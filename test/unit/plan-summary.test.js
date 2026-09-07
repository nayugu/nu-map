// ═══════════════════════════════════════════════════════════════════
// The clipboard plan summary, assembled end to end.
//
// `buildPlanSummary` is reached from exactly one place — a click handler in
// Header.jsx — so nothing in Node exercised it before this file, and a green
// suite would have said nothing about whether the button works. That is the
// shape of failure this repo has already paid for once (a `const` read before
// its initializer in PlannerContext shipped through 2,018 passing tests).
//
// So these run the real function over stub adapters and assert the PROPERTIES
// the summary is for:
//
//   · the appendix is gone and the pointer that replaced it is present, which
//     is the whole change: 88% of the paste was catalog prose;
//   · a satisfied requirement section is omitted and an outstanding one is not;
//   · a term names itself "Summer A", never the grid's "Summer 1";
//   · the work-term course a plan REGISTERS survives, because it is the only
//     reason the term satisfies anything and it appears in no course row;
//   · copying twice is byte-identical.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlanSummary, buildCourseDescriptions, standaloneSemLabel }
  from "../../src/core/planSummary.js";

const SEM_TYPES = [
  { id: "fall",   label: "Fall",     weight: 1 },
  { id: "spring", label: "Spring",   idPrefix: "spr", weight: 1 },
  { id: "sumA",   label: "Summer 1", altLabel: "Summer A", weight: 0.5 },
  { id: "sumB",   label: "Summer 2", altLabel: "Summer B", weight: 0.5 },
];
const SEMS = [
  { id: "incoming", label: "Incoming Credit", type: "special", semTypeId: "incoming" },
  { id: "fall2025", label: "Fall 2025",     type: "fall",   semTypeId: "fall",   weight: 1 },
  { id: "spr2026",  label: "Spring 2026",   type: "spring", semTypeId: "spring", weight: 1 },
  { id: "sumA2026", label: "Summer 1 2026", type: "summer", semTypeId: "sumA",   weight: 0.5 },
  { id: "fall2026", label: "Fall 2026",     type: "fall",   semTypeId: "fall",   weight: 1 },
];
const IDX = Object.fromEntries(SEMS.map((s, i) => [s.id, i]));

// `subject` + `number` are what buildPlacedKeySet canonicalises on — not the
// printed `code` — so a stub that omits `number` audits as an empty plan and
// every section reads outstanding. Worth stating: it is the mistake this file's
// first run made, and it looked like a bug in the summary.
const course = (id, code, sh, desc) => [id, {
  id, code, title: `Title of ${code}`, sh,
  subject: code.split(" ")[0], number: code.split(" ")[1],
  desc: desc ?? `Description of ${code}. `.repeat(6),
}];
const COURSES = Object.fromEntries([
  course("cs2500", "CS 2500", 4), course("cs2510", "CS 2510", 4),
  course("cs3000", "CS 3000", 4), course("coop3945", "COOP 3945", 0),
  course("math1341", "MATH 1341", 4),
]);

// A program with one section that IS satisfied and one that is not.
const PROGRAM = {
  name: "Test Program, BS",
  totalCreditsRequired: 128,
  requirementSections: [
    { type: "SECTION", title: "Computer Science Overview", minRequirementCount: 1,
      requirements: [{ type: "COURSE", subject: "CS", classId: 2500 }] },
    { type: "SECTION", title: "Mathematics", minRequirementCount: 1,
      requirements: [{ type: "COURSE", subject: "MATH", classId: 9999 }] },
  ],
  concentrations: [],
};

const ADAPTER = {
  calendar:      { getSemesterTypes: () => SEM_TYPES },
  creditSystem:  { getUnitName: () => "SH", getSemesterMax: () => 19, getFullTimeMin: () => 12 },
  institution:   { appName: "NU Map" },
  specialTerms:  { getTypes: () => [{
    id: "coop", label: "Co-op",
    durations: [{ id: "4mo", label: "4 months", weight: 1 }],
  }] },
  attributeSystem: {
    getGridCodes:  () => ["ND", "EI", "WF"],
    getSystemName: () => "NUpath",
    getCoverage:   () => new Set(["ND"]),
  },
  majorRequirements: {
    fmtProgramLabel: (folder) => folder.replace(/_/g, " "),
    loadMajor: async () => PROGRAM,
    loadGradMajor: async () => PROGRAM,
    loadMinor: async () => null,
  },
};

const ARGS = {
  planName: "My Plan",
  placements: { cs2500: "fall2025", cs2510: "spr2026", cs3000: "fall2026" },
  courseMap: COURSES,
  semesters: SEMS, semIndex: IDX, currentSemId: "spr2026",
  semesterCardIds: (semId) => Object.entries({ cs2500: "fall2025", cs2510: "spr2026", cs3000: "fall2026" })
    .filter(([, s]) => s === semId).map(([id]) => id),
  specialTermPl: {}, specialTermStartMap: {}, specialTermContMap: {},
  grades: {}, placedOut: new Set(), substitutions: [],
  studentType: "undergraduate",
  entry: "Fall 2025", graduation: "Spring 2029",
  majorPath: "programs/undergraduate/2026/test_program/requirements.json",
  totalSHPlaced: 12, totalSHDone: 4,
  adapter: ADAPTER, dataUpdated: "2026-09-01",
};

