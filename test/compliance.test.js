import test from 'node:test';
import assert from 'node:assert/strict';
import { Compliance, shownKmh } from '../src/compliance.js';
import { withOverrides } from '../src/tunables.js';

const TAGGED_50 = { kmh: 50, tier: 'tagged' };
const ASSUMED_50 = { kmh: 50, tier: 'assumed' };

// One fix per second. Each step is [seconds, km/h, limit, usable?].
// Pass an earlier result's `c` and `t` to carry the same drive on.
function run(steps, c = new Compliance(), t = 0) {
  const events = [];
  for (const [seconds, kmh, limit, usable = true] of steps) {
    for (let i = 0; i < seconds; i++, t += 1000) {
      events.push(...c.update({ t, speedMs: kmh / 3.6, limit, usable }));
    }
  }
  return { c, t, events, types: events.map((e) => e.type) };
}

test('a little over the limit: never red or disqualified, but yellow once it lasts', () => {
  const { c, types } = run([[30, 52.9, TAGGED_50]]);
  assert.deepEqual(types, ['caution', 'caution'], 'at 6 s, again 20 s later');
  assert.equal(c.zone, 'yellow');
  assert.equal(c.episodes.length, 0);
  assert.equal(c.disqualified, false);
  assert.equal(c.dqClockS, 0);
  assert.equal(c.yellowS, 29);
  assert.equal(c.redS, 0);
});

test('a short spell a little over the limit is not yellow', () => {
  const { c, events } = run([[10, 48, TAGGED_50], [5, 51, TAGGED_50], [10, 48, TAGGED_50]]);
  assert.equal(events.length, 0);
  assert.equal(c.zone, 'ok');
  assert.equal(c.yellowS, 4);
});

// Playtest 3: 1-2 km/h over for long stretches and no yellow, because one reading at the limit
// restarted a six-second count. The seconds now add up.
test('hovering a little over the limit turns yellow even when single readings dip to the limit', () => {
  const hover = [];
  for (let i = 0; i < 8; i++) hover.push([3, 51.5, TAGGED_50], [1, 49.8, TAGGED_50]);
  const { c, types } = run(hover);
  assert.equal(types[0], 'caution');
  assert.ok(c.cautions >= 1);
  assert.equal(c.disqualified, false);
});

test('a junction where the map offers a faster road for one fix does not wipe the yellow clock', () => {
  const { types, events } = run([[5, 52, TAGGED_50], [1, 52, { kmh: 70, tier: 'tagged' }], [3, 52, TAGGED_50]]);
  assert.deepEqual(types, ['caution']);
  assert.equal(events[0].t, 8000);
});

test('the verdict uses the speed the driver sees: whole km/h', () => {
  assert.equal(shownKmh(50.4 / 3.6), 50);
  assert.equal(shownKmh(50.6 / 3.6), 51);
  const onTheDot = run([[120, 50.4, TAGGED_50]]);
  assert.equal(onTheDot.events.length, 0, 'reads 50 in a 50 zone');
  assert.equal(onTheDot.c.yellowS, 0);
  assert.equal(run([[10, 53.4, TAGGED_50]]).c.redS, 0, 'reads 53: still the band');
  assert.equal(run([[10, 53.6, TAGGED_50]]).c.redS, 9, 'reads 54: red');
});

test('over the limit is known at once, before any caution', () => {
  const { c, t, events } = run([[3, 48, TAGGED_50], [2, 51, TAGGED_50]]);
  assert.equal(c.aboveNow, true);
  assert.equal(c.zone, 'ok');
  assert.equal(events.length, 0);
  run([[1, 48, TAGGED_50]], c, t);
  assert.equal(c.aboveNow, false);
});

test('slowing down clears yellow at once; a short dip does not buy a fresh six seconds, a long one does', () => {
  let { c, t } = run([[10, 52, TAGGED_50]]);
  assert.equal(c.zone, 'yellow');
  ({ t } = run([[3, 49, TAGGED_50]], c, t));
  assert.equal(c.zone, 'ok');
  assert.equal(c.yellowClockS, 5, 'two under-under seconds at half rate');
  ({ t } = run([[3, 52, TAGGED_50]], c, t));
  assert.equal(c.zone, 'yellow', 'back within a couple of seconds');
  run([[14, 49, TAGGED_50], [5, 52, TAGGED_50]], c, t);
  assert.equal(c.zone, 'ok', 'clean slate after long enough under the limit');
});

