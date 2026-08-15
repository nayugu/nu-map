// Work experience is drawn in the theme's INK, not in a subject hue.
//
// The colour must agree with the co-op GRANT about what a work term is, so it
// reads the same table: `course.coop`, stamped from coop-courses.json. This
// file exists to keep it from drifting back to a title guess — the first
// attempt was a regex, and it inked `CS 1210 Professional Development for
// Khoury Co-op`, a 1 SH class you sit in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isInkCourse, isInkGroup, courseInk, subjectColor, INK } from "../../src/core/courseModel.js";
import { stampCoopVariants } from "../../src/adapters/northeastern/courseNorm.js";
import { SUBJECT_PALETTE } from "../../src/core/constants.js";

const WHITE = "#ffffff", BLACK = "#000000";
const rec = (subject, title, extra = {}) =>
  ({ subject, title, color: subjectColor(subject), ...extra });

// ── the predicate is the stamp, and only the stamp ──────────────────
test("a stamped course inks; an unstamped one keeps its hue", () => {
  const work = rec("COOP", "Co-op Work Experience", { coop: { abroad: false, halfTime: false, kind: "coop" } });
  assert.ok(isInkCourse(work));
  assert.equal(courseInk(work, true), WHITE);
  assert.equal(courseInk(work, false), BLACK);

  const prep = rec("CS", "Professional Development for Khoury Co-op");
  assert.ok(!isInkCourse(prep));
  assert.equal(courseInk(prep, true), subjectColor("CS"));
  assert.equal(courseInk(prep, false), subjectColor("CS"));
});

test("the title is not consulted — in either direction", () => {
  // A co-op title with no stamp is a class.
  assert.ok(!isInkCourse(rec("ENCP", "Introduction to Cooperative Education")));
  assert.ok(!isInkCourse(rec("GST", "International Conflict and Cooperation")));
  // A stamped course with an unhelpful title is still a work term.
  assert.ok(isInkCourse(rec("XYZ", "", { coop: { kind: "intern" } })));
});

test("a reservation is never inked — it has its own neutral grey", () => {
  const r = { subject: "", title: "Co-op Work Experience", isReservation: true,
              color: "#94a3b8", coop: { kind: "coop" } };
  assert.ok(!isInkCourse(r));
  assert.equal(courseInk(r, true), "#94a3b8");
});

test("junk shapes do not throw", () => {
  for (const bad of [null, undefined, {}, { coop: null }, { coop: false }, { title: 42 }])
    assert.doesNotThrow(() => { isInkCourse(bad); courseInk(bad, true); });
  assert.equal(courseInk({ subject: "CS" }, true), subjectColor("CS"));
});

// ── groups ──────────────────────────────────────────────────────────
test("a group inks only when every course in it is a work term", () => {
  const w = rec("COOP", "Co-op Work Experience", { coop: { kind: "coop" } });
  const c = rec("CS", "Algorithms");
  assert.ok(isInkGroup([w, w]));
  assert.ok(!isInkGroup([w, c]));
  assert.ok(!isInkGroup([]));            // an empty group is not "all work terms"
  assert.ok(!isInkGroup(null));
  assert.ok(!isInkGroup([w, undefined])); // a missing course is not one either
});

test("neither ink collides with a palette slot", () => {
  for (const hex of SUBJECT_PALETTE) {
    assert.notEqual(hex.toLowerCase(), WHITE);
    assert.notEqual(hex.toLowerCase(), BLACK);
  }
  assert.equal(INK(true), WHITE);
  assert.equal(INK(false), BLACK);
});

// ── against the live tables, stamped the way the app stamps them ────
const read = p => JSON.parse(readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8"));
const catalog = read("../../public/northeastern/catalog-courses.json");
const coopJson = read("../../public/northeastern/coop-courses.json");
const courses = stampCoopVariants(
  (Array.isArray(catalog) ? catalog : Object.values(catalog.courses ?? catalog))
    .map(c => ({ ...c, id: c.id ?? `${c.subject}${c.number}` })),
  coopJson);
const byId = Object.fromEntries(courses.map(c => [c.id, c]));

test("the corpus inks exactly the co-op table, nothing more", () => {
  const inked = courses.filter(isInkCourse).map(c => c.id).sort();
  assert.deepEqual(inked, Object.keys(coopJson.courses).sort());
});

test("the prep seminars keep their department's colour", () => {
  // Named individually: these are the ones a title rule got wrong, and the
  // point of the table is that they are ordinary classes a student places.
  for (const id of ["CS1210", "ENCP6100", "ENCP2000", "SLPA2000", "BUSN1103",
                    "COP3940", "MATH3000", "CRIM3000", "EXED6959"]) {
    const c = byId[id];
    if (!c) continue;                     // catalog churn is not this test's business
    assert.ok(!isInkCourse(c), `${id} — ${c.title}`);
    // Raw catalog records carry no `color` — that is added by normalize — so
    // the fallback is the subject hue, which is the same colour either way.
    assert.equal(courseInk(c, true), subjectColor(c.subject));
  }
});

test("the registrations do ink", () => {
  for (const id of ["COOP3945", "COOP3948", "COP6945", "BINF6964", "ARTE6964"]) {
    const c = byId[id];
    if (!c) continue;
    assert.ok(isInkCourse(c), `${id} — ${c.title}`);
    assert.equal(courseInk(c, false), BLACK);
  }
});

test("no table means no ink — never a wrong colour", () => {
  // The table is an optional asset. If it fails to load, `stampCoopVariants`
  // leaves every course untouched and the whole feature degrades to silence.
  const unstamped = stampCoopVariants(courses.map(({ coop, ...rest }) => rest), null);
  assert.equal(unstamped.filter(isInkCourse).length, 0);
});
