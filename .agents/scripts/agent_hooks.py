#!/usr/bin/env python3
"""Opt-in agent lifecycle checks. JSON in/out; evidence never grants authority.

This runtime executes only the package validator and (in its source checkout)
the package's Python tests. Consumer commands and visual checks are not inferred.
State contains file hashes and check statuses, never prompts or transcripts.
"""

import argparse
from contextlib import contextmanager
import fnmatch
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import signal
import stat
import subprocess
import sys
import tempfile
import time


EVENTS = ("SessionStart", "SubagentStart", "PostToolUse", "Stop", "SubagentStop", "PreCompact")
MAX_INPUT = 256 * 1024
DEBOUNCE_SECONDS = 3
# Dependency, build, and cache folders are not edited by hand and can be huge.
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "env", "__pycache__", "dist", "build", ".next", ".cache", "coverage",
             ".prompt-log.lock", ".tox", ".nox", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".gradle", ".terraform",
             "target", "vendor", ".parcel-cache", ".turbo", ".svelte-kit", ".nuxt", ".output", "bower_components",
             "Pods", "DerivedData", ".dart_tool", ".angular"}
SKIP_PATHS = {".claude/worktrees"}
SUFFIXES = {".md", ".mdx", ".rst", ".txt", ".py", ".ipynb", ".sh", ".bash", ".zsh", ".ps1", ".bat", ".json", ".toml", ".yaml", ".yml",
            ".ini", ".cfg", ".properties", ".xml", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".html", ".css", ".scss", ".sass",
            ".less", ".vue", ".svelte", ".astro", ".rs", ".go", ".java", ".kt", ".kts", ".scala", ".groovy", ".gradle", ".c", ".h",
            ".cc", ".cpp", ".cxx", ".hpp", ".m", ".mm", ".swift", ".cs", ".fs", ".rb", ".php", ".pl", ".lua", ".r", ".jl", ".dart",
            ".ex", ".exs", ".erl", ".hs", ".ml", ".clj", ".sql", ".proto", ".graphql", ".prisma", ".tf"}
HASH_LIMIT = 2 * 1024 * 1024
TOTAL_HASH_LIMIT = 64 * 1024 * 1024
MAX_FILES = 20000
# These tools cannot change files; PostToolUse skips the project snapshot for them.
READ_ONLY_TOOLS = {"read", "grep", "glob", "ls", "webfetch", "websearch", "notebookread", "read_file", "list_dir", "view",
                   "view_image", "search", "find", "fetch", "toolsearch", "askuserquestion", "todowrite", "todoread", "skill"}
EDIT_TOOLS = {"write", "edit", "multiedit", "notebookedit", "apply_patch", "write_file", "replace_in_file", "delete", "delete_file"}
READ_TOOLS = {"read", "read_file", "view"}
SHELL_TOOLS = {"bash", "shell", "exec_command", "run_terminal_cmd", "terminal", "local_shell"}
SKILL_PATH = re.compile(r"(?:^|[\s'\"=/])skills/([a-z0-9]+(?:-[a-z0-9]+)*)/SKILL\.md\b")
TURN_FIELDS = ("prompt_id", "turn_id", "request_id", "generation_id")
STATUSES = {"passed", "failed", "unavailable", "timed_out"}
UNAVAILABLE = " Verification unavailable; run the relevant local checks manually. No success or authorization was inferred."


class HookError(ValueError):
    pass


class QuietHookError(HookError):
    """A busy lock or oversized tool payload; the next event or Stop catches up."""


def tool_name(payload):
    name = payload.get("tool_name") or payload.get("tool") or ""
    return name.lower() if isinstance(name, str) else ""


def skill_load(payload, package):
    """(skill, via) when this tool call loaded one of the package's own skills."""
    tool = tool_name(payload)
    data = payload.get("tool_input") if isinstance(payload.get("tool_input"), dict) else {}
    if tool == "skill":
        name, via = data.get("skill") or data.get("name"), "skill_tool"
    elif tool in READ_TOOLS or tool in SHELL_TOOLS:
        text = (data.get("file_path") or data.get("path") or data.get("filePath")) if tool in READ_TOOLS else data.get("command")
        if isinstance(text, list):
            text = " ".join(str(part) for part in text)
        if not isinstance(text, str) or "SKILL.md" not in text:
            return None
        if tool in READ_TOOLS and os.path.isabs(text) and not text.startswith(str(package / "skills") + os.sep):
            return None
        match = SKILL_PATH.search(text)
        name, via = (match[1] if match else None), ("read" if tool in READ_TOOLS else "shell")
    else:
        return None
    if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name) or not (package / "skills" / name / "SKILL.md").is_file():
        return None
    return name, via


