"""JSON Schema for ``linti.yaml``, derived from the pydantic config models.

The schema is generated, never written by hand: :class:`linti.config.Config`
supplies the structure and the field descriptions, the rule registry supplies
one ``rules.<key>`` entry per registered rule (including rules that have no
dedicated config class) and its metadata supplies the per-rule descriptions.

Editors use it for completion and validation, e.g. through the YAML language
server comment ``# yaml-language-server: $schema=<url>`` in ``linti.yaml``.
The committed copy (``linti.schema.json`` at the repository root) is refreshed
with ``python scripts/generate_config_schema.py``; its ``$id`` names the release
tag it ships with, so each tag serves the schema of its own version.
"""

from __future__ import annotations

import json
from typing import Any, Optional

from linti.config import _REMOVED_RULE_CONFIGS, Config, RuleConfig
from linti.rules import _RULE_REGISTRY
from linti.rules.rule_ids import rule_instances, synthetic_rules
from linti.schema_reference import SCHEMA_URL_TEMPLATE, installed_version, schema_url

SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema"


def _rule_descriptions() -> dict[str, str]:
    """One description per config key, listing every rule the key configures.

    Several rules can share a key (the whitespace group), so each contributes
    its own ``<ID> <name>: <description>`` line.
    """
    lines: dict[str, list[str]] = {}
    entries = [
        (rule_cls.CONFIG_KEY, rule_instances(rule_cls)[0].RULE_ID, rule_cls.METADATA)
        for rule_cls in _RULE_REGISTRY
    ]
    entries += [(s.config_key, s.rule_id, s.metadata) for s in synthetic_rules()]
    for config_key, rule_id, metadata in entries:
        if metadata is None:
            text = rule_id
        else:
            text = f"{rule_id} {metadata.name}: {metadata.description}"
            if metadata.deprecated_by:
                text += f" (deprecated, superseded by {metadata.deprecated_by})"
        lines.setdefault(config_key, []).append(text)
    return {key: "\n".join(sorted(texts)) for key, texts in lines.items()}


def build_config_schema(linti_version: Optional[str] = None) -> dict[str, Any]:
    """Return the JSON Schema describing a ``linti.yaml`` file.

    *linti_version* (default: the installed one) only decides the ``$id``, the
    URL under which that version's release tag serves the schema.
    """
    linti_version = linti_version or installed_version()
    schema_id = (
        schema_url(linti_version)
        if linti_version
        else SCHEMA_URL_TEMPLATE.format(ref="main")
    )
    schema = Config.model_json_schema(by_alias=True)
    defs = schema["$defs"]

    # A misspelt key is silently ignored at load time; the schema is where it
    # gets caught, so no model accepts properties it does not declare.
    for definition in defs.values():
        if definition.get("type") == "object":
            definition["additionalProperties"] = False

    # Rule config classes carry developer docstrings ("Configuration for
    # XRule."); the user-facing text lives on the rules.<key> properties.
    rule_config_names = {
        cls.__name__ for cls in [RuleConfig, *_all_subclasses(RuleConfig)]
    }
    for name in rule_config_names & defs.keys():
        defs[name].pop("description", None)

    defs["Severity"]["description"] = "How much weight a finding carries."

    rules = defs["RulesConfig"]
    rules.pop("description", None)
    properties = rules["properties"]
    # Registered rules without a dedicated config class still take the common
    # enabled/severity settings (RulesConfig accepts them through extra=allow).
    for rule_cls in _RULE_REGISTRY:
        properties.setdefault(rule_cls.CONFIG_KEY, {"$ref": "#/$defs/RuleConfig"})
    for config_key, description in _rule_descriptions().items():
        properties[config_key]["description"] = description
    # Removed rules only trigger a warning when configured, so they stay valid
    # but are flagged in the editor.
    for config_key, message in _REMOVED_RULE_CONFIGS.items():
        properties[config_key] = {
            "type": "object",
            "deprecated": True,
            "description": message,
        }
    rules["properties"] = dict(sorted(properties.items()))

    return {
        "$schema": SCHEMA_DIALECT,
        "$id": schema_id,
        "title": "linti configuration",
        "description": (
            "Configuration file (linti.yaml) for linti, the TM1 TurboIntegrator linter."
        ),
        "type": "object",
        "properties": schema["properties"],
        "additionalProperties": False,
        "$defs": dict(sorted(defs.items())),
    }


def render_config_schema(linti_version: Optional[str] = None) -> str:
    """The schema as the JSON text that is committed and printed by the CLI."""
    schema = build_config_schema(linti_version)
    return json.dumps(schema, indent=2, ensure_ascii=False) + "\n"


def _all_subclasses(cls: type) -> list[type]:
    subclasses = []
    for sub in cls.__subclasses__():
        subclasses.append(sub)
        subclasses.extend(_all_subclasses(sub))
    return subclasses
