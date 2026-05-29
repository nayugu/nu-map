// ═══════════════════════════════════════════════════════════════════
// TRANSLATION WORKER
//
// Runs NLLB-200-distilled-600M via @huggingface/transformers entirely
// inside a Web Worker so the main thread is never blocked.
//
// Message protocol (main → worker):
//   { type: 'translate', id: number, texts: string[], targetLocale: string, sourceLocale: string }
//
// Message protocol (worker → main):
//   { type: 'progress',    loaded: number, total: number }
//   { type: 'model-ready' }
//   { type: 'result',      id: number, results: string[] }
//   { type: 'error',       id: number, message: string }
//
// The model (~890 MB) is downloaded once by @huggingface/transformers
// and cached in the browser's built-in model cache (Cache API / OPFS).
// Subsequent loads are instant.
// ═══════════════════════════════════════════════════════════════════

// Import ORT before transformers so we can override wasmPaths.
// @huggingface/transformers@4.2 sets wasmPaths to jsDelivr CDN (a dev-build URL
// that may not resolve).  We override it to use the locally-served WASM files
// in /public/ort/ — same-origin, no CDN availability issues.
// This override is read lazily by ORT at first InferenceSession creation, so
// setting it here (after module init but before any loadModel() call) is safe.
import * as ort from "onnxruntime-web";
import { pipeline, env } from "@huggingface/transformers";

// Force single-threaded ORT.  With numThreads > 1, ORT spawns WASM pthread
// sub-workers from inside our Web Worker; those sub-workers can't resolve the
// blob factory URL and hang indefinitely, causing the "stuck at 100%" symptom.
// numThreads = 1 runs the threaded WASM binary in single-thread mode: no
// sub-workers are created, SharedArrayBuffer is not required.
ort.env.wasm.numThreads = 1;

// Safari uses the standard threaded variant; other browsers use asyncify.
const _isSafari = /apple/i.test(navigator.vendor ?? "");
ort.env.wasm.wasmPaths = _isSafari
  ? { mjs:  `${import.meta.env.BASE_URL}ort/ort-wasm-simd-threaded.mjs`,
      wasm: `${import.meta.env.BASE_URL}ort/ort-wasm-simd-threaded.wasm` }
  : { mjs:  `${import.meta.env.BASE_URL}ort/ort-wasm-simd-threaded.asyncify.mjs`,
      wasm: `${import.meta.env.BASE_URL}ort/ort-wasm-simd-threaded.asyncify.wasm` };

env.allowLocalModels = false;

// FLORES-200 language codes required by NLLB-200.
// Extend this map if new locales are added to src/locales/.
const NLLB_LANG = {
  en: "eng_Latn",
  zh: "zho_Hans",
  ja: "jpn_Jpan",
  hi: "hin_Deva",
  ar: "ara_Arab",
  fr: "fra_Latn",
  es: "spa_Latn",
};

let translator = null;
let loadingPromise = null;

function loadModel() {
  if (translator) return Promise.resolve(translator);
  if (loadingPromise) return loadingPromise;

  // Track bytes per file so overall progress never goes backwards.
  // @huggingface/transformers fires progress_callback once per file,
  // resetting loaded/total for each — accumulating here prevents flicker.
  const fileBytes = new Map(); // filename → { loaded, total }

  loadingPromise = pipeline(
    "translation",
    "Xenova/nllb-200-distilled-600M",
    {
      progress_callback(p) {
        if (p.status === "progress" && p.file) {
          fileBytes.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
          const loaded = [...fileBytes.values()].reduce((s, f) => s + f.loaded, 0);
          const total  = [...fileBytes.values()].reduce((s, f) => s + f.total,  0);
          self.postMessage({ type: "progress", loaded, total });
        }
      },
    }
  ).then(pipe => {
    translator = pipe;
    loadingPromise = null;
    // Send model-ready here — pipeline is fully initialised and translate()
    // calls will succeed immediately.  The callback's status==="ready" fires
    // before the promise resolves, so sending it there was premature.
    self.postMessage({ type: "model-ready" });
    return translator;
  }).catch(err => {
    // Reset so a retry attempt can start a fresh load instead of re-throwing
    // the same cached rejected promise forever.
    loadingPromise = null;
    throw err;
  });

  return loadingPromise;
}

self.addEventListener("message", async ({ data }) => {
  if (data.type !== "translate") return;
  const { id, texts, targetLocale, sourceLocale = "en" } = data;

  try {
    const pipe = await loadModel();
    const srcLang = NLLB_LANG[sourceLocale] ?? sourceLocale;
    const tgtLang = NLLB_LANG[targetLocale] ?? targetLocale;

    const results = [];
    for (const text of texts) {
      if (!text) { results.push(""); continue; }
      const out = await pipe(text, {
        src_lang: srcLang,
        tgt_lang: tgtLang,
        max_new_tokens: 256,
      });
      results.push(out[0]?.translation_text ?? text);
    }

    self.postMessage({ type: "result", id, results });
  } catch (err) {
    self.postMessage({ type: "error", id, message: err.message ?? String(err) });
  }
});
