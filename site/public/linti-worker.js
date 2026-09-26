/* Runs the real LinTi package in a browser worker, away from the UI thread. */
let runtime;

function initialize() {
  runtime ||= load().catch((error) => {
    // Do not cache a failed start (e.g. a network hiccup): the next run retries.
    runtime = undefined;
    throw error;
  });
  return runtime;
}

async function load() {
  const assetRoot = new URL('./', self.location.href);
  const pyodideRoot = new URL('pyodide/', assetRoot).href;
  importScripts(new URL('pyodide/pyodide.js', assetRoot).href);
  const pyodide = await loadPyodide({ indexURL: pyodideRoot });
  await pyodide.loadPackage(['micropip', 'pydantic', 'pyyaml']);

  const manifest = await fetch(new URL('linti-wheel.json', assetRoot)).then((response) => {
    if (!response.ok) throw new Error('LinTi wheel manifest not found');
    return response.json();
  });
  const wheelURL = new URL(`wheels/${manifest.wheel}`, assetRoot).href;
  // deps=False: every asset is self-hosted, so micropip must not reach PyPI.
  // The in-memory linter needs only the packages loaded above; the CLI-only
  // dependencies (typer, rich, pathspec) are never imported.
  pyodide.globals.set('wheel_url', wheelURL);
  await pyodide.runPythonAsync('import micropip\nawait micropip.install(wheel_url, deps=False)');
  const bridge = await fetch(new URL('linti-bridge.py', assetRoot)).then((response) => {
    if (!response.ok) throw new Error('LinTi browser bridge not found');
    return response.text();
  });
  await pyodide.runPythonAsync(bridge);
  return pyodide;
}

self.onmessage = async ({ data }) => {
  const { id, action = 'rule' } = data;
  try {
    const pyodide = await initialize();
    // Loading is done; tell the page so its run timeout covers only the
    // (synchronous) lint itself, not the Pyodide download.
    self.postMessage({ id, status: 'running' });
    // Pass user input as data, never interpolate it into Python source.
    const run = pyodide.globals.get(action === 'process' ? 'run_playground' : 'run_linti');
    try {
      const result = action === 'process'
        ? run(data.code, data.config || '', data.fix)
        : run(data.code, data.procedure, data.ruleId, data.fix, JSON.stringify(data.context || {}));
      const parsed = JSON.parse(result);
      self.postMessage(parsed.error ? { id, error: parsed.error } : { id, result: parsed });
    } finally {
      run.destroy();
    }
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
