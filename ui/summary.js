// One run, after the fact: the verdict, the trace on a map, every over-limit moment.

import { h, fmtDist, fmtDate, fmtClock } from './dom.js';
import { summarize } from '../src/records.js';
import { formatDuration, formatDelta, standingText } from '../src/phrases.js';
import { BUCKET_LABELS } from '../src/buckets.js';
import { retime } from '../src/replay.js';
import { isFirstFinish } from '../src/guide.js';
import { isPrivate, placeName } from '../src/privacy.js';
import { shownLimit, fromKmh, UNIT_LABEL } from '../src/units.js';

const COLORS = { ok: '#1f7a4d', yellow: '#e0a100', over: '#c4161c', unknown: '#7b828c' };
const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const ABORTS = {
  gps_gap: 'Stopped: GPS was paused for more than two minutes.',
  stationary: 'Stopped: standing still for too long.',
  manual: 'Cancelled before the finish.',
};

function verdict(run, summary) {
  if (run.status !== 'finished') return ['red', ABORTS[run.abortReason] || 'Did not finish.'];
  if (run.disqualified) return ['yellow', 'Disqualified for speeding · does not count'];
  if (run.flags?.gap) return ['yellow', 'GPS paused during the run · does not count'];
  if (summary.firstInBucket) return ['green', `First clean run for ${BUCKET_LABELS[run.bucket]} · time to beat`];
  if (summary.isBest) return ['green', `New personal best · ${formatDelta(summary.deltaS)}`];
  return ['dark', `${formatDelta(summary.deltaS)} on your ${BUCKET_LABELS[run.bucket]} best`];
}

// tiles: false draws no map under the trace, so nothing on it says where this is (Presentation mode).
// places: which markers get a pin and circle.
function drawTrace(el, { fixes, route, maxAccuracyM, tiles = true, places = () => true }) {
  // Locked until asked: a map that grabs every swipe makes the page impossible to scroll on a phone.
  const map = L.map(el, {
    zoomControl: false, dragging: false, touchZoom: false, scrollWheelZoom: false,
    doubleClickZoom: false, boxZoom: false, keyboard: false, minZoom: 2, maxZoom: 19,
    zoomSnap: tiles ? 1 : 0.1, // map tiles only look sharp at whole zoom levels; a plain line fills the box at any
  });
  if (tiles) L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
  else {
    el.classList.add('plain');
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution('Speed limits © OpenStreetMap contributors'); // the colours still come from its data
  }
  // Consecutive fixes of the same kind become one line.
  const kind = (f) => (f.zone === 'red' || f.over ? 'over' : f.zone === 'yellow' ? 'yellow' : f.limitKmh == null ? 'unknown' : 'ok');
  let line = null;
  let current = null;
  for (const f of fixes) {
    if (f.accuracy != null && f.accuracy > maxAccuracyM) continue;
    const k = kind(f);
    if (k !== current) {
      const last = line?.getLatLngs().at(-1);
      line = L.polyline(last ? [last] : [], { color: COLORS[k], weight: k === 'over' ? 7 : 5, opacity: 0.95 }).addTo(map);
      current = k;
    }
    line.addLatLng([f.lat, f.lon]);
  }
  if (route) {
    for (const [m, cls] of [[route.a, 'a'], [route.b, 'b']]) {
      if (m.lat == null || !places(m)) continue;
      L.circle([m.lat, m.lon], { radius: m.activationM, color: '#0f4c8a', weight: 2, fillOpacity: 0.08 }).addTo(map);
      L.marker([m.lat, m.lon], { icon: L.divIcon({ className: '', html: `<div class="pin ${cls}">${cls.toUpperCase()}</div>`, iconSize: [30, 30] }) }).addTo(map);
    }
  }
  const pts = fixes.map((f) => [f.lat, f.lon]);
  if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.12));
  return map;
}

