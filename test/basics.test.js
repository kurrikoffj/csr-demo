import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceM, bearingDeg, angleDiffDeg, projectOnSegment, circleCrossing, bboxAround } from '../src/geo.js';
import { bucketFor } from '../src/buckets.js';
import { limitFromTags, wayLimit, overpassQuery } from '../src/osm.js';
import { formatDuration, formatDelta, standingText } from '../src/phrases.js';
import { syntheticDrive } from '../src/replay.js';
import { route } from '../src/router.js';
import { xy, town, COMMUTE } from './helpers.js';

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ''} expected ${expected} ±${tol}, got ${actual}`);

test('geo: distance, bearing, angle difference', () => {
  near(distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 111195, 50);
  near(distanceM(xy(0, 0), xy(300, 400)), 500, 0.5);
  near(bearingDeg(xy(0, 0), xy(100, 0)), 90, 0.1);
  near(bearingDeg(xy(0, 0), xy(0, -100)), 180, 0.1);
  assert.equal(angleDiffDeg(350, 10), 20);
  assert.equal(angleDiffDeg(90, 270), 180);
});

test('geo: projection onto a segment clamps to its ends', () => {
  const mid = projectOnSegment(xy(50, 10), xy(0, 0), xy(100, 0));
  near(mid.distM, 10, 0.05);
  near(mid.t, 0.5, 0.001);
  const past = projectOnSegment(xy(130, 0), xy(0, 0), xy(100, 0));
  near(past.distM, 30, 0.05);
  assert.equal(past.t, 1);
});

test('geo: circle crossing fraction, outward and inward', () => {
  const c = xy(0, 0);
  near(circleCrossing(c, 60, xy(0, 50), xy(0, 70)), 0.5, 0.01, 'outward');
  near(circleCrossing(c, 40, xy(100, 0), xy(0, 0)), 0.6, 0.01, 'inward');
  assert.equal(circleCrossing(c, 40, xy(100, 0), xy(90, 0)), null);
});

test('geo: padded bounding box', () => {
  const box = bboxAround([xy(0, 0), xy(1000, 500)], 2000);
  near(distanceM({ lat: box.south, lon: box.west }, { lat: box.north, lon: box.west }), 4500, 5);
});

test('buckets: weekday and weekend edges', () => {
  const at = (day, h, m) => bucketFor(new Date(2026, 8, day, h, m));
  assert.equal(new Date(2026, 8, 21).getDay(), 1, '2026-09-21 is a Monday');
  assert.equal(at(21, 6, 29), 'wd_eve');
  assert.equal(at(21, 6, 30), 'wd_am');
  assert.equal(at(21, 9, 29), 'wd_am');
  assert.equal(at(21, 9, 30), 'wd_mid');
  assert.equal(at(21, 15, 30), 'wd_pm');
  assert.equal(at(21, 18, 30), 'wd_eve');
  assert.equal(at(25, 23, 0), 'wd_eve', 'Friday night is still a weekday');
  assert.equal(at(26, 6, 59), 'we_night');
  assert.equal(at(26, 7, 0), 'we_day');
  assert.equal(at(27, 20, 0), 'we_night');
});

test('osm: maxspeed parsing', () => {
  assert.deepEqual(limitFromTags({ maxspeed: '50' }), { kmh: 50, tier: 'tagged', approx: false });
  assert.equal(limitFromTags({ maxspeed: '30 mph' }).kmh, 48);
  assert.equal(limitFromTags({ maxspeed: 'EE:urban' }).kmh, 50);
  assert.equal(limitFromTags({ 'source:maxspeed': 'EE:rural' }).kmh, 90);
  assert.equal(limitFromTags({ 'zone:maxspeed': 'EE:30' }).kmh, 30);
  assert.equal(limitFromTags({ maxspeed: 'signals' }), null);
  assert.equal(limitFromTags({ highway: 'tertiary' }), null);
});

test('osm: several values resolve to the highest and are marked approximate', () => {
  const school = limitFromTags({ maxspeed: '50', 'maxspeed:conditional': '30 @ (Mo-Fr 07:00-17:00; Sa 09:00-12:00)' });
  assert.deepEqual(school, { kmh: 50, tier: 'tagged', approx: true });
  const summer = limitFromTags({ maxspeed: '90', 'maxspeed:conditional': '110 @ (May-Sep)' });
  assert.equal(summer.kmh, 110);
  assert.equal(limitFromTags({ 'maxspeed:lanes': '100|100|80' }).kmh, 100);
  assert.equal(limitFromTags({ maxspeed: '70', 'maxspeed:variable': 'yes' }).approx, true);
  assert.equal(limitFromTags({ maxspeed: '50', 'maxspeed:hgv': '80' }).kmh, 50, 'truck limits are ignored');
});

test('osm: untagged roads get assumed or unknown limits', () => {
  assert.deepEqual(wayLimit({ highway: 'residential', limit: null }), { kmh: 50, tier: 'assumed', approx: false });
  assert.equal(wayLimit({ highway: 'living_street', limit: null }).kmh, 20);
  assert.equal(wayLimit({ highway: 'tertiary', limit: null }), null);
});

test('osm: overpass query covers the bbox', () => {
  const q = overpassQuery({ south: 59.4, west: 24.7, north: 59.45, east: 24.8 });
  assert.match(q, /\(59\.40000,24\.70000,59\.45000,24\.80000\)/);
  assert.match(q, /out tags geom;$/);
});

test('phrases: durations and deltas', () => {
  assert.equal(formatDuration(754.2), '12:34');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(formatDelta(-18.4), '−0:18');
  assert.equal(formatDelta(42), '+0:42');
  assert.equal(standingText({ faster: 6, total: 8 }), 'Faster than 6 of 8 of your runs in this bucket');
});

test('replay: synthetic drive covers the path at the given speed', () => {
  const fixes = syntheticDrive({ path: [xy(0, 0), xy(1000, 0)], speedKmh: 36, startT: 1000 });
  assert.equal(fixes[0].t, 1000);
  near(fixes.length, 101, 1);
  near(distanceM(fixes.at(-1), xy(1000, 0)), 0, 0.5);
  near(fixes[10].heading, 90, 0.1);
  assert.equal(fixes[10].speed, 10);
});

test('replay: a red light is a speed function returning zero', () => {
  const fixes = syntheticDrive({ path: [xy(0, 0), xy(200, 0)], speedKmh: (d, t) => (t >= 5 && t < 15 ? 0 : 36) });
  near(fixes.length, 31, 1);
  assert.equal(fixes[8].speed, 0);
  assert.equal(fixes[8].heading, null);
});

test('router: finds the commute over the town roads', () => {
  const r = route(town(), COMMUTE[0], COMMUTE.at(-1));
  assert.ok(r, 'route found');
  let len = 0;
  for (let i = 1; i < r.points.length; i++) len += distanceM(r.points[i - 1], r.points[i]);
  near(len, 4200, 60);
  assert.ok(r.points.some((p) => distanceM(p, xy(3000, 0)) < 1), 'passes the Main St / Slow St junction');
  assert.equal(r.points.length, r.wayIdx.length);
});
