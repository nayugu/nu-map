// UNIT · CHART must not schedule a work term as a class.
//
// The defect, verbatim from the generated International Business plan:
//
//   Year 2 Spring   Co-op
//   Year 3 Fall     INTB 3205 | BUSN 4945 or COOP 3945 or COOP 3946 (+4) | …
//   Year 3 Spring   Co-op
//   Year 4 Fall     INTB 4202 | COOP 3948 | Concentration | General Elective
//
// Four co-op terms, and the registrations booked as lectures beside them.
// `deriveCells` reads requirement trees and `COOP 3948` is a COURSE node like
// any other, so it emitted a cell and the search dutifully placed it.
//
// These tests attack the two rules that fix it, and one of them exists because
// the first implementation got it wrong: a ranked assignment proposed that a
// co-op register `BUSN 4945`, an 8 SH classroom practicum, because its kind
// filter defaulted unstamped courses to "coop".
import { test } from "node:test";
import assert from "node:assert/strict";
import { withdrawWorkTermCells, assignRegistrations } from "../../src/engine/demand.js";

/** A catalog where the COOP/EEBA keys carry the registration stamp and BUSN does not. */
const MAP = {
  COOP3945: { id: "COOP3945", sh: 0, coop: { abroad: false, halfTime: false, kind: "coop" } },
  COOP3946: { id: "COOP3946", sh: 0, coop: { abroad: false, halfTime: true,  kind: "coop" } },
  COOP3947: { id: "COOP3947", sh: 0, coop: { abroad: true,  halfTime: true,  kind: "coop" } },
  COOP3948: { id: "COOP3948", sh: 0, coop: { abroad: true,  halfTime: false, kind: "coop" } },
  COOP3949: { id: "COOP3949", sh: 0, coop: { abroad: false, halfTime: false, kind: "intern" } },
  EEBA2945: { id: "EEBA2945", sh: 0, coop: { abroad: false, halfTime: false, kind: "intern" } },
  BUSN4945: { id: "BUSN4945", sh: 8 },          // In-the-Field Practicum — a real class
  INTB3205: { id: "INTB3205", sh: 4 },
};
const cell = (id, title, groups, sh = 0) => ({ id, title, groups, sh });

// ── withdrawal ──────────────────────────────────────────────────────

test("a cell whose every option is a registration is withdrawn, co-op or not", () => {
  const cells = [cell("a", "International Experiential", [["COOP3948"]])];
  for (const hasCoop of [true, false]) {
    const r = withdrawWorkTermCells(cells, MAP, hasCoop);
    assert.equal(r.cells.length, 0, `kept the cell with hasCoop=${hasCoop}`);
    assert.equal(r.withdrawn[0].why, "every-option-is-a-registration");
  }
});

test("a MIXED cell is withdrawn only when the plan puts the student on co-op", () => {
  // International Business's Business Experiential: an 8 SH practicum or a co-op.
  const cells = [cell("b", "Business Experiential",
    [["BUSN4945"], ["COOP3945"], ["COOP3946"], ["COOP3947"], ["COOP3948"], ["EEBA2945"]])];

  const withCoop = withdrawWorkTermCells(cells, MAP, true);
  assert.equal(withCoop.cells.length, 0);
  assert.equal(withCoop.withdrawn[0].why, "satisfied-by-the-plans-coop");

  // No co-op in the shape: the class route is the only reading left, so the
  // cell stays and CHART schedules it exactly as before.
  const without = withdrawWorkTermCells(cells, MAP, false);
  assert.equal(without.cells.length, 1);
  assert.equal(without.withdrawn.length, 0);
});

test("ordinary cells are untouched, and a cell with no options passes through", () => {
  const cells = [cell("c", "Core", [["INTB3205"]], 4), cell("d", "General Elective", [], 4)];
  const r = withdrawWorkTermCells(cells, MAP, true);
  assert.equal(r.cells.length, 2);
  assert.equal(r.withdrawn.length, 0);
});

test("WITHDRAWAL MOVES NO CREDIT — the claim the whole fix rests on", () => {
  // These cells are charged their CHEAPEST option, which is 0 SH because the
  // co-ops are. If a withdrawn cell ever carried credit, the general electives
  // would shrink to compensate and the plan would graduate the student short —
  // the exact failure demand.js's cheapest-option rule was written to prevent.
  const cells = [
    cell("a", "International Experiential", [["COOP3948"]], 0),
    cell("b", "Business Experiential", [["BUSN4945"], ["COOP3945"]], 0),
    cell("c", "Core", [["INTB3205"]], 4),
  ];
  const r = withdrawWorkTermCells(cells, MAP, true);
  assert.equal(r.withdrawn.reduce((n, w) => n + w.sh, 0), 0);
  // …and the survivors still carry everything they did.
  assert.equal(r.cells.reduce((n, c) => n + c.sh, 0), 4);
});

