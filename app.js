// App shell: loads what the phone has stored, then shows one view per hash route.

import { withOverrides } from './src/tunables.js';
import { WayIndex, coverage } from './src/osm.js';
import { store } from './ui/store.js';
import { Cues } from './ui/audio.js';
import { mountDrive } from './ui/drive.js';
import { mountSummary } from './ui/summary.js';
import { mountHistory } from './ui/history.js';
import { mountRoute } from './ui/route.js';
import { mountTuning } from './ui/tuning.js';

const view = document.getElementById('view');
const tabs = document.getElementById('tabs');

const app = {
  store,
  settings: {},
  tunables: withOverrides(),
  route: null,
  roads: null, // { ways, bbox, fetchedAt, coverage }
  index: null, // WayIndex over roads.ways
  runs: [],
  cues: new Cues(),
  session: null,
  lastResult: null,
  pendingReplay: null,
  async reload() {
    this.settings = await store.getSettings();
    this.tunables = withOverrides(this.settings.tunables);
    this.cues.configure({ mode: this.settings.audioMode || 'mix' });
    this.route = (await store.getRoute()) || null;
    this.roads = (await store.getRoads()) || null;
    this.index = this.roads ? new WayIndex(this.roads.ways) : null;
    if (this.roads) this.roads.coverage = coverage(this.roads.ways, this.tunables); // follows the Tuning values
    this.runs = await store.runs();
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
  const mount = { drive: mountDrive, history: mountHistory, route: mountRoute, tuning: mountTuning }[name];
  if (name === 'run') mounted = mountSummary(view, app, arg);
  else if (mount) mounted = mount(view, app);
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
