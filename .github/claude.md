# Claude Instructions

## Code

- Use `ruff` to lint Python code.
- Run all unit tests after changing code.
- After adding a new rule or changing metadata for an existing rule, run `scripts/generate_all_rules.py` to generate `ALL_RULES.md`.
- Do not edit `ALL_RULES.md` directly.
- After changing `src/linti/config.py` (settings, defaults, descriptions) or adding a rule, regenerate the config JSON Schema: `python scripts/generate_config_schema.py`. If the config structure changed, the schema version becomes the version in `pyproject.toml`, so bump it first if that version is already released.
- Do not edit `linti.schema.json` or `src/linti/_schema_version.py` directly. CI fails when they are out of date or when a released schema version would change.
- Update `README.md` if necessary.
- Suggest a version bump in `pyproject.toml` after implementing a new feature or a fix.

