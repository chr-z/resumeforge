# ResumeForge — pure ATS engine (no DOM). Python 3, stdlib only.
# Runs identically under CPython (tests) and Pyodide/WASM (browser) —
# this module is the single source of truth for all scoring logic.
#
# Ported 1:1 from the JS v1 engine (js/core.js @ e6c4560); known-answer
# vectors preserved in tests/python/test_rfcore.py and mirrored through
# the real WASM runtime in tests/pyodide_engine.test.mjs.

from __future__ import annotations

import json
import math
import re
import sys
from typing import Any, Dict, List, Optional

MONTHS = {
    # EN
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    # PT-BR (jan/mar/jun/jul/nov shared above)
    "fev": 2, "abr": 4, "mai": 5, "ago": 8, "set": 9, "out": 10, "dez": 12,
}

ACTION_VERBS = [
    "led", "built", "shipped", "designed", "launched", "managed", "owned", "drove",
    "created", "improved", "reduced", "increased", "automated", "migrated", "scaled",
    "delivered", "implemented", "optimized", "negotiated", "mentored", "developed",
    "cut", "grew", "won", "streamlined", "architected", "refactored", "founded",
    "liderei", "construi", "criei", "implantei", "implementei", "otimizei", "reduzi",
    "aumentei", "entreguei", "gerenciei", "desenvolvi", "projetei", "migrei", "fundi",
]

_PRESENT_RE = re.compile(r"(present|current|now|atual|hoje)\Z", re.IGNORECASE)
_ISO_MONTH_RE = re.compile(r"(\d{4})-(\d{1,2})\Z")
_NAME_MONTH_RE = re.compile(r"([a-z]{3})[a-z]*[\s/.-]+(\d{4})\Z")
_QUANT_RE = re.compile(r"(\d+([.,]\d+)?\s*%|\b\d+([.,]\d+)?|[US$R\u20ac\u00a3\u00a5]\s?\d)", re.IGNORECASE)
_CAPS_RE = re.compile(r"\b[A-Z\u00c1\u00c2\u00c3\u00c0\u00c7\u00c9\u00ca\u00cd\u00d3\u00d4\u00d5\u00da\u00dc]{6,}\b")


def round_num(n: Any, d: int = 2) -> float:
    """Round to `d` decimals with JS Math.round semantics (half away from zero
    toward +infinity, plus the Number.EPSILON nudge of the original engine)."""
    f = 10.0 ** d
    x = (float(n) + sys.float_info.epsilon) * f
    return math.floor(x + 0.5) / f


def parse_month(raw: Any) -> Optional[str]:
    """Parse a resume date into an ISO month (YYYY-MM).
    Accepts \"2023-03\", \"Mar 2023\", \"March 2023\", \"mar/2023\".
    \"Present\"/\"Current\"/\"Now\"/\"Atual\"/\"Hoje\" -> None."""
    if not isinstance(raw, str):
        return None
    s = raw.strip().lower()
    if not s or _PRESENT_RE.fullmatch(s):
        return None

    m = _ISO_MONTH_RE.fullmatch(s)
    if m:
        mo = int(m.group(2))
        if 1 <= mo <= 12:
            return "%s-%02d" % (m.group(1), mo)
        return None

    m = _NAME_MONTH_RE.fullmatch(s)
    if m and m.group(1) in MONTHS:
        return "%s-%02d" % (m.group(2), MONTHS[m.group(1)])

    return None


def is_present(raw: Any) -> bool:
    """True when the string means \"still ongoing\" in EN or PT."""
    return isinstance(raw, str) and bool(_PRESENT_RE.fullmatch(raw.strip()))


def months_between(from_iso: Any, to_iso: Any) -> Optional[int]:
    """Months between two ISO months. Negative ranges -> None."""
    def parts(v: Any) -> Optional[List[int]]:
        if not isinstance(v, str):
            return None
        bits = v.split("-")
        if len(bits) != 2:
            return None
        try:
            y, mo = int(bits[0]), int(bits[1])
        except ValueError:
            return None
        if not (math.isfinite(y) and math.isfinite(mo)):
            return None
        return [y, mo]

    p1, p2 = parts(from_iso), parts(to_iso)
    if p1 is None or p2 is None:
        return None
    n = (p2[0] - p1[0]) * 12 + (p2[1] - p1[1])
    return None if n < 0 else n


def human_duration(months: Any, years_label: str = "yr", months_label: str = "mo") -> Optional[str]:
    """Human duration from N months (\"1 yr 6 mos\"). >=24 months collapses to years only."""
    try:
        n = float(months)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(n) or n < 0:
        return None
    n = int(n)
    years = n // 12
    mos = n % 12
    yl = years_label or "yr"
    ml = months_label or "mo"
    ys = "" if years == 1 else "s"
    ms = "" if mos == 1 else "s"
    if years == 0:
        return f"{mos} {ml}{ms}"
    if mos == 0 or n >= 24:
        return f"{years} {yl}{ys}"
    return f"{years} {yl}{ys} {mos} {ml}{ms}"


