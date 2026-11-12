// Four in a Row screen: draws the view it receives and sends { type: 'drop', col } back.
// Looks like the real thing: a molded plastic rack on a wooden table, ridged checkers that
// drop and bounce, a hovering checker that follows your pointer, and a glowing winning line.
import { h, avatar } from '../../core/util.js';
import { sound } from '../../core/sound.js';

const COLS = 7;
const ROWS = 6;

export function mount(ctx) {
  const root = h('div.f4');
  const status = h('div.f4-status');
  const players = h('div.f4-players');
  const discs = h('div.f4-discs');
  const rack = h('div.f4-rack');
  const rims = h('div.f4-rims');
  const line = h('div.f4-line');
  const ghost = h('div.f4-ghost', h('div.f4-disc'));
  const cols = h('div.f4-cols');
  const board = h('div.f4-board', discs, rack, rims, line, cols);
  const after = h('div.f4-after');
  const stage = h(
    'div.f4-stage',
    ghost,
    h('div.f4-frame', board, h('div.f4-leg.left'), h('div.f4-leg.right')),
    h('div.f4-shadow'),
  );
  root.append(h('div.f4-wood'), h('div.f4-lamp'), players, status, stage, after);
  ctx.el.append(root);

  for (let c = 0; c < COLS; c++) {
    const btn = h('button.f4-col', {
      'aria-label': `Column ${c + 1}`,
      onclick: () => drop(c),
      onpointerenter: () => hover(c),
      onfocus: () => hover(c),
    });
    cols.append(btn);
  }
  cols.addEventListener('pointerleave', () => hover(null));

  let view = null;
  let seats = [];
  let waiting = false;
  let hoverCol = null;

  const myTurn = () => view && view.seat != null && view.turn === view.seat && view.winner == null && view.moves < COLS * ROWS;

  function hover(col) {
    hoverCol = col;
    paintGhost();
  }
  function paintGhost() {
    const show = myTurn() && !waiting && hoverCol != null && view.board[hoverCol] == null;
    ghost.classList.toggle('show', !!show);
    if (show) {
      ghost.style.setProperty('--c', hoverCol);
      ghost.firstChild.className = `f4-disc p${view.seat}`;
    }
  }

  function drop(col) {
    if (!myTurn() || waiting) return;
    if (view.board[col] != null) return sound.error();
    waiting = true;
    ghost.classList.remove('show');
    ctx.client.act({ type: 'drop', col });
  }

  function render(msg) {
    const prev = view;
    view = msg.view;
    seats = msg.seats || seats;
    waiting = false;
    const mine = view.seat;
    const fresh = !prev || view.moves < prev.moves;
    discs.replaceChildren(
      ...view.board.flatMap((v, i) => {
        if (v == null) return [];
        const c = i % COLS;
        const r = Math.floor(i / COLS);
        const d = h(`div.f4-disc.p${v}`, { style: { '--c': c, '--r': r, '--spin': `${((c * 37 + r * 53) % 360)}deg` } });
        if (!fresh && view.last && view.last.col === c && view.last.row === r && prev.moves < view.moves) d.classList.add('drop');
        if (view.line?.some(([x, y]) => x === c && y === r)) d.classList.add('win');
        return [d];
      }),
    );
    if (prev && view.moves > prev.moves) {
      setTimeout(() => sound.card(), 160 + (view.last?.row ?? 0) * 45);
    }
    drawLine();
    const over = view.winner != null || view.moves === COLS * ROWS;
    const name = (s) => (s === mine ? 'You' : seats[s]?.name || ['Red', 'Gold'][s]);
    players.replaceChildren(
      ...[0, 1].map((s) =>
        h(
          `div.f4-player.p${s}` + (view.turn === s && !over ? '.turn' : '') + (view.winner === s ? '.won' : ''),
          avatar(seats[s]?.name || '?', seats[s]?.hue ?? 0, { bot: seats[s]?.kind === 'bot' }),
          h('div', h('strong', name(s)), h('small', s === 0 ? 'Red' : 'Gold')),
          h(`span.f4-disc.chip.p${s}`),
        ),
      ),
    );
    root.classList.toggle('my-turn', myTurn());
    root.classList.toggle('over', over);
    if (view.winner != null) {
      status.textContent = view.winner === mine ? 'You win!' : `${name(view.winner)} wins!`;
      if (!prev || prev.winner == null) setTimeout(() => (view.winner === mine || mine == null ? sound.win : sound.bad)(), 450);
    } else if (over) status.textContent = 'Draw — the board is full.';
    else status.textContent = view.turn === mine ? 'Your move — pick a column' : `${name(view.turn)} is thinking…`;
    after.replaceChildren(
      over
        ? h(
            'div.f4-actions',
            h('button.btn.ghost', { onclick: () => ctx.leave() }, 'Game Center'),
            ctx.client.isHost ? h('button.btn.gold', { onclick: () => ctx.client.send({ t: 'rematch' }) }, 'Play again') : h('small', 'Waiting for the host…'),
          )
        : null,
    );
    paintGhost();
    if (myTurn() && prev?.turn !== mine) sound.turn();
  }

  // a glowing bar through the winning four
  function drawLine() {
    const cells = view?.line;
    if (!cells || cells.length < 2) {
      line.classList.remove('show');
      return;
    }
    const sorted = [...cells].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const [x1, y1] = sorted[0];
    const [x2, y2] = sorted[sorted.length - 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    line.style.setProperty('--x', x1 + 0.5);
    line.style.setProperty('--y', y1 + 0.5);
    line.style.setProperty('--len', Math.hypot(dx, dy));
    line.style.setProperty('--angle', `${Math.atan2(dy, dx)}rad`);
    line.classList.remove('show');
    void line.offsetWidth;
    line.classList.add('show');
  }

  // voice chat: light up whoever is talking
  function paintVoice() {
    if (!ctx.voice) return;
    players.querySelectorAll('.f4-player').forEach((el, s) => {
      const id = seats[s]?.playerId;
      el.classList.toggle('speaking', !!(id && ctx.voice.speaking.has(id)));
    });
  }
  const offVoice = ctx.voice ? [ctx.voice.on('speaking', paintVoice), ctx.voice.on('change', paintVoice)] : [];
  const off = ctx.client.on('state', (msg) => {
    render(msg);
    paintVoice();
  });
  if (ctx.client.lastState) render(ctx.client.lastState);
  return {
    destroy() {
      off();
      offVoice.forEach((f) => f());
      root.remove();
    },
  };
}
