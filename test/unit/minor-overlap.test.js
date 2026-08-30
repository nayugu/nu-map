// The 50% cap on double counting a minor against a major.
//
//   "Students are permitted to double count a maximum of 50% of the credits
//    required for a minor from their major, transfer credit, or advanced
//    standing credit."   — Undergraduate catalog, § Minors
//
// These attack the rule from the four directions it can go wrong:
//
//   · the BOUNDARY — half is allowed, a hair over is not, and an odd
//     requirement makes the cap land on a .5;
//   · the ARTEFACT — a shared course the student could have replaced with
//     another course they already placed must not produce a violation, because
//     greedy allocation, not the plan, chose it;
//   · INVENTION — nothing may be counted that the minor does not claim, that
//     the major does not claim, or that carries no credit;
//   · INERTNESS — the report must not perturb the audit or its own inputs.
import test from "node:test";
import assert from "node:assert/strict";
import { minorShare, minorRequirementSections, majorClaimOf, MINOR_SHARE_FRACTION }
  from "../../src/core/minorOverlap.js";
import { allocateSections, courseKey } from "../../src/core/gradRequirements.js";
import { _minorShareNote } from "../../src/core/planModel.js";

const C = (subject, classId) => ({ type: "COURSE", subject, classId });
const SECTION = (title, minRequirementCount, ...requirements) =>
  ({ type: "SECTION", title, minRequirementCount, requirements });
const XOM = (numCreditsMin, ...courses) => ({ type: "XOM", numCreditsMin, courses });

const course = (id, sh = 4) => ({
  id, code: id, subject: id.replace(/\d.*/, ""), number: id.replace(/^\D+/, ""), sh,
});
const CM = Object.fromEntries(
  ["AA1000", "AA1001", "AA1002", "BB2000", "BB2001", "CC3000"]
    .map(id => [id, course(id)])
);

const minor = (...sections) => ({ name: "Test, Minor", requirementSections: sections });
const share = (m, placed, majorKeys, courseMap = CM) =>
  minorShare({ minor: m, placedSet: new Set(placed), majorKeys: new Set(majorKeys), courseMap });

// Three 4 SH courses, all required: 12 SH, so the cap is 6.
const THREE = minor(SECTION("Core", 3, C("AA", 1000), C("AA", 1001), C("AA", 1002)));
const ALL_THREE = ["AA1000", "AA1001", "AA1002"];

// ── The denominator ──────────────────────────────────────────────

test("minor share › the requirement is read off the courses, and the cap is half of it", () => {
  const r = share(THREE, ALL_THREE, []);
  assert.equal(r.requiredSH, 12);
  assert.equal(r.capSH, 12 * MINOR_SHARE_FRACTION);
  assert.equal(r.claimedSH, 12);
});

test("minor share › a minor stating no requirement at all reports nothing", () => {
  // Null, not a zero: a 0 SH cap would read as a measurement, and dividing a
  // shared figure by it would call every plan a violation.
  assert.equal(share(minor(), ALL_THREE, ALL_THREE), null);
  assert.equal(minorShare({ minor: null, placedSet: new Set(), majorKeys: new Set() }), null);
  assert.equal(minorShare({}), null);
  assert.equal(minorShare(), null);
});

test("minor share › the audit's General Electives placeholder is not a minor requirement", () => {
  const withGE = minor(
    SECTION("Core", 3, C("AA", 1000), C("AA", 1001), C("AA", 1002)),
    { type: "SECTION", title: "Required General Electives", minRequirementCount: 1,
      requirements: [C("CC", 3000)] },
  );
  assert.equal(minorRequirementSections(withGE).length, 1);
  assert.equal(share(withGE, [...ALL_THREE, "CC3000"], ["CC3000"]).requiredSH, 12);
});

// ── The boundary ─────────────────────────────────────────────────

