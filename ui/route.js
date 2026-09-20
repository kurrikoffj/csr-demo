// Route tab: place the two markers, set the circle sizes, download speed limits for the area.

import { h, fmtKm } from './dom.js';
import { distanceM } from '../src/geo.js';
import { WayIndex } from '../src/osm.js';
import { downloadRoads } from './limits.js';

const EUROPE = { center: [54, 15], zoom: 4 };

export function mountRoute(container, app) {
  const tun = app.tunables;
  const saved = app.route;
  // Working copy; nothing changes until Save.
  const draft = {
    a: saved ? { ...saved.a } : { name: 'Home', lat: null, lon: null },
    b: saved ? { ...saved.b } : { name: 'Work', lat: null, lon: null },
    activationM: saved?.a.activationM ?? tun.activationRadiusM,
    finalizationM: saved?.a.finalizationM ?? tun.finalizationRadiusM,
  };
  let placing = saved ? null : 'a';
  let busy = false;
  const layers = { a: null, b: null };

  const mapEl = h('div', { class: 'map' });
  const hint = h('p', { class: 'notice', style: 'min-height:5.4em' });
  const status = h('p', { class: 'muted' });
  const saveBtn = h('button', { class: 'plate', onclick: save }, 'Save route');
  const nameInput = (key) => h('input', { type: 'text', value: draft[key].name, maxlength: 14, oninput: (e) => { draft[key].name = e.target.value.trim() || (key === 'a' ? 'Home' : 'Work'); } });
  const placeBtn = (key) => h('button', { class: 'plate dark small', onclick: () => { placing = key; update(); } }, `Move ${key.toUpperCase()}`);
  const slider = (field, label, help) => {
    const out = h('span', { class: 'data' }, `${draft[field]} m`);
    return h('label', { class: 'field wide' },
      h('span', { class: 'hud-top' }, h('span', {}, label), out),
      h('input', { type: 'range', min: tun.minRadiusM, max: 200, step: 5, value: draft[field], oninput: (e) => { draft[field] = Number(e.target.value); out.textContent = `${draft[field]} m`; drawMarkers(); } }),
      h('small', {}, help));
  };

  container.replaceChildren(h('div', { class: 'stack' },
    h('h1', { class: 'display' }, 'Route'),
    hint,
    mapEl,
    h('div', { class: 'row' },
      h('button', { class: 'plate dark small', onclick: locate }, 'Show where I am'),
      placeBtn('a'), placeBtn('b')),
    h('label', { class: 'field' }, h('span', {}, 'Name of marker A'), nameInput('a')),
    h('label', { class: 'field' }, h('span', {}, 'Name of marker B'), nameInput('b')),
    slider('activationM', 'Start circle', 'The clock starts when you drive out of this circle. Make it big enough to cover where you park.'),
    slider('finalizationM', 'Finish circle', 'The clock stops when you drive into this circle.'),
    saved ? h('p', { class: 'muted' }, 'Moving a marker or resizing a circle starts fresh records; earlier runs stay in History.') : null,
    saveBtn,
    status,
    h('p', { class: 'muted' }, 'Speed limits come from OpenStreetMap, © OpenStreetMap contributors. Place markers on the street itself, not on a building.'),
  ));

  const map = L.map(mapEl, { zoomControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
  if (saved) map.fitBounds(L.latLngBounds([[saved.a.lat, saved.a.lon], [saved.b.lat, saved.b.lon]]).pad(0.25));
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
    if (d > tun.maxMarkerSeparationM) return `The markers are ${Math.round(d / 1000)} km apart. Zoom in and place both on your own streets.`;
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
        : !p ? `${fmtKm(distanceM(draft.a, draft.b))} in a straight line.` : '';
    }
  }

  async function save() {
    if (problem() || busy) return;
    const marker = (key) => ({
      name: draft[key].name, lat: draft[key].lat, lon: draft[key].lon,
      activationM: draft.activationM, finalizationM: draft.finalizationM,
    });
    const next = { id: saved?.id || 'r1', rev: saved?.rev || 1, a: marker('a'), b: marker('b') };
    const moved = saved && ['a', 'b'].some((k) =>
      distanceM(saved[k], next[k]) > 1 || saved[k].activationM !== next[k].activationM || saved[k].finalizationM !== next[k].finalizationM);
    if (moved) next.rev = saved.rev + 1;

    busy = true;
    update();
    try {
      await app.store.saveRoute(next);
      app.route = next;
      const covered = app.roads && !moved && saved;
      if (!covered) {
        const roads = await downloadRoads(next, app.tunables, (msg) => { status.textContent = msg; });
        status.textContent = 'Saving the road data…';
        await app.store.saveRoads(roads);
        app.roads = roads;
        app.index = new WayIndex(roads.ways);
      }
      const c = app.roads.coverage;
      status.textContent = `Saved. Speed limits known for ${Math.round(((c.tagged + c.assumed) / c.total) * 100)}% of ${c.total.toLocaleString()} streets in this area.`;
      setTimeout(() => { if (location.hash === '#route') location.hash = '#drive'; }, 1200);
    } catch (err) {
      status.textContent = err.message;
    } finally {
      busy = false;
      saveBtn.disabled = !!problem();
    }
  }

  update();
  return { unmount() { map.remove(); } };
}
