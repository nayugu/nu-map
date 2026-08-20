// ═══════════════════════════════════════════════════════════════════
// CHART · COVERING SAMPLE — the default corpus for a question
//
// A full sweep of all 1,078 shapes is ~4–10 minutes. That is the right cost for a
// verdict and the wrong cost for a question, and the difference is not academic: three
// hypotheses about an empty-term regression were each disproved by a ten-minute run,
// during which three more changes went in flight and nothing could be attributed to
// anything (docs/chart-success-criteria.md).
//
// So the sweep is now opt-in (`--all`) and this is what runs by default.
//
// ── Why a UNIFORM sample is the wrong instrument ────────────────────
//
// Measured over the corpus, the properties a regression hides behind are rare:
//
//     concentration DISJUNCTION      112 of 1078   (10.4%)
//     shared section                 134           (12.4%)
//     15+ requirement sections        65            (6.0%)
//     40–79 SH                        80            (7.4%)
//
// A uniform 120 carries about 12 disjunction shapes and 7 with 15+ sections. The
// reservation rule is violated by roughly a quarter of the plans that have a
// disjunction, so a uniform draw catches a regression in it maybe half the time — and a
// guard that fails to fire half the time is not a guard, it is a coin that reports
// "clean" on tails. This is the same argument `chart-hard-rules.test.js` already makes
// for appending 20 disjunction programs to its uniform 45; this generalises it.
//
// ── How the sample is built ─────────────────────────────────────────
//
// A quota per stratum, filled greedily by whichever candidate covers the most
// still-underfilled strata, then a uniform draw to the target size. Greedy because the
// strata OVERLAP heavily — one graduate program with a disjunction and 15+ sections pays
// for three quotas at once — so a naive per-stratum draw costs several times the shapes
// for the same coverage.
//
// Deterministic: same corpus in, same sample out, from a fixed seed. A sample that moved
// between runs would make two measurements incomparable, which is the entire reason for
// measuring on a sample in the first place.
//
// ── What this CANNOT do ─────────────────────────────────────────────
//
// It cannot prove a corpus-wide property. A clean sample means "no regression in the
// shapes we covered", never "no violating plan exists" — so every caller must exit
// non-zero-and-loud rather than report a pass. `verify-chart.js` exits 3 for exactly
// this reason, on the same grounds it already refused to let `--limit` look like a tick.
// ═══════════════════════════════════════════════════════════════════

/**
 * Default sample size. 120 shapes, measured at **3:47** on a 10-core M-series machine.
 *
 * ── That is a 2x win, not the 9x the shape count suggests ───────────
 *
 * Stated wrongly here at first ("roughly 60–90 s"), on the assumption that 11% of the
 * shapes would cost 11% of the time. Measured, a covering sample costs **1.9 s/shape**
 * against the corpus mean of ~0.56 s/shape — 3.4x more, and for a structural reason:
 * this sample is deliberately weighted toward the rare strata, the rare strata are the
 * hard programs, and a hard program is one that spends its whole 5,000 ms budget before
 * refusing. Selecting for "unusual" selects for "expensive". Any stratified sample of
 * this corpus will have that property, so do not re-derive it as a surprise.
 *
 * ── Why the fix is NOT a smaller sample ─────────────────────────────
 *
 * Cutting `DEFAULT_QUOTA` is the obvious lever and it trades away precisely what
 * stratification was built to buy. The reservation rule is violated by roughly a quarter
 * of the plans carrying a concentration disjunction, so the chance of catching a
 * regression in it is 1-0.75^q: at the measured q=22 that is 99.8%, at q=10 it is 94%,
 * and at q=5 it is 76%. A quota of 5 turns the guard back into the coin this file exists
 * to replace. So the quota holds and the remaining cost is paid by PARALLELISM — the
 * sweep runs at 94% of one core with nine idle.
 */
export const DEFAULT_SAMPLE = 120;

/**
 * Shapes guaranteed per stratum, where the corpus has that many.
 *
 * 10 is a floor set by detection power, not by taste — see `DEFAULT_SAMPLE` for the
 * 1-0.75^q arithmetic. Lower it only with a number that says the guard still fires.
 */
export const DEFAULT_QUOTA = 10;

/**
 * The strata, as predicates over a shape descriptor.
 *
 * Two candidates were measured and DROPPED rather than shipped: `nested requirement
 * sections` matched 0 shapes (a stratum that is always empty is a check that always
 * passes) and `plan-of-study witness` matched 1078 of 1078 (a stratum every sample hits
 * for free discriminates nothing). Both would have padded the list and bought nothing.
 *
 * Each predicate takes `{ lvl, published, variantOf, concOptions, minOptions, sections,
 * sh, statedGE, coop, shared }` — see `describeShape`.
 */
export const STRATA = {
  "graduate": s => s.lvl === "graduate",
  "undergraduate": s => s.lvl !== "graduate",
  "published plan": s => s.published,
  "no published plan (donor path)": s => !s.published,
  "a non-primary variant": s => s.variantOf,
  "concentration disjunction": s => s.concOptions >= 2 && s.minOptions >= 1,
  "single/no concentration": s => !(s.concOptions >= 2 && s.minOptions >= 1),
  "co-op": s => s.coop,
  "no co-op": s => !s.coop,
  "shared section": s => s.shared,
  "catalog states generalElectiveSH": s => s.statedGE,
  "GE share derived": s => !s.statedGE,
  "sh<40": s => s.sh < 40,
  "sh40-79": s => s.sh >= 40 && s.sh < 80,
  "sh80-129": s => s.sh >= 80 && s.sh < 130,
  "sh130+": s => s.sh >= 130,
  "sec1-4": s => s.sections <= 4,
  "sec5-8": s => s.sections > 4 && s.sections <= 8,
  "sec9-14": s => s.sections > 8 && s.sections <= 14,
  "sec15+": s => s.sections > 14,
};

