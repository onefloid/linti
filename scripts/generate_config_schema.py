#!/usr/bin/env python3
"""Generate linti.schema.json (the JSON Schema for linti.yaml) from the config models.

Usage:
    python scripts/generate_config_schema.py          # write linti.schema.json
    python scripts/generate_config_schema.py --check  # check if file is up-to-date
"""

from __future__ import annotations

import sys
from pathlib import Path

# Ensure the package is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from linti.config_schema import render_config_schema  # noqa: E402

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "linti.schema.json"


def main() -> int:
    content = render_config_schema()

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
