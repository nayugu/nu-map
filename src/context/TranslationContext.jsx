// ═══════════════════════════════════════════════════════════════════
// TRANSLATION CONTEXT
//
// Manages engine lifecycle, model cache state, and two-mode design:
//
//   locale-only  (default) — LanguageContext switches UI strings only.
//   translate-courses      — course titles + descriptions translated
//                            on demand (opt-in via Header toggle or
//                            InfoPanel "Translate →" button).
//
// Model caching
// ─────────────
// @huggingface/transformers stores files in the Cache Storage API
// under key 'transformers-cache'.  We check for this on mount to
// know whether the ~890 MB model has already been downloaded, and
// expose clearModelCache() to delete it.
//
// Progress notes
// ──────────────
// The worker accumulates per-file bytes into running totals so
// modelProgress only ever increases.  modelProgress is cleared only
// on 'model-ready', not on per-file completion.
//
// Exposed API
// ───────────
//   translate(texts, locale)        → Promise<string[]>
//   engineTier                      'native' | 'wasm' | null
//   modelProgress                   { loaded, total } | null
//   modelCached                     boolean | null (null = unknown)
//   courseTranslationEnabled        boolean
//   setCourseTranslationEnabled     (bool) => void
//   cancelDownload()                terminates worker + clears partial cache
//   clearModelCache()               deletes 'transformers-cache' entirely
//
// Hooks
// ─────
//   useCourseTranslation(course)  → { title, desc, isTranslating }
// ═══════════════════════════════════════════════════════════════════
import {
  createContext, useContext, useState, useRef,
  useEffect, useCallback,
} from "react";
import { useLanguage }           from "./LanguageContext.jsx";
import { ChromeAIEngine }        from "../adapters/translation/ChromeAIEngine.js";
import { TransformersJsEngine }  from "../adapters/translation/TransformersJsEngine.js";

const TranslationContext = createContext(null);

const STORAGE_KEY    = "nu-map-course-translation";
const HF_CACHE_KEY   = "transformers-cache";

// ── Cache helpers ──────────────────────────────────────────────────

async function checkModelCached() {
  if (!("caches" in window)) return false;
  try {
    if (!await caches.has(HF_CACHE_KEY)) return false;
    const cache = await caches.open(HF_CACHE_KEY);
    const keys  = await cache.keys();
    return keys.some(req => req.url.includes("nllb-200"));
  } catch {
    return false;
  }
}

async function deleteModelCache() {
  if (!("caches" in window)) return;
  try { await caches.delete(HF_CACHE_KEY); } catch {}
}

// ── Provider ───────────────────────────────────────────────────────

