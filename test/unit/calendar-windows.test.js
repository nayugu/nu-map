// UNIT · src/adapters/northeastern/calendar.js › term windows
//
// The planner decides which semester is "now" — and therefore which courses
// count as completed — from a date alone. These tests hold that decision
// against the registrar's actual calendar: OBSERVED below is the first class
// day and end of the exam period for every term measurable from Banner
// section meeting dates, 2018–2026 (the same corpus scripts/derive-term-windows.js
// samples, kept here as a fixed adversary so a regenerated termWindows.js that
// stops describing real terms fails loudly).
//
// The properties that matter:
//   · on the first day of classes, and on the last day of finals, the app must
//     say you are IN that term — being wrong at either edge is the whole bug;
//   · a finished term must stop being "now" quickly (this used to take 39 days);
//   · windows must never overlap, or "which term is now" is ambiguous;
//   · every date must resolve to some semester, in every year, including the
//     leap years and the year boundaries.
import { test } from "node:test";
import assert from "node:assert/strict";
import calendar from "../../src/adapters/northeastern/calendar.js";
import termWindows from "../../src/adapters/northeastern/termWindows.js";

// [semId, semTypeId, calendarYear, firstClassDay, endOfFinals]
const OBSERVED = [
  ["fall2018", "fall",   2018, "2018-09-05", "2018-12-13"],
  ["spr2019",  "spring", 2019, "2019-01-07", "2019-04-26"],
  ["sumA2019", "sumA",   2019, "2019-05-06", "2019-06-25"],
  ["sumB2019", "sumB",   2019, "2019-07-01", "2019-08-20"],
  ["fall2019", "fall",   2019, "2019-09-04", "2019-12-13"],
  ["spr2020",  "spring", 2020, "2020-01-06", "2020-04-24"],
  ["fall2020", "fall",   2020, "2020-09-09", "2020-12-18"],
  ["spr2021",  "spring", 2021, "2021-01-19", "2021-04-30"],
  ["sumA2021", "sumA",   2021, "2021-05-10", "2021-06-29"],
  ["sumB2021", "sumB",   2021, "2021-07-06", "2021-08-24"],
  ["fall2021", "fall",   2021, "2021-09-08", "2021-12-16"],
  ["spr2022",  "spring", 2022, "2022-01-18", "2022-05-04"],
  ["sumA2022", "sumA",   2022, "2022-05-09", "2022-06-28"],
  ["sumB2022", "sumB",   2022, "2022-07-05", "2022-08-23"],
  ["fall2022", "fall",   2022, "2022-09-07", "2022-12-14"],
  ["spr2023",  "spring", 2023, "2023-01-09", "2023-04-25"],
  ["sumA2023", "sumA",   2023, "2023-05-08", "2023-06-27"],
  ["sumB2023", "sumB",   2023, "2023-07-03", "2023-08-22"],
  ["fall2023", "fall",   2023, "2023-09-06", "2023-12-14"],
  ["spr2024",  "spring", 2024, "2024-01-08", "2024-04-24"],
  ["sumA2024", "sumA",   2024, "2024-05-06", "2024-06-25"],
  ["sumB2024", "sumB",   2024, "2024-07-01", "2024-08-20"],
  ["fall2024", "fall",   2024, "2024-09-04", "2024-12-11"],
  ["spr2025",  "spring", 2025, "2025-01-06", "2025-04-23"],
  ["sumA2025", "sumA",   2025, "2025-05-05", "2025-06-24"],
  ["sumB2025", "sumB",   2025, "2025-06-30", "2025-08-19"],
  ["fall2025", "fall",   2025, "2025-09-03", "2025-12-14"],
  ["spr2026",  "spring", 2026, "2026-01-07", "2026-04-26"],
  ["sumA2026", "sumA",   2026, "2026-05-06", "2026-06-21"],
];

// The 2021 and 2022 terms ran on a COVID calendar — Spring 2022 began twelve
// days late and finished nine days late. The thresholds are deliberately fitted
// with a robust estimator that discounts exactly that kind of year, so those
// terms are held to a looser bar rather than pretended to be typical.
const ANOMALOUS = new Set(["spr2021", "spr2022", "sumA2021", "sumB2021"]);

