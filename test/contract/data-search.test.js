// CONTRACT · src/core/entitySearch.js — the /data omnibox holds its promises.
//
// The promise is "type anything on this data surface and the right page comes
// up". That is a property, so this file checks properties rather than examples:
//
//   · MONOTONICITY — once an entity appears in the list, typing one more
//     character must not remove it, and an entity must NEVER be absent when
//     queried by its own full name. This is the primary metric. Recall@1 on an
//     exact full name scores 99.8% before any work is done and therefore
//     measures nothing; monotonicity found a real defect on its first run —
//     3.39% of prefix queries dropped their entity and 434 entities were
//     unreachable by their own name, all because a course code was matched by
//     equality instead of tokenized.
//   · REPRESENTATION — the best hit of every kind that matched is on screen.
//     "Chemistry" is a subject, a BS, a minor and an MS, and burying three of
//     them is the failure this rule exists to prevent.
//   · THE CODEC REFUSES RUBBISH — on Cloudflare Pages a missing file answers
//     with the HTML shell at status 200, so decode is the only real gate.
//   · NOTHING IS INVENTED — a junk query returns nothing, not something.
//
// It runs against a FIXED fixture (test/fixtures/data-search-index.json,
// regenerated with `node scripts/data-search-probe.js --fixture`), never live
// data: the catalog is rescraped monthly and pushed to main unattended, so a
// contract keyed on live data would fail that job for reasons that are not
// regressions.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INDEX_VERSION, encodeIndex, decodeIndex, prepareIndex, searchEntities, urlOf, applyRepresentation,
} from "../../src/core/entitySearch.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "..", "fixtures", "data-search-index.json");
const payload = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const prepared = prepareIndex(decodeIndex(payload));
const LIMIT = 10;

/** How a person would type this entity: the code leads when there is one. */
const typedForm = (r) => (r.code ? `${r.code} ${r.name}` : r.name);

test("data-search › the fixture is a real corpus, not a stub", () => {
  assert.ok(prepared.records.length > 700, `only ${prepared.records.length} records`);
  const kinds = new Set(prepared.records.map((r) => r.kind));
  for (const k of prepared.kinds) assert.ok(kinds.has(k.id), `fixture has no ${k.id}`);
  // The hard cases the fixture is stratified for must actually be present, or
  // every assertion below is measuring the easy corpus.
  const names = prepared.records.map((r) => r.name.toLowerCase());
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  assert.ok(dupes.length >= 20, `only ${dupes.length} duplicate names — fixture lost its collisions`);
  assert.ok(prepared.records.some((r) => (r.aliases ?? []).length), "fixture has no aliases");
  assert.ok(prepared.records.some((r) => r.name.length > 90), "fixture has no long names");
});

test("data-search › every entity is found by its own full name", () => {
  // The hard half of monotonicity, and the one that must be exactly zero: if a
  // page cannot be reached by typing its own name, it is unsearchable.
  const missing = [];
  for (let i = 0; i < prepared.records.length; i++) {
    const hits = searchEntities(prepared, typedForm(prepared.records[i]), { limit: LIMIT });
    if (!hits.some((h) => h.index === i)) missing.push(typedForm(prepared.records[i]));
  }
  assert.deepEqual(missing, [], `${missing.length} entities unreachable by their own name`);
});

