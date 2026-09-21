// One drive: idle → armed → running → finished | aborted. Fed fixes, emits events.
// route: { id, rev, a: marker, b: marker }, marker: { name, lat, lon, activationM, finalizationM }.
// Start line = the start marker's activation circle, crossed outward.
// Finish line = the finish marker's finalization circle, crossed inward. Crossing times are interpolated.

import { DEFAULTS, KMH_PER_MS } from './tunables.js';
import { distanceM, bearingDeg, circleCrossing } from './geo.js';
import { bucketFor } from './buckets.js';
import { Compliance, shownKmh } from './compliance.js';
import { shownSpeed, shownLimit } from './units.js';

export class RunEngine {
  // unit: 'kmh' | 'mph', the unit on the driver's screen. Speeding is judged in it (see units.js).
  constructor({ route, tunables = DEFAULTS, matcher = null, onEvent = () => {}, unit = 'kmh' }) {
    this.route = route;
    this.tun = tunables;
    this.unit = unit;
    this.matcher = matcher;
    this.onEvent = onEvent;
    this.state = 'idle';
    this.straightM = distanceM(route.a, route.b);
    this._clear();
  }

  _clear() {
    this.direction = null; // 'ab' | 'ba'
    this.preferred = null; // direction picked on screen; standing in a start circle overrides it
    this.lastHeading = null; // last reliable GPS course, kept while stopped so the guidance arrow holds still
    this.lastHeadingT = null;
    this.compliance = new Compliance(this.tun, this.unit);
    this.trace = [];
    this.distanceM = 0;
    this.startT = null;
    this.endT = null;
    this.abortReason = null;
    this.flags = { gap: false, impreciseStart: false };
    this.gaps = [];
    this.limitStats = { tagged: 0, assumed: 0, unknown: 0 };
    this.lastFix = null;
    this.lastUsable = null;
    this.lastMatch = null;
    this._lastInside = null;
    this._pending = null; // unconfirmed start crossing
    this._fastCount = 0;
    this._stationarySince = null;
    this._events = null;
  }

  get startMarker() {
    return this.direction === 'ba' ? this.route.b : this.route.a;
  }

  get finishMarker() {
    return this.direction === 'ba' ? this.route.a : this.route.b;
  }

  // direction: 'ab' | 'ba' the driver means to run. Optional; without it the first circle entered decides.
  arm({ direction = null } = {}) {
    this._clear();
    this.preferred = direction;
    this.matcher?.reset();
    this.state = 'armed';
    this._emit({ type: 'armed' });
  }

  cancel() {
    if (this.state === 'running') this._abort('manual', this.lastFix?.t ?? null);
    else if (this.state === 'armed') this.state = 'idle';
  }

  // Returns the events this fix caused (also sent to onEvent).
  onFix(fix) {
    this._events = [];
    const usable = fix.accuracy != null && fix.accuracy <= this.tun.maxAccuracyM;
    if (usable && fix.heading != null && fix.speed != null && fix.speed >= this.tun.headingMinSpeedMs) {
      this.lastHeading = fix.heading;
      this.lastHeadingT = fix.t;
    }
    if (this.state === 'running') this._runningFix(fix, usable);
    else {
      if (this.matcher && usable) this.lastMatch = this.matcher.match(fix);
      if (this.state === 'armed' && usable) this._armedFix(fix);
    }
    this.lastFix = fix;
    if (usable) this.lastUsable = fix;
    const out = this._events;
    this._events = null;
    return out;
  }

  // Call about once a second: catches GPS going silent (page hidden, phone locked).
  tick(now) {
    if (this.state !== 'running' || !this.lastFix) return;
    if ((now - this.lastFix.t) / 1000 > this.tun.gapAbortS) this._abort('gps_gap', this.lastFix.t);
  }

  _emit(evt) {
    this._events?.push(evt);
    this.onEvent(evt);
  }

