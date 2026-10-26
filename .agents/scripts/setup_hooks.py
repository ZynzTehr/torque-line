#!/usr/bin/env python3
"""Opt in to project-local agent hooks, preserving unrelated harness settings."""
import argparse
from contextlib import contextmanager
from datetime import datetime
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import stat
import subprocess
import sys
import tempfile


HARNESSES = ("codex", "claude", "cursor")
EVENTS = ("SessionStart", "SubagentStart", "PostToolUse", "Stop", "SubagentStop", "PreCompact")
CONFIGS = {"codex": ".codex/hooks.json", "claude": ".claude/settings.json", "cursor": ".cursor/hooks.json"}
LOCAL_CONFIGS = {"claude": ".claude/settings.local.json"}
CURSOR_EVENTS = {event: event[0].lower() + event[1:] for event in EVENTS}
# These fixed programs accept only installer-generated arguments, leave stdin for
# the runtime, and avoid baking a checkout's absolute path into settings.
# Ownership recognizes every released text, so an update replaces registrations
# instead of orphaning them. Never edit a released entry; append a new version.
BOOTSTRAP_V1 = '''import os,pathlib,runpy,sys
marker = "myagent-hooks:v1"
harness,event,layout = sys.argv[1:]
env_root = os.environ.get("CLAUDE_PROJECT_DIR") if harness == "claude" else None
start = pathlib.Path(env_root).absolute() if env_root else pathlib.Path.cwd()
roots = [start] if env_root else [start, *start.parents]
for root in roots:
    package = root if layout == "." else root / ".agents"
    runtime = package / "scripts" / "agent_hooks.py"
    if not runtime.is_file() or not (package / "AGENTS.md").is_file():
        continue
    paths = [runtime, package / "AGENTS.md"]
    if any(p.is_symlink() for path in paths for p in [path, *path.parents]):
        raise SystemExit("MyAgent hooks refuse symlink paths")
    sys.argv = [str(runtime), "--harness", harness, "--event", event, "--project-root", str(root), "--package-root", str(package)]
    runpy.run_path(str(runtime), run_name="__main__")
    break
else:
    raise SystemExit("MyAgent hook runtime missing; run scripts/setup_hooks.py in the project again")
'''
# Version 2 runs only the package of the project whose host configuration holds
# the hook: a project missing its runtime fails instead of executing a package
# from a parent directory. Only paths inside that project must not be symlinks,
# and no bytecode cache is written into the package.
BOOTSTRAP_V2 = '''import os,pathlib,runpy,sys
sys.dont_write_bytecode = True
marker = "myagent-hooks:v2"
harness,event,layout = sys.argv[1:]
configs = {"claude": [".claude/settings.json", ".claude/settings.local.json"], "codex": [".codex/hooks.json"], "cursor": [".cursor/hooks.json"]}[harness]
env_root = os.environ.get("CLAUDE_PROJECT_DIR") if harness == "claude" else None
start = pathlib.Path(env_root or os.getcwd()).resolve()
root = start if env_root else next((p for p in [start, *start.parents] if any((p / name).is_file() for name in configs)), None)
if root is None:
    raise SystemExit("MyAgent hook configuration not found from " + str(start))
package = root if layout == "." else root / ".agents"
runtime = package / "scripts" / "agent_hooks.py"
if not runtime.is_file() or not (package / "AGENTS.md").is_file():
    raise SystemExit("MyAgent hook runtime missing; run scripts/setup_hooks.py in the project again")
if any(path.is_symlink() for path in [package, package / "scripts", runtime, package / "AGENTS.md"]):
    raise SystemExit("MyAgent hooks refuse symlink paths")
sys.argv = [str(runtime), "--harness", harness, "--event", event, "--project-root", str(root), "--package-root", str(package)]
runpy.run_path(str(runtime), run_name="__main__")
'''
# Each released bootstrap with the interpreter arguments that run it. Version 2
# runs isolated (-I): files in the project directory cannot shadow the standard
# library, and PYTHON* environment variables are ignored.
RELEASES = ((("python3", "-c"), BOOTSTRAP_V1), (("python3", "-I", "-c"), BOOTSTRAP_V2))
RELEASED_BOOTSTRAPS = tuple(text for _, text in RELEASES)
BOOTSTRAP = RELEASED_BOOTSTRAPS[-1]
LEGACY_PROJECT_BOOTSTRAP = BOOTSTRAP_V1.replace('"--project-root"', '"--project"')


