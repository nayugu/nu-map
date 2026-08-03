// NU Map — Copyright (C) 2025-2026 Nathan Gu and Matthew Gu
// SPDX-License-Identifier: AGPL-3.0-only
// AGPL-3.0-only + attribution term under §7(b); see LICENSING.md and NOTICE.
//
// Root error boundary — the last white-screen source. index.html's
// recovery script covers a bundle that fails to LOAD; this covers code
// that loads and then throws during render, which previously unmounted
// React to a blank page with no explanation.
//
// One throttled auto-reload first: a deploy can strand old code against
// new data shapes, which a fresh load fixes. A genuine bug re-crashes
// inside the throttle window, so the message stays up instead of looping.
//
// Sits ABOVE every provider (crashes in providers must land here), so it
// cannot use LanguageContext — strings are mirrored inline for all 8
// locales, keyed off the persisted locale, exactly like the index.html
// overlay it visually matches.

import { Component } from "react";

const MSG = {
  en: "Something went wrong. Reloading usually fixes it.",
  es: "Algo salió mal. Recargar suele solucionarlo.",
  fr: "Une erreur est survenue. Recharger règle généralement le problème.",
  ar: "حدث خطأ ما. عادةً ما تحل إعادة التحميل المشكلة.",
  hi: "कुछ गड़बड़ हुई। दोबारा लोड करने से अक्सर ठीक हो जाता है।",
  ja: "問題が発生しました。再読み込みで直ることがほとんどです。",
  ko: "문제가 발생했습니다. 새로고침하면 대부분 해결됩니다.",
  zh: "出了点问题，重新加载通常可以解决。",
};
const BTN = {
  en: "Reload", es: "Recargar", fr: "Recharger",
  ar: "إعادة التحميل", hi: "फिर से लोड करें",
  ja: "再読み込み", ko: "새로고침", zh: "重新加载",
};

const localeOf = () => {
  try { return (localStorage.getItem("ncp-locale") || navigator.language || "en").slice(0, 2); }
  catch { return "en"; }
};

export default class RecoveryBoundary extends Component {
  state = { crashed: false };

  static getDerivedStateFromError() { return { crashed: true }; }

  componentDidCatch(error, info) {
    console.error("[nu-map] render crash:", error, info?.componentStack);
    try {
      const last = parseInt(sessionStorage.getItem("numap-crash-retry") || "0", 10);
      if (Date.now() - last > 60_000) {
        sessionStorage.setItem("numap-crash-retry", String(Date.now()));
        window.location.reload();
      }
    } catch { /* storage unavailable — the message below still shows */ }
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    const lc = localeOf();
    const dark = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    return (
      <div dir={lc === "ar" ? "rtl" : "ltr"} style={{
        position: "fixed", inset: 0, zIndex: 99999,
        display: "flex", alignItems: "center", justifyContent: "center",
        textAlign: "center", padding: 24,
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: dark ? "#0f172a" : "#f8fafc",
        color: dark ? "#e2e8f0" : "#1e293b",
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, maxWidth: 420, lineHeight: 1.5 }}>
            {MSG[lc] || MSG.en}
          </div>
          <button onClick={() => window.location.reload()} style={{
            marginTop: 16, fontSize: 13, fontWeight: 700, padding: "8px 20px",
            borderRadius: 8, border: `1px solid ${dark ? "#475569" : "#cbd5e1"}`,
            background: "transparent", color: "inherit", cursor: "pointer",
          }}>
            {BTN[lc] || BTN.en}
          </button>
        </div>
      </div>
    );
  }
}
