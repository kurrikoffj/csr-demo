// Privacy: which places are hidden on screen, and what leaves the phone in a file.
// Nothing here changes what is stored or judged.

import { distanceM } from './geo.js';
import { DEFAULTS } from './tunables.js';

// Every marker is a private place unless the player unticked it (a public landmark).
export const isPrivate = (marker) => marker?.private !== false;

// A route from a file with its ends hidden has markers without a position: it can be looked at, not driven.
export const hasPlaces = (route) => !!route && route.a?.lat != null && route.b?.lat != null;

// Name to draw for marker 'a' | 'b'. In Presentation mode a private place is only its letter.
export function placeName(route, key, presenting = false) {
  const marker = route?.[key];
  if (!marker || (presenting && isPrivate(marker))) return key.toUpperCase();
  return marker.name;
}

export const routeName = (route, presenting = false) => `${placeName(route, 'a', presenting)} ⇄ ${placeName(route, 'b', presenting)}`;

// A copy of an export file that is safer to send: no GPS point within trimM of a private marker,
// and private markers without name or position. Packed trace rows are [t, lat, lon, ...].
// What is lost: the start and finish crossings, so these runs cannot be replayed through the rules.
export function trimForSharing(data, { trimM = DEFAULTS.shareTrimM } = {}) {
  const routeOf = new Map((data.routes || []).map((r) => [r.id, r]));
  const hiddenPlaces = (route) => (route ? ['a', 'b'].map((k) => route[k]).filter((m) => isPrivate(m) && m.lat != null) : []);
  const near = (p, places) => places.some((m) => distanceM(p, m) < trimM);

  const routes = (data.routes || []).map((route) => {
    const out = { ...route, trimmed: true };
    for (const key of ['a', 'b']) {
      if (isPrivate(route[key])) out[key] = { ...route[key], name: key.toUpperCase(), lat: null, lon: null };
    }
    return out;
  });

  const traces = {};
  const runs = (data.runs || []).map((run) => {
    const route = routeOf.get(run.routeId);
    const places = hiddenPlaces(route);
    const rows = data.traces?.[run.id];
    if (rows) traces[run.id] = route ? rows.filter((row) => !near({ lat: row[1], lon: row[2] }, places)) : trimEnds(rows, trimM);
    return {
      ...run,
      trimmed: true,
      // A red episode near a hidden place would name its street and point at it.
      episodes: (run.episodes || []).map((e) => (!route || e.lat == null || near(e, places)
        ? { ...e, lat: null, lon: null, wayId: null, wayName: '' } : e)),
    };
  });

  return { ...data, trimmed: true, trimM, routes, runs, traces };
}

// No route to measure from: drop the first and last trimM driven.
function trimEnds(rows, trimM) {
  const at = (row) => ({ lat: row[1], lon: row[2] });
  const cum = [0];
  for (let i = 1; i < rows.length; i++) cum.push(cum[i - 1] + distanceM(at(rows[i - 1]), at(rows[i])));
  const total = cum.at(-1) ?? 0;
  return rows.filter((_, i) => cum[i] >= trimM && cum[i] <= total - trimM);
}
