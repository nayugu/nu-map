// ═══════════════════════════════════════════════════════════════════
// RATING CONSENT — asked once, before anything is ever sent.
//
// ── Why an explicit ask rather than a default ──────────────────────
// Everything else NU Map sends is addressed: a share code goes to one
// browser you named, a Claude sync goes to a connector you linked.
// A rating is different in kind — it joins a pool, permanently, for
// strangers. That is a real change to "your plan lives in your browser",
// and the honest way to make it is to ask, not to default.
//
// It is also the difference between data being COLLECTED and being
// VOLUNTEERED, which is the distinction any privacy question turns on.
//
// ── Why it lists specifics instead of reassurance ──────────────────
// "We care about your privacy" is unfalsifiable and everyone has learnt
// to skip it. Every line below is a property of code in this repo that a
// reader could check, and the two that matter most — grades never being
// sent, and separate ratings never being linkable — are the two a
// reasonable person would actually worry about.
//
// Declining is a real option: it costs nothing. Grades, the planner and
// your own saved ratings all keep working; only the pooling stops.
// ═══════════════════════════════════════════════════════════════════
import { createPortal } from "react-dom";
import { usePlanner } from "../context/PlannerContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";

/**
 * @param {Object} props
 * @param {() => void} [props.onDecided] fired after either choice, so a
 *   caller that opened this to unblock a submission can continue.
 */
export default function RatingConsentSheet({ onDecided }) {
  const { t } = useLanguage();
  const { ratingConsent, setRatingConsent } = usePlanner();

  // Asked exactly once. A decline is a decision, not a deferral — it is
  // respected until the person changes it in settings, and this sheet
  // never reappears on its own.
  if (ratingConsent !== "unasked") return null;

  const choose = (v) => { setRatingConsent(v); onDecided?.(); };

  const point = (text) => (
    <li style={{ margin: "6px 0", lineHeight: 1.5 }}>{text}</li>
  );

  return createPortal(
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 8600,
                    background: "var(--overlay, rgba(0,0,0,0.5))" }} />
      <div role="dialog" aria-modal="true" aria-label={t("consent.title")}
           style={{
             position: "fixed", zIndex: 8601,
             left: "50%", top: "50%", transform: "translate(-50%, -50%)",
             width: "min(430px, calc(100vw - 32px))",
             maxHeight: "calc(100vh - 64px)", overflowY: "auto",
             background: "var(--bg-surface)",
             border: "1px solid var(--border-card)", borderRadius: 11,
             boxShadow: "var(--shadow-modal)", padding: "18px 20px 16px",
             fontFamily: "'Inter', system-ui, sans-serif",
           }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>
          {t("consent.title")}
        </div>
        <div style={{ fontSize: 11, lineHeight: 1.6, color: "var(--text-3)",
                      marginTop: 8 }}>
          {t("consent.intro")}
        </div>

        <ul style={{ fontSize: 10.5, color: "var(--text-3)",
                     margin: "12px 0 0", paddingInlineStart: 16 }}>
          {point(t("consent.point.grades"))}
          {point(t("consent.point.anon"))}
          {point(t("consent.point.unlinked"))}
          {point(t("consent.point.aggregate"))}
          {point(t("consent.point.stop"))}
        </ul>

        <div style={{ fontSize: 10, color: "var(--text-5)", marginTop: 12,
                      lineHeight: 1.5 }}>
          {t("consent.verify")}{" "}
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer"
             style={{ color: "var(--active)" }}>
            {t("consent.policy")}
          </a>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8,
                      marginTop: 16 }}>
          {/* Decline reads as an equal choice, not a greyed-out escape —
              a sheet whose "no" is hard to find is not really asking. */}
          <button onClick={() => choose("off")}
                  style={btn(false)}>{t("consent.decline")}</button>
          <button onClick={() => choose("on")}
                  style={btn(true)}>{t("consent.accept")}</button>
        </div>
      </div>
    </>,
    document.body,
  );
}

const btn = (primary) => ({
  fontSize: 11, fontWeight: 700, padding: "7px 15px", borderRadius: 6,
  cursor: "pointer", fontFamily: "inherit",
  border: `1px solid ${primary ? "var(--active)" : "var(--border-2)"}`,
  background: primary ? "var(--active)" : "transparent",
  color: primary ? "var(--on-active, #fff)" : "var(--text-3)",
});
