# Security policy

## Reporting a vulnerability

Please report suspected security vulnerabilities privately to
Soapy.Panels@outlook.com. Include the affected version and edition, operating
system, reproduction steps, impact, and any suggested mitigation. Do not put
exploitable details in a public issue before a fix is available.

You should receive an acknowledgement within seven days. The project will try
to confirm the issue, coordinate a fix, and agree on disclosure timing. This is
a best-effort process and not a promise of a specific remediation date.

## Supported versions

Security fixes are normally made on the current development line and the most
recent published release. Older versions may not receive fixes.

## Scope

Reports about Electron boundaries, IPC validation, project-file parsing,
export handling, external navigation, Microsoft Store integration, and Linux
packaging are in scope. Third-party service outages and vulnerabilities that
do not affect Soapy Panels are outside this project's control.

## Dependency audits

Run `npm ci` followed by `npm run audit:security` before preparing a release.
This command blocks all production dependency advisories and high or critical
advisories across the full dependency tree. Electron is a development dependency
in npm but ships as the application's runtime, so `npm audit --omit=dev` alone
does not cover the bundled runtime.

The Linux release workflow and Windows `store:package` entry point run the
combined audit before building release artifacts. An audit failure stops the
release path; the Windows check runs before deleting previous build output.
Use `npm audit --audit-level=low` when verifying that a dependency security
update resolves every reported advisory, including moderate and low findings.

## Resource limits

Project files are validated before restoration and are limited to 256 MiB,
16,384 pixels per canvas axis, and bounded object collections and nesting.
Streamed exports are limited to 16 GiB of logical output and 32 GiB of
cumulative writes while retaining at least 512 MiB of free disk space when the
operating system exposes filesystem statistics. These limits are security
contracts and must not be raised without compatibility and abuse-case review.

### GIF decoding

GIF bytes are inspected before a pixel buffer is allocated or the source reaches
an HTML image element. The renderer and worker share the same hard limits:

| Resource | Maximum |
| --- | ---: |
| Compressed input | 32 MiB |
| Logical-screen width or height | 4,096 pixels |
| Logical-screen pixel count | 8,388,608 |
| Source frame descriptors | 10,000 |
| Retained decoded frames per GIF | 256 MiB |
| Managed GIF buffers per editor window | 768 MiB |
| Active decoding jobs, through canvas creation | 1 |
| Active worker time | 60 seconds |
| Static sticker thumbnail cache | 16 MiB; 128 × 128 pixels per thumbnail |

The existing 300-frame and 30-second playback cutoffs remain. Caller options can
lower these cutoffs but cannot raise them. Exceeding a memory limit rejects the
GIF instead of reducing its quality or silently truncating it further. Every
frame rectangle must fit the logical screen, including frames beyond the playback
cutoff; compressed sub-block and palette boundaries are checked before GifReader
constructs its frame metadata.

The FIFO decoder reserves two compressed-buffer copies, twice the retained RGBA
frame bytes, three full-screen RGBA scratch buffers, and one indexed-pixel buffer.
Resident frame canvases and thumbnail canvases share the same budget. Successful
jobs retain only their canvas charge. Failure, cancellation, timeout, deletion,
and project replacement release reservations. MP4 snapshots hold explicit frame
references until export completion or failure.

This accounts for managed backing buffers, not total process RSS. Source strings
in projects, bounded parser metadata, garbage-collection delays, GPU copies, and
other application resources are outside this byte budget. The separate project
size and collection limits continue to apply.

New unsafe imports are rejected with an explanation. Project and recovery loads
preserve blocked GIF sources and layer geometry using small labeled placeholders.
Saving preserves those original sources; image, GIF, and MP4 exports are blocked
until loading finishes and blocked layers are removed or successfully retried.
User-sticker GIFs are signature-detected even when renamed, read with a file-size
cap, and never fall back to native image decoding after inspection fails.

## Private streamed exports

Streamed exports stage only in `app.getPath("userData")/export-staging`.
Each main process creates a separate `<PID>-<random UUID>` directory and a small
`owner.json` record. There is no system-temp fallback. On POSIX, directories
are owner-only (`0700`), and records and seekable staging files are created
exclusively with `0600`, independently of the user's umask. Ownership, file type,
hard-link count, and directory/file identity are checked before artwork writes.
On Windows, a fixed main-process PowerShell/.NET adapter establishes and verifies
protected ACLs for the current user, SYSTEM, and Administrators. Paths travel as
JSON on stdin to an absolute Windows PowerShell executable, never as code. An
unavailable permission adapter or unsafe profile causes streamed exports to fail
with an explanation; the editor remains usable.

