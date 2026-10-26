#!/usr/bin/env python3
"""Generate THIRD_PARTY_NOTICES.md from skill frontmatter and licenses/upstreams.json.

The rendering lives in validate.py, so the validator can check the notices
without running any other bundled code. Run --write after adding, importing,
or changing the provenance of a skill.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="exit 1 when the notices are out of date")
    mode.add_argument("--write", action="store_true", help="rewrite the notices when they are out of date")
    args = parser.parse_args(argv)
    specification = importlib.util.spec_from_file_location("notices_validator", Path(__file__).with_name("validate.py"))
    validator = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(validator)
    try:
        expected = validator.render_notices(args.root)
    except (OSError, ValueError) as error:
        print(json.dumps({"status": "error", "message": str(error)}))
        return 1
    path = args.root / validator.NOTICES
    current = path.read_text(encoding="utf-8") if path.is_file() else None
    if args.check:
        print(json.dumps({"current": current == expected}))
        return 0 if current == expected else 1
    if current != expected:
        path.write_text(expected, encoding="utf-8")
    print(json.dumps({"written": current != expected}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
