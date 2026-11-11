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
      // Steep descents are taken a little slower.
      if (d < 40 && p.grade < -0.06) v = Math.min(v, this.vMax * (1 + (p.grade + 0.06) * 3));
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
