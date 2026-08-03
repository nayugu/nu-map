// ═══════════════════════════════════════════════════════════════════
// INFO TIP — a small "?" affordance that reveals a styled explanation
//
// The same chrome as the graduation panel's "checked" popover
// (VerificationPopover): a portalled, measured-and-clamped card with an
// optional uppercase title and a line or two of plain language. Meant for the
// controls whose label alone doesn't say what they do — settings toggles,
// import/export actions, and the like.
//
// Two input models, matching VerificationPill:
//   desktop  hover the trigger → card shows (card is inert, pointer-events none)
//   touch    tap the trigger → card shows; tap outside → dismiss
//
// Portalled to document.body: an ancestor `transform: scale` would otherwise
// become the containing block and break `position: fixed`.
// ═══════════════════════════════════════════════════════════════════
import { useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { usePlanner } from "../context/PlannerContext.jsx";

const GAP  = 10;   // clearance between trigger and card
const EDGE  = 8;   // min clearance from any viewport edge

function TipCard({ title, rect, width, interactive, onDismiss, children }) {
  const ref = useRef(null);
  const [placed, setPlaced] = useState(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = rect.left + rect.width / 2 - w / 2;                 // centred over the trigger
    left = Math.min(Math.max(EDGE, left), window.innerWidth - w - EDGE);
    let top = rect.top - GAP - h;                                  // above the trigger…
    if (top < EDGE) top = rect.bottom + GAP;                       // …or below if it'd clip
    top = Math.min(Math.max(EDGE, top), window.innerHeight - h - EDGE);
    setPlaced({ top: Math.round(top), left: Math.round(left) });
  }, [rect, children]);

  return createPortal(
    <>
      {interactive && (
        // Tap-outside to close. Touch has no "mouse leave".
        <div onClick={e => { e.stopPropagation(); onDismiss?.(); }}
             style={{ position: "fixed", inset: 0, zIndex: 9000 }} />
      )}
      <div ref={ref} style={{
        position: "fixed",
        left: placed ? placed.left : Math.round(rect.left + rect.width / 2 - width / 2),
        top:  placed ? placed.top  : Math.round(rect.top - GAP),
        zIndex: 9001, width, padding: "13px 15px",
        background: "var(--bg-surface)", border: "1px solid var(--border-card)",
        borderRadius: 9, boxShadow: "var(--shadow-modal)",
        pointerEvents: interactive ? "auto" : "none",
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
      </div>
    </>,
    document.body
  );
}

/**
 * @param {object} props
 * @param {React.ReactNode} props.content  what the card says (string or JSX)
 * @param {string} [props.title]           optional uppercase heading
 * @param {number} [props.width=232]       card width
 * @param {React.ReactNode} [props.children] custom trigger; defaults to a "?" dot
 * @param {number} [props.size=13]         diameter of the default "?" dot
 */
export default function InfoTip({ content, title, width = 232, children, size = 13 }) {
  const { isMobile } = usePlanner();
  const [open, setOpen] = useState(null);   // anchor rect while shown

  const show = e => setOpen(e.currentTarget.getBoundingClientRect());
  const hide = () => setOpen(null);
  // Read the rect NOW: by the time the state updater runs React has already
  // nulled currentTarget on the pooled event.
  const toggle = e => {
    e.stopPropagation();
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setOpen(o => (o ? null : rect));
  };

  const trigger = children ?? (
    <span aria-hidden="true" style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      border: "1px solid var(--border-2)", color: "var(--text-4)",
      fontSize: Math.round(size * 0.72), fontWeight: 700, lineHeight: 1,
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>?</span>
  );

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        aria-label={typeof content === "string" ? content : (title || "More information")}
        onMouseEnter={isMobile ? undefined : show}
        onMouseLeave={isMobile ? undefined : hide}
        onClick={isMobile ? toggle : e => e.stopPropagation()}
        style={{ display: "inline-flex", alignItems: "center", cursor: "help", verticalAlign: "middle" }}
      >
        {trigger}
      </span>
      {open && (
        <TipCard title={title} rect={open} width={width}
                 interactive={isMobile} onDismiss={hide}>
          {content}
        </TipCard>
      )}
    </>
  );
}