test("minor share › exactly half is allowed", () => {
  // 8 SH required, 4 SH shared. The policy says "a maximum of 50%", so the
  // figure at the cap is inside it.
  const two = minor(SECTION("Core", 2, C("AA", 1000), C("AA", 1001)));
  const r = share(two, ["AA1000", "AA1001"], ["AA1000"]);
  assert.equal(r.requiredSH, 8);
  assert.equal(r.dependentSH, 4);
  assert.equal(r.capSH, 4);
  assert.equal(r.over, false);
  assert.equal(r.overSH, 0);
});

test("minor share › a hair over half is not", () => {
  const r = share(THREE, ALL_THREE, ["AA1000", "AA1001"]);
  assert.equal(r.dependentSH, 8);
  assert.equal(r.capSH, 6);
  assert.equal(r.over, true);
  assert.equal(r.overSH, 2);
});

test("minor share › an odd requirement puts the cap on a half credit", () => {
  const odd = minor(SECTION("Core", 2, C("AA", 1000), C("BB", 2000)));
  const cm = { ...CM, BB2000: course("BB2000", 3) };
  const r = share(odd, ["AA1000", "BB2000"], ["AA1000"], cm);
  assert.equal(r.requiredSH, 7);
  assert.equal(r.capSH, 3.5);
  // 4 shared against a 3.5 cap — over by half a credit, and the comparison
  // must not be eaten by floating-point dust.
  assert.equal(r.over, true);
  assert.equal(r.overSH, 0.5);
});

test("minor share › a minor entirely inside the major is over by half of itself", () => {
  // The catalog bans this outright ("a BS student with a biology major cannot
  // enroll in the biology minor"); the cap catches it too, which is the case
  // the measured sweep found for Speech-Language Pathology.
  const r = share(THREE, ALL_THREE, ALL_THREE);
  assert.equal(r.dependentSH, 12);
  assert.equal(r.overSH, 6);
  assert.equal(r.over, true);
});

// ── The greedy-allocation artefact ───────────────────────────────

test("minor share › a shared course the student could replace is not a violation", () => {
  // One 4 SH slot, two ways to fill it, both placed, one of them claimed by the
  // major. Whichever the allocator reaches for first, the minor could be
  // satisfied without touching the major's course — so nothing here is
  // genuinely double counted.
  const pool = minor(SECTION("Elective", 1, XOM(4, C("AA", 1000), C("BB", 2000))));
  const r = share(pool, ["AA1000", "BB2000"], ["AA1000"]);
  assert.equal(r.requiredSH, 4);
  assert.equal(r.capSH, 2);
  assert.equal(r.dependentSH, 0);
  assert.equal(r.over, false);
  // The test would pass for the wrong reason if allocation simply happened to
  // reach for the non-major course: pin that it did NOT, so this stays a
  // measurement of the fix rather than of the allocator's order.
  assert.equal(r.sharedSH, 4, "allocation picked the other course, so nothing was proved");
});

test("minor share › the same pool with only the major's course placed IS over", () => {
  // The other half of the pair above: without the alternative on the board the
  // minor really does depend on the major's course, so the cap fires. If this
  // ever passes for the same reason as the test above, the pool stopped being
  // capped and neither test is measuring anything.
  const pool = minor(SECTION("Elective", 1, XOM(4, C("AA", 1000), C("BB", 2000))));
  const r = share(pool, ["AA1000"], ["AA1000"]);
  assert.equal(r.dependentSH, 4);
  assert.equal(r.over, true);
  assert.ok(r.sharedKeys.includes("AA1000"));
});

test("minor share › the courses listed can exceed the credit charged, never the reverse", () => {
  // `sharedKeys` answers "which courses count toward both" and `dependentSH`
  // answers "how much of the minor needs them". The list may be longer; a
  // charge larger than the credit of the courses it names would be invention.
  const pool = minor(SECTION("Elective", 1, XOM(4, C("AA", 1000), C("BB", 2000))));
  const r = share(pool, ["AA1000", "BB2000"], ["AA1000", "BB2000"]);
  assert.ok(r.sharedSH >= r.dependentSH, "charged more credit than the shared courses carry");
  assert.equal(r.dependentSH, 4, "with both alternatives in the major, the slot is shared");
});

