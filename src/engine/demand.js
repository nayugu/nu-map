// ═══════════════════════════════════════════════════════════════════
// CHART · DEMAND — requirement sections become plan cells
//
// This is the inversion the whole engine rests on. Reading a published plan
// means taking a department's wording and inferring which requirement it meant:
// 1,353 distinct phrasings, 3,882 ambiguous cells, a max-flow solve to bind them,
// and a wording-evidence stack that can be wrong. Constructing a plan runs the
// arrow the other way — the requirement is known first and the cell is built
// from it — so the cell's label IS the requirement's title and its binding is set
// rather than guessed.
//
// ── Structure decides content; arithmetic decides count ────────────
//
// Two different questions, and answering both with one number is what makes a
// generated plan either lose named courses or double-count credit:
//
//   what goes in a cell   the requirement tree's SHAPE. A section that demands
//                         all four of its children yields four cells, and the
//                         one that reads `CS 1800 and CS 1802` names both.
//   how many cells        the audit's own arithmetic, via `demandOf`. Only a
//                         credit pool ("8 SH of Khoury electives") leaves this
//                         open, and only there is a division performed.
//
// Deriving the count structurally as well would be a second arithmetic, which
// `requirementDemand.js` exists to prevent — so the structural walk is CHECKED
// against `demandOf` and the difference is reported, never silently absorbed.
//
// ── Three kinds of cell, because the catalog has three ─────────────
//
//   named    one group of courses, all of them. `CS 2000 and CS 2001`.
//   choice   several groups, one of them. `CS 4300 or CS 4100`.
//   open     a pool too wide to name. `Khoury Approved Electives`, and every
//            general elective.
//
// `named` becomes a course placement; `choice` and `open` become reservations,
// which is exactly what `applySamplePlan` already does with the same three
// shapes. Nothing downstream needs a case for a generated plan.
//
// ── `shared` sections emit nothing ─────────────────────────────────
//
// A `shared` section is deliberately cross-counted — satisfied by courses that
// also answer somewhere else — so `allocateSections` evaluates it permissively
// and never commits its courses. Emitting cells for one would schedule the same
// obligation twice.
//
// ── A named course is scheduled ONCE, however many sections want it ──
//
// `{XOM numCreditsMin: 1, courses: [GE 1501]}` is the split-credit pattern:
// GE 1501 contributes 1 SH to this section and the rest elsewhere.
// `gradRequirements` handles it by reporting the allotment rather than the
// course's full value, "which would inflate totals in every section listing it".
//
// Deriving cells section by section walks straight into that trap. Bioengineering
// names GE 1501 in three sections, and three cells at 4 SH each is 12 SH for one
// registration. Measured: **69 programs, 197 duplicate cells, 787 SH** — enough
// that Industrial Engineering emitted 153 SH into a shape that holds 152 and the
// search spent 45 seconds proving it could not fit.
//
// So forced cells naming the same group MERGE, carrying the group's real catalog
// credit and remembering every section it answers. If the audit then reports one
// of those sections unmet, that is its honest verdict about a program whose
// requirements cannot both be met by distinct courses — and CHART must not paper
// over it by scheduling the same registration twice.
//
// CHOICE cells deliberately do NOT merge. Two sections each asking for one of
// {ORGB 3201, ORGB 3203} need two DIFFERENT courses, and the witness's
// distinctness constraint is what enforces that. Merging them would quietly
// satisfy two requirements with one course.
// ═══════════════════════════════════════════════════════════════════

import { normalizePooledSection, courseKey } from "../core/gradRequirements.js";
import { specForNode, specIsEmpty, emptySpec } from "../core/programEligibility.js";
import { unionSpec, materialize } from "../core/candidateSpec.js";
import {
  DEFAULT_UNIT_SH, GENERAL_ELECTIVE, CONCENTRATION, typicalSH,
} from "../core/requirementDemand.js";
import { obligationsOf } from "../core/requirementBinding.js";
import { resolveConcentration } from "../core/concentrationResolve.js";
import { breadthSplit, breadthIndices } from "./electives.js";

export { GENERAL_ELECTIVE, CONCENTRATION };

// ── A degree's free credit has no positional curve, and had one ────
//
// `GE_SPREAD_LO = 0.30` and `GE_SPREAD_HI = 0.95` lived here, ramping an expected position
// across the elective sequence. Both are gone; see the note at the cell construction below for
// why a fitted curve on top of a graph-derived ordering can only disagree with it.
//
// One argument from the old comment is worth keeping, because it is about the DEGREE and not
// about the mechanism: departments spend the electives before the first co-op — 54.0% of theirs
// are — and CHART exists because that leaves a student with nothing but requirements afterwards.
// Rule 4 serves that intent better than the floor did. The floor asserted that no elective may
// sit in the first third of any plan; rule 4 says a DEPTH elective competes against the major's
// own courses for an early slot and a BREADTH one defers, which is the same instinct stated
// about what the cell is for rather than about where its index falls.
//
// The ceiling's dead end is also worth keeping. Lowering it to 0.85 was tried, so an elective
// would yield the final term to the capstone that belongs there, and it measured WORSE: terms
// leaving three or more cells unguided went 10 to 12, and it did not fix the case that motivated
// it. Squeezing the range packs the electives closer together, which is the opposite of the
// point — and "spread them out" is now rule 2's per-term constraint, where squeezing is not
// expressible.

/**
 * @typedef {Object} Cell
 * @property {string} id            deterministic; position in the derivation
 * @property {number|string} target section index, or a sentinel
 * @property {string} title         the narrowest titled node above it
 * @property {number} sh
 * @property {"named"|"choice"|"open"} kind
 * @property {string[][]|null} groups
 * @property {import("../core/programEligibility.js").EligibleSpec|null} spec
 *   what may answer it; null when the target admits any course
 */

// ── Reading one requirement node ───────────────────────────────────

/**
 * Flatten an OR into groups of co-required courses.
 *
 * `PSYC 3200 or (PT 5410 and PT 5411)` is two groups, not three courses —
 * offering PT 5410 alone would not answer the requirement. Nested ORs flatten
 * (the corpus has them: "Supporting Course" wraps `DS 1300 or PHIL 1300` inside
 * a ten-way OR), nested ANDs become one group.
 *
 * Returns null when any branch is not enumerable — a RANGE inside an OR means
 * the choice cannot be written out, so the cell must fall back to a spec.
 */
function orGroups(node) {
  const out = [];
  const walk = (n) => {
    if (!n) return false;
    switch (n.type) {
      case "COURSE":
        out.push([courseKey(n.subject, n.classId)]);
        return true;
      case "OR":
        return (n.courses ?? []).every(walk);
      case "AND": {
        const g = andGroup(n);
        if (!g) return false;
        out.push(g);
        return true;
      }
      default:
        return false;               // RANGE, XOM, SECTION — not enumerable
    }
  };
  return (node.courses ?? []).every(walk) && out.length ? out : null;
}

/** The single group an AND names, or null when a branch is not a plain course. */
function andGroup(node) {
  const out = [];
  const walk = (n) => {
    if (!n) return false;
    if (n.type === "COURSE") { out.push(courseKey(n.subject, n.classId)); return true; }
    if (n.type === "AND") return (n.courses ?? []).every(walk);
    return false;
  };
  return (node.courses ?? []).every(walk) && out.length ? out : null;
}

/**
 * How many credits a node demands, when it says so itself.
 *
 * An XOM's `numCreditsMin` is the only place a requirement states credit rather
 * than a count. Everything else is counted in courses and converted with the
 * section's own unit — the same conversion `demandOf` performs, so the two agree.
 */
