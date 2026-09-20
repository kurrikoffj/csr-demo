import { DEFAULTS } from './tunables.js';

export const BUCKETS = ['wd_am', 'wd_mid', 'wd_pm', 'wd_eve', 'we_day', 'we_night'];

export const BUCKET_LABELS = {
  wd_am: 'Weekday AM rush',
  wd_mid: 'Weekday midday',
  wd_pm: 'Weekday PM rush',
  wd_eve: 'Weekday evening',
  we_day: 'Weekend day',
  we_night: 'Weekend night',
};

// Bucket of a run, from its local start time.
export function bucketFor(date, cfg = DEFAULTS.buckets) {
  const day = date.getDay();
  const mins = date.getHours() * 60 + date.getMinutes();
  if (day === 0 || day === 6) {
    return mins >= cfg.weekendDayStart && mins < cfg.weekendDayEnd ? 'we_day' : 'we_night';
  }
  if (mins >= cfg.amStart && mins < cfg.amEnd) return 'wd_am';
  if (mins >= cfg.amEnd && mins < cfg.middayEnd) return 'wd_mid';
  if (mins >= cfg.middayEnd && mins < cfg.pmEnd) return 'wd_pm';
  return 'wd_eve';
}
