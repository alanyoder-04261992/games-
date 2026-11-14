// Play stats for the Game Center's owner (dashboard at #/insights, see docs/INSIGHTS.md).
//
// Each device reports what it does: opening the app, starting, finishing or leaving a game,
// joining a friend's table. With a random device id and the name the player typed, so the
// owner can see who plays what. Nothing else: no IP addresses or locations are stored.
import { store } from './util.js';

const ENDPOINT = 'api/track';
const DEVICE = 'gc.device';
let queue = [];
let timer = null;

function deviceId() {
  let d = store.get(DEVICE);
  if (!d || !/^[A-Za-z0-9_-]{8,40}$/.test(d)) {
    const a = crypto.getRandomValues(new Uint8Array(12));
    d = [...a].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 16);
    store.set(DEVICE, d);
  }
  return d;
}

// Only where the site's own /api exists: deployed on Netlify, or `npm start` locally.
const supported = () => location.protocol.startsWith('http') && typeof fetch === 'function';

export function track(t, data = {}) {
  if (!supported() || /^#\/?insights/.test(location.hash)) return; // the owner reading the dashboard isn't play
  const name = store.get('gc.profile')?.name || 'Player';
  queue.push({ t, d: deviceId(), n: name, ...data });
  clearTimeout(timer);
  timer = setTimeout(flush, t === 'open' ? 4000 : 1500);
  if (queue.length >= 20) flush();
}

export function flush() {
  clearTimeout(timer);
  if (!queue.length) return;
  const body = JSON.stringify({ events: queue.splice(0, 25) });
  const url = new URL(ENDPOINT, document.baseURI).href;
  try {
    if (navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) return;
  } catch {
    /* fall back to fetch */
  }
  fetch(url, { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
}

addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
addEventListener('pagehide', flush);
