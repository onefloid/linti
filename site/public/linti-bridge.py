"""Small JSON bridge shared by the browser worker and Pyodide smoke test."""

import json

from linti.config import Config
from linti.linter.api import lint_process_model
from linti.linter.fixer import auto_fix_process
from linti.linter.linter import Linter
from linti.model.process_ir import ProcessIR, ProcedureInfo
from linti.rules.rule_factory import create_rules


def run_linti(source, procedure, rule_id, apply_fix):
    if procedure not in {"prolog", "metadata", "data", "epilog"}:
        raise ValueError(f"Unknown procedure: {procedure}")

    token_rules, statement_rules = create_rules(Config(), select=rule_id)
    linter = Linter(token_rules, statement_rules)
    process = ProcessIR(name="playground", **{procedure: ProcedureInfo(code=source)})
    fixes = 0
    if apply_fix:
        fixes = sum(auto_fix_process(process, linter).values())
    issues = lint_process_model(process, linter)
    return json.dumps(
        {
            "code": getattr(process, procedure).code,
            "fixes": fixes,
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
