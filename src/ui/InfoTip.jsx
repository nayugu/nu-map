// ═══════════════════════════════════════════════════════════════════
// HOVER TIP — hovering a control reveals a styled explanation
//
// Wraps a control (a settings toggle, an import/export button…) and, on
// hover, shows the explanation in the same chrome as the graduation panel's
// "checked" popover (VerificationPopover): a portalled, measured-and-clamped
// card with an optional uppercase title and a line or two of plain language.
//
// Desktop-only by design. Touch has no hover, and these tips replaced the
// native `title=` tooltips, which never appeared on touch either — so on a
// touch device the control simply renders untouched and no card shows.
//
// Portalled to document.body: an ancestor `transform: scale` would otherwise
// become the containing block and break `position: fixed`.
// ═══════════════════════════════════════════════════════════════════
import { useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { usePlanner } from "../context/PlannerContext.jsx";

const GAP  = 10;   // clearance between the control and the card
const EDGE = 8;    // min clearance from any viewport edge

// width="auto" sizes the card to its content instead of a fixed column — for
// tips whose text has no typical length (a subject name runs from "Physics" to
// "Arts Administration and Cultural Entrepreneurship"). It still wraps rather
// than running off the screen: max-content up to AUTO_MAX, then normal wrapping.
const AUTO_MAX = 340;

function TipCard({ title, rect, width, placement, children }) {
  const ref = useRef(null);
  const [placed, setPlaced] = useState(null);
  const auto = width === "auto";

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    let left, top;
    if (placement === "side") {
      // Beside the control — left of it (or right if that would clip), so a
      // panel pinned to the screen edge stays readable while the tip shows.
      left = rect.left - GAP - w;
      if (left < EDGE) left = rect.right + GAP;
      left = Math.min(Math.max(EDGE, left), window.innerWidth - w - EDGE);
      top = rect.top + rect.height / 2 - h / 2;                    // vertically centred on the row
      top = Math.min(Math.max(EDGE, top), window.innerHeight - h - EDGE);
    } else {
      left = rect.left + rect.width / 2 - w / 2;                   // centred over the control
      left = Math.min(Math.max(EDGE, left), window.innerWidth - w - EDGE);
      top = rect.top - GAP - h;                                    // above the control…
      if (top < EDGE) top = rect.bottom + GAP;                     // …or below if it'd clip
      top = Math.min(Math.max(EDGE, top), window.innerHeight - h - EDGE);
    }
    setPlaced({ top: Math.round(top), left: Math.round(left) });
  }, [rect, children, placement]);

  return createPortal(
    <div ref={ref} style={{
      position: "fixed",
      left: placed ? placed.left : Math.round(auto ? rect.left : rect.left + rect.width / 2 - width / 2),
      top:  placed ? placed.top  : Math.round(rect.top - GAP),
      zIndex: 9001,
      ...(auto ? { width: "max-content", maxWidth: AUTO_MAX } : { width }),
      padding: "13px 15px",
      background: "var(--bg-surface)", border: "1px solid var(--border-card)",
      borderRadius: 9, boxShadow: "var(--shadow-modal)",
      pointerEvents: "none",   // inert: it must never steal the pointer from the control
      fontFamily: "'Inter', system-ui, sans-serif",
      visibility: placed ? "visible" : "hidden",
    }}>
      {title && (
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-4)",
                      letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 7 }}>
          {title}
        </div>
      )}
      <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--text-2)" }}>
        {children}
      </div>
    </div>,
    document.body
  );
}

/**
 * @param {object} props
 * @param {React.ReactNode} props.tip      what the card says (string or JSX)
 * @param {string} [props.title]           optional uppercase heading
 * @param {number|"auto"} [props.width=232] card width; "auto" sizes to content
 *                                         (up to AUTO_MAX, then wraps)
 * @param {string} [props.display="block"] wrapper display (use "inline-flex"
 *                                         inside a flex row so flow is kept)
 * @param {object} [props.style]           extra wrapper styles (e.g. flex: 1
 *                                         so the wrapper sizes like the control)
 * @param {"top"|"side"} [props.placement="top"] where the card appears — "top"
 *                                         above the control, "side" to its left
 *                                         (right on clip), for edge-pinned panels
 * @param {React.ReactNode} props.children the control to hover over
 */
export default function HoverTip({ tip, title, width = 232, display = "block", placement = "top", style, children }) {
  const { isMobile } = usePlanner();
  const [open, setOpen] = useState(null);   // control rect while shown

  if (isMobile || tip == null) return children;

  return (
    <span
      onMouseEnter={e => setOpen(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setOpen(null)}
      style={{ display, ...style }}
    >
      {children}
      {open && <TipCard title={title} rect={open} width={width} placement={placement}>{tip}</TipCard>}
    </span>
  );
}
