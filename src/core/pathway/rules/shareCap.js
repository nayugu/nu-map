// ═══════════════════════════════════════════════════════════════════
// RULE: shareCap — the university-wide limit on shared credit.
//
// From the graduate catalog's Course Credit Sharing policy, verbatim:
//
//   "Not more than four graduate courses or 16 semester hours, whichever is
//    greater, taken while a student is in undergraduate status and
//    participating in an accelerated master's (PlusOne) program at
//    Northeastern, may be used to fulfill the requirements for both the
//    undergraduate and graduate degrees."
//
// ── "whichever is greater" is not a typo, and the cap is not 16 ────
//
// The limit is a DISJUNCTION. A share set is legal if it satisfies EITHER limb:
//
//     courses <= 4  ||  semesterHours <= 16
//
// Both limbs are load-bearing in published practice:
//
//   · Bouvé: "many courses are 3 credits each so students may take up to FIVE
//     courses and still double-count them" — 5 courses, 15 SH. Fails the course
//     limb, passes the SH limb.
//   · College of Science: "count up to 17 eligible undergraduate credits
//     toward a master's degree" — 4 courses, 17 SH. Fails the SH limb, passes
//     the course limb.
//
// So `&&` is wrong, `Math.min` is wrong, and a flat 16 SH ceiling is wrong for
// two colleges. This is the single most quoted error about PlusOne and the test
// suite pins all three cases.
//
// The policy's own escape hatch — "exceptions to this credit sharing limit
// must be approved through governance processes" — is why a violation here is
// still only a flag. We do not know whether a given student has one.
// ═══════════════════════════════════════════════════════════════════

import { STATUS } from "../ruleKinds.js";

const DEFAULTS = { courses: 4, semesterHours: 16 };

/**
 * @param {{courses?: number, semesterHours?: number}} rule
 * @param {import("../evaluate.js").PathwayCtx} ctx
 */
export default function shareCap(rule, ctx) {
  const courses = Number.isFinite(rule.courses) ? rule.courses : DEFAULTS.courses;
  const semesterHours = Number.isFinite(rule.semesterHours)
    ? rule.semesterHours : DEFAULTS.semesterHours;

  const totals = ctx?.totals ?? { courses: 0, semesterHours: 0 };
  const byCourses = totals.courses <= courses;
  const bySH = totals.semesterHours <= semesterHours;

  const evidence = {
    used: { courses: totals.courses, semesterHours: totals.semesterHours },
    limit: { courses, semesterHours },
    byCourses,
    bySH,
  };

  // Either limb is enough. Report WHICH one is carrying the set, because a
  // student at 5 courses / 15 SH is legal but has no course headroom left, and
  // that is worth seeing before they place a sixth.
  if (byCourses || bySH) {
    return {
      status: STATUS.SATISFIED,
      messageKey: "plusone.rule.shareCap.ok",
      params: {
        courses: totals.courses,
        maxCourses: courses,
        sh: totals.semesterHours,
        maxSH: semesterHours,
      },
      evidence,
    };
  }

  return {
    status: STATUS.VIOLATED,
    messageKey: "plusone.rule.shareCap.over",
    params: {
      courses: totals.courses,
      maxCourses: courses,
      sh: totals.semesterHours,
      maxSH: semesterHours,
    },
    evidence,
  };
}
