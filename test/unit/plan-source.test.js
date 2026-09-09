// Every case here is a bug that actually shipped, or the invariant that bug
// broke. `planSourceState` exists because these were unreachable from Node while
// the same logic lived as seven flags in a component body.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planSourceState } from "../../src/core/planSource.js";

const S = (o) => planSourceState(o);

test("both sources available: catalog is preferred and both tabs live", () => {
  const r = S({ hasCatalogPlan: true, chartEligible: true });
  assert.equal(r.show, true, "a catalog plan is something to show at once");
  assert.equal(r.source, "catalog");
  assert.equal(r.catalog.enabled, true);
  assert.equal(r.chart.enabled, true);
});

test("no catalog plan: the section renders once CHART HAS A PLAN, not when it finishes", () => {
  // Stated positively, because "wait until CHART finishes" is the wrong rule and
  // was briefly the implemented one: finishing includes REFUSING, and a refusal
  // is not a reason to render. The section must not appear, sit busy, and then
  // vanish — so it waits for a plan to exist, not for a search to end.
  const pending = S({ hasCatalogPlan: false, chartEligible: true, chartHasPlan: false });
  assert.equal(pending.show, false, "the section appeared before CHART had an answer");
  assert.equal(pending.chartPending, true);
  // ...and the work must still have STARTED, or it would wait for ever.
  assert.equal(pending.mayGenerate, true, "nothing would ever start the generation");

  const settled = S({ hasCatalogPlan: false, chartEligible: true, chartHasPlan: true });
  assert.equal(settled.show, true);
  assert.equal(settled.source, "chart");
  assert.equal(settled.catalog.enabled, false);
  assert.equal(settled.catalog.why, "no-catalog-plan");
});

test("show and mayGenerate are not gated on each other — the deadlock", () => {
  // Written because it happened: gating `mayGenerate` on `show` while `show`
  // waits for the generation is a deadlock, and the panel simply never appeared.
  // The property is that in EVERY state where the section is waiting on CHART,
  // something is starting CHART.
  for (const chosen of ["catalog", "chart"])
    for (const hasCatalogPlan of [true, false]) {
      const r = S({ hasCatalogPlan, chartEligible: true, chartHasPlan: false, chosen });
      if (r.chartPending && !r.show) {
        assert.equal(r.mayGenerate, true,
          `deadlock: waiting on CHART but not running it (${chosen}/${hasCatalogPlan})`);
      }
    }
});

test("a catalog plan shows AT ONCE, without waiting for CHART", () => {
  // The wait is only ever paid by a program that has nothing else to show.
  const r = S({ hasCatalogPlan: true, chartEligible: true, chartHasPlan: false });
  assert.equal(r.show, true);
  assert.equal(r.source, "catalog");
});

test("CHART refuses but the catalog plan exists: the tab greys, nothing is lost", () => {
  const r = S({ hasCatalogPlan: true, chartEligible: true,
                refusal: { reason: "mostly-unlabelled" }, refusalText: "only 44%" });
  assert.equal(r.show, true);
  assert.equal(r.source, "catalog");
  assert.equal(r.chart.enabled, false);
  assert.equal(r.chart.why, "only 44%", "the real refusal must outrank the generic reason");
});

test("BOTH unavailable: the section does not render at all", () => {
  // International Business, BSIB (Boston) on 2026-2027: no catalog plan for the
  // edition, and CHART refuses with `mostly-unlabelled`. It used to render a
  // section offering two sources and possessing neither.
  for (const r of [
    S({ hasCatalogPlan: false, chartEligible: false }),
    S({ hasCatalogPlan: false, chartEligible: true, refusal: { reason: "mostly-unlabelled" } }),
  ]) {
    assert.equal(r.show, false);
    assert.equal(r.source, null);
    assert.equal(r.mayGenerate, false, "a hidden section must never start work");
  }
});

