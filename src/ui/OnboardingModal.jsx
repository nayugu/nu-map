// ═══════════════════════════════════════════════════════════════════
// ONBOARDING MODAL  (first-run setup — flows straight into the tour)
//
// Two short steps, then it hands off to the feature tour:
//   1) cohort   — student type + entry/graduation terms
//   2) program  — major(s) + minor(s)
//
// Finishing OR skipping commits the setup via finishOnboarding() (which then
// auto-opens the tour), so there's no separate "start / example plan" choice —
// the user always lands in the video walkthrough next. Typography matches the
// tour (InterTight, larger sizes) so the whole flow reads as one piece.
// ═══════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useRef } from "react";
import { usePlanner }         from "../context/PlannerContext.jsx";
import { usePort }            from "../context/InstitutionContext.jsx";
import { IInstitution }       from "../ports/IInstitution.js";
import { IMajorRequirements } from "../ports/IMajorRequirements.js";
import { useLanguage }        from "../context/LanguageContext.jsx";
import { SearchCombo }        from "./GradPanel.jsx";
import YearStepper            from "./YearStepper.jsx";
import { NUM_YEARS }          from "../core/constants.js";
import { cohortCatalogYear } from "../data/programPaths.js";
import { sampleplanOffer, variantsFor, describeTemplate } from "../core/planTemplate.js";

const MAX_GRAD_YEAR = 2040;
const GRAD_YEARS    = 2;
const STEPS = 2;

