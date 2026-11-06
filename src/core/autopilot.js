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

// Lane geometry, shared with the traffic stream.
export const LANE = 3.0;
const ROAD_HALF = 4.8;

export class Autopilot {
  constructor(track) {
    this.track = track;
    this.smoothSteer = 0;
    this.targetSpeed = 30;

    // Overtaking runs as a small state machine so a manoeuvre commits and then
    // finishes, instead of oscillating in and out of the oncoming lane.
    this.mode = 'hold';      // hold | pull-out | passing | tuck-in
    this.modeTime = 0;
    // Start on the centreline: the car spawns there, so beginning the target in
    // the lane would make it chase a 3 m error from frame one and swing wide.
    this.laneTarget = 0;
    this.passes = 0;
  }

  // Steering is curvature feed-forward plus a cross-track correction. Pure
  // pursuit on its own lags through a corner and crosses the line on exit;
  // feeding the road's own curvature straight in removes that lag, and the
  // pursuit term only has to fix what is left.
  drive(dt, { s, x, z, yaw, speed, leadGap, oncomingGap, leadSpeed, passClear, leadBehind, signal, route }) {
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

    // Lane discipline first: the car drives in its own lane, not on the
    // centreline. Everything below is a deviation from that.
    this.modeTime += dt;
    this.leadBehind = !!leadBehind;
    const wantPass = leadGap !== null && leadGap !== undefined
      && leadGap < 48 && speed > 14
      && (leadSpeed === undefined || leadSpeed === null || leadSpeed < speed - 1.5);

    switch (this.mode) {
      case 'hold':
        if (wantPass && passClear) {
          this.mode = 'pull-out';
          this.modeTime = 0;
        }
        break;

      case 'pull-out':
        if (this.modeTime > 1.2) {
          this.mode = 'passing';
          this.modeTime = 0;
        }
        if (oncomingGap !== null && oncomingGap !== undefined && oncomingGap < 14) {
          this.mode = 'tuck-in';
          this.modeTime = 0;
        }
        break;

      case 'passing':
        // The pass ends when the other car is behind us, not when the gap opens.
        // At the start of the manoeuvre the gap is already 40 m, so keying on "the
        // gap grew" ended the pass before it began.
        if (this.leadBehind) {
          this.mode = 'tuck-in';
          this.modeTime = 0;
          this.passes++;
        } else if (oncomingGap !== null && oncomingGap !== undefined && oncomingGap < 11) {
          this.mode = 'tuck-in';
          this.modeTime = 0;
        } else if (this.modeTime > 12) {
          // The car ahead outran us: give up rather than sit in the wrong lane.
          this.mode = 'tuck-in';
          this.modeTime = 0;
        }
        break;

      case 'tuck-in':
        if (this.modeTime > 1.0) {
          this.mode = 'hold';
          this.modeTime = 0;
        }
        break;
    }

    // Pull in slightly from the oncoming lane centre: at -3.0 the outer edge of
    // the car sits at 3.92 m against a 4.8 m road, so any transient hangs a wheel
    // off the asphalt. -2.4 keeps a real margin and still clears the car alongside.
    let laneWant = LANE;
    if (this.mode === 'pull-out' || this.mode === 'passing') laneWant = -LANE + 0.6;

    let avoid = 0;
    if (this.mode === 'hold' && oncomingGap !== null && oncomingGap !== undefined
        && oncomingGap < 15) {
      const urgency = clamp(1 - oncomingGap / 15, 0, 1);
      avoid = urgency * 2.0;
    }

    // A junction turn overrides the lane target. It has to be decided here, before
    // the ramp, or the ramp has already run for this frame and the turn only takes
    // effect next frame, by which time the mouth is behind the car.
    let turning = false;
    if (route && route.turn && route.distance < 60 && route.distance > -20) {
      const t = clamp(1 - Math.abs(route.distance) / 60, 0, 1);
      laneWant = route.side * (6.5 * t);
      turning = true;
    }

    // Move the lane target as a rate-limited ramp, not an exponential approach. An
    // exponential reaches the target in well under a second, which asks for a 6 m
    // lateral step at 90 km/h; the car cannot do that and overshoots past the far
    // lane. A ramp tuned to a comfortable lateral rate keeps it between them.
    const maxRate = turning ? 7.0 : 2.6;  // metres per second of lateral movement
    const d = laneWant - this.laneTarget;
    this.laneTarget += clamp(d, -maxRate * dt, maxRate * dt);

    const steerFF = Math.atan(kappa * WHEELBASE);
    // Cross-track gain has to hold the car near the centre line at speed: at
    // 0.016 a 1.7 m offset only asked for 1.5 degrees of lock, so the car drifted
    // wide and its own body hid the asphalt under it. Heading damping rises with
    // the offset gain to keep this from overshooting.
    // Avoidance shifts the reference line sideways, so it enters through the same
    // cross-track term the controller already stabilises.
    const latErr = clamp(crossTrack - this.laneTarget - avoid, -4.5, 4.5);
    const steerCorr = -heading * 0.95 - latErr * 0.075;
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
    // While tucked in behind traffic the gap caps speed. While overtaking it must
    // not: the point is to carry speed past the car, and capping it there made the
    // manoeuvre stall alongside the other driver.
    const overtaking = this.mode === 'pull-out' || this.mode === 'passing';
    if (!overtaking && leadGap !== undefined && leadGap !== null) {
      const gapCap = Math.max(6, leadGap - 8);
      vLimit = Math.min(vLimit, Math.max(4, gapCap / 1.6));
    }
    if (overtaking) vLimit = Math.min(vLimit, 62);
    if (turning) vLimit = Math.min(vLimit, 22);

    // Turning at a junction: as the mouth approaches, the reference line swings
    // toward the branch and the speed drops to something the tyres can hold. The
    // branch is a real road, so this is an ordinary lane change over a short arc.
    // Junction signals. A red or amber approach is a stop line, not a suggestion:
    // the target speed falls to zero as the car reaches the mouth.
    // A red light is a stop line only when the car is approaching it. Past the
    // mouth the car must accelerate away, so the rule is bounded on both sides.
    if (signal && (signal.state === 'red' || signal.state === 'amber')
        && signal.distance > 2) {
      const d = Math.max(1, signal.distance - 4);
      vLimit = Math.min(vLimit, Math.sqrt(2 * 4.2 * d));
    }

    const err = vLimit - speed;
    const throttle = err > 1.5 ? clamp(err / 12, 0.15, 1) : err > 0 ? 0.22 : 0;
    const brake = err < -2.5 ? clamp(-err / 14, 0, 1) : 0;

    this.targetSpeed = vLimit;
    this.crossTrack = crossTrack;
    this.avoid = avoid;
    this.overtaking = overtaking;
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
