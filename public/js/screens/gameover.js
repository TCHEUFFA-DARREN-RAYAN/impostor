// Final podium after the host ends the game.
import { $, h } from '../dom.js';
import { avatar } from '../ui.js';

const PODIUM_HEIGHT = [120, 90, 70]; // by rank: 1st, 2nd, 3rd

export function init(app) {
  $('btn-play-again').addEventListener('click', () => app.goHome());
}

export function render(app) {
  const standings = app.gameOver ? app.gameOver.standings : [];
  const youId = app.gameOver ? app.gameOver.youId : null;
  const top = standings.slice(0, 3);
  const order = top.length === 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : top;

  $('podium').replaceChildren(
    h(
      'div',
      { class: 'podium-row' },
      order.map((p) => {
        const rank = top.indexOf(p);
        return h(
          'div',
          { class: `podium-place rank-${rank + 1}${p.id === youId ? ' is-me' : ''}` },
          h('div', { class: 'podium-avatar' }, rank === 0 ? h('span', { class: 'crown', 'aria-hidden': 'true' }, '👑') : null, avatar(p, 'lg')),
          h('span', { class: 'podium-name' }, p.name),
          h(
            'div',
            { class: 'podium-bar', style: { height: `${PODIUM_HEIGHT[rank]}px` } },
            h('span', { class: 'podium-rank' }, `#${rank + 1}`),
            h('span', { class: 'podium-pts' }, `${p.score} pts`)
          )
        );
      })
    )
  );

  $('other-scores').replaceChildren(
    ...standings.slice(3).map((p, i) =>
      h(
        'li',
        { class: `list-row${p.id === youId ? ' is-me' : ''}` },
        h('span', { class: 'rank' }, `#${i + 4}`),
        avatar(p, 'sm'),
        h('span', { class: 'list-main' }, h('span', { class: 'list-name' }, p.name)),
        h('span', { class: 'list-score' }, `${p.score} pts`)
      )
    )
  );
}