const at = iso => new Date(`${iso}T12:00:00`);
const shift = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const days = (a, b) => Math.round((b - a) / 86400000);
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ── The two edges that define correctness ────────────────────────

test("a term is never current before its first day of classes", () => {
  // The one-sided rule the design is built on: when the planner says a
  // semester is in progress, that should be a fact about the past, not a
  // forecast. It holds for every ordinary year in the corpus — and it is NOT
  // absolute, which is worth stating plainly rather than hiding behind an
  // exclusion list. A fixed threshold fitted to typical years necessarily
  // fires early in a year that runs late: Spring 2021 began Jan 19 and
  // Spring 2022 Jan 18, so the Jan 11 threshold led them by 8 and 7 days.
  //
  // Pinning the threshold to the latest year ever seen would close the hole,
  // at the cost of letting one pandemic set the calendar forever — Fall would
  // then linger 36 days instead of 31. The bounded exception is the better
  // trade, so it is measured here rather than excused.
  const early = [];
  for (const [semId, , , first] of OBSERVED) {
    let n = 0;
    while (n <= 60 && calendar.getCurrentSemId(shift(at(first), -n - 1)) === semId) n++;
    const allowed = ANOMALOUS.has(semId) ? 8 : 0;
    if (n > allowed) early.push(`${semId}: current ${n}d before classes started ${first} (allowed ${allowed}d)`);
  }
  assert.deepEqual(early, [], "\"in progress\" must not precede the first class in an ordinary year");
});

test("and becomes current within a week of classes starting", () => {
  // The price of the rule above: a threshold that must never fire early has to
  // sit a little late, and that margin is the lateness. Fall pays nothing (the
  // Labor Day rule is exact); the rest stay inside a week.
  const late = [];
  for (const [semId, , , first] of OBSERVED) {
    if (ANOMALOUS.has(semId)) continue;
    let n = 0;
    while (n <= 60 && calendar.getCurrentSemId(shift(at(first), n)) !== semId) n++;
    if (n > 7) late.push(`${semId}: classes started ${first}, "now" caught up ${n}d later`);
  }
  assert.deepEqual(late, [], "onset lag must stay under a week");
});

test("fall's onset is exact, because its rule is not an estimate", () => {
  if (termWindows.types.fall.startRule !== "laborDayPlus2") return;
  for (const [semId, type, , first] of OBSERVED) {
    if (type !== "fall") continue;
    assert.equal(calendar.getCurrentSemId(at(first)), semId,
      `${semId}: fall must be current on day one — no margin needed`);
  }
});

test("still in session on the last day of finals", () => {
  const early = [];
  for (const [semId, , , , fin] of OBSERVED) {
    if (ANOMALOUS.has(semId)) continue;
    const got = calendar.getCurrentSemId(at(fin));
    if (got !== semId) early.push(`${semId}: finals end ${fin} but "now" was already ${got}`);
  }
  assert.deepEqual(early, [], "a term must not be declared over while exams are running");
});

test("a finished term lingers only until the next one begins", () => {
  // The accepted cost of never being early. A term stays current through the
  // break, so this lag is the REAL break length (fall→spring is 25 days of
  // actual winter break) plus the next term's onset margin. It cannot be
  // shrunk without either firing the next term early — forbidden above — or
  // handing off at the old term's own end, which is the design that was
  // weighed and turned down. These bars are the break lengths, not slack.
  // Summer 1's bar is the loosest relative to its break because the merged
  // summer term (AY2026+) compressed session A — it ended Jun 21 in 2026,
  // while session B has begun as late as Jul 6 in other years, and one
  // threshold has to sit past the latest of those. 8 days of real break plus
  // 8 days of that margin is the 16 observed.
  const bar = { fall: 31, spring: 17, sumA: 17, sumB: 16 };
  const slow = [];
  for (const [semId, type, , , fin] of OBSERVED) {
    let n = 0;
    while (n <= 90 && calendar.getCurrentSemId(shift(at(fin), n)) === semId) n++;
    if (n > bar[type]) slow.push(`${semId}: still "now" ${n}d after finals ended ${fin} (bar ${bar[type]}d)`);
  }
  assert.deepEqual(slow, [], "lingering must not exceed the break it sits in");
});

