// UNIT · src/engine/demand.js `breadthCodes` — which competencies the electives must carry.
//
// A general elective is the most flexible cell in a plan: any level, any subject, no
// ordering requirement at all. The ONE exception is breadth — the NUPath codes the
// degree's own named courses do not already guarantee have to come from somewhere, and
// electives are the only somewhere left. Binding those is what gives an otherwise
// `spec: null` cell a candidate set, and therefore a place in every ordering signal the
// engine has.
//
// Every test here is a way of getting that wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { breadthCodes } from "../../src/engine/demand.js";

const course = (id, attributes = [], extra = {}) => ({
  id, subject: id.replace(/\d.*/, ""), number: id.replace(/^\D+/, ""), sh: 4,
  attributes, ...extra,
});
const mapOf = (...cs) => Object.fromEntries(cs.map(c => [c.id, c]));
const named = (id, ids) => ({ id, kind: "named", groups: [ids], sh: 4, title: id });
const choice = (id, ids) => ({ id, kind: "choice", groups: [ids], sh: 4, title: id });

// Supply is deliberately unequal and never tied, so the ordering assertion tests RARITY
// rather than the alphabetical tie-break behind it. Mirrors the real spread, where WF has
// 5 courses corpus-wide, WD 16, and WI 327.
//   WF 1 course   <   EX 2   <   IC 3
const CM = mapOf(
  course("AAA1", ["IC"]), course("AAA2", ["IC"]), course("AAA3", ["IC"]),
  course("BBB1", ["WF"]),
  course("CCC1", ["EX"]), course("CCC2", ["EX"]),
  course("DDD1", []),
);

test("breadth › the unmet codes come back, rarest first", () => {
  const got = breadthCodes([], CM, []);
  assert.deepEqual(got.map(c => c.code), ["WF", "EX", "IC"],
    "scarcest competency first — it has the fewest terms it can possibly sit in");
  assert.deepEqual(got.find(c => c.code === "IC").ids.sort(), ["AAA1", "AAA2", "AAA3"]);
});

test("breadth › a code a NAMED course already carries is not asked for again", () => {
  const got = breadthCodes([named("n", ["AAA1"])], CM, []);
  assert.ok(!got.some(c => c.code === "IC"), "IC is guaranteed by a course the degree names");
  assert.deepEqual(got.map(c => c.code), ["WF", "EX"]);
});

test("breadth › a CHOICE cell guarantees nothing and must not count as covered", () => {
  // "AAA1 or BBB1" carries IC on one branch and WF on the other. Counting it would let a
  // degree read as covered by a competency no student is obliged to take, and the
  // student finds out at graduation.
  const got = breadthCodes([choice("c", ["AAA1", "BBB1"])], CM, []);
  assert.deepEqual(got.map(c => c.code), ["WF", "EX", "IC"],
    "neither branch may be assumed");
});

test("breadth › a granted code is not spent on an elective", () => {
  // EX is the most-unmet competency in the corpus (244 of 349 programs) and a co-op
  // carries it. Not crediting it burns a free elective on something the plan already
  // delivers, in about 70% of programs.
  const got = breadthCodes([], CM, ["EX"]);
  assert.deepEqual(got.map(c => c.code), ["WF", "IC"]);
});

test("breadth › no attribute data means NO CLAIM, not 'everything is unmet'", () => {
  // A catalog without NUPath would otherwise bind every elective to a code with no
  // courses in it, which is the loudest possible way to be wrong about missing data.
  assert.deepEqual(breadthCodes([], mapOf(course("ZZZ1", [])), []), []);
  assert.deepEqual(breadthCodes([], {}, []), []);
});

test("breadth › a named cell naming a course the catalog lost is skipped, not thrown on", () => {
  // 13.2% of prereq atoms are renumbered away; a group can name an id `courseMap` has
  // no entry for, and a crash here would refuse the whole degree over one stale code.
  assert.doesNotThrow(() => breadthCodes([named("n", ["GONE9999", "AAA1"])], CM, []));
  const got = breadthCodes([named("n", ["GONE9999", "AAA1"])], CM, []);
  assert.ok(!got.some(c => c.code === "IC"), "the readable half still counts");
});

// ── How a bound cell is expressed: LABELLED, never restricted ───────

