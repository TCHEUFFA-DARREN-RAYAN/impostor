// App controller: owns the connection and the latest server snapshot, picks
// the screen to show, and plays the effects tied to state transitions.
import { $, show, setText } from './dom.js';
import { createNet } from './net.js';
import { session, revealed } from './storage.js';
import { sounds } from './sounds.js';
import { startStarfield } from './starfield.js';
import { toast, setupConfirm, closeAllDialogs, confirmAction, vibrate, confetti, withBusy, copyText } from './ui.js';
import * as home from './screens/home.js';
import * as lobby from './screens/lobby.js';
import * as reveal from './screens/reveal.js';
import * as playing from './screens/playing.js';
import * as results from './screens/results.js';
import * as gameover from './screens/gameover.js';

const SCREENS = { home, lobby, reveal, playing, results, gameover };
const BOOT_TIME = Date.now();

const app = {
  net: createNet(),
  game: null, // latest snapshot from the server (null = not in a room)
  gameOver: null, // { standings, youId } after the host ends the game
  screen: 'home',
  everConnected: false,
  resuming: false,

  roundKey: (g) => `${g.roomCode}:${g.round ? g.round.id : 0}`,
  isRevealed: (g) => revealed.get() === app.roundKey(g),
  markRevealed(key) {
    revealed.set(key);
    render();
  },

  /** Sends a request (button shows busy) and toasts errors. */
  act(button, event, payload) {
    return withBusy(button, async () => {
      const res = await app.net.request(event, payload);
      if (!res.ok) toast(res.error);
      return res;
    });
  },

  async leave() {
    const isHost = Boolean(app.game && app.game.you.isHost);
    const ok = await confirmAction({
      title: 'Leave game?',
      message: isHost ? "You're the host — leaving ends the game for everyone." : 'Are you sure?',
      confirmText: 'Leave',
      danger: true,
    });
    if (!ok) return;
    app.net.request('room:leave');
    exitRoom();
  },

  goHome() {
    app.gameOver = null;
    render();
  },
};

// ─── Screen selection ───────────────────────────────────────────────────────

function pickScreen() {
  const g = app.game;
  if (!g) return app.gameOver ? 'gameover' : 'home';
  if (g.phase === 'lobby') return 'lobby';
  if (g.phase === 'results' && g.results) return 'results';
  if (g.phase === 'playing' && g.round) return g.you.inRound && !app.isRevealed(g) ? 'reveal' : 'playing';
  return 'lobby';
}

function onEnterScreen(name, previous) {
  if (name === 'reveal') sounds.play('whoosh');
  if (name === 'playing' && previous === 'reveal' && app.game && isMyTurn(app.game)) {
    sounds.play('ping');
    vibrate([60, 40, 60]);
  }
}

const isMyTurn = (g) => Boolean(g.round && g.you.inRound && g.round.currentSpeaker === g.you.turnOrder);

function render() {
  const next = pickScreen();
  if (next !== app.screen) {
    const previous = app.screen;
    $(`screen-${previous}`).classList.remove('active');
    const el = $(`screen-${next}`);
    el.classList.add('active');
    el.scrollTop = 0;
    app.screen = next;
    onEnterScreen(next, previous);
  }
  try {
    SCREENS[next].render(app, app.game);
  } catch (err) {
    console.error(`Rendering ${next} failed`, err);
  }
  renderChrome();
}

function renderChrome() {
  const g = app.game;
  document.body.dataset.screen = app.screen;
  show($('appbar-brand'), app.screen !== 'home');
  show($('appbar-room'), Boolean(g));
  if (g) setText($('appbar-room-code'), g.roomCode);

  const online = app.net.connected;
  const dot = $('conn-dot');
  dot.className = `conn-dot ${online ? 'is-online' : 'is-offline'}`;
  dot.title = online ? 'Connected' : 'Offline';

  let banner = '';
  // On first load, only mention connecting if it takes noticeably long (avoids a flash).
  if (!online && (app.everConnected || Date.now() - BOOT_TIME > 1500)) {
    banner = app.everConnected ? 'Connection lost — reconnecting…' : 'Connecting to the server…';
  }
  else if (app.resuming) banner = 'Rejoining your game…';
  show($('banner-connection'), Boolean(banner));
  if (banner) setText($('banner-connection-text'), banner);

  show($('banner-host'), Boolean(online && g && !g.hostConnected && !g.you.isHost));
}

