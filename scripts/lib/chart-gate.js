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
 *
 * ── The one place a reservation HAS to be reasoned about ────────────
 *
 * That stance had a hole in it. A reservation carries no course, so the prereq and
 * availability checks above see nothing to check, and this gate printed "every generated
 * plan passes every hard rule" over plans that put three `Concentration` cells in a term
 * where the tightest concentration could offer none. The verdict was true and its SCOPE was
 * named courses only, which is not what the sentence said.
 *
 * So `reservations` below asks the one question a placeholder can be wrong about: whichever
 * concentration the student eventually picks, can the cells reserved for it be answered by
 * DISTINCT courses from THAT option, each offered in its term's season and each prereq-clear
 * by then? `∀ option, ∃ a filling` — never `∃ a course, ∀ options`, which is candidate-set
 * intersection and is empty here.
 *
 * Two deliberate choices keep it an instrument rather than a second opinion from the engine:
 *
 *   The POOLS are data, read with core's `specForNode`/`materialize` — what the catalog says
 *   an option contains. The VERDICT is this file's own, including its own matching, because a
 *   gate that imported `witnessPlan` could not detect `witnessPlan` being wrong, which is the
 *   defect it exists to catch.
 *
 *   It is NECESSARY, not sufficient. A candidate's prerequisites are read against the named
 *   courses only, so a prereq that another reservation would have supplied reads as no-claim
 *   and the candidate counts as available. That over-estimates what is reachable, which is the
 *   safe direction: a violation reported here is real, and silence is not proof of feasibility.
 */

// The sentinel the emitter writes into a concentration cell's binding. Core, not engine: it is
// what a target IS, not how one gets scheduled.
import { CONCENTRATION } from "../../src/core/requirementDemand.js";

/**
 * @param {object} args
 * @param {object} args.plan          one entry of `plans[]` from a generated document
 * @param {Record<string,object>} args.courseMap
 * @param {(courseId: string, semTypeId: string) => boolean} args.offered
 * @param {(tree, placements, semIndex, ti) => string} args.evalPrereqTree
 * @param {number} args.creditCap     the registration cap for this student type
 * @param {number} args.minCourses    real courses a FULL term should carry; 0 disables
 * @param {number} args.realCourseSH  the credit floor at which a cell is a real course
 * @param {{title: string, ids: string[]}[]} [args.concentrationOptions]
 *   every concentration the student could still pick, already materialised to course ids.
 *   Empty or omitted for a program with none, or for a plan generated against a PICK — with
 *   one chosen there is no disjunction left to be wrong about.
 * @returns {{order: string[], availability: string[], overCap: string[], thin: string[],
 *            reservations: string[], fullTerms: number, ok: boolean}}
 */