// ── The major-side release ───────────────────────────────────────
// A course only counts toward both if BOTH audits claim it, and this app
// chooses both assignments. So when the major could have satisfied its
// requirement with another course the student already placed, the overlap is
// ours, not the plan's. Measured: 1 of 19 over-cap verdicts in a 6,920-pair
// sweep is a false violation without this.

/**
 * A stand-in for the panel's major allocator.
 *
 * `pools` is a list of course-key arrays: each pool is one major requirement
 * satisfied by ANY ONE of its courses. That is the shape the release exists
 * for, and it is enough to test the contract (`sat` per requirement, `claimed`)
 * without dragging a whole program record in.
 */
const majorOf = (...pools) => (placed) => {
  const set = placed instanceof Set ? placed : new Set(placed);
  const claimed = new Set();
  const sat = [];
  for (const pool of pools) {
    const pick = pool.find(k => set.has(k) && !claimed.has(k));
    if (pick) claimed.add(pick);
    sat.push(pick ? (CM[pick]?.sh ?? 0) : 0);
  }
  return { sat, claimed };
};

test("minor share › a shared course the MAJOR could swap out is not charged", () => {
  // The major's one requirement takes AA1000 or CC3000; both are placed. The
  // minor needs AA1000 and AA1001 (8 SH, cap 4), so greedily the whole minor
  // reads as double-counted — but the major has CC3000 sitting right there.
  const two = minor(SECTION("Core", 2, C("AA", 1000), C("AA", 1001)));
  const claim = majorOf(["AA1000", "CC3000"], ["AA1001"]);
  const placed = new Set(["AA1000", "AA1001", "CC3000"]);
  const majorKeys = claim(placed).claimed;

  const strict = minorShare({ minor: two, placedSet: placed, majorKeys, courseMap: CM });
  assert.equal(strict.over, true, "without the release this is a violation");
  assert.equal(strict.dependentSH, 8);

  const fair = minorShare({ minor: two, placedSet: placed, majorKeys, courseMap: CM,
                            majorClaim: claim });
  assert.deepEqual(fair.releasedKeys, ["AA1000"]);
  assert.equal(fair.dependentSH, 4, "only AA1001, which the major genuinely needs");
  assert.equal(fair.over, false);
  // The listing is unchanged: both courses really are ticked under the major on
  // the card beside this one, and hiding that would make the two disagree.
  assert.deepEqual(fair.sharedKeys, ["AA1000", "AA1001"]);
});

test("minor share › a course the major CANNOT do without is still charged", () => {
  // The mirror image, and the one that matters: an alternative that is not
  // placed is not an alternative. If this ever passes for the same reason as
  // the test above, the release has stopped testing anything.
  const two = minor(SECTION("Core", 2, C("AA", 1000), C("AA", 1001)));
  const claim = majorOf(["AA1000", "CC3000"], ["AA1001"]);
  const placed = new Set(["AA1000", "AA1001"]);            // no CC3000 on the board
  const r = minorShare({ minor: two, placedSet: placed, majorKeys: claim(placed).claimed,
                         courseMap: CM, majorClaim: claim });
  assert.deepEqual(r.releasedKeys, []);
  assert.equal(r.dependentSH, 8);
  assert.equal(r.over, true);
});

