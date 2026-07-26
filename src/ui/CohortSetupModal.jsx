import { useState, useEffect } from "react";
import { usePlanner }      from "../context/PlannerContext.jsx";
import { usePort }         from "../context/InstitutionContext.jsx";
import { IInstitution }    from "../ports/IInstitution.js";
import { useLanguage }     from "../context/LanguageContext.jsx";
import YearStepper         from "./YearStepper.jsx";
import { NUM_YEARS }       from "../core/constants.js";

const MAX_GRAD_YEAR   = 2040;
const GRAD_YEARS      = 2;

export default function CohortSetupModal() {
  const {
    planEntSem, planEntYear, planGradSem, planGradYear,
    semOrd, setEntSem, setEntYear, setGradSem, setGradYear,
    showCohortSetup, setShowCohortSetup,
    studentType: savedStudentType, setStudentType,
  } = usePlanner();
  const institution = usePort(IInstitution);
  const { t } = useLanguage();

  const [localStudentType, setLocalStudentType] = useState(savedStudentType);
  const [entSem,   setLocalEntSem]   = useState(planEntSem);
  const [entYear,  setLocalEntYear]  = useState(planEntYear);
  const [gradSem,  setLocalGradSem]  = useState(planGradSem);
  const [gradYear, setLocalGradYear] = useState(planGradYear);

  const maxEntYear = new Date().getFullYear() + 1;

  useEffect(() => {
    if (!showCohortSetup) return;
    const onKey = (e) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCohortSetup]);

  if (!showCohortSetup) return null;

  const entOrd  = semOrd(entSem,  entYear);
  const gradOrd = semOrd(gradSem, gradYear);

  const durationYrs = ((gradYear * 2 + (gradSem === "fall" ? 1 : 0)) -
                       (entYear  * 2 + (entSem  === "fall" ? 1 : 0)) + 1) / 2;

  const switchStudentType = (type) => {
    setLocalStudentType(type);
    const defaultYears = type === "graduate" ? GRAD_YEARS : NUM_YEARS;
    setLocalGradYear(entYear + defaultYears);
    setLocalGradSem(type === "graduate" ? "spring" : "spring");
  };

  const dismiss = () => {
    if (localStudentType !== savedStudentType) setStudentType(localStudentType);
    setEntSem(entSem);
    setEntYear(entYear);
    setGradSem(gradSem);
    setGradYear(gradYear);
    try { localStorage.setItem(`${institution.storagePrefix}-seen-cohort-setup`, "1"); } catch {}
    setShowCohortSetup(false);
  };

  const btnBase = {
    flex: 1, fontSize: 9, padding: "4px 0", borderRadius: 4, cursor: "pointer",
  };

  return (
    <div
      onClick={dismiss}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.65)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 14,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--bg-surface)", border: "1px solid var(--border-2)",
          borderRadius: 12, maxWidth: 300, width: "100%",
          padding: "18px 16px 16px", boxShadow: "var(--shadow-modal)",
          color: "var(--text-2)", fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text-1)", marginBottom: 4 }}>
            Welcome to {institution.appName}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-4)", lineHeight: "calc(1.5 * var(--lh-scale, 1))" }}>
            Set your cohort dates so the planner can track your progress accurately.
          </div>
        </div>

        {/* Student type */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 6 }}>
            STUDENT TYPE
          </div>
          <div style={{ display: "flex", borderRadius: 4, overflow: "hidden", border: "1px solid var(--border-2)" }}>
            {[["undergrad", "Undergraduate"], ["graduate", "Graduate"]].map(([val, label]) => (
              <button key={val} onClick={() => switchStudentType(val)}
                style={{
                  flex: 1, fontSize: 9, padding: "4px 0", cursor: "pointer",
                  background: localStudentType === val ? "var(--active-bg)" : "transparent",
                  border: "none",
                  borderRight: val === "undergrad" ? "1px solid var(--border-2)" : "none",
                  color: localStudentType === val ? "var(--active)" : "var(--text-4)",
                  fontWeight: localStudentType === val ? 700 : 400,
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Entry */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 6 }}>
            {t("header.cohort.entry").toUpperCase()}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {["fall", "spring"].map(s => {
              const wouldBe = semOrd(s, entYear);
              const blocked = wouldBe >= gradOrd;
              return (
                <button key={s} onClick={() => { if (!blocked) setLocalEntSem(s); }} style={{
                  ...btnBase,
                  cursor: blocked ? "not-allowed" : "pointer",
                  background: entSem === s ? (s === "fall" ? "var(--sel-fall-bg)" : "var(--sel-spr-bg)") : "transparent",
                  border: `1px solid ${entSem === s ? (s === "fall" ? "var(--sel-fall-border)" : "var(--sel-spr-border)") : blocked ? "var(--blocked-border)" : "var(--border-2)"}`,
                  color: entSem === s ? (s === "fall" ? "var(--sel-fall-text)" : "var(--sel-spr-text)") : blocked ? "var(--blocked-text)" : "var(--text-4)",
                  fontWeight: entSem === s ? 700 : 400, opacity: blocked ? 0.4 : 1,
                }}>
                  {s === "fall" ? t("header.cohort.fall") : t("header.cohort.spring")}
                </button>
              );
            })}
            <YearStepper
              year={entYear} min={2010} max={maxEntYear}
              canInc={entOrd + 2 < gradOrd && entYear < maxEntYear}
              onDec={() => { if (entYear > 2010) setLocalEntYear(entYear - 1); }}
              onInc={() => { if (entOrd + 2 < gradOrd && entYear < maxEntYear) setLocalEntYear(entYear + 1); }}
            />
          </div>
        </div>

        {/* Graduation */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 6 }}>
            {t("header.cohort.graduation").toUpperCase()}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {["fall", "spring"].map(s => {
              const wouldBe = semOrd(s, gradYear);
              const blocked = wouldBe <= entOrd;
              return (
                <button key={s} onClick={() => { if (!blocked) setLocalGradSem(s); }} style={{
                  ...btnBase,
                  cursor: blocked ? "not-allowed" : "pointer",
                  background: gradSem === s ? (s === "fall" ? "var(--sel-fall-bg)" : "var(--sel-spr-bg)") : "transparent",
                  border: `1px solid ${gradSem === s ? (s === "fall" ? "var(--sel-fall-border)" : "var(--sel-spr-border)") : blocked ? "var(--blocked-border)" : "var(--border-2)"}`,
                  color: gradSem === s ? (s === "fall" ? "var(--sel-fall-text)" : "var(--sel-spr-text)") : blocked ? "var(--blocked-text)" : "var(--text-4)",
                  fontWeight: gradSem === s ? 700 : 400, opacity: blocked ? 0.4 : 1,
                }}>
                  {s === "fall" ? t("header.cohort.fall") : t("header.cohort.spring")}
                </button>
              );
            })}
            <YearStepper
              year={gradYear} min={2010} max={MAX_GRAD_YEAR}
              canDec={gradOrd - 2 > entOrd}
              onDec={() => { if (gradOrd - 2 > entOrd && gradYear > 2010) setLocalGradYear(gradYear - 1); }}
              onInc={() => { if (gradYear < MAX_GRAD_YEAR) setLocalGradYear(gradYear + 1); }}
            />
          </div>
        </div>

        {/* Summary */}
        <div style={{
          fontSize: 9, color: "var(--text-6)", lineHeight: "calc(1.6 * var(--lh-scale, 1))",
          borderTop: "1px solid var(--border-1)", paddingTop: 8, marginBottom: 14,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span>
            {entSem  === "fall" ? t("header.cohort.fall") : t("header.cohort.spring")} {entYear}
            {" → "}
            {gradSem === "fall" ? t("header.cohort.fall") : t("header.cohort.spring")} {gradYear}
          </span>
          {gradOrd <= entOrd
            ? <span style={{ color: "var(--error)" }}>{t("header.cohort.error")}</span>
            : <span style={{ color: "var(--success)" }}>{t("header.cohort.duration", { yrs: durationYrs })}</span>
          }
        </div>

        {/* CTA */}
        <button
          onClick={dismiss}
          style={{
            width: "100%", fontSize: 11, fontWeight: 700,
            padding: "8px 16px", borderRadius: 6, cursor: "pointer",
            background: "var(--link-bg)", border: "1px solid var(--link-1)",
            color: "var(--link-1)",
          }}
        >
          Get started
        </button>
      </div>
    </div>
  );
}
