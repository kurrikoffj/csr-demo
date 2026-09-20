// Builds a demo drive over the player's own downloaded roads, so the whole game can be
// tried from the sofa: marker to marker, just under each road's limit, optionally speeding once.

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

  // One stretch of a tagged road, a third of the way in, driven well over its limit.
  let burst = null;
  if (speeding) {
    let runStart = null;
    for (const leg of legs) {
      const tagged = leg.limit?.tier === 'tagged' && leg.from >= total * 0.3;
      if (!tagged) runStart = null;
      else {
        runStart ??= leg.from;
        if (leg.from + leg.len - runStart >= 260) {
          burst = { from: runStart + 30, to: runStart + 230 };
          break;
        }
      }
    }
  }

  let li = 0;
  const speedKmh = (d, tS) => {
    if (tS < PARKED_S) return 0;
    while (li + 1 < legs.length && d >= legs[li].from + legs[li].len) li++;
    const limit = legs[li].limit;
    if (burst && limit && d >= burst.from && d < burst.to) return limit.kmh + 14;
    return Math.max(15, (limit ? limit.kmh : UNKNOWN_LIMIT_SPEED) - 4);
  };
  return syntheticDrive({ path: points, speedKmh, startT });
}
