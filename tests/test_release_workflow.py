"""Release metadata must be shell data, never executable script text."""

import os
from pathlib import Path
import shutil
import subprocess

import pytest
import yaml


def test_release_tag_is_not_evaluated_by_shell(tmp_path):
    bash = shutil.which("bash")
    if bash is None:
        pytest.skip("Release workflow runs in bash")
    workflow_path = (
        Path(__file__).resolve().parents[1] / ".github/workflows/python-publish.yml"
    )
    workflow = yaml.safe_load(workflow_path.read_text())
    step = next(
        step
        for step in workflow["jobs"]["release-build"]["steps"]
        if step.get("name") == "Verify tag matches package version"
    )
    assert step["env"]["RELEASE_TAG"] == "${{ github.event.release.tag_name }}"
    assert "${{" not in step["run"]
    (tmp_path / "pyproject.toml").write_text('[project]\nversion = "0.7.0"\n')
    tag = "v0.7.0$(printf${IFS}INJECTED)"
    result = subprocess.run(
        [bash, "-e", "-c", step["run"]],
        cwd=tmp_path,
        env={**os.environ, "RELEASE_TAG": tag},
        text=True,
        capture_output=True,
        timeout=10,
    )
    assert result.returncode == 1
    assert tag in result.stdout
    assert "v0.7.0INJECTED" not in result.stdout
