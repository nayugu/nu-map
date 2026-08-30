/**
 * requirementBinding.js — which requirement an unanswered plan cell stands for.
 *
 * Moved here from scripts/lib/plan-binding.js unchanged. It is domain logic,
 * not scrape logic: it already imported only from src/core, and the runtime
 * needs it for the same reason the scraper does.
 *
 * Running it at RUNTIME is what closes the gap a reservation otherwise has.
 * `applySamplePlan` records a requirement only when the binding was forced, so
 * an ambiguous card arrives knowing nothing and offers the entire catalog —
 * 7,966 courses where the union of its actual candidates is a median of 34.
 * Carrying the answer instead of recomputing it was measured at +54% on the
 * reservations payload, and it would freeze at the moment the plan was applied
 * and drift against the next scrape. Recomputing costs nothing to store, cannot
 * go stale, and sharpens as the student places courses.
 *
 * ## Why the cell's own words cannot decide
 *
 * The plan pane and the requirements pane are two descriptions of one degree,
 * written by the same department, and they disagree. 9,629 cells name no
 * course, worded 1,353 distinct ways. The same requirement — identical
 * ten-course list, same 4 SH — is titled "Supporting Course" in Computer
 * Science and Mathematics and "Computing and Social Issues" in Computer
 * Science BSCS, and each program's plan cell matches the OTHER program's title.
 * A matcher keyed on wording gets one right, the other wrong, and cannot tell
 * the two situations apart.
 *
 * ## What decides: what is left over
 *
 * Everything the plan names outright is checked off against the requirements,
 * and whatever demand remains is what the unnamed cells stand for. CS and
 * Mathematics closes to the credit hour — 8 SH of Khoury, 12 of Mathematics
 * electives, one Supporting Course, 28 of general electives against exactly
 * 2 + 3 + 1 + 7 cells. "Computing and social issues" is identified because it
 * is the only thing left standing, with nothing about the phrase recognised.
 *
 * ## Why this is a flow problem
 *
 * Assign unanswered cells to outstanding requirements without exceeding any
 * requirement's capacity. That is a capacitated assignment, and it has an exact
 * answer, so approximating it with a hand-tuned ladder of relaxation rules —
 * which an earlier attempt did, complete with a pass limit and a strength table
 * chosen by its author — is solving a solved problem badly.
 *
 * Capacity is counted in CELLS rather than credit hours, which is what stops a
 * 4 SH cell being split two hours into one requirement and two into another. A
 * requirement short by 8 SH of 4 SH courses can absorb two cells.
 *
 * Classification is then exact. For each cell/requirement pair, force that
 * assignment and re-solve: if the maximum flow is unchanged the pair is
 * POSSIBLE, otherwise it is impossible. A cell left with exactly one possible
 * requirement is FORCED. The graphs are tiny (tens of nodes) and this runs
 * offline, so the O(cells x requirements) re-solves cost nothing.
 *
 * ## Evidence may narrow; it never decides
 *
 * Two kinds, and mixing them is what forced the earlier attempt to invent
 * "relaxation":
 *
 *   checkable   "MATH elective" — the Khoury bucket admits no MATH course, so
 *               that edge does not exist. A fact about course sets.
 *   wording     "Khoury Elective" ~ "Khoury Approved Electives". A guess.
 *
 * Facts remove edges outright. Wording is applied only if the graph still
 * carries the same maximum flow without it — so a hint that contradicts the
 * arithmetic is dropped rather than obeyed, and no relaxation ladder is needed
 * to notice.
 */

import { specForNode, specIsEmpty, courseEligible } from "./programEligibility.js";
import { allocateSections } from "./gradRequirements.js";
// Sizing a requirement and measuring what a student has satisfied since must
// use the identical numbers, or a reservation could bind to a requirement the
// audit considers met.
import {
  DEFAULT_UNIT_SH, GENERAL_ELECTIVE, CONCENTRATION,
  typicalSH, demandOf, shortfallOf, deepPools,
} from "./requirementDemand.js";

