// ═══════════════════════════════════════════════════════════════════
// SAMPLE PLAN LOADER  (data adapter)
//
// The department's published Sample Plan of Study for a program, kept in a
// `plan.json` beside that program's `requirements.json` and reached through
// its own import.meta.glob.
//
// ── Why it is a separate file and a separate glob ──────────────────
//
// The plan is 3-18 KB against a ~14 KB program, so folding it into the program
// file would roughly double what every student downloads when they pick a
// major — to carry something only the ones who ask for a sample plan will ever
// open. A second glob keeps it lazy: the module registry knows the path, and
// nothing is fetched until someone asks.
//
// Only 385 of ~1,017 programs publish one, so `null` is the ordinary answer
// and callers must treat it as "this program has no plan", never as an error.
//
// ── Why this is worth shipping now ─────────────────────────────────
//
// Northeastern is reworking sample plans so each DEPARTMENT hosts its own,
// which means this data will stop being available in one machine-readable
// place. Whatever is not read before then is not read at all.
// ═══════════════════════════════════════════════════════════════════

import { parseMajorPathParts, resolveInMap } from "./programPaths.js";

const _planMap = import.meta.glob("../../data/northeastern/programs/undergraduate/**/plan.json",      { eager: false });
const _gradMap = import.meta.glob("../../data/northeastern/programs/graduate/**/plan.json", { eager: false });

/**
 * A program path points at `requirements.json`; its plan is the sibling.
 * Derived rather than stored so the two can never drift apart.
 */
const toPlanPath = (programPath) =>
  String(programPath ?? "").replace(/requirements\.json$/, "plan.json");

/**
 * Load the sample plans for a program path, or null when it publishes none.
 *
 * `path` is the same string `loadMajor`/`loadGradMajor` take, so callers never
 * hold a second identifier for the same program.
 *
 * @param {string} path      e.g. ".../programs/undergraduate/2026/science/biology_bs_(boston)/requirements.json"
 * @param {boolean} isGrad
 * @returns {Promise<{plans: Array}|null>}
 */
export async function loadSamplePlans(path, isGrad = false) {
  const map = isGrad ? _gradMap : _planMap;
  const wanted = toPlanPath(path);
  // Saved plans can hold a path from an older edition or a renamed folder, so
  // the same migration the program loader uses applies here too — otherwise a
  // program that still resolves would silently lose its sample plan.
  const key = map[wanted] ? wanted : resolveInMap(map, wanted, parseMajorPathParts);
  if (!key || !map[key]) return null;
  const mod = await map[key]();
  const grid = mod.default ?? mod;
  return grid?.plans?.length ? grid : null;
}

/**
 * Whether a program publishes a plan — answerable without fetching anything,
 * because the glob registers every path eagerly and only the contents lazily.
 * Lets the UI decide whether to offer the option at all instead of offering it
 * and then discovering there is nothing behind it.
 */
export function hasSamplePlan(path, isGrad = false) {
  const map = isGrad ? _gradMap : _planMap;
  const wanted = toPlanPath(path);
  return Boolean(map[wanted] || resolveInMap(map, wanted, parseMajorPathParts));
}
