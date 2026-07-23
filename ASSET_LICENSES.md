# Bundled asset licenses

This inventory covers non-code assets distributed with Soapy Panels. It must
be updated whenever bundled assets are added, removed, or replaced.

## Project-created assets

Unless a file or directory is identified below as third-party material, the UI
artwork, application icons, advertising artwork, documentation artwork,
translations, and bundled sticker artwork in `app/renderer/assets/` and
`packaging/assets/` were created or commissioned for this project and are
distributed under Apache License 2.0 as part of the Work. The Soapy Panels
names and logos remain subject to `TRADEMARKS.md`.

The advertising assets are included only in the Windows Store edition. They
are deliberately excluded from Linux Community packages.

## Bundled fonts

Bundled font files are third-party works. Each font directory must contain an
adjacent license or information file that identifies a redistribution and
modification license. The package includes fonts under one or more of these
terms:

- SIL Open Font License 1.1
- Apache License 2.0
- Public domain or CC0 dedication
- Creative Commons Attribution licenses compatible with redistribution
- Other permissive licenses whose notice is retained beside the font

`tools/checks/check-asset-licenses.js` validates that every bundled font
directory has recognized license evidence and rejects known restrictive or
unknown-license assets. The adjacent license files are the authoritative terms
for individual fonts.

The following assets are intentionally not distributed because their previous
license evidence was insufficient or restricted modification/commercial
redistribution:

- 1942 Report font
- ProFont Windows font
- Bearpaw font
- Bloody font
- Silkscreen font
- VTC Letterer Pro font
- Wagnasty font

## Third-party code assets

Vendored media libraries and their licenses are listed in
`packaging/THIRD_PARTY_NOTICES.txt`. The reproducible notice generator fails if
a production dependency has unknown licensing or no readable license text.

## User-supplied content

Fonts, images, stickers, projects, and other content imported by users are not
part of this repository and are not licensed by the project.