export function gatePlan({ plan, courseMap, offered, evalPrereqTree,
                           creditCap, minCourses, realCourseSH,
                           concentrationOptions = [] }) {
  const placed = {};
  const rows = [];
  const concCells = [];
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
          // A cell reserved for the concentration, by the binding the emitter writes. Read
          // from the target sentinel rather than the title, because the title is the
          // requirement's own wording and varies across 93 programs.
          if (e.binding?.targets?.includes(CONCENTRATION)) concCells.push({ ord });
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

  // ── Whichever concentration the student picks, can the reservations be answered? ──
  //
  // One independent matching per option, over this option's own courses. A cell reserved for
  // the concentration is answerable here only by a course THIS option names — which is the
  // whole point, because the pools are typically disjoint and the union proves a filling no
  // single student can perform. See the header for why this is necessary and not sufficient.
  const reservations = [];
  // ── FILLABLE and CHOOSABLE are different promises ────────────────
  //
  // The matching below proves the cells can be filled. The card says "Concentration" and
  // renders as a slot the student is invited to fill, which promises a CHOICE. A cell where
  // one course works satisfies the first and breaks the second — and `minDepthOf` places pool
  // cells on exactly that basis, taking the MINIMUM over candidates, so a single early outlier
  // licenses the term for the whole pool.
  //
  // Counted, never gated, like the rest of the quality vector: a forced reservation is still a
  // followable plan, so it is bad advice rather than an illegal enrolment. It is counted
  // because nothing counted it, and 23 of 690 (plan, concentration) pairs had one.
  const choice = [];
  for (const opt of concCells.length ? concentrationOptions : []) {
    if (!opt?.ids?.length) continue;          // nothing enumerable: no claim to make
    const adj = concCells.map(c => opt.ids.filter(id => {
      const course = courseMap[id];
      if (!course) return false;
      if (!offered(id, rows[c.ord].season)) return false;
      if (!course.prereqs?.length) return true;
      return evalPrereqTree(course.prereqs, placed, semIndex, c.ord) !== "order";
    }));
    // How much of the promised choice survives, per cell, for this option.
    for (const legal of adj) choice.push(legal.length);
    const matched = maxMatching(adj);
    if (matched >= concCells.length) continue;
    // Hall's condition over PREFIXES, to name the term that carries the shortfall: a course
    // reachable by term t is reachable later too, so the cells up to t can never outnumber the
    // distinct courses available by t. "Infeasible" is not something a reader can act on.
    let worst = null;
    for (const c of concCells) {
      const upto = concCells.map((x, i) => [x, i]).filter(([x]) => x.ord <= c.ord);
      const want = upto.length;
      const have = new Set(upto.flatMap(([, i]) => adj[i])).size;
      if (want > have && (!worst || want - have > worst.want - worst.have)) {
        worst = { ord: c.ord, want, have };
      }
    }
    reservations.push(`${opt.title}: ${concCells.length} cells, ${matched} fillable`
      + (worst ? ` — by ${rows[worst.ord].label}, ${worst.want} reserved and ${worst.have} takeable` : ""));
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
    // A term with nothing placed has nothing to check. A pure work term lands here too:
    // its only entry is the co-op marker, which `walk` does not count as a cell.
    if (r.cells === 0) continue;
    // ── The credit cap still applies while employed ──────────────────
    //
    // This check used to be skipped for any co-op term. That was harmless while a MIXED
    // co-op term emitted no marker — it simply read as an ordinary term and was checked.
    // Now that the marker is written for those 90 terms, skipping on `coop` would have
    // quietly retired the registration-cap check on exactly the terms whose load this
    // work just changed. Employment does not raise the registrar's limit, so the hard
    // rule is checked here and only the CONVENTIONS below are waived.
    if (r.sh > creditCap * (r.half ? 0.5 : 1) + 0.01) overCap.push(`${r.label} ${r.sh} SH`);
    // The four-course bar is not a claim about someone on co-op — the departments
    // themselves schedule one course beside one — so a co-op term is not counted toward
    // it in either direction.
    if (r.coop || r.half || minCourses <= 0) continue;
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
    // ── Surviving choice, for a reservation that promises one ────────
    //
    // `choicePairs` is the denominator and is reported with the rest: a zero collapse count
    // means nothing beside how many reservations were EXPOSED to the question, which is the
    // error the previous version of this gate made about its own scope.
    //
    // The p10 rather than the mean, and for the reason `domains.js` gives for its own p10: the
    // mean of a pool that is 100% available in eight terms and 1 course in a ninth is a healthy
    // number describing a plan with a dead term in it. The tail IS the defect here.
    choicePairs: choice.length,
    choiceCollapsed: choice.filter(n => n <= 1).length,
    choiceTight: choice.filter(n => n <= 2).length,
    choiceP10: choice.length
      ? [...choice].sort((a, b) => a - b)[Math.floor(0.10 * choice.length)] : null,
    // Does THIS plan contain a forced reservation? The per-student unit, kept separate because
    // the per-pair rate is not one anybody experiences — 1.1% of pairs was 3.3% of students,
    // and reporting only the first is how the size of this was missed.
    choiceCollapsedHere: choice.some(n => n <= 1),
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
    order, availability, overCap, thin, fullTerms, emptyFull, quality, reservations,
    // `thin` is deliberately NOT part of `ok`. It is a convention CHART relaxes where it is
    // unsatisfiable — 4.2% of published full terms miss it too, and they are architecture and
    // art where one studio course is 16 credits. The other three are rules a student cannot
    // work around: the registrar refuses the enrolment, so one instance is a bug.
    ok: order.length === 0 && availability.length === 0 && overCap.length === 0
      && reservations.length === 0,
  };
}

/**
 * Maximum bipartite matching, cells to courses — Kuhn's, on adjacency lists.
 *
 * A SECOND implementation, next to the engine's `witnessPlan`, and deliberately so. This gate
 * exists to contradict the engine when the engine is wrong, and a check that imported the
 * engine's matching would agree with it by construction — including about the thing it is
 * meant to catch. The rule this file must not duplicate is *what counts as a violation*;
 * fifteen lines of textbook augmenting-path search is not that rule.
 */
function maxMatching(adj) {
  const takenBy = new Map();
  let size = 0;
  const augment = (i, seen) => {
    for (const id of adj[i]) {
      if (seen.has(id)) continue;
      seen.add(id);
      const holder = takenBy.get(id);
      if (holder === undefined || augment(holder, seen)) { takenBy.set(id, i); return true; }
    }
    return false;
  };
  for (let i = 0; i < adj.length; i++) if (augment(i, new Set())) size++;
  return size;
}
