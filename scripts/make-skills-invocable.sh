#!/usr/bin/env bash
# Make every installed MyNewAgent skill model-invocable and visible to Claude Code.
# Re-run after each `setup.sh` update: the installer restores package files to their
# shipped state, which re-disables model invocation on the manual-only skills.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SKILLS="$ROOT/.agents/skills"
[ -d "$SKILLS" ] || { echo "No $SKILLS; install MyNewAgent first." >&2; exit 1; }

changed=0
for skill in "$SKILLS"/*/SKILL.md; do
  # Only touch the flag inside the leading frontmatter block (between the first two --- lines).
  if awk 'NR==1&&$0!="---"{exit 1} NR>1&&$0=="---"{exit 1} /^disable-model-invocation:[[:space:]]*true[[:space:]]*$/{f=1} END{exit !f}' "$skill"; then
    awk 'BEGIN{fm=0} NR==1&&$0=="---"{fm=1; print; next} fm&&$0=="---"{fm=0; print; next} fm&&/^disable-model-invocation:[[:space:]]*true[[:space:]]*$/{next} {print}' "$skill" > "$skill.tmp" && mv "$skill.tmp" "$skill"
    changed=$((changed+1))
  fi
  policy="$(dirname "$skill")/agents/openai.yaml"
  if [ -f "$policy" ] && grep -Eq '^[[:space:]]*allow_implicit_invocation:[[:space:]]*false' "$policy"; then
    sed -E -i.bak 's/^([[:space:]]*allow_implicit_invocation:[[:space:]]*)false/\1true/' "$policy" && rm -f "$policy.bak"
  fi
done

# Claude Code discovers project skills in .claude/skills/, not .agents/skills/.
mkdir -p "$ROOT/.claude"
link="$ROOT/.claude/skills"
if [ -L "$link" ]; then :
elif [ -e "$link" ]; then echo "$link exists and is not a symlink; leaving it alone." >&2; exit 1
else ln -s ../.agents/skills "$link"; fi

remaining=0
for skill in "$SKILLS"/*/SKILL.md; do
  awk 'NR==1&&$0!="---"{exit 1} NR>1&&$0=="---"{exit 1} /^disable-model-invocation:[[:space:]]*true[[:space:]]*$/{f=1} END{exit !f}' "$skill" && remaining=$((remaining+1))
done
total=$(ls "$SKILLS"/*/SKILL.md | wc -l | tr -d ' ')
echo "Enabled model invocation on $changed skill(s). Manual-only remaining: $remaining of $total."
echo "Claude Code skills path: .claude/skills -> $(readlink "$link")"
