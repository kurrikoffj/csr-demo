// Who is driving? A name is the whole account: no password, no sign-up, nothing sent anywhere.
// Shown on first open, and again from Tuning to add another player on the same phone.

import { h } from './dom.js';
import { newPlayer, cleanName } from '../src/profile.js';

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
    h('h1', { class: 'display' }, first ? 'Who is driving?' : 'Add a player'),
    h('p', {}, first
      ? 'Your name goes on your routes, runs and any feedback you send. That is the whole account: no password, no sign-up.'
      : 'Each player keeps their own routes, runs and bests on this phone.'),
    input,
    go,
    status,
    first ? null : h('a', { href: '#tuning' }, 'Cancel'),
    h('h2', { class: 'display' }, 'Before you drive'),
    h('p', { class: 'muted' }, 'Set everything up while parked. Once armed, the game needs no touching: it starts, warns and finishes by itself with tones. The road rules come first; the game disqualifies speeding.'),
    h('p', { class: 'muted' }, 'Everything stays on this phone. Nothing is uploaded. If you send feedback, you choose who gets it and what goes with it.'),
  ));
  setTimeout(() => input.focus(), 100);
  return { unmount() {} };
}
