// ═══════════════════════════════════════════════════════════════════
// MAINTENANCE NOTICE — the header strip that says a window is coming.
//
// ── Why it lives in the header, in the flow ─────────────────────────
//
// A floating toast was built first and was wrong twice over: it overlapped the
// storage alarm (the app's other non-modal notice, which owns the bottom-centre
// slot), and it was the kind of thing a student swipes away without reading.
// This is a fact about the page, so it belongs to the page — it is the first
// row of the sticky header, above the plan, full width, in normal flow. It
// pushes content down instead of covering it, which means it can never hide a
// course card and never needs a z-index. `smoothScroll.js` already measures the
// header's height rather than assuming it, so an extra row costs nothing.
//
// ── Why it collapses instead of closing ─────────────────────────────
//
// A dismissed announcement is normally gone. That is wrong for a SCHEDULED
// event: the student who reads "maintenance at 2 AM" at noon and dismisses it
// has not stopped needing to know when 2 AM is, and the alternative is asking
// them to remember. So dismissing collapses the detail and leaves the one-line
// label with its countdown. Nothing about the window becomes unreachable, and
// nothing about it nags.
//
// ── Why dismissal is keyed on PHASE, not just the window ────────────
//
// `id:phase`, so dismissing the day-ahead announcement does not also silence
// the "starts in 30 minutes" escalation — two different messages, and only the
// second is urgent. This is why phases are data (src/core/maintenance.js)
// rather than a boolean plus a countdown.
//
// ── Why the backup offer is conditional ─────────────────────────────
//
// Because the honest answer is usually "you don't need one". Plans live in this
// browser's localStorage; a deploy cannot touch them. A scary "SAVE YOUR WORK"
// on every routine window is crying wolf, and the cost of crying wolf is that
// the one window where it matters — a storage migration, `backup:
// "recommended"` — gets ignored too. So the schedule decides whether to ask,
// the copy says plainly that plans are local either way, and the button is the
// same whole-library export the plan library already offers.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { usePlanner } from "../context/PlannerContext.jsx";
import { useMaintenance } from "../context/MaintenanceContext.jsx";
import { formatRelative, formatWindow } from "../core/maintenanceFormat.js";

const DISMISS_KEY = "numap.maintenance.dismissed";
/** Keep the record small — it lives in the store StorageAlarm warns about. */
const DISMISS_MAX = 8;

/**
 * Windows this browser was actually present for.
 *
 * "We're back" is only news to someone who was here when it went down. Without
 * this, a `restored` phase of 12 h — what the outage playbook sets — greeted
 * every fresh visitor for half a day with a notice about an event they never
 * experienced, and the reload button it carries would have been advice about a
 * stale bundle they never loaded.
 */
const SEEN_KEY = "numap.maintenance.seen";

/**
 * How long the "we're back" strip stays before retiring itself.
 *
 * Five seconds. It is an acknowledgement, not a status: one glance and it has
 * done its job. Dismissing it is final — unlike every other phase, where × only
 * collapses the detail and keeps the countdown reachable, because a window that
 * has ENDED has nothing left to look up.
 */
const RESTORED_VISIBLE_MS = 5e3;

function readSeen() {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
    return Array.isArray(v) ? v.filter(x => typeof x === "string") : [];
  } catch { return []; }
}

function markSeen(id) {
  try {
    const list = readSeen();
    if (list.includes(id)) return;
    localStorage.setItem(SEEN_KEY, JSON.stringify([...list, id].slice(-DISMISS_MAX)));
  } catch { /* no store — the strip simply won't claim they were here */ }
}

function readDismissed() {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]");
    return Array.isArray(v) ? v.filter(x => typeof x === "string") : [];
  } catch { return []; }
}

function writeDismissed(list) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify(list.slice(-DISMISS_MAX))); }
  catch { /* a full store is not a reason to fail rendering a notice */ }
}

/** Tone per severity — and per PHASE for `restored`, which is good news. */
function toneOf(phase, severity) {
  if (phase === "restored") return { fg: "var(--success)", bg: "var(--success-bg)", bd: "var(--success-border)" };
  if (severity === "offline") return { fg: "var(--error)", bg: "var(--error-bg)", bd: "var(--error-border-2)" };
  if (severity === "degraded") return { fg: "var(--warn)", bg: "var(--warn-bg)", bd: "var(--warn-border)" };
  return { fg: "var(--link-1)", bg: "var(--link-bg)", bd: "var(--link-border)" };
}

