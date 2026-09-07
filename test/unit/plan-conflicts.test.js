// ═══════════════════════════════════════════════════════════════════
// The Flags block of the clipboard summary.
//
// This is a REPORTING surface over verdicts other modules reached, so the tests
// that matter are not "does it list a violation" — they are the ones that catch
// it inventing a verdict, contradicting the board, or losing one:
//
//   · a completed term withholds an availability alarm (the card does too) but
//     NOT a corequisite or standing failure, which are statements about a plan
//     as written rather than forecasts;
//   · a clean plan produces a POSITIVE result, because an omitted section is
//     indistinguishable from a check that never ran — the whole reason the
//     block exists;
//   · evidence degrades to prose and never to a wrong course name;
//   · a concurrent-registration prereq in the same term is NOT reported, or the
//     paste contradicts a relation line the app draws in its ordinary colour;
//   · private-grades mode never names a grade as a cause;
//   · the order is deterministic, so two pastes of one plan diff clean.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectConflicts, formatConflicts, conflictClause, formatEnvelope,
  CHECKS, CHECK_KEYS, NOT_GATED, TRUST_NOTE, SCOPE_COURSE,
} from "../../src/core/planConflicts.js";

/** Wrapped prose: compare on content, not on where the lines happen to break. */
const flat = (lines) => (Array.isArray(lines) ? lines.join("\n") : lines).replace(/\s+/g, " ");

/** Every check wired on, with nothing wrong — the app's own situation. */
const ALL_CHECKS = {
  prereqViolations: new Map(), coreqViolations: new Map(),
  standingViolations: new Map(), coopGradConflicts: [],
  offered: () => true, probability: () => 1,
  semesterLoad: () => 0, creditCap: 19,
  substitutions: [],
};

// ── A miniature plan: fall2025 (done) → spr2026 (now) → fall2026 → sumA/sumB2027
const SEMS = [
  { id: "incoming", label: "Incoming Credit", type: "special", semTypeId: "incoming" },
  { id: "fall2025", label: "Fall 2025",   type: "fall",   semTypeId: "fall",   weight: 1 },
  { id: "spr2026",  label: "Spring 2026", type: "spring", semTypeId: "spring", weight: 1 },
  { id: "fall2026", label: "Fall 2026",   type: "fall",   semTypeId: "fall",   weight: 1 },
  { id: "sumA2027", label: "Summer 1 2027", type: "summer", semTypeId: "sumA", weight: 0.5 },
  { id: "sumB2027", label: "Summer 2 2027", type: "summer", semTypeId: "sumB", weight: 0.5 },
];
const IDX = Object.fromEntries(SEMS.map((s, i) => [s.id, i]));

const C = (id, code, extra = {}) => [id, { id, code, title: code, sh: 4, ...extra }];
const MAP = Object.fromEntries([
  C("cs2500", "CS 2500"), C("cs2510", "CS 2510"), C("cs3000", "CS 3000"),
  C("phys1151", "PHYS 1151"), C("phys1152", "PHYS 1152"),
  C("old9999", "OLD 9999", { retired: true }),
  C("rare1", "RARE 1"),
]);

const base = {
  courseMap: MAP, semesters: SEMS, semIndex: IDX, currentSemId: "spr2026",
  // The standalone heading, as every other surface resolves it — "Summer A",
  // never the grid's "Summer 1".
  semLabelOf: (id) => ({ sumA2027: "Summer A 2027", sumB2027: "Summer B 2027" }[id])
    ?? SEMS.find(s => s.id === id)?.label,
};

test("conflicts › a clean plan states a RESULT, not an empty section", () => {
  const { items, count, ran } = collectConflicts({
    ...base, ...ALL_CHECKS, placements: { cs2500: "fall2025" },
  });
  assert.equal(count, 0);
  assert.ok(CHECK_KEYS.every(k => ran[k]), "every check was wired");
  const text = formatConflicts(items, 1, ran).join("\n");
  // The positive claim, and the count it was made over. An omitted heading here
  // is the failure this whole block exists to prevent.
  assert.match(text, /^--- Flags \(supplementary\) ---$/m);
  assert.match(text, /None\. All 1 placed course pass every check/);
  assert.doesNotMatch(text, /^0 Flags/m);
  assert.doesNotMatch(text, /NOT CHECKED/);
});

