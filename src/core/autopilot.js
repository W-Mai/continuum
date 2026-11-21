// Autopilot and manual input.
//
// Steering is curvature feed-forward taken a little ahead of the car (the
// steering rack and the tyres lag), plus heading and cross-track feedback that
// hold the car in its lane. Speed is planned, not reacted to: every bend in the
// next 260 m sets a ceiling at the car's position through the braking distance
// it needs, so the car is already slow when it reaches a hairpin instead of
// braking in it.

import { clamp } from './car.js';
import { LANE } from '../world/road.js';

const WHEELBASE = 2.7;
const MAX_STEER = 0.52;
const G = 9.81;

export class Autopilot {
  constructor(road, opts = {}) {
    this.road = road;
    this.smoothSteer = 0;
    this.targetSpeed = 20;
    this.lane = LANE;
    this.lateralG = opts.lateralG || 0.42;   // a brisk but unhurried driver
    // Planned braking is gentler than the car can brake, so the controller
    // always has margin to stay on the braking curve.
    this.brakeDecel = opts.brakeDecel || 2.8;
    this.vMax = opts.vMax || 27;              // ~97 km/h on a mountain road
    this.crossTrack = 0;
    this.heading = 0;
    this.mode = 'hold';
  }

  // Highest speed at arc length s that still lets the car take every bend in
  // the window ahead at the chosen lateral acceleration.
  speedLimit(s) {
    let v = this.vMax;
    for (let d = 0; d <= 260; d += 4) {
      const p = this.road.at(s + d);
      if (!p) break;
      const k = Math.abs(p.kappa);
      if (k > 1e-4) {
        const vc = Math.sqrt(this.lateralG * G / k);
        v = Math.min(v, Math.sqrt(vc * vc + 2 * this.brakeDecel * d));
      }
      // Steep descents are taken a little slower (not where the road rolls on
      // purpose: there the car is meant to fly).
      if (d < 40 && p.grade < -0.06 && !p.roll) v = Math.min(v, this.vMax * (1 + (p.grade + 0.06) * 3));
    }
    return v;
  }

  drive(dt, { s, x, z, yaw, speed, leadGap, leadSpeed }) {
    const road = this.road;
    const here = road.at(s);
    if (!here) return { steer: 0, throttle: 0, brake: 1, targetSpeed: 0 };

    const nx = -Math.sin(here.theta);
    const nz = Math.cos(here.theta);
    const crossTrack = (x - here.x) * nx + (z - here.z) * nz;
    let heading = yaw - here.theta;
    while (heading > Math.PI) heading -= 2 * Math.PI;
    while (heading < -Math.PI) heading += 2 * Math.PI;

    // Feed-forward from the curvature slightly ahead, and from the lane's own
    // radius: the right lane of a left bend is a tighter circle than the axis.
    const preview = road.at(s + clamp(speed * 0.3, 1.5, 9)) || here;
    const k = preview.kappa / Math.max(0.2, 1 - preview.kappa * this.lane);
    const latErr = clamp(crossTrack - this.lane, -4, 4);
    const steerAngle = Math.atan(k * WHEELBASE) - heading * 1.0 - latErr * 0.09;
    const command = clamp(steerAngle / MAX_STEER, -1, 1);
    this.smoothSteer += (command - this.smoothSteer) * clamp(dt * 16, 0, 1);

    let vLimit = this.speedLimit(s);
    // Keep a two-second gap to the car ahead in this lane.
    if (leadGap !== null && leadGap !== undefined) {
      const gap = Math.max(0, leadGap - 6);
      const lead = leadSpeed || 0;
      vLimit = Math.min(vLimit, Math.max(0, lead + (gap - Math.max(8, speed * 2)) * 0.35));
    }

    const err = vLimit - speed;
    const throttle = err > 0.5 ? clamp(err / 6, 0.08, 1) : 0;
    const brake = err < -0.4 ? clamp(-err / 3.5, 0, 1) : 0;

    this.targetSpeed = vLimit;
    this.crossTrack = crossTrack;
    this.heading = heading;
    return { steer: this.smoothSteer, throttle, brake, targetSpeed: vLimit };
  }
}

// How a stick or a finger steers. A push of less than `deadzone` (of the whole
// travel) is nothing; past it the push is raised to the curve's power (linear:
// the push itself; soft: its 1.6th power, so that small pushes are small
// turns of the wheel) and multiplied by `sens`. The keys are not a push and
// are left as they are, but for how long they take to come to full lock and
// to let go of it (EASES: seconds each way; instant is the keys as they have
// always been, the car's own steering rack the only thing between a key and
// the wheel).
export const FEEL = { deadzone: 0.08, curve: 'soft', sens: 1 };
export const CURVES = { linear: 1, soft: 1.6 };
export const EASES = { instant: [0, 0], soft: [0.18, 0.12], softer: [0.35, 0.25] };
export const EASE_DEFAULT = 'instant';

