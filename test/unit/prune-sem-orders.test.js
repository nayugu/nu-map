// UNIT · pruneSemOrders — what a plan is allowed to carry out of the app.
//
// Every door out (slot, file, archive, share link) runs through
// captureCurrentPlan, so this is where stale bookkeeping either stops or
// becomes permanent. The distinction the tests below pin down is the one that
// matters: an order entry naming a card the plan does not hold is cruft, while
// a card parked in a term outside the current window is the user's work and
// must survive.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pruneSemOrders } from "../../src/core/planSchema.js";

test("prune › drops an order entry for a card the plan does not hold", () => {
  const out = pruneSemOrders({
    placements: { CS2500: "fall2026" },
    reservations: {},
    semOrders: { fall2026: ["CS2500", "CS9999"] },
  });
  assert.deepEqual(out.semOrders, { fall2026: ["CS2500"] });
});

test("prune › keeps reservations, which are cards too", () => {
  const out = pruneSemOrders({
    placements: {},
    reservations: { "~res:abc": { id: "~res:abc", semId: "fall2026" } },
    semOrders: { fall2026: ["~res:abc"] },
  });
  assert.deepEqual(out.semOrders, { fall2026: ["~res:abc"] });
});

test("prune › KEEPS a card parked outside the timeline", () => {
  // The whole point of the rule being about membership rather than about the
  // window. Shortening a cohort parks cards; they come back when it widens.
  // Pruning here would make that silent, permanent data loss.
  const out = pruneSemOrders({
    placements: { CS3000: "fall2030" },
    reservations: {},
    semOrders: { fall2030: ["CS3000"] },
  });
  assert.deepEqual(out.semOrders, { fall2030: ["CS3000"] });
});

test("prune › removes a term whose order has emptied out", () => {
  const out = pruneSemOrders({
    placements: {}, reservations: {},
    semOrders: { fall2026: ["GONE"], spr2027: [] },
  });
  assert.deepEqual(out.semOrders, {});
});

test("prune › returns the SAME object when there is nothing to do", () => {
  // Callers can skip a write on identity; a fresh object every capture would
  // defeat that and churn localStorage on every keystroke-driven save.
  const data = {
    placements: { CS2500: "fall2026" }, reservations: {},
    semOrders: { fall2026: ["CS2500"] },
  };
  assert.equal(pruneSemOrders(data), data);
});

test("prune › leaves every other field untouched", () => {
  const data = {
    version: 1, placements: { A: "fall2026" }, reservations: {},
    semOrders: { fall2026: ["A", "B"] },
    grades: { A: "B+" }, bonusSH: 8, substitutions: [{ from: "X", to: "Y" }],
    appliedTemplate: { programKey: "p", planLabel: "l" },
  };
  const out = pruneSemOrders(data);
  assert.deepEqual(out.grades, data.grades);
  assert.equal(out.bonusSH, 8);
  assert.deepEqual(out.substitutions, data.substitutions);
  assert.deepEqual(out.appliedTemplate, data.appliedTemplate);
  assert.equal(out.version, 1);
});

test("prune › survives junk", () => {
  assert.deepEqual(pruneSemOrders({}), {});
  assert.equal(pruneSemOrders(null), null);
  assert.equal(pruneSemOrders(undefined), undefined);
  assert.deepEqual(pruneSemOrders({ semOrders: null }).semOrders, null);
  // A non-array order value is not an order.
  assert.deepEqual(pruneSemOrders({ semOrders: { f: "nope" }, placements: {} }).semOrders, {});
});
