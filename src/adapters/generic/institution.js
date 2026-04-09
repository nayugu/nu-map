// ═══════════════════════════════════════════════════════════════════
// ADAPTER: generic/institution  (implements IInstitution)
//
// Placeholder — every real deployment MUST override this.
// The values here let the app boot for development/preview
// without crashing on missing institution data.
// ═══════════════════════════════════════════════════════════════════

/** @type {import('../../ports/IInstitution.js').IInstitution} */
export default {
  id:              "generic",
  name:            "My University",
  shortName:       "MU",
  portalName:      "Student Portal",
  degreeAuditName: "Degree Audit",
  storagePrefix:   "myapp",
};
