// ResumeForge — cross-engine parity + WASM integration suite (node:test).
// Boots the REAL vendored Pyodide runtime in Node, installs python/rfcore.py
// into it, and asserts the Python engine matches the v1 JS engine 1:1 on the
// same known-answer vectors used by tests/core.test.js.
// Run: node --test tests/pyodide_engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPyodide } from '../vendor/pyodide/pyodide.mjs';
import { readFile } from 'node:fs/promises';
import {
  parseMonth,
  isPresent,
  monthsBetween,
  humanDuration,
  atsKeywords,
  quantifiedImpact,
  startsWithActionVerb,
  atsScore,
  resumeToText,
} from '../js/core.js';

const py = await loadPyodide({
  indexURL: decodeURIComponent(
    new URL('../vendor/pyodide/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  ),
});
py.FS.mkdirTree('/home/pyd');
py.FS.writeFile('/home/pyd/rfcore.py', await readFile(new URL('../python/rfcore.py', import.meta.url), 'utf8'));
await py.runPythonAsync('import sys; sys.path.insert(0, "/home/pyd"); import rfcore');

/** Call rfcore.api_json inside WASM with JS-call positional semantics. */
async function callEngine(name, ...args) {
  const out = await py.runPythonAsync(
    `rfcore.api_json(${JSON.stringify(name)}, ${JSON.stringify(JSON.stringify(args))})`
  );
  return JSON.parse(out); // api_json already returns a JSON string
}

const sortKeys = (v) => (Array.isArray(v))
  ? v.map(sortKeys)
  : (v && typeof v === 'object')
    ? Object.keys(v).sort().reduce((a, k) => ((a[k] = sortKeys(v[k])), a), {})
    : v;

async function assertParity(api, ...args) {
  const pyOut = await callEngine(api, ...args);
  const jsOut = jsApi[api](...args);
  assert.deepEqual(sortKeys(pyOut), sortKeys(jsOut), `parity mismatch on ${api}`);
  return pyOut;
}

const jsApi = {
  parseMonth,
  isPresent,
  monthsBetween,
  humanDuration: (m, o) => humanDuration(m, o),
  atsKeywords,
  quantifiedImpact,
  startsWithActionVerb: (b, v) => startsWithActionVerb(b, v),
  atsScore,
  resumeToText,
};

function goodResume() {
  return {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '+55 11 91234-5678',
    summary: 'Backend engineer with eight years of experience building reliable payment systems, leading teams and reducing cloud costs across high traffic platforms.',
    experience: [{
      title: 'Senior Engineer',
      company: 'Acme',
      from: 'Jan 2020',
      to: 'Present',
      bullets: [
        'Led migration of legacy APIs, cutting p99 latency by 35%',
        'Automated deployments and reduced release effort to 15 minutes',
      ],
    }],
    education: [{ degree: 'BSc Computer Science', school: 'UFPE', year: '2015' }],
    skills: ['Node.js', 'PostgreSQL', 'AWS', 'Docker', 'Kubernetes'],
  };
}

// ---------- parseMonth ----------
test('WASM parity: parseMonth ISO, month names and pt slash formats', async () => {
  for (const v of ['2023-03', 'Mar 2023', 'September 2019', 'dez/2022']) {
    const r = await assertParity('parseMonth', v);
    assert.equal(r, v === '2023-03' ? '2023-03'
      : v === 'Mar 2023' ? '2023-03'
      : v === 'September 2019' ? '2019-09'
      : '2022-12');
  }
});

test('WASM parity: parseMonth Present-like words → null; invalid rejected', async () => {
  for (const w of ['Present', 'Current', 'Now', 'Atual', 'Hoje']) {
    const r = await assertParity('parseMonth', w);
    assert.equal(r, null);
  }
  for (const w of ['13/2023', 'Foo 2023', '', 42]) {
    assert.equal(await callEngine('parseMonth', w), null);
  }
});

// ---------- isPresent / monthsBetween ----------
test('WASM parity: isPresent EN/PT', async () => {
  assert.equal(await assertParity('isPresent', 'Present'), true);
  assert.equal(await assertParity('isPresent', ' atual '), true);
  assert.equal(await assertParity('isPresent', '2024-01'), false);
  assert.equal(await callEngine('isPresent', null), false);
});

test('WASM parity: monthsBetween inclusive math and invalid ranges', async () => {
  assert.equal(await assertParity('monthsBetween', '2022-01', '2023-01'), 12);
  assert.equal(await assertParity('monthsBetween', '2022-01', '2022-01'), 0);
  const neg = await callEngine('monthsBetween', '2022-06', '2022-03');
  assert.equal(neg, null);
  assert.deepEqual(await callEngine('monthsBetween', null, '2022-03'), null);
});

// ---------- humanDuration ----------
test('WASM parity: humanDuration formats with collapse rule', async () => {
  assert.equal(await assertParity('humanDuration', 6), '6 mos');
  const pt = await callEngine('humanDuration', 1, { yearsLabel: 'yr', monthsLabel: 'mês' });
  assert.equal(pt, '1 mês');
  assert.equal(await assertParity('humanDuration', 18), '1 yr 6 mos');
  assert.equal(await assertParity('humanDuration', 24), '2 yrs');
  assert.equal(await assertParity('humanDuration', 36), '3 yrs');
  assert.equal(await callEngine('humanDuration', -1), null);
});

// ---------- atsKeywords ----------
test('WASM parity: atsKeywords word-boundary, java ≠ javascript', async () => {
  const r = await assertParity(
    'atsKeywords',
    'Built services in JavaScript and Java on AWS. Led CI/CD.',
    ['javascript', 'java', 'aws', 'docker']
  );
  assert.deepEqual(r.matched, ['javascript', 'java', 'aws']);
  assert.deepEqual(r.missing, ['docker']);
  assert.equal(r.score, 75);
});

test('WASM parity: atsKeywords dedupe/blanks/perfect score', async () => {
  const r = await assertParity('atsKeywords', 'deployed on AWS', ['AWS', '', 'aws ', 'K8S']);
  assert.deepEqual(r.matched, ['AWS']);
  assert.deepEqual(r.missing, ['K8S']);
  assert.equal(r.score, 50);
  assert.equal(await callEngine('atsKeywords', 'anything', []).then((x) => x.score), 100);
});

// ---------- quantifiedImpact ----------
test('WASM parity: quantifiedImpact numbers/%/money', async () => {
  const r = await assertParity('quantifiedImpact', [
    'Reduced latency by 40%',
    'Managed the payments team',
    'Cut infra spend from R$ 90k to R$ 61k',
    'Shipped feature used by 1.2M users',
  ]);
  assert.equal(r.quantified, 3);
  assert.equal(r.total, 4);
  assert.equal(r.ratio, 0.75);
  assert.equal(await callEngine('quantifiedImpact', []).then((x) => x.ratio), 0);
  assert.equal(await callEngine('quantifiedImpact', 'nope').then((x) => x.total), 0);
});

// ---------- startsWithActionVerb ----------
test('WASM parity: startsWithActionVerb EN/PT accent-safe', async () => {
  assert.equal(await assertParity('startsWithActionVerb', 'Led a team of 8'), true);
  assert.equal(await assertParity('startsWithActionVerb', '  liderei um time de 8'), true);
  assert.equal(await assertParity('startsWithActionVerb', 'Responsible for testing'), false);
  assert.equal(await callEngine('startsWithActionVerb', ''), false);
});

// ---------- atsScore ----------
test('WASM parity: atsScore complete resume = 100, zero issues', async () => {
  const r = await assertParity('atsScore', goodResume());
  assert.equal(r.score, 100);
  assert.deepEqual(r.issues, []);
});

test('WASM parity: atsScore empty resume near zero with issues', async () => {
  const r = await callEngine('atsScore', {});
  assert.ok(r.score <= 10);
  const codes = r.issues.map((i) => i.code);
  for (const c of ['contact.name', 'contact.email', 'summary.missing', 'experience.missing', 'education.missing', 'skills.few']) {
    assert.ok(codes.includes(c));
  }
  // and identical to the JS engine
  const js = atsScore({});
  assert.equal(js.score, r.score);
  assert.deepEqual(sortKeys(js.issues), sortKeys(r.issues));
});

test('WASM parity: each fixable defect deducts its expected weight', async () => {
  const noSkills = structuredClone(goodResume());
  noSkills.skills = [];
  assert.equal((await assertParity('atsScore', noSkills)).score, 80);

  const shortSummary = goodResume();
  shortSummary.summary = 'Too short.';
  assert.equal((await assertParity('atsScore', shortSummary)).score, 95);

  const caps = goodResume();
  caps.experience[0].bullets[0] = 'LED MIGRATION OF LEGACY APIS WITH GREAT RESULTS';
  const rc = await assertParity('atsScore', caps);
  assert.equal(rc.score, 95);
  assert.ok(rc.issues.some((i) => i.code === 'formatting.caps'));
});

test('WASM parity: score clamps at 0, integer', async () => {
  const r = await callEngine('atsScore', {});
  assert.ok(r.score >= 0 && Number.isInteger(r.score));
});

// ---------- resumeToText ----------
test('WASM parity: resumeToText flattens sections', async () => {
  const txt = await assertParity('resumeToText', goodResume());
  assert.match(txt, /ada@example\.com/);
  assert.match(txt, /Acme/);
  assert.match(txt, /PostgreSQL/);
});

// ---------- api surface ----------
test('WASM engine exposes the full API surface', async () => {
  const names = JSON.parse(await py.runPythonAsync('rfcore.api_names_json()'));
  assert.deepEqual(names, [
    'atsKeywords', 'atsScore', 'humanDuration', 'isPresent', 'monthsBetween',
    'parseMonth', 'quantifiedImpact', 'resumeToText', 'round',
    'startsWithActionVerb',
  ]);
});