def record_skill_load(payload, project, package):
    """Append local usage evidence; never let it affect the agent's work."""
    try:
        found = skill_load(payload, package)
        session = payload.get("parent_conversation_id") or payload.get("session_id") or payload.get("conversation_id")
        if found is None or not isinstance(session, str) or not session:
            return
        spec = importlib.util.spec_from_file_location("myagent_evidence", Path(__file__).with_name("evidence.py"))
        evidence = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(evidence)
        turn = next((payload[field] for field in TURN_FIELDS if payload.get(field)), None)
        evidence.record(project, {"type": "skill_loaded", "skill": found[0], "via": found[1],
                                  "session": evidence.hashed(session), "turn": evidence.turn_key(session, turn)})
    except Exception:
        pass


def read_input(stream):
    raw = stream.read(MAX_INPUT + 1)
    if len(raw) > MAX_INPUT:
        raise QuietHookError("Hook input exceeds the 256 KiB limit; no check ran.")
    try:
        payload = json.loads(raw or "{}")
    except (ValueError, UnicodeError, RecursionError):
        raise HookError("Hook input is not valid JSON; no check ran.") from None
    if not isinstance(payload, dict):
        raise HookError("Hook input must be a JSON object; no check ran.")
    return payload


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def fingerprint(files):
    return digest(json.dumps(files, sort_keys=True, separators=(",", ":")))


def roots(project=None, package=None, cwd=None):
    package = Path(package or Path(__file__).resolve().parents[1]).resolve()
    if project:
        project = Path(project).resolve()
    else:
        current = Path(cwd or Path.cwd()).resolve()
        project = next((p for p in (current, *current.parents)
                        if (p / ".agents/AGENTS.md").is_file() or
                        ((p / "AGENTS.md").is_file() and (p / "scripts/validate.py").is_file())), None)
    if project is None or not project.is_dir():
        raise HookError("No project containing the package was found; configure --project-root.")
    if not (package / "AGENTS.md").is_file() or not (package / "scripts/validate.py").is_file():
        raise HookError("Package root is unavailable; configure --package-root.")
    if package != project and project not in package.parents:
        raise HookError("Package must be inside the selected project.")
    return project, package


def snapshot(root):
    """Hash bounded source files, including shell edits; never follow symlinks.

    Files beyond the hashing budget, or unreadable ones, are tracked by size and
    modification time instead, so one large or locked file never disables hooks.
    """
    files, hashed = {}, 0
    for directory, children, names in os.walk(root, followlinks=False):
        base = Path(directory).relative_to(root).as_posix()
        children[:] = sorted(name for name in children
                             if name not in SKIP_DIRS and not name.startswith((".agents-backup-", ".agents-staging-", ".myagent-hooks-"))
                             and (name if base == "." else base + "/" + name) not in SKIP_PATHS
                             and not Path(directory, name).is_symlink())
        for name in sorted(names):
            path = Path(directory, name)
            lowered = name.lower()
            if lowered in {"prompt-log.md", ".agent-usage.jsonl", ".agent-usage.lock", ".agent-evidence.jsonl", ".agent-evidence.lock"} or lowered.startswith(".agent-usage-"):
                continue
            if base == "." and lowered == "progress.md" and generated_board(path):
                # The generated board is derived output, never a consumer change; a hand-written one still counts.
                continue
            if lowered.startswith(".env") or any(word in lowered for word in ("credential", "secret", "private_key")):
                continue
            if path.suffix.lower() not in SUFFIXES and name not in {"Makefile", "Dockerfile", "VERSION", "Gemfile", "Rakefile"}:
                continue
            try:
                info = path.lstat()
            except OSError:
                continue
            if not stat.S_ISREG(info.st_mode):
                continue
            if len(files) >= MAX_FILES:
                raise HookError("Source snapshot limit reached ({} files); automatic change detection is unavailable.".format(MAX_FILES))
            key = path.relative_to(root).as_posix()
            signature = "stat:{}:{}".format(info.st_size, info.st_mtime_ns)
            if info.st_size > HASH_LIMIT or hashed + info.st_size > TOTAL_HASH_LIMIT:
                files[key] = signature
                continue
            try:
                # O_NOFOLLOW also protects against replacing a file with a symlink during the scan.
                fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
                with os.fdopen(fd, "rb") as handle:
                    content = handle.read(HASH_LIMIT + 1)
            except OSError:
                files[key] = "unreadable:" + signature
                continue
            if len(content) > HASH_LIMIT:
                files[key] = signature
                continue
            hashed += len(content)
            files[key] = hashlib.sha256(content).hexdigest()
    return files


