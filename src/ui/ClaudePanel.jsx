// ═══════════════════════════════════════════════════════════════════
// CLAUDE INTEGRATION UI — deliberately invisible until used.
//
// nu-map never needs Claude; this is a hidden power feature. The rule:
//   • Never paired → nothing anywhere except a low-key "Connect Claude…"
//     entry at the bottom of ⚙ settings.
//   • Paired → a small dot in the header (orange = live, hollow grey =
//     link down). An indicator that an AI can currently see the plan
//     must never be ambiguous or hidden.
//
// Three pieces:
//   ClaudeDot          — header liveness dot (null until paired)
//   ClaudeSettings     — status + On/Off + auto-apply + connect/disconnect
//                        (rendered inside the ⚙ settings dropdown)
//   ClaudeConnectModal — the one-time pairing ceremony. A modal, not a
//                        dropdown: the flow requires switching to the
//                        Claude chat to read the code, and a dropdown
//                        would close on the way back.
//
// Two access tiers, explained in the modal:
//   1. Adding the connector (in Claude) → the PUBLIC database only:
//      courses, offerings, program requirements. Nothing about you.
//   2. Linking (here, via pairing code) → additionally, this plan.
//      Changes are propose-for-review; auto-apply is a separate opt-in.
// ═══════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { usePort } from "../context/InstitutionContext.jsx";
import { IAIAssistant } from "../ports/IAIAssistant.js";
import { usePlanner } from "../context/PlannerContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";

const CLAUDE_ORANGE = "#fb923c";

/** Poll SSE liveness every 2 s while mounted. */
function useClaudeLive() {
  const aiAssistant = usePort(IAIAssistant);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const tick = () => setConnected(!!aiAssistant?.isAvailable?.());
    tick();
    const id = setInterval(tick, 2_000);
    return () => clearInterval(id);
  }, [aiAssistant]);
  return connected;
}

// ── Header dot ─────────────────────────────────────────────────────

export function ClaudeDot() {
  const { claudePaired, claudeAccessEnabled } = usePlanner();
  const connected = useClaudeLive();
  if (!claudePaired) return null;
  // Orange = connected and On (Claude can see the plan right now).
  // Subtle grey = connected but paused (Off). Hollow = link down.
  const active = connected && claudeAccessEnabled;
  return (
    <span
      title={active ? "Claude is connected to this plan"
           : connected ? "Claude is connected but paused (Off)"
           : "Claude is linked but the connection is down"}
      style={{
        width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
        alignSelf: "center", margin: "0 2px",
        background: active ? CLAUDE_ORANGE : connected ? "var(--border-2)" : "transparent",
        border: connected ? "none" : "1.5px solid var(--text-5)",
        boxSizing: "border-box",
        opacity: active ? 1 : 0.8,
      }}
    />
  );
}

// ── Settings section content ───────────────────────────────────────

