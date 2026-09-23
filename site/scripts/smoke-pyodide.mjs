/** Exercise the same Python bridge against the generated, self-hosted assets. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadPyodide } from 'pyodide';

const root = new URL('../public/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('linti-wheel.json', root), 'utf8'));
const pyodide = await loadPyodide({ indexURL: new URL('pyodide/', root).pathname });
await pyodide.loadPackage(['micropip', 'pydantic', 'pyyaml']);
pyodide.globals.set('wheel_url', new URL(`wheels/${manifest.wheel}`, root).href);
await pyodide.runPythonAsync('import micropip\nawait micropip.install(wheel_url, deps=False)');
await pyodide.runPythonAsync(await readFile(new URL('linti-bridge.py', root), 'utf8'));
const run = pyodide.globals.get('run_linti');

try {
  const finding = JSON.parse(run('nValue=1;', 'prolog', 'F220', false));
  assert.ok(finding.issues.some(issue => issue.rule_id === 'F220'));
  const fixed = JSON.parse(run('nValue=1;', 'prolog', 'F220', true));
  assert.ok(fixed.fixes > 0);
  assert.ok(fixed.code.includes('nValue = 1;'));
  console.log('LinTi/Pyodide smoke test passed (lint and auto-fix).');
} finally {
  run.destroy();
}
