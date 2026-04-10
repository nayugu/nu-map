// ═══════════════════════════════════════════════════════════════════
// ADAPTER: generic/institution  (implements IInstitution)
//
// Placeholder — every real deployment MUST override this.
// The values here let the app boot for development/preview
// without crashing on missing institution data.
// ═══════════════════════════════════════════════════════════════════

/** @type {import('../../ports/IInstitution.js').IInstitution} */
export default {
  id:              "map",
  name:            "My University",
  shortName:       "Map",
  url:             null,
  appName:         "Map",
  defaultLocale:   "en",
  portalName:      "Student Portal",
  degreeAuditName: "Degree Audit",
  storagePrefix:   "map",
};
