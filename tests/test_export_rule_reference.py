"""The website must describe the same rules as the Python registry."""

import importlib.util
import json
from pathlib import Path

from linti.rules.rule_ids import rule_metadata_index


SCRIPT = Path(__file__).parents[1] / "scripts" / "export_rule_reference.py"
SPEC = importlib.util.spec_from_file_location("export_rule_reference", SCRIPT)
assert SPEC and SPEC.loader
export_rule_reference = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(export_rule_reference)

OUTPUT = export_rule_reference.OUTPUT
collect_rules = export_rule_reference.collect_rules
render_json = export_rule_reference.render_json


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


def test_export_carries_example_context():
    rules = {rule["id"]: rule for rule in collect_rules()}
    lowercase = next(e for e in rules["F110"]["examples"] if e["config"])
    assert "style: lowercase" in lowercase["config"]
    assert lowercase["procedure"] == "prolog"
    placement = rules["C150"]["examples"]
    assert {example["procedure"] for example in placement} - {"prolog"}
    assert any(example["parameters"] for example in rules["C210"]["examples"])
