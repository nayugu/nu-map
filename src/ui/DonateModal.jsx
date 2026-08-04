// ═══════════════════════════════════════════════════════════════════
// DONATE MODAL — QR-first, so the payment happens on a phone
//
// The QR is the primary control, not decoration. Students use the planner on a
// laptop, where paying means typing a card number; handing the checkout to a
// phone turns that into a wallet prompt and a Face ID tap. Everything else on
// the surface is secondary to getting them to scan.
//
// Only ever opened deliberately (the header ♥ pill). It never auto-opens, and
// there is no dismissal memory to nag against.
// ═══════════════════════════════════════════════════════════════════
import { usePlanner }   from "../context/PlannerContext.jsx";
import { useLanguage }  from "../context/LanguageContext.jsx";
import { scaleLatinRuns } from "../context/TranslationContext.jsx";
import { DONATE_URL, donateUrlFor } from "../core/donate.js";
// Bundled (not public/) so it ships hashed under /assets/ — cache-busted,
// and immune to zone rules that treat unlisted root paths differently.
import donateQrUrl from "../assets/donate-qr.svg";

export default function DonateModal() {
  const { showDonate, setShowDonate } = usePlanner();
  const { t, locale } = useLanguage();

  if (!showDonate || !DONATE_URL) return null;

  // The tapped link carries the active locale; the QR can't, since it is baked
  // at build time. That costs nothing — Stripe sniffs the scanning phone's own
  // language, which is the better signal for a QR anyway.
  const payUrl = donateUrlFor(locale);

  return (
    <div
      onClick={() => setShowDonate(false)}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.75)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 14,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--bg-surface)", border: "1px solid var(--border-2)",
          borderRadius: 12, maxWidth: 360, width: "100%",
          maxHeight: "85vh", overflow: "hidden",
          display: "flex", flexDirection: "column",
          boxShadow: "var(--shadow-modal)",
          color: "var(--text-2)", fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        <div style={{ overflowY: "auto", minHeight: 0, padding: "16px 14px 14px" }}>
          {/* Title */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text-1)" }}>
              <span style={{ color: "var(--error)", marginRight: 6 }} aria-hidden="true">♥</span>
              {scaleLatinRuns(t("donate.title"))}
            </div>
            <div style={{ fontSize: 15, color: "var(--text-4)", marginTop: 5 }}>
              {scaleLatinRuns(t("donate.subtitle"))}
            </div>
          </div>

          {/* QR plaque — always white with black modules, in every theme.
              Contrast is what makes it scan on the first try; matching the
              surrounding surface would look better and work worse. */}
          <a
            href={payUrl}
            target="_blank" rel="noopener noreferrer"
            style={{
              display: "block", background: "#ffffff", borderRadius: 10,
              // Padding carries the whole size relationship: the plaque is
              // block-level so it always fills the modal's content width, and
              // the QR is width:100% inside it. Raising the padding shrinks the
              // code without changing the frame at all.
              padding: 28, marginBottom: 10, border: "1px solid var(--border-2)",
            }}
          >
            <img
              src={donateQrUrl}
              alt={t("donate.qr.hint")}
              style={{ display: "block", width: "100%", height: "auto", imageRendering: "pixelated" }}
            />
          </a>

          {/* Same destination as the QR — so anyone already reading this on a
              phone taps through instead of scanning their own screen. The only
              action on the surface: no second rail to choose between. */}
          <a
            href={payUrl}
            target="_blank" rel="noopener noreferrer"
            style={{
              display: "block", textAlign: "center", boxSizing: "border-box",
              padding: "9px 16px", borderRadius: 7, marginBottom: 12,
              background: "var(--link-bg)", border: "1px solid var(--link-1)",
              color: "var(--link-1)", fontSize: 12, fontWeight: 700, textDecoration: "none",
            }}
          >
            {scaleLatinRuns(t("donate.fast"))} ↗
          </a>

          {/* No "what this covers" blurb — the Stripe page itself carries that
              line, so repeating it here just delayed the scan. */}
          {/* No affiliation / tax notice here on purpose — the About modal
              already carries both in its disclaimer list, and repeating them
              at the point of payment only adds friction. */}
          <button
            onClick={() => setShowDonate(false)}
            style={{
              width: "100%", fontSize: 11, fontWeight: 600, padding: "7px 16px", borderRadius: 6,
              background: "transparent", border: "1px solid var(--border-2)",
              color: "var(--text-3)", cursor: "pointer",
            }}
          >{t("donate.close")}</button>
        </div>
      </div>
    </div>
  );
}
