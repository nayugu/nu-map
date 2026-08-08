// UNIT · the tab title, which is also the search-result title.
//
// Google renders the app before it indexes it, so whatever the title logic
// produces for a visitor with NO state is what appears in search. The claim
// under test is that a cold render is indistinguishable from a crawler and
// yields no title at all (leaving index.html's), while every way a person can
// make the tab theirs does yield one. Getting this backwards is invisible in
// the app and only shows up weeks later, in a search result reading
// "Plan 1 · NU Map".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { tabTitle, ownsDocument, FIRST_PLAN_NAME } from "../../src/core/tabTitle.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const APP  = "NU Map";
const cold = { plans: [{ id: "default", name: FIRST_PLAN_NAME }], activePlanId: "default",
               placements: {}, hadStoredPlans: false, appName: APP };

test("tab title › a cold first render leaves the static title alone", () => {
  assert.equal(ownsDocument(cold), false);
  assert.equal(tabTitle(cold), null);
});

test("tab title › the crawler's own render is the cold one", () => {
  // A crawler has no storage, no second plan and places nothing, so it cannot
  // reach any branch that would rename the tab.
  assert.equal(tabTitle({ ...cold, plans: [{ id: "default", name: FIRST_PLAN_NAME }] }), null);
  assert.equal(tabTitle({ plans: [], activePlanId: "default", appName: APP }), null);
});

test("tab title › storage from an earlier visit makes the tab yours", () => {
  assert.equal(tabTitle({ ...cold, hadStoredPlans: true }), `✎ ${FIRST_PLAN_NAME} · ${APP}`);
});

test("tab title › renaming, adding a plan, or placing a course makes it yours", () => {
  assert.equal(tabTitle({ ...cold, plans: [{ id: "default", name: "Combined CS" }] }),
               `✎ Combined CS · ${APP}`);
  assert.equal(tabTitle({ ...cold, plans: [{ id: "default", name: FIRST_PLAN_NAME }, { id: "b", name: "Plan 2" }] }),
               `✎ ${FIRST_PLAN_NAME} · ${APP}`);
  assert.equal(tabTitle({ ...cold, placements: { "CS2500": "fall-1" } }),
               `✎ ${FIRST_PLAN_NAME} · ${APP}`);
});

test("tab title › the scheme keeps the pencil and the ownership separator", () => {
  const title = tabTitle({ ...cold, hadStoredPlans: true, plans: [{ id: "default", name: "Privacy Policy" }] });
  // A plan may be named after a site page; the pencil and "·" are what keep
  // the two apart, so neither is optional.
  assert.match(title, /^✎ /);
  assert.ok(title.includes(" · "), "plan tabs use · , site pages use -");
  assert.notEqual(title, "Privacy Policy - NU Map");
});

test("tab title › the default name the app ships matches the one it tests for", () => {
  // The literal lives in PlannerContext's plan-index initializer; if the two
  // drift, every first visit starts out looking like somebody's document.
  const ctx = readFileSync(join(ROOT, "src/context/PlannerContext.jsx"), "utf8");
  assert.ok(ctx.includes("name: FIRST_PLAN_NAME"),
    "PlannerContext should seed the first plan from FIRST_PLAN_NAME, not a literal");
});

test("tab title \u203a corrupt stored state yields no title, never a crash", () => {
  // plan-index comes from localStorage; the literal "null" parses to null, and
  // a default parameter does not catch that. A broken tab title must never be
  // the thing that takes the app down.
  for (const bad of [undefined, {}, { plans: null }, { plans: "nope" }, { plans: [null] },
                     { plans: [{}], activePlanId: "x" }, { placements: null }]) {
    assert.doesNotThrow(() => tabTitle(bad), `tabTitle(${JSON.stringify(bad)})`);
    assert.doesNotThrow(() => ownsDocument(bad), `ownsDocument(${JSON.stringify(bad)})`);
  }
  assert.equal(tabTitle({ plans: null, appName: APP }), null);
});