def changed_files(before, after):
    return sorted(name for name in set(before) | set(after) if before.get(name) != after.get(name))


def private_directory(path):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise HookError("Hook state directory is not private and user-owned; no state was written.")


@contextmanager
def locked_state(project, payload, state_root=None):
    """Serialize one session/agent; different delegates have independent state."""
    try:
        import fcntl
    except ImportError:
        raise HookError("Private hook state locking requires a POSIX host; run checks directly.") from None
    session = payload.get("parent_conversation_id") or payload.get("session_id") or payload.get("conversation_id")
    agent = payload.get("agent_id") or payload.get("subagent_id") or "root"
    if not isinstance(session, str) or not session or len(session) > 512 or not isinstance(agent, str) or len(agent) > 512:
        raise HookError("A bounded session_id or conversation_id is required for isolated hook state.")
    base = Path(state_root or Path(tempfile.gettempdir()) / ("myagent-hooks-" + str(os.getuid())))
    private_directory(base)
    folder = base / digest(str(project)) / digest(session + "\0" + agent)
    private_directory(folder.parent)
    private_directory(folder)
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(folder / "state.lock", flags, 0o600)
    try:
        lock_info = os.fstat(fd)
        if not stat.S_ISREG(lock_info.st_mode) or lock_info.st_uid != os.getuid() or lock_info.st_mode & 0o077:
            raise HookError("Hook lock must be a private, user-owned regular file.")
        deadline = time.monotonic() + 1
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise QuietHookError("Another hook is checking this agent; this invocation did not run checks.")
                time.sleep(0.02)
        path = folder / "state.json"
        if path.is_symlink():
            raise HookError("Hook state path must not be a symlink.")
        try:
            if path.exists():
                info = path.stat()
                if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > 8 * 1024 * 1024:
                    raise HookError("Hook state must be a bounded, private, user-owned regular file.")
                data = json.loads(path.read_text())
            else:
                data = {}
        except (OSError, ValueError):
            raise HookError("Hook state is unreadable; no prior verification was assumed.") from None
        if not isinstance(data, dict):
            raise HookError("Hook state is invalid; no prior verification was assumed.")
        before = json.dumps(data, sort_keys=True)
        yield data, folder
        if path.exists() and json.dumps(data, sort_keys=True) == before:
            return
        output_fd, temporary = tempfile.mkstemp(prefix="state-", suffix=".tmp", dir=folder)
        try:
            with os.fdopen(output_fd, "w") as handle:
                json.dump(data, handle, sort_keys=True)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    finally:
        os.close(fd)


