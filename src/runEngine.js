// One drive: idle → armed → running → finished | aborted. Fed fixes, emits events.
// route: { id, rev, a: marker, b: marker }, marker: { name, lat, lon, activationM, finalizationM }.
// Start line = the start marker's activation circle, crossed outward.
// Finish line = the finish marker's finalization circle, crossed inward. Crossing times are interpolated.

import { DEFAULTS, KMH_PER_MS } from './tunables.js';
import { distanceM, circleCrossing } from './geo.js';
import { bucketFor } from './buckets.js';
import { Compliance } from './compliance.js';

export class RunEngine {
  constructor({ route, tunables = DEFAULTS, matcher = null, onEvent = () => {} }) {
    this.route = route;
    this.tun = tunables;
    this.matcher = matcher;
    this.onEvent = onEvent;
    this.state = 'idle';
    this.straightM = distanceM(route.a, route.b);
    this._clear();
  }

  _clear() {
    this.direction = null; // 'ab' | 'ba'
    this.compliance = new Compliance(this.tun);
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

  arm() {
    this._clear();
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
    if (!this.direction) {
      const { a, b } = this.route;
      if (distanceM(fix, a) <= a.activationM) this.direction = 'ab';
      else if (distanceM(fix, b) <= b.activationM) this.direction = 'ba';
      else return; // armed outside both circles: drive into one first
      this._emit({ type: 'direction', direction: this.direction });
    }
    const start = this.startMarker;
    if (distanceM(fix, start) <= start.activationM) {
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
    fix.over = this.compliance.isOver;
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
      startT: this.startT,
      endT: this.endT,
      durationS: this.endT == null ? null : (this.endT - this.startT) / 1000,
      distanceM: this.distanceM,
      status: finished ? 'finished' : this.state === 'aborted' ? 'aborted' : 'running',
      abortReason: this.abortReason,
      disqualified: c.disqualified,
      dqAt: c.dqAt,
      warnings: c.warnings,
      episodes: c.episodes.map((e) => ({ ...e })),
      limitStats: { ...s },
      knownLimitFrac: counted ? (s.tagged + s.assumed) / counted : 0,
      flags: { ...this.flags },
      gaps: this.gaps.slice(),
      clean: finished && !c.disqualified && !this.flags.gap,
    };
  }

  // Everything the drive screen needs, in one object.
  hud(now) {
    const fix = this.lastFix;
    const usable = !!fix && fix.accuracy != null && fix.accuracy <= this.tun.maxAccuracyM;
    const out = {
      state: this.state,
      direction: this.direction,
      startName: this.direction ? this.startMarker.name : null,
      finishName: this.direction ? this.finishMarker.name : null,
      gps: !fix ? 'none' : usable ? 'ok' : 'weak',
      accuracyM: fix?.accuracy ?? null,
      speedKmh: fix?.speed != null ? fix.speed * KMH_PER_MS : null,
      limit: this.lastMatch?.limit ?? null,
      wayName: this.lastMatch?.way?.name ?? '',
      over: this.compliance.isOver,
      dqProgress: this.compliance.dqProgress,
      disqualified: this.compliance.disqualified,
      elapsedS: null,
      distanceM: this.distanceM,
      distToFinishM: null,
      waitingFor: null,
    };
    if (this.state === 'armed') {
      if (!usable) out.waitingFor = 'gps';
      else if (!this.direction) {
        out.waitingFor = 'enter';
        out.distToStartM = Math.min(distanceM(fix, this.route.a), distanceM(fix, this.route.b));
      } else {
        out.waitingFor = 'leave';
        out.distToStartM = distanceM(fix, this.startMarker);
      }
    }
    if (this.state === 'running') {
      out.elapsedS = Math.max(0, (now - this.startT) / 1000);
      if (usable) out.distToFinishM = distanceM(fix, this.finishMarker);
    }
    if (this.state === 'finished' || this.state === 'aborted') {
      out.elapsedS = this.endT != null && this.startT != null ? (this.endT - this.startT) / 1000 : null;
    }
    return out;
  }
}