export { GENERAL_ELECTIVE, CONCENTRATION };

/**
 * The degree's free-elective allowance: what the total leaves over.
 *
 * ── One rule, because there used to be three ──────────────────────
 *
 * The same quantity was computed three different ways, and two of them were
 * wrong for the same reason — they trusted `generalElectiveSH`, which only 95
 * of 1,071 programs state at all:
 *
 *   the panel      `major.generalElectiveSH ?? 0` — so for the other 976 the
 *                  General Electives section read "12/0 SH", a section
 *                  reporting more credit than it required;
 *   obligationsOf  `stated ?? residual` — the stated figure won where present,
 *                  disagreeing with CHART on exactly those 95;
 *   deriveCells    the residual, always, having measured that the stated figure
 *                  is wrong in BOTH directions (a program stating 8 SH with 23
 *                  unaccounted for; sections 120 + stated 20 against a 133 SH
 *                  degree).
 *
 * The residual is right because it makes "the plan totals the degree" true by
 * construction instead of usually true, and `totalCreditsRequired` is the
 * degree's own headline claim. So the residual is the rule everywhere, and the
 * stated figure survives as a SIGNAL: where the two disagree, one of the
 * catalog's own numbers is wrong, and `deriveCells` says which two.
 *
 * CHART still takes its residual against its own cell total rather than calling
 * this — deliberately, and it is not a fourth rule: a co-requisite pair is one
 * cell and two courses, so cells and `demandOf` legitimately count differently.
 * Mixing the two accountings in one plan is what left Industrial Engineering
 * eight credits short of its own degree. Same rule, measured in each layer's
 * own unit, with `reconciliation` reporting where the units diverge.
 *
 * @param demand  Σ demandOf over the program's sections, plus any concentration
 *                floor — the caller has it already, and re-deriving it here is
 *                how the two copies drift.
 */
export function generalElectiveAllowance(programData, demand) {
  return Math.max(0, (programData?.totalCreditsRequired ?? 0) - demand);
}

// ── Obligations ────────────────────────────────────────────────────

/**
 * What a program still demands, read off the graduation audit's own result.
 *
 * Not re-derived here. `allocateSections` is what the audit runs on, so
 * reading its numbers means a cell binds to precisely the requirement the audit
 * reports as unmet, and the two cannot drift. Alignment is taken at SECTION
 * level only: `normalizePooledSection` reshapes a section's children before
 * allocating, so a node-by-node walk of the two trees would silently mismatch.
 *
 * Section granularity is also what the data wants — every residual requirement
 * observed across the corpus is a whole section, because a catalog section
 * already IS the unit of "one kind of thing".
 */
