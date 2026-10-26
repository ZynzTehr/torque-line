#!/usr/bin/env python3
"""Local evidence of real work: which skills agents load and what Jev decided.

The record is append-only, private, and bounded. Events carry skill names,
numbers, and hashed identifiers only; never prompt text, paths, commands, or
tool output. The report turns them into usage and agreement figures that show
which skills earn their place and whether a Jev decision point helps.
"""

import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys

EVIDENCE = ".agent-evidence.jsonl"
LOCK = ".agent-evidence.lock"
MAX_BYTES = 8 * 1024 * 1024
VERSION = 1
NAME = re.compile(r"[a-z0-9]+(?:[-_][a-z0-9]+)*\Z")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
VIA = {"read", "skill_tool", "shell"}
QUESTIONS = {"suggested_skill", "prompt_kind"}
STATUSES = {"ok", "abstained", "skipped", "unavailable", "budget_exhausted", "missing_key"}
THRESHOLDS = (0.5, 0.7, 0.85, 0.95)
FIELDS = {
    "skill_loaded": {"required": {"skill", "via", "session"}, "optional": {"turn"}},
    "jev_decision": {"required": {"question", "status", "session"},
                     "optional": {"turn", "choice", "reason", "top_probability", "runner_up", "margin", "gate",
                                  "catalog", "scope", "model"}},
}


class EvidenceError(ValueError):
    pass


def hashed(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def turn_key(session_id, turn_id):
    """The prompt-log entry ID for a turn: sha256(sha256(session) + NUL + turn)."""
    if not isinstance(session_id, str) or not isinstance(turn_id, str) or not turn_id or len(turn_id) > 512:
        return None
    return hashed(hashed(session_id) + "\0" + turn_id)


def validate(event):
    if not isinstance(event, dict) or event.get("type") not in FIELDS:
        raise EvidenceError("unknown_event_type")
    spec = FIELDS[event["type"]]
    keys = set(event) - {"type", "v", "at"}
    if not spec["required"] <= keys or keys - spec["required"] - spec["optional"]:
        raise EvidenceError("invalid_event_fields")
    result = {"type": event["type"], "v": VERSION}
    at = event.get("at")
    if at is not None:
        try:
            datetime.strptime(at, "%Y-%m-%dT%H:%M:%SZ")
        except (TypeError, ValueError):
            raise EvidenceError("invalid_time") from None
    result["at"] = at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for key in sorted(keys):
        value = event[key]
        if value is None and key in spec["optional"]:
            continue
        if key in {"session", "turn"}:
            valid = isinstance(value, str) and HEX64.fullmatch(value)
        elif key in {"skill", "choice", "runner_up"}:
            valid = isinstance(value, str) and len(value) <= 64 and NAME.fullmatch(value)
        elif key in {"top_probability", "margin", "gate"}:
            valid = type(value) in (int, float) and 0 <= value <= 1
        elif key == "via":
            valid = value in VIA
        elif key == "question":
            valid = value in QUESTIONS
        elif key == "status":
            valid = value in STATUSES
        elif key == "scope":
            valid = value in {"invocable", "all"}
        elif key == "catalog":
            valid = isinstance(value, str) and re.fullmatch(r"[0-9a-f]{16}", value)
        else:  # reason, model: short fixed identifiers, never free text
            valid = isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9._-]{1,100}", value)
        if not valid:
            raise EvidenceError("invalid_" + key)
        result[key] = value
    return result


def project_root(project):
    root = Path(project)
    if root.is_symlink() or not root.is_dir():
        raise EvidenceError("invalid_project_directory")
    return root


def ledger_lock(root):
    specification = importlib.util.spec_from_file_location("evidence_lock", Path(__file__).with_name("usage_budget.py"))
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module.exclusive_lock(root, LOCK)


