// UNIT · prerequisite lines for a card that has no course yet.
//
// The motivating case, from the real catalog: a reservation reading
// "IE 3412 or MATH 3081" and a placed IE 4516 whose prerequisite is
// "IE 3412 Or MATH 3081". Both options feed it, so the connection holds however
// the student decides — and it should be drawn.
//
// The rule under test is that an edge is synthesised ONLY when choosing
// differently could not falsify it. Everything below tries to produce a line
// that a later decision would turn into a lie.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { reservationEdges } from "../../src/core/reservationEdges.js";
import { extractEdges } from "../../src/core/courseModel.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const raw = JSON.parse(readFileSync(join(ROOT, "public/northeastern/catalog-courses.json"), "utf8"));

const COURSE_MAP = {};
const ALL_EDGES = [];
for (const c of raw) {
  const id = `${c.subject}${parseInt(c.number, 10)}`;
  COURSE_MAP[id] = { id, subject: c.subject, number: String(parseInt(c.number, 10)) };
  ALL_EDGES.push(...extractEdges(id, c.prereqs, c.coreqs));
}

const res = (id, options) => ({ id, semId: "fall2026", label: "x", sh: 4, options });
const edgesFor = (reservations, opts = {}) =>
  reservationEdges(reservations, ALL_EDGES, { courseMap: COURSE_MAP, ...opts });

// ── The case from the screenshot, against real catalog data ────────

test("REAL: 'IE 3412 or MATH 3081' connects to IE 4516", () => {
  // Confirm the fixture is the real thing before relying on it.
  const ie4516 = ALL_EDGES.filter(e => e.to === "IE4516" && e.type === "prerequisite");
  const from = new Set(ie4516.map(e => e.from));
  assert.ok(from.has("IE3412"), "catalog changed: IE 4516 no longer lists IE 3412");
  assert.ok(from.has("MATH3081"), "catalog changed: IE 4516 no longer lists MATH 3081");

  const r = res("~res:a", [["IE3412"], ["MATH3081"]]);
  const got = edgesFor({ "~res:a": r });
  const hit = got.find(e => e.from === "~res:a" && e.to === "IE4516");
  assert.ok(hit, `no edge to IE4516; got ${JSON.stringify(got.slice(0, 8))}`);
  assert.equal(hit.type, "prerequisite");
  assert.equal(hit.viaReservation, true, "synthesised edges must be identifiable");
});

test("REAL: every synthesised edge is one both options genuinely share", () => {
  const r = res("~res:a", [["IE3412"], ["MATH3081"]]);
  const feeds = (id) => new Set(ALL_EDGES.filter(e => e.from === id).map(e => e.to));
  const fedBy = (id) => new Set(ALL_EDGES.filter(e => e.to === id).map(e => e.from));
  const a = feeds("IE3412"), b = feeds("MATH3081");
  const ra = fedBy("IE3412"), rb = fedBy("MATH3081");

  for (const e of edgesFor({ "~res:a": r })) {
    if (e.from === "~res:a") {
      assert.ok(a.has(e.to) && b.has(e.to), `${e.to} is not fed by BOTH options`);
    } else {
      assert.ok(ra.has(e.from) && rb.has(e.from), `${e.from} does not feed BOTH options`);
    }
  }
});

// ── The lie the strict rule exists to prevent ──────────────────────

test("an edge only one option supports is NOT drawn", () => {
  const edges = [
    { from: "AAA1000", to: "YYY9000", type: "prerequisite" },   // only option A feeds it
    { from: "BBB1000", to: "ZZZ9000", type: "prerequisite" },
  ];
  const map = { AAA1000: {}, BBB1000: {}, YYY9000: {}, ZZZ9000: {} };
  const got = reservationEdges({ "~res:a": res("~res:a", [["AAA1000"], ["BBB1000"]]) },
                               edges, { courseMap: map });
  assert.deepEqual(got, [], "drew a line that picking the other option would falsify");
});

test("the same edge becomes drawable once BOTH options support it", () => {
  const edges = [
    { from: "AAA1000", to: "YYY9000", type: "prerequisite" },
    { from: "BBB1000", to: "YYY9000", type: "prerequisite" },
  ];
  const map = { AAA1000: {}, BBB1000: {}, YYY9000: {} };
  const got = reservationEdges({ "~res:a": res("~res:a", [["AAA1000"], ["BBB1000"]]) },
                               edges, { courseMap: map });
  assert.equal(got.length, 1);
  assert.deepEqual({ from: got[0].from, to: got[0].to }, { from: "~res:a", to: "YYY9000" });
});

