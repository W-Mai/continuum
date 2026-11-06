// Autopilot: pure pursuit steering plus a curvature-limited target speed.
// Everything reads from the Track's cached samples, so it costs a handful of
// lookups per frame and works at any arc length.

import { clamp } from './car.js';

const LOOKAHEAD_BASE = 8;
const LOOKAHEAD_GAIN = 0.55;
const LOOKAHEAD_MIN = 10;
const LOOKAHEAD_MAX = 34;
const SPEED_SCAN = 46;
const GRIP = 1.05;
const G = 9.81;
const WHEELBASE = 2.7;
const MAX_STEER = 0.52;

export class Autopilot {
  constructor(track) {
    this.track = track;
    this.smoothSteer = 0;
    this.targetSpeed = 30;
  }

  // Steering is curvature feed-forward plus a cross-track correction. Pure
  // pursuit on its own lags through a corner and crosses the line on exit;
  // feeding the road's own curvature straight in removes that lag, and the
  // pursuit term only has to fix what is left.
  drive(dt, { s, x, z, yaw, speed, leadGap }) {
    const here = this.track.at(s);
    if (!here) {
      return { steer: 0, throttle: 0.2, brake: 0, targetSpeed: 0 };
    }

    const lookahead = clamp(LOOKAHEAD_BASE + speed * LOOKAHEAD_GAIN,
                            LOOKAHEAD_MIN, LOOKAHEAD_MAX);
    const target = this.track.at(s + lookahead) || here;

    const nx = -Math.sin(here.theta);
    const nz = Math.cos(here.theta);
    const crossTrack = (x - here.x) * nx + (z - here.z) * nz;
    let heading = yaw - here.theta;
    while (heading > Math.PI) heading -= 2 * Math.PI;
    while (heading < -Math.PI) heading += 2 * Math.PI;

    // Reference curvature at the car, plus pursuit geometry toward the aim
    // point so the controller still converges when it is far off the line.
    const refKappa = here.kappa;
    const dx = target.x - x;
    const dz = target.z - z;
    const localX = dx * Math.cos(yaw) + dz * Math.sin(yaw);
    const localZ = -dx * Math.sin(yaw) + dz * Math.cos(yaw);
    const distSq = Math.max(localX * localX + localZ * localZ, 1e-3);
    const pursuitKappa = (2 * localZ) / distSq;

    const blend = clamp(Math.abs(crossTrack) / 6, 0, 1);
    const kappa = refKappa * (1 - blend) + (refKappa + pursuitKappa) * blend;

    const steerFF = Math.atan(kappa * WHEELBASE);
    // Cross-track gain has to hold the car near the centre line at speed: at
    // 0.016 a 1.7 m offset only asked for 1.5 degrees of lock, so the car drifted
    // wide and its own body hid the asphalt under it. Heading damping rises with
    // the offset gain to keep this from overshooting.
    const steerCorr = -heading * 0.95 - crossTrack * 0.075;
    const steerAngle = steerFF + steerCorr;
    const command = clamp(steerAngle / MAX_STEER, -1, 1);

    this.smoothSteer += (command - this.smoothSteer) * clamp(dt * 14, 0, 1);

    const maxKappa = this.track.maxCurvatureAhead(s + 6, SPEED_SCAN);
    let vLimit = maxKappa > 1e-4
      ? Math.sqrt((GRIP * G) / maxKappa) * 0.86
      : 90;
    vLimit = clamp(vLimit, 9, 88);

    // A car in the same lane caps the target speed rather than making the
    // controller brake late: keep a two-second gap at whatever speed is left.
    if (leadGap !== undefined && leadGap !== null) {
      const gapCap = Math.max(6, leadGap - 8);
      vLimit = Math.min(vLimit, Math.max(4, gapCap / 1.6));
    }

    const err = vLimit - speed;
    const throttle = err > 1.5 ? clamp(err / 12, 0.15, 1) : err > 0 ? 0.22 : 0;
    const brake = err < -2.5 ? clamp(-err / 14, 0, 1) : 0;

    this.targetSpeed = vLimit;
    this.crossTrack = crossTrack;
    this.heading = heading;
    return { steer: this.smoothSteer, throttle, brake, targetSpeed: vLimit };
  }
}

export class Driver {
  constructor(target = window) {
    this.keys = new Set();
    this.padSteer = 0;
    this.padThrottle = 0;
    this.padBrake = 0;
    target.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());
  }

  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0;
      this.padSteer = Math.abs(ax) > 0.12 ? ax : 0;
      this.padThrottle = p.buttons[7] ? p.buttons[7].value : 0;
      this.padBrake = p.buttons[6] ? p.buttons[6].value : 0;
      return;
    }
    this.padSteer = 0;
    this.padThrottle = 0;
    this.padBrake = 0;
  }

  read() {
    this.pollPad();
    const k = this.keys;
    const up = k.has('KeyW') || k.has('ArrowUp');
    const down = k.has('KeyS') || k.has('ArrowDown');
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');

    let steer = (left ? -1 : 0) + (right ? 1 : 0);
    if (this.padSteer !== 0) steer = this.padSteer;

    let throttle = up ? 1 : 0;
    let brake = down ? 1 : 0;
    if (this.padThrottle > 0.02) throttle = this.padThrottle;
    if (this.padBrake > 0.02) brake = this.padBrake;

    return { steer, throttle, brake, anyInput: steer !== 0 || up || down };
  }
}
