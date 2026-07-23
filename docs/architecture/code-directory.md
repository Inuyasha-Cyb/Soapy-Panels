# Soapy Panels Code Directory

Quick feature map for agents. Prefer function, id, and module searches over line anchors; this app still has a large renderer boot file and line numbers drift. Unless a row gives a full path, `index.html`, `src/`, `styles/`, `assets/`, and `vendor/` are relative to `app/renderer/`.

## Source Layers

| Layer | Primary files | Use for |
| --- | --- | --- |
| Electron shell | `app/main/index.js`, `app/main/window.js`, `app/main/protocol.js`, `app/main/ipc.js`, `app/main/menus.js`, `app/main/user-assets.js`, `app/main/export-save-targets.js`, `app/main/export-stream-sessions.js`, `app/main/monetization-store.js`, `app/main/windows-store-bridge.js`, `app/main/config.js`, `app/main/logging.js` | App startup, `app://` path enforcement, window security/chrome, native menus, Help PDFs, user assets, native export targets/streams, Store bridge monetization, runtime flags, IPC handlers |
| Safe renderer API | `app/preload/index.js`, `app/shared/ipc-channels.js`, `app/shared/app-paths.js`, `app/shared/app-editions.js`, `app/shared/monetization-products.js`, `app/shared/monetization-status.js` | Renderer-accessible Electron APIs, channel/path constants, edition capabilities, opaque export target/session APIs, and Windows monetization normalization |
| Renderer markup | `app/renderer/index.html` | Stable DOM ids/classes, menus, panels, modals, script/style loading |
| Renderer CSS | `app/renderer/styles/base.css`, `app/renderer/styles/layout.css`, `app/renderer/styles/main.css` | Themes, layout, controls, canvas overlays, responsive styling |
| Renderer behavior | `app/renderer/src/boot.js`, `app/renderer/src/ui/tool-buttons.js` | Legacy editor behavior while extraction continues, plus toolbox/footer icon state |
| Extracted helpers | `app/renderer/src/project/`, `history/`, `text/`, `bubbles/`, `tails/`, `fonts/`, `images/`, `media/`, `i18n/`, `ui/`, `utils/` | Tested helpers and classic browser modules |

## Feature Navigation

### Platform and Repository

| Feature area | Start here | Then check |
| --- | --- | --- |
| App contracts and packaged paths | `docs/architecture/app-contracts.md` | `package.json`, all `packaging/electron-builder*.json` profiles, `tools/checks/check-structure.js`, `tools/checks/check-package.js` |
| Development workflow | `docs/runbooks/development.md` | `package.json` scripts, focused unit/integration/e2e tests, and `npm run check` |
| Packaging and Microsoft Store workflow | `docs/runbooks/packaging.md` | `packaging/electron-builder.json`, Store build/preflight/activation tools, `npm run pack`, and `npm run check:package` |
| Main process startup, window chrome, and native menus | `app/main/index.js`, `app/main/window.js`, `app/main/menus.js` | `app/main/config.js`, `app/main/logging.js`, `app/main/protocol.js`, `app/shared/app-paths.js`, `app/shared/ipc-channels.js`, `test/e2e/electron-smoke.test.js` |
| Renderer load order | `docs/architecture/renderer-module-map.md` | `<link>` and `<script>` tags in `app/renderer/index.html`; `npm run check:structure` |
| Security and trust boundaries | `app/main/window.js`, `app/main/trusted-ipc.js`, `app/preload/index.js`, `app/main/ipc.js`, `app/main/protocol.js` | Renderer sandboxing, context isolation, disabled Node integration, trusted-main-frame IPC validation, external URL allowlists, Help-path containment, opaque export targets, and the same-origin-script CSP in `index.html`; inline scripts and event attributes are forbidden by `check:structure` |

### Editor Shell and Rendering

