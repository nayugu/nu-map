// ═══════════════════════════════════════════════════════════════════
// THE TERM → SEMESTER JOIN, ATTACKED.
//
// This is the one thing standing between the engine's relative shape ("Year 1 Fall") and the
// grid the reader actually has ("Fall 2027"). It is three lines of lookup, and every way it can
// be wrong is silent: a course drawn in a semester it was not placed in still looks like a plan.
//
// So the tests here are about the ways a shape and a timeline DISAGREE, because agreement is the
// case that needs no help:
//
//   a shape longer than the student's timeline (a five-year pattern against four years)
//   a spring-entry timeline, where academic year 1 starts with spring and there is no fall
//   a trace old enough to carry no join at all
//   a summer whose two halves must stay ONE row after falling off the end
//
// The confirming case — "year 0 fall is the first fall" — is one line and is here only because
// everything else is measured against it being right.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { termSemesters, orderReason, orderWhy, ORDER_KEYS } from "../../src/core/derivation/steps.js";
import { generateSemesters } from "../../src/core/semGrid.js";

/** A four-year NU timeline starting in fall 2026, as `buildCohortSemesters` would produce one. */
const timeline = (years = 4, startYear = 2026) => generateSemesters(startYear, years);

/** The shape's terms, in the shorthand `shapeFromPlan` produces. */
const term = (yearIndex, semTypeId, extra = {}) => ({
  yearIndex, semTypeId,
  label: `Year ${yearIndex + 1}`,
  term: { fall: "Fall", spring: "Spring", sumA: "Summer 1", sumB: "Summer 2" }[semTypeId] ?? "",
  weight: semTypeId === "sumA" || semTypeId === "sumB" ? 0.5 : 1,
  ...extra,
});

test("a term lands on the semester the apply would put it in", () => {
  const { semIds, extraSems } = termSemesters(
    [term(0, "fall"), term(0, "spring"), term(3, "spring")], timeline());
  assert.deepEqual(semIds, ["fall2026", "spr2027", "spr2030"]);
  assert.equal(extraSems.length, 0);
});

test("a shape longer than the timeline invents rows rather than dropping courses", () => {
  // Five-year pattern, four-year timeline. The fifth year has nowhere to land, and the answer is
  // NOT to return null and have the walkthrough quietly omit whatever was placed there.
  const terms = [term(0, "fall"), term(4, "fall"), term(4, "spring")];
  const { semIds, extraSems } = termSemesters(terms, timeline(4));
  assert.equal(semIds[0], "fall2026");
  assert.equal(semIds.filter(Boolean).length, 3, "every term still has somewhere to be drawn");
  assert.equal(extraSems.length, 2);
  // Named by the shape's own words, since the calendar has nothing to say about a year the
  // student's plan does not contain.
  assert.equal(extraSems[0].label, "Year 5 Fall");
  assert.equal(extraSems[0].type, "fall", "still drawn in the fall row's seasonal tint");
  assert.equal(extraSems[0].semTypeId, "", "and NOT named by the season alone, which loses the year");
});

test("a summer that falls off the end stays one row, not two", () => {
  // The grid pairs a summer's halves by stripping `sumA`/`sumB` and comparing what is left. That
  // is the property, and it is why these ids are keyed by the shape's YEAR and not by term index.
  const { extraSems } = termSemesters(
    [term(0, "fall"), term(5, "sumA"), term(5, "sumB")], timeline(4));
  const [a, b] = extraSems;
  assert.equal(a.id.replace("sumA", ""), b.id.replace("sumB", ""));
  assert.equal(a.type, "summer");
  assert.equal(b.type, "summer");
  assert.equal(a.maxSlots, 2, "a half term draws half a term's slots");
});

