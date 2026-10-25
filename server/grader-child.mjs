// Runs participant code for grading. Started by grader.ts with Node's
// permission model, so it can only read the Pyodide files and the harness:
// no study data, no child processes, no workers. Pyodide also gets an empty
// jsglobals so Python's `import js` doesn't reach the Node globals.
import { constants, readFileSync } from 'node:fs';

// Emscripten only asks process.binding for the fs open flags, and the
// permission model blocks process.binding, so hand it those directly.
process.binding = (name) => {
  if (name === 'constants') return { fs: constants };
  throw new Error(`process.binding(${name}) is not available`);
};

const [pyodideEntry, harnessPath] = process.argv.slice(2);
const { loadPyodide } = await import(pyodideEntry);

const py = await loadPyodide({ jsglobals: {}, stdout: () => {}, stderr: () => {} });
py.runPython(readFileSync(harnessPath, 'utf8'));
const runTests = py.globals.get('run_tests');

process.on('message', ({ id, code, tests }) => {
  try {
    const out = JSON.parse(runTests(code, JSON.stringify(tests)));
    process.send({ id, ok: true, results: out.results });
  } catch (err) {
    process.send({ id, ok: false, error: String(err) });
  }
});
process.send({ ready: true });