test("the loose rule draws it, and is not the default", () => {
  const edges = [{ from: "AAA1000", to: "YYY9000", type: "prerequisite" }];
  const map = { AAA1000: {}, BBB1000: {}, YYY9000: {} };
  const r = { "~res:a": res("~res:a", [["AAA1000"], ["BBB1000"]]) };
  assert.equal(reservationEdges(r, edges, { courseMap: map }).length, 0, "strict is not the default");
  assert.equal(reservationEdges(r, edges, { courseMap: map, requireAll: false }).length, 1);
});

// ── Groups are all-or-nothing ──────────────────────────────────────

test("a compound option contributes its members' connections together", () => {
  // "PSYC3200 or (PT5410 and PT5411)". The second option is taken whole, so a
  // connection from EITHER of its members is a connection of that option.
  const edges = [
    { from: "PSYC3200", to: "YYY9000", type: "prerequisite" },
    { from: "PT5411",   to: "YYY9000", type: "prerequisite" },
  ];
  const map = { PSYC3200: {}, PT5410: {}, PT5411: {}, YYY9000: {} };
  const got = reservationEdges({ "~res:a": res("~res:a", [["PSYC3200"], ["PT5410", "PT5411"]]) },
                               edges, { courseMap: map });
  assert.equal(got.length, 1, "a compound option's members should pool their connections");
  assert.equal(got[0].to, "YYY9000");
});

test("a group naming a course we do not have is ignored, not treated as unsatisfiable", () => {
  // If the phantom group counted, the intersection would be empty and the real
  // connection would vanish. 13.2% of prereq atoms name renumbered courses.
  const edges = [{ from: "IE3412", to: "IE4516", type: "prerequisite" }];
  const map = { IE3412: {}, IE4516: {} };
  const got = reservationEdges({ "~res:a": res("~res:a", [["IE3412"], ["GONE9999"]]) },
                               edges, { courseMap: map });
  assert.equal(got.length, 1, "a phantom option suppressed a real connection");
});

test("a card whose every option is phantom draws nothing", () => {
  const edges = [{ from: "IE3412", to: "IE4516", type: "prerequisite" }];
  const got = reservationEdges({ "~res:a": res("~res:a", [["GONE1"], ["GONE2"]]) },
                               edges, { courseMap: { IE3412: {}, IE4516: {} } });
  assert.deepEqual(got, []);
});

// ── Things that must never happen ──────────────────────────────────

test("a card never points at a course it could itself become", () => {
  // MATH3081 feeds IE4516, and IE3412 also feeds it — but if a card could BE
  // IE4516, an edge to IE4516 reads as the course being its own prerequisite.
  const edges = [
    { from: "AAA1000", to: "BBB1000", type: "prerequisite" },
    { from: "CCC1000", to: "BBB1000", type: "prerequisite" },
  ];
  const map = { AAA1000: {}, BBB1000: {}, CCC1000: {} };
  const got = reservationEdges({ "~res:a": res("~res:a", [["AAA1000"], ["BBB1000"]]) },
                               edges, { courseMap: map });
  for (const e of got) {
    assert.ok(e.to !== "BBB1000" && e.from !== "BBB1000",
      "drew an edge to a course the card could itself become");
  }
});

test("an UNNAMED card borrows nothing", () => {
  // A "Khoury Elective" could be a hundred courses; their shared connections
  // are empty in almost every case, and computing that per render costs real
  // time to draw nothing.
  const got = edgesFor({ "~res:a": { id: "~res:a", semId: "fall2026", label: "Khoury Elective" } });
  assert.deepEqual(got, []);
});

test("prerequisite and corequisite lines never cross-breed", () => {
  const edges = [
    { from: "AAA1000", to: "YYY9000", type: "prerequisite" },
    { from: "BBB1000", to: "YYY9000", type: "corequisite" },
  ];
  const map = { AAA1000: {}, BBB1000: {}, YYY9000: {} };
  const got = reservationEdges({ "~res:a": res("~res:a", [["AAA1000"], ["BBB1000"]]) },
                               edges, { courseMap: map });
  assert.deepEqual(got, [], "a prereq edge and a coreq edge were combined into one line");
});

