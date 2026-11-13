// Chinese Checkers: the flat board, drawn as one SVG (styled in checkers.css). Used when
// "3D board" is off in Settings, or when the device can't run the 3D board.
//
// It has the same small interface as the 3D board in scene.js, so ui.js can use either one:
//   const board = createFlatBoard(container, { onPick, onHover, onHop });
//   board.update(view, prev)   draw a view; animate the move since `prev` (null = no animation)
//   board.mark({ selected, targets, path, movable })   highlights for choosing a move
//   board.destroy()
// The board never sends moves. It reports the hole that was tapped (onPick) or pointed at
// (onHover), and onHop each time a moving marble lands (for the sound).
import { CELLS, N, STAR, layout, turnsFor } from './board.js';
import { COLORS } from './colors.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  el.append(...kids);
  return el;
};
const R = 0.37; // marble radius, in hole spacings
const HOP_STEP = 0.2; // seconds per step…
const HOP_JUMP = 0.27; // …and per jump

// the corners of a point's triangle (its tip and the two ends of its widest row), pushed out
function pointTriangle(p, turns, pad) {
  const cells = CELLS.filter((c) => c.point === p);
  const row = cells.filter((c) => c.depth === 3).map((c) => layout(c.i, turns));
  row.sort((a, b) => a.px - b.px || a.py - b.py);
  const corners = [layout(cells.find((c) => c.depth === 0).i, turns), row[0], row[row.length - 1]];
  const cx = corners.reduce((t, q) => t + q.px, 0) / 3;
  const cy = corners.reduce((t, q) => t + q.py, 0) / 3;
  return corners.map((q) => [cx + (q.px - cx) * pad, cy + (q.py - cy) * pad]);
}

