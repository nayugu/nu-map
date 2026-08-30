// CHART's cell derivation, attacked. Every requirement shape the corpus contains,
// plus the malformed ones a monthly re-scrape can produce.
import test from "node:test";
import assert from "node:assert/strict";
import { deriveCells, cellsSH, specLabel } from "../../src/engine/demand.js";
import { GENERAL_ELECTIVE, CONCENTRATION } from "../../src/core/requirementDemand.js";

const C = (subject, classId) => ({ type: "COURSE", subject, classId });
const AND = (...courses) => ({ type: "AND", courses });
const OR = (...courses) => ({ type: "OR", courses });
const XOM = (numCreditsMin, ...courses) => ({ type: "XOM", numCreditsMin, courses });
const RANGE = (subject, a, b, exceptions = []) =>
  ({ type: "RANGE", subject, idRangeStart: a, idRangeEnd: b, exceptions });
const SECTION = (title, minRequirementCount, ...requirements) =>
  ({ type: "SECTION", title, minRequirementCount, requirements });

const course = (id, sh = 4) => ({
  id, subject: id.replace(/\d.*/, ""), number: id.replace(/^\D+/, ""), sh,
});
const CM = Object.fromEntries([
  course("CS1800"), course("CS1802", 1), course("CS2000"), course("CS2001", 1),
  course("CS2800"), course("CS3000"), course("CS4300"), course("CS4100"),
  course("MATH1341"), course("MATH3001"), course("MATH3002"), course("MATH4999"),
  course("GE1501"), course("SEM1000", 1),
  // A 0 SH co-op, which is what makes a choice cell's credit ambiguous in the corpus.
  course("COOP3945", 0),
].map(c => [c.id, c]));

const prog = (sections, extra = {}) => ({
  totalCreditsRequired: 100, requirementSections: sections, ...extra,
});
const cellsOf = (sections, extra = {}) =>
  deriveCells(prog(sections, extra), { courseMap: CM });

const titles = (cells) => cells.map(c => c.title);
const kinds = (cells) => cells.map(c => c.kind);
const groups = (cells) => cells.filter(c => c.groups).map(c => c.groups);

// ── The three cell kinds ───────────────────────────────────────────

test("demand › an all-required section yields one cell per obligation", () => {
  const { cells } = cellsOf([SECTION("Core", 2, C("CS", "1800"), C("CS", "2800"))]);
  const real = cells.filter(c => typeof c.target === "number");
  assert.deepEqual(kinds(real), ["named", "named"]);
  assert.deepEqual(groups(real), [[["CS1800"]], [["CS2800"]]]);
});

test("demand › a NESTED and is a sequence, not one co-requisite group", () => {
  // A group is what a student registers for together, so it cannot contain a
  // prerequisite chain. `andGroup` used to flatten nested ANDs, which was
  // harmless while no nested AND existed — 0 sections in the corpus — until the
  // catalog's subheadered branches began parsing as one. Public Health BA offers
  // "BIOL 1111 and 1112, BIOL 1113 and 1114" as ONE option, and General Biology
  // 2 requires General Biology 1: flattened, all four had to share a term and
  // the plan was refused with `named-prereq`.
  const { cells } = cellsOf([SECTION("Biology", 1,
    AND(AND(C("CS", "1800"), C("CS", "1802")), AND(C("CS", "2500"), C("CS", "2501"))))]);
  const real = cells.filter(c => typeof c.target === "number");
  assert.deepEqual(groups(real), [[["CS1800", "CS1802"]], [["CS2500", "CS2501"]]],
    "one cell per pair, so the ordinary prerequisite ordering can sequence them");
});

test("demand › co-required courses share ONE cell and their credit sums", () => {
  const { cells } = cellsOf([SECTION("Core", 1, AND(C("CS", "1800"), C("CS", "1802")))]);
  const cell = cells.find(c => typeof c.target === "number");
  assert.equal(cell.kind, "named");
  assert.deepEqual(cell.groups, [["CS1800", "CS1802"]]);
  assert.equal(cell.sh, 5, "4 + 1, the way the catalog prints CS 1800 and CS 1802");
});

test("demand › an OR of courses is one CHOICE cell with several groups", () => {
  const { cells } = cellsOf([SECTION("Pick", 1, OR(C("CS", "4300"), C("CS", "4100")))]);
  const cell = cells.find(c => typeof c.target === "number");
  assert.equal(cell.kind, "choice");
  assert.deepEqual(cell.groups, [["CS4300"], ["CS4100"]]);
});

