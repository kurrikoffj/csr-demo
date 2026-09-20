// OpenStreetMap roads and speed limits: Overpass query, maxspeed parsing, spatial index.
// A way is { id, name, highway, oneway: 1|-1|0, limit: {kmh,tier,approx}|null, coords: [[lat,lon],...] }.

import { DEFAULTS } from './tunables.js';

const RAD = Math.PI / 180;
const M_PER_DEG_LAT = 111320;

const HIGHWAYS =
  'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|' +
  'motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';

export function overpassQuery(bbox) {
  const b = [bbox.south, bbox.west, bbox.north, bbox.east].map((v) => v.toFixed(5)).join(',');
  return `[out:json][timeout:90];way["highway"~"^(${HIGHWAYS})$"](${b});out tags geom;`;
}

// Tags whose numbers all describe the general limit on this road, in some direction, lane or condition.
const SPEED_KEYS = [
  'maxspeed', 'maxspeed:forward', 'maxspeed:backward',
  'maxspeed:conditional', 'maxspeed:forward:conditional', 'maxspeed:backward:conditional',
  'maxspeed:lanes', 'maxspeed:lanes:forward', 'maxspeed:lanes:backward',
  'maxspeed:seasonal', 'maxspeed:seasonal:summer', 'maxspeed:seasonal:winter',
];
// Used only when none of the above gave a number, e.g. source:maxspeed=EE:urban.
const IMPLICIT_KEYS = ['zone:maxspeed', 'maxspeed:type', 'source:maxspeed'];

function parseSpeedToken(token, tun) {
  const tok = token.trim();
  let m = /^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh|kph)?$/i.exec(tok);
  if (m) {
    const v = parseFloat(m[1]);
    return /mph/i.test(m[2] || '') ? Math.round(v * 1.609344) : v;
  }
  m = /^[A-Za-z]{2}:(.+)$/.exec(tok);
  if (!m) return null;
  const kind = m[1].toLowerCase();
  if (kind === 'urban') return tun.implicitUrbanKmh;
  if (kind === 'rural') return tun.implicitRuralKmh;
  if (kind === 'living_street') return tun.assumedLivingStreetKmh;
  const zone = /^(?:zone:?)?(\d+)$/.exec(kind);
  return zone ? parseFloat(zone[1]) : null;
}

function speedsIn(value, tun) {
  const out = [];
  // "30 @ (Mo-Fr 07:00-17:00); 50 @ wet" and "100|100|80"
  for (const part of String(value).split(/[;|]/)) {
    const v = parseSpeedToken(part.split('@')[0], tun);
    if (v != null && v > 0) out.push(v);
  }
  return out;
}

// Tagged limit of a way, or null. Several values (conditional, per lane, per direction) → the
// highest, marked approx: a false disqualification is worse than leniency.
export function limitFromTags(tags, tun = DEFAULTS) {
  let values = [];
  for (const key of SPEED_KEYS) if (tags[key]) values.push(...speedsIn(tags[key], tun));
  if (!values.length) {
    for (const key of IMPLICIT_KEYS) if (tags[key]) values.push(...speedsIn(tags[key], tun));
  }
  if (!values.length) return null;
  return {
    kmh: Math.max(...values),
    tier: 'tagged',
    approx: new Set(values).size > 1 || 'maxspeed:variable' in tags,
  };
}

// Limit to apply on a way: its tag, else an assumed default for the road class, else null (unknown).
export function wayLimit(way, tun = DEFAULTS) {
  if (way.limit) return way.limit;
  if (way.highway === 'living_street') {
    return { kmh: tun.assumedLivingStreetKmh, tier: 'assumed', approx: false };
  }
  if (way.highway === 'residential') {
    return { kmh: tun.assumedResidentialKmh, tier: 'assumed', approx: false };
  }
  return null;
}

function onewayOf(tags) {
  const v = tags.oneway;
  if (v === '-1' || v === 'reverse') return -1;
  if (v === 'yes' || v === '1' || v === 'true') return 1;
  if (v === 'no') return 0;
  return tags.junction === 'roundabout' || tags.highway === 'motorway' ? 1 : 0;
}

