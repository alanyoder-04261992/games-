// Four in a Row screen. This file runs the game side of the screen: it reads each state
// message, shows the players and whose turn it is, sends { type: 'drop', col } when you pick a
// column, and offers "Play again" at the end.
//
// The board itself is drawn by one of two interchangeable modules with the same interface:
//   scene.js    the 3D board (three.js WebGPURenderer), loaded only when it's used
//   board2d.js  the flat HTML/CSS board
// The "3D board" setting (saved on this device with ctx.prefs) picks one. If the device can't
// run 3D graphics, the flat board is used instead.
import { h, avatar } from '../../core/util.js';
import { sound } from '../../core/sound.js';
import { createFlatBoard } from './board2d.js';

const COLS = 7;
const ROWS = 6;
const PREF_3D = 'four.3d';

export function mount(ctx) {
  const root = h('div.f4');
  const players = h('div.f4-players');
  const status = h('div.f4-status');
  const top = h('div.f4-top', players, status);
  const host = h('div.f4-host'); // the board goes in here
  const keys = h('div.f4-keys'); // keyboard and screen-reader buttons for the 3D board
  const after = h('div.f4-after');
  root.append(h('div.f4-wood'), h('div.f4-lamp'), top, host, keys, after);
  ctx.el.append(root);

  let view = null;
  let seats = [];
  let hoverCol = null; // the column under the pointer, finger or keyboard focus
  let sent = null; // the column we just sent, until the next state arrives
  let board = null;
  let boardToken = 0; // bumped on every switch, so a slow 3D load can't arrive late
  let want3d = ctx.prefs.get(PREF_3D) ?? true;

  const myTurn = () => view && view.seat != null && view.turn === view.seat && view.winner == null && view.moves < COLS * ROWS;
  const canPick = () => myTurn() && sent == null;

  function hover(col) {
    hoverCol = col;
    paintPreview();
  }
  // the preview disc: over the hovered column on your turn, and held over the column you chose
  // until the move comes back, so the dropping disc starts right where the preview was
  function paintPreview() {
    if (!board || !view) return;
    if (sent != null) return board.preview(sent, view.seat);
    const show = canPick() && hoverCol != null && view.board[hoverCol] == null;
    board.preview(show ? hoverCol : null, view.seat);
  }

  function drop(col) {
    if (!canPick()) return;
    if (view.board[col] != null) return sound.error();
    sent = col;
    paintPreview();
    ctx.client.act({ type: 'drop', col });
  }

  // ---------- choosing the board ----------
  async function useBoard(three) {
    const token = ++boardToken;
    board?.destroy();
    board = null;
    root.classList.toggle('three', three);
    root.classList.toggle('loading', three);
    const handlers = { onHover: hover, onPick: drop, onLand: () => sound.card(), canPick };
    let next = null;
    if (three) {
      try {
        const { createScene } = await import('./scene.js');
        next = await createScene(host, handlers);
      } catch (err) {
        console.warn('Four in a Row: 3D graphics are not available, using the flat board.', err);
        if (token === boardToken) ctx.toast('3D graphics aren’t available on this device, so the flat board is showing.');
        three = false;
      }
    }
    if (token !== boardToken) return next?.destroy(); // switched again (or left) while loading
    board = next || createFlatBoard(host, handlers);
    root.classList.toggle('three', three);
    root.classList.remove('loading');
    if (view) board.update(view, null); // draw the current position without animating it
    paintPreview();
    frame();
  }

  // tell the 3D board how much of the screen the player list and buttons cover
  function frame() {
    if (!board?.frame) return;
    const box = root.getBoundingClientRect();
    board.frame({ top: top.getBoundingClientRect().bottom - box.top, bottom: box.bottom - after.getBoundingClientRect().top });
  }
  const ro = new ResizeObserver(frame);
  [root, top, after].forEach((x) => ro.observe(x));

  for (let c = 0; c < COLS; c++) {
    keys.append(
      h('button', {
        'aria-label': `Drop in column ${c + 1}`,
        onclick: () => drop(c),
        onfocus: () => hover(c),
        onblur: () => hover(null),
      }),
    );
  }

  // ---------- drawing a state ----------
  function render(msg) {
    const prev = view;
    view = msg.view;
    seats = msg.seats || seats;
    sent = null;
    board?.update(view, prev);
    const mine = view.seat;
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
    paintPreview();
    if (myTurn() && prev?.turn !== mine) sound.turn();
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
  useBoard(want3d);

  return {
    destroy() {
      off();
      offVoice.forEach((f) => f());
      ro.disconnect();
      boardToken++;
      board?.destroy();
      root.remove();
    },
    // shown in the table's Settings sheet
    settings: () => [
      {
        label: '3D board',
        value: want3d,
        set: (v) => {
          want3d = v;
          ctx.prefs.set(PREF_3D, v);
          useBoard(v);
        },
      },
    ],
  };
}
