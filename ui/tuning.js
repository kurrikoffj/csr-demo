// Tuning tab: every rule of the game is a number here. Change it, drive, see how it feels.

import { h, fmtDate } from './dom.js';
import { DEFAULTS, withOverrides } from '../src/tunables.js';
import { cleanName } from '../src/profile.js';
import { hasPlaces } from '../src/privacy.js';
import { fromKmh, toKmh, bandWidth, UNIT_LABEL } from '../src/units.js';
import { downloadRoads } from './limits.js';
import { guideFor, setGuideHidden } from './guide.js';
import { persistent } from './store.js';
import { BUILD } from '../version.js';

// [key, label, unit, help]. A 'km/h' field is shown and edited in mph when that is the phone's unit;
// what is stored is always km/h.
const GROUPS = [
  ['Speeding', [
    ['overToleranceKmh', 'Yellow band width', 'km/h', 'From the limit up to limit + this is yellow. Above it is red. GPS speed wobbles a little, which is why the band exists. Everything is judged on the whole number the screen shows.'],
    ['yellowAfterS', 'Yellow caution after', 's', 'Seconds above the limit before the yellow screen and tone. They add up: a moment at the limit does not restart the count. The speed digits turn yellow at once.'],
    ['yellowDrainRate', 'Yellow count runs down at', '×', 'While at or under the limit. At 0.5, clearing a full count takes twice as long as building it.'],
    ['yellowRepeatS', 'Repeat yellow caution every', 's', ''],
    ['yellowDqRate', 'Yellow counts toward disqualification', '×', '0 means yellow only warns. At 0.25, every 4 s of yellow counts as 1 s of red.'],
    ['warnAfterS', 'Red warning after', 's', 'Seconds in red before the warning sounds.'],
    ['warnRepeatS', 'Repeat red warning every', 's', ''],
    ['dqAfterS', 'Disqualify after', 's', 'Sustained seconds over a signed limit. The concept doc’s placeholder is about 5.'],
    ['dqDrainRate', 'Clock drain rate', '×', 'How fast the disqualification clock runs back down while you are under the limit.'],
  ]],
  ['Speed limit data', [
    ['assumedResidentialKmh', 'Unsigned residential street', 'km/h', 'Assumed limits only warn. They never disqualify.'],
    ['assumedLivingStreetKmh', 'Unsigned living street', 'km/h', ''],
    ['slackBehindM', 'Old limit still counts for', 'm', 'After a sign, the higher of the two limits applies for this distance. Map data is not sign-accurate.'],
    ['slackAheadM', 'New limit counts from', 'm', 'Before a sign, same idea.'],
    ['maxAccuracyM', 'Ignore GPS worse than', 'm', ''],
  ]],
  ['Start, finish and pauses', [
    ['startMinSpeedMs', 'Start needs at least', 'm/s', (unit) => `2.5 m/s is ${unit === 'mph' ? 'about 6 mph' : '9 km/h'}. Stops GPS wander while parked from starting the clock.`],
    ['finishMinElapsedS', 'Shortest possible run', 's', ''],
    ['finishCountdownM', 'Finish countdown from', 'm', 'The arrow and metre countdown take over inside this distance to the finish line.'],
    ['gapFlagS', 'GPS pause that voids a run', 's', 'Happens when the phone locks or another app comes to the front.'],
    ['gapAbortS', 'GPS pause that stops a run', 's', ''],
    ['recordWindowDays', 'Records last', 'days', ''],
  ]],
  ['Sending files', [
    ['shareTrimM', 'Hide this far around a private marker', 'm', 'A file sent with your start and finish hidden leaves out every GPS point this close to a private marker.'],
  ]],
];

const BUCKET_FIELDS = [
  ['amStart', 'Weekday AM rush starts'], ['amEnd', 'Weekday midday starts'], ['middayEnd', 'Weekday PM rush starts'],
  ['pmEnd', 'Weekday evening starts'], ['weekendDayStart', 'Weekend day starts'], ['weekendDayEnd', 'Weekend night starts'],
];

const toClock = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
const fromClock = (text) => { const [hh, mm] = text.split(':').map(Number); return hh * 60 + mm; };

