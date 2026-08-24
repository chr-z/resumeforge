// Build-invariant guard for ResumeForge (CI + Pages workflow).
// Fails the build if any PWA-critical artifact is missing or malformed in
// dist/. Guards against regressions like the 2026-08-24 one where Vite
// hashed the web app manifest into assets/manifest-<hash>.json, leaving the
// stable ./manifest.json URL 404 => PWA not installable.
import { existsSync, readFileSync } from 'node:fs';

const errors = [];

function mustExist(p) {
  if (!existsSync(p)) errors.push(`missing file: ${p}`);
}

mustExist('dist/index.html');
mustExist('dist/upgrade.html');
mustExist('dist/manifest.json'); // stable PWA root URL — never hashed
mustExist('dist/sw.js');
mustExist('dist/locales/en.json');
mustExist('dist/locales/pt-BR.json');
mustExist('dist/vendor/pyodide/pyodide.asm.wasm');
mustExist('dist/vendor/pyodide/python_stdlib.zip');

if (existsSync('dist/index.html')) {
  const html = readFileSync('dist/index.html', 'utf8');

  if (/href="\.?\/?assets\/manifest-[^"]*\.json"/.test(html)) {
    errors.push('index.html still references hashed assets/manifest-<hash>.json');
  }
  if (!/href="\.?\/?manifest\.json"/.test(html)) {
    errors.push('index.html has no <link rel=manifest> pointing at ./manifest.json');
  }
  if (!html.includes('__RF_RUNTIME_ASSETS__')) {
    errors.push('runtime asset list (__RF_RUNTIME_ASSETS__) not injected');
  }

  const sw = readFileSync('dist/sw.js', 'utf8');
  if (sw.includes('__RF_CACHE_VERSION__')) {
    errors.push('sw.js cache version not stamped');
  }
  const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
  if (!manifest.start_url || !manifest.icons?.length) {
    errors.push('manifest.json missing start_url/icons');
  }
}

if (errors.length) {
  console.error('PWA guard FAILED:\n  - ' + errors.join('\n  - '));
  process.exit(1);
}
console.log('PWA guard OK: manifest at stable root URL, SW stamped, runtime assets injected.');
