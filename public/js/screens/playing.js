// Round in progress: word bar, speaking turns, voting, host controls.
import { $, h, show, setText, renderList } from '../dom.js';
import { avatar, updateAvatar, confirmAction, toast, vibrate } from '../ui.js';
import { sounds } from '../sounds.js';

// Requests in flight, used to keep buttons from double-firing between the
// server's acknowledgement and the next state snapshot.
let pendingTurn = null; // "roundId:turn" we asked to finish
let pendingVote = null; // { roundId, targetId, settled }
let wordHidden = false;

const participantsOf = (g) => g.players.filter((p) => p.turnOrder != null).sort((a, b) => a.turnOrder - b.turnOrder);
const turnKey = (g) => `${g.round.id}:${g.round.currentSpeaker}`;
const isMyTurn = (g) => g.you.inRound && g.round.currentSpeaker === g.you.turnOrder;

function myVote(g) {
  if (g.you.votedFor) return g.you.votedFor;
  if (pendingVote && pendingVote.roundId === g.round.id) return pendingVote.targetId;
  return null;
}

/** Called by main.js for every new snapshot, before render. */
export function onState(g) {
  if (pendingVote && (pendingVote.settled || !g.round || pendingVote.roundId !== g.round.id)) pendingVote = null;
  if (pendingTurn && (!g.round || pendingTurn !== turnKey(g))) pendingTurn = null;
}

function finishTurn(app) {
  const g = app.game;
  if (!g || !g.round || !isMyTurn(g)) return;
  const key = turnKey(g);
  if (pendingTurn === key) return;
  pendingTurn = key;
  render(app, g);
  sounds.play('click');
  app.net.request('turn:next', { roundId: g.round.id, turn: g.round.currentSpeaker }).then((res) => {
    if (res.ok && res.changed) return; // the next snapshot moves the turn on
    if (!res.ok) toast(res.error);
    if (pendingTurn === key) pendingTurn = null;
    if (app.game) render(app, app.game);
  });
}

function castVote(app, targetId) {
  const g = app.game;
  if (!g || !g.round || !g.you.inRound || g.round.votingLocked || myVote(g)) return;
  pendingVote = { roundId: g.round.id, targetId, settled: false };
  render(app, g);
  sounds.play('click');
  vibrate(50);
  const mine = pendingVote;
  app.net.request('vote:cast', { targetId }).then((res) => {
    if (pendingVote !== mine) return;
    if (res.ok) mine.settled = true;
    else {
      pendingVote = null;
      toast(res.error);
      if (app.game) render(app, app.game);
    }
  });
}

export function init(app) {
  $('btn-speak-done').addEventListener('click', () => finishTurn(app));

  $('btn-skip-speaker').addEventListener('click', async (e) => {
    const g = app.game;
    if (!g || !g.round) return;
    const speaker = participantsOf(g).find((p) => p.turnOrder === g.round.currentSpeaker);
    const expected = { roundId: g.round.id, turn: g.round.currentSpeaker };
    const ok = await confirmAction({
      title: 'Skip this turn?',
      message: `Move on from ${speaker ? speaker.name : 'this player'} to the next speaker.`,
      confirmText: 'Skip',
    });
    if (ok) app.act(e.currentTarget, 'turn:next', expected);
  });

  $('vote-grid').addEventListener('click', (e) => {
    const cell = e.target.closest('.vote-cell');
    if (cell && !cell.disabled) castVote(app, cell.dataset.key);
  });

  $('play-word').addEventListener('click', () => {
    wordHidden = !wordHidden;
    if (app.game) render(app, app.game);
  });

  $('btn-toggle-voting').addEventListener('click', (e) => app.act(e.currentTarget, 'vote:toggle'));

  $('btn-reset-voting').addEventListener('click', async (e) => {
    const ok = await confirmAction({ title: 'Reset votes?', message: 'All votes are cleared and voting is locked again.', confirmText: 'Reset', danger: true });
    if (ok) app.act(e.currentTarget, 'vote:reset');
  });

  $('btn-new-word').addEventListener('click', async (e) => {
    const ok = await confirmAction({ title: 'Deal a new word?', message: 'Everyone gets a new word, new impostors and a new speaking order.', confirmText: 'New word' });
    if (ok) app.act(e.currentTarget, 'round:new');
  });

  $('btn-end-round').addEventListener('click', async (e) => {
    const ok = await confirmAction({ title: 'End round?', message: 'Show results now?', confirmText: 'End round', danger: true });
    if (ok) app.act(e.currentTarget, 'round:end');
  });

  $('btn-leave-game').addEventListener('click', () => app.leave());
}

