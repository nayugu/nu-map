// UNIT · rotate-mode merge + change-log logic for scripts/scrape-catalog.js.
// The merge logic is inlined below and MUST mirror scrape-catalog.js exactly;
// this test is the guard that catches drift in that mirror. No network, no writes.
// (Migrated from scripts/test-rotate-logic.js into node:test.)
import { test } from "node:test";
import assert from "node:assert/strict";

// ── Logic under test (mirror of scrape-catalog.js) ──────────────────
const DIFF_FIELDS = ["title", "credits", "creditsMax", "scheduleType", "description", "nuPath", "prereqs", "coreqs", "repeatable", "repeatMax", "repeatMaxSH"];

function diffCourse(prev, next) {
  const changes = [];
  for (const field of DIFF_FIELDS) {
    const before = JSON.stringify(prev[field] ?? null);
    const after = JSON.stringify(next[field] ?? null);
    if (before !== after) {
      changes.push({ field, before: prev[field] ?? null, after: next[field] ?? null });
    }
  }
  return changes;
}

function mergeSubject(existing, freshCourses, subjectCode) {
  const existingForSubject = new Map(
    existing.filter((c) => c.subject === subjectCode).map((c) => [`${c.subject} ${c.number}`, c])
  );
  const existingOther = existing.filter((c) => c.subject !== subjectCode);
  const catMap = new Map(freshCourses.map((c) => [`${c.subject} ${c.number}`, c]));

  const addedCodes = [];
  const modifiedCourses = [];
  const removedCodes = [];
  let unchangedCount = 0;
  const mergedSubject = [];

  for (const [key, cat] of catMap) {
    const prev = existingForSubject.get(key);
    if (!prev) {
      mergedSubject.push(cat);
      addedCodes.push(key);
    } else {
      const merged = {
        ...prev,
        title: cat.title || prev.title,
        credits: cat.credits || prev.credits,
        scheduleType: cat.scheduleType || prev.scheduleType,
        description: cat.description || prev.description,
        nuPath: cat.nuPath?.length ? cat.nuPath : prev.nuPath,
        prereqs: cat.prereqs?.length ? cat.prereqs : prev.prereqs,
        coreqs: cat.coreqs?.length ? cat.coreqs : prev.coreqs,
        // Repeatability rides the description — mirrors scrape-catalog.js:
        // a catalog description makes its parse authoritative; `undefined`
        // spreads clear stale fields (dropped by JSON.stringify on write).
        ...(cat.description ? { repeatable: cat.repeatable, repeatMax: cat.repeatMax, repeatMaxSH: cat.repeatMaxSH } : {}),
      };
      const changes = diffCourse(prev, merged);
      if (changes.length > 0) modifiedCourses.push({ code: key, changes });
      else unchangedCount++;
      mergedSubject.push(merged);
      existingForSubject.delete(key);
    }
  }
  for (const [key, c] of existingForSubject) {
    removedCodes.push(key);
    mergedSubject.push(c);
  }
  return { updated: [...existingOther, ...mergedSubject], addedCodes, modifiedCourses, removedCodes, unchangedCount };
}

// ── Fixtures ────────────────────────────────────────────────────────
const baseCS2100 = {
  subject: "CS", number: "2100", title: "Program Design and Implementation 1",
  credits: 4, scheduleType: "Lecture", nuPath: ["AD", "ND"],
  description: "Builds on prior introductory programming experience…",
  prereqs: [{ subject: "CS", number: "2000" }, "Or", { subject: "CS", number: "2500" }],
  coreqs: [{ subject: "CS", number: "2101" }],
  sections: [{ crn: "12345", term: "202530" }], // enrollment data — must survive merge
};
const baseCS2101 = {
  subject: "CS", number: "2101", title: "Lab for CS 2100", credits: 1, scheduleType: "Lab",
  nuPath: [], description: "Accompanies CS 2100.", prereqs: [], coreqs: [], sections: [],
};
const otherCourse = {
  subject: "DS", number: "2000", title: "Programming with Data", credits: 4, scheduleType: "Lecture",
  nuPath: ["AD"], description: "DS course.", prereqs: [], coreqs: [], sections: [{ crn: "99999", term: "202530" }],
};

// ── diffCourse ──────────────────────────────────────────────────────
test("diffCourse › single title change › one diff with correct before/after", () => {
  const diff = diffCourse(baseCS2100, { ...baseCS2100, title: "Program Design 1 (Revised)" });
  assert.equal(diff.length, 1);
  assert.equal(diff[0].field, "title");
  assert.equal(diff[0].before, "Program Design and Implementation 1");
  assert.equal(diff[0].after, "Program Design 1 (Revised)");
});

test("diffCourse › nuPath reordered › reported as a (cosmetic) diff", () => {
  const diff = diffCourse({ ...baseCS2100, nuPath: ["AD", "ND"] }, { ...baseCS2100, nuPath: ["ND", "AD"] });
  assert.equal(diff.length, 1);
  assert.equal(diff[0].field, "nuPath");
});

test("diffCourse › identical courses › empty diff", () => {
  assert.equal(diffCourse(baseCS2100, { ...baseCS2100 }).length, 0);
});

