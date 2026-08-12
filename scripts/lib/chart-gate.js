/**
 * chart-gate.js — the hard rules a generated plan must satisfy, in one place.
 *
 * ── Why this is a library and not a test ────────────────────────────
 *
 * The same four checks are needed by three callers that must not each write their own:
 *
 *   test/invariant/chart-hard-rules.test.js   fails the suite on a regression
 *   scripts/precompute-plans.js               refuses to WRITE a violating plan
 *   the app, eventually                       explains a plan to a student
 *
 * Three copies of "what counts as a violation" is exactly how CHART came to disagree with
 * the app about availability in the first place — four implementations of `offered`, one of
 * them weaker than the rest. So the rules live here and every caller asks.
 *
 * ── Checked with the APP's checkers, over the plan the UI HOLDS ──────
 *
 * `evalPrereqTree` is the function that draws the `! order` badge, and `offered` is the
 * verdict `CourseCard` renders. Using the engine's own notion instead is what let an engine
 * wrong twice in the same way score zero: an `! order` badge appeared on screen while the
 * differential reported none.
 *
 * And only NAMED courses exist here, because a choice or pool cell is a reservation
 * containing no course. The engine's witness proves reachability using courses it MATCHED
 * into pool cells, and those courses are not in the student's plan — reading the plan the
 * way the engine does would reproduce the same blind spot.
 */

/**
 * @param {object} args
 * @param {object} args.plan          one entry of `plans[]` from a generated document
 * @param {Record<string,object>} args.courseMap
 * @param {(courseId: string, semTypeId: string) => boolean} args.offered
 * @param {(tree, placements, semIndex, ti) => string} args.evalPrereqTree
 * @param {number} args.creditCap     the registration cap for this student type
 * @param {number} args.minCourses    real courses a FULL term should carry; 0 disables
 * @param {number} args.realCourseSH  the credit floor at which a cell is a real course
 * @returns {{order: string[], availability: string[], overCap: string[], thin: string[],
 *            fullTerms: number, ok: boolean}}
 */
export function gatePlan({ plan, courseMap, offered, evalPrereqTree,
                           creditCap, minCourses, realCourseSH }) {
  const placed = {};
  const rows = [];
  let ord = 0;
  for (const year of plan?.years ?? []) {
    for (const t of year.terms ?? []) {
      let coop = false, cells = 0, big = 0, sh = 0;
      const walk = (entries) => {
        for (const e of entries ?? []) {
          if (e.coop) { coop = true; walk(e.children); continue; }
          if (e.vacation || e.heading) { walk(e.children); continue; }
          cells++;
          sh += e.sh ?? 0;
          if ((e.sh ?? 0) >= realCourseSH) big++;
          if (e.options?.length === 1) for (const id of e.options[0]) placed[id] = ord;
          walk(e.children);
        }
      };
      walk(t.entries);
      rows.push({
        label: `${year.label ?? ""} ${t.term ?? ""}`.trim(),
        season: t.type, coop, cells, big, sh,
        // A work term still occupies an ordinal: it separates a prerequisite from the
        // course that needs it, and collapsing it would make a co-op look like no time at all.
        half: /summer\s*(1|2|a|b)/i.test(`${t.term ?? ""}`),
      });
      ord++;
    }
  }

  const semIndex = {};
  for (let i = 0; i < ord; i++) semIndex[i] = i;

  const order = [], availability = [];
  for (const [id, at] of Object.entries(placed)) {
    if (!offered(id, rows[at].season)) availability.push(`${id} in ${rows[at].label}`);
    const course = courseMap[id];
    if (!course?.prereqs?.length) continue;
    // The strictest reading: no transfer credit, no prior takes, no asserted conditions.
    // A generated plan asserts none of those, so anything it needs it must schedule.
    if (evalPrereqTree(course.prereqs, placed, semIndex, at) === "order") {
      order.push(`${id} in ${rows[at].label}`);
    }
  }

  const overCap = [], thin = [];
  let fullTerms = 0;
  for (const r of rows) {
    if (r.coop || r.cells === 0) continue;
    if (r.sh > creditCap * (r.half ? 0.5 : 1) + 0.01) overCap.push(`${r.label} ${r.sh} SH`);
    if (r.half || minCourses <= 0) continue;
    fullTerms++;
    if (r.big < minCourses) thin.push(`${r.label} (${r.big})`);
  }

  return {
    order, availability, overCap, thin, fullTerms,
    // `thin` is deliberately NOT part of `ok`. It is a convention CHART relaxes where it is
    // unsatisfiable — 4.2% of published full terms miss it too, and they are architecture and
    // art where one studio course is 16 credits. The other three are rules a student cannot
    // work around: the registrar refuses the enrolment, so one instance is a bug.
    ok: order.length === 0 && availability.length === 0 && overCap.length === 0,
  };
}
