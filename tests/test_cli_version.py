"""CLI-level tests for `linti version` / `linti --version`."""

from importlib.metadata import version

import pytest
from typer.testing import CliRunner

from linti.cli.main import app

runner = CliRunner()


@pytest.mark.parametrize("args", [["version"], ["--version"]])
def test_version_prints_installed_version(args: list[str]):
    result = runner.invoke(app, args)
    assert result.exit_code == 0
    assert result.stdout.strip() == f"linti {version('linti')}"


def test_version_flag_is_not_rewritten_to_lint():
    # The default-lint fallback must leave the flag to the group; otherwise it
    # would become `linti lint --version` and fail as an unknown option.
    result = runner.invoke(app, ["--version"])
    assert "No such option" not in result.output
