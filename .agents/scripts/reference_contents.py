#!/usr/bin/env python3
"""Add or refresh Contents lists in long Markdown reference documents."""

import argparse
from dataclasses import dataclass
import html
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import unicodedata
from urllib.parse import unquote, urlsplit


START = "<!-- reference-contents:start -->"
END = "<!-- reference-contents:end -->"
SCOPES = ("skills", "rules", "agents")
ROOT_DOCS = {"README.md", "SETUP.md", "HOOKS.md", "JEV.md", "USAGE.md", "HARNESS.md",
             "RULES-INDEX.md", "SECURITY-CHECKS.md", "SESSIONS.md", "WORKFLOW-CHECKS.md", "autonomy-config.md"}
TOC_NAMES = {"contents", "table of contents"}
TOC_ITEM = re.compile(r"^\s*(?:[-*+] |\d+[.)] )\[([^\n]*)\]\(#[^\n]*\)\s*$")


@dataclass
class Heading:
    line: int
    end: int
    level: int
    text: str


def frontmatter_end(lines):
    if lines and lines[0].strip().lstrip("\ufeff") == "---":
        for index in range(1, len(lines)):
            if lines[index].strip() in {"---", "..."}:
                return index + 1
        raise ValueError("Unclosed frontmatter")
    return 0


def visible_lines(lines):
    """Yield prose lines outside frontmatter, fenced code, and HTML comments."""
    fence, comment = None, False
    for index in range(frontmatter_end(lines), len(lines)):
        line = lines[index].rstrip("\r\n")
        if fence:
            if re.fullmatch(r"\s*" + re.escape(fence[0]) + "{" + str(fence[1]) + r",}\s*", line):
                fence = None
            continue
        opening = re.match(r"^\s*(`{3,}|~{3,})(.*)$", line)
        if opening:
            fence = (opening[1][0], len(opening[1]))
            continue
        if comment:
            if "-->" in line:
                comment = False
            continue
        if "<!--" in line:
            if "-->" not in line.split("<!--", 1)[1]:
                comment = True
            line = line.split("<!--", 1)[0]
        yield index, line


def headings(text):
    lines = text.splitlines(keepends=True)
    result, previous = [], None
    for index, line in visible_lines(lines):
        match = re.match(r"^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$", line)
        if match:
            title = re.sub(r"[ \t]+#+[ \t]*$", "", match[2] or "").strip()
            result.append(Heading(index, index + 1, len(match[1]), title))
        elif previous and previous[0] == index - 1 and previous[1].strip() and re.fullmatch(r" {0,3}(?:=+|-+)[ \t]*", line):
            if not re.match(r"^ {4}|^\s*(?:[-*+] |\d+[.)] |>)", previous[1]):
                result.append(Heading(index - 1, index + 1, 1 if "=" in line else 2, previous[1].strip()))
        previous = None if match else (index, line)
    return result


def plain_heading(value):
    codes = []
    def code(match):
        codes.append(match[2])
        return "\x00" + str(len(codes) - 1) + "\x00"
    value = re.sub(r"(`+)(.+?)\1", code, value)
    value = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", value)
    value = re.sub(r"</?[A-Za-z][A-Za-z0-9]*(?:\s[^<>]*|\s*/?)>", "", value)
    value = re.sub(r"(?<!\w)(__|_)(?=\S)(.+?)(?<=\S)\1(?!\w)", r"\2", value)
    value = value.replace("*", "").replace("~~", "")
    value = re.sub(r"\\([!\"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~])", r"\1", value)
    value = re.sub(r"\x00(\d+)\x00", lambda match: codes[int(match[1])], value)
    return html.unescape(value)


def slug(value):
    value = plain_heading(value).lower()
    return "".join("-" if char.isspace() else char for char in value
                   if char.isalnum() or unicodedata.category(char).startswith("M") or char in "_-" or char.isspace())


def label(value):
    value = html.escape(plain_heading(value), quote=False)
    return re.sub(r"([\\\[\]*_`])", r"\\\1", value)


def strip_contents(text):
    """Remove only a managed block or a recognisable list-only legacy TOC."""
    lines = text.splitlines(keepends=True)
    visible = {index for index, _ in visible_lines(lines)}
    starts = [index for index, line in enumerate(lines) if index in visible and line.strip() == START]
    if starts:
        if len(starts) != 1:
            raise ValueError("Multiple managed Contents blocks")
        start = starts[0]
        finish = next((index + 1 for index in range(start + 1, len(lines)) if index in visible and lines[index].strip() == END), None)
        if finish is None:
            raise ValueError("Unclosed managed Contents block")
        if finish < len(lines) and not lines[finish].strip():
            finish += 1
        body = "".join(lines[:start] + lines[finish:])
        block = "".join(lines[start:finish])
        title = next((head.text for head in headings(block) if plain_heading(head.text).lower() in TOC_NAMES), "Contents")
        numbered = bool(re.search(r"^\d+[.)] \[", block, re.MULTILINE))
        return body, start, title, numbered, "managed"
    if any(index in visible and line.strip() == END for index, line in enumerate(lines)):
        raise ValueError("Orphaned managed Contents marker")
    for head in headings(text):
        if plain_heading(head.text).lower() not in TOC_NAMES:
            continue
        finish, found, numbered = head.end, False, False
        while finish < len(lines):
            line = lines[finish].rstrip("\r\n")
            if not line.strip():
                finish += 1
            elif finish in visible and TOC_ITEM.fullmatch(line):
                found = True
                numbered = numbered or bool(re.match(r"^\d+[.)] ", line))
                finish += 1
            else:
                break
        if found:
            return "".join(lines[:head.line] + lines[finish:]), head.line, head.text, numbered, "existing"
    return text, None, "Contents", False, "new"