test("a spring-entry timeline joins by season, never by position", () => {
  // Academic year 1 for a spring entrant OPENS with spring — `academicYears` starts a new year
  // each time it meets the cohort's first season — so that year runs spring → summer → fall, and
  // "Year 1 Fall" is the fall at the END of it.
  //
  // This is the whole reason the join is shared with `applySamplePlan` rather than written here.
  // A reasonable-looking local rule ("year 1 fall is the first fall in the list") gives the same
  // answer for a fall entrant and a DIFFERENT one here, and the walkthrough would then draw a
  // course in a term the apply puts elsewhere — for spring entrants only, which is the kind of
  // bug that ships.
  const all = generateSemesters(2026, 5);
  const spring = all.findIndex(s => s.id === "spr2027");
  const cohort = [all[0], ...all.slice(spring)];
  const { semIds, extraSems } = termSemesters([term(0, "spring"), term(0, "fall")], cohort);
  assert.deepEqual(semIds, ["spr2027", "fall2027"]);
  assert.equal(extraSems.length, 0);
  // And a term that counted positions instead would have put the fall FIRST, on the spring.
  assert.notEqual(semIds[1], "fall2026");
});

test("a trace with no join at all degrades to shape rows, not to a crash", () => {
  // Every field missing: the shape from before `semTypeId`/`yearIndex` were recorded, and the
  // junk-shape case generally. Nothing here may throw, and nothing may silently vanish.
  const { semIds, extraSems } = termSemesters(
    [{}, { label: "Year 2" }, null], timeline());
  assert.equal(semIds.length, 3);
  assert.equal(extraSems.length, 3);
  assert.ok(semIds.every(Boolean));
  assert.equal(new Set(semIds).size, 3, "and each gets its OWN row, not one row three courses deep");
});

test("no terms, no semesters, no timeline — all empty, none throwing", () => {
  assert.deepEqual(termSemesters([], []), { semIds: [], extraSems: [] });
  assert.deepEqual(termSemesters(null, null), { semIds: [], extraSems: [] });
  assert.deepEqual(termSemesters(undefined, timeline()), { semIds: [], extraSems: [] });
});

// ═══════════════════════════════════════════════════════════════════
// THE REASON A CARD IS WHERE IT IS.
//
// `orderReason` is the queue's whole claim: that the ONE key it prints is the key that actually
// decided this pair. It is worth attacking because the failure is silent and confident — a wrong
// key still prints a sentence, and the sentence still sounds like an explanation.
//
// The property under test is agreement with `byConstraint` in `search.js`: same keys, same order,
// same treatment of an open cell's unbounded candidate count.
// ═══════════════════════════════════════════════════════════════════

/** Recorded keys, in the shape `trace.order` stores them. */
const keys = (o = {}) => ({ filler: 0, claim: 2, terms: 8, options: 4, depth: 0, ...o });

test("the first differing key wins, even when later keys disagree loudly", () => {
  // Claim differs, so nothing after it may be consulted — and here everything after it points the
  // other way. A "most obvious difference" heuristic would report `options` (4 against 99) and be
  // describing a comparison the engine never made.
  assert.deepEqual(
    orderReason(keys({ claim: 0, terms: 10, options: 4 }), keys({ claim: 1, terms: 2, options: 99 })),
    { key: "claim", value: 0 });
  // Same, one level down: equal claim, so width decides, and the depth disagreement is irrelevant.
  assert.deepEqual(
    orderReason(keys({ terms: 3, depth: 0 }), keys({ terms: 9, depth: 7 })),
    { key: "terms", value: 3 });
});

test("filler outranks every other key, in both directions", () => {
  // A filler is last unconditionally — that is the founding rule, and it is the first key.
  assert.deepEqual(orderReason(keys({ filler: 0, claim: 2 }), keys({ filler: 1, claim: 0 })),
                   { key: "filler" });
  // Truthiness, not identity: the recorder writes 1/0 and a shape could carry booleans.
  assert.deepEqual(orderReason(keys({ filler: false }), keys({ filler: true })), { key: "filler" });
  assert.equal(orderReason(keys({ filler: 1 }), keys({ filler: 1 }))?.key, "tie");
});

