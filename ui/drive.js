// Drive tab: ready screen (pick route and direction), armed screen, and the HUD while a run is on.

import { h, roundel, setRoundel, guideArrow, setGuideArrow, fmtDist } from './dom.js';
import { Session } from './session.js';
import { guideFor, guideCard } from './guide.js';
import { placeName, routeName, hasPlaces } from '../src/privacy.js';
import { UNIT_LABEL } from '../src/units.js';
import { bucketFor, BUCKET_LABELS } from '../src/buckets.js';
import { bestsByBucket } from '../src/records.js';
import { formatDuration } from '../src/phrases.js';
import { distanceM } from '../src/geo.js';
import { demoDrive } from '../src/demo.js';
import { ScreenLock } from './gps.js';

const UP_ARROW = '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 6 88 48H64v46H36V48H12z"/></svg>';

function digits(text) {
  const el = h('span', { class: 'digits' });
  setDigits(el, text);
  return el;
}

function setDigits(el, text) {
  if (el.dataset.text === text) return;
  el.dataset.text = text;
  el.replaceChildren(...[...text].map((ch) => h('span', { class: /\d/.test(ch) ? '' : 'sep' }, ch)));
}

// What the guidance arrow is steering by, said plainly under the distance.
const MODE_TEXT = { course: 'by direction of travel', compass: 'by compass', north: 'north up' };

// Whole metres close in, so the last stretch reads as a countdown. Metres in either unit: only long distances follow it.
function guideDistance(m, unit) {
  if (m >= 1000) return fmtDist(m, unit);
  return `${m < 300 ? Math.round(m) : Math.round(m / 10) * 10} m`;
}