export function obligationsOf(programData, { placedSet = new Set(), courseMap = {} } = {}) {
  const sections = programData?.requirementSections ?? [];
  if (!sections.length && !programData?.totalCreditsRequired) return [];

  const alloc = allocateSections(sections, placedSet, new Set(), courseMap);
  const out = [];
  let demand = 0;

  sections.forEach((section, i) => {
    const spec = specForNode(section);
    const unitSH = typicalSH(spec, courseMap);
    const short = shortfallOf(alloc[i], unitSH, courseMap);
    demand += demandOf(alloc[i], unitSH, courseMap);
    // `shared` sections are deliberately cross-counted toward several
    // requirements, so charging their demand to the total would shrink the
    // derived general-elective allowance below.
    // Optional-chained because a hole in the array must not take down the whole
    // audit: no shipped program has one, and a crash here would surface as a blank
    // requirements panel rather than as the one bad section.
    if (section?.shared) demand -= demandOf(alloc[i], unitSH, courseMap);
    if (short <= 0) return;
    out.push({ target: i, title: section.title ?? "", spec, shortfallSH: short, unitSH });
  });

  // A required-but-unchosen concentration. 51 programs have one, and their
  // plans reserve terms for it — CS BSCS spends 16 SH on four cells. Without a
  // target those cells float through every other requirement's candidates.
  // Named, not resolved: which concentration is the student's choice, so the
  // binding says `~concentration` and runtime narrows it.
  const conc = programData?.concentrations;
  if (conc?.concentrationOptions?.length && (conc.minOptions ?? 1) > 0) {
    let floor = Infinity;
    for (const option of conc.concentrationOptions) {
      const s = specForNode(option);
      const a = allocateSections([option], placedSet, new Set(), courseMap)[0];
      floor = Math.min(floor, demandOf(a, typicalSH(s, courseMap), courseMap));
    }
    if (Number.isFinite(floor) && floor > 0) {
      const sh = floor * (conc.minOptions ?? 1);
      out.push({ target: CONCENTRATION, title: "", spec: null, shortfallSH: sh,
                 unitSH: DEFAULT_UNIT_SH });
      demand += sh;
    }
  }

  // Recorded for only 95 of 532 programs, so derived for the rest. It admits
  // anything, and is included for what it ABSORBS: without it, seven "General
  // Elective" cells with nowhere to go stay candidates for every real
  // requirement and block elimination everywhere.
  const stated = programData?.generalElectiveSH;
  const geSH = generalElectiveAllowance(programData, demand);
  if (geSH > 0) {
    const allocated = new Set();
    for (const r of alloc) r?.allocatedCourses?.forEach(k => allocated.add(k));
    const used = [...placedSet].reduce(
      (n, k) => n + (allocated.has(k) ? 0 : courseMap[k]?.sh ?? 0), 0);
    const left = Math.max(0, geSH - used);
    if (left > 0) {
      out.push({ target: GENERAL_ELECTIVE, title: "", spec: null,
                 shortfallSH: left, unitSH: DEFAULT_UNIT_SH,
                 ...(stated ? {} : { derived: true }) });
    }
  }
  return out;
}

/**
 * The free-elective allowance a renderer should show as REQUIRED.
 *
 * Deliberately routed through `obligationsOf` rather than re-deriving Σ demand:
 * at zero placements nothing is used yet, so the general-elective obligation's
 * shortfall IS the allowance, and the panel then shows the audit's own number
 * instead of a second opinion about it. That second opinion is what this exists
 * to delete — see `generalElectiveAllowance`.
 *
 * Placement-independent, so a caller may memoise it on the program alone.
 */
export function generalElectiveSHOf(programData, courseMap = {}) {
  const ge = obligationsOf(programData, { courseMap })
    .find(o => o.target === GENERAL_ELECTIVE);
  return ge?.shortfallSH ?? 0;
}

// ── Max flow ───────────────────────────────────────────────────────
//
// Edmonds-Karp on an adjacency-matrix graph. The graphs here have tens of
// nodes, so nothing cleverer earns its complexity.

function maxFlow(n, cap, source, sink) {
  const c = cap.map(row => row.slice());
  let total = 0;
  for (;;) {
    const prev = new Array(n).fill(-1);
    prev[source] = source;
    const queue = [source];
    while (queue.length && prev[sink] < 0) {
      const u = queue.shift();
      for (let v = 0; v < n; v++) {
        if (prev[v] < 0 && c[u][v] > 0) { prev[v] = u; queue.push(v); }
      }
    }
    if (prev[sink] < 0) return total;
    let push = Infinity;
    for (let v = sink; v !== source; v = prev[v]) push = Math.min(push, c[prev[v]][v]);
    for (let v = sink; v !== source; v = prev[v]) { c[prev[v]][v] -= push; c[v][prev[v]] += push; }
    total += push;
  }
}

// ── Binding ────────────────────────────────────────────────────────

