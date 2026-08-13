// Share-link privacy — planShare.js.
// Grades are the most sensitive thing NU Map holds. They live in plan
// slots (localStorage) and MUST NOT survive into a share link: _KEYS is
// an allowlist, so this test pins the property that keeps it one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodePlan, decodePlan } from "../../src/core/planShare.js";

const plan = {
  version: 1,
  entSem: "fall", entYear: 2026, gradSem: "spring", gradYear: 2030,
  placements: { CS2500: "fall2026", "CS2500#2": "spr2027" },
  placedOut: ["ENGW1111"],
  major: "2026/khoury/computer_science_bscs_(boston)",
  planName: "test",
  // The sensitive part: must vanish in transit.
  grades: { CS2500: "F", ENGW1111: "C" },
};

test("share › grades never survive into a share link", async () => {
  const encoded = await encodePlan(plan);
  const decoded = await decodePlan(encoded);
  assert.equal(decoded.grades, undefined);
  // and not under any other name either — no value of the payload
  // contains a grade map shape or the entered symbols keyed by course
  assert.ok(!JSON.stringify(decoded).includes('"F"'));
  // the rest of the plan still round-trips
  assert.deepEqual(decoded.placements, plan.placements);
  assert.deepEqual(decoded.placedOut, plan.placedOut);
});

// ── Ratings ───────────────────────────────────────────────────────────────
// Your own hours/difficulty answers are held OUTSIDE the plan (see
// src/core/ratingStore.js), in their own device-local key. The claim that
// makes is stronger than the one grades get: grades are excluded by an
// allowlist that someone could widen, whereas ratings are not plan fields at
// all, so no share or export door can reach them even by accident.
//
// That is only true while the registry says so. These pin it.
import { PLAN_FIELDS, SHARE_KEYS, PRIVATE_FIELDS } from "../../src/core/planSchema.js";
import { RATINGS_KEY, setRatingField, readRatings } from "../../src/core/ratingStore.js";

test("share › ratings are not a plan field at all", () => {
  const names = PLAN_FIELDS.map(f => f.name);
  assert.equal(names.includes("ratings"), false,
    "ratings must not become a plan field — it would then travel every door");
  assert.equal("ratings" in SHARE_KEYS, false);
  // The grade precedent still holds, and is a different mechanism: present
  // in the registry, excluded by a flag.
  assert.equal(names.includes("grades"), true);
  assert.equal(PRIVATE_FIELDS.includes("grades"), true);
  assert.equal("grades" in SHARE_KEYS, false);
});

test("share › a plan carrying a stray ratings key still cannot share it", () => {
  // Defence in depth: even if some future code path attached ratings to a
  // plan object, the share encoder is an allowlist and must drop it.
  const withRatings = {
    ...plan,
    ratings: { "CS 3000@fall2025": { hours: 19, difficulty: 5 } },
  };
  return (async () => {
    const decoded = await decodePlan(await encodePlan(withRatings));
    assert.equal(decoded.ratings, undefined);
    const blob = JSON.stringify(decoded);
    assert.ok(!blob.includes("fall2025"), "a rating key leaked into the share");
    assert.ok(!blob.includes("19"), "a rating value leaked into the share");
  })();
});

test("share › the rating store lives under its own key, not a plan slot", () => {
  // If this ever changed to a plan-scoped key, ratings would start being
  // captured, exported and restored with the plan.
  assert.equal(RATINGS_KEY, "course-ratings");
  assert.equal(PLAN_FIELDS.some(f => f.name === RATINGS_KEY), false);
});

test("share › nothing in a stored rating identifies who wrote it", () => {
  let r = setRatingField({}, "CS 3000", "fall2025", "hours", 19);
  r = setRatingField(r, "CS 3000", "fall2025", "difficulty", 5);
  r = setRatingField(r, "CS 3000", "fall2025", "instructor", "Rajaraman");
  const blob = JSON.stringify(readRatings(r));
  for (const forbidden of ["user", "id", "uuid", "device", "session",
                           "token", "At", "time", "date", "ip"]) {
    assert.ok(!blob.toLowerCase().includes(forbidden.toLowerCase()),
      `stored rating leaked "${forbidden}"`);
  }
  // Only the three answers and the course/term key.
  const entry = Object.values(readRatings(r))[0];
  assert.deepEqual(Object.keys(entry).sort(),
    ["difficulty", "hours", "instructor"]);
});

// ── Consent is a gate, not a banner ───────────────────────────────────────
// A sheet that can be dismissed is decoration. These pin the property that
// makes it a control: the submit paths read one flag, and only an explicit
// "on" opens them.

import { readFileSync } from "node:fs";

const SRC = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");

