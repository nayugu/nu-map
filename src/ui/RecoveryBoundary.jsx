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
  en: "Something went wrong. Fixing it…",
  es: "Algo salió mal. Arreglándolo…",
  fr: "Une erreur est survenue. Réparation en cours…",
  ar: "حدث خطأ ما. جارٍ الإصلاح…",
  hi: "कुछ गड़बड़ हुई। ठीक किया जा रहा है…",
  ja: "問題が発生しました。復旧しています…",
  ko: "문제가 발생했습니다. 복구 중…",
  zh: "出了点问题，正在修复…",
};
// No time estimate on the crash page — a bug's duration can't honestly
// be promised, unlike a deploy's. Just the message, then the nudge.
// Mirrors the overlay's return-button label ("NU Map" stays untranslated).
const BACK = {
  en: "Back to NU Map",
  es: "Volver a NU Map",
  fr: "Retour à NU Map",
  ar: "العودة إلى NU Map",
  hi: "NU Map पर वापस जाएँ",
  ja: "NU Map に戻る",
  ko: "NU Map으로 돌아가기",
  zh: "返回 NU Map",
};
// The 90-second nudge, also mirrored from the overlay.
const NUDGE = {
  en: "Taking longer than usual? A reload sometimes helps.",
  es: "¿Tarda más de lo normal? Recargar a veces ayuda.",
  fr: "Plus long que prévu ? Recharger aide parfois.",
  ar: "يستغرق وقتًا أطول من المعتاد؟ قد تساعد إعادة التحميل.",
  hi: "सामान्य से ज़्यादा समय लग रहा है? कभी-कभी फिर से लोड करने से मदद मिलती है।",
  ja: "いつもより時間がかかっていますか？再読み込みすると直ることがあります。",
  ko: "평소보다 오래 걸리나요? 새로고침이 도움이 될 때가 있습니다.",
  zh: "比平时慢？有时重新加载会有帮助。",
};

const localeOf = () => {
  try { return (localStorage.getItem("ncp-locale") || navigator.language || "en").slice(0, 2); }
  catch { return "en"; }
};

// The animated emblem, mirrored from the index.html overlay: the logo
// floats with a diagonal glint sweeping inside the letterform (the PNG
// doubles as a CSS mask), wrapped in a single red ribbon streamer — a
// long dash segment flowing along a slowly-turning eccentric loop.
function Emblem({ dark, complete, onReturn, title }) {
  const ribbon = (d, stroke, width, dash, period, flowDur, spin, opacity) => (
    <g opacity={opacity}>
      <animateTransform attributeName="transform" type="rotate"
        from={spin < 0 ? "360 60 60" : "0 60 60"} to={spin < 0 ? "0 60 60" : "360 60 60"}
        dur={`${Math.abs(spin)}s`} repeatCount="indefinite" />
      <path d={d} stroke={stroke} strokeWidth={width} fill="none"
        strokeLinecap="round" strokeDasharray={dash}
        style={{ transition: "stroke-dasharray 1.1s ease" }}>
        <animate attributeName="stroke-dashoffset" from="0" to={`-${period}`}
          dur={flowDur} repeatCount="indefinite" />
      </path>
    </g>
  );
  return (
    <div className={complete ? "numap-emblem-live" : undefined}
      role={complete ? "button" : undefined}
      title={complete ? title : undefined}
      onClick={complete ? onReturn : undefined}
      style={{ position: "relative", width: 120, height: 120, margin: "0 auto 14px",
        cursor: complete ? "pointer" : "default", transition: "transform .35s ease" }}>
      {/* One color: the logo's red carries the whole screen — the single
          ribbon and the sweeping bar segment both wear it. On detection
          the dash grows to swallow its gap (same 240 period, seamless)
          and the closed ring IS the way back. */}
      <svg viewBox="0 0 120 120" aria-hidden="true"
        style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", overflow: "visible" }}>
        {ribbon("M60 8 C 90 6, 114 30, 110 60 C 106 90, 84 112, 56 110 C 26 108, 6 84, 10 56 C 14 30, 32 10, 60 8",
          "#ef4444", 6, complete ? "240 0" : "150 90", 240, "3.2s", 16, 0.9)}
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

// The exit storm, mirroring index.html: each petal ACCELERATES
// left→right (ease-in cubic-bezier = wind force, not constant speed),
// the infinite repeat keeps fresh petals arriving from the left, and
// the layer itself gusts — irregular opacity waves, denser at some
// moments than others.
const STORM = Array.from({ length: 36 }, (_, i) => {
  const dur = 1.2 + ((i * 53) % 100) / 100;
  return {
    top:     ((i * 61 + 3) % 100) - 8,
    size:    8 + ((i * 37) % 9),
    dur,
    delay:   -(dur * ((i * 5) % 36) / 36),
    color:   i % 3 === 0 ? "#ef4444" : i % 3 === 1 ? "#f87171" : "#fca5a5",
    opacity: 0.4 + ((i * 17) % 40) / 100,
  };
});

function Storm() {
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none",
      animation: "numapGust 2.6s ease-in-out infinite" }}>
      {STORM.map((p, i) => (
        <div key={i} style={{ position: "absolute", top: `${p.top}%`, left: "-12%",
          animation: `numapStorm ${p.dur}s cubic-bezier(.5,.05,.85,.45) ${p.delay}s infinite` }}>
          <svg width={p.size} height={p.size} viewBox="0 0 12 12" aria-hidden="true"
            style={{ display: "block", opacity: p.opacity }}>
            <path d="M6 0 C 9.2 2.4, 9.2 7.2, 6 12 C 2.8 7.2, 2.8 2.4, 6 0" fill={p.color} />
          </svg>
        </div>
      ))}
    </div>
  );
}

