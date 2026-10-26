#!/usr/bin/env python3
"""Check package metadata and syntax without executing bundled code or installing tools."""

import argparse
import ast
import datetime
import hashlib
import io
import json
import keyword
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import subprocess
import sys
import tokenize


REQUIRED_FILES = (
    "AGENTS.md", "HARNESS.md", "RULES-INDEX.md", "autonomy-config.md",
    "setup.sh", "validate.sh", "scripts/validate.py", "resources.json",
    "skills/autonomy-safe/SKILL.md", "skills/autonomy-full/SKILL.md",
    "skills/choose-stack/SKILL.md", "skills/creative-direction/SKILL.md",
    "rules/principles.md", "rules/git-discipline.md", "rules/security.md",
    "rules/agent-efficiency.md", "rules/safe-research.md",
)
SKIP_DIRS = {".git", "node_modules", ".venv", "__pycache__"}
ALWAYS_ON_RULES = {"principles", "git-discipline", "security", "agent-efficiency", "safe-research"}
INSTALL_MANIFEST = ".myagent-manifest.json"
MIN_PYTHON = (3, 9)
# Optional components an installation manifest may record (see scripts/install.py COMPONENTS).
COMPONENT_NAMES = {"jev"}
LOCAL_RULES = "LOCAL-RULES.md"
# Skill provenance and lifecycle, enforced when the package ships its upstream registry.
UPSTREAMS = "licenses/upstreams.json"
NOTICES = "THIRD_PARTY_NOTICES.md"
SKILL_LICENSES = {"MIT", "Apache-2.0", "All-Rights-Reserved"}
SKILL_STATUSES = {"stable", "experimental", "outdated", "deprecated"}
# Top-level Markdown files the installer ships; tests keep this equal to install.py's list.
SHIPPED_DOCS = ("AGENTS.md", "HARNESS.md", "HOOKS.md", "JEV.md", "README.md", "RULES-INDEX.md", "SECURITY-CHECKS.md",
                "SESSIONS.md", "SETUP.md", "THIRD_PARTY_NOTICES.md", "USAGE.md", "WORKFLOW-CHECKS.md", "autonomy-config.md")
REVIEW_DAYS = 180
LISTING_BUDGET = 8000
LINK = re.compile(r"\]\(([^)\s]+)\)")
# Local secrets are never opened just to look for a shebang.
PRIVATE_NAME = re.compile(r"secret|credential|private[_-]?key|id_(?:rsa|dsa|ecdsa|ed25519)", re.IGNORECASE)
SECRET_SETTING = re.compile(r"(?:^|_)(?:API_?KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)$", re.IGNORECASE)
CAPABILITY_NOTICE = "Optional capability "


def frontmatter(text):
    """Read the package's bounded scalar metadata subset, not arbitrary YAML."""
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        raise ValueError("missing opening frontmatter delimiter")
    end = next((i for i, line in enumerate(lines[1:201], 1) if line == "---"), None)
    if end is None or len("\n".join(lines[:end + 1])) > 16384:
        raise ValueError("frontmatter must close within 200 lines and 16384 characters")
    fields = {}
    current = None
    for line in lines[1:end]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line[0].isspace():
            if current is None:
                raise ValueError("indented metadata without a parent key")
            fields[current].append(line)
            continue
        match = re.fullmatch(r"([A-Za-z][A-Za-z0-9_-]*):(?:\s+(.*))?", line)
        if not match:
            raise ValueError("invalid top-level frontmatter field")
        current, value = match.groups()
        if current in fields:
            raise ValueError("duplicate frontmatter field: " + current)
        fields[current] = [value or ""]
    return fields


def scalar(fields, key):
    values = fields.get(key)
    if not values:
        raise ValueError("missing field: " + key)
    value = values[0].strip()
    if re.fullmatch(r"[>|][+-]?", value):
        if len(values) == 1:
            raise ValueError("empty block scalar: " + key)
        return " ".join(part.strip() for part in values[1:]).strip()
    if len(values) > 1:
        raise ValueError("expected scalar field: " + key)
    if value.startswith('"'):
        try:
            decoded, end = json.JSONDecoder().raw_decode(value)
        except ValueError as error:
            raise ValueError("invalid double-quoted field: " + key) from error
        if value[end:] and not re.fullmatch(r"\s+(?:#.*)?", value[end:]):
            raise ValueError("unexpected text after quoted field: " + key)
        return decoded
    if value.startswith("'"):
        match = re.fullmatch(r"'((?:[^']|'')*)'(?:\s+#.*)?", value)
        if not match:
            raise ValueError("invalid single-quoted field: " + key)
        return match.group(1).replace("''", "'")
    value = re.split(r"\s+#", value, maxsplit=1)[0].strip()
    if not value or value[0] in "[{:*!&>|" or value in {"null", "~", "true", "false"}:
        raise ValueError("expected nonempty text scalar: " + key)
    return value


