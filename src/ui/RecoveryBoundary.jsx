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

// The animated emblem, mirrored from the index.html overlay: the logo
// floats with a diagonal glint sweeping inside the letterform (the PNG
// doubles as a CSS mask), wrapped in a single red ribbon streamer — a
// long dash segment flowing along a slowly-turning eccentric loop.
function Emblem({ dark }) {
  const ribbon = (d, stroke, width, dash, period, flowDur, spin, opacity) => (
    <g opacity={opacity}>
      <animateTransform attributeName="transform" type="rotate"
        from={spin < 0 ? "360 60 60" : "0 60 60"} to={spin < 0 ? "0 60 60" : "360 60 60"}
        dur={`${Math.abs(spin)}s`} repeatCount="indefinite" />
      <path d={d} stroke={stroke} strokeWidth={width} fill="none"
        strokeLinecap="round" strokeDasharray={dash}>
        <animate attributeName="stroke-dashoffset" from="0" to={`-${period}`}
          dur={flowDur} repeatCount="indefinite" />
      </path>
    </g>
  );
  return (
    <div style={{ position: "relative", width: 120, height: 120, margin: "0 auto 14px" }}>
      {/* One color: the logo's red carries the whole screen — the single
          ribbon and the sweeping bar segment both wear it. */}
      <svg viewBox="0 0 120 120" aria-hidden="true"
        style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", overflow: "visible" }}>
        {ribbon("M60 8 C 90 6, 114 30, 110 60 C 106 90, 84 112, 56 110 C 26 108, 6 84, 10 56 C 14 30, 32 10, 60 8",
          "#ef4444", 6, "150 90", 240, "3.2s", 16, 0.9)}
      </svg>
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 56, height: 56,
        margin: "-28px 0 0 -28px", animation: "numapFloat 3s ease-in-out infinite alternate" }}>
        <img src="/logo.png" alt="" onError={e => { e.currentTarget.parentNode.style.display = "none"; }}
          style={{ width: "100%", height: "100%", display: "block" }} />
        <div style={{ position: "absolute", inset: 0, overflow: "hidden",
          WebkitMaskImage: "url(/logo.png)", WebkitMaskSize: "contain", WebkitMaskRepeat: "no-repeat",
          maskImage: "url(/logo.png)", maskSize: "contain", maskRepeat: "no-repeat" }}>
          <div style={{ position: "absolute", top: "-20%", bottom: "-20%", width: "30%",
            transform: "skewX(-20deg)",
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.8), transparent)",
            animation: "numapGlint 2.6s ease-in-out infinite" }} />
        </div>
      </div>
    </div>
  );
}

// Petal drift over the whole screen — tints of the logo red, each petal
// on its own clock (negative delays start them mid-flight), swaying and
// tumbling as it falls. Deterministic pseudo-randomness from the index,
// mirroring the index.html overlay exactly.
// Phase-uniform delays: each petal starts at an evenly spaced fraction
// of its own fall (5 is coprime to 14, so the fractions cover the whole
// cycle) — the shower is steady at every height, never bunches, never
// leaves gaps.
const PETALS = Array.from({ length: 14 }, (_, i) => {
  const fall = 9 + ((i * 53) % 70) / 10;
  return {
    left:    (i * 83 + 7) % 100,
    size:    10 + ((i * 37) % 8),
    fall,
    delay:   -(fall * ((i * 5) % 14) / 14),
    sway:    2.4 + ((i * 29) % 20) / 10,
    color:   i % 3 === 0 ? "#ef4444" : i % 3 === 1 ? "#f87171" : "#fca5a5",
    opacity: 0.35 + ((i * 17) % 30) / 100,
  };
});

function Petals() {
  return (
    <div className="numap-petals" style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {PETALS.map((p, i) => (
        <div key={i} style={{ position: "absolute", top: "-6vh", left: `${p.left}%`,
          animation: `numapFall ${p.fall}s linear ${p.delay}s infinite` }}>
          <svg width={p.size} height={p.size} viewBox="0 0 12 12" aria-hidden="true"
            style={{ display: "block", opacity: p.opacity,
              animation: `numapSway ${p.sway}s ease-in-out ${p.delay / 2}s infinite alternate` }}>
            <path d="M6 0 C 9.2 2.4, 9.2 7.2, 6 12 C 2.8 7.2, 2.8 2.4, 6 0" fill={p.color} />
          </svg>
        </div>
      ))}
    </div>
  );
}

// Same theme resolution as index.html's pre-paint script: the saved app
// theme wins, the OS preference is only the fallback.
const isDark = () => {
  let theme = null;
  try { theme = localStorage.getItem("ncp-theme") || localStorage.getItem("map-theme"); } catch { /* fall through */ }
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return typeof window !== "undefined"
    && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
};

export default class RecoveryBoundary extends Component {
  // Design preview: ?preview=crash renders the fallback without a real
  // crash (and without the auto-reload, which only runs in didCatch).
  state = { crashed: /[?&]preview=crash\b/.test(window.location.search) };

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
    const dark = isDark();
    const rtl = lc === "ar";
    return (
      <div dir={rtl ? "rtl" : "ltr"} style={{
        position: "fixed", inset: 0, zIndex: 99999,
        display: "flex", alignItems: "center", justifyContent: "center",
        textAlign: "center", padding: 24,
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: dark ? "#0d1117" : "#fefefe",
        color: dark ? "#e2e8f0" : "#1e293b",
      }}>
        {/* Same sweeping bar as the index.html overlay (the app's own
            loading-bar vocabulary): the auto-reload IS working on it,
            and a moving element says so better than static text. */}
        <style>{`
          @keyframes numapCrashSweep { from { transform: translateX(${rtl ? "250%" : "-100%"}) } to { transform: translateX(${rtl ? "-100%" : "250%"}) } }
          @keyframes numapCrashIn { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
          @keyframes numapFloat { from { transform: translateY(-2px) } to { transform: translateY(3px) } }
          @keyframes numapGlint { 0% { left: -45% } 55% { left: 125% } 100% { left: 125% } }
          @keyframes numapFall { from { transform: translateY(0) } to { transform: translateY(112vh) } }
          @keyframes numapSway { from { transform: translateX(-10px) rotate(-40deg) } to { transform: translateX(10px) rotate(40deg) } }
          @media (prefers-reduced-motion: reduce) {
            .numap-crash *, .numap-petals * { animation: none !important }
            .numap-petals { display: none }
          }
        `}</style>
        <Petals />
        <div className="numap-crash" style={{ animation: "numapCrashIn .35s ease-out", position: "relative" }}>
          <Emblem dark={dark} />
          <div style={{ width: 260, height: 4, borderRadius: 99, overflow: "hidden",
            margin: "0 auto 20px", background: dark ? "#21262d" : "#e2e8f0" }}>
            <div style={{ width: "40%", height: "100%", borderRadius: 99,
              background: "#ef4444",
              animation: "numapCrashSweep 1.3s ease-in-out infinite alternate" }} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, maxWidth: 420, lineHeight: 1.5 }}>
            {MSG[lc] || MSG.en}
          </div>
          <button onClick={() => window.location.reload()} style={{
            marginTop: 16, fontSize: 13, fontWeight: 700, padding: "8px 20px",
            borderRadius: 8, border: `1px solid ${dark ? "#3d444d" : "#cbd5e1"}`,
            background: "transparent", color: "inherit", cursor: "pointer",
          }}>
            {BTN[lc] || BTN.en}
          </button>
        </div>
      </div>
    );
  }
}
