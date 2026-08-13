// INVARIANT · every surface that audits a plan reads the SAME grade views.
//
// This exists because a second derivation is how the bug happened, and a
// second derivation is how it would come back. GradPanel built its placed and
// done sets through dropVoidTakes/dropUnearnedTakes; the printed report built
// its own, in the caller, from RAW placements — it had no grade view at all.
// So a course graded F, W, U or X was struck through on screen and printed as
// COMPLETED: toward requirement satisfaction, toward the NUPath grid, and
// toward "SH completed". The one non-editable artifact we produce was the
// least correct view in the app, and it is the one a student hands to an
// advisor.
//
// The unit test in test/unit/plan-report-grades.test.js pins the behaviour of
// derivePlanSets. This file pins the thing the unit test structurally cannot:
// that the report actually CALLS it, and that no caller re-derives the sets by
// hand. The old code would fail every assertion below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = p => readFileSync(join(ROOT, p), "utf8");

test("the printed report derives its audit sets through derivePlanSets", () => {
  const model = read("src/core/planModel.js");
  assert.match(model, /export function derivePlanSets\(/,
    "derivePlanSets is gone — the shared derivation has been dismantled");

  const report = /export async function exportReport\([\s\S]*$/.exec(model)?.[0];
  assert.ok(report, "exportReport is gone");
  assert.match(report, /derivePlanSets\(\{/,
    "exportReport no longer derives its sets through derivePlanSets");

  // The specific regression: building the placed set straight off the raw
  // `placements` argument, with no grade view in between.
  assert.ok(!/buildPlacedKeySet\(\s*filterInTimeline\(\s*placements\b/.test(report),
    "exportReport builds a placed set from RAW placements again");
});

test("both grade views are used — dropping only voids loses the earned view", () => {
  const model = read("src/core/planModel.js");
  // PROJECTION decides what still satisfies; EARNED decides what is complete.
  // Collapsing them to one filter is the subtle version of this bug: an
  // incomplete (I) would either satisfy nothing or count as hours earned,
  // and both are wrong.
  assert.match(model, /dropVoidTakes/, "the projection view is gone");
  assert.match(model, /dropUnearnedTakes/, "the earned view is gone");
});

test("the printed report's credit totals are grade-scoped too", () => {
  // "N SH completed" is the registrar's earned view. Summing raw layout
  // placements counts a failed course's hours as earned.
  const model  = read("src/core/planModel.js");
  const totals = /let doneSH = 0, plannedSH = 0;[\s\S]*?semRows\.push/.exec(model)?.[0];
  assert.ok(totals, "the report's credit-total loop has been restructured");
  assert.ok(!/if \(isDone\) doneSH \+= sh; else plannedSH \+= sh;/.test(totals),
    "credit totals are summed from the layout again, ignoring grades");
  assert.match(totals, /earned\[id\]/,    "completed hours no longer consult the earned view");
  assert.match(totals, /projected\[id\]/, "planned hours no longer consult the projection view");
});

test("the caller hands over raw state and does not re-derive the sets", () => {
  // Header used to compute npCovered and doneKeys itself. That is what
  // allowed it to disagree with GradPanel: the derivation lived at the call
  // site, where nobody comparing the two surfaces would look.
  const header = read("src/ui/Header.jsx");
  const fn = /const handleExport = e => \{[\s\S]*?\n  \};/.exec(header)?.[0];
  assert.ok(fn, "handleExport is gone or has been restructured");

  assert.match(fn, /grades,/, "the export no longer passes grades at all");
  assert.ok(!/getCoverage\(/.test(fn),
    "handleExport builds the attribute grid itself again");
  assert.ok(!/doneKeys\s*=/.test(fn),
    "handleExport builds the completed-course set itself again");
});

test("GradPanel still reads the same two grade views the report does", () => {
  // GradPanel keeps its own memos (its completion rule differs — it also
  // treats the graduation semester as complete once graduated, which the
  // report never has). What must NOT drift is the grade filtering itself.
  const panel = read("src/ui/GradPanel.jsx");
  assert.match(panel, /dropVoidTakes\(placements, grades\)/,
    "GradPanel's requirement sets are no longer grade-scoped");
  assert.match(panel, /dropUnearnedTakes\(placements, grades\)/,
    "GradPanel's completed set is no longer grade-scoped");
});
