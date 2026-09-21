// Getting started: the numbered steps a new player sees, as road signs. Blue disc = do this now,
// green tick = done, grey = later. The welcome screen uses the same list as an overview.

import { h } from './dom.js';
import { gettingStarted } from '../src/guide.js';

// steps: [{ title, state?, body? }]. body: text or elements shown under the title.
export function stepList(steps) {
  return h('ol', { class: 'steps' }, steps.map((s, i) => h('li', { dataset: { state: s.state || 'info' } },
    h('span', { class: 'step-no', 'aria-hidden': 'true' }, s.state === 'done' ? '✓' : String(i + 1)),
    h('div', {},
      h('p', { class: 'step-title' }, s.title, s.state === 'done' ? h('span', { class: 'muted', style: 'font:inherit' }, ' · done') : null),
      s.body ? h('div', { class: 'step-body' }, s.body) : null))));
}

export const guideFor = (app) => gettingStarted({
  player: app.player, routes: app.routes, runs: app.runs,
  hidden: !!app.settings.guideHidden?.[app.player?.id],
});

export async function setGuideHidden(app, hidden) {
  const map = { ...(app.settings.guideHidden || {}) };
  if (hidden) map[app.player.id] = true;
  else delete map[app.player.id];
  app.settings = { ...app.settings, guideHidden: map };
  await app.store.saveSettings(app.settings);
}

// The card on Drive. bodies: { markers, drive } → what to show under the step that is current.
export function guideCard(app, guide, bodies, onHide) {
  return h('section', { class: 'guide-card', 'aria-label': 'Getting started' },
    h('div', { class: 'hud-top' },
      h('p', { class: 'eyebrow' }, `Getting started · step ${guide.stepNo} of ${guide.total}`),
      h('button', { class: 'linklike', onclick: async () => { await setGuideHidden(app, true); onHide(); } }, 'Hide')),
    stepList(guide.steps.map((s) => ({ ...s, body: s.state === 'now' ? bodies[s.key] : null }))));
}
