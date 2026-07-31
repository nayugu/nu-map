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

// MyMemory hard-rejects queries over 500 chars ("QUERY LENGTH LIMIT
// EXCEEDED"), so anything longer — course descriptions — is split into
// sentence-boundary chunks, translated separately, and rejoined.
export const MYMEMORY_MAX_CHARS = 500;

/**
 * Split text into chunks of at most `max` chars, preferring sentence
 * boundaries, then word boundaries, then a hard cut.  Exported for tests.
 *
 * @param {string} text
 * @param {number} [max=MYMEMORY_MAX_CHARS]
 * @returns {string[]}
 */
export function chunkForMyMemory(text, max = MYMEMORY_MAX_CHARS) {
  if (text.length <= max) return [text];
  const chunks = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    // Longest prefix ending in a sentence terminator followed by space.
    const m = window.match(/[\s\S]*[.!?;:][)"'\]]?(?=\s)/);
    let cut = m ? m[0].length : -1;
    if (cut < max * 0.5) {
      // No usable sentence break in the back half — fall back to the last
      // word boundary, then to a hard cut.
      const sp = window.lastIndexOf(" ");
      cut = sp > max * 0.5 ? sp : max;
    }
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
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
  name = "mymemory";

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
        return this.#fetchText(text, sl, tl).then(translated => {
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

  // Translate one text, chunking around MyMemory's 500-char query limit.
  // Chunks go through the same limiter as everything else; CJK targets
  // join without spaces (their sentences don't use them).
  async #fetchText(text, sl, tl) {
    const chunks = chunkForMyMemory(text);
    if (chunks.length === 1) return this.#fetch(text, sl, tl);
    const parts  = await Promise.all(chunks.map(c => this.#fetch(c, sl, tl)));
    const joiner = /^(zh|ja|ko)/.test(tl) ? "" : " ";
    return parts.join(joiner);
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
      // TimeoutError (not AbortError) so CascadeEngine can tell a slow
      // request apart from a caller cancel.
      const timer = setTimeout(
        () => ac.abort(new DOMException("MyMemory timeout", "TimeoutError")),
        FETCH_TIMEOUT_MS,
      );
      try {
        const response = await fetch(url, { signal: ac.signal });
        if (!response.ok) throw new Error(`MyMemory ${response.status}`);
        const data = await response.json();
        if (data.quotaFinished) throw new Error("MyMemory daily quota exceeded");
        // responseStatus arrives as a number on success but a string on
        // some error paths — coerce before comparing.
        if (Number(data.responseStatus) !== 200) throw new Error(`MyMemory status ${data.responseStatus}`);
        const translated = (data.responseData?.translatedText ?? "").trim();
        // Empty result for non-empty input = failed translation; throw so
        // the caller falls back instead of blanking the text.
        if (!translated && text.trim()) throw new Error("MyMemory returned empty result");
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
