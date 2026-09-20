import test from 'node:test';
import assert from 'node:assert/strict';
import { demoDrive } from '../src/demo.js';
import { RunEngine } from '../src/runEngine.js';
import { Matcher } from '../src/matcher.js';
import { packTrace, unpackTrace } from '../src/replay.js';
import { town, townRoute, feed, MONDAY_AM } from './helpers.js';

function play(options) {
  const index = town();
  const engine = new RunEngine({ route: townRoute(), matcher: new Matcher(index) });
  engine.arm();
  const fixes = demoDrive(index, townRoute(), { startT: MONDAY_AM, ...options });
  return { engine, fixes, events: feed(engine, fixes).map((e) => e.type) };
}

test('clean demo drive finishes clean in both directions', () => {
  for (const direction of ['ab', 'ba']) {
    const { engine, events } = play({ direction });
    assert.deepEqual(events, ['direction', 'started', 'finished'], direction);
    assert.equal(engine.result().direction, direction);
    assert.equal(engine.result().clean, true);
  }
});

test('speeding demo drive gets a warning, then disqualified, and still finishes', () => {
  const { engine, events } = play({ speeding: true });
  assert.ok(events.indexOf('warning') > 0 && events.indexOf('warning') < events.indexOf('disqualified'));
  assert.equal(events.at(-1), 'finished');
  assert.equal(engine.result().disqualified, true);
  assert.equal(engine.result().episodes[0].wayName, 'Main St');
});

test('a stored trace replays to the same result', () => {
  const { engine, fixes } = play({});
  const again = new RunEngine({ route: townRoute(), matcher: new Matcher(town()) });
  again.arm();
  feed(again, unpackTrace(JSON.parse(JSON.stringify(packTrace(fixes)))));
  assert.equal(again.state, 'finished');
  assert.ok(Math.abs(again.result().durationS - engine.result().durationS) < 0.5);
});
