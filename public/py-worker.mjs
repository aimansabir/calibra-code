// Module worker that owns the Pyodide instance. One request at a time.
import { loadPyodide } from './pyodide/pyodide.mjs';

let py = null;

const ready = (async () => {
  try {
    py = await loadPyodide({ indexURL: new URL('./pyodide/', import.meta.url).href });
    const harness = await fetch(new URL('./harness.py', import.meta.url)).then((r) => r.text());
    py.runPython(harness);
    postMessage({ type: 'ready' });
  } catch (err) {
    postMessage({ type: 'load-error', error: String(err) });
    throw err;
  }
})();

onmessage = async (e) => {
  const { id, kind, code, tests } = e.data;
  try {
    await ready;
    let raw;
    if (kind === 'run') raw = py.globals.get('run_program')(code);
    else raw = py.globals.get('run_tests')(code, JSON.stringify(tests));
    postMessage({ type: 'result', id, ok: true, result: JSON.parse(raw) });
  } catch (err) {
    postMessage({ type: 'result', id, ok: false, error: String(err) });
  }
};