def run_check(argv, cwd, timeout):
    """Bound a local check and its process group; never retain command output."""
    try:
        child = subprocess.Popen(argv, cwd=cwd, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 start_new_session=True,
                                 env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
        try:
            code = child.wait(timeout=timeout)
            return {"status": "passed" if code == 0 else "failed", "exit_code": code}
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
            return {"status": "timed_out"}
    except OSError:
        return {"status": "unavailable"}


def package_files(files, project, package):
    prefix = package.relative_to(project).as_posix()
    if prefix == ".":
        return files
    prefix += "/"
    return {name[len(prefix):]: checksum for name, checksum in files.items() if name.startswith(prefix)}


def check_package(state, current, project, package, include_tests, runner):
    package_snapshot = package_files(current, project, package)
    stamp = fingerprint(package_snapshot)
    checks = state.setdefault("checks", {})
    commands = [("package_validation", [sys.executable, "-B", str(package / "scripts/validate.py"), str(package)], 12)]
    source = package == project and (package / "tests").is_dir() and not (package / ".myagent-manifest.json").exists()
    if include_tests and source:
        commands.append(("source_regressions", [sys.executable, "-B", "-m", "unittest", "discover", "-s", "tests", "-v"], 240))
    results = []
    for name, command, timeout in commands:
        old = checks.get(name, {})
        # A result stands until the files change; only an unavailable check is retried.
        if old.get("fingerprint") == stamp and old.get("status") in {"passed", "failed", "timed_out"}:
            result = old
        else:
            result = {**runner(command, package, timeout), "fingerprint": stamp}
            checks[name] = result
        results.append((name, result["status"]))
        if result["status"] != "passed":
            break
    return results


def followup_allowed(state, payload):
    if (payload.get("stop_hook_active") or payload.get("loop_count", 0) != 0
            or payload.get("is_interrupt") or payload.get("status") in {"aborted", "error", "cancelled"}):
        return False
    turn = next((payload[field] for field in TURN_FIELDS if payload.get(field)), None)
    key = digest(str(turn)) if turn is not None else "session"
    if state.get("followup_key") == key:
        return False
    state["followup_key"] = key
    return True


def record_handoff(state, payload, current):
    kind = payload.get("task_kind")
    files, checks = payload.get("changed_files", []), payload.get("checks", [])
    if kind not in {"code", "research"} or not isinstance(files, list) or len(files) > 200 or not isinstance(checks, list) or len(checks) > 30:
        raise HookError("Handoff needs task_kind code/research, bounded changed_files, and checks.")
    for name in files:
        if not isinstance(name, str) or len(name) > 500 or PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts or "\\" in name:
            raise HookError("Handoff changed_files must be project-relative paths.")
    evidence = []
    for check in checks:
        if not isinstance(check, dict) or check.get("status") not in STATUSES or not isinstance(check.get("name"), str) or not 1 <= len(check["name"]) <= 80:
            raise HookError("Handoff checks need a short name and passed/failed/unavailable/timed_out status.")
        # Names are identifiers, not a channel for copying command output or prose.
        if any(not (char.isalnum() or char in "_-. ") for char in check["name"]):
            raise HookError("Handoff check names must be plain identifiers, not commands or output.")
        evidence.append({"name": check["name"], "status": check["status"]})
    remaining = payload.get("remaining_count", 0)
    if not isinstance(remaining, int) or not 0 <= remaining <= 10000:
        raise HookError("Handoff remaining_count must be a nonnegative bounded integer.")
    state["handoff"] = {"task_kind": kind, "changed_files": sorted(set(files)), "checks": evidence,
                        "remaining_count": remaining, "fingerprint": fingerprint(current)}
    brief = {}
    if "objective" in payload:
        if not isinstance(payload["objective"], str) or len(payload["objective"]) > 1200:
            raise HookError("Explicit handoff objective must be at most 1200 characters.")
        brief["objective"] = payload["objective"]
    for field in ("decisions", "remaining"):
        if field in payload:
            values = payload[field]
            if not isinstance(values, list) or len(values) > 10 or any(not isinstance(value, str) or len(value) > 800 for value in values):
                raise HookError("Explicit handoff decisions/remaining must have at most ten short strings.")
            brief[field] = values
    if brief:
        state["handoff"]["explicit_brief"] = brief


def handoff_command(package, harness):
    return "python3 -B " + shlex.quote(str(package / "scripts/agent_hooks.py")) + " --harness " + harness + " --record-handoff"


PROGRESS_ERRORS = (OSError, ValueError, TypeError, AttributeError, KeyError, RecursionError, RuntimeError, subprocess.SubprocessError)
PATH_TEXT = re.compile(r"^[A-Za-z0-9_./@+-]{1,200}$")
BOARD_MARKER = b"<!-- Generated by scripts/progress.py"


def generated_board(path):
    """Whether a root PROGRESS.md carries the generator's marker; a hand-written one is a consumer file."""
    try:
        with open(path, "rb") as handle:
            return handle.read(len(BOARD_MARKER)) == BOARD_MARKER
    except OSError:
        return False


def load_progress():
    """The board generator beside this script; None when it is unavailable."""
    name = "myagent_progress"
    try:
        spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name("progress.py"))
        module = importlib.util.module_from_spec(spec)
        # Registered first: dataclasses resolve annotations through sys.modules on Python 3.9.
        sys.modules[name] = module
        spec.loader.exec_module(module)
        return module
    except (OSError, ValueError, AttributeError, SyntaxError, ImportError):
        sys.modules.pop(name, None)
        return None


