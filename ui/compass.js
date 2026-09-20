// The phone's compass, so the guidance arrow turns with you on foot or while parked.
// In a moving car the GPS course is used instead: mounts and car bodies upset a compass.

const SMOOTHING = 0.35; // share of each new reading that is taken up

const screenAngle = () => screen.orientation?.angle ?? window.orientation ?? 0;

export class Compass {
  constructor() {
    this.heading = null; // degrees clockwise from north of the top of the screen
    this.status = 'off'; // 'off' | 'asking' | 'on' | 'denied' | 'unsupported'
    this._on = (e) => this._read(e);
  }

  // Call from a tap: iOS only shows its Motion & Orientation prompt during one.
  start() {
    if (!('DeviceOrientationEvent' in window)) {
      this.status = 'unsupported';
      return;
    }
    const listen = () => {
      this.status = 'on';
      window.addEventListener('deviceorientationabsolute', this._on);
      window.addEventListener('deviceorientation', this._on);
    };
    const ask = DeviceOrientationEvent.requestPermission;
    if (typeof ask !== 'function') return listen();
    this.status = 'asking';
    try {
      ask.call(DeviceOrientationEvent)
        .then((answer) => (answer === 'granted' ? listen() : (this.status = 'denied')))
        .catch(() => (this.status = 'denied'));
    } catch {
      this.status = 'denied';
    }
  }

  _read(e) {
    let north = null;
    if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) {
      north = e.webkitCompassHeading; // iOS: heading of the top of the phone
    } else if (e.absolute && e.alpha != null) {
      north = 360 - e.alpha;
    }
    if (north == null) return;
    const reading = (north + screenAngle() + 360) % 360; // phone sideways: the top of the screen is its side
    if (this.heading == null) this.heading = reading;
    else {
      const diff = ((reading - this.heading + 540) % 360) - 180;
      this.heading = (this.heading + diff * SMOOTHING + 360) % 360;
    }
  }

  stop() {
    window.removeEventListener('deviceorientationabsolute', this._on);
    window.removeEventListener('deviceorientation', this._on);
    if (this.status === 'on') this.status = 'off';
  }
}
