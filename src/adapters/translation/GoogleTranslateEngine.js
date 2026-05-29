// ═══════════════════════════════════════════════════════════════════
// ADAPTER: GoogleTranslateEngine
//
// Translates text via the unofficial Google Translate endpoint
// (translate.googleapis.com).  No API key, no setup, CORS-enabled
// (Access-Control-Allow-Origin: *).  Compatible with GitHub Pages.
//
// Responses are near-instant so no streaming is needed.  onToken is
// called once with the final result to maintain interface parity.
//
// Implements the ITranslationEngine port.
// ═══════════════════════════════════════════════════════════════════

// Google uses different locale codes than BCP-47 in a few cases.
const GOOGLE_LOCALE = {
  zh: "zh-CN",
};

function googleLocale(bcp47) {
  return GOOGLE_LOCALE[bcp47] ?? bcp47;
}

export class GoogleTranslateEngine {
  tier = "api";

  /** @type {((loaded: number, total: number) => void) | null} */
  onProgress = null;

  /** @type {(() => void) | null} */
  onReady = null;

  #aborts = [];

  async isAvailable() { return true; }

  /**
   * @param {string[]} texts
   * @param {string} targetLocale   BCP-47 code
   * @param {string} [sourceLocale="en"]
   * @param {((partials: (string|undefined)[]) => void) | null} [onToken]
   * @returns {Promise<string[]>}
   */
  async translate(texts, targetLocale, sourceLocale = "en", onToken = null) {
    const sl = googleLocale(sourceLocale);
    const tl = googleLocale(targetLocale);

    const results = await Promise.all(
      texts.map((text, i) => {
        if (!text) return Promise.resolve("");
        return this.#fetch(text, sl, tl).then(translated => {
          if (onToken) {
            const snapshot = texts.map((_, j) => j === i ? translated : undefined);
            onToken(snapshot);
          }
          return translated;
        });
      }),
    );

    return results;
  }

  async #fetch(text, sl, tl) {
    const ac = new AbortController();
    this.#aborts.push(ac);

    const url =
      "https://translate.googleapis.com/translate_a/single" +
      `?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}` +
      `&dt=t&q=${encodeURIComponent(text)}`;

    try {
      const response = await fetch(url, { signal: ac.signal });
      if (!response.ok) throw new Error(`Google Translate ${response.status}`);
      const data = await response.json();
      // Response: [[[translatedSegment, original, ...], ...], ...]
      // Concatenate all translated segments.
      const translated = (data[0] ?? [])
        .map(seg => seg[0] ?? "")
        .join("");
      return translated.trim();
    } finally {
      this.#aborts = this.#aborts.filter(a => a !== ac);
    }
  }

  destroy() {
    this.#aborts.forEach(a => a.abort());
    this.#aborts = [];
  }
}
