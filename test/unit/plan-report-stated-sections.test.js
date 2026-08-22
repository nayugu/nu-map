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

// ── Prose and headings that sit on a NODE, not on the section ───────────────
//
// The export is the artifact handed to an advisor, so it has to agree with the
// panel about where a sentence belongs. These pin the two placements added with
// the positional-notes change; both were rendering paths with no test, which is
// worse than an untested new feature because the section-level case beside them
// IS tested and reads as coverage.

/** A menu introduced by its own instruction, the way parseRowGroup emits it. */
const withNodeNotes = {
  type: "SECTION", title: "Electives", notes: [],
  sat: false, satCount: 0, minRequired: 1, total: 1,
  children: [
    { type: "OR", sat: false, satCount: 0, total: 2,
      notes: ["Complete one of the following, excluding any course used above:"],
      children: [
        { type: "COURSE", sat: false, key: "HIST2301", label: "HIST 2301" },
        { type: "COURSE", sat: false, key: "HIST2302", label: "HIST 2302" },
      ] },
  ],
};

test("report › a note on a NODE prints with that node, not at the section", () => {
  const html = sectionHtml(withNodeNotes, new Set());
  const sentence = withNodeNotes.children[0].notes[0];
  assert.ok(html.includes(sentence), "the instruction must reach the export");
  // Position is the whole point: it has to appear after the section heading and
  // before the courses of the menu it introduces.
  const atNote = html.indexOf(sentence);
  const atFirstCourse = html.indexOf("HIST 2301");
  assert.ok(atNote < atFirstCourse,
    "the sentence must precede the menu it introduces");
  assert.ok(html.indexOf("Electives") < atNote,
    "…and follow the section it sits inside");
});

test("report › a note on a node is escaped too", () => {
  // The section-level path is escaped and tested; the node path is a second
  // interpolation site and would have been an unescaped hole.
  const html = sectionHtml({
    ...withNodeNotes,
    children: [{ ...withNodeNotes.children[0], notes: [`<img src=x onerror=alert(1)>`] }],
  }, new Set());
  assert.ok(!/<img\s+src=x/i.test(html), "raw markup from a node note survived");
  assert.ok(html.includes("&lt;img"));
});

test("report › a pool's category headings print above their own courses", () => {
  // The allocated shape carries `children` per group (the PARSED shape carries
  // `courses` — allocateNode re-slices one into the other, and mixing them up
  // is what threw on 40 pages).
  const pooled = {
    type: "SECTION", title: "Upper-Level Course", notes: [],
    sat: false, satCount: 0, minRequired: 1, total: 1,
    children: [
      { type: "XOM", sat: false, satSh: 0, reqSh: 12, children: [],
        groups: [
          { title: "Society and Behavior",
            children: [{ type: "COURSE", sat: false, key: "SOCL3441", label: "SOCL 3441" }] },
          { title: "Globalization and Global Health",
            children: [{ type: "COURSE", sat: false, key: "PHTH1270", label: "PHTH 1270" }] },
        ] },
    ],
  };
  const html = sectionHtml(pooled, new Set());
  assert.ok(html.includes("rg-cat"), "headings need the class the stylesheet targets");
  // Each heading immediately precedes its own course, in catalog order.
  const order = ["Society and Behavior", "SOCL 3441",
                 "Globalization and Global Health", "PHTH 1270"];
  let at = -1;
  for (const needle of order) {
    const next = html.indexOf(needle, at + 1);
    assert.ok(next > at, `${needle} is out of order in the export`);
    at = next;
  }
});

test("report › a category title is escaped", () => {
  const html = sectionHtml({
    type: "SECTION", title: "Pool", notes: [], sat: false, satCount: 0,
    minRequired: 1, total: 1,
    children: [{ type: "XOM", sat: false, satSh: 0, reqSh: 4, children: [],
      groups: [{ title: `<img src=x onerror=alert(1)>`, children: [] }] }],
  }, new Set());
  assert.ok(!/<img\s+src=x/i.test(html), "raw markup from a category title survived");
  assert.ok(html.includes("&lt;img"));
});
