# Copilot Instructions

## Code

- Use `ruff` to lint Python code.
- Run all unit tests after changing code.
- After adding a new rule or changing metadata for an existing rule, run `scripts/generate_all_rules.py` to generate `ALL_RULES.md`.
- Do not edit `ALL_RULES.md` directly.
- After changing `src/linti/config.py` (settings, defaults, descriptions), adding a rule, or bumping the version in `pyproject.toml`, regenerate `linti.schema.json`: `python scripts/generate_config_schema.py`.
- Do not edit `linti.schema.json` directly. CI fails when it is out of date.
- Update `README.md` if necessary.
- Suggest a version bump in `pyproject.toml` after implementing a new feature or a fix.