const poolCredits = (node) =>
  typeof node?.numCreditsMin === "number" ? node.numCreditsMin : null;

// ── The walk ───────────────────────────────────────────────────────

/**
 * Cells for one section, from its shape.
 *
 * @param {object} section       a raw requirementSections entry
 * @param {number} target        its index, which is also its binding target
 * @param {object} courseMap
 * @returns {{cells: Cell[], notes: object[]}}
 */
function cellsForSection(section, target, courseMap) {
  const norm = normalizePooledSection(section);
  const reqs = norm.requirements ?? [];
  const sectionTitle = (norm.title ?? "").trim();
  const sectionSpec = specForNode(norm);
  // `standaloneOnly`: CHART constructs cells, so a one-credit lab is not a unit anybody would
  // pick out of a pool. Opt-in, because the catalog binding is inferring rather than
  // constructing and must keep the widest reading — see `typicalSH`.
  const unit = typicalSH(sectionSpec, courseMap, undefined, { standaloneOnly: true });
  const cells = [];
  const notes = [];
  let ordinal = 0;

  // The narrowest titled node above a cell. Requirement trees nest, and a cell
  // labelled by a broad ancestor would offer a narrower set than its own name
  // implies. Falls back to a spec-derived label, because untitled sections
  // really exist and `resolveRequirement` correctly refuses to match an empty
  // title — a blank matching a blank adopts an arbitrary requirement.
  const labelFor = (node) => {
    const own = (node?.title ?? "").trim();
    if (own) return own;
    if (sectionTitle) return sectionTitle;
    return specLabel(node ? specForNode(node) : sectionSpec) || "Requirement";
  };

  // A forced group's credit is the sum of its members' catalog credit — what the
  // student actually registers for. `unit` (the section's modal course size) is
  // only a fallback for a course the catalog does not have, and using it where
  // real credit is known is how a 1 SH seminar became a 4 SH cell.
  const groupSH = (group) => {
    let n = 0, known = false;
    for (const id of group ?? []) {
      const sh = courseMap[id]?.sh;
      if (typeof sh === "number") { n += sh; known = true; }
    }
    return known ? n : unit;
  };

  const push = (kind, { groups = null, spec = null, sh = null, node = null }) => {
    cells.push({
      id: `s${target}#${ordinal++}`,
      target, title: labelFor(node),
      sh: sh ?? (groups?.length === 1 ? groupSH(groups[0]) : unit),
      kind, groups, spec,
    });
  };

  // A pool: "choose N of these M", or a credit-valued XOM. The children are
  // options rather than obligations, so the cell draws from their union and the
  // COUNT comes from arithmetic.
  const emitPool = (nodes, { credits = null, count = null, node = null }) => {
    const spec = nodes.reduce((acc, n) => unionSpec(acc, specForNode(n)), emptySpec());
    const poolUnit = typicalSH(spec, courseMap, undefined, { standaloneOnly: true }) || unit;
    // Credit-shaped pools divide; count-shaped ones do not, and rounding a count
    // through credit and back is how a 3-course pool becomes 2 or 4 cells.
    // Rounded UP, never down. A section demanding 5 SH answered by 4 SH courses
    // needs two cells: one leaves the student a credit short of a requirement they
    // cannot graduate without, and being a course over is a slot they can drop.
    // Over is recoverable, under is not.
    const n = count != null
      ? count
      : Math.max(1, Math.ceil((credits ?? poolUnit) / (poolUnit || DEFAULT_UNIT_SH)));
    // An indivisible remainder — 3 SH of demand answered by 4 SH courses — has no
    // clean answer, so it is recorded rather than hidden. The catalog has the
    // same problem: its own printed term totals disagree with its own cells in
    // 7 terms.
    if (credits != null && credits % (poolUnit || DEFAULT_UNIT_SH) !== 0) {
      notes.push({ kind: "indivisible-pool", target, credits, unit: poolUnit,
                   emitting: n * poolUnit });
    }
    for (let i = 0; i < n; i++) {
      push("open", { spec: specIsEmpty(spec) ? null : spec, sh: poolUnit, node });
    }
  };

  // "Choose min of M" at section level, after normalisation.
  const min = norm.minRequirementCount;
  const isChoiceSection = typeof min === "number" && min > 0 && min < reqs.length;

  if (isChoiceSection) {
    emitPool(reqs, { count: min, node: norm });
    return { cells, notes };
  }

  // Otherwise every child is an obligation in its own right.
  for (const req of reqs) {
    // A hole or a scalar where a requirement belongs. Noted and skipped: emitting a
    // cell for it would put an unanswerable card in a student's plan, and throwing
    // would refuse the whole program over one bad entry.
    if (!req || typeof req !== "object") {
      notes.push({ kind: "unreadable-node", target, type: null });
      continue;
    }
    switch (req.type) {
      case "COURSE":
        push("named", { groups: [[courseKey(req.subject, req.classId)]], node: req });
        break;

      case "AND": {
        const g = andGroup(req);
        if (g) {
          // Co-required courses share one cell and one credit total, exactly as
          // the catalog prints `CS 1800 and CS 1802` with 5 SH.
          push("named", { groups: [g], node: req });
        } else {
          // An AND containing a range or a pool: every branch is still required,
          // so recurse rather than collapsing it into one cell.
          const sub = cellsForSection({ ...req, type: "SECTION", title: req.title ?? norm.title,
                                        requirements: req.courses ?? [] }, target, courseMap);
          cells.push(...sub.cells.map(c => ({ ...c, id: `s${target}#${ordinal++}` })));
          notes.push(...sub.notes);
        }
        break;
      }

      case "OR": {
        const groups = orGroups(req);
        if (groups && groups.length > 1) {
          // ── The CHEAPEST option, not the dearest ──────────────────
          //
          // This was `Math.max`, reasoned as "a plan that fits the biggest choice fits any of
          // them". That is true about term capacity and wrong about the degree, and the
          // degree is the one that cannot be recovered from.
          //
          // A cell's credit is not only a load to reserve; it is also credit counted as
          // ALREADY EARNED when the general electives are derived to close the gap to the
          // stated total. Charging the maximum therefore spends credit the student may never
          // receive. International Business is the clean case: "Business Experiential
          // Learning" offers seven options, six of them 0 SH co-ops and one an 8 SH field
          // course, so `max` charged the plan 8 credits, derived 8 SH fewer general electives,
          // and emitted two courses too few. A student who takes COOP 3945 — the option the
          // department's own plan shows — and follows ours would graduate EIGHT CREDITS SHORT.
          //
          // So the cell is worth what it GUARANTEES, which is its cheapest option; anything
          // above that is a bonus the electives no longer have to cover. This is the same
          // trade `emitPool` already states two hundred lines up — over is recoverable, under
          // is not — applied to the other half of the arithmetic. The cost is a term
          // occasionally reserving less room than the student's actual choice needs, which is
          // one course they move; the benefit is that no plan can silently under-credit a
          // degree. Measured: 319 cells in 198 programs (37.2%) disagree across their options,
          // over-charging 711 SH corpus-wide.
          push("choice", { groups, sh: Math.min(...groups.map(groupSH)), node: req });
        } else if (groups) {
          push("named", { groups, node: req });
        } else {
          emitPool(req.courses ?? [], { count: 1, node: req });
        }
        break;
      }

      case "XOM": {
        const credits = poolCredits(req);
        const courses = req.courses ?? [];
        // A single-course XOM is the split-credit pattern — a genuine
        // requirement, not a choice (programEligibility draws the same line).
        // `allot` records what this section claims of the course, which is NOT
        // the course's load: the student registers for all of it, once.
        if (courses.length === 1 && courses[0]?.type === "COURSE") {
          const g = [courseKey(courses[0].subject, courses[0].classId)];
          push("named", { groups: [g], node: req });
          if (credits != null) cells[cells.length - 1].allot = credits;
        } else {
          emitPool(courses, { credits, node: req });
        }
        break;
      }

      case "RANGE":
        emitPool([req], { credits: poolCredits(req), node: req });
        break;

      case "SECTION": {
        const sub = cellsForSection(req, target, courseMap);
        cells.push(...sub.cells.map(c => ({ ...c, id: `s${target}#${ordinal++}` })));
        notes.push(...sub.notes);
        break;
      }

      default:
        notes.push({ kind: "unreadable-node", target, type: req?.type ?? null });
        break;
    }
  }
  return { cells, notes };
}