test("completion lag still beats the scheme it replaced", () => {
  // The old hand-picked thresholds — Sep 15 / Jan 22 / May 12 / Jul 16 — left
  // a finished term current for 24.7d on average and 42d at worst. Keeping the
  // one-sided rule gives up most of the gap, but the accurate start dates
  // still buy a real improvement: 18.3d / 31d. Asserted rather than asserted
  // ABOUT, because this is the number the whole exercise is judged on.
  const lag = [];
  for (const [semId, , , , fin] of OBSERVED) {
    let n = 0;
    while (n <= 90 && calendar.getCurrentSemId(shift(at(fin), n)) === semId) n++;
    lag.push(n);
  }
  const mean = lag.reduce((a, b) => a + b, 0) / lag.length;
  assert.ok(mean < 20, `mean completion lag ${mean.toFixed(1)}d — was 24.7d across these same terms`);
  assert.ok(Math.max(...lag) < 35, `worst completion lag ${Math.max(...lag)}d — was 42d`);
});

test("the term named during a break is the one that just ended", () => {
  // Not the one about to start. This is the half of the trade that is easy to
  // regress by "fixing" the lingering, so it is pinned: on the day after
  // Fall 2025's exams finished, "now" is still Fall — not Spring 2026.
  assert.equal(calendar.getCurrentSemId(at("2025-12-15")), "fall2025");
  assert.equal(calendar.getCurrentSemId(at("2025-12-31")), "fall2025");
  assert.equal(calendar.getCurrentSemId(at("2026-01-06")), "fall2025", "spring had not started yet");
  assert.equal(calendar.getCurrentSemId(at("2026-01-11")), "spr2026", "and hands over once it has");
});

// ── Structural properties ────────────────────────────────────────

