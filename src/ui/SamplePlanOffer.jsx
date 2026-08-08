// ═══════════════════════════════════════════════════════════════════
// SAMPLE PLAN OFFER — inside the major card.
//
// It lives here, not beside the program picker, because it belongs to the
// program you have CHOSEN rather than to choosing one. (That reasoning is
// inherited from the superseded design, which got this part right.)
//
// ── What it does differently ───────────────────────────────────────
//
// It is not a permanent control. `sampleplanOffer` decides whether to appear at
// all, so it is silent when the program publishes no plan (632 of 1,017), when
// the canvas already IS that plan, and for a true double major.
//
// The counts are shown BEFORE the action, not reported after it. "Adds 26
// courses and 22 placeholders" is a decision input; "placed 26 courses" is a
// receipt for a decision already made. Half of a sample plan names no course,
// so a student who is not told that meets a wall of blanks.
//
// The primary verb follows what is at stake. On an empty canvas there is
// nothing to lose, so it lays the plan out. On an occupied one the safe action
// leads — a new plan, which is also where "what if I did the five-year
// version?" belongs — and REPLACE is a demoted, confirmed action. Provenance
// proves the canvas started as a sample plan; it does not prove the student has
// left it alone.
//
// "Add here" is deliberately gone. A sample plan assumes year 1 is your first
// year with nothing done, so adding it beside existing work leaves a canvas
// that is neither the student's nor the department's.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { usePlanner }         from "../context/PlannerContext.jsx";
import { usePort }            from "../context/InstitutionContext.jsx";
import { useLanguage }        from "../context/LanguageContext.jsx";
import { IMajorRequirements } from "../ports/IMajorRequirements.js";
import { applySamplePlan }    from "../core/applySamplePlan.js";
import {
  sampleplanOffer, variantsFor, describeTemplate, isPlanEmpty,
} from "../core/planTemplate.js";