test("summary › the descriptions are OUT and the lookup grammar is IN", async () => {
  const text = await buildPlanSummary(ARGS);
  // The appendix was 88% of the paste. Its absence is the change.
  assert.doesNotMatch(text, /Appendix/);
  assert.doesNotMatch(text, /Description of CS 2500/);
  assert.match(text, /numap\.app\/data\/courses\/\{SUBJECT\}\/\{NUMBER\}/);
  assert.match(text, /numap\.app\/llms\.txt/);
  // …and it is genuinely small: a plan of 3 courses must not carry 3 descriptions.
  assert.ok(text.length < 6000, `summary was ${text.length} chars`);
});

// Every check wired on and finding nothing — what the app itself always passes.
const WIRED = {
  prereqViolations: new Map(), coreqViolations: new Map(),
  standingViolations: new Map(), coopGradConflicts: [],
  edges: [], offered: () => true, probability: () => 1,
  semesterLoad: () => 12, creditCap: 19, substitutions: [],
  hideGrades: false,
};

test("summary › the envelope and a positive conflict result are both present", async () => {
  const text = await buildPlanSummary({ ...ARGS, conflictInputs: WIRED });
  assert.match(text, /--- What this was checked against ---/);
  assert.match(text, /Checked: prerequisite order/);
  assert.match(text, /Not gated on: seat counts/);
  assert.match(text, /--- Flags \(supplementary\) ---\nNone\. All 3 placed courses pass every check/);
  assert.doesNotMatch(text, /NOT CHECKED/);
});

test("summary › a caller that wires no checks cannot publish a clean bill of health", async () => {
  // ARGS deliberately omits `conflictInputs`. The paste must then say what it
  // did not check rather than reporting silence as success — the failure the
  // real-catalog measurement run caught.
  const text = await buildPlanSummary(ARGS);
  assert.doesNotMatch(text, /pass every check/);
  assert.match(text, /NOT CHECKED in this export/);
  // The envelope drops the unclaimed checks, so the two sections agree. Scoped
  // to the "Checked:" sentence: matching the whole document would pass on the
  // very phrase appearing in the NOT CHECKED list, which is the opposite claim.
  const checked = text.split("Checked: ")[1].split("Not gated on:")[0].replace(/\s+/g, " ");
  assert.doesNotMatch(checked, /prerequisite order/);
  assert.match(text, /NOT CHECKED in this export[\s\S]*prerequisite order/);
  // Every check now comes from `conflictInputs`, so wiring nothing leaves the
  // claim empty rather than partially true. An empty claim is the honest one.
  assert.match(checked, /nothing — this export was built without any of the checks wired/);
});

test("summary › the PLAN comes first and the method comes last", async () => {
  // The reader opened the paste for the schedule. Three screens of methodology
  // before the first course is a document nobody reaches the end of — so the
  // order is verdict line, schedule, conflicts, requirements, envelope.
  const text = await buildPlanSummary({ ...ARGS, conflictInputs: WIRED });
  const at = (s) => {
    const i = text.indexOf(s);
    assert.notEqual(i, -1, `missing section: ${s}`);
    return i;
  };
  assert.ok(at("--- Schedule ---") < at("Flags (supplementary)"),
    "the schedule precedes the flags");
  assert.ok(at("Flags (supplementary)") < at("--- Requirements still outstanding"));
  assert.ok(at("--- Requirements still outstanding") < at("--- What this was checked against"),
    "the envelope is an appendix");
  assert.ok(at("--- What this was checked against") < at("https://numap.app/data/courses"));

  // …and the verdict is readable without scrolling: within the first six lines.
  const head = text.split("\n").slice(0, 8).join("\n");
  assert.match(head, /No flags from any check/);

  // A forward reference must name its target, not a position. "listed above"
  // was true only while the envelope was on top.
  assert.doesNotMatch(text, /listed above/);
});

test("summary › the verdict line counts the conflicts it found", async () => {
  const text = await buildPlanSummary({
    ...ARGS,
    conflictInputs: {
      ...WIRED,
      standingViolations: new Map([["cs3000", { required: "JR", earned: 8 }]]),
    },
  });
  assert.match(text, /^1 flag after the schedule \(signals, not errors\)\.$/m);
  // Singular, not "1 flags".
  assert.doesNotMatch(text, /^1 flags/m);
});

test("summary › satisfied sections are omitted, outstanding ones are not", async () => {
  const text = await buildPlanSummary(ARGS);
  assert.match(text, /--- Requirements still outstanding \(satisfied sections omitted\) ---/);
  assert.match(text, /Mathematics/);
  assert.doesNotMatch(text, /○ Computer Science Overview/);
  assert.match(text, /of \d+ sections complete/);
});

