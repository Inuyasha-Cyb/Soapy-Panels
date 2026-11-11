const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const {
  createExportStreamSessionRegistry,
} = require('../../app/main/export-stream-sessions');

test(
  'restart removes a killed exporter but preserves another live process in the same profile',
  { timeout: 60000 },
  async () => {
    const profile = await fs.mkdtemp(
      path.join(os.tmpdir(), 'soapy-export-crash-'),
    );
    const root = path.join(profile, 'export-staging');
    const children = [];
    let restarted;
    async function launch() {
      const child = spawn(
        process.execPath,
        [
          '-e',
          `
      const {createExportStreamSessionRegistry}=require('./app/main/export-stream-sessions');
      const path=require('node:path');
      const r=createExportStreamSessionRegistry({stagingRoot:process.argv[1],minFreeBytes:0});
      (async()=>{ const s=await r.begin({filePath:path.join(process.argv[1],'unused.mp4')},1);
        await r.write(s.sessionId,1,0,Buffer.from('private synthetic artwork'));
        process.send({pid:process.pid,session:s.sessionId});
        process.on('message',async()=>{await r.write(s.sessionId,1,25,Buffer.from('still alive'));process.send({alive:true});});
      })().catch(e=>{console.error(e);process.exit(1)});
    `,
          root,
        ],
        {
          cwd: path.resolve(__dirname, '../..'),
          stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        },
      );
      children.push(child);
      const [message] = await once(child, 'message');
      return { child, ...message };
    }
    try {
      const dead = await launch(),
        live = await launch();
      const deadRun = (await fs.readdir(root)).find((name) =>
        name.startsWith(dead.pid + '-'),
      );
      const liveRun = (await fs.readdir(root)).find((name) =>
        name.startsWith(live.pid + '-'),
      );
      const stopped = once(dead.child, 'exit');
      dead.child.kill('SIGKILL');
      await stopped;
      restarted = createExportStreamSessionRegistry({
        stagingRoot: root,
        minFreeBytes: 0,
      });
      await restarted.initialize();
      assert.ok(!(await fs.readdir(root)).includes(deadRun));
      const liveFile = path.join(root, liveRun, live.session + '.tmp');
      assert.equal(
        await fs.readFile(liveFile, 'utf8'),
        'private synthetic artwork',
      );
      const response = once(live.child, 'message');
      live.child.send('continue');
      assert.equal((await response)[0].alive, true);
      assert.match(await fs.readFile(liveFile, 'utf8'), /still alive$/);
    } finally {
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null) {
          const stopped = once(child, 'exit');
          child.kill('SIGKILL');
          await stopped;
        }
      await restarted?.dispose();
      await fs.rm(profile, { recursive: true, force: true });
    }
  },
);