export default function SamplePlanOffer({ path, isGrad, programData, isPhone }) {
  const majorRequirements = usePort(IMajorRequirements);
  const { t } = useLanguage();
  const {
    major2, appliedTemplate, placements, reservations, specialTermPl, placedOut,
    SEMESTERS, courseMap, applySamplePlanToPlan, createPlan, doUndo,
    planEntSem, planEntYear, planGradSem, planGradYear, studentType,
  } = usePlanner();

  const [plans,      setPlans]      = useState(null);
  const [variantIdx, setVariantIdx] = useState(0);
  const [justDid,    setJustDid]    = useState(null);   // "loaded" | "replaced" | "opened"

  // Question 1 of the rule, answered synchronously so nothing flickers in for a
  // program that publishes nothing.
  const hasSamplePlan = !!path && !!majorRequirements.hasSamplePlan?.(path, isGrad);

  useEffect(() => {
    setPlans(null); setVariantIdx(0); setJustDid(null);
    if (!hasSamplePlan) return;
    let live = true;
    majorRequirements.loadSamplePlans(path, isGrad)
      .then(g => { if (live) setPlans(g?.plans ?? null); })
      .catch(() => { if (live) setPlans(null); });
    return () => { live = false; };
  }, [path, isGrad, hasSamplePlan, majorRequirements]);

  const canvasEmpty = useMemo(
    () => isPlanEmpty({ placements, reservations, specialTermPl, placedOut }),
    [placements, reservations, specialTermPl, placedOut]);

  const offer = useMemo(() => sampleplanOffer({
    major: path, major2, hasSamplePlan, appliedTemplate, canvasEmpty,
  }), [path, major2, hasSamplePlan, appliedTemplate, canvasEmpty]);

  const years = Math.round(((planGradYear * 2 + (planGradSem === "fall" ? 1 : 0)) -
                            (planEntYear  * 2 + (planEntSem  === "fall" ? 1 : 0)) + 1) / 2);
  const variants = useMemo(() => variantsFor(plans ?? [], { years }), [plans, years]);
  const safeIdx  = Math.min(Math.max(variantIdx, 0), Math.max(variants.length - 1, 0));
  const chosen   = variants[safeIdx] ?? null;

  // Counted against THIS canvas, so "adds N" is what this student would get —
  // a course they already placed is not counted again.
  const counts = useMemo(() => (chosen ? describeTemplate(chosen, {
    semesters: SEMESTERS, courseMap, placements, reservations, specialTermPl, programData,
  }) : null), [chosen, SEMESTERS, courseMap, placements, reservations, specialTermPl, programData]);

  // The offer disappears once taken (appliedTemplate now matches), so the undo
  // affordance has to survive that. Shown instead of the offer, never with it.
  if (justDid) {
    return (
      <Row isPhone={isPhone}>
        <span style={{ color: "var(--text-3)" }}>{t(`grad.plan.did.${justDid}`)}</span>
        <button onClick={() => { doUndo(); setJustDid(null); }} style={linkBtn}>
          {t("grad.plan.undo")}
        </button>
      </Row>
    );
  }

  if (!offer.offer || !chosen) return null;

  const layOut = () => {
    applySamplePlanToPlan(chosen, programData, 0, path);
    setJustDid("loaded");
  };

  const replace = () => {
    if (!window.confirm(t("grad.plan.replace.confirm"))) return;
    applySamplePlanToPlan(chosen, programData, 0, path, { replace: true });
    setJustDid("replaced");
  };

  // Seeded into a NEW slot rather than applied here: the current canvas is not
  // touched at all, which is the whole point of this verb.
  const openAsNew = () => {
    const r = applySamplePlan(chosen, { semesters: SEMESTERS, courseMap, programData });
    createPlan(t("grad.plan.newplan.name", { name: shortName(path) }), {
      entSem: planEntSem, entYear: planEntYear,
      gradSem: planGradSem, gradYear: planGradYear, studentType,
    }, null, {
      placements: r.placements, reservations: r.reservations, specialTermPl: r.specialTermPl,
      major: path, appliedTemplate: { programKey: path, planLabel: chosen.label ?? "" },
    });
    setJustDid("opened");
  };

  const primary = offer.verbs[0] === "load" ? layOut : openAsNew;
  const primaryLabel = offer.verbs[0] === "load" ? t("grad.plan.load") : t("grad.plan.newplan");

  return (
    <div style={{
      margin: "8px 0 10px", padding: isPhone ? "7px 8px" : "9px 10px", borderRadius: 6,
      border: "1px solid var(--border-2)", background: "var(--bg-surface-2)",
    }}>
      <div style={{
        fontSize: isPhone ? 8 : 9, fontWeight: 700, letterSpacing: "0.06em",
        color: "var(--text-4)", marginBottom: 4,
      }}>{t("grad.plan.label")}</div>

      {/* What arrives, before deciding. */}
      <div style={{ fontSize: isPhone ? 9 : 10, color: "var(--text-3)", marginBottom: 6 }}>
        {counts
          ? t("onboard.sampleplan.counts", {
              courses: counts.courses, placeholders: counts.placeholders })
          : "…"}
      </div>

      {/* Only when the cohort's year count leaves a real choice. */}
      {variants.length > 1 && (
        <select
          value={safeIdx}
          onChange={e => setVariantIdx(Number(e.target.value))}
          style={{
            fontSize: isPhone ? 9 : 10, maxWidth: "100%", marginBottom: 6,
            background: "var(--bg-2)", color: "var(--text-2)",
            border: "1px solid var(--border-1)", borderRadius: 4, padding: "2px 4px",
          }}
        >
          {variants.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
        </select>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button onClick={primary} style={primaryBtn(isPhone)}>{primaryLabel}</button>
        {/* Destructive, so never the default and always confirmed. */}
        {offer.verbs.includes("replace") && (
          <button onClick={replace} style={linkBtn}>{t("grad.plan.replace")}</button>
        )}
      </div>
    </div>
  );
}

const shortName = (p) => String(p ?? "").split("/").pop().replace(/_/g, " ");

function Row({ children, isPhone }) {
  return (
    <div style={{
      margin: "8px 0 10px", padding: isPhone ? "7px 8px" : "9px 10px", borderRadius: 6,
      border: "1px solid var(--border-2)", background: "var(--bg-surface-2)",
      display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
      fontSize: isPhone ? 9 : 10,
    }}>{children}</div>
  );
}

const primaryBtn = (isPhone) => ({
  fontSize: isPhone ? 9 : 10, fontWeight: 600, padding: "3px 10px", borderRadius: 5,
  cursor: "pointer", border: "1px solid var(--border-1)",
  background: "var(--bg-2)", color: "var(--text-2)",
});
const linkBtn = {
  fontSize: 10, background: "transparent", border: "none", color: "var(--link-1)",
  cursor: "pointer", padding: 0,
};
