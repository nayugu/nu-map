// ═══════════════════════════════════════════════════════════════════
// DISCLAIMER / ABOUT MODAL
// ═══════════════════════════════════════════════════════════════════
import { usePlanner } from "../context/PlannerContext.jsx";

export default function DisclaimerModal() {
  const { showDisclaimer, setShowDisclaimer } = usePlanner();

  const dismiss = () => {
    setShowDisclaimer(false);
    try { localStorage.setItem("ncp-seen-disclaimer", "1"); } catch {}
  };

  if (!showDisclaimer) return null;

  const disclaimers = [
    "This is NOT an official Northeastern University tool and is not affiliated with or endorsed by Northeastern.",
    "This does NOT replace your official degree audit. Always verify your plan with your academic advisor and through MyNEU / DegreeWorks.",
    "Course availability, prerequisites, credit hours, and NUpath designations may be outdated or incorrect. Always confirm with the official course catalog.",
    "Your saved plan lives in your browser's localStorage only. Clearing browser data will erase it.",
    "Use at your own risk.",
  ];

  return (
    <div
      onClick={dismiss}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.75)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--bg-surface)", border: "1px solid var(--border-2)",
          borderRadius: 12, maxWidth: 520, width: "100%",
          maxHeight: "88vh", overflowY: "auto",
          padding: "20px 16px 16px", boxShadow: "var(--shadow-modal)",
          color: "var(--text-2)", fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        {/* Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-1)" }}>NU Map</div>
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>Unofficial student planning tool</div>
          </div>
        </div>

        {/* Attribution */}
        <div style={{
          background: "var(--badge-bg)", border: "1px solid var(--border-1)",
          borderRadius: 8, padding: "12px 14px", marginBottom: 14,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--link-1)", marginBottom: 6, letterSpacing: "0.04em" }}>
            DATA SOURCE
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.6, color: "var(--text-2)" }}>
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
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a href="https://github.com/ninest/nu-courses" target="_blank" rel="noreferrer"
              style={{ fontSize: 10, color: "var(--link-1)", background: "var(--link-bg)", border: "1px solid var(--link-border)", borderRadius: 4, padding: "3px 9px", textDecoration: "none" }}>
              github.com/ninest/nu-courses ↗
            </a>
            <a href="https://husker.vercel.app" target="_blank" rel="noreferrer"
              style={{ fontSize: 10, color: "var(--text-3)", background: "var(--bg-surface-2)", border: "1px solid var(--border-2)", borderRadius: 4, padding: "3px 9px", textDecoration: "none" }}>
              husker.vercel.app ↗
            </a>
          </div>
        </div>

        {/* Requirements engine attribution */}
        <div style={{
          background: "var(--badge-bg)", border: "1px solid var(--border-1)",
          borderRadius: 8, padding: "12px 14px", marginBottom: 14,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--link-1)", marginBottom: 6, letterSpacing: "0.04em" }}>
            GRADUATION REQUIREMENTS
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.6, color: "var(--text-2)" }}>
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
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a href="https://github.com/sandboxnu/graduatenu" target="_blank" rel="noreferrer"
              style={{ fontSize: 10, color: "var(--link-1)", background: "var(--link-bg)", border: "1px solid var(--link-border)", borderRadius: 4, padding: "3px 9px", textDecoration: "none" }}>
              github.com/sandboxnu/graduatenu ↗
            </a>
            <a href="https://github.com/denniwang" target="_blank" rel="noreferrer"
              style={{ fontSize: 10, color: "var(--text-3)", background: "var(--bg-surface-2)", border: "1px solid var(--border-2)", borderRadius: 4, padding: "3px 9px", textDecoration: "none" }}>
              @denniwang ↗
            </a>
            <a href="https://github.com/sandboxnu" target="_blank" rel="noreferrer"
              style={{ fontSize: 10, color: "var(--text-3)", background: "var(--bg-surface-2)", border: "1px solid var(--border-2)", borderRadius: 4, padding: "3px 9px", textDecoration: "none" }}>
              Sandbox ↗
            </a>
          </div>
        </div>

        {/* Disclaimers */}
        <div style={{
          background: "var(--error-bg-2)", border: "1px solid var(--error-border-2)",
          borderRadius: 8, padding: "12px 14px", marginBottom: 18,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--error)", marginBottom: 8, letterSpacing: "0.04em" }}>
            ⚠ DISCLAIMERS
          </div>
          {disclaimers.map((text, i) => (
            <div key={i} style={{
              display: "flex", gap: 8, marginBottom: i < disclaimers.length - 1 ? 7 : 0,
              fontSize: 11, color: "var(--error-text)", lineHeight: 1.5,
            }}>
              <span style={{ flexShrink: 0, marginTop: 1 }}>•</span>
              <span>{text}</span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 10, color: "var(--text-6)" }}>Click outside or dismiss to continue.</span>
            <span style={{ fontSize: 10, color: "var(--text-6)" }}>
              Built with{" "}
              <a href="https://www.anthropic.com/claude" target="_blank" rel="noreferrer"
                style={{ color: "var(--text-5)", textDecoration: "none" }}>
                Claude Sonnet
              </a>
              {" (Anthropic)"}
            </span>
          </div>
          <button
            onClick={dismiss}
            style={{
              fontSize: 11, fontWeight: 700, padding: "6px 20px", borderRadius: 6,
              background: "var(--link-bg)", border: "1px solid var(--link-1)",
              color: "var(--link-1)", cursor: "pointer",
            }}
          >I understand — let me plan!</button>
        </div>
      </div>
    </div>
  );
}
