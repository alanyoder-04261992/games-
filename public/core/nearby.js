// Nearby play: an online table with no internet and no server.
//
// Everyone is on the same Wi-Fi, or on one phone's hotspot. Phones still talk over WebRTC
// (like online tables), but instead of a signalling server introducing them, they swap two
// QR codes: the host shows a code (a WebRTC offer), the player scans it and shows one back
// (the answer), and the host scans that. Each player gets their own pair of codes. After
// that the connection looks to the rest of the Game Center exactly like an online one
// (see ChannelConn), so seats, chat, rematch and the next game all work the same.
//
// The codes hold a WebRTC description, squeezed (deflate) and written in base45 (RFC 9285),
// which fits QR's compact alphanumeric mode. They start with "GC1" so other QR codes are
// ignored. Anyone without a camera can copy and paste the code as text instead.
import { Emitter, h, uid } from './util.js';

const PREFIX = 'GC1';
const NO_SERVERS = { iceServers: [] }; // nothing outside the local network

// ---------- the two small libraries in public/vendor/qr, loaded on first use ----------
const loaded = {};
function loadScript(file, name) {
  if (window[name]) return Promise.resolve(window[name]);
  loaded[file] ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL(`../vendor/qr/${file}`, import.meta.url).href;
    s.onload = () => (window[name] ? resolve(window[name]) : reject(new Error(`${file} did not load`)));
    s.onerror = () => {
      loaded[file] = null;
      reject(new Error('Could not load the QR code reader. Open the Game Center once with internet first.'));
    };
    document.head.append(s);
  });
  return loaded[file];
}

// ---------- packing a code ----------
const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
export function b45encode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      let n = bytes[i] * 256 + bytes[i + 1];
      const c = n % 45;
      n = (n - c) / 45;
      out += B45[c] + B45[n % 45] + B45[(n - (n % 45)) / 45];
    } else {
      const n = bytes[i];
      out += B45[n % 45] + B45[(n - (n % 45)) / 45];
    }
  }
  return out;
}
export function b45decode(str) {
  const out = [];
  for (let i = 0; i < str.length; i += 3) {
    const chunk = str.slice(i, i + 3);
    const v = [...chunk].map((ch) => B45.indexOf(ch));
    if (v.some((x) => x < 0) || chunk.length < 2) throw new Error('That isn’t a Game Center code');
    const n = v[0] + v[1] * 45 + (v.length === 3 ? v[2] * 2025 : 0);
    if (v.length === 3) {
      if (n > 65535) throw new Error('That isn’t a Game Center code');
      out.push(n >> 8, n & 255);
    } else {
      if (n > 255) throw new Error('That isn’t a Game Center code');
      out.push(n);
    }
  }
  return new Uint8Array(out);
}

async function squeeze(bytes, how) {
  const stream = new Blob([bytes]).stream().pipeThrough(how === 'in' ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function pack(obj) {
  return PREFIX + b45encode(await squeeze(new TextEncoder().encode(JSON.stringify(obj)), 'in'));
}

export async function unpack(text) {
  const t = String(text || '').trim().replace(/\s*\n\s*/g, '');
  if (!t.startsWith(PREFIX)) throw new Error('That isn’t a Game Center code');
  try {
    return JSON.parse(new TextDecoder().decode(await squeeze(b45decode(t.slice(PREFIX.length)), 'out')));
  } catch {
    throw new Error('That code didn’t read right. Try again.');
  }
}

// a WebRTC description with only what a data connection needs (smaller QR codes)
function slim(sdp) {
  return sdp
    .split('\r\n')
    .filter((l) => l && !/^a=(extmap-allow-mixed|msid-semantic|ice-options)/.test(l) && !(l.startsWith('a=candidate') && / tcp /i.test(l)))
    .map((l) => (l.startsWith('a=candidate') ? l.replace(/ generation \d+| network-id \d+| network-cost \d+/g, '') : l))
    .join('\r\n') + '\r\n';
}

// wait until the device has listed its own addresses (no servers to ask, so it is quick)
function gathered(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => pc.iceGatheringState === 'complete' && resolve();
    pc.addEventListener('icegatheringstatechange', done);
    setTimeout(resolve, 4000);
  });
}

// ---------- a connection that looks like a PeerJS one to the rest of the Game Center ----------
export class ChannelConn extends Emitter {
  constructor(pc, dc = null) {
    super();
    this.pc = pc;
    this.dc = null;
    this.done = false;
    if (dc) this.#bind(dc);
    else pc.addEventListener('datachannel', (e) => this.#bind(e.channel));
    pc.addEventListener('connectionstatechange', () => ['failed', 'closed'].includes(pc.connectionState) && this.#closed());
  }
  #bind(dc) {
    this.dc = dc;
    // a channel that arrives already open may still fire 'open' later: say it once
    const opened = () => {
      if (this.wasOpen) return;
      this.wasOpen = true;
      this.emit('open');
    };
    dc.onopen = opened;
    dc.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      this.emit('data', msg);
    };
    dc.onclose = () => this.#closed();
    if (dc.readyState === 'open') queueMicrotask(opened);
  }
  #closed() {
    if (this.done) return;
    this.done = true;
    this.emit('close');
  }
  get open() {
    return this.dc?.readyState === 'open';
  }
  send(msg) {
    if (this.open) this.dc.send(JSON.stringify(msg));
  }
  close() {
    try {
      this.dc?.close();
      this.pc.close();
    } catch {
      /* already closed */
    }
    this.#closed();
  }
}

