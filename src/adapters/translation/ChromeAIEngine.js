// ═══════════════════════════════════════════════════════════════════
// ADAPTER: ChromeAIEngine
//
// Wraps Chrome 138+ window.Translator (built-in AI).
// Zero download, hardware-accelerated.  Falls back gracefully when
// the API is absent or the language pair is unavailable.
// ═══════════════════════════════════════════════════════════════════

function getAPI() {
  return window.Translator ?? window.ai?.translator ?? null;
}

export class ChromeAIEngine {
  tier = "native";

  /** @type {((loaded: number, total: number) => void) | null} */
  onProgress = null;

  /** @type {(() => void) | null} */
  onReady = null;

  // Reuse translator instances per locale to avoid repeated API creation.
  #instances = new Map(); // targetLocale → Translator instance

  async isAvailable(targetLocale) {
    const api = getAPI();
    if (!api) return false;
    try {
      const status = await api.availability({
        sourceLanguage: "en",
        targetLanguage: targetLocale,
      });
      return status !== "no";
    } catch {
      return false;
    }
  }

  async translate(texts, targetLocale) {
    const api = getAPI();

    if (!this.#instances.has(targetLocale)) {
      const self = this;
      const t = await api.create({
        sourceLanguage: "en",
        targetLanguage: targetLocale,
        monitor(m) {
          m.addEventListener("downloadprogress", e => {
            self.onProgress?.(e.loaded ?? 0, e.total ?? 0);
          });
        },
      });
      this.#instances.set(targetLocale, t);
      this.onReady?.();
    }

    const t = this.#instances.get(targetLocale);
    return Promise.all(
      texts.map(text => (text ? t.translate(text) : Promise.resolve("")))
    );
  }

  destroy() {
    for (const t of this.#instances.values()) t.destroy?.();
    this.#instances.clear();
  }
}
