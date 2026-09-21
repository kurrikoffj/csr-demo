import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivate, hasPlaces, placeName, routeName, trimForSharing } from '../src/privacy.js';
import { planImport } from '../src/profile.js';
import { packTrace } from '../src/replay.js';
import { distanceM } from '../src/geo.js';
import { xy, townRoute, commuteFixes } from './helpers.js';

const me = { id: 'pme', name: 'Joonas', createdAt: 1 };
const at = (row) => ({ lat: row[1], lon: row[2] });

function exportFile(route = townRoute()) {
  const run = {
    id: '100', routeId: route.id, routeRev: 1, direction: 'ab', status: 'finished', durationS: 300, disqualified: false, flags: {},
    episodes: [
      { wayName: 'Home Ln', wayId: 3, ...xy(0, -100), limitKmh: 50, maxSpeedKmh: 60 }, // 200 m from Home
      { wayName: 'Main St', wayId: 1, ...xy(1500, 0), limitKmh: 50, maxSpeedKmh: 61 }, // mid-route
    ],
  };
  return { app: 'csr-demo', format: 3, player: me, settings: { tunables: {} }, routes: [route], runs: [run], traces: { 100: packTrace(commuteFixes()) } };
}

test('a marker is a private place unless it was unticked', () => {
  assert.equal(isPrivate({ name: 'Home' }), true, 'markers from before the flag existed are private');
  assert.equal(isPrivate({ name: 'Home', private: true }), true);
  assert.equal(isPrivate({ name: 'Airport', private: false }), false);
});

test('Presentation mode: a private place is only its letter; a public landmark keeps its name', () => {
  const route = townRoute({ b: { ...townRoute().b, name: 'Airport', private: false } });
  assert.equal(placeName(route, 'a', false), 'Home');
  assert.equal(placeName(route, 'a', true), 'A');
  assert.equal(placeName(route, 'b', true), 'Airport');
  assert.equal(routeName(route, true), 'A ⇄ Airport');
  assert.equal(routeName(route, false), 'Home ⇄ Airport');
});

test('a file with start and finish hidden has no GPS point near a private marker, and no marker positions', () => {
  const full = exportFile();
  const safe = trimForSharing(full, { trimM: 500 });
  const route = townRoute();
  assert.equal(safe.trimmed, true);
  assert.equal(safe.trimM, 500);
  const rows = safe.traces[100];
  assert.ok(rows.length > 50 && rows.length < full.traces[100].length);
  for (const row of rows) {
    assert.ok(distanceM(at(row), route.a) >= 500 && distanceM(at(row), route.b) >= 500);
  }
  for (const key of ['a', 'b']) {
    assert.deepEqual([safe.routes[0][key].name, safe.routes[0][key].lat, safe.routes[0][key].lon], [key.toUpperCase(), null, null]);
    assert.equal(safe.routes[0][key].activationM, 60, 'circle sizes are not places');
  }
  assert.equal(hasPlaces(safe.routes[0]), false);
  assert.equal(safe.runs[0].trimmed, true);
  assert.equal(safe.runs[0].durationS, 300, 'the result of the run is untouched');
  assert.deepEqual([safe.runs[0].episodes[0].wayName, safe.runs[0].episodes[0].lat], ['', null], 'a red episode near home loses its street and position');
  assert.equal(safe.runs[0].episodes[1].wayName, 'Main St', 'one in the middle of the drive keeps them');
  assert.doesNotMatch(JSON.stringify(safe), /Home|Work/);
  // The original is not touched.
  assert.equal(full.routes[0].a.name, 'Home');
  assert.equal(full.trimmed, undefined);
});

test('a public landmark keeps its end of the trace, its name and its position', () => {
  const route = townRoute({ b: { ...townRoute().b, name: 'Airport', private: false } });
  const safe = trimForSharing(exportFile(route));
  assert.equal(safe.routes[0].b.name, 'Airport');
  assert.notEqual(safe.routes[0].b.lat, null);
  assert.equal(safe.routes[0].a.lat, null);
  assert.ok(safe.traces[100].some((row) => distanceM(at(row), route.b) < 100), 'the finish at the landmark is still there');
  assert.ok(safe.traces[100].every((row) => distanceM(at(row), route.a) >= 500));
});

test('a run whose route is not in the file loses the first and last 500 m driven', () => {
  const full = exportFile();
  const rows = trimForSharing({ ...full, routes: [] }).traces[100];
  const all = full.traces[100];
  const driven = (list) => list.reduce((sum, row, i) => (i ? sum + distanceM(at(list[i - 1]), at(row)) : 0), 0);
  const head = all.findIndex((row) => row[0] === rows[0][0]);
  const tail = all.findIndex((row) => row[0] === rows.at(-1)[0]);
  assert.ok(driven(all.slice(0, head + 1)) >= 500);
  assert.ok(driven(all.slice(tail)) >= 500);
  assert.ok(rows.length > 50);
});

test('a trimmed file imports as a friend, marked trimmed', () => {
  const safe = trimForSharing(exportFile());
  const plan = planImport({ ...safe, player: { id: 'pfriend', name: 'Mari' } }, { players: [me], activeId: 'pme', routes: [], runs: [] });
  assert.equal(plan.created, true);
  assert.equal(plan.trimmed, true);
  assert.equal(plan.runs[0].trimmed, true);
  assert.equal(plan.routes[0].trimmed, true);
  assert.equal(plan.applySettings, false);
});

test('my own trimmed file never replaces my full routes, runs or settings', () => {
  const full = exportFile();
  const safe = trimForSharing(full);
  const local = { players: [me], activeId: 'pme', routes: [{ ...full.routes[0], playerId: 'pme' }], runs: [{ ...full.runs[0], playerId: 'pme' }] };
  const plan = planImport(safe, local);
  assert.equal(plan.player.id, 'pme');
  assert.deepEqual([plan.routes.length, plan.runs.length, Object.keys(plan.traces).length], [0, 0, 0]);
  assert.equal(plan.skipped, 1);
  assert.equal(plan.applySettings, false);
  // A full file, imported later, does replace a trimmed copy.
  const trimmedLocal = { ...local, routes: [{ ...safe.routes[0], playerId: 'pme' }], runs: [{ ...safe.runs[0], playerId: 'pme' }] };
  assert.equal(planImport(full, trimmedLocal).runs.length, 1);
  assert.equal(planImport(safe, trimmedLocal).runs.length, 1, 'trimmed over trimmed is fine');
});
