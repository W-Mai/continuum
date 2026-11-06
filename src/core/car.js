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
    this.y = 0;            // height of the contact patch
    this.yaw = 0;
    this.vx = 0;           // body-frame forward
    this.vy = 0;           // body-frame lateral
    this.vyWorld = 0;      // vertical velocity, world frame
    this.airborne = false;
    this.pitchSlope = 0;   // chassis pitch from the road grade
    this.rollAngle = 0;    // accumulated body roll from impacts
    this.rollRate = 0;
    this.landImpact = 0;
    this.wrecked = false;  // flipped past recovery
    this.wreckTimer = 0;
    this.r = 0;            // yaw rate
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.surfaceGrip = 1.0;
    this.speed = 0;
    this.lateralG = 0;
    this.slipAngle = 0;
    this.accelLong = 0;
  }

  get speedKmh() {
    return Math.hypot(this.vx, this.vy) * 3.6;
  }

  reset(x, z, yaw, y = 0) {
    this.x = x;
    this.z = z;
    this.y = y;
    this.yaw = yaw;
    this.vyWorld = 0;
    this.airborne = false;
    this.pitchSlope = 0;
    this.rollAngle = 0;
    this.rollRate = 0;
    this.wrecked = false;
    this.wreckTimer = 0;
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

    this._stepVertical(dt);
    this._stepRoll(dt);

    this.speed = Math.hypot(this.vx, this.vy);
    this.accelLong = ax;
    this.lateralG = (fyFront + fyRear) / MASS / G;
    this.slipAngle = Math.max(Math.abs(alphaF), Math.abs(alphaR));
    return this;
  }

  // A hit kills forward speed and starts the body rolling. Without a roll
  // impulse every collision looked like the car simply stopping, which read as a
  // bug rather than a crash.
  applyImpact(severity, oncoming) {
    const k = Math.min(1, severity / 30);
    this.vx *= 1 - 0.75 * k;
    this.vy += (oncoming ? 1 : -1) * k * 3.2;
    this.r += (oncoming ? 1 : -1) * k * 1.6;
    this.rollRate += (oncoming ? 1 : -1) * k * 5.5;
    this.y += k * 0.10;
    this.vyWorld += k * 1.4;
    this.airborne = true;
    this.landImpact = Math.max(this.landImpact || 0, k * 6);

    // A hard enough hit flips the car outright. Waiting for the roll spring to
    // accumulate past a quarter turn never worked, because the restoring torque
    // pulls it back before it gets there.
    if (severity > 34) {
      this.wrecked = true;
      this.wreckTimer = 0;
      this.rollRate = Math.sign(this.rollRate || 1) * 7.5;
    }
  }

  // Roll relaxes back to level through a spring; past a threshold the car is
  // considered flipped and the caller plays the reset.
  _stepRoll(dt) {
    const restore = -this.rollAngle * 26 - this.rollRate * 5.4;
    this.rollRate += restore * dt;
    this.rollAngle += this.rollRate * dt;

    // Past a quarter turn it is not recoverable by driving.
    if (Math.abs(this.rollAngle) > Math.PI * 0.5 && !this.wrecked) {
      this.wrecked = true;
      this.wreckTimer = 0;
    }
    if (this.wrecked) {
      this.wreckTimer += dt;
      // Keep turning while airborne so it reads as a flip.
      this.rollAngle += this.rollRate * dt * 0.5;
    }
  }

  // Vertical motion over the road surface. groundY is where the tyres sit and
  // groundVy is how fast that surface is rising under the car. A crest hands the
  // car less upward velocity than gravity can absorb, so it leaves the ground
  // with whatever margin it had: the jump falls out of the profile, not a script.
  _stepVertical(dt) {
    const groundY = this.groundY || 0;
    const groundVy = this.groundVy || 0;

    if (this.airborne) {
      this.vyWorld -= G * dt;
      this.y += this.vyWorld * dt;
      if (this.y <= groundY) {
        this.landImpact = Math.max(0, -this.vyWorld);
        this.y = groundY;
        this.vyWorld = groundVy;
        this.airborne = false;
      }
      return;
    }

    // Leaving the ground is decided by the road profile, not by a per-frame
    // position delta: at 150 km/h a frame covers 0.7 m, so (groundY - y)/dt is
    // dominated by rounding. The physical question is whether gravity can supply
    // the vertical deceleration the surface demands. Cresting a hill asks the car
    // to shed groundVy in one frame; if gravity cannot do it, the tyres unload.
    const neededDv = groundVy - this.vyWorld;
    if (neededDv < 0 && -neededDv > G * dt * 1.8) {
      this.airborne = true;
      this.vyWorld = Math.max(this.vyWorld, groundVy) - G * dt;
      this.y += this.vyWorld * dt;
      return;
    }

    this.vyWorld = groundVy;
    this.y = groundY;
    this.landImpact = Math.max(0, (this.landImpact || 0) - dt * 8);
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