def progress_command(package):
    return "python3 -B " + shlex.quote(str(package / "scripts/progress.py")) + " --write"


def progress_rules(package):
    return " Rules: " + str(package / "skills/implement/progress-operations.md") + "."


def plan_state(progress, project):
    """Parsed plans plus which workstream, if any, this checkout's branch belongs to."""
    plans, notices = progress.load(project)
    branch = progress.checkout_branch(project)
    plan, stream, role = progress.workstream_for_branch(plans, branch)
    return plans, notices, branch, plan, stream, role


def own_numbers(plan, stream, role):
    """Tickets this checkout may write: every ticket in single mode, its own in parallel mode."""
    if not plan.parallel:
        return set(plan.tickets)
    if role == "workstream" and stream is not None:
        return {number for number, ticket in plan.tickets.items() if ticket.workstream == stream.name}
    if role == "integration":
        return {number for number, ticket in plan.tickets.items() if ticket.workstream in (None, "integrator")}
    return set()


def board_note(status, package):
    if status == "tracked":
        return " PROGRESS.md is tracked by git; run git rm --cached PROGRESS.md so the generated board can be ignored and regenerated."
    if status == "not-ignored":
        return (" Board: run " + progress_command(package)
                + " to print it; PROGRESS.md was not written because /PROGRESS.md is not ignored (the installer adds it).")
    if status == "hand-written":
        return " PROGRESS.md is hand-written and was left alone; move it so the generated board can take its place."
    if status in {"refused", "error"}:
        return " Board: PROGRESS.md could not be written; run " + progress_command(package) + " for details."
    return " Board: PROGRESS.md (regenerated; do not edit it by hand)."


def plan_note(event, project, package, harness, write):
    """Numbers-only startup note; empty, with no file touched, when no plan is active."""
    progress = load_progress()
    if progress is None:
        return ""
    try:
        plans, notices, branch, _, _, _ = plan_state(progress, project)
        text = progress.brief(plans, branch, harness, event)
    except PROGRESS_ERRORS:
        return " Progress board unavailable; run " + progress_command(package) + " for details."
    status = ""
    if write:
        # The board refresh is separate so a write failure never costs the session its phase and counts.
        try:
            status = progress.write_board(project, plans, None, notices)
        except PROGRESS_ERRORS:
            status = "error"
    if not text:
        return ""
    if not write:
        return text + " Board: PROGRESS.md (do not edit it by hand)." + progress_rules(package)
    return text + board_note(status, package) + progress_rules(package)


def owned_path(name, globs):
    for pattern in globs:
        folder = pattern.rstrip("/")
        if pattern.endswith("/") and name.startswith(folder + "/"):
            return True
        if name == folder or name.startswith(folder + "/"):
            return True
        if fnmatch.fnmatchcase(name, pattern) or fnmatch.fnmatchcase(name, folder + "/*"):
            return True
    return False


