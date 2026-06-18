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
// A module-level concurrency limiter caps simultaneous in-flight
// requests so opening a page with many translatable elements (course
// bank, grad requirement tree) doesn't burst dozens of requests at
// Google and trip per-IP throttling.
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

// Shared across all engine instances so a re-mount doesn't reset the cap.
const MAX_CONCURRENT = 6;
const FETCH_TIMEOUT_MS = 5_000;
let inFlight = 0;
const queue = [];

function drain() {
  while (inFlight < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift();
    inFlight++;
    job().finally(() => { inFlight--; drain(); });
  }
}

function schedule(taskFactory) {
  return new Promise((resolve, reject) => {
    queue.push(() => taskFactory().then(resolve, reject));
    drain();
  });
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

  #fetch(text, sl, tl) {
    const ac = new AbortController();
    this.#aborts.push(ac);

    const base = import.meta.env.VITE_TRANSLATE_PROXY ?? "https://translate.googleapis.com";
    const url =
      `${base}/translate_a/single` +
      `?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}` +
      `&dt=t&q=${encodeURIComponent(text)}`;

    return schedule(async () => {
      // Start the timeout once the job is actually running (not while queued).
      const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
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
        clearTimeout(timer);
        this.#aborts = this.#aborts.filter(a => a !== ac);
      }
    });
  }

  destroy() {
    this.#aborts.forEach(a => a.abort());
    this.#aborts = [];
  }
}
