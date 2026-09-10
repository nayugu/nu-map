/**
 * programChunks.js — group the per-program JSON modules into size-capped chunks.
 *
 * ── The wall this exists for ─────────────────────────────────────────
 *
 * `src/data/majorLoader.js`, `minorLoader.js` and `samplePlanLoader.js` reach
 * their data with `import.meta.glob(..., { eager: false })`, which is exactly
 * right for the app — keys are known synchronously so the picker can enumerate
 * programs without fetching any, and a record is fetched only when a student
 * declares that program. What it also does is emit ONE ROLLUP CHUNK PER MATCHED
 * FILE: measured 2026-09-10, 2,306 `requirements-*.js` and 385 `plan-*.js` in
 * `dist/assets`.
 *
 * Cloudflare Pages' free plan caps a deployment at 20,000 FILES, and going over
 * does not fail a request — it fails the DEPLOY, silently, leaving the site
 * serving the last good build while the monthly scrape commits data nobody
 * receives. The build was at 19,176 (95.9%). Worse, each new catalog edition adds
 * ~1,150 of these chunks, so the 5-7 years of requirements students actually need
 * was unaffordable on any plan. See docs/scalability.md § 1.
 *
 * ── Why manualChunks and not a fetch-a-bundle rewrite ────────────────
 *
 * The obvious fix was to stop using the glob: emit bundles, ship a manifest, and
 * have the loaders fetch and index them. That was designed and abandoned, for one
 * reason that outweighs everything else — **the glob's KEYS are the program
 * identity, and they are persisted.** A saved plan's `major` field is literally
 * `../../data/northeastern/programs/undergraduate/2026/science/biology_bs_(boston)/requirements.json`,
 * and so are `major2`, `minor1`, `minor2`; share links carry the same strings
 * through `planSchema`; and `resolveInMap`'s four migration tiers parse them. A
 * rewrite has to reproduce every one of those strings byte-identically from a
 * generated manifest, and getting one wrong breaks a real student's saved plan
 * with no way to notice.
 *
 * Rollup already solves this at the layer where it costs nothing. `manualChunks`
 * decides which OUTPUT FILE a module lands in; it does not touch module ids,
 * import specifiers, the glob, or laziness. So keys stay byte-identical by
 * construction rather than by care, no loader changes, no manifest, no migration
 * — and the app still fetches on demand, just a group at a time.
 *
 * ── Why size-capped and not per college ──────────────────────────────
 *
 * Per college per year was the first grouping and it has a bad tail. Measured,
 * gzipped, over all 2,306 records:
 *
 *     grouping                files   median load   worst load
 *     one chunk per program   2,306         1.3K         4.0K
 *     per college per year        50        18.6K       192.8K   <- the tail
 *     size-capped (this)          65        21.8K        26.8K
 *
 * social-sciences-humanities is 193K gzipped on its own, so a student declaring
 * one program there would fetch 150x what they do today. Capping costs 15 more
 * files and cuts the worst case 7x, which is the better trade: the file budget
 * has thousands of headroom and a student has one connection.
 *
 * ⚠ The cap is a TARGET, not a bound, and that is deliberate. Packing decides on
 * RAW bytes against a budget derived from the observed compression ratio, so a
 * 20K cap produced a 26.8K max — 34% over. The alternative is to compress each
 * candidate shard as it grows to find the exact boundary, which is O(n^2)
 * compressions; the first version of the measurement script did that and blew a
 * 120-second timeout on 2,306 records. One pass, one compression per sealed
 * chunk, and a soft cap is the right shape for a build step.
 */
import { readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

/**
 * Raw bytes per chunk. `RATIO` is the measured gzip ratio of these records
 * bundled together (25.17 MB -> 1,271K, so ~20x); `TARGET_GZIP` is what a
 * student's first program load should cost. Both are named rather than folded
 * into one constant because they mean different things: one is a property of the
 * data and moves when the catalog does, the other is a product decision.
 *
 * ── Why 10K ─────────────────────────────────────────────────────────
 *
 * Measured, gzipped, with the deployment total each cap implies at seven
 * editions and the years of catalog growth (+554 course pages a roll) left after:
 *
 *     cap   chunks   median    max    7 editions   headroom   years
 *      3K      503     3.7K   5.5K      80.9%        3,828     6.9
 *      5K      289     5.7K   8.1K      77.0%        4,607     8.3
 *     10K      138    10.8K  14.1K      74.2%        5,158     9.3   <- here
 *     20K       68    20.5K  27.1K      72.9%        5,413     9.8
 *
 * The curve is CONVEX, and that is the whole decision: 20K -> 10K halves a
 * student's first program load for 0.5 years of runway, while 10K -> 5K takes
 * another quarter off and costs a further 1.0. Take the cheap half, stop.
 *
 * The first version shipped 20K, chosen while the deployment sat at 95.9% of the
 * file cap, when files felt precious. The correction after the /data JSON was
 * bundled overshot to 5K, on the argument that spare files buy nothing. Both
 * were wrong in the same way — treating bytes and files as interchangeable. They
 * are not: load bytes are a one-time cost anyone can revisit in an afternoon,
 * while headroom is consumed by an unattended monthly job that nobody watches.
 * Spend the cheap half of the file budget, keep the rest for the scrape.
 *
 * Not taken further toward 20K because the WORST case is what a student feels:
 * 27.1K on a ~400 Kbps mobile connection is about 540 ms to declare a major
 * against ~280 ms at 14.1K, and campus wifi is not always better than that.
 */
const TARGET_GZIP = 10 * 1024;
const RATIO = 20;
const BUDGET = TARGET_GZIP * RATIO;

/** Every `<name>.json` under a program tree, in a stable sorted order. */
function programFiles(root, name) {
  const out = [];
  const trees = join(root, "data", "northeastern", "programs");
  for (const tree of ["undergraduate", "graduate"]) {
    const base = join(trees, tree);
    let years;
    try { years = readdirSync(base).filter((y) => /^\d{4}$/.test(y)).sort(); }
    catch { continue; }
    for (const year of years) {
      for (const college of readdirSync(join(base, year)).sort()) {
        const cd = join(base, year, college);
        if (!statSync(cd).isDirectory()) continue;
        for (const slug of readdirSync(cd).sort()) {
          const f = join(cd, slug, name);
          try {
            const st = statSync(f);
            // Sorted by PATH, so programs of one college land together and a
            // student declaring a major and a minor in the same college usually
            // gets both from one chunk.
            out.push({ file: f, size: st.size, tree, year });
          } catch { /* no such sibling — plan.json is optional */ }
        }
      }
    }
  }
  return out;
}

/**
 * `absolute module id -> chunk name`, for `rollupOptions.output.manualChunks`.
 *
 * Chunks never span a TREE or a YEAR even when there is budget left. Two reasons:
 * a graduate student never needs undergraduate records, and an edition roll then
 * rewrites only the chunks of the year that changed rather than reflowing every
 * chunk after the insertion point — which would break every cached chunk a
 * returning visitor holds.
 *
 * @param {string} root repo root
 * @returns {Map<string, string>}
 */
export function programChunkMap(root) {
  const map = new Map();
  for (const [name, prefix] of [["requirements.json", "prog"], ["plan.json", "plan"]]) {
    let key = null, index = 0, used = 0;
    for (const { file, size, tree, year } of programFiles(root, name)) {
      const scope = `${tree}-${year}`;
      if (scope !== key) { key = scope; index = 0; used = 0; }
      else if (used + size > BUDGET) { index += 1; used = 0; }
      used += size;
      map.set(file, `${prefix}-${tree === "graduate" ? "grad" : "ug"}-${year}-${index}`);
    }
  }
  return map;
}

/**
 * The `manualChunks` function itself.
 *
 * Returns `undefined` for everything else, which is what tells Rollup to keep
 * its own chunking for the app — returning a name for an unmatched module is how
 * you accidentally pull React into a data chunk.
 */
export function programManualChunks(root) {
  const map = programChunkMap(root);
  // Rollup ids are absolute and platform-native on disk, but a query suffix
  // (`?used`, `?commonjs-proxy`) or a posix-style separator both show up. Strip
  // the query and normalise separators so a lookup cannot miss for cosmetic
  // reasons and silently fall back to one chunk per file.
  return (id) => {
    const clean = String(id).split("?")[0].split("/").join(sep);
    return map.get(clean);
  };
}
