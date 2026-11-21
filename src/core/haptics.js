// What the drive does in the hands. A gamepad rumbles (its dual-rumble effect:
// a weak motor and a strong one, each 0..1, for so many milliseconds) and a
// phone buzzes (navigator.vibrate, in milliseconds); a keyboard has nothing to
// shake, and a car on its autopilot has nobody holding it, so nothing happens
// there. What shakes it is told by the game: a landing, a hit, an animal
// struck, and every frame what the tyres are doing.
//
//                  weak motor              strong motor        how long
//   landing        0.3                     min(1, fall / 8)    180 ms
//   a hit          0.6                     min(1, speed / 12)  250 ms
//   an animal      0.4                     0.5                 120 ms
//   off the road   0.15 + 0.2 * speed / 30 0                   kept up every 100 ms
//   tyres sliding  0.25                    0                   kept up every 100 ms
//
// A phone buzzes for a landing (40 ms) and a hit (80 ms) and for nothing else.
// The clock is the one the game gives (update's dt), not the wall's.

export const RUMBLE = {
  land: { weak: 0.3, strongAt: 8, ms: 180 },
  hit: { weak: 0.6, strongAt: 12, ms: 250 },
  animal: { weak: 0.4, strong: 0.5, ms: 120 },
  off: { base: 0.15, gain: 0.2, at: 30, minSpeed: 1 },
  slip: { weak: 0.25, from: 0.08 },
  every: 0.1,    // s between the renewals of what goes on
  last: 120,     // ms each renewal lasts, a little over the 100 between them so that they run into one another
};
export const BUZZ = { land: 40, hit: 80 };

const buzzNow = (ms) => {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(ms);
  } catch { /* a browser that will not */ }
};

export class Haptics {
  // actuator(): the gamepad's motors now, or null. device(): what last gave
  // input ('pad', 'touch' or 'key'). buzz(ms): a phone's vibration.
  constructor({ actuator = () => null, device = () => 'key', buzz = buzzNow } = {}) {
    this.actuator = actuator;
    this.device = device;
    this.buzz = buzz;
    this.on = true;          // the visitor's choice (the settings; off by default when the system asks for less motion)
    this.driving = false;    // by hand: the autopilot has nobody to tell
    this.t = 0;              // s, the game's
    this._busy = 0;          // until when a landing or a hit is being felt
    this._next = 0;          // when what goes on is to be renewed
    this._live = false;      // whether the motors may be running
    this.plays = 0;          // rumbles and buzzes made, for the checks
  }

  // Who is to feel it: 'pad' (a gamepad with motors, in use), 'phone' (a touch
  // screen, with a vibrator), or null.
  target() {
    if (!this.on || !this.driving) return null;
    const d = this.device();
    if (d === 'pad' && this.actuator()) return 'pad';
    if (d === 'touch' && typeof navigator !== 'undefined' && navigator.vibrate) return 'phone';
    return null;
  }

  _play(weak, strong, ms) {
    const a = this.actuator();
    if (!a || !a.playEffect) return false;
    try {
      const p = a.playEffect('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: Math.min(1, weak), strongMagnitude: Math.min(1, strong) });
      if (p && p.catch) p.catch(() => {});
    } catch { return false; }
    this._live = true;
    this.plays++;
    return true;
  }

  _shot(weak, strong, ms, buzz) {
    const who = this.target();
    if (who === 'pad') {
      this._busy = this.t + ms / 1000;
      return this._play(weak, strong, ms);
    }
    if (who === 'phone' && buzz > 0) {
      this.buzz(buzz);
      this.plays++;
      return true;
    }
    return false;
  }

  // The car came down from `speed` m/s of fall.
  land(speed) {
    const k = RUMBLE.land;
    return this._shot(k.weak, Math.min(1, speed / k.strongAt), k.ms, BUZZ.land);
  }

  // The car was hit, or hit something, at `speed` m/s of closing.
  hit(speed) {
    const k = RUMBLE.hit;
    return this._shot(k.weak, Math.min(1, speed / k.strongAt), k.ms, BUZZ.hit);
  }

  // The car ran into an animal.
  animal() {
    const k = RUMBLE.animal;
    return this._shot(k.weak, k.strong, k.ms, 0);
  }

  // Every frame, dt s on: what the tyres are doing. `off`: the car is off the
  // road's platform; `air`: it is in the air; `speed` m/s; `slip` 0..1 how hard
  // the tyres slide (what lays the skid marks).
  update(dt, { off = false, air = false, speed = 0, slip = 0 } = {}) {
    this.t += dt;
    if (this.target() !== 'pad') {
      this.stop();
      return;
    }
    if (this.t < this._next || this.t < this._busy) return;
    let weak = 0;
    if (off && !air && speed > RUMBLE.off.minSpeed) weak = RUMBLE.off.base + RUMBLE.off.gain * speed / RUMBLE.off.at;
    if (slip > RUMBLE.slip.from && !air) weak = Math.max(weak, RUMBLE.slip.weak);
    if (weak > 0 && this._play(weak, 0, RUMBLE.last)) this._next = this.t + RUMBLE.every;
  }

  // The motors are let go of (the car is given back to the autopilot, or the
  // visitor has asked for none).
  stop() {
    if (!this._live) return;
    this._live = false;
    const a = this.actuator();
    try {
      if (a && a.reset) {
        const p = a.reset();
        if (p && p.catch) p.catch(() => {});
      }
    } catch { /* gone */ }
  }
}
