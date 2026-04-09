// ═══════════════════════════════════════════════════════════════════
// ADAPTER: generic/calendar  (implements ICalendar)
//
// Default: fall + spring only, weight 1.0 each.
// Covers the vast majority of universities globally.
//
// Override when your institution has:
//   - Summer sessions (add sumA/sumB with weight 0.5)
//   - Quarter system (replace with fall/winter/spring, weight ~0.67)
//   - Trimesters or non-standard term structure
// ═══════════════════════════════════════════════════════════════════

/** @type {import('../../ports/ICalendar.js').ICalendar} */
const calendar = {
  defaultStartYear:   new Date().getFullYear(),
  yearAnchor:         "september",
  academicYearFormat: "single",
  semesterTypes: [
    {
      id:         "fall",
      label:      "Fall",
      shortLabel: "FA",
      weight:     1.0,
      optional:   false,
      theme:      "fall",
      months:     ["09", "10", "11", "12"],
    },
    {
      id:         "spring",
      label:      "Spring",
      shortLabel: "SP",
      weight:     1.0,
      optional:   false,
      theme:      "spring",
      months:     ["01", "02", "03", "04", "05"],
    },
  ],
};

// Stage 1 compat exports
export const DEFAULT_START_YEAR = calendar.defaultStartYear;
export const SEMESTER_TYPES     = calendar.semesterTypes.map(t => t.id);

export default calendar;