export function createFlatBoard(container, { onPick, onHover, onHop }) {
  const grads = COLORS.map((c, s) =>
    svg('radialGradient', { id: `cc-m${s}`, cx: '0.36', cy: '0.3', r: '0.78' },
      svg('stop', { offset: '0', 'stop-color': c.light }),
      svg('stop', { offset: '0.42', 'stop-color': c.hex }),
      svg('stop', { offset: '1', 'stop-color': c.dark })),
  );
  const defs = svg('defs', {},
    svg('linearGradient', { id: 'cc-wood', x1: '0', y1: '0', x2: '1', y2: '1' },
      svg('stop', { offset: '0', 'stop-color': '#e9c38b' }),
      svg('stop', { offset: '0.55', 'stop-color': '#cf9a5a' }),
      svg('stop', { offset: '1', 'stop-color': '#a66d35' })),
    svg('radialGradient', { id: 'cc-hole', cx: '0.5', cy: '0.38', r: '0.62' },
      svg('stop', { offset: '0', 'stop-color': '#2b1607' }),
      svg('stop', { offset: '0.72', 'stop-color': '#4e2d12' }),
      svg('stop', { offset: '0.9', 'stop-color': '#8a5a2c' }),
      svg('stop', { offset: '1', 'stop-color': '#f1cf9c', 'stop-opacity': '0.8' })),
    svg('radialGradient', { id: 'cc-shine', cx: '0.32', cy: '0.26', r: '0.4' },
      svg('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '0.85' }),
      svg('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' })),
    svg('filter', { id: 'cc-grain', x: '0', y: '0', width: '100%', height: '100%' },
      svg('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.06 1.1', numOctaves: '3', seed: '5' }),
      svg('feColorMatrix', { values: '0 0 0 0 0.32 0 0 0 0 0.16 0 0 0 0 0.02 0 0 0 0.5 0' }),
      svg('feComposite', { in2: 'SourceGraphic', operator: 'in' })),
    ...grads,
  );
  const starLayer = svg('g');
  const tints = svg('g', { class: 'cc-tints' });
  const holes = svg('g', { class: 'cc-holes' });
  const trail = svg('g', { class: 'cc-trail' });
  const marks = svg('g', { class: 'cc-marks' });
  const marbles = svg('g', { class: 'cc-marbles' });
  const hits = svg('g', { class: 'cc-hits' });
  const root = svg('svg', { class: 'cc-svg', viewBox: '-7.3 -8 14.6 16', role: 'img', 'aria-label': 'Chinese Checkers board' }, defs, starLayer, tints, holes, trail, marks, marbles, hits);
  const stage = document.createElement('div');
  stage.className = 'cc-stage';
  stage.append(root);
  container.append(stage);

  // the star: two triangles with thick rounded strokes make a padded star with soft corners
  const star = (attrs) => svg('g', { 'stroke-linejoin': 'round', ...attrs }, ...STAR.map((tri) => svg('polygon', { points: tri.map((p) => p.join(',')).join(' ') })));
  starLayer.append(
    star({ fill: '#000', stroke: '#000', 'stroke-width': '1.7', opacity: '0.45', transform: 'translate(0.12 0.34)', class: 'cc-shadow' }),
    star({ fill: 'url(#cc-wood)', stroke: 'url(#cc-wood)', 'stroke-width': '1.6' }),
    star({ fill: '#fff', stroke: '#fff', 'stroke-width': '1.6', filter: 'url(#cc-grain)', opacity: '0.9' }),
    star({ fill: 'none', stroke: '#5c3615', 'stroke-width': '0.06', opacity: '0.5', transform: 'scale(1.11)' }),
  );

  let turns = 0;
  const pos = (i) => layout(i, turns);
  const holeEls = [];
  const hitEls = [];
  for (let i = 0; i < N; i++) {
    const hole = svg('circle', { r: '0.2', fill: 'url(#cc-hole)' });
    holes.append(hole);
    holeEls.push(hole);
    const hit = svg('circle', { r: '0.5', class: 'cc-hit', 'data-i': i });
    hit.addEventListener('click', () => onPick(i));
    hit.addEventListener('pointerenter', (ev) => ev.pointerType === 'mouse' && onHover(i));
    hit.addEventListener('focus', () => onHover(i));
    hit.addEventListener('keydown', (ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), onPick(i)));
    hits.append(hit);
    hitEls.push(hit);
  }
  hits.addEventListener('pointerleave', () => onHover(null));
  function placeHoles() {
    for (let i = 0; i < N; i++) {
      const { px, py } = pos(i);
      holeEls[i].setAttribute('cx', px);
      holeEls[i].setAttribute('cy', py);
      hitEls[i].setAttribute('cx', px);
      hitEls[i].setAttribute('cy', py);
    }
  }

  function makeMarble(seat) {
    return svg('g', { class: 'cc-marble' },
      svg('ellipse', { class: 'cc-mshadow', cx: '0.07', cy: '0.13', rx: R * 1.02, ry: R * 0.95 }),
      svg('g', { class: 'cc-mball' },
        svg('circle', { r: R, fill: `url(#cc-m${seat})` }),
        svg('circle', { r: R * 0.98, fill: 'none', stroke: COLORS[seat].dark, 'stroke-width': '0.04', opacity: '0.6' }),
        svg('circle', { r: R, fill: 'url(#cc-shine)' })),
    );
  }
  const place = (el, px, py, lift = 0) => {
    el.setAttribute('transform', `translate(${px} ${py})`);
    el.firstChild.setAttribute('transform', `translate(${lift * 0.25} ${lift * 0.45}) scale(${1 + lift * 0.15})`);
    el.lastChild.setAttribute('transform', `translate(0 ${-lift * 0.35}) scale(${1 + lift * 0.28})`);
  };

  let view = null;
  let anim = null; // { el, path, t, raf }
  const els = new Map(); // hole → marble element

  function stopAnim() {
    if (!anim) return;
    cancelAnimationFrame(anim.raf);
    const { px, py } = pos(anim.path[anim.path.length - 1]);
    place(anim.el, px, py);
    anim.el.classList.remove('moving');
    anim = null;
  }

  function hop(el, path) {
    const jump = path.length > 2 || isJump(path);
    const per = jump ? HOP_JUMP : HOP_STEP;
    const legs = path.length - 1;
    let start = null;
    let landed = 0;
    el.classList.add('moving');
    marbles.append(el); // on top of the others while it flies
    const frame = (now) => {
      if (start == null) start = now;
      const t = (now - start) / 1000 / per;
      const leg = Math.min(legs - 1, Math.floor(t));
      const u = Math.min(1, t - leg);
      while (landed < Math.min(legs, Math.floor(t))) (landed++, onHop?.());
      if (t >= legs) {
        if (landed < legs) onHop?.();
        anim = null;
        el.classList.remove('moving');
        const { px, py } = pos(path[legs]);
        return place(el, px, py);
      }
      const a = pos(path[leg]), b = pos(path[leg + 1]);
      const e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u); // ease in and out
      place(el, a.px + (b.px - a.px) * e, a.py + (b.py - a.py) * e, Math.sin(Math.PI * u) * (jump ? 1 : 0.4));
      anim.raf = requestAnimationFrame(frame);
    };
    anim = { el, path, raf: requestAnimationFrame(frame) };
  }
  // a two-hole path is a jump if the holes aren't next to each other
  const isJump = (path) => {
    const a = CELLS[path[0]], b = CELLS[path[1]];
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z)) > 1;
  };

  function drawTints() {
    tints.replaceChildren();
    if (!view) return;
    view.homes.forEach((p, seat) => {
      const c = COLORS[seat];
      tints.append(svg('polygon', { points: pointTriangle(p, turns, 1.42).map((q) => q.join(',')).join(' '), fill: c.hex, 'fill-opacity': '0.2', stroke: c.hex, 'stroke-opacity': '0.55', 'stroke-width': '0.07', 'stroke-linejoin': 'round' }));
    });
    // your target point: a dashed outline in your colour
    if (view.seat != null) {
      const c = COLORS[view.seat];
      tints.append(svg('polygon', { class: 'cc-goal', points: pointTriangle(view.targets[view.seat], turns, 1.42).map((q) => q.join(',')).join(' '), fill: c.hex, 'fill-opacity': '0.07', stroke: c.hex, 'stroke-width': '0.08', 'stroke-dasharray': '0.25 0.18', 'stroke-linejoin': 'round' }));
    }
  }

  function drawTrail() {
    trail.replaceChildren();
    const last = view?.last;
    if (!last?.path) return;
    const pts = last.path.map((i) => {
      const { px, py } = pos(i);
      return `${px},${py}`;
    });
    trail.append(
      svg('polyline', { points: pts.join(' '), stroke: COLORS[last.seat].light }),
      svg('circle', { class: 'cc-from', r: '0.26', cx: pos(last.from).px, cy: pos(last.from).py, stroke: COLORS[last.seat].light }),
    );
  }

  function update(next, prev) {
    stopAnim();
    const newTurns = turnsFor(next.seat != null ? next.homes[next.seat] : null);
    const reoriented = newTurns !== turns || !view || view.n !== next.n || view.seat !== next.seat;
    turns = newTurns;
    view = next;
    if (reoriented) (placeHoles(), drawTints());
    const moved = prev && !reoriented && next.moves === prev.moves + 1 && next.last?.path ? next.last : null;
    // rebuild the marbles from the board; keep the elements that didn't move
    const keep = new Map();
    for (let i = 0; i < N; i++) {
      const seat = next.board[i];
      if (seat == null) continue;
      let el = els.get(i);
      if (moved && i === moved.to) el = els.get(moved.from);
      if (!el || el.dataset.seat !== String(seat)) (el = makeMarble(seat)), (el.dataset.seat = seat);
      keep.set(i, el);
    }
    const kept = new Set(keep.values());
    for (const el of els.values()) if (!kept.has(el)) el.remove();
    els.clear();
    for (const [i, el] of keep) {
      els.set(i, el);
      if (!el.isConnected) marbles.append(el);
      const { px, py } = pos(i);
      place(el, px, py);
    }
    drawTrail();
    if (moved) {
      const el = els.get(moved.to);
      const { px, py } = pos(moved.from);
      place(el, px, py);
      hop(el, moved.path);
    }
  }

  function mark({ selected = null, targets = [], path = null, movable = [] } = {}) {
    marks.replaceChildren();
    const ring = (i, cls, r) => {
      const { px, py } = pos(i);
      return svg('circle', { class: cls, cx: px, cy: py, r });
    };
    for (const i of movable) if (i !== selected) marks.append(ring(i, 'cc-movable', R + 0.06));
    if (selected != null) marks.append(ring(selected, 'cc-selected', R + 0.08));
    if (path && path.length > 1) {
      marks.append(svg('polyline', { class: 'cc-path', points: path.map((i) => `${pos(i).px},${pos(i).py}`).join(' ') }));
      for (const i of path.slice(1, -1)) marks.append(ring(i, 'cc-via', 0.1));
    }
    for (const i of targets) marks.append(ring(i, 'cc-target' + (path && path[path.length - 1] === i ? ' on' : ''), 0.17));
    // keyboard: only the holes you can use right now take focus
    const focusable = new Set([...movable, ...targets]);
    hitEls.forEach((el, i) => {
      if (focusable.has(i)) el.setAttribute('tabindex', '0');
      else el.removeAttribute('tabindex');
      el.classList.toggle('live', focusable.has(i));
    });
  }

  return {
    update,
    mark,
    destroy() {
      stopAnim();
      stage.remove();
    },
  };
}

