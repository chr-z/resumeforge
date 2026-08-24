// ResumeForge — fetches the vendored Pyodide runtime for local dev/build.
// Usage: node scripts/fetch-pyodide.mjs
// Downloads the official release tarball and extracts ONLY the 5 core files
// needed to boot CPython 3.13 + stdlib in the browser (no wheels/packages).
import { mkdirSync, statSync, createWriteStream, rmSync, renameSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.28.3';
const TARBALL_URL = `https://github.com/pyodide/pyodide/releases/download/${VERSION}/pyodide-${VERSION}.tar.bz2`;
const CORE = [
  'pyodide.asm.js',
  'pyodide.asm.wasm',
  'pyodide.mjs',
  'python_stdlib.zip',
  'pyodide-lock.json',
  // Node module-format marker (see vite.config.js note)
  'package.json',
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'vendor', 'pyodide');
mkdirSync(dest, { recursive: true });

const missing = CORE.filter((f) => {
  try { return statSync(path.join(dest, f)).size === 0; } catch { return true; }
});
if (missing.length === 0) {
  console.log('Pyodide runtime already present:', dest);
  process.exit(0);
}
console.log('Missing core files:', missing.join(', '));

console.log('Downloading', TARBALL_URL);
const tmp = path.join(root, 'vendor', `pyodide-${VERSION}.tar.bz2`);
const res = await fetch(TARBALL_URL);
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status}`);
  process.exit(1);
}
await pipeline(res.body, createWriteStream(tmp));

const extractDir = path.join(root, 'vendor', `_extract_${Date.now()}`);
mkdirSync(extractDir, { recursive: true });
try {
  // Windows 10+ ships bsdtar, which handles .tar.bz2 natively.
  execFileSync('tar', ['-xjf', tmp, '-C', extractDir], { stdio: ['ignore', 'ignore', 'inherit'] });
} catch (err) {
  console.error('Extraction failed:', err.message);
  console.error(`Extract manually then copy pyodide/{${CORE.join(',')}} into ${dest}`);
  process.exit(1);
}

for (const f of missing) {
  renameSync(path.join(extractDir, 'pyodide', f), path.join(dest, f));
}
rmSync(tmp, { force: true });
rmSync(extractDir, { recursive: true, force: true });
console.log('Done. Core files installed to', dest);