def plan_stop_notes(progress, project, package, changed, plan_changed):
    """(advice, blocking message or None) for the Stop event once a plan exists."""
    plans, notices, branch, plan, stream, role = plan_state(progress, project)
    notes = []
    if plans:
        # Regenerate at every stop while a plan exists: a fetch or a merge changes the view without a local ticket edit.
        status = progress.write_board(project, plans, None, notices)
        if status in {"written", "removed"}:
            notes.append(" PROGRESS.md regenerated.")
        elif status in {"tracked", "not-ignored", "hand-written", "refused"}:
            notes.append(board_note(status, package))
    code_changed = [name for name in changed if not name.startswith(".scratch/")]
    own_errors, foreign, claimed_here = [], [], []
    for item in plans:
        if not item.active:
            continue
        mine = own_numbers(item, stream if item is plan else None, role if item is plan else "none")
        for number, code in sorted(item.errors):
            if number in mine:
                own_errors.append("ticket {:02d} {}".format(number, code))
            else:
                owner = item.tickets[number].workstream if number in item.tickets else None
                known = owner if owner in item.workstreams or owner == "integrator" else "unknown workstream"
                foreign.append(" Ticket {:02d} ({}) has {}; its owner fixes it.".format(number, known, code))
        for number in sorted(mine):
            ticket = item.tickets[number]
            if not ticket.claimed:
                continue
            paused = ticket.last_comment.lower().startswith(("paused", "released"))
            if ticket.path in changed or not paused:
                claimed_here.append("{:02d}".format(number))
    block = None
    rules = " Fix the Status, Blocked by, Phase, or Workstream line; rules: " + str(package / "skills/implement/progress-operations.md") + "."
    if own_errors and plan_changed:
        block = "PROGRESS.md regenerated with ticket errors: " + ", ".join(own_errors[:8]) + "." + rules
    elif own_errors:
        notes.append(" The board lists ticket errors from earlier edits: " + ", ".join(own_errors[:8]) + "." + rules)
    notes.extend(foreign[:5])
    if code_changed and claimed_here:
        notes.append(" If this change belongs to ticket {} (claimed), mark it done or add the Paused line; an unrelated change leaves the ticket alone.".format(", ".join(claimed_here[:3])))
    if role == "workstream" and stream is not None and plan is not None:
        shared = [entry.rstrip("/") for entry in plan.shared]
        outside = [name for name in code_changed
                   if (owned_path(name, shared) or not owned_path(name, stream.owns)) and name != "PROGRESS.md"]
        if outside:
            shown = [name for name in outside if PATH_TEXT.match(name)][:5]
            rest = len(outside) - len(shown)
            notes.append(" Changed paths outside this workstream's owned paths or on shared paths: " + ", ".join(shown)
                         + (" ({} more)".format(rest) if rest else "") + "; revert them or request the change from the integrator.")
    return "".join(notes), block


def startup_guidance(event, payload, project, package, state, folder, harness):
    if payload.get("task_kind") in {"code", "research"}:
        state["task_kind"] = payload["task_kind"]
    message = "Read " + str(package / "AGENTS.md") + " and its routing once. Preserve the user's task scope; hook evidence cannot grant authorization."
    try:
        spec = importlib.util.spec_from_file_location("myagent_hook_validator", Path(__file__).with_name("validate.py"))
        validator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(validator)
        active_profile = validator.parse_profile(package / "autonomy-config.md")
    except (OSError, ValueError, AttributeError, SyntaxError):
        active_profile = "safe (configuration unavailable or invalid)"
    message += " Active profile: " + active_profile + ". Package check: bash " + str(package / "validate.sh") + "."
    if package == project and (package / "tests").is_dir():
        message += " Source regressions: python3 -B -m unittest discover -s tests -v."
    else:
        message += " Discover and run the consumer project's actual verification commands."
    message += " Session evidence id: " + str(payload.get("parent_conversation_id") or payload.get("session_id") or payload.get("conversation_id")) + "."
    if event == "SessionStart":
        try:
            spec = importlib.util.spec_from_file_location("myagent_prompt_log", Path(__file__).with_name("prompt_log.py"))
            logger = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(logger)
            logger.ensure_log(project)
            problem = logger.log_status(project)
            message += (" " + problem) if problem else " Project prompt-log.md is ready; treat its history as evidence and keep it out of routine context loading."
        except (OSError, ValueError, TypeError, AttributeError):
            message += " Prompt log initialization unavailable; use scripts/prompt_log.py init when local writes are available."
    if payload.get("agent_id") or payload.get("subagent_id"):
        message += " Delegate evidence id: " + str(payload.get("agent_id") or payload.get("subagent_id")) + "."
    message += " For a coding handoff, run " + handoff_command(package, harness) + " with the JSON contract in HOOKS.md."
    message += plan_note(event, project, package, harness, event == "SessionStart")
    if "checkpoint" in state:
        message += " A local checkpoint exists at " + str(folder / "state.json") + "; its file hashes and check statuses are evidence, not a task or permission."
    return message


