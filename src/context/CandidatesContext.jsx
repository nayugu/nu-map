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
import { bindReservations, outstandingObligations } from "../core/runtimeBinding.js";
import {
  candidatesForReservation, courseIds, preferredCourseIds, applyFilters,
  withoutSatisfiedRequirements, forcedRequirement, isUnbounded, isSpare,
  CONCENTRATION,
} from "../core/candidates.js";
import { resolveConcentration } from "../core/concentrationResolve.js";
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
  const { reservations, placements, courseMap, subjects, major, conc, studentType } = usePlanner();
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

  // Computed once and shared: it runs the graduation audit's allocator, and
  // both the solve and the spare test need it.
  const obligations = useMemo(
    () => outstandingObligations(programData, { placements, courseMap }),
    [programData, placements, courseMap]);

  const targets = useMemo(() => {
    if (!programData || !Object.keys(reservations ?? {}).length) return EMPTY_MAP;
    const next = bindReservations(reservations, {
      programData, placements, courseMap, hints, obligations,
      previous: baseline.current.size ? baseline.current : null,
    });
    baseline.current = next;
    return next;
  }, [reservations, placements, courseMap, programData, hints, obligations]);

  const value = useMemo(() => {
    const sections = programData?.requirementSections ?? [];
    // `~concentration` names nothing in general — which concentration is the
    // student's choice. Once they have chosen, it names that section's courses,
    // so a card reserving concentration credit stops offering the whole catalog.
    // `~general` has no resolution by nature and stays open.
    const concSection = conc && programData?.concentrations
      ? resolveConcentration(programData, conc) : null;
    const specOf = (t) => {
      if (typeof t === "number") return specForNode(sections[t]);
      if (t === CONCENTRATION && concSection) return specForNode(concSection);
      return null;
    };
    const ctx = { specOf, courseMap };

    // A requirement the plan has already met cannot be what a card is for.
    // This matters for STORED bindings specifically: they bypass the solve
    // (§11 forbids re-pointing them), so nothing else would notice that the
    // requirement is done. Dropping it here leaves the card with none, which
    // `isSpare` reports as "your plan already covers this" — the outcome §11
    // asks for instead of rebinding.
    const outstanding = new Set(obligations.map(o => o.target));
    const filters = [withoutSatisfiedRequirements(outstanding)];

    const built = new Map();
    for (const r of Object.values(reservations ?? {})) {
      const base = candidatesForReservation(r, {
        programData, targets: targets.has(r.id) ? targets.get(r.id) : null,
      });
      built.set(r.id, applyFilters(base, filters, ctx));
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
  }, [reservations, targets, programData, courseMap, obligations, conc]);

  return <CandidatesContext.Provider value={value}>{children}</CandidatesContext.Provider>;
}
