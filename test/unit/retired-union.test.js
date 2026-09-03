// UNIT · deriveRetiredUnion — the edition roll, simulated before it happens.
//
// ── Why this is the whole point of the module ───────────────────────
//
// Run against the repo as it stands today, `derive-retired-union.js` reports
// "retired union: 0 courses", and it is right to: the frozen 2026 snapshot and
// the shipped catalog are the same edition, so nothing has retired yet. Which
// means the code that matters — what happens when a roll retires a thousand
// courses — is exercised by nothing at all until the morning of 2026-10-01,
// unattended, on a job that pushes straight to main.
//
// That is exactly the situation `course-retention.js` describes escaping by
// injecting its IO ("the one way to find out whether it ran was to spend 29
// minutes and see"). So the roll is simulated here instead: take the real
// 7,966-course snapshot, delete courses from the CATALOG side, and assert the
// union recovers precisely those and nothing else.
//
// The simulation uses the real snapshot rather than three hand-written
// fixtures. A fixture proves the arithmetic; only the real corpus catches the
// duplicate keys, missing subjects and odd records that a scrape actually
// contains.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { deriveRetiredUnion } from "../../scripts/derive-retired-union.js";
import { keyOfCourse } from "../../scripts/lib/course-retention.js";

const SNAPSHOT = JSON.parse(readFileSync(
  new URL("../../data/northeastern/catalog/editions/2026/catalog-courses.json", import.meta.url), "utf8"));

/** A post-roll catalog: the snapshot minus `n` courses, plus one brand-new one. */
function simulateRoll(n) {
  const gone = SNAPSHOT.slice(0, n);
  const kept = SNAPSHOT.slice(n);
  // A roll ADDS courses too — 923 of them in the real 2027 roll — and a new
  // course must not be mistaken for anything. It is in neither snapshot nor
  // union; it simply exists.
  const added = { subject: "ZZZZ", number: "9001", title: "Brand New", credits: 4 };
  return { catalog: [...kept, added], gone };
}

