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
import { createContext, useContext, useState, useMemo } from "react";
import { usePort }       from "./InstitutionContext.jsx";
import { IInstitution } from "../ports/IInstitution.js";

// Eagerly load all locale files at build time.
// Each file must export { meta, strings, default }.
const LOCALE_MODULES = import.meta.glob("../locales/*.js", { eager: true });

/** @type {Record<string, Record<string, string>>} code → strings map */
const LOCALE_STRINGS = {};

/** @type {{ code: string, name: string, nativeName: string, dir: string }[]} */
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
    try { return localStorage.getItem(storageKey) ?? defaultLocale; }
    catch { return defaultLocale; }
  });

  const setLocale = (code) => {
    setLocaleState(code);
    try { localStorage.setItem(storageKey, code); } catch {}
  };

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
