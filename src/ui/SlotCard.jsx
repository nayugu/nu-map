// ═══════════════════════════════════════════════════════════════════
// SLOT CARD — an elective the department planned but did not name.
//
// "General Elective", "Khoury Elective", "Science Requirement". These are not
// a minor case: 51% of all credit in an undergraduate sample plan is a slot
// rather than a named course, 32% of study terms are nothing BUT slots, and
// the share climbs through the degree (Y1 34% → Y4 70%) because a degree gets
// less prescribed, not more.
//
// ── Which means the visual has one unusual constraint ──────────────
//
// It has to read as "not a course" while NOT reading as "a problem". A fourth
// year that is entirely slots is exactly what the department published, so
// anything alarming — a warning colour, an alert glyph, an "incomplete" badge —
// would paint the back half of every degree red for being correct.
//
// And it has to be QUIETER than a course card, not louder. At half the cards
// on screen, a slot that shouts turns a semester into competing demands. So:
// dashed border, muted fill, the catalog's own wording, and the credit value
// in the same place a course puts it. Nothing else at rest.
//
// The dashes are neutral on purpose. Dashed ORANGE already means "Claude is
// proposing this" (see PlannerContext's preview treatment), and the two must
// never be confusable — one is a suggestion from the catalog that is part of
// your plan, the other is a suggestion from an assistant that is not yet.
// ═══════════════════════════════════════════════════════════════════

import { usePlanner } from "../context/PlannerContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { usePort } from "../context/InstitutionContext.jsx";
import { ICreditSystem } from "../ports/ICreditSystem.js";

export default function SlotCard({ slot, isPhone }) {
  const { removeSlot } = usePlanner();
  const { t } = useLanguage();
  // "SH" here, "credits" elsewhere — the unit is the institution's to name.
  const unitName = usePort(ICreditSystem).getUnitName();

  return (
    <div
      className="slot-card"
      title={slot.label}
      style={{
        position: "relative",
        minHeight: isPhone ? 0 : 70,
        display: "flex", flexDirection: "column", justifyContent: "space-between",
        padding: isPhone ? "4px 6px" : "6px 8px",
        borderRadius: 6,
        // 1.5px rather than 2: at this density a 2px dash reads as a border
        // treatment shouting for attention rather than an absence of content.
        border: "1.5px dashed var(--border-slot, var(--border-2))",
        background: "var(--bg-slot, transparent)",
        color: "var(--text-3)",
        overflow: "hidden",
      }}
    >
      <div style={{
        fontSize: isPhone ? 9 : 10.5, lineHeight: 1.25, fontWeight: 500,
        fontStyle: "italic",
        display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
        overflow: "hidden",
      }}>
        {slot.label}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
        {/* Same corner a course puts its credits in, so a term reads as one
            list of loads rather than two kinds of thing. */}
        <span style={{ fontSize: isPhone ? 8 : 9, color: "var(--text-5)" }}>
          {slot.sh != null ? `${slot.sh} ${unitName}` : ""}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); removeSlot(slot.id); }}
          aria-label={t("slot.remove")}
          title={t("slot.remove")}
          style={{
            border: "none", background: "transparent", cursor: "pointer",
            color: "var(--text-5)", fontSize: isPhone ? 10 : 11, lineHeight: 1,
            padding: "1px 2px", fontFamily: "inherit",
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
