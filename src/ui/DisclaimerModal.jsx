// ═══════════════════════════════════════════════════════════════════
// DISCLAIMER / ABOUT MODAL
// ═══════════════════════════════════════════════════════════════════
import { usePlanner }       from "../context/PlannerContext.jsx";
import { usePort, useInstitution } from "../context/InstitutionContext.jsx";
import { IInstitution }     from "../ports/IInstitution.js";
import { ILocalization }    from "../ports/ILocalization.js";
import { useLanguage }      from "../context/LanguageContext.jsx";
import { TText }            from "../context/TranslationContext.jsx";

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

  const adapter      = useInstitution();
  const disclaimers  = localization.getDisclaimers();
  const sources      = adapter.getAllSources();

  // Creators — Nathan (left), Matthew (right). Drop photos at public/creator-<name>.jpg
  // to replace the initials fallback. Names/tagline stay untranslated (proper nouns).
  // Tagline is hard-capped at 20 chars (LinkedIn headlines run long).
  const TAGLINE_MAX = 20;
  const cap = s => (s.length > TAGLINE_MAX ? s.slice(0, TAGLINE_MAX - 1).trimEnd() + "…" : s);
  const creators = [
    { name: "Nathan",  role: "Creator",     tagline: "CS + Math (HMS)",    initial: "N", img: `${import.meta.env.BASE_URL}creator-nathan.jpg`,  url: "https://www.linkedin.com/in/nayugu/" },
    { name: "Matthew", role: "Contributor", tagline: "CS + IE (Robotics)", initial: "M", img: `${import.meta.env.BASE_URL}creator-matthew.jpg`, url: "https://www.linkedin.com/in/iammg/" },
  ];

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
          maxHeight: "80vh", overflow: "hidden",
          display: "flex", flexDirection: "column",
          boxShadow: "var(--shadow-modal)",
          color: "var(--text-2)", fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        {/* Inner scroll area — inset from the rounded corners (outer is
            overflow:hidden) so the scrollbar never pokes past the rounding. */}
        <div style={{ overflowY: "auto", minHeight: 0, padding: "16px 14px 14px" }}>
        {/* Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text-1)" }}>{institution.appName}</div>
            <div style={{ fontSize: 10, color: "var(--text-3)" }}><TText>{t("modal.subtitle")}</TText></div>
          </div>
        </div>

        {/* Data sources — aggregated from all ports via wire().getAllSources() */}
        {sources.length > 0 && (
          <div style={{
            background: "var(--badge-bg)", border: "1px solid var(--border-1)",
            borderRadius: 8, padding: "10px 12px", marginBottom: 10,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--link-1)", marginBottom: 7, letterSpacing: "0.04em" }}>
              <TText>DATA SOURCES</TText>
            </div>
            {sources.map((src, i) => (
              <div key={src.id} style={{
                display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8,
                marginBottom: i < sources.length - 1 ? 7 : 0,
              }}>
                <div style={{ minWidth: 0 }}>
                  <a href={src.url} target="_blank" rel="noreferrer"
                    style={{ fontSize: 11, fontWeight: 700, color: "var(--link-1)", textDecoration: "none" }}>
                    {src.label}
                  </a>
                  {src.author && (
                    <span style={{ fontSize: 10, color: "var(--text-4)", marginLeft: 5 }}><TText>{`by @${src.author}`}</TText></span>
                  )}
                  <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 1, lineHeight: "calc(1.4 * var(--lh-scale, 1))" }}>
                    <TText>{`used for ${src.usedFor.join(", ")}`}</TText>
                  </div>
                </div>
                <a href={src.url} target="_blank" rel="noreferrer"
                  style={{ fontSize: 10, color: "var(--link-1)", background: "var(--link-bg)", border: "1px solid var(--link-border)", borderRadius: 4, padding: "2px 8px", textDecoration: "none", flexShrink: 0 }}>
                  ↗
                </a>
              </div>
            ))}
          </div>
        )}

        {/* Disclaimers */}
        <div style={{
          background: "var(--error-bg-2)", border: "1px solid var(--error-border-2)",
          borderRadius: 8, padding: "10px 12px", marginBottom: 10,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--error)", marginBottom: 6, letterSpacing: "0.04em" }}>
            ⚠ <TText>DISCLAIMERS</TText>
          </div>
          {disclaimers.map((text, i) => (
            <div key={i} style={{
              display: "flex", gap: 7, marginBottom: i < disclaimers.length - 1 ? 5 : 0,
              fontSize: 10, color: "var(--error-text)", lineHeight: "calc(1.5 * var(--lh-scale, 1))",
            }}>
              <span style={{ flexShrink: 0, marginTop: 1 }}>•</span>
              <span><TText>{text}</TText></span>
            </div>
          ))}
        </div>

        {/* GitHub + privacy policy links */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {[["https://github.com/nayugu/nu-map", "/github"], [`${import.meta.env.BASE_URL}privacy.html`, "/privacy"]].map(([href, label]) => (
            <a
              key={label}
              href={href}
              target="_blank" rel="noreferrer"
              style={{
                display: "block", flex: 1, textAlign: "center", boxSizing: "border-box",
                padding: "7px 0", borderRadius: 7,
                background: "var(--bg-surface-2)", border: "1px solid var(--border-2)",
                fontSize: 11, fontWeight: 400, color: "var(--text-3)", textDecoration: "none",
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                letterSpacing: "0.02em",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--text-4)"; e.currentTarget.style.color = "var(--text-2)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-2)"; e.currentTarget.style.color = "var(--text-3)"; }}
            >
              {label}
            </a>
          ))}
        </div>

        {/* Made by — creators + LinkedIn */}
        <div style={{
          background: "var(--badge-bg)", border: "1px solid var(--border-1)",
          borderRadius: 8, padding: "10px 12px", marginBottom: 12,
        }}>
          <div style={{ display: "flex", gap: 8 }}>
            {creators.map(c => (
              <div key={c.name} style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--link-1)", marginBottom: 6, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                  <TText>{c.role}</TText>
                </div>
                <a
                  href={c.url}
                  target="_blank" rel="noreferrer"
                  title={`${c.name} on LinkedIn`}
                  style={{
                    display: "flex", alignItems: "center", gap: 9, boxSizing: "border-box",
                    padding: "8px 10px", borderRadius: 8,
                    background: "var(--bg-surface-2)", border: "1px solid var(--border-2)",
                    textDecoration: "none",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#0A66C2"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-2)"; }}
                >
                {/* Avatar (photo, initials fallback) + LinkedIn badge */}
                <div style={{ position: "relative", width: 34, height: 34, flexShrink: 0 }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: "50%",
                    background: "var(--link-bg)", color: "var(--link-1)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 15, fontWeight: 800,
                  }}>{c.initial}</div>
                  <img
                    src={c.img} alt=""
                    onError={e => { e.currentTarget.style.display = "none"; }}
                    style={{ position: "absolute", inset: 0, width: 34, height: 34, borderRadius: "50%", objectFit: "cover" }}
                  />
                  <span style={{
                    position: "absolute", right: -3, bottom: -3, width: 15, height: 15,
                    borderRadius: 4, background: "#fff", overflow: "hidden",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 0 0 1.5px var(--bg-surface-2)",
                  }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="#0A66C2" aria-hidden="true">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"/>
                    </svg>
                  </span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                  <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={c.tagline}>{cap(c.tagline)}</div>
                </div>
                </a>
              </div>
            ))}
          </div>
        </div>

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
          <span style={{ fontSize: 10, color: "var(--text-6)" }}>
            Built with{" "}
            <a href="https://www.anthropic.com/claude" target="_blank" rel="noreferrer"
              style={{ color: "var(--text-5)", textDecoration: "none" }}>
              Claude
            </a>
          </span>
        </div>
        </div>
      </div>
    </div>
  );
}
