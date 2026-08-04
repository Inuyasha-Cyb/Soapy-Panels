#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function rel(...parts) {
  return path.join(root, ...parts);
}

function fail(message) {
  console.error(`structure check failed: ${message}`);
  process.exitCode = 1;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function exists(...parts) {
  return fs.existsSync(rel(...parts));
}

function walk(dir, predicate = () => true) {
  const start = typeof dir === 'string' ? rel(dir) : dir;
  if (!fs.existsSync(start)) return [];
  const results = [];
  for (const entry of fs.readdirSync(start, { withFileTypes: true })) {
    const full = path.join(start, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full, predicate));
    } else if (entry.isFile() && predicate(full)) {
      results.push(full);
    }
  }
  return results;
}

const requiredPaths = [
  'AGENTS.md',
  'README.md',
  'app/renderer/AGENTS.md',
  'app/main/index.js',
  'app/main/trusted-ipc.js',
  'app/main/export-stream-sessions.js',
  'app/preload/index.js',
  'app/shared/ipc-channels.js',
  'app/shared/app-paths.js',
  'app/shared/app-editions.js',
  'app/shared/font-coverage.js',
  'app/renderer/index.html',
  'app/renderer/src/project/serialization.js',
  'app/renderer/src/project/validation.js',
  'app/renderer/src/history/stack.js',
  'app/renderer/src/text/wrapping.js',
  'app/renderer/src/boot.js',
  'app/renderer/src/ui/themes.js',
  'app/renderer/src/ui/dock-layouts.js',
  'app/renderer/src/ui/dock-controller.js',
  'app/renderer/src/ui/ads.js',
  'app/renderer/styles/ads.css',
  'app/renderer/src/ui/tool-buttons.js',
  'app/renderer/src/bubbles/hit-testing.js',
  'app/renderer/src/bubbles/duplication.js',
  'app/renderer/src/bubbles/saved-styles.js',
  'app/renderer/src/bubbles/outline.js',
  'app/renderer/src/tails/outline.js',
  'app/renderer/src/tails/curve.js',
  'app/renderer/src/media/mp4-export.js',
  'app/renderer/src/media/mp4-finalize.js',
  'app/renderer/vendor/mediabunny/mediabunny.cjs',
  'app/renderer/vendor/mediabunny/LICENSE',
  'app/renderer/src/fonts/local-fonts/bootstrap.js',
  'app/renderer/src/fonts/compatibility.js',
  'app/renderer/assets/fonts/local-font-coverage.manifest.js',
  'app/renderer/src/utils/uid.js',
  'app/renderer/src/images/effects.js',
  'app/renderer/src/images/effects-runtime.js',
  'app/renderer/src/images/effects-worker.js',
  'docs/architecture/app-contracts.md',
  'docs/runbooks/development.md',
  'docs/runbooks/linux-validation.md',
  'docs/debugging',
  'docs/decisions/0001-agent-ready-structure.md',
  'packaging/electron-builder.json',
  'packaging/electron-builder.base.json',
  'packaging/electron-builder.linux.json',
  'packaging/OPEN_SOURCE_NOTICES.txt',
  'packaging/store-installed-identity.json',
  'packaging/assets/icons/icon.ico',
  'packaging/assets/icons/icon.icns',
  'packaging/assets/icons/icon.png',
  'tools/checks/check-package.js',
  'tools/checks/check-asset-licenses.js',
  'tools/fonts/generate-font-coverage.js',
  'tools/development/start-with-entitlement.js',
  'tools/development/start-with-edition.js',
  'tools/development/measure-ipc-latency.js',
  'tools/legal/generate-legal-pdfs.py',
  'tools/packaging/build-store-launcher.ps1',
  'tools/packaging/appx-manifest-created.js',
  'tools/packaging/store-launcher/SoapyStoreLauncher.cs',
  'tools/packaging/test-store-activation-smoke.ps1',
  'tools/packaging/reset-store-registration.ps1',
  'tools/packaging/verify-store-ingestion.ps1',
  'test/unit',
  'test/integration',
  'test/e2e',
  'test/fixtures',
  'test/support',
  'LICENSE',
  'NOTICE',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'ASSET_LICENSES.md',
  'TRADEMARKS.md',
  'docs/legal/Soapy_Panels_Privacy_Policy.md',
  'docs/legal/Soapy_Panels_Terms_of_Service.md',
];

for (const requiredPath of requiredPaths) {
  if (!exists(requiredPath)) fail(`missing required path ${requiredPath}`);
}

