// ═══════════════════════════════════════════════════════════════════
// CORE: planConflicts — the FLAGS block of the clipboard summary.
// ═══════════════════════════════════════════════════════════════════
//
// ── Why this exists ────────────────────────────────────────────────
//
// The app has always KNOWN these things and has only ever DRAWN them: an amber
// rim on a card, a red relation line, a warning row in the panel. There was no
// way to SAY them, so the two artifacts a student hands to someone else — the
// printed report and the clipboard summary — described a plan while silently
// omitting everything the app had already looked at.
//
// For a human that is merely incomplete. For a model reading the paste it is
// worse: it cannot tell "checked and clean" from "not checked", so it
// re-derives the prerequisite order itself, badly, from the course codes it can
// see. So the point is not the list of failures — it is making the EMPTY list
// sayable. "None, over 32 placed courses, against these checks" is a result;
// silence is not.
//
// ── What this is NOT ───────────────────────────────────────────────
//
// It is not a list of the student's mistakes, and the section is named
// `Flags (supplementary)` because calling it Conflicts overstated every line in
// it. Most entries are not errors at all — see the note above `FLAG_HEADING`
// for the walk through each kind, the registration-consequence test a kind has
// to pass to be here, and the three that were cut for failing it. The default
// is to CUT; the schedule is the artifact, and this is secondary to it.
//
// ── The one rule: the verdict comes from the app, the evidence is derived ─
//
// Nothing here decides whether a plan is broken. Every item originates in a
// verdict some other module already reached and the UI already draws
// (`prereqViolations`, `coreqViolations`, `standingViolations`,
// `coopGradConflicts`, `ICourseOffering.offered`, `creditLoad`). This module's
// own work is finding the EVIDENCE for a verdict it was handed — which
// prerequisite, in which term — and that search is best-effort by construction:
// it degrades to naming the requirement in prose and never to inventing,
// downgrading or withholding a verdict.
//
// The consequence to keep: a flag list that disagreed with the board would be
// worse than no list, because the student can see both. So the inputs are the
// board's own maps, and the two gates the board applies are applied here too
// (see the availability block below).
// ═══════════════════════════════════════════════════════════════════

import { formatPrereqSummary } from "./planModel.js";
import { loadState, LOAD_OVER } from "./creditLoad.js";
import { STANDING_NAMES, requiredSHFor } from "./classStanding.js";

/**
 * The checks whose failures appear in this list, keyed by the input that
 * enables each one, in the words the export uses.
 *
 * ── Why this is keyed on the input, and not a flat list ────────────
 *
 * The first version was a flat array printed unconditionally, and the
 * measurement run caught what that costs: called with no violation maps at all,
 * the export printed "None. All 32 placed courses pass every check listed
 * above" over a plan nothing had looked at. That is ABSENT reported as FALSE —
 * the one collapse this repo has paid for in every scrape bug of consequence,
 * arriving here in the export layer.
 *
 * So a check is claimed only when its input was actually supplied. `undefined`
 * means "the caller wired nothing", an empty Map means "we looked and there was
 * nothing", and those now produce different text: the first names the check as
 * NOT RUN, the second contributes to a positive result. The app supplies
 * everything, so nothing changes in the live paste — this exists so that a
 * future caller who forgets one cannot publish a coverage claim it has not
 * earned.
 */
export const CHECKS = {
  prereqViolations:   "prerequisite order (with entered grades)",
  coreqViolations:    "corequisite same-term placement",
  standingViolations: "class-standing gates from Banner section restrictions",
  offered:            "term availability from offering history",
  semesterLoad:       "credit load against the registration cap",
  coopGradConflicts:  "work terms overlapping graduation",
};

