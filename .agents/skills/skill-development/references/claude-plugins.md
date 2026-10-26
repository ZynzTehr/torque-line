# Skills inside a Claude Code plugin

Read this only when the requested skill is distributed as part of a Claude Code plugin. These are platform details, not requirements for portable skills.

## Layout and discovery

Place the skill at `<plugin>/skills/<name>/SKILL.md`. Keep the plugin manifest at `<plugin>/.claude-plugin/plugin.json`; skills are beside that manifest directory, not inside it. Preserve the existing plugin's structure and versioning conventions.

The skill is distributed with the plugin; a separate skill ZIP or a `package_skill.py` command is not required. Creating a standalone project skill does not itself require a plugin manifest or marketplace.

Enabled, implicitly available plugin skills contribute names and descriptions to Claude Code's context; their full bodies load when used. Supporting files should have explicit reading conditions. Preserve the user's invocation policy rather than assuming the same metadata semantics in another harness. [Official plugin overview](https://code.claude.com/docs/en/plugins)

## Local verification

When Claude Code is available and a local runtime test is within scope, verify the installed CLI supports the option and load the plugin from its folder:

```bash
claude --plugin-dir /absolute/path/to/plugin
```

Exercise an intended request and a nearby request that should not activate the skill. Confirm which skill/resources actually load and inspect the resulting work. A static file check cannot establish native discovery. If the CLI is unavailable, validate the files and report the runtime check as unverified; do not invent an alias such as `cc` or install a runtime without authorization. [Official local-plugin development guidance](https://code.claude.com/docs/en/plugins)

Publishing the plugin or changing global configuration is separate from creating and checking its skill files.
