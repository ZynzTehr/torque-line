# Common Hook Patterns

This reference provides common, proven patterns for implementing Claude Code hooks. Use these patterns as starting points for typical hook use cases.

<!-- reference-contents:start -->
## Contents

- [Pattern 1: Security Validation](#pattern-1-security-validation)
- [Pattern 2: Test Enforcement](#pattern-2-test-enforcement)
- [Pattern 3: Context Loading](#pattern-3-context-loading)
- [Pattern 4: Notification Logging](#pattern-4-notification-logging)
- [Pattern 5: MCP Tool Monitoring](#pattern-5-mcp-tool-monitoring)
- [Pattern 6: Build Verification](#pattern-6-build-verification)
- [Pattern 7: Permission Confirmation](#pattern-7-permission-confirmation)
- [Pattern 8: Code Quality Checks](#pattern-8-code-quality-checks)
- [Pattern Combinations](#pattern-combinations)
- [Pattern 9: Temporarily Active Hooks](#pattern-9-temporarily-active-hooks)
- [Pattern 10: Configuration-Driven Hooks](#pattern-10-configuration-driven-hooks)
<!-- reference-contents:end -->

## Pattern 1: Security Validation

Block dangerous file writes using prompt-based hooks:

```json
{
  "PreToolUse": [
    {
      "matcher": "Write|Edit",
      "hooks": [
        {
          "type": "prompt",
          "prompt": "Hook input: $ARGUMENTS. Check tool_input.file_path. Verify: 1) Not in /etc or system directories 2) Not .env or credentials 3) Path doesn't contain '..' traversal. Respond with {\"ok\": true} to allow, or {\"ok\": false, \"reason\": \"why\"} to block."
        }
      ]
    }
  ]
}
```

**Use for:** Preventing writes to sensitive files or system directories.

## Pattern 2: Test Enforcement

Ensure tests run before stopping:

```json
{
  "Stop": [
    {
      "matcher": "*",
      "hooks": [
        {
          "type": "agent",
          "prompt": "Claude is about to stop. If code changed in this session, run the project's test suite and check the results. Hook input: $ARGUMENTS. Respond with {\"ok\": true} if the tests pass or no code changed; otherwise {\"ok\": false, \"reason\": \"Tests must pass after code changes: the failures\"}.",
          "timeout": 120
        }
      ]
    }
  ]
}
```

**Use for:** Enforcing quality standards and preventing incomplete work. It is an agent hook because it runs the tests itself: a prompt hook sees only the hook input, and the transcript file may not yet hold the turn's latest tool calls when the hook fires.

## Pattern 3: Context Loading

Load project-specific context at session start:

```json
{
  "SessionStart": [
    {
      "matcher": "*",
      "hooks": [
        {
          "type": "command",
          "command": "bash ${CLAUDE_PLUGIN_ROOT}/scripts/load-context.sh"
        }
      ]
    }
  ]
}
```

**Example script (load-context.sh):**
```bash
#!/bin/bash
cd "$CLAUDE_PROJECT_DIR" || exit 1

# Detect project type
if [ -f "package.json" ]; then
  echo "📦 Node.js project detected"
  echo "export PROJECT_TYPE=nodejs" >> "$CLAUDE_ENV_FILE"
elif [ -f "Cargo.toml" ]; then
  echo "🦀 Rust project detected"
  echo "export PROJECT_TYPE=rust" >> "$CLAUDE_ENV_FILE"
fi
```

**Use for:** Automatically detecting and configuring project-specific settings.

## Pattern 4: Notification Logging

Log all notifications for audit or analysis:

```json
{
  "Notification": [
    {
      "matcher": "*",
      "hooks": [
        {
          "type": "command",
          "command": "bash ${CLAUDE_PLUGIN_ROOT}/scripts/log-notification.sh"
        }
      ]
    }
  ]
}
```

**Use for:** Tracking user notifications or integration with external logging systems.

## Pattern 5: MCP Tool Monitoring

Monitor and validate MCP tool usage:

```json
{
  "PreToolUse": [
    {
      "matcher": "mcp__.*__delete.*",
      "hooks": [
        {
          "type": "prompt",
          "prompt": "Deletion operation detected. Verify: Is this deletion intentional? Can it be undone? Are there backups? Input: $ARGUMENTS. Respond with {\"ok\": true} only if safe; otherwise {\"ok\": false, \"reason\": \"why\"}."
        }
      ]
    }
  ]
}
```

**Use for:** Protecting against destructive MCP operations.

## Pattern 6: Build Verification

Ensure project builds after code changes:

```json
{
  "Stop": [
    {
      "matcher": "*",
      "hooks": [
        {
          "type": "agent",
          "prompt": "Claude is about to stop. If code changed in this session, run the project's build (npm run build, cargo build, or its equivalent) and check that it succeeds. Hook input: $ARGUMENTS. Respond with {\"ok\": true} if it builds or no code changed; otherwise {\"ok\": false, \"reason\": \"Fix the build before stopping: the errors\"}.",
          "timeout": 120
        }
      ]
    }
  ]
}
```

**Use for:** Catching build errors before committing or stopping work. Like Pattern 2, it is an agent hook that runs the check itself.

## Pattern 7: Permission Confirmation

Ask user before dangerous operations:

```json
{
  "PreToolUse": [
    {
      "matcher": "Bash",
      "hooks": [
        {
          "type": "prompt",
          "prompt": "Hook input: $ARGUMENTS. If tool_input.command contains 'rm', 'delete', 'drop', or other destructive operations, respond with {\"ok\": false, \"reason\": \"needs the user's confirmation\"}. Otherwise respond with {\"ok\": true}. A prompt hook cannot ask the user; use a command hook's permissionDecision ask for that."
        }
      ]
    }
  ]
}
```

**Use for:** User confirmation on potentially destructive commands.

## Pattern 8: Code Quality Checks

Run linters or formatters on file edits:

```json
{
  "PostToolUse": [
    {
      "matcher": "Write|Edit",
      "hooks": [
        {
          "type": "command",
          "command": "bash ${CLAUDE_PLUGIN_ROOT}/scripts/check-quality.sh"
        }
      ]
    }
  ]
}
```

**Example script (check-quality.sh):**
```bash
#!/bin/bash
input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path')

# Run linter if applicable
if [[ "$file_path" == *.js ]] || [[ "$file_path" == *.ts ]]; then
  npx eslint "$file_path" 2>&1 || true
fi
```

**Use for:** Automatic code quality enforcement.

## Pattern Combinations

Combine multiple patterns for comprehensive protection:

```json
{
  "PreToolUse": [
    {
      "matcher": "Write|Edit",
      "hooks": [
        {
          "type": "prompt",
          "prompt": "Validate file write safety"
        }
      ]
    },
    {
      "matcher": "Bash",
      "hooks": [
        {
          "type": "prompt",
          "prompt": "Validate bash command safety"
        }
      ]
    }
  ],
  "Stop": [
    {
      "matcher": "*",
      "hooks": [
        {
          "type": "agent",
          "prompt": "If code changed, run the tests and the build and check that both succeed",
          "timeout": 120
        }
      ]
    }
  ],
  "SessionStart": [
    {
      "matcher": "*",
      "hooks": [
        {
          "type": "command",
          "command": "bash ${CLAUDE_PLUGIN_ROOT}/scripts/load-context.sh"
        }
      ]
    }
  ]
}
```

This provides multi-layered protection and automation.

## Pattern 9: Temporarily Active Hooks

Create hooks that only run when explicitly enabled via flag files:

```bash
#!/bin/bash
# Hook only active when flag file exists
FLAG_FILE="$CLAUDE_PROJECT_DIR/.enable-security-scan"

if [ ! -f "$FLAG_FILE" ]; then
  # Quick exit when disabled
  exit 0
fi

# Flag present, run validation
input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path')

# Run security scan
security-scanner "$file_path"
```

**Activation:**
```bash
# Enable the hook
touch .enable-security-scan

# Disable the hook
rm .enable-security-scan
```

**Use for:**
- Temporary debugging hooks
- Feature flags for development
- Project-specific validation that's opt-in
- Performance-intensive checks only when needed

**Note:** Must restart Claude Code after creating/removing flag files for hooks to recognize changes.

## Pattern 10: Configuration-Driven Hooks

Use JSON configuration to control hook behavior:

```bash
#!/bin/bash
CONFIG_FILE="$CLAUDE_PROJECT_DIR/.claude/my-plugin.local.json"

# Read configuration
if [ -f "$CONFIG_FILE" ]; then
  strict_mode=$(jq -r '.strictMode // false' "$CONFIG_FILE")
  max_file_size=$(jq -r '.maxFileSize // 1000000' "$CONFIG_FILE")
else
  # Defaults
  strict_mode=false
  max_file_size=1000000
fi

# Skip if not in strict mode
if [ "$strict_mode" != "true" ]; then
  exit 0
fi

# Apply configured limits
input=$(cat)
file_size=$(echo "$input" | jq -r '.tool_input.content | length')

if [ "$file_size" -gt "$max_file_size" ]; then
  echo '{"decision": "deny", "reason": "File exceeds configured size limit"}' >&2
  exit 2
fi
```

**Configuration file (.claude/my-plugin.local.json):**
```json
{
  "strictMode": true,
  "maxFileSize": 500000,
  "allowedPaths": ["/tmp", "/home/user/projects"]
}
```

**Use for:**
- User-configurable hook behavior
- Per-project settings
- Team-specific rules
- Dynamic validation criteria
