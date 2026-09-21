import test from 'node:test';
import assert from 'node:assert/strict';
import { gettingStarted, isFirstFinish } from '../src/guide.js';
import { townRoute } from './helpers.js';

const me = { id: 'pme', name: 'Joonas' };
const states = (g) => g.steps.map((s) => s.state);
const run = (id, over = {}) => ({ id, status: 'finished', demo: false, ...over });

test('a new player is walked from name to markers to the first drive', () => {
  assert.equal(gettingStarted({ player: null }).show, false, 'the welcome screen comes before any steps');
  const named = gettingStarted({ player: me });
  assert.deepEqual([named.show, named.now, named.stepNo, named.total], [true, 'markers', 2, 3]);
  assert.deepEqual(states(named), ['done', 'now', 'later']);

  const placed = gettingStarted({ player: me, routes: [townRoute()] });
  assert.deepEqual([placed.now, placed.stepNo], ['drive', 3]);
  assert.deepEqual(states(placed), ['done', 'done', 'now']);

  const driven = gettingStarted({ player: me, routes: [townRoute()], runs: [run('1')] });
  assert.deepEqual([driven.show, driven.now], [false, null]);
  assert.deepEqual(states(driven), ['done', 'done', 'done']);
});

test('only a real finished drive ends the steps', () => {
  const routes = [townRoute()];
  for (const r of [run('1', { demo: true }), run('2', { status: 'aborted' })]) {
    assert.equal(gettingStarted({ player: me, routes, runs: [r] }).now, 'drive');
  }
  assert.equal(gettingStarted({ player: me, routes, runs: [run('3', { disqualified: true })] }).show, false, 'a disqualified finish still taught the whole loop');
});

test('a route that came without marker positions does not count as placed', () => {
  const hiddenEnds = townRoute({ a: { name: 'A', lat: null, lon: null }, trimmed: true });
  assert.equal(gettingStarted({ player: me, routes: [hiddenEnds] }).now, 'markers');
});

test('the steps can be hidden, and never show for an imported friend', () => {
  assert.equal(gettingStarted({ player: me, hidden: true }).show, false);
  assert.equal(gettingStarted({ player: { ...me, imported: true } }).show, false);
});

test('the first finish is recognised once, saved or not', () => {
  const first = run('1');
  assert.equal(isFirstFinish(first, []), true, 'before it is saved');
  assert.equal(isFirstFinish(first, [first]), true, 'after it is saved');
  assert.equal(isFirstFinish(run('2'), [first, run('2')]), false);
  assert.equal(isFirstFinish(run('3', { demo: true }), []), false);
  assert.equal(isFirstFinish(first, [first, run('9', { demo: true }), run('8', { status: 'aborted' })]), true);
});
