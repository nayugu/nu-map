// ═══════════════════════════════════════════════════════════════════
// ADAPTER: TransformersJsEngine
//
// Drives NLLB-200-distilled-600M in a Web Worker.  The model (~890 MB)
// downloads once and is cached by @huggingface/transformers in the
// browser.  All supported locales use the same model.
//
// Progress is reported via stable properties set by the owner
// (TranslationContext) rather than per-translate-call callbacks, so
// concurrent translation requests don't clobber each other's listener.
// ═══════════════════════════════════════════════════════════════════

export class TransformersJsEngine {
  tier = "wasm";

  /** @type {((loaded: number, total: number) => void) | null} */
  onProgress = null;

  /** @type {(() => void) | null} */
  onReady = null;

  #worker  = null;
  #pending = new Map(); // id → { resolve, reject }
  #nextId  = 0;

  async isAvailable() { return true; }

  #ensureWorker() {
    if (this.#worker) return;
    this.#worker = new Worker(
      new URL("../../workers/translation.worker.js", import.meta.url),
      { type: "module" }
    );
    this.#worker.addEventListener("message", ({ data }) => {
      if (data.type === "result") {
        this.#pending.get(data.id)?.resolve(data.results);
        this.#pending.delete(data.id);
      } else if (data.type === "error") {
        this.#pending.get(data.id)?.reject(new Error(data.message));
        this.#pending.delete(data.id);
      } else if (data.type === "progress") {
        this.onProgress?.(data.loaded, data.total);
      } else if (data.type === "model-ready") {
        this.onReady?.();
      }
    });
  }

  async translate(texts, targetLocale) {
    this.#ensureWorker();
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({ type: "translate", id, texts, targetLocale });
    });
  }

  destroy() {
    this.#worker?.terminate();
    this.#worker = null;
    for (const { reject } of this.#pending.values()) {
      reject(new Error("TransformersJsEngine destroyed"));
    }
    this.#pending.clear();
  }
}