test("demand › a nested OR flattens; a nested AND stays one group", () => {
  const { cells } = cellsOf([
    SECTION("Pick", 1, OR(C("CS", "4300"), OR(C("CS", "4100"), AND(C("CS", "2000"), C("CS", "2001"))))),
  ]);
  const cell = cells.find(c => typeof c.target === "number");
  assert.deepEqual(cell.groups, [["CS4300"], ["CS4100"], ["CS2000", "CS2001"]]);
});

// This asserted the LARGEST option, reasoned as "a plan that fits the biggest choice fits any
// of them". That is sound about term capacity and unsound about the degree, and the degree is
// what a student cannot recover from: a cell's credit is also counted as already earned when
// the general electives are derived to close the gap to the stated total, so charging the
// maximum spends credit the student may never receive. See `demand.js` at the OR case —
// International Business charged 8 SH for a co-op requirement whose usual option is 0 SH, and
// emitted two courses too few as a result.
test("demand › a choice cell costs the CHEAPEST option, so the degree cannot be under-credited", () => {
  const { cells } = cellsOf([
    SECTION("Pick", 1, OR(C("CS", "4300"), AND(C("CS", "2000"), C("CS", "2001")))),
  ]);
  assert.equal(cells.find(c => typeof c.target === "number").sh, 4,
    "CS 4300 alone is 4 SH; the 5 SH pair is the dearer option and is not what the cell guarantees");
});

test("demand › a 0 SH option makes the choice cell free, so electives cover the rest", () => {
  // The International Business shape: a requirement answered EITHER by a credit-bearing
  // course or by a 0 SH co-op. Charging 4 here would silently delete a general elective.
  const { cells } = cellsOf([
    SECTION("Experiential", 1, OR(C("CS", "4300"), C("COOP", "3945"))),
  ]);
  assert.equal(cells.find(c => typeof c.target === "number").sh, 0);
});

test("demand › a credit pool emits cells sized by its own courses", () => {
  const { cells } = cellsOf([SECTION("Electives", 1, XOM(12, RANGE("MATH", 3001, 4999)))]);
  const real = cells.filter(c => typeof c.target === "number");
  assert.equal(real.length, 3, "12 SH of 4 SH courses");
  assert.deepEqual(kinds(real), ["open", "open", "open"]);
  assert.equal(real[0].spec.ranges.length, 1);
});

test("demand › a choose-N-of-M section emits N cells drawing from the union", () => {
  const { cells } = cellsOf([
    SECTION("Two of four", 2, C("CS", "1800"), C("CS", "2800"), C("CS", "3000"), C("CS", "4300")),
  ]);
  const real = cells.filter(c => typeof c.target === "number");
  assert.equal(real.length, 2);
  assert.ok(real.every(c => c.kind === "open"));
  // The union, so any of the four can answer either cell.
  assert.equal(real[0].spec.keys.size, 4);
});

test("demand › a single-course XOM is the split-credit pattern, not a choice", () => {
  const { cells } = cellsOf([SECTION("Supplemental", 1, XOM(1, C("GE", "1501")))]);
  const cell = cells.find(c => typeof c.target === "number");
  assert.equal(cell.kind, "named");
  assert.equal(cell.allot, 1, "what this section claims");
  assert.equal(cell.sh, 4, "what the student registers for");
});

// ── The merge ──────────────────────────────────────────────────────

test("demand › the same course demanded by three sections is scheduled ONCE", () => {
  // BUG THIS CATCHES: 69 programs, 197 duplicate cells, 787 SH double-scheduled.
  // Bioengineering names GE 1501 in three sections and got three 4 SH cells.
  const { cells, notes } = cellsOf([
    SECTION("A", 1, XOM(2, C("GE", "1501"))),
    SECTION("B", 1, XOM(1, C("GE", "1501"))),
    SECTION("C", 1, XOM(1, C("GE", "1501"))),
  ]);
  const ge = cells.filter(c => c.groups?.[0]?.[0] === "GE1501");
  assert.equal(ge.length, 1, "GE 1501 emitted more than once");
  assert.equal(ge[0].sh, 4);
  assert.deepEqual(ge[0].alsoAnswers, [1, 2]);
  assert.equal(notes.filter(n => n.kind === "merged-duplicate").length, 2);
});

