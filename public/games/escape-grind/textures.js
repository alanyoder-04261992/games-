// Escape the Grind — every texture is painted in code (no image downloads): wood, the printed
// board, space tiles, playing cards, dice faces and building windows.
import * as THREE from '../../vendor/three/three.module.js';
import { SPACE_INFO, STOCKS } from './cards.js';
import { money } from './engine.js';

const SERIF = '"Playfair Display", Georgia, "Times New Roman", serif';
const SANS = 'Inter, "Segoe UI", Roboto, Arial, sans-serif';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, { srgb = true, repeat = null, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.needsUpdate = true;
  return t;
}

// ---- tileable value noise ------------------------------------------------------------------
function noiseField(seed, period) {
  const v = new Float32Array(period * period);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < v.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    v[i] = ((x >>> 0) % 10000) / 10000;
  }
  return (px, py) => {
    const x0 = Math.floor(px), y0 = Math.floor(py);
    const fx = px - x0, fy = py - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const m = (n) => ((n % period) + period) % period;
    const a = v[m(y0) * period + m(x0)], b = v[m(y0) * period + m(x0 + 1)];
    const c = v[m(y0 + 1) * period + m(x0)], d = v[m(y0 + 1) * period + m(x0 + 1)];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

// ---- wood: planked walnut for the table, a darker solid piece for the board rim ------------
export function woodTextures({ w = 1024, h = 1024, planks = 5, dark = [46, 27, 15], light = [118, 74, 42], seed = 7 } = {}) {
  const [c, g] = canvas(w, h);
  const [rc, rg] = canvas(w, h);
  const img = g.createImageData(w, h);
  const rough = rg.createImageData(w, h);
  const n1 = noiseField(seed, 64);
  const n2 = noiseField(seed * 3 + 1, 64);
  for (let y = 0; y < h; y++) {
    const v = y / h;
    const plank = Math.floor(v * planks);
    const inPlank = v * planks - plank;
    const tint = 0.85 + ((plank * 9301 + 49297) % 233280) / 233280 * 0.3;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const wob = n1(u * 8 + plank * 13, v * 16) * 2 + n1(u * 32, v * 64) * 0.4;
      const ring = Math.sin((v * planks * 18 + wob * 3 + plank * 5.1) * Math.PI);
      const streak = n2(u * 3 + plank * 5, v * planks * 40) * 0.6 + n2(u * 64, v * 256) * 0.25;
      let t = 0.45 + ring * 0.18 + (streak - 0.4) * 0.6;
      t = Math.max(0, Math.min(1, t)) * tint;
      const seam = Math.min(inPlank, 1 - inPlank) * planks * h / planks;
      const edge = seam < 2 ? 0.35 : seam < 4 ? 0.75 : 1;
      const i = (y * w + x) * 4;
      img.data[i] = (dark[0] + (light[0] - dark[0]) * t) * edge;
      img.data[i + 1] = (dark[1] + (light[1] - dark[1]) * t) * edge;
      img.data[i + 2] = (dark[2] + (light[2] - dark[2]) * t) * edge;
      img.data[i + 3] = 255;
      const r = 150 + (1 - t) * 70 + (edge < 1 ? 35 : 0);
      rough.data[i] = rough.data[i + 1] = rough.data[i + 2] = Math.min(255, r);
      rough.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  rg.putImageData(rough, 0, 0);
  return { map: c, rough: rc };
}

// ---- the printed board surface ----------------------------------------------------------------
// R is the radius of the board top in world units; the ring radii are passed in world units.
export function boardTexture({ R, inner, outer }) {
  const S = 2048;
  const [c, g] = canvas(S, S);
  const k = S / (2 * R);
  const cx = S / 2;
  const grd = g.createRadialGradient(cx, cx, 0, cx, cx, S / 2);
  grd.addColorStop(0, '#1d6a4b');
  grd.addColorStop(0.55, '#12503a');
  grd.addColorStop(1, '#0a3122');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  // felt fibers
  const img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const ring = (r, wdt, col, dash) => {
    g.beginPath();
    g.arc(cx, cx, r * k, 0, Math.PI * 2);
    g.lineWidth = wdt;
    g.strokeStyle = col;
    g.setLineDash(dash || []);
    g.stroke();
    g.setLineDash([]);
  };
  ring(R - 0.18, 10, '#d8b35a');
  ring(R - 0.32, 3, '#d8b35a');
  ring(outer.r + outer.d / 2 + 0.22, 4, '#d8b35a');
  ring(outer.r - outer.d / 2 - 0.2, 4, '#d8b35a');
  ring(inner.r + inner.d / 2 + 0.2, 4, '#d8b35a');
  ring(inner.r - inner.d / 2 - 0.22, 6, '#d8b35a');
  ring(inner.r - inner.d / 2 - 0.36, 2, '#d8b35a');
  // curved lettering in the band between the two loops
  const band = (inner.r + inner.d / 2 + outer.r - outer.d / 2) / 2;
  const curved = (text, radius, startAngle, size, color, spacing = 1) => {
    g.save();
    g.font = `800 ${size}px ${SANS}`;
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let a = startAngle;
    for (const ch of text) {
      const wch = g.measureText(ch).width * spacing;
      const da = wch / (radius * k);
      g.save();
      g.translate(cx + Math.cos(a + da / 2) * radius * k, cx + Math.sin(a + da / 2) * radius * k);
      g.rotate(a + da / 2 + Math.PI / 2);
      g.fillText(ch, 0, 0);
      g.restore();
      a += da;
    }
    g.restore();
  };
  for (let q = 0; q < 4; q++) {
    curved('THE GRIND', band - 0.12, (q * Math.PI) / 2 + 0.25, 40, 'rgba(233, 215, 160, 0.75)', 1.35);
    curved('FREEDOM RING', band - 0.12, (q * Math.PI) / 2 + 0.95, 40, 'rgba(246, 215, 124, 0.9)', 1.35);
  }
  // center medallion
  const med = 1.75 * k;
  const mg = g.createRadialGradient(cx, cx - med * 0.3, med * 0.1, cx, cx, med);
  mg.addColorStop(0, '#1a4a37');
  mg.addColorStop(1, '#0c2a1e');
  g.fillStyle = mg;
  g.beginPath();
  g.arc(cx, cx, med, 0, Math.PI * 2);
  g.fill();
  ring(1.75, 8, '#d8b35a');
  ring(1.62, 2, '#d8b35a');
  g.textAlign = 'center';
  g.fillStyle = '#f2d27a';
  g.font = `900 ${Math.round(0.42 * k)}px ${SERIF}`;
  g.fillText('ESCAPE', cx, cx - 1.05 * k);
  g.font = `800 ${Math.round(0.2 * k)}px ${SANS}`;
  g.fillStyle = '#e9dcb5';
  g.fillText('T H E    G R I N D', cx, cx + 1.25 * k);
  return tex(c, { aniso: 16 });
}

// ---- space tiles ---------------------------------------------------------------------------
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${ch(n >> 16)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}
const ICONS = {
  dollar(g, s) {
    g.font = `900 ${s * 1.1}px ${SERIF}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('$', 0, s * 0.05);
  },
  bulb(g, s) {
    g.beginPath();
    g.arc(0, -s * 0.12, s * 0.32, Math.PI * 0.8, Math.PI * 2.2);
    g.lineTo(s * 0.14, s * 0.3);
    g.lineTo(-s * 0.14, s * 0.3);
    g.closePath();
    g.fill();
    g.fillRect(-s * 0.15, s * 0.34, s * 0.3, s * 0.08);
    g.fillRect(-s * 0.12, s * 0.45, s * 0.24, s * 0.07);
  },
  swap(g, s) {
    g.lineWidth = s * 0.11;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(-s * 0.38, -s * 0.16); g.lineTo(s * 0.36, -s * 0.16); g.lineTo(s * 0.18, -s * 0.34);
    g.moveTo(s * 0.38, s * 0.18); g.lineTo(-s * 0.36, s * 0.18); g.lineTo(-s * 0.18, s * 0.36);
    g.stroke();
  },
  bag(g, s) {
    g.beginPath();
    g.moveTo(-s * 0.34, -s * 0.12); g.lineTo(s * 0.34, -s * 0.12); g.lineTo(s * 0.4, s * 0.42); g.lineTo(-s * 0.4, s * 0.42); g.closePath();
    g.fill();
    g.lineWidth = s * 0.07;
    g.beginPath();
    g.arc(0, -s * 0.14, s * 0.18, Math.PI, 0);
    g.stroke();
  },
  heart(g, s) {
    g.beginPath();
    g.moveTo(0, s * 0.38);
    g.bezierCurveTo(-s * 0.55, 0, -s * 0.36, -s * 0.46, 0, -s * 0.2);
    g.bezierCurveTo(s * 0.36, -s * 0.46, s * 0.55, 0, 0, s * 0.38);
    g.fill();
  },
  stroller(g, s) {
    g.beginPath();
    g.moveTo(-s * 0.36, -s * 0.05);
    g.arc(-s * 0.02, -s * 0.05, s * 0.34, Math.PI, Math.PI * 1.5);
    g.lineTo(-s * 0.02, -s * 0.05);
    g.closePath();
    g.fill();
    g.fillRect(-s * 0.38, -s * 0.05, s * 0.7, s * 0.2);
    for (const x of [-0.24, 0.2]) {
      g.beginPath();
      g.arc(x * s, s * 0.32, s * 0.1, 0, Math.PI * 2);
      g.fill();
    }
  },
  slip(g, s) {
    g.fillRect(-s * 0.32, -s * 0.4, s * 0.64, s * 0.8);
    g.globalCompositeOperation = 'destination-out';
    g.lineWidth = s * 0.09;
    g.beginPath();
    g.moveTo(-s * 0.16, -s * 0.16); g.lineTo(s * 0.16, s * 0.16);
    g.moveTo(s * 0.16, -s * 0.16); g.lineTo(-s * 0.16, s * 0.16);
    g.stroke();
    g.globalCompositeOperation = 'source-over';
  },
  case(g, s) {
    g.fillRect(-s * 0.42, -s * 0.18, s * 0.84, s * 0.56);
    g.lineWidth = s * 0.08;
    g.strokeRect(-s * 0.16, -s * 0.34, s * 0.32, s * 0.18);
  },
  star(g, s) {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? s * 0.2 : s * 0.46;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  },
  bolt(g, s) {
    g.beginPath();
    g.moveTo(s * 0.1, -s * 0.46); g.lineTo(-s * 0.26, s * 0.06); g.lineTo(-s * 0.02, s * 0.06);
    g.lineTo(-s * 0.12, s * 0.46); g.lineTo(s * 0.26, -s * 0.08); g.lineTo(s * 0.02, -s * 0.08);
    g.closePath();
    g.fill();
  },
};
const ICON_FOR = { pay: 'dollar', opp: 'bulb', mkt: 'swap', spl: 'bag', chr: 'heart', kid: 'stroller', lay: 'slip', fpay: 'dollar', ven: 'case', drm: 'star', set: 'bolt' };

export function tileTexture(kind, w = 256, h = 300) {
  const info = SPACE_INFO[kind];
  const [c, g] = canvas(w, h);
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, shade(info.color, 1.18));
  grd.addColorStop(1, shade(info.color, 0.82));
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 5;
  g.strokeRect(12, 12, w - 24, h - 24);
  g.save();
  g.translate(w / 2, h * 0.42);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.translate(3, 4);
  ICONS[ICON_FOR[kind]](g, w * 0.5);
  g.translate(-3, -4);
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  ICONS[ICON_FOR[kind]](g, w * 0.5);
  g.restore();
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 34;
  g.font = `800 ${size}px ${SANS}`;
  while (g.measureText(info.label.toUpperCase()).width > w - 40 && size > 18) g.font = `800 ${--size}px ${SANS}`;
  g.fillText(info.label.toUpperCase(), w / 2, h * 0.82);
  return tex(c);
}

// ---- cards ------------------------------------------------------------------------------------
export const DECK_STYLE = {
  small: { name: 'SMALL DEAL', color: '#2c8f5b', ink: '#0f3d26' },
  big: { name: 'BIG DEAL', color: '#2463b8', ink: '#0f2a52' },
  market: { name: 'MARKET', color: '#7a4fd0', ink: '#2f1a5c' },
  splurge: { name: 'SPLURGE', color: '#d6463b', ink: '#5a1510' },
  venture: { name: 'VENTURE', color: '#1f7fb8', ink: '#0b3350' },
  setback: { name: 'SETBACK', color: '#9f2e2e', ink: '#3d0d0d' },
  dream: { name: 'DREAM', color: '#d9a21b', ink: '#4a3204' },
};
const CW = 768, CH = 1075;
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function paper(g, w, h) {
  roundRect(g, 0, 0, w, h, 44);
  g.save();
  g.clip();
  const grd = g.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, '#fbf8f0');
  grd.addColorStop(1, '#ece5d4');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = `rgba(80,60,30,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  g.restore();
}
function wrap(g, text, x, y, maxW, lh) {
  const words = String(text).split(' ');
  let line = '';
  for (const wd of words) {
    const t = line ? line + ' ' + wd : wd;
    if (g.measureText(t).width > maxW && line) {
      g.fillText(line, x, y);
      y += lh;
      line = wd;
    } else line = t;
  }
  if (line) g.fillText(line, x, y);
  return y + lh;
}

export function cardBack(deck) {
  const st = DECK_STYLE[deck];
  const [c, g] = canvas(384, 538);
  roundRect(g, 0, 0, 384, 538, 24);
  g.save();
  g.clip();
  g.fillStyle = st.color;
  g.fillRect(0, 0, 384, 538);
  g.strokeStyle = 'rgba(255,255,255,0.14)';
  g.lineWidth = 3;
  for (let i = -538; i < 538; i += 22) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 538, 538);
    g.stroke();
  }
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 6;
  roundRect(g, 18, 18, 348, 502, 16);
  g.stroke();
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 46px ${SERIF}`;
  const words = st.name.split(' ');
  words.forEach((w, i) => g.fillText(w, 192, 269 + (i - (words.length - 1) / 2) * 54));
  return tex(c);
}

export function cardFace(card, deck) {
  const st = DECK_STYLE[deck] || DECK_STYLE.small;
  const [c, g] = canvas(CW, CH);
  paper(g, CW, CH);
  g.save();
  roundRect(g, 0, 0, CW, CH, 44);
  g.clip();
  g.fillStyle = st.color;
  g.fillRect(0, 0, CW, 150);
  g.restore();
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `800 40px ${SANS}`;
  g.fillText(st.name.split('').join(' '), CW / 2, 78);
  g.fillStyle = st.ink;
  let size = 62;
  g.font = `900 ${size}px ${SERIF}`;
  const title = card.name || '';
  const lines = [];
  {
    const words = title.split(' ');
    let line = '';
    for (const wd of words) {
      const t = line ? line + ' ' + wd : wd;
      if (g.measureText(t).width > CW - 90 && line) {
        lines.push(line);
        line = wd;
      } else line = t;
    }
    lines.push(line);
  }
  let y = 230;
  for (const l of lines.slice(0, 3)) {
    g.fillText(l, CW / 2, y);
    y += 70;
  }
  g.font = `500 34px ${SANS}`;
  g.fillStyle = '#3a3326';
  y = wrap(g, card.text || '', CW / 2, y + 20, CW - 110, 46);

  const rows = [];
  if (card.type === 'asset') {
    rows.push(['Price', money(card.cost)]);
    if (card.mortgage) rows.push(['Loan', money(card.mortgage)]);
    rows.push(['Down payment', money(card.down)]);
    rows.push(['Cash flow', `${card.flow >= 0 ? '+' : ''}${money(card.flow)} / mo`, card.flow > 0 ? '#1b7a46' : card.flow < 0 ? '#b3261e' : '#3a3326']);
  } else if (card.type === 'stock') {
    rows.push(['Symbol', card.sym]);
    rows.push(['Price per share', `$${card.price}`, '#1b4f9a']);
    rows.push(['Usual range', card.sym === 'BMF' ? '$10 – $30' : card.sym === 'CRL' ? '$5 – $30' : '$1 – $40']);
  } else if (card.type === 'offer') {
    if (card.price != null) rows.push(['Offer', money(card.price), '#1b7a46']);
    if (card.perUnit != null) rows.push(['Offer per unit', money(card.perUnit), '#1b7a46']);
    if (card.mult != null) rows.push(['Offer', `${card.mult}× what you paid`, '#1b7a46']);
  } else if (card.type === 'boom') rows.push(['Cash flow', `+${money(card.flow)} / mo each`, '#1b7a46']);
  else if (card.type === 'repair') rows.push(['Owners pay', money(card.amount), '#b3261e']);
  else if (card.type === 'splurge') rows.push(['You pay', money(card.amount), '#b3261e']);
  else if (card.type === 'venture') {
    rows.push(['Price', money(card.cost)]);
    rows.push(['Cash flow', `+${money(card.flow)} / mo`, '#1b7a46']);
  } else if (card.type === 'dream') rows.push(['Price', money(card.cost), '#8a5a08']);
  else if (card.type === 'setback') rows.push(['You lose', card.half ? 'Half your cash' : money(card.amount), '#b3261e']);
  else if (card.type === 'split') rows.push(['Shares', card.factor > 1 ? '×2' : '÷2', '#1b4f9a']);

  if (card.listCost && card.listCost !== card.cost) rows.unshift(['Normal price', money(card.listCost), '#7a6b4c']);
  if (card.econNote) {
    // a stamped banner: "Recession sale: 22% off"
    const sale = /off|less/.test(card.econNote) && card.type !== 'offer';
    g.save();
    g.translate(CW / 2, y + 30);
    g.rotate(-0.04);
    g.fillStyle = sale || /more/.test(card.econNote) ? '#1b7a46' : '#b3261e';
    roundRect(g, -(CW - 120) / 2, -30, CW - 120, 60, 12);
    g.fill();
    g.fillStyle = '#fff';
    g.font = `800 30px ${SANS}`;
    g.fillText(card.econNote.toUpperCase(), 0, 2);
    g.restore();
    y += 70;
  }
  let ry = Math.max(y + 10, CH - 110 - rows.length * 86);
  for (const [label, val, col] of rows) {
    g.fillStyle = 'rgba(0,0,0,0.05)';
    roundRect(g, 50, ry - 36, CW - 100, 72, 14);
    g.fill();
    g.textAlign = 'left';
    g.fillStyle = '#5b5241';
    g.font = `600 32px ${SANS}`;
    g.fillText(label, 76, ry);
    g.textAlign = 'right';
    g.fillStyle = col || '#2a2418';
    g.font = `800 40px ${SANS}`;
    g.fillText(val, CW - 76, ry);
    ry += 86;
  }
  g.textAlign = 'center';
  g.fillStyle = 'rgba(60,50,30,0.45)';
  g.font = `700 22px ${SANS}`;
  g.fillText('E S C A P E   T H E   G R I N D', CW / 2, CH - 34);
  if (card.type === 'stock' && STOCKS[card.sym]) {
    /* the note is already in the text */
  }
  return tex(c, { aniso: 16 });
}

// ---- dice ------------------------------------------------------------------------------------
export function dieFaces() {
  const pips = {
    1: [[0.5, 0.5]],
    2: [[0.27, 0.27], [0.73, 0.73]],
    3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
    4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
    5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
    6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]],
  };
  const out = {};
  for (let v = 1; v <= 6; v++) {
    const [c, g] = canvas(256, 256);
    const grd = g.createRadialGradient(128, 110, 20, 128, 128, 190);
    grd.addColorStop(0, '#fffdf6');
    grd.addColorStop(1, '#efe8d6');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    for (const [x, y] of pips[v]) {
      const r = v === 1 ? 30 : 22;
      const pg = g.createRadialGradient(x * 256 - 5, y * 256 - 6, 2, x * 256, y * 256, r);
      pg.addColorStop(0, '#4a0d0d');
      pg.addColorStop(1, v === 1 ? '#a3161a' : '#151515');
      g.fillStyle = pg;
      g.beginPath();
      g.arc(x * 256, y * 256, r, 0, Math.PI * 2);
      g.fill();
    }
    out[v] = tex(c);
  }
  return out;
}

// ---- small textures for the miniature buildings ---------------------------------------------
export function windowsTexture({ floors = 3, cols = 4, wall = '#d9cbb4', glass = '#2b3d52', lit = 0.35 } = {}) {
  const [c, g] = canvas(256, 256);
  g.fillStyle = wall;
  g.fillRect(0, 0, 256, 256);
  const fh = 256 / floors, cw = 256 / cols;
  for (let f = 0; f < floors; f++)
    for (let k = 0; k < cols; k++) {
      g.fillStyle = Math.random() < lit ? '#ffd98a' : glass;
      g.fillRect(k * cw + cw * 0.2, f * fh + fh * 0.22, cw * 0.6, fh * 0.5);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillRect(k * cw + cw * 0.17, f * fh + fh * 0.72, cw * 0.66, fh * 0.05);
    }
  return tex(c);
}
export function sidingTexture(color = '#b3322a', trim = '#f4efe4') {
  const [c, g] = canvas(256, 256);
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let x = 0; x < 256; x += 16) g.fillRect(x, 0, 3, 256);
  g.fillStyle = trim;
  g.fillRect(92, 120, 72, 136);
  g.fillStyle = color;
  g.fillRect(100, 128, 56, 128);
  g.strokeStyle = trim;
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(100, 128); g.lineTo(156, 256); g.moveTo(156, 128); g.lineTo(100, 256);
  g.stroke();
  g.fillStyle = trim;
  g.fillRect(124, 128, 8, 128);
  return tex(c);
}
export function rollDoorsTexture() {
  const [c, g] = canvas(512, 128);
  g.fillStyle = '#e7e2d7';
  g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = '#e0762b';
    g.fillRect(i * 64 + 8, 24, 48, 104);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 30; y < 128; y += 9) g.fillRect(i * 64 + 8, y, 48, 2);
  }
  return tex(c);
}
export function awningTexture() {
  const [c, g] = canvas(256, 64);
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 2 ? '#f3efe6' : '#2a8a5a';
    g.fillRect(i * 16, 0, 16, 64);
  }
  return tex(c);
}
export function coinFaceTexture() {
  const [c, g] = canvas(256, 256);
  const grd = g.createRadialGradient(110, 100, 10, 128, 128, 130);
  grd.addColorStop(0, '#fff0b0');
  grd.addColorStop(0.6, '#e9b949');
  grd.addColorStop(1, '#a8740f');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(128, 128, 128, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#8a5a08';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(128, 128, 104, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#8a5a08';
  g.font = `900 140px ${SERIF}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('$', 128, 136);
  return tex(c);
}
export function bumpFromCanvas(canvasEl, repeat) {
  return tex(canvasEl, { srgb: false, repeat });
}
export function woodTex(canvasEl, repeat, srgb = true) {
  return tex(canvasEl, { srgb, repeat, aniso: 16 });
}
