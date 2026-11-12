// Keeps players on the newest Game Center.
//
// 1. "Update ready" bar: every deploy writes build.json (tools/stamp-build.mjs) with the
//    deploy's id and every game's version. We read it when the page opens, then again
//    every few minutes and whenever the player comes back to the tab. If it changed, a
//    bar names what improved ("Hexstead v1.8") and a tap reloads onto the new version.
// 2. Pull to refresh: drag down from the top of the home, options and lobby pages to
//    reload (installed phone apps have no browser pull-to-refresh of their own). It is
//    off at the game table, where dragging belongs to the game.
import { h } from './util.js';
import { newer } from './version.js';

const CHECK_EVERY = 5 * 60e3;
const PULL_TRIGGER = 72; // px of (damped) pull that triggers a reload
const PULL_MAX = 110;

let loaded = null; // build.json as it was when this page loaded
let shown = null;
let checking = false;

export function startUpdates({ games, allowPull }) {
  check(games, true);
  setInterval(() => check(games), CHECK_EVERY);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check(games));
  window.addEventListener('online', () => check(games));
  window.addEventListener('focus', () => check(games));
  pullToRefresh(allowPull);
}

async function fetchBuild() {
  try {
    const res = await fetch(`build.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const info = await res.json();
    return info && typeof info.id === 'string' ? info : null;
  } catch {
    return null; // offline, or a host without a deploy step: nothing to compare
  }
}

async function check(games, first = false) {
  if (checking) return;
  checking = true;
  try {
    const now = await fetchBuild();
    if (!now) return;
    if (first || !loaded) {
      loaded = now;
      return;
    }
    if (now.id === loaded.id || shown?.id === now.id) return;
    showBar(now, whatsNew(now, games));
  } finally {
    checking = false;
  }
}

// games whose version went up, by name: "Hexstead v1.8, Rook v1.6"
function whatsNew(now, games) {
  const better = [];
  for (const [id, v] of Object.entries(now.games || {})) {
    const game = games.get(id);
    const before = loaded.games?.[id] ?? game?.version;
    if (!before || newer(v, before)) better.push(`${game?.name || id} v${v}`);
  }
  return better;
}

function showBar(info, better) {
  document.querySelector('.gc-update')?.remove();
  shown = info;
  const text = better.length ? `Improved: ${better.join(', ')}` : 'A new version of the Game Center is ready';
  const bar = h(
    'div.gc-update',
    { role: 'status', 'aria-live': 'polite' },
    h('button.gc-update-main', { type: 'button', onclick: () => reload() }, h('span.gc-update-dot'), h('span.gc-update-text', text), h('span.gc-update-go', 'Tap to reload')),
    h('button.gc-update-x', { type: 'button', 'aria-label': 'Later', onclick: () => bar.remove() }, '×'),
  );
  document.body.append(bar);
  requestAnimationFrame(() => bar.classList.add('open'));
}

function reload() {
  document.body.classList.add('gc-reloading');
  // make the service worker fetch fresh copies, then reload
  navigator.serviceWorker?.getRegistration?.().then((r) => r?.update()).catch(() => {});
  setTimeout(() => location.reload(), 60);
}

function pullToRefresh(allowPull) {
  const ring = h('div.gc-pull', { 'aria-hidden': 'true' }, h('div.gc-pull-ring', { html: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' }));
  document.body.append(ring);
  let startY = null;
  let startX = 0;
  let pull = 0;
  const set = (px) => {
    pull = px;
    ring.style.transform = `translate(-50%, ${px - 56}px)`;
    ring.style.opacity = String(Math.min(1, px / 40));
    ring.firstChild.style.transform = `rotate(${px * 3}deg)`;
    ring.classList.toggle('ready', px >= PULL_TRIGGER);
  };
  const reset = () => {
    startY = null;
    ring.classList.add('back');
    set(0);
    setTimeout(() => ring.classList.remove('back'), 250);
  };
  window.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1 || !allowPull() || scrollTop() > 0 || document.querySelector('.gc-modal-wrap')) return (startY = null);
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
    },
    { passive: true },
  );
  window.addEventListener(
    'touchmove',
    (e) => {
      if (startY == null) return;
      const dy = e.touches[0].clientY - startY;
      const dx = Math.abs(e.touches[0].clientX - startX);
      if (dy <= 0 || scrollTop() > 0 || (pull === 0 && dx > dy)) {
        if (pull) set(0);
        if (dy < 0 || dx > dy) startY = null;
        return;
      }
      set(Math.min(PULL_MAX, dy * 0.5)); // resistance: the ring moves half as far as the finger
      if (e.cancelable) e.preventDefault(); // we handle it: no page bounce underneath
    },
    { passive: false },
  );
  const end = () => {
    if (startY == null) return;
    if (pull >= PULL_TRIGGER) {
      ring.classList.add('spin');
      set(PULL_TRIGGER);
      reload();
    } else reset();
  };
  window.addEventListener('touchend', end, { passive: true });
  window.addEventListener('touchcancel', reset, { passive: true });
}

const scrollTop = () => window.scrollY || document.documentElement.scrollTop || 0;
