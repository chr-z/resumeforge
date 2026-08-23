// ResumeForge — UI wiring. All ATS logic lives in core.js (tested); this file only glues DOM.
'use strict';

import {
  atsScore,
  atsKeywords,
  parseMonth,
  isPresent,
  monthsBetween,
  humanDuration,
  resumeToText,
} from './core.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'rf_resume_v1';

// ---------- state ----------
let resume = blankResume();

function blankResume() {
  return { name: '', location: '', email: '', phone: '', summary: '', experience: [], education: [], skills: [] };
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && typeof saved === 'object') resume = Object.assign(blankResume(), saved);
  } catch { /* fresh start */ }
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(resume)); } catch { /* ignore */ }
}

// ---------- sample data ----------
const SAMPLE = {
  name: 'Ada Lovelace',
  location: 'London, UK',
  email: 'ada@example.com',
  phone: '+44 20 7946 0958',
  summary: 'Backend engineer with eight years of experience building reliable payment systems. Led teams of up to 9 engineers, cut cloud spend by R$ 2M a year and shipped platforms serving 12 million users across three continents.',
  experience: [
    {
      title: 'Staff Engineer',
      company: 'Acme Payments',
      from: 'Mar 2020',
      to: '',
      bullets: [
        'Led migration of legacy APIs to Node.js, cutting p99 latency by 38%',
        'Automated CI/CD pipelines and reduced release effort from 5 hours to 15 minutes',
        'Mentored 6 engineers; 3 were promoted within a year',
      ],
    },
    {
      title: 'Senior Engineer',
      company: 'Globex Cloud',
      from: 'Jan 2017',
      to: 'Feb 2020',
      bullets: [
        'Designed billing service handling R$ 90M in monthly volume with 99.98% uptime',
        'Reduced AWS costs by 27% through storage lifecycle policies',
      ],
    },
  ],
  education: [{ degree: 'BSc Mathematics', school: 'University of London', year: '2016' }],
  skills: ['Node.js', 'TypeScript', 'PostgreSQL', 'AWS', 'Docker', 'Kubernetes', 'CI/CD'],
};

// ---------- dynamic rows ----------
function expRow(exp = {}) {
  const div = document.createElement('div');
  div.className = 'item';
  div.innerHTML = `
    <div class="grid">
      <label><span data-i18n="exp.title">Job title</span><input class="e-title" type="text" maxlength="60" /></label>
      <label><span data-i18n="exp.company">Company</span><input class="e-company" type="text" maxlength="60" /></label>
      <label><span data-i18n="exp.from">From</span><input class="e-from" type="text" placeholder="Mar 2022" maxlength="24" /></label>
      <label><span data-i18n="exp.to">To</span><input class="e-to" type="text" placeholder="Present" maxlength="24" /></label>
    </div>
    <label><span data-i18n="exp.bullets">Achievements (one per line)</span>
      <textarea class="e-bullets" rows="3"></textarea></label>
    <button type="button" class="btn ghost danger sm remove-btn" data-i18n="exp.remove">Remove</button>`;
  div.querySelector('.e-title').value = exp.title || '';
  div.querySelector('.e-company').value = exp.company || '';
  div.querySelector('.e-from').value = exp.from || '';
  div.querySelector('.e-to').value = exp.to || '';
  div.querySelector('.e-bullets').value = (exp.bullets || []).join('\n');
  return div;
}

function eduRow(edu = {}) {
  const div = document.createElement('div');
  div.className = 'item';
  div.innerHTML = `
    <div class="grid">
      <label><span data-i18n="edu.degree">Degree</span><input class="d-degree" type="text" maxlength="80" /></label>
      <label><span data-i18n="edu.school">School</span><input class="d-school" type="text" maxlength="80" /></label>
      <label><span data-i18n="edu.year">Year</span><input class="d-year" type="text" maxlength="10" /></label>
    </div>
    <button type="button" class="btn ghost danger sm remove-btn" data-i18n="edu.remove">Remove</button>`;
  div.querySelector('.d-degree').value = edu.degree || '';
  div.querySelector('.d-school').value = edu.school || '';
  div.querySelector('.d-year').value = edu.year || '';
  return div;
}

function readRowsIntoState() {
  resume.experience = [...document.querySelectorAll('#exp-list .item')].map((div) => ({
    title: div.querySelector('.e-title').value.trim(),
    company: div.querySelector('.e-company').value.trim(),
    from: div.querySelector('.e-from').value.trim(),
    to: div.querySelector('.e-to').value.trim(),
    bullets: div.querySelector('.e-bullets').value.split('\n').map((s) => s.trim()).filter(Boolean),
  }));
  resume.education = [...document.querySelectorAll('#edu-list .item')].map((div) => ({
    degree: div.querySelector('.d-degree').value.trim(),
    school: div.querySelector('.d-school').value.trim(),
    year: div.querySelector('.d-year').value.trim(),
  }));
}

