// ═══════════════════════════════════════════════════════════════════
// FEATURE TOUR  (image + caption walkthrough of the top features)
//
// A short, dismissible carousel: screenshot/clip on top, localized caption
// below, back/next. Ends on a celebratory screen with a "Start planning"
// call to action. Auto-runs once right after first-run setup (gated by a
// "seen-tour" flag) and can be replayed anytime from the About dialog.
//
// Assets live in public/tour/ (language-neutral media; captions are the
// only localized part). A step may be a .mp4 (muted autoplay loop) or a
// static screenshot.
// ═══════════════════════════════════════════════════════════════════
import { useState, useEffect, useRef } from "react";
import { usePlanner }    from "../context/PlannerContext.jsx";
import { usePort }       from "../context/InstitutionContext.jsx";
import { IInstitution }  from "../ports/IInstitution.js";
import { useLanguage }   from "../context/LanguageContext.jsx";
import { fireConfetti }  from "./confetti.js";

const BASE = import.meta.env.BASE_URL;
const STEPS = [
  { img: "01-requirements.mp4", t: "tour.step.1" },
  { img: "02-search.mp4",       t: "tour.step.2" },
  { img: "03-coop.mp4",         t: "tour.step.3" },
  { img: "04-prereqs.png",      t: "tour.step.4" },
  { img: "05-class.png",        t: "tour.step.5" },
  { img: "06-plans.mp4",        t: "tour.step.6" },
  { img: "07-language.mp4",     t: "tour.step.7" },
];
const DONE = STEPS.length; // step index of the celebratory completion screen
const HOLD_MS = 1200;      // pause on the last frame before a video loops (clips are 6–12s)