/**
 * Spend a general-elective slot on a prerequisite the degree never requires.
 *
 * ── The gap this closes, and why an elective is the right currency ───
 *
 * 115 named courses across the corpus need a prerequisite their own degree does not
 * require anywhere. `MATH 1341` needs precalculus; a program that assumes you arrive with
 * it lists neither. The plan was therefore complete against the requirements and NOT
 * followable: the student cannot register for the course, and CHART reported the fact in
 * `unscheduledPrereqs` and scheduled nothing about it.
 *
 * Three answers were possible — report it (what it did), refuse the program, or schedule
 * the prerequisite. Scheduling is right, and the reason it is affordable is that such a
 * course IS free-elective credit for this student: it counts toward the degree total
 * without answering any named requirement, which is exactly what the general-elective
 * bucket is. So the substitution spends a slot the student was going to fill with
 * something arbitrary on something they actually need first.
 *
 * ── What it does not do ─────────────────────────────────────────────
 *
 * It never invents capacity. If no general-elective slot is free, nothing is substituted
 * and the gap is still reported — a plan one course over the degree total would be a
 * quiet lie about how long the degree takes, and the student can see the gap and place the
 * course themselves.
 *
 * One course per gap, the shallowest first: a prerequisite with its own unmet
 * prerequisites would need a chain, and adding the foundation lets the next pass see
 * whether the rest is still missing rather than guessing at the whole ladder at once.
 *
 * The substituted cell keeps `target: GENERAL_ELECTIVE`, because that is the truth about
 * which requirement it answers — free-elective credit — and the binding a reader sees
 * should not claim otherwise. It carries the course's OWN credit value, so the degree
 * total stays honest even where a 3 SH prerequisite replaces a 4 SH placeholder.
 *
 * @returns {{cells: object[], substituted: object[]}}
 */
/**
 * How many prerequisites one plan will schedule into elective slots.
 *
 * Three. A degree with one or two courses assuming a prerequisite it does not list is
 * ordinary — a program expecting you to arrive with precalculus. A degree with ten is
 * telling you something about our parse of its requirements, not about the student's
 * schedule, and spending ten free electives on that guess would rewrite the plan around a
 * data defect. Bounded, and the rest reported.
 */
export const MAX_PREREQ_SUBSTITUTIONS = 3;

export function substitutePrereqs(cells, unscheduled, courseMap, { depthOf = () => 0 } = {}) {
  if (!unscheduled?.length) return { cells, substituted: [] };

  const out = [...cells];
  const substituted = [];
  const already = new Set(cells.flatMap(c => c.groups?.flat() ?? []));

  // ── ONE course per gap, because `needs` is usually an OR ──────────
  //
  // The first version took the union of every `needs` list and substituted all of it,
  // which spent three elective slots on alternatives to each other: `ECON 2560` lists
  // `ENGW 1113 or ENGW 1114 or INSH 3102 …`, and one of them satisfies it. Measured, that
  // turned 30-odd real gaps into 100 substitutions and burned electives the student needs
  // for something else.
  //
  // This is the same mistake this engine already paid for in `buildDepthIndex`, where
  // reading an OR's operands as jointly required inflated every bound — an OR takes the
  // MINIMUM. One course per gap is the honest reading, and if a gap needs a whole ladder
  // the next generation sees what is still missing rather than guessing at it now.
  //
  // Sorted for determinism; shallowest first so a foundation is chosen over something that
  // would itself need prerequisites.
  const gaps = [...unscheduled].sort((a, b) =>
    String(a.course).localeCompare(String(b.course)) || String(a.cell).localeCompare(String(b.cell)));

  for (const gap of gaps) {
    if (substituted.length >= MAX_PREREQ_SUBSTITUTIONS) break;
    const options = (gap.needs ?? [])
      .filter(id => courseMap[id])
      // ── Only a course that itself needs nothing ────────────────────
      //
      // A substituted prerequisite has to sit BEFORE its consumer, so it tightens
      // precedence — and if it carries prerequisites of its own it needs a whole ladder,
      // each rung tightening further. Unfiltered, this made the test suite go from 1:05 to
      // over ten minutes: not because substitution is expensive to compute, but because the
      // plans became much harder to solve, and a harder plan spends its whole budget before
      // refusing. Closing a gap by making the program unplannable is not closing it.
      //
      // Depth 0 means the catalog records no prerequisite for it, so it can go anywhere its
      // season allows and cannot lengthen a chain. Deeper gaps are reported instead, which
      // is what the student can act on: they are usually a course the degree assumes you
      // arrive with, and no arrangement of THIS degree supplies it.
      .filter(id => depthOf(id) === 0)
      .sort((a, b) => a.localeCompare(b));
    if (!options.length) continue;
    // Already covered — by an earlier substitution, or by a branch of this very OR.
    if (options.some(id => already.has(id))) continue;

    const slot = out.findIndex(c =>
      c.target === GENERAL_ELECTIVE && c.kind === "open" && !c.substitutedFor);
    if (slot < 0) break;                              // no elective left to spend; reported instead

    const id = options[0];
    const course = courseMap[id];
    const slotSH = out[slot].sh ?? 0;
    const courseSH = course.sh ?? slotSH;

    out[slot] = {
      ...out[slot],
      kind: "named",
      groups: [[id]],
      spec: null,
      sh: courseSH,
      title: course.title ? `${id} ${course.title}` : id,
      // Recorded on the cell so the explainer can say WHY a named course is sitting in
      // what the requirements call a free elective.
      substitutedFor: gap.course ?? null,
    };

    // ── Never UNDER the free-elective pool ──────────────────────────
    //
    // A 1 SH prerequisite replacing a 4 SH placeholder would leave the degree three
    // credits short — `POLS 1000` for `POLS 1150` did exactly that. Being over the pool is
    // a slot the student can drop; being under it is a degree they cannot finish, and the
    // two are not symmetric. So the remainder stays in the plan as elective credit.
    if (courseSH < slotSH) {
      out.push({
        ...out[slot],
        id: `${out[slot].id}~rem`,
        kind: "open", groups: null, spec: null,
        sh: slotSH - courseSH,
        title: cells.find(c => c.target === GENERAL_ELECTIVE)?.title ?? out[slot].title,
        substitutedFor: null,
      });
    }

    already.add(id);
    substituted.push({ course: id, forCourse: gap.course ?? null, sh: courseSH,
                       remainderSH: Math.max(0, slotSH - courseSH) });
  }
  return { cells: out, substituted };
}

