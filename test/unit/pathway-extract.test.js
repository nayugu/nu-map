// ═══════════════════════════════════════════════════════════════════
// PATHWAY EXTRACTION — hostile tests.
//
// The extractor writes DRAFT pathway data from a published page. What it gets
// wrong reaches a student's degree, so most of what is tested here is its
// refusal to guess: no shares, no rules, and a loud todo whenever a page has the
// shape that has already fooled it once.
// ═══════════════════════════════════════════════════════════════════

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  extractTables, isEligibilityTable, eligibilityFromRow, coursesFromRow, buildDraft,
} from "../../scripts/lib/pathway-extract.js";
import { matchesEligibility } from "../../src/core/pathway/select.js";

/** A page shaped like the engineering ones: heading, eligibility table, courses. */
const enginePage = ({ concentration = "General", majors = [], courses = [] } = {}) => `
  <h2>PlusOne with MS in Mechanical Engineering, Concentration in ${concentration}</h2>
  <h4>Acceptable Undergraduate Pathways</h4>
  <table>
    <tr><th>Eligible Undergrad Majors</th><th>Additional Prerequisites</th></tr>
    ${majors.map(([m, p]) => `<tr><td>${m}</td><td>${p ?? ""}</td></tr>`).join("")}
  </table>
  <table>${courses.map(c => `<tr><td>${c}</td><td>Some Title</td><td>4 SH</td></tr>`).join("")}</table>`;

