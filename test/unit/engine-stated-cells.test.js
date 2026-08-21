// A requirement the catalog states only in PROSE, as CHART sees it.
//
// ME BSME's "Mechanical and Industrial Engineering Technical Elective" is 4 SH
// and two sentences, naming no course. `cellsForSection` emitted nothing for it,
// and `deriveCells` then takes general electives as the residual against the
// degree total — so the 4 SH came back as a FREE elective. The plan totalled the
// degree and told the student to put anything at all in a slot the registrar
// restricts to six subjects. Six of ME's cells read "General Elective" and one
// of them was really this.
//
// These tests attack the fix from the three directions it can go wrong: the SH
// must MOVE rather than be added (a degree does not grow), the cell must claim
// no candidate set it cannot justify, and a program whose prose sections
// over-subscribe its own degree must still be plannable.
import test from "node:test";
import assert from "node:assert/strict";
import { deriveCells, cellsSH } from "../../src/engine/demand.js";
import { GENERAL_ELECTIVE } from "../../src/core/requirementDemand.js";
import { demandOf } from "../../src/core/requirementDemand.js";
import { generalElectiveSHOf } from "../../src/core/requirementBinding.js";
import { checkSection } from "../../src/core/gradRequirements.js";

const C = (subject, classId) => ({ type: "COURSE", subject, classId });
const SECTION = (title, minRequirementCount, ...requirements) =>
  ({ type: "SECTION", title, minRequirementCount, requirements });
/** A section the catalog states in prose: credit, no course. */
const PROSE = (title, creditsRequired, notes = []) => ({
  type: "SECTION", title, requirements: [], minRequirementCount: 1,
  creditsRequired, ...(notes.length ? { notes } : {}),
});

const course = (id, sh = 4) => ({
  id, subject: id.replace(/\d.*/, ""), number: id.replace(/^\D+/, ""), sh,
});
const CM = Object.fromEntries([
  course("ME2350"), course("ME3475"), course("ME4570"), course("MATH1341"),
  // Ten DISTINCT courses. A menu built from one course repeated is not ten
  // cells — `mergeForcedCells` collapses them — so the first version of the
  // restated-credit test below measured a 4 SH program while claiming to
  // measure a 40 SH one, and failed for that reason rather than a real one.
  ...Array.from({ length: 10 }, (_, i) => course(`XX${1000 + i}`)),
].map(c => [c.id, c]));

const prog = (sections, extra = {}) => ({
  totalCreditsRequired: 100, requirementSections: sections, ...extra,
});
const cellsOf = (sections, extra = {}) => deriveCells(prog(sections, extra), { courseMap: CM });
const scheduled = (cells) => cells.filter(c => typeof c.target === "number");
const geCells = (cells) => cells.filter(c => c.target === GENERAL_ELECTIVE);

// ── The cell exists, and says only what we know ─────────────────────

test("stated › a prose-only section gets a cell titled after itself", () => {
  const { cells } = cellsOf([
    SECTION("Core", 1, C("ME", "2350")),
    PROSE("Mechanical and Industrial Engineering Technical Elective", 4),
  ]);
  const cell = scheduled(cells).find(c => c.stated);
  assert.ok(cell, "no cell was emitted for the prose-only section");
  assert.equal(cell.title, "Mechanical and Industrial Engineering Technical Elective");
  assert.equal(cell.sh, 4);
});

test("stated › the cell claims NO candidate set", () => {
  // The whole design rests on this. The catalog names six subjects and says
  // "technical elective", which is not a set we can enumerate — inventing one
  // would let ME 2350 Statics, required elsewhere in the degree, answer it.
  const { cells } = cellsOf([PROSE("Technical Elective", 4)]);
  const cell = scheduled(cells).find(c => c.stated);
  assert.equal(cell.spec, null, "a spec here would be a claim about which courses count");
  assert.equal(cell.groups, null);
  assert.equal(cell.kind, "open");
});

test("stated › the cell is aimed at the END of the plan", () => {
  // With no course named there is no prerequisite chain, no level and no floor.
  // Late is the safe end of that ignorance: a slot filled later than it needed
  // to be costs nothing, one scheduled before its unrecorded prerequisites
  // pushes the degree out.
  const { cells } = cellsOf([PROSE("Technical Elective", 4)]);
  assert.equal(scheduled(cells).find(c => c.stated).levelTarget, 1);
});

