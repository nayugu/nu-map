// INVARIANT · a placed co-op satisfies the co-op requirement, across the
// real program corpus.
//
// The unit test in test/unit/coop-course-grant.test.js pins the bridge on a
// hand-built section, which proves the mechanism and not the coverage. This
// reads the shipped requirement trees instead: 37 undergraduate programs name
// a COOP course, they spread it across 8 different section titles and three
// node shapes, and before the bridge existed EVERY one of them told a student
// with two co-ops on the board that the requirement was unmet.
//
// Committed data only — no network, no deps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../helpers/paths.js";
import { allocateSections } from "../../src/core/gradRequirements.js";
import { workTermGrants } from "../../src/core/specialTermUtils.js";
import specialTerms from "../../src/adapters/northeastern/specialTerms.js";

/** Every COOP-bearing requirement section in the live undergraduate tree. */
function loadCoopSections() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!e.endsWith(".json")) continue;
      let j;
      try { j = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
      for (const prog of (Array.isArray(j) ? j : [j])) {
        if (!prog?.name || !JSON.stringify(prog).includes('"COOP"')) continue;
        for (const sec of (prog.requirementSections ?? [])) {
          if (JSON.stringify(sec).includes('"COOP"')) out.push({ prog: prog.name, sec });
        }
      }
    }
  };
  walk(join(ROOT, "data/northeastern/programs/undergraduate"));
  return out;
}

const SECTIONS = loadCoopSections();
// COOP 3945 is a zero-credit course. That is load-bearing: one program nests
// it under an XOM credit pool, where gradRequirements' DEFAULT_SH of 4 would
// be invented for a course carrying no `sh`.
const COURSE_MAP = { COOP3945: { subject: "COOP", number: "3945", sh: 0 } };

// A co-op the student RECORDED as COOP 3945 — the ordinary case, and the one
// the old inference used to assume. Nothing is granted without the courseId;
// see test/unit/coop-course-grant.test.js for why the default was removed.
// What this file measures is unchanged by that: given the key, which of the
// corpus's real sections does it actually satisfy.
const GRANTED = workTermGrants(
  { c1: { typeId: "coop", semId: "s1", duration: 6, courseId: "COOP3945" } },
  specialTerms.getTypes(),
  { s1: 0 },
).planned;

const satisfies = (sec, placed) =>
  allocateSections([sec], placed, new Set(), COURSE_MAP)[0]?.sat === true;

test("the corpus still names COOP where we measured it", () => {
  // If this moves, the numbers in the assertions below are stale rather than
  // wrong — re-measure before adjusting them.
  const progs = new Set(SECTIONS.map(s => s.prog));
  assert.equal(progs.size, 37, `expected 37 COOP-naming programs, found ${progs.size}`);
  assert.ok(SECTIONS.length >= 37);
});

test("a placed co-op satisfies the great majority of COOP sections", () => {
  const before = SECTIONS.filter(({ sec }) => satisfies(sec, new Set()));
  assert.equal(before.length, 0,
    "a COOP section is satisfied by an EMPTY plan — the requirement is not being read");

  const after = SECTIONS.filter(({ sec }) => satisfies(sec, GRANTED));
  assert.equal(after.length, 32,
    `a placed co-op satisfies ${after.length} sections; it satisfied 32 when measured`);
});

test("the sections a co-op does NOT satisfy are the ones it should not", () => {
  // Each of these is a deliberate conservative miss, not a gap. Naming them
  // means the next person to widen courseGrants has to argue with the list.
  const unmet = SECTIONS.filter(({ sec }) => !satisfies(sec, GRANTED))
    .map(({ prog, sec }) => `${prog} :: ${sec.title}`);

  // An ordinary co-op is not an ABROAD co-op. Claiming it would be exactly
  // the confident-and-wrong failure this whole surface is judged on.
  assert.ok(unmet.some(s => s.startsWith("International Business, BSIB")),
    "an ordinary co-op now satisfies an international experiential requirement");

  // A zero-credit course cannot fill a 5-credit XOM pool. That is a catalog /
  // parse mismatch and must stay visible, not be papered over by the bridge.
  assert.ok(unmet.some(s => s.includes("Speech-Language Pathology")),
    "the zero-credit co-op is now filling a credit pool it cannot fill");

  // Everything still unmet must be explicable. If a new one appears, it is
  // either a corpus change or a regression — either way, look at it.
  assert.equal(unmet.length, 6, `unexpected unmet set:\n  ${unmet.join("\n  ")}`);
});

test("the grant is one key, and the alternatives stay ungranted", () => {
  assert.deepEqual([...GRANTED], ["COOP3945"]);
});
