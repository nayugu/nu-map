// ═══════════════════════════════════════════════════════════════════
// ADAPTER: mcp/plannerQueryAdapter  (Node.js — implements IPlannerQuery
// for external actors, primarily Claude via the MCP server)
//
// Institution-agnostic: imports only src/core. Everything institution-
// specific (calendar, attribute system, special terms, credit system,
// offering statistics, catalog data) is injected by the composition
// root (mcp-server/index.js), mirroring how the UI receives adapters
// through wire()/usePort().
//
// All methods are pure with respect to the plan: they take an explicit
// PlanContext argument. The transport layer supplies the live synced
// snapshot; tests supply fixtures.
// ═══════════════════════════════════════════════════════════════════

import { extractEdges } from "../../core/courseModel.js";
import { evalPrereqTree } from "../../core/prereqEval.js";
import {
  buildPlacedKeySet,
  allocateMajorWithElectives,
  allocateSections,
} from "../../core/gradRequirements.js";
import { buildCohortSemesters, deriveSemMaps } from "../../core/semGrid.js";
import { getSemSH, getOrderedCourses } from "../../core/planModel.js";
import { computeGrantedAttrs, resolveTermByDuration, termSpans } from "../../core/specialTermUtils.js";
import { applyChangeset, completedCourseIds, semSortKey } from "./plannerActionAdapter.js";

/**
 * @param {object} deps
 * @param {object} deps.catalog        loadCatalog() result: courses, courseMap, termDetails, subjectColleges, meta
 * @param {object} deps.programs      loadPrograms() result: programs, programData, resolveProgramId
 * @param {object} deps.calendar      ICalendar adapter
 * @param {object} deps.attributeSystem  IAttributeSystem adapter
 * @param {object} deps.specialTerms  ISpecialTerms adapter
 * @param {object} deps.creditSystem  ICreditSystem adapter
 * @param {object} deps.offeringStats offeringStats module (semTypeProb, offeringHistory, …)
 * @param {(course: object) => string|null} [deps.courseUrl]
 * @param {object[]} [deps.sources]   SourceInfo[] for getSources()
 */
