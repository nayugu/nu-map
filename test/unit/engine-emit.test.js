// CHART's shape inheritance, refusal gate and emitter — the three modules with no
// unit coverage until now, and the ones a corpus test cannot pin down because it only
// ever sees the shapes the real catalog happens to contain.
import test from "node:test";
import assert from "node:assert/strict";
import { shapeFromPlan, defaultShape, studyTerms, firstWorkBoundary } from "../../src/engine/shape.js";
import { emitPlan, cellLabel, MAX_NAMED_OPTIONS } from "../../src/engine/emit.js";
import { preflight, MAX_DERIVED_GE_SHARE } from "../../src/engine/preflight.js";
import { permissivePorts } from "../../src/engine/ports.js";
import { cellSubject, majorSubjectsOf } from "../../src/engine/subjects.js";
import { GENERAL_ELECTIVE, CONCENTRATION } from "../../src/core/requirementDemand.js";

const course = (id, sh = 4) => ({
  id, subject: id.replace(/\d.*/, ""), number: id.replace(/^\D+/, ""), sh,
});
const CM = Object.fromEntries([
  course("CS1800"), course("CS1802", 1), course("CS4300"), course("CS4100"),
  course("MATH1341"), course("PT5410"), course("PT5411"), course("PSYC3200"),
].map(c => [c.id, c]));

const entry = (text, opts) => ({ text, sh: 4, options: opts ?? [] });
const year = (label, terms) => ({ label, terms });
const term = (t, type, hours, entries) => ({ term: t, type, hours, entries });

// ── shapeFromPlan ──────────────────────────────────────────────────

test("shape › a term with courses is a study term", () => {
  const s = shapeFromPlan({ label: "Four Years", years: [
    year("Year 1", [term("Fall", "fall", 16, [entry("CS 1800", [["CS1800"]])])]),
  ] });
  assert.equal(s.terms.length, 1);
  assert.equal(s.terms[0].work, false);
  assert.equal(s.terms[0].unused, false);
  assert.equal(s.terms[0].targetSH, 16);
  assert.equal(studyTerms(s).length, 1);
});

test("shape › a term with only co-op cells is a WORK term and never holds a cell", () => {
  const s = shapeFromPlan({ years: [
    year("Year 2", [term("Spring", "spring", 0, [{ text: "Co-op", coop: true }])]),
  ] });
  assert.equal(s.terms[0].work, true);
  assert.equal(s.terms[0].targetSH, 0);
  assert.equal(studyTerms(s).length, 0, "a work term is not placeable at all");
});

test("shape › a term with a co-op AND a course is a study term", () => {
  // Mixed terms exist, and the student is registered either way.
  const s = shapeFromPlan({ years: [
    year("Year 2", [term("Fall", "fall", 4, [
      { text: "Co-op", coop: true }, entry("CS 1800", [["CS1800"]]),
    ])]),
  ] });
  assert.equal(s.terms[0].work, false);
});

test("shape › an EMPTY term is unused, and optional rather than excluded", () => {
  // It used to be treated as a study term, which scheduled 8 SH into a summer the
  // catalog prints as vacation. It is now optional: available when availability
  // leaves a cell nowhere else, tried last otherwise.
  const s = shapeFromPlan({ years: [
    year("Year 1", [
      term("Fall", "fall", 16, [entry("CS 1800", [["CS1800"]])]),
      term("Summer 2", "sumB", 0, []),
    ]),
  ] });
  assert.equal(s.terms[1].unused, true);
  assert.equal(s.terms[1].targetSH, 0);
  const study = studyTerms(s);
  assert.equal(study.length, 2, "included, because availability outranks the shape");
  assert.equal(study[1].optional, true);
  assert.notEqual(study[0].optional, true);
});

test("shape › a vacation or heading row is a label, not content", () => {
  const s = shapeFromPlan({ years: [
    year("Year 1", [term("Summer 1", "sumA", 0, [
      { text: "Vacation", vacation: true }, { text: "Choose one", heading: true },
    ])]),
  ] });
  assert.equal(s.terms[0].unused, true);
});

