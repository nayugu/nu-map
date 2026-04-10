// ═══════════════════════════════════════════════════════════════════
// LOADING SCREEN
// ═══════════════════════════════════════════════════════════════════
import { usePort }       from "../context/InstitutionContext.jsx";
import { IInstitution } from "../ports/IInstitution.js";
import { useLanguage }  from "../context/LanguageContext.jsx";
import { storageKey }   from "../data/persistence.js";

export default function LoadingScreen({ loadErr, loadPct }) {
  const institution = usePort(IInstitution);
  const { t } = useLanguage();
  const handleRetry = () => {
    try { localStorage.removeItem(storageKey(institution.storagePrefix)); } catch {}
    window.location.reload();
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100vh", background: "var(--bg-app)",
      color: "var(--text-3)", fontFamily: "'Inter', system-ui, sans-serif", gap: 16,
    }}>
      {loadErr ? (
        <>
          <div style={{ fontSize: 32 }}>⚠️</div>
          <div style={{ color: "var(--error-text)", fontSize: 14, fontWeight: 700 }}>
            {t("loading.error.title")}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-4)", maxWidth: 420, textAlign: "center", lineHeight: 1.6 }}>
            {loadErr}<br />
            <span style={{ fontSize: 11 }}>
              {t("loading.error.hint")}
            </span>
          </div>
          <button
            onClick={handleRetry}
            style={{
              marginTop: 8, padding: "6px 20px", borderRadius: 6,
              border: "1px solid var(--border-2)", background: "var(--bg-surface)",
              color: "var(--text-2)", cursor: "pointer", fontSize: 12,
            }}
          >{t("loading.error.retry")}</button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-2)", letterSpacing: "-0.02em" }}>
            {institution.appName}
          </div>
          <div style={{ width: 260, height: 4, background: "var(--border-1)", borderRadius: 99, overflow: "hidden" }}>
            <div style={{
              width: `${loadPct}%`, height: "100%",
              background: "linear-gradient(90deg,var(--active),var(--link-2))",
              transition: "width 0.5s", borderRadius: 99,
            }} />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-4)" }}>{t("loading.progress")}</div>
          <div style={{ fontSize: 10, color: "var(--text-5)" }}>{t("loading.note")}</div>
        </>
      )}
    </div>
  );
}
