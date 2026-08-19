// ═══════════════════════════════════════════════════════════════════
// A key BUILT at runtime still has to exist.
//
// `locale-completeness` checks that no locale carries a key `en` lacks. It cannot see the
// opposite and more damaging case: a key the code ASKS for that exists nowhere. `t()` ends
// in `?? key`, so the reader gets the literal string `chart.deriv.retry.department-early-terms`
// in the middle of a sentence — and every locale is equally broken, so no completeness check
// notices.
//
// That is not hypothetical. It shipped: the early-terms fallback emits
// `retry.because = "department-early-terms"`, the spine renders
// `t(\`chart.deriv.retry.${because}\`)`, and the string was never written. 19 of 258 plans
// would have printed the raw key.
//
// ── Why this is not a static analyser ───────────────────────────────
//
// Resolving every template key in the codebase is not decidable and the attempt would be a
// maintenance burden that rots. What IS enumerable is the small number of places where a key
// is built from a value the ENGINE emits, and those are exactly the ones a new engine feature
// breaks. So each family below names its source of truth — an exported constant, or the
// literals the engine emits — and asserts the strings exist for every member.
//
// Add a new `trace.stage("retry", { because })` reason and this fails until the sentence is
// written, which is the whole point.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { strings as en } from "../../src/locales/en.js";
import { EXCLUSION } from "../../src/core/derivation/events.js";
import {
  MOVED_AVAILABILITY, MOVED_PREREQ, MOVED_CAPACITY,
} from "../../src/engine/earlyTerms.js";
import { ORDER_KEYS } from "../../src/core/derivation/steps.js";

// ── The walkthrough's REASON sentences, which had no guard at all ────
//
// `whyText` and `reasonText` in `BuildSteps.jsx` build their key from the comparator key, and for
// `claim` they append the rank as well — `why2.claim.1`, `why.claim.2`. `whyText` also appends
// `.one` where a count of one needs its own sentence. Every one of those is assembled at runtime
// from something the ENGINE decided, which is precisely the shape this file exists for, and the
// family was not listed here. Probing it found real leaks: `constructor` and `-1` both reached
// `headlineWhy`, and each would have printed its own key to the reader.
//
// `claimRank` returns 0, 1 or 2 — all three are reachable, because `whyText` defaults a missing
// value to 2 — so all three sentences must exist.
const CLAIM_RANKS = ["0", "1", "2"];
// The keys whose singular reads differently enough to need its own sentence. From `whyText`.
const COUNTABLE = ["terms", "options", "depth", "tie"];
/** One comparator key as the locale suffixes it actually produces. */
const expand = (k) => (k === "claim" ? CLAIM_RANKS.map(v => `claim.${v}`) : [k]);

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");

/** Every `because: "..."` the engine hands to a `retry` stage. */
function retryReasons() {
  const dir = join(ROOT, "src/engine");
  const out = new Set();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const src = readFileSync(join(dir, f), "utf8");
    // Only inside a `retry` stage — `because` is a common enough word that a looser match
    // would sweep up comments and unrelated fields.
    for (const m of src.matchAll(/trace\.stage\(\s*"retry"\s*,\s*\{\s*because:\s*"([^"]+)"/g)) {
      out.add(m[1]);
    }
  }
  return [...out];
}

const families = [
  {
    what: "retry reasons the engine emits",
    prefix: "chart.deriv.retry.",
    members: retryReasons(),
    why: "the spine renders t(`chart.deriv.retry.${because}`) for every retry it records",
  },
  {
    what: "exclusion reasons a card can carry",
    prefix: "chart.deriv.fate.",
    members: Object.values(EXCLUSION),
    why: "the derivation tree names why each term was ruled out",
  },
  {
    what: "why the early terms moved a course",
    prefix: "chart.early.moved.",
    members: [MOVED_AVAILABILITY, MOVED_PREREQ, MOVED_CAPACITY],
    why: "the explainer renders t(`chart.early.moved.${why}`) for every repaired course",
  },
  {
    what: "who planned the early terms",
    prefix: "chart.early.",
    // The KEY suffixes, which are not the `source` values — `similar-programs` reads a key
    // named `similar`. `EarlyTerms` maps them with an explicit ternary rather than by
    // interpolation, so a missing one cannot be produced at runtime; listed anyway because
    // there are four lead sentences and exactly one of them is ever shown, which is the
    // shape where a gap goes unnoticed longest.
    members: ["department", "similar", "own", "relaxed"],
    why: "`EarlyTerms` picks one lead sentence by `report.earlyTerms.source`",
  },
  {
    what: "the early-terms stage, by source",
    prefix: "chart.deriv.stage.early.",
    members: ["department", "similar-programs", "chart"],
    why: "the spine titles the stage by the source the engine recorded",
  },
  {
    what: "the ranking ladder's rungs",
    prefix: "chart.deriv.rank.rung.",
    // `RUNGS` in BuildSteps is exactly this: a tie is not a test, so it carries no rung.
    members: ORDER_KEYS.filter(k => k !== "tie"),
    why: "the ladder lists one line per comparator key, numbered by the order it consults them",
  },
  {
    what: "the headline reason, in prose",
    prefix: "chart.deriv.rank.why2.",
    members: [
      ...ORDER_KEYS.flatMap(expand),
      ...COUNTABLE.flatMap(k => expand(k).map(b => `${b}.one`)),
    ],
    why: "`whyText` builds this from the comparator key, the claim rank, and whether the count is 1",
  },
  {
    what: "the terse reason, for the queue rows and the small print",
    prefix: "chart.deriv.rank.why.",
    // `last` is not a comparator key — `orderReason` returns it when there is no row below to be
    // ahead of — so it is added here rather than coming from `ORDER_KEYS`.
    members: [...ORDER_KEYS.flatMap(expand), "last"],
    why: "`reasonText` renders every queue row's reason, and now the demoted keys in the small print",
  },
];

for (const { what, prefix, members, why } of families) {
  test(`dynamic keys › ${what} all resolve`, () => {
    // A family that silently empties would pass forever. The extractor above is the only one
    // that can, so it is the one worth guarding.
    assert.ok(members.length > 0, `no members found for ${prefix} — the extractor is broken`);
    const missing = members.filter(m => !(prefix + m in en));
    assert.deepEqual(missing.map(m => prefix + m), [],
      `${missing.length} key(s) are built at runtime and exist in no locale. ${why}. `
      + `t() ends in "?? key", so each of these prints its own name to the reader.`);
  });
}

test("dynamic keys › the retry extractor actually reads the engine", () => {
  // It must be able to FAIL. If the regex stops matching, every assertion above passes over
  // an empty list — the failure mode this file exists to prevent, one level up.
  const found = retryReasons();
  assert.ok(found.includes("department-early-terms"),
    `the extractor found [${found}] and missed the reason that motivated this file`);
  assert.ok(found.length >= 3, `only ${found.length} retry reasons found; expected at least 3`);
});
