// Synthesized sound effects (no audio files). Everything is generated with WebAudio so the
// site stays small and works offline.
import { store } from './util.js';

let ctx = null;
let master = null;
let enabled = store.get('gc.sound', true);

function audio() {
  if (!enabled) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Browsers need a user gesture before audio can start.
window.addEventListener('pointerdown', () => audio(), { once: true, capture: true });

let noiseBuf = null;
function noise(ac) {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function burst({ freq = 2400, q = 0.8, dur = 0.07, gain = 0.5, type = 'bandpass', delay = 0 }) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + delay;
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.3);
  src.stop(t + dur + 0.02);
}

function tone({ freq = 440, dur = 0.2, gain = 0.2, type = 'sine', delay = 0, slide = 0 }) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sound = {
  get enabled() {
    return enabled;
  },
  set enabled(v) {
    enabled = !!v;
    store.set('gc.sound', enabled);
    if (enabled) audio();
  },
  card() {
    burst({ freq: 3200, q: 0.7, dur: 0.06, gain: 0.45 });
    burst({ freq: 420, q: 1.2, dur: 0.09, gain: 0.35, type: 'lowpass' });
  },
  slide() {
    burst({ freq: 1800, q: 0.4, dur: 0.16, gain: 0.22 });
  },
  deal(count = 8) {
    for (let i = 0; i < count; i++) burst({ freq: 2600 + Math.random() * 900, q: 0.9, dur: 0.045, gain: 0.25, delay: i * 0.045 });
  },
  shuffle() {
    for (let i = 0; i < 26; i++) burst({ freq: 2000 + Math.random() * 1800, q: 1.1, dur: 0.03, gain: 0.18, delay: i * 0.018 });
    for (let i = 0; i < 26; i++) burst({ freq: 2000 + Math.random() * 1800, q: 1.1, dur: 0.03, gain: 0.18, delay: 0.62 + i * 0.016 });
  },
  sweep() {
    burst({ freq: 900, q: 0.3, dur: 0.28, gain: 0.25, type: 'lowpass' });
  },
  chip() {
    tone({ freq: 1250, dur: 0.06, gain: 0.12, type: 'triangle' });
    tone({ freq: 1870, dur: 0.05, gain: 0.08, type: 'triangle', delay: 0.03 });
  },
  turn() {
    tone({ freq: 660, dur: 0.16, gain: 0.1 });
    tone({ freq: 990, dur: 0.22, gain: 0.08, delay: 0.09 });
  },
  good() {
    [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.35, gain: 0.1, type: 'triangle', delay: i * 0.08 }));
  },
  bad() {
    [392, 330, 262].forEach((f, i) => tone({ freq: f, dur: 0.4, gain: 0.1, type: 'sawtooth', delay: i * 0.11 }));
  },
  win() {
    [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => tone({ freq: f, dur: 0.4, gain: 0.1, type: 'triangle', delay: i * 0.11 }));
  },
  pop() {
    tone({ freq: 520, dur: 0.08, gain: 0.12, slide: 1.8 });
  },
  error() {
    tone({ freq: 180, dur: 0.15, gain: 0.12, type: 'square' });
  },
};