def interpreter(base):
    """The interpreter arguments a released bootstrap shipped with; derived legacy text ran as version 1 did."""
    return next((prefix for prefix, text in RELEASES if text == base), RELEASES[0][0])


class HookSetupError(ValueError):
    pass


def jev_bootstrap(base):
    return re.sub(r'"myagent-hooks:(v\d+)"', r'"myagent-jev:\1"', base).replace(
        'harness,event,layout = sys.argv[1:]', 'harness,layout = sys.argv[1:]').replace(
        '"agent_hooks.py"', '"jev_router.py"').replace(
        '"--harness", harness, "--event", event,', '"hook", "--allow-network", "--harness", harness,')


def prompt_bootstrap(base):
    return jev_bootstrap(base).replace('"myagent-jev:', '"myagent-prompt-log:').replace(
        '"jev_router.py"', '"prompt_log.py"').replace('"hook", "--allow-network",', '"hook",')


def prompt_command(harness, layout, base=BOOTSTRAP):
    return " ".join(shlex.quote(part) for part in (*interpreter(base), prompt_bootstrap(base), harness, layout))


def is_prompt_owned(handler, harness):
    return isinstance(handler, dict) and handler.get("command") in {
        prompt_command(harness, layout, base) for layout in (".", ".agents") for base in RELEASED_BOOTSTRAPS}


def reply_bootstrap(base):
    """The prompt logger's reply action: it records the agent's reply from a Stop or afterAgentResponse payload."""
    return prompt_bootstrap(base).replace('"myagent-prompt-log:', '"myagent-reply-log:').replace(
        '[str(runtime), "hook",', '[str(runtime), "reply",')


def reply_command(harness, layout, base=BOOTSTRAP):
    return " ".join(shlex.quote(part) for part in (*interpreter(base), reply_bootstrap(base), harness, layout))


def is_reply_owned(handler, harness):
    return isinstance(handler, dict) and handler.get("command") in {
        reply_command(harness, layout, base) for layout in (".", ".agents") for base in RELEASED_BOOTSTRAPS}


def jev_command(harness, layout, base=BOOTSTRAP):
    return " ".join(shlex.quote(part) for part in (*interpreter(base), jev_bootstrap(base), harness, layout))


def is_jev_owned(handler, harness):
    return isinstance(handler, dict) and handler.get("command") in {
        jev_command(harness, layout, base) for layout in (".", ".agents") for base in RELEASED_BOOTSTRAPS}


def checked_path(path):
    supplied = Path(path)
    if not supplied.is_absolute():
        supplied = Path.cwd() / supplied
    # Check the supplied spelling before normalization so a symlink/.. cannot
    # conceal a traversed link.
    for component in reversed((supplied, *supplied.parents)):
        if component.is_symlink():
            raise HookSetupError("Symlink paths are not supported: {}".format(component))
        if component != supplied and component.exists() and not component.is_dir():
            raise HookSetupError("Path ancestor is not a directory: {}".format(component))
    return Path(os.path.abspath(supplied))


def command(harness, event, layout, bootstrap=BOOTSTRAP):
    return " ".join(shlex.quote(part) for part in (*interpreter(bootstrap), bootstrap, harness, event, layout))


def is_owned(handler, harness):
    if not isinstance(handler, dict):
        return False
    # A marker substring alone is not ownership: only our exact executable and
    # fixed bootstrap with one of the known argument tuples can be replaced.
    return handler.get("command") in {
        command(harness, event, layout, bootstrap)
        for event in EVENTS for layout in (".", ".agents")
        for bootstrap in (LEGACY_PROJECT_BOOTSTRAP, *RELEASED_BOOTSTRAPS)
    }


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise HookSetupError("Duplicate JSON key: {}".format(key))
        result[key] = value
    return result


def invalid_constant(value):
    raise HookSetupError("Invalid JSON constant: {}".format(value))


