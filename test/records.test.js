import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, bestsByBucket, isClean } from '../src/records.js';

const NOW = new Date(2026, 8, 21, 8, 30).getTime();
const DAY = 86400000;

let seq = 0;
const run = (durationS, over = {}) => ({
  id: String(++seq), routeId: 'r1', routeRev: 1, direction: 'ab', bucket: 'wd_am',
  startT: NOW - seq * DAY, durationS, status: 'finished', disqualified: false, flags: { gap: false },
  ...over,
});

test('first clean run in a bucket is the best by default', () => {
  const r = run(1500);
  const s = summarize(r, [r], { now: NOW });
  assert.equal(s.isBest, true);
  assert.equal(s.firstInBucket, true);
  assert.equal(s.standing, null);
  assert.equal(s.deltaS, null);
});

test('faster run is a new best; standing counts the runs it beat', () => {
  const history = [run(1500), run(1450), run(1600)];
  const r = run(1440, { startT: NOW });
  const s = summarize(r, [...history, r], { now: NOW });
  assert.equal(s.isBest, true);
  assert.equal(s.deltaS, -10);
  assert.deepEqual(s.standing, { faster: 3, total: 3 });
});

test('slower run reports the gap and a middling standing', () => {
  const history = [run(1500), run(1450), run(1600)];
  const r = run(1520, { startT: NOW });
  const s = summarize(r, [...history, r], { now: NOW });
  assert.equal(s.isBest, false);
  assert.equal(s.deltaS, 70);
  assert.deepEqual(s.standing, { faster: 1, total: 3 });
});

test('disqualified, GPS-paused and aborted runs never set or count toward records', () => {
  const dirty = [
    run(900, { disqualified: true }),
    run(900, { flags: { gap: true } }),
    run(900, { status: 'aborted' }),
  ];
  assert.ok(dirty.every((r) => !isClean(r)));
  const r = run(1500, { startT: NOW });
  const s = summarize(r, [...dirty, r], { now: NOW });
  assert.equal(s.isBest, true);
  assert.equal(s.firstInBucket, true);

  const dq = run(800, { disqualified: true, startT: NOW });
  const sDq = summarize(dq, [run(1500), dq], { now: NOW });
  assert.equal(sDq.isBest, false);
  assert.equal(sDq.standing, null);
});

test('other buckets, directions and marker revisions are separate records', () => {
  const others = [run(900, { bucket: 'wd_pm' }), run(900, { direction: 'ba' }), run(900, { routeRev: 2 })];
  const r = run(1500, { startT: NOW });
  const s = summarize(r, [...others, r], { now: NOW });
  assert.equal(s.firstInBucket, true);
  assert.equal(s.fallback.overallBest.bucket, 'wd_pm', 'empty bucket falls back to the best at any time of day');
});

test('records expire after the window', () => {
  const old = run(1000, { startT: NOW - 731 * DAY });
  const r = run(1500, { startT: NOW });
  assert.equal(summarize(r, [old, r], { now: NOW }).isBest, true);
  assert.equal(summarize(r, [old, r], { now: NOW, windowDays: 800 }).isBest, false);
});

test('bests by bucket for the history screen', () => {
  const runs = [run(1500), run(1450), run(1300, { bucket: 'wd_pm' }), run(1000, { disqualified: true })];
  const bests = bestsByBucket(runs, { routeId: 'r1', routeRev: 1, direction: 'ab' }, { now: NOW });
  assert.equal(bests.wd_am.durationS, 1450);
  assert.equal(bests.wd_pm.durationS, 1300);
  assert.equal(bests.we_day, undefined);
});
