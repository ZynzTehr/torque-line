#!/usr/bin/env python3
"""Record measured model usage and review local prompting evidence, without network access."""

import argparse
from contextlib import contextmanager
from datetime import date
from decimal import Decimal, InvalidOperation, localcontext
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import time


LEDGER = ".agent-usage.jsonl"
LOCK = ".agent-usage.lock"
MAX_LEDGER = 8 * 1024 * 1024
# input_tokens is the total input; cached reads and cache writes are subsets of it.
TOKEN_FIELDS = ("input_tokens", "output_tokens", "cached_input_tokens", "cache_write_input_tokens")
RATE_FIELDS = ("input_rate_per_million_usd", "output_rate_per_million_usd", "cached_input_rate_per_million_usd",
               "cache_write_rate_per_million_usd")
ANTHROPIC_FIELDS = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")
FIELDS = {"event_id", "provider", "model", "session_id", "prompt_id", *TOKEN_FIELDS, *RATE_FIELDS,
          "provider_cost_usd", "pricing_source", "pricing_date"}
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}\Z")


class UsageError(ValueError):
    pass


def decode(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise UsageError("duplicate_json_key")
            result[key] = value
        return result
    def reject(value):
        raise UsageError("invalid_json_number")
    try:
        # Decimal keeps a JSON price such as 0.1234567890123456789 exact.
        return json.loads(raw, object_pairs_hook=unique, parse_constant=reject, parse_float=Decimal)
    except (ValueError, UnicodeError, RecursionError):
        raise UsageError("invalid_json") from None


def from_anthropic(value):
    """Map Anthropic's usage fields onto the ledger's total-input model.

    Anthropic reports input_tokens after the last cache breakpoint only; the
    total input is input_tokens + cache_creation_input_tokens + cache_read_input_tokens.
    """
    if not isinstance(value, dict) or "anthropic_usage" not in value:
        return value
    usage = value["anthropic_usage"]
    if not isinstance(usage, dict) or set(usage) - set(ANTHROPIC_FIELDS) - {"server_tool_use", "service_tier", "cache_creation"}:
        raise UsageError("invalid_anthropic_usage")
    counts = {field: usage.get(field, 0) for field in ANTHROPIC_FIELDS}
    if any(type(count) is not int or count < 0 for count in counts.values()):
        raise UsageError("invalid_anthropic_usage")
    event = {key: item for key, item in value.items() if key != "anthropic_usage"}
    event.update({"input_tokens": counts["input_tokens"] + counts["cache_creation_input_tokens"] + counts["cache_read_input_tokens"],
                  "cached_input_tokens": counts["cache_read_input_tokens"],
                  "cache_write_input_tokens": counts["cache_creation_input_tokens"],
                  "output_tokens": counts["output_tokens"]})
    return event


def money(value):
    if value is None:
        return None
    if type(value) not in (str, int, float, Decimal) or len(str(value)) > 80:
        raise UsageError("invalid_money")
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        raise UsageError("invalid_money") from None
    if not number.is_finite() or number < 0 or number > Decimal("1000000000") or number.as_tuple().exponent < -18:
        raise UsageError("invalid_money")
    return format(number.normalize(), "f")


def validate_event(value):
    if not isinstance(value, dict) or set(value) - FIELDS:
        raise UsageError("invalid_event_fields")
    result = {}
    for field in ("event_id", "provider", "model", "session_id", "prompt_id"):
        item = value.get(field)
        if item is None and field in {"session_id", "prompt_id"}:
            result[field] = None
        elif not isinstance(item, str) or not IDENTIFIER.fullmatch(item):
            raise UsageError("invalid_identifier")
        else:
            result[field] = item
    for field in TOKEN_FIELDS:
        item = value.get(field)
        if item is not None and (type(item) is not int or not 0 <= item <= 10**15):
            raise UsageError("invalid_token_count")
        result[field] = item
    cached, written, total = result["cached_input_tokens"], result["cache_write_input_tokens"], result["input_tokens"]
    if (cached is not None or written is not None) and (total is None or (cached or 0) + (written or 0) > total):
        raise UsageError("cached_tokens_must_be_known_subset")
    for field in (*RATE_FIELDS, "provider_cost_usd"):
        result[field] = money(value.get(field))
    source = value.get("pricing_source")
    if source is not None and (not isinstance(source, str) or not 1 <= len(source) <= 500 or any(ord(char) < 32 for char in source)):
        raise UsageError("invalid_pricing_source")
    result["pricing_source"] = source
    pricing_date = value.get("pricing_date")
    if pricing_date is not None:
        try:
            if not isinstance(pricing_date, str) or date.fromisoformat(pricing_date).isoformat() != pricing_date:
                raise ValueError
        except ValueError:
            raise UsageError("invalid_pricing_date") from None
    result["pricing_date"] = pricing_date
    return result


def project_root(path):
    supplied = Path(path)
    if supplied.is_symlink() or not supplied.is_dir():
        raise UsageError("invalid_project_directory")
    return supplied.resolve()


def checked_read(path, limit, private=False):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
        raise UsageError("unsafe_or_oversized_file")
    if private and os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
        raise UsageError("usage_file_not_private")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as stream:
        content = stream.read(limit + 1)
    if len(content) > limit:
        raise UsageError("oversized_file")
    return content


@contextmanager
def exclusive_lock(root, name=LOCK):
    """Cross-platform exclusive lock on a private file in root; shared with evidence.py."""
    path = root / name
    if path.is_symlink():
        raise UsageError("unsafe_lock")
    fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or (os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077)):
            raise UsageError("unsafe_lock")
        if info.st_size == 0:
            os.write(fd, b"0")
        deadline = time.monotonic() + 3
        locked = False
        while not locked:
            try:
                if os.name == "nt":
                    import msvcrt
                    os.lseek(fd, 0, os.SEEK_SET)
                    msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                locked = True
            except (BlockingIOError, OSError):
                if time.monotonic() >= deadline:
                    raise UsageError("usage_ledger_busy")
                time.sleep(0.02)
        try:
            yield
        finally:
            if os.name == "nt":
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