test("data-search › typing one more character does not lose the entity", () => {
  // A drop IS legitimate at a list cutoff: "Bioe" is the derived acronym of
  // BSBioE, so every Bioengineering program matches at the ACRONYM tier, while
  // "Bioen" matches no acronym and they all fall to PREFIX where coverage
  // reorders them — a long qualified name then loses to the plain ones. So this
  // is a ratchet on a rare event, not a zero. It was 3.39% before codes were
  // tokenized; anything near that is a regression, not a cutoff artifact.
  let queries = 0;
  const drops = [];
  for (let i = 0; i < prepared.records.length; i++) {
    const typed = typedForm(prepared.records[i]).slice(0, 40);
    let had = false;
    for (let L = 3; L <= typed.length; L++) {
      const q = typed.slice(0, L).trim();
      if (!q) continue;
      queries++;
      const inList = searchEntities(prepared, q, { limit: LIMIT }).some((h) => h.index === i);
      if (had && !inList) drops.push(`"${typed.slice(0, L - 1)}" → "${q}" lost ${prepared.records[i].name}`);
      had = inList;
    }
  }
  const rate = drops.length / queries;
  assert.ok(rate < 0.005,
    `${drops.length} drops in ${queries} prefix queries (${(rate * 100).toFixed(3)}%)\n  `
    + drops.slice(0, 8).join("\n  "));
});

test("data-search › the best hit of every matching kind is on screen", () => {
  // Take queries that genuinely span kinds, and assert the guarantee holds
  // against the UNLIMITED ranking rather than against a hand-written list.
  for (const q of ["chemistry", "biology", "computer", "science", "data", "health", "art", "1"]) {
    const all = searchEntities(prepared, q, { limit: 1e6 });
    if (all.length <= LIMIT) continue;
    const kinds = [...new Set(all.map((h) => h.kind))];
    const shown = searchEntities(prepared, q, { limit: LIMIT });
    const shownKinds = new Set(shown.map((h) => h.kind));
    for (const k of kinds.slice(0, LIMIT)) {
      assert.ok(shownKinds.has(k), `"${q}" matched ${k} but did not show it`);
      // …and it must be that kind's BEST hit, not merely one of them.
      const best = all.find((h) => h.kind === k);
      assert.ok(shown.some((h) => h.index === best.index),
        `"${q}" showed ${k} but not its best hit (${prepared.records[best.index].name})`);
    }
  }
});

test("data-search › representation never invents or duplicates a hit", () => {
  const hits = Array.from({ length: 40 }, (_, i) => ({ index: i, kind: `k${i % 5}`, score: 1000 - i }));
  const out = applyRepresentation(hits, 10);
  assert.equal(out.length, 10);
  assert.equal(new Set(out.map((h) => h.index)).size, 10, "a hit appeared twice");
  for (const h of out) assert.ok(hits.includes(h), "a hit was invented");
  assert.equal(new Set(out.slice(0, 5).map((h) => h.kind)).size, 5, "the five kinds were not promoted");
  // Below the limit it must be a pass-through, not a reshuffle.
  const few = hits.slice(0, 6);
  assert.deepEqual(applyRepresentation(few, 10), few);
});

test("data-search › an exact code routes, and routing is exact", () => {
  const coded = prepared.records.filter((r) => r.code);
  assert.ok(coded.length > 100, "fixture has too few coded records");
  for (const r of coded.slice(0, 120)) {
    const top = searchEntities(prepared, r.code, { limit: LIMIT })[0];
    assert.ok(top, `"${r.code}" returned nothing`);
    assert.equal(top.routed, true, `"${r.code}" did not route`);
    assert.equal(prepared.records[top.index].code, r.code, `"${r.code}" routed elsewhere`);
    // The unspaced form is the same request.
    const squashed = r.code.replace(/ /g, "").toLowerCase();
    const alt = searchEntities(prepared, squashed, { limit: LIMIT })[0];
    assert.ok(alt && prepared.records[alt.index].code === r.code, `"${squashed}" did not route`);
  }
});

test("data-search › a nickname reaches its course", () => {
  for (const r of prepared.records) {
    for (const alias of r.aliases ?? []) {
      const hits = searchEntities(prepared, alias, { limit: LIMIT });
      assert.ok(hits.some((h) => prepared.records[h.index].code === r.code),
        `alias "${alias}" did not reach ${r.code}`);
    }
  }
});

