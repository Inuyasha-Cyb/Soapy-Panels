const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const {
  createRecoveryStore,
  RECOVERY_LIMITS: L,
} = require('../../app/main/project-recovery-store');
const flags = process.execArgv.filter((arg) => arg === '--experimental-sqlite');
const modulePath = require.resolve('../../app/main/project-recovery-store');
const value = {
  generation: 0,
  revision: 1,
  name: 'child',
  excludedVideoCount: 0,
  project: { bg: { w: 100, h: 100, images: [] }, bubbles: [], savedStyles: [] },
};
async function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
}
async function launch(root, code, extra = []) {
  const child = spawn(
    process.execPath,
    [...flags, '-e', code, modulePath, root, ...extra],
    { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
  );
  const response = await Promise.race([
    once(child, 'message').then(([message]) => message),
    once(child, 'exit').then(() => {
      throw new Error('Child exited before reporting');
    }),
  ]);
  return { child, response };
}
test(
  'two processes cannot exceed a shared session cap and a live owner survives discovery',
  { timeout: 30000 },
  async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'soapy-recovery-race-'),
    );
    const children = [];
    const script = `const {createRecoveryStore}=require(process.argv[1]); const s=createRecoveryStore(process.argv[2],{maxSessions:1});
    (async()=>{try{const id=await s.start(1);await s.write(1,id,JSON.parse(process.argv[3]));process.send({ok:true,id});}catch(e){process.send({ok:false,code:e.code});}process.on('message',()=>{});})().catch(e=>{console.error(e);process.exit(1)});`;
    try {
      const results = await Promise.all([
        launch(root, script, [JSON.stringify(value)]),
        launch(root, script, [JSON.stringify(value)]),
      ]);
      children.push(...results.map((r) => r.child));
      assert.equal(results.filter((r) => r.response.ok).length, 1);
      assert.equal(
        results.find((r) => !r.response.ok).response.code,
        'RECOVERY_SESSION_LIMIT',
      );
      const store = createRecoveryStore(root, { maxSessions: 1 });
      assert.equal((await store.list()).sessions.length, 0);
      await assert.rejects(
        store.claim(2, results.find((r) => r.response.ok).response.id),
        { code: 'RECOVERY_ACTIVE' },
      );
      await store.dispose();
    } finally {
      for (const child of children) await terminate(child);
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
test(
  'killing a writer releases SQLite coordination, cleans its temp, and preserves the previous snapshot',
  { timeout: 30000 },
  async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'soapy-recovery-kill-'),
    );
    let child;
    const script = `const fs=require('node:fs/promises');const {createRecoveryStore}=require(process.argv[1]);let crash=false;
    const io={...fs,rename:async(a,b)=>{if(crash&&b.includes('snapshot-')){process.send({id,temp:a});await new Promise(()=>{});}return fs.rename(a,b);}};
    const store=createRecoveryStore(process.argv[2],{fs:io});let id;
    (async()=>{id=await store.start(1);const value=JSON.parse(process.argv[3]);await store.write(1,id,value);crash=true;await store.write(1,id,{...value,revision:2});})().catch(e=>{console.error(e);process.exit(1)});`;
    try {
      const started = await launch(root, script, [JSON.stringify(value)]);
      child = started.child;
      assert.ok((await fs.stat(started.response.temp)).size > 0);
      const contender = createRecoveryStore(root);
      // A busy writer is not a stale lease: no directory is deleted to take its lock.
      const before = await fs.readdir(path.join(root, started.response.id));
      await terminate(child);
      child = null;
      const listed = await contender.list();
      assert.equal(listed.sessions.length, 1);
      assert.ok(before.some((n) => n.endsWith('.tmp')));
      assert.ok(
        !(await fs.readdir(path.join(root, started.response.id))).some((n) =>
          n.endsWith('.tmp'),
        ),
      );
      await contender.claim(2, started.response.id);
      assert.equal((await contender.read(2, started.response.id)).revision, 1);
      await contender.write(2, started.response.id, { ...value, revision: 2 });
      assert.ok((await contender.list()).usage.totalBytes < L.totalBytes);
      await contender.dispose();
    } finally {
      if (child) await terminate(child);
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
test(
  'separate processes race aggregate byte admission without exceeding the temporary-write budget',
  { timeout: 30000 },
  async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'soapy-recovery-bytes-'),
    );
    const children = [];
    const bytes = Buffer.byteLength(
      JSON.stringify({
        version: 1,
        timestamp: new Date().toISOString(),
        name: value.name,
        generation: 0,
        revision: 1,
        excludedVideoCount: 0,
        project: value.project,
      }),
    );
    const script = `const {createRecoveryStore}=require(process.argv[1]);const store=createRecoveryStore(process.argv[2],{maxTotalBytes:Number(process.argv[4])});
    (async()=>{const id=await store.start(1);process.send({ready:true,id});process.once('message',async()=>{try{await store.write(1,id,JSON.parse(process.argv[3]));process.send({ok:true});}catch(e){process.send({ok:false,code:e.code});}});})().catch(e=>{console.error(e);process.exit(1)});`;
    try {
      const a = await launch(root, script, [
        JSON.stringify(value),
        String(L.controlReserveBytes + bytes),
      ]);
      children.push(a.child);
      const b = await launch(root, script, [
        JSON.stringify(value),
        String(L.controlReserveBytes + bytes),
      ]);
      children.push(b.child);
      const answers = children.map((child) =>
        once(child, 'message').then(([message]) => message),
      );
      children.forEach((child) => child.send('write'));
      const results = await Promise.all(answers);
      assert.equal(results.filter((r) => r.ok).length, 1);
      assert.ok(
        ['RECOVERY_BUSY', 'RECOVERY_STORAGE_LIMIT'].includes(
          results.find((r) => !r.ok).code,
        ),
      );
      const inspection = createRecoveryStore(root, {
        maxTotalBytes: L.controlReserveBytes + bytes,
      });
      const usage = (await inspection.list()).usage;
      assert.equal(usage.dataBytes, bytes);
      assert.ok(usage.totalBytes <= usage.limitBytes);
      await inspection.dispose();
    } finally {
      for (const child of children) await terminate(child);
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
