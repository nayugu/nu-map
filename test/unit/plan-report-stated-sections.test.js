// UNIT · src/core/planModel.js — how the export prints a requirement it cannot check.
//
// A section the catalog states only in prose (ME BSME's "Mechanical and
// Industrial Engineering Technical Elective": 4 SH, no course named) has
// nothing to count. The panel and the export used to print "0/0" over an empty
// progress bar, which reads as a bug and — worse, on paper — as "you have
// completed none of this", a claim neither of them is entitled to make.
//
// The export matters more than the panel here, because it is the artifact a
// student hands an advisor. An advisor must be able to tell three states apart:
// checked (we verified it), outstanding (we checked and it is not done), and
// NOT EVALUABLE (we never could). This pins the third.
import { test } from "node:test";
import assert from "node:assert/strict";
import { _sectionHtml as sectionHtml } from "../../src/core/planModel.js";

/** The shape allocateSection returns for a prose-only section. */
const statedOnly = {
  type: "SECTION",
  title: "Mechanical and Industrial Engineering Technical Elective",
  notes: [
    "Complete one technical elective in one of the following subject areas:",
    "EMGT, ENGR, ENSY, IE, ME, or MEIE",
  ],
  statedSH: 4,
  sat: false, satCount: 0, minRequired: 1, total: 0, children: [],
};

/** An ordinary unsatisfied section, for contrast. */
const ordinary = {
  type: "SECTION", title: "Required Courses", notes: [],
  sat: false, satCount: 1, minRequired: 2, total: 2,
  children: [
    { type: "COURSE", sat: true,  key: "ME2350", label: "ME 2350" },
    { type: "COURSE", sat: false, key: "ME3475", label: "ME 3475" },
  ],
};

test("report › a prose-only section prints its stated credit, not 0/0", () => {
  const html = sectionHtml(statedOnly, new Set());
  assert.ok(html.includes("4 SH"), "the registrar's own number must print");
  assert.ok(!html.includes("0/0"),
    "0/0 asserts we counted something; there was nothing to count");
});

test("report › a prose-only section draws no progress bar", () => {
  // A bar at 0% is a claim of no progress. No progress is MEASURABLE here, so
  // the honest rendering is no bar at all — degrade to less information, never
  // to wrong information.
  const html = sectionHtml(statedOnly, new Set());
  assert.ok(!html.includes("sec-bar"), "an empty bar claims zero progress");
  assert.ok(sectionHtml(ordinary, new Set()).includes("sec-bar"),
    "…while an ordinary section still gets one");
});

test("report › a prose-only section is marked not-evaluable, not failed", () => {
  const html = sectionHtml(statedOnly, new Set());
  assert.match(html, /<span class="sec-icon">–<\/span>/,
    "the dash is the print twin of the panel's dashed box");
  assert.ok(!html.includes(">✓<"), "never a check — nobody verified this");
  // And it must not be styled as satisfied, which is what would put it in the
  // "done" colour band on paper.
  assert.ok(!/class="sec sec-sat"/.test(html));
});

test("report › the catalog's sentences print verbatim and attributed", () => {
  const html = sectionHtml(statedOnly, new Set());
  assert.ok(html.includes("From the catalog"),
    "unattributed prose would read as OUR rule rather than the registrar's");
  for (const n of statedOnly.notes) assert.ok(html.includes(n), `missing: ${n}`);
});

test("report › a section with children keeps its counts", () => {
  // The guard against the branch firing too widely: `statedSH` is only set
  // when there is nothing to count, but a bug that let it win over real
  // children would replace a verified 1/2 with an unverifiable credit figure.
  const html = sectionHtml({ ...ordinary, statedSH: 99 }, new Set());
  assert.ok(html.includes("1/2"), "real counts must survive");
  assert.ok(!html.includes("99 SH"));
});

test("report › catalog prose is escaped like everything else", () => {
  // Notes are scraped text. They reach an HTML document, so they are hostile
  // input until escaped — the same rule the rest of this export follows.
  const html = sectionHtml(
    { ...statedOnly, notes: [`<img src=x onerror=alert(1)>`] }, new Set());
  assert.ok(!/<img\s+src=x/i.test(html), "raw markup from a note survived");
  assert.ok(html.includes("&lt;img"), "…and it should still be visible as text");
});