| Feature area | Start here | Then check |
| --- | --- | --- |
| Themes and global styling | `styles/main.css` | `applyTheme`, `getSystemTheme`, `refreshRulerColors` in `src/boot.js`; theme menu ids in `index.html` |
| Layout, panels, menus, docker tabs | `index.html`, `styles/layout.css`, `styles/main.css` | `updatePanels`, menu wiring, mobile drawer, splitter logic in `src/boot.js` |
| Canvas, zoom, rulers, grid | `#stage`, `#overlay`, `#rulerTop`, `#rulerLeft`, `#canvasGrid`, `#canvasChecker` in `index.html` | `renderStage`, `draw`, `setZoom`, `layoutCanvasForZoom`, `drawRulers`, `fitToViewport`; `test/e2e/canvas-visibility-toggles.test.js` |
| Canvas footer, color, opacity, size, lock, and toolbox controls | Footer tabs and toolbox buttons in `index.html` | Footer visibility, active footer tab, color/opacity/size controls, `setLockBgImages`, toolbox collapse logic in `src/boot.js`; `test/e2e/canvas-footer-color-opacity.test.js` |
| Render invalidation and performance | `docs/runbooks/performance.md` | `markBubbleDirty`, `markBackgroundDirty`, `requestBubbleDamageDraw`, `requestBubbleComponentDamageDraw`, `drawOverlayOnly`, tile rendering, render-scale helpers, and `test/e2e/cold-interaction-performance.test.js` |
| Mask, paint, and pan tools | `#toolsPanel`, `#maskBrushSection`, toolbox/footer buttons with `data-tool` in `index.html` | `activeTool` values including `paintEraser`, plus `opacityBrush` and `paintBrush` state, mask serialization, and pointer handlers in `src/boot.js`; `test/e2e/docker-tool-mode-defaults.test.js`, `test/unit/project-serialization.test.js` |

### Content, Media, and Persistence

