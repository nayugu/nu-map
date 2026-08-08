// ═══════════════════════════════════════════════════════════════════
// CANDIDATES CONTEXT — what each undecided card could still be.
//
// The core answers this (src/core/candidates.js, runtimeBinding.js); this is
// the only place the app asks. Kept out of PlannerContext because it needs the
// selected program's requirements, which are LOADED — and PlannerContext must
// stay synchronous over plan state.
//
// ── The baseline is what makes narrowing safe ──────────────────────
//
// A live solve is not monotone. Elimination is relative to competition: a card
// is excluded from a requirement only because its rivals must go there, so
// satisfying those rivals frees it and the card GAINS a candidate. More
// information making a card more ambiguous is exactly the churn the design
// warned about, so each solve is fed the previous one and can only refine it.
//
// The baseline lives in a ref rather than state because it must not itself
// trigger a render — it is a record of what we have already told the student,
// not an input to what we compute next. Writing a ref during render is safe
// here for one specific reason: the operation is idempotent. Narrowing by a set
// that already contains the result changes nothing, so React re-invoking this
// (StrictMode does, twice) produces the same answer.
// ═══════════════════════════════════════════════════════════════════

import { createContext, useContext, useState, useEffect, useMemo, useRef } from "react";

import { usePlanner }         from "./PlannerContext.jsx";
import { usePort }            from "./InstitutionContext.jsx";
import { IMajorRequirements } from "../ports/IMajorRequirements.js";
import { bindReservations }   from "../core/runtimeBinding.js";
import {
  candidatesForReservation, courseIds, preferredCourseIds,
  forcedRequirement, isUnbounded, isSpare,
} from "../core/candidates.js";
import { specForNode }        from "../core/programEligibility.js";
import { specAdmitsSubject, specAdmitsRange } from "../core/requirementBinding.js";
import { createPlanHints }    from "../adapters/northeastern/planHints.js";

const EMPTY_MAP = new Map();
const CandidatesContext = createContext({
  candidatesFor: () => null,
  coursesFor: () => new Set(),
  preferredFor: () => new Set(),
  requirementTitleFor: () => null,
  ready: false,
});

export const useCandidates = () => useContext(CandidatesContext);

export function CandidatesProvider({ children }) {
  const { reservations, placements, courseMap, subjects, major, studentType } = usePlanner();
  const majorRequirements = usePort(IMajorRequirements);
  const isGrad = studentType === "graduate";

  // Same load the relevance layer does. Failure resolves to null rather than
  // surfacing here: a card with no program data degrades to "we do not know",
  // which is the honest reading, and GradPanel owns program-load UX.
  const [programData, setProgramData] = useState(null);
  useEffect(() => {
    if (!major) { setProgramData(null); return; }
    let stale = false;
    const load = isGrad ? majorRequirements.loadGradMajor : majorRequirements.loadMajor;
    Promise.resolve(load(major))
      .then(d => { if (!stale) setProgramData(d ?? null); })
      .catch(() => { if (!stale) setProgramData(null); });
    return () => { stale = true; };
  }, [major, isGrad, majorRequirements]);

  // `subjects` is an ARRAY of codes here (the scrape side reads an object and
  // takes its keys — same data, different shape). Passing it through
  // Object.keys would yield "0","1","2"…, so every subject-prefix hint would
  // quietly stop matching and binding would get worse with no error anywhere.
  const hints = useMemo(() => {
    const list = Array.isArray(subjects) ? subjects : Object.keys(subjects ?? {});
    return list.length ? createPlanHints(list, { specAdmitsSubject, specAdmitsRange }) : null;
  }, [subjects]);

  // Reset when the program changes: a narrowing derived from a different
  // degree's requirements says nothing about this one.
  const baseline = useRef(EMPTY_MAP);
  const baselineFor = useRef(null);
  if (baselineFor.current !== programData) {
    baseline.current = EMPTY_MAP;
    baselineFor.current = programData;
  }

  const targets = useMemo(() => {
    if (!programData || !Object.keys(reservations ?? {}).length) return EMPTY_MAP;
    const next = bindReservations(reservations, {
      programData, placements, courseMap, hints,
      previous: baseline.current.size ? baseline.current : null,
    });
    baseline.current = next;
    return next;
  }, [reservations, placements, courseMap, programData, hints]);

  const value = useMemo(() => {
    const sections = programData?.requirementSections ?? [];
    const specOf = (t) => (typeof t === "number" ? specForNode(sections[t]) : null);
    const ctx = { specOf, courseMap };

    const built = new Map();
    for (const r of Object.values(reservations ?? {})) {
      built.set(r.id, candidatesForReservation(r, {
        programData, targets: targets.has(r.id) ? targets.get(r.id) : null,
      }));
    }

    const get = (id) => built.get(id) ?? null;
    return {
      ready: !!programData,
      candidatesFor: get,
      coursesFor: (id) => { const c = get(id); return c ? courseIds(c, ctx) : new Set(); },
      preferredFor: (id) => { const c = get(id); return c ? preferredCourseIds(c, ctx) : new Set(); },
      /** The requirement a card is for, once exactly one survives. */
      requirementTitleFor: (id) => {
        const c = get(id);
        if (!c) return null;
        const t = forcedRequirement(c);
        return typeof t === "number" ? (sections[t]?.title ?? null) : null;
      },
      isUnboundedFor: (id) => { const c = get(id); return c ? isUnbounded(c, ctx) : true; },
      isSpareFor: (id) => { const c = get(id); return c ? isSpare(c) : false; },
    };
  }, [reservations, targets, programData, courseMap]);

  return <CandidatesContext.Provider value={value}>{children}</CandidatesContext.Provider>;
}
