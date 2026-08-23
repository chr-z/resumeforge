// ResumeForge — pure ATS engine (no DOM). Testable with `node --test`.
'use strict';

const MONTHS = {
  // EN
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  // PT-BR (jan/mar/jun/jul/nov shared above)
  fev: 2, abr: 4, mai: 5, ago: 8, set: 9, out: 10, dez: 12,
};

const ACTION_VERBS = [
  'led', 'built', 'shipped', 'designed', 'launched', 'managed', 'owned', 'drove',
  'created', 'improved', 'reduced', 'increased', 'automated', 'migrated', 'scaled',
  'delivered', 'implemented', 'optimized', 'negotiated', 'mentored', 'developed',
  'cut', 'grew', 'won', 'streamlined', 'architected', 'refactored', 'founded',
  'liderei', 'construi', 'criei', 'implantei', 'implementei', 'otimizei', 'reduzi',
  'aumentei', 'entreguei', 'gerenciei', 'desenvolvi', 'projetei', 'migrei', 'fundi',
];

/** Round to `d` decimals. */
function round(n, d = 2) {
  const f = Math.pow(10, d);
  return Math.round((Number(n) + Number.EPSILON) * f) / f;
}

/**
 * Parse a resume date into an ISO month (YYYY-MM).
 * Accepts "2023-03", "Mar 2023", "March 2023", "mar/2023".
 * "Present"/"Current"/"Now"/"Atual"/"Hoje" → null (caller decides what that means).
 */
function parseMonth(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (!s || /^(present|current|now|atual|hoje)$/.test(s)) return null;

  let m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) {
    const mo = Number(m[2]);
    if (mo >= 1 && mo <= 12) return `${m[1]}-${String(mo).padStart(2, '0')}`;
    return null;
  }

  m = s.match(/^([a-z]{3})[a-z]*[\s/.-]+(\d{4})$/);
  if (m && MONTHS[m[1]]) return `${m[2]}-${String(MONTHS[m[1]]).padStart(2, '0')}`;

  return null;
}

/** True when the string means "still ongoing" in EN or PT. */
function isPresent(raw) {
  return typeof raw === 'string' && /^(present|current|now|atual|hoje)$/i.test(raw.trim());
}

/** Months between two ISO months. Negative ranges → null. */
function monthsBetween(fromISO, toISO) {
  if (!fromISO || !toISO) return null;
  const [y1, m1] = String(fromISO).split('-').map(Number);
  const [y2, m2] = String(toISO).split('-').map(Number);
  if (![y1, m1, y2, m2].every(Number.isFinite)) return null;
  const n = (y2 - y1) * 12 + (m2 - m1);
  return n < 0 ? null : n;
}

/** Human duration from N months ("1 yr 6 mos"). ≥24 months collapses to years only. */
function humanDuration(months, opts = {}) {
  const n = Number(months);
  if (!Number.isFinite(n) || n < 0) return null;
  const yl = opts.yearsLabel || 'yr';
  const ml = opts.monthsLabel || 'mo';
  const years = Math.floor(n / 12);
  const mos = n % 12;
  if (years === 0) return `${mos} ${ml}${mos === 1 ? '' : 's'}`;
  if (mos === 0 || n >= 24) return `${years} ${yl}${years === 1 ? '' : 's'}`;
  return `${years} ${yl}${years === 1 ? '' : 's'} ${mos} ${ml}${mos === 1 ? '' : 's'}`;
}

/**
 * ATS keyword coverage against the job posting.
 * Word-boundary match so "java" does NOT match inside "javascript".
 */
function atsKeywords(text, keywords) {
  if (!Array.isArray(keywords)) keywords = [];
  const hay = String(text || '').toLowerCase();
  const matched = [];
  const seenLower = new Set();
  for (const kwRaw of keywords) {
    const kw = String(kwRaw || '').trim().toLowerCase();
    if (!kw || seenLower.has(kw)) continue;
    let re;
    try {
      re = new RegExp('(^|[^a-z0-9])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)', 'i');
    } catch { continue; }
    if (re.test(hay)) {
      matched.push(String(kwRaw).trim());
      seenLower.add(kw);
    }
  }
  // unique non-blank keywords in their original casing
  const uniq = [];
  const allLower = new Set();
  for (const k of keywords.map((k) => String(k || '').trim())) {
    if (!k) continue;
    const lo = k.toLowerCase();
    if (!allLower.has(lo)) { allLower.add(lo); uniq.push(k); }
  }
  const missing = uniq.filter((k) => !matched.includes(k));
  const score = uniq.length === 0 ? 100 : Math.round((matched.length / uniq.length) * 100);
  return { matched, missing, score };
}

/** Quantified-impact detector: bullets containing numbers/percentages/money. */
function quantifiedImpact(bullets) {
  if (!Array.isArray(bullets)) bullets = [];
  const list = bullets.filter((b) => typeof b === 'string' && b.trim());
  const re = /(\d+([.,]\d+)?\s*%|\b\d+([.,]\d+)?|[US$R€£¥]\s?\d)/i;
  const quant = list.filter((b) => re.test(b)).length;
  return {
    quantified: quant,
    total: list.length,
    ratio: list.length === 0 ? 0 : round(quant / list.length),
  };
}

