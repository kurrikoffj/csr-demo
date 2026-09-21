// Route editor: place the two markers, set the circle sizes, download speed limits for the area.
// arg is a route id, or 'new'.

import { h, fmtDist } from './dom.js';
import { distanceM } from '../src/geo.js';
import { isPrivate, hasPlaces } from '../src/privacy.js';
import { downloadRoads } from './limits.js';
import { guideFor } from './guide.js';

const EUROPE = { center: [54, 15], zoom: 4 };

export function mountRoute(container, app, arg) {
  const tun = app.tunables;
  let saved = arg === 'new' ? null : app.routeById(arg);
  if (arg !== 'new' && !saved) {
    location.hash = '#route';
    return { unmount() {} };
  }
  const first = app.routes.find(hasPlaces);
  // Working copy; nothing changes until Save. A new marker is a private place until it is unticked.
  const draft = {
    a: saved ? { ...saved.a, private: isPrivate(saved.a) } : { name: first ? first.a.name : 'Home', lat: null, lon: null, private: true },
    b: saved ? { ...saved.b, private: isPrivate(saved.b) } : { name: first ? 'Finish' : 'Work', lat: null, lon: null, private: true },
    activationM: saved?.a.activationM ?? tun.activationRadiusM,
    finalizationM: saved?.a.finalizationM ?? tun.finalizationRadiusM,
  };
  // A route from a file with its ends hidden has markers to place, like a new one.
  let placing = draft.a.lat == null ? 'a' : draft.b.lat == null ? 'b' : null;
  let busy = false;
  const layers = { a: null, b: null };

  // Markers of other routes, so Home is the same spot in every route that starts there.
  const known = [];
  for (const route of app.routes) {
    if (route.id === saved?.id) continue;
    for (const m of [route.a, route.b]) {
      if (m.lat != null && !known.some((k) => distanceM(k, m) < 1)) known.push(m);
    }
  }

  const mapEl = h('div', { class: 'map' });
  const hint = h('p', { class: 'notice', style: 'min-height:5.4em' });
  const status = h('p', { class: 'muted', role: 'status' });
  const saveBtn = h('button', { class: 'plate', onclick: save }, 'Save route');
  const names = {};
  const nameInput = (key) => (names[key] = h('input', {
    type: 'text', value: draft[key].name, maxlength: 14,
    oninput: (e) => { draft[key].name = e.target.value.trim() || key.toUpperCase(); },
  }));
  const placeBtn = (key) => h('button', { class: 'plate dark small', onclick: () => { placing = key; update(); } }, `Move ${key.toUpperCase()}`);
  const privateBox = (key) => h('label', { class: 'field' },
    h('span', {}, `${key.toUpperCase()} is a private place`),
    h('input', { type: 'checkbox', checked: draft[key].private, onchange: (e) => { draft[key].private = e.target.checked; } }));
  const slider = (field, label, help) => {
    const out = h('span', { class: 'data' }, `${draft[field]} m`);
    return h('label', { class: 'field wide' },
      h('span', { class: 'hud-top' }, h('span', {}, label), out),
      h('input', { type: 'range', min: tun.minRadiusM, max: 200, step: 5, value: draft[field], oninput: (e) => { draft[field] = Number(e.target.value); out.textContent = `${draft[field]} m`; drawMarkers(); } }),
      h('small', {}, help));
  };

  const guide = guideFor(app);
  container.replaceChildren(h('div', { class: 'stack' },
    guide.show && guide.now === 'markers' ? h('p', { class: 'eyebrow' }, `Getting started · step ${guide.stepNo} of ${guide.total} · place your two markers`) : null,
    h('div', { class: 'hud-top' },
      h('h1', { class: 'display' }, saved ? 'Edit route' : 'New route'),
      app.routes.length ? h('a', { href: '#route' }, 'All routes') : null),
    hint,
    mapEl,
    h('div', { class: 'row' },
      h('button', { class: 'plate dark small', onclick: locate }, 'Show where I am'),
      placeBtn('a'), placeBtn('b')),
    known.length ? h('div', { class: 'stack', style: 'gap:6px' },
      h('p', { class: 'muted' }, 'Or reuse a marker from another route, so it is exactly the same spot:'),
      h('div', { class: 'pads' }, known.map((m) => h('button', { class: 'plate dark small', onclick: () => reuse(m) }, m.name)))) : null,
    h('label', { class: 'field' }, h('span', {}, 'Name of marker A'), nameInput('a')),
    privateBox('a'),
    h('label', { class: 'field' }, h('span', {}, 'Name of marker B'), nameInput('b')),
    privateBox('b'),
    h('p', { class: 'muted' }, 'A private place, like home or work, is hidden in Presentation mode and left out of files you send with your start and finish hidden. Untick it for a public landmark.'),
    slider('activationM', 'Start circle', 'The clock starts when you drive out of this circle. Make it big enough to cover where you park.'),
    slider('finalizationM', 'Finish circle', 'The clock stops when you drive into this circle.'),
    saved ? h('p', { class: 'muted' }, 'Moving a marker or resizing a circle starts fresh records; earlier runs stay in History.') : null,
    saveBtn,
    status,
    h('p', { class: 'muted' }, 'Speed limits come from OpenStreetMap, © OpenStreetMap contributors. Saving asks its servers for the roads in the area around your two markers, so they can see that area. Place markers on the street itself, not on a building.'),
  ));

  const map = L.map(mapEl, { zoomControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
  if (hasPlaces(saved)) map.fitBounds(L.latLngBounds([[saved.a.lat, saved.a.lon], [saved.b.lat, saved.b.lon]]).pad(0.25));
  else if (first) map.setView([first.a.lat, first.a.lon], 13);
  else {
    map.setView(EUROPE.center, EUROPE.zoom);
    locate();
  }
  setTimeout(() => map.invalidateSize(), 50);

  map.on('click', (e) => {
    if (!placing) return;
    draft[placing].lat = e.latlng.lat;
    draft[placing].lon = e.latlng.lng;
    placing = placing === 'a' && draft.b.lat == null ? 'b' : null;
    update();
  });

  function reuse(marker) {
    const key = placing || (draft.a.lat == null ? 'a' : draft.b.lat == null ? 'b' : null);
    if (!key) {
      status.textContent = 'Both markers are placed. Tap Move A or Move B first, then the marker to reuse.';
      return;
    }
    draft[key] = { ...draft[key], name: marker.name, lat: marker.lat, lon: marker.lon, private: isPrivate(marker) };
    names[key].value = marker.name;
    placing = key === 'a' && draft.b.lat == null ? 'b' : null;
    map.setView([marker.lat, marker.lon], Math.max(map.getZoom(), 14));
    update();
  }

  function locate() {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 15),
      () => { status.textContent = 'Could not get your location. Pan and zoom the map to your area instead.'; },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  function drawMarkers() {
    for (const key of ['a', 'b']) {
      layers[key]?.remove();
      layers[key] = null;
      const m = draft[key];
      if (m.lat == null) continue;
      const at = [m.lat, m.lon];
      const pin = L.marker(at, {
        draggable: true,
        icon: L.divIcon({ className: '', html: `<div class="pin ${key}">${key.toUpperCase()}</div>`, iconSize: [30, 30] }),
      });
      pin.on('dragend', () => {
        const p = pin.getLatLng();
        m.lat = p.lat;
        m.lon = p.lng;
        update();
      });
      layers[key] = L.layerGroup([
        L.circle(at, { radius: draft.activationM, color: '#0f4c8a', weight: 2, fillOpacity: 0.1 }),
        L.circle(at, { radius: draft.finalizationM, color: '#111', weight: 2, dashArray: '6 6', fillOpacity: 0.05 }),
        pin,
      ]).addTo(map);
    }
  }

  function problem() {
    if (draft.a.lat == null || draft.b.lat == null) return 'Both markers need a place on the map.';
    const d = distanceM(draft.a, draft.b);
    if (d < tun.minMarkerSeparationM) return `The markers are ${Math.round(d)} m apart. They need at least ${tun.minMarkerSeparationM} m between them.`;
    if (d > tun.maxMarkerSeparationM) return `The markers are ${fmtDist(d, app.unit)} apart. Zoom in and place both on your own streets.`;
    return null;
  }

  function update() {
    drawMarkers();
    // Always shown, so the map does not jump under the finger when a Move button is tapped.
    hint.textContent = placing
      ? `Tap the map where marker ${placing.toUpperCase()} (${draft[placing].name}) goes. Zoom in first: it should sit on the street.`
      : 'Drag a marker to fine-tune it, or use Move A / Move B and tap the map. Zoom in: markers should sit on the street.';
    const p = problem();
    saveBtn.disabled = busy || !!p;
    if (!busy) {
      status.textContent = p && draft.a.lat != null && draft.b.lat != null ? p
        : !p ? `${fmtDist(distanceM(draft.a, draft.b), app.unit)} in a straight line.` : '';
    }
  }

  async function save() {
    if (problem() || busy) return;
    const marker = (key) => ({
      name: draft[key].name, lat: draft[key].lat, lon: draft[key].lon,
      activationM: draft.activationM, finalizationM: draft.finalizationM,
      private: draft[key].private !== false,
    });
    // Markers placed on a route that came with its ends hidden make it a route of this phone.
    const next = { id: saved?.id || app.store.newRouteId(), rev: saved?.rev || 1, playerId: app.player.id, a: marker('a'), b: marker('b') };
    const moved = saved && (!hasPlaces(saved) || ['a', 'b'].some((k) =>
      distanceM(saved[k], next[k]) > 1 || saved[k].activationM !== next[k].activationM || saved[k].finalizationM !== next[k].finalizationM));
    if (moved) next.rev = saved.rev + 1;

    busy = true;
    update();
    try {
      app.routes = saved ? app.routes.map((r) => (r.id === next.id ? next : r)) : [...app.routes, next];
      await app.store.saveRoute(next);
      saved = next; // a retry after a failed download must update this route, not add another
      let roads = saved && !moved ? await app.store.getRoads(next.id) : null;
      if (!roads) {
        roads = await downloadRoads(next, app.tunables, (msg) => { status.textContent = msg; });
        status.textContent = 'Saving the road data…';
        await app.store.saveRoads(next.id, roads);
      }
      await app.useRoute(next.id);
      const c = app.roads.coverage;
      status.textContent = `Saved. Speed limits known for ${Math.round(((c.tagged + c.assumed) / c.total) * 100)}% of ${c.total.toLocaleString()} streets in this area.`;
      setTimeout(() => { if (location.hash.startsWith('#route/')) location.hash = '#drive'; }, 1200);
    } catch (err) {
      // The route itself is saved; only the speed limits are missing. Saving again retries the download.
      await app.useRoute(next.id);
      status.textContent = err.message;
    } finally {
      busy = false;
      saveBtn.disabled = !!problem();
    }
  }

  update();
  return { unmount() { map.remove(); } };
}
