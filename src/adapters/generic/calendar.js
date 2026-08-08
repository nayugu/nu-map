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
  getTermCodeYear(_term) { return null; },

  // No dates, so no opinion about which semester is "now". Callers treat null
  // as "the user sets it manually", which is the honest answer here — better
  // than guessing from month numbers and quietly marking a term complete.
  //
  // To implement: give each semester type a first and last day (see
  // northeastern/calendar.js, which derives both from the registrar's own
  // published section dates rather than hardcoding them), then return the
  // term whose window contains `now` — and between terms, the term about to
  // BEGIN. Returning the one that just ended leaves it looking in-progress
  // for the length of the break.
  getTermStart(_semTypeId, _year) { return null; },
  getTermEnd(_semTypeId, _year)   { return null; },
  getCurrentSemId(_now)           { return null; },
  isTermPast(_code, _now)         { return false; },

  getSources() { return []; },
};

export default calendar;
