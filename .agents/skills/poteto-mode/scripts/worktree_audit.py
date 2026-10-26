#!/usr/bin/env python3
"""Inspect local Git worktrees without authorizing or performing cleanup."""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


class AuditError(Exception):
    pass


def git(repo, *args, allowed=(0,)):
    env = os.environ.copy()
    # A caller's Git overrides must not redirect an inspected worktree elsewhere.
    for name in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"):
        env.pop(name, None)
    env["GIT_OPTIONAL_LOCKS"] = "0"
    try:
        result = subprocess.run(
            ["git", "--no-optional-locks", "-c", "core.fsmonitor=false", "-C", str(repo), *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise AuditError(f"Git query failed: {exc}") from exc
    if result.returncode not in allowed:
        detail = os.fsdecode(result.stderr).strip()
        raise AuditError(f"git {args[0]} failed ({result.returncode}): {detail}")
    return result


def worktree_records(data):
    records = []
    record = {}
    for field in data.split(b"\0"):
        if not field:
            if record:
                if "worktree" not in record:
                    raise AuditError("Malformed worktree list: missing path")
                records.append(record)
                record = {}
            continue
        key, _, value = field.partition(b" ")
        record[os.fsdecode(key)] = os.fsdecode(value)
    if record:
        raise AuditError("Incomplete worktree list")
    if not records:
        raise AuditError("Git returned no worktrees")
    return records


def file_changes(data):
    changes = {"tracked": [], "untracked": [], "ignored": []}
    entries = data.split(b"\0")
    if entries[-1] != b"":
        raise AuditError("Incomplete Git status output")
    entries.pop()
    index = 0
    while index < len(entries):
        entry = entries[index]
        if len(entry) < 4 or entry[2:3] != b" ":
            raise AuditError("Malformed Git status output")
        status = entry[:2]
        change = {"path": os.fsdecode(entry[3:]), "status": os.fsdecode(status)}
        category = "untracked" if status == b"??" else "ignored" if status == b"!!" else "tracked"
        if category == "tracked" and (b"R" in status or b"C" in status):
            index += 1
            if index >= len(entries):
                raise AuditError("Incomplete renamed file in Git status output")
            change["original_path"] = os.fsdecode(entries[index])
        changes[category].append(change)
        index += 1
    return changes


def git_path(repo, option):
    output = git(repo, "rev-parse", "--path-format=absolute", option).stdout
    if not output.endswith(b"\n"):
        raise AuditError("Incomplete Git path output")
    return Path(os.fsdecode(output[:-1]))


def inspect_worktree(repo, record, main, base_commit, common_dir):
    row = {
        "path": record["worktree"],
        "branch": record.get("branch"),
        "head": record.get("HEAD"),
        "main": main,
        "locked": "locked" in record,
        "prunable": "prunable" in record,
        "files": None,
        "merged_into_base": None,
        "decision": "hold",
        "reasons": [],
        "errors": [],
        "deletion_authorized": False,
    }
    if main:
        row["reasons"].append("main worktree")
    for flag in ("locked", "prunable"):
        if flag in record:
            row["reasons"].append(f"{flag}: {record[flag]}")
    if "bare" in record:
        row["reasons"].append("bare repository")
        return row
    path = Path(row["path"])
    try:
        if not path.is_dir():
            raise AuditError("Worktree path is missing or is not a directory")
        if not git_path(path, "--git-common-dir").samefile(common_dir):
            raise AuditError("Registered path belongs to a different repository")
        if not git_path(path, "--show-toplevel").samefile(path):
            raise AuditError("Registered path is no longer a worktree root")
        row["head"] = os.fsdecode(git(path, "rev-parse", "--verify", "HEAD").stdout).strip()
        row["files"] = file_changes(
            git(path, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored", "--ignore-submodules=none").stdout
        )
        for category, files in row["files"].items():
            if files:
                row["reasons"].append(f"{category} files require preservation or explicit disposition")
        if base_commit:
            result = git(repo, "merge-base", "--is-ancestor", row["head"], base_commit, allowed=(0, 1))
            row["merged_into_base"] = result.returncode == 0
        if not row["reasons"]:
            row["decision"] = "review"
            row["reasons"].append("Clean snapshot; inspect usage and obtain path-specific deletion authorization")
    except (AuditError, OSError) as exc:
        row["errors"].append(str(exc))
        row["reasons"].append("inspection incomplete")
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo", nargs="?", default=".", help="Repository path (default: current directory)")
    parser.add_argument("--base", help="Optional local Git ref for ancestry information; never fetched")
    args = parser.parse_args()
    report = {
        "repository": str(Path(args.repo).absolute()),
        "base_ref": args.base,
        "base_commit": None,
        "notice": "Offline snapshot only. Merge state and a clean tree do not authorize deletion. Ignored and untracked files may be irreplaceable.",
        "worktrees": [],
        "errors": [],
    }
    try:
        records = worktree_records(git(args.repo, "worktree", "list", "--porcelain", "-z").stdout)
        common_dir = git_path(args.repo, "--git-common-dir")
        if args.base:
            try:
                report["base_commit"] = os.fsdecode(git(args.repo, "rev-parse", "--verify", "--end-of-options", f"{args.base}^{{commit}}").stdout).strip()
            except AuditError as exc:
                report["errors"].append(str(exc))
        for index, record in enumerate(records):
            row = inspect_worktree(args.repo, record, index == 0, report["base_commit"], common_dir)
            if report["errors"]:
                row["decision"] = "hold"
                row["reasons"].append("base query failed")
            report["worktrees"].append(row)
    except AuditError as exc:
        report["errors"].append(str(exc))
    print(json.dumps(report, ensure_ascii=True, indent=2))
    return int(bool(report["errors"] or any(row["errors"] for row in report["worktrees"])))


if __name__ == "__main__":
    sys.exit(main())