/**
 * The stratum inputs for one shape, read off the program record.
 *
 * `coop` and `shared` are matched against the SERIALISED record rather than a named
 * field, because both appear at several depths and under more than one key — the same
 * reason the program parser matches `*textcontainer` instead of one id. It is a
 * deliberate over-match: a shape wrongly counted into a stratum only makes the sample
 * slightly less efficient, while a missed one leaves the stratum unfilled.
 */
export function describeShape({ lvl, data, variant, variantCount }) {
  const json = JSON.stringify(data);
  return {
    lvl,
    published: !!variant,
    variantOf: variantCount > 1,
    concOptions: (data.concentrations?.concentrationOptions ?? []).length,
    minOptions: data.concentrations?.minOptions ?? 0,
    sections: (data.requirementSections ?? []).length,
    sh: data.totalCreditsRequired ?? 0,
    statedGE: data.generalElectiveSH != null,
    coop: /co-?op/i.test(json),
    shared: /"shared"/.test(json),
  };
}

/**
 * Seeded shuffle. The corpus is ordered by college, so its head is not a sample.
 *
 * ── Canonicalised FIRST, and that is not decoration ─────────────────
 *
 * A seeded Fisher–Yates is a deterministic function of the input SEQUENCE, not of the
 * input SET — so reversing the corpus produced a different sample even though the shapes
 * were identical. Caught by the order-independence test, which is the whole reason it was
 * written. That matters because the corpus arrives from `readdirSync`: a different
 * filesystem, a renamed college folder, or a re-ordered walk would silently move the
 * sample, and two measurements taken across such a change would be incomparable while
 * looking directly comparable.
 *
 * Sorting by label first makes the permutation a function of the set alone.
 */
function shuffled(list, seed = 0xc0ffee) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const a = [...list].sort((x, y) => String(x.label).localeCompare(String(y.label)));
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Choose a covering sample.
 *
 * @param items  shapes, each `{ label, features }` where `features` is a `describeShape`
 * @returns `{ chosen, coverage, unfilled }` — `coverage` is per stratum
 *          `{ quota, got, available }`, and `unfilled` names the strata the CORPUS
 *          cannot fill, which is a fact about the data and must be printed, not hidden.
 */
export function coveringSample(items, {
  size = DEFAULT_SAMPLE, quota = DEFAULT_QUOTA, strata = STRATA, seed = 0xc0ffee,
} = {}) {
  const names = Object.keys(strata);
  // Precompute membership once. Recomputing predicates inside the greedy loop made this
  // O(size x items x strata) for no reason.
  const pool = shuffled(items, seed).map(it => ({
    it, in: new Set(names.filter(n => strata[n](it.features))),
  }));

  const available = Object.fromEntries(
    names.map(n => [n, pool.filter(p => p.in.has(n)).length]));
  const want = Object.fromEntries(
    names.map(n => [n, Math.min(quota, available[n])]));
  const got = Object.fromEntries(names.map(n => [n, 0]));

  const chosen = [];
  const taken = new Set();
  // ── Greedy on UNMET need, not on stratum count ────────────────────
  //
  // Scoring a candidate by how many strata it belongs to picks the most generic shape
  // every time — an undergraduate with a published plan and no co-op — and never reaches
  // the rare combinations that are the whole point. Scoring by how much still-unmet
  // quota it closes drives straight at them.
  for (;;) {
    let best = null, bestScore = 0;
    for (const p of pool) {
      if (taken.has(p.it.label)) continue;
      let score = 0;
      for (const n of p.in) if (got[n] < want[n]) score++;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (!best) break;            // every quota met, or nothing left that helps
    taken.add(best.it.label);
    chosen.push(best.it);
    for (const n of best.in) got[n]++;
  }

  // Fill to the target with a uniform draw. The quota buys COVERAGE; this buys the
  // ordinary-case power that a purely quota-driven set lacks, because a covering set is
  // by construction made of unusual shapes.
  for (const p of pool) {
    if (chosen.length >= size) break;
    if (taken.has(p.it.label)) continue;
    taken.add(p.it.label);
    chosen.push(p.it);
    for (const n of p.in) got[n]++;
  }

  return {
    chosen,
    coverage: Object.fromEntries(
      names.map(n => [n, { quota: want[n], got: got[n], available: available[n] }])),
    unfilled: names.filter(n => available[n] < quota),
  };
}

/** One-line-per-stratum coverage report. Printed by callers, never swallowed. */
export function formatCoverage({ chosen, coverage, unfilled }, total) {
  const lines = [`  covering sample: ${chosen.length} of ${total} shapes `
    + `(${(100 * chosen.length / Math.max(1, total)).toFixed(1)}%)`];
  const worst = Object.entries(coverage).sort((a, b) => a[1].got - b[1].got).slice(0, 6);
  lines.push(`  thinnest strata: ` + worst
    .map(([n, c]) => `${n} ${c.got}/${c.available}`).join(", "));
  if (unfilled.length) {
    lines.push(`  strata the CORPUS cannot fill to quota: ${unfilled.join(", ")}`);
  }
  return lines.join("\n");
}
