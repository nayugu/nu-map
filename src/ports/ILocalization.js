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
/**
 * One link chip rendered below an attribution block's body text.
 *
 * @typedef {Object} AttributionLink
 * @property {string}  href     - URL
 * @property {string}  label    - Display text (without the "↗" arrow — UI adds it)
 * @property {boolean} [primary] - If true, use the accent link style; otherwise use muted style.
 */

/**
 * One institution-specific attribution section in the About / Disclaimer modal.
 *
 * @typedef {Object} AttributionBlock
 * @property {string}            title  - Section header shown in ALL CAPS, e.g. "DATA SOURCE"
 * @property {string}            body   - Plain-text description paragraph
 * @property {AttributionLink[]} links  - Link chips rendered below the body text
 */

/**
 * @typedef {Object} ILocalization
 *
 * @property {() => string[]} getDisclaimers
 *   Ordered list of disclaimer bullet points shown in the About / Disclaimer modal
 *   on first load.  These are institution-specific legal statements that are not part
 *   of the general locale string system.
 *   Returns empty array if no institution-specific disclaimers are needed.
 *
 * @property {() => AttributionBlock[]} getAttributionBlocks
 *   Institution-specific data attribution sections shown in the About modal.
 *   Each block renders as a card with a title, body paragraph, and link chips.
 *   Returns empty array if no attributions are needed (e.g. generic adapter).
 *
 * Design note: cross-locale UI translation (the t() function, locale switching,
 * locale file discovery) lives in LanguageContext — it is cross-cutting
 * infrastructure, not institution-specific configuration.  ILocalization is
 * intentionally narrow: only content that varies by institution, not by language.
 */
