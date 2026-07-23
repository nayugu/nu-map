// ═══════════════════════════════════════════════════════════════════
// RELEVANCE CONTEXT — which placed courses count toward the selected
// programs. Computed app-wide (GradPanel only mounts while its sidebar
// tab is open) so CourseCard can fade cards by tier: major /
// concentration at full strength, minors slightly dimmed, everything
// else one step below.
// ═══════════════════════════════════════════════════════════════════
import { createContext, useContext, useState, useEffect, useMemo } from "react";
import { usePlanner }         from "./PlannerContext.jsx";
import { usePort }            from "./InstitutionContext.jsx";
import { IMajorRequirements } from "../ports/IMajorRequirements.js";
import {
  buildPlacedKeySet,
  allocateMajorWithElectives,
  allocateSections,
} from "../core/gradRequirements.js";

const EMPTY = new Set();
const RelevanceContext = createContext({ active: false, majorKeys: EMPTY, minorKeys: EMPTY });

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
    effectivePlacements, placedOut, courseMap,
    major, major2, conc, minor1, minor2, studentType,
  } = usePlanner();
  const majorRequirements = usePort(IMajorRequirements);
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

  const placedSet = useMemo(
    () => buildPlacedKeySet(effectivePlacements, placedOut, courseMap),
    [effectivePlacements, placedOut, courseMap]
  );

  const value = useMemo(() => {
    const majorKeys = new Set();
    for (const m of [majorData, major2Data]) {
      if (!m) continue;
      const { allocatedSet } = allocateMajorWithElectives(m, placedSet, courseMap);
      // Concentration shares the primary major's used set (same as GradPanel)
      if (m === majorData && conc && m.concentrations) {
        const concSection = m.concentrations.concentrationOptions?.find(c => c.title === conc);
        if (concSection) allocateSections([concSection], placedSet, allocatedSet, courseMap);
      }
      allocatedSet.forEach(k => majorKeys.add(k));
    }

    const minorKeys = new Set();
    for (const m of [minor1Data, minor2Data]) {
      if (!m) continue;
      const sections = (m.requirementSections ?? []).filter(
        s => s.title !== "Required General Electives"
      );
      const used = new Set();
      allocateSections(sections, placedSet, used, courseMap);
      used.forEach(k => { if (!majorKeys.has(k)) minorKeys.add(k); });
    }

    const active = !!(majorData || major2Data || minor1Data || minor2Data);
    return { active, majorKeys, minorKeys };
  }, [majorData, major2Data, minor1Data, minor2Data, conc, placedSet, courseMap]);

  return <RelevanceContext.Provider value={value}>{children}</RelevanceContext.Provider>;
}
