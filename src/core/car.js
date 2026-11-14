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
    this.groundFn = null;  // (x, z) => the ground's height there; with it the car leaves the ground like a car does
    this.landed = 0;       // how hard the last touchdown was (m/s), for the caller to take and clear
    this.landCount = 0;    // how many there have been
    this.flightTime = 0;   // s in the air so far
    this._gPrev = undefined;
    this._lift = 0;        // steps in a row the ground has been falling away faster than gravity
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
    this.landed = 0;
    this.flightTime = 0;
    this._gPrev = undefined;
    this._lift = 0;
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
    const rollResist = 12 * this.vx * (this.rollMul || 1);
    const drag = 0.42 * this.vx * Math.abs(this.vx);
    // Off the ground nothing pushes, brakes or steers: a car in the air goes
    // the way it was going, and turns the way it was turning.
    const grip = this.airborne && this.groundFn ? 0 : 1;
    const fx = (engineForce - brakeForce - rollResist) * grip - drag;

    const accel = fx / MASS;
    const transfer = (MASS * accel * CG_HEIGHT) / WHEELBASE;
    const fzFront = Math.max(200, (MASS * G * B) / WHEELBASE - transfer);
    const fzRear = Math.max(200, (MASS * G * A) / WHEELBASE + transfer);

    // Slip angles. atan2 of the lateral component over forward keeps this sane
    // at very low speed where vx approaches zero.
    const vxs = Math.max(Math.abs(this.vx), 0.35) * Math.sign(this.vx || 1);
    const alphaF = Math.atan2(this.vy + A * this.r, vxs) - this.steer;
    const alphaR = Math.atan2(this.vy - B * this.r, vxs);

    const fyFront = -mu * fzFront * Math.tanh((5.6 * alphaF) / mu) * grip;
    const fyRear = -mu * fzRear * Math.tanh((6.2 * alphaR) / mu) * grip;

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
    // A hit throws the car; it does not wobble it on the spot. The old version
    // bled speed and nudged the roll, which is what read as shaking.
    this.vx *= 1 - 0.55 * k;
    // Lateral kick away from the other car, plus a strong yaw spin.
    this.vy += (oncoming ? 1 : -1) * k * 9.0;
    this.r += (oncoming ? 1 : -1) * k * 5.5;
    // Vertical launch: a head-on at speed lifts the whole car off the road.
    this.vyWorld += k * 4.5;
    this.y += k * 0.18;
    this.airborne = true;
    this.rollRate += (oncoming ? 1 : -1) * k * 12.0;
    this.pitchImpact = (this.pitchImpact || 0) + k * 0.5;
    this.landImpact = Math.max(this.landImpact || 0, k * 12);

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

  // Vertical motion. With a ground function (groundFn) the car is a body on
  // the ground's profile the way a real one is: it follows the ground while
  // the ground can hold it, and leaves it, on a crest or at a lip, when the
  // ground falls away faster than gravity can pull the car down. Without one
  // (the old tools) the road's own numbers say where it is.
  _stepVertical(dt) {
    if (this.groundFn) {
      this._stepFree(dt);
      return;
    }
    this._stepOnRoad(dt);
  }

  // Where the car goes along its way: the way it is moving, on the ground.
  _stepFree(dt) {
    const fn = this.groundFn;
    const g0 = fn(this.x, this.z);
    this.groundY = g0;
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    // The way the car is going over the ground (its heading, if it hardly moves).
    let wx = this.vx * cy - this.vy * sy;
    let wz = this.vx * sy + this.vy * cy;
    const speed = Math.hypot(wx, wz);
    if (speed > 0.5) {
      wx /= speed;
      wz /= speed;
    } else {
      wx = cy;
      wz = sy;
    }

    if (this.airborne) {
      this.flightTime += dt;
      this.vyWorld -= G * dt;
      this.y += this.vyWorld * dt;
      if (this.y <= g0) {
        // Touchdown: the ground's own speed, along the way the car is going.
        this.groundVy = this._slopeAlong(fn, wx, wz, 1.5) * speed;
        const impact = Math.max(0, this.groundVy - this.vyWorld);
        this.landImpact = impact;
        // A hop too small to feel is not a landing: no thump, no dust.
        if (impact > 2.2) {
          this.landed = Math.max(this.landed, impact);
          this.landCount++;
        }
        this.y = g0;
        this.vyWorld = this.groundVy;
        this.airborne = false;
        this.flightTime = 0;
        this._lift = 0;
        // The tyres take the fall, and the car does not roll on as it did:
        // a hard landing costs some of its speed.
        this.vx *= 1 - Math.min(0.1, impact * 0.0045);
      }
      return;
    }

    // The ground's height is also read ahead and behind along the car's way,
    // far enough apart (3 m) that the 2 m steps of the road's own samples
    // average out: its slope there, and how fast the slope itself changes (a
    // crest is a negative number).
    const D = 3;
    const gF = fn(this.x + wx * D, this.z + wz * D);
    const gB = fn(this.x - wx * D, this.z - wz * D);
    const gv = ((gF - gB) / (2 * D)) * speed;
    this.groundVy = gv;
    // How fast the ground falls away under the car beyond what a body in free
    // fall does: what is left of its weight is the tyres' to carry; none is
    // left when the crest is sharper than v^2/R = g.
    const kv = (gF - 2 * g0 + gB) / (D * D);
    this._lift = speed > 6 && kv * speed * speed < -G * 1.2 ? this._lift + 1 : 0;
    if (this._lift >= 3) {
      this.airborne = true;
      this.flightTime = 0;
      this.vyWorld = gv;
      this.y = Math.max(this.y, g0);
      return;
    }
    this.vyWorld = gv;
    this.y = g0;
    this.landImpact = Math.max(0, (this.landImpact || 0) - dt * 8);
  }

  _slopeAlong(fn, wx, wz, D) {
    const a = fn(this.x + wx * D, this.z + wz * D);
    const b = fn(this.x - wx * D, this.z - wz * D);
    return (a - b) / (2 * D);
  }

  // The old way, for a caller that sets groundY and groundVy itself: groundY
  // is where the tyres sit and groundVy is how fast that surface is rising
  // under the car. A crest hands the car less upward velocity than gravity can
  // absorb, so it leaves the ground with whatever margin it had: the jump falls
  // out of the profile, not a script.
  _stepOnRoad(dt) {
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
