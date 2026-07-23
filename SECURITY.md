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

## Resource limits

Project files are validated before restoration and are limited to 256 MiB,
16,384 pixels per canvas axis, and bounded object collections and nesting.
Streamed exports are limited to 16 GiB of logical output and 32 GiB of
cumulative writes while retaining at least 512 MiB of free disk space when the
operating system exposes filesystem statistics. These limits are security
contracts and must not be raised without compatibility and abuse-case review.
