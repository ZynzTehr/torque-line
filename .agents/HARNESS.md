# Harness compatibility and enforcement

The shared policy is ordinary Markdown. It can be used by a harness that can load instructions and read local files, even without native rules or skill discovery. The installer creates entry points for supported tools; it does not modify global settings, install plugins, enable credentials, or loosen permissions.

## Entry points

All installed entry points direct the agent to `<project>/.agents/AGENTS.md`. The agent reads that file and its required references once. Paths inside the shared configuration are relative to `.agents/`, not the current working directory.

| Installer target | Entry point |
|---|---|
| `portable`, `codex` | Root `AGENTS.md` |
| `claude` | Root `AGENTS.md` and `CLAUDE.md` |
| `gemini` | Root `AGENTS.md` and `GEMINI.md` |
| `cursor` | Root `AGENTS.md` and `.cursor/rules/myagent.mdc` |
| `copilot` | Root `AGENTS.md` and `.github/copilot-instructions.md` |
| `antigravity` | Root `AGENTS.md`, plus `.agents/AGENTS.md` and `.agents/rules/` |
| `all` (default) | All entry points above |

These locations follow the documented conventions for [Codex](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [Claude Code](https://code.claude.com/docs/en/memory), [Gemini CLI](https://geminicli.com/docs/cli/gemini-md/), [Cursor](https://cursor.com/docs/rules), [GitHub Copilot](https://docs.github.com/en/copilot/reference/custom-instructions-support), and [Antigravity](https://antigravity.google/docs/rules/). Availability varies by product version and surface; verify loading in the actual session. File installation alone does not prove model adherence.

For another harness, use `--harness portable` and add this to its user-controlled instruction entry point: “Read `<project>/.agents/AGENTS.md` and follow its routing before beginning work.” If it cannot read files, supply the core instructions and required references through its supported context mechanism. A tool that cannot accept those instructions is not automatically supported.

## Skill discovery

The installer puts skills in `.agents/skills/`. Hosts differ in whether they find that folder and in which setting keeps a user-invoked skill out of automatic use. Documentation checked on 2026-10-04:

| Host | Finds `.agents/skills/` | Keeps a skill user-invoked | Skill listing budget |
|---|---|---|---|
| [Codex](https://learn.chatgpt.com/docs/build-skills) | Yes, from the working directory up to the repository root | `agents/openai.yaml` with `policy.allow_implicit_invocation: false` | 2% of the context window, or 8,000 characters when unknown; descriptions are shortened first |
| [Claude Code](https://code.claude.com/docs/en/skills) | No, it reads `.claude/skills/`; skills load through `AGENTS.md` routing and the direct-read fallback below | `disable-model-invocation: true` | 1% of the context window by default; descriptions are dropped first |
| [Cursor](https://cursor.com/docs/context/skills) | Yes | `disable-model-invocation: true` | Not documented |
| [VS Code with Copilot](https://code.visualstudio.com/docs/copilot/customization/agent-skills) | Yes | `disable-model-invocation: true` | Not documented |
| [Gemini CLI](https://geminicli.com/docs/cli/skills) | Yes, as an alias of `.gemini/skills/` | Not documented | Not documented |

Antigravity's skill discovery has not been checked. Every user-invoked skill in this package sets both the frontmatter flag and the Codex policy; `bash validate.sh` checks that they agree and reports the size of the model-invocable listing.

## Capability fallbacks

Read `skills/<name>/SKILL.md` directly when a relevant skill is not registered natively. Load only that skill's required references. A slash-command name in a document means the workflow, not proof that the command exists. Honor the user's invocation and scope regardless of whether a harness recognizes optional skill metadata.

| Named capability in a workflow | Fallback when unavailable |
|---|---|
| `Task`, `poteto-agent`, `Comment Sicko`, multi-model review | Use a supported general delegate with the same bounded brief; otherwise perform the checks sequentially. State when no independent review occurred. |
| `AskQuestion`, `AskUserQuestion` | Ask a concise question through ordinary chat when the answer is needed. |
| `deslop` | Inspect the diff for unnecessary code, unrelated changes, duplication, and unclear naming; apply the bundled `unslop` skill to prose. |
| `control-ui` | Use an available browser or UI inspection tool to exercise the real interface. If none exists, report visual verification as unavailable. |
| `control-cli` | Run the CLI in the available terminal, assert exit status and output, and use a PTY when required. Report interactive checks that cannot run. |
| `/loop`, `/goal`, background agents, cloud runners | Use supported continuation or scheduling within the user's authorized task. Without it, work synchronously and provide a checkpoint when the session ends; do not claim a watcher remains active. |
| A named model or provider | Use an available model under the user's settings. Do not change accounts, buy capacity, or send private data to a new provider to match a workflow. |
| Forge, issue tracker, MCP connector | Use an already available authorized equivalent. Prepare a local artifact if no equivalent exists; report the missing integration before an external step. |
| `EnterWorktree`, `claude --worktree`, parallel worktrees | `git worktree add -b <branch> <path> <base>` in a sibling directory, then open that folder in the harness so its hook configuration runs; without worktrees, work tickets one at a time on one branch and never run two writers in one checkout. |

Capabilities are optional unless a requested outcome actually requires them. Fall back only when the alternative verifies the same property; never relabel a static check as runtime or visual verification. Some bundled skills teach a specific platform, such as Claude plugin authoring or Xcode tooling. Use them for that platform only; the installation does not make those products available elsewhere.

## Enforcement outside Markdown

The user's task controls scope subject to the harness's higher-priority instructions. Markdown cannot override those instructions, prove the identity of an author inside a document, block an arbitrary tool call, or guarantee immunity to prompt injection. Even structured tool output and official sources can carry hostile text. Behavioral scenarios in [SECURITY-CHECKS.md](SECURITY-CHECKS.md) help evaluate adherence but are not a security proof.

Use the harness's actual controls for enforcement:

- Keep filesystem access limited to the current project and explicitly needed inputs. Keep unrelated credentials, browser sessions, private chats, and production data out of the runtime.
- Use a sandbox or isolated checkout for unfamiliar code. Builds, tests, package lifecycle scripts, Git hooks, and plugins execute code; inspect them before running them in a credentialed environment.
- Expose only needed tools and scoped credentials. Restrict outbound destinations and secret access where the platform supports it. A local command can still contact a network service.
- Retain approval gates for destructive, publishing, credential, and permission operations. Never enable blanket bypass flags to satisfy a skill. Policy/profile changes require the user's instruction.
- Review updates to this package, instruction files, hooks, and connectors as code. Repository-controlled instructions are not an authentication mechanism. Protect the trusted configuration outside an untrusted checkout when the threat model requires it.

The installer hardens its own file writes and preserves backups. It does not sandbox future agents or change hook registration, except that `--uninstall` removes this package's own registrations. The optional [hook setup command](HOOKS.md) registers local verification and handoff helpers for Codex, Claude Code, and Cursor while preserving unrelated settings. Other command-capable runners can use the lifecycle runtime's `--harness portable` JSON format and map their own events. Native trust review remains the host's responsibility. These helpers are not security enforcement hooks, and no universal hook protocol covers every harness.

[Jev skill suggestions](JEV.md) use a separate portable JSON command that does not depend on the coding model. Optional native prompt adapters supply advisory context for Codex and Claude Code. Cursor's prompt hook cannot inject that context, so no Jev hook is registered there; use the portable command. The feature ships disabled with a zero request allowance. A host without Python execution needs an external runner or manual playground input. Selecting a skill does not make platform-specific tools available in another host.

[Prompt and usage records](USAGE.md) are also portable. Default hooks capture sanitized user prompts and the agent's final replies for Codex, Claude Code, and Cursor; other callers can invoke the logging command. Exact coding-model token counts still require telemetry from the actual host or provider. The shared ledger accepts explicit measurements and marks missing coverage unknown; prompt text cannot establish a token bill.
