#!/bin/bash
# Claude Code PreToolUse hook for Bash: exit 2 blocks the call and shows stderr to Claude.

INPUT=$(cat)

read_command() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$INPUT" | jq -er '.tool_input.command // ""'
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$INPUT" | python3 -c 'import json, sys; print((json.load(sys.stdin).get("tool_input") or {}).get("command") or "")'
  else
    return 127
  fi
}

# A guard that cannot read the command must not wave it through.
if ! COMMAND=$(read_command); then
  echo "BLOCKED: this git guard could not read the command (it needs jq or python3, and valid hook input). The user has prevented unchecked commands." >&2
  exit 2
fi

# The shell deletes a backslash-newline, even inside a word.
COMMAND=${COMMAND//$'\\\n'/}
COMMAND=$(printf '%s' "$COMMAND" | tr -s '[:space:]' ' ')
# git, then any global options such as -C <path>, -c <name=value>, or --git-dir=<path>.
# One shell word: quoted parts, backslash escapes, and plain characters may alternate, as in user.name="A B" or O\'Brien.
# $'...' may hold \' and $(...) or `...` may hold spaces, as in -C $(git rev-parse --show-toplevel).
VALUE=$'(("([^"\\\\]|\\\\.)*"|\\$\'([^\'\\\\]|\\\\.)*\'|\'[^\']*\'|\\$\\([^()]*\\)|`[^`]*`|\\\\.|[^ "\'\\\\])+)'
GIT="(^|[^A-Za-z0-9_.-])git( +(-C|-c|--git-dir|--work-tree|--namespace|--exec-path) +${VALUE}| +--?[A-Za-z][A-Za-z-]*(=${VALUE})?)*"
ARGS="( +[^ ;&|]+)*"
END="([^A-Za-z0-9_-]|$)"

DANGEROUS_PATTERNS=(
  "${GIT} +push${END}"
  "${GIT} +reset${ARGS} +--hard${END}"
  "${GIT} +clean${ARGS} +(-[A-Za-z]*f[A-Za-z]*|--force)${END}"
  "${GIT} +branch${ARGS} +-D${END}"
  "${GIT} +checkout${ARGS} +\\."
  "${GIT} +restore${ARGS} +\\."
  "push --force"
  "reset --hard"
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if printf '%s\n' "$COMMAND" | grep -qE "$pattern"; then
    echo "BLOCKED: '$COMMAND' is a destructive git command. The user has prevented you from doing this." >&2
    exit 2
  fi
done

exit 0
