// App shell: loads what the phone has stored, then shows one view per hash route.

import { withOverrides } from './src/tunables.js';
import { WayIndex, coverage } from './src/osm.js';
import { store } from './ui/store.js';
import { Cues } from './ui/audio.js';
import { mountDrive } from './ui/drive.js';
import { mountSummary } from './ui/summary.js';
import { mountHistory } from './ui/history.js';
import { mountRoutes } from './ui/routes.js';
import { mountRoute } from './ui/route.js';
import { mountTuning } from './ui/tuning.js';

const view = document.getElementById('view');
const tabs = document.getElementById('tabs');

const app = {
  store,
  settings: {},
  tunables: withOverrides(),
  routes: [],
  route: null, // the selected route: the one Drive arms
  roads: null, // { ways, bbox, fetchedAt, coverage } for the selected route
  index: null, // WayIndex over roads.ways
  runs: [],
  cues: new Cues(),
  session: null,
  lastResult: null,
  pendingReplay: null,
  direction: {}, // route id → direction picked on the Drive screen

  async reload() {
    this.settings = await store.getSettings();
    this.tunables = withOverrides(this.settings.tunables);
    this.cues.configure({ mode: this.settings.audioMode || 'mix' });
    this.routes = await store.getRoutes();
    this.runs = await store.runs();
    const wanted = this.routes.find((r) => r.id === this.settings.activeRouteId) || this.routes[0] || null;
    await this.useRoute(wanted?.id);
  },

  // Select a route and load its roads. Building the index takes a moment on a phone.
  async useRoute(id) {
    this.route = this.routes.find((r) => r.id === id) || null;
    this.roads = this.route ? (await store.getRoads(this.route.id)) || null : null;
    this.index = this.roads ? new WayIndex(this.roads.ways) : null;
    if (this.roads) this.roads.coverage = coverage(this.roads.ways, this.tunables); // follows the Tuning values
    if (this.route && this.settings.activeRouteId !== this.route.id) {
      this.settings = { ...this.settings, activeRouteId: this.route.id };
      await store.saveSettings(this.settings);
    }
  },

  routeById(id) {
    return this.routes.find((r) => r.id === id) || null;
  },
};

let mounted = null;

function show() {
  const hash = location.hash.replace(/^#/, '') || 'drive';
  const [name, arg] = hash.split('/');
  // A drive in progress owns the screen.
  if (app.session?.active && name !== 'drive') return void (location.hash = '#drive');
  mounted?.unmount();
  window.scrollTo(0, 0);
  const tab = name === 'run' ? 'history' : name;
  for (const a of tabs.querySelectorAll('a')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (name === 'run') mounted = mountSummary(view, app, arg);
  else if (name === 'route') mounted = arg ? mountRoute(view, app, arg) : mountRoutes(view, app);
  else if (name === 'drive') mounted = mountDrive(view, app);
  else if (name === 'history') mounted = mountHistory(view, app);
  else if (name === 'tuning') mounted = mountTuning(view, app);
  else location.hash = '#drive';
}

async function main() {
  try {
    await app.reload();
  } catch (err) {
    console.error('Could not read stored data', err);
  }
  window.addEventListener('hashchange', show);
  show();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

main();
