// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/institution  (implements IInstitution)
// ═══════════════════════════════════════════════════════════════════

/** @type {import('../../ports/IInstitution.js').IInstitution} */
export default {
  id:               "northeastern",
  name:             "Northeastern University",
  shortName:        "NU",
  url:              "https://www.northeastern.edu",
  appName:          "NU Map",
  defaultLocale:    "en",
  portalName:       "MyNEU",
  degreeAuditName:  "DegreeWorks",
  storagePrefix:    "ncp",
  getSources()      { return []; },
};
