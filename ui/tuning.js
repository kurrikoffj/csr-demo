// Tuning tab: every rule of the game is a number here. Change it, drive, see how it feels.

import { h, fmtDate } from './dom.js';
import { DEFAULTS, withOverrides } from '../src/tunables.js';
import { downloadRoads } from './limits.js';
import { persistent } from './store.js';
import { BUILD } from '../version.js';

// [key, label, unit, help]
const GROUPS = [
  ['Speeding', [
    ['overToleranceKmh', 'Yellow band width', 'km/h', 'From the limit up to limit + this is yellow. Above it is red. GPS speed wobbles a little, which is why the band exists.'],
    ['yellowAfterS', 'Yellow caution after', 's', 'Continuous seconds above the limit before the yellow caution.'],
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
    ['startMinSpeedMs', 'Start needs at least', 'm/s', '2.5 m/s is 9 km/h. Stops GPS wander while parked from starting the clock.'],
    ['finishMinElapsedS', 'Shortest possible run', 's', ''],
    ['finishCountdownM', 'Finish countdown from', 'm', 'The arrow and metre countdown take over inside this distance to the finish line.'],
    ['gapFlagS', 'GPS pause that voids a run', 's', 'Happens when the phone locks or another app comes to the front.'],
    ['gapAbortS', 'GPS pause that stops a run', 's', ''],
    ['recordWindowDays', 'Records last', 'days', ''],
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
    const changed = app.tunables[key] !== DEFAULTS[key];
    return h('label', { class: 'field' },
      h('span', {}, `${label} (${unit})`, changed ? h('span', { class: 'tag', style: 'margin-left:8px' }, `default ${DEFAULTS[key]}`) : null),
      h('input', { type: 'number', step: 'any', min: 0, inputmode: 'decimal', value: app.tunables[key],
        onchange: async (e) => { await setTunable(key, parseFloat(e.target.value)); draw(); } }),
      help ? h('small', {}, help) : null);
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

  async function exportData() {
    const data = await app.store.exportAll();
    const file = new File([JSON.stringify(data)], `csr-demo-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
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
      const count = await app.store.importAll(JSON.parse(await file.text()));
      await app.reload();
      status.textContent = `Imported ${count} runs.`;
      draw();
    } catch (err) {
      status.textContent = `Import failed: ${err.message}`;
    }
  }

  function draw() {
    const s = app.settings;
    const picker = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: importData });
    container.replaceChildren(h('div', { class: 'stack' },
      h('h1', { class: 'display' }, 'Tuning'),
      h('p', { class: 'muted' }, 'These are placeholders to drive with. Changes apply to the next run; old runs keep their results.'),

      h('h2', { class: 'display' }, 'Sound'),
      h('label', { class: 'field wide' }, h('span', {}, 'How cues play'),
        h('select', { onchange: (e) => saveSettings({ audioMode: e.target.value }) },
          h('option', { value: 'mix', selected: s.audioMode !== 'takeover' }, 'Over my music'),
          h('option', { value: 'takeover', selected: s.audioMode === 'takeover' }, 'Always audible')),
        h('small', {}, '“Over my music” follows the iPhone ringer switch: with the ringer off, cues are silent. “Always audible” ignores the switch but may pause other audio. Tap a sound below to check.')),
      h('div', { class: 'pads' }, [['go', 'Start'], ['caution', 'Yellow'], ['warning', 'Red'], ['dq', 'Disqualified'], ['finish', 'Finish'], ['best', 'New best'], ['gap', 'GPS paused']].map(([tone, label]) =>
        h('button', { class: 'plate dark small', onclick: () => { app.cues.unlock(); app.cues.play(tone); } }, label))),

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
      h('div', { class: 'row' },
        h('button', { class: 'plate dark small', disabled: !app.route, onclick: refreshRoads }, 'Update speed limits'),
        h('button', { class: 'plate dark small', onclick: async () => {
          const n = await app.store.deleteDemoRuns();
          app.runs = await app.store.runs();
          status.textContent = `Deleted ${n} demo ${n === 1 ? 'run' : 'runs'}.`;
        } }, 'Delete demo runs')),
      h('button', { class: 'plate red small', onclick: async () => {
        if (!confirm('Delete the route, all runs and all settings from this phone? Export first if you want a backup.')) return;
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
