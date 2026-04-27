/**
 * Particle text background — impostor game theme.
 * Ported from React/TypeScript to vanilla JS.
 * Self-contained IIFE: inject this script on any page for a full-screen canvas background.
 */
(function () {
  // ─── Game words & colour palette ─────────────────────────────────────────
  const WORDS = ['IMPOSTOR', 'REPORT', 'VOTE', 'EJECT'];
  const PALETTE = [
    { r: 88,  g: 101, b: 242 }, // indigo   – primary
    { r: 123, g: 138, b: 255 }, // violet   – accent
    { r: 255, g:  71, b:  87 }, // red      – danger / impostor
    { r:  46, g: 213, b: 115 }, // green    – safe / crew
    { r:   0, g: 200, b: 255 }, // cyan     – info
    { r: 255, g: 165, b:   2 }, // amber    – warning
  ];

  const PIXEL_STEPS  = 6;     // sample every N pixels (higher = fewer particles)
  const FRAME_DELAY  = 260;   // frames between word changes (~4 s at 60 fps)
  const BG_ALPHA     = 0.12;  // motion-blur fade per frame

  // ─── State ───────────────────────────────────────────────────────────────
  let particles  = [];
  let frameCount = 0;
  let wordIndex  = 0;
  let animId     = null;

  // ─── Canvas setup ────────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;';
  document.body.insertBefore(canvas, document.body.firstChild);

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      showWord(WORDS[wordIndex]);
    }, 150);
  });

  // ─── Helpers ─────────────────────────────────────────────────────────────
  function randomEdgePos() {
    const cx  = canvas.width  / 2;
    const cy  = canvas.height / 2;
    const mag = (canvas.width + canvas.height) / 2;
    const rx  = Math.random() * canvas.width;
    const ry  = Math.random() * canvas.height;
    const dx  = rx - cx;
    const dy  = ry - cy;
    const m   = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: cx + (dx / m) * mag, y: cy + (dy / m) * mag };
  }

  function randomPalette() {
    return PALETTE[Math.floor(Math.random() * PALETTE.length)];
  }

  // ─── Particle class ──────────────────────────────────────────────────────
  class Particle {
    constructor() {
      this.pos    = { x: 0, y: 0 };
      this.vel    = { x: 0, y: 0 };
      this.acc    = { x: 0, y: 0 };
      this.target = { x: 0, y: 0 };

      this.closeEnough = 100;
      this.maxSpeed    = 1.0;
      this.maxForce    = 0.1;
      this.isKilled    = false;

      this.startColor  = { r: 0, g: 0, b: 0 };
      this.targetColor = { r: 0, g: 0, b: 0 };
      this.colorWeight = 0;
      this.blendRate   = 0.01;
    }

    move() {
      const dx   = this.target.x - this.pos.x;
      const dy   = this.target.y - this.pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const prox = dist < this.closeEnough ? dist / this.closeEnough : 1;
      const m    = dist || 1;

      const tx = (dx / m) * this.maxSpeed * prox;
      const ty = (dy / m) * this.maxSpeed * prox;

      let sx = tx - this.vel.x;
      let sy = ty - this.vel.y;
      const sm = Math.sqrt(sx * sx + sy * sy) || 1;
      sx = (sx / sm) * this.maxForce;
      sy = (sy / sm) * this.maxForce;

      this.acc.x += sx;
      this.acc.y += sy;
      this.vel.x += this.acc.x;
      this.vel.y += this.acc.y;
      this.pos.x += this.vel.x;
      this.pos.y += this.vel.y;
      this.acc.x  = 0;
      this.acc.y  = 0;
    }

    draw(ctx) {
      if (this.colorWeight < 1) {
        this.colorWeight = Math.min(this.colorWeight + this.blendRate, 1);
      }
      const t = this.colorWeight;
      const r = Math.round(this.startColor.r + (this.targetColor.r - this.startColor.r) * t);
      const g = Math.round(this.startColor.g + (this.targetColor.g - this.startColor.g) * t);
      const b = Math.round(this.startColor.b + (this.targetColor.b - this.startColor.b) * t);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(this.pos.x, this.pos.y, 2, 2);
    }

    kill() {
      if (!this.isKilled) {
        const rp = randomEdgePos();
        this.target.x = rp.x;
        this.target.y = rp.y;
        const t = this.colorWeight;
        this.startColor = {
          r: this.startColor.r + (this.targetColor.r - this.startColor.r) * t,
          g: this.startColor.g + (this.targetColor.g - this.startColor.g) * t,
          b: this.startColor.b + (this.targetColor.b - this.startColor.b) * t,
        };
        this.targetColor = { r: 0, g: 0, b: 0 };
        this.colorWeight = 0;
        this.isKilled    = true;
      }
    }
  }

  // ─── Word rendering ───────────────────────────────────────────────────────
  function showWord(word) {
    const off  = document.createElement('canvas');
    off.width  = canvas.width;
    off.height = canvas.height;
    const ctx2 = off.getContext('2d');

    const fontSize = Math.max(48, Math.min(Math.floor(canvas.width / 5.5), 160));
    /* Place the word in the upper third so a centered menu card does not sit on the whole string */
    const textY         = Math.max(fontSize, canvas.height * 0.18);
    ctx2.fillStyle     = 'white';
    ctx2.font          = `900 ${fontSize}px Nunito, Arial, sans-serif`;
    ctx2.textAlign     = 'center';
    ctx2.textBaseline  = 'middle';
    ctx2.fillText(word, canvas.width / 2, textY);

    const data     = ctx2.getImageData(0, 0, canvas.width, canvas.height).data;
    const newColor = randomPalette();

    // Collect lit pixel indexes and shuffle for fluid motion
    const indexes = [];
    for (let i = 0; i < data.length; i += PIXEL_STEPS * 4) {
      if (data[i + 3] > 0) indexes.push(i);
    }
    for (let i = indexes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
    }

    let pi = 0;
    for (const idx of indexes) {
      const x = (idx / 4) % canvas.width;
      const y = Math.floor(idx / 4 / canvas.width);
      let p;

      if (pi < particles.length) {
        p          = particles[pi];
        p.isKilled = false;
        pi++;
      } else {
        p           = new Particle();
        const rp    = randomEdgePos();
        p.pos.x     = rp.x;
        p.pos.y     = rp.y;
        p.maxSpeed  = Math.random() * 6 + 4;
        p.maxForce  = p.maxSpeed * 0.05;
        p.blendRate = Math.random() * 0.025 + 0.003;
        particles.push(p);
      }

      const t = p.colorWeight;
      p.startColor = {
        r: p.startColor.r + (p.targetColor.r - p.startColor.r) * t,
        g: p.startColor.g + (p.targetColor.g - p.startColor.g) * t,
        b: p.startColor.b + (p.targetColor.b - p.startColor.b) * t,
      };
      p.targetColor  = newColor;
      p.colorWeight  = 0;
      p.target.x     = x;
      p.target.y     = y;
    }

    // Kill excess particles from previous word
    for (let i = pi; i < particles.length; i++) {
      particles[i].kill();
    }
  }

  // ─── Animation loop ───────────────────────────────────────────────────────
  function animate() {
    const ctx = canvas.getContext('2d');

    // Fade to black each frame → motion-blur trail effect
    ctx.fillStyle = `rgba(0,0,0,${BG_ALPHA})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.move();
      p.draw(ctx);

      // Prune dead particles that have left the viewport
      if (p.isKilled && (
        p.pos.x < -10 || p.pos.x > canvas.width  + 10 ||
        p.pos.y < -10 || p.pos.y > canvas.height + 10
      )) {
        particles.splice(i, 1);
      }
    }

    frameCount++;
    if (frameCount % FRAME_DELAY === 0) {
      wordIndex = (wordIndex + 1) % WORDS.length;
      showWord(WORDS[wordIndex]);
    }

    animId = requestAnimationFrame(animate);
  }

  // ─── Init (wait for Google Font to load so canvas text matches UI) ────────
  function init() {
    showWord(WORDS[wordIndex]);
    animate();
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(init);
  } else {
    // Fallback: slight delay for font to settle
    setTimeout(init, 300);
  }
})();