test("shape › the stated hours win over the summed cells, and 0 falls back", () => {
  const stated = shapeFromPlan({ years: [year("Y", [term("Fall", "fall", 19,
    [entry("a", [["CS1800"]]), entry("b", [["CS4300"]])])])] });
  assert.equal(stated.terms[0].targetSH, 19, "the department's own number");
  const summed = shapeFromPlan({ years: [year("Y", [term("Fall", "fall", 0,
    [entry("a", [["CS1800"]]), entry("b", [["CS4300"]])])])] });
  assert.equal(summed.terms[0].targetSH, 8, "no stated hours, so sum the cells");
});

test("shape › malformed plans do not throw", () => {
  for (const p of [null, undefined, {}, { years: null }, { years: [] },
                   { years: [null] }, { years: [{ terms: null }] },
                   { years: [{ terms: [{}] }] },
                   { years: [{ terms: [{ entries: null }] }] }]) {
    assert.doesNotThrow(() => { const s = shapeFromPlan(p); studyTerms(s); firstWorkBoundary(s); },
      String(JSON.stringify(p)));
  }
});

test("firstWorkBoundary › counts STUDY terms before the first co-op", () => {
  const s = shapeFromPlan({ years: [year("Y1", [
    term("Fall", "fall", 16, [entry("a", [["CS1800"]])]),
    term("Spring", "spring", 16, [entry("b", [["CS4300"]])]),
    term("Summer 1", "sumA", 0, [{ text: "Co-op", coop: true }]),
    term("Summer 2", "sumB", 8, [entry("c", [["CS4100"]])]),
  ])] });
  assert.equal(firstWorkBoundary(s), 2, "two study terms precede the co-op");
});

test("firstWorkBoundary › a plan with no co-op has the whole plan before it", () => {
  const s = shapeFromPlan({ years: [year("Y1", [
    term("Fall", "fall", 16, [entry("a", [["CS1800"]])]),
  ])] });
  assert.equal(firstWorkBoundary(s), 1);
});

// ── defaultShape ───────────────────────────────────────────────────

test("defaultShape › fits the credit it is given without exceeding the cap", () => {
  const s = defaultShape({ totalSH: 128, maxTermSH: 19, targetTermSH: 16 });
  const study = studyTerms(s);
  assert.ok(study.length >= 8, `only ${study.length} terms for 128 SH`);
  assert.ok(study.reduce((n, t) => n + t.targetSH, 0) >= 128);
  for (const t of study) assert.ok(t.targetSH <= 19 * (t.weight ?? 1));
  assert.equal(s.source, "derived");
});

test("defaultShape › degenerate inputs still produce a usable skeleton", () => {
  for (const args of [{}, { totalSH: 0 }, { totalSH: -50 }, { totalSH: 4, maxTermSH: 0 },
                      { totalSH: 1000, maxTermSH: 19, targetTermSH: 16 }]) {
    const s = defaultShape(args);
    assert.ok(studyTerms(s).length >= 1, JSON.stringify(args));
    for (const t of s.terms) assert.ok(Number.isFinite(t.targetSH) && t.targetSH >= 0);
  }
});

// ── cellLabel ──────────────────────────────────────────────────────

test("cellLabel › singularises a recognised trailing plural", () => {
  assert.equal(cellLabel("Mathematics Electives"), "Mathematics Elective");
  assert.equal(cellLabel("Khoury Approved Electives"), "Khoury Approved Elective");
  assert.equal(cellLabel("Supporting Courses"), "Supporting Course");
  assert.equal(cellLabel("Writing Requirements"), "Writing Requirement");
});

test("cellLabel › leaves a subject that merely ends in s alone", () => {
  // Blind de-pluralisation is the trap: these are names, not counts.
  for (const s of ["Statistics", "Physics", "Media and Screen Studies",
                   "Economics", "Politics", "Mathematics"]) {
    assert.equal(cellLabel(s), s);
  }
});