| Feature area | Start here | Then check |
| --- | --- | --- |
| Background images, stickers, and image masks | `#bgImageSectionContent`, `#stickerSectionContent`, `assets/stickers/`, `assets/stickers/stickers.manifest.js` | `addBackgroundImage`, `restoreProject`, `saveProject`, `setLockBgImages`, `hitTestBackgroundImage`, `ensureEraseMask`, `ensurePaintMask`, user sticker IPC in `app/main/user-assets.js`, `tools/stickers/generate-sticker-manifest.js`; `test/integration/sticker-manifest.test.js`, `test/integration/user-stickers.test.js`, `test/unit/project-serialization.test.js` |
| Image, GIF, and MP4 color effects | `#imageEffectsPanel`, `src/images/effects.js`, `src/images/effects-runtime.js`, `src/images/effects-worker.js` | Docked review-mode UI, hold-to-compare, bounded animated-frame previews, draft/resource lifetime, optional `bg.images[].colorEffect` persistence, and per-frame export preparation in `src/boot.js`. GIF effects persist in projects; MP4 effects participate in runtime history and exports because MP4 layers remain runtime-only |
| GIF and MP4 canvas media | `src/media/gif.js`, `src/media/video.js`, `src/media/gif-decode-worker.js`, `src/media/gif-export-worker.js` | `initializeGifEntry`, `installVideoRuntime`, playback/redraw scheduling, and media state in `src/boot.js`; GIF entries are project-compatible, while MP4 entries are runtime-only and omitted from saved project snapshots; `test/unit/gif-media.test.js`, `test/unit/video-media.test.js`, `test/e2e/gif-media.test.js`, `test/e2e/video-media.test.js` |
| PNG, JPEG, GIF, and MP4 export | `#mi-exp-*`, `#mp4ExportSettingsOverlay`, `#exportProgressOverlay`, `src/media/gif.js`, `src/media/mp4-export.js`, `src/media/mp4-finalize.js` | Export orchestration in `src/boot.js`, orientation-aware MP4 quality presets and active-Plus gating, opaque targets in `app/main/export-save-targets.js`, streamed MP4 sessions in `app/main/export-stream-sessions.js`; `test/unit/export-flow.test.js`, `test/unit/export-save-targets.test.js`, `test/unit/export-stream-sessions.test.js`, `test/unit/mp4-export.test.js`, `test/unit/mp4-finalize.test.js`. Mediabunny is pinned in `package.json`; refresh `vendor/mediabunny/mediabunny.cjs` and its `LICENSE` with `npm run media:vendor`, then rebuild notices with `npm run licenses:build` |
| Project file lifecycle and history | `docs/architecture/project-file-format.md`, `src/project/serialization.js`, `src/history/stack.js` | `newProject`, `openProject`, `saveProject`, `restoreProject`, `lastSavedSnapshot`, `hasUnsavedProjectChanges`, `getSessionOnlyVideoCount`, `hasProjectDiscardRisk`, `handleBeforeUnload`, snapshot/history reset helpers, and serialization/history tests. Persistable dirty state excludes MP4 data, while the separate discard-risk path warns before session-only MP4 layers can be lost |
| Bubble creation, saved styles, style codes, and duplication | Add Bubble menu values, saved-style controls, and `#styleCodeOverlay` in `index.html` | Bubble factories in `src/boot.js`, `src/bubbles/saved-styles.js`, `src/bubbles/duplication.js`, style-code handlers; `test/unit/saved-styles.test.js`, `test/unit/bubble-duplication.test.js`, `test/e2e/saved-style-recreation.test.js` |
| Selection, overlap hints, and hit testing | `#overlay`, `#overlapSelectionHint`, `src/bubbles/hit-testing.js` | Bubble/background hit tests, overlap-selection hint behavior, selection performance hooks; `test/unit/bubble-hit-testing.test.js`, `test/e2e/bubble-hit-testing.test.js` |
| Tail geometry, cloud dots, connectors, roundness, wavy tails, and burst handles | Tail/shape controls in `index.html` | `drawHandles`, tail hit-tests, tail normalization/anchor helpers, `src/tails/outline.js`, `src/tails/curve.js`; `test/unit/tail-roundness-ui.test.js`, `test/unit/tail-free-anchor-ui.test.js`, `test/unit/wavy-tail-ellipse.test.js`, `test/unit/wavy-tail-strength.test.js`, `test/unit/wavy2-bubble.test.js`, `test/e2e/connector-tail-component-bounds.test.js`, `test/e2e/tail-curvature-undo.test.js`; investigation records in `docs/debugging/multiple-tail-curvature-investigation.md`, `docs/debugging/connector-tail-investigation.md`, and `docs/debugging/extra-tail-joint-outline-investigation.md` |
| Text layout, wrapping, and editor modal | `src/text/wrapping.js`, text controls, and `#textEditorOverlay` in `index.html` | The modal markup precedes `src/boot.js`; its scoped controller, localized errors, focus trap/restoration, preview, and history integration live in `src/boot.js` and focused text-editor/history tests |
| Local fonts and font picker | `docs/architecture/local-fonts.md`, `src/fonts/local-fonts/bootstrap.js` | `app/main/user-assets.js`, `app/preload/index.js`, `assets/fonts/local-fonts.manifest.js`, `test/integration/user-font-import.test.js`, local font integration tests, and `test/e2e/font-picker-selection-sync.test.js` |
| Gradients, shadows, outlines, highlights | Gradient/highlight modals in `index.html` and CSS in `styles/main.css` | Gradient target maps and preview/render helpers in `src/boot.js`, `src/bubbles/outline.js`; `test/unit/bubble-outline.test.js`, `test/unit/bubble-outline-ui.test.js`, `test/e2e/bubble-outline-controls.test.js` |

### Services, Commands, and Test Surfaces

