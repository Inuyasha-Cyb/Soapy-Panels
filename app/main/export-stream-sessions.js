const fs = require("fs");
const os = require("os");
const path = require("path");
const nodeCrypto = require("crypto");

const MAX_EXPORT_CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_EXPORT_STREAM_BYTES = 16 * 1024 * 1024 * 1024;
const MAX_EXPORT_CUMULATIVE_WRITE_BYTES = 32 * 1024 * 1024 * 1024;
const MIN_EXPORT_FREE_BYTES = 512 * 1024 * 1024;
const MAX_EXPORT_STREAM_SESSIONS = 4;
const MAX_EXPORT_STREAM_SESSIONS_PER_WEB_CONTENTS = 1;
const EXPORT_STREAM_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const EXPORT_STREAM_RESOURCE_ERROR = "EXPORT_STREAM_RESOURCE_LIMIT";

function createSessionId() {
  if (typeof nodeCrypto.randomUUID === "function") return nodeCrypto.randomUUID();
  return `${Date.now().toString(36)}-${nodeCrypto.randomBytes(8).toString("hex")}`;
}

function resourceLimitError(message) {
  const error = new Error(message);
  error.code = EXPORT_STREAM_RESOURCE_ERROR;
  return error;
}

function createExportStreamSessionRegistry(options = {}) {
  const fileSystem = options.fs || fs;
  const tempRoot = options.tempRoot || os.tmpdir();
  const setTimer = options.setTimeout || setTimeout;
  const clearTimer = options.clearTimeout || clearTimeout;
  const idleTimeoutMs = Number.isFinite(options.idleTimeoutMs)
    ? Math.max(1, options.idleTimeoutMs)
    : EXPORT_STREAM_IDLE_TIMEOUT_MS;
  const maxStreamBytes = Number.isSafeInteger(options.maxStreamBytes)
    ? options.maxStreamBytes
    : MAX_EXPORT_STREAM_BYTES;
  const maxCumulativeWriteBytes = Number.isSafeInteger(options.maxCumulativeWriteBytes)
    ? options.maxCumulativeWriteBytes
    : MAX_EXPORT_CUMULATIVE_WRITE_BYTES;
  const minFreeBytes = Number.isSafeInteger(options.minFreeBytes)
    ? options.minFreeBytes
    : MIN_EXPORT_FREE_BYTES;
  const maxSessions = Number.isSafeInteger(options.maxSessions)
    ? options.maxSessions
    : MAX_EXPORT_STREAM_SESSIONS;
  const maxSessionsPerWebContents = Number.isSafeInteger(options.maxSessionsPerWebContents)
    ? options.maxSessionsPerWebContents
    : MAX_EXPORT_STREAM_SESSIONS_PER_WEB_CONTENTS;
  const statfs =
    typeof options.statfs === "function"
      ? options.statfs
      : fileSystem.promises && typeof fileSystem.promises.statfs === "function"
        ? fileSystem.promises.statfs.bind(fileSystem.promises)
        : null;
  const sessions = new Map();

  function requireOwnedSession(sessionId, webContentsId) {
    const session = sessions.get(typeof sessionId === "string" ? sessionId : "");
    if (!session || session.state !== "open") {
      throw new Error("Export stream is no longer available.");
    }
    const senderId = Number.isInteger(webContentsId) ? webContentsId : null;
    if (session.webContentsId !== null && session.webContentsId !== senderId) {
      throw new Error("Export stream does not belong to this window.");
    }
    return session;
  }

  function clearIdleTimer(session) {
    if (!session || !session.idleTimer) return;
    clearTimer(session.idleTimer);
    session.idleTimer = null;
  }

  async function closeAndDelete(session) {
    if (!session) return;
    clearIdleTimer(session);
    if (session.handle) {
      try {
        await session.handle.close();
      } catch {
        /* best-effort handle cleanup */
      }
      session.handle = null;
    }
    try {
      await fileSystem.promises.unlink(session.tempPath);
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
    }
  }

  function removeSession(session) {
    if (!session) return;
    if (sessions.get(session.sessionId) === session) sessions.delete(session.sessionId);
    session.state = "closed";
    clearIdleTimer(session);
  }

  async function invalidateSession(session) {
    removeSession(session);
    await closeAndDelete(session).catch(function () {});
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
        if (sessions.get(session.sessionId) !== session || session.state !== "open") return;
        await invalidateSession(session);
      }).catch(function () {});
    }, idleTimeoutMs);
    if (session.idleTimer && typeof session.idleTimer.unref === "function") {
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
      throw resourceLimitError("Not enough free disk space to continue the export.");
    }
  }

  function countForWebContents(webContentsId) {
    const senderId = Number.isInteger(webContentsId) ? webContentsId : null;
    let count = 0;
    for (const session of sessions.values()) {
      if (session.state === "open" && session.webContentsId === senderId) count += 1;
    }
    return count;
  }

  return {
    async begin(target, webContentsId) {
      if (!target || typeof target.filePath !== "string" || !target.filePath) {
        throw new Error("Export target path is required.");
      }
      if (sessions.size >= maxSessions) {
        throw resourceLimitError("Too many export streams are active.");
      }
      if (countForWebContents(webContentsId) >= maxSessionsPerWebContents) {
        throw resourceLimitError("An export stream is already active for this window.");
      }
      await requireDiskHeadroom(tempRoot, 0);

      const sessionId = createSessionId();
      const tempPath = path.join(tempRoot, `soapy-panels-export-${sessionId}.tmp`);
      const handle = await fileSystem.promises.open(tempPath, "w+");
      const session = {
        sessionId,
        filePath: target.filePath,
        tempPath,
        handle,
        webContentsId: Number.isInteger(webContentsId) ? webContentsId : null,
        highestWrittenEnd: 0,
        cumulativeBytesWritten: 0,
        queue: Promise.resolve(),
        idleTimer: null,
        state: "open",
      };
      sessions.set(sessionId, session);
      armIdleTimer(session);
      return { sessionId };
    },

    async write(sessionId, webContentsId, position, payload) {
      const session = requireOwnedSession(sessionId, webContentsId);
      return queueSessionTask(session, async () => {
        if (sessions.get(session.sessionId) !== session || session.state !== "open") {
          throw new Error("Export stream is no longer available.");
        }
        try {
          const offset = Number(position);
          if (!Number.isSafeInteger(offset) || offset < 0) {
            throw resourceLimitError("Invalid export stream position.");
          }
          if (!Buffer.isBuffer(payload)) {
            throw resourceLimitError("Invalid export stream data.");
          }
          if (payload.byteLength > MAX_EXPORT_CHUNK_BYTES) {
            throw resourceLimitError("Export stream chunk is too large.");
          }
          const writeEnd = offset + payload.byteLength;
          if (!Number.isSafeInteger(writeEnd) || writeEnd > maxStreamBytes) {
            throw resourceLimitError("Export stream exceeds the maximum file size.");
          }
          const cumulative = session.cumulativeBytesWritten + payload.byteLength;
          if (
            !Number.isSafeInteger(cumulative) ||
            cumulative > maxCumulativeWriteBytes
          ) {
            throw resourceLimitError("Export stream exceeds the cumulative write limit.");
          }
          if (!payload.byteLength) {
            armIdleTimer(session);
            return { ok: true, bytesWritten: 0 };
          }

          const logicalGrowth = Math.max(0, writeEnd - session.highestWrittenEnd);
          await requireDiskHeadroom(
            tempRoot,
            Math.max(payload.byteLength, logicalGrowth),
          );
          const result = await session.handle.write(payload, 0, payload.byteLength, offset);
          if (!result || result.bytesWritten !== payload.byteLength) {
            throw new Error("Unable to write the complete export stream chunk.");
          }
          session.highestWrittenEnd = Math.max(session.highestWrittenEnd, writeEnd);
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
      session.state = "finishing";
      clearIdleTimer(session);
      return queueSessionTask(session, async () => {
        sessions.delete(session.sessionId);
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
          await fileSystem.promises.copyFile(session.tempPath, session.filePath);
          await fileSystem.promises.unlink(session.tempPath);
          session.state = "closed";
          return { ok: true, fileName: path.basename(session.filePath) };
        } catch (error) {
          await invalidateSession(session);
          throw error;
        }
      });
    },

    async abort(sessionId, webContentsId) {
      const key = typeof sessionId === "string" ? sessionId : "";
      const session = sessions.get(key);
      if (!session) return false;
      requireOwnedSession(key, webContentsId);
      removeSession(session);
      await session.queue.catch(function () {});
      await closeAndDelete(session);
      return true;
    },

    async clearForWebContents(webContentsId) {
      const senderId = Number.isInteger(webContentsId) ? webContentsId : null;
      const matches = Array.from(sessions.values()).filter(
        (session) => session.webContentsId === senderId,
      );
      for (const session of matches) removeSession(session);
      for (const session of matches) {
        await session.queue.catch(function () {});
        await closeAndDelete(session).catch(function () {});
      }
    },

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