def strict_yaml(fields):
    """Hosts parse package frontmatter as strict YAML, where an unquoted value cannot hold ': ' or end with ':'."""
    def problem(value):
        value = re.split(r"\s+#", value.strip(), maxsplit=1)[0].rstrip()
        return bool(value) and value[0] not in "\"'|>" and (": " in value or value.endswith(":"))
    for key, values in fields.items():
        if values and values[0].strip():
            if problem(values[0]):
                raise ValueError("an unquoted value cannot contain ': ' or end with ':'; quote it: " + key)
            continue
        for line in values[1:]:
            match = re.fullmatch(r"  ([A-Za-z][A-Za-z0-9_-]*):\s+(.*)", line)
            if match and problem(match[2]):
                raise ValueError("an unquoted value cannot contain ': ' or end with ':'; quote it: " + key + "." + match[1])


def flag(fields, key):
    """A true/false field; absent means false."""
    values = fields.get(key)
    if not values:
        return False
    value = re.split(r"\s+#", values[0].strip(), maxsplit=1)[0].strip()
    if len(values) > 1 or value not in {"true", "false"}:
        raise ValueError("expected true or false: " + key)
    return value == "true"


def mapping(fields, key):
    """A one-level `key:` block of two-space `name: value` lines. Deeper lines
    belong to the entry above them and are not interpreted."""
    values = fields.get(key)
    if not values:
        return None
    if values[0].strip():
        raise ValueError("expected a mapping block: " + key)
    result = {}
    for line in values[1:]:
        if not line.startswith("  ") or line.startswith("   "):
            continue
        match = re.fullmatch(r"  ([A-Za-z][A-Za-z0-9_-]*):(?:\s+(.*))?", line)
        if not match:
            raise ValueError("invalid " + key + " entry")
        name, value = match[1], (match[2] or "").strip()
        if name in result:
            raise ValueError("duplicate " + key + " field: " + name)
        if len(value) >= 2 and value[0] in "'\"" and value[-1] == value[0]:
            value = value[1:-1]
        result[name] = value
    return result


def upstream_registry(root):
    path = Path(root) / UPSTREAMS
    if not path.exists():
        return None
    registry = load_json(path)
    if (not isinstance(registry, dict) or registry.get("version") != 1 or not isinstance(registry.get("upstreams"), list)
            or not isinstance(registry.get("retrieved", ""), str) or not isinstance(registry.get("extra", []), list)):
        raise ValueError("expected a version 1 upstream registry with text dates and lists of upstreams and extra files")
    ids = set()
    for upstream in registry["upstreams"]:
        if not isinstance(upstream, dict) or not {"id", "name", "repository", "license", "copyright", "license_file"} <= set(upstream):
            raise ValueError("each upstream needs id, name, repository, license, copyright, and license_file")
        if (any(not isinstance(upstream[key], str) or not upstream[key] for key in ("id", "name", "repository", "license", "copyright"))
                or not isinstance(upstream["license_file"], (str, type(None))) or not isinstance(upstream.get("warning", ""), str)):
            raise ValueError("upstream fields must be text, and license_file text or null: " + str(upstream.get("id")))
        if upstream["license"] not in SKILL_LICENSES or not upstream["repository"].startswith("https://") or upstream["id"] in ids:
            raise ValueError("invalid or duplicate upstream: " + str(upstream.get("id")))
        if upstream["license_file"] is not None:
            contained_file(Path(root), upstream["license_file"])
        ids.add(upstream["id"])
    for item in registry.get("extra", []):
        if (not isinstance(item, dict) or any(not isinstance(item.get(key), str) for key in ("path", "upstream", "source", "changes"))
                or item["upstream"] not in ids or item["changes"] not in {"modified", "none"} or not item["source"].startswith("https://")):
            raise ValueError("each extra file needs a registered upstream, an https source, and changes: modified or none")
        contained_file(Path(root), item.get("path"))
    return registry