/** A label for a spec, when nothing in the tree carries a title. */
export function specLabel(spec) {
  if (!spec) return "";
  if (spec.ranges.length) {
    const r = spec.ranges[0];
    return `${r.subject} ${r.start}–${r.end}`;
  }
  const first = [...spec.keys][0];
  return first ? `${first} or similar` : "";
}

// ── The public derivation ──────────────────────────────────────────

/**
 * Every cell a program's requirements demand, from an empty plan.
 *
 * From-scratch only. Fitting a plan AROUND courses a student has already placed
 * means reverse-inferring which requirement each was for, which is inference
 * rather than arithmetic and is deliberately out of scope — `allocateSections`
 * is greedy and order-dependent, so with courses already placed it can charge a
 * course to section A when B needed it more and inflate B's shortfall.
 *
 * @param {object} programData
 * @param {object} opts
 * @param {object} opts.courseMap
 * @param {(courseId: string) => boolean} [opts.repeatable]
 *   whether a course may be taken more than once, which is what stops two
 *   demands for `MUS 1990` collapsing into one registration
 * @returns {{cells: Cell[], notes: object[], reconciliation: object[]}}
 */
export function deriveCells(programData, {
  courseMap = {}, repeatable = () => false, concentration = null,
  // Competencies the student earns WITHOUT spending an elective on them — in practice the
  // ones a co-op grants. `EX` is the most-unmet code in the corpus (244 of 349 programs) and
  // co-op carries it, so not crediting it would spend a free elective on something the plan
  // already delivers, in about 70% of programs. Injected rather than read here: which term
  // is a co-op is a property of the SHAPE, and this function does not have one.
  grantedAttributes = [],
  // Dropped by `generatePlan`'s retry when binding electives to competencies is what made
  // the degree unplannable — the guidance is a preference and this is where it yields.
  breadthGuidance = true,
} = {}) {
  const sections = programData?.requirementSections ?? [];
  const cells = [];
  const notes = [];
  const reconciliation = [];

  // The audit's own numbers, for the count check and for the two sentinels.
  const obligations = obligationsOf(programData, { placedSet: new Set(), courseMap });
  const byTarget = new Map(obligations.map(o => [o.target, o]));

  sections.forEach((section, i) => {
    if (section?.shared) {
      notes.push({ kind: "shared-section-skipped", target: i, title: section.title ?? "" });
      return;
    }
    const { cells: got, notes: n } = cellsForSection(section, i, courseMap);
    notes.push(...n);

    // Check the structural walk against the arithmetic. Reported, not corrected:
    // where they differ, one of them is misreading the section, and quietly
    // padding to the larger number would hide which.
    const ob = byTarget.get(i);
    const structuralSH = got.reduce((s, c) => s + (c.sh ?? 0), 0);
    const demandSH = ob?.shortfallSH ?? 0;
    if (ob && structuralSH !== demandSH) {
      reconciliation.push({
        target: i, title: section.title ?? "",
        structuralSH, demandSH, delta: structuralSH - demandSH,
      });
    }
    cells.push(...got);
  });

  const merged = poolExcess(
    mergeForcedCells(
      mergeCoreqCells(withCoreqPartners(cells, notes, courseMap), notes, courseMap, repeatable),
      notes, repeatable),
    notes, { total: programData?.totalCreditsRequired ?? 0, courseMap, sections });

  // ── The two sentinels ────────────────────────────────────────────
  //
  // Neither is a catalog section, so neither has a shape to walk. A concentration
  // is arithmetic and comes straight from `obligationsOf` — the minimum over the
  // options — and is NAMED, not resolved: which one is the student's choice.
  //
  // General electives are the RESIDUAL, and a residual has to be taken against the
  // same accounting as everything else. `obligationsOf` derives it as
  // `totalCreditsRequired − Σ demandOf`, and `demandOf` counts a co-requisite pair
  // as one course at the section's modal credit — 4 SH where `CS 1800 and CS 1802`
  // is really 5. That is the right measure for BINDING CAPACITY, which is counted
  // in cells, and the wrong one for a credit total.
  //
  // Using it here mixed two accountings in one plan: Industrial Engineering emitted
  // 129 SH against a 137 SH degree, eight credits short, because the sections were
  // measured structurally and the residual against a smaller number.
  //
  // So the residual is taken against CHART's own total.
  //
  // ── And it is the RESIDUAL, not the catalog's stated figure ──────
  //
  // `totalCreditsRequired` is the degree's headline statement of how much a student
  // must complete, and it is the stronger claim. `generalElectiveSH` frequently
  // disagrees with it, in both directions:
  //
  //   stated too LOW   a program stating 8 SH of free electives while 23 SH of the
  //                    degree is otherwise unaccounted for. Trusting it left 17 of
  //                    113 plans adrift and one 23 credits short of its own degree.
  //   stated too HIGH  sections 120 + stated 20 = 140 for a 133-credit degree.
  //                    Trusting it overshot by 7 and put the plan over the top.
  //
  // Taking the larger of the two fixes the first and causes the second. Taking the
  // residual fixes both, and makes "the plan totals the degree" true by
  // construction rather than usually true. The stated figure is kept as a signal:
  // where it disagrees, one of the catalog's own numbers is wrong and the note says
  // which two.
  const structuralSH = cellsSH(merged);
  const concOb = byTarget.get(CONCENTRATION);
  const concSH = concOb && concOb.shortfallSH > 0 ? concOb.shortfallSH : 0;
  const statedGE = programData?.generalElectiveSH;
  const totalRequired = programData?.totalCreditsRequired ?? 0;
  const geSH = Math.max(0, totalRequired - structuralSH - concSH);
  if (statedGE != null && geSH !== statedGE) {
    notes.push({ kind: "general-elective-disagreement",
                 stated: statedGE, residual: geSH,
                 detail: `sections ${structuralSH} + concentration ${concSH} + stated ` +
                         `${statedGE} = ${structuralSH + concSH + statedGE}, but the degree ` +
                         `states ${totalRequired}` });
  }

  // The competencies this degree does not already guarantee, rarest first. Computed once,
  // from the cells built above, so it sees every named course the program commits to.
  const breadth = breadthGuidance ? breadthCodes(merged, courseMap, grantedAttributes) : [];

  // ── Rule 1: the pool SPLITS, by arithmetic, per degree ─────────────
  //
  // How many general-elective cells this degree has, computed here rather than inside the loop
  // below because the split needs the total before it can say which cells carry breadth. The
  // arithmetic is `breadthSplit`'s and the reasoning is there; what matters at this call site
  // is that both halves come from the same count the loop then emits, so a change to one
  // cannot silently disagree with the other.
  const geOb = byTarget.get(GENERAL_ELECTIVE);
  const geUnit = geOb?.unitSH || DEFAULT_UNIT_SH;
  const geCells = geSH > 0 ? Math.max(1, Math.ceil(geSH / geUnit)) : 0;
  const split = breadthSplit({ cells: geCells, remaining: breadth.length });
  // ── Rule 3: breadth binds to the LATER cells ──────────────────────
  //
  // `breadthAt` used to walk from 0, so the shallowest electives in the degree were also the
  // earliest and the student's depth was pushed behind them. Breadth is what a plan can afford
  // to defer, so it leans late — spread by an even stride rather than clustered at the very
  // end, because a wall of placeholders in the last two terms is the defect this whole rule set
  // exists to remove.
  const breadthCells = breadthIndices(geCells, split.breadth);
  let breadthAt = 0;

  for (const target of [CONCENTRATION, GENERAL_ELECTIVE]) {
    const ob = byTarget.get(target);
    const wanted = target === GENERAL_ELECTIVE ? geSH : (ob?.shortfallSH ?? 0);
    if (wanted <= 0) continue;
    const unit = ob?.unitSH || DEFAULT_UNIT_SH;
    // Up, for the same reason as a pool: 13 SH of free electives rounded down to
    // three 4 SH slots leaves the plan a credit short of the degree, and a student
    // who follows it graduates late. Rounded up it is a slot they can drop.
    //
    // The general-elective count comes from `geCells` rather than being re-derived, so the
    // split above and the cells emitted here cannot disagree. Identical arithmetic today; a
    // shared binding is what keeps it identical after the next edit to either one.
    const n = target === GENERAL_ELECTIVE ? geCells : Math.max(1, Math.ceil(wanted / unit));
    if (wanted % unit !== 0) {
      notes.push({ kind: "indivisible-pool", target, credits: wanted,
                   unit, emitting: n * unit });
    }
    for (let i = 0; i < n; i++) {
      // ── The breadth tier ────────────────────────────────────────
      //
      // The first general-elective cells take an unmet competency each, while there are
      // unmet codes left to take. Bounded at the number of cells the degree actually has,
      // never the other way round: in 6.9% of programs the unmet codes outnumber the free
      // electives, and a degree whose breadth cannot fit in its electives is a fact about
      // the degree — refusing over it would turn a real constraint into a missing plan.
      // Rule 1 decided HOW MANY cells carry breadth and rule 3 decided WHICH; the codes
      // themselves are still taken rarest-first, so the scarcest competency is the one a cell
      // is bound to. Fewer cells than codes is the point of rule 1, not a shortfall: at ~1.5
      // codes per course, four well-chosen electives cover six competencies, and labelling six
      // cells would reserve two slots the student never needed to spend.
      const bind = target === GENERAL_ELECTIVE && breadthCells.has(i) && breadthAt < breadth.length
        ? breadth[breadthAt++]
        : null;
      merged.push({
        id: `${target}#${i}`,
        target,
        // Titled with the concentration once one is picked, because the cell's candidates ARE
        // that concentration's courses at that point and a card reading "Concentration" would
        // hide the difference between a plan built for one option and a plan built for the
        // union of five. Unchosen it keeps the generic title, which is then the honest one.
        //
        // ── The competency is NOT printed on the card ─────────────────
        //
        // This read `General Elective (IC)`, on the reasoning that a card saying only
        // "General Elective" hides what the cell is for. The reasoning is backwards about
        // what the code MEANS here. Binding a competency to an elective is guidance — one
        // ordering among several the plan could have chosen — and printing it turns that
        // into an instruction, telling a student their fifth elective must be an IC course
        // when any elective of theirs could carry it and the choice was never the plan's to
        // make. It also overclaims on data we know is partial: `attributes` covers 1,516 of
        // 7,966 courses, so the code names one competency out of a set we cannot see the
        // whole of.
        //
        // The binding still exists and still does its job — `nupath` below carries it, and
        // it is what spreads breadth across the plan instead of stacking it. It simply is
        // not a label on the student's card, because a reservation should say what it
        // reserves and nothing it cannot stand behind.
        title: target === CONCENTRATION
          ? (resolveConcentration(programData, concentration)?.title ?? "Concentration")
          : "General Elective",
        sh: unit,
        kind: "open",
        groups: null,
        // A CONCENTRATION carries the union of its options, so it is a bounded cell.
        //
        // Emitting `null` made it read as "admits anything", so it sorted as filler
        // and was placed last: measured median position 0.89 through the plan. A
        // concentration is major depth — 51 programs require one and CS BSCS spends
        // 16 credits on it — and burying it at the end is the same defect as burying
        // the major courses, one level up.
        //
        // The union is not a guess about which concentration the student will choose.
        // It is exactly the set of courses that can answer the cell BEFORE they
        // choose, which is what a candidate set means everywhere else here.
        //
        // ── A breadth elective is LABELLED, never restricted ─────────
        //
        // The first version gave a bound cell a real spec — the courses carrying that code —
        // on the reasoning that a candidate set is what makes a cell visible to the ordering
        // signals. It worked and it cost far more than it bought. Measured over the plans it
        // affected, empty full terms went 18 -> 63 while terms leaving 3+ cells unguided
        // improved only from about 12 to 2. Labelling without restricting lands at 19 and 3:
        // effectively all of the guidance, effectively none of the cost.
        //
        // The reason is the thing that makes a general elective special in the first place.
        // It is the most flexible cell in the plan — any level, any subject, no ordering
        // requirement — so it is what fills a term that would otherwise be empty. Give it a
        // spec and it stops being able to do that, and the flexibility is not replaced by
        // anything. Restricting five cells removed five degrees of freedom from a plan that
        // needed them.
        //
        // And restricting would be overclaiming anyway: `attributes` covers 1,516 of 7,966
        // courses — 19% — so a hard spec would exclude four fifths of the catalog on the
        // strength of data we know is partial. A student satisfies IC with any IC course,
        // including the ones our scrape has not labelled. Naming the competency tells them
        // what this elective is FOR; pretending to know every course that carries it does not.
        spec: target === CONCENTRATION ? concentrationSpec(programData, concentration) : null,
        // Carried so the card can say which competency, and so `reqKey` does not count this
        // cell as one of the term's unguided ones — it is guided, just not constrained.
        ...(bind ? { nupath: bind.code } : {}),
        // ── Which HALF of the pool this cell is, carried on the cell ───
        //
        // Rule 1 splits the pool into breadth and depth, and rules 4 and 5 place the two
        // differently — a depth elective competes for an early slot against the major's own
        // courses, a breadth elective defers. So the role has to survive the trip from here to
        // the search, and it travels ON THE CELL for the same reason `optionPools` does: a flag
        // threaded through four layers of arguments is a flag the next caller forgets.
        //
        // Derived from the breadth binding rather than stored twice. `nupath` is the label and
        // this is the role; they agree by construction because both come from `breadthCells`.
        ...(target === GENERAL_ELECTIVE
          ? { geRole: breadthCells.has(i) ? "breadth" : "depth" }
          : {}),
        // ── No POSITIONAL depth curve. It could only fight the ordering ──
        //
        // A ramp used to live here: `GE_SPREAD_LO -> GE_SPREAD_HI` across the elective sequence,
        // so the i-th elective of n wanted a position `0.30 + 0.65 * i/(n-1)`. It was reached
        // for because every general elective otherwise falls through to a level target of 1.0 —
        // `cellLevelTarget` has nothing to say about a cell that names no course — so fourteen
        // electives all wanted the last term and clumped there.
        //
        // The diagnosis was right and the remedy was the wrong shape. Depth already comes from
        // the prerequisite graph, so a hand-fitted curve laid on top of a graph-derived ordering
        // can only disagree with it — and with breadth bound to the FIRST cells, as it was, the
        // curve disagreed in the wrong direction: it asked the shallowest electives in the
        // degree to sit earliest and pushed the student's depth behind them.
        //
        // What replaces it is rule 4, in `search.js`: a depth elective is ordered by comparing
        // its estimated depth against the depths of the MAJOR'S OWN courses. One comparison,
        // opposite outcomes in a shallow and a deep degree, because the comparand differs — and
        // no curve to fit. The clumping the ramp was aimed at is rule 2's job, which states it
        // as a per-term constraint instead of a preference.
        //
        // `i` is still the cell's position in the pool and rule 3 reads it; nothing positional
        // is asserted about the TERM any more.
        // ── And the union is not, on its own, a legal answer ──────────
        //
        // The union says what MAY answer this cell before the student chooses. It does not say
        // the cell is fillable, because the student does not get the union — they get one
        // option. CS BSCS's five pools are pairwise disjoint, so a matching drawn from the
        // union can answer three cells with three courses from three DIFFERENT concentrations,
        // which no student can do.
        //
        // So the cell carries its options with it. The witness quantifies `∀ option, ∃ a
        // filling` over exactly this list — and it travels ON THE CELL rather than through the
        // search's arguments so that no call site can forget to ask. A guard that has to be
        // passed down four layers is a guard the next caller omits.
        ...(target === CONCENTRATION
          ? { optionPools: concentrationOptionPools(programData, courseMap, concentration) }
          : {}),
        // Marked when the bucket rests on OUR arithmetic rather than the catalog's
        // statement, because that is what pre-flight's "mostly unlabelled" gate is
        // entitled to refuse over. A bucket the catalog stated is evidence; one we
        // derived may be a gap in our reading of the requirements.
        ...(target === GENERAL_ELECTIVE && statedGE !== geSH ? { derivedBucket: true } : {}),
      });
    }
  }

  return { cells: merged, notes, reconciliation };
}

