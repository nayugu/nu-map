// UNIT · the one number the requirements panel is allowed to state.
//
// Every section in that panel reads `placements`, which by design cannot see a
// reservation — so a requirement the student has reserved two cards for still
// reads "0/2", and an advisor reads that as "not planned".
//
// This is the correction, and it is deliberately the dumbest statement
// available: a count of cards and their credit hours. The sophisticated version
// (mark the sections each card is bound to) was measured at 17.7% of cards, a
// median of 2 sections out of 11 per plan, with 34 sections corpus-wide claimed
// by more cards than they hold. A count covers every card and cannot be wrong.
//
// So the only way to fail here is to state a number that is not true. These
// tests try to make it do that.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { reservedTotals, createReservation, removeReservation } from "../../src/core/reservations.js";
import { applySamplePlan } from "../../src/core/applySamplePlan.js";
import { dropOnBank, dropOnCard } from "../../src/core/planDrop.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const r = (sh, extra = {}) => ({
  ...createReservation({ semId: "fall2026", label: "Elective", sh }), ...extra,
});
const mapOf = (...list) => Object.fromEntries(list.map(x => [x.id, x]));

// ── The plain cases ────────────────────────────────────────────────

test("counts cards and sums their credit", () => {
  const got = reservedTotals(mapOf(r(4), r(4), r(2)));
  assert.deepEqual(got, { cards: 3, sh: 10 });
});

test("nothing reserved is zero, not null", () => {
  for (const input of [{}, null, undefined]) {
    assert.deepEqual(reservedTotals(input), { cards: 0, sh: 0 }, JSON.stringify(input));
  }
});

// ── A card with no credit is still a card ──────────────────────────

test("a card with no SH is counted, and contributes no credit", () => {
  // Vacation rows carry sh: 0 deliberately, and some cells never state hours.
  // Dropping such a card from the COUNT would understate what is undecided;
  // adding a guessed 4 SH would overstate the credit. Both are lies, so it
  // counts the card and stays silent about the hours.
  for (const sh of [0, null, undefined, "", NaN]) {
    const got = reservedTotals(mapOf(r(4), r(sh)));
    assert.equal(got.cards, 2, `sh=${String(sh)} was dropped from the count`);
    assert.equal(got.sh, 4, `sh=${String(sh)} contributed credit it does not have`);
  }
});

test("a negative or absurd SH never reduces the total", () => {
  // Scraped data has produced stranger things than this, and a note reading
  // "reserves 3 cards (-2 SH)" is worse than one reading "(0 SH)".
  const got = reservedTotals(mapOf(r(4), r(-8)));
  assert.equal(got.sh, 4, "a negative SH was subtracted from the total");
  assert.equal(got.cards, 2);
});

test("SH arriving as a string is still credit", () => {
  // JSON round trips and hand-edited plans both produce this.
  assert.equal(reservedTotals(mapOf(r("4"), r("2"))).sh, 6);
});

test("malformed entries are skipped, not counted or thrown on", () => {
  const map = { ...mapOf(r(4)), bad1: null, bad2: undefined, bad3: {}, bad4: { sh: 4 } };
  let got;
  assert.doesNotThrow(() => { got = reservedTotals(map); });
  assert.deepEqual(got, { cards: 1, sh: 4 }, "an entry with no id was counted");
});

// ── It must track the plan, not lag it ─────────────────────────────

test("answering a card removes it from the total", () => {
  // The note would otherwise keep claiming credit the student has now chosen.
  const card = r(4);
  const state = {
    placements: { CS3000: "fall2026" },
    reservations: mapOf(card),
    semOrders: { fall2026: ["CS3000", card.id] },
  };
  const ctx = {
    gridPlacements: { CS3000: "fall2026", [card.id]: "fall2026" },
    gridCourseMap: { CS3000: { id: "CS3000", sh: 4 }, [card.id]: { id: card.id, sh: 4 } },
  };
  assert.equal(reservedTotals(state.reservations).cards, 1);

  const filled = dropOnCard(state, { dragId: "NEW1", targetId: card.id, targetSemId: "fall2026" }, ctx);
  assert.ok(filled, "the fill gesture was refused");
  assert.deepEqual(reservedTotals(filled.reservations), { cards: 0, sh: 0 },
    "an answered card is still being counted as undecided");
});

test("deleting a card removes it from the total", () => {
  const card = r(4);
  const state = { placements: {}, reservations: mapOf(card), semOrders: {} };
  const next = dropOnBank(state, { dragId: card.id });
  assert.deepEqual(reservedTotals(next.reservations), { cards: 0, sh: 0 });
  // and directly
  assert.deepEqual(reservedTotals(removeReservation(state.reservations, card.id)), { cards: 0, sh: 0 });
});

test("moving a card between terms changes nothing", () => {
  const card = r(4);
  const before = reservedTotals(mapOf(card));
  const moved = { ...card, semId: "spr2029" };
  assert.deepEqual(reservedTotals(mapOf(moved)), before, "a move altered the total");
});

// ── Against the real corpus ────────────────────────────────────────

test("REAL: the note's number matches the cards actually in the plan", () => {
  const SEMESTERS = [
    { id: "incoming", semTypeId: "incoming", type: "special" },
    ...[2026, 2027, 2028, 2029, 2030].flatMap(y => [
      { id: `fall${y}`, semTypeId: "fall", type: "fall", weight: 1 },
      { id: `spr${y + 1}`, semTypeId: "spring", type: "spring", weight: 1 },
      { id: `sumA${y + 1}`, semTypeId: "sumA", type: "summer", weight: 0.5 },
      { id: `sumB${y + 1}`, semTypeId: "sumB", type: "summer", weight: 0.5 },
    ]),
  ];
  const courseMap = new Proxy({}, { get: (_, k) => ({ id: String(k), sh: 4 }), has: () => true });

  let plans = 0, maxCards = 0;
  const base = join(ROOT, "src/data/majors/2026");
  for (const college of readdirSync(base)) {
    let progs = [];
    try { progs = readdirSync(join(base, college)); } catch { continue; }
    for (const prog of progs.slice(0, 12)) {
      const f = join(base, college, prog, "plan.json");
      if (!existsSync(f)) continue;
      const grid = JSON.parse(readFileSync(f, "utf8"));
      for (const plan of grid.plans ?? []) {
        const applied = applySamplePlan(plan, { semesters: SEMESTERS, courseMap });
        const got = reservedTotals(applied.reservations);
        plans += 1;
        maxCards = Math.max(maxCards, got.cards);

        assert.equal(got.cards, Object.keys(applied.reservations).length,
          `${prog}: the count disagrees with the cards in the plan`);
        const expected = Object.values(applied.reservations)
          .reduce((n, x) => n + (Number(x.sh) > 0 ? Number(x.sh) : 0), 0);
        assert.equal(got.sh, expected, `${prog}: the credit total is wrong`);
        assert.ok(got.sh >= 0 && Number.isFinite(got.sh), `${prog}: nonsense SH ${got.sh}`);
        assert.ok(Number.isInteger(got.cards), `${prog}: fractional card count`);
      }
    }
  }
  assert.ok(plans > 40, `only ${plans} plans exercised`);
  assert.ok(maxCards > 5, "no plan reserved enough cards for this to be a real test");
});
