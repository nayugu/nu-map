// The entry year a NEW plan opens at — and why it must never be a constant.
//
// ── The fuse ────────────────────────────────────────────────────────
//
// `getDefaultStartYear` returned a literal `2026`. It sets `planEntYear`, which sets the
// cohort, which selects the CATALOG EDITION a student's requirements are read from
// (`pickCatalogYear` takes the newest edition <= the cohort year). Frozen, every plan
// created from fall 2027 onward would have opened against the 2026 catalog: the wrong
// degree, chosen silently, for precisely the students with no way to notice.
//
// Nothing would have failed. No test, no rail, no log. The app would just have been a year
// stale for every new user, and then two years, and so on. That is the shape this file
// exists to keep out — a defect with a period of one year, which cannot be held by anyone
// remembering it.
//
// Sits beside `no-pinned-edition.test.js`, which does the same job for the scripts.
import { test } from "node:test";
import assert from "node:assert/strict";
import calendar from "../../src/adapters/northeastern/calendar.js";

const at = (iso) => calendar.getDefaultStartYear(new Date(`${iso}T12:00:00`));

test("the default entry year is the academic year in PROGRESS, not the calendar year", () => {
  // August anchor: the academic year turns over with the fall term, so everything from
  // August to December belongs to the year it starts in, and January to July belongs to the
  // year before.
  assert.equal(at("2026-09-10"), 2026, "September is in the year that just began");
  assert.equal(at("2026-08-01"), 2026, "the anchor month itself has already turned over");
  assert.equal(at("2026-12-31"), 2026);
  assert.equal(at("2027-01-05"), 2026, "spring belongs to the academic year that began in fall");
  assert.equal(at("2027-03-01"), 2026);
  assert.equal(at("2027-07-31"), 2026, "summer is still the old academic year");
  assert.equal(at("2027-08-01"), 2027, "...and it turns over on the anchor");
});

test("it agrees with the constant it replaced, on the day it replaced it", () => {
  // The change is a fuse removed, not a behaviour altered. If this ever fails, the
  // derivation drifted from the value that was hand-checked against the real app.
  assert.equal(at("2026-09-10"), 2026);
});

test("it tracks forward without anyone editing it — the whole point", () => {
  // Stated as a property over a decade rather than as a handful of dates: for every year,
  // the September answer is that year. A constant passes exactly one iteration of this.
  for (let y = 2026; y <= 2036; y++) {
    assert.equal(at(`${y}-09-15`), y, `September ${y} did not resolve to ${y}`);
    assert.equal(at(`${y + 1}-02-15`), y, `February ${y + 1} did not resolve to ${y}`);
  }
});

test("it is one-sided in the same direction as getCurrentSemId", () => {
  // "Now" never names a term that has not started. The default entry year follows the same
  // rule, and the reason is not symmetry for its own sake: guessing FORWARD would put every
  // returning student on an edition they do not follow, which is the unrecoverable
  // direction. A prospective student planning ahead changes it in one click.
  //
  // July 2027 is the discriminating case: the 2027-2028 catalog may already be published,
  // but the academic year in progress is still 2026-2027.
  assert.equal(at("2027-07-20"), 2026,
    "the default jumped to an academic year nobody has started yet");
});

test("the anchor is read from the calendar, not hard-coded twice", () => {
  // The month index is derived from `getYearAnchor`, so there is one definition of when the
  // year turns over. If the two were separate constants they would agree only until someone
  // edited one of them — the same failure as the two copies of the edition resolver in the
  // scripts.
  assert.equal(calendar.getYearAnchor(), "august");
  assert.equal(at("2026-07-31"), 2025, "July is before an August anchor");
  assert.equal(at("2026-08-01"), 2026, "August is on it");
});

test("no argument means now, and it is a plausible year", () => {
  // The production call site passes nothing. A default parameter that threw, or returned
  // NaN, would take the whole planner down on first render — and `npm test` is not what
  // catches that (see CLAUDE.md: a green Node suite says nothing about whether the app
  // renders), so it is worth one cheap assertion here.
  const y = calendar.getDefaultStartYear();
  assert.equal(typeof y, "number");
  assert.ok(Number.isInteger(y) && y >= 2020 && y <= 2100, `implausible default year: ${y}`);
  const nowY = new Date().getFullYear();
  assert.ok(y === nowY || y === nowY - 1, `${y} is not this academic year or the last`);
});
