#!/usr/bin/env python3
"""Install the package and harness entry points with backups and error rollback."""
import argparse
from datetime import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile


HARNESSES = ("all", "portable", "codex", "claude", "gemini", "cursor", "copilot", "antigravity")
ADAPTERS = {
    "portable": "AGENTS.md",
    "codex": "AGENTS.md",
    "claude": "CLAUDE.md",
    "gemini": "GEMINI.md",
    "cursor": ".cursor/rules/myagent.mdc",
    "copilot": ".github/copilot-instructions.md",
}
BEGIN = "<!-- myagent:begin -->"
END = "<!-- myagent:end -->"
POINTER = (
    BEGIN + "\n"
    "Before working, read the project-root `.agents/AGENTS.md` once per session "
    "and follow its instructions. Read it again if it changes.\n"
    "Resolve relative paths in that configuration against the project-root "
    "`.agents/` directory. Other harness entry points reference this same "
    "configuration; do not load it repeatedly.\n" + END
)
MANIFEST = ".myagent-manifest.json"
INSTALLER_FILES = (MANIFEST, ".version")
SKIP_DIRS = {"__pycache__", "node_modules", ".venv", ".git"}
# Optional parts of the package. A project gets them only when selected, and a
# selection persists across updates through the manifest.
COMPONENTS = {
    "jev": ("scripts/jev_router.py", "scripts/evaluate_jev.py", ".env.example", "evaluations/jev/cases.jsonl"),
}
LOCAL_IGNORE = (
    "/prompt-log.md", "/.prompt-log.lock/", "/.prompt-log.flock", "/.agent-usage.jsonl", "/.agent-usage.lock", "/.agent-usage-*.tmp", "/budget-report.md", "/PROGRESS.md",
    "/.agents-backup-*/", "/.agents-staging-*/", "/.myagent-install.lock/", "/.myagent-hooks.lock/",
    "/.myagent-hooks-backup-*/", "/.myagent-hooks-stage-*/", "/.agents/**/__pycache__/", "/.agent-evidence.jsonl", "/.agent-evidence.lock",
    "/.agents/**/node_modules/", "/.claude/settings.local.json",
)


class InstallError(ValueError):
    pass


def checked_path(path):
    """Refuse symlink components before resolving the supplied path."""
    supplied = Path(path)
    if not supplied.is_absolute():
        supplied = Path.cwd() / supplied
    for component in reversed((supplied, *supplied.parents)):
        if component.is_symlink():
            raise InstallError("Symlink paths are not supported: {}".format(component))
        if component != supplied and component.exists() and not component.is_dir():
            raise InstallError("Path ancestor is not a directory: {}".format(component))
    return Path(os.path.abspath(supplied))


def check_tree(root):
    checked_path(root)
    if not root.exists():
        return
    for path in (root, *root.rglob("*")):
        if skipped(root, path):
            continue
        mode = path.lstat().st_mode
        if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
            raise InstallError("Only regular files and directories are supported: {}".format(path))


def skipped(root, path):
    """Dependency and cache folders a skill's own tools create; the validator skips the same names."""
    return bool(SKIP_DIRS & set(path.relative_to(root).parts))


def check_project_tree(root):
    """The project's .agents may hold its own symlinks (hosts such as Codex
    follow symlinked skills), but never device, FIFO, or socket files."""
    checked_path(root)
    if not root.exists():
        return
    for directory, children, names in os.walk(root, followlinks=False):
        for name in children + names:
            path = Path(directory, name)
            mode = path.lstat().st_mode
            if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode) or stat.S_ISLNK(mode)):
                raise InstallError("Only regular files, directories, and symlinks are supported: {}".format(path))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_new(path, text):
    """Replace an installer-owned file with a new regular file, never writing through a link at its path."""
    if path.is_symlink() or path.exists():
        path.unlink()
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o644)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        stream.write(text)


def shareable_path(path):
    """A path for files a project may commit: under the home directory it starts with ~ and omits the user name."""
    try:
        return "~/" + Path(path).relative_to(Path.home()).as_posix()
    except (ValueError, RuntimeError, KeyError):
        return str(path)