export default function MaintenanceNotice() {
  const { t, locale, locales } = useLanguage();
  const m = useMaintenance();
  const { exportLibraryJSON } = usePlanner();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [saved, setSaved] = useState(false);
  const [restoredExpired, setRestoredExpired] = useState(false);

  // Declared before the early returns below, because hooks must be — and read
  // off `m` rather than the window object so the deps are primitives.
  const phase = m.phase;
  const winId = m.window?.id ?? null;

  // Remember that this browser was here for it. `imminent` counts: someone
  // watching the countdown ten minutes out is exactly who the "we're back"
  // strip is for.
  useEffect(() => {
    if (winId && (phase === "active" || phase === "imminent")) markSeen(winId);
  }, [winId, phase]);

  // Retire the "we're back" strip on its own. It is an acknowledgement, not a
  // status — once read it has no job, and it should not outlive the glance.
  useEffect(() => {
    if (phase !== "restored") return;
    const id = setTimeout(() => setRestoredExpired(true), RESTORED_VISIBLE_MS);
    return () => clearTimeout(id);
  }, [phase, winId]);

  // The full-screen page is already saying all of this, at length.
  if (m.phase === "none" || m.blocking) return null;

  // "We're back" goes only to whoever was here when it went down, only for a
  // few seconds, and never again once dismissed. Everyone else gets the
  // ordinary app with nothing to explain.
  if (m.phase === "restored") {
    const gone = restoredExpired
      || !readSeen().includes(m.window.id)
      || dismissed.includes(`${m.window.id}:restored`);
    if (gone) return null;
  }

  const key = `${m.window.id}:${m.phase}`;
  const open = !dismissed.includes(key);
  const rtl = (locales.find(l => l.code === locale)?.dir ?? "ltr") === "rtl";
  const tone = toneOf(m.phase, m.severity);

  // `active` counts toward the forecast return (`etaMs`), `restored` toward the
  // end that just passed, the rest toward the start. While overrunning there is
  // no number to count to, so the label says that instead.
  const when = formatRelative(
    m.phase === "active" ? m.etaMs : m.phase === "restored" ? m.endsInMs : m.startsInMs,
    locale,
  );
  const label = m.overrunning ? t("maint.overrun") : t(`maint.label.${m.phase}`, { when });

  const setOpen = (want) => {
    const next = want ? dismissed.filter(k => k !== key) : [...dismissed.filter(k => k !== key), key];
    setDismissed(next);
    writeDismissed(next);
  };

  const features = (m.window.features.length ? m.window.features : ["catalog"])
    .map(f => t(`maint.feature.${f}`)).join(t("maint.feature.join"));

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        direction: rtl ? "rtl" : "ltr",
        background: tone.bg, border: `1px solid ${tone.bd}`, borderRadius: 8,
        padding: open ? "6px 9px 8px" : "5px 9px",
        display: "flex", flexDirection: "column", gap: 6,
      }}
    >
      {/* ── The line that is always there ──────────────────────────── */}
      {/* WRAPS, does not truncate. The first version put the label and the
          absolute window on one nowrap line with an ellipsis, which read fine on
          a desktop and became "Maintenance sta…  Sat, Aug 22, 8:16 PM …" at
          390 px — clipping the countdown, which is the single most useful token
          on the strip. Two short lines on a phone beat one unreadable one. The
          toggle stays outside the wrapping column so it can never wrap alone. */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 7, minWidth: 0 }}>
        <span style={{ width: 6, height: 6, borderRadius: 99, background: tone.fg, flexShrink: 0, marginTop: 5 }} />
        <div style={{
          flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap",
          alignItems: "baseline", columnGap: 8, rowGap: 2,
        }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text-1)" }}>{label}</span>
          {/* A countdown alone is not a schedule: the window is stated in full,
              in the reader's own timezone, whenever there is one. */}
          {m.phase !== "restored" && (
            <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-3)" }}>
              {formatWindow(m.window.start, m.window.end, locale)}
            </span>
          )}
        </div>
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          title={open ? t("maint.dismiss") : t("maint.details")}
          style={{
            background: "transparent", border: "none", cursor: "pointer", padding: "0 2px",
            color: tone.fg, fontSize: 10, fontWeight: 700, flexShrink: 0, fontFamily: "inherit",
          }}
        >{open ? "×" : t("maint.details")}</button>
      </div>

      {/* ── The detail, until dismissed ────────────────────────────── */}
      {open && (
        <div style={{
          display: "flex", flexDirection: "column", gap: 6,
          fontSize: 11, color: "var(--text-2)",
          lineHeight: "calc(1.55 * var(--lh-scale, 1))",
        }}>
          <div>
            {m.phase === "restored" ? t("maint.restored.body") : (
              <>
                {t(`maint.kind.${m.kind}`)}{" "}
                {m.severity === "degraded"
                  ? t("maint.effect.degraded", { features })
                  : t(`maint.effect.${m.severity}`)}
                {" "}
                {/* Said on every window, not only the ones with a backup ask:
                    the single most useful fact a student can have here is that
                    this cannot cost them their plan. */}
                <span style={{ color: "var(--text-3)" }}>{t("maint.safe")}</span>
              </>
            )}
          </div>

          {m.backup && <div>{t(`maint.backup.${m.backup}`)}</div>}

          {(m.backup || m.phase === "restored") && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {m.backup && (
                <button
                  onClick={() => { try { exportLibraryJSON(); setSaved(true); } catch { /* the export path reports its own failures */ } }}
                  style={{
                    padding: "4px 9px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
                    background: saved ? "transparent" : "var(--bg-surface)",
                    border: `1px solid ${saved ? "var(--border-2)" : tone.bd}`,
                    color: saved ? "var(--text-4)" : "var(--text-1)",
                    fontSize: 10, fontWeight: 700,
                  }}
                >{saved ? t("maint.backup.done") : t("maint.backup.action")}</button>
              )}
              {/* After a window, the useful act is reloading: a tab left open
                  through a deploy is running a bundle that no longer exists. */}
              {m.phase === "restored" && (
                <button
                  onClick={() => window.location.reload()}
                  style={{
                    padding: "4px 9px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
                    background: "var(--bg-surface)", border: `1px solid ${tone.bd}`,
                    color: "var(--text-1)", fontSize: 10, fontWeight: 700,
                  }}
                >{t("maint.reload")}</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
