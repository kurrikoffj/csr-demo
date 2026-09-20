import { DEFAULTS, KMH_PER_MS } from './tunables.js';

// Warning / disqualification clock for one run.
// A blip over the limit warns. Sustained time over a *tagged* limit disqualifies.
// Assumed limits only warn; unknown limits are not enforced.
export class Compliance {
  constructor(tunables = DEFAULTS) {
    this.tun = tunables;
    this.dqClockS = 0;
    this.disqualified = false;
    this.dqAt = null;
    this.warnings = 0;
    this.episodes = []; // closed and open over-limit episodes
    this._open = null;
    this._lastT = null;
    this._prevOver = false;
    this._lastWarnT = null;
  }

  // limit: { kmh, tier } | null. usable: false freezes the clock (bad GPS, no speed).
  // ctx: { wayId, wayName, lat, lon } recorded on the episode.
  // Returns events: 'warning' | 'disqualified' | 'cleared'.
  update({ t, speedMs, limit, usable = true, ctx = {} }) {
    const events = [];
    if (!usable || speedMs == null) {
      this._lastT = t;
      return events;
    }
    const dt = this._lastT == null ? 0 : Math.min(3, Math.max(0, (t - this._lastT) / 1000));
    this._lastT = t;

    const speedKmh = speedMs * KMH_PER_MS;
    const over = !!limit && speedKmh > limit.kmh + this.tun.overToleranceKmh;

    if (over) {
      if (!this._open) {
        this._open = {
          tStart: t, tEnd: t, limitKmh: limit.kmh, tier: limit.tier,
          maxSpeedKmh: speedKmh, ...ctx,
        };
        this.episodes.push(this._open);
      }
      const ep = this._open;
      ep.tEnd = t;
      ep.maxSpeedKmh = Math.max(ep.maxSpeedKmh, speedKmh);
      // Time only counts between two consecutive over fixes.
      if (this._prevOver && limit.tier === 'tagged') this.dqClockS += dt;

      const overForS = (t - ep.tStart) / 1000;
      const sinceWarnS = this._lastWarnT == null ? Infinity : (t - this._lastWarnT) / 1000;
      if (overForS >= this.tun.warnAfterS && sinceWarnS >= this.tun.warnRepeatS) {
        this._lastWarnT = t;
        this.warnings++;
        events.push({ type: 'warning', t, speedKmh, limitKmh: limit.kmh, tier: limit.tier });
      }
      if (!this.disqualified && this.dqClockS >= this.tun.dqAfterS) {
        this.disqualified = true;
        this.dqAt = t;
        ep.disqualifying = true;
        events.push({ type: 'disqualified', t, speedKmh, limitKmh: limit.kmh, ...ctx });
      }
    } else {
      if (this._open) {
        this._open = null;
        events.push({ type: 'cleared', t });
      }
      if (!this._prevOver) {
        this.dqClockS = Math.max(0, this.dqClockS - dt * this.tun.dqDrainRate);
      }
    }
    this._prevOver = over;
    return events;
  }

  get isOver() {
    return !!this._open;
  }

  // 0..1, how close the DQ clock is to tripping.
  get dqProgress() {
    return Math.min(1, this.dqClockS / this.tun.dqAfterS);
  }
}
