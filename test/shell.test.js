import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sw = readFileSync(new URL('sw.js', root), 'utf8');

test('service worker precaches every module, so the game opens offline', () => {
  for (const dir of ['src', 'ui']) {
    for (const file of readdirSync(new URL(`${dir}/`, root))) {
      if (file.endsWith('.js')) assert.ok(sw.includes(`'./${dir}/${file}'`), `${dir}/${file} missing from sw.js`);
    }
  }
});

test('everything the service worker precaches exists', () => {
  for (const [, path] of sw.matchAll(/'\.\/([^']+)'/g)) {
    assert.ok(existsSync(new URL(path, root)), `${path} is listed in sw.js but does not exist`);
  }
});

test('engine modules stay free of browser APIs', () => {
  for (const file of readdirSync(new URL('src/', root))) {
    const code = readFileSync(new URL(`src/${file}`, root), 'utf8').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /\b(document|window|navigator)\.\w|\b(localStorage|indexedDB)\b/, `src/${file} touches the browser`);
  }
});