test("data-search › junk returns nothing at all", () => {
  for (const junk of ["", "   ", "!!!", "!!! ???", "zzzzqx", "qqqqqqqq", " ",
                      "-----", "...", "@@@", "🙂", "zzz zzz zzz"]) {
    assert.deepEqual(searchEntities(prepared, junk, { limit: LIMIT }), [],
      `${JSON.stringify(junk)} returned results`);
  }
  // Null-ish input must not throw either.
  for (const bad of [null, undefined]) assert.deepEqual(searchEntities(prepared, bad), []);
});

test("data-search › every result resolves to a real page path", () => {
  for (let i = 0; i < prepared.records.length; i++) {
    const url = urlOf(prepared, i);
    assert.ok(url.startsWith("/data/"), `${url} is not under /data/`);
    assert.ok(!url.includes("//"), `${url} has a doubled slash`);
    assert.ok(!/\s/.test(url), `${url} contains whitespace`);
    assert.ok(!url.endsWith("/"), `${url} ends in a slash`);
  }
  // Paths are unique, or two entities share a page and one is unreachable.
  const urls = prepared.records.map((_, i) => urlOf(prepared, i));
  assert.equal(new Set(urls).size, urls.length, "two records share a URL");
});

test("data-search › the codec refuses anything that is not an index", () => {
  const html = "<!DOCTYPE html><html><body>the SPA shell, at status 200</body></html>";
  for (const bad of [null, undefined, 0, "", html, [], "{}", { v: 1 }, { v: 99, kinds: [{ id: "x" }] }]) {
    assert.throws(() => decodeIndex(bad), /index/i, `accepted ${JSON.stringify(bad)?.slice(0, 40)}`);
  }
  // A ragged payload is the dangerous one: it would decode into silent nonsense.
  const ragged = JSON.parse(JSON.stringify(payload));
  ragged.n = ragged.n.slice(0, -1);
  assert.throws(() => decodeIndex(ragged), /rows/);
  // An unknown kind index must not produce an undefined kind.
  const badKind = JSON.parse(JSON.stringify(payload));
  badKind.k = badKind.k.map(() => 99);
  assert.throws(() => decodeIndex(badKind), /kind index/);
});

test("data-search › encode refuses what it cannot represent", () => {
  const kinds = [{ id: "course", label: "Course", prefix: "/data/courses/" }];
  assert.throws(() => encodeIndex([{ kind: "nope", name: "x", path: "x" }], kinds), /unknown kind/);
  assert.throws(() => encodeIndex([{ kind: "course", name: "", path: "x" }], kinds), /without a name/);
  assert.throws(() => encodeIndex([{ kind: "course", name: "x" }], kinds), /neither path nor code/);
  // The list separator inside a value would merge two entries on decode.
  assert.throws(() => encodeIndex([{ kind: "course", name: "x", path: "x", aliases: ["a|b"] }], kinds), /\|/);
});

test("data-search › encode and decode are inverse over the whole fixture", () => {
  const round = decodeIndex(payload);
  const again = encodeIndex(round.records, round.kinds);
  assert.equal(again.v, INDEX_VERSION);
  const back = decodeIndex(again);
  assert.equal(back.records.length, round.records.length);
  for (let i = 0; i < round.records.length; i++) {
    assert.deepEqual(back.records[i], round.records[i], `row ${i} changed on re-encode`);
  }
  // The derived-path optimisation must be invisible: a coded record stores no
  // path, and still decodes to the same one.
  const coded = round.records.find((r) => r.code && r.path);
  assert.ok(coded, "fixture has no coded record");
  assert.equal(again.p[round.records.indexOf(coded)], "", "a derivable path was still stored");
});

