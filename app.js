// App shell: loads what the phone has stored, then shows one view per hash route.

import { withOverrides } from './src/tunables.js';
import { WayIndex, coverage } from './src/osm.js';
import { ownedBy } from './src/profile.js';
import { defaultUnit } from './src/units.js';
import { store } from './ui/store.js';
import { Cues } from './ui/audio.js';
import { mountDrive } from './ui/drive.js';
import { mountSummary } from './ui/summary.js';
import { mountHistory } from './ui/history.js';
import { mountRoutes } from './ui/routes.js';
import { mountRoute } from './ui/route.js';
import { mountTuning } from './ui/tuning.js';
import { mountWelcome } from './ui/welcome.js';
import { mountFeedback } from './ui/feedback.js';

const view = document.getElementById('view');
const tabs = document.getElementById('tabs');

const app = {
  store,
  settings: {},
  tunables: withOverrides(),
  players: [],
  player: null, // who is driving: a name, nothing more. Routes and runs below are this player's only.
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

  // Speed unit on this phone: 'kmh' | 'mph'. Until it is picked in Tuning it follows where the phone seems to be.
  get unit() {
    if (this.settings.speedUnit) return this.settings.speedUnit;
    let timeZone = '';
    try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* unknown */ }
    return defaultUnit({ languages: navigator.languages?.length ? navigator.languages : [navigator.language], timeZone });
  },

  // Presentation mode: draw nothing that says where a place is. Changes what is drawn, never what is stored or judged.
  get presenting() {
    return !!this.settings.presentation;
  },

  async reload() {
    this.settings = await store.getSettings();
    this.tunables = withOverrides(this.settings.tunables);
    this.cues.configure({ mode: this.settings.audioMode || 'mix' });
    this.players = await store.getPlayers();
    this.player = this.players.find((p) => p.id === this.settings.activePlayerId) || this.players[0] || null;
    const mine = this.player?.id;
    this.routes = ownedBy(await store.getRoutes(), mine);
    this.runs = ownedBy(await store.runs(), mine);
    const wantedId = this.settings.activeRouteByPlayer?.[mine] ?? this.settings.activeRouteId;
    await this.useRoute((this.routes.find((r) => r.id === wantedId) || this.routes[0])?.id);
  },

  async usePlayer(id) {
    this.settings = { ...this.settings, activePlayerId: id };
    await store.saveSettings(this.settings);
    this.session = null;
    this.lastResult = null;
    await this.reload();
  },

  // Select a route and load its roads. Building the index takes a moment on a phone.
  async useRoute(id) {
    this.route = this.routes.find((r) => r.id === id) || null;
    this.roads = this.route ? (await store.getRoads(this.route.id)) || null : null;
    this.index = this.roads ? new WayIndex(this.roads.ways) : null;
    if (this.roads) this.roads.coverage = coverage(this.roads.ways, this.tunables); // follows the Tuning values
    const chosen = this.settings.activeRouteByPlayer || {};
    if (this.route && this.player && chosen[this.player.id] !== this.route.id) {
      this.settings = { ...this.settings, activeRouteByPlayer: { ...chosen, [this.player.id]: this.route.id } };
      await store.saveSettings(this.settings);
    }
  },

  routeById(id) {
    return this.routes.find((r) => r.id === id) || null;
  },
};

let mounted = null;

// The strip across the top: a mode that changes what the screen shows must never be forgotten.
function flags() {
  const el = document.getElementById('flags');
  el.textContent = app.presenting ? 'Presentation mode on' : '';
  el.hidden = !app.presenting;
  document.body.classList.toggle('flagged', app.presenting);
}

function show() {
  const hash = location.hash.replace(/^#/, '') || 'drive';
  const [name, arg] = hash.split('/');
  // A drive in progress owns the screen.
  if (app.session?.active && name !== 'drive') return void (location.hash = '#drive');
  mounted?.unmount();
  window.scrollTo(0, 0);
  // Nobody has said who they are yet: that comes first.
  const welcome = !app.player || name === 'player';
  document.body.classList.toggle('welcome', !app.player);
  flags();
  const tab = name === 'run' ? 'history' : name === 'feedback' || name === 'player' ? 'tuning' : name;
  for (const a of tabs.querySelectorAll('a')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (welcome) mounted = mountWelcome(view, app);
  else if (name === 'run') mounted = mountSummary(view, app, arg);
  else if (name === 'route') mounted = arg ? mountRoute(view, app, arg) : mountRoutes(view, app);
  else if (name === 'drive') mounted = mountDrive(view, app);
  else if (name === 'history') mounted = mountHistory(view, app);
  else if (name === 'tuning') mounted = mountTuning(view, app);
  else if (name === 'feedback') mounted = mountFeedback(view, app);
  else location.hash = '#drive';
}

async function main() {
  try {
    await app.reload();
  } catch (err) {
    console.error('Could not read stored data', err);
  }
  app.show = show;
  app.refreshFlags = flags;
  window.addEventListener('hashchange', show);
  show();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

main();