test("minor share › releases are checked TOGETHER, not one at a time", () => {
  // Two major requirements, both able to fall back on CC3000 — but there is
  // only one CC3000. Each release is harmless alone and they are not harmless
  // together, which is exactly what a per-course test would miss.
  const two = minor(SECTION("Core", 2, C("AA", 1000), C("AA", 1001)));
  const claim = majorOf(["AA1000", "CC3000"], ["AA1001", "CC3000"]);
  const placed = new Set(["AA1000", "AA1001", "CC3000"]);
  const r = minorShare({ minor: two, placedSet: placed, majorKeys: claim(placed).claimed,
                         courseMap: CM, majorClaim: claim });
  assert.equal(r.releasedKeys.length, 1, `released ${r.releasedKeys} — both cannot go`);
  assert.equal(r.dependentSH, 4);
});

test("minor share › a swap that robs one requirement to pay another is refused", () => {
  // Comparing TOTAL satisfied credit is the tempting shortcut and it is wrong:
  // one requirement can gain exactly what another loses, and the sum says
  // nothing happened while a requirement just broke.
  //
  // The callback here is deliberately NON-MONOTONE — section 2 is satisfied
  // only once BB2000 is gone — because that is the contract being tested. The
  // guard promises "every section at least as satisfied", not "the allocator
  // I happen to ship is monotone", and a first version of this test used a
  // well-behaved stand-in whose total dropped anyway. It asserted the right
  // outcome for the wrong reason and the mutation probe caught it: the
  // sum-comparing mutant survived with this test green.
  const one = minor(SECTION("Core", 1, C("BB", 2000)));
  const claim = (placed) => {
    const set = placed instanceof Set ? placed : new Set(placed);
    const has = set.has("BB2000");
    return { sat: [has ? 4 : 0, has ? 0 : 4], claimed: new Set(has ? ["BB2000"] : []) };
  };
  const placed = new Set(["BB2000", "CC3000"]);
  const base = claim(placed);
  assert.equal(base.sat.reduce((a, b) => a + b, 0),
               claim(new Set(["CC3000"])).sat.reduce((a, b) => a + b, 0),
               "the fixture must hold the TOTAL constant, or it proves nothing");
  const r = minorShare({ minor: one, placedSet: placed, majorKeys: base.claimed,
                         courseMap: CM, majorClaim: claim });
  assert.deepEqual(r.releasedKeys, [], "released a course the major still needed");
});

test("minor share › a malformed majorClaim is declined, not trusted", () => {
  const two = minor(SECTION("Core", 2, C("AA", 1000), C("AA", 1001)));
  const placed = new Set(["AA1000", "AA1001"]);
  const majorKeys = new Set(["AA1000", "AA1001"]);
  const junk = [
    () => null,
    () => ({}),                                    // no sat
    () => ({ sat: "lots", claimed: new Set() }),   // sat not an array
    () => { throw new Error("boom"); },
    // Different section count between calls — the two runs are not comparable.
    //
    // SHRINKING, not growing, and that distinction is the whole test. A longer
    // second array fails the element-wise compare on its own (`>= undefined` is
    // false), so it would pass with no length check at all: the probe showed
    // the length guard surviving deletion against a growing fixture. A SHORTER
    // one is the dangerous shape — every element of it can match while a whole
    // section has silently vanished — so it is the one that has to be here.
    (() => { let n = 3; return () => ({ sat: new Array(n--).fill(4), claimed: new Set() }); })(),
  ];
  for (const majorClaim of junk) {
    let r;
    try { r = minorShare({ minor: two, placedSet: placed, majorKeys, courseMap: CM, majorClaim }); }
    catch (e) { assert.fail(`threw on a bad callback: ${e.message}`); }
    assert.equal(r.over, true, "declined to the strict answer, as it must");
    assert.deepEqual(r.releasedKeys, []);
  }
});

test("minor share › the release cannot run when nothing is over", () => {
  // It is only applied where it changes the verdict — see the note in
  // minorOverlap.js about the major card showing the greedy allocation.
  let calls = 0;
  const claim = (placed) => { calls++; return majorOf(["AA1000", "CC3000"])(placed); };
  const three = THREE;                                     // 12 SH, cap 6
  const placed = new Set([...ALL_THREE, "CC3000"]);
  const r = minorShare({ minor: three, placedSet: placed, majorKeys: new Set(["AA1000"]),
                         courseMap: CM, majorClaim: claim });
  assert.equal(r.over, false);
  assert.equal(calls, 0, "the callback ran for a plan that was already inside the cap");
});

