// Builds a demo drive over the player's own downloaded roads, so the whole game can be
// tried from the sofa: marker to marker, just under each road's limit, with a yellow spell and,
// if asked, one stretch of real speeding.

import { distanceM, bearingDeg, destination } from './geo.js';
import { wayLimit } from './osm.js';
import { route } from './router.js';
import { syntheticDrive } from './replay.js';
import { DEFAULTS } from './tunables.js';

const PARKED_S = 5;
const APPROACH_M = 220;
const MARGIN_M = 90;
const UNKNOWN_LIMIT_SPEED = 40;

// direction 'ab' | 'ba'. Returns fixes, or null when the markers are not connected by the roads.
export function demoDrive(index, routeDef, { tunables = DEFAULTS, direction = 'ab', speeding = false, startT = 0 } = {}) {
  const from = direction === 'ba' ? routeDef.b : routeDef.a;
  const to = direction === 'ba' ? routeDef.a : routeDef.b;
  const r = route(index, from, to);
  if (!r) return null;

  // Leg i runs from point i to point i+1. Marker positions bracket the road path so the
  // drive begins inside the start circle even when the marker sits a little off the road.
  // It begins a little way short of the start circle, so the demo also shows the arrow that leads there.
  const start = { lat: from.lat, lon: from.lon };
  const approach = destination(start, bearingDeg(start, r.points[Math.min(1, r.points.length - 1)]) + 180, APPROACH_M);
  const points = [approach, start, ...r.points, { lat: to.lat, lon: to.lon }];
  const legs = [];
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const len = distanceM(points[i], points[i + 1]);
    const wi = i === 0 ? null : r.wayIdx[Math.min(i - 1, r.wayIdx.length - 1)]; // leg 0 is the off-road approach
    legs.push({ from: total, len, limit: wi == null ? null : wayLimit(index.ways[wi], tunables) });
    total += len;
  }

  // First stretch of lengthM, after fromFrac of the drive, on roads that pass ok() and share one limit.
  // It sits MARGIN_M inside that run, clear of the slack the engine allows around limit changes.
  const stretch = (fromFrac, lengthM, ok) => {
    let runStart = null;
    let kmh = null;
    for (const leg of legs) {
      if (leg.from < total * fromFrac || !ok(leg)) runStart = null;
      else {
        if (runStart == null || leg.limit.kmh !== kmh) {
          runStart = leg.from;
          kmh = leg.limit.kmh;
        }
        if (leg.from + leg.len - runStart >= lengthM + 2 * MARGIN_M) {
          return { from: runStart + MARGIN_M, to: runStart + MARGIN_M + lengthM };
        }
      }
    }
    return null;
  };
  // Every demo rides a couple of km/h over a limit for a while, to show the yellow caution.
  const yellow = stretch(0.08, 180, (leg) => !!leg.limit);
  // The speeding demo also goes well over a signed limit, long enough to be disqualified.
  const red = speeding ? stretch(0.3, 200, (leg) => leg.limit?.tier === 'tagged') : null;

  let li = 0;
  const speedKmh = (d, tS) => {
    if (tS < PARKED_S) return 0;
    while (li + 1 < legs.length && d >= legs[li].from + legs[li].len) li++;
    const limit = legs[li].limit;
    if (red && limit && d >= red.from && d < red.to) return limit.kmh + 14;
    if (yellow && limit && d >= yellow.from && d < yellow.to) return limit.kmh + 2;
    return Math.max(15, (limit ? limit.kmh : UNKNOWN_LIMIT_SPEED) - 4);
  };
  return syntheticDrive({ path: points, speedKmh, startT });
}
