// ═══════════════════════════════════════════════════════════════════
// DISCLAIMER / ABOUT MODAL
// ═══════════════════════════════════════════════════════════════════
import { usePlanner }     from "../context/PlannerContext.jsx";
import { usePort }        from "../context/InstitutionContext.jsx";
import { IInstitution }   from "../ports/IInstitution.js";
import { ILocalization }  from "../ports/ILocalization.js";
import { useLanguage }    from "../context/LanguageContext.jsx";

export default function DisclaimerModal() {
  const { showDisclaimer, setShowDisclaimer } = usePlanner();
  const institution  = usePort(IInstitution);
  const localization = usePort(ILocalization);
  const { t }        = useLanguage();

  const dismiss = () => {
    setShowDisclaimer(false);
    try { localStorage.setItem(`${institution.storagePrefix}-seen-disclaimer`, "1"); } catch {}
  };

  if (!showDisclaimer) return null;

  const disclaimers = localization.getDisclaimers();

  return (
    <div
      onClick={dismiss}
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
          borderRadius: 12, maxWidth: 440, width: "100%",
          maxHeight: "80vh", overflowY: "auto",
          padding: "16px 14px 14px", boxShadow: "var(--shadow-modal)",
          color: "var(--text-2)", fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        {/* Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text-1)" }}>{institution.appName}</div>
            <div style={{ fontSize: 10, color: "var(--text-3)" }}>{t("modal.subtitle")}</div>
          </div>
        </div>

        {/* Attribution */}
        <div style={{
          background: "var(--badge-bg)", border: "1px solid var(--border-1)",
          borderRadius: 8, padding: "10px 12px", marginBottom: 10,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--link-1)", marginBottom: 5, letterSpacing: "0.04em" }}>
            DATA SOURCE
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.5, color: "var(--text-2)" }}>
            Course catalog data is sourced from{" "}
            <a href="https://github.com/ninest/nu-courses" target="_blank" rel="noreferrer"
              style={{ color: "var(--link-1)", textDecoration: "none", fontWeight: 700 }}>
              ninest/nu-courses
            </a>{" "}— built and maintained by{" "}
            <a href="https://github.com/ninest" target="_blank" rel="noreferrer"
              style={{ color: "var(--link-2)", textDecoration: "none", fontWeight: 700 }}>
              @ninest
            </a>.
            Data is scraped from Northeastern's Banner registration system.
          </div>
          <div style={{ marginTop: 7, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <a href="https://github.com/ninest/nu-courses" target="_blank" rel="noreferrer"
              style={{ fontSize: 10, color: "var(--link-1)", background: "var(--link-bg)", border: "1px solid var(--link-border)", borderRadius: 4, padding: "2px 8px", textDecoration: "none" }}>
              github.com/ninest/nu-courses ↗
            </a>
            <a href="https://husker.vercel.app" target="_blank" rel="noreferrer"
              style={{ fontSize: 10, color: "var(--text-3)", background: "var(--bg-surface-2)", border: "1px solid var(--border-2)", borderRadius: 4, padding: "2px 8px", textDecoration: "none" }}>
              husker.vercel.app ↗
            </a>
          </div>
        </div>

        {/* Requirements engine attribution */}
        <div style={{
          background: "var(--badge-bg)", border: "1px solid var(--border-1)",
          borderRadius: 8, padding: "10px 12px", marginBottom: 10,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--link-1)", marginBottom: 5, letterSpacing: "0.04em" }}>
            GRADUATION REQUIREMENTS
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.5, color: "var(--text-2)" }}>
            Graduation requirement data and validation logic is derived from{" "}
            <a href="https://github.com/sandboxnu/graduatenu" target="_blank" rel="noreferrer"
              style={{ color: "var(--link-1)", textDecoration: "none", fontWeight: 700 }}>
              sandboxnu/graduatenu
            </a>{" "}— built by{" "}
            <a href="https://github.com/denniwang" target="_blank" rel="noreferrer"
              style={{ color: "var(--link-2)", textDecoration: "none", fontWeight: 700 }}>
              @denniwang
            </a>{" "}and{" "}
            <a href="https://github.com/sandboxnu" target="_blank" rel="noreferrer"
              style={{ color: "var(--link-2)", textDecoration: "none", fontWeight: 700 }}>
              Sandbox
            </a>.
          </div>
          <div style={{ marginTop: 7, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <a href="https://github.com/sandboxnu/graduatenu" target="_blank" rel="noreferrer"
              style={{ fontSize: 10, color: "var(--link-1)", background: "var(--link-bg)", border: "1px solid var(--link-border)", borderRadius: 4, padding: "2px 8px", textDecoration: "none" }}>
              github.com/sandboxnu/graduatenu ↗
            </a>
            <a href="https://github.com/denniwang" target="_blank" rel="noreferrer"
              style={{ fontSize: 10, color: "var(--text-3)", background: "var(--bg-surface-2)", border: "1px solid var(--border-2)", borderRadius: 4, padding: "2px 8px", textDecoration: "none" }}>
              @denniwang ↗
            </a>
            <a href="https://github.com/sandboxnu" target="_blank" rel="noreferrer"
              style={{ fontSize: 10, color: "var(--text-3)", background: "var(--bg-surface-2)", border: "1px solid var(--border-2)", borderRadius: 4, padding: "2px 8px", textDecoration: "none" }}>
              Sandbox ↗
            </a>
          </div>
        </div>

        {/* Disclaimers */}
        <div style={{
          background: "var(--error-bg-2)", border: "1px solid var(--error-border-2)",
          borderRadius: 8, padding: "10px 12px", marginBottom: 10,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--error)", marginBottom: 6, letterSpacing: "0.04em" }}>
            ⚠ DISCLAIMERS
          </div>
          {disclaimers.map((text, i) => (
            <div key={i} style={{
              display: "flex", gap: 7, marginBottom: i < disclaimers.length - 1 ? 5 : 0,
              fontSize: 10, color: "var(--error-text)", lineHeight: 1.5,
            }}>
              <span style={{ flexShrink: 0, marginTop: 1 }}>•</span>
              <span>{text}</span>
            </div>
          ))}
        </div>

        {/* Documentation link */}
        <a
          href={`${import.meta.env.BASE_URL}documentation/`}
          target="_blank" rel="noreferrer"
          style={{
            display: "block", width: "100%", textAlign: "center", boxSizing: "border-box",
            padding: "7px 0", marginBottom: 12, borderRadius: 7,
            background: "var(--bg-surface-2)", border: "1px solid var(--border-2)",
            fontSize: 11, fontWeight: 400, color: "var(--text-3)", textDecoration: "none",
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
            letterSpacing: "0.02em",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--text-4)"; e.currentTarget.style.color = "var(--text-2)"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-2)"; e.currentTarget.style.color = "var(--text-3)"; }}
        >
          /documentation
        </a>

        {/* Footer */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <button
            onClick={dismiss}
            style={{
              width: "100%", fontSize: 11, fontWeight: 700, padding: "7px 16px", borderRadius: 6,
              background: "var(--link-bg)", border: "1px solid var(--link-1)",
              color: "var(--link-1)", cursor: "pointer",
            }}
          >{t("modal.dismiss")}</button>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <span style={{ fontSize: 10, color: "var(--text-6)" }}>{t("modal.hint")}</span>
            <span style={{ fontSize: 10, color: "var(--text-6)" }}>
              Built with{" "}
              <a href="https://www.anthropic.com/claude" target="_blank" rel="noreferrer"
                style={{ color: "var(--text-5)", textDecoration: "none" }}>
                Claude Sonnet
              </a>
              {" (Anthropic)"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
