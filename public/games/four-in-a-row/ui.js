// Four in a Row screen: draws the view it receives and sends { type: 'drop', col } back.
import { h, avatar } from '../../core/util.js';
import { sound } from '../../core/sound.js';

const COLS = 7;
const ROWS = 6;

export function mount(ctx) {
  const root = h('div.f4');
  const status = h('div.f4-status');
  const players = h('div.f4-players');
  const board = h('div.f4-board');
  const discs = h('div.f4-discs');
  const holes = h('div.f4-holes');
  const cols = h('div.f4-cols');
  const after = h('div.f4-after');
  board.append(discs, holes, cols);
  root.append(players, status, h('div.f4-frame', board), after);
  ctx.el.append(root);

  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) holes.append(h('div.f4-hole'));
  for (let c = 0; c < COLS; c++) {
    cols.append(h('button.f4-col', { 'aria-label': `Column ${c + 1}`, onclick: () => drop(c) }));
  }

  let view = null;
  let seats = [];
  let waiting = false;

  function drop(col) {
    if (!view || waiting || view.turn !== view.seat || view.winner != null) return;
    if (view.board[col] != null) return sound.error();
    waiting = true;
    ctx.client.act({ type: 'drop', col });
  }

  function render(msg) {
    const prev = view;
    view = msg.view;
    seats = msg.seats || seats;
    waiting = false;
    const mine = view.seat;
    discs.replaceChildren(
      ...view.board.flatMap((v, i) => {
        if (v == null) return [];
        const c = i % COLS, r = Math.floor(i / COLS);
        const d = h(`div.f4-disc.p${v}`, { style: { '--c': c, '--r': r } });
        if (view.last && view.last.col === c && view.last.row === r && (!prev || prev.moves < view.moves)) d.classList.add('drop');
        if (view.line?.some(([x, y]) => x === c && y === r)) d.classList.add('win');
        return [d];
      }),
    );
    if (prev && view.moves > prev.moves) sound.card();
    const over = view.winner != null || view.moves === COLS * ROWS;
    const name = (s) => (s === mine ? 'You' : seats[s]?.name || ['Red', 'Gold'][s]);
    players.replaceChildren(
      ...[0, 1].map((s) =>
        h(
          `div.f4-player.p${s}` + (view.turn === s && !over ? '.turn' : ''),
          avatar(seats[s]?.name || '?', seats[s]?.hue ?? 0, { bot: seats[s]?.kind === 'bot' }),
          h('div', h('strong', name(s)), h('small', s === 0 ? 'Red' : 'Gold')),
          h('span.f4-chip'),
        ),
      ),
    );
    root.classList.toggle('my-turn', view.turn === mine && !over);
    root.dataset.me = mine ?? '';
    if (view.winner != null) {
      status.textContent = view.winner === mine ? 'You win!' : `${name(view.winner)} win${view.winner === mine ? '' : 's'}!`;
      if (!prev || prev.winner == null) (view.winner === mine || mine == null ? sound.win : sound.bad)();
    } else if (over) status.textContent = 'Draw — the board is full.';
    else status.textContent = view.turn === mine ? 'Your move — tap a column' : `${name(view.turn)} is thinking…`;
    after.replaceChildren(
      over
        ? h(
            'div.f4-actions',
            h('button.btn.ghost', { onclick: () => ctx.leave() }, 'Game Center'),
            ctx.client.isHost ? h('button.btn.gold', { onclick: () => ctx.client.send({ t: 'rematch' }) }, 'Play again') : h('small', 'Waiting for the host…'),
          )
        : null,
    );
    if (view.turn === mine && !over && prev?.turn !== mine) sound.turn();
  }

  const off = ctx.client.on('state', render);
  if (ctx.client.lastState) render(ctx.client.lastState);
  return {
    destroy() {
      off();
      root.remove();
    },
  };
}
