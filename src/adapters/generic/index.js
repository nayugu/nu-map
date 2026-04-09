// ═══════════════════════════════════════════════════════════════════
// ADAPTER: generic  (bundle)
//
// The baseline adapter.  All institution-specific adapters spread
// this object and override only the ports that differ:
//
//   import generic from "../generic/index.js";
//   export default {
//     ...generic,
//     institution: myInstitution,   // always required
//     courseCatalog: myCourseCatalog, // always required
//     // add more overrides only for ports that actually differ
//   };
//
// Minimum viable fork: override `institution` + `courseCatalog`
// and provide a `courses.json` at your public root.  Everything
// else works out of the box.
//
// Named exports allow selective imports:
//   import { calendar, creditSystem } from "../generic/index.js";
// ═══════════════════════════════════════════════════════════════════

import institution       from "./institution.js";
import calendar          from "./calendar.js";
import creditSystem      from "./creditSystem.js";
import specialTerms      from "./specialTerms.js";
import attributeSystem   from "./attributeSystem.js";
import localization      from "./localization.js";
import majorRequirements from "./majorRequirements.js";
import courseCatalog     from "./courseCatalog.js";

// Named re-exports — import individual sub-adapters without the bundle
export { default as institution }       from "./institution.js";
export { default as calendar }          from "./calendar.js";
export { default as creditSystem }      from "./creditSystem.js";
export { default as specialTerms }      from "./specialTerms.js";
export { default as attributeSystem }   from "./attributeSystem.js";
export { default as localization }      from "./localization.js";
export { default as majorRequirements } from "./majorRequirements.js";
export { default as courseCatalog }     from "./courseCatalog.js";

export default {
  institution,
  calendar,
  creditSystem,
  specialTerms,
  attributeSystem,
  localization,
  majorRequirements,
  courseCatalog,
};
