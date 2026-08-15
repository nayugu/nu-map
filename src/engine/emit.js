// ═══════════════════════════════════════════════════════════════════
// CHART · EMIT — the artifact
//
// The output is the SAME shape the catalog publishes, not a new format:
//
//   { plans: [ { label, pattern, years: [ { label, terms: [
//       { term, type, hours, entries: [ { text, sh, options?, binding?, why? } ] }
//   ] } ] } ] }
//
// `applySamplePlan` already reads exactly this — `options` with one group becomes a
// course placement, several groups becomes a reservation that knows its choices,
// none becomes an open reservation, and `binding.targets` sets the requirement. So
// reservations, candidates, the grid, PDF export and share links all work with zero
// new downstream code, and a generated plan is diffable against the published one
// for the same program, which is what the verification differential needs.
//
// `why` is additive. An older reader ignores an unknown key, so emitting it costs
// nothing and a reader that wants it gets legibility for free.
//
// ── Co-ops must be emitted, or the plan silently loses them ────────
//
// `applySamplePlan` builds work blocks from `{coop: true}` entries and merges
// consecutive ones into a run. A grid of course cells alone therefore produces NO
// co-op blocks at all: the work terms would become empty study terms, and every
// credit and standing calculation downstream would be wrong. The shape knows which
// terms are work terms, so they are emitted as co-op cells and the run merging on
// the other side reassembles the six-month block.
// ═══════════════════════════════════════════════════════════════════

import { GENERAL_ELECTIVE, CONCENTRATION } from "../core/requirementDemand.js";
import { materialize } from "../core/candidateSpec.js";
import { GENERATED_PLAN_LABEL } from "../core/planLabels.js";

/**
 * Turn an assignment into a plan.json grid.
 *
 * @param {object} args
 * @param {import("./shape.js").Shape} args.shape
 * @param {import("./domains.js").CellPlan[]} args.plans
 * @param {Map<string, number>} args.termOf   cell id → STUDY-term index
 * @param {object} args.program
 * @param {Record<string,object>} args.courseMap
 * @param {Map<string, object[]>} [args.reasons]
 * @param {string} [args.label]
 * @returns {object} a plan.json document with exactly one plan
 */
