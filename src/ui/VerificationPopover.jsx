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
 * A mark, a colour, a line of plain language, and (when something is off) the
 * specific causes.
 *
 * Four states, because three conflated two different things:
 *
 *   pass  ✓  green   the check passed
 *   fail  ✕  red     the check failed AND counts against the program
 *   note  !  muted   worth knowing, but deliberately NOT counted
 *   na    –  muted   this check does not apply to this kind of program
 *
 * `note` exists because a red ✕ next to a green badge is a contradiction the
 * reader is right to distrust. One or two course codes missing from our
 * catalog is almost always our own gap (LAW, DS), so it is graded info and
 * does not colour the badge — but it was still drawing a failure mark. The
 * mark now follows the same severity the badge does.
 *
 * The named causes are the difference between "something doesn't line up" and
 * a finding an advisor can act on.
 */
const LINE = "16px";   // one shared line box, so the mark sits on the first line of text

function CheckRow({ state, detail = [], overflow = 0, moreLabel, children }) {
  const mark = state === "pass" ? "✓" : state === "fail" ? "✕" : state === "note" ? "!" : "–";
  // Same green and red as the header's relationship legend and the badge
  // itself, read from REL_STYLE so the three can't drift apart.
  const color = state === "pass" ? REL_STYLE.prerequisite.color
              : state === "fail" ? REL_STYLE["prerequisite-order"].color
              : "var(--text-5)";
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span style={{ flexShrink: 0, width: 10, textAlign: "center", fontSize: 10,
                     fontWeight: 800, color, lineHeight: LINE }}>{mark}</span>
      <div style={{ minWidth: 0 }}>
        <span style={{ fontSize: 11, lineHeight: LINE, display: "block",
                       color: state === "pass" || state === "fail" ? "var(--text-3)" : "var(--text-5)" }}>{children}</span>
        {detail.length > 0 && (
          <div style={{ marginTop: 5, fontSize: 10.5, lineHeight: 1.5, color: "var(--text-4)",
                        display: "flex", flexDirection: "column", gap: 4 }}>
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

  // Detail bullets ship as { key, params } so they can be translated here
  // rather than baked into the committed data in English. Older data may still
  // hold plain strings; those pass through unchanged.
  const renderDetail = d =>
    typeof d === "string" ? d : t(`verify.detail.${d.key}`, d.params ?? {});

  // Find the finding behind a row, so the row can name what caused it.
  const findings = verification?.discrepancies ?? [];
  const causeOf = (...checks) => {
    const d = findings.find(f => checks.includes(f.check));
    if (!d) return { detail: [], overflow: 0, severity: null };
    // Course keys read better spaced; anything else is already prose.
    return { detail: (d.detail ?? []).map(renderDetail), overflow: d.overflow ?? 0, severity: d.severity };
  };

  // The mark must agree with the badge: only a finding that COUNTS against the
  // program may draw a failure. An info-level finding is a note.
  const markFor = (sev, fallback = "pass") =>
    sev === null || sev === undefined ? fallback
    : sev === "info" ? "note" : "fail";

  // Whether a sample plan was ever expected. 98% of undergraduate majors
  // publish one; minors and certificates never do. Saying "no plan to compare
  // against" without that context reads as a gap in OUR work rather than
  // simply how minors are published.
  const planExpected = verification?.kind === "major";

  // Each row: did the check pass, fail, or was it unavailable? Order runs
  // strongest evidence first, so the most meaningful line is read first.
  const tables = causeOf("requirement-table-parity");
  const planC  = causeOf("plan-witness-unaccounted");
  const course = causeOf("unknown-course");
  const total  = causeOf("missing-total-credits", "total-from-sample-plan");

  const rows = [
    { state: markFor(tables.severity), text: t("verify.pop.complete"), ...tables },
    { state: !hasPlan ? "na" : markFor(planC.severity),
      text:  hasPlan ? t("verify.pop.plan")
           : planExpected ? t("verify.pop.planMissing") : t("verify.pop.planNA"),
      ...planC },
    { state: markFor(course.severity), text: t("verify.pop.courses"), ...course },
    { state: num("zeroTotal") === 0 ? markFor(total.severity) : "na",
      text:  num("zeroTotal") === 0 ? t("verify.pop.total") : t("verify.pop.totalNone"),
      ...total },
  ];

  // Findings with no row of their own — duplicate titles, impossible sections,
  // a leaked marker. Rare, but they must not vanish just because the four
  // standard rows don't cover them.
  const OWNED = new Set(["requirement-table-parity", "plan-witness-unaccounted",
                         "unknown-course", "missing-total-credits", "no-sample-plan",
                         "total-from-sample-plan"]);
  for (const f of findings) {
    if (OWNED.has(f.check) || f.severity === "info") continue;
    rows.push({ state: markFor(f.severity, "fail"), text: f.message,
                detail: (f.detail ?? []).map(renderDetail), overflow: f.overflow ?? 0 });
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