def _kw_pattern(kw: str) -> str:
    escaped = re.sub(r"[.*+?^${}()|[\]\\]", lambda c: "\\" + c.group(0), kw)
    return "(^|[^a-z0-9])" + escaped + "([^a-z0-9]|$)"


def ats_keywords(text: Any, keywords: Any) -> Dict[str, Any]:
    """ATS keyword coverage against the job posting.
    Word-boundary match so \"java\" does NOT match inside \"javascript\"."""
    if not isinstance(keywords, list):
        keywords = []
    hay = (text if isinstance(text, str) else "").lower()
    matched: List[str] = []
    seen_lower = set()
    for kw_raw in keywords:
        kw = (str(kw_raw) if kw_raw is not None else "").strip().lower()
        if not kw or kw in seen_lower:
            continue
        try:
            hit = re.search(_kw_pattern(kw), hay, re.IGNORECASE) is not None
        except re.error:
            continue
        if hit:
            matched.append(str(kw_raw).strip())
            seen_lower.add(kw)
    # unique non-blank keywords in their original casing
    uniq: List[str] = []
    all_lower = set()
    for k in [(str(k) if k is not None else "").strip() for k in keywords]:
        if not k:
            continue
        lo = k.lower()
        if lo not in all_lower:
            all_lower.add(lo)
            uniq.append(k)
    missing = [k for k in uniq if k not in matched]
    score = 100 if len(uniq) == 0 else int(round_num(len(matched) / len(uniq) * 100, 0))
    return {"matched": matched, "missing": missing, "score": score}


def quantified_impact(bullets: Any) -> Dict[str, Any]:
    """Quantified-impact detector: bullets containing numbers/percentages/money."""
    if not isinstance(bullets, list):
        bullets = []
    lst = [b for b in bullets if isinstance(b, str) and b.strip()]
    quant = sum(1 for b in lst if _QUANT_RE.search(b))
    return {
        "quantified": quant,
        "total": len(lst),
        "ratio": 0 if len(lst) == 0 else round_num(quant / len(lst)),
    }


def starts_with_action_verb(bullet: Any, verbs: Any = None) -> bool:
    """Bullet starts with a strong action verb?"""
    if not isinstance(bullet, str):
        return False
    lst = verbs if isinstance(verbs, list) and len(verbs) > 0 else ACTION_VERBS
    first = bullet.strip().lower()
    if not first:
        return False
    # accent-insensitive so "Liderei" matches "liderei" regardless of normalization
    return any(
        isinstance(v, str) and v and first.startswith(v.lower())
        for v in lst
    )


def ats_score(resume: Any) -> Dict[str, Any]:
    """ATS readiness score (0-100), weighted:
    contact 25 - summary 10 - experience 30 - education 10 - skills 20 - formatting 5.
    Returns {score, issues:[{code,message}], max}."""
    if not isinstance(resume, dict):
        resume = {}
    issues: List[Dict[str, str]] = []

    def fail(code: str, message: str) -> None:
        issues.append({"code": code, "message": message})

    s = 100.0

    # --- contact (25) ---
    name = str(resume.get("name") or "").strip()
    email = str(resume.get("email") or "").strip()
    phone = str(resume.get("phone") or "").strip()
    if not name:
        s -= 15
        fail("contact.name", "Missing professional name.")
    if not email:
        s -= 10
        fail("contact.email", "No email — recruiters cannot reach you.")

    phone_digits = re.sub(r"\D", "", phone)
    if phone and len(phone_digits) < 8:
        s -= 3
        fail("contact.phone_short", "Phone number looks too short.")

    # --- summary (10) ---
    summary = str(resume.get("summary") or "").strip()
    if not summary:
        s -= 10
        fail("summary.missing", "Add a 2–3 line professional summary.")
    else:
        wc = len(summary.split())
        if wc < 20 or wc > 120:
            s -= 5
            fail("summary.length", "Summary should be 20–120 words.")

    # --- experience (30) ---
    exps = resume.get("experience") if isinstance(resume.get("experience"), list) else []
    if len(exps) == 0:
        s -= 30
        fail("experience.missing", "No work experience entries.")
    else:
        dated = 0
        bulleted = 0
        for e in exps:
            e = e if isinstance(e, dict) else {}
            has_from = parse_month(e.get("from")) is not None
            has_to = parse_month(e.get("to")) is not None or is_present(e.get("to"))
            if has_from and has_to:
                dated += 1
            raw_bullets = e.get("bullets") if isinstance(e.get("bullets"), list) else []
            bl = [b for b in raw_bullets if isinstance(b, str) and b.strip()]
            if len(bl) >= 2:
                bulleted += 1
        if dated < len(exps):
            s -= 7
            fail("experience.dates", "Every role needs from/to dates (or “Present”).")
        if bulleted < len(exps):
            s -= 13
            fail("experience.bullets", "Give each role 2+ achievement bullets.")
        all_bullets: List[str] = []
        for e in exps:
            e = e if isinstance(e, dict) else {}
            raw_bullets = e.get("bullets") if isinstance(e.get("bullets"), list) else []
            all_bullets.extend(b for b in raw_bullets if b)
        if len(all_bullets) > 0 and quantified_impact(all_bullets)["ratio"] < 0.5:
            s -= 5
            fail("experience.quantify", "Quantify at least half your bullets with numbers.")
        if len(all_bullets) > 0 and not any(starts_with_action_verb(b) for b in all_bullets):
            s -= 5
            fail("experience.verbs", "Start bullets with strong action verbs.")

    # --- education (10) ---
    raw_edus = resume.get("education") if isinstance(resume.get("education"), list) else []
    edus = [
        e for e in raw_edus
        if isinstance(e, dict) and (e.get("degree") or e.get("school"))
    ]
    if len(edus) == 0:
        s -= 10
        fail("education.missing", "Add at least one education entry.")

    # --- skills (20) ---
    raw_skills = resume.get("skills") if isinstance(resume.get("skills"), list) else []
    skills = [sk for sk in raw_skills if sk]
    if len(skills) < 5:
        s -= 20
        fail("skills.few", "List at least 5 relevant skills.")

    # --- formatting (up to −5): ALL-CAPS words (not acronyms <=5 chars) ---
    text_parts: List[str] = [resume.get("summary")]
    for e in exps:
        e = e if isinstance(e, dict) else {}
        text_parts.append(e.get("title"))
        text_parts.append(e.get("company"))
        raw_bullets = e.get("bullets") if isinstance(e.get("bullets"), list) else []
        text_parts.extend(raw_bullets)
    for e in edus:
        text_parts.append(e.get("degree"))
        text_parts.append(e.get("school"))
    full_text = " ".join(p for p in text_parts if isinstance(p, str))
    caps = _CAPS_RE.findall(full_text)
    if len(caps) > 0:
        s -= min(len(caps) * 5, 5)
        fail("formatting.caps", "Avoid ALL-CAPS words (except short acronyms).")

    score = max(0, min(100, int(round_num(s, 0))))
    return {"score": score, "issues": issues, "max": 100}