/**
 * A named course brings its corequisites, and their credit.
 *
 * A corequisite must be taken in the SAME term, and `applySamplePlan` already adds a
 * placed course's partners for exactly that reason — "218 such gaps across the
 * corpus, in 19.9% of plans". So they arrive in the student's plan whether CHART
 * planned for them or not.
 *
 * Which means CHART has to plan for them, or its arithmetic is a fiction. 418 catalog
 * courses have partners that carry credit, a mean of +2.67 SH and up to +7
 * (`CHEM 2324` brings `CHEM 2315` and `CHEM 2316`). A term CHART sized at 18 SH
 * arrives at 20 and blows the registration cap it was checked against — and the
 * whole plan overshoots the degree total by credit nobody counted.
 *
 * Added to the GROUP, not just the credit, so the cell names what the student will
 * actually register for and the emitted text matches the term load.
 *
 * A partner some other cell already names is left alone: `applySamplePlan` places a
 * course once, so claiming it twice would double-count the credit — the same trap
 * `mergeForcedCells` exists for.
 */
function withCoreqPartners(cells, notes, courseMap) {
  const claimed = new Set();
  for (const c of cells) {
    if (c.kind === "named") for (const id of c.groups?.[0] ?? []) claimed.add(id);
  }
  // Deterministic, so two cells wanting the same partner resolve the same way twice.
  const order = [...cells].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const cell of order) {
    if (cell.kind !== "named" || !cell.groups?.[0]) continue;
    const add = [];
    for (const id of cell.groups[0]) {
      for (const r of courseMap[id]?.coreqs ?? []) {
        if (!r || typeof r !== "object" || !r.subject) continue;
        const partner = `${String(r.subject).toUpperCase()}${parseInt(r.number, 10)}`;
        if (!courseMap[partner] || claimed.has(partner)) continue;
        claimed.add(partner);
        add.push(partner);
      }
    }
    if (!add.length) continue;
    const extra = add.reduce((n, id) => n + (courseMap[id]?.sh ?? 0), 0);
    cell.groups = [[...cell.groups[0], ...add]];
    cell.sh = (cell.sh ?? 0) + extra;
    // Recorded ON THE CELL, not only in the notes.
    //
    // A partner is in the group because the REGISTRAR requires it in the same term,
    // not because the requirement asked for it — `CHEM 2313` is nowhere in the
    // section that names `CHEM 2311`. So the cell's binding is a true claim about the
    // CELL and a false one about that course, and anything checking "can these
    // options answer this requirement" has to be able to tell the two apart.
    cell.coreqAdded = [...(cell.coreqAdded ?? []), ...add];
    notes.push({ kind: "coreq-added", cell: cell.id, added: add, addedSH: extra });
  }
  return cells;
}

