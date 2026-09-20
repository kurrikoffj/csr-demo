// A small made-up town in the middle of the Atlantic. No real places in this repo.
//
//   Home Ln (residential, untagged)   x=0, y=-400..0      → assumed 50
//   Main St (maxspeed 50)             x=0..3000, y=0
//   Slow St (maxspeed 30)             x=3000..4000, y=0
//   Mystery Rd (tertiary, untagged)   x=4000..5000, y=0   → unknown
//   Side Rd (maxspeed 30)             x=500..2500, y=20   parallel to Main St
//
//   Marker A "Home" at (0,-300), marker B "Work" at (3900,0).

import { fromXY } from '../src/geo.js';
import { parseOverpass, WayIndex } from '../src/osm.js';
import { syntheticDrive } from '../src/replay.js';

export const ORIGIN = { lat: 40, lon: -30 };
export const xy = (x, y) => fromXY(ORIGIN, { x, y });

function line(x0, y0, x1, y1, stepM = 250) {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / stepM));
  const out = [];
  for (let i = 0; i <= n; i++) out.push(xy(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n));
  return out;
}

const way = (id, geometry, tags) => ({ type: 'way', id, tags, geometry });

export function townJson() {
  return {
    elements: [
      way(1, line(0, 0, 3000, 0), { highway: 'secondary', name: 'Main St', maxspeed: '50' }),
      way(2, line(3000, 0, 4000, 0), { highway: 'secondary', name: 'Slow St', maxspeed: '30' }),
      way(3, line(0, -400, 0, 0), { highway: 'residential', name: 'Home Ln' }),
      way(4, line(4000, 0, 5000, 0), { highway: 'tertiary', name: 'Mystery Rd' }),
      way(5, line(500, 20, 2500, 20), { highway: 'residential', name: 'Side Rd', maxspeed: '30' }),
    ],
  };
}

export function town(tun) {
  const ways = parseOverpass(townJson(), tun);
  return new WayIndex(ways);
}

export function townRoute(overrides = {}) {
  return {
    id: 'r1',
    rev: 1,
    a: { name: 'Home', ...xy(0, -300), activationM: 60, finalizationM: 40 },
    b: { name: 'Work', ...xy(3900, 0), activationM: 60, finalizationM: 40 },
    ...overrides,
  };
}

export const COMMUTE = [xy(0, -300), xy(0, 0), xy(3000, 0), xy(3900, 0)];

// Legal speeds for the commute, by distance along COMMUTE (300 m of Home Ln, 3000 m of Main St, then Slow St).
export const legalSpeed = (d) => (d < 300 ? 40 : d < 2990 ? 48 : 28);

// Monday 2026-09-21 07:45 local: weekday AM rush.
export const MONDAY_AM = new Date(2026, 8, 21, 7, 45, 0).getTime();

export function commuteFixes({ speedKmh = legalSpeed, startT = MONDAY_AM, path = COMMUTE, ...rest } = {}) {
  return syntheticDrive({ path, speedKmh, startT, ...rest });
}

export function fixAt(x, y, { t = 0, speedKmh = 40, heading = 90, accuracy = 5 } = {}) {
  return { t, ...xy(x, y), speed: speedKmh / 3.6, heading, accuracy };
}

// Run fixes through an engine; returns all events in order.
export function feed(engine, fixes) {
  const events = [];
  for (const fix of fixes) events.push(...engine.onFix({ ...fix }));
  return events;
}
