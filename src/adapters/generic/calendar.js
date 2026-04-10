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

const _semesterTypes = [
  {
    id:         "fall",
    label:      "Fall",
    shortLabel: "FA",
    sub:        "Sep \u2013 Dec",
    weight:     1.0,
    optional:   false,
    theme:      "fall",
    months:     ["09", "10", "11", "12"],
  },
  {
    id:         "spring",
    label:      "Spring",
    shortLabel: "SP",
    sub:        "Jan \u2013 May",
    weight:     1.0,
    optional:   false,
    theme:      "spring",
    months:     ["01", "02", "03", "04", "05"],
  },
];

/** @type {import('../../ports/ICalendar.js').ICalendar} */
const calendar = {
  getSemesterTypes()       { return _semesterTypes; },
  getDefaultStartYear()    { return new Date().getFullYear(); },
  getYearAnchor()          { return "september"; },
  getAcademicYearFormat()  { return "single"; },

  // Generic adapter has no term-code convention — override in your institution adapter.
  decodeTermCode(_term) { return null; },
};

export default calendar;
