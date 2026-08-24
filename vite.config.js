// ResumeForge v2 — Vite config. Static multi-page build; the Python engine is
// inlined as a string (?raw) and executed by the vendored Pyodide runtime.
import { defineConfig } from 'vite';
import { cpSync, mkdirSync } from 'node:fs';

// The exact file set loadPyodide() fetches to boot a bare CPython+stdlib
// runtime (verified empirically). Everything else in the release tarball is
// optional wheels/packages this app never imports.
const PYODIDE_CORE_FILES = [
  'pyodide.asm.js',
  'pyodide.asm.wasm',
  'pyodide.mjs',
  'python_stdlib.zip',
  'pyodide-lock.json',
  // Node module-format marker: without it, Node's syntax detection chokes on
  // pyodide.asm.js (require() + top-level await) under node --test.
  'package.json',
];

export default defineConfig({
  base: './', // GitHub Pages project subpath (/resumeforge/)
  plugins: [
    {
      name: 'copy-static',
      async closeBundle() {
        // Vendored CPython/WASM runtime — ONLY the 5 core files Pyodide needs
        // to boot CPython 3.13 with the stdlib (no wheels, no packages).
        mkdirSync('dist/vendor/pyodide', { recursive: true });
        for (const f of PYODIDE_CORE_FILES) {
          cpSync(`vendor/pyodide/${f}`, `dist/vendor/pyodide/${f}`);
        }
        // PWA statics that must keep stable URLs.
        for (const d of ['locales', 'css']) {
          cpSync(d, `dist/${d}`, { recursive: true });
        }
        // Classic scripts + service worker (not part of the module graph).
        mkdirSync('dist/js', { recursive: true });
        for (const f of ['sw.js', 'js/i18n.js', 'js/pay.js']) {
          cpSync(f, `dist/${f}`);
        }
        // Inject the full runtime asset list so the app can warm the service
        // worker cache (true offline-first, including the ~9 MB wasm runtime).
        const { readdirSync, readFileSync, writeFileSync } = await import('node:fs');
        const urls = ['./sw.js'];
        for (const dir of ['assets', 'vendor/pyodide']) {
          for (const f of readdirSync(`dist/${dir}`)) urls.push(`./${dir}/${f}`);
        }
        for (const f of ['locales/en.json', 'locales/pt-BR.json', 'manifest.json']) urls.push(`./${f}`);
        const inject = `<script>window.__RF_RUNTIME_ASSETS__=${JSON.stringify(urls)};</script>`;
        for (const page of ['index.html', 'upgrade.html']) {
          const p = `dist/${page}`;
          writeFileSync(p, readFileSync(p, 'utf8').replace('</body>', `${inject}</body>`));
        }
      },
    },
  ],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: 'index.html',
        upgrade: 'upgrade.html',
      },
    },
  },
});
