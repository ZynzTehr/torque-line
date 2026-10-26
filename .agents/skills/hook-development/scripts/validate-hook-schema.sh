#!/bin/bash
# Hook Schema Validator
# Validates hooks.json structure and checks for common issues

set -euo pipefail

# Usage
if [ $# -eq 0 ]; then
  echo "Usage: $0 <path/to/hooks.json>"
  echo ""
  echo "Validates hook configuration file for:"
  echo "  - Valid JSON syntax"
  echo "  - Required fields"
  echo "  - Hook type validity"
  echo "  - Matcher type (a string when present)"
  echo "  - Timeout ranges"
  exit 1
fi

HOOKS_FILE="$1"

if [ ! -f "$HOOKS_FILE" ]; then
  echo "❌ Error: File not found: $HOOKS_FILE"
  exit 1
fi

echo "🔍 Validating hooks configuration: $HOOKS_FILE"
echo ""

# Check 1: Valid JSON
echo "Checking JSON syntax..."
if ! jq empty "$HOOKS_FILE" 2>/dev/null; then
  echo "❌ Invalid JSON syntax"
  exit 1
fi
echo "✅ Valid JSON"

# Check 2: Root structure
echo ""
echo "Checking root structure..."
# The events in the Claude Code hooks reference (checked 2026-10-04); a newer event only draws a warning.
VALID_EVENTS=("PreToolUse" "PostToolUse" "PostToolUseFailure" "PostToolBatch" "PermissionRequest" "PermissionDenied"
  "UserPromptSubmit" "UserPromptExpansion" "Stop" "StopFailure" "SubagentStart" "SubagentStop" "SessionStart" "SessionEnd"
  "Setup" "PreCompact" "PostCompact" "Notification" "MessageDisplay" "TaskCreated" "TaskCompleted" "TeammateIdle"
  "ConfigChange" "CwdChanged" "DirectoryAdded" "FileChanged" "InstructionsLoaded" "Elicitation" "ElicitationResult"
  "PreModelSwitch" "PostModelSwitch" "WorktreeCreate" "WorktreeRemove")
error_count=0
warning_count=0

# Plugin hooks.json and settings files both put the event map under a top-level "hooks" object.
if jq -e 'has("hooks") and (.hooks | type == "object")' "$HOOKS_FILE" >/dev/null; then
  ROOT='.hooks'
else
  ROOT='.'
  echo "⚠️  No top-level \"hooks\" object. Plugin hooks.json and settings files need one; reading the file as a bare event map."
  warning_count=$((warning_count + 1))
fi

for event in $(jq -r "$ROOT | keys[]" "$HOOKS_FILE"); do
  found=false
  for valid_event in "${VALID_EVENTS[@]}"; do
    if [ "$event" = "$valid_event" ]; then
      found=true
      break
    fi
  done

  if [ "$found" = false ]; then
    echo "⚠️  Unknown event type: $event"
  fi
done
echo "✅ Root structure valid"

# Check 3: Validate each hook
echo ""
echo "Validating individual hooks..."

for event in $(jq -r "$ROOT | keys[]" "$HOOKS_FILE"); do
  EVENT="$ROOT[\"$event\"]"
  hook_count=$(jq -r "$EVENT | length" "$HOOKS_FILE")

  for ((i=0; i<hook_count; i++)); do
    # A matcher is optional: omitted, "", or "*" matches every occurrence, and events without matchers ignore it.
    matcher_type=$(jq -r "$EVENT[$i].matcher | type" "$HOOKS_FILE")
    if [ "$matcher_type" != "null" ] && [ "$matcher_type" != "string" ]; then
      echo "❌ $event[$i]: 'matcher' must be a string, not $matcher_type"
      error_count=$((error_count + 1))
    fi

    # Check hooks array exists
    hooks=$(jq -r "$EVENT[$i].hooks // empty" "$HOOKS_FILE")
    if [ -z "$hooks" ] || [ "$hooks" = "null" ]; then
      echo "❌ $event[$i]: Missing 'hooks' array"
      error_count=$((error_count + 1))
      continue
    fi

    # Validate each hook in the array
    hook_array_count=$(jq -r "$EVENT[$i].hooks | length" "$HOOKS_FILE")

    for ((j=0; j<hook_array_count; j++)); do
      hook_type=$(jq -r "$EVENT[$i].hooks[$j].type // empty" "$HOOKS_FILE")

      if [ -z "$hook_type" ]; then
        echo "❌ $event[$i].hooks[$j]: Missing 'type' field"
        error_count=$((error_count + 1))
        continue
      fi

      if [ "$hook_type" != "command" ] && [ "$hook_type" != "prompt" ] && [ "$hook_type" != "agent" ] && [ "$hook_type" != "http" ] && [ "$hook_type" != "mcp_tool" ]; then
        echo "❌ $event[$i].hooks[$j]: Invalid type '$hook_type' (must be command, prompt, agent, http, or mcp_tool)"
        error_count=$((error_count + 1))
        continue
      fi

      # Check type-specific fields
      if [ "$hook_type" = "command" ]; then
        command=$(jq -r "$EVENT[$i].hooks[$j].command // empty" "$HOOKS_FILE")
        if [ -z "$command" ]; then
          echo "❌ $event[$i].hooks[$j]: Command hooks must have 'command' field"
          error_count=$((error_count + 1))
        else
          # Check for hardcoded paths
          if [[ "$command" == /* ]] && [[ "$command" != *'${CLAUDE_PLUGIN_ROOT}'* ]]; then
            echo "⚠️  $event[$i].hooks[$j]: Hardcoded absolute path detected. Consider using \${CLAUDE_PLUGIN_ROOT}"
            warning_count=$((warning_count + 1))
          fi
        fi
      elif [ "$hook_type" = "prompt" ] || [ "$hook_type" = "agent" ]; then
        prompt=$(jq -r "$EVENT[$i].hooks[$j].prompt // empty" "$HOOKS_FILE")
        if [ -z "$prompt" ]; then
          echo "❌ $event[$i].hooks[$j]: $hook_type hooks must have 'prompt' field"
          error_count=$((error_count + 1))
        fi
      elif [ "$hook_type" = "http" ]; then
        if [ -z "$(jq -r "$EVENT[$i].hooks[$j].url // empty" "$HOOKS_FILE")" ]; then
          echo "❌ $event[$i].hooks[$j]: http hooks must have 'url' field"
          error_count=$((error_count + 1))
        fi
      elif [ -z "$(jq -r "$EVENT[$i].hooks[$j].server // empty" "$HOOKS_FILE")" ] || [ -z "$(jq -r "$EVENT[$i].hooks[$j].tool // empty" "$HOOKS_FILE")" ]; then
        echo "❌ $event[$i].hooks[$j]: mcp_tool hooks must have 'server' and 'tool' fields"
        error_count=$((error_count + 1))
      fi

      # The hook types each event runs, per the hooks reference. Setup always skips mcp_tool hooks, and SessionStart
      # skips them at launch, before MCP servers connect.
      case "$event" in
        Setup) supported="command" ;;
        SessionStart) supported="command mcp_tool" ;;
        ConfigChange|CwdChanged|DirectoryAdded|Elicitation|ElicitationResult|FileChanged|InstructionsLoaded|MessageDisplay|\
Notification|PostCompact|PostModelSwitch|PreCompact|PreModelSwitch|SessionEnd|StopFailure|SubagentStart|WorktreeCreate|WorktreeRemove)
          supported="command http mcp_tool" ;;
        PermissionRequest) supported="command http mcp_tool prompt" ;;
        *) supported="command http mcp_tool prompt agent" ;;
      esac
      case " $supported " in
        *" $hook_type "*) ;;
        *)
          echo "❌ $event[$i].hooks[$j]: $event does not run $hook_type hooks (it runs: $supported)"
          error_count=$((error_count + 1))
          ;;
      esac
      if [ "$event" = "SessionStart" ] && [ "$hook_type" = "mcp_tool" ]; then
        echo "⚠️  $event[$i].hooks[$j]: SessionStart skips mcp_tool hooks at launch; they run only after /clear or compaction"
        warning_count=$((warning_count + 1))
      fi

      # Check timeout
      timeout=$(jq -r "$EVENT[$i].hooks[$j].timeout // empty" "$HOOKS_FILE")
      if [ -n "$timeout" ] && [ "$timeout" != "null" ]; then
        if ! [[ "$timeout" =~ ^[0-9]+$ ]]; then
          echo "❌ $event[$i].hooks[$j]: Timeout must be a number"
          error_count=$((error_count + 1))
        elif [ "$timeout" -gt 600 ]; then
          echo "⚠️  $event[$i].hooks[$j]: Timeout $timeout seconds is very high (max 600s)"
          warning_count=$((warning_count + 1))
        elif [ "$timeout" -lt 5 ]; then
          echo "⚠️  $event[$i].hooks[$j]: Timeout $timeout seconds is very low"
          warning_count=$((warning_count + 1))
        fi
      fi
    done
  done
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $error_count -eq 0 ] && [ $warning_count -eq 0 ]; then
  echo "✅ All checks passed!"
  exit 0
elif [ $error_count -eq 0 ]; then
  echo "⚠️  Validation passed with $warning_count warning(s)"
  exit 0
else
  echo "❌ Validation failed with $error_count error(s) and $warning_count warning(s)"
  exit 1
fi