// ── Invention ────────────────────────────────────────────────────

test("minor share › a major course the minor does not claim is not shared", () => {
  const r = share(THREE, [...ALL_THREE, "CC3000"], ["CC3000"]);
  assert.deepEqual(r.sharedKeys, []);
  assert.equal(r.dependentSH, 0);
  assert.equal(r.over, false);
});

test("minor share › a minor course the major does not claim is not shared", () => {
  const r = share(THREE, ALL_THREE, []);
  assert.deepEqual(r.sharedKeys, []);
  assert.equal(r.sharedSH, 0);
});

test("minor share › a course with no credit on record contributes no shared credit", () => {
  const cm = { ...CM, AA1000: { ...course("AA1000"), sh: undefined } };
  const r = share(THREE, ALL_THREE, ["AA1000"], cm);
  assert.equal(r.sharedSH, 0, "invented credit for a course that states none");
  assert.ok(r.sharedKeys.includes("AA1000"), "the course is still named as shared");
});

test("minor share › a section stating credit in prose is required credit nothing can share", () => {
  const prose = minor(
    { type: "SECTION", title: "Related Study", minRequirementCount: 1,
      requirements: [], creditsRequired: 8 },
    SECTION("Core", 1, C("AA", 1000)),
  );
  const r = share(prose, ALL_THREE, ALL_THREE);
  assert.equal(r.requiredSH, 12, "the registrar's 8 SH plus the 4 SH course");
  assert.equal(r.dependentSH, 4);
  assert.equal(r.over, false, "8 SH of prose credit raised the cap above the shared 4");
});

test("minor share › the keys come back in a stable order", () => {
  const a = share(THREE, ALL_THREE, ALL_THREE).sharedKeys;
  const b = share(THREE, [...ALL_THREE].reverse(), ALL_THREE).sharedKeys;
  assert.deepEqual(a, [...a].sort());
  assert.deepEqual(a, b);
});

// ── Hostile input ────────────────────────────────────────────────

test("minor share › junk inputs degrade instead of throwing", () => {
  const cases = [
    { minor: THREE, placedSet: undefined, majorKeys: undefined, courseMap: undefined },
    { minor: THREE, placedSet: ALL_THREE, majorKeys: ALL_THREE, courseMap: CM }, // arrays, not Sets
    { minor: THREE, placedSet: new Set(["ZZ9999"]), majorKeys: new Set(["ZZ9999"]), courseMap: CM },
    { minor: { requirementSections: [null, undefined, {}] }, placedSet: new Set(), majorKeys: new Set() },
    { minor: { requirementSections: [SECTION("Odd", 1, { type: "NONSENSE" })] },
      placedSet: new Set(ALL_THREE), majorKeys: new Set(ALL_THREE), courseMap: CM },
  ];
  for (const args of cases) {
    const r = minorShare(args);
    if (r === null) continue;
    for (const k of ["requiredSH", "capSH", "sharedSH", "dependentSH", "claimedSH", "overSH"]) {
      assert.ok(Number.isFinite(r[k]), `${k} was ${r[k]} for ${JSON.stringify(args.placedSet)}`);
      assert.ok(r[k] >= 0, `${k} went negative`);
    }
    assert.ok(r.dependentSH <= r.requiredSH, "charged more than the minor requires");
    assert.equal(r.over, r.overSH > 0);
  }
});

test("minor share › arrays are accepted where Sets are expected", () => {
  const r = minorShare({ minor: THREE, placedSet: ALL_THREE, majorKeys: ["AA1000", "AA1001"],
                         courseMap: CM });
  assert.equal(r.dependentSH, 8);
  assert.equal(r.over, true);
});

