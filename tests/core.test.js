// ResumeForge — business logic tests (node --test, zero deps)
import test from 'node:test';
import assert from 'node:assert/strict';
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

// ---------- parseMonth ----------
test('parseMonth: ISO, month names and pt slash formats', () => {
  assert.equal(parseMonth('2023-03'), '2023-03');
  assert.equal(parseMonth('Mar 2023'), '2023-03');
  assert.equal(parseMonth('September 2019'), '2019-09');
  assert.equal(parseMonth('dez/2022'), '2022-12'); // pt month + slash
});

test('parseMonth: Present-like words → null; invalid input rejected', () => {
  for (const w of ['Present', 'Current', 'Now', 'Atual', 'Hoje']) {
    assert.equal(parseMonth(w), null);
  }
  assert.equal(parseMonth('13/2023'), null);   // impossible month number
  assert.equal(parseMonth('Foo 2023'), null);  // not a month
  assert.equal(parseMonth(42), null);          // not a string
  assert.equal(parseMonth(''), null);
});

// ---------- isPresent / monthsBetween ----------
test('isPresent detects ongoing ranges in EN and PT', () => {
  assert.equal(isPresent('Present'), true);
  assert.equal(isPresent(' atual '), true);
  assert.equal(isPresent('2024-01'), false);
  assert.equal(isPresent(null), false);
});

test('monthsBetween: inclusive math and invalid ranges', () => {
  assert.equal(monthsBetween('2022-01', '2023-01'), 12);
  assert.equal(monthsBetween('2022-01', '2022-01'), 0);
  assert.equal(monthsBetween('2022-06', '2022-03'), null); // negative → null
  assert.equal(monthsBetween(null, '2022-03'), null);
});

// ---------- humanDuration ----------
test('humanDuration formats years+months with collapse rule', () => {
  assert.equal(humanDuration(6), '6 mos');
  assert.equal(humanDuration(1, { monthsLabel: 'mês' }), '1 mês');
  assert.equal(humanDuration(18), '1 yr 6 mos');
  assert.equal(humanDuration(24), '2 yrs'); // ≥24 collapses to years only
  assert.equal(humanDuration(36), '3 yrs');
  assert.equal(humanDuration(-1), null);
});

// ---------- atsKeywords ----------
test('atsKeywords: word-boundary match, java does NOT match javascript', () => {
  const r = atsKeywords(
    'Built services in JavaScript and Java on AWS. Led CI/CD.',
    ['javascript', 'java', 'aws', 'docker']
  );
  assert.deepEqual(r.matched, ['javascript', 'java', 'aws']);
  assert.deepEqual(r.missing, ['docker']);
  assert.equal(r.score, 75);
});

test('atsKeywords: dedupes, ignores blanks, empty keywords = perfect score', () => {
  const r = atsKeywords('deployed on AWS', ['AWS', '', 'aws ', 'K8S']);
  assert.deepEqual(r.matched, ['AWS']); // case-insensitive, deduped
  assert.deepEqual(r.missing, ['K8S']);
  assert.equal(r.score, 50);
  assert.equal(atsKeywords('anything', []).score, 100);
});

// ---------- quantifiedImpact ----------
test('quantifiedImpact: numbers, % and money count as quantified', () => {
  const r = quantifiedImpact([
    'Reduced latency by 40%',
    'Managed the payments team',          // no numbers → unquantified
    'Cut infra spend from R$ 90k to R$ 61k',
    'Shipped feature used by 1.2M users',
  ]);
  assert.equal(r.quantified, 3);
  assert.equal(r.total, 4);
  assert.equal(r.ratio, 0.75);
  assert.equal(quantifiedImpact([]).ratio, 0);
  assert.equal(quantifiedImpact('nope').total, 0);
});

// ---------- startsWithActionVerb ----------
test('startsWithActionVerb: strong openers in EN and PT, accent-safe', () => {
  assert.equal(startsWithActionVerb('Led a team of 8'), true);
  assert.equal(startsWithActionVerb('  liderei um time de 8'), true);
  assert.equal(startsWithActionVerb('Responsible for testing'), false);
  assert.equal(startsWithActionVerb(''), false);
});

// ---------- atsScore ----------
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

test('atsScore: complete resume scores 100 with zero issues', () => {
  const r = atsScore(goodResume());
  assert.equal(r.score, 100);
  assert.deepEqual(r.issues, []);
});

test('atsScore: empty resume scores near zero with actionable issues', () => {
  const r = atsScore({});
  assert.ok(r.score <= 10);
  const codes = r.issues.map((i) => i.code);
  for (const c of ['contact.name', 'contact.email', 'summary.missing', 'experience.missing', 'education.missing', 'skills.few']) {
    assert.ok(codes.includes(c), `missing issue ${c}`);
  }
});

test('atsScore: each fixable defect deducts its expected weight', () => {
  const base = goodResume();
  const noSkills = JSON.parse(JSON.stringify(base));
  noSkills.skills = [];
  assert.equal(atsScore(noSkills).score, 80);

  const shortSummary = goodResume();
  shortSummary.summary = 'Too short.';
  assert.equal(atsScore(shortSummary).score, 95);

  const caps = goodResume();
  caps.experience[0].bullets[0] = 'LED MIGRATION OF LEGACY APIS WITH GREAT RESULTS';
  const rc = atsScore(caps);
  assert.equal(rc.score, 95);
  assert.ok(rc.issues.some((i) => i.code === 'formatting.caps'));
});

test('atsScore: clamps at 0 and never goes negative', () => {
  const bad = {};
  const r = atsScore(bad);
  assert.ok(r.score >= 0 && Number.isInteger(r.score));
});

// ---------- resumeToText ----------
test('resumeToText flattens all sections into plain text', () => {
  const txt = resumeToText(goodResume());
  assert.match(txt, /ada@example\.com/);
  assert.match(txt, /Acme/);
  assert.match(txt, /PostgreSQL/);
});
