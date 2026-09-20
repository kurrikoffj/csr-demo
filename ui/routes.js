// Routes tab: every route as a direction sign. Tap one to select it for Drive.

import { h, fmtKm } from './dom.js';
import { distanceM } from '../src/geo.js';
import { isClean } from '../src/records.js';

export const routeLabel = (route) => `${route.a.name} ⇄ ${route.b.name}`;

export function mountRoutes(container, app) {
  const status = h('p', { class: 'muted', role: 'status' });

  async function select(route) {
    status.textContent = `Loading the roads for ${routeLabel(route)}…`;
    await app.useRoute(route.id);
    draw();
  }

  async function remove(route) {
    const runs = app.runs.filter((r) => r.routeId === route.id).length;
    const what = runs ? ` and its ${runs} ${runs === 1 ? 'run' : 'runs'}` : '';
    if (!confirm(`Delete ${routeLabel(route)}${what}? This cannot be undone. Export first if you want a backup.`)) return;
    await app.store.deleteRoute(route.id);
    await app.reload();
    draw();
  }

  function card(route) {
    const selected = app.route?.id === route.id;
    const runs = app.runs.filter((r) => r.routeId === route.id && r.routeRev === route.rev);
    const clean = runs.filter(isClean).length;
    return h('div', { class: 'stack', style: 'gap:6px' },
      h('button', {
        class: `plate route-sign route-pick${selected ? '' : ' dark'}`,
        'aria-pressed': String(selected),
        onclick: () => select(route),
      },
      h('span', { class: 'display' }, route.a.name, h('span', { class: 'arrow' }, '⇄'), route.b.name),
      h('span', { class: 'data' }, fmtKm(distanceM(route.a, route.b)))),
      h('p', { class: 'muted' },
        `${selected ? 'Selected for Drive · ' : ''}${runs.length} ${runs.length === 1 ? 'run' : 'runs'}, ${clean} clean`),
      h('div', { class: 'row' },
        h('a', { class: 'plate dark small', href: `#route/${route.id}` }, 'Edit'),
        h('button', { class: 'plate dark small', onclick: () => remove(route) }, 'Delete')));
  }

  function draw() {
    status.textContent = '';
    container.replaceChildren(h('div', { class: 'stack' },
      h('h1', { class: 'display' }, 'Routes'),
      app.routes.length
        ? h('p', { class: 'muted' }, 'Tap a route to select it. Drive arms the selected route, in the direction you pick there.')
        : h('p', {}, 'A route is two markers, for example home and work. The clock runs between them, in either direction, on any roads you choose.'),
      app.routes.map(card),
      h('a', { class: 'plate gap-top', href: '#route/new' }, app.routes.length ? 'Add a route' : 'Place markers'),
      status,
    ));
  }

  draw();
  return { unmount() {} };
}
