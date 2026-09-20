// Drive tab: ready screen, armed screen, and the HUD while a run is on.

import { h, roundel, setRoundel, fmtKm, fmtM, fmtDate } from './dom.js';
import { Session } from './session.js';
import { bucketFor, BUCKET_LABELS } from '../src/buckets.js';
import { bestsByBucket } from '../src/records.js';
import { formatDuration } from '../src/phrases.js';
import { distanceM } from '../src/geo.js';
import { demoDrive } from '../src/demo.js';
import { ScreenLock } from './gps.js';

const ARROW = '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 6 88 48H64v46H36V48H12z"/></svg>';

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
        if (result.status === 'finished' || result.startT != null) location.hash = `#run/${result.id}`;
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

  // ----- Ready -----

  function ready() {
    const { route, roads, runs, tunables } = app;
    if (!route) {
      return h('div', { class: 'stack' },
        h('h1', { class: 'display' }, 'Set your start and finish'),
        h('p', {}, 'Place two markers on the map, for example home and work. The clock runs between them, in either direction, on any roads you choose.'),
        h('a', { class: 'plate', href: '#route' }, 'Place markers'),
      );
    }
    const bucket = bucketFor(new Date(), tunables.buckets);
    const best = (direction) =>
      bestsByBucket(runs, { routeId: route.id, routeRev: route.rev, direction }, { windowDays: tunables.recordWindowDays })[bucket];
    const bestLine = (from, to, direction) => {
      const b = best(direction);
      return h('tr', {},
        h('td', {}, `${from} → ${to}`),
        h('td', { class: 'num' }, b ? formatDuration(b.durationS) : 'no run yet'),
        h('td', { class: 'num muted' }, b ? fmtDate(b.startT) : ''),
      );
    };
    const cov = roads?.coverage;
    const known = cov ? Math.round(((cov.tagged + cov.assumed) / cov.total) * 100) : null;
    const s = session();

    return h('div', { class: 'stack' },
      h('div', { class: 'plate route-sign' },
        h('span', { class: 'display' }, route.a.name, h('span', { class: 'arrow' }, '⇄'), route.b.name),
        h('span', { class: 'data' }, fmtKm(distanceM(route.a, route.b))),
      ),
      s?.notice ? h('p', { class: 'notice' }, s.notice) : null,
      !roads
        ? h('p', { class: 'notice' }, 'Speed limits are not downloaded yet, so no limit can be shown or enforced. ',
          h('a', { href: '#route' }, 'Download them on the Route tab.'))
        : null,
      h('button', { class: 'arm', 'aria-label': 'Arm', onclick: () => startSession((x) => x.armLive()), innerHTML: ARROW }),
      h('p', { class: 'display arm-label' }, 'Arm'),
      h('p', { class: 'muted', style: 'text-align:center' },
        'Phone on the mount, this page in front, screen on. Start your music first. The clock starts by itself when you drive out of the start circle.'),
      ScreenLock.supported ? null
        : h('p', { class: 'notice' }, 'This browser cannot keep the screen awake. Set Auto-Lock to Never while you test.'),

      h('h2', { class: 'display' }, `Now: ${BUCKET_LABELS[bucket]}`),
      h('table', {}, h('tbody', {},
        bestLine(route.a.name, route.b.name, 'ab'),
        bestLine(route.b.name, route.a.name, 'ba'))),
      known != null
        ? h('p', { class: 'muted' }, `Speed limits known for ${known}% of ${cov.total.toLocaleString()} streets around this route (${cov.tagged.toLocaleString()} signed, ${cov.assumed.toLocaleString()} assumed). Downloaded ${fmtDate(roads.fetchedAt)}.`)
        : null,

      h('h2', { class: 'display' }, 'Try it from the sofa'),
      h('p', { class: 'muted' }, 'Replays a made-up drive along your roads at 8× speed, with all the sounds. Nothing is saved unless you turn that on in Tuning.'),
      h('div', { class: 'row' },
        h('button', { class: 'plate dark small', disabled: !app.index, onclick: () => demo(false) }, 'Replay a clean drive'),
        h('button', { class: 'plate dark small', disabled: !app.index, onclick: () => demo(true) }, 'Replay with speeding'),
      ),
    );
  }

  function demo(speeding) {
    const fixes = demoDrive(app.index, app.route, { tunables: app.tunables, speeding, startT: Date.now() });
    if (!fixes) {
      app.session = { notice: 'The downloaded roads do not connect your two markers. Move a marker onto a street and save the route again.' };
      return refresh(true);
    }
    startSession((x) => x.armReplay(fixes, { rate: 8, save: !!app.settings.saveDemos }));
  }

  // ----- Armed -----

  function armed() {
    const els = {
      note: h('p', { class: 'armed-note' }),
      sub: h('p', { class: 'armed-note muted', style: 'color:inherit;opacity:.8' }),
      roundel: roundel(null),
      speed: h('span', { class: 'display', style: 'font-size:64px' }, '–'),
    };
    els.roundel.style.setProperty('--d', '84px');
    hudEls = els;
    return h('div', { class: 'hud', style: 'grid-template-rows:auto 1fr auto' },
      h('div', { class: 'hud-top' },
        h('span', { class: 'display' }, session().demo ? 'Demo 8×' : 'Live GPS'),
        h('span', { class: 'data' }, BUCKET_LABELS[bucketFor(new Date(session().now()), app.tunables.buckets)]),
      ),
      h('div', { class: 'stack', style: 'align-self:center' },
        h('p', { class: 'display armed-title' }, 'Armed'),
        els.note,
        els.sub,
        h('div', { class: 'row', style: 'justify-content:center;align-items:center;gap:18px;margin-top:10px' },
          els.roundel, h('div', { style: 'flex:none' }, els.speed, h('span', { class: 'unit' }, ' km/h'))),
      ),
      h('div', { class: 'row' },
        h('button', { class: 'plate white small', onclick: () => app.cues.play('warning') }, 'Test warning sound'),
        h('button', { class: 'plate white small', onclick: () => session().stop() }, 'Disarm'),
      ),
    );
  }

  function updateArmed(hud) {
    const els = hudEls;
    const s = session();
    const texts = {
      gps: ['Waiting for GPS…', hud.accuracyM ? `Accuracy ${Math.round(hud.accuracyM)} m. Needs ${app.tunables.maxAccuracyM} m or better.` : s.notice || 'Allow location if asked.'],
      enter: ['Drive into a start circle.', `${fmtM(hud.distToStartM)} to the nearest one.`],
      leave: [`At ${hud.startName}. The clock starts when you drive out of the circle.`, `Finish: ${hud.finishName}. ${fmtM(hud.distToStartM)} from the marker.`],
    }[hud.waitingFor] || ['', ''];
    els.note.textContent = texts[0];
    els.sub.textContent = s.screenAwake === false ? `${texts[1]} Screen lock is not held: keep the screen on yourself.` : texts[1];
    setRoundel(els.roundel, hud.limit);
    els.speed.textContent = hud.speedKmh == null ? '–' : String(Math.round(hud.speedKmh));
  }

  // ----- Running -----

  function running() {
    let cancelArmedAt = 0;
    const els = {
      dir: h('span', { class: 'display' }),
      bucket: h('span', { class: 'data' }),
      roundel: roundel(null),
      speed: digits('0'),
      road: h('p', { class: 'hud-road' }),
      clock: digits('0:00'),
      bar: h('div', { class: 'dq-bar', 'aria-hidden': 'true' }, h('i')),
      banner: h('p', { class: 'plate yellow display banner', hidden: true }, 'Disqualified · this run does not count'),
      toGo: h('span', { class: 'data' }),
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
    hudEls = els;
    return h('div', { class: 'hud' },
      h('div', { class: 'hud-top' }, els.dir, els.bucket),
      h('div', { class: 'hud-body' },
        h('div', { class: 'hud-main' },
          els.roundel,
          h('div', { class: 'speed' }, h('div', { class: 'display' }, els.speed), h('div', { class: 'unit' }, 'km/h'))),
        els.road),
      h('div', { class: 'hud-clock' }, h('div', { class: 'display' }, els.clock)),
      h('div', { class: 'stack' },
        els.banner, els.bar,
        h('div', { class: 'hud-foot' }, els.toGo, els.cancel)),
    );
  }

  function updateRunning(hud) {
    const els = hudEls;
    const s = session();
    els.dir.textContent = `${hud.startName} → ${hud.finishName}`;
    els.bucket.textContent = `${s.demo ? 'DEMO 8× · ' : ''}${BUCKET_LABELS[s.engine.bucket] || ''}`;
    setRoundel(els.roundel, hud.limit);
    setDigits(els.speed, hud.speedKmh == null ? '–' : String(Math.round(hud.speedKmh)));
    els.road.textContent = hud.gps === 'weak' ? `Weak GPS (${Math.round(hud.accuracyM)} m)` : hud.wayName || ' ';
    setDigits(els.clock, formatDuration(hud.elapsedS));
    els.banner.hidden = !hud.disqualified;
    els.bar.classList.toggle('on', !hud.disqualified && hud.dqProgress > 0);
    els.bar.firstChild.style.width = `${Math.round(hud.dqProgress * 100)}%`;
    els.toGo.textContent = hud.distToFinishM == null ? '' : `${fmtM(hud.distToFinishM)} to ${hud.finishName}`;
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
    setBody(want === 'armed' ? 'armed' : hud.over ? 'over' : 'running');
    if (want === 'armed') updateArmed(hud);
    else updateRunning(hud);
  }

  refresh(true);
  if (app.pendingReplay) {
    // "Replay this drive" from a run's summary: same trace, today's rules. Never saved.
    const fixes = app.pendingReplay;
    app.pendingReplay = null;
    startSession((x) => x.armReplay(fixes, { rate: 8, save: false }));
  }
  return {
    unmount() {
      // Leaving the tab never happens mid-drive (tabs are hidden), but be safe.
      if (session()?.active) session().stop();
      setBody('idle');
    },
  };
}