export function parseOverpass(json, tun = DEFAULTS) {
  const ways = [];
  for (const el of json.elements || []) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    const coords = el.geometry.filter(Boolean).map((g) => [g.lat, g.lon]);
    if (coords.length < 2) continue;
    const tags = el.tags || {};
    ways.push({
      id: el.id,
      name: tags.name || tags.ref || '',
      highway: tags.highway || '',
      oneway: onewayOf(tags),
      limit: limitFromTags(tags, tun),
      coords,
    });
  }
  return ways;
}

// Share of ways per tier, for the setup screen ("limits known on 84% of roads here").
export function coverage(ways, tun = DEFAULTS) {
  const out = { tagged: 0, assumed: 0, unknown: 0, total: ways.length };
  for (const way of ways) out[wayLimit(way, tun)?.tier || 'unknown']++;
  return out;
}

const SEG_BASE = 2048; // OSM ways have at most 2000 nodes

// Grid index over way segments, plus which ways meet at which node.
export class WayIndex {
  constructor(ways, { cellM = 120 } = {}) {
    this.ways = ways;
    let south = Infinity, west = Infinity, north = -Infinity;
    for (const way of ways) {
      for (const [lat, lon] of way.coords) {
        if (lat < south) south = lat;
        if (lat > north) north = lat;
        if (lon < west) west = lon;
      }
    }
    if (!ways.length) south = west = north = 0;
    this.lat0 = south;
    this.lon0 = west;
    this.cellM = cellM;
    this.cellLat = cellM / M_PER_DEG_LAT;
    this.cellLon = cellM / (M_PER_DEG_LAT * Math.cos(((south + north) / 2) * RAD));
    this.cells = new Map(); // cell key → segment codes
    this.nodes = new Map(); // node key → way index, or array of them at junctions
    this._connected = new Map();

    ways.forEach((way, wi) => {
      const c = way.coords;
      for (let i = 0; i < c.length; i++) {
        this._addNode(this.nodeKey(c[i]), wi);
        if (i + 1 < c.length) this._addSegment(wi, i, c[i], c[i + 1]);
      }
    });
  }

  // Shared OSM nodes have identical coordinates in every way that uses them.
  nodeKey([lat, lon]) {
    return Math.round((lat - this.lat0) * 1e7) * 2 ** 26 + Math.round((lon - this.lon0) * 1e7);
  }

  _cellOf(lat, lon) {
    return [Math.floor((lon - this.lon0) / this.cellLon), Math.floor((lat - this.lat0) / this.cellLat)];
  }

  _addNode(key, wi) {
    const cur = this.nodes.get(key);
    if (cur === undefined) this.nodes.set(key, wi);
    else if (typeof cur === 'number') {
      if (cur !== wi) this.nodes.set(key, [cur, wi]);
    } else if (!cur.includes(wi)) cur.push(wi);
  }

  _addSegment(wi, si, a, b) {
    const [ax, ay] = this._cellOf(a[0], a[1]);
    const [bx, by] = this._cellOf(b[0], b[1]);
    const code = wi * SEG_BASE + si;
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) {
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) {
        const key = y * 65536 + x;
        const list = this.cells.get(key);
        if (list) list.push(code);
        else this.cells.set(key, [code]);
      }
    }
  }

  // Segments that may lie within radiusM of p, as [wayIndex, segmentIndex]. Caller checks distance.
  query(p, radiusM) {
    const [cx, cy] = this._cellOf(p.lat, p.lon);
    const r = Math.ceil(radiusM / this.cellM);
    const seen = new Set();
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const list = this.cells.get(y * 65536 + x);
        if (list) for (const code of list) seen.add(code);
      }
    }
    return [...seen].map((code) => [Math.floor(code / SEG_BASE), code % SEG_BASE]);
  }

  waysAtNode(coord) {
    const v = this.nodes.get(this.nodeKey(coord));
    return v === undefined ? [] : typeof v === 'number' ? [v] : v;
  }

  // Ways sharing any node with this one.
  connected(wi) {
    let set = this._connected.get(wi);
    if (!set) {
      set = new Set();
      for (const coord of this.ways[wi].coords) {
        for (const other of this.waysAtNode(coord)) if (other !== wi) set.add(other);
      }
      this._connected.set(wi, set);
    }
    return set;
  }
}
