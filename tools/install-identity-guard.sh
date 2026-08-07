#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  printf 'Run this script from inside the repository.\n' >&2
  exit 1
}

git config --local core.hooksPath "$repo_root/.githooks"
printf 'Installed repository hooks at %s/.githooks\n' "$repo_root"