/**
 * ── What is NOT flagged, and why each one was cut ───────────────────
 *
 * The default is to cut. A flag has to earn its line by being something a
 * student or an advisor would ACT on, that is not already stated somewhere
 * this reader can see, and that is not merely a fact about a course. Three
 * failed that test:
 *
 *   · **an unplaced substitution.** Recording "A stands in for B" before
 *     dragging A onto the board is the order a person does those two steps in.
 *     Flagging it told them off for using the feature correctly. Now stated in
 *     the Substitutions block as "(not yet placed)".
 *
 *   · **a retired course.** It is in the plan BECAUSE a shipped program
 *     edition still requires it (course-retention.js), so for the student whose
 *     edition that is, taking it is correct and a flag is an accusation. It is
 *     still worth knowing, so the schedule row says `[retired]`: a property of
 *     the course, printed on the course.
 *
 *   · **a minor over the 50% double-count cap.** Real and important, and
 *     already printed verbatim in that minor's own audit block, in the
 *     registrar's numbers ("Double counting: 12 of the 20 SH this minor
 *     requires…"). A second copy in a supplementary list is bloat, not
 *     information. Note the app itself treats this as information: it never
 *     un-allocates a course over the cap, because choosing which to drop is an
 *     advising decision.
 *
 * What survived, and the sentence each one has to be able to say:
 *
 *   prereq order       Banner will refuse the registration.
 *   coreq co-placement Banner will refuse the registration.
 *   class standing     the registrar's gate closes this section to them.
 *   availability       NEU may not run the course in that term at all.
 *   credit cap         over the cap is a petition, not a registration.
 *   work term/grad     the plan graduates the student mid-co-op.
 *
 * Anything that cannot say one of those belongs beside the thing it describes,
 * or nowhere.
 */

/** The checks, in a stable order, for anything that wants to enumerate them. */
export const CHECK_KEYS = Object.keys(CHECKS);

/**
 * Everything a plan is NOT gated on: one list, held and unheld together.
 *
 * It began as two — data we hold but do not enforce, and data nobody could
 * have — which is a true and useful distinction and cost two headings and
 * fourteen bullets to draw. The single fact worth keeping from it is inside
 * the first entry, and it is load-bearing because the very first draft got it
 * backwards: seat data is NOT missing. Enrolled, capacity and section counts
 * are scraped per completed term and every course page draws fill percentage
 * and open seats per section. What does not exist is a seat count for a term
 * that has not been scraped yet, so the two seat entries sit adjacent and say
 * exactly which is which.
 */
export const NOT_GATED = [
  "seat counts, fill and instructors for PAST terms (on each course page, but never a gate)",
  "seats at this student's own registration time",
  "meeting-time clashes",
  "credit not entered here, such as unrecorded transfer",
  "conditions only an advisor or the registrar can judge",
];

/**
 * The sentence that has to survive every cut.
 *
 * A conflict is what NU Map can see, and what it can see is a plan a student
 * typed. A prerequisite may already be waived, a petition may be approved, a
 * transferred course may never have been entered, and a course may be missing
 * because the student chose not to record it. None of that is visible here, so
 * a reader who treats the list as a list of the student's MISTAKES will be
 * confidently wrong about someone else's degree.
 *
 * Printed with the conflicts rather than in the appendix, because the doubt it
 * answers arrives exactly there.
 */
export const TRUST_NOTE =
  "Signals, not errors, and secondary to the plan above. Each may already be "
  + "resolved in a way NU Map cannot see: an approval, a petition, credit not "
  + "entered here, or the student's own choice. Do not rewrite the plan around "
  + "one, and ask before calling one a mistake.";

/** Scope of a conflict: one course, one term, or the plan as a whole. */
export const SCOPE_COURSE = "course";
export const SCOPE_TERM   = "term";
export const SCOPE_PLAN   = "plan";

