// ═══════════════════════════════════════════════════════════════════
// SUBJECT TIP — hovering a subject code names the subject in full
//
// The app only ever has room for the code: a pill in the info panel, a
// section header in the bank, a chip in the colour key. "ABRC" tells a
// student nothing until it reads "Study Abroad - CPS Specialty".
//
// The card leads with the same coloured pill the page is already showing, so
// the hover is visibly ABOUT the thing under the cursor rather than a stray
// caption, and the name follows in text heavy enough to be the card's
// subject rather than a footnote. Width is content-sized: subject names run
// from "Physics" to "Arts Administration and Cultural Entrepreneurship", and
// a fixed card either wastes a line on the short ones or wraps the long ones
// for no reason.
//
// Chrome, placement and the desktop-only rule all come from HoverTip.
// ═══════════════════════════════════════════════════════════════════
import HoverTip from "./InfoTip.jsx";

export default function SubjectTip({ subject, color, name, placement = "top", display = "inline-flex", style, children }) {
  const tip = name
    ? (
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Centred against the name, not pinned to its first line: a name long
            enough to wrap is exactly when the card is tallest, and a pill stuck
            at the top then reads as a heading over the text rather than a label
            beside it. */}
        <span style={{
          fontSize: 9.5, background: color, color: "var(--badge-bg)",
          borderRadius: 3, padding: "2px 7px", fontWeight: 800,
          letterSpacing: "0.04em", flexShrink: 0,
        }}>{subject}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>{name}</span>
      </span>
    )
    : null;

  return (
    <HoverTip tip={tip} width="auto" placement={placement} display={display} style={style}>
      {children}
    </HoverTip>
  );
}