test('exactly at the limit is fine for ever', () => {
  const { c, events } = run([[60, 50, TAGGED_50]]);
  assert.equal(events.length, 0);
  assert.equal(c.yellowS, 0);
});

test('easing from red back into the band stays over the limit: yellow, without a fresh wait', () => {
  const { c, types } = run([[2, 48, TAGGED_50], [3, 60, TAGGED_50], [6, 52, TAGGED_50]]);
  assert.deepEqual(types, ['warning', 'cleared', 'caution']);
  assert.equal(c.zone, 'yellow');
  assert.equal(c.redS, 2);
});

test('yellow only warns by default; yellowDqRate makes long yellow count toward disqualification', () => {
  assert.equal(run([[120, 52, TAGGED_50]]).c.disqualified, false);
  const strict = run([[40, 52, TAGGED_50]], new Compliance(withOverrides({ yellowDqRate: 0.25 })));
  assert.equal(strict.c.disqualified, true);
  assert.equal(strict.events.find((e) => e.type === 'disqualified').t, 20000);
  const assumed = run([[40, 52, ASSUMED_50]], new Compliance(withOverrides({ yellowDqRate: 1 })));
  assert.equal(assumed.c.disqualified, false, 'assumed limits never disqualify');
});

test('weak GPS clears the colour on screen but keeps the clocks', () => {
  const { c } = run([[3, 60, TAGGED_50], [2, 60, TAGGED_50, false]]);
  assert.equal(c.zone, 'ok');
  assert.equal(c.dqClockS, 2);
});

test('a single-fix blip does nothing; two seconds over warns; neither disqualifies', () => {
  assert.deepEqual(run([[5, 48, TAGGED_50], [1, 58, TAGGED_50], [5, 48, TAGGED_50]]).types, ['cleared']);
  const twoSec = run([[5, 48, TAGGED_50], [2, 58, TAGGED_50], [5, 48, TAGGED_50]]);
  assert.deepEqual(twoSec.types, ['warning', 'cleared']);
  assert.equal(twoSec.c.disqualified, false);
  assert.equal(twoSec.c.episodes.length, 1);
  assert.equal(Math.round(twoSec.c.episodes[0].maxSpeedKmh), 58);
});

test('five sustained seconds over a tagged limit disqualifies, once', () => {
  const { c, events } = run([[3, 48, TAGGED_50], [12, 60, TAGGED_50]]);
  const dq = events.filter((e) => e.type === 'disqualified');
  assert.equal(dq.length, 1);
  assert.equal(dq[0].t, 8000, 'first over fix at 3 s, clock reaches 5 s at 8 s');
  assert.equal(c.dqAt, 8000);
  assert.equal(c.episodes[0].disqualifying, true);
});

test('assumed limits warn, repeatedly, but never disqualify', () => {
  const { c, types } = run([[25, 70, ASSUMED_50]]);
  assert.equal(c.disqualified, false);
  assert.equal(c.dqClockS, 0);
  assert.deepEqual(types, ['warning', 'warning', 'warning'], 'at 1 s, 11 s and 21 s');
});

test('unknown limit is never over', () => {
  const { c, events } = run([[20, 130, null]]);
  assert.equal(events.length, 0);
  assert.equal(c.isOver, false);
});

test('the clock drains at half rate, so repeated bursts still add up', () => {
  const { c, events } = run([
    [4, 60, TAGGED_50], // clock 3
    [3, 45, TAGGED_50], // drains 2 × 0.5 → 2
    [4, 60, TAGGED_50], // +3 → 5 → DQ
  ]);
  assert.equal(c.disqualified, true);
  assert.equal(events.find((e) => e.type === 'disqualified').t, 10000);
});

test('long enough under the limit resets the clock', () => {
  const { c } = run([[4, 60, TAGGED_50], [10, 45, TAGGED_50], [4, 60, TAGGED_50]]);
  assert.equal(c.disqualified, false);
  assert.equal(c.dqClockS, 3);
});

test('unusable fixes freeze the clock instead of draining or filling it', () => {
  const { c } = run([[3, 60, TAGGED_50], [20, 60, TAGGED_50, false], [1, 45, TAGGED_50]]);
  assert.equal(c.disqualified, false);
  assert.equal(c.dqClockS, 2);
});

test('dqProgress runs from 0 to 1', () => {
  const { c } = run([[3, 60, TAGGED_50]]);
  assert.equal(c.dqProgress, 0.4);
});