// ---------- the host: one code to show at a time, and the player's code back ----------
export class NearbyHost {
  constructor(room) {
    this.room = room;
    this.pending = new Map(); // offer id → { pc, dc }, newest last
  }
  async offer() {
    const pc = new RTCPeerConnection(NO_SERVERS);
    const dc = pc.createDataChannel('gc', { ordered: true });
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    const id = uid(5);
    this.pending.set(id, { pc, dc });
    // keep the last few: a player may scan a code that has since been replaced on screen
    for (const [old, x] of this.pending) {
      if (this.pending.size <= 4) break;
      this.pending.delete(old);
      x.pc.close();
    }
    const room = this.room;
    const text = await pack({ k: 'o', i: id, c: room.code, h: room.players.get('host')?.name || 'Host', g: room.game.id, s: slim(pc.localDescription.sdp) });
    return { id, text };
  }
  // the player's code: connects them and hands the connection to the table
  async answer(text) {
    const m = await unpack(text);
    if (m.k !== 'a') throw new Error('That’s a host’s code. Scan the code on the player’s screen.');
    const p = this.pending.get(m.i);
    if (!p) throw new Error('That player scanned an old code. Ask them to scan the code on your screen again.');
    this.pending.delete(m.i);
    await p.pc.setRemoteDescription({ type: 'answer', sdp: m.s });
    const conn = new ChannelConn(p.pc, p.dc);
    this.room.acceptLink(conn);
    return conn;
  }
  close() {
    for (const x of this.pending.values()) x.pc.close();
    this.pending.clear();
  }
}

// ---------- a player: the host's code in, our code out ----------
export async function answerOffer(text) {
  const m = await unpack(text);
  if (m.k !== 'o') throw new Error('That’s a player’s code. Scan the code on the host’s screen.');
  const pc = new RTCPeerConnection(NO_SERVERS);
  const conn = new ChannelConn(pc);
  await pc.setRemoteDescription({ type: 'offer', sdp: m.s });
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  return { code: m.c, host: m.h, gameId: m.g, conn, text: await pack({ k: 'a', i: m.i, s: slim(pc.localDescription.sdp) }) };
}

// ---------- on screen ----------
// A QR code for `text`, as an SVG element sized by CSS.
export async function qrCode(text) {
  const qrcode = await loadScript('qrcode.min.js', 'qrcode');
  const q = qrcode(0, 'L');
  q.addData(text, 'Alphanumeric');
  q.make();
  const box = h('div.gc-qr', { role: 'img', 'aria-label': 'Join code to scan' });
  box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 16, scalable: true }); // a white border 4 squares wide: readers need it
  return box;
}

// The camera, reading QR codes until it finds a Game Center code. Also a box to paste the
// code as text (computers without a camera, or a camera that won't focus).
export function scanner({ onCode, label = 'Point the camera at the code' }) {
  const video = h('video', { playsinline: '', muted: '', autoplay: '' });
  video.muted = true;
  video.setAttribute('playsinline', '');
  const note = h('p.gc-hint.gc-scan-note', 'Starting the camera…');
  const paste = h('textarea.gc-input.gc-paste', { rows: 3, placeholder: 'Or paste the code here', spellcheck: false, autocapitalize: 'characters' });
  let stream = null;
  let timer = null;
  let stopped = false;
  let busy = false;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
  };
  const found = async (text) => {
    if (busy || stopped) return;
    busy = true;
    try {
      await onCode(text);
      stop();
    } catch (e) {
      note.textContent = e.message;
      note.classList.add('warn');
      setTimeout(() => (busy = false), 1500); // let them point at the right code
      return;
    }
  };
  const el = h(
    'div.gc-scanner',
    h('div.gc-scan-view', video, h('div.gc-scan-frame')),
    note,
    paste,
    h('button.btn.ghost.small', { type: 'button', onclick: () => paste.value.trim() && found(paste.value) }, 'Use pasted code'),
  );
  (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (stopped) return stop();
      video.srcObject = stream;
      await video.play().catch(() => {});
      note.textContent = label;
      const detector = 'BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats?.())?.includes('qr_code') ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
      const jsQR = detector ? null : await loadScript('jsqr.min.js', 'jsQR');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const look = async () => {
        if (stopped) return;
        if (video.readyState >= 2 && !busy) {
          try {
            let text = null;
            if (detector) text = (await detector.detect(video))[0]?.rawValue;
            else {
              const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
              canvas.width = Math.round(video.videoWidth * scale);
              canvas.height = Math.round(video.videoHeight * scale);
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              text = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data;
            }
            if (text?.startsWith(PREFIX)) await found(text);
          } catch {
            /* a frame that didn't read: try the next */
          }
        }
        timer = setTimeout(look, 180);
      };
      look();
    } catch {
      el.classList.add('no-camera');
      note.textContent = 'No camera here (or it isn’t allowed). Paste the code instead: the other phone can copy it under its QR code.';
    }
  })();
  return { el, stop };
}
