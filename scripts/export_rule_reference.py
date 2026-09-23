#!/usr/bin/env python3
"""Export the rule registry for the interactive, static documentation site.

Usage:
    python scripts/export_rule_reference.py
    python scripts/export_rule_reference.py --check
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from linti.rules import _RULE_REGISTRY  # noqa: E402
from linti.rules.rule_ids import (  # noqa: E402
    GROUP_NAMES,
    deprecated_ids_for,
    group_sort_key,
    rule_instances,
    synthetic_rules,
)

OUTPUT = Path(__file__).resolve().parent.parent / "site" / "public" / "rules.json"


def collect_rules() -> list[dict]:
    """Return one serializable record per canonical (including synthetic) rule."""
    records: list[dict] = []
    seen: set[str] = set()

    for rule_cls in _RULE_REGISTRY:
        metadata = rule_cls.METADATA
        if metadata is None:
            continue
        for instance in rule_instances(rule_cls):
            rule_id = instance.RULE_ID
            if rule_id in seen:
                continue
            seen.add(rule_id)
            records.append(
                _record(
                    rule_id,
                    metadata,
                    rule_cls.CONFIG_KEY,
                    rule_cls.DEFAULT_ENABLED,
                )
            )

    for synthetic in synthetic_rules():
        if synthetic.rule_id in seen:
            raise ValueError(f"Duplicate rule ID: {synthetic.rule_id}")
        records.append(
            _record(
                synthetic.rule_id,
                synthetic.metadata,
                synthetic.config_key,
                True,
            )
        )

    return sorted(records, key=lambda record: group_sort_key(record["id"]))


def _record(rule_id, metadata, config_key, enabled_by_default) -> dict:
    return {
        "id": rule_id,
        "name": metadata.name,
        "description": metadata.description,
        "group": rule_id[0],
        "group_name": GROUP_NAMES.get(rule_id[0], "Other"),
        "severity": metadata.severity.value,
        "auto_fix": metadata.auto_fix,
        "enabled_by_default": enabled_by_default,
        "config_key": config_key,
        "explanation": metadata.explanation,
        "config_example": metadata.config_example,
        "deprecated_by": metadata.deprecated_by,
        "previous_ids": deprecated_ids_for(rule_id),
        "examples": [
            {"code": example.code, "description": example.description, "valid": example.valid}
            for example in metadata.examples
        ],
    }


def render_json() -> str:
    return json.dumps(collect_rules(), ensure_ascii=False, indent=2) + "\n"


def main() -> None:
    content = render_json()
    if "--check" in sys.argv:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != content:
            raise SystemExit("Rule reference is out of date. Run scripts/export_rule_reference.py")
        print("Rule reference is up to date.")
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(content, encoding="utf-8")
        print(f"Generated {OUTPUT}")


if __name__ == "__main__":
    main()
