// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/specialTerms  (implements ISpecialTerms)
//
// Each duration object has two distinct numeric fields:
//   duration — length in calendar months (stored in plan state,
//              used for display labels and drag-and-drop identity)
//   weight   — grid weight on the ICalendar scale (1.0 = one full
//              semester slot; used for span logic when placing terms)
//
//   4-month co-op      → duration 4,  weight 1.0  (one full slot)
//   6-month co-op      → duration 6,  weight 2.0  (spans two slots)
//   2-month internship → duration 2,  weight 0.5  (one summer half)
//   4-month internship → duration 4,  weight 1.0  (one full slot)
// ═══════════════════════════════════════════════════════════════════

/** @type {import('../../ports/ISpecialTerms.js').ISpecialTerms} */
export default {
  types: [
    {
      id:    "coop",
      label: "Co-op",
      color: "#f87171",
      durations: [
        { id: "4mo", label: "4-month", duration: 4, weight: 1.0 },
        { id: "6mo", label: "6-month", duration: 6, weight: 2.0 },
      ],
      attributeGrants: ["EX"],
      occupiesSlot:    true,
      creditValue:     0,
    },
    {
      id:    "intern",
      label: "Full-Time Internship",
      color: "#9ca3af",
      durations: [
        { id: "2mo", label: "2-month", duration: 2, weight: 0.5 },
        { id: "4mo", label: "4-month", duration: 4, weight: 1.0 },
      ],
      attributeGrants: [],
      occupiesSlot:    true,
      creditValue:     0,
    },
  ],
};