def tree_contents(root):
    """Content of a package tree, ignoring the per-deployment timestamp file.

    Symlinks are recorded by target and never followed.
    """
    if not root.exists():
        return None
    contents = {}
    for directory, children, names in os.walk(root, followlinks=False):
        for name in children + names:
            path = Path(directory, name)
            relative = path.relative_to(root).as_posix()
            if relative == ".version":
                continue
            if path.is_symlink():
                contents[relative] = "link:" + os.readlink(path)
            else:
                contents[relative] = digest(path) if path.is_file() else None
    return contents


def symlink_component(root, relative):
    """The first symlink on the way from root to root/relative, if any."""
    current = root
    for part in PurePosixPath(relative).parts:
        current = current / part
        if current.is_symlink():
            return current
    return None


def profile(path):
    specification = importlib.util.spec_from_file_location(
        "myagent_profile_validator", Path(__file__).with_name("validate.py")
    )
    validator = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(validator)
    return validator.parse_profile(path)


def package_files(source, components=()):
    """Every file the package installs. Unselected component files are still
    checked, so a symlink in the source is refused either way."""
    optional = {name for component, names in COMPONENTS.items() if component not in components for name in names}
    files = []
    for name in ("rules", "skills", "scripts"):
        directory = source / name
        if not directory.is_dir():
            raise InstallError("Missing package directory: {}".format(directory))
        check_tree(directory)
        files.extend(
            path.relative_to(source) for path in directory.rglob("*")
            if path.is_file() and not skipped(directory, path) and path.suffix != ".pyc"
        )
    for name in ("AGENTS.md", "RULES-INDEX.md", "autonomy-config.md", "HARNESS.md", "SECURITY-CHECKS.md", "resources.json", "setup.sh", "validate.sh", "VERSION"):
        path = source / name
        checked_path(path)
        if not path.is_file():
            raise InstallError("Missing package file: {}".format(path))
        files.append(Path(name))
    for name in ("README.md", "SETUP.md", "WORKFLOW-CHECKS.md", "HOOKS.md", "JEV.md", "USAGE.md", "SESSIONS.md", ".env.example", "evaluations/jev/cases.jsonl",
                 "THIRD_PARTY_NOTICES.md"):
        path = source / name
        checked_path(path)
        if not path.exists():
            continue
        if not path.is_file():
            raise InstallError("Package documentation must be a regular file: {}".format(path))
        files.append(Path(name))
    # License texts travel with the imported skills; the validator requires them when a skill declares an upstream.
    licenses = source / "licenses"
    checked_path(licenses)
    if licenses.exists():
        check_tree(licenses)
        files.extend(path.relative_to(source) for path in licenses.rglob("*") if path.is_file() and not skipped(licenses, path))
    return sorted(relative for relative in files if relative.as_posix() not in optional)


def safe_relative(name):
    relative = PurePosixPath(name)
    return isinstance(name, str) and not (relative.is_absolute() or ".." in relative.parts or relative.as_posix() != name
                                          or name == "." or "\\" in name or any(ord(char) < 32 for char in name))


