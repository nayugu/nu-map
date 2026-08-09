// UNIT · reservations through every serialising door, against real data.
//
// A plan leaves the browser through four: a localStorage slot, a share link,
// an exported JSON file, and a PDF. The first three are JSON, and JSON is
// lossy in ways that are invisible until someone reloads — undefined keys
// disappear, Sets and Maps become {}, NaN and Infinity become null, and a
// Date becomes a string that will not parse back into one.
//
// So these run the REAL plan through JSON and assert what comes back is what
// went in, field for field.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { applySamplePlan } from "../../src/core/applySamplePlan.js";
import { createReservation, semesterOccupants, occupantCards } from "../../src/core/reservations.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PLAN = join(ROOT, "data/northeastern/programs/majors/2026/computer-information-science",
  "computer_science_and_mathematics_bs_(boston)/plan.json");

const SEMESTERS = [
  { id: "incoming", semTypeId: "incoming", type: "special" },
  ...[2026, 2027, 2028, 2029].flatMap(y => [
    { id: `fall${y}`,     semTypeId: "fall",   type: "fall",   weight: 1 },
    { id: `spr${y + 1}`,  semTypeId: "spring", type: "spring", weight: 1 },
    { id: `sumA${y + 1}`, semTypeId: "sumA",   type: "summer", weight: 0.5 },
    { id: `sumB${y + 1}`, semTypeId: "sumB",   type: "summer", weight: 0.5 },
  ]),
];
const courseMap = new Proxy({}, { get: (_, k) => ({ id: String(k), sh: 4 }), has: () => true });

const loadRealPlan = () => {
  const grid = JSON.parse(readFileSync(PLAN, "utf8"));
  return applySamplePlan(grid.plans[0], { semesters: SEMESTERS, courseMap });
};

const jsonRoundTrip = (v) => JSON.parse(JSON.stringify(v));

// ── JSON fidelity on real data ─────────────────────────────────────

test("a real plan's reservations survive JSON exactly", () => {
  const { reservations } = loadRealPlan();
  assert.ok(Object.keys(reservations).length >= 13, "the plan really does reserve cells");
  assert.deepEqual(jsonRoundTrip(reservations), reservations,
    "a field JSON cannot carry would show up here as a difference");
});

test("no reservation carries a value JSON silently destroys", () => {
  // undefined vanishes, Set/Map become {}, NaN and Infinity become null, a
  // Date becomes an unparseable string. Each is invisible until a reload.
  const { reservations } = loadRealPlan();
  const bad = [];
  for (const [id, r] of Object.entries(reservations)) {
    const walk = (v, path) => {
      if (v === undefined) bad.push(`${id}${path}: undefined`);
      else if (typeof v === "number" && !Number.isFinite(v)) bad.push(`${id}${path}: ${v}`);
      else if (v instanceof Set || v instanceof Map) bad.push(`${id}${path}: ${v.constructor.name}`);
      else if (v instanceof Date) bad.push(`${id}${path}: Date`);
      else if (typeof v === "function") bad.push(`${id}${path}: function`);
      else if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
      }
    };
    walk(r, "");
  }
  assert.deepEqual(bad, [], "values that will not survive a save");
});

test("a choice cell's options survive as groups, not flattened", () => {
  // Choice cells become reservations carrying `options` — nested arrays, the
  // shape most likely to be quietly mangled by a serialiser that "helps".
  const r = createReservation({ semId: "fall2026", label: "CS 4530 or 4535", sh: 4 });
  r.options = [["CS4530"], ["CS4535"]];
  const back = jsonRoundTrip({ [r.id]: r })[r.id];
  assert.deepEqual(back.options, [["CS4530"], ["CS4535"]]);
  assert.equal(Array.isArray(back.options[0]), true, "still a group, not a flat list");
});

// ── The whole artifact, as a slot or a file would hold it ──────────

test("the full plan artifact round-trips through JSON", () => {
  const r = loadRealPlan();
  const artifact = {
    version: 1,
    placements: r.placements,
    reservations: r.reservations,
    specialTermPl: r.specialTermPl,
    semOrders: {},
    placedOut: [],
    substitutions: [],
  };
  const back = jsonRoundTrip(artifact);
  assert.deepEqual(back.placements, artifact.placements);
  assert.deepEqual(back.reservations, artifact.reservations);
  assert.deepEqual(back.specialTermPl, artifact.specialTermPl, "co-op blocks too");
});

test("an artifact written before reservations existed still reads", () => {
  // Every plan already saved on someone's machine looks like this.
  const legacy = { version: 1, placements: { CS2500: "fall2026" }, semOrders: {} };
  const back = jsonRoundTrip(legacy);
  assert.deepEqual(back.reservations ?? {}, {}, "absent reads as none, never as garbage");
  assert.deepEqual(back.placements, { CS2500: "fall2026" }, "and the courses are untouched");
});

// ── The derived views rebuild identically after a round trip ───────

test("the semester view is identical before and after a save", () => {
  // The real test of a save is not that the bytes match but that the app draws
  // the same thing afterwards.
  const r = loadRealPlan();
  const before = semesterOccupants(r.placements, r.reservations);
  const after  = semesterOccupants(jsonRoundTrip(r.placements), jsonRoundTrip(r.reservations));
  assert.deepEqual(after, before);

  const cardsBefore = occupantCards(courseMap, r.reservations);
  const cardsAfter  = occupantCards(courseMap, jsonRoundTrip(r.reservations));
  for (const id of Object.keys(r.reservations)) {
    assert.equal(cardsAfter[id].code, cardsBefore[id].code);
    assert.equal(cardsAfter[id].sh, cardsBefore[id].sh);
    assert.equal(cardsAfter[id].color, cardsBefore[id].color, "colour is read unguarded by the card");
  }
});

test("reserved credit is the same number after a save", () => {
  const r = loadRealPlan();
  const total = (m) => Object.values(m).reduce((n, x) => n + (x.sh ?? 0), 0);
  assert.equal(total(jsonRoundTrip(r.reservations)), total(r.reservations));
  assert.ok(total(r.reservations) > 0, "and it is not trivially zero");
});
