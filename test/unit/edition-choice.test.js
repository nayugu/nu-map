// UNIT · what the per-program catalog-year control shows.
//
// These assertions used to live in a browser suite, where each one cost a
// 16-second app build plus a ~20-second page boot — and the mutation probe ran
// that suite once per mutant, so measuring whether eight guards were real took
// over twenty minutes. The rules being checked are all decisions about a small
// object. Booting a 2.1 MB application to ask whether a boolean is true is the
// least direct way to find out.
//
// This is the `bankRank` move, and CLAUDE.md records why it is about accuracy
// and not only speed: a mutant SURVIVED the whole browser suite while that
// comparator was inline in BankPanel.jsx, because the natural browser test
// could not observe an ordering at all. Extraction made it killable.
//
// What stays in a browser is what a browser is uniquely for: that the app
// mounts, that the program box is not blank, and that choosing another edition
// really re-audits the degree and reaches the saved plan.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { editionChoice } from "../../src/core/editionChoice.js";

const ED = (year) => ({
  year,
  label: `${year - 1}-${year}`,
  path: `../../data/northeastern/programs/undergraduate/${year}/khoury/cs_bscs/requirements.json`,
});

const TWO = [ED(2026), ED(2027)];

describe("editionChoice · whether to draw a control at all", () => {
  test("one edition held draws NOTHING", () => {
    // Not a disabled control, not a single-option dropdown — nothing. A
    // dropdown with one option tells a student they may pick something when
    // they may not. This is the common case, not an edge: 180 of 689
    // undergraduate programs and all 524 graduate programs are here.
    assert.equal(editionChoice({ editions: [ED(2026)], cohortPath: null, cohortLabel: "", currentYear: 2026 }), null);
  });

  test("no editions at all draws nothing", () => {
    for (const editions of [[], undefined, null]) {
      assert.equal(editionChoice({ editions, cohortPath: null, cohortLabel: "", currentYear: null }), null);
    }
    assert.equal(editionChoice(), null, "called with no argument at all");
  });

  test("two editions draw a control", () => {
    const c = editionChoice({ editions: TWO, cohortPath: null, cohortLabel: "", currentYear: 2026 });
    assert.ok(c);
    assert.deepEqual(c.options.map(o => o.label), ["2025-2026", "2026-2027"]);
    assert.equal(c.currentYear, 2026);
  });
});

describe("editionChoice · the cohort hint", () => {
  test("is silent when the program is on its cohort's edition", () => {
    // The regression that mattered: the predecessor of this control fired for
    // 338 of 498 undergraduate majors — every student the app had — and told
    // each of them to leave the edition they actually owe.
    const c = editionChoice({ editions: TWO, cohortPath: null, cohortLabel: "2025-2026", currentYear: 2026 });
    assert.equal(c.hint, null, "a correctly pinned plan was told about its cohort");
    assert.equal(c.resetTo, null, "a correctly pinned plan was offered a reset");
  });

  test("names the cohort's edition when the program is not on it", () => {
    const c = editionChoice({ editions: TWO, cohortPath: ED(2026).path, cohortLabel: "2025-2026", currentYear: 2027 });
    assert.equal(c.hint, "2025-2026");
    assert.equal(c.resetTo, ED(2026).path);
  });

  test("the reset is a PATH, and it is the one the hint names", () => {
    // The caller assigns `resetTo` straight to the saved program field. If the
    // hint and the reset came from different places they could name different
    // editions, and the student would be told one thing and given another.
    const c = editionChoice({ editions: TWO, cohortPath: ED(2027).path, cohortLabel: "2026-2027", currentYear: 2026 });
    assert.equal(c.resetTo, ED(2027).path);
    assert.match(c.resetTo, new RegExp(`/${c.hint.split("-")[1]}/`),
      "the reset points at an edition the hint does not name");
  });

  test("the reset can move a plan BACKWARD", () => {
    // The repair path for every plan the old newer-only banner pushed forward.
    // A control that only ever moved forward would strand exactly the students
    // that defect damaged.
    const c = editionChoice({ editions: TWO, cohortPath: ED(2026).path, cohortLabel: "2025-2026", currentYear: 2027 });
    assert.match(c.resetTo, /\/2026\//);
  });

  test("an empty cohort label degrades to no hint, never to an empty one", () => {
    // Rendering "your cohort: " with nothing after it states a fact we do not
    // have. The control itself still appears — the student can still choose.
    const c = editionChoice({ editions: TWO, cohortPath: ED(2026).path, cohortLabel: "", currentYear: 2027 });
    assert.equal(c.hint, null);
    assert.ok(c.options.length === 2, "the selector must survive a missing label");
  });
});

describe("editionChoice · it decides, it does not invent", () => {
  test("the options are exactly what it was given, in order", () => {
    // The offered editions come from the registry, so every one is a path that
    // loads. Filtering, sorting or synthesising here would break the property
    // that a selection can always be displayed and re-selected — the defect
    // that left the program box blank over loaded requirements.
    const c = editionChoice({ editions: TWO, cohortPath: null, cohortLabel: "", currentYear: 2026 });
    assert.deepEqual(c.options, TWO);
    assert.strictEqual(c.options[0], TWO[0], "options were rebuilt rather than passed through");
  });

  test("a missing current year is null, not undefined or 0", () => {
    // The renderer feeds this to a <select value>. `undefined` makes it an
    // uncontrolled input and `0` would select nothing while looking deliberate.
    const c = editionChoice({ editions: TWO, cohortPath: null, cohortLabel: "", currentYear: undefined });
    assert.equal(c.currentYear, null);
  });
});
