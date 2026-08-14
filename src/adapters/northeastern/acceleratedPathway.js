// ═══════════════════════════════════════════════════════════════════
// ADAPTER (Northeastern): acceleratedPathway — the PlusOne data source.
//
// Northeastern brands this "PlusOne". The port and the core do not (see
// src/ports/IAcceleratedPathway.js for why), so the brand appears here, in the
// data files, and in the locale strings — nowhere else.
//
// ── Loading ───────────────────────────────────────────────────────
//
// `import.meta.glob` with `eager: true` inlines every pathway file at build
// time, the same way majorLoader.js and minorLoader.js load program data. The
// literal-string requirement is a Vite constraint, which is why the pattern is
// spelled out rather than composed.
//
// The dataset is small — a pathway file is a couple of kilobytes and there are
// four — so eager loading costs less than the machinery to defer it.
//
// This file therefore only runs under Vite. Tests exercise src/core/pathway/*
// directly and read the JSON with fs, matching how courseCatalog.node.js and
// programRegistry.node.js keep the Node side free of bundler features.
//
// ── This adapter holds no policy ──────────────────────────────────
//
// Eligibility and staleness are decided by src/core/pathway/select.js, and rule
// evaluation is not reachable from here at all. An adapter that could evaluate
// rules could quietly override the safety classification in ruleKinds.js, which
// is the one thing standing between a student and being told their degree plan
// is broken because of a GPA we do not hold.
// ═══════════════════════════════════════════════════════════════════

import { selectPathways } from "../../core/pathway/select.js";

// Pathway files only. The negative pattern excludes intake artefacts — the "_"
// prefix marks `_inventory.json` (75 discovery records) and the `_cache/` of
// fetched page text, none of which belongs in the browser bundle. The `.id`
// filter below would have dropped the inventory anyway, but by luck rather than
// intent, and it would still have been bundled first.
const modules = import.meta.glob([
  "../../../data/northeastern/pathways/**/*.json",
  "!../../../data/northeastern/pathways/_*/**",
  "!../../../data/northeastern/pathways/_*",
], { eager: true });

/**
 * Every pathway, in a stable order.
 *
 * Sorted by id rather than by the glob's filesystem order, so a share link, a
 * panel and a test all see the same sequence regardless of platform.
 */
const PATHWAYS = Object.freeze(
  Object.values(modules)
    .map(m => m?.default ?? m)
    .filter(p => p && typeof p === "object" && p.id)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
);

const byId = new Map(PATHWAYS.map(p => [p.id, p]));

// ── HIDDEN pending further work ────────────────────────────────────
//
// Only 4 of ~44 real PlusOne pathways are transcribed (Khoury), and shipping
// that as if it were the whole picture risks reading as more authoritative
// or more complete than it is. Nothing below is deleted — the engine, the
// data, the tests and the UI are all intact and stay exercised by the test
// suite — this is the one switch that makes the feature invisible until a
// decision is made to ship it. Flip to `false` to bring it back exactly as
// it was; every other file is unaffected.
//
// A student who already had a pathway declared (only possible in local
// dev/testing — this never shipped) sees the existing, already-built
// StaleNotice fallback ("this pathway is no longer published"), the same
// path a pathway file being removed for real would take.
const HIDDEN = true;

export default {
  /**
   * @param {{ugProgramId?: string, ugProgramIds?: string[], studentType?: string, msConcentration?: string}} q
   * @returns {import("../../ports/IAcceleratedPathway.js").Pathway[]}
   */
  listPathways(q = {}) {
    if (HIDDEN) return [];
    return selectPathways(PATHWAYS, q);
  },

  /** @returns {import("../../ports/IAcceleratedPathway.js").Pathway|null} */
  getPathway(id) {
    if (HIDDEN) return null;
    return byId.get(id) ?? null;
  },

  /** Attribution, in the shape wire() aggregates. */
  sources: [
    {
      id: "plusone-pathways",
      label: "Northeastern PlusOne program pages",
      usedFor: "accelerated master's pathways",
      note:
        "Transcribed by hand from each college's published PlusOne pages. The " +
        "academic catalog carries no PlusOne course data, so each pathway file " +
        "names its own source URL and the date it was checked.",
    },
  ],
};

/** Unsorted access for the verifier and for tests that bypass the port. */
export { PATHWAYS };
