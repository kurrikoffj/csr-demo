import test from 'node:test';
import assert from 'node:assert/strict';
import { RunEngine } from '../src/runEngine.js';
import { Matcher } from '../src/matcher.js';
import { withOverrides } from '../src/tunables.js';
import { syntheticDrive } from '../src/replay.js';
import { distanceM } from '../src/geo.js';
import { town, townRoute, commuteFixes, legalSpeed, feed, fixAt, xy, COMMUTE, MONDAY_AM } from './helpers.js';

function engine(tunables) {
  const e = new RunEngine({ route: townRoute(), matcher: new Matcher(town(), tunables), tunables });
  e.arm();
  return e;
}

const types = (events) => events.map((e) => e.type);

test('clean commute: starts leaving the home circle, finishes entering the work circle', () => {
  const e = engine();
  const events = feed(e, commuteFixes());
  assert.deepEqual(types(events), ['direction', 'started', 'finished']);
  const r = e.result();
  assert.equal(r.direction, 'ab');
  assert.equal(r.bucket, 'wd_am');
  assert.equal(r.clean, true);
  assert.equal(r.knownLimitFrac, 1);
  assert.equal(r.warnings, 0);
  // Between the two circle edges: 240 m at 40, 2690 m at 48, 1170 m at 28
  const expected = 240 / (40 / 3.6) + 2690 / (48 / 3.6) + 1170 / (28 / 3.6);
  assert.ok(Math.abs(r.durationS - expected) < 2.5, `duration ${r.durationS} vs ${expected}`);
  assert.ok(Math.abs(r.distanceM - 4100) < 30, `distance ${r.distanceM}`);
});

test('start time is interpolated to the circle edge, not snapped to a fix', () => {
  const e = engine();
  const events = feed(e, commuteFixes());
  const started = events.find((ev) => ev.type === 'started');
  // 60 m at 40 km/h = 5.4 s after the first fix
  assert.ok(Math.abs(started.t - (MONDAY_AM + 5400)) < 60, `start offset ${started.t - MONDAY_AM} ms`);
  assert.equal(e.result().flags.impreciseStart, false);
});

test('parked GPS jitter across the circle edge does not start a run', () => {
  const e = engine();
  const parked = [];
  for (let i = 0; i < 90; i++) {
    parked.push(fixAt(0, -300 + 55 + (i % 2 ? 9 : -9), { t: MONDAY_AM + i * 1000, speedKmh: i % 7 ? 0 : 1.5, heading: null }));
  }
  assert.deepEqual(types(feed(e, parked)), ['direction']);
  assert.equal(e.state, 'armed');
  const events = feed(e, commuteFixes({ startT: MONDAY_AM + 100000 }));
  assert.deepEqual(types(events), ['started', 'finished']);
});

test('wandering outside for longer than the confirm window needs a fresh exit', () => {
  const e = engine();
  const fixes = [fixAt(0, -300, { t: MONDAY_AM, speedKmh: 0 })];
  for (let i = 1; i <= 40; i++) fixes.push(fixAt(0, -235, { t: MONDAY_AM + i * 1000, speedKmh: 0 }));
  feed(e, fixes);
  // Drives off from where it stands, outside the circle: no valid start line was crossed.
  const away = syntheticDrive({ path: [xy(0, -235), xy(0, 0), xy(1500, 0)], speedKmh: 40, startT: MONDAY_AM + 41000 });
  feed(e, away);
  assert.equal(e.state, 'armed');
});

test('armed outside both circles: drive in first, the run starts on the way out', () => {
  const e = engine();
  const events = feed(e, commuteFixes({ path: [xy(0, -400), ...COMMUTE] , speedKmh: (d) => legalSpeed(d - 100) }));
  assert.deepEqual(types(events), ['direction', 'started', 'finished']);
  assert.equal(e.hud(0).state, 'finished');
});

test('return trip: arming inside the work circle runs the route backwards', () => {
  const e = engine();
  const back = COMMUTE.slice().reverse();
  const events = feed(e, commuteFixes({ path: back, speedKmh: (d) => (d < 900 ? 28 : d < 3890 ? 48 : 40) }));
  assert.deepEqual(types(events), ['direction', 'started', 'finished']);
  assert.equal(e.result().direction, 'ba');
  assert.equal(e.hud(0).finishName, 'Home');
});

test('sustained speeding disqualifies; the run still records to the finish', () => {
  const e = engine();
  const events = feed(e, commuteFixes({ speedKmh: (d) => (d > 1000 && d < 1300 ? 62 : legalSpeed(d)) }));
  assert.deepEqual(types(events), ['direction', 'started', 'warning', 'disqualified', 'warning', 'cleared', 'finished']);
  const r = e.result();
  assert.equal(r.disqualified, true);
  assert.equal(r.clean, false);
  assert.equal(r.status, 'finished');
  assert.equal(r.episodes.length, 1);
  assert.equal(r.episodes[0].wayName, 'Main St');
  assert.equal(r.episodes[0].limitKmh, 50);
});

test('speeding on an assumed-limit street warns but never disqualifies', () => {
  const e = engine();
  const events = feed(e, commuteFixes({ speedKmh: (d) => (d > 70 && d < 290 ? 75 : legalSpeed(d)) }));
  assert.ok(types(events).includes('warning'));
  assert.ok(!types(events).includes('disqualified'));
  assert.equal(e.result().clean, true);
});

test('braking late into the 30 zone is forgiven inside the slack distance', () => {
  const e = engine();
  // Holds 48 until 40 m past the sign.
  const events = feed(e, commuteFixes({ speedKmh: (d) => (d < 300 ? 40 : d < 3340 ? 48 : 28) }));
  assert.ok(!types(events).includes('warning'), types(events).join(','));
});