test("diffCourse › two fields changed › both reported", () => {
  const diff = diffCourse(baseCS2100, { ...baseCS2100, credits: 3, description: "Updated." });
  assert.equal(diff.length, 2);
  assert.ok(diff.some((d) => d.field === "credits"));
  assert.ok(diff.some((d) => d.field === "description"));
});

// ── mergeSubject ────────────────────────────────────────────────────
test("mergeSubject › existing course › sections preserved (not overwritten by catalog)", () => {
  const { updated } = mergeSubject([baseCS2100, otherCourse], [{ ...baseCS2100, sections: [] }], "CS");
  const merged = updated.find((c) => c.subject === "CS" && c.number === "2100");
  assert.ok(merged);
  assert.deepEqual(merged.sections, baseCS2100.sections);
});

test("mergeSubject › new catalog course › added and listed in addedCodes", () => {
  const newCS = { subject: "CS", number: "9999", title: "New", credits: 4, scheduleType: "Lecture", nuPath: ["FQ"], description: "New.", prereqs: [], coreqs: [], sections: [] };
  const { updated, addedCodes } = mergeSubject([baseCS2100, otherCourse], [baseCS2100, baseCS2101, newCS], "CS");
  assert.ok(updated.some((c) => c.number === "9999"));
  assert.ok(addedCodes.includes("CS 9999"));
  assert.ok(addedCodes.includes("CS 2101"));
});

test("mergeSubject › course gone from catalog › kept in data and flagged removed", () => {
  const { updated, removedCodes } = mergeSubject([baseCS2100, baseCS2101, otherCourse], [baseCS2100], "CS");
  assert.ok(updated.some((c) => c.number === "2101"));
  assert.ok(removedCodes.includes("CS 2101"));
});

test("mergeSubject › other subjects › left untouched", () => {
  const { updated } = mergeSubject([baseCS2100, otherCourse], [{ ...baseCS2100, credits: 3 }], "CS");
  const ds = updated.find((c) => c.subject === "DS");
  assert.ok(ds);
  assert.deepEqual(ds.sections, otherCourse.sections);
});

test("mergeSubject › description rewrite › flagged in modifiedCourses", () => {
  const { modifiedCourses, unchangedCount } = mergeSubject(
    [baseCS2100, otherCourse],
    [{ ...baseCS2100, sections: [], description: "Completely rewritten." }],
    "CS"
  );
  assert.equal(modifiedCourses.length, 1);
  assert.equal(modifiedCourses[0].code, "CS 2100");
  assert.equal(modifiedCourses[0].changes[0].field, "description");
  assert.equal(unchangedCount, 0);
});

test("mergeSubject › unchanged course › counted, not flagged", () => {
  const { modifiedCourses, unchangedCount } = mergeSubject([baseCS2100, otherCourse], [{ ...baseCS2100, sections: [] }], "CS");
  assert.equal(modifiedCourses.length, 0);
  assert.equal(unchangedCount, 1);
});

test("mergeSubject › repeatability appears in catalog › fields set and flagged", () => {
  const fresh = {
    ...baseCS2100, sections: [],
    description: baseCS2100.description + " May be repeated twice for a maximum of 12 semester hours.",
    repeatable: true, repeatMax: 3, repeatMaxSH: 12,
  };
  const { updated, modifiedCourses } = mergeSubject([baseCS2100, otherCourse], [fresh], "CS");
  const cs = updated.find((c) => c.subject === "CS" && c.number === "2100");
  assert.equal(cs.repeatable, true);
  assert.equal(cs.repeatMax, 3);
  assert.equal(cs.repeatMaxSH, 12);
  assert.deepEqual(cs.sections, baseCS2100.sections); // enrollment data still survives
  const fields = modifiedCourses[0].changes.map((ch) => ch.field);
  assert.ok(fields.includes("repeatable") && fields.includes("repeatMax") && fields.includes("repeatMaxSH"));
});

test("mergeSubject › repeat sentence removed from catalog › stale fields cleared", () => {
  const prev = { ...baseCS2100, repeatable: true, repeatMax: 3, repeatMaxSH: 12 };
  const fresh = { ...baseCS2100, sections: [] }; // description present, no repeat fields
  const { updated, modifiedCourses } = mergeSubject([prev, otherCourse], [fresh], "CS");
  const cs = updated.find((c) => c.subject === "CS" && c.number === "2100");
  // undefined-spread clearing: JSON round-trip (as on write) must drop the keys
  const written = JSON.parse(JSON.stringify(cs));
  assert.ok(!("repeatable" in written) && !("repeatMax" in written) && !("repeatMaxSH" in written));
  const fields = modifiedCourses[0].changes.map((ch) => ch.field);
  assert.ok(fields.includes("repeatable"));
});

test("mergeSubject › catalog has no description › previous repeat fields preserved", () => {
  const prev = { ...baseCS2100, repeatable: true, repeatMax: 3 };
  const fresh = { ...baseCS2100, sections: [], description: "" };
  const { updated } = mergeSubject([prev, otherCourse], [fresh], "CS");
  const cs = updated.find((c) => c.subject === "CS" && c.number === "2100");
  assert.equal(cs.repeatable, true);
  assert.equal(cs.repeatMax, 3);
});
