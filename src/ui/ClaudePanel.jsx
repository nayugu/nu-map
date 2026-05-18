// ═══════════════════════════════════════════════════════════════════
// CLAUDE PANEL  — header button + dropdown for Claude AI integration
//
// STATUS: Built but not rendered — commented out in Header.jsx until
// the MCP server is deployed and wired in src/config.js.
//
// Shows a "◆ Claude" button in the header.  On click:
//   • If connected (SSE live): shows a green "Connected" badge + URL.
//   • If not connected: shows three-step setup instructions with a
//     copy-able MCP URL the user pastes into claude.ai settings.
// ═══════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { usePort } from "../context/InstitutionContext.jsx";
import { IAIAssistant } from "../ports/IAIAssistant.js";

export default function ClaudePanel({ isMobile }) {
  const aiAssistant = usePort(IAIAssistant);
  const [open, setOpen]       = useState(false);
  const [copied, setCopied]   = useState(false);
  const [connected, setConnected] = useState(false);

  // Poll connection status every 2 s while panel is mounted.
  useEffect(() => {
    const tick = () => setConnected(!!aiAssistant?.isAvailable?.());
    tick();
    const id = setInterval(tick, 2_000);
    return () => clearInterval(id);
  }, [aiAssistant]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  if (!aiAssistant?.getMCPUrl) return null;

  const url = aiAssistant.getMCPUrl();

  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {}
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        className="hdr-btn"
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        title="Connect Claude AI to your plan"
        style={{
          fontSize: isMobile ? 8 : 10, cursor: "pointer", whiteSpace: "nowrap",
          color:      open ? "var(--text-2)" : connected ? "var(--active)" : "var(--text-4)",
          background: open ? "var(--bg-surface)" : "var(--bg-surface-2)",
          border:    `1px solid ${open ? "var(--active)" : connected ? "var(--active)" : "var(--border-2)"}`,
          borderRadius: 5, padding: isMobile ? "2px 5px" : "3px 8px",
        }}
      >
        {isMobile ? "◆" : `◆ Claude`}
      </button>

      {open && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 100,
            background: "var(--bg-surface)", border: "1px solid var(--border-2)",
            borderRadius: 8, padding: "12px 14px", width: 290,
            boxShadow: "var(--shadow-modal)", display: "flex", flexDirection: "column", gap: 10,
          }}
        >
          {/* Status row */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
              background: connected ? "var(--success)" : "var(--text-5)",
            }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)" }}>
              {connected ? "Claude is connected" : "Connect Claude to your plan"}
            </span>
          </div>

          {connected ? (
            <div style={{ fontSize: 10, color: "var(--text-4)", lineHeight: 1.5 }}>
              Claude can see your live plan and make changes. Chat on{" "}
              <a href="https://claude.ai" target="_blank" rel="noreferrer"
                style={{ color: "var(--active)", textDecoration: "none" }}>claude.ai</a>.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 10, color: "var(--text-4)", lineHeight: 1.6 }}>
                Add your personal URL to Claude and it can read and edit your plan.
              </div>

              {/* Step 1 */}
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: "var(--text-5)", letterSpacing: "0.05em", marginBottom: 5 }}>
                  STEP 1 — COPY YOUR URL
                </div>
                <div style={{ display: "flex", gap: 5, alignItems: "stretch" }}>
                  <div style={{
                    flex: 1, fontSize: 9, fontFamily: "monospace",
                    background: "var(--bg-app)", border: "1px solid var(--border-2)",
                    borderRadius: 4, padding: "5px 7px", color: "var(--text-3)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    userSelect: "all",
                  }} title={url}>
                    {url}
                  </div>
                  <button
                    onClick={handleCopy}
                    style={{
                      flexShrink: 0, fontSize: 10, fontWeight: 700, cursor: "pointer",
                      background: copied ? "var(--success-bg)" : "var(--bg-surface-2)",
                      border: `1px solid ${copied ? "var(--success-border)" : "var(--border-2)"}`,
                      color: copied ? "var(--success)" : "var(--text-3)",
                      borderRadius: 4, padding: "0 10px",
                    }}
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>

              {/* Step 2 */}
              <div style={{ fontSize: 10, color: "var(--text-4)", lineHeight: 1.6 }}>
                <span style={{ fontWeight: 700, color: "var(--text-3)" }}>Step 2 —</span>{" "}
                Open{" "}
                <a href="https://claude.ai" target="_blank" rel="noreferrer"
                  style={{ color: "var(--active)", textDecoration: "none" }}>claude.ai</a>
                {" "}→ Settings → Integrations → Add integration.
              </div>

              {/* Step 3 */}
              <div style={{ fontSize: 10, color: "var(--text-4)", lineHeight: 1.6 }}>
                <span style={{ fontWeight: 700, color: "var(--text-3)" }}>Step 3 —</span>{" "}
                Paste the URL above and save. Then start a new chat and ask Claude about your plan.
              </div>
            </>
          )}

          {/* MCP URL (always shown when connected, for reference) */}
          {connected && (
            <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 8, display: "flex", gap: 5 }}>
              <div style={{
                flex: 1, fontSize: 8, fontFamily: "monospace",
                background: "var(--bg-app)", border: "1px solid var(--border-2)",
                borderRadius: 4, padding: "4px 6px", color: "var(--text-5)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }} title={url}>
                {url}
              </div>
              <button
                onClick={handleCopy}
                style={{
                  flexShrink: 0, fontSize: 9, cursor: "pointer",
                  background: copied ? "var(--success-bg)" : "var(--bg-surface-2)",
                  border: `1px solid ${copied ? "var(--success-border)" : "var(--border-2)"}`,
                  color: copied ? "var(--success)" : "var(--text-5)",
                  borderRadius: 4, padding: "0 8px",
                }}
              >
                {copied ? "✓" : "Copy"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
