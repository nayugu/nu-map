// UNIT · reservations — cards in a semester that have no course yet.
//
// The whole point is that they behave like courses. So most of these tests are
// about a reservation doing exactly what a course card does, and the few that
// matter are about the one question it must never answer: what counts toward
// the degree.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createReservation, moveReservation, removeReservation, fillReservation,
  resolveRequirement, semesterOccupants, occupantCards, semesterReservedSH,
  isReservationId,
} from "../../src/core/reservations.js";

const asMap = (list) => Object.fromEntries(list.map(r => [r.id, r]));
const make = (label, semId, sh = 4, requirement = null) =>
  createReservation({ semId, label, sh, requirement });

const PROGRAM = {
  requirementSections: [
    { title: "Computer Science Required Courses" },
    { title: "Khoury Approved Electives" },
    { title: "Supporting Course" },
  ],
};

// ── Identity ───────────────────────────────────────────────────────

test("ids are generated, so nothing about them can drift", () => {
  const a = make("Khoury Elective", "fall2026");
  const b = make("Khoury Elective", "fall2026");
  assert.notEqual(a.id, b.id, "two cards worded the same in one term are two cards");
  assert.ok(isReservationId(a.id));
  assert.ok(!isReservationId("CS2500"), "cannot be mistaken for a course id");
  assert.ok(!isReservationId("CS2500#2"), "nor for a repeat instance");
});

test("a reservation with no label still reads as something", () => {
  assert.equal(createReservation({ semId: "fall2026" }).label, "Elective");
});

// ── It behaves like a course card ──────────────────────────────────

test("it moves between semesters exactly like a course", () => {
  const r = make("MATH elective", "fall2026");
  const moved = moveReservation(asMap([r]), r.id, "spr2027");
  assert.equal(moved[r.id].semId, "spr2027");
  assert.equal(moved[r.id].label, "MATH elective", "moving changes nothing else");
});

test("it is deleted like a course, and deleting an absent one is a no-op", () => {
  const r = make("Elective", "fall2026");
  const map = asMap([r]);
  assert.deepEqual(removeReservation(map, r.id), {});
  assert.equal(removeReservation(map, "~res:nope"), map, "same reference, no churn");
});

test("it appears in the semester view alongside real placements", () => {
  const r = make("Khoury Elective", "fall2026");
  const view = semesterOccupants({ CS2500: "fall2026" }, asMap([r]));
  assert.deepEqual(view, { CS2500: "fall2026", [r.id]: "fall2026" });
});

test("the semester view is unchanged when there is nothing to add", () => {
  const placements = { CS2500: "fall2026" };
  assert.equal(semesterOccupants(placements, {}), placements, "same reference");
});

test("it renders from a card map, carrying the catalog's wording and hours", () => {
  const r = make("Khoury Elective", "fall2026", 4);
  const card = occupantCards({ CS2500: { id: "CS2500", sh: 4 } }, asMap([r]))[r.id];
  assert.equal(card.code, "Khoury Elective", "the wording is what the header shows");
  assert.equal(card.sh, 4);
  assert.equal(card.isReservation, true);
  assert.deepEqual(card.prereqs, null, "it enters no prereq chain");
});

// ── Dropping a course on it ────────────────────────────────────────

test("dropping a course on it replaces it, in that term", () => {
  const r = make("Khoury Elective", "spr2028");
  const next = fillReservation(asMap([r]), r.id, "CS4500");
  assert.deepEqual(next.reservations, {}, "the card is gone");
  assert.equal(next.courseId, "CS4500");
  assert.equal(next.semId, "spr2028", "the course lands where the card was");
});

test("the card that is filled is the card that was clicked", () => {
  // Two Khoury cards, one in each of two terms. Working out satisfaction
  // instead of replacing outright would retire whichever came first, so
  // clicking the later card would make the earlier one disappear.
  const early = make("Khoury Elective", "sumB2028");
  const late  = make("Khoury Elective", "fall2029");
  const next = fillReservation(asMap([early, late]), late.id, "CS4500");
  assert.ok(!next.reservations[late.id], "the one acted on is gone");
  assert.ok(next.reservations[early.id], "the other is untouched");
  assert.equal(next.semId, "fall2029");
});

test("filling one that does not exist reports it rather than half-acting", () => {
  assert.equal(fillReservation({}, "~res:gone", "CS4500"), null);
});

// ── The one question it must not answer ────────────────────────────

