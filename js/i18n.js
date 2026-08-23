// ResumeForge — i18n (EN / PT-BR). Canonical source: /locales/*.json.
// Loaded synchronously before the app; silent fallback to the raw key.
'use strict';

(function () {
  const LANGS = [
    ['en', 'English'],
    ['pt-BR', 'Português (BR)'],
  ];
  const DICTS = {};

  let current = 'en';
  try {
    const saved = localStorage.getItem('rf_lang');
    if (saved && LANGS.some(([code]) => code === saved)) current = saved;
    else if ((navigator.language || '').toLowerCase().startsWith('pt')) current = 'pt-BR';
  } catch { /* keep en */ }

  function loadDicts() {
    for (const [code] of LANGS) {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', new URL('locales/' + code + '.json', document.baseURI).href, false);
        xhr.send(null);
        if (xhr.status === 200 || xhr.status === 0) {
          DICTS[code] = JSON.parse(xhr.responseText);
        }
      } catch { /* missing dict → raw keys */ }
    }
  }

  function t(key, params) {
    const dict = DICTS[current] || {};
    let s = typeof dict[key] === 'string' ? dict[key] : key;
    if (params) {
      for (const k of Object.keys(params)) {
        s = s.split('{' + k + '}').join(String(params[k]));
      }
    }
    return s;
  }

  function applyStatic() {
    document.querySelectorAll('[data-i18n]').forEach((elm) => {
      elm.textContent = t(elm.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((elm) => {
      elm.setAttribute('placeholder', t(elm.getAttribute('data-i18n-ph')));
    });
    document.documentElement.lang = current;
  }

  function wireSelector() {
    const sel = document.getElementById('lang-select');
    if (!sel) return;
    sel.innerHTML = '';
    for (const [code, name] of LANGS) {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = name;
      sel.appendChild(opt);
    }
    sel.value = current;
    sel.addEventListener('change', () => setLang(sel.value));
  }

  function setLang(lang) {
    if (!DICTS[lang]) return;
    current = lang;
    try { localStorage.setItem('rf_lang', lang); } catch { /* ignore */ }
    applyStatic();
    document.dispatchEvent(new CustomEvent('resumeforge:langchange'));
  }

  function boot() {
    loadDicts();
    wireSelector();
    applyStatic();
  }

  window.RFI18N = { t, get current() { return current; }, boot, setLang };
  boot();
})();
