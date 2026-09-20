// Fix → road → effective speed limit.
// Nearest way with a heading filter and stickiness, then every ambiguity resolved upward:
// parallel candidates, the last few metres driven and the next few ahead all raise the limit, never lower it.

import { DEFAULTS } from './tunables.js';
import { distanceM, bearingDeg, angleDiffDeg, projectOnSegment } from './geo.js';
import { wayLimit } from './osm.js';

const pt = (c) => ({ lat: c[0], lon: c[1] });
const sameCoord = (a, b) => a[0] === b[0] && a[1] === b[1];

function higher(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (b.kmh !== a.kmh) return b.kmh > a.kmh ? b : a;
  return a.tier === 'tagged' ? a : b;
}

export class Matcher {
  constructor(index, tunables = DEFAULTS) {
    this.index = index;
    this.tun = tunables;
    this.reset();
  }

  reset() {
    this.current = null; // way index
    this._challenger = null;
    this._challengerWins = 0;
    this._trail = []; // { cum, limit } of recently matched ways, for the behind window
    this._cum = 0;
    this._lastFix = null;
  }

  // Returns { wayIndex, way, rawLimit, limit, distM }. limit is null when unknown.
  match(fix) {
    const tun = this.tun;
    if (this._lastFix && fix.t - this._lastFix.t < 10000) this._cum += distanceM(this._lastFix, fix);
    this._lastFix = fix;

    const headingOk =
      fix.heading != null && !Number.isNaN(fix.heading) &&
      fix.speed != null && fix.speed >= tun.matchHeadingMinSpeedMs;

    const cands = new Map(); // way index → best segment candidate
    for (const [wi, si] of this.index.query(fix, tun.matchRadiusM)) {
      const way = this.index.ways[wi];
      const a = pt(way.coords[si]);
      const b = pt(way.coords[si + 1]);
      const proj = projectOnSegment(fix, a, b);
      if (proj.distM > tun.matchRadiusM) continue;
      const segBearing = bearingDeg(a, b);
      let diff = 0;
      if (headingOk) {
        const d = angleDiffDeg(fix.heading, segBearing);
        diff = way.oneway === 1 ? d : way.oneway === -1 ? 180 - d : Math.min(d, 180 - d);
        if (diff > tun.matchHeadingMaxDeg) continue;
      }
      const raw =
        proj.distM + tun.matchHeadingWeight * diff +
        (way.highway === 'service' ? tun.matchServicePenaltyM : 0);
      const stick =
        wi === this.current ? tun.matchStickCurrentM
          : this.current != null && this.index.connected(this.current).has(wi) ? tun.matchStickConnectedM
            : 0;
      const prev = cands.get(wi);
      if (!prev || raw < prev.raw) {
        cands.set(wi, { wi, si, raw, score: raw - stick, distM: proj.distM, point: proj.point, segBearing });
      }
    }

    if (!cands.size) {
      this.current = null;
      this._challenger = null;
      this._pushTrail(null);
      return { wayIndex: null, way: null, rawLimit: null, limit: null, distM: null };
    }

    let best = null;
    for (const c of cands.values()) if (!best || c.score < best.score) best = c;

    if (this.current == null || !cands.has(this.current)) {
      this.current = best.wi;
      this._challenger = null;
    } else if (best.wi !== this.current) {
      // A different way must win a few fixes in a row before we switch.
      if (this._challenger === best.wi) this._challengerWins++;
      else {
        this._challenger = best.wi;
        this._challengerWins = 1;
      }
      if (this._challengerWins >= tun.matchSwitchWins) {
        this.current = best.wi;
        this._challenger = null;
      }
    } else {
      this._challenger = null;
    }

    const chosen = cands.get(this.current);
    const way = this.index.ways[chosen.wi];
    const rawLimit = wayLimit(way, tun);
    let limit = rawLimit;

    if (rawLimit) {
      for (const c of cands.values()) {
        if (c.wi !== chosen.wi && c.raw - chosen.raw <= tun.matchAmbiguityM) {
          limit = higher(limit, wayLimit(this.index.ways[c.wi], tun));
        }
      }
      for (const s of this._trail) {
        if (s.cum >= this._cum - tun.slackBehindM) limit = higher(limit, s.limit);
      }
      if (headingOk) for (const l of this._aheadLimits(chosen, fix)) limit = higher(limit, l);
    }

    this._pushTrail(rawLimit);
    return {
      wayIndex: chosen.wi,
      way: { id: way.id, name: way.name, highway: way.highway },
      rawLimit,
      limit,
      distM: chosen.distM,
    };
  }

  _pushTrail(limit) {
    this._trail.push({ cum: this._cum, limit });
    const keepFrom = this._cum - this.tun.slackBehindM - 50;
    while (this._trail.length && this._trail[0].cum < keepFrom) this._trail.shift();
  }

  // Limits of ways that continue roughly straight on, if this way ends within the ahead window.
  _aheadLimits(chosen, fix) {
    const way = this.index.ways[chosen.wi];
    const c = way.coords;
    const forward = angleDiffDeg(fix.heading, chosen.segBearing) < 90;
    let remaining = this.tun.slackAheadM;
    let from = chosen.point;
    const step = forward ? 1 : -1;
    for (let i = forward ? chosen.si + 1 : chosen.si; i >= 0 && i < c.length; i += step) {
      const d = distanceM(from, pt(c[i]));
      if (d >= remaining) return [];
      remaining -= d;
      from = pt(c[i]);
    }
    const end = forward ? c[c.length - 1] : c[0];
    const beforeEnd = forward ? c[c.length - 2] : c[1];
    const travel = bearingDeg(pt(beforeEnd), pt(end));

    const out = [];
    for (const wj of this.index.waysAtNode(end)) {
      if (wj === chosen.wi) continue;
      const other = this.index.ways[wj];
      const limit = wayLimit(other, this.tun);
      if (!limit) continue;
      other.coords.forEach((coord, k) => {
        if (!sameCoord(coord, end)) return;
        for (const dir of [1, -1]) {
          const next = other.coords[k + dir];
          if (!next || (other.oneway !== 0 && other.oneway !== dir)) continue;
          if (angleDiffDeg(bearingDeg(pt(end), pt(next)), travel) <= this.tun.matchHeadingMaxDeg) {
            out.push(limit);
          }
        }
      });
    }
    return out;
  }
}
