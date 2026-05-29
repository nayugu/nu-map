// ═══════════════════════════════════════════════════════════════════
// TRANSLATION WORKER
//
// Runs NLLB-200-distilled-600M via @huggingface/transformers entirely
// inside a Web Worker so the main thread is never blocked.
//
// Message protocol (main → worker):
//   { type: 'translate', id: number, texts: string[], targetLocale: string }
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
import { pipeline, env } from "@huggingface/transformers";

env.allowLocalModels = false;

// Force single-threaded ONNX inference.  Multithreaded WASM requires
// SharedArrayBuffer, which is only available under cross-origin isolation
// (COOP + COEP headers).  Static hosts like GitHub Pages don't set those
// headers, so the threaded session would throw and the error gets silently
// swallowed.  Single-threaded is slower but works everywhere.
env.backends.onnx.wasm.numThreads = 1;

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
  const { id, texts, targetLocale } = data;

  try {
    const pipe = await loadModel();
    const tgtLang = NLLB_LANG[targetLocale] ?? targetLocale;

    const results = [];
    for (const text of texts) {
      if (!text) { results.push(""); continue; }
      const out = await pipe(text, {
        src_lang: "eng_Latn",
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