test('GPS pause over 10 s flags the run; it finishes but is not clean', () => {
  const e = engine();
  const fixes = commuteFixes().filter((f) => f.t < MONDAY_AM + 100000 || f.t > MONDAY_AM + 130000);
  const events = feed(e, fixes);
  assert.ok(types(events).includes('gap'));
  assert.equal(e.state, 'finished');
  assert.equal(e.result().flags.gap, true);
  assert.equal(e.result().clean, false);
});

test('GPS pause over 120 s aborts, from the next fix or from the ticking clock', () => {
  const byFix = engine();
  feed(byFix, commuteFixes().filter((f) => f.t < MONDAY_AM + 100000 || f.t > MONDAY_AM + 230000));
  assert.equal(byFix.state, 'aborted');
  assert.equal(byFix.result().abortReason, 'gps_gap');

  const byTick = engine();
  feed(byTick, commuteFixes().filter((f) => f.t < MONDAY_AM + 100000));
  byTick.tick(MONDAY_AM + 150000);
  assert.equal(byTick.state, 'running');
  byTick.tick(MONDAY_AM + 221000);
  assert.equal(byTick.state, 'aborted');
});

test('weak GPS fixes are ignored for the start line', () => {
  const e = engine();
  const events = feed(e, commuteFixes({ accuracy: 80 }));
  assert.deepEqual(types(events), []);
  assert.equal(e.hud(0).gps, 'weak');
  assert.equal(e.hud(0).waitingFor, 'gps');
});

test('finish guard: reaching the finish circle too soon does not end the run', () => {
  const e = engine(withOverrides({ finishMinElapsedS: 3600 }));
  feed(e, commuteFixes());
  assert.equal(e.state, 'running');
});

test('cancel while running aborts; hud reports what the driver should do', () => {
  const e = engine();
  assert.equal(e.hud(0).waitingFor, 'gps');
  feed(e, commuteFixes().slice(0, 3));
  assert.equal(e.hud(0).waitingFor, 'leave');
  feed(e, commuteFixes().slice(3, 60));
  const hud = e.hud(MONDAY_AM + 60000);
  assert.equal(hud.state, 'running');
  assert.equal(hud.limit.kmh, 50);
  assert.ok(hud.elapsedS > 50 && hud.elapsedS < 56);
  e.cancel();
  assert.equal(e.state, 'aborted');
  assert.equal(e.result().abortReason, 'manual');
});

test('direction picked on screen applies when armed away from both circles, and the arrow aims at that start', () => {
  const e = new RunEngine({ route: townRoute(), matcher: new Matcher(town()) });
  e.arm({ direction: 'ba' });
  const events = feed(e, [fixAt(3000, 0, { t: MONDAY_AM, speedKmh: 40, heading: 90 })]);
  assert.deepEqual(types(events), ['direction']);
  const hud = e.hud(MONDAY_AM);
  assert.equal(hud.waitingFor, 'enter');
  assert.equal(hud.startName, 'Work');
  assert.equal(hud.target.kind, 'start');
  assert.ok(Math.abs(hud.target.distM - (900 - 60)) < 1, `to the circle edge: ${hud.target.distM}`);
  assert.ok(Math.abs(hud.target.bearingDeg - 90) < 0.5);
  assert.equal(hud.headingDeg, 90);
});

test('standing in the other start circle overrides the direction picked on screen', () => {
  const e = new RunEngine({ route: townRoute(), matcher: new Matcher(town()) });
  e.arm({ direction: 'ba' });
  const events = feed(e, commuteFixes());
  assert.deepEqual(types(events), ['direction', 'started', 'finished']);
  assert.equal(e.result().direction, 'ab');
});

test('inside the start circle there is no arrow; running aims at the finish line and counts down the last 200 m', () => {
  const e = engine();
  const fixes = commuteFixes();
  feed(e, fixes.slice(0, 2));
  assert.equal(e.hud(0).waitingFor, 'leave');
  assert.equal(e.hud(0).target, null);

  const far = fixes.findIndex((f) => distanceM(f, townRoute().b) < 1500);
  feed(e, fixes.slice(2, far));
  let hud = e.hud(fixes[far].t);
  assert.equal(hud.target.kind, 'finish');
  assert.equal(hud.target.name, 'Work');
  assert.equal(hud.finishClose, false);

  const close = fixes.findIndex((f) => distanceM(f, townRoute().b) < 200);
  feed(e, fixes.slice(far, close + 1));
  hud = e.hud(fixes[close].t);
  assert.equal(hud.finishClose, true);
  assert.ok(hud.target.distM < 160 && hud.target.distM > 100, `metres to the line: ${hud.target.distM}`);
});

test('the last good heading is kept while stopped at a light', () => {
  const e = engine();
  feed(e, commuteFixes().slice(0, 40));
  const moving = e.hud(0).headingDeg;
  feed(e, [{ ...e.lastFix, t: e.lastFix.t + 1000, speed: 0, heading: null }]);
  assert.equal(e.hud(0).headingDeg, moving);
});

test('a run records its yellow time and cautions, and stays clean', () => {
  const e = engine();
  feed(e, commuteFixes({ speedKmh: (d) => (d > 800 && d < 1200 ? 52 : legalSpeed(d)) }));
  const r = e.result();
  assert.equal(r.clean, true);
  assert.equal(r.cautions, 2);
  assert.ok(r.yellowS > 25 && r.yellowS < 30, `yellow seconds ${r.yellowS}`);
  assert.equal(r.redS, 0);
  assert.ok(e.trace.some((f) => f.zone === 'yellow'));
});
