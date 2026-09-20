import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, newPlayer, ownedBy, planImport, runTally, feedbackText } from '../src/profile.js';

const me = { id: 'pme', name: 'Joonas', createdAt: 1 };
const run = (id, over = {}) => ({ id, routeId: 'r1', status: 'finished', disqualified: false, flags: {}, ...over });
const file = (over = {}) => ({ app: 'csr-demo', format: 3, routes: [{ id: 'r1', rev: 1 }], runs: [run('100')], traces: { 100: [[1]] }, ...over });

test('names are trimmed, squeezed and capped; ids are unique enough', () => {
  assert.equal(cleanName('  Mari   Tamm \n'), 'Mari Tamm');
  assert.equal(cleanName('x'.repeat(40)).length, 24);
  const a = newPlayer(' Mari ', 1000, () => 0.1);
  const b = newPlayer('Mari', 1000, () => 0.9);
  assert.equal(a.name, 'Mari');
  assert.notEqual(a.id, b.id);
  assert.match(a.id, /^p[0-9a-z]+$/);
});

test('each player only sees their own routes and runs', () => {
  const items = [{ id: 1, playerId: 'pme' }, { id: 2, playerId: 'pfriend' }, { id: 3 }];
  assert.deepEqual(ownedBy(items, 'pme').map((x) => x.id), [1]);
});

test("a friend's file becomes a new player here, and never touches my settings", () => {
  const plan = planImport(
    file({ player: { id: 'pfriend', name: ' Mari ' }, settings: { tunables: { dqAfterS: 99 } } }),
    { players: [me], activeId: 'pme', routes: [{ id: 'r9', playerId: 'pme' }], runs: [] },
  );
  assert.equal(plan.created, true);
  assert.deepEqual({ id: plan.player.id, name: plan.player.name, imported: plan.player.imported }, { id: 'pfriend', name: 'Mari', imported: true });
  assert.equal(plan.applySettings, false);
  assert.ok(plan.routes.every((r) => r.playerId === 'pfriend'));
  assert.ok(plan.runs.every((r) => r.playerId === 'pfriend'));
});

test('ids that clash with another player get renamed, and runs and traces follow their route', () => {
  const plan = planImport(
    file({ player: { id: 'pfriend', name: 'Mari' } }),
    { players: [me], activeId: 'pme', routes: [{ id: 'r1', playerId: 'pme' }], runs: [run('100', { playerId: 'pme' })] },
  );
  assert.equal(plan.routes[0].id, 'r1-pfriend');
  assert.equal(plan.runs[0].routeId, 'r1-pfriend');
  assert.equal(plan.runs[0].id, '100-pfriend');
  assert.deepEqual(Object.keys(plan.traces), ['100-pfriend']);
});

test('my own backup goes back to me, with my settings', () => {
  const again = planImport(
    file({ player: me, settings: { audioMode: 'takeover' } }),
    { players: [me], activeId: 'pme', routes: [{ id: 'r1', playerId: 'pme' }], runs: [] },
  );
  assert.equal(again.created, false);
  assert.equal(again.player.id, 'pme');
  assert.equal(again.applySettings, true);
  assert.equal(again.routes[0].id, 'r1', 'my own route keeps its id');
});

test('restoring a backup on a fresh phone: same name and nothing here yet means it is me', () => {
  const fresh = { id: 'pnew', name: 'joonas', createdAt: 5 };
  const plan = planImport(file({ player: me }), { players: [fresh], activeId: 'pnew', routes: [], runs: [] });
  assert.equal(plan.created, false);
  assert.equal(plan.player.id, 'pnew');
  assert.ok(plan.runs.every((r) => r.playerId === 'pnew'));
});

test('a backup from before players existed belongs to whoever is active', () => {
  const plan = planImport(file({ format: 1, routes: undefined, route: { id: 'r1', rev: 1 } }), { players: [me], activeId: 'pme', routes: [], runs: [] });
  assert.equal(plan.player.id, 'pme');
  assert.equal(plan.routes.length, 1);
});

test('rubbish files are refused', () => {
  assert.throws(() => planImport({ hello: 1 }, { players: [me], activeId: 'pme', routes: [], runs: [] }), /Not a CSR Demo export/);
});

test('feedback text carries name, build and counts, but no places', () => {
  const runs = [run('1', { cautions: 2 }), run('2', { disqualified: true, warnings: 3 }), run('3', { status: 'aborted' }), run('4', { demo: true })];
  assert.deepEqual(runTally(runs), { total: 3, clean: 1, disqualified: 1, paused: 0, unfinished: 1, cautions: 2, warnings: 3 });
  const text = feedbackText({ player: { name: 'Mari' }, build: 'b1', routes: [{ a: { lat: 59.4 } }], runs, note: '  Start felt late.  ' });
  assert.match(text, /From: Mari/);
  assert.match(text, /real runs: 3 \(1 clean, 1 disqualified/);
  assert.match(text, /Start felt late\.$/);
  assert.doesNotMatch(text, /59\.4/);
});