/**
 * Collect every known conflict in a plan.
 *
 * Everything is a plain value or a function — no ports, no adapter, no React —
 * so the whole list is testable without an app. The caller binds the ports
 * (`offered` carries the student's overrides; `semesterLoad` carries the
 * reservation-aware combined view).
 *
 * @param {object}  a
 * @param {Record<string,string>} a.placements        id → semId (raw)
 * @param {Record<string,object>} a.courseMap
 * @param {Array}   a.semesters                       SEMESTERS, in order
 * @param {Record<string,number>} a.semIndex          SEM_INDEX
 * @param {string}  a.currentSemId
 * @param {Map<string,string>}    [a.prereqViolations]   id → "order"|"missing"|"grade"
 * @param {Map<string,string>}    [a.coreqViolations]    id → "alone"|"sep"
 * @param {Map<string,object>}    [a.standingViolations] id → {required, earned}
 * @param {Array}   [a.coopGradConflicts]             [{id, label, semId}]
 * @param {Array}   [a.edges]                         allEdges [{from,to,type,concurrent}]
 * @param {Set<string>} [a.placedOut]
 * @param {Array}   [a.substitutions]                 [{from,to}]
 * @param {(course: object, semTypeId: string) => boolean} [a.offered]
 * @param {(course: object, semTypeId: string) => number|null} [a.probability]
 * @param {(semId: string) => number} [a.semesterLoad]
 * @param {number}  [a.creditCap]                     Infinity when there is none
 * @param {boolean} [a.hideGrades]                    private-grades mode
 * @param {string}  [a.unitName]
 * @param {(semId: string) => string} [a.semLabelOf]  standalone term heading;
 *        NOT `sem.label`. A SemesterType may carry an `altLabel` used wherever
 *        a term names itself alone ("Summer A 2027", never "Summer 1 2027"),
 *        which is the case here — so the caller supplies the resolved label
 *        and this module stays free of calendar knowledge.
 * @returns {{items: object[], count: number}} items sorted by term, then code
 */