def previous_manifest(agents):
    """The installed manifest as {"files", "components", "created"}.

    Version 1 recorded files only; a version 1 install that included Jev files
    keeps the Jev component, so an update never silently drops it.
    """
    path = agents / MANIFEST
    if not path.exists():
        return {"files": {}, "components": [], "created": []}
    try:
        def unique_object(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("duplicate manifest key: " + key)
                result[key] = value
            return result

        data = json.loads(path.read_text(), object_pairs_hook=unique_object)
        keys = {1: {"version", "files"}, 2: {"version", "files", "components", "created"}}
        if not isinstance(data, dict) or data.get("version") not in keys or set(data) != keys[data["version"]] or not isinstance(data.get("files"), dict):
            raise ValueError("unsupported manifest")
        for name, checksum in data["files"].items():
            if not safe_relative(name) or not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
                raise ValueError("invalid file entry")
        if data["version"] == 1:
            components = [name for name, files in COMPONENTS.items() if any(item in data["files"] for item in files)]
            return {"files": data["files"], "components": components, "created": []}
        if (not isinstance(data["components"], list) or any(item not in COMPONENTS for item in data["components"])
                or not isinstance(data["created"], list) or not all(safe_relative(item) for item in data["created"])):
            raise ValueError("invalid components or created entries")
        return {"files": data["files"], "components": sorted(set(data["components"])), "created": sorted(set(data["created"]))}
    except (ValueError, AttributeError) as error:
        raise InstallError("Repair the invalid installation manifest {}: {}".format(path, error)) from error


def load_hook_setup(source):
    """The package's own hook registrar, used to detect and remove registrations."""
    path = source / "scripts/setup_hooks.py"
    if not path.is_file():
        return None
    specification = importlib.util.spec_from_file_location("myagent_install_hooks", path)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def jev_hook_files(source, target):
    """Hook configurations that still register the Jev router for this project."""
    hooks = load_hook_setup(source)
    if hooks is None:
        return []
    found = []
    for host in hooks.HARNESSES:
        for relative in {hooks.CONFIGS[host], getattr(hooks, "LOCAL_CONFIGS", {}).get(host)} - {None}:
            path = target / relative
            if path.is_symlink() or not path.is_file():
                # The host reads through a link; judge such a file, or one that cannot be read, by the Jev marker in it.
                if path.is_symlink() and hooks.holds_package(path, None, host, markers=(b"myagent-jev:",)) is not False:
                    found.append(relative)
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                if hooks.holds_package(path, None, host, markers=(b"myagent-jev:",)) is not False:
                    found.append(relative)
                continue
            groups = data.get("hooks", {}) if isinstance(data, dict) else {}
            for entries in (groups.values() if isinstance(groups, dict) else []):
                for entry in entries if isinstance(entries, list) else []:
                    handlers = [entry] if host == "cursor" else (entry.get("hooks", []) if isinstance(entry, dict) else [])
                    if any(hooks.is_jev_owned(handler, host) for handler in handlers):
                        found.append(relative)
    return sorted(set(found))


def adapter_content(path):
    content = path.read_bytes().decode("utf-8") if path.exists() else ""
    if content.count(BEGIN) != content.count(END) or content.count(BEGIN) > 1:
        raise InstallError("Repair the incomplete or duplicated myagent block in {}".format(path))
    if BEGIN in content:
        start, finish = content.index(BEGIN), content.index(END)
        if finish < start:
            raise InstallError("Repair the reversed myagent markers in {}".format(path))
        content = content[:start] + POINTER + content[finish + len(END):]
    else:
        content += ("\n" if content.endswith("\n") else "\n\n") if content else ""
        content += POINTER + "\n"
    if path.suffix == ".mdc":
        lines = content.splitlines()
        if lines and lines[0] == "---":
            close = next((index for index, line in enumerate(lines[1:], 1) if line == "---"), None)
            declarations = [line for line in lines[1:close] if re.match(r"^alwaysApply\s*:", line)]
            if close is None or declarations != ["alwaysApply: true"]:
                raise InstallError("Existing Cursor entry point must have exactly one 'alwaysApply: true' field: {}".format(path))
        else:
            content = "---\nalwaysApply: true\n---\n\n" + content
    return content


def ensure_parents(path, project, created):
    missing = []
    parent = path.parent
    while parent != project and not parent.exists():
        missing.append(parent)
        parent = parent.parent
    for directory in reversed(missing):
        checked_path(directory)
        directory.mkdir()
        created.append(directory)


def install(source, target, harness, components=None, adopt=False):
    """Install or update the package. components=None keeps the previous selection."""
    source, target = checked_path(source), checked_path(target)
    if not target.is_dir():
        raise InstallError("Project must be an existing directory: {}".format(target))
    if source == target or source in target.parents or target in source.parents:
        raise InstallError("Package and project directories must not overlap.")
    if components is not None and set(components) - set(COMPONENTS):
        raise InstallError("Unknown component: {}".format(", ".join(sorted(set(components) - set(COMPONENTS)))))
    package_files(source, tuple(COMPONENTS))
    checked_path(source / "validate.sh")
    print("Validating source package...", flush=True)
    subprocess.run(["bash", str(source / "validate.sh")], check=True, cwd=source)
    source_profile = profile(source / "autonomy-config.md")
    if harness not in HARNESSES:
        raise InstallError("Unknown harness: {}".format(harness))
    adapter_names = sorted(set(ADAPTERS.values())) if harness == "all" else sorted({"AGENTS.md", *([ADAPTERS[harness]] if harness in ADAPTERS else [])})
    destinations = [target / ".agents", *(target / name for name in adapter_names)]
    for destination in destinations:
        checked_path(destination)
        if destination.exists() and not (destination.is_dir() if destination.name == ".agents" else destination.is_file()):
            raise InstallError("Unexpected destination type: {}".format(destination))
    lock = checked_path(target / ".myagent-install.lock")
    try:
        lock.mkdir()
    except FileExistsError as error:
        raise InstallError("Installation lock exists: {}. If no installer is running, inspect and remove this stale lock before retrying.".format(lock)) from error
    stage = None
    backup = None
    prompt_guard = None
    new_prompt_log = None
    created_flock = None
    try:
        (lock / "owner").write_text("pid={}\n".format(os.getpid()))
        agents = target / ".agents"
        check_project_tree(agents)
        # The installer writes these two files itself; a planted link would redirect that write outside the project.
        for name in INSTALLER_FILES:
            if (agents / name).is_symlink():
                raise InstallError("An installer file inside .agents is a symlink; remove it before installing: {}".format(agents / name))
        previous = previous_manifest(agents)
        old_manifest = previous["files"]
        first_install = not (agents / MANIFEST).exists()
        selected = sorted(previous["components"] if components is None else set(components))
        if "jev" in previous["components"] and "jev" not in selected:
            registered = jev_hook_files(source, target)
            if registered:
                # Removing the router while a hook still calls it would fail every prompt.
                raise InstallError("Jev hooks are still registered in {}. Run python3 -B .agents/scripts/setup_hooks.py --harness all --remove . "
                                   "and register again without --jev (for a hook added with --jev-local, run setup_hooks.py --harness "
                                   "claude --jev-local --remove . instead), then retry --without-jev.".format(", ".join(registered)))
        files = package_files(source, selected)
        for relative in sorted({*(path.as_posix() for path in files), *old_manifest}):
            link = symlink_component(agents, relative)
            if link is not None:
                raise InstallError("A package path inside .agents is a symlink; replace it with a regular file before updating: {}".format(link))
        pre_existing = []
        if first_install and agents.exists():
            # Hosts such as Codex, Gemini CLI, and Antigravity read .agents/ natively; never replace their files silently.
            pre_existing = [".agents/" + path.as_posix() for path in files
                            if (agents / path).is_file() and digest(agents / path) != digest(source / path)]
            if pre_existing and not adopt:
                raise InstallError("Refusing to replace pre-existing project files in .agents/ (rerun with --adopt to back them up and replace them): "
                                   + ", ".join(pre_existing[:20]) + (" and more" if len(pre_existing) > 20 else ""))
        chosen_profile = profile(agents / "autonomy-config.md") if (agents / "autonomy-config.md").exists() else source_profile
        stage = Path(tempfile.mkdtemp(prefix=".agents-staging-", dir=target))
        staged_agents = stage / ".agents"
        if agents.exists():
            shutil.copytree(agents, staged_agents, symlinks=True)
        else:
            staged_agents.mkdir()
        retired = []
        for name in sorted(set(old_manifest) - {relative.as_posix() for relative in files}):
            staged = staged_agents / name
            if not staged.exists():
                continue
            if not staged.is_file():
                raise InstallError("Retired package file is now a directory; reconcile it before updating: {}".format(agents / name))
            locally_modified = digest(staged) != old_manifest[name]
            staged.unlink()
            retired.append((name, locally_modified))
            parent = staged.parent
            while parent != staged_agents:
                try:
                    parent.rmdir()
                except OSError:
                    break
                parent = parent.parent
        modified = []
        checksums = {}
        for relative in files:
            original, existing, staged = source / relative, agents / relative, staged_agents / relative
            if existing.is_file() and not first_install:
                baseline = old_manifest.get(relative.as_posix(), digest(original))
                if digest(existing) != baseline:
                    modified.append(".agents/" + relative.as_posix())
            staged.parent.mkdir(parents=True, exist_ok=True)
            if staged.exists() and not staged.is_file():
                raise InstallError("Package file conflicts with a project directory: {}".format(existing))
            shutil.copy2(original, staged)
            if relative == Path("autonomy-config.md"):
                content = staged.read_text(encoding="utf-8")
                content = re.sub(r"^active_profile:.*$", "active_profile: " + chosen_profile, content, count=1, flags=re.MULTILINE)
                staged.write_text(content, encoding="utf-8")
                profile(staged)
            checksums[relative.as_posix()] = digest(staged)
        changes = []
        # Stage local records and ignore rules in the same rollback transaction.
        # Existing prompt history is project-owned and never replaced.
        helper = source / "scripts/prompt_log.py"
        if helper.is_file():
            log = checked_path(target / "prompt-log.md")
            if log.exists() and not log.is_file():
                raise InstallError("Prompt log must be a regular file.")
            if not log.exists():
                specification = importlib.util.spec_from_file_location("myagent_install_prompt_log", helper)
                logger = importlib.util.module_from_spec(specification)
                specification.loader.exec_module(logger)
                # Serialize with native prompt writers through commit/rollback.
                # Recheck after acquiring the lock: a hook may have created it.
                flock_file = target / getattr(logger, "FLOCK_NAME", ".prompt-log.flock")
                created_flock = None if flock_file.exists() else flock_file
                guard = logger.locked(target)
                guard.__enter__()
                prompt_guard = guard
                if not log.exists():
                    logger.ensure_log(stage)
                    new_prompt_log = log
                    changes.append(log)
        ignore = checked_path(target / ".gitignore")
        if ignore.exists() and not ignore.is_file():
            raise InstallError("Project .gitignore must be a regular file.")
        original = ignore.read_text(encoding="utf-8") if ignore.exists() else ""
        missing = [pattern for pattern in LOCAL_IGNORE if pattern not in original.splitlines()]
        if missing:
            addition = ("" if not original or original.endswith("\n") else "\n") + "\n# Local agent records, backups, and locks\n" + "\n".join(missing) + "\n"
            (stage / ".gitignore").write_text(original + addition, encoding="utf-8")
            if ignore.exists():
                shutil.copymode(ignore, stage / ".gitignore")
            changes.append(ignore)
        for name in adapter_names:
            destination = target / name
            content = adapter_content(destination)
            original_content = destination.read_bytes().decode("utf-8") if destination.exists() else ""
            if not destination.exists() or original_content != content:
                if BEGIN in original_content and original_content[original_content.index(BEGIN):original_content.index(END) + len(END)] != POINTER:
                    modified.append(name + " (managed block)")
                staged = stage / name
                staged.parent.mkdir(parents=True, exist_ok=True)
                staged.write_bytes(content.encode("utf-8"))
                if destination.exists():
                    shutil.copymode(destination, staged)
                changes.append(destination)
        # Files this installer created, so --uninstall can remove them and keep the rest.
        created_files = {name for name in previous["created"] if (target / name).exists()}
        created_files.update(path.relative_to(target).as_posix() for path in changes if not path.exists())
        write_new(staged_agents / MANIFEST, json.dumps({"version": 2, "files": checksums, "components": selected,
                                                        "created": sorted(created_files)}, indent=2) + "\n")
        version = (source / "VERSION").read_text().strip() if (source / "VERSION").is_file() else "unknown"
        write_new(staged_agents / ".version", version + "\nDeployed from: {}\nDeployed on: {}\n".format(
            shareable_path(source), datetime.now().isoformat(timespec="seconds")))
        # An unchanged package is left in place: no swap, no backup.
        if tree_contents(staged_agents) != tree_contents(agents):
            changes.insert(0, agents)
        if any(path.exists() for path in changes):
            prefix = ".agents-backup-" + datetime.now().strftime("%Y%m%d-%H%M%S") + "-"
            backup = Path(tempfile.mkdtemp(prefix=prefix, dir=target))
        records, created = [], []
        try:
            for destination in changes:
                checked_path(destination)
                ensure_parents(destination, target, created)
                if destination == new_prompt_log:
                    # A writer that does not use our lock may still have created
                    # history after staging. Never replace that project's file.
                    try:
                        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
                    except FileExistsError:
                        checked_path(destination)
                        if not destination.is_file():
                            raise InstallError("Prompt log must be a regular file.")
                        continue
                    record = [destination, None, True]
                    records.append(record)
                    with os.fdopen(fd, "wb") as output, (stage / destination.relative_to(target)).open("rb") as source_log:
                        shutil.copyfileobj(source_log, output)
                        output.flush()
                        os.fsync(output.fileno())
                    continue
                saved = None
                if destination.exists():
                    saved = backup / destination.relative_to(target)
                    saved.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(destination, saved)
                record = [destination, saved, False]
                records.append(record)
                os.replace(stage / destination.relative_to(target), destination)
                record[2] = True
        except BaseException:
            rollback_errors = []
            for destination, saved, installed in reversed(records):
                try:
                    if installed:
                        checked_path(destination)
                        if destination == new_prompt_log:
                            destination.unlink()
                        else:
                            os.replace(destination, stage / destination.relative_to(target))
                    if saved is not None:
                        os.replace(saved, destination)
                except (OSError, InstallError) as error:
                    rollback_errors.append(str(error))
            for directory in reversed(created):
                try:
                    directory.rmdir()
                except OSError:
                    pass
            if created_flock is not None and not (target / "prompt-log.md").exists():
                # This run created the logger's lock file for a log it never kept.
                created_flock.unlink(missing_ok=True)
            if backup is not None:
                # Restored originals leave the backup empty; rmdir keeps any leftovers.
                for directory in [*sorted((p for p in backup.rglob("*") if p.is_dir()), reverse=True), backup]:
                    try:
                        directory.rmdir()
                    except OSError:
                        pass
            if rollback_errors:
                print("Rollback incomplete. Recover original files from {}. Errors: {}".format(backup, "; ".join(rollback_errors)), file=sys.stderr)
            raise
        if not changes:
            print("Agent configuration already current in {} (harness: {}, profile: {}); nothing changed.".format(agents, harness, chosen_profile))
            return
        print("Installed agent configuration in {} (harness: {}, profile: {}, components: {}).".format(
            agents, harness, chosen_profile, ", ".join(selected) or "none"))
        if backup:
            print("Backup of replaced destinations: {}".format(backup))
        if pre_existing:
            print("Replaced pre-existing project files (originals are in the backup):")
            for name in pre_existing:
                print("  " + name)
        if modified:
            print("Locally edited package files were backed up before replacement:")
            for name in modified:
                print("  " + name)
        if retired:
            print("Retired package files removed from the active installation; originals are in the backup:")
            for name, locally_modified in retired:
                print("  .agents/" + name + (" (locally modified; review backup)" if locally_modified else ""))
        print("Project-local additions and the selected autonomy profile were preserved; package policy was refreshed.")
    finally:
        try:
            if stage is not None:
                shutil.rmtree(stage)
            owner = lock / "owner"
            if owner.exists():
                owner.unlink()
            lock.rmdir()
        finally:
            if prompt_guard is not None:
                prompt_guard.__exit__(None, None, None)


def strip_block(content):
    """Remove the managed block and the blank line the installer put before it."""
    start, finish = content.index(BEGIN), content.index(END) + len(END)
    before, after = content[:start].rstrip("\n"), content[finish:].lstrip("\n")
    return (before + "\n" if before else "") + after


def uninstall(source, target):
    """Remove the package from a project.

    Hooks go first, because a registered hook whose runtime is gone fails on
    every prompt. Prompt history, usage records, ignore rules, and earlier
    backups stay; .agents/ moves into a final backup instead of being deleted.
    """
    source, target = checked_path(source), checked_path(target)
    agents = target / ".agents"
    if not (agents / MANIFEST).is_file():
        raise InstallError("No installed package found in {}; nothing to uninstall.".format(agents))
    check_project_tree(agents)
    previous = previous_manifest(agents)
    lock = checked_path(target / ".myagent-install.lock")
    try:
        lock.mkdir()
    except FileExistsError as error:
        raise InstallError("Installation lock exists: {}. If no installer is running, inspect and remove this stale lock before retrying.".format(lock)) from error
    removed, edited, skipped = [], [], []
    try:
        (lock / "owner").write_text("pid={}\n".format(os.getpid()))
        hooks = load_hook_setup(source)
        hook_warnings = []
        hook_files = hooks.setup(target, "all", remove=True, warnings=hook_warnings, strict=True)[0] if hooks else []
        for warning in hook_warnings:
            print("Warning: " + warning, file=sys.stderr)
        backup = Path(tempfile.mkdtemp(prefix=".agents-backup-" + datetime.now().strftime("%Y%m%d-%H%M%S") + "-",
                                       suffix="-uninstall", dir=target))
        for name in sorted(set(ADAPTERS.values())):
            path = checked_path(target / name)
            if not path.is_file():
                continue
            content = path.read_bytes().decode("utf-8")
            if BEGIN not in content and END not in content:
                continue
            if content.count(BEGIN) != 1 or content.count(END) != 1 or content.index(END) < content.index(BEGIN):
                skipped.append(name)
                continue
            saved = backup / name
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, saved)
            remaining = strip_block(content)
            if name in previous["created"] and remaining.strip() in {"", "---\nalwaysApply: true\n---"}:
                path.unlink()
                removed.append(name)
                parent = path.parent
                while parent != target:
                    try:
                        parent.rmdir()
                    except OSError:
                        break
                    parent = parent.parent
            else:
                path.write_bytes(remaining.encode("utf-8"))
                edited.append(name)
        os.replace(agents, backup / ".agents")
    finally:
        owner = lock / "owner"
        if owner.exists():
            owner.unlink()
        lock.rmdir()
    print("Removed the agent configuration package from {}.".format(target))
    if hook_files:
        print("Removed this package's hook registrations from: " + ", ".join(path.relative_to(target).as_posix() for path in hook_files))
    if removed:
        print("Deleted entry points the installer created: " + ", ".join(removed))
    if edited:
        print("Removed the managed block from: " + ", ".join(edited))
    if skipped:
        print("Left for manual repair (incomplete or duplicated managed block): " + ", ".join(skipped))
    print("Moved .agents/ and the original entry points to {}; delete it when you no longer need it.".format(backup))
    print("Kept project records: prompt-log.md, local usage records, .gitignore rules, and earlier backups.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--harness", choices=HARNESSES, default="all", help="entry points to install (default: all)")
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--with-jev", dest="jev", action="store_const", const=True,
                           help="also install the optional Jev router, its evaluator, and its .env template")
    selection.add_argument("--without-jev", dest="jev", action="store_const", const=False,
                           help="remove a previously installed Jev component")
    parser.add_argument("--adopt", action="store_true",
                        help="on a first install, back up and replace pre-existing files in .agents/")
    parser.add_argument("--uninstall", action="store_true",
                        help="remove hook registrations, managed entry-point blocks, and .agents/ (moved to a backup)")
    parser.add_argument("project", type=Path, help="existing project directory; package/project overlap and symlinks are refused")
    arguments = parser.parse_args()
    if sys.version_info < (3, 9):
        parser.error("Python 3.9 or newer is required")
    if arguments.uninstall and (arguments.jev is not None or arguments.adopt):
        parser.error("--uninstall takes no component or adoption options")
    signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(128 + signum))
    try:
        # The package's own location is trusted; resolve it so a symlinked path
        # to the source (macOS /tmp or /var, a linked workspace) still installs.
        source = Path(__file__).resolve().parents[1]
        if arguments.uninstall:
            uninstall(source, arguments.project)
        else:
            components = None if arguments.jev is None else ({"jev"} if arguments.jev else set())
            install(source, arguments.project, arguments.harness, components, arguments.adopt)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print("Installation failed: {}".format(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