export default function FeatureTour() {
  const { showTour, setShowTour, setShowDisclaimer } = usePlanner();
  const institution = usePort(IInstitution);
  const { t, locales } = useLanguage();
  const [step, setStep] = useState(0);
  const cardRef  = useRef(null);
  const holdRef  = useRef(null);  // pending video loop-hold timer

  // Reset, move focus in, and warm the image cache whenever it opens.
  useEffect(() => {
    if (!showTour) return;
    setStep(0);
    requestAnimationFrame(() => cardRef.current?.focus());
    STEPS.forEach(s => { if (!s.img.endsWith(".mp4")) { const im = new Image(); im.src = `${BASE}tour/${s.img}`; } });
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTour]);

  // Clear any pending video loop-hold timer when the step changes or on unmount.
  useEffect(() => () => { if (holdRef.current) clearTimeout(holdRef.current); }, [step]);

  if (!showTour) return null;

  const close = () => {
    try { localStorage.setItem(`${institution.storagePrefix}-seen-tour`, "1"); } catch {}
    setStep(0);           // reset so a replay never reopens on the completion screen
    setShowTour(false);
  };
  const openAbout = () => { close(); setShowDisclaimer(true); };

  const isDone = step === DONE;
  const cur    = STEPS[step];
  const last   = step === STEPS.length - 1;

  const navBtn = {
    fontSize: 15, fontWeight: 700, padding: "10px 24px", borderRadius: 9, cursor: "pointer",
    background: "var(--link-bg)", border: "1px solid var(--link-1)", color: "var(--link-1)",
  };

  return (
    <div
      onClick={close}
      style={{
        position: "fixed", inset: 0, zIndex: 210,
        background: "rgba(0,0,0,0.65)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--bg-surface)", border: "1px solid var(--border-2)",
          borderRadius: 16, maxWidth: 860, width: "100%",
          padding: 22, boxShadow: "var(--shadow-modal)",
          color: "var(--text-2)", fontFamily: "'Inter', system-ui, sans-serif",
          outline: "none",
        }}
      >
        {isDone ? (
          /* ── Completion screen ── */
          <div style={{ textAlign: "center", padding: "24px 12px 12px" }}>
            <div style={{
              width: 72, height: 72, borderRadius: "50%", margin: "0 auto 16px",
              background: "var(--success-bg, rgba(46,125,50,0.12))",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 38,
            }}>🎓</div>
            <div id="tour-title" style={{ fontSize: 27, fontWeight: 800, color: "var(--text-1)", marginBottom: 8 }}>
              {t("tour.wrap.title")}
            </div>
            <div style={{
              fontSize: 17, color: "var(--text-3)", maxWidth: 480, margin: "0 auto 24px",
              lineHeight: "calc(1.6 * var(--lh-scale, 1))",
              fontFamily: "'InterTight', 'Inter', system-ui, sans-serif", letterSpacing: "0.01em",
            }}>
              {t("tour.wrap.body")}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <button onClick={close} style={{ ...navBtn, fontSize: 16, padding: "12px 30px" }}>
                {t("tour.wrap.start")}
              </button>
              <button onClick={openAbout} style={{
                fontSize: 15, fontWeight: 600, padding: "12px 26px", borderRadius: 9, cursor: "pointer",
                background: "transparent", border: "1px solid var(--border-2)", color: "var(--text-3)",
              }}>{t("tour.wrap.about")}</button>
            </div>
          </div>
        ) : (
          <>
            {/* Media — fixed-height frame so the box never resizes between steps */}
            <div style={{
              height: 460, borderRadius: 10, overflow: "hidden",
              background: "var(--bg-app)", border: "1px solid var(--border-1)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {cur.img.endsWith(".mp4") ? (
                <video key={cur.img} src={`${BASE}tour/${cur.img}`} autoPlay muted playsInline
                  aria-label={t(`${cur.t}.title`)}
                  onEnded={e => {
                    // Custom loop: hold on the final frame briefly, then restart.
                    const v = e.currentTarget;
                    holdRef.current = window.setTimeout(() => { if (v.isConnected) { v.currentTime = 0; v.play().catch(() => {}); } }, HOLD_MS);
                  }}
                  style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              ) : (
                <img src={`${BASE}tour/${cur.img}`} alt={t(`${cur.t}.title`)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              )}
            </div>

            {/* Caption */}
            <div style={{ padding: "16px 6px 6px" }}>
              <div id="tour-title" style={{ fontSize: 22, fontWeight: 800, color: "var(--text-1)", marginBottom: 7 }}>
                {t(`${cur.t}.title`)}
              </div>
              {/* `n` = live locale count, so the language step never claims a
                  stale number when a locale file is added or removed. */}
              <div style={{
                fontSize: 17, color: "var(--text-3)", minHeight: 52,
                lineHeight: "calc(1.6 * var(--lh-scale, 1))",
                fontFamily: "'InterTight', 'Inter', system-ui, sans-serif", letterSpacing: "0.01em",
              }}>
                {t(`${cur.t}.body`, { n: locales.length })}
              </div>
            </div>

            {/* Dots + nav */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
              <div style={{ display: "flex", gap: 8, flex: 1 }}>
                {STEPS.map((_, i) => (
                  <button key={i} onClick={() => setStep(i)} aria-label={t("tour.step.aria", { n: i + 1 })} style={{
                    width: 9, height: 9, borderRadius: "50%", padding: 0, cursor: "pointer",
                    border: "none", background: i === step ? "var(--link-1)" : "var(--border-2)",
                  }} />
                ))}
              </div>
              {/* Skip reads bold on step 1 only — that's where a returning user
                  is most likely looking for the way out; it recedes after. */}
              <button onClick={close} style={{
                background: "transparent", border: "1px solid var(--border-2)",
                color: "var(--text-3)", fontSize: 15, fontWeight: step === 0 ? 700 : 500,
                padding: "10px 24px", borderRadius: 9, cursor: "pointer",
              }}>{t("onboard.skip")}</button>
              {step > 0 && (
                <button onClick={() => setStep(step - 1)} style={{
                  fontSize: 15, fontWeight: 600, padding: "10px 20px", borderRadius: 9, cursor: "pointer",
                  background: "transparent", border: "1px solid var(--border-2)", color: "var(--text-3)",
                }}>{t("onboard.back")}</button>
              )}
              <button
                onClick={() => {
                  setStep(step + 1);
                  // Reaching the completion screen (last → Done) is the only
                  // path to DONE, so fire the confetti here — deterministic,
                  // never on open/replay.
                  if (last) requestAnimationFrame(() => fireConfetti(cardRef.current));
                }}
                style={navBtn}
              >
                {last ? t("tour.done") : t("onboard.next")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
