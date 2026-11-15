// Card flip that reveals your word (and whether you're the impostor).
import { $ } from '../dom.js';
import { shake, vibrate } from '../ui.js';
import { sounds } from '../sounds.js';

let currentKey = null;
let flipped = false;
let timer = 0;

function flip(app) {
  if (flipped || !currentKey || !app.game) return;
  flipped = true;
  $('reveal-card').classList.add('flipped');
  $('reveal-hint').textContent = 'Get ready…';
  sounds.play('reveal');

  const isImpostor = app.game.you.isImpostor;
  if (isImpostor) {
    setTimeout(() => {
      shake();
      sounds.play('impostor');
      vibrate([200, 100, 200, 100, 200]);
    }, 600);
  }

  const key = currentKey;
  clearTimeout(timer);
  timer = setTimeout(() => app.markRevealed(key), isImpostor ? 3500 : 2500);
}

export function init(app) {
  $('reveal-card').addEventListener('click', () => flip(app));
}

export function render(app, g) {
  const key = app.roundKey(g);
  if (key === currentKey) return;
  currentKey = key;
  flipped = false;
  clearTimeout(timer);

  const card = $('reveal-card');
  card.classList.remove('flipped');
  $('reveal-hint').textContent = 'Keep your screen hidden from others';

  const isImpostor = g.you.isImpostor;
  $('reveal-word').textContent = g.you.word || '---';
  $('reveal-role').textContent = isImpostor ? 'YOU ARE THE IMPOSTOR' : 'YOUR WORD IS';
  $('reveal-role').classList.toggle('is-impostor', isImpostor);
  $('reveal-word').classList.toggle('is-impostor', isImpostor);
  $('reveal-back').classList.toggle('is-impostor', isImpostor);
}
