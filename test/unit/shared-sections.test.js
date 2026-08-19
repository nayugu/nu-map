// ═══════════════════════════════════════════════════════════════════
// The cross-count repairs, and the rail that stops them evaporating.
//
// `shared: true` makes the demand model SKIP a section, so losing one charges the degree
// twice for the same courses. Measured on the run that surfaced this: 21 of 1,078 shapes
// went from a plan to `mostly-unschedulable`, and every guard in `update-majors.yml` passed
// while it happened — nothing in that workflow generates a plan.
//
// So there are two things to hold: the manifest APPLIES, and a manifest that no longer fits
// STOPS the run. These tests are written against the failure, not the happy path.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applySharedSections, SHARED_SECTIONS } from "../../scripts/lib/shared-sections.js";
import { checkSharedSectionsRail } from "../../scripts/lib/scrape-rails.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");

const rec = (...titles) => ({ requirementSections: titles.map(t => ({ title: t })) });

test("shared › a manifest title is marked, and only that one", () => {
  // Driven through the real manifest rather than a fixture: the function's whole job is the
  // `<sourceUrl>#<slug>` key shape, and a fixture would test a lookup nobody performs.
  const key = Object.keys(SHARED_SECTIONS)[0];
  const [url, slug] = key.split("#");
  const want = SHARED_SECTIONS[key];
  const data = rec(...want, "Something Else Entirely");
  const out = applySharedSections(data, { url, slug });
  assert.equal(out.applied, want.length);
  assert.deepEqual(out.missing, []);
  for (const s of data.requirementSections) {
    assert.equal(!!s.shared, want.includes(s.title), `${s.title} marked wrongly`);
  }
});

test("shared › a title that matches nothing is REPORTED, never invented", () => {
  // The signal that the catalog reorganised under a hand adjudication. Adding the section
  // would be manufacturing a requirement, which is worse than losing the repair.
  const key = Object.keys(SHARED_SECTIONS)[0];
  const [url, slug] = key.split("#");
  const data = rec("A Section That Is Not In The Manifest");
  const out = applySharedSections(data, { url, slug });
  assert.equal(out.applied, 0);
  assert.deepEqual(out.missing, SHARED_SECTIONS[key]);
  assert.equal(data.requirementSections.length, 1, "no section was added");
});

test("shared › a program not in the manifest is untouched", () => {
  const data = rec("Core", "Electives");
  const out = applySharedSections(data, { url: "https://example.invalid/x/", slug: "nope" });
  assert.deepEqual(out, { applied: 0, missing: [] });
  for (const s of data.requirementSections) assert.ok(!s.shared);
});

test("shared › an already-marked section is not double-counted", () => {
  const key = Object.keys(SHARED_SECTIONS)[0];
  const [url, slug] = key.split("#");
  const want = SHARED_SECTIONS[key];
  const data = { requirementSections: want.map(t => ({ title: t, shared: true })) };
  assert.equal(applySharedSections(data, { url, slug }).applied, 0,
    "already true, so nothing was newly applied");
});

test("shared › junk in, nothing out — never a throw", () => {
  for (const bad of [null, undefined, {}, { requirementSections: null },
                     { requirementSections: [null] }, { requirementSections: [{}] }]) {
    const out = applySharedSections(bad, { url: "https://example.invalid/", slug: "x" });
    assert.deepEqual(out, { applied: 0, missing: [] });
  }
  assert.deepEqual(applySharedSections({}, {}), { applied: 0, missing: [] });
});

// ── The rail ───────────────────────────────────────────────────────

test("rail › a clean run passes", () => {
  const out = checkSharedSectionsRail([{ _slug: "a", _sharedMissing: [] }, { _slug: "b" }]);
  assert.deepEqual(out, { ok: true, misses: [] });
});

test("rail › ONE unmatched title fails the run, and names it", () => {
  // Deliberately not a ratio. A single lost repair is one degree a student cannot schedule,
  // and the workflow that would ship it generates no plan to notice.
  const out = checkSharedSectionsRail([
    { _slug: "accounting_msa_(boston)", _sharedMissing: ["Taxation Track"] },
    { _slug: "fine", _sharedMissing: [] },
  ]);
  assert.equal(out.ok, false);
  assert.deepEqual(out.misses, [
    { slug: "accounting_msa_(boston)", titles: ["Taxation Track"] }]);
});

test("rail › survives records with no marker at all", () => {
  assert.equal(checkSharedSectionsRail([]).ok, true);
  assert.equal(checkSharedSectionsRail(null).ok, true);
  assert.equal(checkSharedSectionsRail([null, undefined, {}]).ok, true);
});

// ── The manifest itself ────────────────────────────────────────────

test("manifest › matches what the committed corpus actually carries", () => {
  // The manifest was GENERATED from the corpus, so it must still describe it. If a future
  // edit adds an entry by hand, this is what checks the program and title really exist.
  const found = {};
  for (const dir of ["undergraduate", "graduate"]) {
    const base = join(ROOT, `data/northeastern/programs/${dir}/2026`);
    if (!existsSync(base)) continue;
    for (const col of readdirSync(base)) {
      const cd = join(base, col);
      if (!statSync(cd).isDirectory()) continue;
      for (const slug of readdirSync(cd)) {
        const f = join(cd, slug, "requirements.json");
        if (!existsSync(f)) continue;
        const d = JSON.parse(readFileSync(f, "utf8"));
        const titles = (d.requirementSections ?? [])
          .filter(s => s.shared).map(s => s.title).sort();
        // Keyed exactly as the manifest is — by page URL, because four slugs are filed
        // under more than one college and a slug key applied one program's adjudication
        // to another's page. The rail caught that; this keeps it caught.
        if (titles.length) found[`${d.metadata?.sourceUrl}#${slug}`] = titles;
      }
    }
  }
  assert.ok(Object.keys(found).length > 50,
    `only ${Object.keys(found).length} shared sections in the corpus — did a scrape drop them?`);
  assert.deepEqual(
    Object.keys(SHARED_SECTIONS).sort(), Object.keys(found).sort(),
    "the manifest and the corpus disagree about WHICH programs carry a shared section");
  for (const k of Object.keys(found)) {
    assert.deepEqual(SHARED_SECTIONS[k], found[k], `${k}: titles differ`);
  }
});
