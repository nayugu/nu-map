import { usePlanner } from "../context/PlannerContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";

export default function PalettePanel() {
  const {
    palette, removeFromPalette, onDropPalette,
    showPalette, setShowPalette,
    dragInfo, onDragStart,
    effectiveCourseMap,
  } = usePlanner();
  const { t } = useLanguage();

  const isDragTarget = dragInfo?.type === "course" && !palette.includes(dragInfo.id);

  if (!showPalette) {
    return (
      <div
        onClick={() => setShowPalette(true)}
        style={{
          width: 18, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--bg-surface)",
          borderRight: "1px solid var(--border-1)",
          cursor: "pointer",
          userSelect: "none",
        }}
        title="Show scratch pad"
      >
        <span style={{ fontSize: 8, color: "var(--text-5)", writingMode: "vertical-rl", letterSpacing: "0.08em", fontWeight: 700, textTransform: "uppercase" }}>{t("palette.title")}</span>
      </div>
    );
  }

  return (
    <div
      data-drop-palette="true"
      onDragOver={e => { if (isDragTarget) e.preventDefault(); }}
      onDrop={onDropPalette}
      style={{
        width: 100, flexShrink: 0,
        display: "flex", flexDirection: "column",
        background: isDragTarget ? "var(--active-hov-bg)" : "var(--bg-surface)",
        borderRight: "1px solid var(--border-1)",
        transition: "background 0.12s",
      }}
    >
      {/* Sticky header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 10,
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border-2)",
        padding: "10px 6px 5px",
        display: "flex", alignItems: "center",
        userSelect: "none",
      }}>
        <span style={{ flex: 1, fontSize: 8, fontWeight: 700, color: "var(--text-5)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{t("palette.title")}</span>
        <span
          onClick={() => setShowPalette(false)}
          style={{ fontSize: 9, color: "var(--text-5)", cursor: "pointer", padding: "0 2px", lineHeight: 1 }}
          title="Hide scratch pad"
        >‹</span>
      </div>

      {/* Scrollable chip list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "5px 4px", display: "flex", flexDirection: "column", gap: 3 }}>
        {palette.length === 0 && (
          <div style={{ fontSize: 8, color: "var(--text-5)", textAlign: "center", padding: "14px 4px", lineHeight: 1.5 }}>
            {t("palette.empty")}
          </div>
        )}
        {palette.map(courseId => {
          const course = effectiveCourseMap[courseId];
          if (!course) return null;
          return (
            <div
              key={courseId}
              draggable
              data-drag-id={courseId}
              data-drag-type="course"
              data-drag-from="palette"
              onDragStart={e => onDragStart(e, courseId, "course", "palette")}
              style={{
                position: "relative",
                background: "var(--card-bg)",
                border: "1px solid var(--border-card)",
                borderRadius: 4,
                padding: "3px 18px 3px 8px",
                cursor: "grab", userSelect: "none",
                display: "flex", alignItems: "center",
                minHeight: 22, overflow: "hidden",
              }}
            >
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: course.color, borderRadius: "3px 0 0 3px" }} />
              <span style={{ fontSize: 9, fontWeight: 800, color: course.color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                {course.code}
              </span>
              <button
                onClick={e => { e.stopPropagation(); removeFromPalette(courseId); }}
                style={{
                  position: "absolute", right: 2, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 10, color: "var(--text-5)", padding: "0 2px",
                  lineHeight: 1, userSelect: "none",
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