test("demand › CHOICE cells do NOT merge — two sections need two courses", () => {
  // Two sections each asking for one of {A, B} need two DISTINCT courses; merging
  // would satisfy both requirements with one.
  const { cells } = cellsOf([
    SECTION("A", 1, OR(C("CS", "4300"), C("CS", "4100"))),
    SECTION("B", 1, OR(C("CS", "4300"), C("CS", "4100"))),
  ]);
  assert.equal(cells.filter(c => c.kind === "choice").length, 2);
});

test("demand › a repeatable course is not merged away", () => {
  const out = deriveCells(prog([
    SECTION("A", 1, C("SEM", "1000")),
    SECTION("B", 1, C("SEM", "1000")),
  ]), { courseMap: CM, repeatable: (id) => id === "SEM1000" });
  assert.equal(out.cells.filter(c => c.groups?.[0]?.[0] === "SEM1000").length, 2);
});

// ── shared sections ────────────────────────────────────────────────

test("demand › a `shared` section whose course another section forces emits NO cells", () => {
  const { cells, notes } = cellsOf([
    SECTION("Core", 1, C("CS", "1800")),
    { ...SECTION("GPA re-list", 1, C("CS", "1800")), shared: true },
  ]);
  assert.equal(cells.filter(c => c.target === 1).length, 0);
  assert.equal(notes.filter(n => n.kind === "shared-section-skipped").length, 1);
});

// A `shared` section nothing else covers is a DELETED requirement, not a
// de-duplicated one — Mathematics and Physics BS never scheduled the MATH 4545 and
// PHYS 3601 its integrative requirement demands. The plan of study is what tells a
// real cross-count from the "pick one" workaround that rides on the same flag.
const withPlan = (...planOfStudyCourses) => ({ metadata: { planOfStudyCourses } });

test("demand › a `shared` section nothing else forces emits its witnessed courses", () => {
  const { cells, notes } = cellsOf([
    SECTION("Core", 1, C("CS", "1800")),
    { ...SECTION("Integrative", 2, C("CS", "4300"), C("CS", "4100")), shared: true },
  ], withPlan("CS4300", "CS4100"));
  assert.deepEqual(groups(cells.filter(c => c.target === 1)), [[["CS4300"]], [["CS4100"]]]);
  const note = notes.find(n => n.kind === "shared-section-witnessed");
  assert.deepEqual(note.courses, ["CS4300", "CS4100"]);
  assert.equal(notes.filter(n => n.kind === "shared-section-skipped").length, 0);
});

test("demand › an alternative TRACK the plan never takes stays skipped", () => {
  // The other population on the flag: "Taxation Track" against "Audit Track", or 34
  // programs' "Thesis Option". Same shape as the integrative case above — a full
  // conjunction of plain courses — so only the witness separates them.
  const { cells, notes } = cellsOf([
    SECTION("Audit Track", 1, C("CS", "3000")),
    { ...SECTION("Taxation Track", 2, C("CS", "4300"), C("CS", "4100")), shared: true },
  ], withPlan("CS3000"));
  assert.equal(cells.filter(c => c.target === 1).length, 0);
  assert.equal(notes.filter(n => n.kind === "shared-section-skipped").length, 1);
});

test("demand › no published plan means no change at all", () => {
  const { cells, notes } = cellsOf([
    { ...SECTION("Integrative", 1, C("CS", "4300")), shared: true },
  ]);
  assert.equal(cells.filter(c => c.target === 0).length, 0);
  assert.equal(notes.filter(n => n.kind === "shared-section-skipped").length, 1);
});

test("demand › a witnessed course inside an OR is an OPTION, never forced", () => {
  // CS and Health Science's `Capstone` is `OR(CS 4530, CS 4535)` and the plan of study
  // names BOTH. Emitting them would turn the department's example into the requirement.
  const { cells, notes } = cellsOf([
    { ...SECTION("Capstone", 1, OR(C("CS", "4300"), C("CS", "4100"))), shared: true },
  ], withPlan("CS4300", "CS4100"));
  assert.equal(cells.filter(c => c.target === 0).length, 0);
  assert.equal(notes.filter(n => n.kind === "shared-section-skipped").length, 1);
});

