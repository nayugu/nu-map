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
import { applySharedSections, SHARED_SECTIONS, ADJUDICATED_EDITION } from "../../scripts/lib/shared-sections.js";
import { checkSharedSectionsRail, SHARED_RAIL_RUNBOOK } from "../../scripts/lib/scrape-rails.js";

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
    { _slug: "accounting_msa_(boston)", _sharedMissing: ["Taxation Track"],
      metadata: { sourceUrl: "https://catalog.northeastern.edu/graduate/business/accounting-msa/" } },
    { _slug: "fine", _sharedMissing: [] },
  ]);
  assert.equal(out.ok, false);
  // The URL is part of the contract, not incidental: this rail halts an unattended monthly
  // job, and the first thing whoever picks it up needs is the page to re-adjudicate against.
  assert.deepEqual(out.misses, [{
    slug: "accounting_msa_(boston)",
    titles: ["Taxation Track"],
    url: "https://catalog.northeastern.edu/graduate/business/accounting-msa/",
  }]);
});

test("rail › a record with no sourceUrl still reports, with url null", () => {
  // Degrade to less information, never to wrong information — and never to a throw. A
  // missing URL must not swallow the miss it was attached to.
  const out = checkSharedSectionsRail([{ _slug: "x", _sharedMissing: ["A"] }]);
  assert.equal(out.ok, false);
  assert.deepEqual(out.misses, [{ slug: "x", titles: ["A"], url: null }]);
});

test("rail › the runbook states the tempting WRONG recovery, not just the right ones", () => {
  // The failure mode this text exists for. A hard stop with no documented recovery gets
  // recovered by whatever is fastest — deleting the manifest entry — which silently
  // reintroduces the defect the manifest prevents. If that warning is ever dropped, the
  // runbook has stopped doing the one job it was written for.
  assert.match(SHARED_RAIL_RUNBOOK, /Deleting the entry/);
  assert.match(SHARED_RAIL_RUNBOOK, /RENAMED/);
  assert.match(SHARED_RAIL_RUNBOOK, /shared-sections\.js/);
});

test("rail › survives records with no marker at all", () => {
  assert.equal(checkSharedSectionsRail([]).ok, true);
  assert.equal(checkSharedSectionsRail(null).ok, true);
  assert.equal(checkSharedSectionsRail([null, undefined, {}]).ok, true);
});

// ── The manifest itself ────────────────────────────────────────────

/**
 * The newest edition committed for ONE tree.
 *
 * Per tree, not one global maximum, because the two trees roll SEPARATELY.
 * `update-majors.yml` and `update-grad-majors.yml` are different jobs on
 * different schedules, so a corpus where undergraduate is 2027 and graduate is
 * still 2026 exists for hours at every roll — and indefinitely when one of them
 * refuses, which is not hypothetical: the graduate scrape has been stopped by
 * the shared-section rail since 2026-09-01.
 *
 * A global `Math.max` reads that state as "the corpus is 2027" and then finds
 * no graduate 2027 programs, so it blames the manifest — 68 entries reported as
 * naming nothing — for a tree that simply has not been scraped. The failure
 * points at the wrong file, and the honest reading is per tree.
 */
function committedEdition(dir) {
  const base = join(ROOT, `data/northeastern/programs/${dir}`);
  if (!existsSync(base)) return null;
  const years = readdirSync(base).filter(y => /^\d{4}$/.test(y)).map(Number);
  return years.length ? Math.max(...years) : null;
}

test("manifest › matches what the committed corpus actually carries", () => {
  // The manifest was GENERATED from the corpus, so it must still describe it. If a future
  // edit adds an entry by hand, this is what checks the program and title really exist.
  //
  // ── Except across an edition roll ─────────────────────────────────
  // The manifest is adjudicated against the LIVE catalog and the corpus is the last one
  // SCRAPED, so between rolls they are the same document and this comparison is exact.
  // At a roll they are two different documents: NEU renamed four of these sections for
  // 2027 while the corpus was still 2026, and no offline test can tell a legitimate
  // rename from a typo. `ADJUDICATED_EDITION` records which document the titles came
  // from; while it is ahead, this checks the half that still holds — every entry names a
  // program that exists — and the exact comparison comes back by itself when the scrape
  // lands the new edition. The live check is the scrape rail, and it is unaffected.
  // Each tree is read at ITS OWN newest edition, and the run is "rolling" while
  // ANY tree is behind the adjudication — including the half-rolled corpus the
  // two separate workflows produce at every roll. Comparing exactly against a
  // tree that has not been scraped yet reports the manifest as broken when the
  // truth is that the data is missing; see committedEdition above.
  const editions = { undergraduate: committedEdition("undergraduate"), graduate: committedEdition("graduate") };
  const rolling = Object.values(editions).some(y => y == null || ADJUDICATED_EDITION > y);

  const found = {};
  for (const dir of ["undergraduate", "graduate"]) {
    const base = join(ROOT, `data/northeastern/programs/${dir}/${editions[dir]}`);
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

  if (!rolling) {
    // Named individually rather than as two sorted lists. This runs inside the
    // data workflows now, so a mismatch stops a monthly pipeline — and a
    // failure that prints 118 keys twice and leaves you to spot the difference
    // is how a hard stop becomes a rubber stamp.
    const orphaned = Object.keys(SHARED_SECTIONS).filter(k => !(k in found));
    const unclaimed = Object.keys(found).filter(k => !(k in SHARED_SECTIONS));
    assert.deepEqual(orphaned, [],
      `these manifest entries name no program in the corpus. Either the page moved (fix the `
      + `URL) or the program is gone from the catalog (delete the entry — runbook option 3). `
      + `A typo looks exactly like this and is inert everywhere else, which is why it is `
      + `caught here:\n  ${orphaned.join("\n  ")}`);
    assert.deepEqual(unclaimed, [],
      `these programs carry shared: true but the manifest does not, so the next scrape drops `
      + `the flag and the degree is charged twice for the same courses:\n  ${unclaimed.join("\n  ")}`);
    for (const k of Object.keys(found)) {
      assert.deepEqual(SHARED_SECTIONS[k], found[k], `${k}: titles differ`);
    }
    return;
  }

  // Rolling. Titles may legitimately differ; the program must still be real, and an entry
  // must still name at least one section, or it is doing nothing and should have been
  // deleted rather than emptied.
  const corpusPrograms = new Set(Object.keys(found).map(k => k.split("#")[1]));
  for (const [key, titles] of Object.entries(SHARED_SECTIONS)) {
    assert.ok(Array.isArray(titles) && titles.length, `${key}: an entry with no titles does nothing`);
    assert.ok(titles.every(t => typeof t === "string" && t.trim()), `${key}: a title must be a non-empty string`);
    assert.ok(corpusPrograms.has(key.split("#")[1]) || key.includes(`/${ADJUDICATED_EDITION}/`),
      `${key}: names a program the corpus has never carried — a typo, or a URL that moved`);
  }
});

test("manifest › the adjudicated edition is never behind the corpus", () => {
  // Behind means the titles describe a catalog OLDER than the one we have scraped, which
  // is not a state anything reaches honestly: the manifest is read from the live pages.
  // It would silently disable the exact-comparison branch above, so it is worth naming.
  assert.ok(ADJUDICATED_EDITION >= committedEdition(),
    `ADJUDICATED_EDITION (${ADJUDICATED_EDITION}) is older than the committed corpus `
    + `(${committedEdition()}) — re-adjudicate against the live catalog, or fix the constant`);
});
