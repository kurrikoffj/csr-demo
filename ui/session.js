// One armed drive: wires a location source (live GPS or a replayed trace) to the engine,
// turns engine events into sound cues, and saves the result.

import { RunEngine } from '../src/runEngine.js';
import { Matcher } from '../src/matcher.js';
import { summarize } from '../src/records.js';
import { playFixes } from '../src/replay.js';
import { LiveGps, ScreenLock, gpsErrorText } from './gps.js';

const ABORT_TEXT = {
  gps_gap: 'Run stopped. GPS was paused for too long. Keep this page open and the screen on.',
  stationary: 'Run stopped after standing still for too long.',
  manual: 'Run cancelled.',
};

export class Session {
  // app: { route, index, tunables, runs, store, cues }. onChange: redraw. onEnd(result, summary, fixes).
  constructor(app, { onChange, onEnd }) {
    this.app = app;
    this.onChange = onChange;
    this.onEnd = onEnd;
    this.engine = new RunEngine({
      route: app.route,
      tunables: app.tunables,
      matcher: app.index ? new Matcher(app.index, app.tunables) : null,
      onEvent: (evt) => this._onEvent(evt),
    });
    this.source = null;
    this.lock = new ScreenLock((held) => {
      this.screenAwake = held;
      this.onChange();
    });
    this.demo = null; // { save } while replaying
    this.notice = '';
    this.screenAwake = null;
    this._ticker = null;
    this._gpsReadySaid = false;
  }

  get active() {
    return this.engine.state === 'armed' || this.engine.state === 'running';
  }

  now() {
    return this.source ? this.source.now() : Date.now();
  }

  hud() {
    return this.engine.hud(this.now());
  }

  // direction: 'ab' | 'ba' picked on the Drive screen.
  armLive({ direction = null } = {}) {
    this.demo = null;
    this.app.cues.unlock();
    this.engine.arm({ direction });
    this.source = new LiveGps();
    this.source.start(
      (fix) => this._onFix(fix),
      (err) => {
        this.notice = gpsErrorText(err);
        this.onChange();
      },
    );
    this.lock.acquire();
    this._startTicker();
  }

  // Replay a trace through the same pipeline. save: keep the result in history (tagged as a demo).
  armReplay(fixes, { rate = 8, save = false, direction = null } = {}) {
    this.demo = { save };
    this.app.cues.unlock();
    this.engine.arm({ direction });
    const player = playFixes(fixes, (fix) => this._onFix(fix), {
      rate,
      onDone: () => {
        if (this.active) this.stop('Replay ended before the finish line.');
      },
    });
    this.source = { now: player.now, stop: player.stop };
    this.lock.acquire(); // a replay outlasts the phone's auto-lock, so it doubles as the keep-awake test
    this._startTicker();
  }

  // Disarm, or cancel a run in progress.
  stop(notice = '') {
    this.notice = notice;
    this.engine.cancel();
    if (this.engine.state !== 'aborted') this._teardown();
    this.onChange();
  }

  _startTicker() {
    clearInterval(this._ticker);
    this._ticker = setInterval(() => {
      this.engine.tick(this.now());
      this.onChange();
    }, 250);
  }

  _teardown() {
    clearInterval(this._ticker);
    this._ticker = null;
    this.source?.stop();
    this.lock.dispose();
  }

  _onFix(fix) {
    this.notice = '';
    this.engine.onFix(fix);
    if (!this._gpsReadySaid && this.engine.state === 'armed' && this.engine.hud(fix.t).gps === 'ok') {
      this._gpsReadySaid = true;
      this.app.cues.play('ready');
    }
    this.onChange();
  }

  _onEvent(evt) {
    const { cues } = this.app;
    switch (evt.type) {
      case 'started':
        cues.play('go');
        break;
      case 'caution':
        cues.play('caution');
        break;
      case 'warning':
        cues.play('warning');
        break;
      case 'disqualified':
        cues.play('dq');
        break;
      case 'gap':
        cues.play('gap');
        break;
      case 'finished':
      case 'aborted':
        this._end(evt);
        break;
    }
  }

  async _end(evt) {
    this._teardown();
    const { app } = this;
    const result = { ...evt.result, demo: !!this.demo };
    const fixes = this.engine.trace.slice();
    const summary = summarize(result, [...app.runs, result], {
      now: result.startT,
      windowDays: app.tunables.recordWindowDays,
    });
    if (evt.type === 'finished') app.cues.play(summary.isBest && !summary.firstInBucket ? 'best' : result.clean ? 'finish' : 'dq');
    else {
      this.notice = ABORT_TEXT[evt.reason] || 'Run stopped.';
      if (evt.reason !== 'manual') app.cues.play('gap');
    }
    if (!this.demo || this.demo.save) {
      try {
        await app.store.saveRun(result, fixes);
        app.runs = await app.store.runs();
      } catch (err) {
        this.notice = `Could not save this run: ${err.message}`;
      }
    }
    this.onEnd(result, summary, fixes);
  }
}