| Feature area | Start here | Then check |
| --- | --- | --- |
| Localization and language preference | `src/i18n/index.js`, `src/i18n/locales/`, `data-i18n*` attributes, `#mi-lang` | All locale catalogs, required first-run selection, `sp.locale`, locale-change refresh, `test/unit/i18n.test.js`, and `test/e2e/language-preference.test.js` |
| Monetization, Store purchases, and ad removal | `app/shared/monetization-products.js`, `app/shared/monetization-status.js`, `app/main/monetization-store.js`, `app/main/windows-store-bridge.js` | Monetization IPC, Help overlay UI, `tools/packaging/build-store-bridge.js`, `test/unit/monetization-status.test.js`, `test/unit/renderer-monetization-ui.test.js`, `test/unit/windows-store-bridge.test.js`; use the packaging runbook for Store operations |
| Optional Windows ads | `app/renderer/src/ui/ads.js`, `app/renderer/styles/ads.css`, `assets/ads/` | Capability-gated dynamic loading, locale-specific images, timers, export hooks, and Linux package exclusion |
| Keyboard and edit commands | Edit menu ids in `index.html`, `app/main/menus.js`, `handleKeydown`, and `handleShortcut` in `src/boot.js` | Project undo/redo, native menu history sends, copy/paste, delete, duplication, `test/unit/renderer-history-reset.test.js`, and bubble duplication tests |
| IPC, native menu history, and Help PDFs | `docs/architecture/ipc-map.md` | Shared channel/path constants, main handlers/senders, preload exposure; `test/integration/app-paths.test.js`, `test/e2e/electron-smoke.test.js`, `test/unit/renderer-history-reset.test.js` |
| Renderer debug and test hooks | `window.SoapyPanels.debug` setup in `src/boot.js` | Undo capture/select, connector-tail and selection performance, `debug.effects`, `debug.gif`, `debug.video`, and `debug.export`. These are test-facing compatibility surfaces, not supported user APIs |

## Cautions

- `index.html` owns DOM structure; `styles/` owns CSS; `src/boot.js` owns most behavior. Do not put new inline script or style blocks in `index.html`.
- Persistable local/project images and GIFs intentionally use `blob:` URLs for editing performance, while saved `.soapy` files remain self-contained with `data:` URLs. MP4 canvas entries are runtime-only, display a session-only badge, are omitted from saved project snapshots, and keep new/open/close actions behind discard-risk confirmation while present.
- Keep `.soapy` project fields backward compatible unless a migration is planned.
- Renderer `localStorage` keys such as `sp.locale`, theme, zoom, panel collapse, footer/toolbox visibility, font favorites, and performance mode are local UI preferences, not project schema unless explicitly serialized in `project-file-format.md`.
- `app/renderer/styles/` must stay CSS-only, and runtime code under `app/` must not import from `docs/`, `tools/`, `test/`, `out/`, or `dist/`.
- Renderer modules are classic browser scripts. Respect the script order in `renderer-module-map.md` and use `window.SoapyPanels` for shared extracted helpers.
- Background lock behavior is nuanced: non-sticker backgrounds are locked by default, stickers remain interactable while locked, and unlocked mode targets non-sticker backgrounds.
- Store bridge code is generated into `out/store-bridge/` for packaging but runs as `resources/store-bridge/SoapyStoreBridge.exe` in packaged builds.
- Do not broaden `window.SoapyPanels.debug` into a production API; keep hooks narrowly test-facing and update focused tests when refactoring them.

## Update Triggers

| Change | Keep in sync |
| --- | --- |
| Renderer script or load-order change | `index.html`, `docs/architecture/renderer-module-map.md`, and `npm run check:structure` |
| IPC channel or preload method | `app/shared/ipc-channels.js`, main/preload wiring, `docs/architecture/ipc-map.md`, and a focused test |
| Saved project field or normalization rule | `docs/architecture/project-file-format.md`, serialization helpers, backward-compatibility fixtures/tests, and migration notes when needed |
| Locale or translation key | Every locale catalog, explicit `data-i18n*` targets, i18n unit tests, and language-preference e2e coverage |
| Packaged path or runtime asset | `docs/architecture/app-contracts.md`, `docs/runbooks/packaging.md`, structure validation, then `npm run pack` and `npm run check:package` |
| Vendored media dependency | Pinned dependency/lockfile, `npm run media:vendor`, vendored bundle/license, `npm run licenses:build`, and relevant media tests |

## Validation

- Run the smallest focused test for the changed behavior first.
- Use `npm run check` as the normal structure plus unit/integration baseline.
- Run the Electron suite through `npm run test:e2e`; the script intentionally serializes e2e files.
- Run packaging or Store checks only when their paths, assets, identity, activation, or bridge behavior changes; follow `docs/runbooks/packaging.md` for the full sequence.
