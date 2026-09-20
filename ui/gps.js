// Live GPS and the screen wake lock. A browser only gets GPS while the page is visible.

export class LiveGps {
  constructor() {
    this.watchId = null;
  }

  static get supported() {
    return 'geolocation' in navigator;
  }

  start(onFix, onError) {
    this.stop();
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        const now = Date.now();
        onFix({
          // A few WebKit builds report odd timestamps; trust the clock if they disagree wildly.
          t: Math.abs(pos.timestamp - now) < 300000 ? pos.timestamp : now,
          lat: c.latitude,
          lon: c.longitude,
          speed: c.speed == null || Number.isNaN(c.speed) || c.speed < 0 ? null : c.speed,
          heading: c.heading == null || Number.isNaN(c.heading) ? null : c.heading,
          accuracy: c.accuracy,
        });
      },
      (err) => onError?.(err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
  }

  stop() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  now() {
    return Date.now();
  }
}

export function gpsErrorText(err) {
  if (err?.code === 1) return 'Location is blocked. Allow it for this site in Settings → Safari → Location, then reload.';
  if (err?.code === 2) return 'No GPS signal yet. Move somewhere with a view of the sky.';
  if (err?.code === 3) return 'GPS is taking too long to answer. Still trying.';
  return 'Location is unavailable.';
}

export class ScreenLock {
  // onChange(held) fires whenever the lock is gained or lost, so the HUD can say so.
  constructor(onChange = () => {}) {
    this.sentinel = null;
    this.wanted = false;
    this.onChange = onChange;
    this._onVisible = () => {
      if (this.wanted && document.visibilityState === 'visible') this.acquire();
    };
    document.addEventListener('visibilitychange', this._onVisible);
  }

  static get supported() {
    return 'wakeLock' in navigator;
  }

  async acquire() {
    this.wanted = true;
    if (!ScreenLock.supported) return this._report(false);
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      if (!this.wanted) {
        // The run ended while iOS was still answering: do not keep the screen on afterwards.
        sentinel.release().catch(() => {});
        return false;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.sentinel !== sentinel) return; // released by us
        this.sentinel = null;
        this._report(false);
        // The system drops the lock when the page is hidden, and sometimes on its own. Take it back.
        if (this.wanted && document.visibilityState === 'visible') {
          setTimeout(() => { if (this.wanted && !this.sentinel) this.acquire(); }, 1000);
        }
      });
      return this._report(true);
    } catch {
      return this._report(false);
    }
  }

  _report(held) {
    this.onChange(held);
    return held;
  }

  release() {
    this.wanted = false;
    const sentinel = this.sentinel;
    this.sentinel = null;
    sentinel?.release?.().catch(() => {});
  }

  dispose() {
    this.release();
    document.removeEventListener('visibilitychange', this._onVisible);
  }
}
