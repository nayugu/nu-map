// ═══════════════════════════════════════════════════════════════════
// VERIFICATION POPOVER — what we checked on this program, and what we didn't
//
// Same shape as SchedulePopover: fixed width, measured-and-clamped placement,
// portalled to document.body (an ancestor transform:scale would otherwise
// break position:fixed), opens on hover with no delay.
//
// Written for students and academic advisors, so it names nothing internal —
// no "parser", no "scrape", no "requirement table". It talks about the
// catalog, the sample four-year plan, and the advisor, which the reader
// already has words for. Each check is one line with a mark, so the state is
// readable at a glance rather than parsed out of a paragraph.
//
// The footer is the point of the whole feature: a green badge means we copied
// the catalog correctly, NOT that the requirements are correct. Northeastern
// publishes no second system to check against, so that distinction has to be
// stated every time.
// ═══════════════════════════════════════════════════════════════════
import { useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../context/LanguageContext.jsx";

const WIDTH = 268;
const GAP   = 12;
const EDGE  = 8;

/** pass | fail | na — a mark, a colour, and a line of plain language. */
function CheckRow({ state, children }) {
  const mark = state === "pass" ? "✓" : state === "fail" ? "✕" : "–";
  const color = state === "pass" ? "var(--success-mark, var(--success))"
              : state === "fail" ? "var(--warn, var(--text-2))"
              : "var(--text-5)";
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span style={{ flexShrink: 0, width: 10, textAlign: "center", fontSize: 10,
                     fontWeight: 800, color, lineHeight: "16px" }}>{mark}</span>
      <span style={{ fontSize: 11, lineHeight: 1.45,
                     color: state === "na" ? "var(--text-5)" : "var(--text-3)" }}>{children}</span>
    </div>
  );
}

export default function VerificationPopover({ verification, level, rect }) {
  const { t } = useLanguage();
  const ref = useRef(null);
  const [placed, setPlaced] = useState(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    let left = rect.left + rect.width / 2 - WIDTH / 2;               // centred over the pill
    left = Math.min(Math.max(EDGE, left), window.innerWidth - WIDTH - EDGE);
    let top = rect.top - GAP - h;                                    // above the pill…
    if (top < EDGE) top = rect.bottom + GAP;                         // …or below if it'd clip
    top = Math.min(Math.max(EDGE, top), window.innerHeight - h - EDGE);
    setPlaced({ top: Math.round(top), left: Math.round(left) });
  }, [rect, verification]);

  const c        = verification?.counters ?? {};
  const sources  = verification?.sourcesAvailable ?? [];
  const hasPlan  = sources.includes("plan-of-study");
  const num      = k => (Number.isFinite(c[k]) ? c[k] : 0);

  // Whether a sample plan was ever expected. 98% of undergraduate majors
  // publish one; minors and certificates never do. Saying "no plan to compare
  // against" without that context reads as a gap in OUR work rather than
  // simply how minors are published.
  const planExpected = verification?.kind === "major";

  // Each row: did the check pass, fail, or was it unavailable? Order runs
  // strongest evidence first, so the most meaningful line is read first.
  const rows = [
    { state: num("tablesUnaccounted") === 0 ? "pass" : "fail",
      text:  t("verify.pop.complete") },
    { state: !hasPlan ? "na" : num("planUnexplained") === 0 ? "pass" : "fail",
      text:  hasPlan ? t("verify.pop.plan")
           : planExpected ? t("verify.pop.planMissing") : t("verify.pop.planNA") },
    { state: num("unknownCourses") === 0 ? "pass" : "fail",
      text:  t("verify.pop.courses") },
    { state: num("zeroTotal") === 0 ? "pass" : "na",
      text:  num("zeroTotal") === 0 ? t("verify.pop.total") : t("verify.pop.totalNone") },
  ];

  const headline = level === "verified" ? t("verify.pop.headline.verified")
                 : level === "partial"  ? t("verify.pop.headline.partial")
                 : t("verify.pop.headline.review");

  return createPortal(
    <div ref={ref} style={{
      position: "fixed",
      left: placed ? placed.left : Math.round(rect.left + rect.width / 2 - WIDTH / 2),
      top:  placed ? placed.top  : Math.round(rect.top - GAP),
      zIndex: 9000, width: WIDTH, padding: "15px 17px",
      background: "var(--bg-surface)", border: "1px solid var(--border-card)",
      borderRadius: 9, boxShadow: "var(--shadow-modal)", pointerEvents: "none",
      fontFamily: "'Inter', system-ui, sans-serif",
      visibility: placed ? "visible" : "hidden",
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-4)",
                    letterSpacing: "0.06em", marginBottom: 9 }}>
        <bdi>{t("verify.pop.title")}</bdi>
      </div>

      <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--text-2)",
                    fontWeight: 600, marginBottom: 11 }}>
        <bdi>{headline}</bdi>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {rows.map((r, i) => <CheckRow key={i} state={r.state}>{r.text}</CheckRow>)}
      </div>

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border-2)",
                    fontSize: 10.5, lineHeight: 1.5, color: "var(--text-4)" }}>
        <bdi>{t("verify.pop.caveat")}</bdi>
      </div>
    </div>,
    document.body
  );
}
