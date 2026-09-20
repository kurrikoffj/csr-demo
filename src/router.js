// Shortest-ish driving path over the downloaded ways. Only used to build demo drives on the
// player's own roads; the game itself never routes anyone.

import { distanceM, projectOnSegment } from './geo.js';

const pt = (c) => ({ lat: c[0], lon: c[1] });

// Cost per metre by road class, so demo drives prefer main roads like a commuter would.
const CLASS_COST = {
  motorway: 0.6, trunk: 0.65, primary: 0.75, secondary: 0.85, tertiary: 1,
  motorway_link: 0.8, trunk_link: 0.8, primary_link: 0.9, secondary_link: 0.95, tertiary_link: 1,
  unclassified: 1.3, residential: 1.5, living_street: 3, service: 4,
};
const costPerM = (way) => CLASS_COST[way.highway] ?? 2;

const START = -1;
const GOAL = -2;

class MinHeap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(key, value) {
    const a = this.items;
    a.push([key, value]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

// Closest point on any road: { wi, a, b, point } with a→b the segment's coords.
function snap(index, p) {
  for (const radius of [150, 500, 2000]) {
    let best = null;
    for (const [wi, si] of index.query(p, radius)) {
      const c = index.ways[wi].coords;
      const proj = projectOnSegment(p, pt(c[si]), pt(c[si + 1]));
      if (proj.distM <= radius && (!best || proj.distM < best.distM)) {
        best = { distM: proj.distM, wi, a: c[si], b: c[si + 1], point: proj.point };
      }
    }
    if (best) return best;
  }
  return null;
}

// Returns { points: [{lat,lon}], wayIdx: [way driven to reach each point] } or null if unreachable.
export function route(index, from, to) {
  const s = snap(index, from);
  const g = snap(index, to);
  if (!s || !g) return null;

  const pointOf = new Map([[START, s.point], [GOAL, g.point]]);
  const adj = new Map();
  const link = (ka, kb, wi, cost) => {
    let list = adj.get(ka);
    if (!list) adj.set(ka, (list = []));
    list.push({ to: kb, wi, cost });
  };
  index.ways.forEach((way, wi) => {
    const perM = costPerM(way);
    for (let i = 0; i + 1 < way.coords.length; i++) {
      const a = way.coords[i];
      const b = way.coords[i + 1];
      const ka = index.nodeKey(a);
      const kb = index.nodeKey(b);
      pointOf.set(ka, pt(a));
      pointOf.set(kb, pt(b));
      const cost = distanceM(pt(a), pt(b)) * perM;
      if (way.oneway !== -1) link(ka, kb, wi, cost);
      if (way.oneway !== 1) link(kb, ka, wi, cost);
    }
  });
  // Join the snapped points to the ends of their segments, respecting one-way streets.
  const sWay = index.ways[s.wi];
  const gWay = index.ways[g.wi];
  if (sWay.oneway !== -1) link(START, index.nodeKey(s.b), s.wi, distanceM(s.point, pt(s.b)) * costPerM(sWay));
  if (sWay.oneway !== 1) link(START, index.nodeKey(s.a), s.wi, distanceM(s.point, pt(s.a)) * costPerM(sWay));
  if (gWay.oneway !== -1) link(index.nodeKey(g.a), GOAL, g.wi, distanceM(pt(g.a), g.point) * costPerM(gWay));
  if (gWay.oneway !== 1) link(index.nodeKey(g.b), GOAL, g.wi, distanceM(pt(g.b), g.point) * costPerM(gWay));

  const dist = new Map([[START, 0]]);
  const prev = new Map();
  const heap = new MinHeap();
  heap.push(0, START);
  while (heap.size) {
    const [d, node] = heap.pop();
    if (node === GOAL) break;
    if (d > dist.get(node)) continue;
    for (const edge of adj.get(node) || []) {
      const nd = d + edge.cost;
      if (nd < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, nd);
        prev.set(edge.to, { node, wi: edge.wi });
        heap.push(nd, edge.to);
      }
    }
  }
  if (!dist.has(GOAL)) return null;

  const points = [];
  const wayIdx = [];
  for (let node = GOAL; node !== undefined; node = prev.get(node)?.node) {
    points.push(pointOf.get(node));
    wayIdx.push(prev.get(node)?.wi ?? s.wi);
  }
  return { points: points.reverse(), wayIdx: wayIdx.reverse() };
}
