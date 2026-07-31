// ═══════════════════════════════════════════════════════════════════
// ADAPTER: CascadeEngine
//
// Chains translation engines in priority order.  Each STRING runs
// through the chain independently: on failure it falls through to the
// next engine (e.g. mainland China where translate.googleapis.com is
// blocked), and a string that fails every engine resolves as "" —
// which TranslationContext treats as a failed translation (source
// text shown, nothing cached, retried next call).  Per-item fallback
// matters because items differ wildly in difficulty: a 2000-char
// course description must not sink the title it was batched with.
//
// AbortError is re-thrown immediately instead of falling through: an
// abort means the caller cancelled (locale switched back, component
// unmounted), so retrying elsewhere would translate text nobody is
// waiting for — and a destroy()-triggered abort must never count as
// an engine failure.
//
// Failure tracking is module-level so it survives engine re-creation
// (TranslationContext rebuilds the cascade on every locale change).
// An engine is only skipped for the rest of the page load after
// several consecutive batch failures — a single transient timeout no
// longer downgrades the whole session, and any success resets the
// counter.
//
// Implements the ITranslationEngine port.
// ═══════════════════════════════════════════════════════════════════
import { GoogleTranslateEngine } from "./GoogleTranslateEngine.js";
import { MyMemoryEngine }        from "./MyMemoryEngine.js";

// engine.name → consecutive batch failures (page-load lifetime).
const failCounts = new Map();

// Consecutive failures tolerated before an engine is skipped for the
// session.  Engines without an entry (MyMemory — the last resort) are
// always retried.
const SKIP_AFTER = {
  "chrome-ai": 2,
  "google":    3,
};

export class CascadeEngine {
  name = "cascade";

  onProgress = null;
  onReady    = null;

  #engines;

  /** @param {import("../../ports/ITranslationEngine.js").ITranslationEngine[]} [engines] */
  constructor(engines = [new GoogleTranslateEngine(), new MyMemoryEngine()]) {
    this.#engines = engines;
    this.tier = engines[0]?.tier ?? "api";
  }

  async isAvailable() { return true; }

  #isSkipped(engine) {
    const limit = SKIP_AFTER[engine.name];
    return limit != null && (failCounts.get(engine.name) ?? 0) >= limit;
  }

  async translate(texts, targetLocale, sourceLocale = "en", onToken = null) {
    const results  = new Array(texts.length);
    // Streaming snapshot: only successes appear (undefined = pending or
    // failed) so callers never render a failure placeholder mid-stream.
    const partials = new Array(texts.length);

    await Promise.all(texts.map(async (text, i) => {
      if (!text) { results[i] = ""; return; }
      try {
        results[i]  = await this.#translateOne(text, targetLocale, sourceLocale);
        partials[i] = results[i];
        onToken?.([...partials]);
      } catch (err) {
        if (err?.name === "AbortError") throw err;
        // Failed on every engine: resolve as "" instead of rejecting the
        // batch — the other items' translations still count.
        results[i] = "";
      }
    }));

    return results;
  }

  async #translateOne(text, targetLocale, sourceLocale) {
    let lastErr = null;
    for (const engine of this.#engines) {
      if (this.#isSkipped(engine)) continue;
      try {
        const [out] = await engine.translate([text], targetLocale, sourceLocale, null);
        // Empty output for non-empty input = failure regardless of engine
        // (ChromeAI resolves instead of throwing) — try the next one.
        if (out == null || out.trim() === "") throw new Error(`${engine.name} returned empty result`);
        failCounts.set(engine.name, 0);
        return out;
      } catch (err) {
        if (err?.name === "AbortError") throw err;
        failCounts.set(engine.name, (failCounts.get(engine.name) ?? 0) + 1);
        lastErr = err;
      }
    }
    throw lastErr ?? new Error("CascadeEngine: no translation engine available");
  }

  destroy() {
    for (const engine of this.#engines) engine.destroy?.();
  }
}
