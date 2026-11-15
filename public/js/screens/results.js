// Round results: verdict, the two words, votes, impostor reveal, scores.
import { $, h, show, setText, renderList } from '../dom.js';
import { avatar, updateAvatar, confirmAction } from '../ui.js';

let renderedKey = null;

export function init(app) {
  $('btn-new-round').addEventListener('click', (e) => app.act(e.currentTarget, 'round:new'));
  $('btn-end-game').addEventListener('click', async (e) => {
    const ok = await confirmAction({ title: 'End game?', message: 'Show final scores?', confirmText: 'End game', danger: true });
    if (ok) app.act(e.currentTarget, 'game:end');
  });
}

function renderStatic(g, r, people) {
  const many = r.impostorIds.length > 1;
  const found = r.impostorFound;
  $('results-verdict').className = `verdict ${found ? 'is-found' : 'is-escaped'}`;
  $('results-verdict').replaceChildren(
    h('span', { class: 'verdict-icon', 'aria-hidden': 'true' }, found ? '✅' : '❌'),
    h('span', { class: 'verdict-text' }, found ? (many ? 'IMPOSTORS FOUND!' : 'IMPOSTOR FOUND!') : many ? 'IMPOSTORS WIN!' : 'IMPOSTOR WINS!'),
    h('span', { class: 'verdict-sub' }, found ? 'The crew scores a point' : `The impostor${many ? 's score' : ' scores'} a point`)
  );

  $('results-words').replaceChildren(
    h('div', { class: 'word-card' }, h('span', { class: 'eyebrow' }, 'Crew word'), h('span', { class: 'word-card-text' }, r.words.crew)),
    h('div', { class: 'word-card is-impostor' }, h('span', { class: 'eyebrow' }, 'Impostor word'), h('span', { class: 'word-card-text' }, r.words.impostor))
  );

  setText($('results-impostor-title'), many ? 'The impostors were' : 'The impostor was');
  const impostors = r.impostorIds.map((id) => people.get(id)).filter(Boolean);
  $('results-impostors').replaceChildren(
    ...(impostors.length
      ? impostors.map((p) => h('div', { class: 'impostor-chip' }, avatar(p, 'sm'), h('span', {}, p.name), p.id === g.you.id ? h('span', { class: 'tag tag-me' }, 'YOU') : null))
      : [h('p', { class: 'hint' }, 'The impostor left the game.')])
  );
}

function renderVotes(g, r, people) {
  const votersFor = new Map();
  for (const { voterId, targetId } of r.votes) {
    if (!votersFor.has(targetId)) votersFor.set(targetId, []);
    const voter = people.get(voterId);
    if (voter) votersFor.get(targetId).push(voter);
  }
  const impostors = new Set(r.impostorIds);
  const rows = [...people.values()]
    .map((p) => ({ ...p, count: r.voteCounts[p.id] || 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  renderList($('results-votes'), rows, {
    key: (p) => p.id,
    create: (p) =>
      h(
        'li',
        { class: 'list-row' },
        avatar(p, 'sm'),
        h('span', { class: 'list-main' }, h('span', { class: 'list-name' }), h('span', { class: 'voters' })),
        h('span', { class: 'list-side' })
      ),
    update: (node, p) => {
      const isImpostor = impostors.has(p.id);
      node.classList.toggle('is-impostor', isImpostor);
      updateAvatar(node.querySelector('.avatar'), p);
      node.querySelector('.list-name').replaceChildren(
        p.name,
        p.id === g.you.id ? h('span', { class: 'tag tag-me' }, 'YOU') : '',
        isImpostor ? h('span', { class: 'tag tag-impostor' }, 'IMPOSTOR') : ''
      );
      const voters = votersFor.get(p.id) || [];
      node.querySelector('.voters').replaceChildren(...voters.map((v) => avatar(v, 'xs')));
      node.querySelector('.voters').title = voters.map((v) => v.name).join(', ');
      setText(node.querySelector('.list-side'), `${p.count} vote${p.count === 1 ? '' : 's'}`);
    },
  });
}

function renderScores(g, r) {
  const rows = [...g.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  renderList($('results-scores'), rows, {
    key: (p) => p.id,
    create: (p) =>
      h(
        'li',
        { class: 'list-row' },
        h('span', { class: 'rank' }),
        avatar(p, 'sm'),
        h('span', { class: 'list-main' }, h('span', { class: 'list-name' })),
        h('span', { class: 'delta' }),
        h('span', { class: 'list-score' })
      ),
    update: (node, p, i) => {
      const isMe = p.id === g.you.id;
      node.classList.toggle('is-me', isMe);
      node.classList.toggle('is-offline', !p.isConnected);
      updateAvatar(node.querySelector('.avatar'), p);
      setText(node.querySelector('.rank'), `#${i + 1}`);
      node.querySelector('.list-name').replaceChildren(p.name, isMe ? h('span', { class: 'tag tag-me' }, 'YOU') : '');
      const delta = r.scoreDeltas[p.id] || 0;
      const deltaEl = node.querySelector('.delta');
      setText(deltaEl, delta > 0 ? `+${delta}` : '');
      deltaEl.hidden = delta <= 0;
      setText(node.querySelector('.list-score'), p.score);
    },
  });
}

export function render(app, g) {
  const r = g.results;
  if (!r) return;

  // Everyone who took part in the round, including players who left since.
  const people = new Map(r.roster.map((p) => [p.id, p]));
  for (const p of g.players) if (people.has(p.id)) people.set(p.id, { ...people.get(p.id), ...p });

  const key = `${g.roomCode}:${r.roundId}`;
  if (renderedKey !== key) {
    renderedKey = key;
    renderStatic(g, r, people);
  }
  renderVotes(g, r, people);
  renderScores(g, r);

  show($('results-host'), g.you.isHost);
  show($('results-guest'), !g.you.isHost);
}
