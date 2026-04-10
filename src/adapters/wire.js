// ═══════════════════════════════════════════════════════════════════
// ADAPTER FACTORY  —  wire()
// ═══════════════════════════════════════════════════════════════════
//
// wire() composes a complete institution adapter by merging your
// overrides on top of the generic defaults.  Any port you don't
// list keeps its generic implementation automatically.
//
// HOW TO USE:
//
//   import { wire } from "../wire.js";
//   import myCalendar from "./calendar.js";
//
//   export default wire({
//     calendar: myCalendar,   // overrides the generic default
//     // everything else uses the generic adapter automatically
//   });
//
// AVAILABLE PORT KEYS (camelCase strings):
//
//   institution       — name, short name, portal name, storage prefix
//   calendar          — semester types, weights, start year
//   creditSystem      — unit name ("SH"), credit thresholds
//   attributeSystem   — gen-ed / NUPath grid, labels, coverage logic
//   specialTerms      — co-op, internship, and other non-course blocks
//   majorRequirements — path-parsing helpers for major/minor data
//   courseCatalog     — local JSON path and optional live API URL
//   localization      — disclaimer text and other institution copy
//
// WHAT ARE "PORTS"?
//
//   A port is a named contract between the app core and an external
//   data source or institution-specific rule.  Each port has a
//   generic default implementation in src/adapters/generic/.
//   Your adapter only needs to override the ports that differ.
//
// ═══════════════════════════════════════════════════════════════════

import genericDefaults from "./generic/index.js";

/** Known port keys — used to catch typos in dev mode. */
const KNOWN_PORTS = new Set([
  "institution",
  "calendar",
  "creditSystem",
  "attributeSystem",
  "specialTerms",
  "majorRequirements",
  "courseCatalog",
  "localization",
]);

/**
 * Compose an institution adapter from a set of port overrides.
 * Ports not listed fall back to the generic defaults automatically.
 *
 * @param {Object} overrides  - Plain object mapping port keys to implementations.
 *                              Keys must match the camelCase port names listed above.
 * @returns {Object}            Fully-wired adapter bundle ready for InstitutionProvider.
 */
export function wire(overrides = {}) {
  if (import.meta.env.DEV) {
    for (const key of Object.keys(overrides)) {
      if (!KNOWN_PORTS.has(key)) {
        console.warn(
          `[wire] Unknown port key: "${key}". ` +
          `Valid keys: ${[...KNOWN_PORTS].join(", ")}.`
        );
      }
    }
  }
  const merged = { ...genericDefaults, ...overrides };

  /**
   * Aggregate attribution across all wired ports.
   * Deduplicates by SourceInfo.id; merges usedFor into an array
   * so a source that feeds multiple ports appears only once.
   *
   * @returns {{ id: string, label: string, url: string, author?: string, usedFor: string[] }[]}
   */
  merged.getAllSources = () => {
    const map = new Map();
    Object.values(merged)
      .filter(p => p !== null && typeof p === "object" && typeof p.getSources === "function")
      .flatMap(p => p.getSources())
      .forEach(s => {
        if (map.has(s.id)) {
          const existing = map.get(s.id);
          const next = [existing.usedFor, s.usedFor].flat().filter(Boolean);
          map.set(s.id, { ...existing, usedFor: next });
        } else {
          map.set(s.id, { ...s, usedFor: [s.usedFor].filter(Boolean) });
        }
      });
    return [...map.values()];
  };

  return merged;
}