// The whole summary as an element. view.attach() draws the map once the element is on the page;
// view.remove() lets go of it. notes: paragraphs under the verdict. actions: the buttons at the bottom.
function summaryView({ run, fixes, summary, route, unit, presenting, maxAccuracyM, notes = [], actions = [] }) {
  let map = null;
  const hidePlaces = presenting;
  const [tone, text] = verdict(run, summary);
  const [from, to] = run.direction === 'ba' ? ['b', 'a'] : ['a', 'b'];
  const title = route ? `${placeName(route, from, hidePlaces)} → ${placeName(route, to, hidePlaces)}` : 'Run';
  const avgKmh = run.durationS ? (run.distanceM / run.durationS) * 3.6 : null;
  const mapEl = h('div', { class: 'map short' });
  const episodes = run.episodes || [];
  const speed = (kmh) => Math.round(fromKmh(kmh, unit));

  const el = h('div', { class: 'stack' },
    h('div', { class: 'plate white' },
      h('div', { class: 'hud-top' },
        h('span', { class: 'display', style: 'font-size:26px' }, title),
        h('span', { class: 'data' }, `${fmtDate(run.startT)} ${fmtClock(run.startT)}`)),
      h('p', { class: 'display finish-time' }, formatDuration(run.durationS)),
    ),
    h('p', { class: `plate ${tone} display banner` }, text),
    summary.standing ? h('p', { style: 'text-align:center' }, standingText(summary.standing)) : null,
    notes,

    fixes?.length ? mapEl : null,
    fixes?.length ? h('div', { class: 'legend' },
      h('span', {}, h('i', { style: `background:${COLORS.ok}` }), 'within the limit'),
      h('span', {}, h('i', { style: `background:${COLORS.yellow}` }), 'a little over'),
      h('span', {}, h('i', { style: `background:${COLORS.over}` }), 'over the limit'),
      h('span', {}, h('i', { style: `background:${COLORS.unknown}` }), 'limit unknown'),
      h('button', { class: 'linklike', onclick: (e) => {
        const on = !map.dragging.enabled();
        for (const handler of [map.dragging, map.touchZoom, map.scrollWheelZoom, map.doubleClickZoom]) handler[on ? 'enable' : 'disable']();
        e.target.textContent = on ? 'Lock map' : 'Move and zoom the map';
      } }, 'Move and zoom the map')) : null,

    h('h2', { class: 'display' }, episodes.length ? 'In the red' : 'Never in the red'),
    episodes.length ? h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Road'), h('th', { class: 'num' }, 'Limit'), h('th', { class: 'num' }, 'You'), h('th', { class: 'num' }, 'For'))),
      h('tbody', {}, episodes.map((e) => h('tr', {},
        h('td', {}, hidePlaces ? 'Hidden' : e.wayName || 'Unnamed road', e.disqualifying ? h('span', { class: 'tag dq', style: 'margin-left:8px' }, 'DQ') : null,
          e.tier === 'assumed' ? h('span', { class: 'tag', style: 'margin-left:8px' }, 'assumed') : null),
        h('td', { class: 'num' }, shownLimit({ kmh: e.limitKmh, mph: e.limitMph ?? undefined }, unit)),
        h('td', { class: 'num' }, speed(e.maxSpeedKmh)),
        h('td', { class: 'num' }, `${Math.max(1, Math.round((e.tEnd - e.tStart) / 1000))} s`))))) : null,
    episodes.length ? h('p', { class: 'muted', style: 'font-size:13px' }, `Speeds in ${UNIT_LABEL[unit]}, as whole numbers, the way the screen shows them.`) : null,

    h('h2', { class: 'display' }, 'Details'),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Bucket'), h('dd', {}, BUCKET_LABELS[run.bucket] || '–'),
      h('dt', {}, 'Distance driven'), h('dd', {}, fmtDist(run.distanceM, unit)),
      h('dt', {}, 'Average speed'), h('dd', {}, avgKmh ? `${fromKmh(avgKmh, unit).toFixed(1)} ${UNIT_LABEL[unit]}` : '–'),
      h('dt', {}, 'A little over the limit (yellow)'), h('dd', {}, formatDuration(run.yellowS ?? 0)),
      h('dt', {}, 'Clearly over the limit (red)'), h('dd', {}, formatDuration(run.redS ?? 0)),
      h('dt', {}, 'Yellow cautions · red warnings'), h('dd', {}, `${run.cautions ?? 0} · ${run.warnings ?? 0}`),
      h('dt', {}, 'Speed limit known'), h('dd', {}, `${Math.round((run.knownLimitFrac || 0) * 100)}% of the drive`),
      h('dt', {}, 'GPS pauses'), h('dd', {}, String(run.gaps?.length || 0)),
      run.flags?.impreciseStart ? [h('dt', {}, 'Start line'), h('dd', {}, 'estimated (GPS gap)')] : null,
    ),
    actions,
  );

  return {
    el,
    attach() {
      if (!fixes?.length) return;
      map = drawTrace(mapEl, {
        fixes, route, maxAccuracyM,
        tiles: !hidePlaces,
        places: (m) => !hidePlaces || !isPrivate(m),
      });
      setTimeout(() => map?.invalidateSize(), 50);
    },
    remove() {
      map?.remove();
      map = null;
    },
  };
}