/**
 * Collapse forced cells that name the same courses.
 *
 * A `named` cell's group is decided, so two of them naming the same group are two
 * demands on one registration. The merged cell keeps its first target and records
 * the rest in `alsoAnswers`, so legibility can say "this course covers §2, §5 and
 * §7" instead of showing it three times.
 *
 * Repeatable courses are the exception: a section may genuinely want two takes,
 * and `MUS 1990` twice is two registrations. Merged only when at least one member
 * of the group is not repeatable — the whole group has to sit in one term, so one
 * fixed member pins it.
 *
 * `choice` cells are untouched. See the header for why merging them would satisfy
 * two requirements with one course.
 */
/**
 * Two named cells the registrar forces into the same term become ONE cell.
 *
 * `withCoreqPartners` deliberately declines this case — "a partner some other cell already
 * names is left alone" — because pulling a claimed course into a second cell would
 * double-count its credit. Correct, and it leaves the pair as two cells that nothing keeps
 * together, which is wrong in two ways at once.
 *
 * International Business names `INTB 2205` and `INTB 2206` in separate requirements. They
 * list each other as corequisites, so a student takes them in one term, as one 4 SH decision:
 *
 *   - nothing in the search made them share a term, so a plan could print them a year apart,
 *     which no student can register for; and
 *   - at 2 SH each neither is a "real course", so the term they sit in was counted as
 *     carrying two fewer courses than it does. IB has exactly 32 real courses for exactly 32
 *     slots, and read this way it has 31 — the search then proved, correctly, that no
 *     arrangement of 31 could fill 6 full terms, and refused a degree the department itself
 *     publishes a working plan for.
 *
 * Merging fixes both at the root instead of teaching every counter about corequisites: one
 * cell, one term by construction, credit summed, and `alsoAnswers` carrying the requirement
 * the absorbed cell used to answer — exactly the bookkeeping `mergeForcedCells` already does
 * for duplicates.
 *
 * Only NAMED, non-repeatable cells, and only where the catalog states the edge. A repeatable
 * course genuinely can be two registrations, and a choice cell has no fixed course to be
 * co-required with.
 */
function mergeCoreqCells(cells, notes, courseMap, repeatable = () => false) {
  const fixed = (c) => c.kind === "named" && c.groups?.[0]?.length
    && !c.groups[0].every(id => repeatable(id));
  // Where each course is named, so an edge can find the cell at its other end.
  const cellOf = new Map();
  for (const c of cells) if (fixed(c)) for (const id of c.groups[0]) if (!cellOf.has(id)) cellOf.set(id, c);

  const absorbed = new Set();
  // Deterministic: the same pair must always merge the same way round, or two runs of the
  // same program produce different cell ids.
  const order = [...cells].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const cell of order) {
    if (!fixed(cell) || absorbed.has(cell)) continue;
    for (const id of [...cell.groups[0]]) {
      for (const r of courseMap[id]?.coreqs ?? []) {
        if (!r || typeof r !== "object" || !r.subject) continue;
        const partner = `${String(r.subject).toUpperCase()}${parseInt(r.number, 10)}`;
        const other = cellOf.get(partner);
        if (!other || other === cell || absorbed.has(other) || !fixed(other)) continue;
        // Already in this cell's group — `withCoreqPartners` got there first.
        if (cell.groups[0].includes(partner)) continue;
        cell.groups = [[...cell.groups[0], ...other.groups[0].filter(x => !cell.groups[0].includes(x))]];
        cell.sh = (cell.sh ?? 0) + (other.sh ?? 0);
        cell.alsoAnswers = [...(cell.alsoAnswers ?? []), other.target,
                            ...(other.alsoAnswers ?? [])];
        if (other.allot != null) cell.allots = { ...(cell.allots ?? {}), [other.target]: other.allot };
        for (const x of other.groups[0]) cellOf.set(x, cell);
        absorbed.add(other);
        notes.push({ kind: "merged-coreq", kept: cell.id, absorbed: other.id,
                     courses: [...cell.groups[0]], sh: cell.sh });
      }
    }
  }
  return cells.filter(c => !absorbed.has(c));
}

