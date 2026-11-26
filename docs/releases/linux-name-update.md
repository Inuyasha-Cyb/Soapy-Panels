# Soapy Panels for Linux naming update

Prepared November 25, 2026; version remains `1.2.1-rc.1`.

The Linux privacy and license documents and download instructions now use
“Soapy Panels for Linux.” The app continues to display “Soapy Panels.”
Terms and License has an effective date and no draft label; the Privacy Notice
retains its draft status. Windows documents and internal edition IDs are unchanged.

AppImage: `dist/linux-name-update/Soapy.Panels-1.2.1-rc.1-x64.AppImage`

SHA-256: `109d39e01d5b4cb7553788e6a6f4d73b451f827f889c3d41fd5dee2e2c61addc`

The matching `.sha256` file is beside the executable. Earlier builds are preserved.
Close the previous app and launch this file to see the updated documents in Help.

Validated PDF titles and draft status through text extraction; verified Windows
document checksums remain unchanged. Package-content, artifact/checksum, and
legal-document packaging tests passed. The actual AppImage passed document
viewing, scrolling, close/reopen, external-reader path/error handling, sandbox,
and no-external-web-request checks. Its Terms and License screenshot was reviewed.
Diagnostics: `out/linux-validation/linux-legal-documents/name-update/` and the
`name-*.log` files in its parent directory.

No publication or CI run was performed. Earlier cross-distribution limitations
remain unchanged; this validation concerns the naming and document update.