def render_notices(root):
    """THIRD_PARTY_NOTICES.md, generated from skill frontmatter and the upstream registry."""
    root = Path(root)
    registry = upstream_registry(root)
    if registry is None:
        raise ValueError("missing " + UPSTREAMS)
    grouped = {upstream["id"]: [] for upstream in registry["upstreams"]}
    for path in sorted(root.glob("skills/*/SKILL.md")):
        fields = frontmatter(path.read_text(encoding="utf-8"))
        metadata = mapping(fields, "metadata") or {}
        source = metadata.get("source")
        if not source or source == "original":
            continue
        upstream = next((item for item in registry["upstreams"] if source.startswith(item["repository"] + "/")), None)
        if upstream is None:
            raise ValueError("no registered upstream for skill " + path.parent.name)
        location = re.sub(r"^(?:tree|blob)/[^/]+/", "", source[len(upstream["repository"]) + 1:])
        grouped[upstream["id"]].append((path.parent.name, location, metadata.get("changes", "unknown")))
    lines = ["# Third-party notices", "",
             "<!-- Generated by scripts/third_party_notices.py from skill frontmatter and licenses/upstreams.json. Edit those, then run it with --write. -->", "",
             "Most skills in this package come from the projects below. Each skill's frontmatter records its upstream `source` and `license`. "
             "`changes: modified` means its SKILL.md instructions differ from the upstream copy retrieved on " + registry.get("retrieved", "unknown") + "; "
             "every imported skill also gained a provenance block. The license texts in `licenses/` must stay with any copy of these skills. "
             "Skills whose source is `original` are this package's own work. This is a provenance record, not legal advice."]
    for upstream in registry["upstreams"]:
        rows = grouped[upstream["id"]]
        extras = [item for item in registry.get("extra", []) if item.get("upstream") == upstream["id"]]
        if not rows and not extras:
            continue
        lines += ["", "## " + upstream["name"] + " (" + upstream["license"] + ")", "",
                  "- Copyright: " + upstream["copyright"], "- Source: " + upstream["repository"]]
        if upstream["license_file"]:
            lines.append("- License text: [" + upstream["license_file"] + "](" + upstream["license_file"] + ")")
        if upstream.get("warning"):
            lines += ["", "**Warning:** " + upstream["warning"]]
        if rows:
            lines += ["", "| Skill | Upstream path | Instructions |", "|---|---|---|"]
            lines += ["| {} | `{}` | {} |".format(name, location, "modified" if changes == "modified" else "unchanged")
                      for name, location, changes in rows]
        if extras:
            lines += ["", "Other files from this source:", ""]
            lines += ["- `{}` ({}; from {})".format(item["path"], "modified" if item["changes"] == "modified" else "unchanged", item["source"])
                      for item in extras]
    return "\n".join(lines) + "\n"


def parse_profile(path):
    text = Path(path).read_text(encoding="utf-8")
    fields = frontmatter(text)
    declarations = re.findall(r"^active_profile\s*:", text, re.MULTILINE)
    if len(declarations) != 1:
        raise ValueError("expected exactly one active_profile declaration")
    if set(fields) != {"active_profile"} or len(fields["active_profile"]) != 1:
        raise ValueError("profile frontmatter must contain only one scalar active_profile")
    profile = scalar(fields, "active_profile")
    if profile not in {"safe", "full"}:
        raise ValueError("active_profile must be safe or full")
    return profile


def inspect_env_template(root):
    """A distributed template must never contain an actual secret value."""
    path = root / ".env.example"
    if not path.exists() and not path.is_symlink():
        return
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 65536:
        raise ValueError("environment template must be a bounded regular file")
    seen = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)", line)
        if not match or not SECRET_SETTING.search(match.group(1)):
            continue
        name, value = match.groups()
        if name in seen or value.strip() not in {"", "''", '""'}:
            raise ValueError(name + " must be empty and declared once in .env.example; store keys only in ignored .env")
        seen.add(name)


COMPREHENSIONS = (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)


