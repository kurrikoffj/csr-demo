import { DEFAULTS, KMH_PER_MS } from './tunables.js';
import { shownSpeed, shownLimit, bandWidth } from './units.js';

// The speed the driver sees: a whole number. Every tier is judged on this number, so the digits
// on the HUD and the verdict never disagree (50.4 reads "50" and is fine; 50.6 reads "51" and is over).
// In mph the same holds in whole mph against the roundel's whole mph: see units.js.
export const shownKmh = (speedMs) => shownSpeed(speedMs, 'kmh');

// Speed tiers for one run:
//   yellow  a little over the limit (inside the tolerance band) for too long. The seconds add up
//           on a leaky clock, so a one-fix dip to the limit or a junction does not wipe them.
//           Warns; only feeds the disqualification clock if yellowDqRate says so.
//   red     over limit + tolerance. Warns after a moment; sustained red on a *tagged* limit disqualifies.
// Assumed limits never disqualify; unknown limits are not enforced.
export class Compliance {
  constructor(tunables = DEFAULTS, unit = 'kmh') {
    this.tun = tunables;
    this.unit = unit; // 'kmh' | 'mph': the unit on the driver's screen, which is the unit of judgement
    this.zone = 'ok'; // 'ok' | 'yellow' | 'red', what the HUD shows right now
    this.aboveNow = false; // the shown speed is over the limit at this fix, however briefly
    this.yellowClockS = 0; // fills while over the limit, drains while not; yellow at yellowAfterS
    this.dqClockS = 0;
    this.disqualified = false;
    this.dqAt = null;
    this.warnings = 0; // red cues
    this.cautions = 0; // yellow cues
    this.yellowS = 0; // seconds a little over the limit
    this.redS = 0; // seconds clearly over
    this.episodes = []; // red episodes, closed and open
    this._open = null;
    this._lastT = null;
    this._prev = 'ok'; // 'ok' | 'band' | 'red' at the previous usable fix
    this._lastWarnT = null;
    this._lastCautionT = null;
  }

  // limit: { kmh, tier, mph? } | null. usable: false freezes the clocks (bad GPS, no speed).
  // ctx: { wayId, wayName, lat, lon } recorded on a red episode.
  // Returns events: 'caution' | 'warning' | 'disqualified' | 'cleared'.
  update({ t, speedMs, limit, usable = true, ctx = {} }) {
    const events = [];
    if (!usable || speedMs == null) {
      this._lastT = t;
      this.zone = 'ok';
      this.aboveNow = false;
      return events;
    }
    const tun = this.tun;
    const dt = this._lastT == null ? 0 : Math.min(3, Math.max(0, (t - this._lastT) / 1000));
    this._lastT = t;

    const speedKmh = speedMs * KMH_PER_MS;
    const shown = shownSpeed(speedMs, this.unit);
    const onSign = limit ? shownLimit(limit, this.unit) : null;
    const above = !!limit && shown > onSign;
    const now = !above ? 'ok' : shown > onSign + bandWidth(tun.overToleranceKmh, this.unit) ? 'red' : 'band';
    const tagged = limit?.tier === 'tagged';
    this.aboveNow = above;

    // The time between two fixes counts for the milder of their two states;
    // between an over fix and an under fix, no clock moves.
    if (this._prev !== 'ok' && now !== 'ok') {
      this.yellowClockS = Math.min(tun.yellowAfterS, this.yellowClockS + dt);
      if (this._prev === 'red' && now === 'red') {
        this.redS += dt;
        if (tagged) this.dqClockS += dt;
      } else {
        this.yellowS += dt;
        if (tagged) this.dqClockS += dt * tun.yellowDqRate;
      }
    } else if (this._prev === 'ok' && now === 'ok') {
      this.yellowClockS = Math.max(0, this.yellowClockS - dt * tun.yellowDrainRate);
      this.dqClockS = Math.max(0, this.dqClockS - dt * tun.dqDrainRate);
    }

    if (now === 'red') {
      if (!this._open) {
        this._open = {
          tStart: t, tEnd: t, limitKmh: limit.kmh, limitMph: limit.mph ?? null, tier: limit.tier,
          maxSpeedKmh: speedKmh, ...ctx,
        };
        this.episodes.push(this._open);
      }
      const ep = this._open;
      ep.tEnd = t;
      ep.maxSpeedKmh = Math.max(ep.maxSpeedKmh, speedKmh);
      const sinceWarnS = this._lastWarnT == null ? Infinity : (t - this._lastWarnT) / 1000;
      if ((t - ep.tStart) / 1000 >= tun.warnAfterS && sinceWarnS >= tun.warnRepeatS) {
        this._lastWarnT = t;
        this.warnings++;
        events.push({ type: 'warning', t, speedKmh, limitKmh: limit.kmh, tier: limit.tier });
      }
    } else if (this._open) {
      this._open = null;
      events.push({ type: 'cleared', t });
    }

    const sustained = this.yellowClockS >= tun.yellowAfterS;
    this.zone = now === 'red' ? 'red' : now === 'band' && sustained ? 'yellow' : 'ok';
    if (this.zone === 'yellow') {
      const sinceCautionS = this._lastCautionT == null ? Infinity : (t - this._lastCautionT) / 1000;
      if (sinceCautionS >= tun.yellowRepeatS) {
        this._lastCautionT = t;
        this.cautions++;
        events.push({ type: 'caution', t, speedKmh, limitKmh: limit.kmh, tier: limit.tier });
      }
    }

    if (!this.disqualified && this.dqClockS >= tun.dqAfterS) {
      this.disqualified = true;
      this.dqAt = t;
      if (this._open) this._open.disqualifying = true;
      events.push({ type: 'disqualified', t, speedKmh, limitKmh: limit?.kmh ?? null, ...ctx });
    }

    this._prev = now;
    return events;
  }

  get isOver() {
    return this.zone === 'red';
  }

  // 0..1, how close the DQ clock is to tripping.
  get dqProgress() {
    return Math.min(1, this.dqClockS / this.tun.dqAfterS);
  }
}
