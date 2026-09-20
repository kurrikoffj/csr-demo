// Everything the player owns lives in this browser: settings, route, road data, runs, traces.
// IndexedDB, with an in-memory fallback so the game still runs where storage is blocked.

import { packTrace, unpackTrace } from '../src/replay.js';
import { planImport } from '../src/profile.js';

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

const newId = () => `r${Date.now().toString(36)}`;

export const store = {
  getSettings: async () => (await get('kv', 'settings')) || {},
  saveSettings: (settings) => put('kv', 'settings', settings),

  // Players: [{ id, name, createdAt, imported? }]. Routes and runs carry their owner's playerId.
  getPlayers: async () => (await get('kv', 'players')) || [],
  savePlayers: (players) => put('kv', 'players', players),

  // Routes of every player: [{ id, rev, playerId, a, b }]. Road data is kept per route because it is big.
  async getRoutes() {
    const routes = await get('kv', 'routes');
    if (routes) return routes;
    // First builds stored a single route under 'route' with its roads under 'roads'.
    const legacy = await get('kv', 'route');
    if (!legacy) return [];
    const roads = await get('kv', 'roads');
    if (roads) await put('kv', `roads:${legacy.id}`, roads);
    await put('kv', 'routes', [legacy]);
    await del('kv', 'route');
    await del('kv', 'roads');
    return [legacy];
  },
  saveRoutes: (routes) => put('kv', 'routes', routes),
  async saveRoute(route) {
    const routes = await this.getRoutes();
    const at = routes.findIndex((r) => r.id === route.id);
    if (at >= 0) routes[at] = route;
    else routes.push(route);
    await this.saveRoutes(routes);
  },
  newRouteId: newId,
  getRoads: (routeId) => get('kv', `roads:${routeId}`),
  saveRoads: (routeId, roads) => put('kv', `roads:${routeId}`, roads),
  async deleteRoute(routeId) {
    await this.saveRoutes((await this.getRoutes()).filter((r) => r.id !== routeId));
    await del('kv', `roads:${routeId}`);
    for (const run of (await this.runs()).filter((r) => r.routeId === routeId)) await this.deleteRun(run.id);
  },

  // Runs of every player, newest first.
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

  // Routes and runs made before players existed belong to the first player on this phone.
  async adoptOrphans(playerId) {
    const routes = await this.getRoutes();
    if (routes.some((r) => !r.playerId)) await this.saveRoutes(routes.map((r) => (r.playerId ? r : { ...r, playerId })));
    for (const run of await this.runs()) if (!run.playerId) await put('runs', run.id, { ...run, playerId });
  },

  // One player's backup file. Road data is left out: it is big and can be downloaded again.
  async exportPlayer(player, extra = {}) {
    const runs = (await this.runs()).filter((r) => r.playerId === player.id);
    const traces = {};
    for (const run of runs) traces[run.id] = await get('traces', run.id);
    return {
      app: 'csr-demo', format: 3, exportedAt: new Date().toISOString(),
      player: { id: player.id, name: player.name, createdAt: player.createdAt },
      settings: await this.getSettings(),
      routes: (await this.getRoutes()).filter((r) => r.playerId === player.id),
      runs, traces, ...extra,
    };
  },
  // Your own backup comes back to you; someone else's file becomes a separate player to look through.
  async importFile(data, activeId) {
    const plan = planImport(data, {
      players: await this.getPlayers(), activeId, routes: await this.getRoutes(), runs: await this.runs(),
    });
    if (plan.created) await this.savePlayers([...(await this.getPlayers()), plan.player]);
    if (plan.applySettings) {
      const mine = await this.getSettings(); // which player and route are open stays a matter of this phone
      await this.saveSettings({ ...plan.settings, activePlayerId: mine.activePlayerId, activeRouteByPlayer: mine.activeRouteByPlayer });
    }
    for (const route of plan.routes) await this.saveRoute(route);
    for (const run of plan.runs) {
      await put('runs', run.id, run);
      if (plan.traces[run.id]) await put('traces', run.id, plan.traces[run.id]);
    }
    return plan;
  },
  async deleteDemoRuns(playerId) {
    const demo = (await this.runs()).filter((r) => r.demo && r.playerId === playerId);
    for (const run of demo) await this.deleteRun(run.id);
    return demo.length;
  },
  async deletePlayer(playerId) {
    for (const route of (await this.getRoutes()).filter((r) => r.playerId === playerId)) await this.deleteRoute(route.id);
    for (const run of (await this.runs()).filter((r) => r.playerId === playerId)) await this.deleteRun(run.id);
    await this.savePlayers((await this.getPlayers()).filter((p) => p.id !== playerId));
  },
  async deleteEverything() {
    for (const s of STORES) await wipe(s);
  },
};