test("stated › the catalog's own sentences ride along on the cell", () => {
  const notes = ["Complete one technical elective in one of the following subject areas:",
                 "EMGT, ENGR, ENSY, IE, ME, or MEIE"];
  const { cells } = cellsOf([PROSE("Technical Elective", 4, notes)]);
  assert.deepEqual(scheduled(cells).find(c => c.stated).notes, notes);
});

test("stated › a section with no stated credit yields no cell", () => {
  // Nothing to schedule and nothing to say. The parser does not emit such a
  // section either, but a re-scrape is exactly what produces a shape nobody
  // planned for.
  const { cells } = cellsOf([{ type: "SECTION", title: "Empty", requirements: [], minRequirementCount: 1 }]);
  assert.equal(scheduled(cells).filter(c => c.stated).length, 0);
});

// ── The credit MOVES; the degree does not grow ──────────────────────

test("stated › its credit comes OUT of general electives, not on top", () => {
  const withProse = cellsOf([SECTION("Core", 1, C("ME", "2350")), PROSE("Technical Elective", 4)]);
  const without   = cellsOf([SECTION("Core", 1, C("ME", "2350"))]);

  // The label moves and the arithmetic does not: same total scheduled credit,
  // one fewer general elective, one more named cell.
  assert.equal(cellsSH(withProse.cells), cellsSH(without.cells),
    "a degree must not grow because we learned to read one of its sections");
  assert.equal(geCells(withProse.cells).length, geCells(without.cells).length - 1);
});

test("stated › a 16 SH section becomes four cells, not one", () => {
  // `demandOf` used to answer a flat 4 SH for every prose-only section, so a
  // 16 SH minor requirement was under-claimed by 12 and the free-elective
  // residual absorbed the difference.
  const { cells } = cellsOf([PROSE("Minor Requirement", 16)]);
  const stated = scheduled(cells).filter(c => c.stated);
  assert.equal(stated.length, 4);
  assert.equal(stated.reduce((n, c) => n + c.sh, 0), 16);
});

test("stated › an indivisible remainder rounds UP into label slots", () => {
  const { cells } = cellsOf([PROSE("Social Science Selectives", 7)]);
  const stated = scheduled(cells).filter(c => c.stated);
  assert.equal(stated.length, 2, "7 SH answered by 4 SH cells rounds up — over is recoverable");
});

// ── Restated credit, which is what made this a relabelling ──────────

test("stated › a section restating credit already counted gets NO label", () => {
  // Data Science MSAlign is the case that killed the additive design: a 40 SH
  // degree printing "Electives1: 12 SH" and then six sections named after
  // COLLEGES which ARE that elective's menu. The 12 SH is stated twice.
  //
  // Emitting cells for it pushed the plan past 40 SH, `poolExcess` fired, and the
  // six-college menu collapsed into one anonymous slot — the change destroyed
  // information instead of adding it. Spending from the residual makes it a
  // non-event: the residual is 0, so there is nothing to name, which is the
  // correct reading of a page that counted the same credit twice.
  let next = 1000;
  const menu = (title) => SECTION(title, 1, C("XX", String(next++)));
  const { cells, notes } = cellsOf([
    menu("Fundamentals"), menu("Algorithms"), menu("Data Management"),
    menu("Machine Learning"), menu("Presentation"),
    PROSE("Electives1", 12),
    menu("Khoury College"), menu("College of Engineering"), menu("College of Science"),
    menu("Bouvé College"), menu("College of Arts, Media and Design"),
  ], { totalCreditsRequired: 40 });

  assert.equal(scheduled(cells).filter(c => c.stated).length, 0,
    "there is no unaccounted credit for this section to name");
  assert.ok(!notes.some(n => n.kind === "pooled-excess"),
    "and nothing was shed — a label cannot over-subscribe a degree");
  assert.equal(cellsSH(cells), 40);
});

