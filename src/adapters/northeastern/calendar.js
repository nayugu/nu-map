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

  // NEU Banner term code convention (YYYY = AY end year):
  //   10 = Fall,  30 = Spring,  40 = Summer 1,  60 = Summer 2
  //   32 = Law Spring,  52 = Law Summer
  decodeTermCode(term) {
    const suffix = String(term).slice(-2);
    if (suffix === "10") return "fall";
    if (suffix === "30") return "spring";
    if (suffix === "40") return "sumA";
    if (suffix === "60") return "sumB";
    if (suffix === "32") return "spring"; // Law spring — same academic slot
    if (suffix === "52") return "sumA";   // Law summer — same academic slot
    return null;
  },

  // Banner YYYY = AY end year; Fall (10) runs in year YYYY-1, all others in YYYY.
  getTermCodeYear(term) {
    const year = parseInt(String(term).slice(0, 4), 10);
    if (isNaN(year)) return null;
    const suffix = String(term).slice(-2);
    return suffix === "10" ? year - 1 : year;
  },

  // Returns true only when the term's first class day has already passed.
  // Future/upcoming terms have unreliable Banner data (registration not yet settled).
  isTermPast(code) {
    const semTypeId = this.decodeTermCode(code);
    const yr = this.getTermCodeYear(code);
    if (!semTypeId || yr == null) return false;
    const firstMonth = { fall: 9, spring: 1, sumA: 5, sumB: 7 }[semTypeId];
    if (!firstMonth) return false;
    return new Date(yr, firstMonth - 1, 1) <= new Date();
  },

  getSources() { return []; },
};

export default calendar;
