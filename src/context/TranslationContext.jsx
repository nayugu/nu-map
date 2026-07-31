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
// A single CascadeEngine chains the engines and falls through on
// failure (per-engine failure thresholds live in CascadeEngine):
//   1. ChromeAIEngine      — browser-native, instant, no download
//                            (included only when the pair is instantly
//                            available — download states are skipped)
//   2. GoogleTranslateEngine — unofficial translate.googleapis.com endpoint,
//                              no API key, CORS-enabled, near-instant
//   3. MyMemoryEngine      — last resort; reachable from mainland China
//
// The cascade is rebuilt whenever the language pair changes or the
// course-translation toggle flips — Chrome AI availability is per
// language pair, so an engine chosen for es must not be reused for ar.
//
// Caching
// ───────
// Translations are cached in two layers:
//   • in-memory Map (cacheRef) — zero-latency within a session
//   • localStorage ("nu-map-xlat:v1:…") — persists across sessions
// Empty/whitespace-only results are treated as failed translations:
// never cached, never rendered — the source text is shown instead.
// (Reads also skip empty entries, self-healing caches poisoned before
// this guard existed.)
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
import { ChromeAIEngine }  from "../adapters/translation/ChromeAIEngine.js";
import { CascadeEngine }   from "../adapters/translation/CascadeEngine.js";
import { GoogleTranslateEngine } from "../adapters/translation/GoogleTranslateEngine.js";
import { MyMemoryEngine }        from "../adapters/translation/MyMemoryEngine.js";
// import { HFInferenceEngine }    from "../adapters/translation/HFInferenceEngine.js";
// import { TransformersJsEngine } from "../adapters/translation/TransformersJsEngine.js";
import { glossaryLookup }         from "../locales/glossary.js";

const TranslationContext = createContext(null);

// v2: only ever written by an explicit user action (checkbox/cancel).
// The old unversioned key was persisted by the auto-toggle effect on
// every visit — "0" simply meant "last session ended in English", not
// "the user opted out" — so its value is meaningless as a preference
// and must not be honored (it froze translation off for anyone whose
// last pre-v2 session was in the catalog language).
const TOGGLE_KEY   = "nu-map-course-translation-v2";
const LS_PREFIX    = "nu-map-xlat:v1:";

try { localStorage.removeItem("nu-map-course-translation"); } catch { /* SSR/blocked storage */ }

// ── localStorage helpers ───────────────────────────────────────────

function lsGet(key) {
  try { return localStorage.getItem(LS_PREFIX + key); } catch { return null; }
}
function lsSet(key, val) {
  try { localStorage.setItem(LS_PREFIX + key, val); } catch {}
}
function lsRemove(key) {
  try { localStorage.removeItem(LS_PREFIX + key); } catch {}
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

  const [courseTranslationEnabled, setCourseTranslationEnabledState] = useState(false);

  // User-driven setter: persists the choice so it survives reloads and
  // locale switches.
  const setCourseTranslationEnabled = useCallback((val) => {
    setCourseTranslationEnabledState(val);
    try { localStorage.setItem(TOGGLE_KEY, val ? "1" : "0"); } catch {}
  }, []);

  // Default the toggle when the UI language changes: ON when it diverges
  // from the catalog locale, OFF when it matches — unless the user has
  // toggled explicitly before (persisted under TOGGLE_KEY), which wins.
  useEffect(() => {
    if (locale === catalogLocale) {
      setCourseTranslationEnabledState(false);
      return;
    }
    let stored = null;
    try { stored = localStorage.getItem(TOGGLE_KEY); } catch {}
    setCourseTranslationEnabledState(stored == null ? true : stored === "1");
  }, [locale, catalogLocale]);

  // (Re)build the engine cascade whenever translation becomes active or
  // the language pair changes.  Re-running on locale change matters:
  // Chrome AI availability is per language pair.  The cancelled flag
  // keeps a stale async selection from clobbering a newer one (or from
  // resurrecting an engine after translation was switched off).
  useEffect(() => {
    if (locale === catalogLocale || !courseTranslationEnabled) {
      engineRef.current?.destroy?.();
      engineRef.current = null;
      setEngineTier(null);
      return;
    }

    let cancelled = false;
    (async () => {
      const chain  = [new GoogleTranslateEngine(), new MyMemoryEngine()];
      const chrome = new ChromeAIEngine();
      if (await chrome.isAvailable(locale, catalogLocale)) chain.unshift(chrome);
      const engine = new CascadeEngine(chain);
      if (cancelled) { engine.destroy(); return; }
      engineRef.current?.destroy?.();
      engineRef.current = engine;
      setEngineTier(engine.tier);
    })();

    return () => { cancelled = true; };
  }, [locale, catalogLocale, courseTranslationEnabled]);

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
      // Curated override for academic terms Google mistranslates.
      const override = glossaryLookup(text, targetLocale);
      if (override != null) {
        cacheRef.current.set(key, override);
        results[i] = override;
        return;
      }
      // Empty cached values are failed translations from before the
      // write-path guard existed — skip them (and purge from
      // localStorage) so the string gets retried instead of rendering
      // blank forever.
      const mem = cacheRef.current.get(key);
      if (mem != null && mem.trim() !== "") { results[i] = mem; return; }
      const stored = lsGet(key);
      if (stored != null) {
        if (stored.trim() !== "") {
          cacheRef.current.set(key, stored);
          results[i] = stored;
          return;
        }
        lsRemove(key);
      }
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
        const val = translated[j];
        // An empty/whitespace result is a failed translation — show the
        // source text and leave the cache alone so a later call retries.
        if (val == null || val.trim() === "") {
          results[i] = texts[i];
          return;
        }
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
      // Called after each token — update UI with whatever has arrived so
      // far, falling back to the source text for items still pending
      // (never render "" in place of a title/description).
      if (cancelled) return;
      setTranslated({
        title: partials[0] ?? course.title,
        desc:  hasDesc ? (partials[1] ?? course.desc) : course.desc,
      });
    })
      .then(results => {
        if (cancelled) return;
        setTranslated({ title: results[0], desc: hasDesc ? results[1] : course.desc });
        setIsTranslating(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Drop any partial snapshot so the UI shows the source text
        // instead of whatever half-translated state the batch died in.
        setTranslated(null);
        setIsTranslating(false);
      });

    return () => { cancelled = true; };
  }, [course?.id, locale, catalogLocale, engineTier, courseTranslationEnabled, translate]);

  const active = courseTranslationEnabled && locale !== catalogLocale;
  return {
    // || (not ??): an empty translation must never shadow the source text.
    title:         translated?.title || course?.title || "",
    desc:          translated?.desc  || course?.desc  || "",
    // Only dim while waiting for the very first token; once streaming starts
    // the text updates live and the dim would obscure the typewriter effect.
    isTranslating: active && isTranslating && !translated,
  };
}

