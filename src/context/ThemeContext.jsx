// ═══════════════════════════════════════════════════════════════════
// THEME CONTEXT  — injects CSS custom properties on <html> whenever
// the active theme changes.  All components read colors via
// var(--token-name) in their inline styles — no prop drilling needed.
// ═══════════════════════════════════════════════════════════════════
import { createContext, useContext, useEffect, useState } from 'react';
import { THEMES, DEFAULT_THEME } from '../core/themes.js';

const ThemeCtx = createContext(null);

const LS_KEY = 'ncp-theme';

/** Write all CSS custom properties for `tokens` onto <html>. */
function applyTheme(tokens) {
  const root = document.documentElement;
  Object.entries(tokens).forEach(([k, v]) => root.style.setProperty(k, v));

  // Scrollbar + body colours can't be set via inline style; use a dynamic <style> tag.
  let el = document.getElementById('ncp-theme-style');
  if (!el) {
    el = document.createElement('style');
    el.id = 'ncp-theme-style';
    document.head.appendChild(el);
  }
  el.textContent = `
    body { background: ${tokens['--bg-app']}; color: ${tokens['--text-1']}; }
    ::-webkit-scrollbar-track { background: ${tokens['--scrollbar-track']}; }
    ::-webkit-scrollbar-thumb { background: ${tokens['--scrollbar-thumb']}; border-radius: 99px; }
    ::-webkit-scrollbar-thumb:hover { background: ${tokens['--scrollbar-hov']}; }
  `;
}

export function ThemeProvider({ children }) {
  const [themeName, setThemeState] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      return (saved && THEMES[saved]) ? saved : DEFAULT_THEME;
    } catch {
      return DEFAULT_THEME;
    }
  });

  const setThemeName = name => {
    if (!THEMES[name]) return;
    setThemeState(name);
    try { localStorage.setItem(LS_KEY, name); } catch {}
  };

  // Apply CSS vars whenever theme changes (and on first mount).
  useEffect(() => { applyTheme(THEMES[themeName]); }, [themeName]);

  return (
    <ThemeCtx.Provider value={{ themeName, setThemeName, themeNames: Object.keys(THEMES) }}>
      {children}
    </ThemeCtx.Provider>
  );
}

/** Hook — returns { themeName, setThemeName, themeNames }. */
export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
