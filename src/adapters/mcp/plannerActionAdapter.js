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

/** Build { semId → chronological index } for prereq ordering. */
export function buildSemIndex(plan) {
  const ids = new Set(
    Object.values(plan.placements ?? {}).filter(id => id && id !== "incoming")
  );
  if (plan.currentSemId) ids.add(plan.currentSemId);
  const sorted = [...ids].sort((a, b) => semSortKey(a) - semSortKey(b));
  const index  = {};
  sorted.forEach((id, i) => { index[id] = i; });
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
    .filter(([, semId]) => semId === "incoming" || semSortKey(semId) < cur)
    .map(([courseId]) => courseId);
}

// ── Violation checking ────────────────────────────────────────────

export function checkViolations(plan, courseMap) {
  const violations = [];
  const { placements = {}, placedOut = [] } = plan;
  const semIndex     = buildSemIndex(plan);
  const placedOutSet = new Set(placedOut);

  for (const [courseId, semId] of Object.entries(placements)) {
    if (semId === "incoming") continue;
    const course = courseMap[courseId];
    if (!course) continue;

    const ti = semIndex[semId] ?? 0;

    if (course.prereqs?.length) {
      const result = evalPrereqTree(course.prereqs, placements, semIndex, ti, placedOutSet);
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
  : courseMap && !courseMap[id] ? `Unknown course: ${id}`
  : null;
const badSem = (semId) =>
  !semId || typeof semId !== "string" || !SEM_ID_RE.test(semId)
    ? `Invalid semId: ${semId} (expected e.g. "fall2026", "spr2027", "sumA2027", or "incoming")`
    : null;

const APPLIERS = {
  ADD_COURSE: (plan, a, courseMap) => {
    const err = badCourse(courseMap, a.courseId) ?? badSem(a.semId);
    if (err) return err;
    plan.placements[a.courseId] = a.semId;
    plan.placedOut = asArray(plan.placedOut).filter(id => id !== a.courseId);
    plan.palette   = asArray(plan.palette).filter(id => id !== a.courseId);
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
    if (plan.placements[a.courseId] === undefined) return `${a.courseId} is not placed — use ADD_COURSE`;
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

  ADD_WORK_TERM: (plan, a) => {
    if (!a.typeId || typeof a.typeId !== "string") return "typeId is required (e.g. 'coop', 'intern')";
    if (badSem(a.semId)) return badSem(a.semId);
    if (typeof a.duration !== "number" || a.duration <= 0) return "duration (months, number) is required";
    const id = `wt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    plan.workExperience[id] = {
      typeId:   a.typeId,
      semId:    a.semId,
      duration: a.duration,
      ...(a.company       != null && { company:       a.company }),
      ...(a.companyDomain != null && { companyDomain: a.companyDomain }),
      ...(a.subline       != null && { subline:       a.subline }),
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
  UPDATE_WORK_TERM: (plan, a) => {
    const wt = plan.workExperience[a.instanceId];
    if (!wt) return `Unknown work term: ${a.instanceId}`;
    if (a.company       != null) wt.company       = a.company;
    if (a.companyDomain != null) wt.companyDomain = a.companyDomain;
    if (a.subline       != null) wt.subline       = a.subline;
  },

  SET_MAJOR:         (plan, a) => { plan.major         = a.programId ?? ""; },
  SET_MAJOR2:        (plan, a) => { plan.major2        = a.programId ?? ""; },
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
  SET_MINOR1:        (plan, a) => { plan.minor1        = a.programId ?? ""; },
  SET_MINOR2:        (plan, a) => { plan.minor2        = a.programId ?? ""; },
  SET_BONUS_SH:      (plan, a) => {
    if (typeof a.amount !== "number" || a.amount < 0) return `amount must be a non-negative number, got: ${a.amount}`;
    plan.bonusSH = a.amount;
  },

  SET_SH_OVERRIDE: (plan, a, courseMap) => {
    const err = badCourse(courseMap, a.courseId);
    if (err) return err;
    if (a.value == null) { delete plan.shOverrides[a.courseId]; return; }
    const c = courseMap?.[a.courseId];
    if (c && !c.shMax) return `${a.courseId} has fixed credits (${c.sh} SH) — credit overrides only apply to variable-credit courses`;
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
  RENAME_PLAN: () => {},
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
  ADD_COURSE:           { args: "{courseId, semId}", use: "Place a course in a semester (semId like 'fall2026', 'spr2027', 'sumA2027', or 'incoming' for transfer/AP credit)." },
  REMOVE_COURSE:        { args: "{courseId}", use: "Remove a placed course from the plan entirely." },
  MOVE_COURSE:          { args: "{courseId, toSemId}", use: "Move an already-placed course to a different semester." },
  ADD_PLACED_OUT:       { args: "{courseId}", use: "Mark a course as placed out: it satisfies prerequisites but earns NO credit (e.g. waived via placement exam). NOT a substitution." },
  REMOVE_PLACED_OUT:    { args: "{courseId}", use: "Remove placed-out status." },
  ADD_SUBSTITUTION:     { args: "{fromId, toId}", use: "Course equivalence: placing fromId also satisfies requirements that ask for toId. Both remain real courses; credits count once. NOT for waivers — use ADD_PLACED_OUT for those." },
  REMOVE_SUBSTITUTION:  { args: "{fromId, toId}", use: "Remove a substitution pair." },
  ADD_WORK_TERM:        { args: "{typeId: 'coop'|'intern', semId, duration (months: coop 4|6, intern 2|4), company?, subline?}", use: "Add a co-op or internship starting at a semester." },
  REMOVE_WORK_TERM:     { args: "{instanceId}", use: "Remove a work term (instance ids are the keys of the plan's workExperience)." },
  MOVE_WORK_TERM:       { args: "{instanceId, toSemId}", use: "Move a work term's starting semester." },
  UPDATE_WORK_TERM:     { args: "{instanceId, company?, companyDomain?, subline?}", use: "Edit a work term's company/role without moving it." },
  SET_MAJOR:            { args: "{programId}", use: "Set the major (program ids from list_programs). Empty string clears." },
  SET_MAJOR2:           { args: "{programId}", use: "Set the second major (double major)." },
  SET_STUDENT_TYPE:     { args: "{studentType: 'undergrad'|'graduate'}", use: "Switch the plan's program tree. CLEARS major/major2/concentration — follow with SET_MAJOR (and SET_CONCENTRATION) in the same changeset, after this action." },
  SET_CONCENTRATION:    { args: "{label}", use: "Set the concentration by its title (see get_program concentrations). Empty string clears." },
  SET_MINOR1:           { args: "{programId}", use: "Set the first minor." },
  SET_MINOR2:           { args: "{programId}", use: "Set the second minor." },
  SET_BONUS_SH:         { args: "{amount}", use: "Set general incoming credits (AP/transfer hours not tied to a course)." },
  SET_SH_OVERRIDE:      { args: "{courseId, value|null}", use: "Set credits for a VARIABLE-credit course only (course must have a credit range; check shMin/shMax). null resets." },
  SET_OFFERED_OVERRIDE: { args: "{courseId, semTypeId: fall|spring|sumA|sumB, status: true|false|null}", use: "Force a course to show as offered/not-offered in a semester type. null returns to automatic (history-based)." },
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