// ---------- skills chips ----------
function renderSkills() {
  const wrap = $('skill-chips');
  wrap.innerHTML = '';
  for (const s of resume.skills) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = s;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'chip-x';
    x.setAttribute('aria-label', `remove ${s}`);
    x.textContent = '×';
    x.addEventListener('click', () => {
      resume.skills = resume.skills.filter((v) => v !== s);
      renderSkills();
      update();
    });
    chip.appendChild(x);
    wrap.appendChild(chip);
  }
}

// ---------- score gauge ----------
function verdictFor(score, t) {
  if (score >= 85) return { label: t('score.excellent'), color: '#16a34a' };
  if (score >= 65) return { label: t('score.good'), color: '#0ea5e9' };
  if (score >= 40) return { label: t('score.fair'), color: '#f59e0b' };
  return { label: t('score.poor'), color: '#dc2626' };
}

const ARC_LEN = 157;

function renderScore(result, t) {
  const arc = $('score-arc');
  arc.style.strokeDashoffset = String(ARC_LEN * (1 - result.score / 100));
  const v = verdictFor(result.score, t);
  arc.style.stroke = v.color;
  $('score-value').textContent = String(result.score);
  $('score-value').style.color = v.color;
  $('score-verdict').textContent = result.issues.length === 0 ? t('ats.perfect') : v.label;

  const ul = $('score-issues');
  ul.innerHTML = '';
  for (const issue of result.issues.slice(0, 7)) {
    const li = document.createElement('li');
    li.textContent = issue.message; // core messages are plain EN by design
    ul.appendChild(li);
  }
}

// ---------- preview ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function rangeLabel(e, t) {
  const fromISO = parseMonth(e.from);
  const toISO = parseMonth(e.to);
  let left = e.from || '';
  let right = isPresent(e.to) || (!e.to && !fromISO) ? t('preview.present') : (e.to || '');
  if (right === '') right = e.to;
  const months = fromISO && toISO ? monthsBetween(fromISO, toISO) : null;
  const dur = months !== null ? ` · ${humanDuration(months)}` : '';
  return `${left} — ${right}${dur}`;
}

function renderPreview(t) {
  const el = $('resume-preview');
  if (!resume.name && !resume.summary && resume.experience.length === 0 && resume.education.length === 0 && resume.skills.length === 0) {
    el.innerHTML = `<p class="empty-hint">${esc(t('kw.empty'))}</p>`;
    return;
  }
  const parts = [];
  parts.push(`<header><h3>${esc(resume.name) || '&nbsp;'}</h3>`);
  const contact = [resume.location, resume.email, resume.phone].filter(Boolean).map(esc).join(' · ');
  if (contact) parts.push(`<p class="c-contact">${contact}</p></header>`);
  else parts.push('</header>');
  if (resume.summary) parts.push(`<p class="c-summary">${esc(resume.summary)}</p>`);
  if (resume.experience.length) {
    parts.push('<h4>Experience</h4>');
    for (const e of resume.experience) {
      parts.push(`<div class="xp"><p class="xp-head"><strong>${esc(e.title)}</strong> · ${esc(e.company)}</p>`);
      parts.push(`<p class="xp-range">${esc(rangeLabel(e, t))}</p>`);
      if ((e.bullets || []).length) parts.push(`<ul>${e.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`);
      parts.push('</div>');
    }
  }
  if (resume.education.length) {
    parts.push('<h4>Education</h4>');
    for (const d of resume.education) {
      parts.push(`<p class="edu-line"><strong>${esc(d.degree)}</strong> · ${esc(d.school)}${d.year ? ` · ${esc(d.year)}` : ''}</p>`);
    }
  }
  if (resume.skills.length) {
    parts.push(`<h4>Skills</h4><p class="skills-line">${resume.skills.map(esc).join(' · ')}</p>`);
  }
  el.innerHTML = parts.join('');
}

// ---------- master update ----------
function update() {
  readRowsIntoState();
  save();
  const t = window.RFI18N.t;
  renderScore(atsScore(resume), t);
  renderPreview(t);
}

