// Download the roads and speed limits around a route from OpenStreetMap (Overpass API).
// The public servers are free and sometimes overloaded, so: a timeout on each, several servers, two rounds.

import { distanceM, bboxAround } from '../src/geo.js';
import { overpassQuery, parseOverpass, coverage } from '../src/osm.js';

const SERVERS = [
  'https://overpass-api.de/api/interpreter', // compresses its answers: about 1 MB for a city commute
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const TIMEOUT_MS = 45000;
const ROUNDS = 2;

// Free routing: pad the box well beyond the straight line between the markers.
export function routeBbox(route) {
  const pad = Math.max(2000, 0.3 * distanceM(route.a, route.b));
  return bboxAround([route.a, route.b], pad);
}

async function ask(server, query) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${server}?data=${encodeURIComponent(query)}`, { signal: abort.signal });
    if (!res.ok) throw new Error(`answered ${res.status}`);
    return await res.json();
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? 'took too long' : err.message);
  } finally {
    clearTimeout(timer);
  }
}

export async function downloadRoads(route, tunables, onProgress = () => {}) {
  const bbox = routeBbox(route);
  const query = overpassQuery(bbox);
  let lastError = '';
  for (let round = 1; round <= ROUNDS; round++) {
    for (const server of SERVERS) {
      const host = new URL(server).host;
      try {
        onProgress(`Asking ${host} for roads and speed limits…${lastError ? ` (${lastError})` : ''}`);
        const json = await ask(server, query);
        onProgress('Reading speed limits…');
        const ways = parseOverpass(json, tunables);
        if (!ways.length) throw new Error('no roads around these markers');
        return { ways, bbox, fetchedAt: Date.now(), routeRev: route.rev, coverage: coverage(ways, tunables) };
      } catch (err) {
        lastError = `${host} ${err.message}`;
      }
    }
  }
  throw new Error(`Could not download speed limits: ${lastError}. The free map servers are sometimes busy. Your route is saved; try again in a minute.`);
}