def read_config(path, harness):
    checked_path(path)
    if not path.exists():
        return None, {"version": 1} if harness == "cursor" else {}, 0o600
    if not stat.S_ISREG(path.lstat().st_mode):
        raise HookSetupError("Config must be a regular file: {}".format(path))
    original = path.read_bytes()
    try:
        data = json.loads(original.decode("utf-8"), object_pairs_hook=unique_object, parse_constant=invalid_constant)
    except (UnicodeError, ValueError) as error:
        raise HookSetupError("Repair invalid hook configuration {}: {}".format(path, error)) from error
    if not isinstance(data, dict):
        raise HookSetupError("Config must contain a JSON object: {}".format(path))
    if harness == "cursor" and (type(data.get("version")) is not int or data["version"] != 1):
        raise HookSetupError("Cursor hooks require version 1: {}".format(path))
    hooks = data.get("hooks", {})
    if not isinstance(hooks, dict):
        raise HookSetupError("Config hooks must be an object: {}".format(path))
    for event, groups in hooks.items():
        if not isinstance(groups, list) or not all(isinstance(item, dict) for item in groups):
            raise HookSetupError("Hook event {} must contain an array of objects: {}".format(event, path))
        if harness != "cursor":
            for group in groups:
                handlers = group.get("hooks")
                if not isinstance(handlers, list) or not all(isinstance(item, dict) for item in handlers):
                    raise HookSetupError("Hook group {} requires a hooks array: {}".format(event, path))
    return original, data, stat.S_IMODE(path.stat().st_mode)


def updated_config(data, harness, layout, remove, jev=False, prompt_log=True):
    # Work on a copy so callers can inspect their original object after planning.
    data = json.loads(json.dumps(data))
    hooks = data.setdefault("hooks", {})
    handlers = [handler for entries in hooks.values() for entry in entries
                for handler in ([entry] if harness == "cursor" else entry["hooks"])]
    # Keep an existing Jev opt-in, but move it to the current bootstrap.
    jev = jev or (not remove and any(is_jev_owned(handler, harness) for handler in handlers))
    def owned(handler):
        # Cursor's beforeSubmitPrompt cannot deliver a suggestion, so a Jev handler there only spends calls.
        return (is_owned(handler, harness) or is_prompt_owned(handler, harness) or is_reply_owned(handler, harness)
                or ((remove or jev or harness == "cursor") and is_jev_owned(handler, harness)))
    for event in list(hooks):
        entries = []
        removed_owned = False
        for entry in hooks[event]:
            if harness == "cursor":
                if not owned(entry):
                    entries.append(entry)
                else:
                    removed_owned = True
            else:
                remaining = [handler for handler in entry["hooks"] if not owned(handler)]
                removed_owned = removed_owned or len(remaining) != len(entry["hooks"])
                if remaining or not entry["hooks"]:
                    entries.append(dict(entry, hooks=remaining))
        if entries:
            hooks[event] = entries
        elif removed_owned:
            del hooks[event]
    if not remove:
        for event in EVENTS:
            name = CURSOR_EVENTS[event] if harness == "cursor" else event
            timeout = 300 if event in ("Stop", "SubagentStop") else 90 if event == "PostToolUse" else 30
            handler = {"type": "command", "command": command(harness, event, layout), "timeout": timeout}
            if harness == "cursor":
                if event in ("Stop", "SubagentStop"):
                    handler["loop_limit"] = 1
                entry = handler
            else:
                handler["statusMessage"] = "MyAgent: " + event
                entry = {"hooks": [handler]}
            hooks.setdefault(name, []).append(entry)
        name = "beforeSubmitPrompt" if harness == "cursor" else "UserPromptSubmit"
        if prompt_log:
            handler = {"type": "command", "command": prompt_command(harness, layout), "timeout": 10}
            # Keep our deterministic logger first, including when preserving Jev.
            entry = handler if harness == "cursor" else {"hooks": [handler]}
            entries = hooks.setdefault(name, [])
            first_jev = next((i for i, item in enumerate(entries)
                              if any(is_jev_owned(h, harness) for h in ([item] if harness == "cursor" else item["hooks"]))), None)
            entries.insert(first_jev if first_jev is not None else len(entries), entry)
            # The agent's reply completes the conversation record: Stop carries it for Claude Code and Codex,
            # and afterAgentResponse for Cursor, whose stop event has no reply text.
            handler = {"type": "command", "command": reply_command(harness, layout), "timeout": 10}
            hooks.setdefault("afterAgentResponse" if harness == "cursor" else "Stop", []).append(
                handler if harness == "cursor" else {"hooks": [handler]})
        if jev and harness != "cursor":
            # A routing call takes about 0.3 s; the host timeout only bounds a hung request.
            handler = {"type": "command", "command": jev_command(harness, layout), "timeout": 15}
            hooks.setdefault(name, []).append(handler if harness == "cursor" else {"hooks": [handler]})
    if not hooks:
        data.pop("hooks")
    return data


