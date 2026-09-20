// Sound cues: plain tones, no voice. The driver listens; the screen is a backup.
// Browsers only allow sound after a tap, so unlock() must run from the Arm button.

const TONES = {
  // [frequency Hz, start s, duration s, waveform, gain]
  ready: [[880, 0, 0.12, 'sine', 0.5]],
  go: [[660, 0, 0.13, 'triangle', 0.7], [990, 0.16, 0.22, 'triangle', 0.7]],
  caution: [[740, 0, 0.11, 'sine', 0.55], [740, 0.2, 0.11, 'sine', 0.55]],
  warning: [[1320, 0, 0.09, 'square', 0.45], [1320, 0.16, 0.09, 'square', 0.45], [1320, 0.32, 0.09, 'square', 0.45]],
  dq: [[440, 0, 0.2, 'sawtooth', 0.5], [330, 0.22, 0.2, 'sawtooth', 0.5], [220, 0.44, 0.4, 'sawtooth', 0.5]],
  finish: [[523, 0, 0.14, 'triangle', 0.7], [784, 0.16, 0.3, 'triangle', 0.7]],
  best: [[523, 0, 0.12, 'triangle', 0.7], [659, 0.13, 0.12, 'triangle', 0.7], [784, 0.26, 0.12, 'triangle', 0.7], [1047, 0.39, 0.12, 'triangle', 0.7], [1319, 0.52, 0.4, 'triangle', 0.7]],
  gap: [[300, 0, 0.18, 'sine', 0.6], [300, 0.26, 0.18, 'sine', 0.6]],
};

export class Cues {
  constructor({ mode = 'mix' } = {}) {
    this.mode = mode; // 'mix' plays over your music; 'takeover' also sounds with the ringer switch off
    this.ctx = null;
  }

  configure({ mode }) {
    if (mode) this.mode = mode;
    this._applySession();
  }

  _applySession() {
    // iOS 16.4+. 'transient' mixes with other apps and follows the ringer switch; 'playback' ignores it.
    try {
      if (navigator.audioSession) navigator.audioSession.type = this.mode === 'takeover' ? 'playback' : 'transient';
    } catch { /* not supported */ }
  }

  // Call from a tap.
  unlock() {
    this._applySession();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC && !this.ctx) this.ctx = new AC();
    this.ctx?.resume?.();
    return !!this.ctx;
  }

  // Returns the cue's length in seconds.
  play(name) {
    const tones = TONES[name];
    if (!tones || !this.ctx) return 0;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const t0 = this.ctx.currentTime + 0.02;
    let end = 0;
    for (const [freq, start, dur, type, gain] of tones) {
      const osc = this.ctx.createOscillator();
      const amp = this.ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      amp.gain.setValueAtTime(0, t0 + start);
      amp.gain.linearRampToValueAtTime(gain, t0 + start + 0.01);
      amp.gain.setValueAtTime(gain, t0 + start + dur - 0.03);
      amp.gain.linearRampToValueAtTime(0, t0 + start + dur);
      osc.connect(amp).connect(this.ctx.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur + 0.02);
      end = Math.max(end, start + dur);
    }
    return end;
  }
}