export function ClaudeSettings({ onConnect }) {
  const aiAssistant = usePort(IAIAssistant);
  const { t } = useLanguage();
  const {
    claudePaired, claudeDisconnect,
    claudeAccessEnabled, setClaudeAccess,
    claudeAutoApply, setClaudeAutoApply,
  } = usePlanner();
  const connected = useClaudeLive();

  if (!aiAssistant?.getMCPUrl) return null;

  // Section heading with the connection state folded in — "Connected"
  // is the complement of the Disconnect action below.
  const heading = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 1 }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: "var(--text-4)", letterSpacing: "0.05em" }}>
        {t("header.settings.claude.section")}
      </span>
      {claudePaired && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 8.5, color: "var(--text-5)" }}>
          {connected ? "Connected" : "Reconnecting…"}
          <span style={{
            width: 5, height: 5, borderRadius: "50%",
            background: connected && claudeAccessEnabled ? CLAUDE_ORANGE
                      : connected ? "var(--border-2)" : "transparent",
            border: connected ? "none" : "1px solid var(--text-5)", boxSizing: "border-box",
          }} />
        </span>
      )}
    </div>
  );

  if (!claudePaired) {
    // Understated single entry — no pitch, no pressure.
    return (
      <>
        {heading}
        <button
          className="hdr-btn-dd"
          onClick={e => { e.stopPropagation(); onConnect?.(); }}
          title="Optional: link Claude AI to help with planning. Off by default."
          style={{ width: "100%", textAlign: "left", fontSize: 10, cursor: "pointer",
            background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
            border: "1px solid var(--border-2)", color: "var(--text-4)" }}>
          Connect Claude…
        </button>
      </>
    );
  }

  return (
    <>
      {heading}

      {/* On / Off (pause without unpairing) */}
      <button
        className="hdr-btn-dd"
        onClick={e => { e.stopPropagation(); setClaudeAccess(!claudeAccessEnabled); }}
        title={t("header.settings.claude.title")}
        style={{ width: "100%", textAlign: "left", fontSize: 10, fontWeight: 700, cursor: "pointer",
          background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
          border: `1px solid ${claudeAccessEnabled ? "var(--success-border)" : "var(--border-2)"}`,
          color: claudeAccessEnabled ? "var(--success)" : "var(--text-4)" }}>
        {claudeAccessEnabled ? t("header.settings.claude.on") : t("header.settings.claude.off")}
      </button>

      {/* Auto-apply opt-in */}
      {claudeAccessEnabled && (
        <button
          className="hdr-btn-dd"
          onClick={e => { e.stopPropagation(); setClaudeAutoApply(!claudeAutoApply); }}
          title={t("header.settings.claude.auto.title")}
          style={{ width: "100%", textAlign: "left", fontSize: 10, fontWeight: 700, cursor: "pointer",
            background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
            border: `1px solid ${claudeAutoApply ? CLAUDE_ORANGE : "var(--border-2)"}`,
            color: claudeAutoApply ? CLAUDE_ORANGE : "var(--text-4)" }}>
          {claudeAutoApply ? t("header.settings.claude.auto.on") : (
            <>
              {t("header.settings.claude.auto.off")}
              <span style={{ fontWeight: 400, fontSize: 8.5, color: "var(--text-5)", marginLeft: 5 }}>
                {t("header.settings.claude.auto.hint")}
              </span>
            </>
          )}
        </button>
      )}

      <button
        className="hdr-btn-dd"
        onClick={e => { e.stopPropagation(); claudeDisconnect(); }}
        title="Sever the link entirely — reconnecting requires a fresh code."
        style={{ width: "100%", textAlign: "left", fontSize: 10, cursor: "pointer",
          background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
          border: "1px solid var(--border-2)", color: "var(--error)" }}>
        Disconnect
      </button>
    </>
  );
}

// ── Proposal review card ───────────────────────────────────────────
// Renders when Claude has queued a changeset (propose_changes). The user
// sees the headline, rationale, and every action in plain language, and
// approves or rejects — nothing touches the plan until Approve.

const SEM_TYPE_WORD = { fall: "Fall", spring: "Spring", spr: "Spring", sumA: "Summer 1", sumB: "Summer 2" };

function semLabelOf(semId, semesters) {
  if (semId === "incoming") return "Incoming Credit";
  const hit = semesters?.find(s => s.id === semId);
  if (hit) return hit.label;
  const m = String(semId).match(/^(fall|spring|spr|sumA|sumB)(\d{4})$/);
  return m ? `${SEM_TYPE_WORD[m[1]] ?? m[1]} ${m[2]}` : semId;
}

