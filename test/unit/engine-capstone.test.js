// UNIT · src/engine/objective.js `settleCapstones` — a capstone belongs at the end.
//
// NUPath's "Capstone Experience" is a designation the registrar publishes, carried by 161
// courses, so membership is READ rather than inferred from a title. And the corpus agrees with
// it more strongly than with anything else it records — over the published undergraduate plans:
//
//     code   median position   p10    p90
//     CE         1.000        0.85   1.00     <- nine in ten in the last 15% of a plan
//     WI         0.692        0.08   1.00
//     EI         0.308        0.00   1.00
//     ALL        0.308        0.00   0.86
//
// The defect it fixes: `industrial_engineering_and_computer_science`, five-year variant, put
// `MEIE 4701 Capstone Design 1` in YEAR ONE SUMMER — in a term the department marks Vacation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { settleCapstones } from "../../src/engine/objective.js";

const CE = "CE";
const cal = { capstoneAttribute: CE, capstoneFloor: 0.85, levelPosition: { 1: 0, 2: 0.36, 3: 0.64, 4: 0.91 } };
const course = (id, attrs = [], sh = 4) => ({
  id, subject: id.replace(/\d.*/, ""), number: id.replace(/^\D+/, ""), sh, attributes: attrs,
});
const mapOf = (...cs) => Object.fromEntries(cs.map(c => [c.id, c]));
const cell = (id, ids, domain) => ({
  cell: { id, kind: "named", groups: [ids], sh: 4, title: id }, candidates: [...ids], domain,
});
const choice = (id, groups, domain) => ({
  cell: { id, kind: "choice", groups, sh: 4, title: id },
  candidates: groups.flat(), domain,
});
// Twelve terms, so the 0.85 floor lands at index 9 and there is room either side of it.
const TERMS = Array.from({ length: 12 }, (_, i) => ({ label: `T${i}`, weight: 1, targetSH: 16 }));
const ALL = TERMS.map((_, i) => i);
const CAP = TERMS.map(() => 99);
const yes = () => true;

test("capstone › an early capstone swaps with a later course", () => {
  // The case the pass exists for. It SWAPS rather than relocates because the terms it fires in
  // are full — a one-cell move would overflow and be rejected, which is why the hill climber
  // never fixed this.
  const courseMap = mapOf(course("CAP4701", [CE]), course("EARLY1000", []));
  const plans = [cell("c", ["CAP4701"], ALL), cell("e", ["EARLY1000"], ALL)];
  const out = settleCapstones(new Map([["c", 3], ["e", 10]]), {
    plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap, cal,
  });
  assert.equal(out.moves, 1);
  assert.equal(out.termOf.get("c"), 10, "the capstone should take the late term");
  assert.equal(out.termOf.get("e"), 3);
});

test("capstone › a capstone ALREADY past the floor is left alone", () => {
  // The floor is a floor. A capstone at 9 of 11 is where it belongs and must not be shuffled
  // further just because a later cell exists.
  const courseMap = mapOf(course("CAP4701", [CE]), course("OTHER1000", []));
  const plans = [cell("c", ["CAP4701"], ALL), cell("e", ["OTHER1000"], ALL)];
  const out = settleCapstones(new Map([["c", 10], ["e", 11]]), {
    plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap, cal,
  });
  assert.equal(out.moves, 0);
});

test("capstone › EVERY option must carry the designation", () => {
  // A cell offering a capstone or an ordinary elective is not a capstone cell — the student may
  // take the other branch. Same `∀ option` reading the rest of the engine uses for credit,
  // competencies and unlock value.
  const courseMap = mapOf(course("CAP4701", [CE]), course("PLAIN4000", []), course("E1000", []));
  const both = settleCapstones(new Map([["c", 3], ["e", 10]]), {
    plans: [choice("c", [["CAP4701"], ["PLAIN4000"]], ALL), cell("e", ["E1000"], ALL)],
    terms: TERMS, cap: CAP, fullLegal: yes, courseMap, cal,
  });
  assert.equal(both.moves, 0, "one non-capstone branch means the cell is not a capstone");
  const all = settleCapstones(new Map([["c", 3], ["e", 10]]), {
    plans: [choice("c", [["CAP4701"], ["CAP4702"]], ALL), cell("e", ["E1000"], ALL)],
    terms: TERMS, cap: CAP, fullLegal: yes,
    courseMap: mapOf(course("CAP4701", [CE]), course("CAP4702", [CE]), course("E1000", [])), cal,
  });
  assert.equal(all.moves, 1, "every branch a capstone means the student gets one whichever they take");
});

