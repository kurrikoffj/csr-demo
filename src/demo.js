// Builds a demo drive over the player's own downloaded roads, so the whole game can be
// tried from the sofa: marker to marker, just under each road's limit, with a yellow spell and,
// if asked, one stretch of real speeding.

import { distanceM } from './geo.js';
import { wayLimit } from './osm.js';
import { route } from './router.js';
import { syntheticDrive } from './replay.js';
import { DEFAULTS } from './tunables.js';

const PARKED_S = 5;
const UNKNOWN_LIMIT_SPEED = 40;

// direction 'ab' | 'ba'. Returns fixes, or null when the markers are not connected by the roads.
export function demoDrive(index, routeDef, { tunables = DEFAULTS, direction = 'ab', speeding = false, startT = 0 } = {}) {
  const from = direction === 'ba' ? routeDef.b : routeDef.a;
  const to = direction === 'ba' ? routeDef.a : routeDef.b;
  const r = route(index, from, to);
  if (!r) return null;

  // Leg i runs from point i to point i+1. Marker positions bracket the road path so the
  // drive begins inside the start circle even when the marker sits a little off the road.
  const points = [{ lat: from.lat, lon: from.lon }, ...r.points, { lat: to.lat, lon: to.lon }];
  const legs = [];
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const len = distanceM(points[i], points[i + 1]);
    const wi = r.wayIdx[Math.min(i, r.wayIdx.length - 1)];
    legs.push({ from: total, len, limit: wi == null ? null : wayLimit(index.ways[wi], tunables) });
    total += len;
  }

  // First stretch of at least lengthM, starting after fromFrac of the drive, where every leg passes ok().
  const stretch = (fromFrac, lengthM, ok) => {
    let runStart = null;
    for (const leg of legs) {
      if (leg.from < total * fromFrac || !ok(leg)) runStart = null;
      else {
        runStart ??= leg.from;
        if (leg.from + leg.len - runStart >= lengthM + 60) return { from: runStart + 30, to: runStart + 30 + lengthM };
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
