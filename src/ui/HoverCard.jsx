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