  _armedFix(fix) {
    const tun = this.tun;
    const { a, b } = this.route;
    // Standing in a start circle settles the direction, whatever was picked on screen.
    const inside = distanceM(fix, a) <= a.activationM ? 'ab' : distanceM(fix, b) <= b.activationM ? 'ba' : null;
    const direction = inside || this.direction || this.preferred;
    if (direction && direction !== this.direction) {
      this.direction = direction;
      this._lastInside = null;
      this._pending = null;
      this._fastCount = 0;
      this._emit({ type: 'direction', direction });
    }
    if (!this.direction) return; // armed outside both circles with no direction picked: drive into one
    const start = this.startMarker;
    if (inside === this.direction) {
      this._lastInside = fix;
      this._pending = null;
      this._fastCount = 0;
      return;
    }
    if (!this._pending) {
      if (!this._lastInside) return;
      const f = circleCrossing(start, start.activationM, this._lastInside, fix) ?? 1;
      this._pending = {
        t: this._lastInside.t + f * (fix.t - this._lastInside.t),
        gapS: (fix.t - this._lastInside.t) / 1000,
        fixes: [this._lastInside],
      };
    }
    const p = this._pending;
    p.fixes.push(fix);
    if ((fix.t - p.t) / 1000 > tun.startConfirmWindowS) {
      // Parked near the edge and GPS wandered out: not a start. Need to be seen inside again.
      this._pending = null;
      this._lastInside = null;
      this._fastCount = 0;
      return;
    }
    this._fastCount = fix.speed != null && fix.speed >= tun.startMinSpeedMs ? this._fastCount + 1 : 0;
    if (this._fastCount < tun.startMinFixes) return;

    this.state = 'running';
    this.startT = p.t;
    this.bucket = bucketFor(new Date(p.t), tun.buckets);
    this.flags.impreciseStart = p.gapS > tun.impreciseStartGapS;
    this.trace = p.fixes.slice();
    for (let i = 1; i < p.fixes.length; i++) this.distanceM += distanceM(p.fixes[i - 1], p.fixes[i]);
    this._emit({ type: 'started', t: p.t, direction: this.direction, bucket: this.bucket });
  }

  _runningFix(fix, usable) {
    const tun = this.tun;
    const gapS = (fix.t - this.lastFix.t) / 1000;
    if (gapS > tun.gapAbortS) return this._abort('gps_gap', this.lastFix.t);
    if (gapS > tun.gapFlagS) {
      this.flags.gap = true;
      this.gaps.push({ t0: this.lastFix.t, t1: fix.t });
      this._emit({ type: 'gap', seconds: gapS });
    }
    this.trace.push(fix);
    if (!usable) {
      this.compliance.update({ t: fix.t, speedMs: null, limit: null, usable: false });
      return;
    }

    const moving = fix.speed == null || fix.speed >= tun.movingMinSpeedMs;
    if (this.lastUsable && moving) this.distanceM += distanceM(this.lastUsable, fix);

    if (fix.speed != null && fix.speed < tun.movingMinSpeedMs) {
      this._stationarySince ??= fix.t;
      if ((fix.t - this._stationarySince) / 1000 > tun.stationaryAbortS) return this._abort('stationary', fix.t);
    } else this._stationarySince = null;

    const match = this.matcher ? this.matcher.match(fix) : null;
    this.lastMatch = match;
    const limit = match?.limit ?? null;
    this.limitStats[limit?.tier ?? 'unknown']++;
    fix.limitKmh = limit?.kmh ?? null; // kept on the trace for the summary map
    const events = this.compliance.update({
      t: fix.t,
      speedMs: fix.speed,
      limit,
      ctx: { wayId: match?.way?.id ?? null, wayName: match?.way?.name ?? '', lat: fix.lat, lon: fix.lon },
    });
    fix.zone = this.compliance.zone;
    fix.over = fix.zone === 'red';
    for (const e of events) this._emit(e);

    const fin = this.finishMarker;
    if (distanceM(fix, fin) > fin.finalizationM) return;
    let tEnd = fix.t;
    if (this.lastUsable && distanceM(this.lastUsable, fin) > fin.finalizationM) {
      const f = circleCrossing(fin, fin.finalizationM, this.lastUsable, fix);
      if (f != null) tEnd = this.lastUsable.t + f * (fix.t - this.lastUsable.t);
    }
    if ((tEnd - this.startT) / 1000 < tun.finishMinElapsedS) return;
    if (this.distanceM < tun.finishMinDistanceFrac * this.straightM) return;
    this.state = 'finished';
    this.endT = tEnd;
    this._emit({ type: 'finished', t: tEnd, result: this.result() });
  }

  _abort(reason, t) {
    this.state = 'aborted';
    this.abortReason = reason;
    this.endT = t;
    this._emit({ type: 'aborted', reason, result: this.result() });
  }

