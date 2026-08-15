// ═══════════════════════════════════════════════════════════════════
// ADAPTER: mcp/plannerActionAdapter  (Node.js — implements the dry-run
// half of IPlannerAction for external actors)
//
// Pure with respect to plan state: applyChangeset works on a deep clone
// and never touches the live plan. The transport layer (mcp-server)
// wires propose/apply to the browser over SSE; this module supplies the
// action semantics, violation checking, and the capability registry
// advertised through get_meta.
//
// Compatibility rule (see IPlannerAction): the action registry is
// additive-only, and unknown action types are SKIPPED and reported in
// `unsupported`, never a hard error — so a newer browser or an older
// server can exchange changesets safely.
// ═══════════════════════════════════════════════════════════════════

import { evalPrereqTree } from "../../core/prereqEval.js";
import { planConditions } from "../../core/prereqConditions.js";
import { baseId, resolveAddId } from "../../core/repeatInstances.js";
import { cohortCatalogYear, withCatalogYear } from "../../data/programPaths.js";

// ── Semester ordering ─────────────────────────────────────────────

const MONTH_OF = { spring: 1, sumA: 5, sumB: 7, fall: 9 };

export function parseSemId(semId) {
  const m = String(semId).match(/^(fall|spring|spr|sumA|sumB)(\d{4})$/);
  if (!m) return null;
  const semType = m[1] === "spr" ? "spring" : m[1];
  return { semType, year: parseInt(m[2], 10) };
}

export function semSortKey(semId) {
  const p = parseSemId(semId);
  if (!p) return 0;
  return p.year * 12 + (MONTH_OF[p.semType] ?? 0);
}

/**
 * Chronological cohort window [entry, graduation] — the calendar-agnostic
 * counterpart of the UI's SEM_INDEX membership test. Placements parked
 * OUTSIDE the plan's timeline (left behind when the cohort shrank) are kept
 * in state but must never count: not as completed history, not as prereq
 * satisfaction, and they aren't validated. "incoming" is always inside.
 */
export function inCohortWindow(plan, semId) {
  if (semId === "incoming") return true;
  if (plan?.entYear == null || plan?.gradYear == null) return true; // no cohort info — don't filter
  const pre = s => (s === "spring" ? "spr" : (s ?? "fall"));
  const k = semSortKey(semId);
  if (!parseSemId(semId)) return false; // "__overflow:*" and other parked shapes
  return k >= semSortKey(`${pre(plan.entSem)}${plan.entYear}`)
      && k <= semSortKey(`${pre(plan.gradSem)}${plan.gradYear}`);
}

/**
 * Build { semId → chronological index } for prereq ordering.
 *
 * "incoming" occupies index 0 — before every dated term — and it MUST be in
 * this map. `evalPrereqTree` reads a prerequisite's position as
 * `semIndex[placements[id]]` and treats `undefined` as **missing**, so a
 * semester absent from the index is not "early", it is "not in the plan at
 * all". Leaving `incoming` out therefore reported every prerequisite met by
 * transfer, AP or IB credit as a missing prerequisite over MCP, while the
 * browser — whose SEM_INDEX is built over the whole SEMESTERS array, incoming
 * included (`src/core/semGrid.js`) — reported the same plan clean.
 *
 * That divergence was one-sided in the worst direction: this module's own
 * `completedCourseIds` and the query adapter's `checkPrereqs` both already
 * count incoming credit as completed, so the plan was simultaneously told the
 * course was done and that its dependents were unsatisfiable.
 *
 * The dated terms are numbered from 1 for that reason; only the ORDER matters
 * to the evaluator (`fi < ti`), so the offset changes no other verdict.
 * See repeatInstances.js `buildTakesResolver` for the same rule stated from
 * the browser's side.
 */
export function buildSemIndex(plan) {
  const ids = new Set(
    Object.values(plan.placements ?? {}).filter(id => id && id !== "incoming")
  );
  // Guarded rather than assumed: `SEM_ID_RE` accepts "incoming", so a hostile
  // or malformed plan can name it here, and re-adding it would overwrite the
  // pinned 0 below.
  if (plan.currentSemId && plan.currentSemId !== "incoming") ids.add(plan.currentSemId);
  const sorted = [...ids].sort((a, b) => semSortKey(a) - semSortKey(b));
  const index  = { incoming: 0 };
  sorted.forEach((id, i) => { index[id] = i + 1; });
  return index;
}