function renderSpeaker(g, participants) {
  const round = g.round;
  const index = participants.findIndex((p) => p.turnOrder === round.currentSpeaker);
  const speaker = participants[index];
  const mine = isMyTurn(g);

  $('speaker-progress').style.width = participants.length ? `${((index + 1) / participants.length) * 100}%` : '0%';

  renderList($('turn-strip'), participants, {
    key: (p) => p.id,
    create: (p) => h('li', { class: 'turn-step' }, avatar(p, 'sm'), h('span', { class: 'turn-step-num' })),
    update: (node, p, i) => {
      updateAvatar(node.querySelector('.avatar'), p);
      setText(node.querySelector('.turn-step-num'), p.turnOrder);
      node.classList.toggle('is-current', i === index);
      node.classList.toggle('is-done', index >= 0 && i < index);
      node.classList.toggle('is-offline', !p.isConnected);
      node.title = p.name;
    },
  });

  const spot = $('speaker-spotlight');
  const spotKey = speaker ? `${speaker.id}:${mine}` : '';
  if (spot.dataset.key !== spotKey) {
    spot.dataset.key = spotKey;
    spot.replaceChildren(
      ...(speaker
        ? [
            avatar(speaker, 'xl', mine ? 'spotlight-avatar is-mine' : 'spotlight-avatar'),
            h('span', { class: 'spotlight-name' }, mine ? 'Your turn!' : speaker.name),
          ]
        : [])
    );
  }
  spot.classList.toggle('is-offline', Boolean(speaker && !speaker.isConnected));

  const speakBtn = $('btn-speak-done');
  show(speakBtn, mine);
  speakBtn.disabled = !mine || pendingTurn === turnKey(g);
  show($('speaker-listening'), !mine);
  setText($('speaker-listening-name'), speaker ? speaker.name : '…');
  show($('btn-skip-speaker'), g.you.isHost && !mine && Boolean(speaker));
}

function renderVoting(g, participants) {
  const round = g.round;
  const picked = myVote(g);
  const canVote = g.you.inRound && !round.votingLocked && !picked;
  const candidates = participants.filter((p) => p.id !== g.you.id);

  show($('vote-locked'), round.votingLocked);

  renderList($('vote-grid'), candidates, {
    key: (p) => p.id,
    create: (p) =>
      h('button', { class: 'vote-cell', type: 'button' }, avatar(p, 'md'), h('span', { class: 'vote-cell-name' }), h('span', { class: 'vote-cell-tag' })),
    update: (node, p) => {
      updateAvatar(node.querySelector('.avatar'), p);
      setText(node.querySelector('.vote-cell-name'), p.name);
      setText(node.querySelector('.vote-cell-tag'), p.id === picked ? 'YOUR VOTE' : p.isConnected ? '' : 'OFFLINE');
      node.disabled = !canVote;
      node.classList.toggle('is-locked', round.votingLocked);
      node.classList.toggle('is-picked', p.id === picked);
      node.classList.toggle('is-offline', !p.isConnected);
      node.setAttribute('aria-label', `Vote for ${p.name}`);
      node.setAttribute('aria-pressed', String(p.id === picked));
    },
  });

  const { totalVotes, totalVoters } = round;
  $('vote-progress').style.width = totalVoters ? `${(totalVotes / totalVoters) * 100}%` : '0%';
  setText($('vote-progress-text'), `${totalVotes} / ${totalVoters} votes`);

  const waiting = participants.filter((p) => !p.hasVoted);
  const showWaiting = !round.votingLocked && waiting.length > 0 && totalVotes > 0;
  show($('vote-waiting'), showWaiting);
  if (showWaiting) {
    const names = waiting.slice(0, 4).map((p) => (p.id === g.you.id ? 'you' : p.name));
    const more = waiting.length > 4 ? ` +${waiting.length - 4}` : '';
    setText($('vote-waiting'), `Waiting for ${names.join(', ')}${more}`);
  }
}

export function render(app, g) {
  if (!g.round) return;
  const participants = participantsOf(g);
  const you = g.you;
  const me = g.players.find((p) => p.id === you.id);

  setText($('play-score'), me ? me.score : 0);
  setText($('play-turn'), `${you.inRound ? you.turnOrder : '-'}/${participants.length}`);

  const chip = $('play-word');
  chip.classList.toggle('is-impostor', you.isImpostor);
  chip.classList.toggle('is-hidden', wordHidden && you.inRound);
  setText($('play-word-label'), !you.inRound ? 'SPECTATING' : wordHidden ? 'TAP TO SHOW' : you.isImpostor ? 'IMPOSTOR WORD' : 'YOUR WORD');
  setText($('play-word-text'), you.inRound ? (wordHidden ? '• • • • •' : you.word) : '—');
  chip.disabled = !you.inRound;

  show($('play-impostor'), you.isImpostor);
  show($('play-spectator'), !you.inRound);

  renderSpeaker(g, participants);
  renderVoting(g, participants);

  show($('host-controls'), you.isHost);
  if (you.isHost) setText($('btn-toggle-voting'), g.round.votingLocked ? 'Unlock voting' : 'Lock voting');
}