test("conflicts › a check that was NOT WIRED is never reported as passing", () => {
  // The failure the measurement run caught: called with no violation maps, the
  // export claimed 32 courses passed every check. Absent is not false.
  const { items, count, ran } = collectConflicts({
    ...base, placements: { cs2500: "fall2025", cs2510: "fall2026" },
  });
  assert.equal(count, 0);
  assert.ok(CHECK_KEYS.every(k => !ran[k]), "nothing was wired");
  const text = formatConflicts(items, 2, ran).join("\n");
  assert.doesNotMatch(text, /pass every check/);
  assert.match(text, /None found among the checks that ran/);
  assert.match(text, /NOT CHECKED in this export/);
  // Every unrun check is still NAMED, wrapped into the sentence rather than
  // bulleted. Newlines are collapsed before matching so the wrap point cannot
  // make a check look absent.
  for (const k of CHECK_KEYS) assert.ok(flat(text).includes(CHECKS[k]), `unnamed: ${k}`);

  // …and the envelope stops claiming them, so the two sections cannot contradict.
  const env = flat(formatEnvelope(ran));
  for (const k of CHECK_KEYS) assert.ok(!env.includes(CHECKS[k]), `still claimed: ${k}`);
});

test("conflicts › an EMPTY map is a result; a MISSING one is not", () => {
  const empty = collectConflicts({ ...base, placements: {}, coreqViolations: new Map() });
  assert.equal(empty.ran.coreqViolations, true);
  const absent = collectConflicts({ ...base, placements: {} });
  assert.equal(absent.ran.coreqViolations, false);
});

test("conflicts › a partial run says so even when it FOUND something", () => {
  // "Here are two problems" otherwise implies the rest was clean.
  const { items, ran } = collectConflicts({
    ...base, placements: { phys1152: "fall2026" },
    coreqViolations: new Map([["phys1152", "alone"]]),
    edges: [{ from: "phys1151", to: "phys1152", type: "corequisite" }],
  });
  const text = formatConflicts(items, 1, ran).join("\n");
  assert.match(text, /^--- 1 Flags \(supplementary\) ---$/m);
  assert.match(text, /NOT CHECKED in this export/);
  assert.ok(flat(text).includes(CHECKS.standingViolations));
});

test("conflicts › no credit cap means the load check did NOT run", () => {
  // Comparing against Infinity is a formality that can never fail, so claiming
  // it as a completed check would be the same lie one level down.
  const { ran } = collectConflicts({
    ...base, placements: {}, semesterLoad: () => 99, creditCap: Infinity,
  });
  assert.equal(ran.semesterLoad, false);
});

test("conflicts › a prereq placed LATER is named, with its term", () => {
  const { items } = collectConflicts({
    ...base,
    placements: { cs3000: "fall2026", cs2510: "sumA2027" },
    prereqViolations: new Map([["cs3000", "order"]]),
    edges: [{ from: "cs2510", to: "cs3000", type: "prerequisite" }],
  });
  assert.equal(items.length, 1);
  const line = formatConflicts(items, 2).join("\n");
  assert.match(line, /CS 3000 \(Fall 2026\)/);
  assert.match(line, /prereq CS 2510 placed later \(Summer A 2027\)/);
  // The alt label reached the evidence too — not just the heading.
  assert.doesNotMatch(line, /Summer 1/);
});

test("conflicts › a CONCURRENT prereq in the same term is not reported as evidence", () => {
  // The relation line draws this edge in its ordinary colour, because a
  // concurrent prereq legitimately shares the term. Naming it here would make
  // the paste contradict the board.
  const { items } = collectConflicts({
    ...base,
    placements: { cs3000: "fall2026", cs2510: "fall2026" },
    prereqViolations: new Map([["cs3000", "order"]]),
    edges: [{ from: "cs2510", to: "cs3000", type: "prerequisite", concurrent: true }],
  });
  const clause = conflictClause(items[0]);
  assert.doesNotMatch(clause, /CS 2510/);
  // …and with nothing to name it falls back to prose rather than inventing.
  assert.match(clause, /prereqs not met by this plan/);
});

test("conflicts › evidence degrades to the requirement, never to a wrong course", () => {
  // The verdict stands (the evaluator said unsatisfied) while the search for an
  // offending card comes up empty — the branch is simply absent from the plan.
  const withTree = { ...MAP, cs3000: { ...MAP.cs3000, prereqs: ["cs2510"] } };
  const { items } = collectConflicts({
    ...base, courseMap: withTree,
    placements: { cs3000: "fall2026" },
    prereqViolations: new Map([["cs3000", "missing"]]),
    edges: [{ from: "cs2510", to: "cs3000", type: "prerequisite" }],   // not placed
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].late.length, 0);
  assert.equal(items[0].same.length, 0);
  assert.ok(items[0].requirement, "the requirement itself is what there is to say");
});