function mergeForcedCells(cells, notes, repeatable = () => false) {
  const out = [];
  const byGroup = new Map();
  for (const cell of cells) {
    if (cell.kind !== "named" || !cell.groups?.[0]) { out.push(cell); continue; }
    // Every member repeatable means two demands really are two registrations.
    // One fixed member is enough to pin the group, because a group sits in one
    // term and cannot be in two.
    if (cell.groups[0].every(id => repeatable(id))) { out.push(cell); continue; }
    const key = [...cell.groups[0]].sort().join("+");
    const seen = byGroup.get(key);
    if (!seen) { byGroup.set(key, cell); out.push(cell); continue; }
    seen.alsoAnswers = [...(seen.alsoAnswers ?? []), cell.target];
    if (cell.allot != null) seen.allots = { ...(seen.allots ?? {}), [cell.target]: cell.allot };
    notes.push({ kind: "merged-duplicate", group: key,
                 keptFor: seen.target, alsoFor: cell.target, savedSH: cell.sh ?? 0 });
  }
  return out;
}

/**
 * The courses a concentration cell can be answered by.
 *
 * ── Resolved beats the union, and the union is UNSOUND ───────────────
 *
 * With a concentration chosen, this is that option's pool and nothing else. Without one it
 * falls back to the union of every option, which is what shipped first and which is an
 * over-approximation rather than a candidate set:
 *
 *   Computer Science BSCS — the five concentration pools are pairwise DISJOINT (measured:
 *   intersection 0, union 36). Three `Concentration` cells sat in one term, and the witness
 *   proved them fillable by matching three courses drawn from three DIFFERENT concentrations.
 *   `minOptions` is 1, so no student can do that. Per option, the courses actually reachable in
 *   that term were 0, 1, 2, 0 and 1 — every one of them short of three.
 *
 * Corpus-wide that is 21 of 77 concentration plans (27%) across 20 of 64 programs putting more
 * concentration cells in a term than the tightest concentration could fill — re-measured with an
 * independent instrument over the emitted documents (`scripts/lib/chart-gate.js`), which
 * corrected the first estimate's denominator without moving its rate.
 *
 * So resolving is not merely a nicety for better sequencing — it is what makes the cell's
 * candidate set true. The union path remains for a student who has not chosen, and what keeps
 * that path honest is the cell's `optionPools` plus the witness's `∀ option, ∃ a filling`.
 *
 * Null when the program has none, or when the options name nothing enumerable — an
 * unbounded concentration cell is honest, it just cannot be sequenced as depth.
 */
function concentrationSpec(programData, chosen = null) {
  const options = programData?.concentrations?.concentrationOptions ?? [];
  if (!options.length) return null;
  // Titles are the only identity a concentration has across saved plans, share links and MCP
  // `SET_CONCENTRATION`, so the lookup goes through the one resolver rather than comparing
  // strings here — a stale or differently-punctuated title must degrade to the union, never
  // throw and never silently match the wrong option.
  const picked = chosen ? resolveConcentration(programData, chosen) : null;
  const from = picked ? [picked] : options;
  const spec = from.reduce((acc, o) => unionSpec(acc, specForNode(o)), emptySpec());
  return specIsEmpty(spec) ? null : spec;
}

/**
 * The NUPath codes a degree still needs, and the courses that carry each.
 *
 * ── Why a free elective is the least free cell in the plan ──────────
 *
 * A general-elective cell carries `spec: null`, which reads as "admits anything" and is
 * therefore treated as maximal freedom. It is the opposite. Every ordering signal in this
 * engine — prereq depth, season, contention, chain height, the witness — is defined over a
 * CANDIDATE SET, and a cell with none is not ordered badly, it is outside the model. So it
 * sorts as filler and lands wherever room is left, which is the end. Measured: CHART leaves
 * 4 unguided cells in a term where departments do that in 0.2% of theirs, and the
 * International Business plan ends with two consecutive terms of nothing else.
 *
 * The departments do not solve this with a cap. They solve it by NAMING: 43% of their
 * elective-bucket cells say "PSYC elective", "Upper-division elective", "Foreign language
 * core course". Naming is how a term buys the right to hold more than two of them.
 *
 * ── NUPath is the naming the catalog already justifies ──────────────
 *
 * The degree genuinely requires the 11 competencies, awarded as 13 codes, and a student who
 * picks electives at random can miss one and not graduate. So the codes the program's own
 * coded courses do NOT guarantee have to come from the electives, and a cell bound to one is
 * not an invented requirement — it is a real one, made visible. That is the difference
 * between this and preferring, say, the major's own subject: the degree does not require a
 * free elective to be in your major, and a card claiming so would be wrong information.
 *
 * The data has been in the engine all along under a different name: the adapter maps
 * `nuPath` onto `courseMap[id].attributes`, so `grep nuPath src/engine/` finds nothing while
 * 1,516 of 7,966 courses carry a code.
 *
 * ── Only NAMED cells count as covered ───────────────────────────────
 *
 * A `choice` cell is one course OR another, and the two may carry different codes, so it
 * guarantees neither. Counting it would let a program read as covered by a code no student is
 * obliged to take. Named cells are the only guarantee, which makes the unmet set an
 * OVER-estimate — some codes will in practice be covered by whatever fills a pool. That is
 * the conservative direction: it binds a cell we might not have needed, and a student who
 * takes an extra course carrying a real competency has lost nothing.
 *
 * @returns {{code: string, ids: string[]}[]} unmet codes, rarest first
 */
export function breadthCodes(cells, courseMap, granted = []) {
  // An array, or nothing. A string is iterable, so `for (const a of "IC")` yields "I" and
  // "C" — a scrape that ever emits a bare string would invent single-letter competencies
  // and bind electives to them. Cheap to rule out, and impossible to notice downstream.
  const codesOf = (c) => (Array.isArray(c?.attributes) ? c.attributes : [])
    .filter(a => typeof a === "string" && a.length >= 2);
  const byCode = new Map();
  for (const id in courseMap) {
    for (const a of codesOf(courseMap[id])) {
      if (!byCode.has(a)) byCode.set(a, []);
      byCode.get(a).push(id);
    }
  }
  if (!byCode.size) return [];                 // no attribute data: make no claim

  const covered = new Set(granted);
  for (const c of cells) {
    if (c.kind !== "named" || !c.groups?.[0]) continue;
    for (const id of c.groups[0]) {
      for (const a of codesOf(courseMap[id])) covered.add(a);
    }
  }
  return [...byCode.entries()]
    .filter(([code]) => !covered.has(code))
    // Rarest first, so the scarcest competency gets a cell before the plentiful ones do.
    // It is also what the search's own MRV tie-break would do with these cells anyway.
    .sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]))
    .map(([code, ids]) => ({ code, ids }));
}