test("cellLabel › never returns an empty string", () => {
  // An empty label cannot be matched — `resolveRequirement` refuses a blank title,
  // and a blank card header renders as nothing at all.
  for (const s of ["", "   ", null, undefined]) assert.equal(cellLabel(s), "Elective");
});

// ── emitPlan ───────────────────────────────────────────────────────

const shapeOf = (terms) => ({
  source: "published", pattern: "Test", label: "T",
  terms: terms.map((t, i) => ({
    semTypeId: t.type, yearIndex: t.yearIndex ?? 0,
    label: `Year ${(t.yearIndex ?? 0) + 1}`, termLabel: t.term,
    work: !!t.work, unused: !!t.unused, targetSH: t.targetSH ?? 16, weight: t.weight ?? 1,
  })),
});
const cellOf = (over) => ({ id: "c", target: 0, title: "T", sh: 4, kind: "open", groups: null, spec: null, ...over });
const planOf = (cell) => ({ cell, domain: [0], candidates: null, minDepth: 0 });

const emit = (cells, terms, termOf, program = { requirementSections: [{ title: "T" }] }) =>
  emitPlan({ shape: shapeOf(terms), plans: cells.map(planOf), termOf: new Map(termOf),
             program, courseMap: CM });

test("emit › a named cell becomes one option group, spaced as the catalog prints it", () => {
  const doc = emit([cellOf({ kind: "named", groups: [["CS1800", "CS1802"]], sh: 5 })],
                   [{ term: "Fall", type: "fall" }], [["c", 0]]);
  const e = doc.plans[0].years[0].terms[0].entries[0];
  assert.equal(e.text, "CS 1800 and CS 1802");
  assert.deepEqual(e.options, [["CS1800", "CS1802"]]);
  assert.equal(e.sh, 5);
});

test("emit › a same-subject choice drops the repeated subject", () => {
  const doc = emit([cellOf({ kind: "choice", groups: [["CS4300"], ["CS4100"]] })],
                   [{ term: "Fall", type: "fall" }], [["c", 0]]);
  assert.equal(doc.plans[0].years[0].terms[0].entries[0].text, "CS 4300 or 4100");
});

test("emit › a cross-subject or grouped choice states everything", () => {
  const doc = emit([cellOf({ kind: "choice", groups: [["PSYC3200"], ["PT5410", "PT5411"]] })],
                   [{ term: "Fall", type: "fall" }], [["c", 0]]);
  const t = doc.plans[0].years[0].terms[0].entries[0].text;
  assert.match(t, /PSYC 3200 or PT 5410 and PT 5411/);
});

test("emit › a work term emits a co-op cell, or the plan loses it entirely", () => {
  const doc = emit([], [{ term: "Spring", type: "spring", work: true }], []);
  const entries = doc.plans[0].years[0].terms[0].entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].coop, true);
});

test("emit › a general elective travels as the sentinel, not as a section index", () => {
  const doc = emit([cellOf({ target: GENERAL_ELECTIVE, title: "General Elective" })],
                   [{ term: "Fall", type: "fall" }], [["c", 0]]);
  const e = doc.plans[0].years[0].terms[0].entries[0];
  assert.deepEqual(e.binding, { targets: [GENERAL_ELECTIVE], forced: true });
  assert.deepEqual(e.options, []);
});

test("emit › a bounded open cell names its options so it stays bounded downstream", () => {
  const spec = { keys: new Set(["CS4300", "CS4100"]), ranges: [] };
  const doc = emit([cellOf({ spec, title: "Khoury Electives" })],
                   [{ term: "Fall", type: "fall" }], [["c", 0]]);
  const e = doc.plans[0].years[0].terms[0].entries[0];
  assert.equal(e.text, "Khoury Elective", "singularised for reading");
  assert.deepEqual(e.options, [["CS4100"], ["CS4300"]], "sorted, so output is deterministic");
});

