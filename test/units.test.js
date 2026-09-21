import test from 'node:test';
import assert from 'node:assert/strict';
import { shownSpeed, shownLimit, bandWidth, isConverted, formatDistance, defaultUnit, fromKmh, toKmh, KMH_PER_MPH } from '../src/units.js';
import { Compliance } from '../src/compliance.js';
import { RunEngine } from '../src/runEngine.js';
import { townRoute, fixAt } from './helpers.js';

const MPH = (sign) => ({ kmh: sign * KMH_PER_MPH, mph: sign, tier: 'tagged' });
const KMH = (sign) => ({ kmh: sign, tier: 'tagged' });
const ms = (value, unit) => toKmh(value, unit) / 3.6;

// Hold one speed for some seconds at 1 Hz; returns the Compliance.
function hold(limit, unit, speed, seconds = 12, c = new Compliance(undefined, unit)) {
  for (let t = 0; t <= seconds; t++) c.update({ t: t * 1000, speedMs: ms(speed, unit), limit });
  return c;
}
// 'ok' | 'band' | 'red' for a single held speed, read off the counters.
const tier = (limit, unit, speed) => {
  const c = hold(limit, unit, speed);
  return c.redS > 0 ? 'red' : c.yellowS > 0 ? 'band' : 'ok';
};

test('units: whole numbers for the screen, in either unit', () => {
  assert.equal(shownSpeed(50 / 3.6, 'kmh'), 50);
  assert.equal(shownSpeed(ms(30.4, 'mph'), 'mph'), 30);
  assert.equal(shownSpeed(ms(30.6, 'mph'), 'mph'), 31);
  assert.equal(shownLimit(KMH(50), 'kmh'), 50);
  assert.equal(shownLimit(MPH(30), 'mph'), 30);
  assert.equal(shownLimit(KMH(50), 'mph'), 32, '50 km/h is 31.07 mph: converted limits round up');
  assert.equal(shownLimit(KMH(80), 'mph'), 50);
  assert.equal(shownLimit({ kmh: 25 * KMH_PER_MPH }, 'mph'), 25, 'float noise from a round trip is not rounded up');
  assert.equal(isConverted(MPH(30), 'mph'), false);
  assert.equal(isConverted(MPH(30), 'kmh'), true);
  assert.equal(isConverted(KMH(50), 'mph'), true);
  assert.equal(bandWidth(3, 'kmh'), 3);
  assert.equal(bandWidth(3, 'mph'), 2, '3 km/h is 1.86 mph: rounded up, so red never comes sooner than in km/h');
  assert.equal(bandWidth(toKmh(2, 'mph'), 'mph'), 2);
  assert.equal(formatDistance(12345, 'kmh'), '12.3 km');
  assert.equal(formatDistance(12345, 'mph'), '7.7 mi');
  assert.equal(Math.round(fromKmh(toKmh(45, 'mph'), 'mph')), 45);
});

test('units: mph by default only where the roads are signed in mph', () => {
  assert.equal(defaultUnit({ languages: ['en-GB', 'en'], timeZone: 'Europe/London' }), 'mph');
  assert.equal(defaultUnit({ languages: ['en-US'], timeZone: 'America/Chicago' }), 'mph');
  assert.equal(defaultUnit({ languages: ['en-US'], timeZone: '' }), 'mph', 'no time zone to check: the region decides');
  assert.equal(defaultUnit({ languages: ['en-US', 'et'], timeZone: 'Europe/Tallinn' }), 'kmh', 'an English (US) phone in Estonia drives in km/h');
  assert.equal(defaultUnit({ languages: ['en-US'], timeZone: 'America/Toronto' }), 'kmh');
  assert.equal(defaultUnit({ languages: ['et-EE'], timeZone: 'Europe/Tallinn' }), 'kmh');
  assert.equal(defaultUnit({ languages: ['en'], timeZone: 'Europe/London' }), 'kmh', 'no region named: km/h');
  assert.equal(defaultUnit({ languages: ['zh-Hant-TW'] }), 'kmh');
  assert.equal(defaultUnit(), 'kmh');
});