/** Bullet starts with a strong action verb? */
function startsWithActionVerb(bullet, verbs) {
  if (typeof bullet !== 'string') return false;
  const list = Array.isArray(verbs) && verbs.length ? verbs : ACTION_VERBS;
  const first = bullet.trim().toLowerCase();
  if (!first) return false;
  // accent-insensitive so "Liderei" matches "liderei" regardless of normalization
  return list.some((v) => typeof v === 'string' && v && first.startsWith(v.toLowerCase()));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * ATS readiness score (0–100), weighted:
 * contact 25 · summary 10 · experience 30 · education 10 · skills 20 · formatting 5.
 * Returns {score, issues:[{code,message}], max}.
 */
function atsScore(resume) {
  const issues = [];
  const fail = (code, message) => issues.push({ code, message });
  let s = 100;

  // --- contact (25) ---
  const name = String(resume.name || '').trim();
  const email = String(resume.email || '').trim();
  const phone = String(resume.phone || '').trim();
  if (!name) { s -= 15; fail('contact.name', 'Missing professional name.'); }
  if (!email) { s -= 10; fail('contact.email', 'No email — recruiters cannot reach you.'); }

  const phoneDigits = phone.replace(/\D/g, '');
  if (phone && phoneDigits.length < 8) { s -= 3; fail('contact.phone_short', 'Phone number looks too short.'); }

  // --- summary (10) ---
  const summary = String(resume.summary || '').trim();
  if (!summary) { s -= 10; fail('summary.missing', 'Add a 2–3 line professional summary.'); }
  else {
    const wc = summary.split(/\s+/).length;
    if (wc < 20 || wc > 120) {
      s -= 5;
      fail('summary.length', 'Summary should be 20–120 words.');
    }
  }

  // --- experience (30) ---
  const exps = Array.isArray(resume.experience) ? resume.experience : [];
  if (exps.length === 0) {
    s -= 30;
    fail('experience.missing', 'No work experience entries.');
  } else {
    let dated = 0;
    let bulleted = 0;
    for (const e of exps) {
      const hasFrom = !!parseMonth(e.from);
      const hasTo = !!parseMonth(e.to) || isPresent(e.to);
      if (hasFrom && hasTo) dated++;
      const bl = Array.isArray(e.bullets) ? e.bullets.filter((b) => typeof b === 'string' && b.trim()) : [];
      if (bl.length >= 2) bulleted++;
    }
    if (dated < exps.length) { s -= 7; fail('experience.dates', 'Every role needs from/to dates (or “Present”).'); }
    if (bulleted < exps.length) { s -= 13; fail('experience.bullets', 'Give each role 2+ achievement bullets.'); }
    const allBullets = exps.flatMap((e) => (Array.isArray(e.bullets) ? e.bullets.filter(Boolean) : []));
    if (allBullets.length > 0 && quantifiedImpact(allBullets).ratio < 0.5) {
      s -= 5;
      fail('experience.quantify', 'Quantify at least half your bullets with numbers.');
    }
    if (allBullets.length > 0 && !allBullets.some((b) => startsWithActionVerb(b))) {
      s -= 5;
      fail('experience.verbs', 'Start bullets with strong action verbs.');
    }
  }

  // --- education (10) ---
  const edus = Array.isArray(resume.education) ? resume.education.filter((e) => e && (e.degree || e.school)) : [];
  if (edus.length === 0) { s -= 10; fail('education.missing', 'Add at least one education entry.'); }

  // --- skills (20) ---
  const skills = Array.isArray(resume.skills) ? resume.skills.filter(Boolean) : [];
  if (skills.length < 5) { s -= 20; fail('skills.few', 'List at least 5 relevant skills.'); }

  // --- formatting (up to −5): ALL-CAPS words (not acronyms ≤5 chars) ---
  const fullText = [
    resume.summary,
    ...exps.flatMap((e) => [e.title, e.company, ...(Array.isArray(e.bullets) ? e.bullets : [])]),
    ...edus.flatMap((e) => [e.degree, e.school]),
  ].filter((v) => typeof v === 'string').join(' ');
  const caps = fullText.match(/\b[A-ZÁÂÃÀÇÉÊÍÓÔÕÚÜ]{6,}\b/g) || [];
  if (caps.length > 0) {
    s -= Math.min(caps.length * 5, 5);
    fail('formatting.caps', 'Avoid ALL-CAPS words (except short acronyms).');
  }

  s = Math.max(0, Math.min(100, Math.round(s)));
  return { score: s, issues, max: 100 };
}

/** Full plain-text export of a resume (for keyword scan + copy/paste). */
function resumeToText(r) {
  const parts = [r.name, r.email, r.phone, r.summary];
  for (const e of (r.experience || [])) {
    parts.push(e.title, e.company, `${e.from || ''} - ${e.to || ''}`, ...(e.bullets || []));
  }
  for (const ed of (r.education || [])) {
    parts.push(ed.degree, ed.school, ed.year);
  }
  parts.push(...(r.skills || []));
  return parts.filter((p) => typeof p === 'string' && p.trim()).join('\n');
}

export {
  round,
  parseMonth,
  isPresent,
  monthsBetween,
  humanDuration,
  atsKeywords,
  quantifiedImpact,
  startsWithActionVerb,
  atsScore,
  resumeToText,
};
