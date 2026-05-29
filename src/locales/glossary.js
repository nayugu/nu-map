// ═══════════════════════════════════════════════════════════════════
// TRANSLATION GLOSSARY
//
// Google Translate is general-purpose and frequently misrenders
// academic-domain terms — e.g. "Incoming Credit" → "传入信用" (banking
// "letter of credit") instead of the educational sense.
//
// This file is a curated override consulted before the engine.  When
// a source string + target locale has an entry here, that translation
// is used directly (no API call, no cache fetch).  Add entries when
// you notice a bad auto-translation.
//
// Shape: source English string  →  { locale: translation, ... }
//
// Sourcing notes (where the rendered text comes from in code):
//   - Calendar adapter:   semType.label / semType.sub  (Fall, Spring, Sep – Dec, …)
//   - semGrid.js:         "Incoming Credit", "Transfer / AP / IB / Waiver"
//   - SemRow / SummerRow: "Session A", "Session B", "Continues", "general SH"
//   - Special terms adapter: term type labels
// ═══════════════════════════════════════════════════════════════════

export const GLOSSARY = {
  "Incoming Credit": {
    zh: "入学学分",
    ja: "持込単位",
    es: "Créditos transferidos",
    fr: "Crédits d'admission",
    hi: "स्थानांतरण क्रेडिट",
    ar: "الاعتمادات المنقولة",
  },
  "general SH": {
    zh: "通用学分",
    ja: "一般単位",
    es: "Créditos generales",
    fr: "Crédits généraux",
    hi: "सामान्य क्रेडिट",
    ar: "ساعات معتمدة عامة",
  },
};

/**
 * Look up a curated translation, if one exists.
 *
 * @param {string} text          source-locale (catalog) text
 * @param {string} targetLocale  BCP-47 code
 * @returns {string | undefined}
 */
export function glossaryLookup(text, targetLocale) {
  return GLOSSARY[text]?.[targetLocale];
}
