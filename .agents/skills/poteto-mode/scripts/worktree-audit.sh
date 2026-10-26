#!/usr/bin/env bash
set -euo pipefail

for required_tool in git python3; do
  if ! command -v "$required_tool" >/dev/null 2>&1; then
    printf 'worktree-audit: required tool not found: %s\n' "$required_tool" >&2
    exit 1
  fi
done

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/worktree_audit.py" "$@"