test("breadth › a bound elective is named but keeps its freedom", async () => {
  // The decision this test exists to protect, and it was measured both ways. Giving the
  // cell a real spec — the courses carrying that code — was the obvious move and it cost
  // far more than it bought: over the plans it touched, empty full terms went 18 -> 63
  // while terms leaving 3+ cells unguided improved only ~12 -> 2. Labelling without
  // restricting lands at 19 and 3.
  //
  // The cause is what makes a general elective worth having: it is the most flexible cell
  // in the plan, so it is what fills a term that would otherwise be empty. A spec takes
  // that away and replaces it with nothing.
  //
  // It would also overclaim. `attributes` covers 1,516 of 7,966 courses, so a hard spec
  // excludes four fifths of the catalog on data we know is partial — a student satisfies
  // IC with any IC course, including the ones our scrape has not labelled.
  const { deriveCells } = await import("../../src/engine/demand.js");
  const cm = mapOf(course("XX1000", ["IC"]), course("XX1001", ["IC"]), course("XX1002", ["IC"]));
  const { cells } = deriveCells(
    { totalCreditsRequired: 40, requirementSections: [] }, { courseMap: cm });
  const bound = cells.filter(c => c.nupath);
  assert.ok(bound.length > 0, "a degree that is all free electives should bind at least one");
  for (const c of bound) {
    assert.equal(c.spec, null, "a breadth elective must NOT be restricted to a candidate set");
    // And it must not ANNOUNCE the competency either. The binding is guidance that spreads
    // breadth across the plan — one ordering among several — so printing it on the card
    // would read as an instruction to a student whose own choice of elective could carry
    // the code just as well. The cell keeps `nupath`; the card says "General Elective".
    assert.equal(c.title, "General Elective");
    assert.doesNotMatch(c.title, /\(/, "no competency, no parenthetical of any kind");
  }
});

test("breadth › malformed cells do not throw", () => {
  for (const cells of [
    [{ id: "x", kind: "named" }],
    [{ id: "x", kind: "named", groups: [] }],
    [{ id: "x", kind: "named", groups: [[]] }],
    [null],
  ]) {
    assert.doesNotThrow(() => breadthCodes(cells.filter(Boolean), CM, []),
      JSON.stringify(cells));
  }
});

// ── RULE 1 and RULE 3 — the split, and which cells carry it ────────
//
// `docs/chart-elective-rules.md`. These are pure arithmetic over a pool, which makes them the
// cheapest place in the engine to be wrong without noticing: every input is a small integer, a
// wrong answer is still a small integer, and the consequence surfaces a plan and three layers
// away as "the electives are in the wrong place".
//
// So these test INVARIANTS rather than examples wherever an invariant exists. An example pins
// today's behaviour; `breadth + depth === cells` pins the thing a caller actually relies on, and
// it is the property that would have caught the collision bug in `breadthIndices` below.
import { breadthSplit, breadthIndices, CODES_PER_COURSE, NUPATH_CODES }
  from "../../src/engine/electives.js";

test("electives › the split always accounts for every cell", () => {
  // The invariant every caller depends on: no cell is invented and none is lost, whatever the
  // inputs. `deriveCells` emits `breadth + depth` cells and marks each one, so a split that does
  // not sum would either label a cell twice or leave one unlabelled.
  for (let cells = 0; cells <= 40; cells++) {
    for (let remaining = 0; remaining <= NUPATH_CODES; remaining++) {
      const s = breadthSplit({ cells, remaining });
      assert.equal(s.breadth + s.depth, cells, `cells=${cells} remaining=${remaining}`);
      assert.ok(s.breadth >= 0 && s.depth >= 0, `negative half at cells=${cells}`);
      assert.ok(s.breadth <= cells, `breadth exceeds the pool at cells=${cells}`);
      assert.equal(s.all, s.breadth >= cells && cells > 0,
        `\`all\` disagrees with the split at cells=${cells} remaining=${remaining}`);
    }
  }
});

test("electives › the split is the ARITHMETIC, not a fixed 3-4", () => {
  // The worked example from the design doc, which the old fixed rule got wrong: 10 electives and
  // 6 unmet codes needs ~4 courses of breadth and leaves 6 free.
  assert.deepEqual(breadthSplit({ cells: 10, remaining: 6 }), { breadth: 4, depth: 6, all: false });
  // And the thing the fixed rule could never do: the breadth need SCALES with what is unmet.
  // One cell per code — the old behaviour — would have said 6 here, not 4.
  assert.equal(breadthSplit({ cells: 20, remaining: 3 }).breadth, 2);
  assert.equal(breadthSplit({ cells: 20, remaining: 12 }).breadth, 8);
  // Ceil, never floor: half a course of breadth is a whole cell to a student, and under-reserving
  // costs a graduation where over-reserving costs a slot they can spend freely anyway.
  assert.equal(breadthSplit({ cells: 20, remaining: 1 }).breadth, 1);
  assert.equal(breadthSplit({ cells: 20, remaining: 2 }).breadth, 2);   // 2/1.5 = 1.33 -> 2
});

test("electives › a small pool is ALL breadth, and says so", () => {
  // Not an edge case, a common shape — 50 of 351 degrees with a pool. A degree with two free
  // electives has no room for depth, and calling one of them "depth" would promise a student a
  // choice the credits do not exist for.
  const s = breadthSplit({ cells: 2, remaining: 13 });
  assert.deepEqual(s, { breadth: 2, depth: 0, all: true });
  // Zero cells is not a small pool, it is no pool. `all` must be false or a caller reading it as
  // "this pool is entirely breadth" would act on a pool that does not exist.
  assert.deepEqual(breadthSplit({ cells: 0, remaining: 13 }), { breadth: 0, depth: 0, all: false });
});

test("electives › junk in the arithmetic does not produce junk cells", () => {
  // `remaining` comes from `breadthCodes`, which reads scraped attribute data. A run reporting
  // more unmet codes than NUPath has is a bug upstream, and reserving 14 cells for 13
  // competencies would be its most expensive symptom.
  assert.equal(breadthSplit({ cells: 30, remaining: 999 }).breadth,
               Math.ceil(NUPATH_CODES / CODES_PER_COURSE));
  // Negatives, fractions and absent values all have to degrade to a usable split rather than
  // throw or emit a negative count — this runs inside `deriveCells`, where a throw is a refused
  // plan for a reason the student cannot act on.
  for (const bad of [{}, { cells: -5, remaining: 4 }, { cells: 7, remaining: -3 },
                     { cells: NaN, remaining: NaN }, { cells: 7.6, remaining: 4.4 },
                     { cells: undefined, remaining: null }]) {
    const s = breadthSplit(bad);
    assert.ok(Number.isInteger(s.breadth) && Number.isInteger(s.depth),
      `non-integer split from ${JSON.stringify(bad)}`);
    assert.ok(s.breadth >= 0 && s.depth >= 0, `negative split from ${JSON.stringify(bad)}`);
  }
});

test("electives › rule 3 — breadth leans LATE, and never loses a competency", () => {
  // The bug this replaces: `breadthAt` walked from 0, so the shallowest electives in the degree
  // were also the earliest and the student's depth was pushed behind them.
  for (let n = 1; n <= 30; n++) {
    for (let count = 0; count <= n; count++) {
      const idx = breadthIndices(n, count);
      // Not one fewer. A dropped index is a competency the plan silently stops covering, and the
      // collision path (`while (out.has(k)) k--`) is where that would happen.
      assert.equal(idx.size, count, `n=${n} count=${count} produced ${idx.size} indices`);
      for (const i of idx) {
        assert.ok(Number.isInteger(i) && i >= 0 && i < n, `index ${i} outside [0,${n})`);
      }
      // ── The LEAN, stated at the strength it actually holds ─────────
      //
      // A first version asserted `mean > midpoint` for every `0 < count < n` and FAILED at
      // n=27, count=26, where the mean lands exactly on the midpoint. That is not a stride bug:
      // when `count` is n-1 the set is forced to be all-but-one index, so the mean is decided
      // entirely by which single cell is omitted and there is no freedom left to lean with.
      // `breadthIndices` says as much — "collisions only happen when count is close to n, where
      // the exact placement no longer matters".
      //
      // So the claim is split rather than weakened. A non-strict bound holds everywhere, which
      // is what catches a reversed stride; the strict one is asserted where the function has
      // room to honour it, which is where every real degree sits — median pool 11, breadth 5.
      if (count > 0 && count < n) {
        const mean = [...idx].reduce((a, b) => a + b, 0) / count;
        assert.ok(mean >= (n - 1) / 2,
          `n=${n} count=${count} mean index ${mean} is EARLIER than the midpoint ${(n - 1) / 2}`);
        if (count * 2 <= n) {
          assert.ok(mean > (n - 1) / 2,
            `n=${n} count=${count} mean index ${mean} is not past the midpoint ${(n - 1) / 2}`);
        }
      }
    }
  }
});

test("electives › rule 3 — the last cell always carries breadth when any does", () => {
  // The stride starts at the back, so the final elective in the pool is the first one bound. This
  // is the specific thing "leans late" means, and it is worth pinning separately from the mean:
  // a stride bug that reversed direction would still satisfy the mean on some inputs.
  for (let n = 2; n <= 20; n++) {
    for (let count = 1; count < n; count++) {
      assert.ok(breadthIndices(n, count).has(n - 1),
        `n=${n} count=${count} did not bind the last cell`);
    }
  }
});

test("electives › degenerate pools produce no indices rather than throwing", () => {
  for (const [n, count] of [[0, 0], [0, 5], [5, 0], [-1, 3], [3, -1], [NaN, 2], [2, NaN]]) {
    const idx = breadthIndices(n, count);
    assert.ok(idx instanceof Set, `n=${n} count=${count} did not return a Set`);
    for (const i of idx) assert.ok(i >= 0 && i < Math.max(0, n), `stray index ${i}`);
  }
});