// ═══════════════════════════════════════════════════════════════════
describe("eligible-major rows become eligibility RULES", () => {
  test("'(and all combined majors)' becomes a name match", () => {
    const e = eligibilityFromRow(["BS in Bioengineering (and all combined majors)", ""]);
    assert.equal(e.nameIncludes, "Bioengineering");
    assert.equal(e.combined, true);
  });

  // The translation that matters: NEU names a combined major after both halves,
  // so a name match is what "all combined majors" actually means.
  test("and that rule really does catch the combined majors", () => {
    const e = eligibilityFromRow(["BS in Bioengineering (and all combined majors)", ""]);
    for (const label of ["Bioengineering, BSBioE (Boston)",
                         "Bioengineering and Biochemistry, BSBioE (Boston)",
                         "Chemical Engineering and Bioengineering, BSChE (Boston)"]) {
      assert.equal(matchesEligibility({ id: "2026/engineering/x", label }, e), true, label);
    }
    assert.equal(matchesEligibility(
      { id: "2026/health-sciences/n", label: "Nursing, BSN (Boston)" }, e), false);
  });

  test("per-major prerequisites are captured, in both code spellings", () => {
    assert.deepEqual(eligibilityFromRow(["BS in Chemical Engineering", "ME 2355, ME 2350"]).prereqs,
                     ["ME 2355", "ME 2350"]);
    assert.deepEqual(eligibilityFromRow(["BS in X", "EECE2150 , EECE2412"]).prereqs,
                     ["EECE 2150", "EECE 2412"]);
  });

  test("a home-college hint is recorded, not folded into the name", () => {
    const e = eligibilityFromRow(["BS in Computer Science (Khoury)", ""]);
    assert.equal(e.nameIncludes, "Computer Science");
    assert.equal(e.homeCollege, "Khoury");
  });

  test("every degree spelling loses its prefix", () => {
    for (const [raw, want] of [["BS in Physics", "Physics"], ["BSCS Computer Science", "Computer Science"],
                               ["BACS Computer Science", "Computer Science"], ["BS Data Science", "Data Science"]]) {
      assert.equal(eligibilityFromRow([raw, ""]).nameIncludes, want, raw);
    }
  });

  test("no prerequisites means no `prereqs` key, not an empty one", () => {
    assert.equal("prereqs" in eligibilityFromRow(["BS in Industrial Engineering", ""]), false);
  });

  test("an empty row yields nothing rather than a rule matching everything", () => {
    for (const row of [[""], ["   ", "ME 2355"], []]) {
      assert.equal(eligibilityFromRow(row), null, JSON.stringify(row));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("tables are identified and attributed to their concentration", () => {
  test("the eligibility table is recognised by its header", () => {
    const [t] = extractTables(enginePage({ majors: [["BS in X", ""]] })).filter(isEligibilityTable);
    assert.ok(t);
    assert.equal(isEligibilityTable({ rows: [["Course", "Title"]] }), false);
  });

  // The bug this pins was mine and it shipped into the first run: MIE repeats
  // "Acceptable Undergraduate Pathways" above all five concentration tables, so
  // taking the NEAREST heading merged them and unioned their prerequisites.
  test("a generic nearest heading is skipped for the concentration above it", () => {
    const [t] = extractTables(enginePage({ concentration: "Materials Science", majors: [["BS in X", ""]] }));
    assert.match(t.heading, /Concentration in Materials Science/);
    assert.notEqual(t.heading, "Acceptable Undergraduate Pathways");
  });

  test("course rows are read with their credits", () => {
    const c = coursesFromRow(["ME 6200", "Mathematical Methods", "4 SH"]);
    assert.deepEqual(c.codes, ["ME 6200"]);
    assert.equal(c.sh, 4);
    assert.equal(coursesFromRow(["Some prose", "no codes"]), null);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("the draft refuses to guess, loudly", () => {
  const page = enginePage({
    majors: [["BS in Bioengineering (and all combined majors)", "ME 2355"],
             ["BS in Civil Engineering (and all combined majors)", ""]],
    courses: ["ME 6200", "ME 5250"],
  });

  test("it never emits shares — the mapping is a judgement call", () => {
    const { draft } = buildDraft({ url: "https://x.edu/p/", html: page });
    assert.deepEqual(draft.shares, []);
    assert.match(draft.todo.join(" "), /SHARES are not extracted/);
  });

  test("it never emits rules beyond the universal cap and caveat", () => {
    const { draft } = buildDraft({ url: "https://x.edu/p/", html: page });
    assert.deepEqual(draft.rules.map(r => r.kind).sort(),
                     ["admissionNotGuaranteed", "shareCap"]);
    assert.match(draft.todo.join(" "), /RULES are not extracted/);
  });

  test("it marks itself derived and dated, never `published`", () => {
    const { draft } = buildDraft({ url: "https://x.edu/p/", html: page, today: "2026-08-13" });
    assert.equal(draft.confidence, "derived");
    assert.equal(draft.source.retrievedAt, "2026-08-13");
    assert.equal(draft.source.url, "https://x.edu/p/");
  });

  test("it leaves msPrograms empty — the page does not state an id", () => {
    assert.deepEqual(buildDraft({ url: "https://x.edu/p/", html: page }).draft.msPrograms, []);
  });

  // The guard that must not depend on the heading logic working, because the
  // heading logic is exactly what failed silently the first time.
  test("MULTIPLE eligibility tables always raise a todo, however they group", () => {
    const twoSameHeading = `
      <h4>Acceptable Undergraduate Pathways</h4>
      <table><tr><th>Eligible Undergrad Majors</th><th>Additional Prerequisites</th></tr>
        <tr><td>BS in Bioengineering</td><td>ME 2340</td></tr></table>
      <h4>Acceptable Undergraduate Pathways</h4>
      <table><tr><th>Eligible Undergrad Majors</th><th>Additional Prerequisites</th></tr>
        <tr><td>BS in Bioengineering</td><td>ME 9999</td></tr></table>`;
    const { draft } = buildDraft({ url: "https://x.edu/p/", html: twoSameHeading });
    assert.match(draft.todo.join(" "), /ONE PER MS CONCENTRATION/);
  });

  test("a single table raises no such todo", () => {
    const { draft } = buildDraft({ url: "https://x.edu/p/", html: page });
    assert.ok(!/ONE PER MS CONCENTRATION/.test(draft.todo.join(" ")));
  });

  test("prerequisites from several tables are kept, never silently dropped", () => {
    const two = `
      <h2>Concentration in A</h2><table>
        <tr><th>Eligible Undergrad Majors</th><th>Additional Prerequisites</th></tr>
        <tr><td>BS in Bioengineering</td><td>ME 2340</td></tr></table>
      <h2>Concentration in B</h2><table>
        <tr><th>Eligible Undergrad Majors</th><th>Additional Prerequisites</th></tr>
        <tr><td>BS in Bioengineering</td><td>ME 9999</td></tr></table>`;
    const { draft } = buildDraft({ url: "https://x.edu/p/", html: two });
    const bio = draft.eligibility.find(e => e.nameIncludes === "Bioengineering");
    assert.deepEqual(bio.prereqs.sort(), ["ME 2340", "ME 9999"]);
  });

  // Khoury states eligibility in PROSE. Producing nothing and saying so is the
  // correct outcome; inventing a list from the page's course table is not.
  test("a page with no eligibility table yields none and says so", () => {
    const prose = `<h1>PlusOne with MS in CS</h1>
      <p>Students pursuing a Khoury College undergraduate degree program, in both
      core and combined majors, are eligible.</p>
      <table><tr><td>CS 3000</td><td>CS 5800</td></tr></table>`;
    const { draft } = buildDraft({ url: "https://x.edu/p/", html: prose });
    assert.deepEqual(draft.eligibility, []);
    assert.match(draft.todo.join(" "), /No eligible-majors table found/);
  });

  test("junk HTML produces an empty draft rather than throwing", () => {
    for (const html of ["", null, undefined, "<html>", "not html at all"]) {
      const { draft } = buildDraft({ url: "https://x.edu/p/", html });
      assert.deepEqual(draft.eligibility, []);
      assert.ok(draft.todo.length >= 2);
    }
  });
});