test("a hidden section NEVER generates — the 85.7 second freeze", () => {
  // The expensive one. `sampleplanOffer` hides the section for a double major,
  // but the generate effect was gated on the SOURCE alone and hooks keep running
  // when a render returns null. So a two-major plan on 2027 ran a full CHART
  // search for a panel nobody could see, and froze the main thread for 85.7s.
  const r = S({ hasCatalogPlan: false, chartEligible: true, sectionHidden: true });
  assert.equal(r.show, false);
  assert.equal(r.mayGenerate, false);
  // ...and it must stay false however the other inputs are arranged.
  for (const hasCatalogPlan of [true, false])
    for (const chartEligible of [true, false])
      for (const chosen of ["catalog", "chart", "nonsense"])
        assert.equal(S({ hasCatalogPlan, chartEligible, chosen, sectionHidden: true }).mayGenerate,
          false, `hidden section generated: ${hasCatalogPlan}/${chartEligible}/${chosen}`);
});

test("the selected source is ALWAYS an available one", () => {
  // The invariant the flag soup could not hold, stated as a property over every
  // combination rather than as a handful of examples.
  for (const hasCatalogPlan of [true, false])
    for (const chartEligible of [true, false])
      for (const refusal of [null, { reason: "x" }])
        for (const chosen of ["catalog", "chart", "", undefined, "junk"]) {
          const r = S({ hasCatalogPlan, chartEligible, refusal, chosen });
          if (!r.show) { assert.equal(r.source, null); continue; }
          assert.ok(r.source === "catalog" || r.source === "chart");
          assert.equal(r[r.source].enabled, true,
            `selected a disabled source: ${JSON.stringify({ hasCatalogPlan, chartEligible, refusal, chosen })}`);
        }
});

test("mayGenerate never runs for a hidden section, or for a source already answered", () => {
  // This used to assert `mayGenerate => show`, which was right when the section
  // appeared first and computed second. That order is now reversed on purpose —
  // the section waits for the answer — so the old assertion described a deadlock
  // rather than a safeguard. What survives is the part that was load-bearing:
  // a hidden section starts nothing, and a refusal is never re-asked.
  for (const hasCatalogPlan of [true, false])
    for (const chartEligible of [true, false])
      for (const refusal of [null, { reason: "x" }])
        for (const sectionHidden of [true, false])
          for (const chartHasPlan of [true, false])
            for (const chosen of ["catalog", "chart"]) {
              const r = S({ hasCatalogPlan, chartEligible, refusal, sectionHidden, chartHasPlan, chosen });
              if (!r.mayGenerate) continue;
              assert.equal(sectionHidden, false, "a hidden section started a search");
              assert.equal(r.chart.enabled, true, "generated for an unavailable source");
              assert.equal(refusal, null, "re-asked a source that already refused");
              // And it only ever runs for a student who would actually land on CHART.
              assert.ok(chosen === "chart" || !hasCatalogPlan,
                "generated while the student was on the catalog plan");
            }
});

test("the student's choice is honoured while it remains available", () => {
  const r = S({ hasCatalogPlan: true, chartEligible: true, chosen: "chart" });
  assert.equal(r.source, "chart");
  assert.equal(r.mayGenerate, true);
});

test("a choice that stops being available falls back rather than sticking", () => {
  // Picking CHART and then having it refuse must not leave CHART selected.
  const r = S({ hasCatalogPlan: true, chartEligible: true, chosen: "chart",
                refusal: { reason: "search-budget-exhausted" } });
  assert.equal(r.source, "catalog");
  assert.equal(r.mayGenerate, false, "a refused source must not be asked again");
});

test("junk in, a coherent answer out", () => {
  for (const bad of [undefined, {}, { hasCatalogPlan: null, chartEligible: "yes" }]) {
    const r = planSourceState(bad);
    assert.equal(typeof r.show, "boolean");
    if (r.show) assert.equal(r[r.source].enabled, true);
    else assert.equal(r.source, null);
  }
});
