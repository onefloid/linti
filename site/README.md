# LinTi documentation walking skeleton

The Docus site lives inside the LinTi repository. Its rule reference is exported
from the Python rule registry; Pyodide runs the actual wheel in a Web Worker.

```bash
python -m pip install -e .
python scripts/export_rule_reference.py
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
