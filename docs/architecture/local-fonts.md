# Local Font Workspace

Soapy Panels has two local-font paths:

- Packaged/developer fonts live under `app/renderer/assets/fonts/` and are described by `app/renderer/assets/fonts/local-fonts.manifest.js`.
- Runtime user fonts live under Electron's user data `fonts` folder and are read by `app/main/user-assets.js` through the async `GET_USER_FONTS_ASYNC` IPC path. The older sync `GET_USER_FONTS` path remains as a fallback. Supported Electron user font extensions are `.ttf`, `.otf`, `.woff`, and `.woff2`.

The renderer bootstrap in `app/renderer/src/fonts/local-fonts/bootstrap.js` populates manifest fonts immediately, then merges Electron user fonts when `window.electronApi.getUserFontsAsync()` resolves. In browser-style or Node-backed previews where the Electron API is unavailable, it falls back to scanning the configured local font directory. The same bootstrap owns the virtualized custom font picker UI, including search, favorites stored under `sp.fontFavorites` in `localStorage`, and temporary filtering against the selected bubble's Unicode letters and combining marks.

Bundled glyph coverage is stored in the generated `app/renderer/assets/fonts/local-font-coverage.manifest.js`. The renderer loads this generated file on demand when font compatibility filtering is first needed, through `app/renderer/src/fonts/coverage-loader.js`; it is no longer parsed on the critical startup path. Run `npm run fonts:coverage:build` whenever bundled font entries or files change. `npm run check:structure` regenerates the expected content in memory and rejects stale coverage. Electron user fonts and Node fallback fonts receive the same compressed `coverageRanges` metadata when `fontkit` parses them; unknown platform fonts and parse failures remain visible rather than being hidden speculatively.

`app/main/user-assets.js` also has an `importUserFontFolder()` helper that copies supported fonts into the persistent user data folder and is covered by `test/integration/user-font-import.test.js`. That helper is main-process/test support only unless a future preload IPC method exposes it deliberately.

## Overriding the folder

Developers who use the Node fallback loader can override its default directory:

- Set the `LOCAL_FONT_DIR` environment variable (or `APP_LOCAL_FONT_DIR`) before
  launching the app.
- Or edit `app/config/local-fonts.json` and replace the `directory` value with an
  absolute path, a path relative to the repository root, or one that begins with
  `~/` to target a location under your home directory.

The fallback loader normalizes the final directory, creates it if necessary, and caches the resolved path for the rest of the session. This override does not change the Electron user data `fonts` folder used by packaged runtime IPC.

## Startup behavior

On launch the renderer waits until the first canvas frame is interactive, then injects manifest fonts with `@font-face` and adds them to the font picker during idle time. Async user-font results are merged by the same deferred hydration. Opening the font picker requests glyph coverage before applying compatibility filtering. Each user font file is inspected for weight, style, and character coverage in the main process so multiple faces of the same family appear as distinct options when they are merged into the picker.

In Electron, `app/main/user-assets.js` watches the user data `fonts` folder and sends `USER_FONTS_CHANGED`; the renderer reapplies fonts when that event arrives. In the Node fallback path, restart or reload so the loader scans the configured directory again.

## Declaring fonts for browser previews

Browsers cannot enumerate folders on disk, so the app also reads `app/renderer/assets/fonts/local-fonts.manifest.js`. This JavaScript file defines an array of font variants that should be available even when Node/Electron APIs are unavailable:

```js
window.localFontManifest = [
  {
    family: 'My Local Sans',
    label: 'My Local Sans Regular',
    path: 'assets/fonts/MyLocalSans-Regular.woff2',
    format: 'woff2',
    weight: '400',
    style: 'normal',
    fallback: 'sans-serif',
  },
];
```

Add one object per weight/style combination. The `path` should be relative to
`app/renderer/index.html`. When the Electron API or Node fallback loader is
available, manifest entries are merged with discovered fonts; when only the
browser is available, the manifest is the sole source of local fonts.