test("demand › a `choose N of M` shared section emits nothing, however well witnessed", () => {
  const { cells } = cellsOf([
    { ...SECTION("Pick two", 2, C("CS", "4300"), C("CS", "4100"), C("CS", "3000")),
      shared: true },
  ], withPlan("CS4300", "CS4100", "CS3000"));
  assert.equal(cells.filter(c => c.target === 0).length, 0);
});

test("demand › a witnessed co-requisite AND emits ONE cell carrying both courses", () => {
  const { cells } = cellsOf([
    { ...SECTION("CS Introductory", 1, AND(C("CS", "2000"), C("CS", "2001"))), shared: true },
  ], withPlan("CS2000", "CS2001"));
  const got = cells.filter(c => c.target === 0);
  assert.deepEqual(groups(got), [[["CS2000", "CS2001"]]]);
  assert.equal(got[0].sh, 5);            // 4 + a 1 SH lab, as the catalog prints it
});

test("demand › half a witnessed pair withdraws the whole pair", () => {
  const { cells } = cellsOf([
    { ...SECTION("CS Introductory", 1, AND(C("CS", "2000"), C("CS", "2001"))), shared: true },
  ], withPlan("CS2000"));
  assert.equal(cells.filter(c => c.target === 0).length, 0);
});

test("demand › emitting a shared section does NOT move the degree total", () => {
  // The credit comes out of the free-elective residual, so a named integrative course
  // replaces a placeholder rather than lengthening the degree.
  const sections = [
    SECTION("Core", 1, C("CS", "1800")),
    { ...SECTION("Integrative", 1, C("CS", "4300")), shared: true },
  ];
  const before = cellsSH(cellsOf(sections).cells);
  const after = cellsOf(sections, withPlan("CS4300"));
  assert.equal(cellsSH(after.cells), before);
  assert.equal(before, 100);             // the fixture's totalCreditsRequired
  // ...and the credit came out of the general-elective bucket specifically.
  const ge = (r) => cellsSH(r.filter(c => c.target === GENERAL_ELECTIVE));
  assert.equal(ge(after.cells), ge(cellsOf(sections).cells) - 4);
});

test("demand › a malformed shared section degrades to the skip, never throws", () => {
  for (const bad of [
    { ...SECTION("x", 1, null), shared: true },
    { ...SECTION("x", 1, { type: "COURSE" }), shared: true },
    { ...SECTION("x", 1, { type: "AND", courses: [] }), shared: true },
    { ...SECTION("x", 1, { type: "AND", courses: [{ type: "RANGE" }] }), shared: true },
    { ...SECTION("x", null, C("CS", "4300")), shared: true },
    { shared: true, type: "SECTION", title: "x" },
  ]) {
    assert.doesNotThrow(() => cellsOf([bad], withPlan("CS4300")));
  }
});

// ── Labelling ──────────────────────────────────────────────────────

test("demand › a cell is labelled by the narrowest titled node", () => {
  const { cells } = cellsOf([
    SECTION("Broad", 1, { ...SECTION("Narrow", 1, C("CS", "1800")) }),
  ]);
  assert.deepEqual(titles(cells.filter(c => c.target === 0)), ["Narrow"]);
});

test("demand › an untitled section falls back to a spec-derived label, never blank", () => {
  // A blank title cannot be matched: `resolveRequirement` refuses it, because a
  // blank matching a blank adopts an arbitrary requirement.
  const { cells } = cellsOf([SECTION("", 1, XOM(4, RANGE("MATH", 3001, 4999)))]);
  const cell = cells.find(c => typeof c.target === "number");
  assert.ok(cell.title.trim(), "emitted a cell with no title");
  assert.equal(cell.title, "MATH 3001–4999");
});

test("demand › every cell in every shape has a non-empty title", () => {
  const shapes = [
    [SECTION("", 1, C("CS", "1800"))],
    [SECTION("", 1, OR(C("CS", "4300"), C("CS", "4100")))],
    [SECTION("", 2, C("CS", "1800"), C("CS", "2800"), C("CS", "3000"))],
    [SECTION("", 1, XOM(8, C("CS", "1800"), C("CS", "2800")))],
    [{ type: "SECTION", requirements: [C("CS", "1800")] }],
  ];
  for (const s of shapes) {
    for (const c of cellsOf(s).cells) {
      assert.ok(String(c.title).trim(), `blank title in ${JSON.stringify(s).slice(0, 60)}`);
    }
  }
});

