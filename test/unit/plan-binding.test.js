// UNIT · which requirement an unnamed plan cell stands for.
//
// The case that defines the module is Computer Science and Mathematics, BS: the
// plan writes "Computing and social issues" and the requirement tables title
// that very requirement "Supporting Course". No reading of the words connects
// them. It is identified because the Khoury, Mathematics and general-elective
// requirements fill up with cells that DO name them, leaving Supporting Course
// as the only thing it can be.
//
// So the properties under test are: wording never decides, a hint that
// contradicts the arithmetic is dropped rather than obeyed, and a cell is only
// called forced when every optimal assignment agrees.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  obligationsOf, bindCells, specAdmitsSubject, assertShallowPools,
  GENERAL_ELECTIVE, CONCENTRATION,
} from "../../scripts/lib/plan-binding.js";

const COURSE = (subject, classId) => ({ type: "COURSE", subject, classId });
const RANGE = (subject, a, b) => ({ type: "RANGE", subject, idRangeStart: a, idRangeEnd: b, exceptions: [] });
const XOM = (numCreditsMin, ...courses) => ({ type: "XOM", numCreditsMin, courses });
const OR = (...courses) => ({ type: "OR", courses });
const SECTION = (title, requirements, min) => ({
  type: "SECTION", title, requirements, minRequirementCount: min ?? requirements.length,
});

/**
 * Cut to the real shape of Computer Science and Mathematics, BS.
 *
 * The total is 60 rather than the degree's real 132 because the CUT keeps only
 * four of its sections: 32 SH of requirements plus 28 SH of free electives is
 * 60, and this fixture has to be arithmetically self-consistent now that the
 * free-elective allowance is the RESIDUAL everywhere (see
 * core/requirementBinding.generalElectiveAllowance).
 *
 * It was 132 with `generalElectiveSH: 28`, which only worked because the stated
 * figure was taken at face value — the fixture was quietly 100 SH short of its
 * own total, and "the credit closes" below closed on a number nothing derived.
 * Stated and residual now agree here, so these tests hold under either rule;
 * that the residual WINS where they disagree is pinned in
 * test/unit/engine-stated-cells.test.js instead.
 */
const PROGRAM = {
  totalCreditsRequired: 60,
  generalElectiveSH: 28,
  requirementSections: [
    SECTION("Computer Science Required Courses", [COURSE("CS", 3000), COURSE("CS", 3800)]),
    SECTION("Khoury Approved Electives", [
      XOM(8, RANGE("CS", 2500, 9999), RANGE("CY", 2000, 9999), COURSE("MKTG", 4606))], 1),
    SECTION("Mathematics Electives", [XOM(12, RANGE("MATH", 3001, 4999))], 1),
    SECTION("Supporting Course", [
      OR(COURSE("AFCS", 2600), COURSE("HIST", 2220), COURSE("PHIL", 1145), COURSE("SOCL", 1280))], 1),
  ],
};

const courseMap = Object.fromEntries(
  ["CS3000", "CS3800", "CS4500", "MATH3081", "MATH3175", "AFCS2600", "HIST2220", "PHIL1145", "SOCL1280"]
    .map(id => [id, { id, subject: id.replace(/\d.*$/, ""), number: id.replace(/^\D+/, ""), sh: 4 }]));

const PLACED = new Set(["CS3000", "CS3800"]);
const cell = (text, sh = 4) => ({ text, sh, options: [] });

// The 13 unnamed cells the real plan contains, in plan order.
const CELLS = [
  cell("Khoury Elective"), cell("Khoury Elective"),
  cell("MATH elective"), cell("MATH elective"), cell("Math elective"),
  cell("Computing and social issues"),
  ...Array.from({ length: 7 }, () => cell("General Elective")),
];

// ── Evidence, as the scraper supplies it ───────────────────────────