export function collectConflicts(input = {}) {
  const {
    placements = {}, courseMap = {}, semesters = [], semIndex = {}, currentSemId,
    prereqViolations = new Map(), coreqViolations = new Map(),
    standingViolations = new Map(), coopGradConflicts = [],
    edges = [], placedOut = new Set(), substitutions = [],
    offered = null, probability = null,
    semesterLoad = null, creditCap = Infinity,
    hideGrades = false, unitName = "SH",
    semLabelOf = null,
  } = input;

  // Which checks the caller actually enabled. `undefined` is "wired nothing",
  // and it must not read as "found nothing" — see the note on CHECKS. Credit
  // load additionally needs a finite cap: a port that returns nothing gives
  // Infinity, and comparing against Infinity is not a check, it is a formality
  // that can never fail.
  const ran = {};
  for (const key of CHECK_KEYS) ran[key] = input[key] !== undefined && input[key] !== null;
  if (ran.semesterLoad && !Number.isFinite(creditCap)) ran.semesterLoad = false;

  const items = [];
  const semById  = new Map(semesters.map(s => [s.id, s]));
  const labelOf  = id => (semLabelOf ? semLabelOf(id) : null) ?? semById.get(id)?.label ?? id;
  const codeOf   = id => courseMap[id]?.code ?? id;
  const curIdx   = semIndex[currentSemId] ?? 0;
  const inPlan   = id => placements[id] !== undefined
                      && placements[id] !== "incoming"
                      && semIndex[placements[id]] !== undefined;

  const push = (o) => items.push({ ...o, semLabel: o.semId ? labelOf(o.semId) : null });

  // ── Prerequisite order ──────────────────────────────────────────
  //
  // The verdict is `prereqViolations`. The evidence — WHICH prerequisite, and
  // where it sits — is searched for among the placed prereq edges, and the
  // search is allowed to come up empty: a tree can be unsatisfied because a
  // branch is absent entirely, in which case there is no offending card to
  // name and the requirement itself is what needs saying.
  for (const [id, kind] of prereqViolations) {
    if (!inPlan(id)) continue;
    const course = courseMap[id];
    if (!course) continue;
    const ti = semIndex[placements[id]];

    const late = [];
    const same = [];
    for (const e of edges) {
      if (e.type !== "prerequisite" || e.to !== id) continue;
      if (!inPlan(e.from)) continue;
      const fi = semIndex[placements[e.from]];
      if (fi > ti) late.push(e.from);
      // A concurrent prereq legitimately shares the term — the same test the
      // relation lines use. Reporting one would contradict the board, which
      // draws that edge in its ordinary colour.
      else if (fi === ti && !e.concurrent) same.push(e.from);
    }

    // "grade" is a distinct fact: the placement order is fine and an entered
    // grade voided the attempt. In private-grades mode it is reported as an
    // unsatisfied prerequisite instead — the conflict is real and stays
    // listed, but the export must not disclose the grade that caused it. Same
    // sanitising the MCP surface does.
    const graded = kind === "grade" && !hideGrades;

    push({
      scope: SCOPE_COURSE, kind: graded ? "prereq-grade" : "prereq-order",
      id, code: codeOf(id), semId: placements[id],
      late: late.map(codeOf).sort(), same: same.map(codeOf).sort(),
      lateTerms: late.map(x => labelOf(placements[x])),
      // Only consulted when nothing was found to name, so the tree summary is
      // paid for only where it is the only thing to say.
      requirement: (late.length || same.length) ? null
        : formatPrereqSummary(course.prereqs, courseMap),
    });
  }

  // ── Corequisites ────────────────────────────────────────────────
  for (const [id, kind] of coreqViolations) {
    if (!inPlan(id)) continue;
    const partners = edges
      .filter(e => e.type === "corequisite" && e.to === id)
      .map(e => e.from);
    push({
      scope: SCOPE_COURSE, kind: kind === "alone" ? "coreq-absent" : "coreq-split",
      id, code: codeOf(id), semId: placements[id],
      partners: partners.map(codeOf).sort(),
      partnerTerms: partners
        .filter(p => inPlan(p))
        .map(p => `${codeOf(p)} in ${labelOf(placements[p])}`).sort(),
    });
  }

  // ── Class standing ──────────────────────────────────────────────
  //
  // Not gated on whether the term is finished, deliberately, and this matches
  // the card: a standing gate is a statement about what the registrar would
  // have allowed, like a corequisite, not a forecast about what NEU will
  // offer. Left lit on a completed term is how a student notices they recorded
  // something they could not have sat.
  for (const [id, v] of standingViolations) {
    if (!inPlan(id)) continue;
    push({
      scope: SCOPE_COURSE, kind: "standing",
      id, code: codeOf(id), semId: placements[id],
      required: v?.required, earned: v?.earned, unitName,
    });
  }

  // ── Availability: not usually offered, or gone from the catalog ──
  //
  // Both are predictions about REGISTRATION, so both are withheld on a
  // completed term — there is no version of the past in which the student
  // picks differently, and an alarm that cannot be acted on is noise. This is
  // the same gate `availabilityAlarm` applies on the card, and it has to stay
  // the same one: the student can see both surfaces at once.
  for (const [id, semId] of Object.entries(placements)) {
    if (!inPlan(id)) continue;
    const course = courseMap[id];
    if (!course) continue;
    if (placedOut.has(id)) continue;
    if ((semIndex[semId] ?? 99) < curIdx) continue;      // completed term
    const sem = semById.get(semId);
    if (!sem || sem.type === "special") continue;

    // `retired` is NOT flagged here; the schedule row says `[retired]`. See the
    // note above CHECKS: the course is in the plan because an edition still
    // requires it, so flagging it accuses the student of following their own
    // catalog year.
    if (offered && sem.semTypeId && !offered(course, sem.semTypeId)) {
      const p = probability ? probability(course, sem.semTypeId) : null;
      // The season, without the year: the offering rate is a fact about
      // "Summer A", not about Summer A 2027. Taken from the resolved standalone
      // label so it reads "Summer A" like every other surface.
      push({ scope: SCOPE_COURSE, kind: "not-offered", id, code: codeOf(id), semId,
             probability: p, semKind: String(labelOf(semId)).replace(/\s+\d{4}$/, "") });
    }
  }

  // ── Credit load ─────────────────────────────────────────────────
  //
  // Summer is judged as a WHOLE against the ordinary cap — two 12 SH halves
  // are 24 SH of summer and that is the number a registrar sees. Grouping by
  // `type` rather than by id is what makes that fall out, and it is why the
  // caller passes `semesterLoad` (the reservation-aware, work-term-aware
  // number the row itself draws) rather than a placement sum computed here.
  if (semesterLoad && Number.isFinite(creditCap)) {
    const groups = new Map();   // key → {semIds, sh}
    for (const sem of semesters) {
      if (sem.type === "special") continue;
      if (semIndex[sem.id] === undefined) continue;
      // Halves of one term share a group; a full-weight term is its own. Keyed
      // on the theme + calendar year rather than on "summer", so an adapter
      // that splits some other term inherits the same treatment.
      const key = (sem.weight ?? 1) < 1
        ? `${sem.type}:${String(sem.id).replace(/^\D+/, "")}` : sem.id;
      const g = groups.get(key) ?? { semIds: [], sh: 0 };
      g.semIds.push(sem.id);
      g.sh += semesterLoad(sem.id) || 0;
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      if (loadState(g.sh, { cap: creditCap }) !== LOAD_OVER) continue;
      // The label is every member named, joined — never a shortened form
      // invented here. "Summer A 2027 + Summer B 2027" is longer than "Summer
      // 2027" and says exactly which cells the number came from, which is what
      // a reader checking it needs.
      items.push({ scope: SCOPE_TERM, kind: "over-cap", semId: g.semIds[0],
                   semLabel: g.semIds.map(labelOf).join(" + "),
                   sh: g.sh, cap: creditCap, unitName,
                   combined: g.semIds.length > 1 });
    }
  }

  // ── Work term overlapping graduation ────────────────────────────
  for (const c of coopGradConflicts) {
    items.push({ scope: SCOPE_PLAN, kind: "coop-graduation",
                 label: c?.label ?? "Work term", semId: c?.semId ?? null,
                 semLabel: c?.semId ? labelOf(c.semId) : null });
  }

  // ── NOT flagged: a minor over the 50% double-count cap ──────────
  //
  // Real, important, and already printed verbatim in that minor's own audit
  // block in the registrar's own numbers ("Double counting: 12 of the 20 SH
  // this minor requires also count toward the major…"). A second copy in a
  // supplementary list is bloat, not information. The app itself treats the cap
  // as information and never un-allocates a course over it, because choosing
  // which one to drop is an advising decision.

  // ── NOT flagged: a substitution whose replacement is unplaced ───
  //
  // This was a flag and should never have been. Recording "MATH 2331 will
  // stand in for MATH 2341" and not yet having dragged MATH 2331 onto the
  // board is ORDINARY PLANNING, in the exact order a student does it. Calling
  // it a problem told them off for using the feature correctly.
  //
  // It is still worth SAYING, so it is said where it is a fact rather than a
  // verdict: the Substitutions block marks the row "(not yet placed)". That is
  // the general shape for everything considered for this list — if the honest
  // sentence is "here is a thing that is true", it belongs beside the thing,
  // not in a section a reader scans for what to fix.

  // Deterministic order: by term, then by code. Two pastes of one plan must be
  // byte-identical, or a reader diffing them sees changes that are not there.
  const rank = { [SCOPE_COURSE]: 0, [SCOPE_TERM]: 1, [SCOPE_PLAN]: 2 };
  items.sort((a, b) =>
    rank[a.scope] - rank[b.scope]
    || (semIndex[a.semId] ?? 999) - (semIndex[b.semId] ?? 999)
    || String(a.code ?? a.label ?? "").localeCompare(String(b.code ?? b.label ?? ""))
    || String(a.kind).localeCompare(String(b.kind)));

  return { items, count: items.length, ran };
}

