// The free-elective allowance, and the three facts it kept collapsing into one.
//
// ── What shipped, and for how long ──────────────────────────────────
//
// `generalElectiveAllowance` was `max(0, (total ?? 0) - demand)`. The `?? 0` did
// arithmetic on a number the record does not carry, so a program with no stated
// total got an allowance of 0 — indistinguishable from a degree that genuinely
// leaves no room. Every consumer then printed it: the report drew
// "General Electives 0/0 SH" with a ✓ and a FULL green bar, because
// `requiredSH > 0 ? … : 100` reads "nothing required" as "requirement met".
//
// Measured over the 1,071 shipped programs: 633 produced a non-positive
// allowance — 173 minors, 269 with no stated total, 364 whose parsed
// requirements already meet or exceed the total. 460 of them are DEGREES, where
// the row reached a student.
//
// So there are three facts and they need three renderings:
//   N > 0   a real residual, with a denominator;
//   0       no free electives, and the row is worth printing only if the
//           student has placed credit against it anyway;
//   null    we cannot say — and this is the one that must never look like 0.
//
// The corpus consequence is `test/invariant/general-elective-allowance.test.js`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generalElectiveAllowance, generalElectiveSHOf,
} from "../../src/core/requirementBinding.js";
import {
  calculateGeneralElectives, generalElectivesWorthShowing, allocateMajorWithElectives,
} from "../../src/core/gradRequirements.js";
import { sectionProgress, sectionProgressText } from "../../src/core/planModel.js";

// ── The rule ───────────────────────────────────────────────────────

test("a stated total yields a number; an unstated one yields null, never 0", () => {
  assert.equal(generalElectiveAllowance({ totalCreditsRequired: 128 }, 100), 28);
  assert.equal(generalElectiveAllowance({ totalCreditsRequired: 128 }, 128), 0,
    "a degree with no room left legitimately allows 0");

  // The defect, in every shape the corpus actually contains. `0` is the one that
  // shipped on 269 records after the 2026-08-21 rollover.
  for (const total of [0, null, undefined, NaN, -4, "128"]) {
    assert.equal(generalElectiveAllowance({ totalCreditsRequired: total }, 100), null,
      `a total of ${JSON.stringify(total)} was treated as a measurement`);
  }
  assert.equal(generalElectiveAllowance(null, 100), null);
  assert.equal(generalElectiveAllowance(undefined, 0), null);
});

test("the allowance never goes negative, and over-demand is 0 rather than null", () => {
  // These are DIFFERENT facts and the distinction is the whole point: 364
  // programs demand at least their own total, which is a claim we can make
  // (possibly a wrong one, but ours), where a missing total is no claim at all.
  const r = generalElectiveAllowance({ totalCreditsRequired: 128 }, 159);
  assert.equal(r, 0);
  assert.notEqual(r, null, "over-demand must not masquerade as an unknown total");
});

test("generalElectiveSHOf agrees with the rule, including on junk", () => {
  assert.equal(generalElectiveSHOf({ totalCreditsRequired: 0, requirementSections: [] }), null);
  assert.equal(generalElectiveSHOf({ requirementSections: [] }), null);
  assert.equal(generalElectiveSHOf(null), null);
  assert.equal(generalElectiveSHOf(undefined), null);
  assert.equal(generalElectiveSHOf({}), null);
  // A stated total with nothing demanded is the whole total, and it is a NUMBER.
  assert.equal(generalElectiveSHOf({ totalCreditsRequired: 120, requirementSections: [] }), 120);
});