// ---------- import/export ----------
function exportJSON() {
  const blob = new Blob([JSON.stringify({ app: 'resumeforge', version: 1, resume }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'resumeforge-export.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      const r = data && data.app === 'resumeforge' ? data.resume : (data && data.name !== undefined ? data : null);
      if (!r || typeof r !== 'object') throw new Error('bad');
      resume = Object.assign(blankResume(), r);
      rebuildForms();
      update();
    } catch {
      alert(window.RFI18N.t('import.badfile'));
    }
  };
  reader.readAsText(file);
}

// ---------- form rebuild ----------
function rebuildForms() {
  $('rf-name').value = resume.name || '';
  $('rf-location').value = resume.location || '';
  $('rf-email').value = resume.email || '';
  $('rf-phone').value = resume.phone || '';
  $('rf-summary').value = resume.summary || '';

  const expList = $('exp-list');
  expList.innerHTML = '';
  (resume.experience.length ? resume.experience : [{}]).forEach((e) => expList.appendChild(expRow(e)));
  const eduList = $('edu-list');
  eduList.innerHTML = '';
  (resume.education.length ? resume.education : [{}]).forEach((d) => eduList.appendChild(eduRow(d)));
  renderSkills();
}

// ---------- keyword matcher ----------
let lastKeywords = [];

function runKeywordCheck() {
  const raw = $('kw-input').value;
  lastKeywords = raw.split(/[,\n;]/).map((s) => s.trim()).filter(Boolean);
  renderKeywords(window.RFI18N.t);
}

function renderKeywords(t) {
  const box = $('kw-result');
  if (lastKeywords.length === 0) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  const res = atsKeywords(resumeToText(resume), lastKeywords);
  $('kw-coverage').textContent = t('kw.coverage')
    .replace('{pct}', String(res.score))
    .replace('{matched}', String(res.matched.length))
    .replace('{total}', String(lastKeywords.length));
  const fill = (id, items, cls) => {
    const ul = $(id);
    ul.innerHTML = '';
    for (const it of items) {
      const li = document.createElement('li');
      li.textContent = it;
      li.className = cls;
      ul.appendChild(li);
    }
    if (items.length === 0) {
      const li = document.createElement('li');
      li.className = 'none';
      li.textContent = '—';
      ul.appendChild(li);
    }
  };
  fill('kw-matched', res.matched, 'hit');
  fill('kw-missing', res.missing, 'miss');
}

// ---------- wiring ----------
function wire() {
  // simple fields
  for (const id of ['rf-name', 'rf-location', 'rf-email', 'rf-phone']) {
    $(id).addEventListener('input', () => {
      resume[id.replace('rf-', '')] = $(id).value;
      save();
      updateScoreOnly();
    });
  }
  $('rf-summary').addEventListener('input', () => {
    resume.summary = $('rf-summary').value;
    save();
    updateScoreOnly();
  });

  // dynamic rows: delegate input events
  $('exp-list').addEventListener('input', update);
  $('edu-list').addEventListener('input', update);
  $('exp-list').addEventListener('click', (ev) => {
    if (ev.target.classList.contains('remove-btn')) {
      ev.target.closest('.item').remove();
      update();
    }
  });
  $('edu-list').addEventListener('click', (ev) => {
    if (ev.target.classList.contains('remove-btn')) {
      ev.target.closest('.item').remove();
      update();
    }
  });
  $('exp-add').addEventListener('click', () => {
    $('exp-list').appendChild(expRow());
    window.RFI18N.applyStatic?.();
  });
  $('edu-add').addEventListener('click', () => {
    $('edu-list').appendChild(eduRow());
    window.RFI18N.applyStatic?.();
  });

  // skills
  $('skill-input').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const v = $('skill-input').value.trim();
      if (v && !resume.skills.some((s) => s.toLowerCase() === v.toLowerCase())) {
        resume.skills.push(v);
        $('skill-input').value = '';
        renderSkills();
        update();
      }
    }
  });

  // toolbar
  $('btn-sample').addEventListener('click', () => {
    resume = JSON.parse(JSON.stringify(SAMPLE));
    rebuildForms();
    update();
  });
  $('btn-clear').addEventListener('click', () => {
    if (confirm(window.RFI18N.t('confirm.clear'))) {
      resume = blankResume();
      rebuildForms();
      update();
    }
  });
  $('btn-print').addEventListener('click', () => window.print());

  // keywords
  $('kw-check').addEventListener('click', runKeywordCheck);
  $('kw-input').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); runKeywordCheck(); }
  });
  document.addEventListener('resumeforge:langchange', () => renderKeywords(window.RFI18N.t));

  // import/export
  $('import-file').addEventListener('change', (ev) => {
    if (ev.target.files && ev.target.files[0]) importJSON(ev.target.files[0]);
    ev.target.value = '';
  });

  document.addEventListener('resumeforge:langchange', update);
}

function updateScoreOnly() {
  const t = window.RFI18N.t;
  renderScore(atsScore(resume), t);
  renderPreview(t);
}

// expose applyStatic for dynamically added rows
window.RFI18N.applyStatic = window.RFI18N.applyStatic || (() => {});

// ---------- boot ----------
load();
rebuildForms();
wire();
update();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
