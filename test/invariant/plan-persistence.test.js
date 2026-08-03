// INVARIANT · plan persistence must round-trip.
//
// Plan state lives in TWO localStorage stores: `<prefix>-state-v2` (the
// continuous autosave) and `<prefix>-plan-data-<id>` (the per-plan SLOT,
// which is what the app actually RELOADS from). Three separate data-loss
// bugs came from that duplication, all the same shape — a field was added
// to one side and forgotten on another:
//
//   1. `grades` and `placedOut` were captured into the slot but missing
//      from the slot-autosave effect's dependency array, so a grade-only
//      edit never reached the slot and the stale slot overwrote it on the
//      next mount.
//   2. the beforeunload handler called saveState with the wrong arguments
//      (prefix omitted), so the last-chance save wrote to a junk key.
//   3. restorePlan treated a MISSING `grades` key the same as an empty
//      one, so every plan slot written before grades existed wiped them
//      on load.
//
// None of these could fail a behavioural test that didn't happen to
// exercise the exact field. This checks the STRUCTURE instead: whatever
// captureCurrentPlan() writes must also be restored and must be watched.
// It reads source text because the invariant is about the code's shape;
// the invariant CI job runs with no npm install, so no parser is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/context/PlannerContext.jsx"), "utf8");

/** Body of a `const <name> = (...) => ({…})` or `=> {…}`, brace-matched.
 *  Anchors on the ARROW, not the first brace: a destructured parameter
 *  (`(d, { initial = false } = {})`) would otherwise be mistaken for the
 *  body and every field would look missing. */
function blockAfter(marker) {
  const i = SRC.indexOf(marker);
  assert.notEqual(i, -1, `could not find ${marker} — this test needs updating`);
  const arrow = SRC.indexOf("=>", i);
  assert.notEqual(arrow, -1, `no arrow after ${marker}`);
  const start = SRC.indexOf("{", arrow);
  let depth = 0;
  for (let j = start; j < SRC.length; j++) {
    if (SRC[j] === "{") depth++;
    else if (SRC[j] === "}" && --depth === 0) return SRC.slice(start, j + 1);
  }
  throw new Error(`unbalanced braces after ${marker}`);
}

// Fields captureCurrentPlan writes. Shorthand (`placements,`) and explicit
// (`grades: gradesRaw,`) both count; `version`/`exported` are metadata.
function capturedFields() {
  const body = blockAfter("const captureCurrentPlan = ");
  const out = new Set();
  // Split on commas, not lines. A line-anchored match saw only the FIRST name
  // on `placements, specialTermPl, semOrders, shOverrides, bonusSH,` and the
  // guard silently checked a fraction of the fields for as long as it existed.
  for (const raw of body.split(/[,\n]/)) {
    const t = raw.replace(/\/\/.*$/, "").trim();
    if (!t || t === "{" || t === "}" || t === "});") continue;
    const m = /^([a-zA-Z_$][\w$]*)\s*(?::|$)/.exec(t);
    if (m) out.add(m[1]);
  }
  for (const k of ["version", "exported"]) out.delete(k);
  return out;
}

test("persistence › every captured plan field is also restored", () => {
  const restore = blockAfter("const restorePlan = ");
  // specialTermPl is read through migrateSpecialTermPl(d), which also handles
  // the legacy workPl/internPl shapes, so `d.specialTermPl` never appears
  // literally in the body.
  const VIA_HELPER = new Set(["specialTermPl"]);
  const missing = [...capturedFields()]
    .filter(f => !VIA_HELPER.has(f))
    .filter(f => !new RegExp(`\\bd\\.${f}\\b`).test(restore));
  assert.deepEqual(missing, [],
    `captureCurrentPlan writes these but restorePlan never reads them, so they are ` +
    `lost on reload: ${missing.join(", ")}`);
});

