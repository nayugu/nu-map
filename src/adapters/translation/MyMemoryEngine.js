// ═══════════════════════════════════════════════════════════════════
// ADAPTER: MyMemoryEngine
//
// Translates text via the MyMemory public API (mymemory.translated.net).
// No API key required.  CORS-enabled (Access-Control-Allow-Origin: *).
// Works from both browsers and Cloudflare Workers, and is accessible
// from mainland China (not a Google/US-owned service).
//
// Rate limit: ~5000 chars/day per IP for anonymous use.  In practice
// this is never hit because all translations are cached in-memory and
// in localStorage (TranslationContext handles caching).
//
// A module-level concurrency limiter caps simultaneous in-flight
// requests so a page with many translatable elements doesn't burst
// requests and trip per-IP throttling.
//
// Implements the ITranslationEngine port.
// ═══════════════════════════════════════════════════════════════════

// MyMemory accepts BCP-47 codes but expects the full regional variant
// for some languages (e.g. "zh-CN" not just "zh").
const LOCALE_MAP = {
  zh: "zh-CN",
  he: "iw",       // Hebrew
};

function mmLocale(bcp47) {
  return LOCALE_MAP[bcp47] ?? bcp47;
}

// Shared across all engine instances so a re-mount doesn't reset the cap.
const MAX_CONCURRENT  = 4;
const FETCH_TIMEOUT_MS = 8_000;
let inFlight = 0;
const queue  = [];

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

export class MyMemoryEngine {
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
    const sl = mmLocale(sourceLocale);
    const tl = mmLocale(targetLocale);

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

    const base = import.meta.env.VITE_TRANSLATE_PROXY ?? "https://api.mymemory.translated.net";
    const url =
      `${base}/get` +
      `?q=${encodeURIComponent(text)}` +
      `&langpair=${encodeURIComponent(sl)}|${encodeURIComponent(tl)}`;

    return schedule(async () => {
      const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(url, { signal: ac.signal });
        if (!response.ok) throw new Error(`MyMemory ${response.status}`);
        const data = await response.json();
        if (data.quotaFinished) throw new Error("MyMemory daily quota exceeded");
        if (data.responseStatus !== 200) throw new Error(`MyMemory status ${data.responseStatus}`);
        return (data.responseData?.translatedText ?? text).trim();
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