test("conflicts › private grades never name a grade as the cause", () => {
  const args = {
    ...base, placements: { cs3000: "fall2026" },
    prereqViolations: new Map([["cs3000", "grade"]]),
  };
  const open = collectConflicts(args);
  assert.equal(open.items[0].kind, "prereq-grade");
  assert.match(conflictClause(open.items[0]), /grade/);

  const private_ = collectConflicts({ ...args, hideGrades: true });
  // Still reported — the conflict is real — with the cause generalised.
  assert.equal(private_.items.length, 1);
  assert.equal(private_.items[0].kind, "prereq-order");
  assert.doesNotMatch(conflictClause(private_.items[0]), /grade/i);
});

test("conflicts › availability is withheld on a COMPLETED term, coreq and standing are not", () => {
  // The card's own split: an availability warning is a prediction about
  // registration, and there is no version of the past in which the student
  // picks differently. A coreq failure and a standing gate say the term as
  // recorded could not have been registered, which stays worth saying.
  const args = {
    ...base,
    placements: { old9999: "fall2025", rare1: "fall2025", phys1152: "fall2025" },
    offered: (c) => c.id !== "rare1",
    probability: () => 0.2,
    coreqViolations: new Map([["phys1152", "alone"]]),
    standingViolations: new Map([["phys1152", { required: "JR", earned: 20 }]]),
    edges: [{ from: "phys1151", to: "phys1152", type: "corequisite" }],
  };
  const done = collectConflicts(args);
  const kinds = done.items.map(i => i.kind).sort();
  assert.deepEqual(kinds, ["coreq-absent", "standing"]);

  // The same three placements in a FUTURE term produce the availability pair too.
  const future = collectConflicts({
    ...args,
    placements: { old9999: "fall2026", rare1: "fall2026", phys1152: "fall2026" },
  });
  const fk = future.items.map(i => i.kind).sort();
  // No "retired": OLD 9999 is placed in a future term and is retired, and it is
  // still NOT a flag. It is in the runtime catalog because a shipped program
  // edition requires it, so for the student on that edition, taking it is
  // correct. The schedule row says `[retired]` instead.
  assert.deepEqual(fk, ["coreq-absent", "not-offered", "standing"]);
});

test("conflicts › a parked or incoming course is never judged", () => {
  const { count } = collectConflicts({
    ...base,
    placements: { cs3000: "__overflow:1", cs2510: "incoming" },
    prereqViolations: new Map([["cs3000", "order"], ["cs2510", "order"]]),
    coreqViolations: new Map([["cs3000", "alone"]]),
    standingViolations: new Map([["cs2510", { required: "SR", earned: 0 }]]),
    offered: () => false,
  });
  assert.equal(count, 0, "off-plan cards have no term to be wrong in");
});

test("conflicts › summer halves are judged as ONE term against the ordinary cap", () => {
  // Two 12 SH halves are 24 SH of summer, which is what a registrar sees.
  // Judging each half alone passes both — the bug this shape exists for.
  const load = { sumA2027: 12, sumB2027: 12, fall2026: 16 };
  const { items } = collectConflicts({
    ...base, placements: {},
    semesterLoad: (id) => load[id] ?? 0, creditCap: 19,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].sh, 24);
  assert.equal(items[0].combined, true);
  // Named as its members, so the number can be checked against the cells.
  assert.equal(items[0].semLabel, "Summer A 2027 + Summer B 2027");
  assert.match(conflictClause(items[0]), /24 SH \(both halves\) over the 19 SH cap/);
});

test("conflicts › AT the cap is not over it", () => {
  const { count } = collectConflicts({
    ...base, placements: {},
    semesterLoad: (id) => (id === "fall2026" ? 19 : 0), creditCap: 19,
  });
  assert.equal(count, 0);
});

test("conflicts › no cap means no verdict, not an infinite one", () => {
  const { count } = collectConflicts({
    ...base, placements: {},
    semesterLoad: () => 99, creditCap: Infinity,
  });
  assert.equal(count, 0);
});

test("conflicts › a standing gate names the THRESHOLD, not just the code", () => {
  // "JR standing needs more" is the re-derivation this block exists to prevent.
  const { items } = collectConflicts({
    ...base, placements: { cs3000: "fall2026" },
    standingViolations: new Map([["cs3000", { required: "JR", earned: 44 }]]),
  });
  const clause = conflictClause(items[0]);
  assert.match(clause, /Junior standing \(64 SH\) required/);
  assert.match(clause, /44 SH earned by then/);
  // An unknown code degrades to itself with a 0 threshold rather than throwing.
  const odd = collectConflicts({
    ...base, placements: { cs3000: "fall2026" },
    standingViolations: new Map([["cs3000", { required: "XX", earned: 4 }]]),
  });
  assert.match(conflictClause(odd.items[0]), /XX standing/);
});

