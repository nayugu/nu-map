// CONTRACT · GPA rules → constraints, against the four page shapes found in
// the corpus census (docs/grades-design.md). Synthetic minimal HTML rather
// than fixtures: each shape is a few rows, and what breaks here is grammar,
// not page structure.
//
// The invariant under all of it: a GPA rule is a CONSTRAINT over grades,
// never a requirement a course can satisfy — the old parser turned
// "these four courses must average to C" into "pick 1 of 4" on 24 programs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'node-html-parser';
import { parseRequirements, parseGpaRule, parseCatalogEdition, UNDERGRAD_PROFILE, GRAD_PROFILE }
  from '../../scripts/lib/catalog-program-parser.js';

// ── catalog edition year ─────────────────────────────────────────────────────
// Programs are frozen per catalog year, so the year a scrape writes into must
// come from the page, never the clock: a January run would invent a phantom
// year, and a run after NEU rolls the edition would overwrite the previous
// year's snapshot — destroying the requirements older cohorts follow.

test('edition › "2025-2026 Edition" is stored as its ENDING year', () => {
  assert.equal(parseCatalogEdition(parse('<html><body><div>2025-2026 Edition</div></body></html>')), 2026);
  assert.equal(parseCatalogEdition(parse('<html><body>Catalog 2031-2032 Edition here</body></html>')), 2032);
});

test('edition › junk never yields a year (the scraper falls back loudly)', () => {
  for (const html of [
    '<html><body>no edition label</body></html>',
    '<html><body>2025-2030 Edition</body></html>',   // not consecutive
    '<html><body>1899-1900 Edition</body></html>',   // outside the window
    '<html><body>2026 Edition</body></html>',        // single year
  ]) assert.equal(parseCatalogEdition(parse(html)), null, html);
});

const page = body => parse(`<html><body><div id="programrequirementstextcontainer">${body}</div></body></html>`);

const courseRow = (subj, num, title) => `
  <tr><td class="codecol"><a href="#" title="${subj} ${num}" class="bubblelink code">${subj}&#160;${num}</a></td>
      <td>${title}</td><td class="hourscol">4</td></tr>`;

// ── grammar (the census phrasings, one per shape) ────────────────────────────

test('gpa grammar › every census phrasing lands in the right scope', () => {
  const CASES = [
    ["Grades in the following courses must average to a minimum of C (2.000):", "courses", 2],
    ["Minimum cumulative 2.000 GPA required in all CS, CY, DS, and IS courses", "subjects", 2],
    ["Minimum 2.000 GPA required in CS, CY, DS, and IS courses", "subjects", 2],
    ["Minimum 2.750 GPA required in all AMSL, INTP, and DEAF courses", "subjects", 2.75],
    // The engineering phrasings the first recall audit missed:
    ["Minimum 2.000 GPA required in CHME coursework", "subjects", 2],
    ["Minimum 2.000 GPA required in all CIVE coursework", "subjects", 2],
    ["Minimum 2.000 GPA required in ME/MEIE/EECE/ENCP coursework", "subjects", 2],
    ["Minimum 2.000 GPA required in all CS, CY, DS, IS", "subjects", 2],   // no suffix
    ["Minimum 2.000 GPA required in IE, ME,and MEIE courses", "subjects", 2], // missing space
    // Inverted order (a few engineering pages) — and the co-op form that
    // must NOT parse (an application bar, not a degree rule):
    ["2.000 minimum GPA required in all BIOE coursework", "subjects", 2],
    ["2.000 minimum GPA required in  CIVE coursework", "subjects", 2],       // double space
    ["A minimum GPA of 3.000 is required in order to apply", null, null],
    ["Minimum 3.000 GPA required", "cumulative", 3],
    ["2.000 GPA required in the minor", "program", 2],          // the dominant minor form: no "Minimum"
    ["Minimum 3.000 GPA required in all major courses", "program", 3],
    ["Minimum 2.000 GPA required in all business courses", "described", 2],  // fuzzy: never guessed
    ["Minimum 2.000 GPA required in anthropology and philosophy courses", "described", 2],
    ["cumulative 3.500 GPA is required for the core requirement", "described", 3.5], // "for": not a floor
    // Spelled-out "grade-point average" + "or higher" (Studio Art BFA's actual catalog
    // sentence) — same "for" → described handling as the abbreviated GPA form above.
    ["A cumulative grade-point average of 2.500 or higher is required for the art history requirements.", "described", 2.5],
    ["Minimum 2.000 GPA required in all courses completed", "cumulative", 2],
    ["Complete one of the following:", null, null],
    ["Select 12 credit hours from the following", null, null],
  ];
  for (const [text, kind, threshold] of CASES) {
    const r = parseGpaRule(text);
    if (kind === null) { assert.equal(r, null, text); continue; }
    assert.ok(r, text);
    assert.equal(r.scope.kind, kind, text);
    assert.ok(Math.abs(r.threshold - threshold) < 1e-9, text);
  }
  const subj = parseGpaRule("Minimum cumulative 2.000 GPA required in all CS, CY, DS, and IS courses");
  assert.deepEqual(subj.scope.subjects, ["CS", "CY", "DS", "IS"]);
});

// ── shape 1: areaheader + comment + courses in one table (PSPE) ──────────────

