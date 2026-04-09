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
  return { ...genericDefaults, ...overrides };
}
