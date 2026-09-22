"""Tests for the linti.yaml JSON Schema (linti.schema.json)."""

import json
from pathlib import Path

import jsonschema
import pytest
import yaml

from linti.config import Config
from linti.config_schema import build_config_schema, render_config_schema
from linti.rules import _RULE_REGISTRY
from linti.rules.rule_factory import create_rules
from linti.rules.naming.naming_rule import VariablePrefixRule

REPO_ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def validator():
    schema = build_config_schema()
    jsonschema.Draft202012Validator.check_schema(schema)
    return jsonschema.Draft202012Validator(schema)


def _errors(validator, data) -> list[str]:
    return [error.message for error in validator.iter_errors(data)]


def test_committed_schema_is_up_to_date():
    committed = (REPO_ROOT / "linti.schema.json").read_text()
    assert committed == render_config_schema(), (
        "linti.schema.json is out of date. "
        "Run: python scripts/generate_config_schema.py"
    )


def test_every_registered_rule_has_a_schema_entry():
    properties = build_config_schema()["$defs"]["RulesConfig"]["properties"]
    for rule_cls in _RULE_REGISTRY:
        assert rule_cls.CONFIG_KEY in properties
        assert properties[rule_cls.CONFIG_KEY].get("description")
    assert "nesting_depth" in properties


def test_example_config_is_valid(validator):
    data = yaml.safe_load((REPO_ROOT / "example" / "linti.yaml").read_text())
    assert _errors(validator, data) == []


def test_default_config_is_valid(validator):
    data = json.loads(Config().model_dump_json(by_alias=True))
    assert _errors(validator, data) == []


def test_empty_config_is_valid(validator):
    assert _errors(validator, {}) == []


@pytest.mark.parametrize(
    "data",
    [
        {"fail_onn": "error"},
        {"rules": {"keyword_casnig": {"enabled": True}}},
        {"rules": {"keyword_casing": {"stlye": "uppercase"}}},
        {"rules": {"keyword_casing": {"style": "shouting"}}},
        {"rules": {"indentation": {"size": "four"}}},
        {"severity": "info"},
        {"rules": {"empty_block": {"severity": "fatal"}}},
    ],
)
def test_invalid_configs_are_rejected(validator, data):
    assert _errors(validator, data)


def test_rule_without_config_class_accepts_common_settings(validator):
    data = {"rules": {"sql_where_filtering": {"enabled": False, "severity": "error"}}}
    assert _errors(validator, data) == []


def test_removed_rule_keys_stay_valid(validator):
    assert _errors(validator, {"rules": {"process_quit": {"enabled": True}}}) == []


def test_allow_loop_counter_variables_reaches_the_rule():
    """Declared in the schema, so it must also survive config loading."""
    cfg = Config(
        **{"rules": {"variable_prefix": {"allow_loop_counter_variables": True}}}
    )
    _, statement_rules = create_rules(cfg, select="N110")
    (rule,) = [r for r in statement_rules if isinstance(r, VariablePrefixRule)]
    assert rule.allow_loop_counter_variables is True
