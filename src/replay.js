// Drives without driving: build a synthetic trace, or play any trace back through the same
// pipeline the live GPS feeds. Real commutes are scarce (two a day); replays are free.

import { distanceM, bearingDeg } from './geo.js';

// path: [{lat,lon},...]. speedKmh: number, or (distM, tS) => km/h (return 0 to wait at a light).
// Returns fixes at `hz` from startT until the end of the path.
export function syntheticDrive({ path, speedKmh, startT = 0, hz = 1, accuracy = 5, maxS = 4 * 3600 }) {
  const speedAt = typeof speedKmh === 'function' ? speedKmh : () => speedKmh;
  const legs = [];
  let total = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const len = distanceM(path[i], path[i + 1]);
    if (len === 0) continue;
    legs.push({ a: path[i], b: path[i + 1], from: total, len, bearing: bearingDeg(path[i], path[i + 1]) });
    total += len;
  }
  const fixes = [];
  const dt = 1 / hz;
  let dist = 0;
  let leg = 0;
  for (let tS = 0; tS <= maxS && legs.length; tS += dt) {
    while (leg + 1 < legs.length && dist > legs[leg].from + legs[leg].len) leg++;
    const L = legs[leg];
    const f = Math.min(1, (dist - L.from) / L.len);
    const v = Math.max(0, speedAt(dist, tS)) / 3.6;
    fixes.push({
      t: startT + tS * 1000,
      lat: L.a.lat + (L.b.lat - L.a.lat) * f,
      lon: L.a.lon + (L.b.lon - L.a.lon) * f,
      speed: v,
      heading: v > 0 ? L.bearing : null,
      accuracy,
    });
    if (dist >= total) break;
    dist = Math.min(total, dist + v * dt);
  }
  return fixes;
}

// Feed fixes to onFix in scaled real time. now() follows the trace, so timers on screen match it.
export function playFixes(fixes, onFix, { rate = 8, onDone = () => {} } = {}) {
  let i = 0;
  let timer = null;
  let stopped = false;
  let virtualNow = fixes[0]?.t ?? 0;
  const step = () => {
    if (stopped) return;
    if (i >= fixes.length) return onDone();
    const fix = fixes[i++];
    virtualNow = fix.t;
    onFix({ ...fix });
    const next = fixes[i];
    timer = setTimeout(step, next ? Math.max(0, (next.t - fix.t) / rate) : 0);
  };
  timer = setTimeout(step, 0);
  return {
    now: () => virtualNow,
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

// Shift a trace so it starts at newStartT (replaying an old drive as if it were now).
export function retime(fixes, newStartT) {
  if (!fixes.length) return [];
  const shift = newStartT - fixes[0].t;
  return fixes.map((f) => ({ ...f, t: f.t + shift }));
}
