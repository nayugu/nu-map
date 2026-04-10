// ═══════════════════════════════════════════════════════════════════
// PORT: ILocalization
// User-visible strings that vary by institution.
//
// Scope: text content that doesn't fit a more specific port.
// Credit unit labels belong in ICreditSystem.getUnitName/getUnitLabel.
// Institution names belong in IInstitution.name/shortName/portalName.
// Attribute labels belong in IAttributeSystem.getLabel.
// This port covers things like legal disclaimers, product copy, and
// any institution-specific phrasing in the UI.
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const ILocalization = "localization";

/**
 * @typedef {Object} ILocalization
 *
 * @property {() => string[]} getDisclaimers
 *   Ordered list of disclaimer bullet points shown in the About / Disclaimer modal
 *   on first load.  These are institution-specific legal statements that are not part
 *   of the general locale string system.
 *   Returns empty array if no institution-specific disclaimers are needed.
 *
 * Design note: cross-locale UI translation (the t() function, locale switching,
 * locale file discovery) lives in LanguageContext — it is cross-cutting
 * infrastructure, not institution-specific configuration.  ILocalization is
 * intentionally narrow: only content that varies by institution, not by language.
 */