// ── The two sentinels ──────────────────────────────────────────────

test("demand › general electives absorb the residual, so the plan reaches the degree", () => {
  const { cells } = cellsOf([SECTION("Core", 1, C("CS", "1800"))]);   // 4 of 100 SH
  assert.equal(cellsSH(cells), 100);
  assert.equal(cells.filter(c => c.target === GENERAL_ELECTIVE).length, 24);
});

test("demand › a STATED elective allowance is never reduced, only raised", () => {
  // BUG THIS CATCHES: trusting a stated value blindly left 17 of 113 plans adrift
  // and one 23 credits short of its own degree.
  const small = cellsOf([SECTION("Core", 1, C("CS", "1800"))], { generalElectiveSH: 8 });
  assert.equal(cellsSH(small.cells), 100, "the plan must still add up to the degree");
  assert.ok(small.notes.some(n => n.kind === "general-elective-disagreement"));

  const large = cellsOf([SECTION("Core", 1, C("CS", "1800"))], { generalElectiveSH: 96 });
  assert.equal(cellsSH(large.cells), 100);
});

test("demand › a general-elective cell admits ANY course (null, not an empty spec)", () => {
  const { cells } = cellsOf([SECTION("Core", 1, C("CS", "1800"))]);
  const ge = cells.find(c => c.target === GENERAL_ELECTIVE);
  assert.equal(ge.spec, null, "an empty spec means 'names nothing', the opposite");
  assert.equal(ge.groups, null);
});

test("demand › a required concentration reserves credit without choosing one", () => {
  const { cells } = deriveCells({
    totalCreditsRequired: 100,
    requirementSections: [SECTION("Core", 1, C("CS", "1800"))],
    concentrations: {
      minOptions: 1,
      concentrationOptions: [
        SECTION("Systems", 2, C("CS", "3000"), C("CS", "4300")),
        SECTION("Theory", 2, C("CS", "2800"), C("CS", "4100")),
      ],
    },
  }, { courseMap: CM });
  const conc = cells.filter(c => c.target === CONCENTRATION);
  assert.equal(conc.length, 2, "the minimum over the options, not one of them");

  // The UNION of every option, not null and not one option's courses.
  //
  // Null read as "admits anything", so the cell sorted as filler and was placed
  // last — measured median position 0.89 through the plan. A concentration is major
  // depth; 51 programs require one and CS BSCS spends 16 credits on it.
  //
  // The union is not a guess about which concentration the student will pick. It is
  // exactly what can answer the cell BEFORE they pick, which is what a candidate set
  // means everywhere else in the engine.
  assert.deepEqual([...conc[0].spec.keys].sort(), ["CS2800", "CS3000", "CS4100", "CS4300"]);
  assert.equal(conc[0].groups, null, "still not a choice the engine makes");
});

test("demand › a concentration with nothing enumerable stays unbounded", () => {
  const { cells } = deriveCells({
    totalCreditsRequired: 100,
    requirementSections: [SECTION("Core", 1, C("CS", "1800"))],
    concentrations: { minOptions: 1, concentrationOptions: [SECTION("Empty", 1)] },
  }, { courseMap: CM });
  for (const c of cells.filter(x => x.target === CONCENTRATION)) {
    assert.equal(c.spec, null, "unbounded is honest when the options name nothing");
  }
});

// ── Reconciliation, reported and not silently absorbed ─────────────

test("demand › a co-requisite pair no longer splits the two accountings", () => {
  // This used to be the canonical DISAGREEMENT: a pair really is 5 SH, and
  // `demandOf` answered 4 — one course at the section's modal credit — so CHART
  // measured the section structurally and the residual against a smaller number.
  // That is what left Industrial Engineering eight credits short of its own
  // degree. `demandOf` now sums the courses, so the two agree and there is
  // nothing to report.
  const { reconciliation } = cellsOf([
    SECTION("Core", 2, AND(C("CS", "1800"), C("CS", "1802")), C("CS", "2800")),
  ]);
  assert.deepEqual(reconciliation, [],
    "9 SH of courses, 9 SH demanded — the coreq is not a disagreement any more");
});

