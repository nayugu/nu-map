import { useState, useEffect, useRef } from "react";
import { usePlanner }    from "../context/PlannerContext.jsx";
import { useLanguage }   from "../context/LanguageContext.jsx";
import YearStepper       from "./YearStepper.jsx";
import { NUM_YEARS }     from "../core/constants.js";
import { folderPath }    from "../core/planFolders.js";
import { FolderIcon }    from "./PlanTree.jsx";

const MAX_GRAD_YEAR = 2040;
const GRAD_YEARS    = 2;

export default function NewPlanModal({ open, onClose }) {
  const {
    planEntSem, planEntYear, planGradSem, planGradYear,
    semOrd, createPlan, studentType: activeStudentType,
    newPlanInitialType, setNewPlanInitialType,
    newPlanFolderId, setNewPlanFolderId, planTree,
  } = usePlanner();
  const { t } = useLanguage();

  const [name,        setName]        = useState("");
  const [studentType, setStudentType] = useState("undergrad");
  const [entSem,      setLocalEntSem]  = useState("fall");
  const [entYear,     setLocalEntYear] = useState(new Date().getFullYear());
  const [gradSem,     setLocalGradSem] = useState("spring");
  const [gradYear,    setLocalGradYear]= useState(new Date().getFullYear() + NUM_YEARS);

  const nameRef    = useRef(null);
  const maxEntYear = new Date().getFullYear() + 1;

  // Seed local state from the active plan's cohort every time the modal opens.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    setName("");
    const seedType = newPlanInitialType ?? activeStudentType;
    const defaultYears = seedType === "graduate" ? GRAD_YEARS : NUM_YEARS;
    setStudentType(seedType);
    setLocalEntSem(planEntSem);
    setLocalEntYear(planEntYear);
    setLocalGradSem(planGradSem);
    setLocalGradYear(newPlanInitialType ? planEntYear + defaultYears : planGradYear);
    if (newPlanInitialType) setNewPlanInitialType(null);
    setTimeout(() => nameRef.current?.focus(), 0);
  }, [open]);

  // Closing must clear the destination folder, or the NEXT plan created from
  // the header would silently land in whatever folder was targeted last.
  const dismiss = () => { setNewPlanFolderId(null); onClose(); };

  // Escape to dismiss
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);

  if (!open) return null;

  const entOrd  = semOrd(entSem,  entYear);
  const gradOrd = semOrd(gradSem, gradYear);
  const canCreate = name.trim().length > 0 && gradOrd > entOrd;

  // Duration in years, same formula as the cohort picker in the header.
  const durationYrs = ((gradYear * 2 + (gradSem === "fall" ? 1 : 0)) -
                       (entYear  * 2 + (entSem  === "fall" ? 1 : 0)) + 1) / 2;

  const switchStudentType = (type) => {
    setStudentType(type);
    const defaultYears = type === "graduate" ? GRAD_YEARS : NUM_YEARS;
    setLocalGradYear(entYear + defaultYears);
    setLocalGradSem("spring");
  };

  const submit = () => {
    if (!canCreate) return;
    createPlan(name.trim(), { entSem, entYear, gradSem, gradYear, studentType }, newPlanFolderId);
    dismiss();
  };

  // Where it will land, when that isn't the root — otherwise "+ New plan" from
  // inside a folder gives no sign it filed the plan somewhere.
  const destination = newPlanFolderId ? folderPath(planTree, newPlanFolderId) : "";

  const semBtnStyle = (s, isSel, isBlocked) => ({
    flex: 1, fontSize: 9, padding: "4px 0", borderRadius: 4,
    cursor: isBlocked ? "not-allowed" : "pointer",
    background: isSel ? (s === "fall" ? "var(--sel-fall-bg)" : "var(--sel-spr-bg)") : "transparent",
    border: `1px solid ${isSel ? (s === "fall" ? "var(--sel-fall-border)" : "var(--sel-spr-border)") : isBlocked ? "var(--blocked-border)" : "var(--border-2)"}`,
    color: isSel ? (s === "fall" ? "var(--sel-fall-text)" : "var(--sel-spr-text)") : isBlocked ? "var(--blocked-text)" : "var(--text-4)",
    fontWeight: isSel ? 700 : 400, opacity: isBlocked ? 0.4 : 1,
  });

  return (
    <div
      onClick={dismiss}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 14,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--bg-surface)", border: "1px solid var(--border-2)",
          borderRadius: 12, maxWidth: 290, width: "100%",
          padding: "16px 16px 14px", boxShadow: "var(--shadow-modal)",
          color: "var(--text-2)", fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        {/* Title */}
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-1)", marginBottom: destination ? 4 : 14 }}>
          {t("header.plan.new.title")}
        </div>
        {destination && (
          <div style={{ fontSize: 9, color: "var(--text-5)", marginBottom: 12, display: "flex", alignItems: "center", gap: 4 }}>
            <FolderIcon size={11} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {t("folders.newPlanIn", { path: destination })}
            </span>
          </div>
        )}

        {/* Name */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 5 }}>
            {t("header.plan.new.name")}
          </div>
          <input
            ref={nameRef}
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") submit(); }}
            placeholder="e.g. Plan A"
            style={{
              width: "100%", boxSizing: "border-box",
              fontSize: 12, padding: "6px 8px", borderRadius: 6,
              background: "var(--bg-app)", border: "1px solid var(--border-2)",
              color: "var(--text-1)", outline: "none",
              fontFamily: "inherit",
            }}
          />
        </div>

        {/* Student type */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em", marginBottom: 5 }}>
            STUDENT TYPE
          </div>
          <div style={{ display: "flex", borderRadius: 4, overflow: "hidden", border: "1px solid var(--border-2)" }}>
            {[["undergrad", "Undergraduate"], ["graduate", "Graduate"]].map(([val, label]) => (
              <button key={val} onClick={() => switchStudentType(val)}
                style={{
                  flex: 1, fontSize: 9, padding: "4px 0", cursor: "pointer",
                  background: studentType === val ? "var(--active-bg)" : "transparent",
                  border: "none",
                  borderRight: val === "undergrad" ? "1px solid var(--border-2)" : "none",
                  color: studentType === val ? "var(--active)" : "var(--text-4)",
                  fontWeight: studentType === val ? 700 : 400,
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
                <button key={s} onClick={() => { if (!blocked) setLocalEntSem(s); }}
                  style={semBtnStyle(s, entSem === s, blocked)}>
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
                <button key={s} onClick={() => { if (!blocked) setLocalGradSem(s); }}
                  style={semBtnStyle(s, gradSem === s, blocked)}>
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
          borderTop: "1px solid var(--border-1)", paddingTop: 8, marginBottom: 12,
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

        {/* Create button */}
        <button
          onClick={submit}
          disabled={!canCreate}
          style={{
            width: "100%", fontSize: 11, fontWeight: 700,
            padding: "7px 16px", borderRadius: 6, cursor: canCreate ? "pointer" : "not-allowed",
            background: canCreate ? "var(--link-bg)" : "var(--bg-surface-2)",
            border: `1px solid ${canCreate ? "var(--link-1)" : "var(--border-2)"}`,
            color: canCreate ? "var(--link-1)" : "var(--text-5)",
          }}
        >
          {t("header.plan.new.create")}
        </button>
      </div>
    </div>
  );
}
