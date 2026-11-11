const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
const { createExportStaging } = require('./export-staging');
const { nextAvailableExportPath } = require('./export-save-targets');

const MAX_EXPORT_CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_EXPORT_STREAM_BYTES = 16 * 1024 * 1024 * 1024;
const MAX_EXPORT_CUMULATIVE_WRITE_BYTES = 32 * 1024 * 1024 * 1024;
const MIN_EXPORT_FREE_BYTES = 512 * 1024 * 1024;
const MAX_EXPORT_STREAM_SESSIONS = 4;
const MAX_EXPORT_STREAM_SESSIONS_PER_WEB_CONTENTS = 1;
const EXPORT_STREAM_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const EXPORT_STREAM_RESOURCE_ERROR = 'EXPORT_STREAM_RESOURCE_LIMIT';

function createSessionId() {
  if (typeof nodeCrypto.randomUUID === 'function')
    return nodeCrypto.randomUUID();
  return `${Date.now().toString(36)}-${nodeCrypto.randomBytes(8).toString('hex')}`;
}

function resourceLimitError(message) {
  const error = new Error(message);
  error.code = EXPORT_STREAM_RESOURCE_ERROR;
  return error;
}

function createExportStreamSessionRegistry(options = {}) {
  const fileSystem = options.fs || fs;
  const staging =
    options.staging || createExportStaging(options.stagingRoot, options);
  const tempRoot = staging.runPath;
  const log = options.log || (() => {});
  let closing = false;
  let disposal;
  const pendingBegins = new Set();
  const ownedResources = new Set();
  const setTimer = options.setTimeout || setTimeout;
  const clearTimer = options.clearTimeout || clearTimeout;
  const idleTimeoutMs = Number.isFinite(options.idleTimeoutMs)
    ? Math.max(1, options.idleTimeoutMs)
    : EXPORT_STREAM_IDLE_TIMEOUT_MS;
  const maxStreamBytes = Number.isSafeInteger(options.maxStreamBytes)
    ? options.maxStreamBytes
    : MAX_EXPORT_STREAM_BYTES;
  const maxCumulativeWriteBytes = Number.isSafeInteger(
    options.maxCumulativeWriteBytes,
  )
    ? options.maxCumulativeWriteBytes
    : MAX_EXPORT_CUMULATIVE_WRITE_BYTES;
  const minFreeBytes = Number.isSafeInteger(options.minFreeBytes)
    ? options.minFreeBytes
    : MIN_EXPORT_FREE_BYTES;
  const maxSessions = Number.isSafeInteger(options.maxSessions)
    ? options.maxSessions
    : MAX_EXPORT_STREAM_SESSIONS;
  const maxSessionsPerWebContents = Number.isSafeInteger(
    options.maxSessionsPerWebContents,
  )
    ? options.maxSessionsPerWebContents
    : MAX_EXPORT_STREAM_SESSIONS_PER_WEB_CONTENTS;
  const statfs =
    typeof options.statfs === 'function'
      ? options.statfs
      : fileSystem.promises && typeof fileSystem.promises.statfs === 'function'
        ? fileSystem.promises.statfs.bind(fileSystem.promises)
        : null;
  const sessions = new Map();

  function requireOwnedSession(sessionId, webContentsId) {
    const session = sessions.get(
      typeof sessionId === 'string' ? sessionId : '',
    );
    if (!session || session.state !== 'open') {
      throw new Error('Export stream is no longer available.');
    }
    const senderId = Number.isInteger(webContentsId) ? webContentsId : null;
    if (session.webContentsId !== null && session.webContentsId !== senderId) {
      throw new Error('Export stream does not belong to this window.');
    }
    return session;
  }

  function clearIdleTimer(session) {
    if (!session || !session.idleTimer) return;
    clearTimer(session.idleTimer);
    session.idleTimer = null;
  }

  function closeAndDelete(session) {
    if (!session) return Promise.resolve();
    if (session.cleanup) return session.cleanup;
    clearIdleTimer(session);
    session.cleanup = (async () => {
      if (session.handle) {
        await session.handle.close();
        session.handle = null;
      }
      await staging.remove(session);
      ownedResources.delete(session);
    })();
    return session.cleanup;
  }

  function removeSession(session) {
    if (!session) return;
    if (sessions.get(session.sessionId) === session)
      sessions.delete(session.sessionId);
    session.state = 'closed';
    clearIdleTimer(session);
  }

  async function invalidateSession(session) {
    removeSession(session);
    await closeAndDelete(session).catch((error) =>
      log('Export staging cleanup deferred', error.code || 'IO_ERROR'),
    );
  }

  function queueSessionTask(session, task) {
    const run = session.queue.catch(function () {}).then(task);
    session.queue = run.catch(function () {});
    return run;
  }

  function armIdleTimer(session) {
    clearIdleTimer(session);
    session.idleTimer = setTimer(() => {
      queueSessionTask(session, async () => {
        if (
          sessions.get(session.sessionId) !== session ||
          session.state !== 'open'
        )
          return;
        await invalidateSession(session);
      }).catch(function () {});
    }, idleTimeoutMs);
    if (session.idleTimer && typeof session.idleTimer.unref === 'function') {
      session.idleTimer.unref();
    }
  }

  async function availableBytes(checkPath) {
    if (!statfs) return null;
    try {
      const stats = await statfs(checkPath);
      const blocks = stats && (stats.bavail ?? stats.bfree);
      const blockSize = stats && stats.bsize;
      if (blocks === undefined || blockSize === undefined) return null;
      return BigInt(blocks) * BigInt(blockSize);
    } catch {
      return null;
    }
  }

  async function requireDiskHeadroom(checkPath, additionalBytes) {
    const available = await availableBytes(checkPath);
    if (available === null) return;
    const required = BigInt(additionalBytes) + BigInt(minFreeBytes);
    if (available < required) {
      throw resourceLimitError(
        'Not enough free disk space to continue the export.',
      );
    }
  }

  function countForWebContents(webContentsId) {
    const senderId = Number.isInteger(webContentsId) ? webContentsId : null;
    let count = 0;
    for (const session of sessions.values()) {
      if (session.state !== 'closed' && session.webContentsId === senderId)
        count += 1;
    }
    return count;
  }

  async function begin(target, webContentsId) {
    if (closing) throw new Error('Export storage is shutting down.');
    if (!target || typeof target.filePath !== 'string' || !target.filePath) {
      throw new Error('Export target path is required.');
    }
    if (sessions.size >= maxSessions)
      throw resourceLimitError('Too many export streams are active.');
    if (countForWebContents(webContentsId) >= maxSessionsPerWebContents) {
      throw resourceLimitError(
        'An export stream is already active for this window.',
      );
    }
    const sessionId = createSessionId();
    const session = {
      sessionId,
      filePath: target.filePath,
      automatic: target.automatic === true,
      webContentsId: Number.isInteger(webContentsId) ? webContentsId : null,
      highestWrittenEnd: 0,
      cumulativeBytesWritten: 0,
      queue: Promise.resolve(),
      idleTimer: null,
      state: 'opening',
      handle: null,
    };
    // Reserve before awaiting initialization so disposal and renderer teardown see begins.
    sessions.set(sessionId, session);
    try {
      await staging.initialize();
      await requireDiskHeadroom(tempRoot, 0);
      if (closing || session.state !== 'opening')
        throw new Error('Export stream was canceled.');
      Object.assign(session, await staging.open(sessionId));
      ownedResources.add(session);
      if (closing || session.state !== 'opening')
        throw new Error('Export stream was canceled.');
      session.state = 'open';
      armIdleTimer(session);
      return { sessionId };
    } catch (error) {
      removeSession(session);
      if (session.tempPath)
        await closeAndDelete(session).catch((cleanupError) =>
          log(
            'Export staging cleanup deferred',
            cleanupError.code || 'IO_ERROR',
          ),
        );
      throw error;
    }
  }

  return {
    initialize: () => staging.initialize(),
    begin(target, webContentsId) {
      const task = begin(target, webContentsId);
      pendingBegins.add(task);
      task.then(
        () => pendingBegins.delete(task),
        () => pendingBegins.delete(task),
      );
      return task;
    },

    async write(sessionId, webContentsId, position, payload) {
      const session = requireOwnedSession(sessionId, webContentsId);
      return queueSessionTask(session, async () => {
        if (
          sessions.get(session.sessionId) !== session ||
          !['open', 'finishing'].includes(session.state)
        ) {
          throw new Error('Export stream is no longer available.');
        }
        try {
          const offset = Number(position);
          if (!Number.isSafeInteger(offset) || offset < 0) {
            throw resourceLimitError('Invalid export stream position.');
          }
          if (!Buffer.isBuffer(payload)) {
            throw resourceLimitError('Invalid export stream data.');
          }
          if (payload.byteLength > MAX_EXPORT_CHUNK_BYTES) {
            throw resourceLimitError('Export stream chunk is too large.');
          }
          const writeEnd = offset + payload.byteLength;
          if (!Number.isSafeInteger(writeEnd) || writeEnd > maxStreamBytes) {
            throw resourceLimitError(
              'Export stream exceeds the maximum file size.',
            );
          }
          const cumulative =
            session.cumulativeBytesWritten + payload.byteLength;
          if (
            !Number.isSafeInteger(cumulative) ||
            cumulative > maxCumulativeWriteBytes
          ) {
            throw resourceLimitError(
              'Export stream exceeds the cumulative write limit.',
            );
          }
          if (!payload.byteLength) {
            armIdleTimer(session);
            return { ok: true, bytesWritten: 0 };
          }

          const logicalGrowth = Math.max(
            0,
            writeEnd - session.highestWrittenEnd,
          );
          await requireDiskHeadroom(
            tempRoot,
            Math.max(payload.byteLength, logicalGrowth),
          );
          await staging.verify(session);
          const result = await session.handle.write(
            payload,
            0,
            payload.byteLength,
            offset,
          );
          if (!result || result.bytesWritten !== payload.byteLength) {
            throw new Error(
              'Unable to write the complete export stream chunk.',
            );
          }
          session.highestWrittenEnd = Math.max(
            session.highestWrittenEnd,
            writeEnd,
          );
          session.cumulativeBytesWritten = cumulative;
          armIdleTimer(session);
          return { ok: true, bytesWritten: result.bytesWritten };
        } catch (error) {
          await invalidateSession(session);
          throw error;
        }
      });
    },

    async finish(sessionId, webContentsId) {
      const session = requireOwnedSession(sessionId, webContentsId);
      session.state = 'finishing';
      clearIdleTimer(session);
      return queueSessionTask(session, async () => {
        try {
          if (session.handle) {
            await session.handle.sync();
            await session.handle.close();
            session.handle = null;
          }
          await requireDiskHeadroom(
            path.dirname(session.filePath),
            session.highestWrittenEnd,
          );
          let filePath = session.filePath;
          while (true) {
            try {
              await staging.copy(session, filePath, session.automatic);
              break;
            } catch (error) {
              if (!session.automatic || !error || error.code !== 'EEXIST')
                throw error;
              filePath = nextAvailableExportPath(filePath, fileSystem);
            }
          }
          await closeAndDelete(session);
          removeSession(session);
          return { ok: true, fileName: path.basename(filePath) };
        } catch (error) {
          await invalidateSession(session);
          throw error;
        }
      });
    },

    async abort(sessionId, webContentsId) {
      const key = typeof sessionId === 'string' ? sessionId : '';
      const session = sessions.get(key);
      if (!session) return false;
      const senderId = Number.isInteger(webContentsId) ? webContentsId : null;
      if (session.webContentsId !== null && session.webContentsId !== senderId)
        throw new Error('Export stream does not belong to this window.');
      if (session.state === 'finishing') {
        await session.queue.catch(() => {});
        return false;
      }
      removeSession(session);
      await session.queue.catch(function () {});
      if (session.tempPath) await closeAndDelete(session);
      return true;
    },

    async clearForWebContents(webContentsId) {
      const senderId = Number.isInteger(webContentsId) ? webContentsId : null;
      const matches = Array.from(sessions.values()).filter(
        (session) => session.webContentsId === senderId,
      );
      for (const session of matches) {
        // Finishing already owns its queued copy. Let it drain before cleanup.
        if (session.state !== 'finishing') removeSession(session);
      }
      await Promise.allSettled(Array.from(pendingBegins));
      for (const session of matches) {
        await session.queue.catch(() => {});
        if (session.tempPath)
          await closeAndDelete(session).catch((error) =>
            log('Export staging cleanup deferred', error.code || 'IO_ERROR'),
          );
      }
    },

    dispose() {
      if (disposal) return disposal;
      closing = true;
      for (const session of sessions.values()) {
        if (session.state !== 'finishing') removeSession(session);
      }
      disposal = (async () => {
        await Promise.allSettled(Array.from(pendingBegins));
        for (const session of ownedResources) {
          await session.queue.catch(() => {});
          await closeAndDelete(session).catch((error) =>
            log('Export staging cleanup deferred', error.code || 'IO_ERROR'),
          );
        }
        await staging.dispose();
      })();
      return disposal;
    },

    cancelHelpers: () => staging.cancelHelpers(),

    size() {
      return sessions.size;
    },
  };
}

module.exports = {
  EXPORT_STREAM_IDLE_TIMEOUT_MS,
  EXPORT_STREAM_RESOURCE_ERROR,
  MAX_EXPORT_CHUNK_BYTES,
  MAX_EXPORT_CUMULATIVE_WRITE_BYTES,
  MAX_EXPORT_STREAM_BYTES,
  MAX_EXPORT_STREAM_SESSIONS,
  MAX_EXPORT_STREAM_SESSIONS_PER_WEB_CONTENTS,
  MIN_EXPORT_FREE_BYTES,
  createExportStreamSessionRegistry,
};
