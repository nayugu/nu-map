// ═══════════════════════════════════════════════════════════════════
// GRADE POPOVER — the grade entry UI, in the schedule/availability
// popover's shape: fixed width, measured-and-clamped placement,
// portalled to document.body (an ancestor transform:scale would
// otherwise break position:fixed).
//
// Opens on CLICK on both platforms — unlike the schedule popover this
// one is an input, not a display, so it must be interactive and must
// not vanish when the pointer crosses the gap to it. Backdrop tap/click
// dismisses.
//
// Sectioned because half the symbols aren't self-explanatory: letters
// are a grid (everyone knows those), while S / U / I / W each carry a
// one-line explanation — an S is NOT "like an A" (credit but no GPA
// effect, and normally only open electives), a W is NOT a failure.
// ═══════════════════════════════════════════════════════════════════
import { useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../context/LanguageContext.jsx";
import { GRADE_POINTS } from "../core/gradeSystem.js";

const WIDTH = 228;
const GAP   = 8;
const EDGE  = 8;

const LETTERS = Object.keys(GRADE_POINTS);           // A … D-, F — grid order
const OTHERS  = ["S", "U", "I", "W"];                // each explained

export default function GradePopover({ pid, grade, rect, setGrade, onDismiss }) {
  const { t } = useLanguage();
  const ref = useRef(null);
  const [placed, setPlaced] = useState(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    let left = rect.left + rect.width / 2 - WIDTH / 2;
    left = Math.min(Math.max(EDGE, left), window.innerWidth - WIDTH - EDGE);
    let top = rect.bottom + GAP;                                   // below the chip…
    if (top + h > window.innerHeight - EDGE) top = rect.top - GAP - h;  // …or above
    top = Math.min(Math.max(EDGE, top), window.innerHeight - h - EDGE);
    setPlaced({ top: Math.round(top), left: Math.round(left) });
  }, [rect]);

  const pick = (g) => { setGrade(pid, g); onDismiss?.(); };

  const cell = (g, selected) => ({
    padding: "4px 0", fontSize: 11, fontWeight: 700, textAlign: "center",
    borderRadius: 5, cursor: "pointer", userSelect: "none",
    border: `1px solid ${selected ? "var(--active)" : "var(--border-2)"}`,
    background: selected ? "var(--badge-bg)" : "transparent",
    color: selected ? "var(--active)" : "var(--text-2)",
  });

  return createPortal(
    <>
      {/* A React portal still bubbles synthetic events through the REACT
          tree, so without these the anchor card sees the pointer as never
          having left (its hover state sticks, and the chip lingers after
          dismissal). Stop the mouse pair here, at the portal boundary. */}
      <div onClick={e => { e.stopPropagation(); onDismiss?.(); }}
           onMouseOver={e => e.stopPropagation()}
           onMouseOut={e => e.stopPropagation()}
           style={{ position: "fixed", inset: 0, zIndex: 9000 }} />
      <div ref={ref}
           onClick={e => e.stopPropagation()}
           onMouseOver={e => e.stopPropagation()}
           onMouseOut={e => e.stopPropagation()}
           style={{
             position: "fixed",
             left: placed ? placed.left : Math.round(rect.left),
             top:  placed ? placed.top  : Math.round(rect.bottom + GAP),
             zIndex: 9001, width: WIDTH, padding: "13px 15px",
             background: "var(--bg-surface)", border: "1px solid var(--border-card)",
             borderRadius: 9, boxShadow: "var(--shadow-modal)",
             fontFamily: "'Inter', system-ui, sans-serif",
             visibility: placed ? "visible" : "hidden",
           }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-4)",
                      letterSpacing: "0.06em", marginBottom: 9 }}>
          <bdi>{t("grade.pop.title")}</bdi>
        </div>

        {/* Letters — a grid needs no explanations */}
        <div style={{ fontSize: 9.5, fontWeight: 600, color: "var(--text-5)", marginBottom: 5 }}>
          <bdi>{t("grade.pop.letters")}</bdi>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
          {LETTERS.map(g => (
            <div key={g} style={cell(g, grade === g)} onClick={() => pick(g)}>{g}</div>
          ))}
        </div>

        {/* S / U / I / W — symbol + one line each */}
        <div style={{ fontSize: 9.5, fontWeight: 600, color: "var(--text-5)",
                      margin: "10px 0 5px" }}>
          <bdi>{t("grade.pop.other")}</bdi>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {OTHERS.map(g => (
            <div key={g} onClick={() => pick(g)}
                 style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 4px",
                          borderRadius: 5, cursor: "pointer",
                          border: `1px solid ${grade === g ? "var(--active)" : "transparent"}`,
                          background: grade === g ? "var(--badge-bg)" : "transparent" }}>
              <span style={{ flexShrink: 0, width: 22, textAlign: "center", fontSize: 11,
                             fontWeight: 800, borderRadius: 4, padding: "2px 0",
                             border: "1px solid var(--border-2)",
                             color: grade === g ? "var(--active)" : "var(--text-2)" }}>{g}</span>
              <span style={{ fontSize: 10, lineHeight: 1.4, color: "var(--text-4)" }}>
                {t(`grade.desc.${g}`)}
              </span>
            </div>
          ))}
        </div>

        {grade != null && (
          <div onClick={() => pick(null)}
               style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid var(--border-2)",
                        fontSize: 10.5, fontWeight: 600, color: "var(--text-4)",
                        cursor: "pointer", textAlign: "center" }}>
            {t("grade.clear")}
          </div>
        )}
      </div>
    </>,
    document.body
  );
}