function describeAction(a, courseMap, semesters) {
  const code = (id) => courseMap?.[id]?.code ?? id;
  const sem  = (id) => semLabelOf(id, semesters);
  switch (a.type) {
    case "ADD_COURSE":          return `Add ${code(a.courseId)} to ${sem(a.semId)}`;
    case "REMOVE_COURSE":       return `Remove ${code(a.courseId)}`;
    case "MOVE_COURSE":         return `Move ${code(a.courseId)} to ${sem(a.toSemId)}`;
    case "ADD_PLACED_OUT":      return `Mark ${code(a.courseId)} as placed out`;
    case "REMOVE_PLACED_OUT":   return `Remove placed-out status from ${code(a.courseId)}`;
    case "ADD_SUBSTITUTION":    return `Substitute ${code(a.fromId)} for ${code(a.toId)}`;
    case "REMOVE_SUBSTITUTION": return `Remove substitution ${code(a.fromId)} → ${code(a.toId)}`;
    case "ADD_WORK_TERM":       return `Add ${a.typeId === "coop" ? "co-op" : a.typeId} (${a.duration} mo)${a.company ? ` at ${a.company}` : ""} starting ${sem(a.semId)}`;
    case "REMOVE_WORK_TERM":    return "Remove a work term";
    case "MOVE_WORK_TERM":      return `Move a work term to ${sem(a.toSemId)}`;
    case "UPDATE_WORK_TERM":    return "Update work-term details";
    case "SET_MAJOR":           return a.programId ? "Change major" : "Clear major";
    case "SET_MAJOR2":          return a.programId ? "Change second major" : "Clear second major";
    case "SET_CONCENTRATION":   return a.label ? `Set concentration: ${a.label}` : "Clear concentration";
    case "SET_MINOR1": case "SET_MINOR2":
                                return a.programId ? "Change a minor" : "Clear a minor";
    case "SET_STUDENT_TYPE":    return `Switch plan type to ${a.studentType}`;
    case "SET_BONUS_SH":        return `Set incoming general credits to ${a.amount} SH`;
    case "SET_SH_OVERRIDE":     return a.value == null ? `Reset credits for ${code(a.courseId)}` : `Set ${code(a.courseId)} to ${a.value} SH`;
    case "SET_OFFERED_OVERRIDE":return `Override ${code(a.courseId)} offering in ${SEM_TYPE_WORD[a.semTypeId] ?? a.semTypeId}: ${a.status == null ? "auto" : a.status ? "offered" : "not offered"}`;
    case "SET_ENTRY":           return `Set entry to ${SEM_TYPE_WORD[a.sem] ?? a.sem} ${a.year}`;
    case "SET_GRADUATION":      return `Set graduation to ${SEM_TYPE_WORD[a.sem] ?? a.sem} ${a.year}`;
    case "SET_CURRENT_SEM":     return `Set current semester to ${sem(a.semId)}`;
    case "STAR_COURSE":         return `Star ${code(a.courseId)}`;
    case "UNSTAR_COURSE":       return `Unstar ${code(a.courseId)}`;
    case "ADD_TO_PALETTE":      return `Add ${code(a.courseId)} to the scratch pad`;
    case "REMOVE_FROM_PALETTE": return `Remove ${code(a.courseId)} from the scratch pad`;
    case "CREATE_PLAN":         return `Create plan “${a.name}”`;
    case "RENAME_PLAN":         return `Rename a plan to “${a.name}”`;
    case "SWITCH_PLAN":         return "Switch active plan";
    case "DELETE_PLAN":         return "⚠ Delete a plan";
    default:                    return a.type;
  }
}