export function createPlannerQuery(deps) {
  const {
    catalog, programs, calendar, attributeSystem, specialTerms,
    creditSystem, offeringStats, courseUrl = () => null, sources = [],
  } = deps;
  const { courseMap, courses, termDetails, subjectColleges } = catalog;
  const { programs: programList, programData, resolveProgramId } = programs;

  const canonId = (id) => String(id ?? "").toUpperCase().replace(/\s+/g, "");

  // ── Course level / trimming ─────────────────────────────────────

  function courseLevel(course) {
    const n = parseInt(String(course.number).match(/\d+/)?.[0] ?? "", 10);
    return Number.isFinite(n) && n >= 5000 ? "grad" : "undergrad";
  }

  /** Compact search-result record — full records come from getCourse. */
  function trimCourse(c) {
    return {
      id: c.id, code: c.code, title: c.title,
      sh: c.sh, ...(c.shMax != null && { shMin: c.shMin, shMax: c.shMax }),
      attributes: c.attributes, scheduleType: c.scheduleType,
      level: courseLevel(c),
      college: subjectColleges[c.subject] ?? null,
      ...(c.isCps && { isCps: true }),
      terms: c.terms,
    };
  }

  // ── Relationship graph (lazy) ───────────────────────────────────
  // unlocksIndex: prereqId → [{ courseId, concurrent? }] — the reverse
  // of the prereq edges, i.e. "what does taking X unlock".

  let _unlocksIndex = null;
  function unlocksIndex() {
    if (_unlocksIndex) return _unlocksIndex;
    _unlocksIndex = new Map();
    for (const c of courses) {
      for (const e of extractEdges(c.id, c.prereqs, c.coreqs)) {
        if (!_unlocksIndex.has(e.from)) _unlocksIndex.set(e.from, []);
        _unlocksIndex.get(e.from).push({
          courseId: e.to, type: e.type, ...(e.concurrent && { concurrent: true }),
        });
      }
    }
    return _unlocksIndex;
  }

  // ── Semester helpers ────────────────────────────────────────────

  function cohortSemesters(plan) {
    return buildCohortSemesters(
      plan.entSem ?? "fall", plan.entYear ?? new Date().getFullYear(),
      plan.gradSem ?? "spring", plan.gradYear ?? new Date().getFullYear() + 4,
      calendar
    );
  }

  /** Semester status function matching the UI's getSemStatus. */
  function semStatusOf(plan) {
    const { SEM_INDEX } = deriveSemMaps(cohortSemesters(plan));
    const curIdx = SEM_INDEX[plan.currentSemId];
    return (semId) => {
      const idx = SEM_INDEX[semId];
      if (idx != null && curIdx != null) {
        if (idx < curIdx) return "completed";
        if (idx === curIdx) return "inprogress";
        return "future";
      }
      // Semester outside the cohort window — compare chronologically.
      if (semId === "incoming") return "completed";
      const cur = plan.currentSemId ? semSortKey(plan.currentSemId) : Infinity;
      return semSortKey(semId) < cur ? "completed"
           : semSortKey(semId) === cur ? "inprogress" : "future";
    };
  }

  /** placements + virtual substitution targets (satisfaction only). */
  function effectivePlacements(plan) {
    const eff = { ...(plan.placements ?? {}) };
    for (const { from, to } of plan.substitutions ?? []) {
      if (eff[from] && !eff[to]) eff[to] = eff[from];
    }
    return eff;
  }

  /** Course map with the plan's per-course credit overrides applied. */
  function effectiveCourseMap(plan) {
    const overrides = plan.shOverrides ?? {};
    const ids = Object.keys(overrides).filter(id => courseMap[id]);
    if (!ids.length) return courseMap;
    const map = { ...courseMap };
    for (const id of ids) map[id] = { ...map[id], sh: overrides[id] };
    return map;
  }

  // ── Port methods ────────────────────────────────────────────────

  function searchCourses(opts = {}) {
    const {
      query, anyOf, subject, attributes, minSH, maxSH, term,
      level, college, campus, format, meetsOn,
      minNumber, maxNumber, limit = 20,
    } = opts;

    let results = courses;

    if (subject)
      results = results.filter(c => c.subject === subject.toUpperCase().trim());
    if (minNumber != null)
      results = results.filter(c => parseInt(c.number, 10) >= minNumber);
    if (maxNumber != null)
      results = results.filter(c => parseInt(c.number, 10) <= maxNumber);
    if (attributes?.length)
      results = results.filter(c => attributes.every(a => c.attributes.includes(a)));
    if (minSH != null) results = results.filter(c => c.sh >= minSH);
    if (maxSH != null) results = results.filter(c => c.sh <= maxSH);
    if (term)  results = results.filter(c => c.terms.includes(term));
    if (level) results = results.filter(c => courseLevel(c) === level);
    if (college)
      results = results.filter(c => (subjectColleges[c.subject] ?? "") === college);
    if (campus)
      results = results.filter(c => c.offering?.cmp?.some(x => x.toLowerCase().includes(campus.toLowerCase())));
    if (format)
      results = results.filter(c => c.offering?.fmt?.some(x => x.toLowerCase().includes(format.toLowerCase())));
    if (meetsOn?.length) {
      // Keep courses whose dominant meeting pattern fits inside the given
      // days (or runs async). Courses without pattern data are excluded —
      // the filter is an assertion about schedule, not a guess.
      const allowed = new Set(meetsOn.map(d => d.toUpperCase()));
      results = results.filter(c => {
        const top = c.offering?.pat?.[0]?.[0];
        if (!top) return false;
        if (top === "async") return true;
        return [...top].every(d => allowed.has(d));
      });
    }

    // Free-text scoring. `query` is a single term; `anyOf` is OR across
    // several terms (synonym fan-out for concept searches like "building"
    // / "construction" / "architecture") — a course keeps its best score.
    const textTerms = anyOf?.length ? anyOf : query ? [query] : null;
    if (textTerms) {
      const qs = textTerms.map(t => String(t).toLowerCase()).filter(Boolean);
      results = results
        .map(c => {
          const idL = c.id.toLowerCase(), codeL = c.code.toLowerCase(), titleL = c.title.toLowerCase();
          let score = 0;
          for (const q of qs) {
            let s = 0;
            if (idL === q || codeL === q)                          s = 4;
            else if (idL.startsWith(q) || codeL.startsWith(q))     s = 3;
            else if (titleL.startsWith(q))                         s = 2;
            else if (idL.includes(q) || codeL.includes(q) ||
                     titleL.includes(q) || c.desc.toLowerCase().includes(q)) s = 1;
            if (s > score) score = s;
          }
          return score > 0 ? { c, score } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .map(x => x.c);
    }

    return results.slice(0, limit).map(trimCourse);
  }

  /**
   * Full course record with opt-in facets.
   * include: "offerings" | "patterns" | "relationships" | "links"
   * plan (optional) supplies the user's offered-in overrides for the
   * effective offered/not-offered state.
   */
  function getCourse(courseId, include = [], plan = null) {
    const id = canonId(courseId);
    const course = courseMap[id];
    if (!course) return null;

    const { offering, ...base } = course;
    const out = { ...base, level: courseLevel(course), college: subjectColleges[course.subject] ?? null };

    if (include.includes("offerings")) {
      out.offerings = {
        history:     offeringStats.offeringHistory(course),
        bySemesterType: offeringStats.semTypeSummary(course, plan?.offeredOverrides?.[id]),
      };
    }
    if (include.includes("patterns")) {
      out.schedule = offeringStats.scheduleProfile(course);
      out.scheduleByTerm = termDetails[id] ?? null;
    }
    if (include.includes("relationships")) {
      out.relationships = {
        unlocks: unlocksIndex().get(id) ?? [],
        coreqs:  (course.coreqs ?? [])
          .filter(r => r?.subject && r?.number)
          .map(r => `${r.subject.toUpperCase()}${r.number}`),
      };
    }
    if (include.includes("links")) {
      out.catalogUrl = courseUrl(course);
    }
    return out;
  }

  function getOfferedIn(courseId) {
    const course = courseMap[canonId(courseId)];
    if (!course) return [];
    const labelOf = Object.fromEntries(
      calendar.getSemesterTypes().map(st => [st.id, st.label])
    );
    return offeringStats.offeringHistory(course).map(e => ({
      ...e,
      label: `${labelOf[e.semTypeId] ?? e.semTypeId} ${e.year}`,
    }));
  }

  function listPrograms({ type, level, college, year, query } = {}) {
    let list = programList;
    if (type && type !== "all")   list = list.filter(p => p.type === type);
    if (level && level !== "all") list = list.filter(p => p.level === level);
    if (college)                  list = list.filter(p => p.college === college);
    if (year)                     list = list.filter(p => p.year === year);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(p => p.label.toLowerCase().includes(q));
    }
    return list;
  }

  function getProgram(programId, include = ["tree", "concentrations"]) {
    const id = resolveProgramId(programId);
    const json = id ? programData.get(id) : null;
    if (!json) return null;
    const option = programList.find(p => p.id === id) ?? { id };
    const out = { ...option, resolvedFrom: programId !== id ? programId : undefined };
    if (include.includes("tree")) out.requirementSections = json.requirementSections ?? [];
    if (include.includes("concentrations")) {
      out.concentrations = {
        required: (json.concentrations?.minOptions ?? 0) > 0,
        options:  (json.concentrations?.concentrationOptions ?? []).map(c => c.title),
      };
    }
    return out;
  }

  /** Tag every satisfied requirement node completed vs planned (exportReport's tri-state). */
  function annotateStatus(node, doneSet) {
    if (!node || typeof node !== "object") return node;
    const out = { ...node };
    if (out.key !== undefined) {
      out.status = !out.sat ? "missing" : doneSet.has(out.key) ? "completed" : "planned";
    }
    for (const k of ["children", "courses", "requirements"]) {
      if (Array.isArray(out[k])) out[k] = out[k].map(n => annotateStatus(n, doneSet));
    }
    if (Array.isArray(out.groups)) {
      out.groups = out.groups.map(g => ({
        ...g,
        children: (g.children ?? []).map(n => annotateStatus(n, doneSet)),
      }));
    }
    return out;
  }

  /**
   * Audit a plan against a program, faithfully reproducing the panel:
   * substitution virtuals, one-course-used-once allocation, General
   * Electives, completed-vs-planned split, and — when the program has
   * concentrations — the selected concentration allocated against the
   * major's shared used-set.
   */
  function auditRequirements(programId, plan, { concentration } = {}) {
    const id = resolveProgramId(programId);
    const majorJson = id ? programData.get(id) : null;
    if (!majorJson) {
      return { error: `Program not found: ${programId}. Call list_programs for valid ids.` };
    }

    const placements   = plan.placements ?? {};
    const placedOutSet = new Set(plan.placedOut ?? []);
    const eff          = effectivePlacements(plan);
    const status       = semStatusOf(plan);

    const placedSet     = buildPlacedKeySet(eff, placedOutSet, courseMap);
    const realPlacedSet = buildPlacedKeySet(placements, placedOutSet, courseMap);
    const donePlacements = Object.fromEntries(
      Object.entries(eff).filter(([, semId]) => status(semId) === "completed")
    );
    const doneSet = buildPlacedKeySet(donePlacements, placedOutSet, courseMap);

    const { sections, generalElectives, allocatedSet } =
      allocateMajorWithElectives(majorJson, placedSet, courseMap, doneSet, realPlacedSet);
    let results = [...sections, generalElectives];

    const conc = concentration ?? plan.concentration ?? "";
    let concentrationApplied = null;
    if (conc && majorJson.concentrations) {
      const concSection = majorJson.concentrations.concentrationOptions
        .find(c => c.title === conc);
      if (concSection) {
        results = [...results, ...allocateSections([concSection], placedSet, allocatedSet, courseMap)];
        concentrationApplied = conc;
      }
    }

    return {
      programId: id,
      label:     majorJson.name ?? id,
      totalCreditsRequired: majorJson.totalCreditsRequired ?? null,
      concentrationApplied,
      concentrationRequired: (majorJson.concentrations?.minOptions ?? 0) > 0 && !concentrationApplied,
      sections: results.map(s => annotateStatus(s, doneSet)),
    };
  }

  /** The semester-grid vocabulary: every valid semId with label, status, capacity. */
  function getSemesters(plan) {
    const status = semStatusOf(plan);
    return cohortSemesters(plan).map(s => ({
      id: s.id, label: s.label, sub: s.sub, type: s.type,
      semTypeId: s.semTypeId, weight: s.weight, maxSlots: s.maxSlots,
      status: status(s.id),
    }));
  }

  /** The per-semester schedule exactly as the grid renders it. */
  function getSchedule(plan) {
    const map     = effectiveCourseMap(plan);
    const status  = semStatusOf(plan);
    const sems    = cohortSemesters(plan);
    const { SEM_NEXT } = deriveSemMaps(sems);
    const shMax   = creditSystem.getSemesterMax(plan.studentType);
    const shMin   = creditSystem.getFullTimeMin(plan.studentType);
    const types   = Object.fromEntries(specialTerms.getTypes().map(t => [t.id, t]));

    // Work-term blocks by starting semester, with span continuation.
    const workBySem = {};
    for (const [instanceId, wt] of Object.entries(plan.workExperience ?? {})) {
      const type = types[wt.typeId];
      const dur  = type ? resolveTermByDuration(type.durations, wt.duration) : null;
      const semW = sems.find(s => s.id === wt.semId)?.weight ?? 1;
      const spans = dur ? termSpans(dur.weight, semW) : false;
      (workBySem[wt.semId] ??= []).push({
        instanceId,
        typeId:   wt.typeId,
        label:    type?.label ?? wt.typeId,
        duration: wt.duration,
        company:  wt.company ?? null,
        subline:  wt.subline ?? null,
        spansInto: spans ? (SEM_NEXT[wt.semId] ?? null) : null,
      });
    }

    return sems.map(sem => {
      const courseIds = getOrderedCourses(sem.id, plan.placements ?? {}, plan.semOrders ?? {}, map);
      const sh = getSemSH(sem.id, plan.placements ?? {}, map);
      return {
        semId: sem.id,
        label: sem.label,
        status: status(sem.id),
        courses: courseIds.map(id => ({
          id, code: map[id]?.code ?? id, title: map[id]?.title ?? "", sh: map[id]?.sh ?? 4,
        })),
        totalSH: sh,
        overMax: sem.weight === 1 && sh > shMax,
        underFullTime: sem.weight === 1 && sem.type !== "special" && sh > 0 && sh < shMin,
        workTerms: workBySem[sem.id] ?? [],
      };
    });
  }

  function getNUPathCoverage(plan) {
    const placements = plan.placements ?? {};
    const granted = computeGrantedAttrs(plan.workExperience ?? {}, specialTerms.getTypes());
    const covered = attributeSystem.getCoverage(placements, courseMap, granted);
    const labels  = Object.fromEntries(attributeSystem.getAttributes().map(a => [a.code, a.label]));
    const grantsByCode = {};
    for (const [instanceId, wt] of Object.entries(plan.workExperience ?? {})) {
      const type = specialTerms.getTypes().find(t => t.id === wt.typeId);
      for (const code of type?.attributeGrants ?? []) {
        if (wt.semId) (grantsByCode[code] ??= []).push(instanceId);
      }
    }
    return attributeSystem.getGridCodes().map(code => ({
      code,
      label:     labels[code] ?? code,
      satisfied: covered.has(code),
      satisfiedBy: [
        ...Object.keys(placements).filter(id => (courseMap[id]?.attributes ?? []).includes(code)),
        ...(grantsByCode[code] ?? []),
      ],
    }));
  }

  function checkPrereqs(courseId, completedIds = null, plan = null) {
    const id = canonId(courseId);
    const course = courseMap[id];
    if (!course) {
      return { satisfied: false, missing: [], concurrent: [], error: `Course not found: ${id}` };
    }

    let completed = completedIds;
    if (!completed && plan) {
      completed = [...completedCourseIds(plan), ...(plan.placedOut ?? [])];
    }
    completed = (completed ?? []).map(canonId);

    if (!course.prereqs?.length) return { satisfied: true, missing: [], concurrent: [] };

    const fakePlacements = {};
    for (const cid of completed) fakePlacements[cid] = "s0";
    fakePlacements[id] = "s1";
    const result = evalPrereqTree(course.prereqs, fakePlacements, { s0: 0, s1: 1 }, 1);

    const missing = [], concurrent = [];
    if (result !== "satisfied") {
      (function collect(tree) {
        if (!tree) return;
        for (const tok of tree) {
          if (Array.isArray(tok)) { collect(tok); continue; }
          if (tok?.subject && tok?.number) {
            const cid = `${tok.subject.toUpperCase()}${tok.number}`;
            if (!fakePlacements[cid]) (tok.concurrent ? concurrent : missing).push(cid);
          }
        }
      })(course.prereqs);
    }

    return {
      satisfied: result === "satisfied",
      missing:    [...new Set(missing)],
      concurrent: [...new Set(concurrent)],
    };
  }

  function validateChangeset(actions, plan) {
    const { plan: resultingPlan, appliedCount, unsupported, invalid, violations } =
      applyChangeset(plan, actions, courseMap);
    return {
      valid: violations.length === 0 && unsupported.length === 0 && invalid.length === 0,
      violations,
      unsupported,
      invalid,
      appliedCount,
      totalCount: actions.length,
      resultingPlan,
    };
  }

  function getSources() { return sources; }

  return {
    searchCourses, getCourse, getOfferedIn,
    listPrograms, getProgram, auditRequirements,
    getSemesters, getSchedule, getNUPathCoverage,
    checkPrereqs, validateChangeset, getSources,
    meta: catalog.meta,
  };
}
