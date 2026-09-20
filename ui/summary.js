// One run, after the fact: the verdict, the trace on a map, every over-limit moment.

import { h, fmtKm, fmtDate, fmtClock } from './dom.js';
import { summarize } from '../src/records.js';
import { formatDuration, formatDelta, standingText } from '../src/phrases.js';
import { BUCKET_LABELS } from '../src/buckets.js';
import { retime } from '../src/replay.js';

const COLORS = { ok: '#1f7a4d', yellow: '#e0a100', over: '#c4161c', unknown: '#7b828c' };

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

function drawTrace(el, app, route, fixes) {
  // Locked until asked: a map that grabs every swipe makes the page impossible to scroll on a phone.
  const map = L.map(el, {
    zoomControl: false, dragging: false, touchZoom: false, scrollWheelZoom: false,
    doubleClickZoom: false, boxZoom: false, keyboard: false,
  });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap contributors',
  }).addTo(map);
  // Consecutive fixes of the same kind become one line.
  const kind = (f) => (f.zone === 'red' || f.over ? 'over' : f.zone === 'yellow' ? 'yellow' : f.limitKmh == null ? 'unknown' : 'ok');
  let line = null;
  let current = null;
  for (const f of fixes) {
    if (f.accuracy != null && f.accuracy > app.tunables.maxAccuracyM) continue;
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
      L.circle([m.lat, m.lon], { radius: m.activationM, color: '#0f4c8a', weight: 2, fillOpacity: 0.08 }).addTo(map);
      L.marker([m.lat, m.lon], { icon: L.divIcon({ className: '', html: `<div class="pin ${cls}">${cls.toUpperCase()}</div>`, iconSize: [30, 30] }) }).addTo(map);
    }
  }
  const pts = fixes.map((f) => [f.lat, f.lon]);
  if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.12));
  return map;
}

export function mountSummary(container, app, runId) {
  let map = null;
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
    const summary = summarize(run, app.runs.some((r) => r.id === run.id) ? app.runs : [...app.runs, run], {
      now: run.startT, windowDays: app.tunables.recordWindowDays,
    });
    const [tone, text] = verdict(run, summary);
    const route = app.routeById(run.routeId);
    const from = run.direction === 'ba' ? route?.b.name : route?.a.name;
    const to = run.direction === 'ba' ? route?.a.name : route?.b.name;
    const avg = run.durationS ? (run.distanceM / run.durationS) * 3.6 : null;
    const mapEl = h('div', { class: 'map short' });

    const episodes = run.episodes || [];
    container.replaceChildren(h('div', { class: 'stack' },
      h('div', { class: 'plate white' },
        h('div', { class: 'hud-top' },
          h('span', { class: 'display', style: 'font-size:26px' }, from && to ? `${from} → ${to}` : 'Run'),
          h('span', { class: 'data' }, `${fmtDate(run.startT)} ${fmtClock(run.startT)}`)),
        h('p', { class: 'display finish-time' }, formatDuration(run.durationS)),
      ),
      h('p', { class: `plate ${tone} display banner` }, text),
      summary.standing ? h('p', { style: 'text-align:center' }, standingText(summary.standing)) : null,
      !saved ? h('p', { class: 'notice' }, 'Demo drive. Not saved to history.') : run.demo ? h('p', { class: 'notice' }, 'Demo drive, saved because “Keep demo drives” is on in Tuning.') : null,

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
          h('td', {}, e.wayName || 'Unnamed road', e.disqualifying ? h('span', { class: 'tag dq', style: 'margin-left:8px' }, 'DQ') : null,
            e.tier === 'assumed' ? h('span', { class: 'tag', style: 'margin-left:8px' }, 'assumed') : null),
          h('td', { class: 'num' }, Math.round(e.limitKmh)),
          h('td', { class: 'num' }, Math.round(e.maxSpeedKmh)),
          h('td', { class: 'num' }, `${Math.max(1, Math.round((e.tEnd - e.tStart) / 1000))} s`))))) : null,

      h('h2', { class: 'display' }, 'Details'),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Bucket'), h('dd', {}, BUCKET_LABELS[run.bucket] || '–'),
        h('dt', {}, 'Distance driven'), h('dd', {}, fmtKm(run.distanceM)),
        h('dt', {}, 'Average speed'), h('dd', {}, avg ? `${avg.toFixed(1)} km/h` : '–'),
        h('dt', {}, 'A little over the limit (yellow)'), h('dd', {}, formatDuration(run.yellowS ?? 0)),
        h('dt', {}, 'Clearly over the limit (red)'), h('dd', {}, formatDuration(run.redS ?? 0)),
        h('dt', {}, 'Yellow cautions · red warnings'), h('dd', {}, `${run.cautions ?? 0} · ${run.warnings ?? 0}`),
        h('dt', {}, 'Speed limit known'), h('dd', {}, `${Math.round((run.knownLimitFrac || 0) * 100)}% of the drive`),
        h('dt', {}, 'GPS pauses'), h('dd', {}, String(run.gaps?.length || 0)),
        run.flags?.impreciseStart ? [h('dt', {}, 'Start line'), h('dd', {}, 'estimated (GPS gap)')] : null,
      ),

      h('div', { class: 'row gap-top' },
        fixes?.length && route ? h('button', { class: 'plate dark small', onclick: () => replay(run, fixes) }, 'Replay this drive 8×') : null,
        saved ? h('button', { class: 'plate dark small', onclick: () => remove(run) }, 'Delete run') : null),
      h('a', { class: 'plate', href: '#drive' }, 'Back to Drive'),
    ));

    if (fixes?.length) {
      map = drawTrace(mapEl, app, route, fixes);
      setTimeout(() => map?.invalidateSize(), 50);
    }
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
      map?.remove();
    },
  };
}