export function ClaudeProposalCard() {
  const {
    mcpProposals, mcpProposalStale, confirmMCPProposal,
    claudePreview, toggleClaudePreview,
    courseMap, SEMESTERS,
  } = usePlanner();

  const head = mcpProposals[0];
  if (!head) return null;

  const { changeset, meta = {} } = head;
  const actions    = changeset?.actions ?? [];
  const previewing = claudePreview?.proposalId === head.proposalId;
  const hasDelta   = meta.violationsBefore !== undefined && meta.violationsAfter !== undefined;
  const deltaGood  = hasDelta && meta.violationsAfter < meta.violationsBefore;
  const deltaBad   = hasDelta && meta.violationsAfter > meta.violationsBefore;

  return (
    <div style={{
      position: "fixed", right: 14, bottom: 14, zIndex: 180,
      width: 304, maxHeight: "62vh", overflowY: "auto",
      background: "var(--bg-surface)", border: `1px solid ${CLAUDE_ORANGE}`,
      borderRadius: 10, padding: "12px 14px", boxShadow: "var(--shadow-modal)",
      display: "flex", flexDirection: "column", gap: 9,
    }}>
      {/* Header: label + queue position */}
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: CLAUDE_ORANGE, flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-2)", flex: 1, minWidth: 0 }}>
          {changeset?.label || "Claude suggests a change"}
        </span>
        {mcpProposals.length > 1 && (
          <span style={{ fontSize: 9, color: "var(--text-5)", flexShrink: 0 }}>
            1 of {mcpProposals.length}
          </span>
        )}
      </div>

      {changeset?.rationale && (
        <div style={{ fontSize: 10, color: "var(--text-4)", lineHeight: 1.55 }}>
          {changeset.rationale}
        </div>
      )}

      <ul style={{ margin: 0, padding: "0 0 0 14px", display: "flex", flexDirection: "column", gap: 3 }}>
        {actions.map((a, i) => (
          <li key={i} style={{ fontSize: 10, color: "var(--text-3)", lineHeight: 1.45 }}>
            {describeAction(a, courseMap, SEMESTERS)}
          </li>
        ))}
      </ul>

      {/* Consequences: prereq/coreq conflict delta from the propose-time dry-run */}
      {hasDelta && (
        <div style={{ fontSize: 9.5, color: deltaGood ? "var(--success)" : deltaBad ? "var(--error)" : "var(--text-5)" }}>
          {meta.violationsBefore === meta.violationsAfter
            ? `No new conflicts (${meta.violationsAfter} existing)`
            : `Conflicts: ${meta.violationsBefore} → ${meta.violationsAfter}`}
        </div>
      )}

      {mcpProposalStale && (
        <div style={{ fontSize: 9.5, color: "var(--warn, #b45309)", lineHeight: 1.5 }}>
          ⚠ Your plan has changed since Claude proposed this — review carefully.
        </div>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          onClick={() => toggleClaudePreview(head)}
          title="Show this change on the grid as translucent ghosts — nothing is applied"
          style={{ fontSize: 10, fontWeight: 700, cursor: "pointer", padding: "4px 10px",
            background: previewing ? "var(--bg-app)" : "var(--bg-surface-2)",
            border: `1px dashed ${previewing ? CLAUDE_ORANGE : "var(--border-2)"}`,
            color: previewing ? CLAUDE_ORANGE : "var(--text-4)", borderRadius: 5 }}>
          {previewing ? "Previewing…" : "Preview"}
        </button>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => confirmMCPProposal(false)}
          style={{ fontSize: 10, fontWeight: 700, cursor: "pointer", padding: "4px 12px",
            background: "var(--bg-surface-2)", border: "1px solid var(--border-2)",
            color: "var(--text-4)", borderRadius: 5 }}>
          Reject
        </button>
        <button
          onClick={() => confirmMCPProposal(true)}
          title="Applies as a single undo entry (Cmd+Z reverses all of it)"
          style={{ fontSize: 10, fontWeight: 700, cursor: "pointer", padding: "4px 12px",
            background: "var(--bg-surface-2)", border: `1px solid ${CLAUDE_ORANGE}`,
            color: CLAUDE_ORANGE, borderRadius: 5 }}>
          Approve
        </button>
      </div>
    </div>
  );
}

// ── Pairing modal ──────────────────────────────────────────────────

