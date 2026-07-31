// ═══════════════════════════════════════════════════════════════════
// LANGUAGE CONTEXT
//
// Cross-cutting app infrastructure — parallel to ThemeContext, NOT
// part of the hexagonal institution adapter system.
//
// The institution adapter touches this at one point only:
//   IInstitution.defaultLocale  — which language to open with
//
// The user can override that at runtime via setLocale(); the choice
// is persisted in localStorage under "{storagePrefix}-locale".
//
// Usage:
//   import { useLanguage } from "../context/LanguageContext.jsx";
//   const { t, locale, setLocale, locales } = useLanguage();
//   t("bank.title")                    → "COURSE BANK" / "课程库"
//   t("sem.other.drop", { unit: "SH"}) → "drop <4 SH here"
// ═══════════════════════════════════════════════════════════════════
import { createContext, useContext, useState, useMemo, useEffect } from "react";
import { usePort }       from "./InstitutionContext.jsx";
import { IInstitution } from "../ports/IInstitution.js";

// Eagerly load all locale files at build time.
// Each file must export { meta, strings, default }.
const LOCALE_MODULES = import.meta.glob("../locales/*.js", { eager: true });

/** @type {Record<string, Record<string, string>>} code → strings map */
const LOCALE_STRINGS = {};

/** @type {{ code: string, name: string, nativeName: string, dir: string, uiScale?: number }[]} */
const LOCALE_META = [];

for (const mod of Object.values(LOCALE_MODULES)) {
  if (!mod.meta?.code || !mod.strings) continue;
  LOCALE_STRINGS[mod.meta.code] = mod.strings;
  LOCALE_META.push(mod.meta);
}
// Sort: English first, then alphabetical by nativeName
LOCALE_META.sort((a, b) =>
  a.code === "en" ? -1 : b.code === "en" ? 1 : a.nativeName.localeCompare(b.nativeName)
);

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const institution   = usePort(IInstitution);
  const defaultLocale = institution.defaultLocale ?? "en";
  const storageKey    = `${institution.storagePrefix}-locale`;

  const [locale, setLocaleState] = useState(() => {
    try {
      const param = new URLSearchParams(window.location.search).get("locale");
      if (param && LOCALE_STRINGS[param]) {
        localStorage.setItem(storageKey, param);
        return param;
      }
      // Validate like the URL param above: a stale code (e.g. a locale
      // later removed) would render English fallbacks while machine
      // translation auto-targets a bogus locale.
      const stored = localStorage.getItem(storageKey);
      if (stored && LOCALE_STRINGS[stored]) return stored;
      return LOCALE_STRINGS[defaultLocale] ? defaultLocale : "en";
    } catch { return defaultLocale; }
  });

  const setLocale = (code) => {
    setLocaleState(code);
    try { localStorage.setItem(storageKey, code); } catch {}
    try {
      const params = new URLSearchParams(window.location.search);
      if (code === defaultLocale) { params.delete("locale"); } else { params.set("locale", code); }
      const q = params.toString();
      history.replaceState(null, "", window.location.pathname + (q ? "?" + q : ""));
    } catch {}
  };

  // Keep the document language in sync: the browser picks correct
  // regional glyph variants for fallback fonts, and index.html's
  // :lang(zh/ja/ko) rules key off it (CJK tracking + line-height scale to
  // match the size-adjusted glyphs from fonts-cjk.css). For those three
  // locales, lazily inject the (large) CJK font stylesheet once — so the
  // Latin-script majority never downloads it. It stays cached thereafter.
  useEffect(() => {
    document.documentElement.lang = locale;
    if (/^(zh|ja|ko)/.test(locale) && !document.getElementById("cjk-fonts")) {
      const link = document.createElement("link");
      link.id = "cjk-fonts";
      link.rel = "stylesheet";
      link.href = `${import.meta.env.BASE_URL}fonts-cjk.css`;
      document.head.appendChild(link);
    }
  }, [locale]);

  /** Translate key with optional named interpolation vars. Falls back to en, then key. */
  const t = useMemo(() => {
    const active   = LOCALE_STRINGS[locale]    ?? {};
    const fallback = LOCALE_STRINGS["en"]      ?? {};
    return (key, vars = {}) => {
      const str = active[key] ?? fallback[key] ?? key;
      return str.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
    };
  }, [locale]);

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t, locales: LOCALE_META }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage() must be used inside <LanguageProvider>");
  return ctx;
}