test("data-search › a directory page is found by its own name", () => {
  // These seven were exempt from the index as "navigation", so "equivalences",
  // "nupath", "professors" and "minors" each returned NOTHING — seven front
  // doors reachable only by clicking the rail. Each must now come back FIRST
  // for its own name: a section is the coarsest possible answer, so if it does
  // not win an exact match on its own label it is not worth indexing at all.
  const sections = prepared.records.filter((r) => r.kind === "section");
  assert.ok(sections.length >= 7, `fixture has ${sections.length} sections`);
  for (const s of sections) {
    const top = searchEntities(prepared, s.name, { limit: LIMIT })[0];
    assert.ok(top, `"${s.name}" returned nothing`);
    assert.equal(prepared.records[top.index].name, s.name, `"${s.name}" was outranked`);
    assert.equal(prepared.records[top.index].kind, "section");
  }
  // …and a directory must not hijack a query that merely CONTAINS its name:
  // "minors" is a directory, "Biology, Minor" is a program. The example is
  // DERIVED from the fixture rather than written in, because the fixture is a
  // sample and a hard-coded program name may simply not be in it — which is
  // how this assertion first failed, on a fixture with no "Biology, Minor".
  const labels = sections.map((s) => s.name.toLowerCase().replace(/s$/, ""));
  const victim = prepared.records.find((r) => r.kind !== "section"
    && labels.some((l) => r.name.toLowerCase().includes(l)));
  assert.ok(victim, "fixture has no entity whose name contains a directory's name");
  const top = searchEntities(prepared, victim.name, { limit: LIMIT })[0];
  assert.equal(prepared.records[top.index].name, victim.name,
    `a directory outranked "${victim.name}" for its own name`);
});

test("data-search › an accented name is reachable by typing ASCII", () => {
  // Synthetic, so the assertion holds whatever the month's catalog contains.
  // Measured on the real index: 3 of 13,022 records carry an accented letter
  // ("Bouvé" twice, professor "Zoë Lang"), and every one of them was
  // unreachable — the tokenizer treats "é" as a separator, so the word became
  // "bouv" and "bouve" prefixed nothing.
  const kinds = [
    { id: "course", label: "Course", prefix: "/data/courses/" },
    { id: "professor", label: "Professor", prefix: "/data/professors/" },
  ];
  const idx = prepareIndex(decodeIndex(encodeIndex([
    { kind: "course", name: "Professional Development for Bouvé Co-op", code: "PHTH 1201", path: "PHTH/1201" },
    { kind: "professor", name: "Zoë Lang", path: "zoe-lang" },
    { kind: "professor", name: "José Martínez", path: "jose-martinez" },
  ], kinds)));

  const names = (q) => searchEntities(idx, q, { limit: 5 }).map((h) => idx.records[h.index].name);
  assert.ok(names("bouve").some((n) => n.includes("Bouvé")), `"bouve" → ${names("bouve")}`);
  assert.ok(names("bouvé").some((n) => n.includes("Bouvé")), "the accented spelling must still work");
  assert.deepEqual(names("zoe"), ["Zoë Lang"]);
  assert.deepEqual(names("zoë"), ["Zoë Lang"]);
  assert.ok(names("jose martinez").includes("José Martínez"));
  assert.ok(names("martinez").includes("José Martínez"), "last name alone, unaccented");
  // Display text keeps its accents — folding is for matching only.
  assert.equal(idx.records[1].name, "Zoë Lang");
});

test("data-search › search is stable and order-independent of record order", () => {
  // Reversing the corpus must not change what comes back, or the ranking is
  // resting on insertion order somewhere.
  const round = decodeIndex(payload);
  const reversed = prepareIndex({ kinds: round.kinds, records: [...round.records].reverse() });
  for (const q of ["chemistry", "cs", "biology", "chem 2311", "data science", "1101"]) {
    const a = searchEntities(prepared, q, { limit: LIMIT })
      .map((h) => prepared.records[h.index].name + "|" + prepared.records[h.index].code);
    const b = searchEntities(reversed, q, { limit: LIMIT })
      .map((h) => reversed.records[h.index].name + "|" + reversed.records[h.index].code);
    assert.deepEqual(b, a, `"${q}" depends on record order`);
  }
});
