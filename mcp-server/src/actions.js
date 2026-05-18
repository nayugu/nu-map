// Pure action applier — used by validate_changeset for dry-run previews.
// Mutates a deep-cloned PlanContext; never touches live plan state.

import { evalPrereqTree } from "../../src/core/prereqEval.js";

// ── Semester ordering ─────────────────────────────────────────────

const MONTH_OF = { spring: 1, sumA: 5, sumB: 7, fall: 9 };

function parseSemId(semId) {
  const m = String(semId).match(/^(fall|spring|spr|sumA|sumB)(\d{4})$/);
  if (!m) return null;
  const semType = m[1] === "spr" ? "spring" : m[1];
  return { semType, year: parseInt(m[2], 10) };
}

function semSortKey(semId) {
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

// ── Violation checking ────────────────────────────────────────────

export function checkViolations(plan, courseMap) {
  const violations = [];
  const { placements = {}, placedOut = [] } = plan;
  const semIndex    = buildSemIndex(plan);
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

// ── Single-action applier ─────────────────────────────────────────

/** Apply one action to a plan (mutates in place). Returns { error? }. */
export function applyAction(plan, action) {
  const pl   = plan.placements     ??= {};
  const po   = plan.placedOut      ??= [];
  const subs = plan.substitutions  ??= [];
  const we   = plan.workExperience ??= {};
  const sho  = plan.shOverrides    ??= {};
  const oo   = plan.offeredOverrides ??= {};

  switch (action.type) {

    case "ADD_COURSE":
      pl[action.courseId] = action.semId;
      plan.placedOut = po.filter(id => id !== action.courseId);
      break;

    case "REMOVE_COURSE":
      delete pl[action.courseId];
      break;

    case "MOVE_COURSE":
      pl[action.courseId] = action.toSemId;
      break;

    case "ADD_PLACED_OUT":
      if (!po.includes(action.courseId)) po.push(action.courseId);
      delete pl[action.courseId];
      break;

    case "REMOVE_PLACED_OUT":
      plan.placedOut = po.filter(id => id !== action.courseId);
      break;

    case "ADD_SUBSTITUTION":
      if (!subs.some(s => s.from === action.fromId && s.to === action.toId))
        subs.push({ from: action.fromId, to: action.toId });
      break;

    case "REMOVE_SUBSTITUTION":
      plan.substitutions = subs.filter(
        s => !(s.from === action.fromId && s.to === action.toId)
      );
      break;

    case "ADD_WORK_TERM": {
      const id = `wt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      we[id] = {
        typeId:   action.typeId,
        semId:    action.semId,
        duration: action.duration,
        ...(action.company       != null && { company:       action.company }),
        ...(action.companyDomain != null && { companyDomain: action.companyDomain }),
        ...(action.subline       != null && { subline:       action.subline }),
      };
      break;
    }

    case "REMOVE_WORK_TERM":
      delete we[action.instanceId];
      break;

    case "MOVE_WORK_TERM":
      if (we[action.instanceId]) we[action.instanceId].semId = action.toSemId;
      break;

    case "UPDATE_WORK_TERM": {
      const wt = we[action.instanceId];
      if (wt) {
        if (action.company       != null) wt.company       = action.company;
        if (action.companyDomain != null) wt.companyDomain = action.companyDomain;
        if (action.subline       != null) wt.subline       = action.subline;
      }
      break;
    }

    case "SET_MAJOR":         plan.major         = action.programId; break;
    case "SET_CONCENTRATION": plan.concentration  = action.label;     break;
    case "SET_MINOR1":        plan.minor1         = action.programId; break;
    case "SET_MINOR2":        plan.minor2         = action.programId; break;
    case "SET_BONUS_SH":      plan.bonusSH        = action.amount;    break;

    case "SET_SH_OVERRIDE":
      if (action.value == null) delete sho[action.courseId];
      else sho[action.courseId] = action.value;
      break;

    case "SET_OFFERED_OVERRIDE":
      oo[action.courseId] ??= {};
      if (action.status == null) delete oo[action.courseId][action.semTypeId];
      else oo[action.courseId][action.semTypeId] = action.status;
      break;

    case "SET_ENTRY":
      plan.entSem  = action.sem;
      plan.entYear = action.year;
      break;

    case "SET_GRADUATION":
      plan.gradSem  = action.sem;
      plan.gradYear = action.year;
      break;

    case "SET_CURRENT_SEM":
      plan.currentSemId = action.semId;
      break;

    // Plan-management actions are no-ops in a dry-run (no multi-plan state here)
    case "CREATE_PLAN":
    case "RENAME_PLAN":
    case "SWITCH_PLAN":
    case "DELETE_PLAN":
      break;

    default:
      return { error: `Unknown action type: ${action.type}` };
  }
  return {};
}

// ── Changeset applier ─────────────────────────────────────────────

/**
 * Apply a sequence of actions to a clone of `plan`.
 * Returns { plan, appliedCount, violations, error? }.
 * Never mutates the original plan.
 */
export function applyChangeset(plan, actions, courseMap) {
  const copy = JSON.parse(JSON.stringify(plan));
  let appliedCount = 0;

  for (const action of actions) {
    const { error } = applyAction(copy, action);
    if (error) return { plan: copy, appliedCount, violations: [], error };
    appliedCount++;
  }

  const violations = checkViolations(copy, courseMap);
  return { plan: copy, appliedCount, violations };
}