def comprehension_scope(node):
    """The nodes a comprehension evaluates in its own scope: its targets, conditions, and every iterable but the first,
    which runs in the enclosing scope. A nested comprehension contributes only its first iterable, and a lambda only its
    default values; the rest of either runs in a scope of its own."""
    parts = [node.key, node.value] if isinstance(node, ast.DictComp) else [node.elt]
    for position, generator in enumerate(node.generators):
        parts += [generator.target] + generator.ifs + ([generator.iter] if position else [])
    while parts:
        part = parts.pop()
        yield part
        if isinstance(part, COMPREHENSIONS):
            parts.append(part.generators[0].iter)
        elif isinstance(part, ast.Lambda):
            parts += part.args.defaults + [default for default in part.args.kw_defaults if default is not None]
        elif not isinstance(part, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            parts.extend(ast.iter_child_nodes(part))


def asynchronous(node):
    """Whether a comprehension runs asynchronously: it has an async for, or an await in its own scope."""
    return any(generator.is_async for generator in node.generators) or any(
        isinstance(part, ast.Await) for part in comprehension_scope(node))


def newer_syntax(source, tree):
    """(line, what) for syntax that Python 3.9 rejects although ast.parse with a 3.9 feature_version accepts it.

    Before 3.12 (PEP 701), an f-string replacement field could not hold the quote of an f-string around it, a backslash,
    or a comment, nor break a line inside a single-quoted f-string; a conversion such as !r had to be followed at once by
    the format spec's colon or the closing brace; and a format spec could hold a replacement field whose own spec held
    none. Before 3.10 an index could not hold an unparenthesized := expression. Before 3.11 (PEP 646) neither an index nor
    a *args annotation could hold a starred expression, and an asynchronous list, set, or dict comprehension could not
    sit inside a synchronous comprehension.
    """
    for node in ast.walk(tree):
        if isinstance(node, ast.arguments) and node.vararg and isinstance(node.vararg.annotation, ast.Starred):
            return node.vararg.annotation.lineno, "a *args annotation is starred"
        if isinstance(node, COMPREHENSIONS) and not asynchronous(node):
            for part in comprehension_scope(node):
                if isinstance(part, (ast.ListComp, ast.SetComp, ast.DictComp)) and asynchronous(part):
                    return part.lineno, "an asynchronous comprehension sits inside a synchronous one"
    fstrings = hasattr(tokenize, "FSTRING_START")
    lines = io.StringIO(source).readlines()
    # quotes: for each f-string around the token, its quote and how many brackets were open where it began.
    # brackets: for each open bracket, whether it is an index, how many lambdas in it have not reached their colon, and
    # for an f-string replacement field, how deep it sits in format specs and whether its own spec has begun.
    # last: the previous token other than a line break or comment. conversion: where a !r, !s, or !a conversion ends.
    quotes, brackets, previous, last, conversion = [], [], (1, 0), None, None
    try:
        for token in tokenize.generate_tokens(io.StringIO(source).readline):
            significant = token.type not in (tokenize.NL, tokenize.COMMENT)
            if fstrings:
                # An f-string's own text belongs to it, not to its replacement fields.
                around = quotes[:-1] if token.type in (tokenize.FSTRING_MIDDLE, tokenize.FSTRING_END) else quotes
                enclosing = [quote for quote, _ in around]
                if enclosing:
                    # The text since the previous token holds any backslash line continuation.
                    (row, column), (end_row, end_column) = previous, token.start
                    gap = (lines[row - 1][column:end_column] if row == end_row else
                           lines[row - 1][column:] + "".join(lines[row:end_row - 1]) + lines[end_row - 1][:end_column])
                    text = gap + token.string
                    what = ("a comment" if token.type == tokenize.COMMENT else "a backslash" if "\\" in text else
                            "the quote of an f-string around it" if any(quote in text for quote in enclosing) else
                            "a line break inside a single-quoted f-string"
                            if "\n" in text and any(len(quote) == 1 for quote in enclosing) else None)
                    if what:
                        return token.start[0], "an f-string replacement field holds " + what
                if token.type == tokenize.FSTRING_START:
                    body = token.string.lstrip("rRfFbBuU")
                    quotes.append((body[:3] if body[:3] in ('"""', "'''") else body[:1], len(brackets)))
                elif token.type == tokenize.FSTRING_END and quotes:
                    quotes.pop()
            if conversion and significant:
                if token.start != conversion:
                    return token.start[0], "an f-string conversion is followed by a space or line break"
                conversion = None
            top = brackets[-1] if brackets else None
            if token.type == tokenize.OP and token.string in ("(", "[", "{"):
                # A bracket after a name, a closing bracket, or a string opens an index; otherwise it opens a display.
                index = token.string == "[" and last is not None and (
                    last.string in (")", "]", "}") or last.type in (tokenize.STRING, getattr(tokenize, "FSTRING_END", None))
                    or last.type == tokenize.NAME and not keyword.iskeyword(last.string))
                # A brace opens a replacement field in an f-string's own text or in a replacement field's format spec.
                field = None
                if token.string == "{" and quotes:
                    if len(brackets) == quotes[-1][1]:
                        field = 0
                    elif top["field"] is not None and top["spec"]:
                        field = top["field"] + 1
                if field == 2:
                    return token.start[0], "an f-string format spec holds a replacement field whose own spec holds another"
                brackets.append({"index": index, "lambdas": 0, "field": field, "spec": False})
            elif token.type == tokenize.OP and token.string in (")", "]", "}"):
                if brackets:
                    brackets.pop()
            elif token.type == tokenize.OP and top and top["index"] and token.string == ":=":
                return token.start[0], "an index holds an unparenthesized := expression"
            elif (token.type == tokenize.OP and top and top["index"] and not top["lambdas"] and token.string == "*"
                  and last.string in ("[", ",")):
                return token.start[0], "an index holds a starred expression"
            elif token.type == tokenize.OP and top and token.string == ":":
                if top["lambdas"]:
                    top["lambdas"] -= 1
                elif top["field"] is not None:
                    top["spec"] = True
            elif token.type == tokenize.NAME and last is not None and last.string == "!" and top and top["field"] is not None:
                conversion = token.end
            elif token.type == tokenize.NAME and token.string == "lambda" and top:
                top["lambdas"] += 1
            if significant:
                last = token
            previous = token.end
    # Some 3.12+ tokenizers raise MemoryError on valid f-strings such as f"""{x=:\n}"""; then this check has no answer.
    except (tokenize.TokenError, SyntaxError, IndexError, MemoryError, RecursionError):
        return None
    return None


def inspect_links(path):
    """Relative Markdown links must resolve. Code, URLs, anchors, and placeholders such as (url) are skipped."""
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"(?ms)^(`{3,}|~{3,}).*?^\1", "", text)
    text = re.sub(r"`[^`\n]*`", "", text)
    for target in LINK.findall(text):
        target = target.split("#", 1)[0]
        if not target or re.match(r"[A-Za-z][A-Za-z0-9+.-]*:", target) or not re.search(r"[./]", target) or target.startswith("<"):
            continue
        if not (path.parent / target).exists():
            raise ValueError("broken relative link: " + target)