export function ClaudeConnectModal({ open, onClose }) {
  const aiAssistant = usePort(IAIAssistant);
  const { confirmClaudePairing } = usePlanner();

  const [copied, setCopied]       = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [pairState, setPairState] = useState("idle"); // idle | working | error | done

  useEffect(() => {
    if (open) { setCodeInput(""); setPairState("idle"); setCopied(false); }
  }, [open]);

  if (!open || !aiAssistant?.getMCPUrl) return null;
  const url = aiAssistant.getMCPUrl();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {}
  };

  const handleConnect = async () => {
    if (!codeInput.trim() || pairState === "working") return;
    setPairState("working");
    const ok = await confirmClaudePairing(codeInput);
    if (ok) {
      setPairState("done");
      setTimeout(onClose, 1200);
    } else {
      setPairState("error");
    }
  };

  const stepLabel = { fontSize: 9, fontWeight: 700, color: "var(--text-5)", letterSpacing: "0.05em", marginBottom: 5 };
  const body      = { fontSize: 10.5, color: "var(--text-4)", lineHeight: 1.6 };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 14,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--bg-surface)", border: "1px solid var(--border-2)",
          borderRadius: 12, maxWidth: 340, width: "100%",
          padding: "16px 16px 14px", boxShadow: "var(--shadow-modal)",
          color: "var(--text-2)", display: "flex", flexDirection: "column", gap: 12,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: CLAUDE_ORANGE }} />
          Connect Claude
        </div>

        <div style={body}>
          Optional — nu-map works fully without this. Linking lets Claude help
          you plan: it can already browse the <b>public course database</b>{" "}
          (any course, offering history, degree requirements) once the connector
          is added. Linking below <b>additionally shares this plan</b> — your
          placements, co-ops, and programs — and lets Claude <b>propose</b>{" "}
          changes that you approve here first.
        </div>

        {/* Step 1 — instructions depend on deployment: hosted builds point
            students at the claude.ai Directory (no tools, no terminal);
            local dev builds show the Claude Code command. */}
        {url.includes("localhost") || url.includes("127.0.0.1") ? (
          <div>
            <div style={stepLabel}>STEP 1 — ADD THE NU MAP CONNECTOR (DEV)</div>
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
            <div style={{ fontSize: 9, color: "var(--text-5)", marginTop: 4, lineHeight: 1.5 }}>
              Local dev server — add it in Claude Code:{" "}
              <span style={{ fontFamily: "monospace" }}>claude mcp add --transport http nu-map &lt;URL&gt;</span>.
              This step grants access to public course data only.
            </div>
          </div>
        ) : (
          <div>
            <div style={stepLabel}>STEP 1 — ADD NU MAP TO CLAUDE</div>
            <div style={body}>
              Open <b>claude.ai → Directory → Your organization</b> and add{" "}
              <b>NU Map</b>. This step grants access to public course data only
              (catalog, offerings, degree requirements).
            </div>
          </div>
        )}

        {/* Step 2 */}
        <div style={body}>
          <span style={{ fontWeight: 700, color: "var(--text-3)" }}>Step 2 —</span>{" "}
          In the chat, ask Claude to <i>“connect to my NU Map”</i>.
          It will show you a 6-character code.
        </div>

        {/* Step 3 */}
        <div>
          <div style={stepLabel}>STEP 3 — ENTER THE CODE TO SHARE THIS PLAN</div>
          <div style={{ display: "flex", gap: 5 }}>
            <input
              value={codeInput}
              onChange={e => { setCodeInput(e.target.value.toUpperCase()); setPairState("idle"); }}
              onKeyDown={e => { if (e.key === "Enter") handleConnect(); }}
              placeholder="ABC123"
              maxLength={8}
              spellCheck={false}
              autoFocus
              style={{
                flex: 1, fontSize: 13, fontFamily: "monospace", letterSpacing: "0.25em",
                background: "var(--bg-app)",
                border: `1px solid ${pairState === "error" ? "var(--error)" : "var(--border-2)"}`,
                borderRadius: 4, padding: "6px 10px", color: "var(--text-2)",
                textTransform: "uppercase", minWidth: 0,
              }}
            />
            <button
              onClick={handleConnect}
              disabled={pairState === "working" || !codeInput.trim()}
              style={{
                flexShrink: 0, fontSize: 11, fontWeight: 700,
                cursor: pairState === "working" ? "wait" : "pointer",
                background: pairState === "done" ? "var(--success-bg)" : "var(--bg-surface-2)",
                border: `1px solid ${pairState === "done" ? "var(--success-border)" : CLAUDE_ORANGE}`,
                color: pairState === "done" ? "var(--success)" : CLAUDE_ORANGE,
                borderRadius: 4, padding: "0 14px",
                opacity: codeInput.trim() || pairState === "done" ? 1 : 0.5,
              }}
            >
              {pairState === "done" ? "Linked ✓" : pairState === "working" ? "…" : "Connect"}
            </button>
          </div>
          {pairState === "error" && (
            <div style={{ fontSize: 9, color: "var(--error)", marginTop: 4 }}>
              Code not recognized (or expired — codes last 10 minutes). Ask Claude for a new one.
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          style={{
            alignSelf: "flex-end", fontSize: 10, cursor: "pointer",
            background: "none", border: "none", color: "var(--text-5)", padding: 2,
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
