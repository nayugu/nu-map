// The device-local rating store. Two things matter here and the rest is
// bookkeeping: a corrupt value must never take the app down on boot, and
// "already rated" must never be true for a course nobody rated — that flag
// decides whether a prompt keeps asking, so a false positive silently costs
// the corpus a response.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ratingKey, parseRatingKey, readRatings, setRatingField,
  getRating, fillState, toDrafts,
} from "../../src/core/ratingStore.js";

// ── Keying ────────────────────────────────────────────────────────────────

test("keys round-trip, including course ids containing spaces", () => {
  for (const [c, s] of [["CS 3000", "fall2025"], ["ENGW 1111", "spring2026"],
                        ["A", "b"], ["MATH 2321", "sumA2024"]]) {
    const k = ratingKey(c, s);
    assert.deepEqual(parseRatingKey(k), { courseId: c, semId: s });
  }
});

test("malformed keys are rejected rather than half-parsed", () => {
  for (const bad of ["", "@", "@fall2025", "CS 3000@", "no-at-sign",
                     null, undefined, 42, {}, []]) {
    assert.equal(parseRatingKey(bad), null, `${String(bad)} should not parse`);
  }
  assert.equal(ratingKey(null, "fall2025"), null);
  assert.equal(ratingKey("CS 3000", null), null);
  assert.equal(ratingKey("", ""), null);
});

test("a course id containing @ splits at the last one", () => {
  // Course ids never contain @ today, but if one ever did, the semester is
  // the part that must survive intact — it is what makes the key absolute.
  assert.deepEqual(parseRatingKey("WEIRD@ID@fall2025"),
    { courseId: "WEIRD@ID", semId: "fall2025" });
});

// ── Reading is total ──────────────────────────────────────────────────────

test("corrupt storage degrades to empty and never throws", () => {
  for (const junk of ["not json", "{", "[]", "null", "undefined", "42",
                      null, undefined, 42, [], true, "", '"a string"']) {
    assert.deepEqual(readRatings(junk), {}, `${String(junk)} should read empty`);
  }
});

test("reading drops entries that are malformed or empty", () => {
  const got = readRatings(JSON.stringify({
    "CS 3000@fall2025": { difficulty: 3, hours: 8 },     // keep
    "CS 3100@fall2025": { difficulty: 9, hours: 99 },    // both invalid → drop
    "CS 3200@fall2025": { difficulty: 4 },               // partial → keep
    "bad-key":          { difficulty: 3 },               // unparseable key
    "CS 3300@fall2025": null,                            // not an object
    "CS 3400@fall2025": { instructor: "X" },             // no answers → drop
    "CS 3500@fall2025": "nope",
  }));
  assert.deepEqual(Object.keys(got).sort(),
    ["CS 3000@fall2025", "CS 3200@fall2025"]);
  assert.deepEqual(got["CS 3200@fall2025"],
    { difficulty: 4, hours: null, instructor: null });
});

test("an instructor alone is not a rating", () => {
  // Otherwise picking a name and changing your mind leaves a husk that
  // reads as "already rated" and stops the prompt from ever asking again.
  const r = readRatings({ "CS 3000@fall2025": { instructor: "Derbinsky" } });
  assert.deepEqual(r, {});
});

// ── Writing ───────────────────────────────────────────────────────────────

test("setting a field creates, updates, and leaves the input untouched", () => {
  const a = {};
  const b = setRatingField(a, "CS 3000", "fall2025", "hours", 8);
  assert.deepEqual(a, {}, "must not mutate the map it was given");
  assert.deepEqual(getRating(b, "CS 3000", "fall2025"),
    { difficulty: null, hours: 8, instructor: null });
  const c = setRatingField(b, "CS 3000", "fall2025", "difficulty", 4);
  assert.deepEqual(getRating(c, "CS 3000", "fall2025"),
    { difficulty: 4, hours: 8, instructor: null });
});

test("clearing the last answer removes the entry, not just the value", () => {
  let r = setRatingField({}, "CS 3000", "fall2025", "hours", 8);
  r = setRatingField(r, "CS 3000", "fall2025", "hours", null);
  assert.deepEqual(r, {}, "an answerless husk must not survive");
  assert.equal(getRating(r, "CS 3000", "fall2025"), null);
});