test("the absence of a general-elective obligation is read two ways, not one", () => {
  // `obligationsOf` emits nothing both when the residual is 0 and when there is
  // no total to take one against. Reading that absence as `?? 0` is exactly how
  // the two collapsed, so the disambiguation must come from the TOTAL.
  const noRoom  = { totalCreditsRequired: 8,
                    requirementSections: [{ title: "S", minRequirementCount: 1,
                                            requirements: [{ type: "COURSE", subject: "CS", classId: "1000" }] }] };
  const noTotal = { ...noRoom, totalCreditsRequired: 0 };
  const cm = { CS1000: { subject: "CS", number: "1000", sh: 40 } };
  assert.equal(generalElectiveSHOf(noRoom,  cm), 0,    "a full degree allows zero");
  assert.equal(generalElectiveSHOf(noTotal, cm), null, "an unknown degree allows nothing knowable");
});

// ── The section ────────────────────────────────────────────────────

const SEC = (requiredSH, placedSH = 0) => ({
  title: "General Electives", placedSH, completedSH: placedSH, plannedSH: 0,
  requiredSH, children: [], satCount: 0, total: 0, minRequired: 0, sat: true,
});

test("null is carried onto the section, not coerced on the way", () => {
  const s = calculateGeneralElectives(new Set(), new Set(), {}, null);
  assert.equal(s.requiredSH, null,
    "the unknown was flattened to a number somewhere between the rule and the section");
});

test("an unsupplied allowance defaults to null, because a caller that did not measure has not measured", () => {
  const { generalElectives } = allocateMajorWithElectives(
    { totalCreditsRequired: 0, requirementSections: [] }, new Set(), {});
  assert.equal(generalElectives.requiredSH, null);
});

test("worth showing: a fact, or nothing", () => {
  assert.equal(generalElectivesWorthShowing(SEC(12)),      true,  "a real residual");
  assert.equal(generalElectivesWorthShowing(SEC(12, 8)),   true);
  assert.equal(generalElectivesWorthShowing(SEC(0,  8)),   true,
    "8 SH beyond a full degree is the case a student most needs to see");
  assert.equal(generalElectivesWorthShowing(SEC(null, 8)), true,
    "credit placed is a fact whatever the denominator");
  assert.equal(generalElectivesWorthShowing(SEC(0)),       false, "0 of 0 says nothing");
  assert.equal(generalElectivesWorthShowing(SEC(null)),    false);
  // Junk must not become a reason to print.
  for (const bad of [null, undefined, {}, SEC(NaN), SEC(Infinity), SEC(-5), SEC("12")]) {
    assert.equal(generalElectivesWorthShowing(bad), false,
      `printed a row for ${JSON.stringify(bad)}`);
  }
});

// ── The rendering ──────────────────────────────────────────────────

test("an unknown allowance renders as unknown, and never as satisfied", () => {
  const p = sectionProgress(SEC(null, 8));
  assert.equal(p.allowanceUnknown, true);
  assert.equal(p.hasSplit, false,
    "the split renderer prints `/${requiredSH}` and would have put `null` on the page");
  assert.match(sectionProgressText(SEC(null, 8)), /states no total/);
  assert.doesNotMatch(sectionProgressText(SEC(null, 8)), /\bof 0\b/,
    "the exact string that read as a met requirement");
});

test("a known allowance is untouched by any of this", () => {
  // The regression that would make the fix worse than the defect.
  const p = sectionProgress(SEC(16, 8));
  assert.equal(p.allowanceUnknown, false);
  assert.equal(p.hasSplit, true);
  assert.equal(sectionProgressText(SEC(16, 8)), "8 completed + 0 planned of 16 SH");

  const zero = sectionProgress(SEC(0, 8));
  assert.equal(zero.allowanceUnknown, false,
    "a degree with no room is a measurement, not an unknown");
  assert.equal(zero.hasSplit, true);
});

test("allowanceUnknown is only ever about General Electives", () => {
  // It keys on the title, so any other section carrying a null must be inert.
  const other = sectionProgress({ title: "Core", requiredSH: null, placedSH: 4,
                                  children: [], satCount: 1, total: 2, sat: false });
  assert.equal(other.allowanceUnknown, false);
  assert.equal(other.isGeneralElectives, false);
});
