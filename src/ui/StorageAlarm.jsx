// ═══════════════════════════════════════════════════════════════════
// STORAGE ALARM — the only warning in this app about an unrecoverable loss
//
// Plans live in this browser and nowhere else. A full store stops saving while the
// edit still appears on screen, and the student finds out on reload, with no way to
// know which edits survived. That is the failure this exists to pre-empt.
//
// ── Deliberately NOT a modal ────────────────────────────────────────
//
// `MigrationBanner` covers the screen because it is asking for a one-time action that
// must not be missed. This is the opposite case: the plan the student is looking at is
// the thing at risk, and blocking the view to say so would be both alarming and
// counterproductive — the useful response is to export or delete something, which
// needs the app. So it sits at the bottom, above the content, and never traps focus.
//
// ── And deliberately quiet ──────────────────────────────────────────
//
// It appears only when the numbers say something is wrong: a write has actually been
// rejected, or the origin is past `PRESSURE_RATIO` of its quota. Not merely when
// storage is evictable — that is true for most origins most of the time, and a
// warning shown to everyone forever is one nobody reads. Persistence is requested
// silently instead; see `storageHealth.js`.
//
// Dismissal is remembered in the very store that is under pressure, which is not an
// oversight: if that store is cleared the warning comes back, and coming back is the
// correct behaviour for a risk that has just been proven real.
// ═══════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { requestPersistence, storagePressure } from "../data/storageHealth.js";

const DISMISS_KEY = "numap.storageAlarm.dismissed";

export default function StorageAlarm() {
  const { t } = useLanguage();
  const [alarm, setAlarm] = useState(null);

  useEffect(() => {
    let live = true;
    (async () => {
      // Pure upside and no UI: a persisted origin is not evicted automatically. Asked
      // for on every load rather than once, because a browser that declined on the
      // first visit may grant it later as engagement builds.
      await requestPersistence();

      let dismissed = false;
      try { dismissed = localStorage.getItem(DISMISS_KEY) === "1"; } catch { /* no store */ }
      if (dismissed) return;

      const p = await storagePressure();
      if (live && p) setAlarm(p);
    })();
    return () => { live = false; };
  }, []);

  if (!alarm) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* nothing to do */ }
    setAlarm(null);
  };

  return (
    <div
      role="status"
      style={{
        position: "fixed", left: 12, right: 12, bottom: 12, zIndex: 9998,
        maxWidth: 460, margin: "0 auto",
        background: "var(--bg-surface)", border: "1px solid var(--border-2)",
        borderRadius: 10, padding: "11px 12px", boxShadow: "var(--shadow-modal)",
        display: "flex", flexDirection: "column", gap: 7,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-1)" }}>
        {t("storage.alarm.title")}
      </div>
      <div style={{
        fontSize: 11, color: "var(--text-2)",
        lineHeight: "calc(1.6 * var(--lh-scale, 1))",
      }}>
        {/* Two different facts and two different remedies: a store that is FULL has
            already stopped accepting edits, while one under pressure has not yet. */}
        {t(alarm.kind === "full" ? "storage.alarm.full" : "storage.alarm.pressure")}
      </div>
      <button
        onClick={dismiss}
        style={{
          alignSelf: "flex-end", padding: "5px 10px", borderRadius: 6,
          background: "transparent", border: "1px solid var(--border-2)",
          color: "var(--text-4)", fontSize: 11, fontWeight: 400, cursor: "pointer",
        }}
      >
        {t("storage.alarm.dismiss")}
      </button>
    </div>
  );
}