test("clearing one of two answers keeps the entry", () => {
  let r = setRatingField({}, "CS 3000", "fall2025", "hours", 8);
  r = setRatingField(r, "CS 3000", "fall2025", "difficulty", 3);
  r = setRatingField(r, "CS 3000", "fall2025", "hours", null);
  assert.deepEqual(getRating(r, "CS 3000", "fall2025"),
    { difficulty: 3, hours: null, instructor: null });
});

test("invalid values clear rather than corrupt", () => {
  let r = setRatingField({}, "CS 3000", "fall2025", "difficulty", 3);
  r = setRatingField(r, "CS 3000", "fall2025", "hours", 999);
  assert.deepEqual(getRating(r, "CS 3000", "fall2025"),
    { difficulty: 3, hours: null, instructor: null });
});

test("unknown fields and bad ids are no-ops", () => {
  const base = setRatingField({}, "CS 3000", "fall2025", "hours", 8);
  for (const f of ["grade", "__proto__", "", null]) {
    assert.deepEqual(setRatingField(base, "CS 3000", "fall2025", f, 1), base);
  }
  assert.deepEqual(setRatingField(base, null, "fall2025", "hours", 5), base);
  assert.deepEqual(setRatingField(base, "CS 3000", null, "hours", 5), base);
});

test("a retake in another term is a separate rating", () => {
  // Different term usually means a different instructor and a genuinely
  // different experience; merging them would hide exactly that.
  let r = setRatingField({}, "CS 3000", "fall2025", "hours", 20);
  r = setRatingField(r, "CS 3000", "fall2026", "hours", 6);
  assert.equal(getRating(r, "CS 3000", "fall2025").hours, 20);
  assert.equal(getRating(r, "CS 3000", "fall2026").hours, 6);
  assert.equal(Object.keys(r).length, 2);
});

test("no timestamp is ever stored", () => {
  let r = setRatingField({}, "CS 3000", "fall2025", "hours", 8);
  r = setRatingField(r, "CS 3000", "fall2025", "instructor", "Derbinsky");
  const entry = getRating(r, "CS 3000", "fall2025");
  assert.deepEqual(Object.keys(entry).sort(), ["difficulty", "hours", "instructor"]);
  const s = JSON.stringify(r);
  for (const leak of ["At", "time", "Time", "ts", "date", "Date"]) {
    assert.equal(s.includes(leak), false, `store leaked "${leak}"`);
  }
});

// ── Fill state ────────────────────────────────────────────────────────────

test("fill state distinguishes empty, partial and complete", () => {
  assert.equal(fillState(null), "empty");
  assert.equal(fillState({}), "empty");
  assert.equal(fillState({ instructor: "X" }), "empty");
  assert.equal(fillState({ difficulty: 3 }), "partial");
  assert.equal(fillState({ hours: 8 }), "partial");
  assert.equal(fillState({ difficulty: 3, hours: 8 }), "complete");
  // 0 is off the hours scale (hours is total time), so it is not an answer.
  assert.equal(fillState({ difficulty: 3, hours: 0 }), "partial");
  assert.equal(fillState({ difficulty: 3, hours: 1 }), "complete");
  // Invalid values do not count toward completion.
  assert.equal(fillState({ difficulty: 9, hours: 8 }), "partial");
  assert.equal(fillState({ difficulty: 9, hours: 99 }), "empty");
});

// ── Drafts ────────────────────────────────────────────────────────────────

test("drafts carry the course and term, and nothing else", () => {
  let r = setRatingField({}, "CS 3000", "fall2025", "hours", 8);
  r = setRatingField(r, "ENGW 1111", "spring2026", "difficulty", 2);
  const drafts = toDrafts(r).sort((a, b) => a.courseId.localeCompare(b.courseId));
  assert.equal(drafts.length, 2);
  assert.deepEqual(Object.keys(drafts[0]).sort(),
    ["courseId", "difficulty", "hours", "instructor", "semId"]);
  assert.deepEqual(drafts[0],
    { courseId: "CS 3000", semId: "fall2025", difficulty: null, hours: 8, instructor: null });
  assert.deepEqual(toDrafts(null), []);
  assert.deepEqual(toDrafts({}), []);
  assert.deepEqual(toDrafts({ "bad": { hours: 8 } }), []);
});
