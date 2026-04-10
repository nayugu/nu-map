// ═══════════════════════════════════════════════════════════════════
// PORT: IInstitution
// Identity and branding metadata for one deployment of the planner.
//
// Scope: who is this institution, what should the UI call things, and
// where should data be persisted?  Policy (requirements), scheduling
// (calendar), and credits live in their own ports.
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const IInstitution = "institution";

/**
 * @typedef {Object} IInstitution
 *
 * Identity
 * @property {string}       id               - Machine-readable identifier, e.g. "northeastern",
 *                                             "mit", "generic".  Used as a stable key for
 *                                             analytics, feature flags, and disambiguation when
 *                                             multiple adapters are loaded in the same environment.
 * @property {string}       name             - Full legal/official institution name,
 *                                             e.g. "Northeastern University".  Used in
 *                                             disclaimers, PDF exports, and page <title>.
 * @property {string}       shortName        - Abbreviation for tight UI spaces, e.g. "NU".
 *                                             May be the same as id if no short form exists.
 * @property {string|null}  url              - Institution home page URL, or null.
 *                                             Shown in the header links section.
 *
 * App deployment
 * @property {string}       appName          - Name of this planner deployment, e.g. "NU Map".
 *                                             Distinct from institution name so forks can brand
 *                                             independently ("My University Map").
 *                                             Shown in the header, loading screen, <title>.
 * @property {string}       storagePrefix    - Prefix for all localStorage keys, e.g. "ncp".
 *                                             Must be unique per institution to avoid collisions
 *                                             if the same browser hosts multiple deployments.
 *
 * Advising integrations — names of external tools referenced in disclaimers / exports
 * @property {string}       portalName       - Student self-service portal name, e.g. "MyNEU",
 *                                             "Banner", "Workday".  Empty string if none.
 * @property {string}       degreeAuditName  - Official degree audit tool name, e.g. "DegreeWorks",
 *                                             "uAchieve", "DARS".  Empty string if none.
 *
 * Localization
 * @property {string}       [defaultLocale]  - BCP-47 locale code used on first load, e.g. "en".
 *                                             Users can override at runtime via the language picker.
 *                                             Defaults to "en" if omitted.
 * @property {string}       [logoUrl]        - URL to the institution wordmark or app logo.
 *                                             Relative paths are resolved from BASE_URL.
 *                                             Falls back to the default logo if omitted.
 *
 * @property {() => import('./IAttributable.js').SourceInfo[]} getSources
 *   External data sources this adapter draws from.  See IAttributable.
 */
