// ═══════════════════════════════════════════════════════════════════
// PORT INDEX  —  AdapterOverrides type
//
// Defines the shape of the wiring object so your IDE can suggest
// available port names when editing an adapter's index.js.
// ═══════════════════════════════════════════════════════════════════

/**
 * The set of ports you can override in an adapter's index.js.
 * Every key is optional — omitted ports fall back to the generic default.
 *
 * @typedef {Object} AdapterOverrides
 * @property {import('./IInstitution.js').IInstitution}           [institution]
 * @property {import('./ICalendar.js').ICalendar}                 [calendar]
 * @property {import('./ICreditSystem.js').ICreditSystem}         [creditSystem]
 * @property {import('./IAttributeSystem.js').IAttributeSystem}   [attributeSystem]
 * @property {import('./ISpecialTerms.js').ISpecialTerms}         [specialTerms]
 * @property {import('./IMajorRequirements.js').IMajorRequirements} [majorRequirements]
 * @property {import('./ICourseCatalog.js').ICourseCatalog}       [courseCatalog]
 * @property {import('./ILocalization.js').ILocalization}         [localization]
 */