/**
 * Every concentration the student could still pick, materialised to course ids.
 *
 * Null once a pick is resolved: the cell then carries that option's own pool and there is no
 * disjunction left to quantify over. Null too when the program requires no concentration, or
 * names fewer than two — `∀` over one option is what the spec already says.
 *
 * An option naming nothing enumerable is DROPPED rather than treated as empty. Empty would
 * refuse every plan for a program whose options we cannot read, which is a claim about our
 * parser dressed as a claim about the degree. The consequence is stated honestly: the guarantee
 * is `∀ option we can enumerate`, not `∀ option`, and a program whose options are all
 * unreadable gets the old union behaviour because nothing better is available.
 *
 * ── Exported, so the gate quantifies over the SAME options ──────────
 *
 * `scripts/lib/chart-gate.js` checks this property independently and deliberately keeps its own
 * matching — a gate that imported the engine's witness could not catch the engine's witness
 * being wrong. But *which options a program has* is catalog data, not a verdict, and the two
 * sides disagreeing about that would be a bug in both rather than a useful second opinion. So
 * the data is shared and only the judgement is duplicated. Built from core's `specForNode` and
 * `materialize`; nothing here is a scheduling decision.
 */
export function concentrationOptionPools(programData, courseMap, chosen = null) {
  const options = programData?.concentrations?.concentrationOptions ?? [];
  if (options.length < 2) return null;
  if ((programData.concentrations?.minOptions ?? 1) < 1) return null;
  if (chosen && resolveConcentration(programData, chosen)) return null;
  const pools = [];
  for (const o of options) {
    let ids;
    try { ids = [...materialize(specForNode(o), courseMap)]; } catch { continue; }
    if (ids.length) pools.push({ title: o.title ?? "Concentration", ids });
  }
  return pools.length ? pools : null;
}

// ── `concentrationCapacity` was removed here, and the removal IS the fix ──
//
// It bounded how many concentration cells could stand in the terms up to each index, as the
// minimum over options of their cumulative prereq-reachable course counts. The reasoning it
// rested on was right and is kept, because the witness now does it exactly: the constraint is
// `∀ option, ∃ a filling`, never `∃ course, ∀ options` — that second reading is candidate-set
// intersection, measured EMPTY across these pools, and it would refuse all 93 programs that
// require a concentration. This codebase has paid for that lesson once already, at 86.7%.
//
// What was wrong was everything between the reasoning and the effect. It counted, but was
// applied as a unary domain filter that cannot express a count. It read STATIC prereq depth, so
// for CS BSCS it permitted 8 cells at term 5 where the arrangement admits 0, while blocking
// terms 1–2 that nothing wanted — 2 plans of cost for a bound that never bound. And the
// dimension that actually failed hardest was seasonal availability, which no depth vector can
// see. An approximation kept beside the exact rule is a second thing to get wrong, and an inert
// guard reads as coverage. See `witnessPlan` and the `optionPools` on a concentration cell.

/** The courses a cell can be answered by, as a spec, whichever shape it stores. */
const specOfCell = (cell) =>
  cell.spec ?? (cell.groups ? { keys: new Set(cell.groups.flat()), ranges: [] } : emptySpec());

/**
 * When the sections demand more credit than the degree, pool the excess.
 *
 * `data_science_ms` states 32 credits and lists six sections each reading "choose
 * one course from College X" — 44 credits in total. Those are not six
 * requirements. The student takes three electives from ANY of them, and the
 * catalog is listing where they may come from. 67 of 748 programs are shaped this
 * way, and CHART previously refused all of them rather than emit a plan a third
 * too long.
 *
 * Nothing in the data says which sections are alternatives, and picking three of
 * six would be a guess dressed as an answer. So instead of choosing, the surviving
 * cells are WIDENED: fewer cells, each able to draw on every section that lost one.
 * That is not a guess — it is the honest reading of "these six are where your three
 * electives come from", and every one of the six stays answerable.
 *
 * Named cells are never shed. Their courses are decided, and a degree that names a
 * course means it.
 */
function poolExcess(cells, notes, { total, courseMap, sections }) {
  if (!(total > 0)) return cells;
  const scheduled = cells.filter(c => typeof c.target === "number");
  let structural = cellsSH(scheduled);
  if (structural <= total) return cells;

  // Deterministic order, shed from the end. There is no signal in the data for
  // which sections are the alternatives, so the choice is arbitrary — and being
  // arbitrary is fine precisely because the survivors absorb what the shed cells
  // stood for. What must NOT be arbitrary is the run-to-run answer.
  const poolable = scheduled
    .filter(c => c.kind !== "named")
    .sort((a, b) => b.target - a.target || String(b.id).localeCompare(String(a.id)));

  const dropped = [];
  // Always leave one poolable cell to carry the union. Without a survivor the shed
  // sections would simply vanish from the plan.
  for (const cell of poolable) {
    if (structural <= total || dropped.length >= poolable.length - 1) break;
    dropped.push(cell);
    structural -= cell.sh ?? 0;
  }
  if (!dropped.length) return cells;

  const droppedIds = new Set(dropped.map(c => c.id));
  const lostTargets = [...new Set(dropped.map(c => c.target))].sort((a, b) => a - b);
  const lostSpec = dropped.reduce((acc, c) => unionSpec(acc, specOfCell(c)), emptySpec());
  const survivors = poolable.filter(c => !droppedIds.has(c.id));

  notes.push({
    kind: "pooled-excess",
    scheduledBefore: cellsSH(scheduled), total,
    droppedCells: dropped.length, droppedSH: cellsSH(dropped),
    lostTargets,
    detail: `sections total ${cellsSH(scheduled)} SH against a ${total} SH degree; ` +
            `${dropped.length} cells pooled into ${survivors.length} that draw on ` +
            `${lostTargets.length + survivors.length} sections`,
  });

  const widen = new Map(survivors.map(c => [c.id, {
    ...c,
    // A pooled cell is no longer a specific choice; it is a slot drawing on several
    // sections, so its groups give way to the union of their course sets.
    kind: "open",
    groups: null,
    spec: unionSpec(specOfCell(c), lostSpec),
    alsoAnswers: [...new Set([...(c.alsoAnswers ?? []), ...lostTargets])]
      .filter(t => t !== c.target).sort((a, b) => a - b),
    pooled: true,
    // Titled for what it now is. Keeping "College of Science" on a cell that also
    // admits five other colleges would be the over-specific label this engine
    // exists to avoid.
    title: pooledTitle(c, lostTargets, sections),
  }]));

  return cells
    .filter(c => !droppedIds.has(c.id))
    .map(c => widen.get(c.id) ?? c);
}

/**
 * A name for a cell that answers several sections at once.
 *
 * The sections' own titles, joined, when there are few enough to read; otherwise a
 * count. Either way it says what the cell is for rather than naming one of the
 * several requirements it covers.
 */
function pooledTitle(cell, lostTargets, sections) {
  const own = (cell.title ?? "").trim();
  const others = lostTargets
    .map(t => (sections?.[t]?.title ?? "").trim())
    .filter(Boolean)
    .filter(t => t !== own);
  if (!others.length) return own || "Elective";
  const all = [own, ...others].filter(Boolean);
  if (all.length <= 3) return all.join(" / ");
  return `${all[0]} or ${all.length - 1} other areas`;
}

/** Total credit the cells account for — what the plan will actually schedule. */
export function cellsSH(cells) {
  return (cells ?? []).reduce((n, c) => n + (c.sh ?? 0), 0);
}
