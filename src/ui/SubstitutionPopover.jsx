// ═══════════════════════════════════════════════════════════════════
// SUBSTITUTION POPOVER — why we are suggesting this swap.
//
// Same shape as the schedule/availability popover and GradePopover:
// fixed width, measured-and-clamped placement, portalled to
// document.body (an ancestor transform:scale would otherwise break
// position:fixed).
//
// Opens on HOVER of the row's "+" because it is a read-only
// explanation, not an input — unlike GradePopover, nothing here is
// clickable, so it can vanish as soon as the pointer leaves.
//
// ## Why this exists at all
//
// Every tier-C row carried a "⚠" and a "+N" chip. Tier C is the common
// case, so the warning appeared on essentially every row and stopped
// carrying information — a uniform marker is decoration. The caveat is
// real but it belongs where someone is deciding, not repeated down a
// column, so the glyph is gone and the reasoning lives here: which tier,
// what evidence produced it, what else the swap drags along, and whether
// an advisor has to sign off.
// ═══════════════════════════════════════════════════════════════════
import { useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../context/LanguageContext.jsx";

const WIDTH = 244;
const GAP   = 8;
const EDGE  = 8;

export default function SubstitutionPopover({ alt, rect, courseName }) {
  const { t } = useLanguage();
  const ref = useRef(null);
  const [placed, setPlaced] = useState(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !rect) return;
    const h = el.offsetHeight;
    let left = rect.left + rect.width / 2 - WIDTH / 2;
    left = Math.min(Math.max(EDGE, left), window.innerWidth - WIDTH - EDGE);
    let top = rect.bottom + GAP;                                      // below…
    if (top + h > window.innerHeight - EDGE) top = rect.top - GAP - h; // …or above
    top = Math.min(Math.max(EDGE, top), window.innerHeight - h - EDGE);
    setPlaced({ top: Math.round(top), left: Math.round(left) });
  }, [rect, alt]);

  if (!alt || !rect) return null;

  const ev = alt.evidence ?? {};
  const tierLine =
    alt.tier === "A" ? (ev.statement ? t("bank.sub.why.stated") : t("bank.sub.why.a"))
    : alt.tier === "B" ? t("bank.sub.why.b")
    : t("bank.sub.why.c");

  // Evidence, strongest first — the same order that decided the tier.
  const lines = [];
  if (ev.programs)  lines.push(t("bank.sub.ev.programs", { n: ev.programs }));
  if (ev.crossList) lines.push(t("bank.sub.ev.crosslist"));
  if (ev.overlap)   lines.push(t("bank.sub.ev.overlap", { pct: ev.overlap }));
  if (ev.scope)     lines.push(t("bank.sub.ev.scope", { scope: ev.scope }));
  if (ev.excludes)  lines.push(t("bank.sub.ev.excludes", { scope: ev.excludes }));

  const row = { fontSize: 10, lineHeight: "calc(1.45 * var(--lh-scale, 1))", color: "var(--text-4)" };

  return createPortal(
    <div ref={ref}
         style={{
           position: "fixed",
           left: placed ? placed.left : Math.round(rect.left),
           top:  placed ? placed.top  : Math.round(rect.bottom + GAP),
           zIndex: 9001, width: WIDTH, padding: "11px 13px",
           background: "var(--bg-surface)", border: "1px solid var(--border-card)",
           borderRadius: 9, boxShadow: "var(--shadow-modal)",
           fontFamily: "'Inter', system-ui, sans-serif",
           pointerEvents: "none",                       // never eat the click
           visibility: placed ? "visible" : "hidden",
         }}>
      {/* the pair itself */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--link-1)" }}>{alt.from}</span>
        <span style={{ fontSize: 9, color: "var(--text-5)" }}>→</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-2)" }}>{alt.to}</span>
      </div>
      {courseName && (
        <div style={{ fontSize: 9.5, color: "var(--text-5)", marginBottom: 7,
                      lineHeight: "calc(1.4 * var(--lh-scale, 1))" }}>{courseName}</div>
      )}

      {/* what kind of claim this is */}
      <div style={{ ...row, color: "var(--text-3)", fontWeight: 600, marginBottom: lines.length ? 5 : 0 }}>
        {tierLine}
      </div>

      {/* and what supports it */}
      {lines.map((l, i) => (
        <div key={i} style={{ ...row, display: "flex", gap: 5 }}>
          <span style={{ color: "var(--text-5)", flexShrink: 0 }}>·</span>
          <span>{l}</span>
        </div>
      ))}

      {/* A stated set rule applies one-to-one like everything else, so this
          pair can be added alone — but the catalog grants the rule for the
          whole set, so say what else it names. */}
      {ev.setRequires?.length > 1 && (
        <div style={{ ...row, marginTop: 7, paddingTop: 6,
                      borderTop: "1px solid var(--border-2)" }}>
          {t("bank.sub.setgap", { codes: ev.setRequires.join(", ") })}
        </div>
      )}

      {/* the caveat, once, where the decision is being made */}
      {alt.approval && (
        <div style={{ ...row, marginTop: 7, paddingTop: 6, borderTop: "1px solid var(--border-2)",
                      color: "var(--text-3)" }}>
          ⚠ {t("bank.sub.approval")}
        </div>
      )}
    </div>,
    document.body
  );
}
