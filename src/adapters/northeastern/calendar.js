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
    months:       ["09", "10", "11", "12"],
    safeStartDay: 15,  // NU fall typically starts Sep 3–8; +1 week buffer
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
    months:       ["01", "02", "03", "04", "05"],
    safeStartDay: 22,  // NU spring typically starts Jan 12–15; +1 week buffer
  },
  {
    id:         "sumA",
    label:      "Summer 1",
    shortLabel: "S1",
    altLabel:   "Summer A",              // standalone headings read "Summer A <year>"
    translateAs:"Summer half-term A",    // engine hint (avoids "summer 1" mistranslation)
    sub:        "May \u2013 Jun",
    weight:     0.5,
    optional:   true,
    theme:      "summer",
    months:       ["05", "06"],
    safeStartDay: 12,  // NU summer 1 typically starts May 1–4; +1 week buffer
  },
  {
    id:         "sumB",
    label:      "Summer 2",
    shortLabel: "S2",
    altLabel:   "Summer B",
    translateAs:"Summer half-term B",
    sub:        "Jul \u2013 Aug",
    weight:     0.5,
    optional:   true,
    theme:      "summer",
    months:       ["07", "08"],
    safeStartDay: 16,  // NU summer 2 typically starts Jul 7–9; +1 week buffer
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

  // Returns true only when the term's safe start day has already passed.
  // Uses safeStartDay (+1 week buffer past typical first day of classes) so we
  // never treat a term as past while it might still be registration/pre-class week.
  // Future/upcoming terms have unreliable Banner data (registration not yet settled).
  isTermPast(code) {
    const semTypeId = this.decodeTermCode(code);
    const yr = this.getTermCodeYear(code);
    if (!semTypeId || yr == null) return false;
    const type = _semesterTypes.find(t => t.id === semTypeId);
    if (!type) return false;
    const firstMonths = { fall: 9, spring: 1, sumA: 5, sumB: 7 };
    const firstMonth = firstMonths[semTypeId];
    if (!firstMonth) return false;
    const safeDay = type.safeStartDay ?? 1;
    return new Date(yr, firstMonth - 1, safeDay) <= new Date();
  },

  // Returns the semId (e.g. "spr2026", "fall2026") that contains today's date,
  // using safeStartDay thresholds so the value only flips once a semester has
  // definitely started. Returns null if the date predates all known thresholds.
  getCurrentSemId(now = new Date()) {
    const year = now.getFullYear();
    const firstMonths = { fall: 9, spring: 1, sumA: 5, sumB: 7 };
    const candidates = [];
    for (const t of _semesterTypes) {
      const firstMonth = firstMonths[t.id];
      if (!firstMonth) continue;
      const safeDay = t.safeStartDay ?? 1;
      const prefix = t.idPrefix ?? t.id;
      for (const yr of [year - 1, year]) {
        candidates.push({
          threshold: new Date(yr, firstMonth - 1, safeDay),
          semId: `${prefix}${yr}`,
        });
      }
    }
    candidates.sort((a, b) => b.threshold - a.threshold);
    return candidates.find(c => c.threshold <= now)?.semId ?? null;
  },

  getSources() { return []; },
};

export default calendar;
