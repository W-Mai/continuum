// Bicycle model with tyre slip angles. Steering changes the front wheel angle;
// the resulting yaw comes out of tyre forces, so the car can understeer, slide
// and recover instead of turning like a turret.

export const MASS = 1380;
const INERTIA = 1900;
const WHEELBASE = 2.7;
const A = 1.21;            // centre of mass to front axle
const B = WHEELBASE - A;   // to rear axle
const CG_HEIGHT = 0.46;
const TRACK = 1.6;
const G = 9.81;

const MAX_STEER = 0.52;
const STEER_RATE = 3.4;    // rad/s at the wheel

export class Car {
  constructor() {
    this.x = 0;
    this.z = 0;
    this.yaw = 0;
    this.vx = 0;           // body-frame forward
    this.vy = 0;           // body-frame lateral
    this.r = 0;            // yaw rate
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.surfaceGrip = 1.0;
    this.speed = 0;
    this.lateralG = 0;
    this.slipAngle = 0;
  }

  get speedKmh() {
    return Math.hypot(this.vx, this.vy) * 3.6;
  }

  reset(x, z, yaw) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.vx = 0;
    this.vy = 0;
    this.r = 0;
    this.steer = 0;
  }

  // dt is fixed; callers use an accumulator so physics never depends on fps.
  step(dt, input) {
    const wantSteer = clamp(input.steer, -1, 1) * MAX_STEER;
    const dSteer = clamp(wantSteer - this.steer, -STEER_RATE * dt, STEER_RATE * dt);
    this.steer += dSteer;

    this.throttle = clamp(input.throttle, 0, 1);
    this.brake = clamp(input.brake, 0, 1);

    const speed = Math.hypot(this.vx, this.vy);
    const mu = 1.05 * this.surfaceGrip;

    const engineForce = this.throttle * engineCurve(speed) * 4200;
    const brakeForce = this.brake * 12000 * Math.sign(this.vx || 1);
    const rollResist = 12 * this.vx;
    const drag = 0.42 * this.vx * Math.abs(this.vx);
    const fx = engineForce - brakeForce - rollResist - drag;

    const accel = fx / MASS;
    const transfer = (MASS * accel * CG_HEIGHT) / WHEELBASE;
    const fzFront = Math.max(200, (MASS * G * B) / WHEELBASE - transfer);
    const fzRear = Math.max(200, (MASS * G * A) / WHEELBASE + transfer);

    // Slip angles. atan2 of the lateral component over forward keeps this sane
    // at very low speed where vx approaches zero.
    const vxs = Math.max(Math.abs(this.vx), 0.35) * Math.sign(this.vx || 1);
    const alphaF = Math.atan2(this.vy + A * this.r, vxs) - this.steer;
    const alphaR = Math.atan2(this.vy - B * this.r, vxs);

    const fyFront = -mu * fzFront * Math.tanh((5.6 * alphaF) / mu);
    const fyRear = -mu * fzRear * Math.tanh((6.2 * alphaR) / mu);

    // Body-frame equations of motion.
    const ax = fx / MASS + this.vy * this.r;
    const ay = (fyFront * Math.cos(this.steer) + fyRear) / MASS - this.vx * this.r;
    const torque = A * fyFront * Math.cos(this.steer) - B * fyRear;

    this.vx += ax * dt;
    this.vy += ay * dt;
    this.r += (torque / INERTIA) * dt;

    // Below walking pace the slip model is not meaningful, so damp the lateral
    // channel to keep a stationary car stationary.
    if (Math.abs(this.vx) < 0.6) {
      this.vy *= 0.82;
      this.r *= 0.82;
    }

    this.r *= 1 - 0.9 * dt;

    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    this.x += (this.vx * cy - this.vy * sy) * dt;
    this.z += (this.vx * sy + this.vy * cy) * dt;
    this.yaw += this.r * dt;

    this.speed = Math.hypot(this.vx, this.vy);
    this.lateralG = (fyFront + fyRear) / MASS / G;
    this.slipAngle = Math.max(Math.abs(alphaF), Math.abs(alphaR));
    return this;
  }
}

function engineCurve(speed) {
  // Falls off with speed so top end is drag-limited rather than power-limited.
  const t = Math.min(speed / 78, 1);
  return 1 - 0.72 * t * t;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export const CAR_DIMS = { wheelbase: WHEELBASE, track: TRACK, a: A, b: B };
