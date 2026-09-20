// Text for the screen and for the voice. The driver should never need to look.

import { BUCKET_LABELS } from './buckets.js';

// 754.2 → "12:34"; 3725 → "1:02:05"
export function formatDuration(s) {
  if (s == null) return '–:––';
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// -18.4 → "−0:18"; 42 → "+0:42"
export function formatDelta(s) {
  if (s == null) return '';
  return `${s < 0 ? '−' : '+'}${formatDuration(Math.abs(s))}`;
}

export function spokenDuration(s) {
  const total = Math.round(Math.abs(s));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  const parts = [];
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (sec || !m) parts.push(`${sec} second${sec === 1 ? '' : 's'}`);
  return parts.join(' ');
}

export function standingText(standing) {
  if (!standing) return '';
  return `Faster than ${standing.faster} of ${standing.total} of your runs in this bucket`;
}

// What the voice says at the finish line.
export function finishPhrase(run, summary) {
  const parts = [`Finished. ${spokenDuration(run.durationS)}.`];
  if (run.disqualified) {
    parts.push('Run disqualified for speeding. It does not count.');
    return parts.join(' ');
  }
  if (run.flags?.gap) {
    parts.push('GPS paused during this run, so it does not count.');
    return parts.join(' ');
  }
  const bucket = BUCKET_LABELS[run.bucket].toLowerCase();
  if (summary.firstInBucket) {
    parts.push(`First clean run for ${bucket}. That is your time to beat.`);
    const best = summary.fallback?.overallBest;
    if (best) {
      const d = run.durationS - best.durationS;
      parts.push(`${spokenDuration(d)} ${d < 0 ? 'faster' : 'slower'} than your best at any time of day.`);
    }
  } else if (summary.isBest) {
    parts.push(`New personal best for ${bucket}, by ${spokenDuration(summary.deltaS)}.`);
  } else {
    parts.push(`${spokenDuration(summary.deltaS)} behind your ${bucket} best.`);
  }
  if (summary.standing) {
    parts.push(`Faster than ${summary.standing.faster} of your ${summary.standing.total} earlier runs.`);
  }
  return parts.join(' ');
}
