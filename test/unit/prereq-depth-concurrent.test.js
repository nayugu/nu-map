// ═══════════════════════════════════════════════════════════════════
// A CONCURRENT prerequisite costs no term.
//
// `concurrent: true` on a prerequisite reference means the catalog permits both in the SAME
// semester. It bounds what must be UNDERWAY, not what must be FINISHED, so charging it a
// term charges for an ordering the registrar does not require.
//
// `precedence.js` has always known this — `planDepthOf` reads `tok.concurrent` and adds 0.
// `prereqDepth.js` did not, and `buildDomains` turns depth into the `before-prereqs`
// exclusion. So one rule was modelled correctly in one file and contradicted in another,
// and the contradiction is what reached the student:
//
//   PHYS 1161 lists MATH 1341 as a concurrent option and its department puts both in the
//   first fall. Depth said 1, and since PHYS 1161 is offered only in fall, its earliest
//   legal term became YEAR TWO — a full year after the plan its own faculty published.
//
// 251 of 2,614 catalog courses with prerequisites (9.6%) carry a concurrent-eligible
// option, and 152 (5.8%) have nothing else, so this is not one program's quirk.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDepthIndex } from "../../src/engine/prereqDepth.js";

const course = (id, prereqs = []) => ({ id, prereqs });

test("depth › a concurrent prerequisite adds no depth", () => {
  const map = {
    MATH1: course("MATH1"),
    PHYS1: course("PHYS1", [{ subject: "MATH", number: "1", concurrent: true }]),
  };
  const ix = buildDepthIndex(map);
  assert.equal(ix.depthOf("MATH1"), 0);
  assert.equal(ix.depthOf("PHYS1"), 0, "it may share MATH1's term, so it costs nothing");
});

test("depth › an ordinary prerequisite still costs a term", () => {
  const map = {
    MATH1: course("MATH1"),
    PHYS1: course("PHYS1", [{ subject: "MATH", number: "1" }]),
  };
  assert.equal(buildDepthIndex(map).depthOf("PHYS1"), 1,
    "without the flag the reference must be FINISHED first");
});

test("depth › an OR takes the cheapest branch, so one concurrent option frees the course", () => {
  // The real `PHYS 1161` shape: several strict options and several concurrent ones.
  const map = {
    MATHA: course("MATHA"),
    MATHB: course("MATHB"),
    PHYS: course("PHYS", [
      { subject: "MATH", number: "A" }, "Or",
      { subject: "MATH", number: "B", concurrent: true },
    ]),
  };
  assert.equal(buildDepthIndex(map).depthOf("PHYS"), 0,
    "OR takes the minimum, and the concurrent branch costs nothing");
});

test("depth › an AND takes the dearest branch, so a strict sibling still binds", () => {
  const map = {
    MATHA: course("MATHA"),
    MATHB: course("MATHB"),
    PHYS: course("PHYS", [
      { subject: "MATH", number: "A" }, "And",
      { subject: "MATH", number: "B", concurrent: true },
    ]),
  };
  assert.equal(buildDepthIndex(map).depthOf("PHYS"), 1,
    "the strict half must still be finished, so the course cannot be free");
});

test("depth › concurrency does not collapse a CHAIN below it", () => {
  // A concurrent reference costs no term of its own and must still carry whatever its own
  // prerequisites cost. Reading `concurrent` as "depth 0" rather than "adds 0" would let a
  // course sit on top of a three-deep chain in term one.
  // Keyed the way the catalog is — `refId` builds `subject + number`, so a reference must
  // name both or it resolves to nothing and the branch reads as free.
  const chain = {
    MATH1: course("MATH1"),
    MATH2: course("MATH2", [{ subject: "MATH", number: "1" }]),
    MATH3: course("MATH3", [{ subject: "MATH", number: "2", concurrent: true }]),
  };
  const ix = buildDepthIndex(chain);
  assert.equal(ix.depthOf("MATH1"), 0);
  assert.equal(ix.depthOf("MATH2"), 1);
  assert.equal(ix.depthOf("MATH3"), 1,
    "concurrent with MATH2 means MATH2's term — which is term 1, not term 0");
});

test("depth › the real catalog shape: PHYS 1161 is free to sit in the first fall", () => {
  // Written out rather than loaded, so this states the rule instead of asserting today's
  // catalog. The token list is the shape the scraper actually produces.
  const map = {
    MATH1241: course("MATH1241"),
    MATH1251: course("MATH1251"),
    MATH1341: course("MATH1341"),
    PHYS1161: course("PHYS1161", [
      { subject: "MATH", number: "1241", minGrade: "D-" }, "Or",
      { subject: "MATH", number: "1251", minGrade: "D-" }, "Or",
      { subject: "MATH", number: "1341", concurrent: true, minGrade: "D-" },
    ]),
  };
  assert.equal(buildDepthIndex(map).depthOf("PHYS1161"), 0,
    "its department puts it beside MATH 1341 in the first fall, and the catalog allows that");
});
