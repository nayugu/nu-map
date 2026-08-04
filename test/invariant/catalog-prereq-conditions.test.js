// INVARIANT · public/northeastern/catalog-courses.json × src/core/prereqConditions.js
//
// Non-course prereq notes are free text written by the catalog, so the monthly
// scrape can change the wording under us. classifyCondition() reads that text;
// a phrase it stops recognizing goes silently neutral, and neutral in an OR
// branch means every graduate student is told they are missing the course's
// undergraduate prereq chain again. These tests fail loudly on that instead.
//
// They read only committed data — no network, no deps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../helpers/paths.js";
import { classifyCondition, planConditions, conditionStatus } from "../../src/core/prereqConditions.js";
import { evalPrereqTree } from "../../src/core/prereqEval.js";

/** Every distinct { note } string in the catalog → the courses carrying it. */
function noteIndex(courses) {
  const index = new Map();
  const walk = (tree, id) => {
    if (!Array.isArray(tree)) return;
    for (const tok of tree) {
      if (Array.isArray(tok)) { walk(tok, id); continue; }
      if (tok && typeof tok === "object" && tok.note) {
        if (!index.has(tok.note)) index.set(tok.note, []);
        index.get(tok.note).push(id);
      }
    }
  };
  for (const c of courses) {
    const id = `${c.subject}${c.number}`;
    walk(c.prereqs, id);
    walk(c.coreqs, id);
  }
  return index;
}

const courses = loadCatalog();
const notes   = noteIndex(courses);
const GRAD    = planConditions({ studentType: "graduate" });

test("catalog › graduate-admission prereqs still exist and still classify", () => {
  // Canary: if the scrape changes wording or stops emitting the note, this
  // drops to zero and the whole feature is silently dead.
  const matched = [...notes.keys()].filter(n => classifyCondition(n) === "grad-admission");
  assert.ok(
    matched.length > 0,
    `No catalog prereq note classifies as grad-admission. Catalog wording likely changed — ` +
    `distinct notes present:\n  ${[...notes.keys()].join("\n  ")}`
  );
});

test("catalog › no note mentioning graduate study falls through to 'other'", () => {
  // The failure mode this guards: a NEW phrasing that means grad admission
  // (or a graduate-level permission/candidacy gate) but matches no rule, so it
  // reads as neutral and quietly does nothing.
  const unclassified = [...notes.entries()]
    .filter(([n]) => /\bgraduat|\bmaster|\bdoctoral|\bph\.?d\b|\badmission|\badmitted/i.test(n))
    .filter(([n]) => classifyCondition(n) === "other")
    .map(([n, ids]) => `${n}  (e.g. ${ids[0]}, ${ids.length} course(s))`);
  assert.deepEqual(
    unclassified,
    [],
    `Prereq note(s) about graduate study that classifyCondition() does not recognize.\n` +
    `Add a rule in src/core/prereqConditions.js (and decide whether it is auto-satisfiable):\n  ` +
    unclassified.join("\n  ")
  );
});

test("catalog › candidacy and permission gates never auto-satisfy in a grad plan", () => {
  // Invariant 2: being in a graduate plan is not candidacy and not consent.
  const leaked = [...notes.keys()]
    .filter(n => /\bdissertation|\bcandidacy|\bpermission|\bconsent|\bapprov/i.test(n))
    .filter(n => conditionStatus(n, GRAD) === "satisfied");
  assert.deepEqual(leaked, [], `Note(s) auto-satisfied by a graduate plan that must not be:\n  ${leaked.join("\n  ")}`);
});

// Courses that carry a grad-admission note AND a second, independent
// requirement, so admission alone cannot clear them. CHEM 5625 is
// "(CHEM 2317 Or CHEM 2313 Or admission) And (CHEM 5620 Or CHEM 5621)" — the
// lab co-requisite is real for everyone. Listed rather than tolerated by a
// percentage so a growing set gets noticed.
const ADMISSION_PLUS_MORE = ["CHEM5625"];

const hasGradAdmission = (tree) => (tree ?? []).some(tok =>
  Array.isArray(tok) ? hasGradAdmission(tok)
  : tok?.note ? classifyCondition(tok.note) === "grad-admission"
  : false);

test("catalog › a graduate plan clears the grad-admission courses' prereqs", () => {
  // End-to-end on real data with an EMPTY plan: a graduate student should not
  // be told they are missing the undergraduate chain these courses list as the
  // alternative to admission. This is the bug, measured on shipped data.
  const withAdmission = courses.filter(c => hasGradAdmission(c.prereqs));
  assert.ok(withAdmission.length > 0, "no grad-admission courses found — see the canary test above");

  const semIndex = { s0: 0, s1: 1 };
  const unsatisfied = withAdmission
    .filter(c => evalPrereqTree(c.prereqs, {}, semIndex, 1, new Set(), null, GRAD) !== "satisfied")
    .map(c => `${c.subject}${c.number}`)
    .filter(id => !ADMISSION_PLUS_MORE.includes(id));
  assert.deepEqual(
    unsatisfied,
    [],
    `Graduate plan still shows unsatisfied prereqs on course(s) whose tree offers admission ` +
    `as an alternative. If a course genuinely ANDs another requirement, add it to ` +
    `ADMISSION_PLUS_MORE with a note:\n  ${unsatisfied.join("\n  ")}`
  );
});

test("catalog › conditions never make any course's prereqs worse", () => {
  // Invariant 1, swept across the whole catalog: adding plan conditions may
  // only move a result toward satisfied, never away. A regex that accidentally
  // returned "missing" for an unmet note would light up red cards everywhere.
  const rank = { satisfied: 2, order: 1, missing: 0 };
  const semIndex = { s0: 0, s1: 1 };
  const regressed = [];
  for (const c of courses) {
    if (!c.prereqs?.length) continue;
    const base = evalPrereqTree(c.prereqs, {}, semIndex, 1);
    const grad = evalPrereqTree(c.prereqs, {}, semIndex, 1, new Set(), null, GRAD);
    if (rank[grad] < rank[base]) regressed.push(`${c.subject}${c.number}: ${base} → ${grad}`);
  }
  assert.deepEqual(regressed, [], `Conditions worsened prereq results:\n  ${regressed.join("\n  ")}`);
});
