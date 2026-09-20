import test from 'node:test';
import assert from 'node:assert/strict';
import { Matcher } from '../src/matcher.js';
import { coverage } from '../src/osm.js';
import { town, fixAt } from './helpers.js';

const EAST = 90;
const WEST = 270;
const NORTH = 0;

// Drive a straight line of fixes through a fresh matcher; returns the last match.
function driveTo(matcher, fromX, toX, y, heading, speedKmh = 45) {
  const step = (speedKmh / 3.6) * Math.sign(toX - fromX);
  let last = null;
  let t = 0;
  for (let x = fromX; (toX - x) * Math.sign(step) >= 0; x += step, t += 1000) {
    last = matcher.match(fixAt(x, y, { t, heading, speedKmh }));
  }
  return last;
}

test('matches the road under the car and reads its tagged limit', () => {
  const m = new Matcher(town());
  const r = m.match(fixAt(1500, 2, { heading: EAST }));
  assert.equal(r.way.name, 'Main St');
  assert.deepEqual(r.limit, { kmh: 50, tier: 'tagged', approx: false });
});

test('heading filter: crossing road is ignored at a junction', () => {
  const m = new Matcher(town());
  const r = m.match(fixAt(1, -8, { heading: NORTH }));
  assert.equal(r.way.name, 'Home Ln');
  assert.equal(r.limit.tier, 'assumed');
});

test('untagged tertiary road has an unknown limit; open sea has no road', () => {
  const m = new Matcher(town());
  const road = m.match(fixAt(4500, 0, { heading: EAST }));
  assert.equal(road.way.name, 'Mystery Rd');
  assert.equal(road.limit, null);
  const sea = m.match(fixAt(1500, 900, { heading: EAST }));
  assert.equal(sea.way, null);
  assert.equal(sea.limit, null);
});

test('parallel roads: when it is unclear which one, the higher limit applies', () => {
  const between = new Matcher(town()).match(fixAt(1500, 12, { heading: EAST }));
  assert.equal(between.limit.kmh, 50, 'Side Rd 30 vs Main St 50, 12 m vs 8 m away');
  const onSide = new Matcher(town()).match(fixAt(1500, 21, { heading: EAST }));
  assert.equal(onSide.way.name, 'Side Rd');
  assert.equal(onSide.limit.kmh, 30, 'clearly on Side Rd');
});

test('stickiness: GPS wobble toward a parallel road does not switch roads at once', () => {
  const m = new Matcher(town());
  driveTo(m, 1000, 1200, 0, EAST);
  const wobble = m.match(fixAt(1215, 13, { t: 99000, heading: EAST }));
  assert.equal(wobble.way.name, 'Main St');
});

test('limit drop 50→30: the old limit holds for the slack distance past the sign', () => {
  const m = new Matcher(town());
  assert.equal(driveTo(m, 2800, 3030, 0, EAST).limit.kmh, 50, '30 m past the sign');
  assert.equal(driveTo(m, 3040, 3120, 0, EAST).limit.kmh, 30, '120 m past the sign');
});

test('limit rise 30→50: the new limit applies from the slack distance before the sign', () => {
  const m = new Matcher(town());
  assert.equal(driveTo(m, 3400, 3200, 0, WEST).limit.kmh, 30);
  assert.equal(driveTo(m, 3190, 3020, 0, WEST).limit.kmh, 50, '20 m before the sign');
});

test('coverage counts tiers', () => {
  assert.deepEqual(coverage(town().ways), { tagged: 3, assumed: 1, unknown: 1, total: 5 });
});