const packageJson = readJson(rel('package.json'));

try {
  const { IPC_CHANNELS } = require('../../app/shared/ipc-channels');
  const { readPreloadIpcChannels } = require('./preload-ipc-contract');
  const preloadChannels = readPreloadIpcChannels();
  if (JSON.stringify(preloadChannels) !== JSON.stringify(IPC_CHANNELS)) {
    fail('sandboxed preload IPC channels must exactly match app/shared/ipc-channels.js');
  }
} catch (error) {
  fail(`unable to validate sandboxed preload IPC channels: ${error.message}`);
}

const windowSource = fs.readFileSync(rel('app', 'main', 'window.js'), 'utf8');
if (!/nodeIntegration\s*:\s*false/.test(windowSource)) {
  fail('BrowserWindow must keep nodeIntegration disabled');
}
if (!/contextIsolation\s*:\s*true/.test(windowSource)) {
  fail('BrowserWindow must keep contextIsolation enabled');
}
if (!/sandbox\s*:\s*true/.test(windowSource)) {
  fail('BrowserWindow must keep renderer sandboxing enabled');
}

const preloadSource = fs.readFileSync(rel('app', 'preload', 'index.js'), 'utf8');
const preloadRequires = Array.from(preloadSource.matchAll(/require\(["']([^"']+)["']\)/g))
  .map((match) => match[1]);
if (preloadRequires.some((request) => request !== 'electron')) {
  fail('sandboxed preload must not require local or unrestricted Node modules');
}

