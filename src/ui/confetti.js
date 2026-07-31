// Lightweight canvas confetti burst from an origin element's center.
// Shared by the graduation row and the onboarding tour's completion screen.
export function fireConfetti(originEl) {
  if (!originEl) return;
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
    else canvas.remove();
  };
  requestAnimationFrame(animate);
}
