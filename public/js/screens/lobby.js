// Lobby: room code, host settings, player list.
import { $, h, show, setText, renderList } from '../dom.js';
import { avatar, updateAvatar, confirmAction, copyText, toast } from '../ui.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const inviteUrl = (code) => `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;

function flashLabel(button, text) {
  const original = button.dataset.label || button.textContent;
  button.dataset.label = original;
  button.textContent = text;
  clearTimeout(button._flash);
  button._flash = setTimeout(() => {
    button.textContent = original;
  }, 1800);
}

export function init(app) {
  $('btn-copy-code').addEventListener('click', async (e) => {
    if (!app.game) return;
    const ok = await copyText(app.game.roomCode);
    flashLabel(e.currentTarget, ok ? 'Copied!' : 'Copy failed');
  });

  $('btn-share').addEventListener('click', async (e) => {
    if (!app.game) return;
    const code = app.game.roomCode;
    const url = inviteUrl(code);
    if (navigator.share) {
      try {
        await navigator.share({ title: 'IMPOSTOR', text: `Join my IMPOSTOR game — room code ${code}`, url });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    const ok = await copyText(url);
    flashLabel(e.currentTarget, ok ? 'Link copied!' : 'Copy failed');
  });

  const step = (delta) => {
    const g = app.game;
    if (!g || !g.you.isHost) return;
    const { impostorCount, minImpostors, maxImpostors } = g.settings;
    const next = Math.max(minImpostors, Math.min(maxImpostors, impostorCount + delta));
    if (next === impostorCount) return;
    g.settings.impostorCount = next; // optimistic; the server echoes the real value
    render(app, g);
    app.act(null, 'lobby:setImpostors', { count: next });
  };
  $('btn-imp-minus').addEventListener('click', () => step(-1));
  $('btn-imp-plus').addEventListener('click', () => step(1));

  $('btn-start').addEventListener('click', (e) => app.act(e.currentTarget, 'game:start'));
  $('btn-leave-lobby').addEventListener('click', () => app.leave());

  $('lobby-players').addEventListener('click', async (e) => {
    const button = e.target.closest('.btn-kick');
    if (!button || !app.game) return;
    const playerId = button.closest('li').dataset.key;
    const target = app.game.players.find((p) => p.id === playerId);
    if (!target) return;
    const ok = await confirmAction({
      title: `Remove ${target.name}?`,
      message: 'They will be sent back to the home screen.',
      confirmText: 'Remove',
      danger: true,
    });
    if (!ok) return;
    const res = await app.act(button, 'lobby:kick', { playerId });
    if (res && res.ok) toast(`${res.name} was removed.`, 'info');
  });
}

function createTile() {
  return h(
    'li',
    { class: 'player-tile' },
    avatar({ name: '?', color: 0 }, 'lg'),
    h('span', { class: 'player-name' }),
    h('span', { class: 'player-tags' })
  );
}

function updateTile(node, p, g) {
  const isMe = p.id === g.you.id;
  node.classList.toggle('is-me', isMe);
  node.classList.toggle('is-offline', !p.isConnected);
  updateAvatar(node.querySelector('.avatar'), p);
  setText(node.querySelector('.player-name'), p.name);

  const tags = [];
  if (p.isHost) tags.push(h('span', { class: 'tag tag-host' }, 'HOST'));
  if (isMe) tags.push(h('span', { class: 'tag tag-me' }, 'YOU'));
  if (!p.isConnected) tags.push(h('span', { class: 'tag tag-offline' }, 'OFFLINE'));
  if (p.score > 0) tags.push(h('span', { class: 'tag tag-score' }, `${p.score} pts`));
  node.querySelector('.player-tags').replaceChildren(...tags);

  const canKick = g.you.isHost && !p.isHost;
  let kick = node.querySelector('.btn-kick');
  if (canKick && !kick) {
    kick = h('button', { class: 'btn-kick', type: 'button', 'aria-label': `Remove ${p.name}` }, '✕');
    node.append(kick);
  } else if (!canKick && kick) kick.remove();
}

export function render(app, g) {
  const { impostorCount, minImpostors, maxImpostors, minPlayers, maxPlayers } = g.settings;
  const connected = g.players.filter((p) => p.isConnected).length;

  setText($('lobby-code'), g.roomCode);
  setText($('lobby-count'), `${g.players.length}/${maxPlayers}`);

  const isHost = g.you.isHost;
  show($('lobby-host'), isHost);
  show($('lobby-guest'), !isHost);

  if (isHost) {
    setText($('lobby-imp-count'), impostorCount);
    $('btn-imp-minus').disabled = impostorCount <= minImpostors;
    $('btn-imp-plus').disabled = impostorCount >= maxImpostors;
    setText($('lobby-imp-hint'), `Max ${maxImpostors} · fewer than players`);

    let hint;
    let canStart = false;
    if (connected < minPlayers) hint = `Waiting for players — need at least ${minPlayers} (${connected} connected).`;
    else if (impostorCount >= connected) hint = `Too many impostors for ${plural(connected, 'player')}.`;
    else {
      canStart = true;
      hint = `${plural(connected, 'player')} ready · ${plural(impostorCount, 'impostor')}`;
    }
    $('btn-start').disabled = !canStart;
    setText($('lobby-start-hint'), hint);
  } else {
    setText($('lobby-guest-settings'), `${plural(impostorCount, 'impostor')} this game · ${plural(connected, 'player')} here`);
  }

  renderList($('lobby-players'), g.players, {
    key: (p) => p.id,
    create: createTile,
    update: (node, p) => updateTile(node, p, g),
  });
}
