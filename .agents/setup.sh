#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: Python 3.9 or newer is required." >&2
  exit 1
fi
exec python3 -B "$SCRIPT_DIR/scripts/install.py" "$@"