/**
 * Course ids the student has completed: incoming credit plus everything
 * placed in a semester strictly before currentSemId. The same rule the
 * UI uses to split done (green) from planned (blue).
 */
export function completedCourseIds(plan) {
  const cur = plan.currentSemId ? semSortKey(plan.currentSemId) : Infinity;
  return Object.entries(plan.placements ?? {})
    .filter(([, semId]) => (semId === "incoming" || semSortKey(semId) < cur)
      && inCohortWindow(plan, semId)) // parked off-timeline ≠ completed history
    .map(([courseId]) => courseId);
}

// ── Violation checking ────────────────────────────────────────────

export function checkViolations(plan, courseMap) {
  const violations = [];
  const { placedOut = [] } = plan;
  // Timeline-scoped view: parked placements are neither validated nor able
  // to satisfy someone else's prereq/coreq — same as the UI.
  const placements = Object.fromEntries(
    Object.entries(plan.placements ?? {}).filter(([, sid]) => inCohortWindow(plan, sid))
  );
  const semIndex     = buildSemIndex({ ...plan, placements });
  const placedOutSet = new Set(placedOut);
  // A graduate plan asserts "graduate program admission", the OR alternative
  // to the undergraduate prereq chain on 209 courses (see prereqConditions.js).
  const conditions   = planConditions(plan);

  for (const [courseId, semId] of Object.entries(placements)) {
    if (semId === "incoming") continue;
    const course = courseMap[courseId];
    if (!course) continue;

    const ti = semIndex[semId] ?? 0;

    if (course.prereqs?.length) {
      const result = evalPrereqTree(course.prereqs, placements, semIndex, ti, placedOutSet, null, conditions);
      if (result === "missing") {
        violations.push({
          type: "prereq",
          courseId,
          message: `${courseId} is missing one or more prerequisites.`,
        });
      } else if (result === "order") {
        violations.push({
          type: "prereq",
          courseId,
          message: `${courseId} is placed before a required prerequisite.`,
        });
      }
    }

    if (course.coreqs?.length) {
      for (const cq of course.coreqs) {
        if (!cq?.subject || !cq?.number) continue;
        const cqId    = `${cq.subject.toUpperCase()}${cq.number}`;
        const cqSemId = placements[cqId];
        if (!cqSemId) {
          violations.push({
            type:    "coreq",
            courseId,
            message: `${courseId} requires corequisite ${cqId} to be in the same semester.`,
            related: [cqId],
          });
        } else if (cqSemId !== semId) {
          violations.push({
            type:    "coreq",
            courseId,
            message: `${courseId} and corequisite ${cqId} must be in the same semester.`,
            related: [cqId],
          });
        }
      }
    }
  }

  return violations;
}

/** Pin a program id to the catalog edition this plan's cohort follows. */
function pinToCohort(plan, programId) {
  if (!programId) return "";
  return withCatalogYear(programId, cohortCatalogYear(plan?.entSem, plan?.entYear));
}

// ── Action registry ───────────────────────────────────────────────
// One entry per action type: a mutator over the (cloned) plan that FIRST
// validates its arguments — returning an error string rejects the action
// (collected as `invalid` by applyChangeset) instead of silently applying
// garbage. Adding an action = adding one entry here (+ docs below) + a
// handler in the browser's applyMCPActions.

const asArray = (v) => (Array.isArray(v) ? v : []);
const SEM_ID_RE = /^(incoming|(fall|spring|spr|sumA|sumB)\d{4})$/;

const badCourse = (courseMap, id, field = "courseId") =>
  !id || typeof id !== "string" ? `${field} is required`
  // Repeat instances ("MUS1990#2" — later takes of a repeatable course)
  // validate through their base course.
  : courseMap && !courseMap[id] && !courseMap[baseId(id)] ? `Unknown course: ${id}`
  : null;
