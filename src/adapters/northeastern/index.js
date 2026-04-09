// ═══════════════════════════════════════════════════════════════════
// NORTHEASTERN ADAPTER  —  wiring
//
// Override generic ports with Northeastern-specific implementations.
// Omitted ports use the generic default automatically.
//
// TO ADD AN OVERRIDE: import the adapter file and add it below.
// TO REMOVE AN OVERRIDE: delete the import and the line below.
// TO FORK FOR A NEW INSTITUTION: copy this folder, edit as needed.
// ═══════════════════════════════════════════════════════════════════

import nuInstitution       from "./institution.js";
import nuCalendar          from "./calendar.js";
import nuCreditSystem      from "./creditSystem.js";
import nuAttributeSystem   from "./attributeSystem.js";
import nuSpecialTerms      from "./specialTerms.js";
import nuMajorRequirements from "./majorRequirements.js";
import nuCourseCatalog     from "./courseCatalog.js";
import nuLocalization      from "./localization.js";

/** @type {import('../../ports/index.js').AdapterOverrides} */
const overrides = {
  institution:       nuInstitution,
  calendar:          nuCalendar,
  creditSystem:      nuCreditSystem,
  attributeSystem:   nuAttributeSystem,
  specialTerms:      nuSpecialTerms,
  majorRequirements: nuMajorRequirements,
  courseCatalog:     nuCourseCatalog,
  localization:      nuLocalization,
};

export default overrides;