test("emit › a pool too wide to name is described instead", () => {
  const keys = new Set(Array.from({ length: MAX_NAMED_OPTIONS + 5 }, (_, i) => `X${1000 + i}`));
  for (const id of keys) CM[id] = course(id);
  const doc = emit([cellOf({ spec: { keys, ranges: [] }, title: "Wide Electives" })],
                   [{ term: "Fall", type: "fall" }], [["c", 0]]);
  assert.deepEqual(doc.plans[0].years[0].terms[0].entries[0].options, []);
  for (const id of keys) delete CM[id];
});

test("emit › a multi-target binding is not marked forced", () => {
  // Several numeric targets is split credit, not ambiguity — but a downstream reader
  // must not mistake the list for a confident single answer.
  const doc = emit([cellOf({ kind: "named", groups: [["CS1800"]], target: 0, alsoAnswers: [1] })],
                   [{ term: "Fall", type: "fall" }], [["c", 0]],
                   { requirementSections: [{ title: "A" }, { title: "B" }] });
  const e = doc.plans[0].years[0].terms[0].entries[0];
  assert.deepEqual(e.binding.targets, [0, 1]);
  assert.equal(e.binding.forced, false);
});

test("emit › term hours are the sum of what the term actually holds", () => {
  const doc = emit(
    [cellOf({ id: "a", kind: "named", groups: [["CS1800"]], sh: 4 }),
     cellOf({ id: "b", kind: "named", groups: [["CS1802"]], sh: 1 })],
    [{ term: "Fall", type: "fall" }], [["a", 0], ["b", 0]]);
  assert.equal(doc.plans[0].years[0].terms[0].hours, 5);
});

test("emit › a plan always carries a pattern, since the UI keys variants on it", () => {
  const doc = emit([], [{ term: "Fall", type: "fall" }], []);
  assert.equal(typeof doc.plans[0].pattern, "string");
  assert.equal(doc.plans[0].generated, true);
});

// ── preflight ──────────────────────────────────────────────────────

const pf = (over) => preflight({
  programData: { totalCreditsRequired: 100, requirementSections: [{ title: "A" }], ...over.programData },
  cells: over.cells ?? [{ id: "c", target: 0, sh: 4 }],
  shape: over.shape ?? shapeOf([{ term: "Fall", type: "fall", targetSH: 100 }]),
  ports: permissivePorts({ creditMax: () => 19 }),
  studentType: "undergraduate",
  impossible: over.impossible ?? [],
});

test("preflight › refuses a program with no requirement sections", () => {
  assert.equal(pf({ programData: { requirementSections: [] } })?.reason, "no-requirements");
});

test("preflight › refuses a program that states no total credit", () => {
  assert.equal(pf({ programData: { totalCreditsRequired: 0 } })?.reason, "no-total-credits");
});

test("preflight › refuses when the degree would be mostly placeholder", () => {
  const cells = Array.from({ length: 20 }, (_, i) =>
    ({ id: `g${i}`, target: GENERAL_ELECTIVE, sh: 4, derivedBucket: true }));
  const r = pf({ cells });
  assert.equal(r?.reason, "mostly-unlabelled");
  assert.ok(r.data.share > MAX_DERIVED_GE_SHARE);
});

test("preflight › a STATED elective bucket is evidence, not a gap", () => {
  const cells = Array.from({ length: 20 }, (_, i) =>
    ({ id: `g${i}`, target: GENERAL_ELECTIVE, sh: 4 }));   // no derivedBucket
  // Six full terms, or the capacity gate fires first and tells us nothing about the
  // one being tested. A fixture that trips an earlier gate is not a test.
  const shape = shapeOf(Array.from({ length: 6 }, (_, i) =>
    ({ term: "Fall", type: "fall", yearIndex: i, targetSH: 16 })));
  assert.equal(pf({ cells, shape }), null);
});

