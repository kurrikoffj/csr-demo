// Everything the player owns lives in this browser: settings, route, road data, runs, traces.
// IndexedDB, with an in-memory fallback so the game still runs where storage is blocked.

import { packTrace, unpackTrace } from '../src/replay.js';

const DB_NAME = 'csr-demo';
const STORES = ['kv', 'runs', 'traces'];

let dbPromise = null;
const memory = { kv: new Map(), runs: new Map(), traces: new Map() };
export let persistent = true;

function open() {
  dbPromise ??= new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      for (const name of STORES) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  }).then((db) => {
    persistent = !!db;
    return db;
  });
  return dbPromise;
}

async function op(storeName, mode, fn) {
  const db = await open();
  if (!db) return fn(null, memory[storeName]);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const get = (s, key) => op(s, 'readonly', (os, mem) => (os ? os.get(key) : mem.get(key)));
const put = (s, key, value) => op(s, 'readwrite', (os, mem) => (os ? os.put(value, key) : void mem.set(key, value)));
const del = (s, key) => op(s, 'readwrite', (os, mem) => (os ? os.delete(key) : void mem.delete(key)));
const all = (s) => op(s, 'readonly', (os, mem) => (os ? os.getAll() : [...mem.values()]));
const wipe = (s) => op(s, 'readwrite', (os, mem) => (os ? os.clear() : void mem.clear()));

export const store = {
  getSettings: async () => (await get('kv', 'settings')) || {},
  saveSettings: (settings) => put('kv', 'settings', settings),
  getRoute: () => get('kv', 'route'),
  saveRoute: (route) => put('kv', 'route', route),
  getRoads: () => get('kv', 'roads'),
  saveRoads: (roads) => put('kv', 'roads', roads),

  async runs() {
    return ((await all('runs')) || []).sort((a, b) => b.startT - a.startT);
  },
  async saveRun(run, fixes) {
    await put('runs', run.id, run);
    await put('traces', run.id, packTrace(fixes));
  },
  async deleteRun(id) {
    await del('runs', id);
    await del('traces', id);
  },
  async trace(id) {
    const rows = await get('traces', id);
    return rows ? unpackTrace(rows) : null;
  },

  // Backup file. Road data is left out: it is big and can be downloaded again.
  async exportAll() {
    const runs = await this.runs();
    const traces = {};
    for (const run of runs) traces[run.id] = await get('traces', run.id);
    return {
      app: 'csr-demo', format: 1, exportedAt: new Date().toISOString(),
      settings: await this.getSettings(), route: (await this.getRoute()) || null, runs, traces,
    };
  },
  async importAll(data) {
    if (data?.app !== 'csr-demo' || !Array.isArray(data.runs)) throw new Error('Not a CSR Demo export file');
    if (data.settings) await this.saveSettings(data.settings);
    if (data.route) await this.saveRoute(data.route);
    for (const run of data.runs) {
      await put('runs', run.id, run);
      if (data.traces?.[run.id]) await put('traces', run.id, data.traces[run.id]);
    }
    return data.runs.length;
  },
  async deleteDemoRuns() {
    const demo = (await this.runs()).filter((r) => r.demo);
    for (const run of demo) await this.deleteRun(run.id);
    return demo.length;
  },
  async deleteEverything() {
    for (const s of STORES) await wipe(s);
  },
};