test("conflicts › several problems on one course group under one heading", () => {
  const { items } = collectConflicts({
    ...base,
    placements: { phys1152: "fall2026" },
    coreqViolations: new Map([["phys1152", "alone"]]),
    standingViolations: new Map([["phys1152", { required: "JR", earned: 44 }]]),
    edges: [{ from: "phys1151", to: "phys1152", type: "corequisite" }],
  });
  const lines = formatConflicts(items, 1);
  assert.equal(lines.filter(l => l.startsWith("PHYS 1152")).length, 1,
    "one heading per course, however many things are wrong with it");
  assert.equal(lines.filter(l => l.trim().startsWith("·")).length, 2);
});

test("conflicts › the order is deterministic across key insertion order", () => {
  const mk = (entries) => collectConflicts({
    ...base,
    placements: { cs2500: "fall2026", cs2510: "fall2026", cs3000: "fall2026" },
    standingViolations: new Map(entries),
  }).items.map(i => i.code);
  const a = mk([["cs3000", { required: "SR", earned: 0 }], ["cs2500", { required: "JR", earned: 0 }], ["cs2510", { required: "JR", earned: 0 }]]);
  const b = mk([["cs2510", { required: "JR", earned: 0 }], ["cs3000", { required: "SR", earned: 0 }], ["cs2500", { required: "JR", earned: 0 }]]);
  assert.deepEqual(a, b);
  assert.deepEqual(a, ["CS 2500", "CS 2510", "CS 3000"]);
});

test("conflicts › an unplaced substitution is NOT a flag", () => {
  // Recording "CS 2500 will stand in for CS 2510" before dragging CS 2500 onto
  // the board is ordinary planning, in the order a person does it. Flagging it
  // told the student off for using the feature correctly. It is still SAID, in
  // the Substitutions block, where it is a fact rather than a verdict — see
  // plan-summary.test.js.
  const { count } = collectConflicts({
    ...base, placements: { cs2510: "fall2026" },
    substitutions: [{ from: "cs2500", to: "cs2510" }],
  });
  assert.equal(count, 0);
  // …and `substitutions` is no longer one of the checks claimed as coverage.
  assert.ok(!CHECK_KEYS.includes("substitutions"));
});

test("flags › the minor double-count cap is NOT flagged, over or under", () => {
  // It is real and important, and it is already printed verbatim in that
  // minor's own audit block in the registrar's numbers. A second copy in a
  // supplementary list is bloat rather than information — and the app never
  // un-allocates a course over the cap, because which one to drop is an
  // advising decision.
  const over = { over: true, sharedSH: 12, capSH: 10, requiredSH: 20, overSH: 2 };
  assert.equal(collectConflicts({ ...base, placements: {}, minorShares: [{ name: "M", share: over }] }).count, 0);
  // …and it is not claimed as flag coverage either, so the envelope and the
  // flag list still agree about what this section is for.
  assert.ok(!CHECK_KEYS.includes("minorShares"));
});

test("flags › every kind still emitted can state a registration consequence", () => {
  // The standard each survivor had to meet: Banner refuses, the registrar's
  // gate closes the section, NEU may not run it, it needs a petition, or the
  // student graduates mid-co-op. Anything that could not say one of those was
  // moved beside the thing it describes, or dropped. This pins the list so a
  // new kind has to be argued for rather than added.
  const KINDS = new Set([
    "prereq-order", "prereq-grade", "coreq-absent", "coreq-split",
    "standing", "not-offered", "over-cap", "coop-graduation",
  ]);
  const seen = new Set();
  const { items } = collectConflicts({
    ...base,
    placements: { cs3000: "fall2026", phys1152: "fall2026", old9999: "fall2026", rare1: "fall2026" },
    prereqViolations: new Map([["cs3000", "order"]]),
    coreqViolations: new Map([["phys1152", "alone"]]),
    standingViolations: new Map([["cs3000", { required: "JR", earned: 4 }]]),
    offered: (c) => c.id !== "rare1", probability: () => 0.1,
    semesterLoad: (id) => (id === "fall2026" ? 30 : 0), creditCap: 19,
    coopGradConflicts: [{ label: "Co-op", semId: "sumA2027" }],
    edges: [{ from: "cs2510", to: "cs3000", type: "prerequisite" },
            { from: "phys1151", to: "phys1152", type: "corequisite" }],
    minorShares: [{ name: "M", share: { over: true, sharedSH: 9, capSH: 5, requiredSH: 10, overSH: 4 } }],
    substitutions: [{ from: "cs2500", to: "cs2510" }],
  });
  for (const it of items) seen.add(it.kind);
  for (const k of seen) assert.ok(KINDS.has(k), `unexpected flag kind: ${k}`);
  // The three that were cut must not reappear, even with their inputs supplied.
  for (const gone of ["retired", "minor-cap", "substitution-unplaced"]) {
    assert.ok(!seen.has(gone), `${gone} is flagged again`);
  }
});