const badSem = (semId) =>
  !semId || typeof semId !== "string" || !SEM_ID_RE.test(semId)
    ? `Invalid semId: ${semId} (expected e.g. "fall2026", "spr2027", "sumA2027", or "incoming")`
    : null;

/**
 * Validate the course a work term says it registers.
 *
 * Absent is always fine and is the default: a work term with no `courseId`
 * records the experience and registers nothing, which is what the card does
 * when the student leaves the field empty.
 *
 * When present it must be a course the catalog marks as a work-experience
 * REGISTRATION (`c.coop`, stamped from coop-courses.json), and of the right
 * family. The UI cannot express either mistake — the picker only lists stamped
 * courses and is scoped by kind — so without this check MCP would be the one
 * way into a state the app itself refuses to create: a co-op registering
 * `MATH 2331`, or registering `COOP 3949 Internship Exchange`.
 *
 * The kind check is skipped when the type is not one the stamp can describe,
 * so a future block type is not rejected for a mismatch nobody defined.
 */
const KNOWN_KINDS = new Set(["coop", "intern"]);
const badRegistration = (courseMap, courseId, typeId) => {
  if (courseId == null || courseId === "") return null;
  if (typeof courseId !== "string") return "courseId must be a course id string, or null to clear";
  const c = courseMap?.[courseId];
  if (courseMap && !c) return `Unknown course: ${courseId}`;
  if (c && !c.coop) {
    return `${courseId} is not a work-experience registration — a work term can only register a `
      + `course like COOP 3945, ENCP 6964 or CS 6964. To take ${courseId} alongside the work term, `
      + `use ADD_COURSE.`;
  }
  const kind = c?.coop?.kind ?? "coop";
  if (c && KNOWN_KINDS.has(typeId) && kind !== typeId) {
    return `${courseId} is ${kind === "intern" ? "an internship" : "a co-op"} registration and cannot be `
      + `recorded by a '${typeId}' work term. Add the matching block type instead.`;
  }
  return null;
};

