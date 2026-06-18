import { useRef, useEffect } from "react";
import { usePlanner }   from "../context/PlannerContext.jsx";
import { useLanguage }  from "../context/LanguageContext.jsx";
import { TText }        from "../context/TranslationContext.jsx";

function fireConfetti(originEl) {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:9999";
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const rect = originEl.getBoundingClientRect();
  const ox = rect.left + rect.width / 2;
  const oy = rect.top + rect.height / 2;

  const colors = ["#c41e3a", "#d4a017", "#2e7d32", "#1565c0", "#7b1fa2", "#e65100", "#00838f", "#f06292"];
  const particles = Array.from({ length: 150 }, () => ({
    x: ox, y: oy,
    vx: (Math.random() - 0.5) * 18,
    vy: -(Math.random() * 14 + 3),
    w: Math.random() * 9 + 4,
    h: Math.random() * 5 + 3,
    color: colors[Math.floor(Math.random() * colors.length)],
    angle: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.25,
    gravity: 0.38,
    life: 1,
    decay: Math.random() * 0.01 + 0.007,
  }));

  const animate = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let anyAlive = false;
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += p.gravity;
      p.angle += p.spin; p.life -= p.decay;
      if (p.life <= 0) return;
      anyAlive = true;
      ctx.save();
      ctx.globalAlpha = Math.min(p.life, 1);
      ctx.translate(p.x, p.y); ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (anyAlive) requestAnimationFrame(animate);
    else document.body.removeChild(canvas);
  };
  requestAnimationFrame(animate);
}

export default function GraduationRow() {
  const { gradSemId, currentSemId, SEMESTERS, isGraduated, setIsGraduated, isPhone } = usePlanner();
  const { t } = useLanguage();
  const rowRef = useRef(null);
  const prevGraduatedRef = useRef(isGraduated);

  const gradSem   = SEMESTERS.find(s => s.id === gradSemId);
  const gradLabel = gradSem?.label ?? gradSemId;

  const isReady = currentSemId === gradSemId && !isGraduated;

  // Fire confetti whenever graduation transitions false → true (covers both manual and auto).
  useEffect(() => {
    if (isGraduated && !prevGraduatedRef.current && rowRef.current) {
      fireConfetti(rowRef.current);
    }
    prevGraduatedRef.current = isGraduated;
  }, [isGraduated]);

  const handleGraduate = e => {
    e.stopPropagation();
    setIsGraduated(true);
  };

  const handleUngraduate = e => {
    e.stopPropagation();
    setIsGraduated(false);
  };

  if (isGraduated) {
    return (
      <div
        ref={rowRef}
        onClick={handleUngraduate}
        title="Click to undo graduation"
        style={{
          margin: "6px 0 16px",
          borderRadius: 8,
          background: "var(--card-bg)",
          border: "1.5px solid var(--success-border)",
          padding: "11px 20px",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: isPhone ? 16 : 22, lineHeight: 1 }}>🎓</span>
        {isPhone ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--success)" }}>{t("grad.row.done")}</span>
            <span style={{ fontSize: 9, fontWeight: 500, color: "var(--success)" }}><TText>{gradLabel}</TText></span>
          </div>
        ) : (
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--success)" }}>
            {t("grad.row.done")} · <TText>{gradLabel}</TText>
          </span>
        )}
        <span style={{ fontSize: isPhone ? 8 : 10, color: "var(--text-4)", marginLeft: 4 }}>{t("grad.row.undo")}</span>
      </div>
    );
  }

  return (
    <div
      ref={rowRef}
      style={{
        margin: "6px 0 16px",
        borderRadius: 8,
        border: isReady ? "1.5px solid var(--success-border)" : "1.5px dashed var(--border-2)",
        background: "var(--card-bg)",
        padding: "10px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        opacity: isReady ? 1 : 0.42,
        transition: "opacity 0.25s, border-color 0.25s, background 0.25s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: isPhone ? 14 : 18, lineHeight: 1 }}>🎓</span>
        {isPhone ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: isReady ? "var(--success)" : "var(--text-3)" }}>{t("grad.row.title")}</span>
            <span style={{ fontSize: 8, fontWeight: 500, color: isReady ? "var(--success)" : "var(--text-4)" }}><TText>{gradLabel}</TText></span>
          </div>
        ) : (
          <span style={{ fontSize: 12, fontWeight: 600, color: isReady ? "var(--success)" : "var(--text-3)" }}>
            {t("grad.row.title")} · <TText>{gradLabel}</TText>
          </span>
        )}
      </div>
      {isReady && (
        <button
          onClick={handleGraduate}
          style={{
            background: "var(--success)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "6px 18px",
            fontSize: isPhone ? 10 : 12,
            fontWeight: 700,
            cursor: "pointer",
            letterSpacing: "0.03em",
          }}
        >
          {t("grad.row.button")}
        </button>
      )}
    </div>
  );
}
