// ═══════════════════════════════════════════════════════════════════
// ADAPTER: CascadeEngine
//
// Tries GoogleTranslateEngine first (unlimited, high quality, works
// in most regions).  If Google returns a CAPTCHA or any error (e.g.
// mainland China where translate.googleapis.com is blocked), it
// silently falls back to MyMemoryEngine for the rest of the session.
//
// The fallback flag is module-level so it survives component re-mounts
// within the same page load — once Google is known to be unreachable,
// we don't waste requests trying it again.
//
// Implements the ITranslationEngine port.
// ═══════════════════════════════════════════════════════════════════
import { GoogleTranslateEngine } from "./GoogleTranslateEngine.js";
import { MyMemoryEngine }        from "./MyMemoryEngine.js";

// Module-level: persists for the lifetime of the page.
let googleFailed = false;

export class CascadeEngine {
  tier = "api";

  onProgress = null;
  onReady    = null;

  #google    = new GoogleTranslateEngine();
  #mymemory  = new MyMemoryEngine();

  async isAvailable() { return true; }

  async translate(texts, targetLocale, sourceLocale = "en", onToken = null) {
    if (googleFailed) {
      return this.#mymemory.translate(texts, targetLocale, sourceLocale, onToken);
    }
    try {
      return await this.#google.translate(texts, targetLocale, sourceLocale, onToken);
    } catch {
      googleFailed = true;
      return this.#mymemory.translate(texts, targetLocale, sourceLocale, onToken);
    }
  }

  destroy() {
    this.#google.destroy();
    this.#mymemory.destroy();
  }
}
