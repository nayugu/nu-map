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
import { REL_STYLE } from "../core/constants.js";

const WIDTH = 268;
const GAP   = 12;
const EDGE  = 8;

/**
 * "CS3500" → "CS 3500". Course keys are stored unspaced; nobody reads them
 * that way.
 */
const prettyCourse = k => String(k).replace(/^([A-Z]+)(\d.*)$/, "$1 $2");

/**
 * pass | fail | na — a mark, a colour, a line of plain language, and (when the
 * check failed) the specific things that caused it.
 *
 * The named causes are the difference between "something doesn't line up" and
 * a finding an advisor can act on: they can look up ENVR 3300 and decide
 * whether it matters. Without them the popover only restates the badge.
 */
function CheckRow({ state, detail = [], overflow = 0, moreLabel, children }) {
  const mark = state === "pass" ? "✓" : state === "fail" ? "✕" : "–";
  // Same green and red as the header's relationship legend and the badge
  // itself, read from REL_STYLE so the three can't drift apart. The ✕ was a
  // dark yellow, which read as a caution rather than the failure it is.
  const color = state === "pass" ? REL_STYLE.prerequisite.color
              : state === "fail" ? REL_STYLE["prerequisite-order"].color
              : "var(--text-5)";
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span style={{ flexShrink: 0, width: 10, textAlign: "center", fontSize: 10,
                     fontWeight: 800, color, lineHeight: "16px" }}>{mark}</span>
      <div style={{ minWidth: 0 }}>
        <span style={{ fontSize: 11, lineHeight: 1.45,
                       color: state === "na" ? "var(--text-5)" : "var(--text-3)" }}>{children}</span>
        {detail.length > 0 && (
          <div style={{ marginTop: 3, fontSize: 10.5, lineHeight: 1.5, color: "var(--text-4)" }}>
            {detail.map((d, i) => (
              <div key={i} style={{ display: "flex", gap: 5 }}>
                <span style={{ color: "var(--text-5)" }}>·</span>
                <span>{d}</span>
              </div>
            ))}
            {overflow > 0 && (
              <div style={{ marginLeft: 10, color: "var(--text-5)" }}>{moreLabel}</div>
            )}
          </div>
        )}
      </div>
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

  // Find the finding behind a row, so the row can name what caused it.
  const findings = verification?.discrepancies ?? [];
  const causeOf = (...checks) => {
    const d = findings.find(f => checks.includes(f.check));
    if (!d) return { detail: [], overflow: 0 };
    // Course keys read better spaced; anything else is already prose.
    const detail = (d.detail ?? []).map(x => /^[A-Z]+\d/.test(x) ? prettyCourse(x) : x);
    return { detail, overflow: d.overflow ?? 0 };
  };

  // Whether a sample plan was ever expected. 98% of undergraduate majors
  // publish one; minors and certificates never do. Saying "no plan to compare
  // against" without that context reads as a gap in OUR work rather than
  // simply how minors are published.
  const planExpected = verification?.kind === "major";

  // Each row: did the check pass, fail, or was it unavailable? Order runs
  // strongest evidence first, so the most meaningful line is read first.
  const rows = [
    { state: num("tablesUnaccounted") === 0 ? "pass" : "fail",
      text:  t("verify.pop.complete"), ...causeOf("requirement-table-parity") },
    { state: !hasPlan ? "na" : num("planUnexplained") === 0 ? "pass" : "fail",
      text:  hasPlan ? t("verify.pop.plan")
           : planExpected ? t("verify.pop.planMissing") : t("verify.pop.planNA"),
      ...causeOf("plan-witness-unaccounted") },
    { state: num("unknownCourses") === 0 ? "pass" : "fail",
      text:  t("verify.pop.courses"), ...causeOf("unknown-course") },
    { state: num("zeroTotal") === 0 ? "pass" : "na",
      text:  num("zeroTotal") === 0 ? t("verify.pop.total") : t("verify.pop.totalNone") },
  ];

  // Findings with no row of their own — duplicate titles, impossible sections,
  // a leaked marker. Rare, but they must not vanish just because the four
  // standard rows don't cover them.
  const OWNED = new Set(["requirement-table-parity", "plan-witness-unaccounted",
                         "unknown-course", "missing-total-credits", "no-sample-plan",
                         "total-from-sample-plan"]);
  for (const f of findings) {
    if (OWNED.has(f.check) || f.severity === "info") continue;
    rows.push({ state: "fail", text: f.message,
                detail: (f.detail ?? []).map(x => /^[A-Z]+\d/.test(x) ? prettyCourse(x) : x),
                overflow: f.overflow ?? 0 });
  }

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
        {rows.map((r, i) => (
          <CheckRow key={i} state={r.state} detail={r.detail} overflow={r.overflow}
                    moreLabel={t("verify.pop.more", { n: r.overflow })}>
            {r.text}
          </CheckRow>
        ))}
      </div>

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border-2)",
                    fontSize: 10.5, lineHeight: 1.5, color: "var(--text-4)" }}>
        <bdi>{t("verify.pop.caveat")}</bdi>
      </div>
    </div>,
    document.body
  );
}
