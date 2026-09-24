"""Small JSON bridge shared by the browser worker and Pyodide smoke test."""

import json
import warnings
from dataclasses import asdict

import yaml
from pydantic import ValidationError

from linti.config import Config, LintiConfigWarning
from linti.linter.api import lint_process_model
from linti.linter.fixer import auto_fix_process
from linti.linter.linter import Linter
from linti.linter.text_api import lint_text
from linti.model.process_ir import ProcessIR, ProcedureInfo
from linti.rules.rule_factory import create_rules


def _load_config(text):
    """Validate linti.yaml text like the CLI does; return (Config, warnings)."""
    try:
        data = yaml.safe_load(text or "") or {}
    except yaml.YAMLError as error:
        raise ValueError(f"Invalid linti.yaml: {error}") from None
    if not isinstance(data, dict):
        raise ValueError("Invalid linti.yaml: expected a mapping at the top level.")
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always", LintiConfigWarning)
        try:
            cfg = Config.model_validate(data)
        except ValidationError as error:
            raise ValueError(f"Invalid linti.yaml: {error}") from None
    return cfg, caught


def run_linti(source, procedure, rule_id, apply_fix, context_json="{}"):
    if procedure not in {"prolog", "metadata", "data", "epilog"}:
        raise ValueError(f"Unknown procedure: {procedure}")
    context = json.loads(context_json)

    cfg, caught = _load_config(context.get("config", ""))
    with warnings.catch_warnings(record=True) as selected:
        # Selecting a deprecated or disabled rule on purpose may warn.
        warnings.simplefilter("always", LintiConfigWarning)
        token_rules, statement_rules = create_rules(cfg, select=rule_id)
    linter = Linter(token_rules, statement_rules)
    process = ProcessIR(
        name="playground",
        parameters=list(context.get("parameters") or []),
        variables=list(context.get("variables") or []),
        datasource_type=context.get("datasource_type") or None,
        datasource_query=context.get("datasource_query") or None,
        **{procedure: ProcedureInfo(code=source)},
    )
    fixes = 0
    if apply_fix:
        fixes = sum(auto_fix_process(process, linter).values())
    issues = lint_process_model(process, linter)
    return json.dumps(
        {
            "code": getattr(process, procedure).code,
            "fixes": fixes,
            "warnings": [str(warning.message) for warning in [*caught, *selected]],
            "issues": [
                {
                    "rule_id": issue.rule_id,
                    "message": issue.message,
                    "line": issue.line,
                    "column": issue.column,
                    "severity": issue.severity.value,
                }
                for _, issue, _ in issues
            ],
        }
    )


def run_playground(text, config_text, apply_fix):
    """Lint a whole pasted process; see linti.linter.text_api.lint_text.

    Input problems (bad config, unreadable process) come back as a short
    ``error`` message instead of a Python traceback.
    """
    try:
        result = lint_text(text, config_text, auto_fix=apply_fix)
    except (ValueError, OSError) as exc:
        return json.dumps({"error": str(exc)})
    return json.dumps(asdict(result))