export default function OnboardingModal() {
  const {
    planEntSem, planEntYear, planGradSem, planGradYear, semOrd,
    studentType: savedStudentType,
    major: savedMajor, major2: savedMajor2, minor1: savedMinor1, minor2: savedMinor2,
    showCohortSetup, finishOnboarding,
    SEMESTERS, courseMap,
  } = usePlanner();
  const institution       = usePort(IInstitution);
  const majorRequirements = usePort(IMajorRequirements);
  const { t } = useLanguage();

  const [step, setStep] = useState(0);

  // Local working copy — nothing is committed until finish/skip.
  const [studentType, setStudentType] = useState(savedStudentType || "undergrad");
  const [entSem,   setEntSem]   = useState(planEntSem);
  const [entYear,  setEntYear]  = useState(planEntYear);
  const [gradSem,  setGradSem]  = useState(planGradSem);
  const [gradYear, setGradYear] = useState(planGradYear);
  const [major,    setMajor]    = useState(savedMajor  || "");
  const [major2,   setMajor2]   = useState(savedMajor2 || "");
  const [minor1,   setMinor1]   = useState(savedMinor1 || "");
  const [minor2,   setMinor2]   = useState(savedMinor2 || "");
  const [showMajor2, setShowMajor2] = useState(!!savedMajor2);

  const isGrad     = studentType === "graduate";
  const maxEntYear = new Date().getFullYear() + 1;

  const majorGroups = useMemo(
    () => isGrad ? majorRequirements.getGradMajorOptionGroups(cohortCatalogYear(entSem, entYear))
                 : majorRequirements.getMajorOptionGroups(cohortCatalogYear(entSem, entYear)),
    [majorRequirements, isGrad, entSem, entYear]
  );
  const minorGroups = useMemo(() => majorRequirements.getMinorOptionGroups(cohortCatalogYear(entSem, entYear)), [majorRequirements, entSem, entYear]);

  // Cohort arithmetic. Computed ABOVE the hooks that read it and above the
  // early return: a hook referencing a `const` declared further down throws
  // "Cannot access before initialization" on every render, which took the whole
  // modal out. Pure derivations of state, so there is nothing to gain by
  // deferring them.
  const entOrd  = semOrd(entSem,  entYear);
  const gradOrd = semOrd(gradSem, gradYear);
  const cohortValid = gradOrd > entOrd;
  const durationYrs = ((gradYear * 2 + (gradSem === "fall" ? 1 : 0)) -
                       (entYear  * 2 + (entSem  === "fall" ? 1 : 0)) + 1) / 2;

  // ── The department's sample plan ────────────────────────────────
  const [samplePlans,   setSamplePlans]   = useState(null);   // variants, or null
  const [useSamplePlan, setUseSamplePlan] = useState(true);   // default on: see below
  const [variantIdx,    setVariantIdx]    = useState(0);

  // Question 1 of the rule — is there anything to offer? Synchronous, so the
  // box never flickers in for a program that publishes nothing.
  const hasSamplePlan = !!major && !!majorRequirements.hasSamplePlan?.(major, isGrad);

  useEffect(() => {
    setSamplePlans(null); setVariantIdx(0);
    if (!hasSamplePlan) return;
    let live = true;
    majorRequirements.loadSamplePlans(major, isGrad)
      .then(g => { if (live) setSamplePlans(g?.plans ?? null); })
      .catch(() => { if (live) setSamplePlans(null); });
    return () => { live = false; };
  }, [major, isGrad, hasSamplePlan, majorRequirements]);

  // The offer rule, shared with every other surface that asks. The canvas is
  // empty by definition during first-run setup, so the verb is always "load".
  const samplePlanOffer = useMemo(() => sampleplanOffer({
    major, major2, hasSamplePlan, appliedTemplate: null, canvasEmpty: true,
  }), [major, major2, hasSamplePlan]);

  // Year count comes from the cohort the student just set, and a variant's
  // length is COUNTED from its own shape — never parsed out of "Four Years",
  // which would tie this to English.
  const offeredVariants = useMemo(
    () => variantsFor(samplePlans ?? [], { years: Math.round(durationYrs) }),
    [samplePlans, durationYrs]);

  const chosenVariant = offeredVariants[variantIdx] ?? offeredVariants[0] ?? null;

  // What loading it would actually do, counted by doing it against this
  // student's own timeline — so the numbers on the box are the ones they get.
  const samplePlanCounts = useMemo(() => {
    if (!chosenVariant) return null;
    return describeTemplate(chosenVariant, { semesters: SEMESTERS, courseMap });
  }, [chosenVariant, SEMESTERS, courseMap]);

  const dialogRef = useRef(null);
  const skipRef   = useRef(() => {});
  // Subscribe once per open (not per keystroke); the listener calls the latest
  // skip via a ref, and focus moves into the dialog when it opens.
  useEffect(() => {
    if (!showCohortSetup) return;
    dialogRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") skipRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showCohortSetup]);

  if (!showCohortSetup) return null;

  const switchStudentType = (type) => {
    setStudentType(type);
    // Grad programs live in a different data tree — a major picked as undergrad
    // won't resolve, so clear the program picks on a type switch.
    setMajor(""); setMajor2(""); setMinor1(""); setMinor2(""); setShowMajor2(false);
    const yrs = type === "graduate" ? GRAD_YEARS : NUM_YEARS;
    setGradYear(entYear + yrs);
    setGradSem("spring");
  };

  const setup  = () => ({
    studentType, entSem, entYear, gradSem, gradYear, major, major2, minor1, minor2, conc: "",
    // Handed to finishOnboarding rather than applied here: the cohort this plan
    // has to be laid out against is set by that same call, so applying from the
    // modal would use the PREVIOUS timeline.
    ...(samplePlanOffer.offer && useSamplePlan && chosenVariant
      ? { samplePlan: chosenVariant, samplePlanKey: major }
      : {}),
  });
  // Skip or finish both commit the setup; finishOnboarding then opens the tour.
  const skip   = () => finishOnboarding(setup());
  skipRef.current = skip;
  const finish = () => finishOnboarding(setup());
  const advance = () => { if (!cohortValid) return; if (step < STEPS - 1) setStep(step + 1); else finish(); };

  // ── shared styling (matches the feature tour) ─────────────────
  const titleText = { fontSize: 25, fontWeight: 800, color: "var(--text-1)", marginBottom: 8 };
  const subText   = {
    fontSize: 17, color: "var(--text-3)", lineHeight: "calc(1.55 * var(--lh-scale, 1))",
    fontFamily: "'InterTight', 'Inter', system-ui, sans-serif", letterSpacing: "0.01em",
  };
  const sectionLabel = { fontSize: 13, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.04em", marginBottom: 8 };
  const btnBase      = { flex: 1, fontSize: 14, padding: "9px 0", borderRadius: 6, cursor: "pointer" };
  const semBtn = (s, sel, blocked) => ({
    ...btnBase,
    cursor: blocked ? "not-allowed" : "pointer",
    background: sel ? (s === "fall" ? "var(--sel-fall-bg)" : "var(--sel-spr-bg)") : "transparent",
    border: `1px solid ${sel ? (s === "fall" ? "var(--sel-fall-border)" : "var(--sel-spr-border)") : blocked ? "var(--blocked-border)" : "var(--border-2)"}`,
    color: sel ? (s === "fall" ? "var(--sel-fall-text)" : "var(--sel-spr-text)") : blocked ? "var(--blocked-text)" : "var(--text-4)",
    fontWeight: sel ? 700 : 400, opacity: blocked ? 0.4 : 1,
  });

  return (
    <div
      onClick={skip}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.65)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--bg-surface)", border: "1px solid var(--border-2)",
          borderRadius: 16, maxWidth: 520, width: "100%",
          padding: "28px 28px 22px", boxShadow: "var(--shadow-modal)",
          color: "var(--text-2)", fontFamily: "'Inter', system-ui, sans-serif",
          outline: "none",
        }}
      >
        {/* Step dots */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {Array.from({ length: STEPS }).map((_, i) => (
            <div key={i} style={{
              flex: 1, height: 4, borderRadius: 2,
              background: i <= step ? "var(--link-1)" : "var(--border-2)",
            }} />
          ))}
        </div>

        {/* ── Step 1: cohort ── */}
        {step === 0 && (
          <>
            <div style={{ marginBottom: 18 }}>
              <div id="onboarding-title" style={titleText}>{t("onboard.cohort.title", { app: institution.appName })}</div>
              <div style={subText}>{t("onboard.cohort.sub")}</div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabel}>{t("onboard.studentType")}</div>
              <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border-2)" }}>
                {[["undergrad", t("header.plan.group.undergrad")], ["graduate", t("header.plan.group.graduate")]].map(([val, label]) => (
                  <button key={val} onClick={() => switchStudentType(val)} style={{
                    flex: 1, fontSize: 14, padding: "9px 0", cursor: "pointer",
                    background: studentType === val ? "var(--active-bg)" : "transparent", border: "none",
                    borderRight: val === "undergrad" ? "1px solid var(--border-2)" : "none",
                    color: studentType === val ? "var(--active)" : "var(--text-4)",
                    fontWeight: studentType === val ? 700 : 400,
                  }}>{label}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabel}>{t("header.cohort.entry").toUpperCase()}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {["fall", "spring"].map(s => {
                  const blocked = semOrd(s, entYear) >= gradOrd;
                  return (
                    <button key={s} onClick={() => { if (!blocked) setEntSem(s); }} style={semBtn(s, entSem === s, blocked)}>
                      {s === "fall" ? t("header.cohort.fall") : t("header.cohort.spring")}
                    </button>
                  );
                })}
                <YearStepper
                  year={entYear} min={2010} max={maxEntYear} size={15}
                  canInc={entOrd + 2 < gradOrd && entYear < maxEntYear}
                  onDec={() => { if (entYear > 2010) setEntYear(entYear - 1); }}
                  onInc={() => { if (entOrd + 2 < gradOrd && entYear < maxEntYear) setEntYear(entYear + 1); }}
                />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabel}>{t("header.cohort.graduation").toUpperCase()}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {["fall", "spring"].map(s => {
                  const blocked = semOrd(s, gradYear) <= entOrd;
                  return (
                    <button key={s} onClick={() => { if (!blocked) setGradSem(s); }} style={semBtn(s, gradSem === s, blocked)}>
                      {s === "fall" ? t("header.cohort.fall") : t("header.cohort.spring")}
                    </button>
                  );
                })}
                <YearStepper
                  year={gradYear} min={2010} max={MAX_GRAD_YEAR} size={15}
                  canDec={gradOrd - 2 > entOrd}
                  onDec={() => { if (gradOrd - 2 > entOrd && gradYear > 2010) setGradYear(gradYear - 1); }}
                  onInc={() => { if (gradYear < MAX_GRAD_YEAR) setGradYear(gradYear + 1); }}
                />
              </div>
            </div>

            <div style={{
              fontSize: 15, color: "var(--text-5)", lineHeight: "calc(1.6 * var(--lh-scale, 1))",
              borderTop: "1px solid var(--border-1)", paddingTop: 12,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span>
                {entSem === "fall" ? t("header.cohort.fall") : t("header.cohort.spring")} {entYear}
                {" → "}
                {gradSem === "fall" ? t("header.cohort.fall") : t("header.cohort.spring")} {gradYear}
              </span>
              {cohortValid
                ? <span style={{ color: "var(--success)" }}>{t("header.cohort.duration", { yrs: durationYrs })}</span>
                : <span style={{ color: "var(--error)" }}>{t("header.cohort.error")}</span>}
            </div>
          </>
        )}

        {/* ── Step 2: program ── */}
        {step === 1 && (
          <>
            <div style={{ marginBottom: 18 }}>
              <div id="onboarding-title" style={titleText}>{t("onboard.program.title")}</div>
              <div style={subText}>{t(isGrad ? "onboard.program.sub.grad" : "onboard.program.sub")}</div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabel}>{t("onboard.program.major")}</div>
              <SearchCombo value={major} onChange={setMajor} groups={majorGroups} placeholder={t("grad.major.search")} size={16} />
            </div>

            {showMajor2 || major2 ? (
              <div style={{ marginBottom: 16 }}>
                <div style={sectionLabel}>{t("onboard.program.major2")}</div>
                <SearchCombo value={major2} onChange={setMajor2} groups={majorGroups} placeholder={t("grad.major.search")} size={16} />
              </div>
            ) : (
              <button onClick={() => setShowMajor2(true)} style={{
                background: "transparent", border: "none", color: "var(--link-1)",
                fontSize: 15, cursor: "pointer", padding: 0, marginBottom: 16,
              }}>{t("onboard.program.major2.add")}</button>
            )}

            {/* Minors are an undergraduate credential — grad programs use
                concentrations/certificates, so hide this for graduate students. */}
            {!isGrad && (
              <div style={{ marginBottom: 8 }}>
                <div style={sectionLabel}>{t("onboard.program.minors")}</div>
                <div style={{ marginBottom: 8 }}>
                  <SearchCombo value={minor1} onChange={setMinor1} groups={minorGroups} placeholder={t("grad.minor.search")} size={16} />
                </div>
                <SearchCombo value={minor2} onChange={setMinor2} groups={minorGroups} placeholder={t("grad.minor.search")} size={16} />
              </div>
            )}

            {/* ── Start from the department's sample plan ──────────
                Shown only when the chosen program publishes one — 632 of
                1,017 do not, and a box that promises nothing for six users
                in ten is worse than no box.

                Hidden entirely for a true DOUBLE major: a sample plan
                schedules the whole degree (median 131 SH of 128), leaving
                ~28 SH of free electives where a second major needs 40-60.
                Loading one would hand the student four full years to
                dismantle. Combined majors ("X and Y") are a single program
                and are unaffected. ── */}
            {samplePlanOffer.offer && (
              <div style={{
                marginTop: 14, padding: "12px 14px", borderRadius: 9,
                border: "1px solid var(--border-2)", background: "var(--bg-surface-2)",
              }}>
                <label style={{ display: "flex", gap: 10, cursor: "pointer", alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={useSamplePlan}
                    onChange={e => setUseSamplePlan(e.target.checked)}
                    style={{ marginTop: 3, width: 17, height: 17, cursor: "pointer", accentColor: "var(--link-1)" }}
                  />
                  <span>
                    <span style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)" }}>
                      {t("onboard.sampleplan.label")}
                    </span>
                    {/* Says what actually arrives. Half of a sample plan names
                        no course, so "load the plan" sets the wrong
                        expectation and the student meets a wall of blanks. */}
                    <span style={{ display: "block", fontSize: 14, color: "var(--text-4)", marginTop: 3 }}>
                      {samplePlanCounts
                        ? t("onboard.sampleplan.counts", {
                            courses: samplePlanCounts.courses,
                            placeholders: samplePlanCounts.placeholders,
                          })
                        : t("onboard.sampleplan.loading")}
                    </span>
                  </span>
                </label>

                {/* The ONE question the data leaves open. Year count is
                    resolved from the cohort, so what remains is the co-op
                    cycle — a fact about the student, not about plans. */}
                {useSamplePlan && offeredVariants.length > 1 && (
                  <div style={{ marginTop: 10, paddingLeft: 27 }}>
                    <div style={{ fontSize: 13, color: "var(--text-4)", marginBottom: 5 }}>
                      {t("onboard.sampleplan.which")}
                    </div>
                    {offeredVariants.map((p, i) => (
                      <label key={i} style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", marginBottom: 3 }}>
                        <input
                          type="radio"
                          name="sampleplan-variant"
                          checked={variantIdx === i}
                          onChange={() => setVariantIdx(i)}
                          style={{ cursor: "pointer", accentColor: "var(--link-1)" }}
                        />
                        <span style={{ fontSize: 14, color: "var(--text-2)" }}>{p.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div style={{ ...subText, fontSize: 15, color: "var(--text-5)", marginTop: 8 }}>
              {t("onboard.program.skip")}
            </div>
          </>
        )}

        {/* ── Footer nav ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 22 }}>
          <button onClick={skip} style={{
            background: "transparent", border: "1px solid var(--border-2)",
            color: "var(--text-3)", fontSize: 16, fontWeight: 500,
            padding: "11px 26px", borderRadius: 9, cursor: "pointer",
          }}>{t("onboard.skip")}</button>
          <div style={{ flex: 1 }} />
          {step > 0 && (
            <button onClick={() => setStep(step - 1)} style={{
              fontSize: 16, fontWeight: 600, padding: "11px 24px", borderRadius: 9, cursor: "pointer",
              background: "transparent", border: "1px solid var(--border-2)", color: "var(--text-3)",
            }}>{t("onboard.back")}</button>
          )}
          <button onClick={advance} disabled={!cohortValid} style={{
            fontSize: 16, fontWeight: 700, padding: "11px 26px", borderRadius: 9,
            cursor: cohortValid ? "pointer" : "not-allowed",
            background: cohortValid ? "var(--link-bg)" : "var(--bg-surface-2)",
            border: `1px solid ${cohortValid ? "var(--link-1)" : "var(--border-2)"}`,
            color: cohortValid ? "var(--link-1)" : "var(--text-5)",
          }}>{t("onboard.next")}</button>
        </div>
      </div>
    </div>
  );
}
