// History tab: current bests per time-of-day bucket, then every run.

import { h, fmtDate, fmtClock } from './dom.js';
import { BUCKETS, BUCKET_LABELS } from '../src/buckets.js';
import { bestsByBucket, isClean } from '../src/records.js';
import { formatDuration } from '../src/phrases.js';

export function mountHistory(container, app) {
  let direction = 'ab';

  function tagFor(run, bests) {
    if (run.status !== 'finished') return h('span', { class: 'tag bad' }, 'Did not finish');
    if (run.disqualified) return h('span', { class: 'tag dq' }, 'Disqualified');
    if (run.flags?.gap) return h('span', { class: 'tag dq' }, 'GPS paused');
    if (bests[run.bucket]?.id === run.id) return h('span', { class: 'tag best' }, 'Best');
    return null;
  }

  function draw() {
    const { route, runs, tunables } = app;
    if (!route) {
      return container.replaceChildren(h('div', { class: 'stack' },
        h('h1', { class: 'display' }, 'No runs yet'),
        h('p', {}, 'Runs show up here after you place your markers and drive between them.'),
        h('a', { class: 'plate', href: '#route' }, 'Place markers')));
    }
    const names = direction === 'ab' ? [route.a.name, route.b.name] : [route.b.name, route.a.name];
    const mine = runs.filter((r) => r.routeId === route.id && r.direction === direction);
    const current = mine.filter((r) => r.routeRev === route.rev);
    const bests = bestsByBucket(runs, { routeId: route.id, routeRev: route.rev, direction }, { windowDays: tunables.recordWindowDays });
    const cleanCount = (bucket) => current.filter((r) => r.bucket === bucket && isClean(r)).length;

    container.replaceChildren(h('div', { class: 'stack' },
      h('h1', { class: 'display' }, 'History'),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Direction' },
        ['ab', 'ba'].map((d) => h('button', {
          'aria-pressed': String(direction === d),
          onclick: () => { direction = d; draw(); },
        }, d === 'ab' ? `${route.a.name} → ${route.b.name}` : `${route.b.name} → ${route.a.name}`))),

      h('h2', { class: 'display' }, 'Bests by time of day'),
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Bucket'), h('th', { class: 'num' }, 'Best'), h('th', { class: 'num' }, 'Clean runs'))),
        h('tbody', {}, BUCKETS.map((b) => h('tr', {},
          h('td', {}, BUCKET_LABELS[b]),
          h('td', { class: 'num' }, bests[b] ? h('a', { href: `#run/${bests[b].id}` }, formatDuration(bests[b].durationS)) : '–'),
          h('td', { class: 'num' }, String(cleanCount(b))))))),

      h('h2', { class: 'display' }, `${names[0]} → ${names[1]} runs`),
      mine.length ? h('div', {}, mine.map((run) => h('a', { class: 'run-row', href: `#run/${run.id}` },
        h('span', {}, `${fmtDate(run.startT)} · ${fmtClock(run.startT)} `, tagFor(run, bests),
          run.demo ? h('span', { class: 'tag', style: 'margin-left:6px' }, 'Demo') : null,
          run.routeRev !== route.rev ? h('span', { class: 'tag', style: 'margin-left:6px' }, 'Old markers') : null),
        h('span', { class: 'time' }, formatDuration(run.durationS)),
        h('span', { class: 'muted' }, BUCKET_LABELS[run.bucket] || ''))))
        : h('p', { class: 'muted' }, `No ${names[0]} → ${names[1]} runs yet. Arm before you set off and the run records itself.`),
    ));
  }

  draw();
  return { unmount() {} };
}
