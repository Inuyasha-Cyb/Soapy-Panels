const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

function recoveryError(code, message) {
  return Object.assign(new Error(message), { code });
}
async function realDirectory(io, file, create = false) {
  if (create) await io.mkdir(file, { recursive: true, mode: 0o700 });
  const stat = await io.lstat(file);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw recoveryError(
      'RECOVERY_UNSAFE',
      'Recovery storage contains an unsafe directory.',
    );
  return stat;
}
async function boundedRead(io, file, maximum) {
  const before = await io.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
    throw recoveryError(
      'RECOVERY_UNSAFE',
      'Recovery storage contains an unsafe file.',
    );
  if (before.size > maximum)
    throw recoveryError(
      'RECOVERY_SIZE_LIMIT',
      'Recovery snapshot exceeds size limit.',
    );
  const handle = await io.open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
  );
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino)
      throw recoveryError(
        'RECOVERY_UNSAFE',
        'Recovery file changed while opening.',
      );
    const chunks = [];
    let size = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, maximum + 1 - size));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > maximum)
        throw recoveryError(
          'RECOVERY_SIZE_LIMIT',
          'Recovery snapshot exceeds size limit.',
        );
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, size).toString('utf8');
  } finally {
    await handle.close();
  }
}
function createRecoveryCoordinator(root, options = {}) {
  const io = options.fs || fs;
  const control = path.join(root, '.control');
  const file = path.join(control, 'quota.sqlite');
  async function open() {
    await realDirectory(io, root, true);
    await realDirectory(io, control, true);
    try {
      const handle = await io.open(file, 'wx', 0o600);
      await handle.close();
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let controlBytes = 0;
    for await (const entry of await io.opendir(control)) {
      const part = await io.lstat(path.join(control, entry.name));
      if (!part.isFile() || part.isSymbolicLink() || part.nlink !== 1)
        throw recoveryError(
          'RECOVERY_UNSAFE',
          'Unsafe recovery coordinator entry.',
        );
      controlBytes += part.size;
    }
    if (controlBytes > 1024 * 1024)
      throw recoveryError(
        'RECOVERY_STORAGE_LIMIT',
        'Recovery coordinator exceeds its storage limit.',
      );
    const stat = await io.lstat(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.size > 512 * 1024
    )
      throw recoveryError(
        'RECOVERY_UNSAFE',
        'Recovery coordination storage is unsafe.',
      );
    // Lazy loading permits build checks on Node versions whose SQLite needs a flag.
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(file);
    try {
      db.exec(
        'PRAGMA busy_timeout=0; PRAGMA max_page_count=128; BEGIN IMMEDIATE',
      );
      const version = db.prepare('PRAGMA user_version').get().user_version;
      if (version !== 0 && version !== 1)
        throw new Error('Unknown recovery coordinator version');
      if (version === 0) db.exec('PRAGMA user_version=1');
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }
  async function run(task, wait = false) {
    const deadline = Date.now() + 5000;
    let db;
    while (!db) {
      try {
        db = await open();
      } catch (error) {
        if (
          error.errcode === 5 ||
          error.errcode === 6 ||
          /database is locked/.test(error.message)
        ) {
          if (wait && Date.now() < deadline) {
            await delay(25);
            continue;
          }
          throw recoveryError(
            'RECOVERY_BUSY',
            'Recovery storage is busy. Please retry.',
          );
        }
        if (error.code?.startsWith('RECOVERY_')) throw error;
        throw recoveryError(
          'RECOVERY_IO',
          'Recovery storage could not be coordinated.',
        );
      }
    }
    try {
      const result = await task();
      db.exec('COMMIT');
      return result;
    } finally {
      try {
        if (db.isTransaction) db.exec('ROLLBACK');
      } finally {
        db.close();
      }
    }
  }
  return { run };
}
module.exports = {
  createRecoveryCoordinator,
  recoveryError,
  boundedRead,
  realDirectory,
};