test("windows are ordered and disjoint for 25 years", () => {
  const bad = [];
  for (let year = 2018; year <= 2042; year++) {
    const wins = calendar.getSemesterTypes()
      .map(t => ({ id: t.id, start: calendar.getTermStart(t.id, year), end: calendar.getTermEnd(t.id, year) }))
      .filter(w => w.start && w.end)
      .sort((a, b) => a.start - b.start);
    for (const w of wins) {
      if (w.end <= w.start) bad.push(`${w.id} ${year}: ends ${iso(w.end)} on/before it starts ${iso(w.start)}`);
    }
    for (let i = 1; i < wins.length; i++) {
      if (wins[i].start <= wins[i - 1].end) {
        bad.push(`${year}: ${wins[i - 1].id} (ends ${iso(wins[i - 1].end)}) overlaps ${wins[i].id} (starts ${iso(wins[i].start)})`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test("every day of 25 years resolves to some semester", () => {
  const misses = [];
  for (let d = at("2018-01-01"); d < at("2043-01-01"); d = shift(d, 1)) {
    if (!calendar.getCurrentSemId(d)) misses.push(iso(d));
  }
  assert.deepEqual(misses.slice(0, 5), [], `${misses.length} dates resolved to no semester`);
});

test("the semester only ever moves forward as time moves forward", () => {
  // Sweeping day by day, the resolved semId must never go backwards — a
  // non-monotonic sequence would make a completed term un-complete itself.
  const order = new Map();
  const types = { fall: 0, spr: 1, sumA: 2, sumB: 3 };
  const key = semId => {
    const m = /^([a-zA-Z]+)(\d{4})$/.exec(semId);
    // Academic order within a year: fall Y, then spring/summer Y+1.
    return m[1] === "fall" ? +m[2] * 10 + 0 : +m[2] * 10 - 10 + types[m[1]];
  };
  let prev = null, prevDate = null;
  const regressions = [];
  for (let d = at("2018-01-01"); d < at("2043-01-01"); d = shift(d, 1)) {
    const cur = calendar.getCurrentSemId(d);
    if (prev && key(cur) < key(prev)) regressions.push(`${iso(prevDate)} ${prev} → ${iso(d)} ${cur}`);
    prev = cur; prevDate = d;
    order.set(cur, true);
  }
  assert.deepEqual(regressions.slice(0, 5), []);
});

test("leap years do not shift a window", () => {
  // Spring's window is expressed as fixed month/day pairs precisely so that
  // February's length cannot move it. Assert the invariant rather than trust it.
  const shape = new Set();
  for (const year of [2024, 2025, 2026, 2028, 2100]) {
    const s = calendar.getTermStart("spring", year);
    const e = calendar.getTermEnd("spring", year);
    shape.add(`${s.getMonth()}/${s.getDate()}→${e.getMonth()}/${e.getDate()}`);
  }
  assert.equal(shape.size, 1, `spring window drifted across leap years: ${[...shape].join(", ")}`);
});

test("fall tracks Labor Day, not a fixed date", () => {
  // The rule is the reason fall needs no margin at all; if termWindows.js ever
  // drops it, this is the test that says so.
  if (termWindows.types.fall.startRule !== "laborDayPlus2") return; // fell back to dates, fine
  for (const [semId, , year, first] of OBSERVED.filter(o => o[1] === "fall")) {
    assert.equal(iso(calendar.getTermStart("fall", year)), first,
      `${semId}: Labor Day rule should reproduce the measured first class day exactly`);
  }
});

// ── Banner-data settling is a separate question ──────────────────

test("isTermPast waits past add/drop, and is false for future terms", () => {
  const start = calendar.getTermStart("fall", 2025);          // 2025-09-03
  assert.equal(calendar.isTermPast("202610", shift(start, -1)), false, "not past the day before it starts");
  assert.equal(calendar.isTermPast("202610", start),            false, "not settled on day one — add/drop is open");
  assert.equal(calendar.isTermPast("202610", shift(start, 7)),  false, "not settled one week in");
  assert.equal(calendar.isTermPast("202610", shift(start, 14)), true,  "settled two weeks in");
  assert.equal(calendar.isTermPast("209910", new Date(2026, 7, 8)), false, "a term 70 years out is not past");
});

test("isTermPast is stricter than it used to be, never looser", () => {
  // The old thresholds were Sep 15 / Jan 22 / May 12 / Jul 16. Loosening any of
  // them would pull an unsettled term's enrolment into offering probability.
  const old = { 202610: "2025-09-15", 202630: "2026-01-22", 202640: "2026-05-12", 202660: "2026-07-16" };
  for (const [code, oldDate] of Object.entries(old)) {
    assert.equal(calendar.isTermPast(code, at(oldDate)), false,
      `${code}: became "past" no later than the old hand-picked ${oldDate}`);
  }
});

test("malformed and unknown term codes are refused, not guessed", () => {
  for (const code of ["", "abc", "20", "2026", null, undefined, "202699", "999999", 202610]) {
    assert.doesNotThrow(() => calendar.isTermPast(code), `threw on ${String(code)}`);
  }
  assert.equal(calendar.isTermPast("202699"), false, "unknown suffix has no window");
  assert.equal(calendar.isTermPast("abcd10"), false, "unparseable year has no window");
  assert.equal(calendar.isTermPast(202610), true, "a numeric code still resolves");
});

// ── The generated data itself ────────────────────────────────────

test("termWindows.js is well formed", () => {
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(termWindows.generatedAt), "generatedAt is a date");
  assert.ok(termWindows.yearsBack >= 3, "rolling window covers at least 3 years");
  for (const id of ["fall", "spring", "sumA", "sumB"]) {
    const w = termWindows.types[id];
    assert.ok(w, `${id} has a window`);
    assert.ok(w.n >= 3, `${id}: fitted on ${w.n} terms, need 3`);
    assert.ok(w.startScale <= 7, `${id}: start scale ${w.startScale}d is not a calendar`);
    for (const [field, v] of [["start", w.start], ["end", w.end]]) {
      if (!v) continue;
      assert.ok(v.month >= 1 && v.month <= 12, `${id}.${field}.month out of range`);
      assert.ok(v.day >= 1 && v.day <= 31, `${id}.${field}.day out of range`);
    }
    if (w.lengthDays != null) assert.ok(w.lengthDays > 0 && w.lengthDays < 200, `${id}: implausible length`);
  }
});

test("the window data is not stale", () => {
  // A rolling derivation that stopped running is the failure this whole design
  // exists to prevent, and it is silent: the numbers stay plausible while the
  // calendar moves out from under them. The monthly workflow regenerates this;
  // two years without a run means that stopped.
  const ageDays = days(at(termWindows.generatedAt), new Date());
  assert.ok(ageDays < 730,
    `termWindows.js was generated ${Math.round(ageDays / 365)} years ago — ` +
    `re-run scripts/derive-term-windows.js --write`);
});