test("persistence › every restored plan field is also captured", () => {
  // The MIRROR of the test above, and the hole that let a real bug ship.
  //
  // restorePlan read `d.substitutions` and wiped the list to [] when the key
  // was absent — but captureCurrentPlan never wrote it, so the slot ALWAYS
  // lacked it. Every applied substitution vanished on refresh. The
  // captured→restored direction could not see this, because the field simply
  // was not captured; only the reverse direction catches it.
  //
  // A field restorePlan reads must be one capture writes, or the restore is
  // guaranteed to read undefined from a slot the app itself produced.
  const restore = blockAfter("const restorePlan = ");
  const captured = capturedFields();
  // Legacy shapes handled by migrateSpecialTermPl, never written by capture.
  const LEGACY = new Set(["workPl", "internPl"]);
  const read = new Set([...restore.matchAll(/\bd\.([a-zA-Z_$][\w$]*)/g)].map(m => m[1]));
  const orphaned = [...read].filter(f => !captured.has(f) && !LEGACY.has(f)).sort();
  assert.deepEqual(orphaned, [],
    `restorePlan reads these but captureCurrentPlan never writes them, so the slot ` +
    `never contains them and the restore clears the live value: ${orphaned.join(", ")}`);
});

test("persistence › every captured plan field is watched by the slot autosave", () => {
  // The slot is what the app reloads from. A captured-but-unwatched field
  // is written to state-v2, never mirrored to the slot, and then clobbered
  // by the stale slot on the next mount — silent loss that looks like
  // "it didn't save". This is bug (1) above.
  const i = SRC.indexOf("saveCurrentPlanToSlot();\n    // EVERY field");
  assert.notEqual(i, -1, "slot-autosave effect not found — this test needs updating");
  const deps = SRC.slice(i, SRC.indexOf("]", i));
  // Captured field → the state variable that actually holds it.
  const alias = {
    grades: "gradesRaw",
    entSem: "planEntSem", entYear: "planEntYear",
    gradSem: "planGradSem", gradYear: "planGradYear",
  };
  const missing = [...capturedFields()]
    .filter(f => !new RegExp(`\\b${alias[f] ?? f}\\b`).test(deps));
  assert.deepEqual(missing, [],
    `captured but not in the slot-autosave deps, so edits to them never reach ` +
    `the slot: ${missing.join(", ")}`);
});

test("persistence › saveState is always called with the storage prefix", () => {
  // saveState(prefix, persist, obj). Calling it with two arguments silently
  // writes {"persist":true} to a junk key — bug (2), which disabled the
  // beforeunload safety net entirely.
  for (const m of SRC.matchAll(/saveState\(([^;]*?)\)\s*;/gs)) {
    const args = m[1].trim();
    assert.ok(args.startsWith("storagePrefix"),
      `saveState must be called as saveState(storagePrefix, persist, obj); got: saveState(${args.slice(0, 60)}…)`);
  }
});

test("persistence › restorePlan distinguishes an ABSENT grades key from an empty one", () => {
  // Bug (3): `d.grades ?? {}` wiped grades for every slot written before
  // grades existed. An explicit {} means "no grades"; a missing key means
  // "this slot predates the feature" and must not destroy live state.
  const restore = blockAfter("const restorePlan = ");
  assert.ok(/if \(d\.grades && typeof d\.grades === "object"\) setGrades\(d\.grades\);/.test(restore),
    "restorePlan must set grades only when the key is actually present");
  assert.ok(/else if \(!initial\) setGrades\(\{\}\);/.test(restore),
    "a missing grades key may only clear on a plan SWITCH, never on the initial mount restore");
  // Strip comments first — the block documents the old `d.grades ?? {}`
  // by name, and a naive scan would flag the explanation as the defect.
  const code = restore.replace(/\/\/.*$/gm, "");
  assert.ok(!/d\.grades \?\? \{\}/.test(code),
    "`d.grades ?? {}` conflates absent with empty — that is the wipe");
});