test("demand › a structural/arithmetic disagreement is still REPORTED", () => {
  // The mechanism has to survive the fix above, so here is a shape that genuinely
  // cannot reconcile: a 3 SH threshold over a subject window. The pool demands 3,
  // and CHART can only emit whole courses, so the cell it builds is worth more
  // than the requirement asks for. 838 sections across 454 programs still land
  // here — overwhelmingly prose sections that name no course at all.
  const { reconciliation } = cellsOf([SECTION("Odd", 1, XOM(3, RANGE("MATH", 3001, 4999)))]);
  assert.equal(reconciliation.length, 1);
  assert.equal(reconciliation[0].demandSH, 3);
  assert.notEqual(reconciliation[0].delta, 0);
});

test("demand › an indivisible remainder is recorded, not hidden", () => {
  const { notes } = cellsOf([SECTION("Odd", 1, XOM(3, RANGE("MATH", 3001, 4999)))]);
  assert.ok(notes.some(n => n.kind === "indivisible-pool"));
});

// ── Determinism and identity ───────────────────────────────────────

test("demand › ids are deterministic and unique", () => {
  const shape = [
    SECTION("A", 2, C("CS", "1800"), AND(C("CS", "2000"), C("CS", "2001"))),
    SECTION("B", 1, XOM(8, RANGE("MATH", 3001, 4999))),
  ];
  const a = cellsOf(shape).cells;
  const b = cellsOf(shape).cells;
  assert.deepEqual(a.map(c => c.id), b.map(c => c.id));
  assert.equal(new Set(a.map(c => c.id)).size, a.length, "duplicate cell id");
});

// ── Malformed input ────────────────────────────────────────────────

test("demand › malformed programs degrade instead of throwing", () => {
  const bad = [
    null, undefined, {}, { requirementSections: null }, { requirementSections: [] },
    { requirementSections: [null] },
    { requirementSections: [{ type: "SECTION" }] },
    { requirementSections: [{ type: "SECTION", requirements: null }] },
    { requirementSections: [{ type: "SECTION", requirements: [null, undefined, 42, "x"] }] },
    { requirementSections: [{ type: "MYSTERY", requirements: [C("CS", "1800")] }] },
    { requirementSections: [SECTION("A", 0)] },
    { requirementSections: [SECTION("A", -5, C("CS", "1800"))] },
    { requirementSections: [SECTION("A", 99, C("CS", "1800"))] },
    { requirementSections: [OR()] },
    { requirementSections: [XOM(0)] },
    { requirementSections: [XOM(NaN, C("CS", "1800"))] },
    { requirementSections: [SECTION("A", 1, C("GONE", "9999"))] },
    { totalCreditsRequired: -100, requirementSections: [SECTION("A", 1, C("CS", "1800"))] },
    { totalCreditsRequired: "lots", requirementSections: [SECTION("A", 1, C("CS", "1800"))] },
  ];
  for (const p of bad) {
    assert.doesNotThrow(() => {
      const out = deriveCells(p, { courseMap: CM });
      assert.ok(Array.isArray(out.cells));
      for (const c of out.cells) {
        assert.ok(Number.isFinite(c.sh) && c.sh >= 0, `bad sh in ${String(JSON.stringify(p)).slice(0, 50)}`);
        assert.ok(String(c.title).length, `blank title in ${String(JSON.stringify(p)).slice(0, 50)}`);
      }
    }, String(JSON.stringify(p)).slice(0, 80));
  }
});

test("demand › a deeply nested section does not blow the stack", () => {
  let node = SECTION("leaf", 1, C("CS", "1800"));
  for (let i = 0; i < 200; i++) node = SECTION(`d${i}`, 1, node);
  assert.doesNotThrow(() => cellsOf([node]));
});

test("demand › an unreadable node type is noted rather than dropped in silence", () => {
  const { notes } = cellsOf([{ type: "SECTION", title: "X", minRequirementCount: 1,
                               requirements: [{ type: "WAT" }] }]);
  assert.ok(notes.some(n => n.kind === "unreadable-node"));
});

test("specLabel › names a range, a key, or nothing", () => {
  assert.equal(specLabel({ keys: new Set(), ranges: [{ subject: "MATH", start: 1, end: 9 }] }), "MATH 1–9");
  assert.equal(specLabel({ keys: new Set(["CS1800"]), ranges: [] }), "CS1800 or similar");
  assert.equal(specLabel({ keys: new Set(), ranges: [] }), "");
  assert.equal(specLabel(null), "");
});
