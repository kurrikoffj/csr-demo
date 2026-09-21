// Speed and distance units. Inside the game everything is km/h and metres; this file is the only
// place that knows about miles. unit is 'kmh' | 'mph', a per-phone setting.
//
// How judging works in either unit:
//   1. The driver is judged on the whole number on the speed digits against the whole number on
//      the roundel, in the unit they chose. The digits and the verdict can never disagree.
//   2. A sign shown in its own unit is itself: 30 mph reads 30, 50 km/h reads 50.
//   3. Anything converted rounds in the driver's favour: a converted limit rounds up (50 km/h reads
//      32 mph, 30 mph reads 49 km/h) and the yellow band rounds up to whole mph (3 km/h → 2 mph).
//   So nobody is ever flagged while truly at or under the sign, in any unit.

import { KMH_PER_MS } from './tunables.js';

export const KMH_PER_MPH = 1.609344;
export const M_PER_MILE = 1609.344;
export const UNIT_LABEL = { kmh: 'km/h', mph: 'mph' };

// 25 mph turned into km/h and back comes out a hair over 25: not a reason to round up to 26.
const EPS = 1e-9;

export const fromKmh = (kmh, unit = 'kmh') => (unit === 'mph' ? kmh / KMH_PER_MPH : kmh);
export const toKmh = (value, unit = 'kmh') => (unit === 'mph' ? value * KMH_PER_MPH : value);

// The whole number on the HUD's speed digits.
export const shownSpeed = (speedMs, unit = 'kmh') => Math.round(fromKmh(speedMs * KMH_PER_MS, unit));

// The whole number on the roundel. limit: { kmh, mph? }, mph being the sign's own number when
// the map gave the limit in mph.
export function shownLimit(limit, unit = 'kmh') {
  const own = unit === 'mph' && limit.mph != null ? limit.mph : fromKmh(limit.kmh, unit);
  return Math.ceil(own - EPS);
}

// True when the roundel shows a converted number rather than the sign's own.
export const isConverted = (limit, unit = 'kmh') => (unit === 'mph') !== (limit.mph != null);

// Width of the yellow band in the driver's unit. In mph it is whole and rounded up:
// rounding 1.86 mph down to 1 would turn red 1 km/h sooner than the km/h rule does.
export const bandWidth = (toleranceKmh, unit = 'kmh') =>
  (unit === 'mph' ? Math.ceil(toleranceKmh / KMH_PER_MPH - EPS) : toleranceKmh);

// Long distances follow the unit. Short ones (guidance, marker circles) stay in metres everywhere.
export function formatDistance(m, unit = 'kmh') {
  if (m == null) return '–';
  return unit === 'mph' ? `${(m / M_PER_MILE).toFixed(1)} mi` : `${(m / 1000).toFixed(1)} km`;
}

// Where the clock says the phone is. English (US) is a common phone language far from the US,
// and the unit has to match the road signs, so the time zone gets a veto.
const MPH_ZONES = {
  US: /^(America\/(New_York|Detroit|Kentucky\/|Indiana\/|Chicago|Menominee|North_Dakota\/|Denver|Boise|Phoenix|Los_Angeles|Anchorage|Juneau|Sitka|Metlakatla|Yakutat|Nome|Adak)|Pacific\/Honolulu|US\/)/,
  GB: /^(Europe\/(London|Belfast|Jersey|Guernsey|Isle_of_Man)|GB)/,
};

// languages: navigator.languages. timeZone: Intl's resolved zone, or '' when unknown.
// The first language that names a region decides.
export function defaultUnit({ languages = [], timeZone = '' } = {}) {
  for (const tag of languages) {
    const region = /^[a-z]{2,3}(?:-[a-z]{4})?-([a-z]{2})(?:-|$)/i.exec(tag || '')?.[1].toUpperCase();
    if (!region) continue;
    const zones = MPH_ZONES[region];
    return zones && (!timeZone || zones.test(timeZone)) ? 'mph' : 'kmh';
  }
  return 'kmh';
}