const SUBJECTS = new Set(["CS", "CY", "MATH", "MKTG", "AFCS", "HIST", "PHIL", "SOCL"]);
const FREE = /^(?:(?:general|open|free|upper[\s-]*division)?\s*electives?)\s*(?:\([^)]*\))?$/i;
const STOP = new Set(["course", "courses", "elective", "electives", "requirement",
  "requirements", "and", "or", "of", "the", "in", "approved", "required", "any"]);
const toks = s => new Set(String(s ?? "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(w => w && !STOP.has(w)));
const subjectOf = (label) => {
  const m = /^([A-Za-z]{2,6})\b/.exec(String(label).trim());
  return m && SUBJECTS.has(m[1].toUpperCase()) ? m[1].toUpperCase() : null;
};

/** Checkable facts — these remove edges outright. */
const admits = (c, o) => {
  if (FREE.test(c.text.trim())) return o.target === GENERAL_ELECTIVE;
  const s = subjectOf(c.text);
  if (s && o.spec) return specAdmitsSubject(o.spec, s);
  return true;
};
/** Wording — obeyed only when it costs the assignment nothing. */
const prefers = (c, o) => {
  const a = toks(c.text), b = toks(o.title);
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared > 0 && shared >= Math.min(a.size, b.size) * 0.5;
};

const bind = (cells = CELLS, program = PROGRAM, placedSet = PLACED) => {
  const obs = obligationsOf(program, { placedSet, courseMap });
  return { obs, res: bindCells(cells, obs, { admits, prefers }) };
};
const titleOf = (obs, target) =>
  typeof target === "number" ? obs.find(o => o.target === target).title : target;

// ── Obligations ────────────────────────────────────────────────────

test("obligations · a requirement the plan already names is not outstanding", () => {
  const { obs } = bind();
  assert.ok(!obs.some(o => o.title === "Computer Science Required Courses"),
    "CS 3000 and CS 3800 are placed");
});

test("obligations · shortfall comes from the audit, in credit hours", () => {
  const { obs } = bind();
  const by = Object.fromEntries(obs.map(o => [o.title || o.target, o.shortfallSH]));
  assert.equal(by["Khoury Approved Electives"], 8);
  assert.equal(by["Mathematics Electives"], 12);
  assert.equal(by["Supporting Course"], 4);
  assert.equal(by[GENERAL_ELECTIVE], 28);
});

test("obligations · a partly-satisfied pool reports only the remainder", () => {
  const { obs } = bind(CELLS, PROGRAM, new Set([...PLACED, "MATH3081"]));
  assert.equal(obs.find(o => o.title === "Mathematics Electives").shortfallSH, 8);
});

// ── The headline case ──────────────────────────────────────────────

test("binding · a cell that resembles nothing is identified by what is left", () => {
  const { obs, res } = bind();
  const i = CELLS.findIndex(c => c.text === "Computing and social issues");
  assert.equal(res[i].forced, true);
  assert.deepEqual(res[i].targets.map(t => titleOf(obs, t)), ["Supporting Course"],
    "nothing about the phrase was recognised — it is the only thing left");
});

test("binding · the cells with usable wording take their own requirements", () => {
  const { obs, res } = bind();
  const of = (text) => {
    const i = CELLS.findIndex(c => c.text === text);
    return res[i].targets.map(t => titleOf(obs, t));
  };
  assert.deepEqual(of("Khoury Elective"), ["Khoury Approved Electives"]);
  // "MATH elective" and "Math elective" are one requirement written twice.
  assert.deepEqual(of("MATH elective"), ["Mathematics Electives"]);
  assert.deepEqual(of("Math elective"), ["Mathematics Electives"]);
  assert.deepEqual(of("General Elective"), [GENERAL_ELECTIVE]);
});

test("binding · every cell resolves, and the credit closes", () => {
  const { obs, res } = bind();
  assert.equal(res.filter(r => r.forced).length, CELLS.length, "all 13 forced");
  assert.equal(obs.reduce((n, o) => n + o.shortfallSH, 0),
    CELLS.reduce((n, c) => n + c.sh, 0), "52 SH of cells against 52 SH of requirement");
});

// ── The properties that make this safe ─────────────────────────────

test("solver · order does not change the answer", () => {
  const forward = bind(CELLS);
  const reversed = bind([...CELLS].reverse());
  const norm = ({ obs, res }, cells) => cells
    .map((c, i) => `${c.text}=${res[i].targets.map(t => titleOf(obs, t)).join(",")}`).sort();
  assert.deepEqual(norm(forward, CELLS), norm(reversed, [...CELLS].reverse()));
});

test("solver · a requirement is never claimed by more cells than it has room for", () => {
  // Three Khoury-worded cells against a requirement with room for two. Wording
  // cannot be obeyed for all three, so none of them is called forced.
  const cells = [cell("Khoury Elective"), cell("Khoury Elective"), cell("Khoury Elective")];
  const program = {
    totalCreditsRequired: 12,
    requirementSections: [SECTION("Khoury Approved Electives", [XOM(8, RANGE("CS", 2500, 9999))], 1)],
  };
  const { obs, res } = bind(cells, program, new Set());
  const room = obs.find(o => o.title === "Khoury Approved Electives");
  const claimed = res.filter(r => r.forced && r.targets[0] === room.target).length;
  assert.ok(claimed <= 2, `at most two cells forced onto an 8 SH requirement, got ${claimed}`);
});

test("evidence · a subject hint that no requirement can satisfy is dropped", () => {
  // A MATH-worded cell in a program with no MATH requirement. The hint selects
  // nothing, so it must not strand the cell with nowhere to go.
  const program = {
    totalCreditsRequired: 8, generalElectiveSH: 4,
    requirementSections: [SECTION("Khoury Approved Electives", [XOM(4, RANGE("CS", 2500, 9999))], 1)],
  };
  const { res } = bind([cell("MATH elective")], program, new Set());
  assert.ok(res[0].targets.length >= 1, "still resolvable");
});

test("evidence · wording that contradicts the arithmetic loses to it", () => {
  // Two cells both worded for Khoury, but Khoury has room for one and a
  // Supporting Course is outstanding. Obeying the wording for both is
  // infeasible, so the arithmetic decides and neither is falsely forced.
  const program = {
    totalCreditsRequired: 8,
    requirementSections: [
      SECTION("Khoury Approved Electives", [XOM(4, RANGE("CS", 2500, 9999))], 1),
      SECTION("Supporting Course", [OR(COURSE("PHIL", 1145), COURSE("SOCL", 1280))], 1),
    ],
  };
  const { obs, res } = bind([cell("Khoury Elective"), cell("Khoury Elective")], program, new Set());
  const all = res.flatMap(r => r.targets.map(t => titleOf(obs, t)));
  assert.ok(all.includes("Supporting Course"),
    "one cell must be able to take the requirement the wording did not name");
});

test("solver · no requirements at all is empty, not a crash", () => {
  assert.deepEqual(obligationsOf(null, { courseMap }), []);
  assert.deepEqual(bindCells([cell("Elective")], []), [{ targets: [], forced: false }]);
  assert.deepEqual(bindCells([], [{ target: 0, shortfallSH: 4, unitSH: 4 }]), []);
});

// ── The assumption the shortfall read rests on ─────────────────────

test("guard · credit pools sit at the top of a section, and it is asserted", () => {
  // Measured across all 6,185 shipped sections: none nests a credit-bearing XOM
  // deeper than an immediate child. The shallow read is therefore correct for
  // real data, and this is the tripwire for that ceasing to be true.
  assert.deepEqual(assertShallowPools(PROGRAM), []);
  const nested = {
    requirementSections: [SECTION("Deep", [OR(XOM(8, COURSE("CS", 3000)))], 1)],
  };
  assert.deepEqual(assertShallowPools(nested), ["Deep"]);
});
