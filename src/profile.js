// Players: a name, nothing more. No passwords, no server. A player owns routes and runs on this
// phone; an export file carries the player so its owner's runs can be opened on another phone.

export function cleanName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

export function newPlayer(name, now = Date.now(), rand = Math.random) {
  const tail = Math.floor(rand() * 46656).toString(36).padStart(3, '0');
  return { id: `p${now.toString(36)}${tail}`, name: cleanName(name), createdAt: now };
}

export const ownedBy = (items, playerId) => items.filter((x) => x.playerId === playerId);

const sameName = (a, b) => cleanName(a).toLowerCase() === cleanName(b).toLowerCase();

// Decide what an export file means on this phone. Pure: returns what to write, writes nothing.
// local: { players, activeId, routes, runs } (routes and runs of every player).
export function planImport(data, local) {
  if (data?.app !== 'csr-demo' || !Array.isArray(data.runs)) throw new Error('Not a CSR Demo export file');
  const { players, activeId } = local;
  const active = players.find((p) => p.id === activeId) || null;
  const theirs = data.player || null;
  const activeIsEmpty = active
    && !local.routes.some((r) => r.playerId === active.id) && !local.runs.some((r) => r.playerId === active.id);

  let player;
  let created = false;
  if (!theirs) player = active; // a backup from before players existed
  else if (players.some((p) => p.id === theirs.id)) player = players.find((p) => p.id === theirs.id);
  else if (activeIsEmpty && sameName(active.name, theirs.name)) player = active; // own backup on a fresh phone
  else {
    player = { id: theirs.id, name: cleanName(theirs.name) || 'Friend', createdAt: theirs.createdAt || Date.now(), imported: true };
    created = true;
  }
  if (!player) throw new Error('Pick a name first, then import');

  // An id already used by a different player here gets a new one, so nobody's data is overwritten.
  const clashes = (list, id) => list.some((x) => x.id === id && x.playerId && x.playerId !== player.id);
  const routeIds = {};
  const routes = (data.routes || (data.route ? [data.route] : [])).map((route) => {
    const id = clashes(local.routes, route.id) ? `${route.id}-${player.id}` : route.id;
    routeIds[route.id] = id;
    return { ...route, id, playerId: player.id };
  });
  const traces = {};
  const runs = data.runs.map((run) => {
    const id = clashes(local.runs, run.id) ? `${run.id}-${player.id}` : run.id;
    if (data.traces?.[run.id]) traces[id] = data.traces[run.id];
    return { ...run, id, routeId: routeIds[run.routeId] ?? run.routeId, playerId: player.id };
  });

  return { player, created, applySettings: !!data.settings && !created && player.id === activeId, settings: data.settings || null, routes, runs, traces };
}

export function runTally(runs) {
  const real = runs.filter((r) => !r.demo);
  return {
    total: real.length,
    clean: real.filter((r) => r.status === 'finished' && !r.disqualified && !r.flags?.gap).length,
    disqualified: real.filter((r) => r.disqualified).length,
    paused: real.filter((r) => r.status === 'finished' && r.flags?.gap).length,
    unfinished: real.filter((r) => r.status !== 'finished').length,
    cautions: real.reduce((n, r) => n + (r.cautions || 0), 0),
    warnings: real.reduce((n, r) => n + (r.warnings || 0), 0),
  };
}

// The message a player sends. No places in it: names, counts and their own words only.
export function feedbackText({ player, build, routes, runs, note, device = '' }) {
  const t = runTally(runs);
  return [
    'CSR Demo feedback',
    `From: ${player.name}`,
    `Build: ${build}`,
    `Routes: ${routes.length} · real runs: ${t.total} (${t.clean} clean, ${t.disqualified} disqualified, ${t.paused} GPS paused, ${t.unfinished} not finished)`,
    `Yellow cautions: ${t.cautions} · red warnings: ${t.warnings}`,
    device ? `Phone: ${device}` : null,
    '',
    cleanNote(note) || '(no comment written)',
  ].filter((line) => line != null).join('\n');
}

export const cleanNote = (note) => String(note ?? '').trim().slice(0, 4000);