def contained_file(base, name):
    if not isinstance(name, str) or not name or "\\" in name:
        raise ValueError("resource path must be a nonempty relative POSIX path")
    relative = PurePosixPath(name)
    if relative.is_absolute() or ".." in relative.parts or any(ord(c) < 32 for c in name):
        raise ValueError("resource path must stay within its declared directory: " + repr(name))
    path = base / relative
    try:
        path.resolve().relative_to(base.resolve())
    except ValueError:
        raise ValueError("resource symlink escapes its declared directory: " + name)
    if not path.is_file():
        raise ValueError("missing declared file: " + str(path))
    return path


def load_json(path):
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON key: " + key)
            result[key] = value
        return result
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_object)


def package_inventory(root):
    """An installed ownership inventory scopes checks; it is not an authenticity proof."""
    manifest = root / INSTALL_MANIFEST
    if not manifest.exists():
        return None
    contained_file(root, INSTALL_MANIFEST)
    data = load_json(manifest)
    keys = {1: {"version", "files"}, 2: {"version", "files", "components", "created"}}
    if not isinstance(data, dict) or data.get("version") not in keys or set(data) != keys[data["version"]] or not isinstance(data["files"], dict):
        raise ValueError("expected a version 1 or 2 installation ownership inventory")
    if data["version"] == 2 and (not isinstance(data["components"], list) or not set(data["components"]) <= COMPONENT_NAMES
                                 or not isinstance(data["created"], list) or not all(isinstance(item, str) for item in data["created"])):
        raise ValueError("invalid components or created entries in the installation ownership inventory")
    files = set(data["files"])
    missing = set(REQUIRED_FILES) - files
    if missing:
        raise ValueError("installation inventory omits required package files: " + ", ".join(sorted(missing)))
    modified = []
    for name, checksum in data["files"].items():
        path = contained_file(root, name)
        if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
            raise ValueError("invalid installation inventory checksum for " + name)
        if hashlib.sha256(path.read_bytes()).hexdigest() != checksum:
            modified.append(name)
    return files, sorted(modified)