// ─── State transitions ──────────────────────────────────────────────────────

function applyState(next) {
  const prev = app.game;
  app.game = next;
  app.gameOver = null;
  playing.onState(next);

  if (prev && prev.roomCode === next.roomCode) {
    const sameRound = prev.round && next.round && prev.round.id === next.round.id;

    if (sameRound && next.phase === 'playing' && prev.round.votingLocked && !next.round.votingLocked) {
      sounds.play('alert');
      vibrate(100);
    }
    if (sameRound && next.phase === 'playing' && prev.round.currentSpeaker !== next.round.currentSpeaker && isMyTurn(next) && app.isRevealed(next)) {
      sounds.play('ping');
      vibrate([60, 40, 60]);
    }
    if (prev.phase === 'playing' && next.phase === 'results' && next.results) {
      if (next.results.impostorFound) {
        sounds.play('victory');
        confetti();
      } else sounds.play('defeat');
      vibrate([100, 50, 100]);
    }
  }
  render();
}

/** Back to the home screen, forgetting the room. */
function exitRoom(reason) {
  session.clear();
  app.game = null;
  closeAllDialogs();
  if (reason) toast(reason, 'info', 4500);
  render();
}

// ─── Connection ─────────────────────────────────────────────────────────────

let resumeRetry = 0;

async function resume() {
  const saved = session.load();
  if (!saved) {
    home.openInviteIfAny(app);
    return;
  }
  app.resuming = true;
  renderChrome();
  const res = await app.net.request('room:resume', { roomCode: saved.roomCode, token: saved.token });
  app.resuming = false;
  if (res.ok) {
    session.save(res.session);
  } else if (res.code === 'SESSION_INVALID') {
    exitRoom(res.error);
    home.openInviteIfAny(app);
  } else if (app.net.connected) {
    clearTimeout(resumeRetry);
    resumeRetry = setTimeout(resume, 2000); // transient failure: try again
  }
  renderChrome();
}

function bindNet() {
  const { net } = app;
  net.on('connect', () => {
    app.everConnected = true;
    renderChrome();
    resume();
  });
  net.on('disconnect', renderChrome);
  net.on('connect_error', renderChrome);

  net.on('state', applyState);
  net.on('room:closed', (d) => exitRoom((d && d.reason) || 'The room was closed.'));
  net.on('room:kicked', (d) => exitRoom((d && d.reason) || 'You were removed from the room.'));
  net.on('session:replaced', () => exitRoom('This game was opened in another tab or device.'));
  net.on('game:over', (d) => {
    const youId = app.game ? app.game.you.id : null;
    session.clear();
    app.game = null;
    app.gameOver = { standings: (d && d.standings) || [], youId };
    closeAllDialogs();
    render();
    sounds.play('fanfare');
    confetti();
  });
  net.on('notice', (d) => d && toast(d.message, d.type || 'info', 5000));
}

// ─── Global chrome ──────────────────────────────────────────────────────────

function bindChrome() {
  const mute = $('btn-mute');
  const paintMute = () => {
    const muted = sounds.isMuted();
    mute.textContent = muted ? '🔇' : '🔊';
    mute.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
  };
  mute.addEventListener('click', () => {
    sounds.toggle();
    paintMute();
  });
  paintMute();

  $('appbar-room').addEventListener('click', async () => {
    if (!app.game) return;
    const ok = await copyText(app.game.roomCode);
    toast(ok ? `Room code ${app.game.roomCode} copied` : 'Could not copy the code', ok ? 'success' : 'error', 2000);
  });

  // Unlock audio on the first interaction (required on mobile browsers).
  const unlock = () => {
    sounds.unlock();
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  };
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', unlock);

  // Stop iOS rubber-band scrolling of the whole page; scroll areas still scroll.
  document.body.addEventListener(
    'touchmove',
    (e) => {
      let t = e.target;
      while (t && t !== document.body) {
        const s = window.getComputedStyle(t);
        if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && t.scrollHeight > t.clientHeight) return;
        t = t.parentElement;
      }
      e.preventDefault();
    },
    { passive: false }
  );
}

// ─── Boot ───────────────────────────────────────────────────────────────────

startStarfield($('starfield'));
setupConfirm();
for (const screen of Object.values(SCREENS)) screen.init?.(app);
bindChrome();
bindNet();
render();
setTimeout(renderChrome, 1600); // surfaces the "Connecting…" banner if the first connect is slow
