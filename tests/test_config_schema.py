"""Tests for the linti.yaml JSON Schema (linti.schema.json)."""

import json
import re
import warnings
from pathlib import Path

import jsonschema
import pytest
import yaml

from linti.config import Config, LintiConfigWarning
from linti.config_schema import build_config_schema, render_config_schema
from linti.rules import _RULE_REGISTRY
from linti.rules.rule_factory import create_rules
from linti.rules.naming.naming_rule import VariablePrefixRule
from linti.schema_reference import check_schema_reference, modeline, schema_url

REPO_ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def validator():
    schema = build_config_schema()
    jsonschema.Draft202012Validator.check_schema(schema)
    return jsonschema.Draft202012Validator(schema)


def _errors(validator, data) -> list[str]:
    return [error.message for error in validator.iter_errors(data)]


def _project_version() -> str:
    pyproject = (REPO_ROOT / "pyproject.toml").read_text()
    return re.search(r'^version\s*=\s*"([^"]+)"', pyproject, re.MULTILINE).group(1)


def test_committed_schema_is_up_to_date():
    committed = (REPO_ROOT / "linti.schema.json").read_text()
    assert committed == render_config_schema(_project_version()), (
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


def test_schema_id_points_at_the_release_tag():
    schema = build_config_schema("1.2.3")
    assert schema["$id"] == (
        "https://raw.githubusercontent.com/onefloid/linti/v1.2.3/linti.schema.json"
    )


# --- upgrade check for the schema a linti.yaml references --------------------


def test_stale_url_reference_warns_with_current_modeline(tmp_path):
    text = f"{modeline('0.7.0')}\nrules: {{}}\n"
    message = check_schema_reference(text, tmp_path / "linti.yaml", "0.8.0")
    assert message is not None
    assert "linti 0.7.0" in message and "linti 0.8.0" in message
    assert modeline("0.8.0") in message


@pytest.mark.parametrize(
    "text",
    [
        "rules: {}\n",
        f"{modeline('0.8.0')}\n",
        "# yaml-language-server: $schema="
        "https://raw.githubusercontent.com/onefloid/linti/main/linti.schema.json\n",
        "# yaml-language-server: $schema=https://example.com/other.json\n",
        "# yaml-language-server: $schema=./missing.schema.json\n",
    ],
)
def test_current_or_unpinned_reference_does_not_warn(tmp_path, text):
    assert check_schema_reference(text, tmp_path / "linti.yaml", "0.8.0") is None


def test_stale_local_schema_file_warns(tmp_path):
    (tmp_path / "linti.schema.json").write_text(
        render_config_schema("0.7.0"), encoding="utf-8"
    )
    text = "# yaml-language-server: $schema=./linti.schema.json\n"
    config = tmp_path / "linti.yaml"
    assert check_schema_reference(text, config, "0.7.0") is None
    assert "linti 0.7.0" in check_schema_reference(text, config, "0.8.0")


def test_loading_a_config_with_a_stale_reference_warns(tmp_path, monkeypatch):
    monkeypatch.setattr("linti.schema_reference.installed_version", lambda: "99.0.0")
    config = tmp_path / "linti.yaml"
    config.write_text(f"{modeline('0.7.0')}\nfail_on: error\n")
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        Config.load_from_file(config)
    messages = [
        str(w.message) for w in caught if issubclass(w.category, LintiConfigWarning)
    ]
    assert len(messages) == 1
    assert schema_url("99.0.0") in messages[0]
