// ═══════════════════════════════════════════════════════════════════
// PORT: IInstitution
// Top-level identity metadata for an institution.
//
// Kept intentionally minimal.  Fields are added only when UI or logic
// actually consumes them — this is identity data, not requirement policy
// (which belongs in the requirement tree) or display config (which
// belongs in themes/localization).
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const IInstitution = "institution";

/**
 * @typedef {Object} IInstitution
 * @property {string}  id               - Machine-readable identifier, e.g. "northeastern"
 * @property {string}  name             - Full institution name, e.g. "Northeastern University"
 * @property {string}  shortName        - Abbreviation shown in tight UI spaces, e.g. "NU"
 * @property {string}  portalName       - Name of the student self-service portal, e.g. "MyNEU"
 * @property {string}  degreeAuditName  - Name of the official degree audit tool, e.g. "DegreeWorks"
 * @property {string}  storagePrefix    - localStorage key namespace, e.g. "ncp".
 *                                        Must be unique across institutions to avoid key collisions
 *                                        if a deployment supports multiple adapters.
 * @property {string}  [logoUrl]        - Optional URL to the institution wordmark/logo.
 *                                        Relative paths resolved from BASE_URL.
 */
