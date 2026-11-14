// Render-resolution control for the 3D table. Slower devices (older phones, TV browsers) drop
// the resolution a step at a time to keep the frame rate up, and raise it again when there is
// room. Two rules keep it from making things worse:
//  - a floor: on sharp (2x/3x) phone screens it never drops below 1.5 pixels per point, or the
//    tile words turn to mush and thin edges shimmer;
//  - hysteresis: it lowers only after two slow 2-second windows in a row, raises only after
//    three smooth ones, and once it has had to lower twice it settles and stops raising. Every
//    change resizes the canvas, which on some phones blinks a frame, so it must not flip back
//    and forth every couple of seconds.
export function newAdapt() {
  return { sum: 0, n: 0, scale: 1, slow: 0, smooth: 0, drops: 0 };
}

// Feed one frame's time; returns the new scale (0..1 of the best pixel ratio) when it changes,
// otherwise null. `max` is the best pixel ratio for this screen and quality setting.
export function adaptStep(a, dt, max) {
  a.sum += dt;
  a.n++;
  if (a.sum < 2) return null;
  const avg = a.sum / a.n;
  a.sum = a.n = 0;
  const floor = Math.min(1, (max >= 2 ? 1.5 : 1) / max);
  if (avg > 1 / 33) {
    a.smooth = 0;
    if (++a.slow < 2 || a.scale <= floor) return null;
    a.slow = 0;
    a.drops++;
    a.scale = Math.max(floor, Math.round((a.scale - 0.15) * 100) / 100);
    return a.scale;
  }
  a.slow = 0;
  if (avg < 1 / 55 && a.scale < 1 && a.drops < 2) {
    if (++a.smooth < 3) return null;
    a.smooth = 0;
    a.scale = Math.min(1, Math.round((a.scale + 0.1) * 100) / 100);
    return a.scale;
  }
  a.smooth = 0;
  return null;
}