/** Join a list as "A, B and C" — read by a person, and by a model, as prose. */
const andList = (xs) => xs.length <= 1 ? (xs[0] ?? "")
  : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/**
 * One conflict → one English clause, with its evidence in it.
 *
 * "CS 3000: prerequisite violation" is a label, and a label is exactly what
 * invites a reader to re-check the claim themselves. "prerequisite CS 2510 is
 * placed in Spring 2028, a later term" states the comparison that was made, so
 * there is nothing left to re-derive.
 *
 * English, like the rest of the export path (planModel.js is English-only by
 * design). The button that triggers it is localised; the artifact is not.
 */
export function conflictClause(it) {
  const u = it.unitName ?? "SH";
  switch (it.kind) {
    case "prereq-order": {
      if (it.late.length) {
        const where = it.late.length === 1 && it.lateTerms.length === 1
          ? ` (${it.lateTerms[0]})` : "";
        return `prereq ${andList(it.late)} placed later${where}`;
      }
      if (it.same.length) {
        return `prereq ${andList(it.same)} in the same term, not marked concurrent`;
      }
      return `prereqs not met by this plan; catalog asks for ${it.requirement || "a tree we could not summarise"}`;
    }
    case "prereq-grade":
      return `order is fine; an entered grade means a prereq was not earned`;
    case "coreq-absent":
      return `coreq ${andList(it.partners)} not in the plan (must share the term)`;
    case "coreq-split":
      return `coreq ${andList(it.partnerTerms.length ? it.partnerTerms : it.partners)} must share this term`;
    case "standing": {
      // The THRESHOLD is named, not just the code: the registrar sets standing
      // by EARNED hours, so the number is the fact and the year name is only a
      // gloss. "JR standing needed" would send a reader off to look up what JR
      // means in credits, which is the re-derivation this file exists to stop.
      const name = STANDING_NAMES[it.required] ?? it.required;
      return `${name} standing (${requiredSHFor(it.required)} ${u}) required; ${it.earned} ${u} earned by then`;
    }
    case "not-offered":
      return it.probability != null
        ? `offered in ${it.semKind} in ${Math.round(it.probability * 100)}% of recorded years`
        : `rarely offered in ${it.semKind}`;
    case "over-cap":
      return `${it.sh} ${u}${it.combined ? " (both halves)" : ""} over the ${it.cap} ${u} cap; needs a petition`;
    case "coop-graduation":
      return `${it.label}${it.semLabel ? ` (${it.semLabel})` : ""} runs into the graduation term`;
    default:
      return it.kind;
  }
}

