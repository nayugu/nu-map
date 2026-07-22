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
// One entry per action type: a mutator over the (cloned) plan. Adding an
// action = adding one entry here + a handler in the browser's
// applyMCPActions. Both sides list their registry in capabilities.

const asArray = (v) => (Array.isArray(v) ? v : []);

const APPLIERS = {
  ADD_COURSE: (plan, a) => {
    plan.placements[a.courseId] = a.semId;
    plan.placedOut = asArray(plan.placedOut).filter(id => id !== a.courseId);
    plan.palette   = asArray(plan.palette).filter(id => id !== a.courseId);
  },
  REMOVE_COURSE: (plan, a) => { delete plan.placements[a.courseId]; },
  MOVE_COURSE:   (plan, a) => { plan.placements[a.courseId] = a.toSemId; },

  ADD_PLACED_OUT: (plan, a) => {
    if (!plan.placedOut.includes(a.courseId)) plan.placedOut.push(a.courseId);
    delete plan.placements[a.courseId];
  },
  REMOVE_PLACED_OUT: (plan, a) => {
    plan.placedOut = plan.placedOut.filter(id => id !== a.courseId);
  },

  ADD_SUBSTITUTION: (plan, a) => {
    if (!plan.substitutions.some(s => s.from === a.fromId && s.to === a.toId))
      plan.substitutions.push({ from: a.fromId, to: a.toId });
  },
  REMOVE_SUBSTITUTION: (plan, a) => {
    plan.substitutions = plan.substitutions.filter(
      s => !(s.from === a.fromId && s.to === a.toId)
    );
  },

  ADD_WORK_TERM: (plan, a) => {
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
  REMOVE_WORK_TERM: (plan, a) => { delete plan.workExperience[a.instanceId]; },
  MOVE_WORK_TERM: (plan, a) => {
    if (plan.workExperience[a.instanceId]) plan.workExperience[a.instanceId].semId = a.toSemId;
  },
  UPDATE_WORK_TERM: (plan, a) => {
    const wt = plan.workExperience[a.instanceId];
    if (wt) {
      if (a.company       != null) wt.company       = a.company;
      if (a.companyDomain != null) wt.companyDomain = a.companyDomain;
      if (a.subline       != null) wt.subline       = a.subline;
    }
  },

  SET_MAJOR:         (plan, a) => { plan.major         = a.programId; },
  SET_MAJOR2:        (plan, a) => { plan.major2        = a.programId; },
  SET_STUDENT_TYPE:  (plan, a) => { plan.studentType   = a.studentType; },
  SET_CONCENTRATION: (plan, a) => { plan.concentration = a.label; },
  SET_MINOR1:        (plan, a) => { plan.minor1        = a.programId; },
  SET_MINOR2:        (plan, a) => { plan.minor2        = a.programId; },
  SET_BONUS_SH:      (plan, a) => { plan.bonusSH       = a.amount; },

  SET_SH_OVERRIDE: (plan, a) => {
    if (a.value == null) delete plan.shOverrides[a.courseId];
    else plan.shOverrides[a.courseId] = a.value;
  },
  SET_OFFERED_OVERRIDE: (plan, a) => {
    plan.offeredOverrides[a.courseId] ??= {};
    if (a.status == null) delete plan.offeredOverrides[a.courseId][a.semTypeId];
    else plan.offeredOverrides[a.courseId][a.semTypeId] = a.status;
  },

  SET_ENTRY:       (plan, a) => { plan.entSem = a.sem;  plan.entYear = a.year; },
  SET_GRADUATION:  (plan, a) => { plan.gradSem = a.sem; plan.gradYear = a.year; },
  SET_CURRENT_SEM: (plan, a) => { plan.currentSemId = a.semId; },

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

  for (const action of actions) {
    const apply = APPLIERS[action?.type];
    if (!apply) { unsupported.push(String(action?.type)); continue; }
    apply(copy, action);
    appliedCount++;
  }

  const violations = checkViolations(copy, courseMap);
  return { plan: copy, appliedCount, unsupported, violations };
}