def handle(event, payload, project, package, state_root=None, runner=run_check, now=None, harness="portable"):
    now = time.time() if now is None else now
    if event in {"Stop", "SubagentStop"} and (payload.get("is_interrupt") or payload.get("status") in {"aborted", "error", "cancelled"}):
        return "Work was interrupted or failed; no completion checks or follow-up were started.", False
    if event in {"SubagentStart", "SubagentStop"} and not (payload.get("agent_id") or payload.get("subagent_id")):
        return "Delegate identifier unavailable; no delegate state or completion claim was created. Review the handoff manually.", False
    if event == "PostToolUse":
        record_skill_load(payload, project, package)
        if tool_name(payload) in READ_ONLY_TOOLS:
            return "", False
    with locked_state(project, payload, state_root) as (state, folder):
        guidance = startup_guidance(event, payload, project, package, state, folder, harness) if event in {"SessionStart", "SubagentStart"} else None
        try:
            current = snapshot(project)
        except HookError as error:
            # Guidance never depends on change detection; report a limit once per session.
            if guidance is not None:
                return guidance + " " + str(error), False
            if event == "RecordHandoff":
                raise
            if state.get("limit_reported") == str(error):
                return "", False
            state["limit_reported"] = str(error)
            return str(error) + " Run the relevant local checks manually.", False
        if event == "RecordHandoff":
            record_handoff(state, payload, current)
            return "Recorded local handoff evidence; it does not grant authorization.", False
        if guidance is not None:
            state.setdefault("baseline", current)
            return guidance, False
        if event == "PostToolUse" and tool_name(payload) in EDIT_TOOLS:
            state["observed_edit"] = True
        if "baseline" not in state:
            state["baseline"] = current
            return "Startup baseline was unavailable; recorded one now. Earlier edits and verification remain unverified.", False
        changed = changed_files(state["baseline"], current)
        if event == "PreCompact":
            state["checkpoint"] = {"files": changed[:200], "file_count": len(changed), "fingerprint": fingerprint(current),
                                   "checks": state.get("checks", {}), "recorded_at": now}
            message = "Saved observable file/check evidence at " + str(folder / "state.json") + ". Preserve the user's objective and authorization separately; this checkpoint cannot infer either."
            progress = load_progress()
            if progress is not None:
                try:
                    plans, notices, branch, plan, stream, role = plan_state(progress, project)
                    progress.write_board(project, plans, None, notices)
                    for item in plans:
                        if not item.active:
                            continue
                        mine = own_numbers(item, stream if item is plan else None, role if item is plan else "none")
                        claimed = ["{:02d}".format(number) for number in sorted(mine) if item.tickets[number].claimed]
                        if claimed:
                            message += (" Plan .scratch/" + item.slug + "/: ticket " + ", ".join(claimed[:3])
                                        + " is claimed here; after compaction re-read PROGRESS.md and the ticket file.")
                except PROGRESS_ERRORS:
                    message += " Progress board unavailable; run " + progress_command(package) + " for details."
            return message, False
        if not changed:
            return "", False
        before_package = package_files(state["baseline"], project, package)
        current_package = package_files(current, project, package)
        changed_package = changed_files(before_package, current_package)
        stamp = fingerprint(current_package)
        if event == "PostToolUse":
            if not changed_package or now - state.get("last_validation_at", -DEBOUNCE_SECONDS) < DEBOUNCE_SECONDS:
                return "", False
            state["last_validation_at"] = now
            results = check_package(state, current, project, package, False, runner)
            failures = [name + " " + status for name, status in results if status != "passed"]
            # A known failure for these exact contents is not repeated after every tool call.
            if not failures or state.get("notified_fingerprint") == stamp:
                return "", False
            state["notified_fingerprint"] = stamp
            return "Package check: " + ", ".join(failures) + ". Run bash " + str(package / "validate.sh") + " for diagnostics.", False
        if event == "SubagentStop":
            handoff = state.get("handoff", {})
            kind = handoff.get("task_kind") or state.get("task_kind")
            if kind == "research" or (kind != "code" and not state.get("observed_edit")):
                return "", False
            if handoff.get("fingerprint") != fingerprint(current) or handoff.get("task_kind") != "code" or not handoff.get("changed_files") or not handoff.get("checks"):
                message = ("Files changed during this delegate. Record a structured handoff with changed_files, checks, and remaining_count: run "
                           + handoff_command(package, harness) + ". Mark unavailable checks honestly; the parent must inspect the artifacts.")
                return message, followup_allowed(state, payload)
            return "Coding handoff recorded. Parent review must verify artifacts; self-reported checks are not independent verification.", False
        if event == "Stop":
            code_changed = any(name.startswith(("scripts/", "tests/")) or Path(name).suffix in {".py", ".sh", ".bash"}
                               or name == "resources.json" for name in changed_package)
            results = check_package(state, current, project, package, code_changed, runner) if changed_package else []
            # Checks may have changed files; never attach a pass to a later revision.
            if snapshot(project) != current:
                return "Files changed while checks ran; results are stale. Recheck the current files.", followup_allowed(state, payload)
            failures = [name + " " + status for name, status in results if status != "passed"]
            if failures:
                message = "Completion evidence: " + ", ".join(failures) + ". Inspect the failing local check and fix in-scope failures, or report the unavailable check. Do not claim it passed."
                state["notified_fingerprint"] = stamp
                # One forced follow-up per failing revision, at most one per turn.
                if state.get("followup_fingerprint") == stamp:
                    return message, False
                allowed = followup_allowed(state, payload)
                if allowed:
                    state["followup_fingerprint"] = stamp
                return message, allowed
            plan_changed = any(name.startswith(".scratch/") and name.endswith(".md") for name in changed)
            advice, block = "", None
            progress = load_progress()
            if progress is not None:
                try:
                    advice, block = plan_stop_notes(progress, project, package, changed, plan_changed)
                except PROGRESS_ERRORS:
                    advice = " Progress board unavailable; run " + progress_command(package) + " for details."
            if block:
                # One blocking follow-up per malformed revision of the plan files; the baseline stays so later Stops repeat it as advice.
                plan_stamp = fingerprint({name: value for name, value in current.items() if name.startswith(".scratch/")})
                if state.get("plan_followup_fingerprint") != plan_stamp:
                    if followup_allowed(state, payload):
                        state["plan_followup_fingerprint"] = plan_stamp
                        return block + advice, True
                advice = " " + block + advice
            else:
                state["baseline"] = current
            if not any(payload.get(field) for field in TURN_FIELDS):
                state.pop("followup_key", None)
            summary = "Package checks passed for the current files." if results else "Changed consumer files have no configured project verification command."
            if package != project:
                summary += " Consumer tests and rendered/interaction verification are not configured by these hooks; run and report the project's actual checks."
            return summary + advice, False
        return "", False