test("an empty or malformed cell list does not throw", () => {
  assert.deepEqual(withdrawWorkTermCells([], MAP, true).cells, []);
  assert.deepEqual(withdrawWorkTermCells(undefined, MAP, true).cells, []);
  assert.deepEqual(withdrawWorkTermCells([{ id: "x" }], MAP, true).cells, [{ id: "x" }]);
});

// ── the registration, where the requirement forces one ──────────────

const req = (id, title, keys) => ({ id, title, keys });

test("a requirement with ONE legal option names it", () => {
  const out = assignRegistrations([req("a", "International Experiential", ["COOP3948"])], 2, MAP);
  assert.deepEqual(out.map(x => [x.runIndex, x.key]), [[0, "COOP3948"]]);
});

test("a requirement with a CHOICE names nothing", () => {
  // Four co-op options differing by abroad and half-time. Picking one is CHART
  // deciding whether the student spends a term in another country.
  const out = assignRegistrations(
    [req("b", "Business Experiential", ["COOP3945", "COOP3946", "COOP3947", "COOP3948"])], 2, MAP);
  assert.deepEqual(out, []);
});

test("THE REGRESSION: a classroom course is never proposed as a registration", () => {
  // BUSN 4945 is 8 SH and carries no `coop` stamp. The first implementation
  // defaulted an unstamped course's kind to "coop" and proposed exactly this.
  const out = assignRegistrations([req("b", "Business Experiential", ["BUSN4945"])], 2, MAP);
  assert.deepEqual(out, [], "an 8 SH practicum was proposed as a co-op registration");
});

test("a mixed requirement reduces to its ONE co-op option and names it", () => {
  // Filtering to stamped co-op courses can turn a choice into a forced pick —
  // and that is legitimate: the others are not co-op registrations at all.
  const out = assignRegistrations(
    [req("b", "Practicum or co-op", ["BUSN4945", "COOP3945", "EEBA2945"])], 1, MAP);
  assert.deepEqual(out.map(x => x.key), ["COOP3945"]);
});

test("an internship registration is never proposed for a co-op run", () => {
  const out = assignRegistrations([req("i", "Experience", ["EEBA2945"])], 2, MAP, "coop");
  assert.deepEqual(out, []);
  // …and asking for the internship family finds it.
  assert.deepEqual(assignRegistrations([req("i", "Experience", ["EEBA2945"])], 2, MAP, "intern")
    .map(x => x.key), ["EEBA2945"]);
});

test("no run, no registration", () => {
  assert.deepEqual(assignRegistrations([req("a", "X", ["COOP3948"])], 0, MAP), []);
  assert.deepEqual(assignRegistrations([req("a", "X", ["COOP3948"])], -1, MAP), []);
});

test("more forced requirements than co-ops: the extras go unnamed, not doubled up", () => {
  const out = assignRegistrations([
    req("a", "Alpha", ["COOP3945"]),
    req("b", "Beta",  ["COOP3948"]),
    req("c", "Gamma", ["COOP3946"]),
  ], 2, MAP);
  assert.equal(out.length, 2);
  assert.equal(new Set(out.map(x => x.runIndex)).size, 2, "two requirements landed on one run");
});

test("the same key is never given to two runs", () => {
  // allocateSections consumes each course key ONCE against a global used set,
  // so two co-ops both registering COOP 3945 satisfy one section, not two.
  // Naming it twice would look like progress and audit as none.
  const out = assignRegistrations([
    req("a", "Alpha", ["COOP3945"]),
    req("b", "Beta",  ["COOP3945"]),
  ], 2, MAP);
  assert.equal(out.length, 1);
});

test("output is deterministic regardless of requirement order", () => {
  // Same program, same plan, every time — a generated plan that reshuffles
  // between runs cannot be diffed or trusted.
  const a = req("a", "Alpha", ["COOP3945"]);
  const b = req("b", "Beta",  ["COOP3948"]);
  assert.deepEqual(assignRegistrations([a, b], 2, MAP), assignRegistrations([b, a], 2, MAP));
});

test("unknown course keys are ignored rather than proposed", () => {
  // A renamed or discontinued course. Proposing a key the catalog cannot
  // resolve would put an unresolvable id on the student's block.
  assert.deepEqual(assignRegistrations([req("a", "X", ["COOP9999"])], 1, MAP), []);
  assert.deepEqual(assignRegistrations([req("a", "X", [])], 1, MAP), []);
  assert.deepEqual(assignRegistrations(undefined, 1, MAP), []);
});