function Petals({ leaving, slow }) {
  return (
    <div className="numap-petals" style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none",
      // The ambient field feels the exit wind too: it accelerates off
      // the right edge rather than jumping to a speed.
      ...(leaving ? { animation: `numapBlowoff ${slow ? "6s" : "2.4s"} cubic-bezier(.5,0,.85,.5) forwards` } : {}) }}>
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
  // Dev-only, like the index.html previews.
  state = {
    crashed: import.meta.env.DEV && /[?&]preview=crash\b/.test(window.location.search),
    leaving: false,
    showLink: false,         // 2-minute mark: the nudge fades in under the message
    detected: false,         // a newer build is live — recovery is offered
    detectedSettled: false,  // fade-outs done; the return button may arrive
  };

  // Detection, crash-page flavor: a bug can't be probed away, but the
  // most common real crash is deploy skew (old code + new data), and
  // for that "a newer build is live" IS the fix signal.
  //
  // The test itself is index.html's — window.__numapCheckLive, defined
  // in the recovery script that always runs before this bundle. It
  // reads the live deployment's assets/build.json and re-fetches the
  // entry bundle it names, because status alone lies here: a hash this
  // deploy deleted does not 404, the SPA fallback answers it with the
  // HTML shell at 200. This screen used to wait for that 404, so it
  // never detected anything; the boot screen used to accept the 200,
  // so it detected instantly and wrongly. Dev has no manifest, so the
  // preview simulates detection instead.
  startProbe = () => {
    if (this.probeTimer || this.previewDetectTimer) return;
    const preview = import.meta.env.DEV && /[?&]preview=crash\b/.test(window.location.search);
    if (preview) {
      this.previewDetectTimer = setTimeout(this.detected, 10_000);
      return;
    }
    if (!window.__numapCheckLive) return;
    this.probeTimer = setInterval(async () => {
      if (await window.__numapCheckLive()) this.detected();
    }, 10_000);
  };

  detected = () => {
    if (this.state.detected || this.state.leaving) return;
    clearInterval(this.probeTimer);
    clearTimeout(this.previewDetectTimer);
    clearTimeout(this.ghostTimer);
    this.setState({ detected: true, showLink: false });
    this.settleTimer = setTimeout(() => this.setState({ detectedSettled: true }), 620);
    // Not pressed? Return on our own after five minutes, like the
    // overlay (30 s in preview, so the unattended cycle is watchable).
    const preview = import.meta.env.DEV && /[?&]preview=crash\b/.test(window.location.search);
    this.autoReturnTimer = setTimeout(this.stormReload, preview ? 15_000 : 300_000);
  };

  static getDerivedStateFromError() { return { crashed: true }; }

  // No button — recovery is automatic. But never a dead end: at the
  // 2-minute mark the quiet reload nudge fades in under the message
  // as the escape hatch (5 s in the dev preview).
  scheduleGhost = () => {
    if (this.ghostTimer) return;
    const preview = import.meta.env.DEV && /[?&]preview=crash\b/.test(window.location.search);
    this.ghostTimer = setTimeout(() => this.setState({ showLink: true }), preview ? 3_000 : 120_000);
  };

  componentDidMount() {
    if (this.state.crashed) { this.scheduleGhost(); this.startProbe(); }
  }
  componentWillUnmount() {
    // Null the ids as well as clearing: StrictMode remounts this same
    // instance in dev, and stale ids would trip the "already scheduled"
    // guards — which silently killed the nudge and detection in dev.
    clearTimeout(this.ghostTimer);         this.ghostTimer = null;
    clearTimeout(this.previewDetectTimer); this.previewDetectTimer = null;
    clearTimeout(this.settleTimer);        this.settleTimer = null;
    clearTimeout(this.autoReturnTimer);    this.autoReturnTimer = null;
    clearInterval(this.probeTimer);        this.probeTimer = null;
  }

  // Exit choreography shared by auto-retry and the button: the petal
  // storm rises for 0.7 s, the reload happens inside it, and the next
  // page boots under the reveal veil (index.html reads numap-reveal)
  // that clears once the app is alive.
  stormReload = () => {
    if (this.state.leaving) return;
    // Preview exits run in slow motion (~2.5×), mirrored from the
    // index.html overlay; flag value '2' carries the slowness across
    // the reload into the reveal veil.
    const slow = /[?&]preview=/.test(window.location.search);
    this.slowExit = slow;
    try { sessionStorage.setItem("numap-reveal", slow ? "2" : "1"); } catch { /* veil is a nicety */ }
    this.setState({ leaving: true });
    setTimeout(() => {
      // index.html's hardReturn — the reload() this used to do left
      // people on the same broken page unless they hit ⌘⇧R, so the
      // return unregisters any service worker, empties Cache Storage and
      // re-fetches the shell and entry bundle with cache:'reload' before
      // navigating. It drops the preview params itself.
      if (window.__numapHardReturn) window.__numapHardReturn();
      else if (slow) window.location.href = window.location.pathname;
      else window.location.reload();
    }, slow ? 6000 : 2300);
  };

  componentDidCatch(error, info) {
    console.error("[nu-map] render crash:", error, info?.componentStack);
    this.scheduleGhost();
    this.startProbe();
    try {
      const last = parseInt(sessionStorage.getItem("numap-crash-retry") || "0", 10);
      if (Date.now() - last > 60_000) {
        sessionStorage.setItem("numap-crash-retry", String(Date.now()));
        this.stormReload();
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
          @keyframes numapStorm { from { transform: translate3d(0,0,0) rotate(0deg) } to { transform: translate3d(150vw,42vh,0) rotate(480deg) } }
          @keyframes numapGust { 0% { opacity:.35 } 22% { opacity:.85 } 41% { opacity:.55 } 63% { opacity:1 } 82% { opacity:.6 } 100% { opacity:.35 } }
          @keyframes numapBlowoff { from { transform: translateX(0) } to { transform: translateX(135vw) } }
          @keyframes numapCardDim { 0% { opacity:1 } 22% { opacity:.5 } 38% { opacity:.75 } 58% { opacity:.3 } 72% { opacity:.45 } 100% { opacity:0 } }
          @keyframes numapBackIn { from { opacity: 0 } to { opacity: 1 } }
          .numap-emblem-live:hover { transform: scale(1.05) !important; }
          @media (prefers-reduced-motion: reduce) {
            .numap-crash *, .numap-petals * { animation: none !important }
            .numap-petals { display: none }
          }
        `}</style>
        <Petals leaving={this.state.leaving} slow={this.slowExit} />
        {/* Top-anchored positioner: identical offset to the index.html
            overlay, so the emblem sits at the same viewport spot on both
            recovery pages, in every state. */}
        <div style={{ position: "absolute", top: "calc(50% - 118px)", left: "50%",
          transform: "translateX(-50%)", width: "100%", maxWidth: 468,
          padding: "0 24px", boxSizing: "border-box" }}>
        <div className="numap-crash" style={{
          // In the exit gusts the card flickers dimmer and brighter,
          // then dies away entirely as the storm takes over.
          animation: this.state.leaving
            ? `numapCardDim ${this.slowExit ? "5.5s" : "2.2s"} ease-in-out forwards`
            : "numapCrashIn .35s ease-out",
          position: "relative" }}>
          <Emblem dark={dark} complete={this.state.detected}
            onReturn={this.state.detectedSettled ? this.stormReload : undefined}
            title={BACK[lc] || BACK.en} />
          {/* On detection the bar's job is done — it folds shut, exactly
              like the overlay's. */}
          <div style={{ width: 260, borderRadius: 99, overflow: "hidden",
            margin: "0 auto", background: dark ? "#21262d" : "#e2e8f0",
            height: this.state.detected ? 0 : 4,
            marginBottom: this.state.detected ? 12 : 20,
            opacity: this.state.detected ? 0 : 1,
            transition: "opacity .7s ease, height .7s ease, margin-bottom .7s ease" }}>
            <div style={{ width: "40%", height: "100%", borderRadius: 99,
              background: "#ef4444",
              animation: "numapCrashSweep 1.3s ease-in-out infinite alternate" }} />
          </div>
          <div style={{ position: "relative" }}>
          {/* One line, always — the font yields on narrow screens
              instead of the text wrapping. */}
          <div style={{ fontSize: "min(15px, 3.4vw)", fontWeight: 600, lineHeight: 1.5, whiteSpace: "nowrap",
            ...(this.state.detected ? { transition: "opacity .6s", opacity: 0 } : {}),
            ...(this.state.detectedSettled ? { visibility: "hidden" } : {}) }}>
            {MSG[lc] || MSG.en}
          </div>
          {/* No time promise here — a bug's duration can't honestly be
              estimated. At the 2-minute mark the nudge fades in where a
              sub-line would sit. */}
          {this.state.showLink && !this.state.detected && (
            <div onClick={this.stormReload} style={{
              marginTop: 6, fontSize: "min(12px, 2.9vw)", fontWeight: 500,
              whiteSpace: "nowrap", cursor: "pointer",
              color: dark ? "#8b949e" : "#64748b",
              animation: "numapCrashIn 1.2s ease-out" }}>
              {NUDGE[lc] || NUDGE.en}
            </div>
          )}
          {/* Detection landed: the localized return button arrives in the
              text's footprint, mirroring the overlay. */}
          {this.state.detectedSettled && !this.state.leaving && (
            <button onClick={this.stormReload} style={{
              position: "absolute", inset: 0, margin: "auto",
              width: "fit-content", height: "fit-content",
              fontSize: 16, fontWeight: 500, fontFamily: "inherit",
              cursor: "pointer", padding: "9px 26px", borderRadius: 10,
              background: "transparent", color: "inherit",
              border: `1px solid ${dark ? "#30363d" : "#e2e8f0"}`,
              animation: "numapBackIn 1.6s ease .25s both" }}>
              {BACK[lc] || BACK.en}
            </button>
          )}
          </div>
        </div>
        </div>
        {this.state.leaving && <Storm />}
      </div>
    );
  }
}
