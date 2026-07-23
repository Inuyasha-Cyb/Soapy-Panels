# Soapy Panels

Soapy Panels is an Electron editor for speech bubbles and dialogue overlays.

## Getting started

```sh
npm install
npm start
```

## Useful commands

- `npm start` launches the app.
- `npm run stickers:build` regenerates the bundled sticker manifest.
- `npm run licenses:build` regenerates third-party notices.
- `npm run pack:linux` builds the Linux Community edition.

## Source layout

- `app/main/` contains the Electron main process.
- `app/preload/` exposes the renderer API.
- `app/shared/` contains shared IPC and path constants.
- `app/renderer/` contains the renderer, runtime assets, and packaged legal PDFs.
- `docs/architecture/` contains the code and local-font guides.
- `docs/legal/` contains editable privacy-policy and terms-of-service sources.
- `packaging/` contains package configuration and static packaging inputs.
- `tools/` contains development and packaging scripts.

Generated output belongs under `out/` and `dist/` and is not committed.

## License and legal notices

Soapy Panels is licensed under Apache License 2.0. See `LICENSE`, `NOTICE`,
`ASSET_LICENSES.md`, and `TRADEMARKS.md`. See `SECURITY.md` for reporting a
security vulnerability and `CONTRIBUTING.md` for contribution guidance.
