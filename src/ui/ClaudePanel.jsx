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
// Header-dot variant: deliberately muted — the always-visible indicator
// should confirm the link without advertising Claude on every login.
const CLAUDE_ORANGE_SOFT = "rgba(251, 146, 60, 0.45)";

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
  const { t } = useLanguage();
  const connected = useClaudeLive();
  if (!claudePaired) return null;
  // Orange = connected and On (Claude can see the plan right now).
  // Subtle grey = connected but paused (Off). Hollow = link down.
  const active = connected && claudeAccessEnabled;
  return (
    <span
      title={active ? t("claude.dot.active")
           : connected ? t("claude.dot.paused")
           : t("claude.dot.down")}
      style={{
        width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
        alignSelf: "center", margin: "0 2px",
        background: active ? CLAUDE_ORANGE_SOFT : connected ? "var(--border-2)" : "transparent",
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
          {connected ? t("claude.connected") : t("claude.reconnecting")}
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
          title={t("claude.connect.title")}
          style={{ width: "100%", textAlign: "left", fontSize: 10, cursor: "pointer",
            background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
            border: "1px solid var(--border-2)", color: "var(--text-4)" }}>
          {t("claude.connect")}
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
        title={t("claude.disconnect.title")}
        style={{ width: "100%", textAlign: "left", fontSize: 10, cursor: "pointer",
          background: "var(--bg-surface)", padding: "4px 8px", borderRadius: 5,
          border: "1px solid var(--border-2)", color: "var(--error)" }}>
        {t("claude.disconnect")}
      </button>
    </>
  );
}

// ── Proposal review card ───────────────────────────────────────────
// Renders when Claude has queued a changeset (propose_changes). The user
// sees the headline, rationale, and every action in plain language, and
// approves or rejects — nothing touches the plan until Approve.

const SEM_TYPE_KEY = { fall: "claude.sem.fall", spring: "claude.sem.spring", spr: "claude.sem.spring", sumA: "claude.sem.sum1", sumB: "claude.sem.sum2" };

function semLabelOf(semId, semesters, t) {
  if (semId === "incoming") return t("claude.sem.incoming");
  const m = String(semId).match(/^(fall|spring|spr|sumA|sumB)(\d{4})$/);
  if (m) return `${t(SEM_TYPE_KEY[m[1]])} ${m[2]}`;
  return semesters?.find(s => s.id === semId)?.label ?? semId;
}

function describeAction(a, courseMap, semesters, t) {
  const code = (id) => courseMap?.[id]?.code ?? id;
  const sem  = (id) => semLabelOf(id, semesters, t);
  const semWord = (id) => t(SEM_TYPE_KEY[id] ?? id);
  switch (a.type) {
    case "ADD_COURSE":          return t("claude.act.add", { code: code(a.courseId), sem: sem(a.semId) });
    case "REMOVE_COURSE":       return t("claude.act.remove", { code: code(a.courseId) });
    case "MOVE_COURSE":         return t("claude.act.move", { code: code(a.courseId), sem: sem(a.toSemId) });
    case "ADD_PLACED_OUT":      return t("claude.act.placeout", { code: code(a.courseId) });
    case "REMOVE_PLACED_OUT":   return t("claude.act.unplaceout", { code: code(a.courseId) });
    case "ADD_SUBSTITUTION":    return t("claude.act.sub", { from: code(a.fromId), to: code(a.toId) });
    case "REMOVE_SUBSTITUTION": return t("claude.act.unsub", { from: code(a.fromId), to: code(a.toId) });
    case "ADD_WORK_TERM":       return t("claude.act.workterm.add", {
                                  type: a.typeId === "coop" ? "co-op" : a.typeId,
                                  n: a.duration, sem: sem(a.semId),
                                }) + (a.company ? ` — ${a.company}` : "");
    case "REMOVE_WORK_TERM":    return t("claude.act.workterm.remove");
    case "MOVE_WORK_TERM":      return t("claude.act.workterm.move", { sem: sem(a.toSemId) });
    case "UPDATE_WORK_TERM":    return t("claude.act.workterm.update");
    case "SET_MAJOR":           return t(a.programId ? "claude.act.major.set" : "claude.act.major.clear");
    case "SET_MAJOR2":          return t(a.programId ? "claude.act.major2.set" : "claude.act.major2.clear");
    case "SET_CONCENTRATION":   return a.label ? t("claude.act.conc.set", { label: a.label }) : t("claude.act.conc.clear");
    case "SET_MINOR1": case "SET_MINOR2":
                                return t(a.programId ? "claude.act.minor.set" : "claude.act.minor.clear");
    case "SET_STUDENT_TYPE":    return t("claude.act.studenttype", { type: a.studentType });
    case "SET_BONUS_SH":        return t("claude.act.bonus", { n: a.amount });
    case "SET_SH_OVERRIDE":     return a.value == null
                                  ? t("claude.act.sh.clear", { code: code(a.courseId) })
                                  : t("claude.act.sh.set", { code: code(a.courseId), n: a.value });
    case "SET_OFFERED_OVERRIDE":return t("claude.act.offered", {
                                  code: code(a.courseId), sem: semWord(a.semTypeId),
                                  status: t(a.status == null ? "claude.act.offered.auto" : a.status ? "claude.act.offered.on" : "claude.act.offered.off"),
                                });
    case "SET_ENTRY":           return t("claude.act.entry", { sem: semWord(a.sem), year: a.year });
    case "SET_GRADUATION":      return t("claude.act.grad", { sem: semWord(a.sem), year: a.year });
    case "SET_CURRENT_SEM":     return t("claude.act.cursem", { sem: sem(a.semId) });
    case "STAR_COURSE":         return t("claude.act.star", { code: code(a.courseId) });
    case "UNSTAR_COURSE":       return t("claude.act.unstar", { code: code(a.courseId) });
    case "ADD_TO_PALETTE":      return t("claude.act.palette.add", { code: code(a.courseId) });
    case "REMOVE_FROM_PALETTE": return t("claude.act.palette.remove", { code: code(a.courseId) });
    case "CREATE_PLAN":         return t("claude.act.plan.create", { name: a.name });
    case "RENAME_PLAN":         return t("claude.act.plan.rename", { name: a.name });
    case "SWITCH_PLAN":         return t("claude.act.plan.switch");
    case "DELETE_PLAN":         return t("claude.act.plan.delete");
    default:                    return a.type;
  }
}

export function ClaudeProposalCard() {
  const {
    mcpProposals, mcpProposalStale, confirmMCPProposal, confirmAllMCPProposals,
    claudePreview, toggleClaudePreview,
    courseMap, SEMESTERS,
  } = usePlanner();
  const { t } = useLanguage();

  const head = mcpProposals[0];
  if (!head) return null;

  const { changeset, meta = {} } = head;
  const actions    = changeset?.actions ?? [];
  // Single-action proposals: our localized action description IS the
  // headline (guaranteed in the app language), and the redundant
  // one-item bullet list is dropped. Claude's free-text label is only
  // used as a summary over multi-action changesets.
  const single     = actions.length === 1;
  const title      = single
    ? describeAction(actions[0], courseMap, SEMESTERS, t)
    : (changeset?.label || t("claude.card.title"));
  const previewing = claudePreview?.proposalId === head.proposalId;
  const hasDelta   = meta.violationsBefore !== undefined && meta.violationsAfter !== undefined;
  const deltaGood  = hasDelta && meta.violationsAfter < meta.violationsBefore;
  const deltaBad   = hasDelta && meta.violationsAfter > meta.violationsBefore;

  return (
    <div style={{
      position: "fixed", right: 14, bottom: 14, zIndex: 180,
      // A queued batch adds the Approve-all button — widen so the button
      // row stays on one line, Approve all at the far right.
      width: mcpProposals.length >= 2 ? 396 : 304, maxHeight: "62vh", overflowY: "auto",
      background: "var(--bg-surface)", border: `1px solid ${CLAUDE_ORANGE}`,
      borderRadius: 10, padding: "12px 14px", boxShadow: "var(--shadow-modal)",
      display: "flex", flexDirection: "column", gap: 9,
    }}>
      {/* Header: label + queue position */}
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: CLAUDE_ORANGE, flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-2)", flex: 1, minWidth: 0 }}>
          {title}
        </span>
        {mcpProposals.length > 1 && (
          <span style={{ fontSize: 9, color: "var(--text-5)", flexShrink: 0 }}>
            {t("claude.card.queue", { n: mcpProposals.length })}
          </span>
        )}
      </div>

      {changeset?.rationale && (
        <div style={{ fontSize: 10, color: "var(--text-4)", lineHeight: 1.55 }}>
          {changeset.rationale}
        </div>
      )}

      {!single && (
        <ul style={{ margin: 0, padding: "0 0 0 14px", display: "flex", flexDirection: "column", gap: 3 }}>
          {actions.map((a, i) => (
            <li key={i} style={{ fontSize: 10, color: "var(--text-3)", lineHeight: 1.45 }}>
              {describeAction(a, courseMap, SEMESTERS, t)}
            </li>
          ))}
        </ul>
      )}

      {/* Consequences: prereq/coreq conflict delta from the propose-time dry-run */}
      {hasDelta && (
        <div style={{ fontSize: 9.5, color: deltaGood ? "var(--success)" : deltaBad ? "var(--error)" : "var(--text-5)" }}>
          {meta.violationsBefore === meta.violationsAfter
            ? t("claude.card.noconflicts", { n: meta.violationsAfter })
            : t("claude.card.conflicts", { before: meta.violationsBefore, after: meta.violationsAfter })}
        </div>
      )}

      {mcpProposalStale && (
        <div style={{ fontSize: 9.5, color: "var(--warn, #b45309)", lineHeight: 1.5 }}>
          {t("claude.card.stale")}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={() => toggleClaudePreview(head)}
          title={t("claude.card.preview.title")}
          style={{ fontSize: 10, fontWeight: 700, cursor: "pointer", padding: "4px 10px",
            background: previewing ? "var(--bg-app)" : "var(--bg-surface-2)",
            border: `1px dashed ${previewing ? CLAUDE_ORANGE : "var(--border-2)"}`,
            color: previewing ? CLAUDE_ORANGE : "var(--text-4)", borderRadius: 5 }}>
          {previewing ? t("claude.card.previewing") : t("claude.card.preview")}
        </button>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => confirmMCPProposal(false)}
          style={{ fontSize: 10, fontWeight: 700, cursor: "pointer", padding: "4px 12px",
            background: "var(--bg-surface-2)", border: "1px solid var(--border-2)",
            color: "var(--text-4)", borderRadius: 5 }}>
          {t("claude.card.reject")}
        </button>
        <button
          onClick={() => confirmMCPProposal(true)}
          title={t("claude.card.approve.title")}
          style={{ fontSize: 10, fontWeight: 700, cursor: "pointer", padding: "4px 12px",
            background: "var(--bg-surface-2)", border: `1px solid ${CLAUDE_ORANGE}`,
            color: CLAUDE_ORANGE, borderRadius: 5 }}>
          {t("claude.card.approve")}
        </button>
        {mcpProposals.length >= 2 && (
          <button
            onClick={() => confirmAllMCPProposals()}
            title={t("claude.card.approveAll.title")}
            style={{ fontSize: 10, fontWeight: 700, cursor: "pointer", padding: "4px 10px",
              whiteSpace: "nowrap",
              background: CLAUDE_ORANGE, border: `1px solid ${CLAUDE_ORANGE}`,
              color: "#fff", borderRadius: 5 }}>
            {t("claude.card.approveAll", { n: mcpProposals.length })}
          </button>
        )}
      </div>
    </div>
  );
}

// ── OAuth approval modal ───────────────────────────────────────────
// Rendered when claude.ai redirected the user here to authorize the
// connector (?claude_connect=…). One decision, made in the app; approval
// finishes the OAuth grant and returns the user to Claude.

export function ClaudeOAuthModal() {
  const { claudeOAuthRequest, resolveClaudeOAuth } = usePlanner();
  const { t } = useLanguage();
  const [working, setWorking] = useState(false);
  const [failed, setFailed]   = useState(false);

  if (!claudeOAuthRequest && !failed) return null;

  const approve = async (planAccess = true) => {
    setWorking(true);
    const ok = await resolveClaudeOAuth(true, { planAccess });
    if (!ok) { setFailed(true); setWorking(false); }
    // on success the page navigates back to Claude
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 210,
      background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 14,
    }}>
      <div style={{
        background: "var(--bg-surface)", border: "1px solid var(--border-2)",
        borderRadius: 12, maxWidth: 330, width: "100%",
        padding: "18px 18px 14px", boxShadow: "var(--shadow-modal)",
        color: "var(--text-2)", display: "flex", flexDirection: "column", gap: 12,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: CLAUDE_ORANGE }} />
          {t("claude.oauth.title")}
        </div>
        {failed ? (
          <>
            <div style={{ fontSize: 10.5, color: "var(--error)", lineHeight: 1.6 }}>
              {t("claude.oauth.error")}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => { setFailed(false); resolveClaudeOAuth(false); }}
                style={{ fontSize: 11, fontWeight: 700, cursor: "pointer", padding: "5px 14px",
                  background: "var(--bg-surface-2)", border: "1px solid var(--border-2)",
                  color: "var(--text-4)", borderRadius: 5 }}>
                {t("claude.modal.close")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 10.5, color: "var(--text-4)", lineHeight: 1.6 }}>
              {t("claude.oauth.body")}
            </div>

            {/* Access choices — two self-explaining cards, full share first */}
            <button
              onClick={() => approve(true)}
              disabled={working}
              style={{ display: "block", width: "100%", textAlign: "start",
                boxSizing: "border-box", padding: "9px 12px",
                cursor: working ? "wait" : "pointer",
                background: "var(--bg-surface-2)",
                border: `1.5px solid ${CLAUDE_ORANGE}`, borderRadius: 8 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: CLAUDE_ORANGE, marginBottom: 2 }}>
                {working ? "…" : t("claude.oauth.full.title")}
              </div>
              <div style={{ fontSize: 9.5, color: "var(--text-4)", lineHeight: 1.5 }}>
                {t("claude.oauth.full.desc")}
              </div>
            </button>
            <button
              onClick={() => approve(false)}
              disabled={working}
              style={{ display: "block", width: "100%", textAlign: "start",
                boxSizing: "border-box", padding: "9px 12px", marginTop: -4,
                cursor: working ? "wait" : "pointer",
                background: "var(--bg-surface-2)",
                border: "1.5px solid var(--border-2)", borderRadius: 8 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-2)", marginBottom: 2 }}>
                {working ? "…" : t("claude.oauth.catalog.title")}
              </div>
              <div style={{ fontSize: 9.5, color: "var(--text-4)", lineHeight: 1.5 }}>
                {t("claude.oauth.catalog.desc")}
              </div>
            </button>

            <button
              onClick={() => { setFailed(false); resolveClaudeOAuth(false); }}
              disabled={working}
              style={{ fontSize: 10.5, fontWeight: 700, alignSelf: "center",
                cursor: working ? "wait" : "pointer", padding: "3px 10px",
                background: "none", border: "none", color: "var(--text-5)" }}>
              {t("claude.oauth.deny")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Pairing modal ──────────────────────────────────────────────────

export function ClaudeConnectModal({ open, onClose }) {
  const aiAssistant = usePort(IAIAssistant);
  const { confirmClaudePairing, claudeDisconnect } = usePlanner();
  const { t } = useLanguage();

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [copied, setCopied]       = useState(null);    // "url" | "cmd" | null
  const [codeInput, setCodeInput] = useState("");
  const [pairState, setPairState] = useState("idle");  // idle | working | error | done

  useEffect(() => {
    if (open) { setShowAdvanced(false); setCodeInput(""); setPairState("idle"); setCopied(null); }
  }, [open]);

  if (!open || !aiAssistant?.getMCPUrl) return null;

  const url    = aiAssistant.getMCPUrl();               // personal session URL (advanced/dev)
  const isDev  = url.includes("localhost") || url.includes("127.0.0.1");
  // OAuth endpoint: one fixed URL for everyone (strip the session segment)
  const oauthUrl = url.replace(/\/session\/[^/]+\/mcp$/, "/mcp");
  const cmd      = `claude mcp add --transport http --scope user nu-map ${isDev ? url : oauthUrl}`;

  const copy = async (what, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {}
  };

  const handleConnect = async () => {
    if (!codeInput.trim() || pairState === "working") return;
    setPairState("working");
    const ok = await confirmClaudePairing(codeInput);
    if (ok) { setPairState("done"); setTimeout(onClose, 1200); }
    else    { setPairState("error"); }
  };

  const body  = { fontSize: 10.5, color: "var(--text-4)", lineHeight: 1.6 };
  const small = { fontSize: 8.5, color: "var(--text-5)", lineHeight: 1.5 };
  const sectionHead = { fontSize: 11, fontWeight: 700, color: "var(--text-2)", marginBottom: 6 };

  const CopyRow = ({ what, text }) => (
    <div style={{ display: "flex", gap: 5, alignItems: "stretch" }}>
      <div style={{
        flex: 1, fontSize: 8.5, fontFamily: "monospace",
        background: "var(--bg-app)", border: "1px solid var(--border-2)",
        borderRadius: 4, padding: "5px 7px", color: "var(--text-3)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        userSelect: "all",
      }} title={text}>
        {text}
      </div>
      <button
        onClick={() => copy(what, text)}
        style={{
          flexShrink: 0, fontSize: 9, fontWeight: 700, cursor: "pointer",
          background: copied === what ? "var(--success-bg)" : "var(--bg-surface-2)",
          border: `1px solid ${copied === what ? "var(--success-border)" : "var(--border-2)"}`,
          color: copied === what ? "var(--success)" : "var(--text-3)",
          borderRadius: 4, padding: "0 9px",
        }}
      >
        {copied === what ? t("claude.copied") : t("claude.copy")}
      </button>
    </div>
  );

  const Steps = ({ items }) => (
    <ol style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((item, i) => (
        <li key={i} style={{ fontSize: 10.5, color: "var(--text-3)", lineHeight: 1.55 }}>{item}</li>
      ))}
    </ol>
  );

  // Pairing-code entry row — embedded in dev step 3 and in manual pairing
  const codeEntry = (
    <>
      <div style={{ display: "flex", gap: 5 }}>
        <input
          value={codeInput}
          onChange={e => { setCodeInput(e.target.value.toUpperCase()); setPairState("idle"); }}
          onKeyDown={e => { if (e.key === "Enter") handleConnect(); }}
          placeholder={t("claude.modal.code.placeholder")}
          maxLength={8}
          spellCheck={false}
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
          {pairState === "done" ? t("claude.modal.linked") : pairState === "working" ? "…" : t("claude.modal.connect")}
        </button>
      </div>
      {pairState === "error" && (
        <div style={{ fontSize: 9, color: "var(--error)" }}>{t("claude.modal.error")}</div>
      )}
    </>
  );

  // Manual pairing — the collapsed fallback for MCP clients without OAuth
  const pairingSection = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={body}>{t("claude.modal.adv.hint")}</div>
      <CopyRow what="url" text={url} />
      {codeEntry}
      {/* Universal escape hatch: when any side is stuck or out of sync,
          reset to a fresh identity — every stale connection anywhere
          loses access, and the user starts the normal flow over. */}
      <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={small}>{t("claude.modal.reset.hint")}</div>
        <button
          onClick={() => claudeDisconnect()}
          style={{ alignSelf: "flex-start", fontSize: 10, fontWeight: 700, cursor: "pointer",
            background: "var(--bg-surface-2)", border: "1px solid var(--border-2)",
            color: "var(--error)", borderRadius: 5, padding: "4px 12px" }}>
          {t("claude.modal.reset")}
        </button>
      </div>
    </div>
  );

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
          borderRadius: 12, maxWidth: 350, width: "100%", maxHeight: "85vh", overflowY: "auto",
          padding: "16px 16px 12px", boxShadow: "var(--shadow-modal)",
          color: "var(--text-2)", display: "flex", flexDirection: "column", gap: 12,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: CLAUDE_ORANGE }} />
          {t("claude.modal.title")}
        </div>

        <div style={body}>{t("claude.modal.intro")}</div>

        {/* Section 1: the student path — claude.ai, plain language.
            Always shown (dev included) so the production copy is
            previewable locally. */}
        <div>
          <div style={sectionHead}>{t("claude.modal.head.web")}</div>
          <Steps items={[
            t("claude.modal.web.1"),
            t("claude.modal.web.2"),
            t("claude.modal.web.3"),
          ]} />
          <div style={{ ...small, marginTop: 5 }}>{t("claude.modal.web.notlisted")}</div>
        </div>

        {/* Section 2: Claude Code. Hosted builds use OAuth (/mcp +
            Authenticate); the local dev server has no OAuth, so dev
            builds show the pairing-code flow inline instead. */}
        <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 10 }}>
          <div style={sectionHead}>{t("claude.modal.tab.code")}</div>
          <Steps items={[
            <span key="1">
              {t("claude.modal.code.1")}
              <span style={{ display: "block", marginTop: 4 }}><CopyRow what="cmd" text={cmd} /></span>
            </span>,
            isDev ? t("claude.modal.dev.2") : t("claude.modal.code.2"),
            isDev ? (
              <span key="3">
                {t("claude.modal.dev.3")}
                <span style={{ display: "block", marginTop: 4 }}>{codeEntry}</span>
              </span>
            ) : t("claude.modal.code.3"),
          ]} />
        </div>

        {/* Each Claude app holds its own credential: reconnecting this
            website after a Disconnect does NOT revive them — a recurring
            point of confusion, so it's stated where people reconnect. */}
        <div style={{ ...small, borderTop: "1px solid var(--border-1)", paddingTop: 8 }}>
          {t("claude.modal.reauth.note")}
        </div>

        {/* Collapsed fallback: manual pairing for clients without OAuth
            (hosted only — dev already has the code entry inline above). */}
        {!isDev && (
          <div style={{ borderTop: "1px solid var(--border-1)", paddingTop: 8 }}>
            <button
              onClick={() => setShowAdvanced(v => !v)}
              style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", cursor: "pointer",
                background: "none", border: "none", color: "var(--text-5)", padding: 0 }}
            >
              {showAdvanced ? "▾" : "▸"} {t("claude.modal.adv.pairing")}
            </button>
            {showAdvanced && <div style={{ marginTop: 8 }}>{pairingSection}</div>}
          </div>
        )}

        <button
          onClick={onClose}
          style={{
            alignSelf: "flex-end", fontSize: 10, cursor: "pointer",
            background: "none", border: "none", color: "var(--text-5)", padding: 2,
          }}
        >
          {t("claude.modal.close")}
        </button>
      </div>
    </div>
  );
}
