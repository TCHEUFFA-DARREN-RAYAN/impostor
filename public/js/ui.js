// Reusable UI pieces: avatars, toasts, confirm dialog, confetti, haptics.
import { $, h } from './dom.js';

// Crew colours. Index is assigned by the server (must match COLOR_COUNT in src/Room.js).
export const PALETTE = [
  ['#c51111', '#ff5a5a'], ['#132ed2', '#5470ff'], ['#127f2d', '#2ed573'], ['#c2b613', '#ffe14d'],
  ['#159e8e', '#38fedb'], ['#6b31bc', '#a55eea'], ['#ed54ba', '#ff8fd5'], ['#ef7d0e', '#ffad4d'],
  ['#50b039', '#8af279'], ['#72491e', '#cd853f'], ['#6b2c3b', '#c4566f'], ['#ec7578', '#ffb3b5'],
  ['#3f474e', '#8b96a1'], ['#d6e0f0', '#ffffff'], ['#5a3d8a', '#9f7ae0'], ['#0f6a7a', '#3cc4dc'],
  ['#a3164d', '#ff4f93'], ['#7a8c00', '#c8e02a'], ['#1f3a5f', '#4d7cc2'], ['#8a5a00', '#e8a33a'],
];

export const colorOf = (index) => PALETTE[(Number(index) || 0) % PALETTE.length];

const initialOf = (name) => (Array.from(String(name || '?').trim())[0] || '?').toUpperCase();

/** size: xs | sm | md | lg | xl */
export function avatar(person, size = 'md', extraClass = '') {
  const [bg, ring] = colorOf(person && person.color);
  return h(
    'span',
    {
      class: `avatar avatar-${size} ${extraClass}`.trim(),
      style: { '--av-bg': bg, '--av-ring': ring },
      'aria-hidden': 'true',
    },
    initialOf(person && person.name)
  );
}

export function updateAvatar(el, person) {
  const [bg, ring] = colorOf(person.color);
  el.style.setProperty('--av-bg', bg);
  el.style.setProperty('--av-ring', ring);
  const letter = initialOf(person.name);
  if (el.textContent !== letter) el.textContent = letter;
}

// ─── Toasts ───────────────────────────────────────────────────────────────
export function toast(message, type = 'error', duration = 3500) {
  if (!message) return;
  const box = $('toasts');
  // Don't stack identical messages.
  for (const t of box.children) if (t.textContent === message && !t.classList.contains('toast-exit')) return;
  const el = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
  box.append(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('toast-exit');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ─── Dialogs ──────────────────────────────────────────────────────────────
export function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

export function closeDialog(dialog) {
  if (dialog.open) dialog.close();
}

/** Wires generic behaviour: [data-close] buttons and clicking the backdrop. */
export function setupDialog(dialog) {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) closeDialog(dialog);
  });
}

let confirmResolve = null;

/** Promise-based confirm dialog. Resolves true/false. */
export function confirmAction({ title, message = '', confirmText = 'Yes', danger = false }) {
  const dialog = $('dialog-confirm');
  $('confirm-title').textContent = title;
  $('confirm-message').textContent = message;
  $('confirm-message').hidden = !message;
  const ok = $('confirm-ok');
  ok.textContent = confirmText;
  ok.className = `btn ${danger ? 'btn-red' : 'btn-blue'}`;
  if (confirmResolve) confirmResolve(false);
  openDialog(dialog);
  ok.focus();
  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

export function setupConfirm() {
  const dialog = $('dialog-confirm');
  const finish = (value) => {
    const resolve = confirmResolve;
    confirmResolve = null;
    closeDialog(dialog);
    if (resolve) resolve(value);
  };
  $('confirm-ok').addEventListener('click', () => finish(true));
  $('confirm-cancel').addEventListener('click', () => finish(false));
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) finish(false);
  });
  dialog.addEventListener('close', () => finish(false));
}

/** Closes every open dialog (e.g. when the room disappears underneath). */
export function closeAllDialogs() {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
}

// ─── Buttons ──────────────────────────────────────────────────────────────
/**
 * Marks a button busy while an async action runs and ignores repeat taps.
 * Deliberately doesn't touch `disabled`, which belongs to the screen's render.
 */
export async function withBusy(button, action) {
  if (!button) return action();
  if (button.dataset.busy === '1') return undefined;
  button.dataset.busy = '1';
  button.classList.add('is-busy');
  button.setAttribute('aria-busy', 'true');
  try {
    return await action();
  } finally {
    button.dataset.busy = '';
    button.classList.remove('is-busy');
    button.removeAttribute('aria-busy');
  }
}

// ─── Haptics & effects ────────────────────────────────────────────────────
export function vibrate(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* not supported */
  }
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function shake() {
  if (prefersReducedMotion()) return;
  document.body.classList.remove('shake');
  void document.body.offsetWidth;
  document.body.classList.add('shake');
  setTimeout(() => document.body.classList.remove('shake'), 600);
}

let confettiRunning = false;
export function confetti() {
  if (confettiRunning || prefersReducedMotion()) return;
  const cv = $('confetti');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = window.innerWidth * dpr;
  cv.height = window.innerHeight * dpr;
  cv.style.display = 'block';
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = window.innerWidth;
  const H = window.innerHeight;
  const colors = ['#ff4757', '#5865f2', '#2ed573', '#ffd166', '#ff9f43', '#a55eea', '#ff6b9d'];
  const pieces = Array.from({ length: 140 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H - H,
    w: Math.random() * 10 + 4,
    h: Math.random() * 6 + 3,
    c: colors[Math.floor(Math.random() * colors.length)],
    vx: (Math.random() - 0.5) * 5,
    vy: Math.random() * 3 + 2,
    r: Math.random() * 360,
    rs: (Math.random() - 0.5) * 12,
  }));
  confettiRunning = true;
  let frame = 0;
  (function loop() {
    ctx.clearRect(0, 0, W, H);
    for (const p of pieces) {
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.rs;
      p.vy += 0.06;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.r * Math.PI) / 180);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (++frame < 220) requestAnimationFrame(loop);
    else {
      cv.style.display = 'none';
      confettiRunning = false;
    }
  })();
}

/** Copies text, falling back to a hidden textarea on older browsers. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
