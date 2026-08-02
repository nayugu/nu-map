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
import { STATE, buildCheckRows } from "../core/verificationRows.js";

const WIDTH = 268;
const GAP   = 12;
const EDGE  = 8;

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

/**
 * One state per severity, so the marks and the badge cannot disagree.
 *
 *   pass ✓ green   nothing found
 *   fail ✕ red     high — counted, and the badge is red
 *   warn ! yellow  medium — counted, and the badge is yellow
 *   note · grey    info — surfaced, deliberately not counted
 *   na   – grey    this check does not apply to this kind of program
 *
 * The badge colour is the worst mark present, by construction. An audit of all
 * 1,017 programs found 52 showing a yellow badge with no row explaining it,
 * because marks were derived from counters while the badge came from severity.
 * Deriving both from severity is what closes that.
 */
function CheckRow({ state, detail = [], overflow = 0, moreLabel, children }) {
  const mark = STATE[state]?.mark ?? "–";
  // Green, red and yellow read from REL_STYLE — the header legend's colours,
  // and the badge's — so all three stay in step.
  const color = state === "pass" ? REL_STYLE.prerequisite.color
              : state === "fail" ? REL_STYLE["prerequisite-order"].color
              : state === "warn" ? REL_STYLE["corequisite-viol"].color
              : "var(--text-5)";
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span style={{ flexShrink: 0, width: 10, textAlign: "center", fontSize: 10,
                     fontWeight: 800, color, lineHeight: LINE }}>{mark}</span>
      <div style={{ minWidth: 0 }}>
        <span style={{ fontSize: 11, lineHeight: LINE, display: "block",
                       color: state === "note" || state === "na" ? "var(--text-5)" : "var(--text-3)" }}>{children}</span>
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

export default function VerificationPopover({ verification, level, rect, interactive = false, onDismiss }) {
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

  // Rows come from src/core/verificationRows.js so the badge and the marks are
  // computed once, from the same input. They previously disagreed twice; an
  // invariant test now checks the two agree on every shipped program.
  const rows = buildCheckRows(verification);

  // Detail bullets ship as { key, params } so they can be translated here
  // rather than baked into the committed data in English. Older data may still
  // hold plain strings; those pass through unchanged.
  const renderDetail = d =>
    typeof d === "string" ? d : t(`verify.detail.${d.key}`, d.params ?? {});

  const headline = level === "verified" ? t("verify.pop.headline.verified")
                 : level === "partial"  ? t("verify.pop.headline.partial")
                 : t("verify.pop.headline.review");

  return createPortal(
    <>
      {interactive && (
        // Tap-outside to close. Touch has no "mouse leave".
        <div onClick={e => { e.stopPropagation(); onDismiss?.(); }}
             style={{ position: "fixed", inset: 0, zIndex: 9000 }} />
      )}
      <div ref={ref} style={{
      position: "fixed",
      left: placed ? placed.left : Math.round(rect.left + rect.width / 2 - WIDTH / 2),
      top:  placed ? placed.top  : Math.round(rect.top - GAP),
      zIndex: 9001, width: WIDTH, padding: "15px 17px",
      background: "var(--bg-surface)", border: "1px solid var(--border-card)",
      borderRadius: 9, boxShadow: "var(--shadow-modal)",
      // Inert while hovering on desktop so it can't steal the pointer; on
      // touch it must be tappable, because the catalog link lives inside it.
      pointerEvents: interactive ? "auto" : "none",
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
          <CheckRow key={i} state={r.state}
                    detail={(r.detail ?? []).map(renderDetail)}
                    overflow={r.overflow}
                    moreLabel={t("verify.pop.more", { n: r.overflow })}>
            {t(r.textKey, { n: r.detail?.length ?? 0 })}
          </CheckRow>
        ))}
      </div>

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border-2)",
                    fontSize: 10.5, lineHeight: 1.5, color: "var(--text-4)" }}>
        <bdi>{t("verify.pop.caveat")}</bdi>
      </div>

      {/* Touch only. On desktop this popover opens on hover and is
          pointer-events:none, so a link here could never be clicked — there
          the badge itself is the link. On touch the badge's link is disabled
          (tapping it opens this instead), so this is the only route to the
          source. */}
      {interactive && verification?.sourceUrl && (
        <a href={verification.sourceUrl} target="_blank" rel="noopener noreferrer"
           onClick={e => e.stopPropagation()}
           style={{ display: "inline-block", marginTop: 9, fontSize: 10.5, fontWeight: 600,
                    color: "var(--active, var(--text-2))", textDecoration: "none",
                    pointerEvents: "auto" }}>
          {t("verify.pop.openCatalog")} ↗
        </a>
      )}
    </div>
    </>,
    document.body
  );
}