const ipcSource = fs.readFileSync(rel('app', 'main', 'ipc.js'), 'utf8');
if (/ipcMain\.(?:handle|on)\s*\(/.test(ipcSource)) {
  fail('incoming IPC handlers must be registered through trusted IPC wrappers');
}
if (packageJson.main !== 'app/main/index.js') {
  fail('package.json main must be app/main/index.js');
}
if (packageJson.version !== '1.2.0') {
  fail('package.json version must be 1.2.0 for the edition refactor');
}
if (packageJson.license !== 'Apache-2.0') {
  fail('package.json license must be Apache-2.0');
}
if (packageJson.soapyEdition !== 'windows-store') {
  fail('source package metadata must default to windows-store');
}
if (packageJson.build) {
  fail(
    'package.json must not contain Electron Builder config; use packaging/electron-builder.json',
  );
}
const packageScripts = packageJson.scripts || {};
for (const obsoleteDependency of [
  '@electron-forge/cli',
  '@electron-forge/maker-msix',
  'electron-icon-builder',
]) {
  if (Object.prototype.hasOwnProperty.call(packageJson.devDependencies || {}, obsoleteDependency)) {
    fail(`package.json must not restore obsolete packaging dependency ${obsoleteDependency}`);
  }
}
if (packageJson.config?.forge) {
  fail('package.json must not contain obsolete Electron Forge configuration');
}
for (const obsoleteConfig of ['forge.config.js', 'packaging/forge.config.js']) {
  if (exists(obsoleteConfig)) fail(`obsolete Electron Forge config must stay removed: ${obsoleteConfig}`);
}
if (packageJson.devDependencies?.['electron-builder'] !== '26.15.3') {
  fail('package.json must pin electron-builder to exactly 26.15.3');
}
if (packageScripts['audit:runtime'] !== 'npm audit --omit=dev --audit-level=low') {
  fail('package scripts must audit all production dependency advisories');
}
if (packageScripts['audit:build'] !== 'npm audit --audit-level=high') {
  fail('package scripts must block high and critical build dependency advisories');
}
if (packageScripts['audit:security'] !== 'npm run audit:runtime && npm run audit:build') {
  fail('package scripts must include the combined audit:security command');
}
if (packageScripts['ipc:measure'] !== 'node tools/development/measure-ipc-latency.js') {
  fail('package scripts must include the repeatable IPC latency measurement');
}
if (packageJson.dependencies?.mediabunny !== '1.44.2') {
  fail('package.json must pin mediabunny to exactly 1.44.2');
}
if (packageScripts['media:vendor'] !== 'node tools/media/vendor-mediabunny.js') {
  fail('package scripts must include the reproducible media:vendor sync command');
}
if (
  packageScripts['fonts:coverage:build'] !==
  'node tools/fonts/generate-font-coverage.js'
) {
  fail('package scripts must include the reproducible font coverage build command');
}
try {
  const coverageGenerator = require('../fonts/generate-font-coverage');
  const expectedCoverage = coverageGenerator.buildCoverageManifestText();
  const actualCoverage = fs.readFileSync(coverageGenerator.OUTPUT_FILE, 'utf8');
  if (actualCoverage !== expectedCoverage) {
    fail('font coverage manifest is stale; run npm run fonts:coverage:build');
  }
} catch (error) {
  fail(`unable to validate font coverage manifest: ${error.message}`);
}
try {
  const assetLicenseCheck = require('./check-asset-licenses');
  const result = assetLicenseCheck.validateFontLicenses();
  for (const failure of result.failures) {
    fail(`asset license validation: ${failure}`);
  }
} catch (error) {
  fail(`unable to validate asset licenses: ${error.message}`);
}
if (
  packageScripts['start:plus'] !==
  'node tools/development/start-with-entitlement.js monthly'
) {
  fail('package scripts must include the monthly Plus development launcher');
}
if (
  packageScripts['start:permanent'] !==
  'node tools/development/start-with-entitlement.js permanent'
) {
  fail('package scripts must include the permanent Plus development launcher');
}
if (
  packageScripts['start:community'] !==
  'node tools/development/start-with-edition.js linux-community'
) {
  fail('package scripts must include the Linux Community development launcher');
}
for (const scriptName of [
  'pack:windows',
  'dist:windows',
  'pack:linux',
  'dist:linux',
  'check:package:windows',
  'check:package:linux',
  'licenses:check',
  'legal:build',
]) {
  if (!packageScripts[scriptName]) fail(`package scripts must include ${scriptName}`);
}
if (packageScripts['store-' + 'g' + 'pu-policy:build']) {
  fail('package scripts must not include the removed Store runtime policy builder');
}
if (packageScripts['store:package:cpu-safe']) {
  fail('package scripts must not include the removed CPU-safe Store package shortcut');
}
if (
  packageScripts['store:ingestion-check'] !==
  'powershell -NoProfile -ExecutionPolicy Bypass -File tools/packaging/verify-store-ingestion.ps1'
) {
  fail('package scripts must include store:ingestion-check for Store ingestion verification');
}
if (
  packageScripts['store:registration-reset'] !==
  'powershell -NoProfile -ExecutionPolicy Bypass -File tools/packaging/reset-store-registration.ps1'
) {
  fail('package scripts must include store:registration-reset for current-user Store registration cleanup');
}
if (
  packageScripts['store:registration-check'] !==
  'powershell -NoProfile -ExecutionPolicy Bypass -File tools/packaging/reset-store-registration.ps1 -CheckOnly'
) {
  fail('package scripts must include store:registration-check for read-only Store registration inspection');
}

const builderBaseConfig = readJson(rel('packaging/electron-builder.base.json'));
const builderConfig = readJson(rel('packaging/electron-builder.json'));
const linuxBuilderConfig = readJson(rel('packaging/electron-builder.linux.json'));
const installedStoreIdentity = readJson(rel('packaging/store-installed-identity.json'));
const builderFiles = builderBaseConfig.files || [];
for (const expected of [
  'app/**/*',
  'packaging/assets/icons/*',
  'packaging/THIRD_PARTY_NOTICES.txt',
]) {
  if (!builderFiles.includes(expected)) {
    fail(`Electron Builder files must include ${expected}`);
  }
}

if (builderConfig.extends !== './packaging/electron-builder.base.json') {
  fail('Windows Electron Builder profile must extend the common profile');
}
if (builderConfig.extraMetadata?.soapyEdition !== 'windows-store') {
  fail('Windows Electron Builder metadata must identify windows-store');
}
if (linuxBuilderConfig.extends !== './packaging/electron-builder.base.json') {
  fail('Linux Electron Builder profile must extend the common profile');
}
if (linuxBuilderConfig.extraMetadata?.soapyEdition !== 'linux-community') {
  fail('Linux Electron Builder metadata must identify linux-community');
}
if (!Array.isArray(linuxBuilderConfig.linux?.target) ||
    linuxBuilderConfig.linux.target.length !== 1 ||
    linuxBuilderConfig.linux.target[0] !== 'AppImage') {
  fail('Linux v1 packaging target must be AppImage only');
}
for (const excluded of [
  '!app/main/monetization-store.js',
  '!app/main/windows-store-bridge.js',
  '!app/shared/monetization-status.js',
  '!app/renderer/src/ui/ads.js',
  '!app/renderer/styles/ads.css',
  '!app/renderer/assets/ads/**/*',
]) {
  if (!(linuxBuilderConfig.files || []).includes(excluded)) {
    fail(`Linux package profile must exclude ${excluded}`);
  }
}

const extraResources = builderConfig.extraResources || [];
if (installedStoreIdentity.packageFamilyName !== 'SoapyPanels.SoapyPanels_xbh7heh5c19c4') {
  fail('Store installed identity packageFamilyName must match the published Store PFN');
}
if (installedStoreIdentity.signatureKind !== 'Store') {
  fail('Store installed identity signatureKind must be Store');
}
const removedPolicyName = ['store', 'g' + 'pu', 'policy.json'].join('-');
if (
  extraResources.some(
    (entry) =>
      entry &&
      [entry.from, entry.to]
        .filter(Boolean)
        .some((value) => String(value).includes(removedPolicyName)),
  )
) {
  fail('Electron Builder extraResources must not include the removed runtime policy file');
}
if (
  !extraResources.some(
    (entry) =>
      entry &&
      entry.from === 'out/store-launcher' &&
      entry.to === 'store-launcher',
  )
) {
  fail('Electron Builder extraResources must include the Store launcher');
}
if (builderConfig.appxManifestCreated !== 'tools/packaging/appx-manifest-created.js') {
  fail('Electron Builder must run the AppX manifest-created hook for Store launcher activation');
}

const gitignore = fs.readFileSync(rel('.gitignore'), 'utf8');
for (const ignored of ['node_modules/', 'dist/', 'out/', '.vscode/']) {
  if (!gitignore.includes(ignored)) fail(`.gitignore must include ${ignored}`);
}

const styleFiles = walk('app/renderer/styles');
for (const file of styleFiles) {
  if (path.extname(file).toLowerCase() !== '.css') {
    fail(`styles folder must be CSS-only: ${path.relative(root, file)}`);
  }
}

const runtimeFiles = walk('app', (file) =>
  ['.js', '.html', '.css', '.json'].includes(path.extname(file).toLowerCase()),
);
const forbiddenRuntimePatterns = [
  /require\(["'][^"']*(?:test|tools|docs|dist|out)[/\\]/,
  /from\s+["'][^"']*(?:test|tools|docs|dist|out)[/\\]/,
  /<script\s+[^>]*src=["'][^"']*(?:test|tools|docs|dist|out)[/\\]/i,
];
for (const file of runtimeFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const pattern of forbiddenRuntimePatterns) {
    if (pattern.test(text)) {
      fail(
        `runtime file references forbidden source folder: ${path.relative(root, file)}`,
      );
      break;
    }
  }
}

const indexHtml = fs.readFileSync(rel('app/renderer/index.html'), 'utf8');
const inlineScripts = indexHtml.match(/<script(?![^>]*\bsrc=)[^>]*>/gi) || [];
if (inlineScripts.length > 0)
  fail('renderer index.html must not contain inline script blocks');
const inlineEventAttributes = indexHtml.match(/\son[a-z]+\s*=/gi) || [];
if (inlineEventAttributes.length > 0)
  fail('renderer index.html must not contain inline event handler attributes');
const inlineStyles = indexHtml.match(/<style\b[^>]*>/gi) || [];
if (inlineStyles.length > 0)
  fail('renderer index.html must not contain inline style blocks');
if (indexHtml.includes('scripts/')) {
  fail('renderer index.html must not reference the old scripts/ folder');
}
if (!indexHtml.includes('src="src/boot.js"')) {
  fail('renderer index.html must load src/boot.js');
}
if (indexHtml.includes('id="adsOverlay"') || indexHtml.includes('src="src/ui/ads.js"')) {
  fail('shared renderer shell must not statically contain or load advertising UI');
}

const cspMetaTag = indexHtml.match(
  /<meta\s+[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i,
);
const cspContent = cspMetaTag &&
  (cspMetaTag[0].match(/\bcontent="([^"]*)"/i) ||
    cspMetaTag[0].match(/\bcontent='([^']*)'/i));
if (!cspContent) {
  fail('renderer index.html must declare a Content-Security-Policy');
} else if (!/(?:^|;)\s*script-src\s+'self'\s*(?:;|$)/.test(cspContent[1])) {
  fail("renderer script-src must be exactly 'self' without unsafe-inline");
}

const textEditorMarkupIndex = indexHtml.indexOf('id="textEditorOverlay"');
const bootScriptIndex = indexHtml.indexOf('src="src/boot.js"');
if (textEditorMarkupIndex === -1 || textEditorMarkupIndex > bootScriptIndex) {
  fail('text editor markup must appear before src/boot.js');
}

const rendererScriptSources = Array.from(
  indexHtml.matchAll(/<script\s+[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi),
).map((match) => match[1].replace(/\\/g, '/'));
for (const scriptSource of rendererScriptSources) {
  if (!exists('app/renderer', scriptSource)) {
    fail(`renderer script source does not exist: ${scriptSource}`);
  }
}

const expectedRendererScriptOrder = [
  'assets/fonts/local-fonts.manifest.js',
  'src/fonts/coverage-loader.js',
  'assets/stickers/stickers.manifest.js',
  'src/fonts/compatibility.js',
  'src/fonts/local-fonts/bootstrap.js',
  'src/utils/uid.js',
  'src/images/effects.js',
  'src/images/effects-runtime.js',
  'src/project/serialization.js',
  'src/project/validation.js',
  'src/history/stack.js',
  'src/text/wrapping.js',
  'src/bubbles/hit-testing.js',
  'src/bubbles/duplication.js',
  'src/bubbles/saved-styles.js',
  'src/bubbles/outline.js',
  'src/tails/outline.js',
  'src/tails/curve.js',
  'src/media/mediabunny-loader.js',
  'src/media/gif.js',
  'src/media/video.js',
  'src/media/mp4-export.js',
  'src/media/mp4-finalize.js',
  'src/i18n/locales/en.js',
  'src/i18n/locales/es.js',
  'src/i18n/locales/zh-hans.js',
  'src/i18n/locales/ja.js',
  'src/i18n/locales/id.js',
  'src/i18n/locales/de.js',
  'src/i18n/locales/fr.js',
  'src/i18n/locales/ru.js',
  'src/i18n/locales/uk.js',
  'src/i18n/index.js',
  'src/ui/themes.js',
  'src/ui/dock-layouts.js',
  'src/ui/dock-controller.js',
  'src/ui/startup.js',
  'src/boot.js',
  'src/ui/tool-buttons.js',
];
let previousScriptIndex = -1;
for (const expectedScript of expectedRendererScriptOrder) {
  const currentIndex = rendererScriptSources.indexOf(expectedScript);
  if (currentIndex === -1) {
    fail(`renderer index.html must load ${expectedScript}`);
    continue;
  }
  if (currentIndex < previousScriptIndex) {
    fail(`renderer script order is wrong around ${expectedScript}`);
  }
  previousScriptIndex = currentIndex;
}

try {
  const validation = require('../../app/renderer/src/project/validation');
  const limits = validation.PROJECT_RESOURCE_LIMITS;
  if (!limits || limits.maxFileBytes !== 256 * 1024 * 1024) {
    fail('project validation must retain the 256 MiB file limit');
  }
  if (limits.maxCanvasDimension !== 16384) {
    fail('project validation must retain the 16,384 pixel canvas dimension limit');
  }
} catch (error) {
  fail(`unable to validate project resource limits: ${error.message}`);
}

if (!indexHtml.includes('src="src/project/validation.js"')) {
  fail('renderer must load project validation before boot');
}
const bootSource = fs.readFileSync(rel('app/renderer/src/boot.js'), 'utf8');
if (!bootSource.includes('projectValidation.readAndValidateProjectFile')) {
  fail('project open must pass through resource validation before restoration');
}

try {
  const streamLimits = require('../../app/main/export-stream-sessions');
  if (streamLimits.MAX_EXPORT_STREAM_BYTES !== 16 * 1024 * 1024 * 1024) {
    fail('export streams must retain the 16 GiB logical size limit');
  }
  if (streamLimits.MAX_EXPORT_CUMULATIVE_WRITE_BYTES !== 32 * 1024 * 1024 * 1024) {
    fail('export streams must retain the 32 GiB cumulative write limit');
  }
  if (streamLimits.MIN_EXPORT_FREE_BYTES !== 512 * 1024 * 1024) {
    fail('export streams must retain the 512 MiB free-space reserve');
  }
} catch (error) {
  fail(`unable to validate export stream resource limits: ${error.message}`);
}

const stickerManifest = rel(
  'app/renderer/assets/stickers/stickers.manifest.js',
);
if (fs.existsSync(stickerManifest)) {
  const manifestText = fs.readFileSync(stickerManifest, 'utf8');
  if (/src:\s*['"]assets\/stickers\/(?!builtin\/)/.test(manifestText)) {
    fail('sticker manifest entries must point at assets/stickers/builtin/');
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log('structure check passed');
