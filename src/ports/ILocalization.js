// ═══════════════════════════════════════════════════════════════════
// PORT: ILocalization
// User-visible strings that vary by institution.
//
// Scope: text content that doesn't fit a more specific port.
// Credit unit labels belong in ICreditSystem.unitName/unitLabel.
// Institution names belong in IInstitution.name/shortName/portalName.
// Attribute labels belong in IAttributeSystem.labels.
// This port covers things like legal disclaimers, product copy, and
// any institution-specific phrasing in the UI.
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const ILocalization = "localization";

/**
 * @typedef {Object} ILocalization
 * @property {string[]} disclaimers - Ordered list of disclaimer bullet points shown in the
 *                                    About / Disclaimer modal on first load.
 *
 * Future fields (Stage 2):
 *   locale: string   — BCP 47 locale tag, e.g. "en-US".
 *                      Used for number formatting and date display.
 *   t(key: string): string
 *     — general-purpose translation lookup for copy that isn't covered
 *       by a dedicated port field.
 */