def read_events(root):
    raw = checked_read(root / LEDGER, MAX_LEDGER, private=True)
    if raw is None:
        return []
    events, seen = [], set()
    for line in raw.splitlines():
        if not line.strip():
            continue
        event = validate_event(decode(line))
        if event["event_id"] in seen or len(events) >= 20000:
            raise UsageError("duplicate_or_excessive_usage_events")
        seen.add(event["event_id"])
        events.append(event)
    return events


def record(project, event):
    root, event = project_root(project), validate_event(event)
    with exclusive_lock(root):
        events = read_events(root)
        for existing in events:
            if existing["event_id"] == event["event_id"]:
                if existing != event:
                    raise UsageError("event_id_conflict")
                return {"status": "duplicate", "event_id": event["event_id"]}
        if len(events) >= 20000:
            raise UsageError("usage_ledger_full")
        events.append(event)
        encoded = ("\n".join(json.dumps(item, sort_keys=True, separators=(",", ":")) for item in events) + "\n").encode("utf-8")
        if len(encoded) > MAX_LEDGER:
            raise UsageError("usage_ledger_full")
        fd, temporary = tempfile.mkstemp(prefix=".agent-usage-", suffix=".tmp", dir=root)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(encoded)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, root / LEDGER)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    return {"status": "recorded", "event_id": event["event_id"]}


def calculated_cost(event):
    inputs, outputs, cached, written = (event[field] for field in TOKEN_FIELDS)
    if inputs is None or outputs is None:
        return None
    input_rate, output_rate, cached_rate, write_rate = (None if event[field] is None else Decimal(event[field]) for field in RATE_FIELDS)
    if outputs and output_rate is None:
        return None
    if inputs and cached is None:
        # Unknown cache usage cannot be priced unless caching has no price effect.
        if input_rate is None or cached_rate != input_rate:
            return None
        cached = 0
    # A null cache-write count means the provider does not bill cache writes separately.
    cached, written = cached or 0, written or 0
    uncached = inputs - cached - written
    if (uncached and input_rate is None) or (cached and cached_rate is None) or (written and write_rate is None):
        return None
    with localcontext() as context:
        context.prec = 64
        return (Decimal(uncached) * (input_rate or 0) + Decimal(cached) * (cached_rate or 0)
                + Decimal(written) * (write_rate or 0) + Decimal(outputs) * (output_rate or 0)) / Decimal(1000000)


def decimal_sum(values):
    with localcontext() as context:
        context.prec = 64
        return format(sum(values, Decimal(0)), "f") if values else None