test('mph judging around a 30 mph sign: 30 is fine, 31 and 32 are yellow, 33 is red', () => {
  const sign = MPH(30);
  assert.equal(tier(sign, 'mph', 30.4), 'ok', 'reads 30');
  assert.equal(tier(sign, 'mph', 30.6), 'band', 'reads 31');
  assert.equal(tier(sign, 'mph', 32.4), 'band', 'reads 32');
  assert.equal(tier(sign, 'mph', 32.6), 'red', 'reads 33');
  assert.equal(hold(sign, 'mph', 32.4, 60).disqualified, false, 'yellow never disqualifies');
  assert.equal(hold(sign, 'mph', 33, 4).disqualified, false);
  assert.equal(hold(sign, 'mph', 33, 6).disqualified, true, '5 s sustained red on a signed limit');
});

test('mph judging around a 70 mph sign: 70 is fine, 71 and 72 are yellow, 73 is red', () => {
  const sign = MPH(70);
  assert.equal(tier(sign, 'mph', 70.4), 'ok');
  assert.equal(tier(sign, 'mph', 70.6), 'band');
  assert.equal(tier(sign, 'mph', 72.4), 'band');
  assert.equal(tier(sign, 'mph', 72.6), 'red');
  assert.equal(hold(sign, 'mph', 73, 6).disqualified, true);
});

test('a converted limit is judged against the rounded-up number on the roundel', () => {
  // 30 mph sign, km/h screen: roundel 49, yellow 50 to 52, red from 53.
  assert.equal(tier(MPH(30), 'kmh', 49.4), 'ok');
  assert.equal(tier(MPH(30), 'kmh', 49.6), 'band');
  assert.equal(tier(MPH(30), 'kmh', 52.4), 'band');
  assert.equal(tier(MPH(30), 'kmh', 52.6), 'red');
  // 50 km/h sign, mph screen: roundel 32, yellow 33 and 34, red from 35.
  assert.equal(tier(KMH(50), 'mph', 32.4), 'ok');
  assert.equal(tier(KMH(50), 'mph', 32.6), 'band');
  assert.equal(tier(KMH(50), 'mph', 34.4), 'band');
  assert.equal(tier(KMH(50), 'mph', 34.6), 'red');
});

test('km/h judging of km/h signs is unchanged', () => {
  assert.equal(tier(KMH(50), 'kmh', 50.4), 'ok');
  assert.equal(tier(KMH(50), 'kmh', 50.6), 'band');
  assert.equal(tier(KMH(50), 'kmh', 53.4), 'band');
  assert.equal(tier(KMH(50), 'kmh', 53.6), 'red');
});

test('nobody is flagged at or under the sign, whatever the unit on the screen or on the sign', () => {
  const signs = [...[20, 25, 30, 40, 50, 60, 70].map(MPH), ...[20, 30, 50, 70, 90, 110].map(KMH)];
  for (const unit of ['kmh', 'mph']) {
    for (const sign of signs) {
      const c = new Compliance(undefined, unit);
      for (let kmh = sign.kmh - 12; kmh <= sign.kmh + 12; kmh += 0.05) {
        c.update({ t: 0, speedMs: kmh / 3.6, limit: sign });
        if (kmh <= sign.kmh) assert.equal(c.aboveNow, false, `${kmh.toFixed(2)} km/h under a ${sign.mph ?? sign.kmh} sign, ${unit} screen`);
        // The digits and the verdict agree: over exactly when the speed shown is more than the limit shown.
        assert.equal(c.aboveNow, shownSpeed(kmh / 3.6, unit) > shownLimit(sign, unit));
      }
    }
  }
});

test('the engine judges in the unit it is given, and says which on the result', () => {
  const e = new RunEngine({ route: townRoute(), unit: 'mph' });
  e.arm();
  e.onFix(fixAt(0, -300, { t: 0, speedKmh: 0 }));
  assert.equal(e.compliance.unit, 'mph');
  const hud = e.hud(0);
  assert.equal(hud.unit, 'mph');
  assert.equal(hud.shownSpeed, 0);
  assert.equal(new RunEngine({ route: townRoute() }).unit, 'kmh');
});
