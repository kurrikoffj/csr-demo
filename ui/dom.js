// Tiny DOM helpers. h('div', { class: 'x', onclick: fn }, child, 'text', [more])
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'innerHTML') el.innerHTML = value; // trusted markup only (inline icons)
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key in el && key !== 'list' && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

// The speed limit as the road sign it came from.
// Solid ring: read from the map. Dashed ring: assumed default. Grey: unknown, not enforced.
export function roundel(limit) {
  const el = h('div', { class: 'roundel', role: 'img' });
  setRoundel(el, limit);
  return el;
}

export function setRoundel(el, limit) {
  const tier = limit ? limit.tier : 'unknown';
  el.dataset.tier = tier;
  el.textContent = limit ? `${limit.approx ? '~' : ''}${Math.round(limit.kmh)}` : '–';
  el.setAttribute(
    'aria-label',
    limit ? `Speed limit ${Math.round(limit.kmh)}${tier === 'assumed' ? ', assumed' : ''}` : 'Speed limit unknown',
  );
}

export const fmtKm = (m) => (m == null ? '–' : `${(m / 1000).toFixed(1)} km`);
export const fmtM = (m) => (m == null ? '–' : m < 1000 ? `${Math.round(m)} m` : fmtKm(m));

export function fmtDate(t) {
  return new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function fmtClock(t) {
  return new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
