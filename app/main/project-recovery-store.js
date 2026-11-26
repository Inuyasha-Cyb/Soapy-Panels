const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  parseAndValidateProjectText,
  PROJECT_RESOURCE_LIMITS,
} = require('../renderer/src/project/validation');
const {
  createRecoveryCoordinator,
  recoveryError,
  boundedRead,
  realDirectory,
} = require('./recovery-coordinator');
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ID = new RegExp(`^${UUID}$`);
const SNAPSHOT = /^snapshot-(\d+)-(\d+)\.json$/;
const META = new RegExp(
  `^(owner\\.json|floor\\.json|claim-${UUID}\\.json|released-${UUID})(\\.${UUID}\\.tmp)?$`,
);
const TEMP = new RegExp(
  `^(snapshot-\\d+-\\d+\\.json|owner\\.json|floor\\.json|claim-${UUID}\\.json|released-${UUID})\\.${UUID}\\.tmp$`,
);
const LIMITS = Object.freeze({
  projectBytes: PROJECT_RESOURCE_LIMITS.maxFileBytes,
  snapshotBytes: PROJECT_RESOURCE_LIMITS.maxFileBytes + 4096,
  totalBytes: 2 * 1024 ** 3,
  sessions: 32,
  ownedSessions: 2,
  recordBytes: 4096,
  sessionMetadataBytes: 64 * 1024,
  coordinatorBytes: 1024 ** 2,
  controlReserveBytes: 3 * 1024 ** 2,
  pageSize: 32,
});
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}
function reduced(value, maximum) {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error('Invalid recovery test limit');
  return Math.min(value, maximum);
}
function createRecoveryStore(root, options = {}) {
  const io = options.fs || fs,
    pid = options.pid || process.pid,
    alive = options.isAlive || processAlive;
  const coordinator = createRecoveryCoordinator(root, { fs: io });
  const owned = new Map(),
    pending = new Map(),
    epochs = new Map(),
    releasing = new Map(),
    maintenance = new Map();
  let disposed = false,
    disposal;
  const limits = {
    ...LIMITS,
    projectBytes: reduced(options.maxBytes, LIMITS.projectBytes),
    snapshotBytes: reduced(options.maxSnapshotBytes, LIMITS.snapshotBytes),
    totalBytes: reduced(options.maxTotalBytes, LIMITS.totalBytes),
    sessions: reduced(options.maxSessions, LIMITS.sessions),
  };
  limits.snapshotBytes = Math.min(
    limits.snapshotBytes,
    limits.projectBytes + 4096,
  );
  function directory(id) {
    if (typeof id !== 'string' || !ID.test(id))
      throw recoveryError('RECOVERY_INVALID', 'Invalid recovery identifier');
    return path.join(root, id);
  }
  async function exists(file) {
    try {
      await io.lstat(file);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }
  async function json(file, maximum = LIMITS.recordBytes) {
    return JSON.parse(await boundedRead(io, file, maximum));
  }
  async function checkDirectory(id) {
    await realDirectory(io, root);
    return realDirectory(io, directory(id));
  }
  function operation(renderer, task, { wait = true } = {}) {
    if (disposed || releasing.has(renderer))
      return Promise.reject(
        recoveryError('RECOVERY_CANCELED', 'Recovery is shutting down.'),
      );
    if (pending.has(renderer))
      return Promise.reject(
        recoveryError(
          'RECOVERY_BUSY',
          'A recovery request is already in progress.',
        ),
      );
    const epoch = epochs.get(renderer) || 0;
    const check = () => {
      if (disposed || (epochs.get(renderer) || 0) !== epoch)
        throw recoveryError(
          'RECOVERY_CANCELED',
          'Recovery request was canceled.',
        );
    };
    const taskPromise = coordinator.run(async () => {
      check();
      return task(check);
    }, wait);
    pending.set(renderer, taskPromise);
    taskPromise.then(
      () => {
        if (pending.get(renderer) === taskPromise) pending.delete(renderer);
      },
      () => {
        if (pending.get(renderer) === taskPromise) pending.delete(renderer);
      },
    );
    return taskPromise;
  }
  function owner(id, renderer, allowClosed = false) {
    const entry = owned.get(id);
    if (!entry || entry.renderer !== renderer || (!allowClosed && entry.closed))
      throw recoveryError(
        'RECOVERY_OWNER',
        'Recovery session is not owned by this renderer',
      );
    return entry;
  }
  function capacity(renderer) {
    if (
      [...owned.values()].filter((e) => e.renderer === renderer).length >=
      LIMITS.ownedSessions
    )
      throw recoveryError(
        'RECOVERY_SESSION_LIMIT',
        'This window already owns two recovery sessions.',
      );
  }
  async function latestOwner(id) {
    await checkDirectory(id);
    const dir = directory(id);
    let entry = await json(path.join(dir, 'owner.json'));
    for (let i = 0; i < 10000; i++) {
      if (
        !entry ||
        !ID.test(entry.token) ||
        !Number.isSafeInteger(entry.pid) ||
        entry.pid <= 0
      )
        throw recoveryError('RECOVERY_INVALID', 'Invalid recovery owner');
      const next = path.join(dir, `claim-${entry.token}.json`);
      if (!(await exists(next))) return entry;
      entry = await json(next);
    }
    throw recoveryError(
      'RECOVERY_INVALID',
      'Recovery ownership chain exceeds limit',
    );
  }
  async function active(id, entry) {
    const marker = path.join(directory(id), `released-${entry.token}`);
    if (await exists(marker)) {
      await json(marker);
      return false;
    }
    return alive(entry.pid) !== false;
  }
  async function assertOwner(id, renderer, allowClosed = false) {
    const local = owner(id, renderer, allowClosed),
      disk = await latestOwner(id);
    if (
      local.token !== disk.token ||
      disk.pid !== pid ||
      !(await active(id, disk))
    )
      throw recoveryError(
        'RECOVERY_OWNER',
        'Recovery session ownership changed',
      );
    return local;
  }
  async function unlink(file) {
    const stat = await io.lstat(file);
    if (!stat.isFile() && !stat.isSymbolicLink())
      throw recoveryError(
        'RECOVERY_UNSAFE',
        'Recovery cleanup encountered an unexpected directory.',
      );
    await io.unlink(file);
  }
  async function durable(file, text, onPublished) {
    const temp = file + '.' + randomUUID() + '.tmp';
    await realDirectory(io, path.dirname(file));
    try {
      const handle = await io.open(temp, 'wx', 0o600);
      try {
        await handle.writeFile(text);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await io.rename(temp, file);
      if (onPublished) onPublished();
    } finally {
      await io.unlink(temp).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    try {
      const handle = await io.open(path.dirname(file), 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (
        !['EPERM', 'EISDIR', 'EINVAL', 'EBADF', 'ENOTSUP', 'EACCES'].includes(
          error.code,
        )
      )
        throw error;
    }
  }
  async function metadata(id, name, value, onPublished) {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > LIMITS.recordBytes)
      throw recoveryError(
        'RECOVERY_INVALID',
        'Recovery metadata exceeds size limit',
      );
    await durable(path.join(directory(id), name), text, onPublished);
  }
  async function compact(id, entry) {
    // All new versions coordinate here. Never compact an active older owner.
    await metadata(id, 'owner.json', entry);
    const dir = directory(id);
    for await (const file of await io.opendir(dir)) {
      if (
        (META.test(file.name) || TEMP.test(file.name)) &&
        file.name !== 'owner.json' &&
        file.name !== 'floor.json' &&
        file.name !== `released-${entry.token}`
      )
        await unlink(path.join(dir, file.name));
    }
  }
  async function removeDirectory(id) {
    await checkDirectory(id);
    const dir = directory(id);
    // Inspect before removing anything, and retain ownership until all data is gone.
    for await (const file of await io.opendir(dir)) {
      if (!file.isFile() && !file.isSymbolicLink())
        throw recoveryError(
          'RECOVERY_UNSAFE',
          'Recovery cleanup encountered an unexpected directory.',
        );
    }
    for await (const file of await io.opendir(dir)) {
      if (file.name !== 'owner.json') await unlink(path.join(dir, file.name));
    }
    if (await exists(path.join(dir, 'owner.json')))
      await unlink(path.join(dir, 'owner.json'));
    await io.rmdir(dir);
    owned.delete(id);
  }
  async function cleanInactive(id, entry) {
    if (await active(id, entry)) return;
    const dir = directory(id);
    for await (const file of await io.opendir(dir))
      if (TEMP.test(file.name)) await unlink(path.join(dir, file.name));
    await compact(id, entry);
    let containsData = false;
    for await (const file of await io.opendir(dir))
      if (!META.test(file.name)) containsData = true;
    if (!containsData) await removeDirectory(id);
  }
  async function usage(clean = false) {
    let totalBytes = 0,
      dataBytes = 0,
      sessions = 0;
    for await (const entry of await io.opendir(root)) {
      const file = path.join(root, entry.name),
        stat = await io.lstat(file);
      if (stat.isSymbolicLink())
        throw recoveryError(
          'RECOVERY_UNSAFE',
          'Recovery storage contains a link.',
        );
      if (entry.name === '.control') {
        await realDirectory(io, file);
        let bytes = 0;
        for await (const part of await io.opendir(file)) {
          const item = await io.lstat(path.join(file, part.name));
          if (!item.isFile() || item.isSymbolicLink())
            throw recoveryError(
              'RECOVERY_UNSAFE',
              'Unsafe recovery coordinator file',
            );
          bytes += item.size;
        }
        if (bytes > LIMITS.coordinatorBytes)
          throw recoveryError(
            'RECOVERY_STORAGE_LIMIT',
            'Recovery coordinator exceeds its storage limit.',
          );
        totalBytes += bytes;
      } else if (ID.test(entry.name) && stat.isDirectory()) {
        if (clean) {
          try {
            await cleanInactive(entry.name, await latestOwner(entry.name));
          } catch (error) {
            if (error.code === 'RECOVERY_UNSAFE')
              throw error; /* Preserve damaged ownership and data. */
          }
          if (!(await exists(file))) continue;
        }
        sessions++;
        let metadataBytes = 0;
        for await (const part of await io.opendir(file)) {
          const item = await io.lstat(path.join(file, part.name));
          if (!item.isFile() || item.isSymbolicLink())
            throw recoveryError(
              'RECOVERY_UNSAFE',
              'Recovery session contains an unsafe entry.',
            );
          totalBytes += item.size;
          if (!META.test(part.name)) dataBytes += item.size;
          else metadataBytes += item.size;
        }
        // Legacy chains may exceed the compact per-session allowance. Charge the
        // excess as data until safe compaction succeeds; never borrow another
        // session's reserved control space.
        dataBytes += Math.max(0, metadataBytes - LIMITS.sessionMetadataBytes);
      } else if (stat.isFile()) {
        totalBytes += stat.size;
        dataBytes += stat.size;
      } else
        throw recoveryError(
          'RECOVERY_UNSAFE',
          'Recovery storage contains an unexpected directory.',
        );
    }
    return {
      totalBytes,
      dataBytes,
      sessions,
      limitBytes: limits.totalBytes,
      sessionLimit: limits.sessions,
    };
  }
  function admit(bytes, used) {
    if (
      Math.max(used.totalBytes, used.dataBytes + LIMITS.controlReserveBytes) +
        bytes >
      limits.totalBytes
    )
      throw recoveryError(
        'RECOVERY_STORAGE_LIMIT',
        'Recovery storage is full. Save the project or manage recovery copies, then retry.',
      );
  }
  function validate(input, writing = false) {
    const envelope = {
      version: writing ? 1 : input?.version,
      timestamp: writing ? new Date().toISOString() : input?.timestamp,
      name: input?.name,
      generation: input?.generation,
      revision: input?.revision,
      excludedVideoCount: input?.excludedVideoCount,
      project: input?.project,
    };
    if (
      envelope.version !== 1 ||
      !Number.isSafeInteger(envelope.generation) ||
      envelope.generation < 0 ||
      !Number.isSafeInteger(envelope.revision) ||
      envelope.revision < 0 ||
      typeof envelope.timestamp !== 'string' ||
      envelope.timestamp.length > 64 ||
      !Number.isFinite(Date.parse(envelope.timestamp)) ||
      typeof envelope.name !== 'string' ||
      envelope.name.length > 512 ||
      !Number.isSafeInteger(envelope.excludedVideoCount) ||
      envelope.excludedVideoCount < 0
    )
      throw recoveryError('RECOVERY_INVALID', 'Invalid recovery metadata');
    let projectText;
    try {
      projectText = JSON.stringify(envelope.project);
    } catch {
      throw recoveryError('RECOVERY_INVALID', 'Invalid recovery project');
    }
    if (
      typeof projectText !== 'string' ||
      Buffer.byteLength(projectText) > limits.projectBytes
    )
      throw recoveryError(
        'RECOVERY_SIZE_LIMIT',
        'Recovery project exceeds size limit',
      );
    envelope.project = parseAndValidateProjectText(projectText);
    for (const image of envelope.project.bg.images || [])
      if (
        image.mediaKind === 'video' ||
        typeof image.src !== 'string' ||
        !image.src.startsWith('data:')
      )
        throw recoveryError(
          'RECOVERY_INVALID',
          'Recovery media must be embedded',
        );
    const text = JSON.stringify(envelope),
      bytes = Buffer.byteLength(text);
    if (bytes > limits.snapshotBytes)
      throw recoveryError(
        'RECOVERY_SIZE_LIMIT',
        'Recovery snapshot exceeds size limit',
      );
    return { envelope, text, bytes, projectText };
  }
  const compare = (a, b) =>
    a.generation - b.generation || a.revision - b.revision;
  function revision(value) {
    if (
      !value ||
      !Number.isSafeInteger(value.generation) ||
      value.generation < 0 ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 0
    )
      throw recoveryError('RECOVERY_INVALID', 'Invalid saved revision');
    return { generation: value.generation, revision: value.revision };
  }
  async function floor(id) {
    try {
      return revision(await json(path.join(directory(id), 'floor.json')));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  async function snapshots(id) {
    await checkDirectory(id);
    const minimum = await floor(id),
      candidates = [];
    for await (const file of await io.opendir(directory(id))) {
      const match = SNAPSHOT.exec(file.name);
      if (
        match &&
        Number.isSafeInteger(+match[1]) &&
        Number.isSafeInteger(+match[2])
      )
        candidates.push({
          name: file.name,
          generation: +match[1],
          revision: +match[2],
        });
    }
    candidates.sort((a, b) => compare(b, a));
    const result = [];
    for (const candidate of candidates) {
      if (minimum && compare(candidate, minimum) <= 0) continue;
      try {
        const valid = validate(
          await json(
            path.join(directory(id), candidate.name),
            limits.snapshotBytes,
          ),
        );
        if (compare(candidate, valid.envelope) !== 0) continue;
        // Keep one parsed project; the second valid snapshot needs only its name.
        result.push(
          result.length
            ? { name: candidate.name }
            : { name: candidate.name, ...valid },
        );
        if (result.length === 2) break;
      } catch {
        /* Preserve corrupt copies and try an earlier completed snapshot. */
      }
    }
    return result;
  }
  function start(renderer) {
    return operation(renderer, async (check) => {
      const current = [...owned.entries()].find(
        ([, e]) => e.renderer === renderer && e.current && !e.closed,
      );
      if (current) return current[0];
      capacity(renderer);
      const used = await usage(true);
      if (used.sessions >= limits.sessions)
        throw recoveryError(
          'RECOVERY_SESSION_LIMIT',
          'Recovery session limit reached. Manage recovery copies, then retry.',
        );
      admit(0, used);
      check();
      const id = randomUUID(),
        entry = { token: randomUUID(), pid };
      await io.mkdir(directory(id), { mode: 0o700 });
      try {
        await metadata(id, 'owner.json', entry);
        check();
        owned.set(id, { ...entry, renderer, current: true, closed: false });
        return id;
      } catch (error) {
        await removeDirectory(id).catch(() => {});
        throw error;
      }
    });
  }
  async function claim(renderer, id) {
    directory(id);
    return operation(renderer, async (check) => {
      if (owned.has(id)) {
        owner(id, renderer);
        return id;
      }
      capacity(renderer);
      const previous = await latestOwner(id);
      if (await active(id, previous))
        throw recoveryError('RECOVERY_ACTIVE', 'Recovery session is active');
      check();
      const entry = { token: randomUUID(), pid };
      await metadata(id, 'owner.json', entry, () => {
        owned.set(id, { ...entry, renderer, current: false, closed: false });
      });
      await compact(id, entry);
      check();
      return id;
    });
  }
  function list(query = {}, renderer = 'listing') {
    return operation(renderer, async () => {
      const cursor = query?.cursor || '';
      if (cursor && !ID.test(cursor))
        throw recoveryError('RECOVERY_INVALID', 'Invalid recovery cursor');
      let used;
      try {
        used = await usage(true);
      } catch (error) {
        used = {
          unavailable: true,
          code: error.code,
          limitBytes: limits.totalBytes,
          sessionLimit: limits.sessions,
        };
      }
      const candidates = [];
      for await (const entry of await io.opendir(root)) {
        if (
          !ID.test(entry.name) ||
          entry.name <= cursor ||
          !entry.isDirectory()
        )
          continue;
        try {
          if (await active(entry.name, await latestOwner(entry.name))) continue;
        } catch {
          continue;
        }
        candidates.push(entry.name);
        candidates.sort();
        if (candidates.length > LIMITS.pageSize + 1) candidates.pop();
      }
      const sessions = [];
      for (const id of candidates.slice(0, LIMITS.pageSize)) {
        let latest;
        try {
          latest = (await snapshots(id))[0];
        } catch {
          /* Present damaged data for explicit discard. */
        }
        const info = latest?.envelope;
        sessions.push({
          id,
          recoverable: !!latest,
          name: info?.name || '',
          timestamp: info?.timestamp || null,
          excludedVideoCount: info?.excludedVideoCount || 0,
        });
      }
      return {
        sessions,
        nextCursor:
          candidates.length > LIMITS.pageSize ? sessions.at(-1).id : null,
        usage: used,
      };
    });
  }
  function write(renderer, id, value) {
    owner(id, renderer);
    return operation(
      renderer,
      async (check) => {
        await assertOwner(id, renderer);
        const valid = validate(value, true),
          envelope = valid.envelope;
        const minimum = await floor(id),
          previous = await snapshots(id);
        if (
          (minimum && compare(envelope, minimum) <= 0) ||
          (previous[0] && compare(envelope, previous[0].envelope) < 0)
        )
          return false;
        if (previous[0] && compare(envelope, previous[0].envelope) === 0) {
          if (valid.projectText !== previous[0].projectText)
            throw recoveryError(
              'RECOVERY_INVALID',
              'Conflicting recovery revision',
            );
          if (
            envelope.name === previous[0].envelope.name &&
            envelope.excludedVideoCount ===
              previous[0].envelope.excludedVideoCount
          )
            return true;
        }
        const used = await usage();
        if (used.sessions > limits.sessions)
          throw recoveryError(
            'RECOVERY_SESSION_LIMIT',
            'Recovery session limit exceeded. Manage recovery copies, then retry.',
          );
        admit(valid.bytes, used);
        check();
        owner(id, renderer);
        const file = `snapshot-${envelope.generation}-${envelope.revision}.json`;
        await durable(path.join(directory(id), file), valid.text);
        const keep = new Set([
          file,
          previous.find((item) => item.name !== file)?.name,
        ]);
        for await (const entry of await io.opendir(directory(id)))
          if (SNAPSHOT.test(entry.name) && !keep.has(entry.name))
            await unlink(path.join(directory(id), entry.name));
        return true;
      },
      { wait: false },
    );
  }
  function read(renderer, id) {
    owner(id, renderer);
    return operation(renderer, async () => {
      await assertOwner(id, renderer);
      const latest = (await snapshots(id))[0];
      if (!latest)
        throw recoveryError('RECOVERY_INVALID', 'No valid recovery snapshot');
      return latest.envelope;
    });
  }
  function clearThrough(renderer, id, value) {
    owner(id, renderer);
    const minimum = revision(value);
    return operation(renderer, async () => {
      await assertOwner(id, renderer);
      const old = await floor(id);
      if (old && compare(minimum, old) < 0) return;
      await metadata(id, 'floor.json', minimum);
      for await (const file of await io.opendir(directory(id))) {
        const match = SNAPSHOT.exec(file.name);
        if (
          match &&
          compare({ generation: +match[1], revision: +match[2] }, minimum) <= 0
        )
          await unlink(path.join(directory(id), file.name));
      }
    });
  }
  function finishSession(renderer, id, discard, internal = false) {
    if (disposed && !internal)
      return Promise.reject(
        recoveryError('RECOVERY_CANCELED', 'Recovery is shutting down.'),
      );
    directory(id);
    if (maintenance.has(renderer))
      return Promise.reject(
        recoveryError(
          'RECOVERY_BUSY',
          'Recovery cleanup is already in progress.',
        ),
      );
    const local = owned.get(id);
    if (local) {
      owner(id, renderer);
      local.closed = true;
    } else if (!discard)
      throw recoveryError(
        'RECOVERY_OWNER',
        'Recovery session is not owned by this renderer',
      );
    const previous = pending.get(renderer);
    const task = (async () => {
      await previous?.catch(() => {});
      return coordinator.run(async () => {
        if (local) await assertOwner(id, renderer, true);
        else if (await active(id, await latestOwner(id)))
          throw recoveryError('RECOVERY_ACTIVE', 'Recovery session is active');
        if (discard) await removeDirectory(id);
        else {
          await metadata(id, `released-${local.token}`, {});
          owned.delete(id);
        }
      }, true);
    })().catch((error) => {
      if (local) local.closed = false;
      throw error;
    });
    maintenance.set(renderer, task);
    task.finally(() => maintenance.delete(renderer)).catch(() => {});
    pending.set(renderer, task);
    task.then(
      () => {
        if (pending.get(renderer) === task) pending.delete(renderer);
      },
      () => {
        if (pending.get(renderer) === task) pending.delete(renderer);
      },
    );
    return task;
  }
  function releaseRenderer(renderer) {
    if (releasing.has(renderer)) return releasing.get(renderer);
    epochs.set(renderer, (epochs.get(renderer) || 0) + 1);
    const task = (async () => {
      await pending.get(renderer)?.catch(() => {});
      for (const [id, entry] of owned)
        if (entry.renderer === renderer && !entry.closed)
          await finishSession(renderer, id, false, true);
    })();
    releasing.set(renderer, task);
    task.finally(() => releasing.delete(renderer)).catch(() => {});
    return task;
  }
  function dispose() {
    if (!disposal) {
      disposed = true;
      disposal = (async () => {
        await Promise.allSettled([...pending.values(), ...releasing.values()]);
        for (const renderer of new Set(
          [...owned.values()].map((e) => e.renderer),
        ))
          await releaseRenderer(renderer);
      })();
    }
    return disposal;
  }
  return {
    start,
    claim,
    list,
    write,
    read,
    clearThrough,
    discard: (renderer, id) => finishSession(renderer, id, true),
    release: (renderer, id) => finishSession(renderer, id, false),
    releaseRenderer,
    dispose,
  };
}
module.exports = { createRecoveryStore, RECOVERY_LIMITS: LIMITS };
