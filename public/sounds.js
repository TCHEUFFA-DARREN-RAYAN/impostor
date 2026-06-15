const GameSounds = (function () {
  let ctx = null;
  let muted = localStorage.getItem('impostor-muted') === 'true';
  let initialized = false;

  function init() {
    if (initialized) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      initialized = true;
    } catch (e) { /* Web Audio not supported */ }
  }

  function tone(freq, dur, type = 'sine', vol = 0.3, delay = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }

  function noise(dur, vol = 0.1, delay = 0) {
    if (!ctx || muted) return;
    const len = ctx.sampleRate * dur;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(g).connect(ctx.destination);
    src.start(t);
  }

  const lib = {
    chime()    { tone(880, 0.15, 'sine', 0.2); tone(1100, 0.2, 'sine', 0.2, 0.1); },
    whoosh()   { noise(0.4, 0.12); tone(250, 0.4, 'sine', 0.08); tone(800, 0.25, 'sine', 0.08, 0.15); },
    reveal()   { tone(440, 0.15, 'triangle', 0.25); tone(554, 0.15, 'triangle', 0.25, 0.15); tone(659, 0.3, 'triangle', 0.3, 0.3); },
    impostor() { tone(100, 0.6, 'sawtooth', 0.25); tone(80, 0.4, 'square', 0.15, 0.1); tone(150, 0.3, 'sawtooth', 0.2, 0.35); },
    ping()     { tone(1200, 0.1, 'sine', 0.18); tone(1600, 0.15, 'sine', 0.12, 0.08); },
    alert()    { tone(600, 0.12, 'square', 0.12); tone(800, 0.12, 'square', 0.12, 0.12); tone(600, 0.12, 'square', 0.12, 0.24); },
    click()    { tone(800, 0.05, 'square', 0.12); noise(0.03, 0.08); },
    drumroll() { for (let i = 0; i < 16; i++) { noise(0.07, 0.04 + i * 0.004, i * 0.1); tone(100 + i * 5, 0.07, 'triangle', 0.04, i * 0.1); } },
    victory()  { tone(523, 0.15, 'triangle', 0.22); tone(659, 0.15, 'triangle', 0.22, 0.15); tone(784, 0.15, 'triangle', 0.22, 0.3); tone(1047, 0.4, 'triangle', 0.28, 0.45); },
    defeat()   { tone(400, 0.3, 'sawtooth', 0.18); tone(300, 0.3, 'sawtooth', 0.18, 0.3); tone(200, 0.5, 'sawtooth', 0.22, 0.6); },
    fanfare()  { tone(523, 0.18, 'triangle', 0.18); tone(659, 0.18, 'triangle', 0.18, 0.18); tone(784, 0.18, 'triangle', 0.18, 0.36); tone(1047, 0.18, 'triangle', 0.22, 0.54); tone(784, 0.12, 'triangle', 0.18, 0.72); tone(1047, 0.5, 'triangle', 0.28, 0.84); },
  };

  return {
    init,
    play(name) { init(); if (lib[name]) lib[name](); },
    toggle() { muted = !muted; localStorage.setItem('impostor-muted', muted); return muted; },
    isMuted() { return muted; },
  };
})();