test("an unknown edge type is ignored rather than mis-typed", () => {
  const edges = [
    { from: "AAA1000", to: "YYY9000", type: "somethingElse" },
    { from: "BBB1000", to: "YYY9000", type: "somethingElse" },
  ];
  const map = { AAA1000: {}, BBB1000: {}, YYY9000: {} };
  assert.deepEqual(reservationEdges({ "~res:a": res("~res:a", [["AAA1000"], ["BBB1000"]]) },
                                    edges, { courseMap: map }), []);
});

// ── Degenerate input ───────────────────────────────────────────────

test("degenerate input returns nothing and throws nothing", () => {
  for (const r of [null, undefined, {}, { x: null }, { x: {} }]) {
    assert.doesNotThrow(() => reservationEdges(r, ALL_EDGES, { courseMap: COURSE_MAP }));
    assert.deepEqual(reservationEdges(r, ALL_EDGES, { courseMap: COURSE_MAP }), []);
  }
  const r = { "~res:a": res("~res:a", [["IE3412"], ["MATH3081"]]) };
  for (const e of [null, undefined, [], [null], [{}], [{ from: "A" }], [{ to: "B" }]]) {
    assert.doesNotThrow(() => reservationEdges(r, e, { courseMap: COURSE_MAP }), `edges ${JSON.stringify(e)}`);
  }
  assert.doesNotThrow(() => reservationEdges(r, ALL_EDGES), "no options object at all");
  for (const options of [null, [], [[]], [null], ["nope"], [["IE3412"], null]]) {
    assert.doesNotThrow(() => edgesFor({ "~res:a": res("~res:a", options) }),
      `options ${JSON.stringify(options)}`);
  }
});

test("a single-option card borrows that course's connections wholesale", () => {
  // Degenerate but legal: the intersection over one group is that group.
  const edges = [
    { from: "AAA1000", to: "YYY9000", type: "prerequisite" },
    { from: "ZZZ1000", to: "AAA1000", type: "prerequisite" },
  ];
  const map = { AAA1000: {}, YYY9000: {}, ZZZ1000: {} };
  const got = reservationEdges({ "~res:a": res("~res:a", [["AAA1000"]]) }, edges, { courseMap: map });
  assert.equal(got.length, 2, "a one-option card should inherit both directions");
  assert.ok(got.some(e => e.from === "~res:a" && e.to === "YYY9000"));
  assert.ok(got.some(e => e.from === "ZZZ1000" && e.to === "~res:a"));
});

test("many reservations do not interfere with each other", () => {
  const edges = [
    { from: "AAA1000", to: "YYY9000", type: "prerequisite" },
    { from: "BBB1000", to: "YYY9000", type: "prerequisite" },
    { from: "CCC1000", to: "WWW9000", type: "prerequisite" },
  ];
  const map = { AAA1000: {}, BBB1000: {}, CCC1000: {}, YYY9000: {}, WWW9000: {} };
  const got = reservationEdges({
    "~res:a": res("~res:a", [["AAA1000"], ["BBB1000"]]),
    "~res:b": res("~res:b", [["CCC1000"]]),
  }, edges, { courseMap: map });
  assert.equal(got.filter(e => e.from === "~res:a").length, 1);
  assert.equal(got.filter(e => e.from === "~res:b").length, 1);
  assert.ok(!got.some(e => e.from === "~res:a" && e.to === "WWW9000"), "cards leaked into each other");
});

// ── Scale, on the whole catalog ────────────────────────────────────

test("REAL: the corpus of named cells produces edges without exploding", () => {
  // Every distinct two-option shape in one go, to check the cost is sane and
  // that nothing produces a self-edge or a duplicate.
  const reservations = {};
  const pairs = [
    ["IE3412", "MATH3081"], ["CS4300", "CS4100"], ["ECON1115", "ECON1116"],
    ["ENGW3302", "ENGW3315"], ["MATH2331", "MATH2341"],
  ];
  pairs.forEach(([a, b], i) => {
    if (COURSE_MAP[a] && COURSE_MAP[b]) reservations[`~res:${i}`] = res(`~res:${i}`, [[a], [b]]);
  });
  assert.ok(Object.keys(reservations).length >= 4, "fixtures reference courses the catalog lacks");

  const got = edgesFor(reservations);
  const seen = new Set();
  for (const e of got) {
    assert.notEqual(e.from, e.to, "a self-edge was produced");
    const key = `${e.from}|${e.to}|${e.type}`;
    assert.ok(!seen.has(key), `duplicate edge ${key}`);
    seen.add(key);
    assert.ok(String(e.from).startsWith("~res:") || String(e.to).startsWith("~res:"),
      "an edge with no reservation endpoint was synthesised");
  }
});
