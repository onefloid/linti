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
const runPlayground = pyodide.globals.get('run_playground');

try {
  const finding = JSON.parse(run('nValue=1;', 'prolog', 'F220', false));
  assert.ok(finding.issues.some(issue => issue.rule_id === 'F220'));
  const fixed = JSON.parse(run('nValue=1;', 'prolog', 'F220', true));
  assert.ok(fixed.fixes > 0);
  assert.ok(fixed.code.includes('nValue = 1;'));
  // Example context (linti.yaml, parameters) must reach the rule.
  const lowercase = JSON.stringify({ config: 'rules:\n  keyword_casing:\n    style: lowercase\n' });
  assert.equal(JSON.parse(run('if (x = 1);\nendif;', 'prolog', 'F110', false, lowercase)).issues.length, 0);
  assert.ok(JSON.parse(run('IF (x = 1);\nENDIF;', 'prolog', 'F110', false, lowercase)).issues.length > 0);
  const parameter = JSON.stringify({ parameters: ['pFactor'] });
  assert.equal(JSON.parse(run("pFactor = 2;", 'prolog', 'C210', false, parameter)).issues.length > 0, true);

  const paCode = await readFile(new URL('../../example/pa-code.ti', import.meta.url), 'utf8');
  const process = JSON.parse(runPlayground(paCode, 'rules:\n  item_skip:\n    enabled: true\n', false));
  assert.equal(process.format, 'pa');
  assert.ok(process.issues.some(issue => issue.procedure === 'data' && issue.line === 13));
  const fixedProcess = JSON.parse(runPlayground(paCode, '', true));
  assert.ok(Object.values(fixedProcess.fixes).reduce((a, b) => a + b, 0) > 0);
  assert.ok(fixedProcess.code.includes('#JSON_PROPERTIES'));
  assert.match(JSON.parse(runPlayground(paCode, 'rules: [', false)).error, /Invalid linti\.yaml/);
  console.log('LinTi/Pyodide smoke test passed (rule with example context, whole-process lint and auto-fix).');
} finally {
  run.destroy();
  runPlayground.destroy();
}