test("consent › the default is 'unasked', which is not permission", () => {
  const ctx = SRC("context/PlannerContext.jsx");
  // Anything other than the two written values must fall back to unasked,
  // so a corrupt or absent key can never read as consent.
  assert.match(ctx, /v === "on" \|\| v === "off" \? v : "unasked"/);
  // The gate itself is equality against "on" — not truthiness, which
  // "unasked" would satisfy.
  assert.match(ctx, /mayShareRatings = ratingConsent === "on"/);
});

test("consent › every submit path checks the gate before sending", () => {
  const past = SRC("ui/PastClassRater.jsx");
  assert.match(past, /if \(!mayShareRatings\) return;/,
    "PastClassRater must refuse to submit without consent");
  // The guard has to come before the dispatch LOOP — not merely before the
  // import of the same name, which is what a bare indexOf finds.
  const dispatch = past.indexOf("for (const one of independentSubmissions");
  assert.ok(dispatch > 0, "dispatch loop not found");
  assert.ok(past.indexOf("if (!mayShareRatings) return;") < dispatch,
    "the gate must precede dispatch");

  const prompt = SRC("ui/TermReviewPrompt.jsx");
  assert.match(prompt, /if \(mayShareRatings\) onSubmit\(/,
    "TermReviewPrompt must gate its submit");
  assert.match(prompt, /ratingConsent === "unasked"/,
    "a first submission must ask rather than send");
});

test("consent › declining still keeps the answers on the device", () => {
  // The value of an honest 'no' is that it costs nothing. Ratings are
  // written straight to the store by the controls, so a refusal to SHARE
  // must not be able to discard them — there is no delete on this path.
  const prompt = SRC("ui/TermReviewPrompt.jsx");
  assert.ok(!/setRating\([^)]*null[^)]*\)\s*;?\s*\/\/\s*discard/i.test(prompt));
  const sheet = SRC("ui/RatingConsentSheet.jsx");
  assert.ok(!sheet.includes("setRating("),
    "the consent sheet must not touch stored ratings");
  assert.ok(!sheet.includes("clear"),
    "declining must not clear anything");
});

test("consent › the decision is device-local and never a plan field", () => {
  const names = PLAN_FIELDS.map(f => f.name);
  assert.equal(names.includes("ratingConsent"), false,
    "consent must not ride into a share link or an export");
  assert.equal("ratingConsent" in SHARE_KEYS, false);
});

// ── "Keep grades private" must cover ratings too ──────────────────────────
// The switch exists for showing your plan to someone standing next to you.
// What you reported a course cost you is exactly as personal in that moment
// as the grade beside it — and there are three separate tells, not one.

test("privacy › hiding masks the rating values, the controls, and the state", () => {
  const pop = SRC("ui/CourseReviewPopover.jsx");
  assert.match(pop, /privateGrades/, "the popover must read the switch");
  assert.match(pop, /const hidden = privateGrades/);
  // 1. the numbers
  assert.match(pop, /hidden \? "••"/, "the readouts must be masked");
  // 2. the slider POSITION — a thumb four-fifths along states the answer
  //    as plainly as the number does
  assert.match(pop, /disabled=\{hidden\}/, "sliders must be parked while hidden");
  // 3. whether an answer exists at all
  assert.match(pop, /show=\{touched && !hidden\}/,
    "the clear button's presence would announce an answered field");
  assert.match(pop, /show=\{ratedDiff && !hidden\}/);
});

test("privacy › the info-panel button does not report its own state", () => {
  // "Rated" vs "Rate this course" tells a bystander whether you filled it in.
  const btn = SRC("ui/CourseReviewButton.jsx");
  assert.match(btn, /privateGrades\s*\?\s*"empty"/,
    "the button must fall back to the neutral state while hiding");
});

test("privacy › hiding never deletes", () => {
  // Same contract the grade switch makes: it hides, and switching it off
  // brings everything back untouched.
  const pop = SRC("ui/CourseReviewPopover.jsx");
  assert.ok(!/hidden\s*&&\s*setRating\(/.test(pop),
    "hiding must not write to the store");
  // Grouped: an unparenthesised alternation here matches the bare word
  // "delete" anywhere in the file, including in a comment saying it never
  // deletes — which is how this assertion first failed against correct code.
  assert.ok(!/hidden[^\n]*(remove|delete)\s*\(/i.test(pop),
    "hiding must not remove anything");
});

// ── Sharing stays dark until there is somewhere to share to ───────────────

test("sharing › the contribute switch is gated on a real collector", () => {
  const cfg = SRC("config.js");
  assert.match(cfg, /export const ratingSharingAvailable/);
  assert.match(cfg, /VITE_RATINGS_SERVER_URL/,
    "availability must key off a configured server, not a hand-edited boolean");
  const header = SRC("ui/Header.jsx");
  assert.match(header, /\{ratingSharingAvailable && \(/,
    "the settings toggle must be behind the gate");
});