/**
 * Drop-in wrapper that renders a translated version of its single
 * string child (or `text` prop).  Sugar over useTranslatedText so callers
 * can wrap any inline string without managing hooks:
 *
 *   <TText>{sem.label}</TText>
 *   <TText>Session A</TText>
 *
 * Useful for adapter-supplied strings (semester labels, special term
 * type labels, etc.) — universities don't need to provide per-language
 * translations; Google does it once per user and caches forever.
 *
 * `as` is an optional disambiguating rephrasing that gets sent to the
 * engine in place of the display text.  Google Translate has no
 * "context" parameter, so when a term is ambiguous in isolation —
 * "Session" reads as "meeting" — pass a clearer phrasing through `as`:
 *
 *   <TText as="summer half-term A">Session A</TText>
 *
 * In the source locale (English) the displayed text is unchanged; in
 * other locales the user sees the translation of the `as` phrase.
 */
// ── Latin runs inside CJK text ─────────────────────────────────────
// size-adjust (public/fonts-cjk.css) enlarges only CJK glyphs — fonts
// select per codepoint and can't see context — so ASCII digits/symbols
// INSIDE a translated sentence ("…微积分 2。") would stay small next to
// the bigger CJK. This render-time helper wraps Latin runs of a
// CJK-containing string in a matching-scale span. Strings without any
// CJK (course codes, English UI) pass through completely untouched.
const CJK_RE = /[⺀-鿿豈-﫿＀-￯]/;
// Hangul (syllables + conjoining jamo). CJK_RE above covers Han/kana.
const HANGUL_RE = /[가-힣ᄀ-ᇿ]/;
export function scaleLatinRuns(str, { tight = false } = {}) {
  if (typeof str !== "string") return str;
  const isKo = HANGUL_RE.test(str);
  // Match each script's size-adjust in fonts-cjk.css: full-scale Inter
  // (Hangul 1.22, else 1.16) or, with `tight`, the gentler InterTight
  // factors (1.11 / 1.08) — for text rendered in the InterTight stack.
  if (!isKo && !CJK_RE.test(str)) return str;
  const em = isKo ? (tight ? "1.11em" : "1.22em") : (tight ? "1.08em" : "1.16em");
  const parts = str.split(/([\x20-\x7E]+)/);
  if (parts.length === 1) return str;
  return parts.map((p, i) =>
    i % 2 ? <span key={i} style={{ fontSize: em }}>{p}</span> : p
  );
}

export function TText({ children, text, as, tight = false }) {
  const display = text ?? (typeof children === "string" ? children : "");
  const translated = useTranslatedText(display, { as });
  return scaleLatinRuns(translated, { tight });
}

/**
 * Translates a single string to the active locale, returning the source
 * text immediately and re-rendering with the translated text once it
 * arrives.  Designed for rendering many translatable names at once
 * (course bank, planner cards, grad requirement tree) — relies on the
 * engine's concurrency limiter to avoid bursting requests.
 *
 * If translation is disabled, locale matches catalogLocale, or the
 * engine isn't ready, returns `text` unchanged.
 *
 * @param {string | null | undefined} text          display text; returned when no translation happens
 * @param {{ as?: string | null }}    [options]     `options.as` overrides what's sent to the engine
 * @returns {string}
 */
export function useTranslatedText(text, options = {}) {
  const { as } = options;
  const source = as ?? text;

  const { locale } = useLanguage();
  const { translate, catalogLocale, engineTier, courseTranslationEnabled } = useTranslation();

  const [translated, setTranslated] = useState(null);

  useEffect(() => {
    if (!courseTranslationEnabled || locale === catalogLocale || !source || !engineTier) {
      setTranslated(null);
      return;
    }
    let cancelled = false;
    translate([source], locale)
      .then(results => { if (!cancelled) setTranslated(results[0]); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [source, locale, catalogLocale, engineTier, courseTranslationEnabled, translate]);

  // || (not ??): an empty translation must never shadow the source text.
  return translated || text || "";
}