export function emitPlan({
  shape, plans, termOf, program, courseMap = {}, reasons = new Map(),
  label = GENERATED_PLAN_LABEL,
  // shape-term index → the course key the co-op STARTING there registers.
  // Keyed on the run's first term because that is the term `applySamplePlan`
  // creates the block in; the continuation terms of a six-month co-op merge
  // into the same block and must not carry a second registration.
  registersAt = new Map(),
}) {
  // `termOf` indexes STUDY terms; the grid needs every term the shape has,
  // including the work and unused ones. Mapping between the two is the one place
  // an off-by-one would put a whole year's courses in the wrong term, so it is
  // done once, explicitly.
  // The filter here MUST be the same one `shape.studyTerms` applies, or the two
  // disagree about what index 4 means and a whole year's courses land in the wrong
  // term. Making unused terms placeable broke exactly this: `studyTerms` began
  // including them while this still skipped them, and the shift showed up as 116
  // season violations and 89 terms over the credit cap — a plan that had been
  // verified against one indexing and written out under another.
  const studyIndexOf = new Map();
  let s = 0;
  shape.terms.forEach((t, i) => {
    if (!t.work) studyIndexOf.set(i, s++);
  });

  const cellsAt = new Map();          // study index → CellPlan[]
  for (const p of plans) {
    const ti = termOf.get(p.cell.id);
    if (ti == null) continue;
    if (!cellsAt.has(ti)) cellsAt.set(ti, []);
    cellsAt.get(ti).push(p);
  }

  const years = [];
  shape.terms.forEach((t, i) => {
    let year = years.find(y => y._index === t.yearIndex);
    if (!year) {
      year = { _index: t.yearIndex, label: t.label, terms: [] };
      years.push(year);
    }

    const entries = [];
    // ── The co-op marker belongs to any EMPLOYED term, not just a pure one ──
    //
    // This used to be `if (t.work)`, so a term carrying a co-op AND a course emitted
    // the course and no marker at all — and the artifact never told the student they
    // were employed that semester. 90 terms across 42 programs are that shape.
    //
    // It was not only a missing label. `gatePlan` reads employment from this entry, so
    // a co-op term CHART left empty was counted as "a semester the student is not
    // enrolled in": 38 of the 398 such terms were students on co-op. That is a headline
    // quality number miscounting the employed as the idle, and it is why an
    // empty-semester regression looked real when the genuinely-empty count had not
    // moved at all.
    //
    // Emitted FIRST, matching the published plans this mirrors — the catalog prints
    // `Co-op | ENGW 3304`, co-op then coursework. Consecutive markers merge into a run
    // on the other side, which is how a six-month co-op printed as two columns becomes
    // one block; a work term followed by a mixed one is exactly that case, and merging
    // them is correct rather than incidental.
    if (t.work || t.coop) {
      // `registers` names the work-experience course this co-op is proposed to
      // register for. Without it the plan sends the student on a co-op that
      // satisfies nothing: the requirement was withdrawn from the schedule
      // (correctly — it is not a class) and nothing put it back, so applying an
      // International Business plan produced two co-op blocks and two unmet
      // experiential sections. The student reads it and can change it, which is
      // what makes proposing one legitimate where inferring one is not.
      const registers = registersAt.get(i) ?? null;
      entries.push({ text: "Co-op", coop: true, ...(registers ? { registers } : {}) });
    }
    if (!t.work) {
      // Unused terms are emitted too, now that a cell may legitimately land in one.
      // A term that stayed empty emits nothing and reads as vacation, exactly as
      // before — the difference is that CHART is allowed to use it when a course
      // runs only in that season.
      const here = (cellsAt.get(studyIndexOf.get(i)) ?? []).slice()
        // Stable, readable order: forced courses first, then choices, then open
        // cells, alphabetically within each. Deterministic output is a hard
        // requirement, and it also reads the way a printed plan does.
        .sort((a, b) => kindRank(a.cell) - kindRank(b.cell)
          || String(a.cell.title).localeCompare(String(b.cell.title))
          || String(a.cell.id).localeCompare(String(b.cell.id)));
      for (const p of here) entries.push(entryFor(p, courseMap, reasons));
    }

    year.terms.push({
      term: t.termLabel,
      type: t.semTypeId,
      hours: entries.reduce((n, e) => n + (e.sh ?? 0), 0),
      entries,
    });
  });

  // ── A plan does not END in empty terms ──────────────────────────
  //
  // `defaultShape` builds whole YEARS, so a degree needing less than one gets a term it
  // can never fill: a 12 SH graduate certificate comes out `Fall 4 courses / Spring
  // nothing`, and the student is shown a semester they are not enrolled in as if it were
  // part of the programme. Measured, this is the bulk of the defect — of 360 empty full
  // terms, 90.3% are graduate and 254 (70.6%) are in derived shapes like these.
  //
  // Trimmed here rather than in the shape, deliberately. The term is real as far as the
  // SEARCH is concerned and must stay available to it: a course that only runs in spring
  // needs a spring to run in, and shortening the skeleton would refuse those degrees to
  // tidy the output. What is wrong is printing a trailing term nothing landed in.
  //
  // TRAILING only. A gap in the middle is a fact about the plan — the student really is
  // not enrolled that semester and needs to see it — and a co-op or vacation row is
  // content, not emptiness. Only the tail is cosmetic, because nothing follows it to give
  // it meaning.
  // The GLOBAL tail, not each year's. Trimming per year would cut a blank Year 1 Spring
  // while Year 2 still had courses, turning a tidy-up into a hole in the middle.
  const isBlank = (t) => !(t.entries ?? []).length;
  while (years.length) {
    const y = years[years.length - 1];
    while (y.terms.length && isBlank(y.terms[y.terms.length - 1])) y.terms.pop();
    if (y.terms.length) break;
    years.pop();
  }
  // ── And the same at the FRONT ───────────────────────────────────
  //
  // A plan whose first term is empty is a plan that starts later, not a plan with a hole.
  // It happens when nothing the degree needs runs in the fall — the courses are all spring
  // offerings, so the search legitimately puts them there and the artifact opens on a
  // semester the student is not enrolled in.
  //
  // Same rule as the tail and the same limit: only the blank RUN at the very start goes. A
  // gap after real coursework has begun is a fact the student needs to see.
  while (years.length) {
    const y = years[0];
    while (y.terms.length && isBlank(y.terms[0])) y.terms.shift();
    if (y.terms.length) break;
    years.shift();
  }

  return {
    plans: [{
      label,
      // The UI keys variant display on `pattern`, so a generated plan needs one.
      // The inherited shape's pattern when there is one, since the plan really is
      // that variant's calendar; a plain statement when the shape was derived.
      pattern: shape.pattern || (shape.source === "derived" ? "Generated" : ""),
      generated: true,
      years: years
        .sort((a, b) => a._index - b._index)
        .map(({ _index, ...rest }) => rest),
    }],
  };
}

