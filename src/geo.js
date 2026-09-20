// Points are { lat, lon } in degrees. Distances in metres, bearings in degrees clockwise from north.

const R = 6371008.8;
const RAD = Math.PI / 180;

export function distanceM(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearingDeg(a, b) {
  const y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD);
  const x =
    Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) -
    Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

// Smallest angle between two bearings, 0..180.
export function angleDiffDeg(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Local flat-earth metres around an origin. Good to well under a metre at commute scale.
export function toXY(origin, p) {
  return {
    x: (p.lon - origin.lon) * RAD * R * Math.cos(origin.lat * RAD),
    y: (p.lat - origin.lat) * RAD * R,
  };
}

export function fromXY(origin, xy) {
  return {
    lat: origin.lat + xy.y / (RAD * R),
    lon: origin.lon + xy.x / (RAD * R * Math.cos(origin.lat * RAD)),
  };
}

// Closest point on segment a→b. t is the fraction along the segment, clamped to 0..1.
export function projectOnSegment(p, a, b) {
  const B = toXY(a, b);
  const P = toXY(a, p);
  const len2 = B.x * B.x + B.y * B.y;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (P.x * B.x + P.y * B.y) / len2));
  const cx = B.x * t;
  const cy = B.y * t;
  return { distM: Math.hypot(P.x - cx, P.y - cy), t, point: fromXY(a, { x: cx, y: cy }) };
}

// Fraction 0..1 along p0→p1 where the path first crosses the circle, or null.
export function circleCrossing(center, radiusM, p0, p1) {
  const A = toXY(center, p0);
  const B = toXY(center, p1);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = 2 * (A.x * dx + A.y * dy);
  const c = A.x * A.x + A.y * A.y - radiusM * radiusM;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
    if (t >= 0 && t <= 1) return t;
  }
  return null;
}

export function bboxAround(points, padM) {
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  for (const p of points) {
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lon);
    east = Math.max(east, p.lon);
  }
  const midLat = (south + north) / 2;
  const dLat = padM / (RAD * R);
  const dLon = padM / (RAD * R * Math.cos(midLat * RAD));
  return { south: south - dLat, west: west - dLon, north: north + dLat, east: east + dLon };
}
