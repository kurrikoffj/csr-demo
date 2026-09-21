// The repo is public. This fails if a real-looking place, or a private folder, is about to be committed.
// It asks git, so a new file is checked before it is even added, and an ignored one is left alone.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

// others: also files git does not track yet but would add (not ignored).
function gitFiles({ others = false } = {}) {
  try {
    const args = ['ls-files', '-z', ...(others ? ['--cached', '--others', '--exclude-standard'] : [])];
    return [...new Set(execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))];
  } catch {
    return null; // not a git checkout (a zip download): nothing to guard
  }
}

// Two decimal numbers with four or more decimals (11 m or finer) close together, in latitude and
// longitude range: "59.43701, 24.75352" or "lat": 59.43701, "lon": 24.75352.
const NUM = String.raw`(?<![\d.])-?\d{1,3}\.\d{4,}(?![\d])`;
const PAIR = new RegExp(`(${NUM})[^\\d\\n-]{1,24}(${NUM})`, 'g');
const PRIVATE_PATH = /^(notes|traces|marketing)\/|(^|\/)csr-demo-[^/]*\.json$/;
const BINARY = /\.(png|jpg|jpeg|gif|ico|woff2?)$/i;
// Third-party code, full of projection constants.
const SKIP = /^vendor\//;

export function coordinatePairs(text) {
  const out = [];
  for (const m of text.matchAll(PAIR)) {
    const [a, b] = [parseFloat(m[1]), parseFloat(m[2])];
    if (Math.abs(a) <= 90 && Math.abs(b) <= 180) out.push(m[0]);
  }
  return out;
}

test('the guard recognises coordinates, and leaves ordinary numbers alone', () => {
  assert.equal(coordinatePairs('L.marker([59.43701, 24.75352])').length, 1);
  assert.equal(coordinatePairs('{"lat": 59.437011, "lon": 24.753521}').length, 1);
  assert.equal(coordinatePairs('[1700000000000,-33.86882,151.20929,12.5]').length, 1);
  assert.equal(coordinatePairs('const ORIGIN = { lat: 40, lon: -30 };').length, 0);
  assert.equal(coordinatePairs('south: 59.4, west: 24.7').length, 0, 'city-level numbers say nothing about a home');
  assert.equal(coordinatePairs('KMH_PER_MPH = 1.609344; M_PER_MILE = 1609.344').length, 0);
  assert.equal(coordinatePairs('[-20037508.34279, -15496570.73972]').length, 0);
});

test('no file git tracks, or would add, holds a pair of precise coordinates', (t) => {
  const files = gitFiles({ others: true });
  if (!files) return t.skip('not a git checkout');
  for (const file of files) {
    if (BINARY.test(file) || SKIP.test(file) || file === 'test/repo.test.js' || !existsSync(root + file)) continue;
    const found = coordinatePairs(readFileSync(root + file, 'utf8'));
    assert.deepEqual(found, [], `${file} looks like it holds a real place. Fixtures use the made-up town in test/helpers.js.`);
  }
});

test('nothing private is tracked: notes, traces, marketing, export files', (t) => {
  const files = gitFiles();
  if (!files) return t.skip('not a git checkout');
  assert.deepEqual(files.filter((f) => PRIVATE_PATH.test(f)), []);
  const ignore = readFileSync(root + '.gitignore', 'utf8');
  for (const line of ['notes/', 'traces/', 'marketing/', 'csr-demo-*.json']) assert.ok(ignore.split('\n').includes(line), `${line} missing from .gitignore`);
});
