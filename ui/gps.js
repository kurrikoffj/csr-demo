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
  constructor() {
    this.sentinel = null;
    this.wanted = false;
    document.addEventListener('visibilitychange', () => {
      if (this.wanted && document.visibilityState === 'visible') this.acquire();
    });
  }

  static get supported() {
    return 'wakeLock' in navigator;
  }

  // The lock is dropped whenever the page is hidden, so it is re-taken when it comes back.
  async acquire() {
    this.wanted = true;
    if (!ScreenLock.supported) return false;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      return true;
    } catch {
      return false;
    }
  }

  release() {
    this.wanted = false;
    this.sentinel?.release?.().catch(() => {});
    this.sentinel = null;
  }
}
