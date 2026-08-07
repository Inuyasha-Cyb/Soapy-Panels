#!/usr/bin/env bash
set -euo pipefail

expected_login='Inuyasha-Cyb'
expected_remote='https://github.com/Inuyasha-Cyb/Soapy-Panels.git'
base_ref='origin/main'

fail() {
  printf 'Identity guard: %s\n' "$1" >&2
  exit 1
}

case "${1:-}" in
  --dry-run|--push) action="$1" ;;
  *)
    printf 'Usage: %s --dry-run|--push\n' "$0" >&2
    exit 2
    ;;
esac

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail 'not inside a Git repository'
cd "$repo_root"

gh_bin="$(command -v gh || true)"
if [[ -z "$gh_bin" && -x /home/inuyasha/.local/bin/gh ]]; then
  gh_bin=/home/inuyasha/.local/bin/gh
fi
[[ -n "$gh_bin" ]] || fail 'GitHub CLI is not installed'

login="$($gh_bin api user --jq .login 2>/dev/null)" || fail 'GitHub CLI is not authenticated'
[[ "$login" == "$expected_login" ]] || fail "authenticated GitHub account is '$login', expected '$expected_login'"

remote="$(git remote get-url origin 2>/dev/null)" || fail 'origin remote is missing'
[[ "$remote" == "$expected_remote" ]] || fail "origin is '$remote', expected '$expected_remote'"

name="$(git config --get user.name || true)"
email="$(git config --get user.email || true)"
[[ "$name" == "$expected_login" ]] || fail "Git user.name is '$name', expected '$expected_login'"
[[ -n "$email" ]] || fail 'Git user.email is not configured'

verified_emails="$($gh_bin api user/emails --jq '.[] | select(.verified == true) | .email' 2>/dev/null)" || fail 'could not read verified GitHub email addresses'
printf '%s\n' "$verified_emails" | grep -Fqx "$email" || fail "Git user.email '$email' is not verified on '$expected_login'"

if git rev-parse --verify "$base_ref" >/dev/null 2>&1; then
  commits="$(git log "$base_ref..HEAD" --format='%an <%ae>%n%cn <%ce>' 2>/dev/null || true)"
  if printf '%s\n' "$commits" | grep -Eiq '(^|[ <])(inuyasha)([ >]|$)|inuyasha@users\.noreply\.github\.com|j9807032054025@tutanota\.com'; then
    fail 'the commits being published contain a prohibited old identity'
  fi
  if [[ -n "$commits" ]] && ! printf '%s\n' "$commits" | awk -v name="$expected_login" -v email="$email" '
    /</ {
      line = $0
      if (line !~ ("^" name " <" email ">$")) bad = 1
    }
    END { exit bad ? 1 : 0 }
  '; then
    fail 'the commits being published do not all use the configured identity'
  fi
fi

case "$action" in
  --dry-run)
    git push --dry-run --force-with-lease origin HEAD
    ;;
  --push)
    git push --force-with-lease origin HEAD
    ;;
esac
