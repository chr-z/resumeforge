// ResumeForge — Pyodide bridge: loads the vendored CPython/WASM runtime and
// injects the pure Python ATS engine (python/rfcore.py). All engine calls go
// through the JSON-string API (rfcore.api_json), so the UI never touches the
// JS<->Python object bridge directly. Zero network at runtime (fully vendored).
'use strict';

import { loadPyodide } from '../vendor/pyodide/pyodide.mjs';
// Raw engine source, imported as a string at build time by Vite.
import rfcoreSource from '../python/rfcore.py?raw';

let pyodidePromise = null;

/** Load Pyodide once and install the Python engine into its filesystem. */
export function getEngine() {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      // indexURL must be a runtime string relative to the page (bundler-proof):
      // dist always ships vendor/pyodide/ next to index.html.
      const indexURL = new URL('vendor/pyodide/', document.baseURI).href;
      const py = await loadPyodide({ indexURL });
      py.FS.mkdirTree('/home/pyd');
      py.FS.writeFile('/home/pyd/rfcore.py', rfcoreSource, { encoding: 'utf8' });
      await py.runPythonAsync(
        'import sys; sys.path.insert(0, "/home/pyd"); import rfcore\n' +
        'def __call_json__(name, args_json):\n' +
        '    return rfcore.api_json(name, args_json)\n'
      );
      return py;
    })();
  }
  return pyodidePromise;
}

/**
 * Call an rfcore JSON API inside WASM.
 * @param {string} name  e.g. 'atsScore'
 * @param {...any} args  positional arguments, JSON-encoded in order
 * @returns {Promise<any>} parsed JSON result
 */
export async function callEngine(name, ...args) {
  const py = await getEngine();
  const payload = py.globals.get('__call_json__');
  try {
    const out = payload(name, JSON.stringify(args));
    return JSON.parse(out);
  } finally {
    payload.destroy();
  }
}

/**
 * Cross-engine parity check: runs the SAME vectors through both the Python
 * (WASM) engine and the original JS engine, asserting identical results.
 * Used by tests/pyodide_engine.test.mjs (CI) and surfaced in the app footer.
 */
export async function verifyParity(vectors) {
  const results = [];
  for (const v of vectors) {
    const pyOut = await callEngine(v.api, ...v.args);
    const jsOut = jsCore[v.api](...v.args);
    results.push({
      api: v.api,
      ok: JSON.stringify(sortKeys(pyOut)) === JSON.stringify(sortKeys(jsOut)),
      py: pyOut,
      js: jsOut,
    });
  }
  return { allOk: results.every((r) => r.ok), results };
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, k) => ((acc[k] = sortKeys(value[k])), acc), {});
  }
  return value;
}