const kindRank = (cell) => cell.kind === "named" ? 0 : cell.kind === "choice" ? 1 : 2;

/**
 * How a cell READS, as distinct from which requirement it is FOR.
 *
 * A reservation carries both strings and they do different jobs: `label` is what the
 * card shows, `requirement.title` is what it matches against the requirements panel.
 * Collapsing them into the section title made every card read like a catalog index —
 * `Mathematics Electives` where the department writes `MATH elective`, and
 * `Computer Science Required Courses` on a card four words wide.
 *
 * So the exact section title still travels, in `binding`, where matching happens and
 * where being verbatim matters. The label is singularised, because a cell is ONE
 * course and a plural title describes the whole requirement:
 *
 *   Mathematics Electives        -> Mathematics Elective
 *   Khoury Approved Electives    -> Khoury Approved Elective
 *   Supporting Courses           -> Supporting Course
 *
 * Nothing is dropped or reworded beyond that. A shortening rule clever enough to
 * turn "Khoury Approved Electives" into the department's own "Khoury Elective" would
 * be guessing at which words carry the meaning, and this file is not entitled to
 * decide that a requirement's name has redundant parts.
 */
export function cellLabel(title) {
  const s = String(title ?? "").trim();
  if (!s) return "Elective";
  // Only the LAST word, and only when it is a plural we recognise. Blind
  // de-pluralisation mangles words that merely end in s ("Statistics", "Physics",
  // "Studies"), which are subject names rather than counts.
  return s.replace(/\b(Electives|Courses|Requirements|Options|Choices)$/i, (m) => ({
    electives: "Elective", courses: "Course", requirements: "Requirement",
    options: "Option", choices: "Choice",
  })[m.toLowerCase()] ?? m);
}

/**
 * `CS 4300 or 4100`, the way the catalog prints a choice within one subject.
 *
 * Repeating the subject is not wrong, just not how a plan reads. Only collapsed when
 * every option is a single course in the SAME subject — `PSYC 3200 or PT 5410 and
 * PT 5411` has to state both subjects and both halves.
 */
/**
 * How many options a title may name before it stops being a title.
 *
 * ── Measured against the published plans ────────────────────────────
 *
 * Over all 13,352 cells in the committed corpus that carry options:
 *
 *     1 option  11,966      4 options   24
 *     2 options  1,111      5 options    2
 *     3 options    222      6 options   26      7 options  1
 *
 * So 99% name three or fewer, and no department has ever printed more than seven. THREE
 * is the bar: it is the p99 of what the catalog itself considers a printable choice.
 *
 * Without a bar, a "Computing and Social Issues" slot with twelve options rendered as
 * "AFCS 2600 or CY 4170 or CY 5240 or DS 1300 or PHIL 1300 or HIST 2220 or INSH 2102 or
 * JRNL 3700 or PHIL 1145 or SOCL 1280 or SOCL 2485 or SOCL 4528" — six lines that
 * swallowed the term it sat in, and named twelve courses to answer a question the
 * requirement's own title answers in three words.
 */
export const MAX_TITLED_OPTIONS = 3;

function choiceText(groups, courseMap) {
  const singles = groups.every(g => g.length === 1 && courseMap[g[0]]);
  const subjects = new Set(groups.flat().map(id => courseMap[id]?.subject));
  const shown = groups.slice(0, MAX_TITLED_OPTIONS);
  // The count of what is NOT named, appended as a numeral. Deliberately not "+9 more":
  // this string is the same in all eight locales, and every other word in it — the course
  // codes — is language-neutral. `(+9)` after a list of three reads the same anywhere;
  // English prose emitted from the engine would not localise at all.
  const overflow = groups.length > shown.length ? ` (+${groups.length - shown.length})` : "";

  if (singles && subjects.size === 1) {
    const [first, ...rest] = shown.map(g => courseMap[g[0]]);
    return `${first.subject} ${first.number}`
      + rest.map(c => ` or ${c.number}`).join("") + overflow;
  }
  return shown.map(g => g.map(id => spaced(id, courseMap)).join(" and ")).join(" or ") + overflow;
}

/**
 * What a cell READS AS on a card — the one derivation, for every reader.
 *
 * Exported because the derivation view draws the same plan and was deriving this
 * SECOND time, worse: its roster carried a course code only when a cell named exactly
 * one course, so `CS 1800 and CS 1802` — a corequisite pair the catalog prints as one
 * cell — fell through to the requirement's title and the walkthrough showed
 * "Computer Science Fundamental Courses" where the preview beside it showed the two
 * courses. A choice cell was worse again: the preview reads `CS 4300 or 4100` and the
 * step-through read the section title.
 *
 * The rule this restores is the one `BuildSteps` states about itself — "whatever the
 * preview does, this does, because it is the same code". Two derivations of one string
 * are two things to get wrong, and this pair had already drifted.
 */