export function TranslationProvider({ catalogLocale = "en", children }) {
  const { locale } = useLanguage();

  const engineRef = useRef(null);
  const cacheRef  = useRef(new Map()); // `${text}::${locale}` → translated string

  const [engineTier,    setEngineTier]    = useState(null);
  const [modelProgress, setModelProgress] = useState(null);
  const [modelCached,   setModelCached]   = useState(null); // null = not yet checked

  const [courseTranslationEnabled, setCourseTranslationEnabledState] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
  });

  const setCourseTranslationEnabled = useCallback((val) => {
    setCourseTranslationEnabledState(val);
    try { localStorage.setItem(STORAGE_KEY, val ? "1" : "0"); } catch {}
  }, []);

  // Check on mount whether the model is already in the browser cache.
  useEffect(() => {
    checkModelCached().then(setModelCached);
  }, []);

  // Select best available engine the first time locale differs from catalog locale.
  useEffect(() => {
    if (locale === catalogLocale) {
      engineRef.current?.destroy?.();
      engineRef.current = null;
      setEngineTier(null);
      setModelProgress(null);
      return;
    }
    if (engineRef.current) return;

    (async () => {
      let engine;
      const chrome = new ChromeAIEngine();
      if (await chrome.isAvailable(locale, catalogLocale)) {
        engine = chrome;
      } else {
        engine = new TransformersJsEngine();
      }
      engine.onProgress = (loaded, total) => setModelProgress({ loaded, total });
      engine.onReady    = () => {
        setModelProgress(null);
        setModelCached(true);
      };
      engineRef.current = engine;
      setEngineTier(engine.tier);
    })();
  }, [locale, catalogLocale]);

  // Core translate — depends on catalogLocale so engines use correct source lang.
  const translate = useCallback(async (texts, targetLocale) => {
    if (targetLocale === catalogLocale) return texts;
    const engine = engineRef.current;
    if (!engine) return texts;

    const results = new Array(texts.length);
    const uncached = [];
    texts.forEach((text, i) => {
      const key = `${text}::${catalogLocale}→${targetLocale}`;
      if (cacheRef.current.has(key)) {
        results[i] = cacheRef.current.get(key);
      } else {
        uncached.push({ i, text, key });
      }
    });

    if (uncached.length > 0) {
      const translated = await engine.translate(
        uncached.map(u => u.text),
        targetLocale,
        catalogLocale,
      );
      uncached.forEach(({ i, key }, j) => {
        const val = translated[j] ?? texts[i];
        cacheRef.current.set(key, val);
        results[i] = val;
      });
    }
    return results;
  }, [catalogLocale]);

  // Cancel an in-progress download: terminate the worker and wipe any
  // partial files so the next attempt starts clean.
  const cancelDownload = useCallback(async () => {
    engineRef.current?.destroy?.();
    engineRef.current = null;
    setEngineTier(null);
    setModelProgress(null);
    setCourseTranslationEnabled(false);
    await deleteModelCache();
    setModelCached(false);
  }, [setCourseTranslationEnabled]);

  // Delete the fully-cached model to free storage.  Resets engine so
  // the next enable triggers a fresh download.
  const clearModelCache = useCallback(async () => {
    if (engineRef.current?.tier === "wasm") {
      engineRef.current.destroy();
      engineRef.current = null;
      setEngineTier(null);
    }
    setModelProgress(null);
    setCourseTranslationEnabled(false);
    await deleteModelCache();
    setModelCached(false);
  }, [setCourseTranslationEnabled]);

  return (
    <TranslationContext.Provider value={{
      translate,
      catalogLocale,
      engineTier,
      modelProgress,
      modelCached,
      courseTranslationEnabled,
      setCourseTranslationEnabled,
      cancelDownload,
      clearModelCache,
    }}>
      {children}
    </TranslationContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(TranslationContext);
  if (!ctx) throw new Error("useTranslation() must be inside <TranslationProvider>");
  return ctx;
}

/**
 * Translates a course's title and description to the active locale,
 * only when courseTranslationEnabled is true.
 *
 * @param {import('../ports/ICourseCatalog.js').Course | null} course
 * @returns {{ title: string, desc: string, isTranslating: boolean }}
 */
export function useCourseTranslation(course) {
  const { locale } = useLanguage();
  const { translate, catalogLocale, engineTier, courseTranslationEnabled } = useTranslation();

  const [translated,    setTranslated]    = useState(null);
  const [isTranslating, setIsTranslating] = useState(false);

  useEffect(() => {
    if (!courseTranslationEnabled || locale === catalogLocale || !course) {
      setTranslated(null);
      setIsTranslating(false);
      return;
    }
    if (!engineTier) {
      setIsTranslating(true);
      return;
    }

    let cancelled = false;
    setIsTranslating(true);

    const hasDesc     = Boolean(course.desc);
    const toTranslate = [course.title, ...(hasDesc ? [course.desc] : [])];

    translate(toTranslate, locale)
      .then(results => {
        if (cancelled) return;
        setTranslated({ title: results[0], desc: hasDesc ? results[1] : course.desc });
        setIsTranslating(false);
      })
      .catch(() => {
        if (!cancelled) setIsTranslating(false);
      });

    return () => { cancelled = true; };
  }, [course?.id, locale, catalogLocale, engineTier, courseTranslationEnabled, translate]);

  const active = courseTranslationEnabled && locale !== catalogLocale;
  return {
    title:         translated?.title ?? course?.title ?? "",
    desc:          translated?.desc  ?? course?.desc  ?? "",
    isTranslating: active && isTranslating,
  };
}
