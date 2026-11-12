// Small shared helpers for the Game Center shell and the games.

// replaceChildren/append ignore null and false, so templates can use `cond ? el : null`.
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const name of ['replaceChildren', 'append']) {
    const original = proto[name];
    proto[name] = function (...kids) {
      return original.apply(this, kids.flat(Infinity).filter((k) => k != null && k !== false));
    };
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// h('div.card.red', { onclick, style: {...}, dataset: {...} }, ...children)
export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props != null && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, val);
        else el.style[prop] = val;
      }
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'class') el.className += ' ' + v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Emitter {
  #handlers = new Map();
  on(type, fn) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
    this.#handlers.get(type).add(fn);
    return () => this.#handlers.get(type)?.delete(fn);
  }
  emit(type, ...args) {
    for (const fn of this.#handlers.get(type) || []) {
      try {
        fn(...args);
      } catch (e) {
        console.error(e);
      }
    }
  }
}

export const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or blocked */
    }
  },
  del(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export function uid(n = 10) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function roomCode(n = 5) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// A little toast at the top of the screen.
export function toast(text, { ms = 2600, kind = '' } = {}) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div');
    host.id = 'toasts';
    document.body.append(host);
  }
  const el = h('div.toast' + (kind ? '.' + kind : ''), text);
  host.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  }, ms);
}

// Initials avatar with a gradient from the player's hue.
export function avatar(name = '?', hue = 210, { bot = false, size = '' } = {}) {
  const initials = name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const el = h('div.avatar' + (size ? '.' + size : ''), {
    style: { '--hue': hue },
    title: name,
  });
  el.append(h('span.initials', initials || '?'));
  if (bot) el.append(h('span.bot-badge', { html: ROBOT_SVG, title: 'Computer player' }));
  return el;
}

export const ROBOT_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="8" width="14" height="11" rx="3" fill="currentColor"/><rect x="11" y="3" width="2" height="4" fill="currentColor"/><circle cx="12" cy="3" r="1.6" fill="currentColor"/><circle cx="9.5" cy="13" r="1.6" fill="#0b1220"/><circle cx="14.5" cy="13" r="1.6" fill="#0b1220"/><rect x="9" y="16" width="6" height="1.4" rx=".7" fill="#0b1220"/></svg>`;

export function share({ title, text, url }) {
  if (navigator.share) return navigator.share({ title, text, url }).catch(() => {});
  return navigator.clipboard?.writeText(url).then(() => toast('Link copied'));
}