New streamed destination files are also private. Existing destinations are
opened and copied through without replacing their inode or security descriptor,
preserving existing permissions. Automatic filename collisions use exclusive
creation and retry with another name. Copying uses bounded buffers. Available
space is checked on both the staging and destination filesystems; the existing
512 MiB reserve, stream size limits, and sender-ownership checks still apply.
This policy concerns streamed exports; it does not change project files or
non-streamed exports.

Startup cleanup deletes recognized files only in an owned private process
directory whose PID is definitively no longer running. Missing ownership records
can be handled using the validated PID/UUID directory name; malformed records,
unknown content, symlinks/junctions, ownership mismatches, and uncertain process
status are skipped. No age-based or recursive deletion is used. Live instances
retain their files. PID reuse can conservatively defer cleanup until a later
launch. Completion, cancellation, errors, idle expiry, renderer termination, and
main-frame navigation share cleanup. After close confirmation, shutdown stops
new exports and drains outstanding work for up to five seconds. Protected
leftovers are left for a later startup if draining or deletion cannot finish.

### Legacy system-temp files

Older builds used system-temp files named `soapy-panels-export-*.tmp` without
reliable process ownership records. They are **not automatically deleted**.
After closing **all Soapy Panels instances**, inspect your operating system's
user temporary directory (`os.tmpdir()`; commonly `/tmp` on Linux and `%TEMP%`
on Windows). Manually delete only regular files owned by your account that match
that exact legacy prefix and `.tmp` extension and that you recognize as abandoned
Soapy Panels exports. Do not follow links or remove directories, other users'
files, or unrelated temporary files. Empty your desktop trash if you used it.
This removes residual copies but does not provide secure erasure of storage media.

## Windows Store helper lookup

Packaged builds execute only `store-bridge/SoapyStoreBridge.exe` beneath Electron's
absolute `process.resourcesPath`. Startup passes `app.isPackaged` through the
monetization store to the bridge. Missing or invalid packaging state uses packaged
restrictions. Only an explicit `false` allows the development helper under the
source repository's `out/store-bridge/` directory. The working directory and
application environment variables never select the helper or enable a fallback.

The helper must be a regular file. Symlinks/junctions at its directory or
executable are rejected, and canonical paths must match the expected location
beneath the trusted root. The bridge invokes the absolute validated executable
without a shell and sets its child working directory to the helper's directory.
Missing, invalid, or unlaunchable helpers do not cause another location to be tried.
Windows package validation uses the same bundled-helper checks; Linux Community
continues to exclude the Store bridge.

If the helper is unavailable, Store queries and purchases report an error while
the editor remains usable. Existing cached-entitlement behavior is preserved.
Installed application resources are the trust boundary; this lookup policy does
not provide signature verification or protect against modification of the
installation itself.


## Recovery snapshot and storage bounds

Recovery persists only the version-1 envelope fields `version`, `timestamp`,
`name`, `generation`, `revision`, `excludedVideoCount`, and `project`; version and
timestamp are main-generated. The project payload is limited to 256 MiB and the
whole serialized UTF-8 snapshot to 256 MiB + 4 KiB. The reader applies the same
bound, including during reads of growing files. Unknown caller envelope fields
are never written.

Each user profile's `project-recovery` directory has a shared 2 GiB logical-byte
budget and a 32-session limit across app processes. Each renderer may own two
sessions. Admission accounts for both retained snapshots and the full temporary
replacement before deletion. Three MiB is reserved for bounded control metadata
(64 KiB/session and 1 MiB for SQLite coordination/sidecars); records are at most
4 KiB. Legacy metadata beyond its allowance remains charged until compacted.
This is a logical storage quota, not a process-memory or physical-disk-block cap.

Bundled `node:sqlite` transactions serialize accounting and mutations across app
instances; the filesystem is the authoritative byte ledger. Coordination failure
rejects recovery operations without disabling editing or manual project saves.
Pending requests are bounded per renderer and concurrent snapshot writes fail
busy before serialization. Close all older app versions before upgrading; they
do not participate in this coordination protocol.

Capacity never triggers eviction of completed recovery copies. Over-quota legacy
copies can still be listed, recovered, released, or explicitly discarded. Startup
discovers copies before allocating new storage. Manage recovery copies supports
32-item pages and damaged-copy discard; leaving the chooser preserves data.
Size/storage/session failures pause automatic recovery until explicit Retry,
with localized explanations. Transient I/O failures retain their existing retry.
Automatic cleanup only removes recognized inactive temporary files and empty
inactive sessions, respects live/uncertain owners, and never follows links.
Shutdown drains pending work within the existing five-second quit deadline.

Implementation and API details: [project recovery architecture](docs/architecture/project-recovery.md).