test("reservations never enter placements, so the degree cannot see them", () => {
  const r = make("Khoury Elective", "fall2026", 4);
  const placements = { CS2500: "fall2026" };
  semesterOccupants(placements, asMap([r]));
  assert.deepEqual(placements, { CS2500: "fall2026" },
    "the combined view is derived; the map the audit reads is not touched");
});

test("reserved credit is available per term, and only per term", () => {
  const map = asMap([
    make("Khoury Elective", "fall2026", 4),
    make("General Elective", "fall2026", 4),
    make("MATH elective", "spr2027", 4),
  ]);
  assert.equal(semesterReservedSH(map, "fall2026"), 8, "a term reads the load as printed");
  assert.equal(semesterReservedSH(map, "spr2027"), 4);
  assert.equal(semesterReservedSH(map, "fall2029"), 0);
});

// ── Which requirement it stands for ────────────────────────────────

test("the requirement resolves when the program is unchanged", () => {
  const r = make("Khoury Elective", "fall2026", 4, { index: 1, title: "Khoury Approved Electives" });
  const got = resolveRequirement(r, PROGRAM);
  assert.equal(got.index, 1);
  assert.equal(got.section.title, "Khoury Approved Electives");
});

test("a re-scrape that reorders sections does not silently repoint the card", () => {
  // A section inserted above shifts every index below it. Trusting the number
  // alone would leave the card offering another requirement's courses with
  // nothing looking wrong.
  const r = make("Khoury Elective", "fall2026", 4, { index: 1, title: "Khoury Approved Electives" });
  const shifted = { requirementSections: [{ title: "New Section" }, ...PROGRAM.requirementSections] };
  const got = resolveRequirement(r, shifted);
  assert.equal(got.index, 2, "found by title at its new position");
  assert.equal(got.section.title, "Khoury Approved Electives");
});

test("a requirement that no longer exists degrades to no suggestion, not a wrong one", () => {
  const r = make("Khoury Elective", "fall2026", 4, { index: 1, title: "Retired Requirement" });
  assert.equal(resolveRequirement(r, PROGRAM), null);
  assert.equal(r.label, "Khoury Elective", "the card still reads correctly");
});

test("a reservation with no requirement asks nothing of the program", () => {
  assert.equal(resolveRequirement(make("General Elective", "fall2026"), PROGRAM), null);
  assert.equal(resolveRequirement(null, PROGRAM), null);
});

test("a reservation card has the SAME SHAPE as a real course card", () => {
  // This is the invariant behind "it behaves like a course". Card rendering
  // reads several fields without guarding — `course.color.slice(1)` is the one
  // that threw and produced an error page the first time a plan was loaded —
  // so a card missing any field is a crash waiting for whichever consumer
  // touches it next.
  const REAL_COURSE_KEYS = [
    "id", "subject", "number", "code", "title", "desc", "sh", "shMin", "shMax",
    "repeatable", "repeatMax", "repeatMaxSH", "scheduleType", "termHistory",
    "birthTermCode", "terms", "isCps", "nuPath", "attributes", "prereqs",
    "coreqs", "sections", "color",
  ];
  const r = make("Khoury Elective", "fall2026", 4);
  const card = occupantCards({}, asMap([r]))[r.id];
  const missing = REAL_COURSE_KEYS.filter(k => !(k in card));
  assert.deepEqual(missing, [], "fields a real course has and a reservation does not");
  assert.equal(typeof card.color, "string", "read unguarded by the card's colour maths");
  assert.match(card.color, /^#[0-9a-f]{6}$/i);
});

test("reserved credit is PLANNED credit, never EARNED credit", () => {
  // The distinction the whole three-way split turns on. A freshly loaded
  // template is roughly half reservations, so excluding them from the planned
  // total reports a four-year degree as half a degree. Including them in
  // EARNED credit would tell a student they have credit for a course nobody
  // has chosen.
  const map = asMap([
    make("Khoury Elective", "fall2029", 4),
    make("General Elective", "spr2030", 4),
  ]);
  const reserved = Object.values(map).reduce((s, r) => s + (r.sh ?? 0), 0);
  assert.equal(reserved, 8, "counts toward what the plan comes to");

  // …and cannot reach the map that credit-toward-the-degree is computed from.
  const placements = { CS2500: "fall2026" };
  assert.equal(Object.keys(semesterOccupants(placements, map)).length, 3);
  assert.equal(Object.keys(placements).length, 1, "placements is untouched");
});