/**
 * The section's own name, carrying its own status. Deliberately not
 * "Conflicts": see below for why every word here is doing work.
 */
export const FLAG_HEADING = "Flags (supplementary)";

/**
 * The whole Flags block, as text.
 *
 * ── Why it is "Flags" and not "Conflicts" ──────────────────────────
 *
 * Because most of these are not wrong. Walk the list and ask what each one
 * actually asserts: a course rarely offered in Summer A is a RATE; a retired
 * course is a fact about the catalog; a class-standing gate is a projection
 * against credits the student has not earned yet; 21 SH over the cap needs a
 * petition, which students get. Only prerequisite order and corequisite
 * co-placement are close to "this cannot be registered", and even they can be
 * waived by the department that owns the course. A section called Conflicts
 * over a list like that overstates every line in it, and the one that was
 * plainly not a problem at all — a substitution recorded before its course was
 * placed, i.e. the feature being used in the order a person uses it — has been
 * removed from the list entirely rather than renamed.
 *
 * The block is SUPPLEMENTARY, and says so in its own second line. Its job is
 * narrow: to show that these things were already looked at, so a reader does
 * not spend their attention re-deriving them from the course codes. It is not
 * a to-do list, and it is not evidence the plan is wrong.
 *
 * ── Shape ──────────────────────────────────────────────────────────
 *
 * Course-scoped items GROUP BY COURSE, one line when a course has a single
 * flag and an indented list when it has several, so a reader scanning for a
 * code finds everything about it in one place. Clauses are terse on purpose:
 * a supplementary section that costs a paragraph per item is one nobody reads
 * to the end of, and the evidence still has to be in each line.
 *
 * A clean plan prints a POSITIVE result, not an empty heading. That asymmetry
 * is the one thing here that is not supplementary: "none, over N placed
 * courses" is a fact, and an omitted section is indistinguishable from a check
 * that never ran.
 *
 * @param {object[]} items        from collectConflicts
 * @param {number}   placedCount  courses the checks ran over
 * @param {object}   [ran]        collectConflicts' own report of which checks
 *                                were enabled. Without it the positive result
 *                                is stated WITHOUT the "every check" claim,
 *                                because a caller that cannot say what ran
 *                                cannot be quoted as saying everything did.
 */
