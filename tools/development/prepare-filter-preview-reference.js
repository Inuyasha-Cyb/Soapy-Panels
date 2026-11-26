#!/usr/bin/env node
// Creates an isolated benchmark reference; never edits the working app or Git state.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const esprima = require('esprima');
const root = path.resolve(__dirname, '../..');
const revision = process.argv[2] || 'HEAD';
const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'soapy-filter-reference-'));
const fromGit = file => execFileSync('git', ['show', `${revision}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const original = fromGit('app/renderer/src/boot.js');
let current = fs.readFileSync(path.join(root, 'app/renderer/src/boot.js'), 'utf8');
const names = new Set([
  'markGifEntryFrameDirty', 'handleGifPlaybackFrame', 'markVideoEntryFrameDirty',
  'installVideoRuntime', 'getPlayingVideoEntries', 'handleVideoPlaybackFrame',
  'getAnimatedColorEffectFrame', 'cacheAnimatedColorEffectFrame',
  'runNextAnimatedColorEffectRequest', 'requestAnimatedColorEffectFrame',
  'getAnimatedColorEffectDisplaySource', 'releaseColorEffectRuntime',
  'refreshColorEffectPreviewAfterDisplaySourceChange', 'requestColorEffectPreview',
  'renderImageEffectDraft', 'scheduleImageEffectDraft', 'closeImageEffectsEditor',
  'flushRenderFrame',
]);
function collect(source) {
  const found = {};
  esprima.parseScript(source, { range: true }, node => {
    if (node.type === 'FunctionDeclaration' && node.id && names.has(node.id.name)) found[node.id.name] = node.range;
  });
  return found;
}
const before = collect(original);
const after = collect(current);
for (const name of names) {
  if (!before[name] || !after[name]) throw new Error(`Revision does not contain the expected preview function: ${name}`);
}
for (const name of [...names].sort((a, b) => after[b][0] - after[a][0])) {
  const [a, b] = after[name];
  const [c, d] = before[name];
  current = current.slice(0, a) + original.slice(c, d) + current.slice(b);
}
const hook = '        if (cached && cached.bitmap) return cached.bitmap;';
if (!current.includes(hook)) throw new Error('Reference display metric hook is unavailable.');
current = current.replace(hook, `        var displayed = cached && cached.bitmap || (runtime.animatedLastSignature === signature && runtime.animatedLastSource);
        if (displayed && runtime.lastDisplayedSource !== displayed) {
          var now = perfNow();
          if (runtime.lastDisplayedAt) previewMetrics.record("displayIntervalMs", now - runtime.lastDisplayedAt);
          runtime.lastDisplayedAt = now;
          runtime.lastDisplayedSource = displayed;
        }
${hook}`);
fs.cpSync(path.join(root, 'app'), path.join(destination, 'app'), { recursive: true });
fs.copyFileSync(path.join(root, 'package.json'), path.join(destination, 'package.json'));
fs.mkdirSync(path.join(destination, 'test/support'), { recursive: true });
fs.copyFileSync(path.join(root, 'test/support/recovery-launch.js'), path.join(destination, 'test/support/recovery-launch.js'));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(destination, 'node_modules'), 'junction');
fs.writeFileSync(path.join(destination, 'app/renderer/src/boot.js'), current);
for (const name of ['effects.js', 'effects-runtime.js', 'effects-worker.js']) {
  const file = 'app/renderer/src/images/' + name;
  fs.writeFileSync(path.join(destination, file), fromGit(file));
}
fs.writeFileSync(path.join(destination, 'filter-reference.json'), JSON.stringify({
  revision: execFileSync('git', ['rev-parse', revision], { cwd: root, encoding: 'utf8' }).trim(),
  method: 'Original playback/filter functions and worker modules inside the current app shell, plus display-only instrumentation.',
  restoredFunctions: [...names],
}, null, 2) + '\n');
console.log(destination);
