// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/calendar  (implements ICalendar)
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
    idPrefix:   "spr",   // saved plans use "spr2027" — keep for backward-compat
    label:      "Spring",
    shortLabel: "SP",
    sub:        "Jan \u2013 Apr",
    weight:     1.0,
    optional:   false,
    theme:      "spring",
    months:     ["01", "02", "03", "04", "05"],
  },
  {
    id:         "sumA",
    label:      "Summer 1",
    shortLabel: "S1",
    sub:        "May \u2013 Jun",
    weight:     0.5,
    optional:   true,
    theme:      "summer",
    months:     ["05", "06"],
  },
  {
    id:         "sumB",
    label:      "Summer 2",
    shortLabel: "S2",
    sub:        "Jul \u2013 Aug",
    weight:     0.5,
    optional:   true,
    theme:      "summer",
    months:     ["07", "08"],
  },
];

/** @type {import('../../ports/ICalendar.js').ICalendar} */
const calendar = {
  getSemesterTypes()       { return _semesterTypes; },
  getDefaultStartYear()    { return 2026; },
  getYearAnchor()          { return "august"; },
  getAcademicYearFormat()  { return "single"; },

  // NEU Banner term code convention: YYYY10 = Fall, YYYY30 = Spring,
  // YYYY40 = Summer 1 (May–Jun), YYYY60 = Summer 2 (Jul–Aug)
  decodeTermCode(term) {
    const suffix = String(term).slice(-2);
    if (suffix === "10") return "fall";
    if (suffix === "30") return "spring";
    if (suffix === "40") return "sumA";
    if (suffix === "60") return "sumB";
    return null;
  },

  getSources() { return []; },
};

export default calendar;
