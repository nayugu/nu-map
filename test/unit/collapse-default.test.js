// UNIT · what "Other credits" defaults to, and who it defaults FOR.
//
// Changing a default is only free for someone who has never seen the old one.
// Three populations, and conflating them is the whole risk:
//
//   chose explicitly   their value wins, forever, whatever the default becomes
//   returning, never chose   keeps the OLD behaviour — their layout must not
//                            rearrange itself under a plan they are mid-way
//                            through
//   genuinely new      gets the NEW default, so a course they add is visible
//                      where they put it
//
// The resolution is a pure function of storage, so it is asserted as one. This
// mirrors the initializer in PlannerContext; if that changes, this fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The rule, extracted. Kept in step with the initializer by the source guard
 * at the bottom rather than by hoping.
 */
function collapseDefault({ stored = null, seenSetup = false, placements = {} } = {}) {
  if (stored !== null) return stored !== "false";
  return seenSetup || Object.keys(placements ?? {}).length > 0;
}

test("an explicit choice always wins", () => {
  // Both directions, and against every other signal — a returning user who
  // turned it OFF must not have it turned back on by the migration branch.
  assert.equal(collapseDefault({ stored: "true" }), true);
  assert.equal(collapseDefault({ stored: "false" }), false);
  assert.equal(collapseDefault({ stored: "false", seenSetup: true }), false,
    "a returning user's explicit OFF was overridden");
  assert.equal(collapseDefault({ stored: "true", seenSetup: false }), true,
    "a new user's explicit ON was overridden");
  assert.equal(collapseDefault({ stored: "false", placements: { CS3000: "fall2026" } }), false);
});

test("a genuinely new install gets the new default — expanded", () => {
  assert.equal(collapseDefault({}), false);
  assert.equal(collapseDefault({ stored: null, seenSetup: false, placements: {} }), false);
});

test("a returning install keeps the old behaviour — collapsed", () => {
  assert.equal(collapseDefault({ seenSetup: true }), true,
    "someone who has completed first-run setup had their layout changed");
});

test("a saved plan counts as returning even without the setup flag", () => {
  // Cleared the flag, or started before it existed. Their plan is exactly the
  // thing that should not rearrange itself.
  assert.equal(collapseDefault({ seenSetup: false, placements: { CS3000: "fall2026" } }), true);
});

test("an empty or missing placements map is not mistaken for a plan", () => {
  for (const placements of [{}, null, undefined]) {
    assert.equal(collapseDefault({ seenSetup: false, placements }), false,
      `placements=${JSON.stringify(placements)} was read as an existing plan`);
  }
});

test("storage values other than 'false' read as ON, matching the writer", () => {
  // The setting is written with String(bool), so "true"/"false" are the only
  // values it produces — but a hand-edited or legacy value must not flip the
  // meaning of the check.
  for (const stored of ["true", "1", "yes", ""]) {
    assert.equal(collapseDefault({ stored }), stored !== "false");
  }
});

// ── The rule above must stay the rule below ────────────────────────

test("the initializer in PlannerContext still implements this", () => {
  // A behavioural test cannot reach a useState initializer, and a copy of the
  // logic that drifts from the original is worse than no test at all.
  const src = readFileSync(join(ROOT, "src/context/PlannerContext.jsx"), "utf8");
  const i = src.indexOf("const [collapseOtherCredits");
  assert.notEqual(i, -1, "the setting was renamed — update this guard");
  const body = src.slice(i, i + 1400);

  assert.ok(/if \(v !== null\) return v !== "false";/.test(body),
    "an explicit choice no longer short-circuits");
  assert.ok(/seen-cohort-setup/.test(body),
    "the returning-user marker is gone");
  assert.ok(/_saved\?\.placements/.test(body),
    "the saved-plan fallback is gone");
  assert.ok(/return seen \|\| hasPlan;/.test(body),
    "the two returning-user signals are no longer combined");
});