export function mountTuning(container, app) {
  const status = h('p', { class: 'muted', role: 'status' });

  async function saveSettings(patch) {
    app.settings = { ...app.settings, ...patch };
    app.tunables = withOverrides(app.settings.tunables);
    app.cues.configure({ mode: app.settings.audioMode });
    await app.store.saveSettings(app.settings);
  }

  function setTunable(key, value, bucket = false) {
    const overrides = { ...(app.settings.tunables || {}) };
    if (bucket) {
      overrides.buckets = { ...(overrides.buckets || {}), [key]: value };
      if (value === DEFAULTS.buckets[key]) delete overrides.buckets[key];
    } else if (value === DEFAULTS[key] || Number.isNaN(value)) delete overrides[key];
    else overrides[key] = value;
    return saveSettings({ tunables: overrides });
  }

  function numberField([key, label, unit, help]) {
    const inMph = unit === 'km/h' && app.unit === 'mph';
    // The yellow band is counted in whole mph, rounded up; other speeds show one decimal.
    const shown = (kmh) => (!inMph ? kmh : key === 'overToleranceKmh' ? bandWidth(kmh, 'mph') : Math.round(fromKmh(kmh, 'mph') * 10) / 10);
    const stored = (value) => (!inMph ? value : value === shown(DEFAULTS[key]) ? DEFAULTS[key] : Math.round(toKmh(value, 'mph') * 1e4) / 1e4);
    const changed = app.tunables[key] !== DEFAULTS[key];
    const text = typeof help === 'function' ? help(app.unit) : help;
    return h('label', { class: 'field' },
      h('span', {}, `${label} (${inMph ? 'mph' : unit})`, changed ? h('span', { class: 'tag', style: 'margin-left:8px' }, `default ${shown(DEFAULTS[key])}`) : null),
      h('input', { type: 'number', step: 'any', min: 0, inputmode: 'decimal', value: shown(app.tunables[key]),
        onchange: async (e) => { await setTunable(key, stored(parseFloat(e.target.value))); draw(); } }),
      text || (inMph && key === 'overToleranceKmh') ? h('small', {}, text, inMph && key === 'overToleranceKmh' ? ' In mph the band is whole mph, rounded up.' : '') : null);
  }

  async function refreshRoads() {
    if (!app.route) return;
    try {
      const roads = await downloadRoads(app.route, app.tunables, (msg) => { status.textContent = msg; });
      await app.store.saveRoads(app.route.id, roads);
      await app.useRoute(app.route.id);
      status.textContent = `Speed limits updated: ${roads.ways.length.toLocaleString()} roads.`;
    } catch (err) {
      status.textContent = err.message;
    }
  }

  async function renamePlayer(e) {
    const name = cleanName(e.target.value);
    if (!name || app.players.some((p) => p.id !== app.player.id && p.name.toLowerCase() === name.toLowerCase())) {
      e.target.value = app.player.name;
      status.textContent = name ? `${name} is already a player on this phone.` : 'A player needs a name.';
      return;
    }
    await app.store.savePlayers(app.players.map((p) => (p.id === app.player.id ? { ...p, name } : p)));
    await app.reload();
  }

  async function exportData() {
    if (!confirm('This file shows where you live and work: it holds your markers and every GPS point of every run. Keep it as your own backup. Export it?')) return;
    const data = await app.store.exportPlayer(app.player);
    const file = new File([JSON.stringify(data)], `csr-demo-${app.player.name.replace(/\W+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch { /* share sheet closed */ }
      return;
    }
    const url = URL.createObjectURL(file);
    h('a', { href: url, download: file.name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function importData(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const plan = await app.store.importFile(JSON.parse(await file.text()), app.player.id);
      await app.reload();
      draw();
      const n = plan.runs.length;
      status.textContent = (plan.player.id === app.player.id
        ? `Imported ${n} ${n === 1 ? 'run' : 'runs'} into ${plan.player.name}.`
        : `Imported ${n} ${n === 1 ? 'run' : 'runs'} from ${plan.player.name}. Switch player at the top of this page to look through them.`)
        + (plan.trimmed ? ' The file was sent with start and finish hidden: its runs can be looked through but not replayed.' : '')
        + (plan.skipped ? ` ${plan.skipped} already here in full were left alone.` : '');
    } catch (err) {
      status.textContent = `Import failed: ${err.message}`;
    }
  }

  function draw() {
    const s = app.settings;
    const picker = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: importData });
    container.replaceChildren(h('div', { class: 'stack' },
      h('h1', { class: 'display' }, 'Tuning'),

      h('h2', { class: 'display', style: 'margin-top:4px' }, 'Player'),
      app.players.length > 1
        ? h('label', { class: 'field wide' }, h('span', {}, 'Who is driving'),
          h('select', { onchange: async (e) => { await app.usePlayer(e.target.value); draw(); } },
            app.players.map((p) => h('option', { value: p.id, selected: p.id === app.player.id }, p.imported ? `${p.name} (imported)` : p.name))))
        : null,
      h('label', { class: 'field' }, h('span', {}, 'Name'),
        h('input', { type: 'text', maxlength: 24, value: app.player.name, style: 'width:140px;justify-self:end', onchange: renamePlayer })),
      h('div', { class: 'row' },
        h('a', { class: 'plate dark small', href: '#player/new' }, 'Add a player'),
        h('a', { class: 'plate small', href: '#feedback' }, 'Send feedback')),
      h('p', { class: 'muted' }, 'A player is just a name. Each one keeps their own routes, runs and bests on this phone. The rules below are shared.'),
      s.guideHidden?.[app.player.id] && !guideFor(app).steps.every((x) => x.state === 'done')
        ? h('button', { class: 'plate dark small', onclick: async () => { await setGuideHidden(app, false); location.hash = '#drive'; } }, 'Show the getting-started steps again')
        : null,

      h('h2', { class: 'display' }, 'Screen'),
      h('label', { class: 'field wide' }, h('span', {}, 'Speed unit'),
        h('select', { onchange: async (e) => { await saveSettings({ speedUnit: e.target.value }); draw(); } },
          ['kmh', 'mph'].map((u) => h('option', { value: u, selected: app.unit === u }, UNIT_LABEL[u]))),
        h('small', {}, 'Speeds, limits and long distances. Distances to the start and finish, and the marker circles, stay in metres. You are judged on the whole number you see, against the whole number on the limit sign.')),
      h('label', { class: 'field' }, h('span', {}, 'Presentation mode'),
        h('input', { type: 'checkbox', checked: app.presenting, onchange: async (e) => { await saveSettings({ presentation: e.target.checked }); app.refreshFlags(); } }),
        h('small', {}, 'For screenshots and screen recordings. Hides the names of private places, their pins and circles, street names, and the map under your drives, so nothing on screen says where you live or work. It changes only what is drawn. The route editor keeps its map.')),


      h('h2', { class: 'display' }, 'Sound'),
      h('label', { class: 'field wide' }, h('span', {}, 'How cues play'),
        h('select', { onchange: (e) => saveSettings({ audioMode: e.target.value }) },
          h('option', { value: 'mix', selected: s.audioMode !== 'takeover' }, 'Over my music'),
          h('option', { value: 'takeover', selected: s.audioMode === 'takeover' }, 'Always audible')),
        h('small', {}, '“Over my music” follows the iPhone ringer switch: with the ringer off, cues are silent. “Always audible” ignores the switch but may pause other audio. Tap a sound below to check.')),
      h('div', { class: 'pads' }, [['go', 'Start'], ['caution', 'Yellow'], ['warning', 'Red'], ['dq', 'Disqualified'], ['finish', 'Finish'], ['best', 'New best'], ['gap', 'GPS paused']].map(([tone, label]) =>
        h('button', { class: 'plate dark small', onclick: () => { app.cues.unlock(); app.cues.play(tone); } }, label))),

      h('p', { class: 'muted gap-top' }, 'The rules below are placeholders to drive with. Changes apply to the next run; old runs keep their results.'),
      GROUPS.map(([title, fields]) => [h('h2', { class: 'display' }, title), fields.map(numberField)]),

      h('h2', { class: 'display' }, 'Time-of-day buckets'),
      BUCKET_FIELDS.map(([key, label]) => h('label', { class: 'field' }, h('span', {}, label),
        h('input', { type: 'time', value: toClock(app.tunables.buckets[key]), onchange: (e) => setTunable(key, fromClock(e.target.value), true) }))),
      h('button', { class: 'plate dark small gap-top', onclick: async () => { await saveSettings({ tunables: {} }); draw(); } }, 'Reset all rules to defaults'),

      h('h2', { class: 'display' }, 'Data'),
      h('label', { class: 'field' }, h('span', {}, 'Keep demo drives in History'),
        h('input', { type: 'checkbox', checked: !!s.saveDemos, onchange: (e) => saveSettings({ saveDemos: e.target.checked }) }),
        h('small', {}, 'Demo drives then count toward bests. Delete them before real use.')),
      h('div', { class: 'row' },
        h('button', { class: 'plate dark small', onclick: exportData }, 'Export data'),
        h('button', { class: 'plate dark small', onclick: () => picker.click() }, 'Import data')),
      picker,
      h('p', { class: 'notice' }, 'The export file is a full backup. It shows where you live and work: your markers and every GPS point of every run. To send runs to someone else, use Send feedback, which can hide your start and finish.'),
      h('div', { class: 'row' },
        h('button', { class: 'plate dark small', disabled: !hasPlaces(app.route), onclick: refreshRoads }, 'Update speed limits'),
        h('button', { class: 'plate dark small', onclick: async () => {
          const n = await app.store.deleteDemoRuns(app.player.id);
          await app.reload();
          status.textContent = `Deleted ${n} demo ${n === 1 ? 'run' : 'runs'}.`;
        } }, 'Delete demo runs')),
      app.players.length > 1 ? h('button', { class: 'plate dark small', onclick: async () => {
        if (!confirm(`Delete the player ${app.player.name} with their ${app.routes.length} routes and ${app.runs.length} runs? Other players are untouched.`)) return;
        await app.store.deletePlayer(app.player.id);
        await app.usePlayer((app.players.find((p) => p.id !== app.player.id)).id);
        draw();
      } }, `Delete player ${app.player.name}`) : null,
      h('button', { class: 'plate red small', onclick: async () => {
        if (!confirm('Delete every player, route, run and setting from this phone? Export first if you want a backup.')) return;
        await app.store.deleteEverything();
        await app.reload();
        location.hash = '#drive';
      } }, 'Delete everything'),
      status,
      h('p', { class: 'muted' },
        persistent ? 'Runs are stored in this browser only. Export now and then: clearing Safari data deletes them.'
          : 'This browser is not letting the game store anything. Runs will be lost when the page closes.'),
      h('p', { class: 'muted data' }, `Build ${BUILD}${app.roads ? ` · roads from ${fmtDate(app.roads.fetchedAt)}` : ''} · map data © OpenStreetMap contributors`),
    ));
  }

  draw();
  return { unmount() {} };
}
