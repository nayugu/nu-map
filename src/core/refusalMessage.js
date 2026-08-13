// ═══════════════════════════════════════════════════════════════════
// REFUSAL MESSAGES — turning an engine verdict into the student's language
//
// A refusal is an ANSWER, and the app shows it as prose. But the prose was written in
// the engine:
//
//   detail: `We can only account for ${pct}% of this degree's ${total} credits; the
//            rest would be unlabelled placeholders.`
//
// …and `SamplePlanOffer` rendered `refused.detail` directly, so every refusal in this
// app was English regardless of locale — against the standing convention that every
// user-facing string exists in all 8 locales. `mostly-unlabelled` alone is 105 of 257
// refusals, so this was the single most-read untranslated sentence in the product.
//
// ── The engine is the wrong place to fix it ─────────────────────────
//
// The obvious repair is to translate those template literals. It is the wrong one: the
// engine is pure, has no locale, and is shared by the Node MCP server and the
// Cloudflare worker, neither of which has a UI language. Handing it a `t` would put a
// presentation concern inside the solver and give three callers a fourth thing to wire.
//
// So the engine keeps emitting a `reason` (a closed vocabulary) and `data` (numbers),
// which it ALREADY does — every refusal below was already carrying its own figures —
// and the rendering happens here, where the locale lives. `detail` stays as the
// developer-facing string and as the fallback.
//
// ── Partial on purpose, and safe where it is ────────────────────────
//
// Not every reason has a translated string yet. A missing key falls back to the
// engine's English `detail`, which is what shipped before, so covering them is
// strictly additive and can be done a reason at a time. What must NOT happen is a
// fallback to the raw key — `t()` returns the key when it is missing, so the check
// below is explicit rather than trusting the lookup.
// ═══════════════════════════════════════════════════════════════════

/**
 * Display parameters for the reasons whose message carries numbers.
 *
 * Kept beside the strings rather than in the engine: `share` is the quantity the
 * solver reasons about, and "the percentage we CAN account for" is the quantity a
 * student can read. Converting between them is a presentation decision.
 */
const PARAMS = {
  "mostly-unlabelled": (d) => ({
    pct: Math.round((1 - (d?.share ?? 0)) * 100),
    total: d?.total ?? 0,
  }),
  "does-not-fit": (d) => ({
    need: d?.need ?? 0, room: d?.room ?? 0, terms: d?.terms ?? 0,
  }),
  // The requirement's own TITLE, not the count. It comes from the catalog so it is not
  // translatable either way, and it is the part a student can act on — "3 requirements
  // do not fit" says less than naming the one that does not.
  "cell-has-no-legal-term": (d) => ({
    title: d?.cells?.[0]?.title ?? "", count: d?.count ?? 0,
  }),
};

/**
 * The sentence to show for a refusal, in the active locale.
 *
 * @param {{reason?: string, detail?: string, data?: object}|null|undefined} refused
 * @param {(key: string, vars?: object) => string} t
 * @returns {string}
 */
export function refusalMessage(refused, t) {
  const reason = refused?.reason;
  if (reason) {
    const key = `chart.refused.${reason}`;
    const vars = PARAMS[reason]?.(refused.data) ?? refused.data ?? {};
    const s = t(key, vars);
    // `t` echoes the key when there is no string for it — that is the signal to fall
    // back, not a message to show anyone.
    if (s !== key) return s;
  }
  return refused?.detail || t("chart.refused");
}