export function cellText(cell, courseMap = {}) {
  if (cell?.kind === "named" && cell.groups?.[0]) {
    return cell.groups[0].map(id => spaced(id, courseMap)).join(" and ");
  }
  if (cell?.kind === "choice" && cell.groups?.length) {
    return choiceText(cell.groups, courseMap);
  }
  return cellLabel(cell?.title);
}

/** One grid entry, in the catalog's own vocabulary. */
function entryFor(plan, courseMap, reasons) {
  const cell = plan.cell;
  const why = reasons.get(cell.id);
  const base = { sh: cell.sh ?? 0, ...(why ? { why } : {}) };

  if (cell.kind === "named" && cell.groups?.[0]) {
    // The catalog writes a co-requisite pair as one cell: "CS 1800 and CS 1802".
    //
    // The binding travels here too, even though a named cell becomes a course
    // placement rather than a reservation and `applySamplePlan` will not read it.
    // Split credit is the reason: `GE 1501` answers three sections at once, and that
    // is exactly the fact a reader of the plan needs and cannot recover from the
    // grid. Omitting it discarded `alsoAnswers` for every merged cell.
    return {
      ...base,
      text: cellText(cell, courseMap),
      options: [cell.groups[0]],
      ...bindingFor(cell),
      // Which members of the group are here for the registrar rather than for the
      // requirement. Without this the binding reads as a claim that every course in
      // the group answers the section, which for a corequisite partner is false.
      ...(cell.coreqAdded?.length ? { coreqAdded: [...cell.coreqAdded] } : {}),
    };
  }

  if (cell.kind === "choice" && cell.groups?.length) {
    return {
      ...base,
      text: cellText(cell, courseMap),
      options: cell.groups.map(g => [...g]),
      // A choice cell carries its binding too. No published plan does — the
      // scraper only binds cells with no options — but generation KNOWS the
      // requirement rather than inferring it, and dropping it would throw away
      // the one thing a generated plan is certain of.
      ...bindingFor(cell),
    };
  }

  // An open cell whose candidate set is small enough to write out gets `options`,
  // which makes the reservation BOUNDED downstream: `candidates.js` seeds from the
  // options rather than falling back to the whole catalog.
  //
  // This matters most for a pooled cell. Its binding names several sections, and
  // `applySamplePlan` only adopts a binding forced to one — so without options it
  // would arrive knowing nothing, and a cell drawing on six named colleges would
  // offer all 8,000 courses. Naming them keeps the precision the derivation had.
  const enumerated = cell.spec ? [...materialize(cell.spec, courseMap)].sort() : [];
  const text = cellText(cell, courseMap);
  if (enumerated.length && enumerated.length <= MAX_NAMED_OPTIONS) {
    return { ...base, text, options: enumerated.map(id => [id]), ...bindingFor(cell) };
  }
  return { ...base, text, options: [], ...bindingFor(cell) };
}

/**
 * How many courses a cell may name before it is better described than listed.
 *
 * Measured against the corpus: requirement sections admit a median of 8 courses and
 * the bulk sit under 40, so this enumerates almost every real elective pool while
 * leaving the genuinely open ones — a `CS 2500–9999` range with 247 members, a
 * general elective with all of them — as descriptions.
 */
export const MAX_NAMED_OPTIONS = 40;

/**
 * The binding a cell carries into the plan.
 *
 * `forced: true` because generation constructed it: this is not a max-flow
 * inference that happened to leave one possibility, it is the requirement the cell
 * was BUILT from. The sentinels travel as themselves — `~general` is not a section
 * index and must not be written as one.
 */
function bindingFor(cell) {
  if (cell.target === GENERAL_ELECTIVE || cell.target === CONCENTRATION) {
    return { binding: { targets: [cell.target], forced: true } };
  }
  if (typeof cell.target !== "number") return {};
  const targets = [cell.target, ...(cell.alsoAnswers ?? [])];
  // More than one target is not ambiguity here — it is a course that genuinely
  // answers several sections by split credit. `forced` stays true only when there
  // is one, so a downstream reader cannot mistake the list for a guess.
  return { binding: { targets, forced: targets.length === 1 } };
}

/** "CS1800" → "CS 1800", the way the catalog prints it. */
function spaced(id, courseMap) {
  const c = courseMap[id];
  return c ? `${c.subject} ${c.number}` : id;
}
