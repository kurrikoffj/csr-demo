// Personal bests and standing, computed from run history. Nothing is stored as "the record":
// the best is simply the fastest clean run inside the record window.
// The demo has no other drivers, so your own past runs stand in for them.

import { DEFAULTS } from './tunables.js';

const DAY_MS = 86400000;

export function recordKey(run) {
  return `${run.routeId}|${run.routeRev}|${run.direction}|${run.bucket}`;
}

// Counts toward records: finished, not disqualified, GPS never paused.
export function isClean(run) {
  return run.status === 'finished' && !run.disqualified && !run.flags?.gap;
}

function eligible(runs, run, now, windowDays, sameBucket) {
  const since = now - windowDays * DAY_MS;
  return runs.filter(
    (r) =>
      r.id !== run.id && isClean(r) && r.startT >= since &&
      r.routeId === run.routeId && r.routeRev === run.routeRev && r.direction === run.direction &&
      (!sameBucket || r.bucket === run.bucket),
  );
}

const fastest = (list) => list.reduce((best, r) => (!best || r.durationS < best.durationS ? r : best), null);

// How a run compares with the rest of the history.
export function summarize(run, runs, { now = Date.now(), windowDays = DEFAULTS.recordWindowDays } = {}) {
  const clean = isClean(run);
  const peers = eligible(runs, run, now, windowDays, true);
  const prevBest = fastest(peers);
  const out = {
    clean,
    prevBest,
    isBest: clean && (!prevBest || run.durationS < prevBest.durationS),
    firstInBucket: !prevBest,
    deltaS: prevBest && run.durationS != null ? run.durationS - prevBest.durationS : null,
    standing: clean && peers.length
      ? { faster: peers.filter((r) => run.durationS < r.durationS).length, total: peers.length }
      : null,
    fallback: null,
  };
  if (!prevBest) {
    // Empty bucket: compare with any bucket on the same route and direction instead.
    const others = eligible(runs, run, now, windowDays, false);
    const overallBest = fastest(others);
    const lastRun = others.reduce((last, r) => (r.startT < run.startT && (!last || r.startT > last.startT) ? r : last), null);
    if (overallBest) out.fallback = { overallBest, lastRun };
  }
  return out;
}

// Current best per bucket for one route direction, for the history screen.
export function bestsByBucket(runs, { routeId, routeRev, direction }, { now = Date.now(), windowDays = DEFAULTS.recordWindowDays } = {}) {
  const since = now - windowDays * DAY_MS;
  const out = {};
  for (const r of runs) {
    if (!isClean(r) || r.startT < since) continue;
    if (r.routeId !== routeId || r.routeRev !== routeRev || r.direction !== direction) continue;
    if (!out[r.bucket] || r.durationS < out[r.bucket].durationS) out[r.bucket] = r;
  }
  return out;
}
