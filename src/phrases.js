// Text for the screen.

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

export function standingText(standing) {
  if (!standing) return '';
  return `Faster than ${standing.faster} of ${standing.total} of your runs in this bucket`;
}
