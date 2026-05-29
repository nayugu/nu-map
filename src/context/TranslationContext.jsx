// ═══════════════════════════════════════════════════════════════════
// TRANSLATION CONTEXT
//
// Manages engine lifecycle and two-mode design:
//
//   locale-only  (default) — LanguageContext switches UI strings only.
//   translate-courses      — course titles + descriptions translated
//                            on demand via InfoPanel (opt-in toggle).
//
// Engine priority
// ───────────────
//   1. ChromeAIEngine      — browser-native, instant, no download
//   2. GoogleTranslateEngine — unofficial translate.googleapis.com endpoint,
//                              no API key, CORS-enabled, near-instant
//
// Caching
// ───────
// Translations are cached in two layers:
//   • in-memory Map (cacheRef) — zero-latency within a session
//   • localStorage ("nu-map-xlat:v1:…") — persists across sessions
//
// The WASM/TransformersJsEngine path is preserved but commented out
// below in case it is needed as an offline fallback in the future.
//
// Exposed API
// ───────────
//   translate(texts, locale, onToken?)  → Promise<string[]>
//   engineTier                          'native' | 'api' | null
//   modelProgress                       null (kept for API compat)
//   modelCached                         null (kept for API compat)
//   courseTranslationEnabled            boolean
//   setCourseTranslationEnabled         (bool) => void
//   cancelDownload()                    abort in-flight requests
//   clearModelCache()                   wipe localStorage translations
//   catalogLocale                       string
//
// Hooks
// ─────
//   useCourseTranslation(course)  → { title, desc, isTranslating }
// ═══════════════════════════════════════════════════════════════════
import {
  createContext, useContext, useState, useRef,
  useEffect, useCallback,
} from "react";
import { useLanguage }          from "./LanguageContext.jsx";
import { ChromeAIEngine }         from "../adapters/translation/ChromeAIEngine.js";
import { GoogleTranslateEngine }  from "../adapters/translation/GoogleTranslateEngine.js";
// import { HFInferenceEngine }    from "../adapters/translation/HFInferenceEngine.js";
// import { TransformersJsEngine } from "../adapters/translation/TransformersJsEngine.js";

const TranslationContext = createContext(null);

const TOGGLE_KEY   = "nu-map-course-translation";
const LS_PREFIX    = "nu-map-xlat:v1:";

// ── localStorage helpers ───────────────────────────────────────────

function lsGet(key) {
  try { return localStorage.getItem(LS_PREFIX + key); } catch { return null; }
}
function lsSet(key, val) {
  try { localStorage.setItem(LS_PREFIX + key, val); } catch {}
}

// ── Provider ───────────────────────────────────────────────────────

export function TranslationProvider({ catalogLocale = "en", children }) {
  const { locale } = useLanguage();

  const engineRef = useRef(null);
  const cacheRef  = useRef(new Map()); // key → translated string (in-memory)

  const [engineTier, setEngineTier] = useState(null);

  // Kept for API compatibility with Header/InfoPanel (always null for API engine).
  const [modelProgress] = useState(null); // eslint-disable-line no-unused-vars
  const [modelCached]   = useState(null); // eslint-disable-line no-unused-vars

  const [courseTranslationEnabled, setCourseTranslationEnabledState] = useState(() => {
    try { return localStorage.getItem(TOGGLE_KEY) === "1"; } catch { return false; }
  });

  const setCourseTranslationEnabled = useCallback((val) => {
    setCourseTranslationEnabledState(val);
    try { localStorage.setItem(TOGGLE_KEY, val ? "1" : "0"); } catch {}
  }, []);

  // Select best available engine when locale diverges from catalog locale.
  useEffect(() => {
    if (locale === catalogLocale) {
      engineRef.current?.destroy?.();
      engineRef.current = null;
      setEngineTier(null);
      return;
    }
    if (engineRef.current) return;

    (async () => {
      let engine;
      const chrome = new ChromeAIEngine();
      if (await chrome.isAvailable(locale, catalogLocale)) {
        engine = chrome;
      } else {
        engine = new GoogleTranslateEngine();
        // Uncomment to fall back to offline WASM instead of API:
        // engine = new TransformersJsEngine();
        // Uncomment to use HuggingFace Inference API (requires VITE_HF_TOKEN):
        // engine = new HFInferenceEngine();
      }
      engineRef.current = engine;
      setEngineTier(engine.tier);
    })();
  }, [locale, catalogLocale]);

  // Core translate — checks memory cache, then localStorage, then engine.
  // onToken(partialResults) is called after each streamed token so callers
  // can update the UI incrementally.
  const translate = useCallback(async (texts, targetLocale, onToken = null) => {
    if (targetLocale === catalogLocale) return texts;
    const engine = engineRef.current;
    if (!engine) return texts;

    const results = new Array(texts.length);
    const uncached = [];

    texts.forEach((text, i) => {
      const key = `${text}::${catalogLocale}→${targetLocale}`;
      const mem = cacheRef.current.get(key);
      if (mem != null) { results[i] = mem; return; }
      const stored = lsGet(key);
      if (stored != null) { cacheRef.current.set(key, stored); results[i] = stored; return; }
      uncached.push({ i, text, key });
    });

    if (uncached.length > 0) {
      // Map the engine's per-uncached-item partial updates back to the full results array.
      const streamHandler = onToken
        ? (partials) => {
            const snapshot = [...results];
            partials.forEach((partial, j) => {
              if (partial !== undefined) snapshot[uncached[j].i] = partial;
            });
            onToken(snapshot);
          }
        : null;

      const translated = await engine.translate(
        uncached.map(u => u.text),
        targetLocale,
        catalogLocale,
        streamHandler,
      );

      uncached.forEach(({ i, key }, j) => {
        const val = translated[j] ?? texts[i];
        cacheRef.current.set(key, val);
        lsSet(key, val);
        results[i] = val;
      });
    }

    return results;
  }, [catalogLocale]);

  // Abort in-flight requests and reset engine so the next translate call
  // starts fresh.
  const cancelDownload = useCallback(() => {
    engineRef.current?.destroy?.();
    engineRef.current = null;
    setEngineTier(null);
    setCourseTranslationEnabled(false);
  }, [setCourseTranslationEnabled]);

  // Wipe all locally-cached translations from localStorage.
  const clearModelCache = useCallback(() => {
    setCourseTranslationEnabled(false);
    cacheRef.current.clear();
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(LS_PREFIX)) toRemove.push(k);
      }
      toRemove.forEach(k => localStorage.removeItem(k));
    } catch {}
  }, [setCourseTranslationEnabled]);

  return (
    <TranslationContext.Provider value={{
      translate,
      catalogLocale,
      engineTier,
      modelProgress,   // always null for API engine; kept for Header compat
      modelCached,     // always null for API engine; kept for Header compat
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
 * streaming tokens into the UI as they arrive.
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
    setTranslated(null);   // clear previous course's translation
    setIsTranslating(true);

    const hasDesc     = Boolean(course.desc);
    const toTranslate = [course.title, ...(hasDesc ? [course.desc] : [])];

    translate(toTranslate, locale, (partials) => {
      // Called after each token — update UI with whatever has arrived so far.
      if (cancelled) return;
      setTranslated({
        title: partials[0] ?? "",
        desc:  hasDesc ? (partials[1] ?? "") : course.desc,
      });
    })
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
    // Only dim while waiting for the very first token; once streaming starts
    // the text updates live and the dim would obscure the typewriter effect.
    isTranslating: active && isTranslating && !translated,
  };
}