const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// What the driver's hands are on, and what they give: the keys, a gamepad, a
// touch screen (ui/touch.js writes `touch`). `device` is the one that gave
// input last, which the touch controls and the rumble go by.
export class Driver {
  constructor(target = window) {
    this.keys = new Set();
    this.padSteer = 0;      // the stick as it is, -1..1: read() shapes it
    this.padThrottle = 0;
    this.padBrake = 0;
    this.pad = null;        // the gamepad being read, for its rumble
    // What a touch screen gives (ui/touch.js): a finger on the steering place
    // (steering) and how far it has been dragged (steer, -1..1, the drag over
    // the length that is full lock); the pedals as pressed, 0..1.
    this.touch = { steering: false, steer: 0, throttle: 0, brake: 0 };
    this.feel = { deadzone: FEEL.deadzone, exponent: CURVES[FEEL.curve], sens: FEEL.sens };
    this.ease = EASES[EASE_DEFAULT];
    this.keySteer = 0;      // where the keys have the wheel, -1..1
    this.device = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 ? 'touch' : 'key';
    target.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      this.device = 'key';
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());
  }

  // The feel of the stick and the finger: { deadzone, curve, sens }, whichever
  // of them are given (a value that is not one is left as it was).
  setFeel({ deadzone, curve, sens } = {}) {
    const f = this.feel;
    if (Number.isFinite(deadzone)) f.deadzone = clampTo(deadzone, 0, 0.5);
    if (curve in CURVES) f.exponent = CURVES[curve];
    if (Number.isFinite(sens)) f.sens = clampTo(sens, 0.2, 2);
  }

  // How the keys come to full lock and let go of it: a name of EASES.
  setEase(name) {
    if (name in EASES) this.ease = EASES[name];
  }

  // The pull on a stick or a finger (-1..1) as the car is steered by it.
  shape(x) {
    const a = Math.abs(x);
    const f = this.feel;
    if (!(a > f.deadzone)) return 0;
    const v = Math.min(1, Math.pow(Math.min(1, a), f.exponent) * f.sens);
    return x < 0 ? -v : v;
  }

  // The rumble motors of the gamepad in the hand, if it has them.
  get actuator() {
    return (this.pad && this.pad.vibrationActuator) || null;
  }

  // Hands off: what was held is let go (the car is taken over, or given back).
  reset() {
    this.keySteer = 0;
    this.touch.steering = false;
    this.touch.steer = 0;
    this.touch.throttle = 0;
    this.touch.brake = 0;
  }

  pollPad() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      this.pad = p;
      this.padSteer = p.axes[0] || 0;
      this.padThrottle = p.buttons[7] ? p.buttons[7].value : 0;
      this.padBrake = p.buttons[6] ? p.buttons[6].value : 0;
      if (this.shape(this.padSteer) !== 0 || this.padThrottle > 0.02 || this.padBrake > 0.02) this.device = 'pad';
      return;
    }
    this.pad = null;
    this.padSteer = 0;
    this.padThrottle = 0;
    this.padBrake = 0;
  }

  // The keys' wheel, dt seconds on: it goes to where the keys want it at the
  // pace of the ease (at once with no dt, or no ease).
  _wheel(want, dt) {
    const [rise, fall] = this.ease;
    const time = want === 0 ? fall : rise;
    if (!(time > 0) || !(dt > 0)) {
      this.keySteer = want;
    } else {
      const v = this.keySteer;
      const step = dt / time;
      this.keySteer = want > v ? Math.min(want, v + step) : Math.max(want, v - step);
    }
    return this.keySteer;
  }

  // dt: the seconds since the last read, for the keys' ease.
  read(dt = 0) {
    this.pollPad();
    const k = this.keys;
    const up = k.has('KeyW') || k.has('ArrowUp');
    const down = k.has('KeyS') || k.has('ArrowDown');
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');
    const t = this.touch;

    let steer = this._wheel((left ? -1 : 0) + (right ? 1 : 0), dt);
    const pad = this.shape(this.padSteer);
    if (pad !== 0) steer = pad;
    if (t.steering) steer = this.shape(t.steer);

    let throttle = up ? 1 : 0;
    let brake = down ? 1 : 0;
    if (this.padThrottle > 0.02) throttle = this.padThrottle;
    if (this.padBrake > 0.02) brake = this.padBrake;
    if (t.throttle > 0) throttle = t.throttle;
    if (t.brake > 0) brake = t.brake;

    return { steer, throttle, brake, anyInput: steer !== 0 || throttle > 0 || brake > 0 };
  }
}
