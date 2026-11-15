// Animated background stars. Pauses when the tab is hidden and stays still
// for users who prefer reduced motion.

export function startStarfield(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const COLORS = ['#ffffff', '#aabbff', '#ffddaa', '#ffaaaa', '#aaffdd'];
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let stars = [];
  let width = 0;
  let height = 0;
  let raf = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(140, Math.max(60, (width * height) / 9000)));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 1.6 + 0.4,
      speed: Math.random() * 0.22 + 0.04,
      alpha: Math.random() * 0.7 + 0.2,
      phase: Math.random() * Math.PI * 2,
      twinkle: Math.random() * 0.018 + 0.004,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    for (const s of stars) {
      if (!still) {
        s.y += s.speed;
        s.phase += s.twinkle;
        if (s.y > height + 5) {
          s.y = -5;
          s.x = Math.random() * width;
        }
      }
      ctx.globalAlpha = s.alpha * (0.5 + 0.5 * Math.sin(s.phase));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (!still) raf = requestAnimationFrame(draw);
  }

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      if (still) draw();
    }, 150);
  });
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(raf);
    if (!document.hidden) draw();
  });

  resize();
  draw();
}
