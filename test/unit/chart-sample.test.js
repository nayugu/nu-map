// UNIT · scripts/lib/chart-sample.js — the sample every corpus measurement now runs on.
//
// This is load-bearing in a way a normal helper is not: `verify-chart.js` defaults to it, so a
// bug here does not produce a wrong number, it produces a CONFIDENT number over the wrong
// shapes. A sample that silently stopped covering concentration disjunctions would report
// "clean" forever and nobody would see a missing stratum in the output.
//
// So these tests attack the two properties the design actually rests on — coverage of rare
// strata, and determinism — plus the degenerate corpora a real run will eventually hit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coveringSample, describeShape, STRATA, DEFAULT_QUOTA }
  from "../../scripts/lib/chart-sample.js";

/** A shape whose features are stated directly, so a test can build a corpus by hand. */
const shape = (label, features) => ({ label, features: { lvl: "undergraduate", published: true,
  variantOf: false, concOptions: 0, minOptions: 0, sections: 6, sh: 128, statedGE: false,
  coop: false, shared: false, ...features } });

/** `n` shapes that differ only in label, so a stratum can be sized exactly. */
const many = (n, prefix, features) =>
  Array.from({ length: n }, (_, i) => shape(`${prefix}${i}`, features));

test("a rare stratum is covered to quota even when it is a sliver of the corpus", () => {
  // 5 rare shapes in 500. A uniform draw of 40 carries a median of 0 of them.
  const corpus = [...many(495, "ord", {}), ...many(5, "rare", { concOptions: 3, minOptions: 1 })];
  const { chosen, coverage } = coveringSample(corpus, { size: 40, quota: 5 });
  assert.equal(coverage["concentration disjunction"].got, 5,
    "every disjunction shape must be drawn when the corpus has exactly the quota");
  assert.equal(chosen.filter(c => c.label.startsWith("rare")).length, 5);
});

test("a stratum the corpus cannot fill is NAMED, not silently under-filled", () => {
  // The failure this prevents: a stratum quietly dropping to zero members after a scrape,
  // leaving the sample reporting clean over a property it no longer tests at all.
  const corpus = [...many(200, "ord", {}), ...many(2, "rare", { shared: true })];
  const { coverage, unfilled } = coveringSample(corpus, { size: 30, quota: DEFAULT_QUOTA });
  assert.ok(unfilled.includes("shared section"), "must report the stratum it could not fill");
  assert.equal(coverage["shared section"].got, 2, "and must still take all that exist");
  assert.equal(coverage["shared section"].available, 2);
});

test("coverage beats size: quotas are met even when they exceed the requested sample", () => {
  // Deliberate and worth pinning. 20 strata x quota 10 can demand more shapes than `size`,
  // and the sample returns the larger set rather than dropping a stratum. A caller wanting a
  // hard cap must lower the QUOTA, which costs detection power and should be a visible choice.
  const corpus = [
    ...many(40, "ug", {}),
    ...many(40, "gr", { lvl: "graduate", sh: 32, sections: 3 }),
    ...many(40, "vr", { variantOf: true, published: false, coop: true, shared: true }),
    ...many(40, "cn", { concOptions: 4, minOptions: 1, sh: 60, sections: 16, statedGE: true }),
  ];
  const { chosen } = coveringSample(corpus, { size: 5, quota: 10 });
  assert.ok(chosen.length > 5,
    `expected the covering set to override size 5, got ${chosen.length}`);
});

test("the same corpus gives the same sample, and order of input does not matter", () => {
  // Determinism is the whole reason to measure on a sample: two runs must be comparable.
  const corpus = [...many(120, "a", {}), ...many(30, "b", { concOptions: 2, minOptions: 1 })];
  const one = coveringSample(corpus, { size: 40 }).chosen.map(c => c.label);
  const two = coveringSample(corpus, { size: 40 }).chosen.map(c => c.label);
  assert.deepEqual(one, two, "same input must give the same sample");

  // A reversed corpus is the same SET of shapes, so the sample must be the same set too —
  // otherwise reading the programs off disk in a different order (a different filesystem,
  // a renamed college folder) would silently move the sample.
  const flipped = coveringSample([...corpus].reverse(), { size: 40 }).chosen.map(c => c.label);
  assert.deepEqual(new Set(flipped), new Set(one),
    "input order must not change which shapes are sampled");
});

test("an empty corpus returns nothing rather than throwing", () => {
  const { chosen, unfilled } = coveringSample([], { size: 40 });
  assert.deepEqual(chosen, []);
  assert.equal(unfilled.length, Object.keys(STRATA).length, "every stratum is unfillable");
});

test("a corpus smaller than the sample size returns all of it, exactly once", () => {
  const corpus = many(7, "s", {});
  const { chosen } = coveringSample(corpus, { size: 120 });
  assert.equal(chosen.length, 7);
  assert.equal(new Set(chosen.map(c => c.label)).size, 7, "no shape may be sampled twice");
});

test("every stratum is reachable — none is dead on arrival", () => {
  // The measured reason this exists: two candidate strata were dropped because one matched 0
  // shapes and one matched all 1,078. A stratum no shape can satisfy is a check that always
  // passes; this fails loudly if a predicate is ever written that nothing can match.
  const corpus = [
    shape("a", {}),
    shape("b", { lvl: "graduate" }),
    shape("c", { published: false, variantOf: true }),
    shape("d", { concOptions: 3, minOptions: 1 }),
    shape("e", { coop: true, shared: true, statedGE: true }),
    shape("f", { sh: 20, sections: 2 }),
    shape("g", { sh: 60, sections: 7 }),
    shape("h", { sh: 100, sections: 12 }),
    shape("i", { sh: 200, sections: 20 }),
  ];
  const dead = Object.entries(STRATA).filter(([, f]) => !corpus.some(s => f(s.features)));
  assert.deepEqual(dead.map(([n]) => n), [],
    "a stratum no shape in this hand-built corpus can satisfy is probably unsatisfiable");
});

test("describeShape reads co-op and shared sections at any depth", () => {
  // Both are matched against the serialised record on purpose: they appear under more than one
  // key and at several depths, so a named-field read misses them and leaves a stratum empty.
  const f = describeShape({
    lvl: "undergraduate",
    data: { totalCreditsRequired: 128,
            requirementSections: [{ title: "x", children: [{ kind: "shared", note: "Co-op" }] }] },
    variant: null, variantCount: 1,
  });
  assert.equal(f.shared, true, "a nested \"shared\" must still register");
  assert.equal(f.coop, true, "and so must a co-op mentioned only in a leaf note");
  assert.equal(f.published, false, "no variant means no published plan");
  assert.equal(f.sections, 1);
});

test("describeShape survives a record missing every optional field", () => {
  // Scraped input. A program whose requirements failed to parse must not take the sampler down
  // and with it every corpus measurement.
  const f = describeShape({ lvl: "graduate", data: {}, variant: null, variantCount: 1 });
  assert.equal(f.sh, 0);
  assert.equal(f.sections, 0);
  assert.equal(f.concOptions, 0);
  assert.equal(f.statedGE, false);
});
