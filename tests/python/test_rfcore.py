# ResumeForge — business logic tests (CPython, zero deps).
# Mirrors the v1 JS suite 1:1 (tests/core.test.js) with identical known-answer vectors.
# Run: python3 -m unittest discover -s tests/python -v
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python"))
from rfcore import (  # noqa: E402
    ats_keywords,
    ats_score,
    human_duration,
    is_present,
    months_between,
    parse_month,
    quantified_impact,
    resume_to_text,
    round_num,
    starts_with_action_verb,
)


# ---------- parseMonth ----------
class ParseMonth(unittest.TestCase):
    def test_iso_month_names_and_pt_slash_formats(self):
        self.assertEqual(parse_month("2023-03"), "2023-03")
        self.assertEqual(parse_month("Mar 2023"), "2023-03")
        self.assertEqual(parse_month("September 2019"), "2019-09")
        self.assertEqual(parse_month("dez/2022"), "2022-12")  # pt month + slash

    def test_present_like_words_null_and_invalid_rejected(self):
        for w in ["Present", "Current", "Now", "Atual", "Hoje"]:
            self.assertIsNone(parse_month(w))
        self.assertIsNone(parse_month("13/2023"))   # impossible month number
        self.assertIsNone(parse_month("Foo 2023"))  # not a month
        self.assertIsNone(parse_month(42))          # not a string
        self.assertIsNone(parse_month(""))


# ---------- isPresent / monthsBetween ----------
class IsPresentMonthsBetween(unittest.TestCase):
    def test_is_present_detects_ongoing_ranges_en_and_pt(self):
        self.assertTrue(is_present("Present"))
        self.assertTrue(is_present(" atual "))
        self.assertFalse(is_present("2024-01"))
        self.assertFalse(is_present(None))

    def test_months_between_inclusive_math_and_invalid_ranges(self):
        self.assertEqual(months_between("2022-01", "2023-01"), 12)
        self.assertEqual(months_between("2022-01", "2022-01"), 0)
        self.assertIsNone(months_between("2022-06", "2022-03"))  # negative -> None
        self.assertIsNone(months_between(None, "2022-03"))


# ---------- humanDuration ----------
class HumanDuration(unittest.TestCase):
    def test_years_months_with_collapse_rule(self):
        self.assertEqual(human_duration(6), "6 mos")
        self.assertEqual(human_duration(1, "yr", "mês"), "1 mês")
        self.assertEqual(human_duration(18), "1 yr 6 mos")
        self.assertEqual(human_duration(24), "2 yrs")  # >=24 collapses to years only
        self.assertEqual(human_duration(36), "3 yrs")
        self.assertIsNone(human_duration(-1))


# ---------- atsKeywords ----------
class AtsKeywords(unittest.TestCase):
    def test_word_boundary_java_does_not_match_javascript(self):
        r = ats_keywords(
            "Built services in JavaScript and Java on AWS. Led CI/CD.",
            ["javascript", "java", "aws", "docker"],
        )
        self.assertEqual(r["matched"], ["javascript", "java", "aws"])
        self.assertEqual(r["missing"], ["docker"])
        self.assertEqual(r["score"], 75)

    def test_dedupes_blanks_and_empty_keywords_perfect_score(self):
        r = ats_keywords("deployed on AWS", ["AWS", "", "aws ", "K8S"])
        self.assertEqual(r["matched"], ["AWS"])  # case-insensitive, deduped
        self.assertEqual(r["missing"], ["K8S"])
        self.assertEqual(r["score"], 50)
        self.assertEqual(ats_keywords("anything", [])["score"], 100)


# ---------- quantifiedImpact ----------
class QuantifiedImpact(unittest.TestCase):
    def test_numbers_percent_money_count_as_quantified(self):
        r = quantified_impact([
            "Reduced latency by 40%",
            "Managed the payments team",           # no numbers -> unquantified
            "Cut infra spend from R$ 90k to R$ 61k",
            "Shipped feature used by 1.2M users",
        ])
        self.assertEqual(r["quantified"], 3)
        self.assertEqual(r["total"], 4)
        self.assertEqual(r["ratio"], 0.75)
        self.assertEqual(quantified_impact([])["ratio"], 0)
        self.assertEqual(quantified_impact("nope")["total"], 0)