const APPLIERS = {
  ADD_COURSE: (plan, a, courseMap) => {
    const err = badCourse(courseMap, a.courseId) ?? badSem(a.semId);
    if (err) return err;
    // A work-experience course is RECORDED BY placing a work term, not by
    // being placed. Dropping the card instead gives a 0 SH phantom with no
    // EX, no co-op rendering, and a term the load calculation thinks is free
    // — and the block already grants this exact key. Refuse and redirect.
    if (courseMap?.[a.courseId]?.coop) {
      const kind = courseMap[a.courseId].coop.kind ?? "coop";
      return `${a.courseId} records a work term; it cannot be placed as a course. `
        + `Use ADD_WORK_TERM {typeId:'${kind}', semId, duration, courseId:'${a.courseId}'} instead — `
        + `courseId is what makes the work term satisfy the requirement asking for ${a.courseId}.`;
    }
    // Repeatable course already placed → this ADD is ANOTHER take under a
    // fresh instance id ("ID#2", "ID#3"…). The browser applier runs the same
    // resolveAddId over the same placements snapshot, so both sides assign
    // identical ids. Takes beyond the catalog's repeat limit are allowed —
    // NU Map trusts the user — and the UI flags them with the warn treatment.
    // A placed non-repeatable course keeps the relocate-on-add semantics.
    const course = courseMap?.[a.courseId];
    const addId = course ? resolveAddId(course, plan.placements, new Set(asArray(plan.placedOut))).id : a.courseId;
    plan.placements[addId] = a.semId;
    plan.placedOut = asArray(plan.placedOut).filter(id => id !== addId);
    plan.palette   = asArray(plan.palette).filter(id => id !== addId);
  },
  REMOVE_COURSE: (plan, a, courseMap) => {
    const err = badCourse(courseMap, a.courseId);
    if (err) return err;
    if (plan.placements[a.courseId] === undefined) return `${a.courseId} is not placed in the plan`;
    delete plan.placements[a.courseId];
  },
  MOVE_COURSE: (plan, a, courseMap) => {
    const err = badCourse(courseMap, a.courseId) ?? badSem(a.toSemId);
    if (err) return err;
    if (plan.placements[a.courseId] === undefined) return `${a.courseId} is not placed; use ADD_COURSE`;
    plan.placements[a.courseId] = a.toSemId;
  },

  ADD_PLACED_OUT: (plan, a, courseMap) => {
    const err = badCourse(courseMap, a.courseId);
    if (err) return err;
    if (!plan.placedOut.includes(a.courseId)) plan.placedOut.push(a.courseId);
    delete plan.placements[a.courseId];
  },
  REMOVE_PLACED_OUT: (plan, a) => {
    if (!plan.placedOut.includes(a.courseId)) return `${a.courseId} is not placed out`;
    plan.placedOut = plan.placedOut.filter(id => id !== a.courseId);
  },

  ADD_SUBSTITUTION: (plan, a, courseMap) => {
    const err = badCourse(courseMap, a.fromId, "fromId") ?? badCourse(courseMap, a.toId, "toId");
    if (err) return err;
    if (!plan.substitutions.some(s => s.from === a.fromId && s.to === a.toId))
      plan.substitutions.push({ from: a.fromId, to: a.toId });
  },
  REMOVE_SUBSTITUTION: (plan, a) => {
    if (!plan.substitutions.some(s => s.from === a.fromId && s.to === a.toId))
      return `No substitution ${a.fromId} → ${a.toId} exists`;
    plan.substitutions = plan.substitutions.filter(
      s => !(s.from === a.fromId && s.to === a.toId)
    );
  },

  ADD_WORK_TERM: (plan, a, courseMap) => {
    if (!a.typeId || typeof a.typeId !== "string") return "typeId is required (e.g. 'coop', 'intern')";
    if (badSem(a.semId)) return badSem(a.semId);
    if (typeof a.duration !== "number" || a.duration <= 0) return "duration (months, number) is required";
    const reg = badRegistration(courseMap, a.courseId, a.typeId);
    if (reg) return reg;
    const id = `wt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    plan.workExperience[id] = {
      typeId:   a.typeId,
      semId:    a.semId,
      duration: a.duration,
      ...(a.company       != null && { company:       a.company }),
      ...(a.companyDomain != null && { companyDomain: a.companyDomain }),
      ...(a.subline       != null && { subline:       a.subline }),
      // Absent means domestic — the default 147 of 152 co-op requirement
      // nodes accept. Only International Business discriminates on it.
      ...(a.abroad === true && { abroad: true }),
      // Absent means the student has not said which course this registers, so
      // it registers none. That is the correct default over MCP for the same
      // reason it is in the UI: an assistant that fills it in is asserting
      // something only the student knows.
      ...(a.courseId != null && a.courseId !== "" && { courseId: a.courseId }),
    };
  },
  REMOVE_WORK_TERM: (plan, a) => {
    if (!plan.workExperience[a.instanceId]) return `Unknown work term: ${a.instanceId} (ids are in the plan's workExperience)`;
    delete plan.workExperience[a.instanceId];
  },
  MOVE_WORK_TERM: (plan, a) => {
    if (!plan.workExperience[a.instanceId]) return `Unknown work term: ${a.instanceId}`;
    if (badSem(a.toSemId)) return badSem(a.toSemId);
    plan.workExperience[a.instanceId].semId = a.toSemId;
  },
  UPDATE_WORK_TERM: (plan, a, courseMap) => {
    const wt = plan.workExperience[a.instanceId];
    if (!wt) return `Unknown work term: ${a.instanceId}`;
    // Validated against the term's OWN type, not the one in the action — this
    // action cannot change the type, so a co-op block may never come to
    // register an internship course by editing it after the fact.
    if (a.courseId != null && a.courseId !== "") {
      const reg = badRegistration(courseMap, a.courseId, wt.typeId);
      if (reg) return reg;
    }
    if (a.company       != null) wt.company       = a.company;
    if (a.companyDomain != null) wt.companyDomain = a.companyDomain;
    if (a.subline       != null) wt.subline       = a.subline;
    if (a.abroad != null) { if (a.abroad) wt.abroad = true; else delete wt.abroad; }
    // null or "" clears it back to unrecorded, mirroring the card's field
    // going empty. Deleted rather than stored empty so the shape stays
    // "absent means none" and no share link carries a redundant key.
    if (a.courseId != null) { if (a.courseId === "") delete wt.courseId; else wt.courseId = a.courseId; }
  },

  // Program ids come from list_programs, which is a CATALOG tool with no
  // plan and so lists the newest catalog edition. A student follows the
  // edition they entered under, so pin the incoming id to their cohort's
  // year before storing it; if that exact edition isn't held, the loaders'
  // resolveInMap falls back to the closest one at or below it.
  SET_MAJOR:         (plan, a) => { plan.major         = pinToCohort(plan, a.programId); },
  SET_MAJOR2:        (plan, a) => { plan.major2        = pinToCohort(plan, a.programId); },
  SET_STUDENT_TYPE:  (plan, a) => {
    if (a.studentType !== "undergrad" && a.studentType !== "graduate")
      return `studentType must be "undergrad" or "graduate", got: ${a.studentType}`;
    plan.studentType = a.studentType;
    // Mirror the app: switching program trees clears program selections —
    // follow with SET_MAJOR/SET_CONCENTRATION in the SAME changeset (order
    // matters: this action first).
    plan.major = ""; plan.major2 = ""; plan.concentration = "";
  },
  SET_CONCENTRATION: (plan, a) => { plan.concentration = a.label ?? ""; },
  SET_MINOR1:        (plan, a) => { plan.minor1        = pinToCohort(plan, a.programId); },
  SET_MINOR2:        (plan, a) => { plan.minor2        = pinToCohort(plan, a.programId); },
  SET_BONUS_SH:      (plan, a) => {
    if (typeof a.amount !== "number" || a.amount < 0) return `amount must be a non-negative number, got: ${a.amount}`;
    plan.bonusSH = a.amount;
  },

  SET_SH_OVERRIDE: (plan, a, courseMap) => {
    const err = badCourse(courseMap, a.courseId);
    if (err) return err;
    if (a.value == null) { delete plan.shOverrides[a.courseId]; return; }
    const c = courseMap?.[a.courseId];
    if (c && !c.shMax) return `${a.courseId} has fixed credits (${c.sh} SH); credit overrides only apply to variable-credit courses`;
    if (typeof a.value !== "number") return "value must be a number (or null to reset)";
    if (c && (a.value < (c.shMin ?? c.sh) || a.value > c.shMax))
      return `${a.courseId} allows ${c.shMin ?? c.sh}–${c.shMax} SH, got: ${a.value}`;
    plan.shOverrides[a.courseId] = a.value;
  },
  SET_OFFERED_OVERRIDE: (plan, a, courseMap) => {
    const err = badCourse(courseMap, a.courseId);
    if (err) return err;
    if (!["fall", "spring", "sumA", "sumB"].includes(a.semTypeId))
      return `semTypeId must be one of fall|spring|sumA|sumB, got: ${a.semTypeId}`;
    plan.offeredOverrides[a.courseId] ??= {};
    if (a.status == null) delete plan.offeredOverrides[a.courseId][a.semTypeId];
    else plan.offeredOverrides[a.courseId][a.semTypeId] = !!a.status;
  },

  SET_ENTRY: (plan, a) => {
    if (!["fall", "spring"].includes(a.sem) || typeof a.year !== "number") return "sem (fall|spring) and year (number) are required";
    plan.entSem = a.sem; plan.entYear = a.year;
  },
  SET_GRADUATION: (plan, a) => {
    if (!["fall", "spring"].includes(a.sem) || typeof a.year !== "number") return "sem (fall|spring) and year (number) are required";
    plan.gradSem = a.sem; plan.gradYear = a.year;
  },
  SET_CURRENT_SEM: (plan, a) => {
    if (badSem(a.semId)) return badSem(a.semId);
    plan.currentSemId = a.semId;
  },

  STAR_COURSE: (plan, a) => {
    plan.starredIds = asArray(plan.starredIds);
    if (!plan.starredIds.includes(a.courseId)) plan.starredIds.push(a.courseId);
  },
  UNSTAR_COURSE: (plan, a) => {
    plan.starredIds = asArray(plan.starredIds).filter(id => id !== a.courseId);
  },
  ADD_TO_PALETTE: (plan, a) => {
    plan.palette = asArray(plan.palette);
    if (!plan.palette.includes(a.courseId) && plan.placements[a.courseId] === undefined)
      plan.palette.push(a.courseId);
  },
  REMOVE_FROM_PALETTE: (plan, a) => {
    plan.palette = asArray(plan.palette).filter(id => id !== a.courseId);
  },

  // Plan-management actions are no-ops in a dry-run (no multi-plan state
  // here); the browser executes them for real on APPLY.
  CREATE_PLAN: () => {},
  RENAME_PLAN: (plan, a) => {
    if (!a.name || typeof a.name !== "string") return "name is required";
    // Dry-run visualizes a rename of the ACTIVE plan; renames of other
    // plans apply for real but have nothing to show in the active view.
    if (!a.planId || !plan.planId || a.planId === plan.planId) plan.planName = a.name;
  },
  SWITCH_PLAN: () => {},
  DELETE_PLAN: () => {},
};

/** Action types this adapter can dry-run — advertised via get_meta capabilities. */
export const SUPPORTED_ACTIONS = Object.keys(APPLIERS);

/**
 * Per-action reference — surfaced through get_meta so the model composes
 * changesets from documentation instead of guessing argument shapes (the
 * classic failure: using ADD_SUBSTITUTION when ADD_PLACED_OUT was meant).
 */
export const ACTION_DOCS = {
  ADD_COURSE:           { args: "{courseId, semId}", use: "Place a course in a semester (semId like 'fall2026', 'spr2027', 'sumA2027', or 'incoming' for transfer/AP credit). If a REPEATABLE course (see get_course repeatable/repeatMax) is already placed, this adds ANOTHER take stored under an instance id like 'MUS1990#2'. Takes beyond repeatMax are allowed but flagged as over-limit in the app — warn the user before proposing one. Re-adding a placed non-repeatable course relocates it." },
  REMOVE_COURSE:        { args: "{courseId}", use: "Remove a placed course from the plan entirely. Extra takes of a repeatable course are removed by their instance id ('MUS1990#2' — see the plan's placements keys)." },
  MOVE_COURSE:          { args: "{courseId, toSemId}", use: "Move an already-placed course to a different semester (instance ids like 'MUS1990#2' move a specific take). Rejected if the course is not currently placed — use ADD_COURSE instead." },
  ADD_PLACED_OUT:       { args: "{courseId}", use: "Mark a course as placed out: it satisfies prerequisites but earns NO credit (e.g. waived via placement exam). NOT a substitution." },
  REMOVE_PLACED_OUT:    { args: "{courseId}", use: "Remove placed-out status." },
  ADD_SUBSTITUTION:     { args: "{fromId, toId}", use: "Course equivalence: placing fromId also satisfies requirements that ask for toId. Both remain real courses; credits count once. NOT for waivers — use ADD_PLACED_OUT for those." },
  REMOVE_SUBSTITUTION:  { args: "{fromId, toId}", use: "Remove a substitution pair. Rejected if that exact from→to pair does not exist (check the plan's substitutions list)." },
  ADD_WORK_TERM:        { args: "{typeId: 'coop'|'intern', semId, duration (months: coop 4|6, intern 2|4), company?, subline?, abroad?, courseId?}", use: "Add a co-op or internship starting at a semester. A work term satisfies a work-experience requirement ONLY when courseId names the course it registers (COOP 3945, ENCP 6964, CS 6964 …) — never place those as courses. Omit courseId unless the student said which one; the plan then records the work term and leaves the requirement unmet, which is correct. abroad is a note on the experience, not a course choice." },
  REMOVE_WORK_TERM:     { args: "{instanceId}", use: "Remove a work term (instance ids are the keys of the plan's workExperience)." },
  MOVE_WORK_TERM:       { args: "{instanceId, toSemId}", use: "Move a work term's starting semester." },
  UPDATE_WORK_TERM:     { args: "{instanceId, company?, companyDomain?, subline?, abroad?, courseId?}", use: "Edit a work term without moving it. courseId sets which work-experience course it registers; pass null or \"\" to clear it back to unrecorded." },
  SET_MAJOR:            { args: "{programId}", use: "Set the major (program ids from list_programs). Empty string clears." },
  SET_MAJOR2:           { args: "{programId}", use: "Set the second major (double major)." },
  SET_STUDENT_TYPE:     { args: "{studentType: 'undergrad'|'graduate'}", use: "Switch the plan's program tree. CLEARS major/major2/concentration — follow with SET_MAJOR (and SET_CONCENTRATION) in the same changeset, after this action." },
  SET_CONCENTRATION:    { args: "{label}", use: "Set the concentration by its EXACT title from get_program's concentrations list — do not paraphrase or translate it. Empty string clears." },
  SET_MINOR1:           { args: "{programId}", use: "Set the first minor." },
  SET_MINOR2:           { args: "{programId}", use: "Set the second minor." },
  SET_BONUS_SH:         { args: "{amount}", use: "Set general incoming credits (AP/transfer hours not tied to a course). amount must be a number, not a string. REPLACES the current value — read it first if adding to it." },
  SET_SH_OVERRIDE:      { args: "{courseId, value|null}", use: "Set credits for a VARIABLE-credit course. MOST courses have fixed credits and are rejected — only valid when get_course shows shMin < shMax, and value must be inside that range. null resets to the catalog default." },
  SET_OFFERED_OVERRIDE: { args: "{courseId, semTypeId: fall|spring|sumA|sumB, status: true|false|null}", use: "Force a course to show as offered/not-offered in a semester type. status must be a real boolean (not the string 'false'); null returns to automatic (history-based)." },
  SET_ENTRY:            { args: "{sem: 'fall'|'spring', year}", use: "Set the cohort entry term." },
  SET_GRADUATION:       { args: "{sem: 'fall'|'spring', year}", use: "Set the target graduation term." },
  SET_CURRENT_SEM:      { args: "{semId}", use: "Set which semester is 'now' (splits completed vs planned)." },
  STAR_COURSE:          { args: "{courseId}", use: "Star a course in the bank." },
  UNSTAR_COURSE:        { args: "{courseId}", use: "Remove a star." },
  ADD_TO_PALETTE:       { args: "{courseId}", use: "Put an unplaced course on the scratch pad." },
  REMOVE_FROM_PALETTE:  { args: "{courseId}", use: "Remove a course from the scratch pad." },
  CREATE_PLAN:          { args: "{name, cohort?}", use: "Create a new plan (applies in the app; dry-run is a no-op)." },
  RENAME_PLAN:          { args: "{planId, name}", use: "Rename a plan." },
  SWITCH_PLAN:          { args: "{planId}", use: "Switch the active plan (changes what the user sees)." },
  DELETE_PLAN:          { args: "{planId}", use: "Delete a plan. Requires confirmDestructive: true on the changeset." },
};

/** UI command types the server will relay — the browser ignores unknown ones. */
export const SUPPORTED_UI_COMMANDS = [
  "FOCUS_COURSE", "OPEN_SEARCH", "SET_BANK_TAB",
  "EXPORT_PDF", "EXPORT_JSON", "COPY_SHARE_LINK",
];

// ── Changeset applier ─────────────────────────────────────────────

/**
 * Apply a sequence of actions to a clone of `plan`.
 * Unknown action types are skipped and reported (tolerant-reader rule).
 * Returns { plan, appliedCount, unsupported, violations }.
 * Never mutates the original plan; never throws on unknown actions.
 */
export function applyChangeset(plan, actions, courseMap) {
  const copy = JSON.parse(JSON.stringify(plan));
  copy.placements       ??= {};
  copy.placedOut        ??= [];
  copy.substitutions    ??= [];
  copy.workExperience   ??= {};
  copy.shOverrides      ??= {};
  copy.offeredOverrides ??= {};

  let appliedCount = 0;
  const unsupported = [];
  const invalid = [];

  for (const [i, action] of actions.entries()) {
    const apply = APPLIERS[action?.type];
    if (!apply) { unsupported.push(String(action?.type)); continue; }
    const reason = apply(copy, action, courseMap);
    if (reason) { invalid.push({ index: i, type: action.type, reason }); continue; }
    appliedCount++;
  }

  const violations = checkViolations(copy, courseMap);
  return { plan: copy, appliedCount, unsupported, invalid, violations };
}