def update_contents(text, threshold=100):
    body, position, title, numbered, kind = strip_contents(text)
    # Removing our own list prevents a previously short document from becoming
    # eligible merely because a generated TOC added lines.
    original_lines = len(body.splitlines()) if kind == "managed" else len(text.splitlines())
    if original_lines <= threshold:
        return text, {"status": "short", "original_lines": original_lines}
    found = headings(body)
    lines = body.splitlines(keepends=True)
    has_title = bool(found) and not any(line.strip() for line in lines[frontmatter_end(lines):found[0].line])
    selected = found[1:] if has_title and len(found) > 1 else found
    if not selected:
        return text, {"status": "no_sections", "original_lines": original_lines}
    if position is None:
        position = found[0].end if has_title and len(found) == 1 else selected[0].line
        if has_title and len(found) == 1:
            while position < len(lines) and not lines[position].strip():
                position += 1
    newline = "\r\n" if "\r\n" in text else "\n"
    occupied, anchors, inserted = set(), {}, False
    def allocate(value):
        base = slug(value)
        candidate, suffix = base, 0
        while candidate in occupied:
            suffix += 1
            candidate = base + "-" + str(suffix)
        occupied.add(candidate)
        return candidate
    for head in found:
        if not inserted and head.line >= position:
            allocate(title)
            inserted = True
        anchors[head.line] = allocate(head.text)
    base_level = min(head.level for head in selected)
    items = []
    for head in selected:
        caption = label(head.text)
        if numbered:
            caption = re.sub(r"^\d+[.)]\s+", "", caption)
        indent = ("   " if numbered else "  ") * max(0, head.level - base_level)
        items.append(indent + ("1. " if numbered else "- ") + "[" + caption + "](#" + anchors[head.line] + ")")
    block = newline.join([START, "## " + title, "", *items, END, "", ""])
    updated = "".join(lines[:position]) + block + "".join(lines[position:])
    return updated, {"status": "unchanged" if updated == text else kind, "original_lines": original_lines, "headings": len(selected)}


def safe_markdown(root, path):
    path = Path(os.path.abspath(path))
    try:
        relative = path.relative_to(root)
    except ValueError:
        return None
    if path.suffix.lower() != ".md" or not path.is_file():
        return None
    if path.name in {"SKILL.md", "AGENTS.md"}:
        return None
    if len(relative.parts) == 1:
        if relative.name not in ROOT_DOCS:
            return None
    elif relative.parts[0] not in SCOPES:
        return None
    # Top-level rules and agent definitions are entrypoints, not companions.
    elif relative.parts[0] in {"rules", "agents"} and len(relative.parts) == 2:
        return None
    if any(component.is_symlink() for component in (path, *path.parents) if component == root or root in component.parents):
        raise ValueError("Symlink Markdown path: " + str(relative))
    return path


def local_links(text):
    prose = "\n".join(line for _, line in visible_lines(text.splitlines(keepends=True)))
    destinations = re.findall(r"!?\[[^\n]*?\]\(\s*(<[^>]+>|[^\s)]+)", prose)
    destinations += re.findall(r"^ {0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)", prose, re.MULTILINE)
    for destination in destinations:
        parsed = urlsplit(destination.strip("<>"))
        if not parsed.scheme and not parsed.netloc and parsed.path:
            yield unquote(parsed.path)


def discover(root):
    root = Path(root).resolve()
    readers = {root / name for name in ROOT_DOCS | {"AGENTS.md"} if (root / name).is_file()}
    candidates = {path for name in ROOT_DOCS if (path := safe_markdown(root, root / name)) is not None}
    for scope in SCOPES:
        if not (root / scope).exists():
            continue
        for path in (root / scope).rglob("*.md"):
            if path.is_symlink():
                raise ValueError("Symlink Markdown path")
            readers.add(path)
            if "references" in path.relative_to(root).parts:
                candidate = safe_markdown(root, path)
                if candidate:
                    candidates.add(candidate)
    manifest = json.loads((root / "resources.json").read_text(encoding="utf-8"))
    for owner, targets in manifest.get("resources", {}).items():
        for target in targets:
            candidate = safe_markdown(root, (root / owner).parent / target)
            if candidate:
                candidates.add(candidate)
    for owner in readers:
        for target in local_links(owner.read_text(encoding="utf-8")):
            candidate = safe_markdown(root, owner.parent / target)
            if candidate:
                candidates.add(candidate)
    return sorted(candidates)


def process(root, write=False):
    records = []
    for path in discover(root):
        original = path.read_bytes()
        updated, info = update_contents(original.decode("utf-8"))
        info["path"] = str(path.relative_to(root))
        records.append(info)
        if write and updated.encode("utf-8") != original:
            if path.read_bytes() != original:
                raise ValueError("Reference changed during processing: " + str(path))
            mode = stat.S_IMODE(path.stat().st_mode)
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".contents-", delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(updated.encode("utf-8"))
            try:
                temporary.chmod(mode)
                os.replace(temporary, path)
            finally:
                temporary.unlink(missing_ok=True)
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    records = process(root, args.write)
    changed = [record for record in records if record["status"] in {"new", "existing", "managed"}]
    print(json.dumps({"references": len(records), "long_references": sum(record["original_lines"] > 100 for record in records),
                      "changed": len(changed), "files": changed}, indent=2))
    return 1 if args.check and changed else 0


if __name__ == "__main__":
    raise SystemExit(main())