def record(project, event):
    root = project_root(project)
    normalized = validate(event)
    line = (json.dumps(normalized, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    with ledger_lock(root):
        path = root / EVIDENCE
        if path.is_symlink():
            raise EvidenceError("unsafe_evidence_file")
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or (os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077)):
                raise EvidenceError("evidence_file_not_private")
            if info.st_size + len(line) > MAX_BYTES:
                raise EvidenceError("evidence_file_full")
            os.write(fd, line)
        finally:
            os.close(fd)
    return normalized


def read_events(project):
    path = project_root(project) / EVIDENCE
    try:
        info = path.lstat()
    except FileNotFoundError:
        return [], 0
    if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_BYTES:
        raise EvidenceError("unsafe_or_oversized_evidence_file")
    events, invalid = [], 0
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            events.append(validate(json.loads(line)))
        except (ValueError, EvidenceError):
            invalid += 1
    return events, invalid


def catalog_names(package_root):
    return sorted(path.parent.name for path in (Path(package_root) / "skills").glob("*/SKILL.md"))


def loads_for(decision, loads, decisions):
    """Skills loaded in the decision's turn; without turn IDs, those loaded in
    the same session after it and before the session's next decision."""
    if decision.get("turn") and any(load.get("turn") for load in loads):
        return {load["skill"] for load in loads if load.get("turn") == decision["turn"]}
    later = [other["at"] for other in decisions if other["session"] == decision["session"] and other["at"] > decision["at"]]
    end = min(later) if later else "9999"
    return {load["skill"] for load in loads
            if load["session"] == decision["session"] and decision["at"] <= load["at"] < end}


def report(project, package_root, since_days=None):
    events, invalid = read_events(project)
    if since_days is not None:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=since_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
        events = [event for event in events if event["at"] >= cutoff]
    loads = [event for event in events if event["type"] == "skill_loaded"]
    usage = {}
    for load in loads:
        row = usage.setdefault(load["skill"], {"skill": load["skill"], "loads": 0, "sessions": set(), "last_loaded": load["at"]})
        row["loads"] += 1
        row["sessions"].add(load["session"])
        row["last_loaded"] = max(row["last_loaded"], load["at"])
    rows = [dict(row, sessions=len(row["sessions"])) for row in sorted(usage.values(), key=lambda row: (-row["loads"], row["skill"]))]
    result = {"scope": "Local evidence recorded by this package's hooks and router; other hosts and sessions are not covered.",
              "since_days": since_days, "events": len(events), "invalid_lines": invalid,
              "skills": {"usage": rows, "never_loaded": sorted(set(catalog_names(package_root)) - set(usage))},
              "jev": {}}
    decisions = [event for event in events if event["type"] == "jev_decision" and event["question"] == "suggested_skill"
                 and event["status"] in {"ok", "abstained"} and "top_probability" in event]
    if decisions:
        verdicts = []
        suggested_not_loaded, loaded_not_suggested = Counter(), Counter()
        for decision in decisions:
            loaded = loads_for(decision, loads, decisions)
            choice = decision.get("choice", "none")
            agreed = (choice in loaded) if choice != "none" else not loaded
            verdicts.append((decision, agreed))
            if choice != "none" and choice not in loaded:
                suggested_not_loaded[choice] += 1
            for skill in loaded - {choice}:
                loaded_not_suggested[skill] += 1
        thresholds = []
        for minimum in THRESHOLDS:
            kept = [agreed for decision, agreed in verdicts if decision["top_probability"] >= minimum]
            thresholds.append({"min_top_probability": minimum, "coverage": round(len(kept) / len(verdicts), 4),
                               "agreement": round(sum(kept) / len(kept), 4) if kept else None})
        result["jev"]["suggested_skill"] = {
            "decisions": len(verdicts), "agreed": sum(agreed for _, agreed in verdicts),
            "disagreed": sum(not agreed for _, agreed in verdicts), "thresholds": thresholds,
            "suggested_not_loaded": dict(suggested_not_loaded.most_common(20)),
            "loaded_not_suggested": dict(loaded_not_suggested.most_common(20)),
            "interpretation": "Agreement with the agent is not accuracy: the agent is the incumbent, not ground truth. "
                              "Review disagreements before acting on them."}
    kinds = [event for event in events if event["type"] == "jev_decision" and event["question"] == "prompt_kind" and event.get("choice")]
    if kinds:
        counts = Counter(event["choice"] for event in kinds)
        corrections_after = Counter()
        for event in kinds:
            if event["choice"] != "correction":
                continue
            earlier = [other for other in kinds if other["session"] == event["session"] and other["at"] < event["at"]]
            if earlier:
                for skill in loads_for(max(earlier, key=lambda other: other["at"]), loads, kinds):
                    corrections_after[skill] += 1
        result["jev"]["prompt_kind"] = {
            "counts": dict(counts), "correction_rate": round(counts["correction"] / len(kinds), 4),
            "corrections_after_skill": dict(corrections_after.most_common(20)),
            "interpretation": "A correction after a skill was loaded is a cue to review that skill, not proof that it caused the rework."}
    statuses = Counter(event["status"] for event in events if event["type"] == "jev_decision")
    if statuses:
        result["jev"]["statuses"] = dict(sorted(statuses.items()))
    return result


def markdown(result):
    lines = ["# Local evidence report", "", result["scope"], ""]
    lines += ["| Skill | Loads | Sessions | Last loaded |", "|---|---:|---:|---|"]
    lines += ["| {skill} | {loads} | {sessions} | {last_loaded} |".format(**row) for row in result["skills"]["usage"]]
    if not result["skills"]["usage"]:
        lines.append("| No recorded skill loads | 0 | 0 | |")
    lines += ["", "Never loaded in this window: " + (", ".join(result["skills"]["never_loaded"]) or "none") + "."]
    routing = result["jev"].get("suggested_skill")
    if routing:
        lines += ["", "## Jev skill suggestions", "",
                  "Decisions: {decisions}; agreed with the skills loaded: {agreed}; disagreed: {disagreed}.".format(**routing), "",
                  "| Minimum top probability | Coverage | Agreement |", "|---:|---:|---:|"]
        lines += ["| {min_top_probability} | {coverage} | {agreement} |".format(**row) for row in routing["thresholds"]]
        for label, key in (("Suggested but not loaded in that turn", "suggested_not_loaded"),
                           ("Loaded but not suggested in that turn", "loaded_not_suggested")):
            counts = routing.get(key) or {}
            lines += ["", label + ": " + (", ".join(name + " (" + str(count) + ")" for name, count in counts.items()) or "none") + "."]
        lines += ["", routing["interpretation"]]
    kinds = result["jev"].get("prompt_kind")
    if kinds:
        lines += ["", "## Prompt kinds", "",
                  "Counts: " + ", ".join(name + " " + str(count) for name, count in sorted(kinds["counts"].items())) + ".",
                  "Correction rate: " + str(kinds["correction_rate"]) + ".", "",
                  "Skills loaded just before a correction: " + (", ".join(name + " (" + str(count) + ")" for name, count in kinds["corrections_after_skill"].items()) or "none") + ".",
                  "", kinds["interpretation"]]
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("record", "report"))
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    parser.add_argument("--package-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--since-days", type=int)
    parser.add_argument("--format", choices=("json", "markdown"), default="json")
    args = parser.parse_args(argv)
    try:
        if args.action == "record":
            raw = sys.stdin.read(65537)
            if len(raw) > 65536:
                raise EvidenceError("input_too_large")
            result = {"status": "recorded", "event": record(args.project_root, json.loads(raw))}
        else:
            result = report(args.project_root, args.package_root, args.since_days)
        print(markdown(result) if args.action == "report" and args.format == "markdown" else json.dumps(result, indent=2))
        return 0
    except EvidenceError as error:
        print(json.dumps({"status": "error", "code": str(error)}))
        return 1
    except (OSError, ValueError):
        print(json.dumps({"status": "evidence_unavailable"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