/**
 * Which requirements each unnamed cell could be for.
 *
 * @param {object[]} cells        entries with `options: []`, in plan order
 * @param {object[]} obligations  from obligationsOf()
 * @param {object} [ctx]
 * @param {(cell, obligation) => boolean} [ctx.admits]  hard, checkable evidence
 * @param {(cell, obligation) => boolean} [ctx.prefers] wording; applied only if free
 * @returns {Array<{targets: (number|string)[], forced: boolean}>} one per cell
 */
export function bindCells(cells, obligations, { admits = null, prefers = null } = {}) {
  if (!cells.length || !obligations.length) return cells.map(() => ({ targets: [], forced: false }));

  const C = cells.length, O = obligations.length;
  const N = C + O + 2, SRC = C + O, SNK = C + O + 1;
  // Capacity in CELLS, not credit hours: a cell cannot be split across two
  // requirements, and a requirement short by 8 SH of 4 SH courses absorbs two.
  const room = obligations.map(o => Math.max(1, Math.round(o.shortfallSH / (o.unitSH || DEFAULT_UNIT_SH))));

  const build = (allowed) => {
    const cap = Array.from({ length: N }, () => new Array(N).fill(0));
    for (let i = 0; i < C; i++) cap[SRC][i] = 1;
    for (let j = 0; j < O; j++) cap[C + j][SNK] = room[j];
    for (let i = 0; i < C; i++) for (let j = 0; j < O; j++) if (allowed(i, j)) cap[i][C + j] = 1;
    return cap;
  };

  const hard = (i, j) => !admits || admits(cells[i], obligations[j]);
  const soft = (i, j) => hard(i, j) && (!prefers || prefers(cells[i], obligations[j]));

  const flowHard = maxFlow(N, build(hard), SRC, SNK);

  // Wording narrows a cell only if that cell has a wording match at all —
  // otherwise it would be left with no edges and stranded, which is not what
  // "we could not read this label" should mean. Getting this wrong makes the
  // whole soft pass fail feasibility and silently do nothing.
  const hasSoft = cells.map((_, i) => !!prefers && obligations.some((__, j) => soft(i, j)));
  const softOrHard = (i, j) => (hasSoft[i] ? soft(i, j) : hard(i, j));

  // Even then, wording is obeyed only when it is free: if narrowing by it costs
  // the graph any flow, the guess contradicted the arithmetic and loses.
  const useSoft = hasSoft.some(Boolean)
    && maxFlow(N, build(softOrHard), SRC, SNK) === flowHard;
  const edge = useSoft ? softOrHard : hard;

  const base = build(edge);
  const flow = maxFlow(N, base, SRC, SNK);

  return cells.map((_, i) => {
    const targets = [];
    for (let j = 0; j < O; j++) {
      if (!edge(i, j)) continue;
      // Force this assignment and re-solve. Unchanged maximum flow means some
      // optimal assignment uses it, so it is genuinely possible.
      const cap = base.map(r => r.slice());
      for (let k = 0; k < O; k++) if (k !== j) cap[i][C + k] = 0;
      if (maxFlow(N, cap, SRC, SNK) === flow) targets.push(obligations[j].target);
    }
    return { targets, forced: targets.length === 1 };
  });
}

/** Does a requirement admit any course in this subject? */
export function specAdmitsSubject(spec, subject) {
  if (!spec || !subject) return false;
  for (const k of spec.keys) {
    if (k.startsWith(subject) && /^\d/.test(k.slice(subject.length))) return true;
  }
  return spec.ranges.some(r => r.subject === subject);
}

/** Does a requirement admit anything inside a stated range? */
export function specAdmitsRange(spec, { subject, start, end }) {
  if (!spec) return false;
  for (const k of spec.keys) {
    if (!k.startsWith(subject)) continue;
    const n = parseInt(k.slice(subject.length), 10);
    if (Number.isFinite(n) && n >= start && n <= end) return true;
  }
  return spec.ranges.some(r => r.subject === subject && r.start <= end && r.end >= start);
}

export { specIsEmpty, courseEligible };

/** Re-exported so the scrape gate reads from one place. */
export const assertShallowPools = deepPools;