def aggregate(events):
    count = len(events)
    tokens = {}
    for field in TOKEN_FIELDS:
        values = [item[field] for item in events if item[field] is not None]
        tokens[field] = {"known_sum": sum(values) if values else None,
                         "total": sum(values) if count and len(values) == count else None,
                         "measured_events": len(values), "unknown_events": count - len(values)}
    reported, calculated, selected = [], [], []
    selected_calculated = 0
    for event in events:
        provider = None if event["provider_cost_usd"] is None else Decimal(event["provider_cost_usd"])
        derived = calculated_cost(event)
        if provider is not None:
            reported.append(provider)
            selected.append(provider)
        elif derived is not None:
            selected.append(derived)
            selected_calculated += 1
        if derived is not None:
            calculated.append(derived)
    return {"events": count, "tokens": tokens, "cost": {
        "known_usd": decimal_sum(selected), "total_usd": decimal_sum(selected) if count and len(selected) == count else None,
        "provider_reported_usd": decimal_sum(reported), "rate_calculated_usd": decimal_sum(calculated),
        "provider_reported_events": len(reported), "rate_calculated_events": len(calculated),
        "selected_rate_calculated_events": selected_calculated, "unknown_events": count - len(selected),
        "coverage": len(selected) / count if count else None}}


def prompt_observations(root, events):
    unavailable = {"status": "unavailable", "analyzed_entries": 0, "observations": [], "usage_linked_prompt_ids": []}
    # The usage numbers do not depend on the prompt log; a bad log only skips the review.
    try:
        raw = checked_read(root / "prompt-log.md", 5 * 1024 * 1024)
    except UsageError as error:
        return {**unavailable, "reason": str(error)}
    if raw is None:
        return unavailable
    try:
        text = raw.decode("utf-8")
    except UnicodeError:
        return {**unavailable, "reason": "invalid_prompt_log_encoding"}
    pattern = re.compile(r"<!-- prompt-log-entry (\{[^\n]*\}) -->\s*\n(?P<fence>`{3,})(?:text)?\n(?P<body>.*?)\n(?P=fence)(?=\n|$)", re.DOTALL)
    matches = list(pattern.finditer(text))
    entries, invalid_entries = [], 0
    for match in matches[-200:]:
        try:
            metadata = decode(match.group(1))
        except UsageError:
            invalid_entries += 1
            continue
        identifier = metadata.get("id") if isinstance(metadata, dict) else None
        if (not isinstance(identifier, str) or not IDENTIFIER.fullmatch(identifier)
                or not isinstance(metadata.get("reply_to"), (str, type(None))) or not isinstance(metadata.get("role"), (str, type(None)))):
            invalid_entries += 1
            continue
        entries.append((identifier, match.group("body")[:32768], metadata.get("text_kind"), metadata.get("role"), metadata.get("reply_to")))
    # Agent replies answer prompts; they are evidence about a prompt's outcome, not prompts to review.
    replies = [entry for entry in entries if entry[3] == "assistant"]
    entries = [entry[:3] for entry in entries if entry[3] != "assistant"]
    observations, by_digest = {}, {}
    def observe(name, identifier):
        observations.setdefault(name, []).append(identifier)
    lengths = {identifier: len(text) for identifier, text, _ in entries}
    for _, text, _, _, reply_to in replies:
        if reply_to in lengths and lengths[reply_to] < 300 and len(text) >= 6000 and reply_to not in observations.get("long_reply_to_short_prompt", []):
            observe("long_reply_to_short_prompt", reply_to)
    for identifier, text, kind in entries:
        normalized = " ".join(text.casefold().split())
        if normalized in {"continue", "continue.", "yes", "yes.", "go ahead", "go ahead.", "do it", "do it."}:
            observe("context_dependent_followup", identifier)
        if re.search(r"\b(don't stop|do not stop|until done|run forever)\b", normalized):
            observe("open_ended_execution_language", identifier)
        if len(text) >= 4000:
            observe("long_prompt_review_for_repeated_context", identifier)
        key = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
        if normalized and key in by_digest:
            observe("repeated_prompt_text", identifier)
        by_digest[key] = identifier
    linked = {event["prompt_id"] for event in events if event["prompt_id"] is not None}
    return {"status": "observed", "analyzed_entries": len(entries), "reply_entries": len(replies), "detected_entries": len(matches),
            "invalid_metadata_entries": invalid_entries,
            "review_limited_to_last_200": len(matches) > 200,
            "summary_entries": sum(kind == "summary" for _, _, kind in entries),
            "observations": [{"kind": kind, "count": len(ids), "prompt_ids": ids[:20]} for kind, ids in sorted(observations.items())],
            "usage_linked_prompt_ids": sorted({identifier for identifier, _, _ in entries} & linked),
            "interpretation": "Heuristic review cues only. Followups may be appropriate in context; length and repetition do not measure quality, waste, tokens, or cost. A long reply to a short prompt is a cue to state the wanted format or stopping point, not proof of waste."}


