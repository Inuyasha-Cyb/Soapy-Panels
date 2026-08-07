# GitHub identity policy

For this repository, the default and required GitHub identity is `Inuyasha-Cyb`.

Before any GitHub operation, verify the authenticated account:

```bash
gh api user --jq .login
```

The command must print exactly `Inuyasha-Cyb`. If `gh` is unavailable, authentication is missing, or another account is active, stop and ask the user to authenticate the correct account. Never guess credentials or use a browser session belonging to another account.

Use the repository remote `https://github.com/Inuyasha-Cyb/Soapy-Panels.git` and the guarded publisher at `tools/publish-as-inuyasha-cyb.sh` for publishing. Do not use raw `git push` or create a pull request without first running the guard.

Never use these identities for this repository:

- `Inuyasha`
- `inuyasha@users.noreply.github.com`
- `j9807032054025@tutanota.com`

Before committing, verify that the effective `user.name` is `Inuyasha-Cyb` and that `user.email` is a verified email belonging to that GitHub account. If an identity check fails, stop rather than changing credentials silently.