test("summary › attribute coverage names what is MISSING", async () => {
  const text = await buildPlanSummary(ARGS);
  assert.match(text, /NUpath: 1 of 3 covered, missing EI, WF/);
});

test("summary › things that are FACTS are printed on the thing, not flagged", async () => {
  // Two cases moved out of the flag list on the same principle: a retired
  // course is a property of the course, and a substitution recorded before its
  // course is placed is the order a person does those two steps in. Both are
  // still said, where they are facts rather than accusations.
  const retiredCourse = { id: "old1", code: "OLD 1", title: "Old One", sh: 4,
                          subject: "OLD", number: "1", retired: true, desc: "x" };
  const text = await buildPlanSummary({
    ...ARGS,
    conflictInputs: WIRED,
    courseMap: { ...COURSES, old1: retiredCourse },
    placements: { ...ARGS.placements, old1: "fall2026" },
    semesterCardIds: (semId) => semId === "fall2026"
      ? ["cs3000", "old1"] : ARGS.semesterCardIds(semId),
    substitutions: [{ from: "math1341", to: "cs2510" }],   // math1341 is unplaced
  });
  assert.match(text, /OLD 1: Old One \(4 SH\) \[retired\]/);
  assert.match(text, /MATH 1341 → CS 2510 \(MATH 1341 not yet placed\)/);
  // …and neither one turned up as a flag.
  assert.doesNotMatch(text, /Flags \(supplementary\) ---\n[\s\S]*OLD 1/);
  assert.match(text, /None\. All \d+ placed courses pass every check/);
});

test("summary › a term names itself Summer A, never Summer 1", async () => {
  const withSummer = {
    ...ARGS,
    placements: { ...ARGS.placements, math1341: "sumA2026" },
    semesterCardIds: (semId) => semId === "sumA2026" ? ["math1341"] : ARGS.semesterCardIds(semId),
  };
  const text = await buildPlanSummary(withSummer);
  assert.match(text, /^Summer A 2026$/m);
  assert.doesNotMatch(text, /Summer 1/);
});

test("summary › the course a work term REGISTERS survives", async () => {
  const withCoop = {
    ...ARGS,
    specialTermPl: { t1: { typeId: "coop", semId: "fall2026", duration: "4mo",
                           company: "Acme", courseId: "coop3945" } },
    specialTermStartMap: { fall2026: "t1" },
  };
  const text = await buildPlanSummary(withCoop);
  // It is not placed, so it appears in no course row — the only mention is this.
  assert.match(text, /Co-op @ Acme · registers COOP 3945/);
});

test("summary › copying twice is byte-identical", async () => {
  const a = await buildPlanSummary(ARGS);
  const b = await buildPlanSummary(ARGS);
  assert.equal(a, b, "a reader diffing two pastes must see only real changes");
});

test("summary › a program that fails to load does not lose the plan", async () => {
  // The schedule is the part a student cannot reconstruct; a network failure in
  // the audit must not take it with it.
  const broken = { ...ARGS, adapter: { ...ADAPTER, majorRequirements: {
    ...ADAPTER.majorRequirements,
    loadMajor: async () => { throw new Error("offline"); },
  } } };
  const text = await buildPlanSummary(broken);
  assert.match(text, /--- Schedule ---/);
  assert.match(text, /CS 3000/);
});

test("summary › a graduate plan asks for no minors and no attribute grid", async () => {
  const grad = { ...ARGS, studentType: "graduate" };
  const text = await buildPlanSummary(grad);
  assert.doesNotMatch(text, /NUpath/);
  assert.doesNotMatch(text, /Minor/);
  assert.match(text, /Program: /);
});

test("descriptions › sorted by code, timeline only, and self-describing", () => {
  const text = buildCourseDescriptions({
    // The parked course must not appear: it is not part of the plan.
    placements: { cs3000: "fall2026", cs2500: "fall2025", math1341: "__overflow:1" },
    courseMap: COURSES, semIndex: IDX,
  });
  assert.match(text, /^--- Course descriptions \(2 courses/);
  assert.ok(text.indexOf("CS 2500") < text.indexOf("CS 3000"), "sorted by code");
  assert.doesNotMatch(text, /MATH 1341/);
});

test("descriptions › a missing description says so rather than printing nothing", () => {
  const text = buildCourseDescriptions({
    placements: { x: "fall2026" },
    courseMap: { x: { id: "x", code: "X 1", title: "X", sh: 4 } },
    semIndex: IDX,
  });
  assert.match(text, /No description published/);
});

test("label › altLabel replaces only the type's own name, keeping the year", () => {
  assert.equal(standaloneSemLabel(SEMS[3], SEM_TYPES), "Summer A 2026");
  assert.equal(standaloneSemLabel(SEMS[1], SEM_TYPES), "Fall 2025");
  // No alt form, or no type at all → the label stands unchanged.
  assert.equal(standaloneSemLabel({ label: "Winter 2026", semTypeId: "winter" }, SEM_TYPES), "Winter 2026");
  assert.equal(standaloneSemLabel(null, SEM_TYPES), "");
});