def report(project, budget_usd=None):
    root = project_root(project)
    events = read_events(root)
    groups = {}
    for event in events:
        groups.setdefault((event["provider"], event["model"]), []).append(event)
    result = {"scope": "Recorded usage events only; unrecorded providers, sessions, and calls are unknown.",
            "summary": aggregate(events),
            "models": [{"provider": provider, "model": model, **aggregate(items)} for (provider, model), items in sorted(groups.items())],
            "prompt_review": prompt_observations(root, events),
            "limitations": ["Provider-reported and rate-calculated subtotals can overlap; never add them together.",
                            "Known cost uses the provider-reported cost when present, otherwise a rate calculation. It is not an all-account bill.",
                            "Cached input is a subset of input; reasoning tokens already included in output are not added again.",
                            "No pricing defaults, character-based token estimates, provider queries, or task-quality scores are used."]}
    if budget_usd is not None:
        budget = Decimal(money(budget_usd))
        cost = result["summary"]["cost"]
        with localcontext() as context:
            context.prec = 64
            remaining = format(budget - Decimal(cost["total_usd"]), "f") if cost["total_usd"] is not None else None
        result["budget_comparison"] = {"budget_usd": format(budget, "f"), "known_spend_usd": cost["known_usd"],
                                       "remaining_usd": remaining, "unknown_cost_events": cost["unknown_events"],
                                       "scope": "Comparison only, without enforcement. Remaining covers recorded events only; unrecorded spending is unknown."}
    return result


def markdown(result):
    summary = result["summary"]
    def shown(value):
        return str(value) if value is not None else "unknown"
    lines = ["# Usage and prompt review", "", result["scope"], "", "| Provider / model | Events | Known USD | Provider-reported USD | Rate-calculated USD | Unknown-cost events |", "|---|---:|---:|---:|---:|---:|"]
    for model in result["models"]:
        cost = model["cost"]
        lines.append("| " + model["provider"] + " / " + model["model"] + " | " + str(model["events"]) + " | " + shown(cost["known_usd"]) + " | " + shown(cost["provider_reported_usd"]) + " | " + shown(cost["rate_calculated_usd"]) + " | " + str(cost["unknown_events"]) + " |")
    if not result["models"]:
        lines.append("| No recorded usage | 0 | unknown | unknown | unknown | unknown |")
    lines.extend(["", "Known recorded cost: " + str(summary["cost"]["known_usd"] if summary["cost"]["known_usd"] is not None else "unknown") + " USD. This is a partial subtotal when coverage is incomplete.", "",
                  "Input tokens, measured subtotal: " + shown(summary["tokens"]["input_tokens"]["known_sum"]) + ". Output tokens, measured subtotal: " + shown(summary["tokens"]["output_tokens"]["known_sum"]) + ". Unknown input/output measurement events: " + str(summary["tokens"]["input_tokens"]["unknown_events"]) + "/" + str(summary["tokens"]["output_tokens"]["unknown_events"]) + ".", "",
                  "Prompt entries reviewed: " + str(result["prompt_review"]["analyzed_entries"]) + "."])
    for item in result["prompt_review"]["observations"]:
        lines.extend(["", "- " + item["kind"] + ": " + ", ".join(item["prompt_ids"]) + ". Review the surrounding task before drawing conclusions."])
    if "budget_comparison" in result:
        budget = result["budget_comparison"]
        lines.extend(["", "Comparison budget: " + budget["budget_usd"] + " USD. Remaining against recorded events: " + shown(budget["remaining_usd"]) + " USD.", "", budget["scope"]])
    lines.append("")
    lines.extend("- " + item for item in result["limitations"])
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("record", "report"))
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument("--format", choices=("json", "markdown"), default="json")
    parser.add_argument("--budget-usd", help="Optional comparison against recorded costs; does not enforce a budget")
    args = parser.parse_args(argv)
    try:
        if args.action == "record":
            raw = sys.stdin.buffer.read(65537)
            if len(raw) > 65536:
                raise UsageError("input_too_large")
            result = record(args.project_root, from_anthropic(decode(raw)))
        else:
            result = report(args.project_root, args.budget_usd)
        print(markdown(result) if args.action == "report" and args.format == "markdown" else json.dumps(result, indent=2), end="\n")
        return 0
    except UsageError as error:
        # UsageError codes are fixed identifiers and never contain input values.
        print(json.dumps({"status": "error", "code": str(error)}))
        return 1
    except (OSError, ValueError, TypeError, KeyError):
        print(json.dumps({"status": "usage_input_or_storage_unavailable"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
