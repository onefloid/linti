# LinTi documentation walking skeleton

The Docus site lives inside the LinTi repository. Its rule reference is exported
from the Python rule registry; Pyodide runs the actual wheel in a Web Worker.
The `/playground` page lints whole pasted processes through
`linti.linter.text_api.lint_text` (format auto-detection, `linti.yaml`, auto-fix).

The `/config` page builds a `linti.yaml`. Its form is generated from
`app/data/config-schema.json`: the pydantic `Config` schema (field help comes
from `Field(description=...)`), the defaults, and the use-case presets from
`linti.config_presets`. The YAML text is the only state. Form edits go through
`app/utils/lintiConfig.ts`, which edits the YAML document in place and keeps
only settings that differ from the defaults. The configurator, the playground
and the rule reference share the visitor's `linti.yaml` via `useSharedConfig()`,
which uses `localStorage` and `#config=` share links.

`scripts/generate_all_rules.py` regenerates both `app/data/*.json` files; never
edit them by hand.

```bash
python -m pip install -e .
python scripts/generate_all_rules.py
python -m pip wheel --no-deps --wheel-dir site/public/wheels .
cd site
npm ci
node scripts/prepare-assets.mjs
node scripts/write-wheel-manifest.mjs
npm run dev
```

Run `npm run generate` to build the static site in `.output/public`. All Pyodide
assets are self-hosted. The Pages workflow runs the above preparation steps on
`main` and deploys the resulting site under `/linti/`.

The rule reference intentionally keeps `ALL_RULES.md` for existing GitHub links.
Once this site is established, the old Markdown generator can be retired
separately.