test("an open cell's candidate count is unbounded, not zero", () => {
  // `null` options means "admits the catalog". Treating it as 0 would make the widest cell in the
  // program look like the narrowest and invert the key it decides.
  assert.deepEqual(orderReason(keys({ options: 12 }), keys({ options: null })),
                   { key: "options", value: 12 });
  // Two open cells tie on it and fall through to depth, exactly as `byConstraint` does.
  assert.deepEqual(orderReason(keys({ options: null, depth: 3 }), keys({ options: null, depth: 1 })),
                   { key: "depth", value: 3 });
});

test("identical on every meaningful key is a TIE, and says so", () => {
  // The comparator breaks this by cell id, for determinism only. Inventing a reason here would be
  // the panel explaining an arbitrary order as if it meant something.
  assert.deepEqual(orderReason(keys(), keys()), { key: "tie" });
});

test("the bullets PARTITION the queue — every rival counted once, by one key", () => {
  // The panel prints "ahead of 23", "ahead of 6", "ahead of 1" as separate bullets. Those counts
  // are a claim about a partition: each remaining card is beaten by exactly one key, so the counts
  // must sum to the number of cards behind this one. If they do not, the sentences are arithmetic
  // that does not add up — and the reader can add.
  const front = keys({ filler: 0, claim: 0, terms: 4, options: 2, depth: 1 });
  const rest = [
    front,
    keys({ filler: 1 }), keys({ filler: 1 }),                         // beaten on filler
    keys({ claim: 1 }), keys({ claim: 2 }), keys({ claim: 1 }),       // beaten on claim
    keys({ claim: 0, terms: 9 }),                                     // beaten on width
    keys({ claim: 0, terms: 4, options: 7 }),                         // beaten on candidates
    keys({ claim: 0, terms: 4, options: 2, depth: 0 }),               // beaten on depth
    keys({ claim: 0, terms: 4, options: 2, depth: 1 }),               // tied on everything
  ];
  const why = orderWhy(front, rest);
  assert.equal(why.reduce((n, w) => n + w.beat, 0), rest.length - 1);
  assert.deepEqual(why.map(w => w.key), ["filler", "claim", "terms", "options", "depth", "tie"]);
  assert.deepEqual(why.map(w => w.beat), [2, 3, 1, 1, 1, 1]);
  // Comparator order, never count order: leading with whichever key happened to beat the most
  // would say the rules rank by popularity.
  assert.deepEqual(why.map(w => w.key), ORDER_KEYS.filter(k => why.some(w => w.key === k)));
});

test("a key that decided nothing is not mentioned at all", () => {
  // Every rival here is an open elective, so `filler` settles all of them and no other key is ever
  // reached. A panel that listed the rest with a count of zero would be inventing reasons.
  const front = keys({ filler: 0, claim: 0, terms: 4 });
  const why = orderWhy(front, [front, keys({ filler: 1 }), keys({ filler: 1 })]);
  assert.deepEqual(why, [{ key: "filler", value: undefined, beat: 2 }]);
});

test("alone in the queue, there is nothing to be ahead of", () => {
  const only = keys({ card: 3 });
  assert.deepEqual(orderWhy(only, [only]), []);
  // The same card as a COPY, which is what one `.map()` between the queue and here would produce.
  // By identity alone it would tie with itself and print "nothing tells it apart from 1 other" —
  // a bullet with no card behind it, in the one place the panel is claiming to do arithmetic.
  assert.deepEqual(orderWhy(only, [{ ...only }]), []);
  assert.deepEqual(orderWhy(keys(), []), []);
  assert.deepEqual(orderWhy(null, [keys()]), []);
  assert.deepEqual(orderWhy(keys(), null), []);
});

test("the ends of the list, and junk", () => {
  assert.deepEqual(orderReason(keys(), undefined), { key: "last" });
  assert.equal(orderReason(null, keys()), null);
  // Missing fields fall back to the comparator's own defaults rather than throwing: claim 2,
  // depth 0, and an absent width is not a difference.
  assert.deepEqual(orderReason({}, {}), { key: "tie" });
  assert.deepEqual(orderReason({ claim: 0 }, {}), { key: "claim", value: 0 });
});
