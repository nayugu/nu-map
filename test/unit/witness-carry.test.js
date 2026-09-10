// UNIT · a shared section's witness survives an edition roll — and only that.
//
// The rules this pins are the ones that make inheriting SAFE rather than merely
// convenient (see scripts/lib/witness-carry.js): it may only fill a gap, never
// overwrite; it must never touch `planOfStudyCourses`, which `verify-majors`
// reads to report `no-sample-plan` and which has to stay honest about what THIS
// edition published; and it must stop looking after two editions, because past
// that a witness is no longer evidence about the same degree.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inheritWitness, renameOrphans, RENAMED } from "../../scripts/lib/witness-carry.js";

/** A throwaway tree: {year}/{college}/{slug}/requirements.json */
function tree(entries) {
  const root = mkdtempSync(join(tmpdir(), "witness-"));
  for (const [year, college, slug, courses] of entries) {
    const dir = join(root, String(year), college, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "requirements.json"),
      JSON.stringify({ metadata: { planOfStudyCourses: courses } }));
  }
  return root;
}

const record = (courses) => ({ metadata: { planOfStudyCourses: courses } });

describe("witness-carry", () => {
  test("carries the previous edition's plan when this one publishes none", (t) => {
    const root = tree([[2026, "science", "physics_bs", ["MATH4545", "PHYS3601"]]]);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const r = record([]);
    const from = inheritWitness(r, { outRoot: root, college: "science", slug: "physics_bs", year: 2027 });
    assert.equal(from, 2026);
    assert.deepEqual(r.metadata.witnessCourses, ["MATH4545", "PHYS3601"]);
    assert.equal(r.metadata.witnessEdition, 2026);
  });

  test("planOfStudyCourses is never written — no-sample-plan must stay true", (t) => {
    const root = tree([[2026, "science", "physics_bs", ["MATH4545"]]]);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const r = record([]);
    inheritWitness(r, { outRoot: root, college: "science", slug: "physics_bs", year: 2027 });
    assert.deepEqual(r.metadata.planOfStudyCourses, [],
      "backfilling this would make the verifier claim a plan the page does not publish");
  });

  test("a page that publishes its own plan is left alone", (t) => {
    const root = tree([[2026, "science", "physics_bs", ["OLD1000"]]]);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const r = record(["NEW2000"]);
    const from = inheritWitness(r, { outRoot: root, college: "science", slug: "physics_bs", year: 2027 });
    assert.equal(from, null);
    assert.equal(r.metadata.witnessCourses, undefined, "a real witness must not be shadowed");
    assert.deepEqual(r.metadata.planOfStudyCourses, ["NEW2000"]);
  });

  test("the NEWEST prior edition wins", (t) => {
    const root = tree([
      [2025, "science", "physics_bs", ["OLD1000"]],
      [2026, "science", "physics_bs", ["NEW2000"]],
    ]);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const r = record([]);
    assert.equal(inheritWitness(r, { outRoot: root, college: "science", slug: "physics_bs", year: 2027 }), 2026);
    assert.deepEqual(r.metadata.witnessCourses, ["NEW2000"]);
  });

  test("an edition that published no plan is skipped, not inherited as empty", (t) => {
    const root = tree([
      [2025, "science", "physics_bs", ["OLD1000"]],
      [2026, "science", "physics_bs", []],           // NEU already dropped it here
    ]);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const r = record([]);
    assert.equal(inheritWitness(r, { outRoot: root, college: "science", slug: "physics_bs", year: 2027 }), 2025);
    assert.deepEqual(r.metadata.witnessCourses, ["OLD1000"]);
  });

  test("it stops after two editions", (t) => {
    const root = tree([[2024, "science", "physics_bs", ["OLD1000"]]]);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const r = record([]);
    assert.equal(inheritWitness(r, { outRoot: root, college: "science", slug: "physics_bs", year: 2027 }), null,
      "three editions back the curriculum has moved; a witness is no longer evidence");
    assert.equal(r.metadata.witnessCourses, undefined);
  });

  test("a program with no prior edition simply gets nothing", (t) => {
    const root = tree([[2026, "science", "other_bs", ["X1000"]]]);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const r = record([]);
    assert.equal(inheritWitness(r, { outRoot: root, college: "science", slug: "physics_bs", year: 2027 }), null);
    assert.equal(r.metadata.witnessCourses, undefined);
  });

  test("a missing tree is not an error — the first scrape of a tree has none", () => {
    const r = record([]);
    assert.equal(inheritWitness(r, { outRoot: join(tmpdir(), "does-not-exist-witness"),
                                     college: "science", slug: "physics_bs", year: 2027 }), null);
  });
});

// ── The folder itself moved ────────────────────────────────────────
//
// Every test above assumes the program keeps its slug, which is the assumption
// an edition roll is entitled to break. These use the REAL `RENAMED` table
// against a synthetic tree, so a typo in the committed entries fails here and
// not only in the scrape rail.
const CIS = "computer-information-science";
const AI_JRNL = "artificial_intelligence_and_journalism_bs_(boston)";
const DS_JRNL = "data_science_and_journalism_bs_(boston)";

