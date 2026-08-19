// ═══════════════════════════════════════════════════════════════════
// HOVER CARD — instant, styled replacement for the native `title` tooltip
//
// The browser's `title` waits about a second before appearing, which made the
// content feel hidden; anything worth writing there was effectively never
// read. This shows on mouseenter with no delay.
//
// Portalled to document.body for the same reason as the offering/schedule
// popovers: an ancestor `transform: scale` would otherwise become the
// containing block and break `position: fixed`.
//
// Extracted from InfoPanel so the graduation panel's fidelity pill can use the
// same mechanism — a badge whose whole purpose is to explain itself must not
// be the one thing behind a one-second delay.
// ═══════════════════════════════════════════════════════════════════
import { useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

/**
 * @param {object}   props
 * @param {DOMRect}  props.rect      anchor rect, from getBoundingClientRect()
 * @param {number}   [props.maxWidth] wrap at this width instead of staying on
 *                                    one line. Use for prose; omit for a label.
 */
export default function HoverCard({ children, rect, maxWidth }) {
  const ref = useRef(null);
  const [placed, setPlaced] = useState(null);   // measured-and-clamped position
  const GAP  = 7;    // clearance between the badge and the popover
  const EDGE = 8;    // min clearance from any viewport edge

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = rect.left + rect.width / 2 - w / 2;                   // centred over the badge
    left = Math.min(Math.max(EDGE, left), window.innerWidth - w - EDGE);
    let top = rect.top - GAP - h;                                    // above the badge…
    if (top < EDGE) top = rect.bottom + GAP;                         // …or below if it'd clip the top
    top = Math.min(Math.max(EDGE, top), window.innerHeight - h - EDGE);
    setPlaced({ top: Math.round(top), left: Math.round(left) });
  }, [rect, children]);

  return createPortal(
    <div ref={ref} style={{
      position: "fixed",
      left: placed ? placed.left : Math.round(rect.left),
      top:  placed ? placed.top  : Math.round(rect.top),
      zIndex: 9000, padding: maxWidth ? "9px 12px" : "7px 11px",
      whiteSpace: maxWidth ? "normal" : "nowrap",
      ...(maxWidth ? { maxWidth, width: "max-content" } : {}),
      background: "var(--bg-surface)", border: "1px solid var(--border-card)",
      borderRadius: 7, boxShadow: "var(--shadow-modal)", pointerEvents: "none",
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: 13.5, color: "var(--text-2)",
      visibility: placed ? "visible" : "hidden",
    }}>
      {children}
    </div>,
    document.body
  );
}

/**
 * A placeholder card, uncropped: its NAME on one line and the courses that answer it below.
 *
 * ── Why two lines and not an em-dash ────────────────────────────────
 *
 * They are different kinds of thing. "Introductory Physics" is what the requirement is
 * called; "(PHYS 1161 and PHYS 1162 and PHYS 1163) or (…)" is what satisfies it. Joined by
 * a dash they read as one sentence, and at this width the join also wrapped the title
 * mid-phrase — "Introductory Physics — (PHYS 1161 and" — so the name was never legible as a
 * unit, which is the one thing a reader scans for first.
 *
 * Stacked, it also matches the CARD, which already puts the name above its detail line. The
 * hover is then the same object with nothing clipped, rather than a second way of saying it.
 *
 * One shared component because both the planner card and the preview card draw this, and
 * two copies of a two-line layout is two copies to drift.
 */
export function CardHover({ rect, title, detail, maxWidth = 300 }) {
  // A colon, because it says the next line ANSWERS this one — which a dash did not.
  //
  // Not appended blindly: plenty of these titles are already a sentence ending in one.
  // "Select one of the following:" is the commonest placeholder wording in the corpus, and
  // "Select one of the following::" is the kind of detail that makes a tool look unfinished.
  const head = !detail ? title
    : /[:：]\s*$/.test(String(title ?? "")) ? title
    : `${title}:`;
  return (
    <HoverCard rect={rect} maxWidth={maxWidth}>
      <div style={{ fontWeight: 600, color: "var(--text-1)" }}>{head}</div>
      {!!detail && (
        <div style={{ marginTop: 3, color: "var(--text-4)", fontSize: 12.5 }}>{detail}</div>
      )}
    </HoverCard>
  );
}
