// Send feedback: your words plus a few counts, through the phone's share sheet.
// You pick who gets it. Runs and routes only go along if you tick the box.

import { h } from './dom.js';
import { feedbackText, cleanNote, runTally } from '../src/profile.js';
import { BUILD } from '../version.js';

export function mountFeedback(container, app) {
  const note = h('textarea', { rows: 7, maxlength: 4000, placeholder: 'What felt good? What felt wrong or unfair? Anything confusing?', 'aria-label': 'Your feedback' });
  const attach = h('input', { type: 'checkbox' });
  const status = h('p', { class: 'muted', role: 'status' });
  const t = runTally(app.runs);

  async function send() {
    const text = feedbackText({
      player: app.player, build: BUILD, routes: app.routes, runs: app.runs, note: note.value,
      device: (navigator.userAgent.match(/\(([^)]+)\)/) || [])[1] || '',
    });
    const files = [];
    if (attach.checked) {
      // The words ride inside the file too: some apps drop the message when a file is attached.
      const data = await app.store.exportPlayer(app.player, { feedback: { note: cleanNote(note.value), build: BUILD, sentAt: new Date().toISOString() } });
      files.push(new File([JSON.stringify(data)], `csr-demo-${app.player.name.replace(/\W+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' }));
    }
    try {
      if (files.length && navigator.canShare?.({ files })) await navigator.share({ title: 'CSR Demo feedback', text, files });
      else if (navigator.share) {
        await navigator.share({ title: 'CSR Demo feedback', text });
        if (files.length) status.textContent = 'This browser cannot attach files to a share. Use Export data in Tuning and send that file separately.';
      } else {
        await navigator.clipboard.writeText(text);
        status.textContent = 'Copied. Paste it into a message to whoever gave you this game.';
        return;
      }
      status.textContent = 'Thanks. Sent on its way.';
    } catch (err) {
      if (err?.name !== 'AbortError') status.textContent = 'Could not open the share sheet. Select the text below, copy it and send it yourself.';
      preview.hidden = false;
      preview.textContent = text;
    }
  }

  const preview = h('pre', { class: 'data', hidden: true, style: 'white-space:pre-wrap;user-select:all;font-size:13px' });

  container.replaceChildren(h('div', { class: 'stack' },
    h('h1', { class: 'display' }, 'Send feedback'),
    h('p', {}, `From ${app.player.name}. You have ${t.total} real ${t.total === 1 ? 'run' : 'runs'} so far, ${t.clean} clean.`),
    note,
    h('label', { class: 'field' }, h('span', {}, 'Attach my routes and runs'), attach,
      h('small', {}, 'Helps tune the rules, but the file shows where you drove, including your start and finish points. Leave it off if you would rather not share that.')),
    h('button', { class: 'plate', onclick: send }, 'Send'),
    status,
    preview,
    h('p', { class: 'muted' }, 'This opens your phone’s share sheet. You choose the app and the person. Without the attachment it sends only your name, the build, how many runs you have made and your words.'),
    h('a', { href: '#tuning' }, 'Back to Tuning'),
  ));
  return { unmount() {} };
}
