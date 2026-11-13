// Chinese Checkers screen. This file runs the game side of the screen: it reads each state
// message, shows the players and how many marbles each has home, lets you pick a marble and
// then a hole for it (showing every hole it can reach and the jumps on the way), sends
// { type: 'move', from, to }, and offers "Play again" at the end.
//
// The board itself is drawn by one of two interchangeable modules with the same interface:
//   scene.js    the 3D board (three.js WebGPURenderer), loaded only when it's used
//   board2d.js  the flat SVG board
// The "3D board" setting (saved on this device with ctx.prefs) picks one. If the device can't
// run 3D graphics, the flat board is used instead. Either way your own point is at the bottom.
import { h, avatar } from '../../core/util.js';
import { sound } from '../../core/sound.js';
import { createFlatBoard } from './board2d.js';
import { destinations, legal, homeCount } from './engine.js';
import { COLORS } from './colors.js';

const PREF_3D = 'checkers.3d';
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

export function mount(ctx) {
  const root = h('div.cc');
  const players = h('div.cc-players');
  const status = h('div.cc-status');
  const top = h('div.cc-top', players, status);
  const host = h('div.cc-host'); // the board goes in here
  const after = h('div.cc-after');
  root.append(h('div.cc-felt'), h('div.cc-lamp'), top, host, after);
  ctx.el.append(root);

  let view = null;
  let seats = [];
  let selected = null; // the marble you picked
  let reachable = new Map(); // where it can go: hole → path
  let hover = null;
  let sent = false; // a move is on its way to the host
  let board = null;
  let boardToken = 0;
  let want3d = ctx.prefs.get(PREF_3D) ?? true;

  const mine = () => view?.seat;
  const myTurn = () => view && view.seat != null && !view.over && view.turn === view.seat;
  const canPick = () => myTurn() && !sent;
  const name = (s) => (s === mine() ? 'You' : seats[s]?.name || COLORS[s].name);

  function movable() {
    if (!canPick()) return [];
    const out = [];
    view.board.forEach((s, i) => s === view.seat && destinations(view, s, i).size && out.push(i));
    return out;
  }

  function paintMarks() {
    if (!board) return;
    const can = canPick();
    board.mark({
      selected: can ? selected : null,
      targets: can && selected != null ? [...reachable.keys()] : [],
      path: can && hover != null ? reachable.get(hover) || null : null,
      movable: can && selected == null ? movable() : [],
    });
    // the status line follows what you're doing
    if (can && selected != null) status.textContent = `Pick where it goes — ${reachable.size} ${reachable.size === 1 ? 'hole' : 'holes'} in reach`;
    else if (can && legal(view, view.seat)[0]?.type !== 'pass') status.textContent = 'Your move — pick a marble';
  }

  function select(i) {
    selected = i;
    reachable = i == null ? new Map() : destinations(view, view.seat, i);
    hover = null;
    paintMarks();
  }

  function pick(i) {
    if (!canPick()) return;
    if (selected != null && reachable.has(i)) {
      sent = true;
      ctx.client.act({ type: 'move', from: selected, to: i });
      selected = null;
      reachable = new Map();
      hover = null;
      paintMarks();
      return;
    }
    if (view.board[i] === view.seat) {
      if (i === selected) return select(null);
      if (!destinations(view, view.seat, i).size) return (sound.error(), ctx.toast('That marble is boxed in — try another.'));
      sound.chip?.();
      return select(i);
    }
    if (selected != null) select(null);
  }
  function hoverAt(i) {
    hover = i;
    if (selected != null) paintMarks();
  }

  // ---------- choosing the board ----------
  async function useBoard(three) {
    const token = ++boardToken;
    board?.destroy();
    board = null;
    root.classList.toggle('three', three);
    root.classList.toggle('loading', three);
    const handlers = { onPick: pick, onHover: hoverAt, onHop: () => sound.card(), canPick };
    let next = null;
    if (three) {
      try {
        const { createScene } = await import('./scene.js');
        next = await createScene(host, handlers);
      } catch (err) {
        console.warn('Chinese Checkers: 3D graphics are not available, using the flat board.', err);
        if (token === boardToken) ctx.toast('3D graphics aren’t available on this device, so the flat board is showing.');
        three = false;
      }
    }
    if (token !== boardToken) return next?.destroy();
    board = next || createFlatBoard(host, handlers);
    root.classList.toggle('three', three);
    root.classList.remove('loading');
    if (view) board.update(view, null);
    paintMarks();
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

  // ---------- drawing a state ----------
  function render(msg) {
    const prev = view;
    view = msg.view;
    seats = msg.seats || seats;
    sent = false;
    // a new game, or the marble we picked has gone: start choosing again
    if (!prev || view.moves !== prev.moves || view.seat !== prev.seat) select(null);
    board?.update(view, prev);
    const me = mine();
    const total = view.pieces;
    players.replaceChildren(
      ...Array.from({ length: view.n }, (_, s) => {
        const place = view.over || view.places.includes(s) ? view.places.indexOf(s) : -1;
        return h(
          `div.cc-player` + (view.turn === s && !view.over ? '.turn' : '') + (place === 0 && view.over ? '.won' : '') + (place >= 0 && !view.over ? '.done' : ''),
          { style: { '--c': COLORS[s].hex } },
          avatar(seats[s]?.name || '?', seats[s]?.hue ?? 0, { bot: seats[s]?.kind === 'bot' }),
          h('div', h('strong', name(s)), h('small', place >= 0 && (view.over || view.places.includes(s)) && (view.mode === 'all' || place === 0) ? ORDINAL[place] : `${homeCount(view, s)}/${total} home`)),
          h('span.cc-chip', { style: { '--c': COLORS[s].hex, '--l': COLORS[s].light, '--d': COLORS[s].dark } }),
        );
      }),
    );
    root.classList.toggle('my-turn', myTurn());
    root.classList.toggle('over', !!view.over);

    let passBtn = null;
    if (view.over) {
      const w = view.winner;
      const how = view.ended === 'limit' ? ' (furthest along when time ran out)' : '';
      status.textContent = w === me ? `You win!${how}` : `${name(w)} wins!${how}`;
      if (!prev?.over) setTimeout(() => (w === me || me == null ? sound.win : sound.bad)(), 600);
    } else if (myTurn()) {
      const moves = legal(view, me);
      if (moves[0]?.type === 'pass') {
        status.textContent = 'No marble can move — you have to pass';
        passBtn = h('button.btn.gold', { onclick: () => ((sent = true), ctx.client.act({ type: 'pass' })) }, 'Pass');
      } else status.textContent = 'Your move — pick a marble';
      if (prev?.turn !== me || prev?.over) sound.turn();
    } else if (view.last?.pass && view.last.seat !== me && view.moves !== prev?.moves) {
      status.textContent = `${name(view.last.seat)} had to pass. ${name(view.turn)} next…`;
    } else status.textContent = me == null ? `${name(view.turn)} to move` : `${name(view.turn)} is thinking…`;
    if (!view.over && prev && view.places.length > prev.places.length && view.places.length) {
      const s = view.places[view.places.length - 1];
      ctx.toast(`${name(s)} ${s === me ? 'are' : 'is'} home — ${ORDINAL[view.places.length - 1]} place!`);
    }

    after.replaceChildren(
      view.over
        ? h(
            'div.cc-actions',
            h('button.btn.ghost', { onclick: () => ctx.leave() }, 'Game Center'),
            ctx.rematch(),
          )
        : passBtn ? h('div.cc-actions', passBtn) : null,
    );
    paintMarks();
  }

  // voice chat: light up whoever is talking
  function paintVoice() {
    if (!ctx.voice) return;
    players.querySelectorAll('.cc-player').forEach((el, s) => {
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

  // Escape puts the marble back down
  const onKey = (ev) => ev.key === 'Escape' && selected != null && select(null);
  window.addEventListener('keydown', onKey);

  return {
    destroy() {
      off();
      offVoice.forEach((f) => f());
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      boardToken++;
      board?.destroy();
      root.remove();
    },
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
