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
import { resolveConcentration } from "../../core/concentrationResolve.js";
import { buildCheckRows, detailText } from "../../core/verificationRows.js";
import { evalPrereqTree } from "../../core/prereqEval.js";
import { planConditions, collectConditions } from "../../core/prereqConditions.js";
import {
  buildPlacedKeySet,
  allocateMajorSections,
  allocateSections,
  collectCandidateKeys,
  calculateGeneralElectives,
} from "../../core/gradRequirements.js";
import { baseId } from "../../core/repeatInstances.js";
import { STANDING_NAMES } from "../../core/classStanding.js";
import { buildCohortSemesters, deriveSemMaps } from "../../core/semGrid.js";
import { getSemSH, getOrderedCourses, filterInTimeline } from "../../core/planModel.js";
import { isOverCap } from "../../core/creditLoad.js";
import { computeGrantedAttrs, workTermGrants, resolveTermByDuration, termSpans } from "../../core/specialTermUtils.js";
import { applyChangeset, completedCourseIds } from "./plannerActionAdapter.js";

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

  /** "202630" → "Spring 2026" via the calendar's display names. */
  const termLabel = (code) => {
    const stId = calendar.decodeTermCode?.(code);
    const yr   = calendar.getTermCodeYear?.(code);
    const st   = calendar.getSemesterTypes().find(s => s.id === stId);
    return st && yr != null ? `${st.altLabel ?? st.label} ${yr}` : code;
  };

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
      ...(c.repeatable && {
        repeatable: true,
        ...(c.repeatMax   != null && { repeatMax:   c.repeatMax }),
        ...(c.repeatMaxSH != null && { repeatMaxSH: c.repeatMaxSH }),
      }),
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
      // Outside the cohort window — aligned with the UI's getSemStatus:
      // parked placements are kept in state but never count as history.
      if (semId === "incoming") return "completed";
      return "future";
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
      minNumber, maxNumber, noPrereqs, unlockedBy, prereqsMetBy, studentType,
      scheduleType, excludeIds, instructor, includeInstructors, sortBy, limit = 20,
    } = opts;

    let results = courses;

    // Diacritic- and case-insensitive name folding ("garcia" finds "García").
    const fold = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const instructorQ = instructor ? fold(instructor) : null;

    if (instructorQ) {
      // Match against the per-semester-type instructor shares (recorded
      // history, primary instructors). Combine with `term` to ask "what
      // does Aloupis teach in the fall".
      results = results.filter(c => {
        const prof = c.offering?.prof;
        if (!prof) return false;
        const types = term ? [term] : Object.keys(prof);
        return types.some(t => (prof[t] ?? []).some(([name]) => fold(name).includes(instructorQ)));
      });
    }

    if (excludeIds?.length) {
      const ex = new Set(excludeIds.map(canonId));
      results = results.filter(c => !ex.has(c.id));
    }
    if (scheduleType)
      results = results.filter(c => (c.scheduleType ?? "").toLowerCase().includes(scheduleType.toLowerCase()));
    if (noPrereqs)
      results = results.filter(c => !c.prereqs?.length);
    if (unlockedBy) {
      const target = canonId(unlockedBy);
      const references = (tree) => (tree ?? []).some(tok =>
        Array.isArray(tok) ? references(tok)
        : tok?.subject && tok?.number && `${tok.subject.toUpperCase()}${tok.number}` === target
      );
      results = results.filter(c => references(c.prereqs));
    }
    if (prereqsMetBy)
      // studentType: "graduate" keeps the grad courses whose only unmet
      // branch is "graduate program admission" — without it, "what can I
      // take" silently drops most 5000-level courses for a grad student.
      results = results.filter(c => checkPrereqs(c.id, prereqsMetBy, null, studentType).satisfied);

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

    if (sortBy === "enrollment") {
      // Most-taken first: total recorded enrolment (recent terms only —
      // the offering summary window). Courses with no data sink to the end.
      const enr = (c) => Object.values(c.offering?.e ?? {}).reduce((s, v) => s + v, 0);
      results = [...results].sort((a, b) => enr(b) - enr(a));
    } else if (sortBy === "number") {
      results = [...results].sort((a, b) =>
        a.subject === b.subject
          ? parseInt(a.number, 10) - parseInt(b.number, 10)
          : a.subject.localeCompare(b.subject));
    }

    return results.slice(0, limit).map(c => {
      const out = trimCourse(c);
      // Opt-in: attach the per-semester-type instructor shares to every
      // result ("find X and tell me who teaches them") — off by default
      // so broad surveys stay compact.
      if (includeInstructors && c.offering?.prof) out.instructors = c.offering.prof;
      // When searching BY instructor, ride the matched person's data along:
      // `share` = their average % of enrolment per semester type (whose
      // course is it), `taught` = the actual terms they taught it, newest
      // first (the when-to-catch-them evidence — regularity beats shares
      // for predicting the future).
      if (instructorQ) {
        const matched = {};   // name → { share: {semType: pct}, taught: [labels] }
        for (const [t, list] of Object.entries(c.offering?.prof ?? {})) {
          for (const [name, pct] of list) {
            if (fold(name).includes(instructorQ)) ((matched[name] ??= { share: {}, taught: [] }).share[t] = pct);
          }
        }
        for (const [code, d] of Object.entries(termDetails[c.id] ?? {}).sort((a, b) => Number(b[0]) - Number(a[0]))) {
          for (const [name] of d.prof ?? []) {
            if (fold(name).includes(instructorQ) && matched[name]) matched[name].taught.push(termLabel(code));
          }
        }
        if (Object.keys(matched).length) out.instructorMatch = matched;
      }
      return out;
    });
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

    // Class standing is a planning FACT, not an offering statistic, so it is
    // unconditional rather than behind include:["offerings"] — a model advising on
    // when to take a capstone needs it whether or not it asked for seat history.
    // `note` because Banner prints its own hedge on every restrictions page, and a
    // model relaying "juniors and seniors only" as absolute would overstate it.
    const standing = offering?.std;
    if (standing && STANDING_NAMES[standing]) {
      out.classStanding = {
        code:    standing,
        minimum: STANDING_NAMES[standing],
        note: `Banner restricts every section of this course to ${STANDING_NAMES[standing]} standing or above. ` +
              `Banner itself notes that not all restrictions apply to all students, and standing is earned by ` +
              `credits rather than by elapsed terms — the student's academic advisor is the authority.`,
      };
    }

    if (include.includes("offerings")) {
      // Primary instructors (from the monthly Banner scrape — historical
      // record, not a promise of future staffing): per completed term from
      // term-details, plus the per-semester-type enrolment-share averages
      // the app displays.
      out.offerings = {
        history:     offeringStats.offeringHistory(course),
        bySemesterType: offeringStats.semTypeSummary(course, plan?.offeredOverrides?.[id]),
        instructors: {
          byTerm: Object.entries(termDetails[id] ?? {})
            .filter(([, d]) => d.prof?.length)
            .sort((a, b) => Number(b[0]) - Number(a[0]))
            .map(([code, d]) => ({
              term:        termLabel(code),
              termCode:    code,
              instructors: d.prof.map(([name, sections, enrolled]) => ({ name, sections, enrolled })),
            })),
          typicalBySemesterType: offering?.prof ?? {},   // typeId → [[name, avg % of enrolment], …]
        },
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
    const id = canonId(courseId);
    const course = courseMap[id];
    if (!course) return [];
    const labelOf = Object.fromEntries(
      calendar.getSemesterTypes().map(st => [st.id, st.label])
    );
    return offeringStats.offeringHistory(course).map(e => {
      // The complete history includes WHO: primary instructors per term
      // [name, enrolled], for completed terms the scrape has covered.
      const prof = termDetails[id]?.[e.termCode]?.prof;
      return {
        ...e,
        label: `${labelOf[e.semTypeId] ?? e.semTypeId} ${e.year}`,
        ...(prof && { instructors: prof.map(([name, , enrolled]) => [name, enrolled]) }),
      };
    });
  }

  function listPrograms({ type, level, college, year, query, campus } = {}) {
    let list = programList;
    if (type && type !== "all")   list = list.filter(p => p.type === type);
    if (level && level !== "all") list = list.filter(p => p.level === level);
    if (college)                  list = list.filter(p => p.college === college);
    if (year)                     list = list.filter(p => p.year === year);
    if (campus) {
      const q = campus.toLowerCase();
      list = list.filter(p => p.id.toLowerCase().includes(q) || p.label.toLowerCase().includes(q));
    }
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
    if (include.includes("tree")) {
      out.requirementSections = json.requirementSections ?? [];
      // GPA rules are constraints over the student's grades, not
      // requirements a placement can satisfy — surfaced verbatim so the
      // model can EXPLAIN them, never evaluated here: grades never leave
      // the browser (docs/grades-design.md).
      if (json.gpaRequirements?.length) out.gpaRequirements = json.gpaRequirements;
    }
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

    // Timeline-scoped: parked placements never satisfy requirements.
    const { SEM_INDEX: semIdx } = deriveSemMaps(cohortSemesters(plan));
    const placedSet     = buildPlacedKeySet(filterInTimeline(eff, semIdx), placedOutSet, courseMap);
    const realPlacedSet = buildPlacedKeySet(filterInTimeline(placements, semIdx), placedOutSet, courseMap);
    const donePlacements = Object.fromEntries(
      Object.entries(eff).filter(([, semId]) => status(semId) === "completed")
    );
    const doneSet = buildPlacedKeySet(donePlacements, placedOutSet, courseMap);

    // A work term registers a real course (COOP 3945), which 37 undergraduate
    // programs name as a requirement. It joins placedSet ONLY — realPlacedSet
    // feeds General Electives and must stay what the student actually placed.
    // Same treatment the UI's GradPanel gives it, so an audit read here and
    // the panel on screen cannot disagree about the experiential requirement.
    const workTerms = plan.workExperience ?? {};
    const grants = workTermGrants(workTerms, specialTerms.getTypes(), semIdx,
      (semId) => status(semId) === "completed");
    for (const k of grants.planned)   placedSet.add(k);
    for (const k of grants.completed) doneSet.add(k);

    // Accumulated-credit repeatable-course requirements (XOM `accumulate: true`, e.g. "68
    // SH of SMFA 3000" — see gradRequirements.js) need the real summed credit across every
    // term a course was repeated; buildPlacedKeySet collapses repeat instances
    // ("SMFA3000#2", …) to one Set entry above, discarding that. Sum sh per base course key
    // from the raw, timeline-scoped placement ids (parked/out-of-timeline takes shouldn't
    // count, matching placedSet's own scoping) and attach it to a shallow courseMap clone —
    // never mutate the shared catalog courseMap.
    const repeatTotals = {};
    for (const [placementId] of Object.entries(filterInTimeline(eff, semIdx))) {
      const base = baseId(placementId);
      const course = courseMap[base];
      if (!course) continue;
      const sh = plan.shOverrides?.[placementId] ?? course.sh ?? 0;
      repeatTotals[base] = (repeatTotals[base] ?? 0) + sh;
    }
    const courseMapWithRepeats = Object.keys(repeatTotals).length
      ? {
          ...courseMap,
          ...Object.fromEntries(
            Object.entries(repeatTotals).map(([base, total]) => [base, { ...courseMap[base], repeatTotalSh: total }])
          ),
        }
      : courseMap;

    // General Electives must be computed AFTER the concentration is applied, not
    // before: a course an XOM pool releases once its own threshold is met (see the
    // cap in allocateNode) is exactly the kind of course a concentration listing it
    // might then claim — compute General Electives too early and that course reads
    // as both a general elective AND concentration credit, double-counted instead
    // of landing in exactly one place.
    const { sections, allocatedSet } = allocateMajorSections(majorJson, placedSet, courseMapWithRepeats);
    let results = [...sections];

    const conc = concentration ?? plan.concentration ?? "";
    let concentrationApplied = null;
    let concResults = [];
    if (conc && majorJson.concentrations) {
      // Resolve through aliases/labels: a saved plan may carry a title from
      // before a scraper-side rename, and silently ignoring it would audit the
      // major without the concentration the user actually chose.
      const concSection = resolveConcentration(majorJson, conc);
      if (concSection) {
        concResults = allocateSections([concSection], placedSet, allocatedSet, courseMapWithRepeats);
        results = [...results, ...concResults];
        concentrationApplied = concSection.title;
      }
    }

    const candidateKeys = collectCandidateKeys([...sections, ...concResults], realPlacedSet ?? placedSet);
    const generalElectives = calculateGeneralElectives(
      placedSet, allocatedSet, courseMapWithRepeats, majorJson.generalElectiveSH ?? 0, doneSet, candidateKeys, realPlacedSet
    );
    results = [...results, generalElectives];

    // Surface the fidelity verdict IN THE PAYLOAD, not only in the tool
    // description. The server's own instructions already treat `note` as
    // non-negotiable for seat counts; the same applies here — an audit built
    // on incomplete requirements must not read as authoritative.
    const v = majorJson.metadata?.verification ?? null;
    const problems = (v?.discrepancies ?? []).filter(x => x.severity === 'high' || x.severity === 'medium');

    return {
      programId: id,
      label:     majorJson.name ?? id,
      totalCreditsRequired: majorJson.totalCreditsRequired ?? null,
      concentrationApplied,
      concentrationRequired: (majorJson.concentrations?.minOptions ?? 0) > 0 && !concentrationApplied,
      // GPA constraints ride along verbatim (with a note below). They are
      // never evaluated server-side: grades live only in the user's browser.
      ...(majorJson.gpaRequirements?.length ? {
        gpaRequirements: majorJson.gpaRequirements,
        gpaNote: "These GPA rules are constraints on grades, which NU Map does not share. State them to the user; do not claim they are met or unmet.",
      } : {}),
      ...(v ? {
        verification: {
          level: v.level,
          // The same rows the human popover draws, from the same function, so
          // the model and the student are never told different things. Each is
          // one check with its outcome and, where something is off, the
          // specific courses or sections responsible.
          checks: buildCheckRows(v).map(r => ({
            check: r.textKey.replace(/^verify\.pop\./, ''),
            outcome: { pass: 'pass', fail: 'failed', warn: 'inconclusive',
                       note: 'note', na: 'not-applicable' }[r.state],
            ...(r.detail?.length ? { because: r.detail.map(detailText) } : {}),
          })),
          sourcesAvailable: v.sourcesAvailable,
          // Where this was read from, so a caller can cite or check the source.
          ...(v.sourceUrl ? { catalogPage: v.sourceUrl } : {}),
        },
      } : {}),
      ...(problems.length ? {
        note: `This program has ${problems.length} known parsing discrepanc${problems.length === 1 ? 'y' : 'ies'} against the catalog (see verification). Treat the audit as a best-effort guide, say so, and point the user to their advisor and the official degree audit.`,
      } : v?.level === 'partial' ? {
        note: 'Every check that could run on this program passed, but the catalog page provides no sample plan of study to cross-check against, so coverage is unconfirmed. Requirement audits remain a guide, not the authority.',
      } : {}),
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
        // The course this block registers, and null when the student has not
        // said. Reported because it is now the ONLY thing that makes a work
        // term satisfy a requirement: without it here, an assistant looking at
        // an unmet experiential row has no way to tell "no co-op" from "a
        // co-op whose course was never recorded" — two states one action apart.
        registers: wt.courseId ?? null,
        abroad:    wt.abroad === true,
        spansInto: spans ? (SEM_NEXT[wt.semId] ?? null) : null,
      });
    }

    // ── Summer's cap is on the two halves TOGETHER ────────────────────
    //
    // `overMax` was `sem.weight === 1 && sh > shMax`, so a summer half could never report an
    // overload at all — the same blind spot the summer row had, reached by a different route.
    // A half is not judged against the full cap either; summer is capped as a whole, so both
    // halves report the verdict for the combined load, which is what the planner draws on the
    // row in front of them. See `creditLoad.js`.
    const summerSH = new Map();
    for (const sem of sems) {
      if (sem.weight === 1 || sem.type === "special") continue;
      const key = String(sem.label).match(/\d{4}/)?.[0] ?? sem.label;
      summerSH.set(key, (summerSH.get(key) ?? 0)
        + getSemSH(sem.id, plan.placements ?? {}, map));
    }
    const judgedSH = (sem) => {
      if (sem.weight === 1 || sem.type === "special") {
        return getSemSH(sem.id, plan.placements ?? {}, map);
      }
      return summerSH.get(String(sem.label).match(/\d{4}/)?.[0] ?? sem.label) ?? 0;
    };

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
        overMax: isOverCap(judgedSH(sem), shMax),
        underFullTime: sem.weight === 1 && sem.type !== "special" && sh > 0 && sh < shMin,
        workTerms: workBySem[sem.id] ?? [],
      };
    });
  }

  function getNUPathCoverage(plan) {
    // Timeline-scoped: parked courses/co-ops neither cover nor grant.
    const { SEM_INDEX: semIdx } = deriveSemMaps(cohortSemesters(plan));
    const placements = filterInTimeline(plan.placements ?? {}, semIdx);
    const granted = computeGrantedAttrs(plan.workExperience ?? {}, specialTerms.getTypes(), semIdx);
    const covered = attributeSystem.getCoverage(placements, courseMap, granted);
    const labels  = Object.fromEntries(attributeSystem.getAttributes().map(a => [a.code, a.label]));
    const grantsByCode = {};
    for (const [instanceId, wt] of Object.entries(plan.workExperience ?? {})) {
      const type = specialTerms.getTypes().find(t => t.id === wt.typeId);
      for (const code of type?.attributeGrants ?? []) {
        if (wt.semId && semIdx[wt.semId] !== undefined) (grantsByCode[code] ??= []).push(instanceId);
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

  function checkPrereqs(courseId, completedIds = null, plan = null, studentType = null) {
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

    // Non-course conditions: an explicit studentType wins (the caller passed
    // its own completed list, so there may be no plan), else the plan's. A
    // graduate plan satisfies "graduate program admission" — the OR branch
    // beside the undergrad chain on 209 courses (see prereqConditions.js).
    const conditions = planConditions({ studentType: studentType ?? plan?.studentType });

    const fakePlacements = {};
    for (const cid of completed) fakePlacements[cid] = "s0";
    fakePlacements[id] = "s1";
    const result = evalPrereqTree(course.prereqs, fakePlacements, { s0: 0, s1: 1 }, 1, new Set(), null, conditions);

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

    // Non-course conditions ride along so the answer is explainable: an
    // unsatisfied course can still be takeable via permission, and a satisfied
    // grad course should say WHY (admission, not the undergrad chain).
    const conds = collectConditions(course.prereqs, conditions);

    return {
      satisfied: result === "satisfied",
      missing:    [...new Set(missing)],
      concurrent: [...new Set(concurrent)],
      ...(conds.length && { conditions: conds }),
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