test("capstone › the partner is never dragged in front of ITS convention", () => {
  // Sending a capstone to the end must not manufacture the very defect two other passes in this
  // file guard against. A 4000-level partner belongs at 0.91 and cannot be moved to term 3.
  const courseMap = mapOf(course("CAP4701", [CE]), course("LATE4000", []));
  const plans = [cell("c", ["CAP4701"], ALL), cell("e", ["LATE4000"], ALL)];
  const out = settleCapstones(new Map([["c", 3], ["e", 10]]), {
    plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap, cal,
  });
  assert.equal(out.moves, 0, "a 4000-level course was pulled to term 3 to make room");
});

test("capstone › another capstone is never the partner", () => {
  // Swapping two capstones moves the problem rather than fixing it, and in a two-part sequence
  // (`Capstone Design 1` and `2`) it would also invert them.
  // The partner is 2000-level ON PURPOSE. With two 4000-level capstones the partner-convention
  // guard refuses the swap first, so the test would pass with this rule deleted — which mutation
  // testing duly showed. At 2000-level the convention permits term 3, leaving this rule as the
  // only thing that can refuse.
  const courseMap = mapOf(course("CAP4701", [CE]), course("CAP2702", [CE]));
  const plans = [cell("c1", ["CAP4701"], ALL), cell("c2", ["CAP2702"], ALL)];
  const out = settleCapstones(new Map([["c1", 3], ["c2", 10]]), {
    plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap, cal,
  });
  assert.equal(out.moves, 0);
});

test("capstone › an ILLEGAL swap is skipped, and fullLegal is CONSULTED", () => {
  // The spy is the assertion, not the outcome: asserting `moves === 0` alone would pass if some
  // earlier guard refused the swap, which is how a `fullLegal` test in this file's sibling
  // turned out to be testing nothing.
  const courseMap = mapOf(course("CAP4701", [CE]), course("E1000", []));
  const plans = [cell("c", ["CAP4701"], ALL), cell("e", ["E1000"], ALL)];
  let asked = 0;
  const out = settleCapstones(new Map([["c", 3], ["e", 10]]), {
    plans, terms: TERMS, cap: CAP, fullLegal: () => { asked += 1; return false; }, courseMap, cal,
  });
  assert.ok(asked > 0, "the swap was decided without consulting `fullLegal`");
  assert.equal(out.moves, 0);
});

test("capstone › a term outside the DOMAIN is never used", () => {
  const courseMap = mapOf(course("CAP4701", [CE]), course("E1000", []));
  const plans = [cell("c", ["CAP4701"], [0, 1, 2, 3]), cell("e", ["E1000"], ALL)];
  const out = settleCapstones(new Map([["c", 3], ["e", 10]]), {
    plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap, cal,
  });
  assert.equal(out.moves, 0, "the capstone cannot legally reach term 10 and must stay");
});

test("capstone › no designation configured means no opinion", () => {
  // The default calibration carries `capstoneAttribute: null`, because an institution without
  // the designation must get the old pipeline rather than a guess about its curriculum.
  const courseMap = mapOf(course("CAP4701", [CE]), course("E1000", []));
  const plans = [cell("c", ["CAP4701"], ALL), cell("e", ["E1000"], ALL)];
  const out = settleCapstones(new Map([["c", 3], ["e", 10]]), {
    plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap,
    cal: { ...cal, capstoneAttribute: null },
  });
  assert.equal(out.moves, 0);
});

test("capstone › malformed cells and attributes do not throw", () => {
  const courseMap = mapOf(course("CAP4701", [CE]), course("E1000", []));
  for (const plans of [
    [],
    [{ cell: { id: "x", kind: "open", groups: null }, candidates: null, domain: ALL }],
    [cell("c", ["GONE9999"], ALL), cell("e", ["E1000"], ALL)],
    [{ cell: { id: "c", kind: "named", groups: [[]] }, candidates: [], domain: ALL }],
  ]) {
    assert.doesNotThrow(() => settleCapstones(new Map([["c", 3], ["e", 10]]), {
      plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap, cal,
    }), JSON.stringify(plans.map(p => p.cell.id)));
  }
  // An attributes field that is a string, not an array — a scrape shape that would otherwise
  // make `includes` match single letters.
  const weird = mapOf({ ...course("CAP4701", []), attributes: "CE" }, course("E1000", []));
  assert.doesNotThrow(() => settleCapstones(new Map([["c", 3], ["e", 10]]), {
    plans: [cell("c", ["CAP4701"], ALL), cell("e", ["E1000"], ALL)],
    terms: TERMS, cap: CAP, fullLegal: yes, courseMap: weird, cal,
  }));
});
