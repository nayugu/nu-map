// ⚠ TEMPORARY — TESTING ONLY.
//
// A bare button to load a department's published plan so the reservation cards
// can be exercised on localhost. The real affordance is designed later; this
// exists only to get plan data into the planner.
//
// To remove: delete this file and its one <TempPlanLoader/> usage in GradPanel.
import { useEffect, useState } from "react";
import { usePlanner } from "../context/PlannerContext.jsx";
import { usePort } from "../context/InstitutionContext.jsx";
import { IMajorRequirements } from "../ports/IMajorRequirements.js";

export default function TempPlanLoader({ path, isGrad, programData }) {
  const majorRequirements = usePort(IMajorRequirements);
  const { applySamplePlanToPlan } = usePlanner();
  const [plans, setPlans] = useState(null);
  const [pick, setPick] = useState(0);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    setPlans(null); setPick(0); setMsg(null);
    if (!path || !majorRequirements.hasSamplePlan?.(path, isGrad)) return;
    let live = true;
    majorRequirements.loadSamplePlans(path, isGrad)
      .then(g => { if (live) setPlans(g?.plans ?? null); })
      .catch(() => { if (live) setPlans(null); });
    return () => { live = false; };
  }, [path, isGrad]);

  if (!plans?.length) return null;

  const load = () => {
    const r = applySamplePlanToPlan(plans[pick], programData);
    setMsg(`placed ${r.placed.length} courses, ${r.reserved.length} reservations`
      + (r.notes.length ? ` · ${r.notes.length} notes` : ""));
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
      padding: "6px 8px", margin: "6px 0", borderRadius: 6,
      border: "1px dashed var(--border-2)", background: "var(--bg-surface-2)",
    }}>
      <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-4)" }}>
        TEMP · TESTING
      </span>
      <select
        value={pick}
        onChange={e => setPick(Number(e.target.value))}
        style={{ fontSize: 11, maxWidth: 300, background: "var(--bg-2)", color: "var(--text-2)",
                 border: "1px solid var(--border-1)", borderRadius: 4, padding: "2px 4px" }}
      >
        {plans.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
      </select>
      <button
        onClick={load}
        style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 5,
                 cursor: "pointer", border: "1px solid var(--border-1)",
                 background: "var(--bg-2)", color: "var(--text-2)" }}
      >
        Load plan
      </button>
      {msg && <span style={{ fontSize: 10, color: "var(--text-3)" }}>{msg}</span>}
    </div>
  );
}
