// ═══════════════════════════════════════════════════════════════════
// RELEVANCE CONTEXT — which placed courses count toward the selected
// programs. Computed app-wide (GradPanel only mounts while its sidebar
// tab is open) so CourseCard can fade cards by tier: major /
// concentration at full strength, minors slightly dimmed, everything
// else one step below.
// ═══════════════════════════════════════════════════════════════════
import { createContext, useContext, useState, useEffect, useMemo } from "react";
import { resolveConcentration } from "../core/concentrationResolve.js";
import { usePlanner }         from "./PlannerContext.jsx";
import { usePort }            from "./InstitutionContext.jsx";
import { IMajorRequirements } from "../ports/IMajorRequirements.js";
import { ISpecialTerms }      from "../ports/ISpecialTerms.js";
import { derivePlanSets }     from "../core/planModel.js";
import { workTermGrants, coopOptionsInPrograms } from "../core/specialTermUtils.js";
import {
  allocateMajorSections,
  allocateSections,
  courseKey,
} from "../core/gradRequirements.js";
import {
  collectEligibleSpec,
  mergeSplitSpecs,
  courseEligible,
  countsAsElectiveOnly,
} from "../core/programEligibility.js";
import { minorRequirementSections, minorShare, majorClaimOf } from "../core/minorOverlap.js";

const EMPTY = new Set();
const RelevanceContext = createContext({
  active: false, majorKeys: EMPTY, minorKeys: EMPTY,
  hasProgram: false, courseRole: () => null, doubleCount: () => null, minorCaps: [],
});

// Allocate a single program against a placed-key set, returning the set of keys
// it consumes into real requirements (not General Electives). Mirrors the
// major/minor allocation in RelevanceProvider (and the Graduation panel).
function allocateProgram(p, placedSet, courseMap) {
  if (p.isMinor) {
    const used = new Set();
    allocateSections(minorRequirementSections(p.data), placedSet, used, courseMap);
    return used;
  }
  // Only the allocated set matters here, so this deliberately stops short of
  // General Electives — building that section would need the free-elective
  // allowance passed in, and nothing below reads it.
  const { allocatedSet } = allocateMajorSections(p.data, placedSet, courseMap);
  if (p.concSection) allocateSections([p.concSection], placedSet, allocatedSet, courseMap);
  return allocatedSet;
}

export const useRelevance = () => useContext(RelevanceContext);

// Load a program JSON, resolving to null on any failure (renamed away,
// discontinued, network). Relevance fading is cosmetic — it must never
// surface load errors of its own; GradPanel owns that UX.
function useProgram(loader, path) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!path) { setData(null); return; }
    let stale = false;
    loader(path)
      .then(d => { if (!stale) setData(d); })
      .catch(() => { if (!stale) setData(null); });
    return () => { stale = true; };
  }, [loader, path]);
  return data;
}

