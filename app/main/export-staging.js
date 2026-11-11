const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createWindowsExportPermissions } = require('./export-private-windows');
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const RUN = new RegExp(`^([1-9][0-9]*)-(${UUID})$`);
const FILE = new RegExp(`^${UUID}\\.tmp$`);
function privacyError(cause) {
  const error = new Error(
    'Unable to create private export staging storage. Check app-profile permissions and available disk space.',
  );
  error.code = 'EXPORT_PRIVATE_STORAGE';
  error.cause = cause;
  return error;
}
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}
function same(a, b) {
  return a.dev === b.dev && a.ino === b.ino;
}
function createExportStaging(root, options = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw privacyError();
  const io = (options.fs || fs).promises;
  const constants = (options.fs || fs).constants;
  const windows = (options.platform || process.platform) === 'win32';
  const uid =
    options.uid === undefined
      ? process.getuid
        ? process.getuid()
        : null
      : options.uid;
  const pid = options.pid || process.pid;
  const alive = options.isAlive || processAlive;
  const log = options.log || (() => {});
  const identifier = (options.randomUUID || randomUUID)();
  if (
    !new RegExp(`^${UUID}$`).test(identifier) ||
    !Number.isSafeInteger(pid) ||
    pid <= 0
  )
    throw privacyError();
  const runPath = path.join(root, `${pid}-${identifier}`);
  let permissions, rootIdentity, runIdentity, ready;
  function own(stat) {
    if (!windows && stat.uid !== uid) throw privacyError();
  }
  async function directory(directoryPath, create = false) {
    if (windows) {
      permissions ||=
        options.windowsPermissions || createWindowsExportPermissions();
      await permissions.directory(directoryPath, create);
    } else {
      if (create)
        await io.mkdir(directoryPath, { mode: 0o700 }).catch((error) => {
          if (error.code !== 'EEXIST') throw error;
        });
      const before = await io.lstat(directoryPath);
      own(before);
      if (!before.isDirectory() || before.isSymbolicLink())
        throw privacyError();
      if (create) await io.chmod(directoryPath, 0o700);
    }
    const stat = await io.lstat(directoryPath);
    own(stat);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (!windows && (stat.mode & 0o777) !== 0o700)
    )
      throw privacyError();
    return stat;
  }
  async function checkDirectories() {
    for (const [directoryPath, identity] of [
      [root, rootIdentity],
      [runPath, runIdentity],
    ]) {
      // ACLs were verified at setup. The protected namespace and identity checks
      // avoid spawning a Windows helper for every encoded chunk.
      const stat = windows
        ? await io.lstat(directoryPath)
        : await directory(directoryPath);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !same(identity, stat))
        throw privacyError();
    }
  }
  function regular(stat) {
    own(stat);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      (!windows && stat.mode & 0o077)
    )
      throw privacyError();
  }
  async function sweep() {
    // Iteration is bounded in memory even if many crashes have accumulated.
    const entries = await io.opendir(root);
    for await (const entry of entries) {
      const match = RUN.exec(entry.name);
      if (
        !match ||
        !entry.isDirectory() ||
        !Number.isSafeInteger(Number(match[1]))
      )
        continue;
      const ownerPid = Number(match[1]);
      if (alive(ownerPid) !== false) continue;
      const dir = path.join(root, entry.name);
      try {
        const identity = await directory(dir);
        const names = await io.readdir(dir);
        if (names.some((name) => name !== 'owner.json' && !FILE.test(name)))
          continue;
        const records = [];
        for (const name of names) {
          const file = path.join(dir, name);
          const stat = await io.lstat(file);
          regular(stat);
          if (name === 'owner.json') {
            if (stat.size > 4096) throw privacyError();
            const owner = JSON.parse(await io.readFile(file, 'utf8'));
            if (
              owner.version !== 1 ||
              owner.pid !== ownerPid ||
              owner.identifier !== match[2]
            )
              throw privacyError();
          }
          records.push({ file, name, stat });
        }
        if (alive(ownerPid) !== false) continue;
        // Delete the record last; sharing/permission errors retain evidence for next startup.
        records.sort(
          (a, b) =>
            Number(a.name === 'owner.json') - Number(b.name === 'owner.json'),
        );
        for (const record of records) {
          if (!same(identity, await directory(dir))) throw privacyError();
          const stat = await io.lstat(record.file);
          regular(stat);
          if (!same(record.stat, stat)) throw privacyError();
          await io.unlink(record.file);
        }
        if (!same(identity, await directory(dir))) throw privacyError();
        await io.rmdir(dir);
      } catch (error) {
        if (error.code !== 'ENOENT')
          log('Export staging cleanup deferred', error.code || 'UNSAFE_ENTRY');
      }
    }
  }
  function initialize() {
    if (!ready)
      ready = (async () => {
        // The profile itself must not allow another user to substitute our staging root.
        const parent = await io.lstat(path.dirname(root));
        own(parent);
        if (
          !parent.isDirectory() ||
          parent.isSymbolicLink() ||
          (!windows && parent.mode & 0o022)
        )
          throw privacyError();
        rootIdentity = await directory(root, true);
        await sweep();
        // This instance never adopts an existing run directory.
        await io.mkdir(runPath, { mode: 0o700 });
        runIdentity = await directory(runPath, true);
        const owner = await io.open(
          path.join(runPath, 'owner.json'),
          'wx',
          0o600,
        );
        try {
          if (windows) await permissions.file(path.join(runPath, 'owner.json'));
          else await owner.chmod(0o600);
          regular(await owner.stat());
          await owner.writeFile(
            JSON.stringify({ version: 1, pid, identifier }),
          );
          await owner.sync();
        } finally {
          await owner.close();
        }
        return runPath;
      })().catch((error) => {
        throw privacyError(error);
      });
    return ready;
  }
  async function open(sessionId) {
    if (!FILE.test(`${sessionId}.tmp`)) throw privacyError();
    await initialize();
    await checkDirectories();
    const tempPath = path.join(runPath, `${sessionId}.tmp`);
    const handle = await io.open(tempPath, 'wx+', 0o600);
    let file;
    try {
      const identity = await handle.stat();
      file = { tempPath, handle, identity };
      if (windows) await permissions.file(tempPath);
      else await handle.chmod(0o600);
      await verify(file);
      return file;
    } catch (error) {
      await handle.close().catch(() => {});
      if (file) await remove(file).catch(() => {});
      throw error;
    }
  }
  async function verify(file) {
    await checkDirectories();
    const stat = await io.lstat(file.tempPath);
    regular(stat);
    if (!same(file.identity, stat)) throw privacyError();
    if (file.handle) {
      const opened = await file.handle.stat();
      regular(opened);
      if (!same(opened, stat)) throw privacyError();
    }
  }
  async function remove(file) {
    try {
      await verify({ ...file, handle: null });
      await io.unlink(file.tempPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  async function copy(file, destination, automatic) {
    await verify(file);
    if (windows) return permissions.copy(file.tempPath, destination, automatic);
    const noFollow = constants.O_NOFOLLOW || 0;
    const source = await io.open(file.tempPath, constants.O_RDONLY | noFollow);
    let output;
    try {
      if (!same(file.identity, await source.stat())) throw privacyError();
      try {
        output = await io.open(destination, 'wx', 0o600);
        await output.chmod(0o600);
      } catch (error) {
        if (automatic || error.code !== 'EEXIST') throw error;
        output = await io.open(
          destination,
          constants.O_WRONLY | noFollow | (constants.O_NONBLOCK || 0),
        );
        if (!(await output.stat()).isFile()) throw privacyError();
        await output.truncate(0);
      }
      const buffer = Buffer.alloc(1024 * 1024);
      let count;
      while (
        (count = (await source.read(buffer, 0, buffer.length, null)).bytesRead)
      ) {
        let offset = 0;
        while (offset < count) {
          const written = (
            await output.write(buffer, offset, count - offset, null)
          ).bytesWritten;
          if (!written) throw new Error('Unable to write exported file.');
          offset += written;
        }
      }
      await output.sync();
    } finally {
      try {
        await source.close();
      } finally {
        if (output) await output.close();
      }
    }
  }
  async function dispose() {
    if (!ready) return;
    try {
      await ready;
    } catch {
      return;
    }
    await checkDirectories();
    const names = await io.readdir(runPath);
    if (names.some((name) => name !== 'owner.json')) return; // Failed deletions stay private for the next launch.
    const ownerPath = path.join(runPath, 'owner.json');
    const stat = await io.lstat(ownerPath);
    regular(stat);
    await io.unlink(ownerPath);
    await io.rmdir(runPath);
  }
  return {
    initialize,
    open,
    verify,
    remove,
    copy,
    dispose,
    runPath,
    cancelHelpers: () => permissions?.cancel(),
  };
}
module.exports = { createExportStaging, privacyError };