test("stated › prose credit exceeding the residual is CAPPED, never over-emitted", () => {
  // Interdisciplinary Studies BS (Oakland): a 128 SH degree printing 159 SH of
  // prose-only sections, because its focus areas are alternatives nothing in the
  // data marks as such. The cap is arithmetic, so no amount of catalog
  // double-counting can put more cells in a plan than the degree has room for.
  const { cells, notes } = cellsOf([
    SECTION("Core", 1, C("ME", "2350")),
    PROSE("Focus Area", 32), PROSE("Biology Focus Area", 32),
    PROSE("Psychology Focus Area", 32), PROSE("Restricted Electives", 24),
    PROSE("Minor Requirement", 16), PROSE("Supporting Courses", 16),
  ], { totalCreditsRequired: 128 });

  assert.equal(cellsSH(cells), 128, "the plan totals the degree, exactly");
  assert.ok(!notes.some(n => n.kind === "pooled-excess"), "nothing had to be shed");
  assert.ok(notes.some(n => n.kind === "prose-credit-restated"),
    "and the credit the page counts twice is reported, with how much");
  // Every slot the residual had is named; none beyond it.
  const stated = scheduled(cells).filter(c => c.stated);
  assert.equal(stated.reduce((n, c) => n + c.sh, 0), 124, "128 − the 4 SH core section");
  assert.equal(geCells(cells).length, 0, "so no anonymous free credit is left over");
});

test("stated › labels are taken in PAGE order", () => {
  // Deterministic and explicable: the first sections on the page get named
  // first. Nothing in the data ranks them, so the page's order is the only
  // non-arbitrary choice available.
  const { cells } = cellsOf([
    SECTION("Core", 1, C("ME", "2350")),   // 4 SH of 100
    PROSE("First", 8), PROSE("Second", 8),
  ]);
  const stated = scheduled(cells).filter(c => c.stated);
  assert.deepEqual([...new Set(stated.map(c => c.title))], ["First", "Second"]);
});

test("stated › a named elective carries no breadth competency", () => {
  // The registrar already said what this elective is FOR. Hanging a NUpath code
  // on it too would tell a student their technical elective must also be an
  // interpreting-culture course.
  const { cells } = cellsOf([SECTION("Core", 1, C("ME", "2350")), PROSE("Technical Elective", 4)],
                            { grantedAttributes: [] });
  const stated = scheduled(cells).filter(c => c.stated);
  assert.ok(stated.length > 0);
  for (const c of stated) assert.equal(c.nupath, undefined);
});

// ── The arithmetic underneath ───────────────────────────────────────

test("demandOf › a childless section demands its STATED credit", () => {
  const sec = checkSection(PROSE("Minor Requirement", 16), new Set(), {});
  assert.equal(sec.statedSH, 16);
  assert.equal(demandOf(sec, 4), 16, "not minRequired * unit, which answered 4");
});

test("demandOf › a section WITH children is untouched", () => {
  const sec = checkSection(SECTION("Core", 2, C("ME", "2350"), C("ME", "3475")), new Set(), CM);
  assert.equal(demandOf(sec, 4), 8);
  assert.equal("statedSH" in sec, false);
});

test("generalElectiveSHOf › the residual wins over the catalog's stated figure", () => {
  // 95 of 1,071 programs state `generalElectiveSH`, and the measured harm of
  // trusting it runs both ways. The panel used `stated ?? 0`, so the other 976
  // showed a General Electives section requiring 0 SH.
  const p = prog([SECTION("Core", 1, C("ME", "2350"))], { generalElectiveSH: 99 });
  assert.equal(generalElectiveSHOf(p, CM), 96, "100 total − 4 SH of sections");

  const q = prog([SECTION("Core", 1, C("ME", "2350"))]);
  assert.equal(generalElectiveSHOf(q, CM), 96, "and it does not depend on the figure existing");
});

test("generalElectiveSHOf › a prose-only section shrinks the free allowance", () => {
  const before = generalElectiveSHOf(prog([SECTION("Core", 1, C("ME", "2350"))]), CM);
  const after  = generalElectiveSHOf(
    prog([SECTION("Core", 1, C("ME", "2350")), PROSE("Technical Elective", 4)]), CM);
  assert.equal(before - after, 4, "the 4 SH is no longer free credit");
});

test("generalElectiveSHOf › never negative, however the catalog adds up", () => {
  const p = prog([PROSE("Focus Area", 32), PROSE("Biology Focus Area", 32)],
                 { totalCreditsRequired: 40 });
  assert.equal(generalElectiveSHOf(p, CM), 0);
});
