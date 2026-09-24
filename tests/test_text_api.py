"""Linting a process pasted as text (the browser playground's entry point)."""

from pathlib import Path

import pytest

from linti.linter.text_api import config_from_text, detect_format, lint_text

EXAMPLES = Path(__file__).parents[1] / "example"


@pytest.mark.parametrize(
    ("file_name", "expected"),
    [
        ("example.ti", "ti"),
        ("git-format.ti", "ti"),
        ("pa-code.ti", "pa"),
        ("example-ti.yaml", "yaml"),
    ],
)
def test_detect_format(file_name, expected):
    assert detect_format((EXAMPLES / file_name).read_text()) == expected


def test_region_ti_is_detected_as_ti():
    text = "#region Prolog\nnValue = 1;\n#endregion\n#region Epilog\n#endregion\n"
    assert detect_format(text) == "ti"


def test_plain_ti_findings_use_text_line_numbers():
    result = lint_text("nValue = 1;\nif (nValue = 1);\nENDIF;\n", select="F110")
    assert result.format == "ti"
    assert [(i.rule_id, i.line, i.column, i.fixable) for i in result.issues] == [
        ("F110", 2, 1, True)
    ]
    assert result.fixes == {}


def test_pa_code_lines_match_the_whole_file():
    text = (EXAMPLES / "pa-code.ti").read_text()
    result = lint_text(text, select="F110")
    assert result.format == "pa"
    assert {(i.procedure, i.line) for i in result.issues} == {
        ("metadata", 6),
        ("metadata", 8),
    }


def test_auto_fix_keeps_original_format():
    text = (EXAMPLES / "example-ti.yaml").read_text()
    result = lint_text(text, auto_fix=True, select="F110")
    assert result.format == "yaml"
    assert result.process_name == "Example-TI"
    assert result.fixes == {"prolog": 1}
    assert result.code.startswith(text[: text.index("PrologProcedure")])
    assert "  IF (a = 1);" in result.code
    assert not result.issues


def test_auto_fix_pa_code_keeps_json_properties():
    text = (EXAMPLES / "pa-code.ti").read_text()
    result = lint_text(text, auto_fix=True, select="F110")
    assert sum(result.fixes.values()) == 2
    assert "#JSON_PROPERTIES" in result.code
    assert "IF (cSTring @<> 'ABC');" in result.code


def test_config_text_disables_rules_and_filters_severity():
    code = "nValue = 1;\nif (nValue = 1);\nENDIF;\n"
    disabled = lint_text(code, "rules:\n  keyword_casing:\n    enabled: false\n")
    assert not any(issue.rule_id == "F110" for issue in disabled.issues)

    downgraded = lint_text(
        code,
        "severity: error\nrules:\n  keyword_casing:\n    severity: warning\n",
    )
    assert not any(issue.rule_id == "F110" for issue in downgraded.issues)


def test_config_warnings_are_returned():
    result = lint_text("nValue = 1;\n", "severity: loud\n")
    assert any("loud" in warning for warning in result.warnings)


@pytest.mark.parametrize("config_text", ["rules: [", "- just\n- a list\n"])
def test_invalid_config_text_raises_value_error(config_text):
    with pytest.raises(ValueError, match="Invalid linti.yaml"):
        config_from_text(config_text)


def test_empty_config_text_uses_defaults():
    assert config_from_text("") == config_from_text("# only a comment\n")
