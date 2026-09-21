import { shownLimit, isConverted, formatDistance, UNIT_LABEL } from '../src/units.js';

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
// The number is the one the driver is judged against, in the unit on their screen. A sign in the
// other unit is converted and rounded up (see src/units.js) and gets a ~, like any approximate limit.
export function roundel(limit, unit = 'kmh') {
  const el = h('div', { class: 'roundel', role: 'img' });
  setRoundel(el, limit, unit);
  return el;
}

export function setRoundel(el, limit, unit = 'kmh') {
  const tier = limit ? limit.tier : 'unknown';
  const n = limit ? shownLimit(limit, unit) : null;
  el.dataset.tier = tier;
  el.textContent = limit ? `${limit.approx || isConverted(limit, unit) ? '~' : ''}${n}` : '–';
  el.setAttribute(
    'aria-label',
    limit ? `Speed limit ${n} ${UNIT_LABEL[unit]}${tier === 'assumed' ? ', assumed' : ''}` : 'Speed limit unknown',
  );
}

// Long distances follow the speed unit: km or miles. Short ones stay in metres everywhere.
export const fmtDist = (m, unit = 'kmh') => (Number.isFinite(m) ? formatDistance(m, unit) : '–');

export function fmtDate(t) {
  return new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function fmtClock(t) {
  return new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Guidance arrow. Points where to drive, relative to the way the car is heading (up = straight on).
// Until the car has moved there is no heading, so it points relative to north and says so.
const ARROW = '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 6 86 90 50 70 14 90z"/></svg>';

export function guideArrow() {
  const el = h('span', { class: 'guide-arrow', innerHTML: ARROW });
  el.angle = 0;
  return el;
}

// bearingDeg: compass bearing to the target. headingDeg: the car's course, or null.
export function setGuideArrow(el, bearingDeg, headingDeg) {
  const want = headingDeg == null ? bearingDeg : bearingDeg - headingDeg;
  // Turn the short way round, so 350° → 10° is a nudge and not a spin.
  el.angle += ((((want - el.angle) % 360) + 540) % 360) - 180;
  el.firstChild.style.transform = `rotate(${el.angle}deg)`;
  el.dataset.northUp = String(headingDeg == null);
}