export function formatConflicts(items, placedCount = 0, ran = null) {
  if (!items.length) {
    const all = ran ? CHECK_KEYS.every(k => ran[k]) : false;
    const n = `${placedCount} placed course${placedCount === 1 ? "" : "s"}`;
    if (all) {
      // Named, not positional: this block moved below the schedule so the plan
      // comes first, and "listed above" quietly became false the moment it did.
      return [`--- ${FLAG_HEADING} ---`,
              `None. All ${n} pass every check under "What this was checked against".`];
    }
    const missing = ran ? CHECK_KEYS.filter(k => !ran[k]) : CHECK_KEYS;
    return [
      `--- ${FLAG_HEADING} ---`,
      `None found among the checks that ran, over ${n}.`,
      ...wrap(`NOT CHECKED in this export, so treat as unknown rather than as `
        + `passing: ${missing.map(k => CHECKS[k]).join("; ")}.`),
    ];
  }

  // The demotion is the SECOND LINE, before the list, not a footnote after it.
  // A reader who meets four terse lines under a heading has already decided
  // what they are by the time a caveat arrives underneath.
  const out = [`--- ${items.length} ${FLAG_HEADING} ---`, ...wrap(TRUST_NOTE), ``];

  // Group the course-scoped ones, preserving the sorted order of first
  // appearance so the block stays term-by-term.
  const byCourse = new Map();
  const rest     = [];
  for (const it of items) {
    if (it.scope !== SCOPE_COURSE) { rest.push(it); continue; }
    const key = it.id;
    if (!byCourse.has(key)) byCourse.set(key, []);
    byCourse.get(key).push(it);
  }

  for (const [, group] of byCourse) {
    const head = `${group[0].code}${group[0].semLabel ? ` (${group[0].semLabel})` : ""}`;
    if (group.length === 1) out.push(`${head}: ${conflictClause(group[0])}.`);
    else {
      out.push(`${head}:`);
      for (const it of group) out.push(`  · ${conflictClause(it)}`);
    }
  }
  for (const it of rest) {
    const head = it.scope === SCOPE_TERM ? (it.semLabel ?? "Term") : "Plan";
    out.push(`${head}: ${conflictClause(it)}.`);
  }
  // A partial run says so even when it found something: "here are two problems"
  // otherwise implies the rest was clean.
  const missing = ran ? CHECK_KEYS.filter(k => !ran[k]) : [];
  if (missing.length) {
    out.push(``, ...wrap(`NOT CHECKED in this export, so treat as unknown rather `
      + `than as passing: ${missing.map(k => CHECKS[k]).join("; ")}.`));
  }
  return out;
}

/**
 * Soft-wrap a paragraph at `width`, so the appendix reads as prose in a
 * fixed-width paste without any line running off the side.
 */
function wrap(text, width = 78) {
  const out = [];
  let line = "";
  for (const word of String(text).split(/\s+/)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

/**
 * The envelope: TWO SENTENCES.
 *
 * It started as three headed sections and 24 bullets, ~1,900 characters, which
 * was 40% of a paste whose entire purpose was to stop being mostly boilerplate.
 * Measured again after a first trim it was still the largest block after the
 * schedule, at 18%. So the formatting went, then a heading went. No fact was
 * dropped in either pass: bullets earn their space when a reader scans and
 * picks one item, and nobody picks one item out of a coverage statement. They
 * read it once, or never.
 *
 * `ran` filters the checked list to the checks that actually happened, so the
 * coverage claim cannot outlive its inputs. Anything wired off drops out here
 * and is named under Conflicts instead: a reader must never have to reconcile
 * a claim in one section with a denial in another.
 */
export function formatEnvelope(ran = null) {
  const claimed = CHECK_KEYS.filter(k => !ran || ran[k]).map(k => CHECKS[k]);
  return [
    `--- What this was checked against ---`,
    // "Checked: ." is what an empty claim used to print, which reads as a
    // formatting slip rather than as the fact it is. A caller that wired
    // nothing checked nothing, and the sentence should say so in words.
    ...wrap(claimed.length
      ? `Checked: ${claimed.join("; ")}.`
      : `Checked: nothing — this export was built without any of the checks wired.`),
    ...wrap(`Not gated on: ${NOT_GATED.join("; ")}.`),
  ];
}
