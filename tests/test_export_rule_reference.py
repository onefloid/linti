"""The website must describe the same rules as the Python registry."""

import json

from scripts.export_rule_reference import OUTPUT, collect_rules, render_json
from linti.rules.rule_ids import rule_metadata_index


def test_export_includes_each_canonical_rule_once():
    rules = collect_rules()
    ids = [rule["id"] for rule in rules]
    assert len(ids) == len(set(ids))
    assert set(ids) == set(rule_metadata_index())
    assert "C150" in ids
    assert "P900" in ids


def test_checked_in_json_matches_export():
    assert OUTPUT.read_text(encoding="utf-8") == render_json()
    example = next(rule for rule in json.loads(render_json()) if rule["id"] == "C150")
    assert example["config_key"] == "misplaced_function"
    assert example["examples"]