test('gpa shapes › tabled course-set average becomes a constraint, not a pick-1 section', () => {
  const r = ug(`
    <h2>Requirements</h2>
    <table class="sc_courselist"><tbody>
      <tr class="even areaheader firstrow"><td colspan="2"><span class="courselistcomment areaheader">Required Courses</span></td><td class="hourscol"></td></tr>
      ${courseRow("ECON", "1115", "Macro")}
      <tr class="even areaheader"><td colspan="2"><span class="courselistcomment areaheader">Economics GPA Requirement</span></td><td class="hourscol"></td></tr>
      <tr class="odd"><td colspan="2"><span class="courselistcomment">Grades in the following courses must average to a minimum of C (2.000):</span></td><td class="hourscol"></td></tr>
      ${courseRow("ECON", "2315", "Macro Theory")}
      ${courseRow("ECON", "2316", "Micro Theory")}
    </tbody></table>`);
  assert.equal(r.gpaConstraints.length, 1);
  const c = r.gpaConstraints[0];
  assert.equal(c.title, "Economics GPA Requirement");
  assert.equal(c.threshold, 2);
  assert.equal(c.scope.kind, "courses");
  assert.deepEqual(c.courses, [
    { subject: "ECON", classId: 2315 }, { subject: "ECON", classId: 2316 },
  ]);
  // and it left requirementSections entirely — no phantom requirement
  assert.deepEqual(r.requirementSections.map(s => s.title), ["Required Courses"]);
  assert.ok(!JSON.stringify(r.requirementSections).includes("_comments"));
});

// ── shape 2: comment-only areaheader group (Khoury subjects rule) ────────────

test('gpa shapes › comment-only subject-scoped group becomes a subjects constraint', () => {
  const r = ug(`
    <h2>Requirements</h2>
    <table class="sc_courselist"><tbody>
      ${courseRow("CS", "2000", "Intro")}
      <tr class="even areaheader"><td colspan="2"><span class="courselistcomment areaheader">Khoury College GPA Requirement</span></td><td class="hourscol"></td></tr>
      <tr class="odd"><td colspan="2"><span class="courselistcomment">Minimum cumulative 2.000 GPA required in all CS, CY, DS, and IS courses</span></td><td class="hourscol"></td></tr>
    </tbody></table>`);
  assert.equal(r.gpaConstraints.length, 1);
  assert.deepEqual(r.gpaConstraints[0].scope, { kind: "subjects", subjects: ["CS", "CY", "DS", "IS"] });
  assert.equal(r.gpaConstraints[0].threshold, 2);
  // the shell never reaches requirementSections
  assert.equal(r.requirementSections.length, 1);
});

// ── shape 3: heading + <p> + following table (CS+Econ combined majors) ───────

test('gpa shapes › heading/para/table split merges into ONE constraint with both halves', () => {
  const r = ug(`
    <h3>Economics GPA Requirement</h3>
    <p>Grades in the following required Economics courses must average to a minimum of C (2.000):</p>
    <table class="sc_courselist"><tbody>
      ${courseRow("ECON", "2315", "Macro Theory")}
      ${courseRow("ECON", "2316", "Micro Theory")}
    </tbody></table>`);
  assert.equal(r.gpaConstraints.length, 1, JSON.stringify(r.gpaConstraints));
  const c = r.gpaConstraints[0];
  assert.equal(c.threshold, 2);                    // from the paragraph
  assert.equal(c.courses.length, 2);               // from the table
  assert.equal(r.requirementSections.length, 0);
});

// ── shape 4: bare <h2> + <p> prose (the grad/minor standard) ─────────────────

test('gpa shapes › prose-only Program Credit/GPA Requirements block', () => {
  const r = grad(`
    <h2>Requirements</h2>
    <table class="sc_courselist"><tbody>${courseRow("INPR", "5120", "Practicum")}</tbody></table>
    <h2>Program Credit/GPA Requirements</h2>
    <p>12 total semester hours required</p>
    <p>Minimum 3.000 GPA required</p>`);
  assert.equal(r.gpaConstraints.length, 1);
  assert.deepEqual(r.gpaConstraints[0].scope, { kind: "cumulative" });
  assert.equal(r.gpaConstraints[0].threshold, 3);
});

// ── the guards ────────────────────────────────────────────────────────────────

test('gpa shapes › admission GPAs are NOT degree constraints', () => {
  const r = grad(`
    <h2>Requirements</h2>
    <table class="sc_courselist"><tbody>${courseRow("CS", "5010", "PDP")}</tbody></table>
    <h2>Admission Requirements</h2>
    <p>Minimum 3.500 GPA required</p>`);
  assert.equal(r.gpaConstraints.length, 0);
});

test('gpa shapes › ordinary sections are untouched and carry no scratch keys', () => {
  const r = ug(`
    <h2>Requirements</h2>
    <table class="sc_courselist"><tbody>
      <tr class="odd"><td colspan="2"><span class="courselistcomment">Complete one of the following:</span></td><td class="hourscol"></td></tr>
      ${courseRow("CS", "2000", "Intro")}
      ${courseRow("CS", "2100", "PDP")}
    </tbody></table>`);
  assert.equal(r.gpaConstraints.length, 0);
  assert.equal(r.requirementSections.length, 1);
  assert.ok(!JSON.stringify(r.requirementSections).includes("_comments"));
});

function ug(body)   { return parseRequirements(page(body), UNDERGRAD_PROFILE); }
function grad(body) { return parseRequirements(page(body), GRAD_PROFILE); }