  result() {
    if (this.startT == null) return null;
    const s = this.limitStats;
    const counted = s.tagged + s.assumed + s.unknown;
    const c = this.compliance;
    const finished = this.state === 'finished';
    return {
      id: String(Math.round(this.startT)),
      routeId: this.route.id,
      routeRev: this.route.rev,
      direction: this.direction,
      bucket: this.bucket,
      unit: this.unit,
      startT: this.startT,
      endT: this.endT,
      durationS: this.endT == null ? null : (this.endT - this.startT) / 1000,
      distanceM: this.distanceM,
      status: finished ? 'finished' : this.state === 'aborted' ? 'aborted' : 'running',
      abortReason: this.abortReason,
      disqualified: c.disqualified,
      dqAt: c.dqAt,
      warnings: c.warnings,
      cautions: c.cautions,
      yellowS: c.yellowS,
      redS: c.redS,
      episodes: c.episodes.map((e) => ({ ...e })),
      limitStats: { ...s },
      knownLimitFrac: counted ? (s.tagged + s.assumed) / counted : 0,
      flags: { ...this.flags },
      gaps: this.gaps.slice(),
      clean: finished && !c.disqualified && !this.flags.gap,
    };
  }

  // Everything the drive screen needs, in one object.
  // target: where the guidance arrow points, { kind, name, bearingDeg, distM } with distM measured
  // to the edge of the circle, because that edge is the start or finish line.
  hud(now) {
    const fix = this.lastFix;
    const usable = !!fix && fix.accuracy != null && fix.accuracy <= this.tun.maxAccuracyM;
    // The arrow may follow a rougher fix than the one needed to start or stop the clock.
    const pos = fix && fix.accuracy != null && fix.accuracy <= this.tun.guideMaxAccuracyM ? fix : this.lastUsable;
    const out = {
      state: this.state,
      direction: this.direction,
      startName: this.direction ? this.startMarker.name : null,
      finishName: this.direction ? this.finishMarker.name : null,
      gps: !fix ? 'none' : usable ? 'ok' : 'weak',
      accuracyM: fix?.accuracy ?? null,
      speedKmh: fix?.speed != null ? fix.speed * KMH_PER_MS : null,
      shownKmh: fix?.speed != null ? shownKmh(fix.speed) : null,
      unit: this.unit,
      shownSpeed: fix?.speed != null ? shownSpeed(fix.speed, this.unit) : null, // the whole number the rules judge
      shownLimit: this.lastMatch?.limit ? shownLimit(this.lastMatch.limit, this.unit) : null, // and the one it is judged against
      headingDeg: this.lastHeading,
      headingAgeS: this.lastHeadingT == null ? null : Math.max(0, (now - this.lastHeadingT) / 1000),
      limit: this.lastMatch?.limit ?? null,
      wayName: this.lastMatch?.way?.name ?? '',
      zone: this.compliance.zone,
      aboveLimit: this.compliance.aboveNow, // over the limit right now, before any caution
      over: this.compliance.isOver,
      dqProgress: this.compliance.dqProgress,
      disqualified: this.compliance.disqualified,
      elapsedS: null,
      distanceM: this.distanceM,
      distToStartM: null,
      distToFinishM: null,
      target: null,
      finishClose: false,
      waitingFor: null,
    };
    const aim = (kind, marker, radiusM) => {
      const d = distanceM(pos, marker);
      return { kind, name: marker.name, bearingDeg: bearingDeg(pos, marker), distM: Math.max(0, d - radiusM) };
    };
    if (this.state === 'armed') {
      if (!usable) out.waitingFor = 'gps';
      if (pos) {
        const { a, b } = this.route;
        const start = this.direction ? this.startMarker
          : this.preferred ? (this.preferred === 'ba' ? b : a)
            : distanceM(pos, a) <= distanceM(pos, b) ? a : b;
        out.distToStartM = distanceM(pos, start);
        const inside = out.distToStartM <= start.activationM;
        if (usable) out.waitingFor = inside ? 'leave' : 'enter';
        if (!inside) out.target = aim('start', start, start.activationM);
        out.startName ??= start.name;
      }
    }
    if (this.state === 'running') {
      out.elapsedS = Math.max(0, (now - this.startT) / 1000);
      if (pos) {
        const fin = this.finishMarker;
        out.distToFinishM = distanceM(pos, fin);
        out.target = aim('finish', fin, fin.finalizationM);
        out.finishClose = out.target.distM <= this.tun.finishCountdownM;
      }
    }
    if (this.state === 'finished' || this.state === 'aborted') {
      out.elapsedS = this.endT != null && this.startT != null ? (this.endT - this.startT) / 1000 : null;
    }
    return out;
  }
}