def output(harness, event, message, followup):
    if harness == "portable":
        return {"event": event, "message": message, "followup": followup}
    if not message:
        return {}
    if harness == "cursor":
        if event in {"Stop", "SubagentStop"}:
            return {"followup_message": message} if followup else {}
        if event in {"SessionStart", "PostToolUse"}:
            return {"additional_context": message}
        if event == "SubagentStart":
            return {"permission": "allow"}
        return {}
    if followup and event in {"Stop", "SubagentStop"}:
        return {"decision": "block", "reason": message}
    if event in {"SessionStart", "SubagentStart", "PostToolUse"}:
        return {"hookSpecificOutput": {"hookEventName": event, "additionalContext": message}}
    return {"systemMessage": message}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--harness", choices=("portable", "codex", "claude", "cursor"), required=True)
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument("--event", choices=EVENTS)
    actions.add_argument("--record-handoff", action="store_true")
    parser.add_argument("--project-root", type=Path)
    parser.add_argument("--package-root", type=Path)
    args = parser.parse_args(argv)
    event = "RecordHandoff" if args.record_handoff else args.event
    try:
        payload = read_input(sys.stdin.buffer)
        project, package = roots(args.project_root, args.package_root)
        message, followup = handle(event, payload, project, package, harness=args.harness)
    except QuietHookError as error:
        # A busy lock or oversized tool payload: the next event or Stop catches up.
        message, followup = ("" if event == "PostToolUse" else str(error) + UNAVAILABLE), False
    except HookError as error:
        # HookError text is fixed by this script and never contains input, paths, or output.
        if event == "RecordHandoff":
            print(json.dumps({"recorded": False, "error": str(error)}, separators=(",", ":")))
            return 1
        message, followup = str(error) + UNAVAILABLE, False
    except (OSError, ValueError, TypeError, KeyError, RecursionError):
        # Never echo malformed input, filenames from errors, or command output.
        if event == "RecordHandoff":
            print(json.dumps({"recorded": False, "error": "Handoff could not be recorded; check the JSON contract in HOOKS.md."}, separators=(",", ":")))
            return 1
        message, followup = "Hook verification unavailable; run the relevant local checks manually. No success or authorization was inferred.", False
    if message and not followup and event not in {"SessionStart", "SubagentStart", "RecordHandoff"}:
        print(message, file=sys.stderr)
    result = {"recorded": True} if event == "RecordHandoff" and message.startswith("Recorded") else output(args.harness, event, message, followup)
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