def resume_to_text(r: Any) -> str:
    """Full plain-text export of a resume (for keyword scan + copy/paste)."""
    if not isinstance(r, dict):
        r = {}
    parts: List[Any] = [r.get("name"), r.get("email"), r.get("phone"), r.get("summary")]
    for e in (r.get("experience") or []):
        e = e if isinstance(e, dict) else {}
        parts.append(e.get("title"))
        parts.append(e.get("company"))
        parts.append("%s - %s" % (e.get("from") or "", e.get("to") or ""))
        raw_bullets = e.get("bullets") if isinstance(e.get("bullets"), list) else []
        parts.extend(raw_bullets)
    for ed in (r.get("education") or []):
        ed = ed if isinstance(ed, dict) else {}
        parts.append(ed.get("degree"))
        parts.append(ed.get("school"))
        parts.append(ed.get("year"))
    raw_skills = r.get("skills") if isinstance(r.get("skills"), list) else []
    parts.extend(raw_skills)
    return "\n".join(p for p in parts if isinstance(p, str) and p.strip())


# ---------------------------------------------------------------------------
# JSON bridge — every engine capability exposed as a JSON-string in/out API.
# The browser UI (Pyodide) and the CI bridge tests call ONLY these.
# ---------------------------------------------------------------------------
def _human_duration_js(months: Any, opts: Any = None) -> Optional[str]:
    o = opts if isinstance(opts, dict) else {}
    return human_duration(months, o.get("yearsLabel") or "yr", o.get("monthsLabel") or "mo")

def _starts_with_action_verb_js(bullet: Any, verbs: Any = None) -> bool:
    return starts_with_action_verb(bullet, verbs)

_API = {
    "round": round_num,
    "parseMonth": parse_month,
    "isPresent": is_present,
    "monthsBetween": months_between,
    "humanDuration": _human_duration_js,
    "atsKeywords": ats_keywords,
    "quantifiedImpact": quantified_impact,
    "startsWithActionVerb": _starts_with_action_verb_js,
    "atsScore": ats_score,
    "resumeToText": resume_to_text,
}


def api_names_json(_: str = "") -> str:
    return json.dumps(sorted(_API.keys()))


def api_json(name: str, args_json: str) -> str:
    """Generic dispatcher: api_json('atsScore', '<resume-json>') -> '<result-json>'.
    Arguments are always POSITIONAL (JS-call semantics): a JSON array spreads
    into multiple arguments; any other JSON value is the single argument."""
    fn = _API.get(name)
    if fn is None:
        raise KeyError(name)
    args = json.loads(args_json)
    argv = list(args) if isinstance(args, list) else [args]
    result = fn(*argv)
    return json.dumps(result, ensure_ascii=False)
