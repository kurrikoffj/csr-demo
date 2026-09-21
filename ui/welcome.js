// The front door: how the game works in three steps, then "who is driving?". A name is the whole
// account: no password, no sign-up. Shown again from Tuning to add another player on the same phone.

import { h } from './dom.js';
import { stepList } from './guide.js';
import { newPlayer, cleanName } from '../src/profile.js';

// What leaves the phone, said exactly. Keep it true.
export const PRIVACY_TEXT = 'Your name, routes and runs stay on this phone. To load speed limits and map tiles, your phone asks OpenStreetMap servers about the area of your route, and they can see that area. If you send feedback, you choose who gets it and what goes with it.';

const HOW_IT_WORKS = [
  { title: 'Place two markers', body: 'On a map, for example home and work. That is your route, in both directions.' },
  { title: 'Arm and drive', body: 'Tap Arm before you set off, phone on its mount. The clock starts by itself as you leave the first marker and stops at the other. Take any roads you like.' },
  { title: 'Beat your best', body: 'Your best time for that time of day is the one to beat. A little over the speed limit is a yellow caution. Clearly over it for about five seconds voids the run.' },
];

export function mountWelcome(container, app) {
  const first = app.players.length === 0;
  const input = h('input', { type: 'text', maxlength: 24, autocomplete: 'given-name', autocapitalize: 'words', placeholder: 'Your name', 'aria-label': 'Your name' });
  const status = h('p', { class: 'muted', role: 'status' });
  const go = h('button', { class: 'plate', onclick: save }, first ? 'Start' : 'Add player');

  async function save() {
    const name = cleanName(input.value);
    if (!name) {
      status.textContent = 'Type a name first. A first name is enough.';
      return input.focus();
    }
    if (app.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      status.textContent = `${name} is already a player on this phone. Pick another name, or switch to ${name} in Tuning.`;
      return;
    }
    go.disabled = true;
    const player = newPlayer(name);
    await app.store.savePlayers([...app.players, player]);
    // Routes and runs made before names existed belong to whoever names themselves first.
    if (first) await app.store.adoptOrphans(player.id);
    await app.usePlayer(player.id);
    if (location.hash === '#drive') app.show();
    else location.hash = '#drive';
  }

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });

  container.replaceChildren(h('div', { class: 'stack' },
    first ? [
      h('p', { class: 'eyebrow' }, 'A time trial on your own commute'),
      h('h1', { class: 'display' }, 'Beat your best. Keep to the limit.'),
      h('h2', { class: 'display' }, 'How it works'),
      stepList(HOW_IT_WORKS.map((s) => ({ ...s, body: h('p', {}, s.body) }))),
      h('h2', { class: 'display' }, 'Who is driving?'),
    ] : h('h1', { class: 'display' }, 'Add a player'),
    h('p', {}, first
      ? 'Your name goes on your routes, runs and any feedback you send. That is the whole account: no password, no sign-up.'
      : 'Each player keeps their own routes, runs and bests on this phone.'),
    input,
    go,
    status,
    first ? null : h('a', { href: '#tuning' }, 'Cancel'),
    h('h2', { class: 'display' }, 'Before you drive'),
    h('p', { class: 'muted' }, 'Set everything up while parked. Once armed, the game needs no touching: it starts, warns and finishes by itself with tones. The road rules come first; the game disqualifies speeding.'),
    h('p', { class: 'muted' }, PRIVACY_TEXT),
  ));
  // A new visitor reads first; the keyboard would cover the steps on a phone.
  if (!first) setTimeout(() => input.focus(), 100);
  return { unmount() {} };
}
