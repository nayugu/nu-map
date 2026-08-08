// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/calendar  (implements ICalendar)
//
// Term windows — when a semester starts and when it is over — come from
// termWindows.js, which scripts/derive-term-windows.js regenerates every
// monthly run from Banner's own section meeting dates over a rolling
// 5-year window.  They used to be four hand-picked "typical first day +
// 1 week" constants, which cost 2–16 days of lag at the start of a term
// and, because there were no END dates at all, up to 42 days at the
// finish: a Fall that ended Dec 14 stayed "now" until Jan 22.
// ═══════════════════════════════════════════════════════════════════

import termWindows from "./termWindows.js";

// Banner enrolment churns while a term is being added/dropped, so history
// for a term that has only just begun is not yet worth reading. Add/drop
// closes about a week in; this doubles that.  Distinct from the term
// windows above on purpose — "has this term started" and "is this term's
// data settled" are different questions that shared one constant before.
const SETTLE_DAYS = 14;

const _dateAt = (year, month, day) => new Date(year, month - 1, day);

/** Labor Day — the first Monday of September — for a calendar year. */
function _laborDay(year) {
  for (let day = 1; day <= 7; day++) {
    const d = _dateAt(year, 9, day);
    if (d.getDay() === 1) return d;
  }
  return _dateAt(year, 9, 1); // unreachable: some day in 1–7 is a Monday
}

const _shift = (d, days) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

/**
 * First day of `semTypeId` in `year`, as the planner counts it: the measured
 * threshold, a few days past the true first class, never before it.
 * Returns null for a type the generated data has no window for.
 */
function _termStart(semTypeId, year) {
  const w = termWindows.types?.[semTypeId];
  if (!w) return null;
  if (w.startRule === "laborDayPlus2") return _shift(_laborDay(year), 2);
  return w.start ? _dateAt(year, w.start.month, w.start.day) : null;
}

/**
 * Last day of `semTypeId` in `year` — end of the exam period — returned as the
 * final INSTANT of that day, not its midnight.
 *
 * The distinction is not pedantry: a window compared with `now <= end` against
 * a midnight boundary is open for zero seconds on its own last day, so a term
 * whose exams finish on Dec 14 stopped being current at 00:00 that morning,
 * while students were still sitting them.
 */
function _termEnd(semTypeId, year) {
  const w = termWindows.types?.[semTypeId];
  if (!w) return null;
  // A rule-anchored window carries a LENGTH rather than a date, so the end
  // moves with the start in a year the rule places the term late.
  const day = w.lengthDays != null
    ? (() => { const s = _termStart(semTypeId, year); return s && _shift(s, w.lengthDays); })()
    : (w.end && _dateAt(year, w.end.month, w.end.day));
  return day ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999) : null;
}

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

  // First and last day of a term type in a given calendar year, as measured
  // from Banner. Exposed so callers (and tests) can reason about the window
  // without reaching into the generated data.
  getTermStart(semTypeId, year) { return _termStart(semTypeId, year); },
  getTermEnd(semTypeId, year)   { return _termEnd(semTypeId, year); },

  // True once a term's Banner data has settled — its start plus SETTLE_DAYS,
  // NOT the same threshold as "the term has begun". A term still inside its
  // add/drop window has section counts and enrolments that move daily, and a
  // future term has no meaningful data at all: term-history records `false`
  // for a course simply because registration has not been published yet.
  // Reading either as fact would skew offering probability.
  isTermPast(code, now = new Date()) {
    const semTypeId = this.decodeTermCode(code);
    const yr = this.getTermCodeYear(code);
    if (!semTypeId || yr == null) return false;
    const start = _termStart(semTypeId, yr);
    return start ? _shift(start, SETTLE_DAYS) <= now : false;
  },

  // The semId (e.g. "spr2026", "fall2026") the planner should treat as NOW:
  // the most recent term to have BEGUN.
  //
  // The rule is deliberately one-sided. "Now" never names a term that has not
  // started yet, so when the planner says a semester is in progress, that is
  // a fact rather than a forecast. The cost is paid at the other end: between
  // terms, the one that just finished stays current until the next actually
  // begins — 28 days over winter break. That is a chosen trade, not an
  // oversight. The alternative (hand off at the old term's end, so a finished
  // term counts as done immediately) makes the opposite claim false instead,
  // by calling a term current for up to 23 days before anyone attends it.
  //
  // Note what this means for the END dates: they do NOT trigger the handoff.
  // A term stops being current when the NEXT one starts, not when its own
  // exams finish. getTermEnd is still the honest end of the term and is what
  // any future "in session?" distinction would key off — during a break this
  // function names a term whose exams are already over.
  //
  // Because the switch point is the next term's start threshold, every day of
  // margin on that threshold is a day the finished term lingers. Fall costs
  // nothing here (the Labor Day rule is exact); the other three carry the few
  // days of margin that keeping this rule one-sided requires.
  getCurrentSemId(now = new Date()) {
    const year = now.getFullYear();
    const started = [];
    for (const t of _semesterTypes) {
      const prefix = t.idPrefix ?? t.id;
      for (const yr of [year - 1, year]) {
        const start = _termStart(t.id, yr);
        if (start && start <= now) started.push({ start, semId: `${prefix}${yr}` });
      }
    }
    if (!started.length) return null;
    started.sort((a, b) => b.start - a.start);
    return started[0].semId;
  },

  getSources() { return []; },
};

export default calendar;
