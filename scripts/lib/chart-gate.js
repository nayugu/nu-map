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
      // Cells of ONE requirement in this term, and how many carry no named course. Both are
      // quality properties that live only in the search's branch ORDER, so nothing guarantees
      // them and nothing was counting them either — see `quality` below.
      const perReq = new Map();
      let fillers = 0;
      const walk = (entries) => {
        for (const e of entries ?? []) {
          if (e.coop) { coop = true; walk(e.children); continue; }
          if (e.vacation || e.heading) { walk(e.children); continue; }
          cells++;
          sh += e.sh ?? 0;
          if ((e.sh ?? 0) >= realCourseSH) big++;
          // The requirement's own title is the cell's label by construction, so it identifies
          // the requirement without needing the binding solve a catalog plan would.
          const key = e.text ?? "";
          if (key) perReq.set(key, (perReq.get(key) ?? 0) + 1);
          if (!e.options?.length) fillers++;
          if (e.options?.length === 1) for (const id of e.options[0]) placed[id] = ord;
          walk(e.children);
        }
      };
      walk(t.entries);
      rows.push({
        label: `${year.label ?? ""} ${t.term ?? ""}`.trim(),
        season: t.type, coop, cells, big, sh,
        maxPerReq: perReq.size ? Math.max(...perReq.values()) : 0,
        fillers,
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

  const overCap = [], thin = [], emptyFull = [];
  let fullTerms = 0;
  for (const r of rows) {
    // ── An EMPTY fall or spring is the defect this gate could not see ──
    //
    // `cells === 0` skipped the term entirely, so a four-year plan with nothing at all in its
    // final spring passed every check and reported zero thin terms. It is a worse outcome than
    // a light term by any reading — the student is not enrolled that semester — and it was also
    // a loophole: the four-course rule exempts terms not in use, so the search could satisfy
    // "every used full term holds four" by emptying one instead of filling it. That is exactly
    // what `american_sign_language_and_human_services` did, reaching 4/4/4/4/4/4/4/0.
    //
    // Reported, not gated, for the same reason `thin` is not: an empty term is unfollowable
    // advice rather than an illegal registration, and the registrar refuses neither. But it is
    // counted now, because a metric that cannot observe a defect will report its absence.
    if (!r.coop && r.cells === 0 && !r.half) emptyFull.push(r.label);
    if (r.coop || r.cells === 0) continue;
    if (r.sh > creditCap * (r.half ? 0.5 : 1) + 0.01) overCap.push(`${r.label} ${r.sh} SH`);
    if (r.half || minCourses <= 0) continue;
    fullTerms++;
    // Credit-aware, matching the engine: a term with no room for another real course is FULL,
    // whatever its course count. A 16 SH studio cannot reach four inside a 19 SH cap, and
    // calling it thin described it wrongly rather than finding a defect.
    if (r.big < minCourses && r.sh + realCourseSH <= creditCap + 0.01) {
      thin.push(`${r.label} (${r.big} courses, ${r.sh} SH)`);
    }
  }

  // ── The QUALITY VECTOR ──────────────────────────────────────────────
  //
  // Every property below is one the engine expresses ONLY as branch ordering in the search:
  // spread a requirement's cells, keep placeholders late, balance the load. Branch order biases
  // which legal plan is found first and can guarantee nothing, so each of these can be violated
  // on any given program — and until now none of them was counted.
  //
  // That gap is why two days of work found quality defects one at a time, by accident. "No
  // empty semesters" was worth exactly zero to this engine: nothing measured it, so nothing
  // protected it, and 63% of graduate plans had one. The single counter added for it exposed
  // that within minutes.
  //
  // So this is the cheap half of the permanent fix: a property that is counted every run cannot
  // regress silently. It is REPORTED and not gated, because none of it is a rule a registrar
  // enforces — a clumped term is bad advice, not an illegal enrolment.
  const studyRows = rows.filter(r => !r.coop && r.cells > 0);
  const span = Math.max(1, rows.length - 1);
  const quality = {
    // Terms holding three or more cells of ONE requirement. Departments do this in 0.7% of
    // terms; CHART measured 14.3% before the per-requirement cap existed.
    clumped: studyRows.filter(r => r.maxPerReq >= 3).length,
    studyTerms: studyRows.length,
    // Where the placeholders sit, as a fraction through the plan. Departments average 0.601 and
    // CHART 0.576 — the motivating complaint of the whole engine was electives spent too early,
    // so this is the number that says whether the inversion still holds.
    fillerCount: rows.reduce((n, r) => n + r.fillers, 0),
    fillerPositionSum: rows.reduce((n, r, i) => n + r.fillers * (i / span), 0),
    // Credit balance, as the worst gap between any two study terms in the plan. A plan that is
    // legal on every term cap can still be 19 SH then 8 SH, which no student would choose.
    loadSpread: studyRows.length
      ? Math.max(...studyRows.map(r => r.sh)) - Math.min(...studyRows.map(r => r.sh)) : 0,
    // The longest RUN of consecutive empty full terms. Three scattered gaps and one three-term
    // gap are very different plans, and a count alone cannot tell them apart.
    longestEmptyRun: (() => {
      let best = 0, cur = 0;
      for (const r of rows) {
        if (!r.coop && !r.half && r.cells === 0) { cur += 1; best = Math.max(best, cur); }
        else if (!r.half) cur = 0;
      }
      return best;
    })(),
  };

  return {
    order, availability, overCap, thin, fullTerms, emptyFull, quality,
    // `thin` is deliberately NOT part of `ok`. It is a convention CHART relaxes where it is
    // unsatisfiable — 4.2% of published full terms miss it too, and they are architecture and
    // art where one studio course is 16 credits. The other three are rules a student cannot
    // work around: the registrar refuses the enrolment, so one instance is a bug.
    ok: order.length === 0 && availability.length === 0 && overCap.length === 0,
  };
}
