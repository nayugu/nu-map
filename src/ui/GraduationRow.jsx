import { useRef, useEffect } from "react";
import { usePlanner }   from "../context/PlannerContext.jsx";
import { useLanguage }  from "../context/LanguageContext.jsx";
import { TText }        from "../context/TranslationContext.jsx";
import { fireConfetti } from "./confetti.js";

export default function GraduationRow() {
  const { gradSemId, currentSemId, SEMESTERS, isGraduated, setIsGraduated, isPhone } = usePlanner();
  const { t } = useLanguage();
  const rowRef = useRef(null);
  const prevGraduatedRef = useRef(isGraduated);

  const gradSem   = SEMESTERS.find(s => s.id === gradSemId);
  const gradLabel = gradSem?.label ?? gradSemId;

  const isReady = currentSemId === gradSemId && !isGraduated;

  // Fire confetti whenever graduation transitions false → true (covers both manual and auto).
  useEffect(() => {
    if (isGraduated && !prevGraduatedRef.current && rowRef.current) {
      fireConfetti(rowRef.current);
    }
    prevGraduatedRef.current = isGraduated;
  }, [isGraduated]);

  const handleGraduate = e => {
    e.stopPropagation();
    setIsGraduated(true);
  };

  const handleUngraduate = e => {
    e.stopPropagation();
    setIsGraduated(false);
  };

  if (isGraduated) {
    return (
      <div
        ref={rowRef}
        onClick={handleUngraduate}
        title="Click to undo graduation"
        style={{
          margin: "6px 0 16px",
          borderRadius: 8,
          background: "var(--card-bg)",
          border: "1.5px solid var(--success-border)",
          padding: "11px 20px",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: isPhone ? 16 : 22, lineHeight: 1 }}>🎓</span>
        {isPhone ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--success)" }}>{t("grad.row.done")}</span>
            <span style={{ fontSize: 9, fontWeight: 500, color: "var(--success)" }}><TText>{gradLabel}</TText></span>
          </div>
        ) : (
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--success)" }}>
            {t("grad.row.done")} · <TText>{gradLabel}</TText>
          </span>
        )}
        <span style={{ fontSize: isPhone ? 8 : 10, color: "var(--text-4)", marginLeft: 4 }}>{t("grad.row.undo")}</span>
      </div>
    );
  }

  return (
    <div
      ref={rowRef}
      style={{
        margin: "6px 0 16px",
        borderRadius: 8,
        border: isReady ? "1.5px solid var(--success-border)" : "1.5px dashed var(--border-2)",
        background: "var(--card-bg)",
        padding: "10px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        opacity: isReady ? 1 : 0.42,
        transition: "opacity 0.25s, border-color 0.25s, background 0.25s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: isPhone ? 14 : 18, lineHeight: 1 }}>🎓</span>
        {isPhone ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: isReady ? "var(--success)" : "var(--text-3)" }}>{t("grad.row.title")}</span>
            <span style={{ fontSize: 8, fontWeight: 500, color: isReady ? "var(--success)" : "var(--text-4)" }}><TText>{gradLabel}</TText></span>
          </div>
        ) : (
          <span style={{ fontSize: 12, fontWeight: 600, color: isReady ? "var(--success)" : "var(--text-3)" }}>
            {t("grad.row.title")} · <TText>{gradLabel}</TText>
          </span>
        )}
      </div>
      {isReady && (
        <button
          onClick={handleGraduate}
          style={{
            background: "var(--success)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "6px 18px",
            fontSize: isPhone ? 10 : 12,
            fontWeight: 700,
            cursor: "pointer",
            letterSpacing: "0.03em",
          }}
        >
          {t("grad.row.button")}
        </button>
      )}
    </div>
  );
}
