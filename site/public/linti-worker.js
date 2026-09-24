/* Runs the real LinTi package in a browser worker, away from the UI thread. */
let runtime;

async function initialize() {
  if (!runtime) {
    runtime = (async () => {
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
      // LinTi's current typer[all] metadata cannot be resolved by micropip.
      // The in-memory linter does not import the CLI or pathspec.
      pyodide.globals.set('wheel_url', wheelURL);
      await pyodide.runPythonAsync('import micropip\nawait micropip.install(wheel_url, deps=False)');
      const bridge = await fetch(new URL('linti-bridge.py', assetRoot)).then((response) => {
        if (!response.ok) throw new Error('LinTi browser bridge not found');
        return response.text();
      });
      await pyodide.runPythonAsync(bridge);
      return pyodide;
    })();
  }
  return runtime;
}

self.onmessage = async ({ data }) => {
  const { id, action = 'rule' } = data;
  try {
    const pyodide = await initialize();
    // Pass user input as data, never interpolate it into Python source.
    const run = pyodide.globals.get(action === 'process' ? 'run_playground' : 'run_linti');
    try {
      const result = action === 'process'
        ? run(data.code, data.config || '', data.fix)
        : run(data.code, data.procedure, data.ruleId, data.fix);
      const parsed = JSON.parse(result);
      self.postMessage(parsed.error ? { id, error: parsed.error } : { id, result: parsed });
    } finally {
      run.destroy();
    }
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
