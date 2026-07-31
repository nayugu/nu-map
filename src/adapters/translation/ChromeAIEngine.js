// ═══════════════════════════════════════════════════════════════════
// ADAPTER: ChromeAIEngine
//
// Wraps Chrome 138+ window.Translator (built-in AI).
// Zero download, hardware-accelerated.  Falls back gracefully when
// the API is absent or the language pair is unavailable.
//
// Only *instantly usable* language pairs are reported available:
// "downloadable"/"downloading" would make create() kick off a large
// model download (possibly requiring a user gesture) with no progress
// UI wired up — the API cascade covers those locales instead.
// ═══════════════════════════════════════════════════════════════════

function getAPI() {
  return window.Translator ?? window.ai?.translator ?? null;
}

export class ChromeAIEngine {
  tier = "native";
  name = "chrome-ai";

  /** @type {((loaded: number, total: number) => void) | null} */
  onProgress = null;

  /** @type {(() => void) | null} */
  onReady = null;

  // Reuse translator instances per language pair to avoid repeated API
  // creation.  Holds *promises*, stored synchronously before the await,
  // so concurrent translate() calls share one create() instead of
  // racing to overwrite each other's instance (the loser would leak).
  #instances = new Map(); // "srcLocale→tgtLocale" → Promise<Translator>

  async isAvailable(targetLocale, sourceLocale = "en") {
    const api = getAPI();
    if (!api) return false;
    try {
      const status = await api.availability({
        sourceLanguage: sourceLocale,
        targetLanguage: targetLocale,
      });
      // "available" (current API) / "readily" (legacy) = pack installed,
      // instant.  Anything else — including "unavailable", "no", and the
      // download states — is treated as unavailable.
      return status === "available" || status === "readily";
    } catch {
      return false;
    }
  }

  async translate(texts, targetLocale, sourceLocale = "en") {
    const key = `${sourceLocale}→${targetLocale}`;
    if (!this.#instances.has(key)) {
      const api = getAPI();
      if (!api) throw new Error("Chrome Translator API unavailable");
      const self = this;
      const promise = api.create({
        sourceLanguage: sourceLocale,
        targetLanguage: targetLocale,
        monitor(m) {
          m.addEventListener("downloadprogress", e => {
            self.onProgress?.(e.loaded ?? 0, e.total ?? 0);
          });
        },
      }).then(t => { self.onReady?.(); return t; });
      // On failure, evict so a later call can retry instead of awaiting
      // the same rejected promise forever.
      promise.catch(() => {
        if (this.#instances.get(key) === promise) this.#instances.delete(key);
      });
      this.#instances.set(key, promise);
    }

    const t = await this.#instances.get(key);
    return Promise.all(
      texts.map(text => (text ? t.translate(text) : Promise.resolve("")))
    );
  }

  destroy() {
    for (const p of this.#instances.values()) {
      Promise.resolve(p).then(t => t.destroy?.()).catch(() => {});
    }
    this.#instances.clear();
  }
}