@contextmanager
def setup_lock(project):
    lock = checked_path(project / ".myagent-hooks.lock")
    try:
        lock.mkdir(mode=0o700)
    except FileExistsError as error:
        raise HookSetupError("Hook setup lock exists: {}. Inspect it before removing a stale lock.".format(lock)) from error
    try:
        (lock / "owner").write_text("pid={}\n".format(os.getpid()), encoding="utf-8")
        yield
    finally:
        (lock / "owner").unlink(missing_ok=True)
        lock.rmdir()


def select_layout(project, package_root):
    candidates = [checked_path(package_root)] if package_root is not None else [project, project / ".agents"]
    for package in candidates:
        if package not in (project, project / ".agents"):
            raise HookSetupError("Package root must be the project itself or its .agents directory; install the package into the target first.")
        runtime = checked_path(package / "scripts/agent_hooks.py")
        instructions = checked_path(package / "AGENTS.md")
        if runtime.is_file() and instructions.is_file():
            return "." if package == project else ".agents"
    raise HookSetupError("No local scripts/agent_hooks.py runtime found. Install the package into this project first.")


def write_file(path, content, mode):
    with path.open("xb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    path.chmod(mode)


def apply_changes(project, changes):
    """Apply prevalidated bytes transactionally; retain unique original backups."""
    if not changes:
        return None
    stage = Path(tempfile.mkdtemp(prefix=".myagent-hooks-stage-", dir=project))
    backup = None
    created, committed = [], []
    try:
        if any(original is not None for _, original, _, _ in changes):
            prefix = ".myagent-hooks-backup-" + datetime.now().strftime("%Y%m%d-%H%M%S") + "-"
            backup = Path(tempfile.mkdtemp(prefix=prefix, dir=project))
        for index, (destination, original, content, mode) in enumerate(changes):
            write_file(stage / str(index), content, mode)
            if original is not None:
                saved = backup / destination.relative_to(project)
                saved.parent.mkdir(parents=True, exist_ok=True)
                write_file(saved, original, 0o600)
        for index, (destination, original, content, mode) in enumerate(changes):
            checked_path(destination)
            current = destination.read_bytes() if destination.exists() else None
            if current != original:
                raise HookSetupError("Config changed during setup; retry after reviewing: {}".format(destination))
            if not destination.parent.exists():
                destination.parent.mkdir(mode=0o700)
                created.append(destination.parent)
            os.replace(stage / str(index), destination)
            committed.append((destination, original, content, mode))
    except BaseException:
        errors = []
        for index, (destination, original, content, mode) in enumerate(reversed(committed)):
            try:
                checked_path(destination)
                if destination.read_bytes() != content:
                    raise HookSetupError("Config changed after setup wrote it: {}".format(destination))
                if original is None:
                    destination.unlink()
                else:
                    restored = stage / ("restore-" + str(index))
                    write_file(restored, original, mode)
                    os.replace(restored, destination)
            except (OSError, HookSetupError) as error:
                errors.append(str(error))
        for directory in reversed(created):
            try:
                directory.rmdir()
            except OSError:
                pass
        if errors:
            print("Rollback incomplete; recover originals from {}: {}".format(backup, "; ".join(errors)), file=sys.stderr)
        raise
    finally:
        shutil.rmtree(stage)
    return backup


def package_handlers(state, harness):
    """This package's handlers in a read_config result, or [] for a missing or unreadable file."""
    if not isinstance(state, tuple):
        return []
    entries = [entry for items in state[1].get("hooks", {}).values() for entry in items]
    handlers = entries if harness == "cursor" else [handler for entry in entries for handler in entry.get("hooks", [])]
    return [handler for handler in handlers if is_owned(handler, harness) or is_prompt_owned(handler, harness)
            or is_reply_owned(handler, harness) or is_jev_owned(handler, harness)]


def holds_only_jev(state, harness):
    """Whether a readable settings file registers this package's Jev hook and none of its other hooks."""
    handlers = package_handlers(state, harness)
    return bool(handlers) and all(is_jev_owned(handler, harness) for handler in handlers)


def jev_only_config(data, harness, layout, remove):
    """data with this package's Jev hook added at the current bootstrap, or removed, and every other handler kept."""
    data = json.loads(json.dumps(data))
    hooks = data.setdefault("hooks", {})
    for event in list(hooks):
        entries = [dict(entry, hooks=[handler for handler in entry["hooks"] if not is_jev_owned(handler, harness)])
                   for entry in hooks[event]]
        # An entry left empty only because its Jev handler went is dropped, as is an event left with no entries.
        entries = [entry for entry, before in zip(entries, hooks[event]) if entry["hooks"] or not before["hooks"]]
        if entries:
            hooks[event] = entries
        elif hooks[event]:
            del hooks[event]
    if not remove:
        handler = {"type": "command", "command": jev_command(harness, layout), "timeout": 15}
        hooks.setdefault("UserPromptSubmit", []).append({"hooks": [handler]})
    if not hooks:
        data.pop("hooks")
    return data


MARKERS = (b"myagent-hooks:", b"myagent-prompt-log:", b"myagent-reply-log:", b"myagent-jev:")
# Settings files are small; a larger one that does not parse is not scanned.
MAX_SCAN_BYTES = 1 << 20


def holds_package(path, state, harness, markers=MARKERS):
    """Whether a settings file registers this package: True or False, or None when that cannot be told.

    A file that does not parse is judged by its raw bytes, which name the bootstrap markers of every release. Only a
    regular file is read, through a symlink as the host would, without blocking and up to a bound: reading a FIFO
    would block and a device may never end, so anything else counts as unknown."""
    if isinstance(state, tuple):
        return bool(package_handlers(state, harness))
    try:
        if not stat.S_ISREG(path.stat().st_mode):
            return None
        with open(path, "rb", opener=lambda name, flags: os.open(name, flags | getattr(os, "O_NONBLOCK", 0))) as handle:
            # The path may have been replaced since the check above.
            if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
                return None
            data = handle.read(MAX_SCAN_BYTES + 1)
    except FileNotFoundError:
        return False
    except OSError:
        return None
    return None if len(data) > MAX_SCAN_BYTES else any(marker in data for marker in markers)


def ignore_problem(project, relative):
    """Why Git would commit the local settings file, or None when it is safe."""
    try:
        tracked = subprocess.run(["git", "-C", str(project), "ls-files", "--error-unmatch", relative], capture_output=True, timeout=10)
        if tracked.returncode == 0:
            return ("{} is tracked by Git, so collaborators receive these hooks. Run git rm --cached {} and commit that."
                    .format(relative, relative))
        ignored = subprocess.run(["git", "-C", str(project), "check-ignore", "-q", relative], capture_output=True, timeout=10)
        if ignored.returncode in (0, 1):
            return None if ignored.returncode == 0 else NOT_IGNORED.format(relative, relative)
    except (OSError, subprocess.SubprocessError):
        pass
    # Outside a Git repository, or without Git: look for the rule the installer writes, or the whole folder.
    ignore = project / ".gitignore"
    lines = ignore.read_text(encoding="utf-8", errors="replace").splitlines() if ignore.is_file() and not ignore.is_symlink() else []
    folder = relative.split("/", 1)[0]
    covered = {"/" + relative, relative, folder, folder + "/", "/" + folder, "/" + folder + "/"}
    return None if any(line.strip() in covered for line in lines) else NOT_IGNORED.format(relative, relative)


NOT_IGNORED = "{} is not ignored by Git here. Add /{} to .gitignore, or a commit opts every collaborator in to these hooks."


def setup(project, harness="all", package_root=None, remove=False, jev=False, prompt_log=True, local=False, warnings=None,
          strict=False, jev_local=False):
    """Register or remove this package's hooks. With strict, removal stops instead of warning while a settings file
    that cannot be read may still register them, as uninstall must before it removes the runtime they call.

    jev_local registers only the Jev hook, in Claude Code's local settings, and leaves the package's other hooks where
    they are, as in a project whose committed settings already register them; with remove, it removes only that hook."""
    project = checked_path(project)
    if not project.is_dir():
        raise HookSetupError("Project must be an existing directory: {}".format(project))
    if harness not in (*HARNESSES, "all"):
        raise HookSetupError("Unsupported harness: {}".format(harness))
    if jev_local and harness != "claude":
        raise HookSetupError("--jev-local registers the Jev hook in Claude Code's local settings; use it with --harness claude.")
    if jev_local and local:
        raise HookSetupError("--jev-local keeps the shared hooks where they are and --local moves them into the local file; use one.")
    selected = HARNESSES if harness == "all" else (harness,)
    with setup_lock(project):
        layout = "." if remove else select_layout(project, package_root)
        if not remove and prompt_log and not jev_local:
            root = project if layout == "." else project / ".agents"
            if not checked_path(root / "scripts/prompt_log.py").is_file():
                raise HookSetupError("Install the prompt log helper before registering project hooks, or pass --no-prompt-log.")
        if (jev or jev_local) and not remove:
            root = project if layout == "." else project / ".agents"
            if not checked_path(root / "scripts/jev_router.py").is_file():
                raise HookSetupError("Install the Jev component in this project (setup.sh --with-jev) before registering its hook.")
        changes = []
        warnings = [] if warnings is None else warnings

        def plan(path, state, removing, with_jev, only_jev=False):
            original, data, mode = state
            if removing and original is None:
                return
            updated = (jev_only_config(data, host, layout, removing) if only_jev
                       else updated_config(data, host, layout, removing, with_jev, prompt_log))
            if updated != data:
                changes.append((path, original, (json.dumps(updated, indent=2, ensure_ascii=False) + "\n").encode("utf-8"), mode))
        for host in selected:
            if host not in LOCAL_CONFIGS:
                plan(project / CONFIGS[host], read_config(project / CONFIGS[host], host), remove, jev)
                continue
            # Registration targets one file per host. For Claude, the other settings file loses this
            # package's handlers so none run twice.
            shared, private = project / CONFIGS[host], project / LOCAL_CONFIGS[host]
            states = {}
            for path in (shared, private):
                try:
                    states[path] = read_config(path, host)
                except (HookSetupError, OSError, UnicodeError) as error:
                    states[path] = HookSetupError("{} cannot be read ({})".format(path.relative_to(project).as_posix(), error))
            holds = {path: holds_package(path, states[path], host) for path in (shared, private)}
            # A local file that registers only the Jev hook sits beside the shared registration rather than replacing it.
            only_jev = isinstance(states[private], tuple) and holds_only_jev(states[private], host)
            shared_jev = any(is_jev_owned(handler, host) for handler in package_handlers(states[shared], host))
            both = "Both {} and {} register this package's hooks. Run setup again with --local to keep only the local registration, or with --remove to clear both.".format(CONFIGS[host], LOCAL_CONFIGS[host])
            if jev_local:
                # --jev-local changes only the local file, and never the shared one.
                if isinstance(states[private], HookSetupError):
                    if not remove:
                        raise states[private]
                    if holds[private] is not False:
                        warnings.append("{}; remove the MyAgent Jev handler from it by hand.".format(states[private]))
                    continue
                if remove:
                    plan(private, states[private], True, False, only_jev=True)
                    continue
                if holds[shared] and package_handlers(states[private], host) and not only_jev:
                    raise HookSetupError(both)
                if shared_jev:
                    # The shared settings already run Jev; a local copy would call it twice per prompt.
                    plan(private, states[private], True, False, only_jev=True)
                    warnings.append("{} already registers the Jev hook, so none was added to {}.".format(CONFIGS[host], LOCAL_CONFIGS[host]))
                else:
                    plan(private, states[private], False, False, only_jev=True)
                    if isinstance(states[shared], HookSetupError) and holds[shared] is not False:
                        warnings.append("{}; if it registers a MyAgent Jev handler, remove that by hand, or Jev runs twice.".format(states[shared]))
                problem = ignore_problem(project, Path(LOCAL_CONFIGS[host]).as_posix())
                if problem:
                    warnings.append(problem)
                continue
            if remove:
                for path in (shared, private):
                    if isinstance(states[path], tuple):
                        plan(path, states[path], True, False)
                    elif holds[path] is not False and strict:
                        raise HookSetupError("{}; it may still register this package's hooks, which fail once the package is "
                                             "removed. Repair the file or remove those handlers by hand, then try again.".format(states[path]))
                    elif holds[path] is not False:
                        warnings.append("{}; remove any MyAgent handlers from it by hand.".format(states[path]))
                continue
            if not local:
                # A --local registration is remembered. Without it, setup never guesses: an unreadable local file may
                # hold that registration, and writing the shared file instead would opt collaborators in by a commit.
                if isinstance(states[private], HookSetupError) and holds[private] is not False:
                    raise HookSetupError("{}. It may hold your --local registration, so setup will not write the shared "
                                         "settings instead; fix or remove it, then run setup again.".format(states[private]))
                if holds[private] and holds[shared] and not only_jev:
                    raise HookSetupError(both)
            use_local = local or (bool(holds[private]) and not only_jev)
            target, other = (private, shared) if use_local else (shared, private)
            if isinstance(states[target], HookSetupError):
                raise states[target]
            # A local Jev-only registration stays local: the other hooks go to the shared file, and --jev keeps Jev local.
            keep_local_jev = only_jev and not use_local
            # A Jev opt-in moves from the shared file into the local one, never the other way into committed settings.
            with_jev = (jev and not keep_local_jev) or (use_local and any(is_jev_owned(handler, host) for handler in package_handlers(states[other], host)))
            plan(target, states[target], False, with_jev)
            if keep_local_jev:
                # Keep the local Jev hook on the current bootstrap, or drop it when the shared settings run Jev already.
                plan(private, states[private], shared_jev, False, only_jev=True)
                if shared_jev:
                    warnings.append("{} registers the Jev hook, so the copy in {} was removed.".format(CONFIGS[host], LOCAL_CONFIGS[host]))
            elif isinstance(states[other], tuple):
                plan(other, states[other], True, False)
            elif holds[other] is not False:
                warnings.append("{}; remove any MyAgent handlers from it by hand, or they run twice.".format(states[other]))
            if use_local or keep_local_jev:
                problem = ignore_problem(project, Path(LOCAL_CONFIGS[host]).as_posix())
                if problem:
                    warnings.append(problem)
        backup = apply_changes(project, changes)
    return [path for path, _, _, _ in changes], backup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path, nargs="?", default=Path.cwd(), help="existing project directory (default: current directory)")
    parser.add_argument("--harness", choices=("all", *HARNESSES), default="all")
    parser.add_argument("--package-root", type=Path, help="package at the project root or project/.agents (auto-detected by default)")
    parser.add_argument("--remove", action="store_true", help="remove only exact MyAgent hook registrations; retain other settings")
    parser.add_argument("--jev", action="store_true", help="also register optional Jev routing; disabled until configured with a key, enabled flag, and positive cap")
    parser.add_argument("--no-prompt-log", action="store_true", help="register lifecycle hooks without the local prompt and reply logger (removes an existing one)")
    parser.add_argument("--local", action="store_true", help="for Claude Code, write .claude/settings.local.json instead of the shared .claude/settings.json")
    parser.add_argument("--jev-local", action="store_true", help="for Claude Code, register only the Jev hook in .claude/settings.local.json and leave "
                        "the other hooks where they are; with --remove, remove only that hook")
    args = parser.parse_args()
    if sys.version_info < (3, 9):
        parser.error("Python 3.9 or newer is required")
    signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(128 + signum))
    warnings = []
    try:
        changes, backup = setup(args.project, args.harness, args.package_root, args.remove, args.jev,
                                not args.no_prompt_log, args.local, warnings, jev_local=args.jev_local)
    except (OSError, ValueError) as error:
        print("Hook setup failed: {}".format(error), file=sys.stderr)
        return 1
    for warning in warnings:
        print("Warning: " + warning, file=sys.stderr)
    if changes:
        print("Updated {} hook configuration file(s).".format(len(changes)))
    else:
        print("Hook configuration already current; nothing changed.")
    if backup:
        print("Original configuration backup: {}".format(backup))
    if not args.remove:
        if args.jev_local:
            try:
                local = read_config(checked_path(args.project) / LOCAL_CONFIGS["claude"], "claude")
            except (OSError, ValueError):
                local = None
            if any(is_jev_owned(handler, "claude") for handler in package_handlers(local, "claude")):
                print("The Jev hook is in .claude/settings.local.json. It calls TypeSafe only when the project's .env enables Jev.")
        elif not args.no_prompt_log:
            print("Conversation logging is on: everyone who trusts these hooks records their prompts and the agent's replies in prompt-log.md. "
                  "Pass --no-prompt-log to decline.")
        print("Review project hooks in each harness and complete its native trust/activation flow. No global settings were changed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