// ── Inertness ────────────────────────────────────────────────────

test("minor share › computing it changes neither the audit nor its own inputs", () => {
  const sections = minorRequirementSections(THREE);
  const before = JSON.stringify(sections);
  const placed = new Set(ALL_THREE);
  const majors = new Set(["AA1000"]);

  const audit = () => allocateSections(minorRequirementSections(THREE), new Set(ALL_THREE),
                                       new Set(), CM);
  const plain = JSON.stringify(audit(), (k, v) => (v instanceof Set ? [...v] : v));
  minorShare({ minor: THREE, placedSet: placed, majorKeys: majors, courseMap: CM });
  const after = JSON.stringify(audit(), (k, v) => (v instanceof Set ? [...v] : v));

  assert.equal(after, plain, "the allocation moved when the cap was measured");
  assert.equal(JSON.stringify(sections), before, "the program record was mutated");
  assert.deepEqual([...placed].sort(), [...ALL_THREE].sort(), "placedSet was mutated");
  assert.deepEqual([...majors], ["AA1000"], "majorKeys was mutated");
});

test("minor share › the fraction is the policy's, and the key helper agrees with it", () => {
  assert.equal(MINOR_SHARE_FRACTION, 0.5);
  assert.equal(courseKey("AA", 1000), "AA1000");
});

// ── majorClaimOf: one owner for "what the majors claim" ──────────
// The panel draws the requirement rows and the board draws the badge on the
// card. A student looking at both at once is the person who finds out when they
// disagree, so both go through this.

test("claim › General Electives are not the major, so they are not claimed", () => {
  // The catalog permits it outright — "courses used to fulfil requirements for
  // the minor may also be used to complete undergraduate degree requirements"
  // — so a minor course sitting in the degree's free electives is the room a
  // minor is meant to occupy, not double-counted credit.
  const major = { requirementSections: [
    SECTION("Core", 1, C("AA", 1000)),
    { type: "SECTION", title: "Required General Electives", minRequirementCount: 1,
      requirements: [C("CC", 3000)] },
  ] };
  const { claimed } = majorClaimOf([{ data: major }], CM)(new Set(["AA1000", "CC3000"]));
  assert.deepEqual([...claimed], ["AA1000"]);
});

test("claim › a concentration is allocated with the major, and its courses are claimed", () => {
  // The catalog calls a concentration "a component of a major", so its courses
  // are major courses and the badge must treat them as such.
  //
  // What this does NOT assert is that the concentration avoids the major's own
  // courses. It does not: with AA1000 already claimed by Core, the
  // concentration takes AA1000 again rather than BB2000. That surprised me and
  // was checked rather than assumed — `allocateSection` decides blocking
  // against a snapshot, so passing the used set in constrains less than the
  // panel's comment implies. It is the audit's existing behaviour, it is out of
  // this module's scope, and it does not change the claimed SET, which is all
  // `minorShare` reads.
  const major = { requirementSections: [SECTION("Core", 1, C("AA", 1000))] };
  const conc  = SECTION("Focus", 1, C("AA", 1000), C("BB", 2000));
  const { claimed, sat } = majorClaimOf([{ data: major, concentration: conc }], CM)(
    new Set(["AA1000", "BB2000"]));
  assert.ok(claimed.has("AA1000"));
  assert.equal(sat.length, 2, "one entry per section, major then concentration");
  assert.equal(sat[1], 4, "the concentration is satisfied");
});

test("claim › a concentration-only course is claimed by the major", () => {
  // The case the badge depends on: a course named ONLY by the concentration is
  // still the major's claim, so a minor course that collides with it is
  // double-counted and must be marked.
  const major = { requirementSections: [SECTION("Core", 1, C("AA", 1000))] };
  const conc  = SECTION("Focus", 1, C("BB", 2000));
  const { claimed } = majorClaimOf([{ data: major, concentration: conc }], CM)(
    new Set(["AA1000", "BB2000"]));
  assert.deepEqual([...claimed].sort(), ["AA1000", "BB2000"]);
});

