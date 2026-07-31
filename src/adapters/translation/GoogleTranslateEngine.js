// ═══════════════════════════════════════════════════════════════════
// ADAPTER: GoogleTranslateEngine
//
// Translates text via the unofficial Google Translate endpoint
// (translate.googleapis.com).  No API key, no setup, CORS-enabled
// (Access-Control-Allow-Origin: *).  Works for most regions.
//
// Used as the primary engine by CascadeEngine.  When Google is
// unreachable (e.g. mainland China), CascadeEngine falls back to
// MyMemoryEngine automatically.
//
// A module-level concurrency limiter caps simultaneous in-flight
// requests so opening a page with many translatable elements doesn't
// burst dozens of requests at Google and trip per-IP throttling.
//
// Implements the ITranslationEngine port.
// ═══════════════════════════════════════════════════════════════════

const GOOGLE_LOCALE = {
  zh: "zh-CN",
};

function googleLocale(bcp47) {
  return GOOGLE_LOCALE[bcp47] ?? bcp47;
}

const MAX_CONCURRENT  = 6;
const FETCH_TIMEOUT_MS = 5_000;
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

export class GoogleTranslateEngine {
  tier = "api";
  name = "google";

  /** @type {((loaded: number, total: number) => void) | null} */
  onProgress = null;

  /** @type {(() => void) | null} */
  onReady = null;

  #aborts = [];

  async isAvailable() { return true; }

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

    const url =
      `https://translate.googleapis.com/translate_a/single` +
      `?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}` +
      `&dt=t&q=${encodeURIComponent(text)}`;

    return schedule(async () => {
      // Abort with a TimeoutError (not the default AbortError) so
      // CascadeEngine can tell a slow request apart from a caller
      // cancel — timeouts fall through to the next engine, cancels don't.
      const timer = setTimeout(
        () => ac.abort(new DOMException("Google Translate timeout", "TimeoutError")),
        FETCH_TIMEOUT_MS,
      );
      try {
        const response = await fetch(url, { signal: ac.signal });
        if (!response.ok) throw new Error(`Google Translate ${response.status}`);
        // If Google serves a CAPTCHA page, response.json() throws — caller catches it.
        const data = await response.json();
        const translated = (data[0] ?? []).map(seg => seg[0] ?? "").join("").trim();
        // An empty result for non-empty input is a failed translation
        // (unexpected JSON shape, interstitial, …) — throw so the
        // cascade can retry elsewhere instead of blanking the text.
        if (!translated && text.trim()) throw new Error("Google Translate returned empty result");
        return translated;
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
