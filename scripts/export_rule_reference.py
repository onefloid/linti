#!/usr/bin/env python3
"""Export the rule registry for the interactive, static documentation site.

Also run by ``scripts/generate_all_rules.py``, so regenerating the rule docs
keeps ``ALL_RULES.md`` and the site's ``rules.json`` in step.

Usage:
    python scripts/export_rule_reference.py
    python scripts/export_rule_reference.py --check
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from linti.rules.rule_ids import GROUP_NAMES, RuleDoc, deprecated_ids_for, rule_docs  # noqa: E402

OUTPUT = Path(__file__).resolve().parent.parent / "site" / "app" / "data" / "rules.json"


def collect_rules() -> list[dict]:
    """Return one serializable record per canonical (including synthetic) rule."""
    return [_record(doc) for doc in rule_docs()]


def _record(doc: RuleDoc) -> dict:
    metadata = doc.metadata
    return {
        "id": doc.rule_id,
        "name": metadata.name,
        "description": metadata.description,
        "group": doc.rule_id[0],
        "group_name": GROUP_NAMES.get(doc.rule_id[0], "Other"),
        "severity": metadata.severity.value,
        "auto_fix": metadata.auto_fix,
        "enabled_by_default": doc.enabled_by_default,
        "config_key": doc.config_key,
        "explanation": metadata.explanation,
        "config_example": metadata.config_example,
        "deprecated_by": metadata.deprecated_by,
        "previous_ids": deprecated_ids_for(doc.rule_id),
        "examples": [
            {
                "code": example.code,
                "description": example.description,
                "valid": example.valid,
            }
            for example in metadata.examples
        ],
    }


def render_json() -> str:
    return json.dumps(collect_rules(), ensure_ascii=False, indent=2) + "\n"


def is_up_to_date() -> bool:
    return OUTPUT.exists() and OUTPUT.read_text(encoding="utf-8") == render_json()


def write() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(render_json(), encoding="utf-8")
    print(f"Generated {OUTPUT}")


def main() -> None:
    if "--check" in sys.argv:
        if not is_up_to_date():
            raise SystemExit(
                "Rule reference is out of date. Run scripts/export_rule_reference.py"
            )
        print("Rule reference is up to date.")
    else:
        write()


if __name__ == "__main__":
    main()
