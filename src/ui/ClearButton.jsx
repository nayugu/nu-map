// ═══════════════════════════════════════════════════════════════════
// CLEAR BUTTON — the "no answer" control that sits beside a slider.
//
// A slider can reach every value on its scale but cannot express the
// absence of one, so this is the only way back to unanswered. That makes
// it the undo for a mis-tap: dragging a slider by accident enters a real
// answer that counts toward a course's average, and the way out has to be
// easier to hit than the mistake was.
//
// Size is not a taste call — WCAG 2.2 SC 2.5.8 (Level AA) sets a 24×24
// CSS px floor for pointer targets, so that is the minimum here, with
// more on touch where a fingertip is the pointer. The GLYPH stays small;
// it is the target that grows, which is the usual way round: a huge ×
// beside a slider reads as a delete button for the whole row.
//
// It holds its width while hidden so the row does not shift the moment a
// value is first set (a jumping row is its own source of mis-taps).
//
// Lives in one file because it is used by both the review popover and the
// term review table, and the last control those two kept separately
// drifted apart — the table kept a stepper bug the popover had already
// fixed.
// ═══════════════════════════════════════════════════════════════════
import { useState } from "react";
import { usePlanner } from "../context/PlannerContext.jsx";

/**
 * @param {Object} props
 * @param {boolean} props.show   whether there is anything to clear
 * @param {() => void} props.onClick
 * @param {string} props.title   accessible name / tooltip
 */
export default function ClearButton({ show, onClick, title }) {
  const [hover, setHover] = useState(false);
  const { isPhone } = usePlanner();
  // 28 clears the 24px floor with margin; 34 on touch, where the pointer is
  // a fingertip. Read from context rather than taken as a prop so both call
  // sites cannot drift to different sizes.
  const size  = isPhone ? 34 : 28;
  const glyph = isPhone ? 19 : 16;
  return (
    <div
      role={show ? "button" : undefined}
      tabIndex={show ? 0 : undefined}
      onClick={show ? onClick : undefined}
      onKeyDown={show ? (e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
      }) : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={show ? title : undefined}
      aria-label={show ? title : undefined}
      style={{
        flexShrink: 0,
        width: size, height: size,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: glyph, lineHeight: 1, fontWeight: 500,
        borderRadius: 6, userSelect: "none",
        cursor: show ? "pointer" : "default",
        visibility: show ? "visible" : "hidden",
        color: hover && show ? "var(--text-2)" : "var(--text-5)",
        background: hover && show ? "var(--badge-bg)" : "transparent",
        transition: "background 120ms ease, color 120ms ease",
      }}
    >
      ×
    </div>
  );
}
