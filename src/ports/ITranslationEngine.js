// ═══════════════════════════════════════════════════════════════════
// PORT: ITranslationEngine
//
// Translates arrays of strings from a source locale to a target locale.
// Three adapters exist, selected at runtime in priority order:
//
//   1. ChromeAIEngine   — Chrome 138+ built-in Translator API.
//                         Zero download, hardware-accelerated, instant.
//   2. TransformersJsEngine — NLLB-200-distilled-600M via @huggingface/
//                         transformers in a Web Worker.  ~890 MB one-time
//                         download, cached in browser IndexedDB forever.
//                         Covers all supported locales offline.
//
// TranslationContext (src/context/TranslationContext.jsx) owns engine
// selection, the in-memory translation cache, and progress state.
// Nothing institution-specific lives here — any deployment gets the
// same translation infrastructure for free.
// ═══════════════════════════════════════════════════════════════════

/**
 * @typedef {'native' | 'wasm'} EngineTier
 *   'native' = browser-managed API, no download required
 *   'wasm'   = WebAssembly model, one-time download then fully offline
 */

/**
 * @typedef {Object} TranslationProgress
 * @property {number} loaded - Bytes loaded so far
 * @property {number} total  - Total bytes (0 if unknown)
 */

/**
 * @typedef {Object} ITranslationEngine
 *
 * @property {EngineTier} tier
 *
 * @property {(targetLocale: string, sourceLocale: string) => Promise<boolean>} isAvailable
 *   Returns true if this engine can translate from sourceLocale to targetLocale.
 *   May be async (e.g. Chrome AI checks model availability over IPC).
 *
 * @property {(
 *     texts: string[],
 *     targetLocale: string,
 *     sourceLocale: string,
 *     onProgress?: (p: TranslationProgress) => void
 *   ) => Promise<string[]>} translate
 *   Translate an array of strings from sourceLocale to targetLocale.
 *   Returns a parallel array of translated strings.
 *   onProgress fires during model loading only (not per-string).
 *   Empty strings pass through as-is.
 */