describe("deriveRetiredUnion", () => {
  test("today: the snapshot IS the catalog, so nothing is retired", () => {
    const { retired } = deriveRetiredUnion(SNAPSHOT, [{ year: 2026, rows: SNAPSHOT }]);
    assert.equal(retired.length, 0,
      "the shipped catalog and the frozen 2026 snapshot are the same edition — "
      + "a non-empty union here means one of them moved");
  });

  test("the roll: the union recovers exactly the courses the catalog dropped", () => {
    // 1,089 is the measured size of the real 2026→2027 retirement
    // (974 absent from live + 115 in 10 subjects with no live page).
    const { catalog, gone } = simulateRoll(1089);
    const { retired } = deriveRetiredUnion(catalog, [{ year: 2026, rows: SNAPSHOT }]);

    const got  = new Set(retired.map(keyOfCourse));
    const want = new Set(gone.map(keyOfCourse));
    assert.equal(got.size, want.size, `expected ${want.size} retired, got ${got.size}`);
    for (const k of want) assert.ok(got.has(k), `${k} was dropped from the catalog but is not in the union`);
  });

  test("disjointness: no key is ever in both files", () => {
    const { catalog } = simulateRoll(500);
    const { retired } = deriveRetiredUnion(catalog, [{ year: 2026, rows: SNAPSHOT }]);
    const current = new Set(catalog.map(keyOfCourse));
    const both = retired.map(keyOfCourse).filter(k => current.has(k));
    assert.deepEqual(both, [],
      "a key in both the catalog and the union makes the runtime lookup ambiguous, "
      + "which is the one thing the disjoint design forbids");
  });

  test("a retired course keeps its full record, not a stub", () => {
    // The point of the union is that the card still renders. `occupantCards`
    // warns that card rendering reads several fields unguarded — `color.slice()`
    // was the one that threw — so a stub would trade a silent disappearance for
    // a crash, which is worse.
    const { catalog, gone } = simulateRoll(50);
    const { retired } = deriveRetiredUnion(catalog, [{ year: 2026, rows: SNAPSHOT }]);
    const byKey = new Map(retired.map(c => [keyOfCourse(c), c]));
    for (const original of gone) {
      const got = byKey.get(keyOfCourse(original));
      assert.ok(got, `${keyOfCourse(original)} missing from the union`);
      for (const field of Object.keys(original)) {
        if (field === "retired" || field === "retiredSince") continue;
        assert.deepEqual(got[field], original[field],
          `${keyOfCourse(original)}.${field} was altered on its way into the union`);
      }
    }
  });

  test("the lifespan names editions, never a scrape date", () => {
    const { catalog } = simulateRoll(20);
    const { retired } = deriveRetiredUnion(catalog, [{ year: 2026, rows: SNAPSHOT }]);
    for (const c of retired) {
      assert.deepEqual(c.lifespan,
        { firstEdition: 2026, lastEdition: 2026, editions: [2026], editionsHeld: 1 },
        `${keyOfCourse(c)} carries a lifespan that does not match the one edition on disk`);
      assert.equal(c.retiredSince, undefined,
        "retiredSince is the day OUR scrape missed the course — a fact about us, not the catalog");
      assert.equal(c.retired, undefined, "the lifespan replaces the boolean; two of them drift");
    }
  });

  test("a snapshot record already carrying retired/retiredSince is cleaned", () => {
    // Found by `mutation-probe.js --only union:`, which deleted the strip and
    // watched every test still pass. The assertion above ("retiredSince is
    // undefined") looked like it covered this and did not: the 2026 snapshot is
    // pre-roll, so no record in it carries either field and the check passed
    // trivially against 7,966 courses.
    //
    // It is not hypothetical. `retainReferencedCourses` writes `retired: true`
    // and `retiredSince` into the courses it rescues INTO the catalog, so the
    // moment a snapshot is frozen from a post-roll catalog its records carry
    // both — and a stale scrape date riding beside the lifespan is two
    // representations of one fact, which is what this file exists to end.
    const rows = [{
      subject: "CS", number: "9004", title: "Rescued Once", credits: 4,
      retired: true, retiredSince: "2026-10-01",
    }];
    const [got] = deriveRetiredUnion([], [{ year: 2026, rows }]).retired;
    assert.equal(got.retiredSince, undefined, "a stale scrape date survived into the union");
    assert.equal(got.retired, undefined, "a stale retirement boolean survived beside the lifespan");
    assert.equal(got.title, "Rescued Once", "the strip took the rest of the record with it");
    assert.equal(got.lifespan.firstEdition, 2026);
  });

  test("multiple editions: the lifespan spans them and the NEWEST record wins", () => {
    // The freshest published description is the least stale thing we can show,
    // so a course carried by two editions must keep the later copy.
    const old  = [{ subject: "CS", number: "9001", title: "Old Title",  credits: 4 },
                  { subject: "CS", number: "9002", title: "Only In Old", credits: 4 }];
    const mid  = [{ subject: "CS", number: "9001", title: "New Title",  credits: 4 }];
    const { retired } = deriveRetiredUnion([], [
      { year: 2027, rows: mid },     // deliberately out of order — the function sorts
      { year: 2026, rows: old },
    ]);
    const byKey = new Map(retired.map(c => [keyOfCourse(c), c]));

    assert.equal(byKey.get("CS9001").title, "New Title", "the older record overwrote the newer one");
    assert.deepEqual(byKey.get("CS9001").lifespan,
      { firstEdition: 2026, lastEdition: 2027, editions: [2026, 2027], editionsHeld: 2 });
    assert.deepEqual(byKey.get("CS9002").lifespan,
      { firstEdition: 2026, lastEdition: 2026, editions: [2026], editionsHeld: 2 },
      "a course present in only the older edition must not claim the newer one");
  });

  test("self-pruning: dropping an edition drops its exclusive courses", () => {
    // The property that stops the union growing without bound, and the reason
    // it is derived from the frozen snapshots rather than from last month's
    // catalog. It must hold by construction, not by a cleanup step.
    const old = [{ subject: "CS", number: "9002", title: "Only In Old", credits: 4 }];
    const withOld    = deriveRetiredUnion([], [{ year: 2026, rows: old }]);
    const withoutOld = deriveRetiredUnion([], []);
    assert.equal(withOld.retired.length, 1);
    assert.equal(withoutOld.retired.length, 0,
      "removing the only edition naming a course must remove it from the union");
  });

  describe("the missing-edition alarm", () => {
    // The union is only as complete as the snapshots behind it. A course that
    // lives in exactly ONE edition — born in 2027, gone in 2028 — is resolvable
    // only if a 2027 snapshot exists, and if that capture is missed it becomes
    // permanently unresolvable with nothing recording the loss. The archive is
    // no fallback: it lags and has already skipped 2025-2026 entirely.
    //
    // `unseen` is the detector, and it needs no network and no edition field on
    // the catalog (there is none): a snapshot of edition N holds ALL of N, so a
    // current catalog holding courses in no snapshot has rolled past the newest
    // capture. Tested here because it is false for the whole of the repo's
    // present state and would otherwise first run during the roll it warns about.

    test("quiet while the catalog matches a frozen edition", () => {
      const { unseen } = deriveRetiredUnion(SNAPSHOT, [{ year: 2026, rows: SNAPSHOT }]);
      assert.deepEqual(unseen, [],
        "the shipped catalog IS the 2026 snapshot, so nothing in it can be unseen");
    });

    test("fires when the catalog has rolled past the newest snapshot", () => {
      // What Oct 1 looks like: the roll removes courses AND adds 923 new ones.
      // The additions are the signal — removals alone are ordinary retirement.
      const { catalog } = simulateRoll(1089);
      const { unseen } = deriveRetiredUnion(catalog, [{ year: 2026, rows: SNAPSHOT }]);
      assert.deepEqual(unseen, ["ZZZZ9001"],
        "the new course exists in no frozen edition, so the catalog has rolled past 2026 "
        + "and this edition needs freezing before the NEXT roll");
    });

    test("silenced again once the new edition is frozen", () => {
      // The alarm must be answerable, or it becomes permanent noise that gets
      // filtered out — which is how the alert that matters goes unread.
      const { catalog } = simulateRoll(1089);
      const { unseen } = deriveRetiredUnion(catalog, [
        { year: 2026, rows: SNAPSHOT },
        { year: 2027, rows: catalog },
      ]);
      assert.deepEqual(unseen, [], "freezing the current edition must clear the warning");
    });
  });

  test("a revived course leaves the union", () => {
    // NEU does un-retire courses. A stale entry would offer a student a course
    // that is currently in the catalog, from the file that says it is gone.
    const rows = [{ subject: "CS", number: "9003", title: "Back Again", credits: 4 }];
    assert.equal(deriveRetiredUnion([], [{ year: 2026, rows }]).retired.length, 1,
      "absent from the catalog, so it is retired");
    assert.equal(deriveRetiredUnion(rows, [{ year: 2026, rows }]).retired.length, 0,
      "the course is in the current catalog again, so it is not retired");
  });
});
