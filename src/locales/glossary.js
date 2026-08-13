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
    ko: "편입 학점",
    es: "Créditos transferidos",
    fr: "Crédits d'admission",
    hi: "स्थानांतरण क्रेडिट",
    ar: "الاعتمادات المنقولة",
  },
  "general SH": {
    zh: "通用学分",
    ja: "一般単位",
    ko: "일반 학점",
    es: "Créditos generales",
    fr: "Crédits généraux",
    hi: "सामान्य क्रेडिट",
    ar: "ساعات معتمدة عامة",
  },

  // ── Special-term type labels (special-terms adapter) ─────────────
  //
  // "Co-op" was the worst auto-translation in the app: zh rendered it 合作社,
  // a co-operative SHOP, so a Chinese-reading student saw six months of their
  // degree labelled "grocery co-op". The word is a Northeastern institution and
  // students say it in English whatever they otherwise speak, so most locales
  // keep it (transliterated where the script demands one) rather than reach for
  // a literal translation. Each rendering matches the one the hand-written
  // locale files use for co-op in prose, so the block on the grid and the
  // sentence describing it read as the same thing.
  "Co-op": {
    zh: "Co-op",
    ja: "コープ",
    ko: "코옵",
    es: "Co-op",
    fr: "Co-op",
    hi: "को-ऑप",
    ar: "التدريب التعاوني",
  },
  "Full-Time Internship": {
    zh: "全职实习",
    ja: "フルタイム・インターンシップ",
    ko: "풀타임 인턴십",
    es: "Prácticas a tiempo completo",
    fr: "Stage à temps plein",
    hi: "पूर्णकालिक इंटर्नशिप",
    ar: "تدريب بدوام كامل",
  },

  // ── Term month ranges (calendar adapter `semType.sub`) ───────────
  //
  // Deterministic because the engine was not: the same grid rendered "五月至六月"
  // for Summer A and "七月 – 八月" for Summer B — one range translated, the next
  // left with an English dash — which reads as a rendering fault rather than a
  // language. Five entries: the four term subs, plus the combined May – Aug the
  // summer row prints in front of its two halves.
  "Sep – Dec": {
    zh: "九月至十二月", ja: "9月～12月",  ko: "9월–12월",
    es: "sep – dic", fr: "sept – déc",
    hi: "सितंबर–दिसंबर", ar: "سبتمبر – ديسمبر",
  },
  "Jan – Apr": {
    zh: "一月至四月", ja: "1月～4月", ko: "1월–4월",
    es: "ene – abr", fr: "janv – avr",
    hi: "जनवरी–अप्रैल", ar: "يناير – أبريل",
  },
  "May – Jun": {
    zh: "五月至六月", ja: "5月～6月", ko: "5월–6월",
    es: "may – jun", fr: "mai – juin",
    hi: "मई–जून", ar: "مايو – يونيو",
  },
  "Jul – Aug": {
    zh: "七月至八月", ja: "7月～8月", ko: "7월–8월",
    es: "jul – ago", fr: "juil – août",
    hi: "जुलाई–अगस्त", ar: "يوليو – أغسطس",
  },
  "May – Aug": {
    zh: "五月至八月", ja: "5月～8月", ko: "5월–8월",
    es: "may – ago", fr: "mai – août",
    hi: "मई–अगस्त", ar: "مايو – أغسطس",
  },

  // ── Summer half-term names (calendar adapter `semType.altLabel`) ──
  //
  // The planner's summer halves render their altLabel through the engine, while
  // the preview and the popover use the written `claude.sem.sum1/2` keys. These
  // entries make the two agree; without them the same half was "夏季 A" in one
  // place and whatever the engine returned in the other.
  "Summer A": {
    zh: "夏季 A", ja: "夏 A", ko: "여름 A",
    es: "Verano A", fr: "Été A", hi: "ग्रीष्म A", ar: "الصيف A",
  },
  "Summer B": {
    zh: "夏季 B", ja: "夏 B", ko: "여름 B",
    es: "Verano B", fr: "Été B", hi: "ग्रीष्म B", ar: "الصيف B",
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