def validate(root):
    errors, notices = [], []
    root = Path(root).resolve()

    def check(label, operation):
        try:
            return operation()
        except (OSError, UnicodeError, ValueError, SyntaxError, RuntimeError, subprocess.TimeoutExpired) as error:
            errors.append(label + ": " + str(error))
            return None

    for name in REQUIRED_FILES:
        check(name, lambda name=name: contained_file(root, name))
    check(".env.example", lambda: inspect_env_template(root))
    inventory, modified = check(INSTALL_MANIFEST, lambda: package_inventory(root)) or (None, [])
    all_skills = sorted(root.glob("skills/*/SKILL.md"))
    all_rules = sorted(root.glob("rules/*.md"))
    skills = [path for path in all_skills if inventory is None or path.relative_to(root).as_posix() in inventory]
    rules = [path for path in all_rules if inventory is None or path.relative_to(root).as_posix() in inventory]
    if inventory is not None:
        notices.append("Installed package checks use its ownership inventory, not a signature or proof of trust.")
        for name in modified:
            notices.append("Modified since installation (review it or reinstall): " + name)
        additions = sorted(path.relative_to(root).as_posix() for path in all_skills + all_rules if path.relative_to(root).as_posix() not in inventory)
        for addition in additions:
            notices.append("Project-local addition outside package validation (contents and dependencies not checked): " + addition)
    registry = check(UPSTREAMS, lambda: upstream_registry(root))
    available = {path.parent.name for path in all_skills}
    today = datetime.date.today()

    def inspect_provenance(fields, name, label):
        metadata = mapping(fields, "metadata") or {}
        if registry is None and not metadata:
            return
        source = metadata.get("source")
        if registry is not None and not source:
            raise ValueError("metadata.source is required: original, or the upstream URL")
        if source and source != "original":
            if not source.startswith("https://"):
                raise ValueError("metadata.source must be original or an https URL")
            if registry is None and not (root / UPSTREAMS).exists():
                raise ValueError("an imported skill needs " + UPSTREAMS + " and the license texts it names")
            if "license" not in fields or scalar(fields, "license") not in SKILL_LICENSES:
                raise ValueError("an imported skill needs license: " + ", ".join(sorted(SKILL_LICENSES)))
            if metadata.get("changes") not in {"modified", "none"}:
                raise ValueError("an imported skill needs metadata.changes: modified or none")
        status = metadata.get("status")
        if status is not None or registry is not None:
            if status not in SKILL_STATUSES:
                raise ValueError("metadata.status must be one of " + ", ".join(sorted(SKILL_STATUSES)))
            if (status == "deprecated") != ("replaced_by" in metadata):
                raise ValueError("a deprecated skill, and only a deprecated skill, names metadata.replaced_by")
            if status == "deprecated" and metadata["replaced_by"] not in available - {name}:
                raise ValueError("metadata.replaced_by must name another skill in the package")
        if "reviewed" in metadata or registry is not None:
            try:
                reviewed = datetime.date.fromisoformat(metadata.get("reviewed", ""))
            except ValueError:
                raise ValueError("metadata.reviewed must be a YYYY-MM-DD date") from None
            # A reviewer one time zone ahead may already be on the next date.
            if reviewed > today + datetime.timedelta(days=1):
                raise ValueError("metadata.reviewed is in the future")
            if (today - reviewed).days > REVIEW_DAYS:
                notices.append("Due for review (last reviewed " + reviewed.isoformat() + "): " + label)

    names, listing = {}, []
    for skill in skills:
        label = skill.relative_to(root).as_posix()
        def inspect_skill():
            contained_file(root, label)
            fields = frontmatter(skill.read_text(encoding="utf-8"))
            name, description = scalar(fields, "name"), scalar(fields, "description")
            strict_yaml(fields)
            inspect_provenance(fields, name, label)
            if not 1 <= len(name) <= 64 or name.lower() in {"my-rule", "skill name", "todo", "changeme", "untitled"}:
                raise ValueError("skill name must be meaningful and at most 64 characters")
            if not 1 <= len(description) <= 1024:
                raise ValueError("skill description must be 1 to 1024 characters")
            if name.casefold() in names:
                raise ValueError("duplicate skill name also in " + names[name.casefold()])
            names[name.casefold()] = label
            if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name):
                raise ValueError("skill name must use lowercase letters, digits, and single hyphens")
            if name != skill.parent.name:
                raise ValueError("skill name must match its folder name")
            # Claude Code and Cursor read the frontmatter flag; Codex reads only agents/openai.yaml.
            manual = flag(fields, "disable-model-invocation")
            policy = skill.parent / "agents" / "openai.yaml"
            explicit_only = policy.is_file() and re.search(r"(?m)^\s*allow_implicit_invocation:\s*false\b", policy.read_text(encoding="utf-8")) is not None
            if manual and not explicit_only:
                raise ValueError("a user-invoked skill needs agents/openai.yaml with policy.allow_implicit_invocation: false, so Codex also waits for an explicit request")
            if explicit_only and not manual:
                raise ValueError("agents/openai.yaml keeps Codex from invoking it, but the frontmatter lacks disable-model-invocation: true")
            if not manual and (mapping(fields, "metadata") or {}).get("status") != "deprecated":
                listing.append(len(name) + len(description))
        check(label, inspect_skill)
        for document in sorted(skill.parent.rglob("*.md")):
            relative = document.relative_to(root).as_posix()
            if "node_modules" not in document.parts and (inventory is None or relative in inventory):
                check(relative, lambda document=document: inspect_links(document))
    if not skills:
        errors.append("no skill manifests found")
    # The docs the installer ships, too: in an installed copy, a link to a file it does not ship is broken.
    # Only these names are read; the private prompt-log.md and its archives are never opened.
    for relative in SHIPPED_DOCS:
        document = root / relative
        if document.is_file() and (inventory is None or relative in inventory):
            check(relative, lambda document=document: inspect_links(document))
    if inventory is None and sum(listing) > LISTING_BUDGET:
        notices.append("Model-invocable skill listing: {:,} characters across {} skills. Hosts with small listing budgets "
                       "(Codex: 8,000 characters when the context window is unknown) may shorten or omit descriptions.".format(sum(listing), len(listing)))

    for rule in rules:
        def inspect_rule():
            contained_file(root, rule.relative_to(root).as_posix())
            fields = frontmatter(rule.read_text(encoding="utf-8"))
            strict_yaml(fields)
            unknown = set(fields) - {"trigger", "description", "globs", "glob"}
            if unknown:
                raise ValueError("unsupported rule frontmatter field(s): " + ", ".join(sorted(unknown)))
            trigger = scalar(fields, "trigger")
            if trigger not in {"always_on", "model_decision", "glob", "manual"}:
                raise ValueError("unsupported rule trigger: " + trigger)
            if rule.stem in ALWAYS_ON_RULES and trigger != "always_on":
                raise ValueError("required core rule must use trigger: always_on")
            if "description" in fields or trigger == "model_decision":
                if not scalar(fields, "description"):
                    raise ValueError("empty rule description")
            if trigger == "glob":
                keys = set(fields) & {"globs", "glob"}
                if len(keys) != 1:
                    raise ValueError("glob trigger needs exactly one globs or glob string")
                patterns = scalar(fields, next(iter(keys)))
                if any(not part.strip() for part in patterns.split(",")):
                    raise ValueError("glob patterns must be a nonempty comma-separated string")
            elif set(fields) & {"globs", "glob"}:
                raise ValueError("glob patterns require trigger: glob")
        check(rule.relative_to(root).as_posix(), inspect_rule)

    def inspect_index():
        index = (root / "RULES-INDEX.md").read_text(encoding="utf-8")
        links = re.findall(r"\[[^\]]*\]\((rules/[^\s)]+)\)", index)
        actual = {path.relative_to(root).as_posix() for path in rules}
        for link in links:
            contained_file(root, link)
        missing, extra = actual - set(links), set(links) - actual
        if missing or extra or len(links) != len(set(links)):
            raise ValueError("rule links must cover each rule exactly once; missing=" + repr(sorted(missing)) + ", unexpected=" + repr(sorted(extra)))
        counts = re.findall(r"\b(\d+)\s+(?:total|rules)\b", index, re.IGNORECASE)
        if any(int(count) != len(rules) for count in counts):
            raise ValueError("declared rule count differs from indexed files")
    check("RULES-INDEX.md", inspect_index)

    def inspect_local_rules():
        # A project's own routing file: not package-owned, so updates never replace it.
        if not (root / LOCAL_RULES).exists():
            return
        text = contained_file(root, LOCAL_RULES).read_text(encoding="utf-8")
        for link in re.findall(r"\[[^\]]*\]\(([^\s)]+)\)", text):
            target = link.split("#", 1)[0]
            if target and "://" not in target:
                contained_file(root, target)
    check(LOCAL_RULES, inspect_local_rules)

    def inspect_notices():
        # Installed copies are covered by the manifest checksums, and project-local skills are not the package's.
        if registry is None or inventory is not None:
            return
        path = root / NOTICES
        if not path.is_file() or path.read_text(encoding="utf-8") != render_notices(root):
            raise ValueError("out of date with skill provenance; run python3 -B scripts/third_party_notices.py --write")
    check(NOTICES, inspect_notices)
    profile = check("autonomy-config.md", lambda: parse_profile(root / "autonomy-config.md"))

    def inspect_resources():
        manifest = load_json(root / "resources.json")
        if not isinstance(manifest, dict) or manifest.get("version") != 1 or set(manifest) != {"version", "resources", "capabilities"}:
            raise ValueError("expected version 1 resources/capabilities manifest")
        if not isinstance(manifest["resources"], dict) or not isinstance(manifest["capabilities"], list):
            raise ValueError("resources must be an object; capabilities must be a list")
        for owner, references in manifest["resources"].items():
            owner_file = contained_file(root, owner)
            if owner_file not in skills or not isinstance(references, list) or any(not isinstance(ref, str) for ref in references):
                raise ValueError("resources must map a skill manifest to a list of relative file paths")
            if len(references) != len(set(references)):
                raise ValueError("duplicate resources for " + owner)
            for reference in references:
                contained_file(owner_file.parent, reference)
        capability_names = set()
        for capability in manifest["capabilities"]:
            if not isinstance(capability, dict) or set(capability) != {"name", "used_by", "fallback"}:
                raise ValueError("capabilities need name, used_by, and fallback")
            if any(not isinstance(capability[key], str) or not capability[key].strip() for key in ("name", "fallback")):
                raise ValueError("capability name and fallback must be nonempty text")
            if capability["name"] in capability_names:
                raise ValueError("duplicate capability: " + capability["name"])
            capability_names.add(capability["name"])
            if not isinstance(capability["used_by"], list) or not capability["used_by"]:
                raise ValueError("capability used_by must list consumers")
            for owner in capability["used_by"]:
                contained_file(root, owner)
            notices.append(CAPABILITY_NOTICE + capability["name"] + " (availability not probed). Fallback: " + capability["fallback"])
    check("resources.json", inspect_resources)

    script_count = 0
    for directory, children, files in os.walk(root, followlinks=False):
        children[:] = sorted(child for child in children if child not in SKIP_DIRS and not Path(directory, child).is_symlink())
        for filename in sorted(files):
            if filename.startswith(".") or PRIVATE_NAME.search(filename):
                continue
            path = Path(directory, filename)
            if inventory is not None and path.relative_to(root).as_posix() not in inventory:
                continue
            if path.is_symlink() or (path.suffix not in {".sh", ".bash", ".py"} and path.suffix):
                continue
            def inspect_script():
                nonlocal script_count
                source = path.read_text(encoding="utf-8")
                first_line = source.splitlines()[0] if source else ""
                if path.suffix == ".py":
                    # The minimum's grammar first: a 3.9 interpreter cannot tell newer syntax from a mistake,
                    # so both read as invalid 3.9 syntax everywhere. compile() then catches compile-time errors.
                    try:
                        tree = ast.parse(source, filename=str(path), feature_version=MIN_PYTHON)
                    except SyntaxError as error:
                        raise ValueError("is not valid Python {}.{} syntax: {} (line {})".format(
                            MIN_PYTHON[0], MIN_PYTHON[1], error.msg, error.lineno)) from None
                    newer = newer_syntax(source, tree)
                    if newer:
                        raise ValueError("is not valid Python {}.{} syntax: {} (line {})".format(MIN_PYTHON[0], MIN_PYTHON[1], newer[1], newer[0]))
                    compile(source, str(path), "exec")
                    script_count += 1
                    return
                interpreter = "bash" if path.suffix in {".sh", ".bash"} else None
                if first_line.startswith("#!"):
                    tokens = shlex.split(first_line[2:])
                    command = Path(tokens[0]).name if tokens else ""
                    if command == "env":
                        command = next((token for token in tokens[1:] if not token.startswith("-")), "")
                    if command in {"sh", "bash"}:
                        interpreter = command
                    elif interpreter:
                        raise ValueError("unsupported shell shebang: " + first_line)
                if interpreter:
                    executable = shutil.which(interpreter)
                    if not executable:
                        raise ValueError("syntax check requires " + interpreter)
                    syntax_env = {key: value for key, value in os.environ.items() if key not in {"BASH_ENV", "ENV"}}
                    result = subprocess.run([executable, "-n", str(path)], capture_output=True, text=True, timeout=10, env=syntax_env)
                    if result.returncode:
                        raise ValueError(result.stderr.strip() or "shell syntax check failed")
                    script_count += 1
            check(path.relative_to(root).as_posix(), inspect_script)
    return errors, notices, {"skills": len(skills), "rules": len(rules), "scripts": script_count, "profile": profile}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--verbose", action="store_true", help="also list optional capabilities and their fallbacks")
    args = parser.parse_args()
    errors, notices, summary = validate(args.root)
    for error in errors:
        print("ERROR: " + error)
    for notice in notices:
        if args.verbose or not notice.startswith(CAPABILITY_NOTICE):
            print("INFO: " + notice)
    print("Checked {skills} skills, {rules} rules, {scripts} scripts; profile={profile}.".format(**summary))
    print("Validation failed: " + str(len(errors)) + " error(s)." if errors else "All checks passed.")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
