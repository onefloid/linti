#!/usr/bin/env python3
"""Generate linti.schema.json (the JSON Schema for linti.yaml) from the config models.

The schema's ``$id`` points at the release tag of the version in pyproject.toml,
so the file has to be regenerated after every config change *and* every
version bump. CI runs ``--check`` to enforce both.

Usage:
    python scripts/generate_config_schema.py          # write linti.schema.json
    python scripts/generate_config_schema.py --check  # check if file is up-to-date
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# Ensure the package is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from linti.config_schema import render_config_schema  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = REPO_ROOT / "linti.schema.json"


def project_version() -> str:
    """The version in pyproject.toml.

    Read from the file rather than the installed metadata, which an editable
    install only refreshes on reinstall and would lag behind a version bump.
    """
    pyproject = (REPO_ROOT / "pyproject.toml").read_text()
    match = re.search(r'^version\s*=\s*"([^"]+)"', pyproject, re.MULTILINE)
    if match is None:
        raise SystemExit("No version found in pyproject.toml")
    return match.group(1)


def main() -> int:
    content = render_config_schema(project_version())

    if "--check" in sys.argv:
        if not SCHEMA_PATH.exists() or SCHEMA_PATH.read_text() != content:
            print(
                f"{SCHEMA_PATH.name} is out of date. "
                "Run: python scripts/generate_config_schema.py"
            )
            return 1
        print(f"{SCHEMA_PATH.name} is up to date.")
        return 0

    SCHEMA_PATH.write_text(content)
    print(f"Wrote {SCHEMA_PATH.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
