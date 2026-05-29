// ═══════════════════════════════════════════════════════════════════
// ADAPTER: HFInferenceEngine
//
// Translates text via the HuggingFace Serverless Inference API using
// Qwen2.5-1.5B-Instruct.  No API key required (free tier, rate-limited
// per IP).  Supports token streaming via onToken callback.  Results are
// cached by TranslationContext in both memory and localStorage so each
// text is only ever fetched once.
//
// Implements the ITranslationEngine port.
// ═══════════════════════════════════════════════════════════════════

const MODEL = "Qwen/Qwen2.5-1.5B-Instruct";
const API   = `https://router.huggingface.co/hf-inference/models/${MODEL}/v1/chat/completions`;

const LANG_NAME = {
  en: "English",
  zh: "Simplified Chinese",
  ja: "Japanese",
  hi: "Hindi",
  ar: "Arabic",
  fr: "French",
  es: "Spanish",
};

function sysPrompt(src, tgt) {
  return (
    `Translate academic course content from ${src} to ${tgt}. ` +
    `Output ONLY the translation. ` +
    `Preserve course codes (e.g. CS 3500), proper nouns, and technical terms exactly.`
  );
}

export class HFInferenceEngine {
  tier = "api";

  /** @type {((loaded: number, total: number) => void) | null} */
  onProgress = null;

  /** @type {(() => void) | null} */
  onReady = null;

  #abort = null;

  async isAvailable() { return true; }

  /**
   * Translate an array of strings.  Calls onToken(partialResults) after
   * each decoded token so the UI can update incrementally.
   *
   * @param {string[]} texts
   * @param {string} targetLocale   BCP-47 code
   * @param {string} [sourceLocale="en"]
   * @param {((partials: (string|undefined)[]) => void) | null} [onToken]
   * @returns {Promise<string[]>}
   */
  async translate(texts, targetLocale, sourceLocale = "en", onToken = null) {
    const src = LANG_NAME[sourceLocale] ?? sourceLocale;
    const tgt = LANG_NAME[targetLocale] ?? targetLocale;
    const sys = sysPrompt(src, tgt);

    const completed = [];

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      if (!text) { completed.push(""); continue; }

      const result = await this.#stream(text, sys, onToken
        ? (partial) => {
            const snapshot = [
              ...completed,
              partial,
              ...new Array(texts.length - i - 1).fill(undefined),
            ];
            onToken(snapshot);
          }
        : null,
      );

      completed.push(result);
    }

    return completed;
  }

  async #stream(text, systemMsg, onToken) {
    this.#abort = new AbortController();

    const response = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: this.#abort.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemMsg },
          { role: "user",   content: text },
        ],
        stream:     true,
        max_tokens: 300,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // 503 = model warming up, surface as retriable error
      throw new Error(`HF API ${response.status}${body ? ": " + body.slice(0, 120) : ""}`);
    }

    let result  = "";
    let buffer  = "";
    const reader  = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const token = JSON.parse(payload).choices?.[0]?.delta?.content;
            if (token) {
              result += token;
              onToken?.(result);
            }
          } catch { /* ignore malformed SSE chunk */ }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return result.trim();
  }

  destroy() {
    this.#abort?.abort();
    this.#abort = null;
  }
}