# ---------- startsWithActionVerb ----------
class StartsWithActionVerb(unittest.TestCase):
    def test_strong_openers_en_and_pt_accent_safe(self):
        self.assertTrue(starts_with_action_verb("Led a team of 8"))
        self.assertTrue(starts_with_action_verb("  liderei um time de 8"))
        self.assertFalse(starts_with_action_verb("Responsible for testing"))
        self.assertFalse(starts_with_action_verb(""))


# ---------- atsScore ----------
def good_resume():
    return {
        "name": "Ada Lovelace",
        "email": "ada@example.com",
        "phone": "+55 11 91234-5678",
        "summary": "Backend engineer with eight years of experience building reliable payment systems, leading teams and reducing cloud costs across high traffic platforms.",
        "experience": [{
            "title": "Senior Engineer",
            "company": "Acme",
            "from": "Jan 2020",
            "to": "Present",
            "bullets": [
                "Led migration of legacy APIs, cutting p99 latency by 35%",
                "Automated deployments and reduced release effort to 15 minutes",
            ],
        }],
        "education": [{"degree": "BSc Computer Science", "school": "UFPE", "year": "2015"}],
        "skills": ["Node.js", "PostgreSQL", "AWS", "Docker", "Kubernetes"],
    }


class AtsScore(unittest.TestCase):
    def test_complete_resume_scores_100_zero_issues(self):
        r = ats_score(good_resume())
        self.assertEqual(r["score"], 100)
        self.assertEqual(r["issues"], [])

    def test_empty_resume_scores_near_zero_with_issues(self):
        r = ats_score({})
        self.assertLessEqual(r["score"], 10)
        codes = [i["code"] for i in r["issues"]]
        for c in ["contact.name", "contact.email", "summary.missing",
                  "experience.missing", "education.missing", "skills.few"]:
            self.assertIn(c, codes)

    def test_each_fixable_defect_deducts_expected_weight(self):
        base = good_resume()
        no_skills = json.loads(json.dumps(base))
        no_skills["skills"] = []
        self.assertEqual(ats_score(no_skills)["score"], 80)

        short_summary = good_resume()
        short_summary["summary"] = "Too short."
        self.assertEqual(ats_score(short_summary)["score"], 95)

        caps = good_resume()
        caps["experience"][0]["bullets"][0] = "LED MIGRATION OF LEGACY APIS WITH GREAT RESULTS"
        rc = ats_score(caps)
        self.assertEqual(rc["score"], 95)
        self.assertTrue(any(i["code"] == "formatting.caps" for i in rc["issues"]))

    def test_clamps_at_zero_never_negative(self):
        r = ats_score({})
        self.assertGreaterEqual(r["score"], 0)
        self.assertIsInstance(r["score"], int)


# ---------- round (JS-parity helper) ----------
class RoundNum(unittest.TestCase):
    def test_js_round_semantics(self):
        self.assertEqual(round_num(2.5), 2.5)          # default d=2 keeps 2.5
        self.assertEqual(round_num(2.5, 0), 3.0)       # half-up at d=0
        self.assertEqual(round_num(0.125 * 100, 0), 13.0)
        self.assertEqual(round_num(-2.7, 0), -3.0)
        self.assertEqual(round_num(0.335, 2), 0.34)    # epsilon nudge parity


# ---------- resumeToText ----------
class ResumeToText(unittest.TestCase):
    def test_flattens_all_sections_into_plain_text(self):
        txt = resume_to_text(good_resume())
        self.assertIn("ada@example.com", txt)
        self.assertIn("Acme", txt)
        self.assertIn("PostgreSQL", txt)


if __name__ == "__main__":
    unittest.main()
