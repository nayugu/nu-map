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

import { inheritWitness } from "../../scripts/lib/witness-carry.js";

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