describe("witness-carry · renamed programs", () => {
  test("a renamed program inherits from the folder it used to live in", (t) => {
    const root = tree([[2026, CIS, DS_JRNL, ["JRNL2201", "JRNL2301"]]]);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const r = record([]);
    assert.equal(inheritWitness(r, { outRoot: root, college: CIS, slug: AI_JRNL, year: 2027 }), 2026);
    assert.deepEqual(r.metadata.witnessCourses, ["JRNL2201", "JRNL2301"]);
    assert.equal(r.metadata.witnessFrom, `${CIS}/${DS_JRNL}`,
      "a carried-across-a-rename witness must say so; the ordinary case stays unannotated");
  });

  test("the program's OWN folder wins over its rename entry", (t) => {
    // The dangerous ordering. A rename entry is a fallback for a folder that is
    // not there — if it could override, a stale entry would replace a real
    // witness with a retired program's, and nothing would say so.
    const root = tree([
      [2026, CIS, AI_JRNL, ["MINE1000"]],
      [2026, CIS, DS_JRNL, ["THEIRS2000"]],
    ]);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const r = record([]);
    inheritWitness(r, { outRoot: root, college: CIS, slug: AI_JRNL, year: 2027 });
    assert.deepEqual(r.metadata.witnessCourses, ["MINE1000"]);
    assert.equal(r.metadata.witnessFrom, undefined);
  });

  test("a rename does not apply to a different edition", (t) => {
    // The table is keyed on the edition the rename appeared in, which is what
    // makes it self-limiting rather than something to prune by hand.
    const root = tree([[2027, CIS, DS_JRNL, ["JRNL2201"]]]);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const r = record([]);
    assert.equal(inheritWitness(r, { outRoot: root, college: CIS, slug: AI_JRNL, year: 2028 }), null);
  });

  test("a renamed program still publishing its own plan is untouched", (t) => {
    const root = tree([[2026, CIS, DS_JRNL, ["OLD1000"]]]);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const r = record(["NEW2000"]);
    assert.equal(inheritWitness(r, { outRoot: root, college: CIS, slug: AI_JRNL, year: 2027 }), null);
    assert.equal(r.metadata.witnessCourses, undefined);
  });

  test("the rename table is a bijection — two programs cannot claim one witness", () => {
    // A copy-paste slip in a 26-entry table is invisible otherwise: both
    // programs inherit, one of them inherits a stranger's plan, and the wrong
    // one confirms a cross-count it was never witnessed for.
    for (const [year, table] of Object.entries(RENAMED)) {
      const values = Object.values(table);
      assert.equal(new Set(values).size, values.length,
        `edition ${year}: two rename entries name the same predecessor`);
      for (const [k, v] of Object.entries(table)) {
        assert.notEqual(k, v, `edition ${year}: ${k} is its own predecessor, which is a no-op`);
        assert.match(k, /^[^/]+\/[^/]+$/, `edition ${year}: ${k} is not a college/slug key`);
        assert.match(v, /^[^/]+\/[^/]+$/, `edition ${year}: ${v} is not a college/slug key`);
      }
    }
  });
});

describe("witness-carry · renameOrphans", () => {
  const present = Object.keys(RENAMED[2027]);

  test("both ends resolving is silence", (t) => {
    const root = tree(Object.values(RENAMED[2027])
      .map(v => [2026, ...v.split("/"), ["X1000"]]));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    assert.deepEqual(renameOrphans({ outRoot: root, year: 2027, present }),
      { deadKeys: [], deadValues: [] });
  });

  test("a key this run did not parse is reported", (t) => {
    const root = tree(Object.values(RENAMED[2027])
      .map(v => [2026, ...v.split("/"), ["X1000"]]));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { deadKeys } = renameOrphans({
      outRoot: root, year: 2027, present: present.filter(k => !k.endsWith(AI_JRNL)) });
    assert.deepEqual(deadKeys, [`${CIS}/${AI_JRNL}`]);
  });

  test("a predecessor that is not on disk is reported", (t) => {
    const root = tree(Object.values(RENAMED[2027])
      .filter(v => !v.endsWith(DS_JRNL))
      .map(v => [2026, ...v.split("/"), ["X1000"]]));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { deadValues } = renameOrphans({ outRoot: root, year: 2027, present });
    assert.deepEqual(deadValues, [`${CIS}/${AI_JRNL} ← ${CIS}/${DS_JRNL}`]);
  });

  test("a predecessor outside the lookback window is dead, not merely quiet", (t) => {
    // Same window `inheritWitness` uses. An entry pointing three editions back
    // can never fire, so reporting it is the only way it is ever noticed.
    const root = tree(Object.values(RENAMED[2027])
      .map(v => [2024, ...v.split("/"), ["X1000"]]));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const { deadValues } = renameOrphans({ outRoot: root, year: 2027, present });
    assert.equal(deadValues.length, Object.keys(RENAMED[2027]).length);
  });

  test("an edition with no rename table is not an error", () => {
    assert.deepEqual(renameOrphans({ outRoot: join(tmpdir(), "nope-witness"), year: 2099, present: [] }),
      { deadKeys: [], deadValues: [] });
  });
});