test("preflight › refuses when the requirements exceed the degree", () => {
  const cells = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, target: 0, sh: 4 }));
  const r = pf({ cells });
  assert.equal(r?.reason, "sections-exceed-degree");
  assert.ok(r.data.over > 0);
});

test("preflight › concentration credit counts toward the degree", () => {
  // Excluding it let one program through at 140 credits for a 133-credit degree.
  const cells = [
    ...Array.from({ length: 25 }, (_, i) => ({ id: `c${i}`, target: 0, sh: 4 })),
    ...Array.from({ length: 8 }, (_, i) => ({ id: `k${i}`, target: CONCENTRATION, sh: 4 })),
  ];
  assert.equal(pf({ cells })?.reason, "sections-exceed-degree");
});

test("preflight › refuses when the shape cannot hold the credit", () => {
  const cells = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, target: 0, sh: 4 }));
  const r = pf({ cells, shape: shapeOf([{ term: "Fall", type: "fall", targetSH: 16 }]),
                 programData: { totalCreditsRequired: 80 } });
  assert.equal(r?.reason, "does-not-fit");
  assert.ok(r.data.need > r.data.room);
});

test("preflight › names the cell nothing can place, and why", () => {
  const r = pf({ impossible: [{ cell: "x", title: "Capstone", reason: "prereq-chain-longer-than-plan" }] });
  assert.equal(r?.reason, "cell-has-no-legal-term");
  assert.match(r.detail, /Capstone/);
  assert.match(r.detail, /prereq-chain-longer-than-plan/);
});

test("preflight › every refusal carries a readable sentence", () => {
  for (const args of [{ programData: { requirementSections: [] } },
                      { programData: { totalCreditsRequired: 0 } },
                      { cells: [] },
                      { impossible: [{ cell: "x", title: "T", reason: "r" }] }]) {
    const r = pf(args);
    assert.ok(r, JSON.stringify(args));
    assert.ok(/[a-z]{4}/.test(r.detail), `"${r.detail}" is not a sentence`);
  }
});

test("preflight › a plannable program is allowed through", () => {
  assert.equal(pf({}), null);
});

// ── subjects ───────────────────────────────────────────────────────

test("cellSubject › one subject across every option, or null", () => {
  assert.equal(cellSubject({ cell: { groups: [["CS4300"], ["CS4100"]] } }, CM), "CS");
  assert.equal(cellSubject({ cell: { groups: [["CS4300"], ["MATH1341"]] } }, CM), null);
  assert.equal(cellSubject({ cell: { groups: null }, candidates: null }, CM), null);
});

test("cellSubject › a pool is about a subject only if most of it is", () => {
  assert.equal(cellSubject({ cell: {}, candidates: ["CS1800", "CS4300", "MATH1341"] }, CM), "CS");
  assert.equal(cellSubject({ cell: {}, candidates: ["CS1800", "MATH1341", "PT5410", "PSYC3200"] }, CM), null);
});

test("majorSubjectsOf › a subject carrying enough cells is a major", () => {
  const cells = [
    ...["CS1800", "CS1802", "CS4300", "CS4100"].map((id, i) =>
      ({ cell: { id: `c${i}`, kind: "named", groups: [[id]] }, candidates: [id] })),
    { cell: { id: "w", kind: "named", groups: [["MATH1341"]] }, candidates: ["MATH1341"] },
  ];
  const majors = majorSubjectsOf(cells, CM);
  assert.ok(majors.has("CS"));
  assert.equal(majors.has("MATH"), false, "one cell is a service requirement, not a major");
});

test("majorSubjectsOf › a small program still has a major", () => {
  const cells = [{ cell: { id: "a", kind: "named", groups: [["MATH1341"]] }, candidates: ["MATH1341"] }];
  assert.deepEqual([...majorSubjectsOf(cells, CM)], ["MATH"]);
});

test("majorSubjectsOf › a program of pure general electives has none", () => {
  const cells = [{ cell: { id: "a", kind: "open", groups: null }, candidates: null }];
  assert.equal(majorSubjectsOf(cells, CM).size, 0);
});