test("claim › both majors are claimed, and their sections stay in one vector", () => {
  const a = { requirementSections: [SECTION("A", 1, C("AA", 1000))] };
  const b = { requirementSections: [SECTION("B", 1, C("BB", 2000)), SECTION("B2", 1, C("CC", 3000))] };
  const { claimed, sat } = majorClaimOf([{ data: a }, { data: b }], CM)(
    new Set(["AA1000", "BB2000", "CC3000"]));
  assert.deepEqual([...claimed].sort(), ["AA1000", "BB2000", "CC3000"]);
  assert.equal(sat.length, 3);
});

test("claim › the vector length is stable across placed sets", () => {
  // `minorShare` compares two runs element-wise and declines when the lengths
  // differ. If this ever became placement-dependent the release would silently
  // stop working rather than fail.
  const major = { requirementSections: [SECTION("Core", 2, C("AA", 1000), C("AA", 1001))] };
  const claim = majorClaimOf([{ data: major }], CM);
  const lengths = [[], ["AA1000"], ["AA1000", "AA1001"], ["ZZ9999"]]
    .map(p => claim(new Set(p)).sat.length);
  assert.equal(new Set(lengths).size, 1, `lengths varied: ${lengths}`);
});

test("claim › junk programs are skipped rather than thrown on", () => {
  for (const programs of [null, undefined, [], [null], [{}], [{ data: null }]]) {
    const r = majorClaimOf(programs, CM)(new Set(ALL_THREE));
    assert.deepEqual([...r.claimed], []);
    assert.deepEqual(r.sat, []);
  }
});

// ── The printed sentence ─────────────────────────────────────────
// The export is the artifact a student hands an advisor, so its wording is a
// claim, not decoration: it must state the figure, the cap and the overage
// without ever announcing a breach that is not one.

test("report › the note states the budget when the plan is inside it", () => {
  const line = _minorShareNote(share(THREE, ALL_THREE, ["AA1000"]));
  assert.match(line, /Double counting/);
  assert.match(line, /4 of 6 SH/);
  assert.doesNotMatch(line, /over/, "a compliant plan must not read as a breach");
});

test("report › the note states the overage when it is one", () => {
  const line = _minorShareNote(share(THREE, ALL_THREE, ["AA1000", "AA1001"]));
  assert.match(line, /8 of the 12 SH/);
  assert.match(line, /2 SH over/);
  assert.match(line, /50% limit/);
});

test("report › a half-credit cap prints as a half, not as 3.5000000001", () => {
  const odd = minor(SECTION("Core", 2, C("AA", 1000), C("BB", 2000)));
  const cm = { ...CM, BB2000: course("BB2000", 3) };
  const line = _minorShareNote(share(odd, ["AA1000", "BB2000"], [], cm), "SH");
  assert.match(line, /0 of 3\.5 SH/);
});

test("report › nothing measurable prints nothing at all", () => {
  assert.equal(_minorShareNote(null), "");
  assert.equal(_minorShareNote(undefined), "");
  assert.equal(_minorShareNote({ requiredSH: 0, capSH: 0, dependentSH: 0, over: false }), "");
  // NaN is the shape that would otherwise print "NaN of NaN SH" on a page an
  // advisor reads.
  assert.equal(_minorShareNote({ requiredSH: NaN, capSH: NaN, dependentSH: NaN, over: false }), "");
});

test("report › the institution's unit name is honoured", () => {
  const line = _minorShareNote(share(THREE, ALL_THREE, ["AA1000"]), "credits");
  assert.match(line, /4 of 6 credits/);
  assert.doesNotMatch(line, /\bSH\b/);
});