export function mountSummary(container, app, runId) {
  let view = null;
  let cancelled = false;

  async function load() {
    let run = app.runs.find((r) => r.id === runId);
    let fixes = run ? await app.store.trace(runId) : null;
    if (!run && app.lastResult?.result.id === runId) ({ result: run, fixes } = app.lastResult);
    if (cancelled) return;
    if (!run) {
      container.replaceChildren(h('div', { class: 'stack' },
        h('h1', { class: 'display' }, 'Run not found'),
        h('a', { class: 'plate', href: '#history' }, 'Open history')));
      return;
    }
    const saved = app.runs.some((r) => r.id === run.id);
    const summary = summarize(run, saved ? app.runs : [...app.runs, run], {
      now: run.startT, windowDays: app.tunables.recordWindowDays,
    });
    const route = app.routeById(run.routeId);
    // A run from a file sent with its start and finish hidden has no start or finish line in its trace.
    const canReplay = fixes?.length && route && !run.trimmed;

    view = summaryView({
      run, fixes, summary, route,
      unit: app.unit, presenting: app.presenting, maxAccuracyM: app.tunables.maxAccuracyM,
      notes: [
        // The last of the getting-started steps: say what the first finish means.
        isFirstFinish(run, app.runs) ? h('p', { class: 'notice' }, run.clean !== false && !run.disqualified && !run.flags?.gap
          ? 'Your first finished drive. This is now your time to beat for this direction and time of day. Drive it again and this page shows the gap.'
          : 'Your first finished drive. It does not count, so there is no time to beat yet: your next clean run sets it.') : null,
        !saved ? h('p', { class: 'notice' }, 'Demo drive. Not saved to history.') : run.demo ? h('p', { class: 'notice' }, 'Demo drive, saved because “Keep demo drives” is on in Tuning.') : null,
        run.trimmed ? h('p', { class: 'notice' }, 'This run was sent with its start and finish hidden. The time and the verdict are the driver’s own; the first and last stretch of the drive are missing, so it cannot be replayed through the rules.') : null,
      ],
      actions: [
        h('div', { class: 'row gap-top' },
          canReplay ? h('button', { class: 'plate dark small', onclick: () => replay(run, fixes) }, 'Replay this drive 8×') : null,
          saved ? h('button', { class: 'plate dark small', onclick: () => remove(run) }, 'Delete run') : null),
        h('a', { class: 'plate', href: '#drive' }, 'Back to Drive'),
      ],
    });
    container.replaceChildren(view.el);
    view.attach();
  }

  // What-if: the same drive through today's rules and road data. Never saved.
  function replay(run, fixes) {
    app.pendingReplay = { fixes: retime(fixes, Date.now()), routeId: run.routeId, direction: run.direction };
    location.hash = '#drive';
  }

  async function remove(run) {
    if (!confirm('Delete this run? This cannot be undone.')) return;
    await app.store.deleteRun(run.id);
    app.runs = await app.store.runs();
    location.hash = '#history';
  }

  load();
  return {
    unmount() {
      cancelled = true;
      view?.remove();
    },
  };
}