test("conflicts › junk inputs produce no verdict rather than a crash", () => {
  // Everything optional, and a courseMap that does not know the placed ids.
  assert.equal(collectConflicts().count, 0);
  const { count } = collectConflicts({
    ...base, placements: { ghost: "fall2026" },
    prereqViolations: new Map([["ghost", "order"]]),
    coreqViolations: new Map([["ghost", "alone"]]),
    offered: () => false,
  });
  // The coreq map is the app's own verdict and is trusted; the prereq and
  // availability paths need the course object and correctly decline without it.
  assert.equal(count, 1);
});

test("envelope › every check named corresponds to an input the collector reads", () => {
  // A coverage claim that drifts from the code is worse than no claim, so the
  // claim list IS the input list: CHECKS is keyed on the argument that enables
  // each one, and this asserts every key is an argument `collectConflicts`
  // actually distinguishes.
  const text = flat(formatEnvelope());
  // Six, and it went DOWN by design: `retired`, the minor cap and unplaced
  // substitutions were cut because they are not things a plan fails. A drop
  // here is not automatically a regression; an addition needs an argument.
  assert.equal(CHECK_KEYS.length, 6);
  for (const k of CHECK_KEYS) {
    assert.ok(text.includes(CHECKS[k]), `missing from the envelope: ${k}`);
    const { ran } = collectConflicts({ ...base, placements: {}, [k]: k === "offered" || k === "semesterLoad" ? () => 0 : new Map() });
    if (k === "semesterLoad") continue;   // needs a finite cap too, asserted above
    assert.equal(ran[k], true, `${k} is named but not detected as wired`);
  }
  for (const s of NOT_GATED) assert.ok(text.includes(s), `missing from the envelope: ${s}`);
});

test("envelope › the seat distinction survived being compressed to one list", () => {
  // The correction that shaped this section, and the thing most likely to be
  // lost the next time someone shortens it: seat data is NOT missing. It is
  // scraped per past term and drawn on every course page. What is unknown is
  // the seat count at this student's own registration moment. Two adjacent
  // entries, and the paste must never collapse them into "we have no seats".
  const text = flat(formatEnvelope());
  assert.match(text, /seat counts, fill and instructors for PAST terms \(on each course page, but never a gate\)/);
  assert.match(text, /seats at this student's own registration time/);
  assert.doesNotMatch(text, /Checked:[^.]*seat/, "seats are not a gate");
});

test("envelope › no claim appears in both lists", () => {
  const all = [...Object.values(CHECKS), ...NOT_GATED];
  assert.equal(new Set(all).size, all.length, "a claim in two lists contradicts itself");
});

test("flags › the section demotes itself BEFORE the list, not after it", () => {
  // Most of these are not errors: a rate, a projection, a petition a student
  // gets. The demotion has to be the second line, because a reader who has met
  // four terse lines under a heading has already decided what they are by the
  // time a caveat arrives underneath.
  const { items, ran } = collectConflicts({
    ...base, ...ALL_CHECKS, placements: { cs3000: "fall2026" },
    standingViolations: new Map([["cs3000", { required: "SR", earned: 8 }]]),
  });
  const lines = formatConflicts(items, 1, ran);
  assert.match(lines[0], /^--- 1 Flags \(supplementary\) ---$/);
  assert.match(flat(lines.slice(1, 5)), /^Signals, not errors, and secondary to the plan above/);
  assert.ok(flat(lines).includes(flat(TRUST_NOTE)));
  assert.match(flat(lines), /Do not rewrite the plan around one/);
  // The demotion precedes the first flag, whatever the wrapping does.
  assert.ok(flat(lines).indexOf("Signals, not errors") < flat(lines).indexOf("CS 3000"));
  // Absent when there is nothing to be wrong about.
  const clean = collectConflicts({ ...base, ...ALL_CHECKS, placements: { cs2500: "fall2026" } });
  assert.ok(!flat(formatConflicts(clean.items, 1, clean.ran)).includes("Signals, not errors"));
});

test("clause › an unknown kind degrades to its own name, never to a lie", () => {
  assert.equal(conflictClause({ kind: "something-new", scope: SCOPE_COURSE }), "something-new");
});