export function mountDrive(container, app) {
  let hudEls = null;
  let shown = null; // which screen is built: 'ready' | 'armed' | 'running'

  const session = () => app.session;

  function startSession(start) {
    app.session = new Session(app, {
      onChange: refresh,
      onEnd: (result, summary, fixes) => {
        app.lastResult = { result, summary, fixes };
        setBody('idle');
        if (result.startT != null) location.hash = `#run/${result.id}`;
        else refresh();
      },
    });
    start(app.session);
    refresh();
  }

  function setBody(state) {
    document.body.dataset.state = state;
    document.body.classList.toggle('driving', state !== 'idle');
  }

  // Commuters alternate: default to the opposite of the last run on this route.
  function direction() {
    const { route } = app;
    if (app.direction[route.id]) return app.direction[route.id];
    const last = app.runs.find((r) => r.routeId === route.id && r.status === 'finished');
    return last?.direction === 'ab' ? 'ba' : 'ab';
  }

  // Presentation mode shows a private place as its letter. What the engine knows is untouched.
  const place = (key) => placeName(app.route, key, app.presenting);
  const names = (dir) => (dir === 'ba' ? [place('b'), place('a')] : [place('a'), place('b')]);
  const unitLabel = () => UNIT_LABEL[app.unit];

  // ----- Ready -----

  function ready() {
    const { route, roads, runs, tunables } = app;
    // A new player gets their next step spelled out, until the first finished drive.
    const guide = guideFor(app);
    const card = guide.show ? guideCard(app, guide, {
      markers: [
        h('p', {}, 'Put marker A where you set off from and marker B where you are going, for example home and work. The clock runs between them, in either direction, on any roads you choose. Speed limits for the area download when you save.'),
        h('a', { class: 'plate', href: '#route/new' }, 'Place markers'),
      ],
      drive: [
        h('p', {}, 'Before you set off: phone on its mount, this page open, then tap the big Arm button below. After that it needs no touching. An arrow leads you to the start circle, the clock starts as you drive out of it, and it stops by itself at the other marker.'),
        h('p', { class: 'muted' }, 'Not in the car? “Replay a clean drive” at the bottom of this page shows and sounds like a real run, along your own roads.'),
      ],
    }, () => refresh(true)) : null;
    if (!route) {
      return card ? h('div', { class: 'stack' }, h('h1', { class: 'display' }, `Welcome, ${app.player.name}`), card)
        : h('div', { class: 'stack' },
          h('h1', { class: 'display' }, 'Set your start and finish'),
          h('p', {}, 'Place two markers on the map, for example home and work. The clock runs between them, in either direction, on any roads you choose.'),
          h('a', { class: 'plate', href: '#route/new' }, 'Place markers'),
        );
    }
    if (!hasPlaces(route)) {
      // Came in a file that was sent with its start and finish hidden.
      return h('div', { class: 'stack' },
        h('h1', { class: 'display' }, routeName(route, app.presenting)),
        h('p', { class: 'notice' }, 'This route came from a file sent with its start and finish hidden, so it has no markers to drive between. Its runs can be looked through in History.'),
        h('a', { class: 'plate', href: '#history' }, 'Open History'),
        app.routes.length > 1 ? h('a', { class: 'plate dark', href: '#route' }, 'Pick another route') : null);
    }
    const dir = direction();
    const [from, to] = names(dir);
    const bucket = bucketFor(new Date(), tunables.buckets);
    const best = bestsByBucket(runs, { routeId: route.id, routeRev: route.rev, direction: dir }, { windowDays: tunables.recordWindowDays })[bucket];
    const cov = roads?.coverage;
    const known = cov ? Math.round(((cov.tagged + cov.assumed) / cov.total) * 100) : null;
    const s = session();

    // The route sign doubles as the route picker: a native select laid over it.
    const picker = app.routes.length > 1
      ? h('select', {
        class: 'route-select', 'aria-label': 'Route',
        onchange: async (e) => {
          await app.useRoute(e.target.value);
          refresh(true);
        },
      }, app.routes.map((r) => h('option', { value: r.id, selected: r.id === route.id }, routeName(r, app.presenting))))
      : null;

    return h('div', { class: 'stack' },
      card,
      h('div', { class: 'plate route-sign', style: 'position:relative' },
        h('span', { class: 'display' }, place('a'), h('span', { class: 'arrow' }, '⇄'), place('b')),
        h('span', { class: 'data', style: picker ? 'font-size:24px' : '' }, picker ? '▾' : fmtDist(distanceM(route.a, route.b), app.unit)),
        picker),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Direction' },
        ['ab', 'ba'].map((d) => h('button', {
          'aria-pressed': String(dir === d),
          onclick: () => { app.direction[route.id] = d; refresh(true); },
        }, names(d).join(' → ')))),
      s?.notice ? h('p', { class: 'notice' }, s.notice) : null,
      !roads
        ? h('p', { class: 'notice' }, 'Speed limits are not downloaded for this route, so no limit can be shown or enforced. ',
          h('a', { href: `#route/${route.id}` }, 'Open the route and save it again to download them.'))
        : null,
      h('button', { class: 'arm', 'aria-label': `Arm ${from} to ${to}`, onclick: () => startSession((x) => x.armLive({ direction: dir })), innerHTML: UP_ARROW }),
      h('p', { class: 'display arm-label' }, `Arm ${from} → ${to}`),
      h('p', { class: 'muted', style: 'text-align:center' },
        `Phone on the mount, this page in front, screen on. Start your music first. An arrow leads you to the ${from} start circle; the clock starts by itself when you drive out of it.`),
      ScreenLock.supported ? null
        : h('p', { class: 'notice' }, 'This browser cannot keep the screen awake. Set Auto-Lock to Never while you test.'),

      h('h2', { class: 'display' }, `Now: ${BUCKET_LABELS[bucket]}`),
      h('table', {}, h('tbody', {}, h('tr', {},
        h('td', { style: 'white-space:nowrap' }, `${from} → ${to} best`),
        h('td', { class: 'num' }, best ? h('a', { href: `#run/${best.id}` }, formatDuration(best.durationS)) : 'no clean run yet')))),
      known != null
        ? h('p', { class: 'muted' }, `Speed limits known for ${known}% of ${cov.total.toLocaleString()} streets around this route (${cov.tagged.toLocaleString()} signed, ${cov.assumed.toLocaleString()} assumed).`)
        : null,

      h('p', { class: 'muted', style: 'text-align:center' }, `Driving as ${app.player.name}. `, h('a', { href: '#tuning' }, 'Change'), ' · ', h('a', { href: '#feedback' }, 'Send feedback')),

      h('h2', { class: 'display' }, 'Try it from the sofa'),
      h('p', { class: 'muted' }, 'Replays a made-up drive along your roads at 8× speed, with all the sounds. Nothing is saved unless you turn that on in Tuning.'),
      h('div', { class: 'row' },
        h('button', { class: 'plate dark small', disabled: !app.index, onclick: () => demo(dir, false) }, 'Replay a clean drive'),
        h('button', { class: 'plate dark small', disabled: !app.index, onclick: () => demo(dir, true) }, 'Replay with speeding'),
      ),
    );
  }

  function demo(dir, speeding) {
    const fixes = demoDrive(app.index, app.route, { tunables: app.tunables, direction: dir, speeding, startT: Date.now() });
    if (!fixes) {
      app.session = { notice: 'The downloaded roads do not connect your two markers. Move a marker onto a street and save the route again.' };
      return refresh(true);
    }
    startSession((x) => x.armReplay(fixes, { rate: 8, save: !!app.settings.saveDemos, direction: dir }));
  }

  // ----- Armed -----

  function armed() {
    const els = {
      title: h('span', { class: 'display' }),
      big: h('p', { class: 'display armed-title' }, 'Armed'),
      guide: h('div', { class: 'armed-guide' }),
      arrow: guideArrow(),
      dist: h('span', { class: 'display guide-dist' }),
      mode: h('span', { class: 'data guide-north' }),
      gps: h('p', { class: 'armed-note data', style: 'font-size:14px;opacity:.85' }),
      note: h('p', { class: 'armed-note' }),
      sub: h('p', { class: 'armed-note', style: 'opacity:.8' }),
      roundel: roundel(null, app.unit),
      speed: h('span', { class: 'display', style: 'font-size:56px' }, '–'),
    };
    els.roundel.style.setProperty('--d', '76px');
    els.guide.append(els.arrow, h('div', {}, els.dist, els.mode));
    hudEls = els;
    return h('div', { class: 'hud', style: 'grid-template-rows:auto 1fr auto' },
      h('div', { class: 'hud-top' },
        els.title,
        h('span', { class: 'data' }, session().demo ? 'Demo 8×' : BUCKET_LABELS[bucketFor(new Date(session().now()), app.tunables.buckets)])),
      h('div', { class: 'stack hud-body' },
        els.big,
        els.guide,
        els.note,
        els.sub,
        els.gps,
        h('div', { class: 'row', style: 'justify-content:center;align-items:center;gap:18px;margin-top:6px' },
          els.roundel, h('div', { style: 'flex:none' }, els.speed, h('span', { class: 'unit' }, ` ${unitLabel()}`)))),
      h('div', { class: 'row' },
        h('button', { class: 'plate white small', onclick: () => app.cues.play('warning') }, 'Test warning sound'),
        h('button', { class: 'plate white small', onclick: () => session().stop() }, 'Disarm')),
    );
  }

  function updateArmed(hud) {
    const els = hudEls;
    const s = session();
    const [from, to] = names(hud.direction || s.engine.preferred);
    els.title.textContent = `Armed · ${from} → ${to}`;
    els.guide.hidden = !hud.target;
    els.big.hidden = !!hud.target; // the arrow replaces the big word while there is somewhere to drive to
    if (hud.target) {
      const up = s.guideHeading(hud);
      setGuideArrow(els.arrow, hud.target.bearingDeg, up.deg);
      els.dist.textContent = guideDistance(hud.target.distM, app.unit);
      els.mode.textContent = MODE_TEXT[up.source] + (up.source === 'north' && s.compass.status === 'denied' ? ' · compass refused' : '');
    }
    const weak = hud.waitingFor === 'gps';
    const label = hud.target ? `to the ${from} start circle` : hud.gps === 'none' ? 'Waiting for GPS…' : `You are at ${from}.`;
    const advice = hud.gps === 'none' ? s.notice || 'Allow location if asked.'
      : hud.target ? 'Go through it. The clock starts as you come out the other side.'
        : 'The clock starts when you drive out of the circle.';
    els.note.textContent = label;
    els.sub.textContent = s.screenAwake === false ? `${advice} Screen lock is not held: keep the screen on yourself.` : advice;
    els.gps.textContent = hud.accuracyM == null ? ''
      : `GPS ±${Math.round(hud.accuracyM)} m${weak ? ` · too rough to start the clock, needs ±${app.tunables.maxAccuracyM} m. Usually better outdoors.` : ''}`;
    setRoundel(els.roundel, hud.limit, app.unit);
    els.speed.textContent = hud.shownSpeed == null ? '–' : String(hud.shownSpeed);
  }

  // ----- Running -----

  function running() {
    let cancelArmedAt = 0;
    const els = {
      dir: h('span', { class: 'display' }),
      bucket: h('span', { class: 'data' }),
      roundel: roundel(null, app.unit),
      speed: digits('0'),
      road: h('p', { class: 'hud-road' }),
      clock: digits('0:00'),
      bar: h('div', { class: 'dq-bar', 'aria-hidden': 'true' }, h('i')),
      banner: h('p', { class: 'plate yellow display banner', hidden: true }, 'Disqualified · this run does not count'),
      guide: h('div', { class: 'guide' }),
      arrow: guideArrow(),
      dist: h('span', { class: 'display guide-dist' }),
      to: h('span', { class: 'guide-to' }),
      cancel: h('button', {
        class: 'plate white small',
        onclick: () => {
          // Two taps, so a bump on the mount cannot end a run.
          if (Date.now() - cancelArmedAt < 3000) return session().stop();
          cancelArmedAt = Date.now();
          els.cancel.textContent = 'Tap again to cancel';
          setTimeout(() => (els.cancel.textContent = 'Cancel run'), 3000);
        },
      }, 'Cancel run'),
    };
    els.guide.append(els.arrow, els.dist, els.to);
    hudEls = els;
    return h('div', { class: 'hud' },
      h('div', { class: 'hud-top' }, els.dir, els.bucket),
      h('div', { class: 'hud-body' },
        h('div', { class: 'hud-main' },
          els.roundel,
          h('div', { class: 'speed' }, h('div', { class: 'display' }, els.speed), h('div', { class: 'unit' }, unitLabel()))),
        els.road),
      h('div', { class: 'hud-clock' }, h('div', { class: 'display' }, els.clock)),
      h('div', { class: 'stack hud-bottom' },
        els.banner, els.bar,
        h('div', { class: 'hud-foot' }, els.guide, els.cancel)),
    );
  }

  function updateRunning(hud) {
    const els = hudEls;
    const s = session();
    const [from, to] = names(hud.direction);
    els.dir.textContent = `${from} → ${to}`;
    els.bucket.textContent = s.screenAwake === false
      ? 'Screen may sleep · keep it on'
      : `${s.demo ? 'DEMO 8× · ' : ''}${BUCKET_LABELS[s.engine.bucket] || ''}`;
    setRoundel(els.roundel, hud.limit, app.unit);
    setDigits(els.speed, hud.shownSpeed == null ? '–' : String(hud.shownSpeed));
    // Over the limit shows at once on the digits; the yellow screen and tone wait for it to last.
    els.speed.classList.toggle('above', hud.aboveLimit && hud.zone === 'ok');
    els.road.textContent = hud.gps === 'weak' ? `Weak GPS (${Math.round(hud.accuracyM)} m)`
      : hud.zone === 'yellow' ? 'Over the limit too long'
        : hud.aboveLimit && hud.zone === 'ok' ? 'A little over the limit'
          : app.presenting ? ' ' : hud.wayName || ' '; // a street name says where you are
    setDigits(els.clock, formatDuration(hud.elapsedS));
    els.banner.hidden = !hud.disqualified;
    els.bar.classList.toggle('on', !hud.disqualified && hud.dqProgress > 0);
    els.bar.firstChild.style.width = `${Math.round(hud.dqProgress * 100)}%`;
    els.guide.hidden = !hud.target;
    if (hud.target) {
      setGuideArrow(els.arrow, hud.target.bearingDeg, s.guideHeading(hud).deg);
      els.dist.textContent = guideDistance(hud.target.distM, app.unit);
      els.to.textContent = hud.finishClose ? 'to finish' : `to ${to}`;
      els.guide.classList.toggle('close', hud.finishClose);
    }
  }

  // ----- Switching -----

  function refresh(force = false) {
    const s = session();
    const state = s?.engine?.state;
    const want = state === 'armed' ? 'armed' : state === 'running' ? 'running' : 'ready';
    if (want !== shown || force === true) {
      shown = want;
      hudEls = null;
      container.replaceChildren(want === 'armed' ? armed() : want === 'running' ? running() : ready());
    }
    if (want === 'ready') return setBody('idle');
    const hud = s.hud();
    setBody(want === 'armed' ? 'armed' : hud.zone === 'red' ? 'over' : hud.zone === 'yellow' ? 'caution' : 'running');
    if (want === 'armed') updateArmed(hud);
    else updateRunning(hud);
  }

  refresh(true);
  if (app.pendingReplay) {
    // "Replay this drive" from a run's summary: same trace, today's rules. Never saved.
    const { fixes, routeId, direction: dir } = app.pendingReplay;
    app.pendingReplay = null;
    (async () => {
      if (routeId && routeId !== app.route?.id && app.routeById(routeId)) await app.useRoute(routeId);
      startSession((x) => x.armReplay(fixes, { rate: 8, save: false, direction: dir }));
    })();
  }
  return {
    unmount() {
      // Leaving the tab never happens mid-drive (tabs are hidden), but be safe.
      if (session()?.active) session().stop();
      setBody('idle');
    },
  };
}
