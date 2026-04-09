// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/calendar  (implements ICalendar)
// ═══════════════════════════════════════════════════════════════════

/** @type {import('../../ports/ICalendar.js').ICalendar} */
const calendar = {
  defaultStartYear:   2026,
  yearAnchor:         "august",
  academicYearFormat: "single",

  semesterTypes: [
    {
      id:        "fall",
      label:     "Fall",
      shortLabel: "FA",
      weight:    1.0,
      optional:  false,
      theme:     "fall",
      months:    ["09", "10", "11", "12"],
    },
    {
      id:        "spring",
      label:     "Spring",
      shortLabel: "SP",
      weight:    1.0,
      optional:  false,
      theme:     "spring",
      months:    ["01", "02", "03", "04", "05"],
    },
    {
      id:        "sumA",
      label:     "Summer 1",
      shortLabel: "S1",
      weight:    0.5,
      optional:  true,
      theme:     "summer",
      months:    ["05", "06"],
    },
    {
      id:        "sumB",
      label:     "Summer 2",
      shortLabel: "S2",
      weight:    0.5,
      optional:  true,
      theme:     "summer",
      months:    ["07", "08"],
    },
  ],
};

// ── Stage 1 compat exports (consumed by constants.js compat re-exports) ──
// Removed in Stage 2 once BankPanel, SemRow, SummerRow, Header use
// useInstitution() directly.
export const DEFAULT_START_YEAR = calendar.defaultStartYear;
export const SEMESTER_TYPES     = calendar.semesterTypes.map(t => t.id);

export default calendar;
