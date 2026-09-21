// First steps for a new player, worked out from what they have already done. Nothing is stored
// for it except "hide this".

import { hasPlaces } from './privacy.js';

const STEPS = [
  { key: 'name', title: 'Pick a name' },
  { key: 'markers', title: 'Place your two markers' },
  { key: 'drive', title: 'Arm and drive' },
];

// A run that reached the finish line, in a car: replays from the sofa do not count.
const drove = (run) => !run.demo && run.status === 'finished';

// player: the active player or null. routes, runs: theirs. hidden: they asked not to see the steps.
// Returns { show, steps: [{ key, title, state: 'done' | 'now' | 'later' }], now: key | null, stepNo, total }.
export function gettingStarted({ player, routes = [], runs = [], hidden = false }) {
  const done = { name: !!player, markers: routes.some(hasPlaces), drive: runs.some(drove) };
  const at = STEPS.findIndex((s) => !done[s.key]);
  return {
    // Someone else's imported runs are for looking through, not for getting started.
    show: !!player && !player.imported && !hidden && at !== -1,
    steps: STEPS.map((s, i) => ({ ...s, state: done[s.key] ? 'done' : i === at ? 'now' : 'later' })),
    now: at === -1 ? null : STEPS[at].key,
    stepNo: at === -1 ? STEPS.length : at + 1,
    total: STEPS.length,
  };
}

// True for the one run that ends the getting-started steps: the player's first finish.
export function isFirstFinish(run, runs) {
  if (!drove(run)) return false;
  const finished = runs.filter(drove);
  return finished.length === 0 || (finished.length === 1 && finished[0].id === run.id);
}
