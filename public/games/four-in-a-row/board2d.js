// Four in a Row: the flat board, drawn with HTML and CSS (four.css). Used when "3D board" is off
// in Settings, or when the device can't run the 3D board.
//
// It has the same small interface as the 3D board in scene.js, so ui.js can use either one:
//   const board = createFlatBoard(container, { onHover, onPick, onLand });
//   board.update(view, prev)   draw a view; animate what changed since `prev` (null = no animation)
//   board.preview(col, seat)   show the disc hovering over a column (col null = hide it)
//   board.destroy()
// The board never sends moves itself. It reports the column under the pointer (onHover) and the
// column the player chose (onPick), and onLand when a dropped disc hits bottom (for the sound).
import { h } from '../../core/util.js';

const COLS = 7;

export function createFlatBoard(container, { onHover, onPick, onLand }) {
  const discs = h('div.f4-discs');
  const rack = h('div.f4-rack');
  const rims = h('div.f4-rims');
  const line = h('div.f4-line');
  const ghost = h('div.f4-ghost', h('div.f4-disc'));
  const cols = h('div.f4-cols');
  const board = h('div.f4-board', discs, rack, rims, line, cols);
  const stage = h(
    'div.f4-stage',
    ghost,
    h('div.f4-frame', board, h('div.f4-leg.left'), h('div.f4-leg.right')),
    h('div.f4-shadow'),
  );
  container.append(stage);

  // one invisible button per column: the click target, and keyboard focus moves the preview
  for (let c = 0; c < COLS; c++) {
    cols.append(
      h('button.f4-col', {
        'aria-label': `Column ${c + 1}`,
        onclick: () => onPick(c),
        onpointerenter: () => onHover(c),
        onfocus: () => onHover(c),
      }),
    );
  }
  cols.addEventListener('pointerleave', () => onHover(null));

  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => (timers.delete(id), fn()), ms);
    timers.add(id);
  };

  function update(view, prev) {
    const newGame = prev && view.moves < prev.moves;
    const dropped = prev && view.moves === prev.moves + 1 ? view.last : null;
    // a new game: the old discs fall out of the bottom of the rack
    if (newGame) {
      for (const d of discs.querySelectorAll('.f4-disc')) {
        const out = d.cloneNode();
        out.className = d.className.replace(/\b(drop|win)\b/g, '') + ' out';
        out.style.setProperty('--delay', `${Math.random() * 0.12}s`);
        board.append(out);
        later(() => out.remove(), 1000);
      }
    }
    discs.replaceChildren(
      ...view.board.flatMap((v, i) => {
        if (v == null) return [];
        const c = i % COLS;
        const r = Math.floor(i / COLS);
        const d = h(`div.f4-disc.p${v}`, { style: { '--c': c, '--r': r } });
        if (dropped && dropped.col === c && dropped.row === r) d.classList.add('drop');
        if (view.line?.some(([x, y]) => x === c && y === r)) d.classList.add('win');
        return [d];
      }),
    );
    if (dropped) later(onLand, 160 + dropped.row * 45);
    drawLine(view.line);
  }

  // a glowing bar through the winning four
  function drawLine(cells) {
    if (!cells || cells.length < 2) {
      line.classList.remove('show');
      return;
    }
    const sorted = [...cells].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const [x1, y1] = sorted[0];
    const [x2, y2] = sorted[sorted.length - 1];
    line.style.setProperty('--x', x1 + 0.5);
    line.style.setProperty('--y', y1 + 0.5);
    line.style.setProperty('--len', Math.hypot(x2 - x1, y2 - y1));
    line.style.setProperty('--angle', `${Math.atan2(y2 - y1, x2 - x1)}rad`);
    if (line.classList.contains('show')) return; // already drawn (a repeated state message)
    void line.offsetWidth; // restart the animation
    line.classList.add('show');
  }

  function preview(col, seat) {
    ghost.classList.toggle('show', col != null);
    if (col != null) {
      ghost.style.setProperty('--c', col);
      ghost.firstChild.className = `f4-disc p${seat}`;
    }
  }

  return {
    update,
    preview,
    destroy() {
      timers.forEach(clearTimeout);
      stage.remove();
    },
  };
}