export function RelevanceProvider({ children }) {
  const {
    placements, grades, effectiveSubstitutions, placedOut, courseMap, SEM_INDEX,
    currentSemIdx,
    major, major2, conc, conc2, minor1, minor2, studentType, specialTermPl,
  } = usePlanner();
  const majorRequirements = usePort(IMajorRequirements);
  const specialTerms      = usePort(ISpecialTerms);
  const isGrad = studentType === "graduate";

  const loadMajor = useMemo(
    () => (isGrad ? p => majorRequirements.loadGradMajor(p) : p => majorRequirements.loadMajor(p)),
    [majorRequirements, isGrad]
  );
  const loadMinor = useMemo(() => p => majorRequirements.loadMinor(p), [majorRequirements]);

  const majorData  = useProgram(loadMajor, major);
  const major2Data = useProgram(loadMajor, major2);
  const minor1Data = useProgram(loadMinor, minor1);
  const minor2Data = useProgram(loadMinor, minor2);

  /**
   * The AUDIT's placed set — the same one the graduation panel allocates from.
   *
   * This used to be its own expression: `buildPlacedKeySet(filterInTimeline(
   * effectivePlacements, …))`. Close, and not the same, in two ways that both
   * put the board at odds with the panel. A definitively failed take (F/U/W)
   * satisfies nothing in the audit but still lit its card up as major-relevant
   * here, and a work term's registered course (COOP 3945, which 37 undergraduate
   * programs require) counted in the panel and nowhere on the board.
   *
   * Timeline-scoping — parked courses must not consume requirement slots, or a
   * genuine candidate reads as a free elective — comes along inside
   * `derivePlanSets`, which is where that derivation already lived for the
   * printed report. Three copies of it existed; this is the second of them
   * folded back in.
   */
  const placedSet = useMemo(
    () => derivePlanSets({
      placements, grades, substitutions: effectiveSubstitutions, placedOut, courseMap,
      dynSemIdx: SEM_INDEX, curIdx: currentSemIdx,
      specialTermPl, specialTermTypes: specialTerms?.getTypes() ?? [],
    }).placedSet,
    [placements, grades, effectiveSubstitutions, placedOut, courseMap, SEM_INDEX,
     currentSemIdx, specialTermPl, specialTerms]
  );

  /**
   * Work-term instance id → the course key it registers.
   *
   * Lives here, not in SemRow or GradPanel, for the reason this whole provider
   * exists: GradPanel only mounts while its tab is open, and the board needs
   * the answer whether or not anyone is looking at the audit. Deriving it in
   * both places is how the two come to disagree — the same mistake
   * `workTermGrants` was extracted to fix.
   */
  const workTermCourse = useMemo(() => {
    const src = workTermGrants(specialTermPl, specialTerms?.getTypes() ?? [], SEM_INDEX).source;
    const byInstance = {};
    for (const [key, instanceId] of src) byInstance[instanceId] = key;
    return byInstance;
  }, [specialTermPl, specialTerms, SEM_INDEX]);

  /**
   * The work-experience courses the student's programs name.
   *
   * No longer used to GRANT anything — a work term registers what the student
   * said and nothing otherwise. It survives as an ordering hint for the card's
   * course picker: showing a Khoury student `CS 6964` near the top is helpful,
   * and is a different act from ticking it on their behalf.
   */
  const coopProgramOptions = useMemo(
    () => new Set(coopOptionsInPrograms([majorData, major2Data], courseMap).map(o => o.key)),
    [majorData, major2Data, courseMap]);

  /**
   * What the majors claim, over any placed set — the panel's own function.
   *
   * Resolving the concentration TITLES here (rather than inside core) keeps
   * `concentrationResolve` the single owner of that lookup, which is what saved
   * plans and share links depend on.
   */
  const majorClaim = useMemo(() => majorClaimOf([
    { data: majorData,  concentration: conc  && majorData?.concentrations
        ? resolveConcentration(majorData, conc) : null },
    { data: major2Data, concentration: conc2 && major2Data?.concentrations
        ? resolveConcentration(major2Data, conc2) : null },
  ], courseMap), [majorData, major2Data, conc, conc2, courseMap]);

  const value = useMemo(() => {
    const majorKeys = majorClaim(placedSet).claimed;

    const minorKeys = new Set();
    // Per-minor double-counting state, so the board can mark a card without
    // opening the graduation panel — and mark it with the SAME numbers, since
    // both sides now allocate from one placed set through one claim function.
    const minorCaps = [];
    for (const [i, m] of [minor1Data, minor2Data].entries()) {
      if (!m) continue;
      const used = new Set();
      allocateSections(minorRequirementSections(m), placedSet, used, courseMap);
      used.forEach(k => { if (!majorKeys.has(k)) minorKeys.add(k); });
      const share = minorShare({ minor: m, placedSet, majorKeys, courseMap, majorClaim });
      if (share) minorCaps.push({ n: i + 1, name: m.name ?? "", share });
    }

    const active = !!(majorData || major2Data || minor1Data || minor2Data);

    // Candidate-facing specs: which catalog courses *could* count toward any
    // selected program (major/2nd major/concentration/minors), split into
    // required vs elective. Powers the Course Bank program filters.
    const splits = [majorData, major2Data, minor1Data, minor2Data].map(collectEligibleSpec);
    if (conc && majorData?.concentrations) {
      const concSection = resolveConcentration(majorData, conc);
      if (concSection) splits.push(collectEligibleSpec({ requirementSections: [concSection] }));
    }
    const { required, elective } = mergeSplitSpecs(...splits);
    const hasProgram = active;

    // ── Search-time attribution ──────────────────────────────────────
    // For a searched course, report what it WOULD count as if slotted into the
    // plan right now (or what it already counts as, if it's placed) — using the
    // exact same allocation as the Graduation panel. Owner is generic
    // ("major1"/"minor1"), kind is required vs elective; unallocated but
    // eligible → a free elective.
    // Only number a label ("Major 1") when there's more than one of that type;
    // with a single major/minor it's just "Major"/"Minor".
    const majorCount = (majorData ? 1 : 0) + (major2Data ? 1 : 0);
    const minorCount = (minor1Data ? 1 : 0) + (minor2Data ? 1 : 0);
    const progs = [];
    if (majorData) {
      const concSection = (conc && majorData.concentrations)
        ? resolveConcentration(majorData, conc) : null;
      progs.push({ type: "major", n: 1, numbered: majorCount > 1, data: majorData, concSection, isMinor: false, split: collectEligibleSpec(majorData) });
    }
    if (major2Data) progs.push({ type: "major", n: 2, numbered: true, data: major2Data, isMinor: false, split: collectEligibleSpec(major2Data) });
    if (minor1Data) progs.push({ type: "minor", n: 1, numbered: minorCount > 1, data: minor1Data, isMinor: true, split: collectEligibleSpec(minor1Data) });
    if (minor2Data) progs.push({ type: "minor", n: 2, numbered: true, data: minor2Data, isMinor: true, split: collectEligibleSpec(minor2Data) });

    const baseAlloc = progs.map(p => allocateProgram(p, placedSet, courseMap));
    // Collect EVERY program the key is allocated to — a course can double-dip
    // across programs (count toward a major and a minor), and be required for
    // one but an elective for another.
    const attribute = (key, allocs) => {
      const roles = [];
      for (let i = 0; i < progs.length; i++) {
        if (!allocs[i].has(key)) continue;
        const c = courseMap[key];
        const kind = c && courseEligible(c, progs[i].split.required) ? "required" : "elective";
        roles.push({ type: progs[i].type, n: progs[i].n, numbered: progs[i].numbered, kind });
      }
      return roles;
    };
    const courseRole = (crs) => {
      if (!crs || !progs.length) return null;
      const key = courseKey(crs.subject, crs.number);
      if (!(courseEligible(crs, required) || countsAsElectiveOnly(crs, required, elective))) return null;
      // Already placed → its real allocation (don't re-add; no double-count).
      // Otherwise → simulate slotting it in now.
      const allocs = placedSet.has(key)
        ? baseAlloc
        : (() => { const t = new Set(placedSet); t.add(key); return progs.map(p => allocateProgram(p, t, courseMap)); })();
      const roles = attribute(key, allocs);
      // Eligible but consumed by no requirement → it'd be a free elective.
      return roles.length ? roles : [{ type: "free" }];
    };

    /**
     * Does this course count toward a MAJOR and a MINOR at once?
     *
     * Northeastern lets it, up to half the credit the minor requires — the one
     * overlap in the app that carries a budget, which is why it is the only one
     * marked. Two majors double-count freely (no budget, nothing to watch), a
     * concentration is part of its major rather than a second credential, and
     * NUPath overlap is unlimited by the same catalog sentence that permits it.
     *
     * Reuses `courseRole` rather than asking allocation a second question, so
     * the badge cannot say one thing while the bank's own filter says another.
     * That also gets the placed/unplaced split for free: `courseRole` reports a
     * placed course's REAL allocation and simulates an unplaced one, which is
     * exactly the difference between "counts twice" and "would count twice".
     *
     * `over` is a fact about the MINOR, not about this course. No single course
     * is the one past the limit — the shared set is — so every card in that set
     * carries the same mark and the tooltip carries the set's own numbers.
     */
    const doubleCount = (crs) => {
      if (!minorCaps.length) return null;
      const roles = courseRole(crs);
      if (!roles) return null;
      const minorRole = roles.find(r => r.type === "minor");
      if (!minorRole || !roles.some(r => r.type === "major")) return null;
      const cap = minorCaps.find(c => c.n === minorRole.n);
      if (!cap) return null;
      return {
        placed: placedSet.has(courseKey(crs.subject, crs.number)),
        over: cap.share.over,
        minorN: minorRole.n,
        numbered: minorRole.numbered,
        minorName: cap.name,
        sh: cap.share.dependentSH,
        capSH: cap.share.capSH,
      };
    };

    return { active, majorKeys, minorKeys, hasProgram, courseRole, doubleCount,
             minorCaps, workTermCourse, coopProgramOptions };
    // `workTermCourse` MUST be listed. Without it this memo keeps the object it
    // closed over on first render — when the plan has not loaded and there are
    // no work terms — so dragging a co-op onto the board recomputed the map and
    // published nothing, and the card's course field never appeared.
    // `majorClaim` and `conc2` MUST be listed for the same reason `workTermCourse`
    // is: without them the memo keeps the claim function it closed over, so
    // changing the second major's concentration would leave every card marked
    // against the previous one.
  }, [majorData, major2Data, minor1Data, minor2Data, conc, conc2, majorClaim,
      placedSet, courseMap, workTermCourse, coopProgramOptions]);

  return <RelevanceContext.Provider value={value}>{children}</RelevanceContext.Provider>;
}
