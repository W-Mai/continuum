/**
 * Presentation layer: everything that makes the car look driven rather than
 * dragged. Turns wheel nodes, tilts the body under load, and drives a camera
 * with mass.
 *
 * All state is smoothed with damped springs so nothing snaps when the physics
 * underneath is doing something abrupt.
 */

import * as THREE from 'three';

const DEG = Math.PI / 180;

/** Damped spring, stable at any dt. */
class Spring {
  constructor(value = 0, stiffness = 90, damping = 1.0) {
    this.value = value;
    this.velocity = 0;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  step(target, dt) {
    const k = this.stiffness;
    const c = 2 * Math.sqrt(k) * this.damping;
    const accel = (target - this.value) * k - this.velocity * c;
    this.velocity += accel * dt;
    this.value += this.velocity * dt;
    return this.value;
  }

  reset(v) {
    this.value = v;
    this.velocity = 0;
  }
}

// Matches carmodel/params.py: WHEEL_R = 340 mm.
const WHEEL_RADIUS = 0.34;

export class CarPresentation {
  constructor(parent) {
    this.root = new THREE.Group();      // world position + heading
    this.body = new THREE.Group();      // suspension pitch / roll / heave
    this.root.add(this.body);
    parent.add(this.root);

    this.wheels = [];
    this.steeringWheel = null;
    this.loaded = false;

    this.pitch = new Spring(0, 110, 0.85);
    this.roll = new Spring(0, 95, 0.8);
    this.heave = new Spring(0, 130, 1.0);
    this.steerAngle = new Spring(0, 140, 0.95);
    this.wheelSpin = 0;
    this._swAngle = 0;
  }

  attach(gltfScene, scale = 0.001) {
    gltfScene.scale.setScalar(scale);
    this.body.add(gltfScene);
    this.model = gltfScene;
    this.loaded = true;

    const byName = {};
    gltfScene.traverse((o) => {
      if (o.name) byName[o.name] = o;
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.material && o.material.transparent) {
          o.material.depthWrite = false;
          o.material.side = THREE.DoubleSide;
        }
      }
    });

    // Each wheel node's origin is its axle centre (the exporter re-bases it
    // there). Wrapping it in a steer pivot lets one node hold the steering angle
    // while the inner node spins.
    for (const name of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
      const node = byName[name];
      if (!node) continue;
      const parentOf = node.parent;
      const steerPivot = new THREE.Group();
      steerPivot.name = name + '_steer';
      steerPivot.position.copy(node.position);
      node.position.set(0, 0, 0);
      parentOf.add(steerPivot);
      steerPivot.add(node);
      this.wheels.push({
        name,
        front: name.endsWith('_fl') || name.endsWith('_fr'),
        left: name.endsWith('_fl') || name.endsWith('_rl'),
        steer: steerPivot,
        spin: node,
        bounce: new Spring(0, 220, 0.75),
      });
    }

    this.steeringWheel = byName['detail_interior'] || null;
  }

  /**
   * @param dt        frame seconds
   * @param car       physics state ({ x, z, yaw, speed, steer, lateralG, throttle, brake })
   * @param roadInfo  { bump }
   */
  update(dt, car, roadInfo = {}) {
    const speed = car.speed || 0;

    // Squat under power, dive under braking, lean out of a bend.
    // Squat and dive on real longitudinal load, not on the pedal position: at a
    // steady cruise there is no load transfer, so the car sits flat, which is
    // what a suspension actually does.
    const accelG = (car.accelLong || 0) / 9.81;
    const targetPitch = THREE.MathUtils.clamp(-accelG * 2.4, -3.4, 3.4) * DEG;
    const targetRoll = THREE.MathUtils.clamp((car.lateralG || 0) * 2.6, -5, 5) * DEG;

    const bump = roadInfo.bump || 0;
    const speedFactor = Math.min(speed / 30, 1);
    const targetHeave = (Math.sin(car.x * 0.7) * 0.012
      + Math.sin(car.z * 0.9) * 0.009) * bump * speedFactor;

    this.pitch.step(targetPitch, dt);
    this.roll.step(targetRoll, dt);
    this.heave.step(targetHeave, dt);

    this.body.rotation.x = this.pitch.value;
    this.body.rotation.z = this.roll.value;
    this.body.position.y = this.heave.value;

    this.steerAngle.step(car.steer || 0, dt);
    const visualSteer = THREE.MathUtils.clamp(this.steerAngle.value * 1.35, -0.6, 0.6);

    this.wheelSpin += (speed / WHEEL_RADIUS) * dt;

    for (const w of this.wheels) {
      const phase = w.left ? 0 : Math.PI * 0.7;
      const travel = Math.sin(car.x * 0.8 + phase) * 0.018 * bump
        * Math.min(speed / 25, 1);
      w.bounce.step(travel, dt);

      if (w.front) w.steer.rotation.y = visualSteer;
      // The axle runs along the node's local Z after the Z-up to Y-up bake, so
      // spinning about Z rolls the wheel.
      w.spin.rotation.z = -this.wheelSpin;
      w.spin.position.y = w.bounce.value;
    }

    if (this.steeringWheel) {
      const target = -visualSteer * 4.0;
      this._swAngle += (target - this._swAngle) * Math.min(dt * 12, 1);
      this.steeringWheel.rotation.z = this._swAngle;
    }

    this.root.position.set(car.x, roadInfo.roadY || 0, car.z);
    // The model's nose is +X after the Z-up to Y-up bake. Rotating +X by a about
    // Y gives (cos a, 0, -sin a), so matching world forward (cos yaw, sin yaw)
    // needs a = -yaw.
    this.root.rotation.y = -car.yaw;
  }

  setVisible(v) {
    this.root.visible = v;
  }
}

export class ChaseCamera {
  /**
   * Cinematic chase rig. Position, heading and look-at each have their own
   * spring, so the camera lags the car, swings wide through corners, pulls back
   * with speed, and eases between framings instead of cutting.
   */
  constructor(camera) {
    this.camera = camera;

    this.posX = new Spring(0, 26, 0.92);
    this.posY = new Spring(2.6, 34, 0.95);
    this.posZ = new Spring(0, 26, 0.92);
    this.lookX = new Spring(0, 40, 1.0);
    this.lookY = new Spring(1.2, 40, 1.0);
    this.lookZ = new Spring(0, 40, 1.0);

    this.yaw = new Spring(0, 30, 1.0);
    this.dist = new Spring(9.0, 22, 0.9);
    this.fov = new Spring(52, 25, 0.95);
    this.shake = new Spring(0, 60, 0.5);
    this.shakeSeed = Math.random() * 1000;

    this.framing = 'chase';
    this.frameWeights = { chase: 1, side: 0, low: 0, front: 0 };
    this.targetWeights = { chase: 1, side: 0, low: 0, front: 0 };

    this._initialised = false;
    this._lookAt = new THREE.Vector3();
    this._pos = new THREE.Vector3();
  }

  static FRAMINGS = {
    // back, up, side are unit offsets; ahead/lookUp shape the aim point.
    chase: { back: 1.0, up: 0.42, side: 0.0, ahead: 1.0, lookUp: 0.16, fov: 0 },
    side: { back: 0.10, up: 0.14, side: 0.58, ahead: 0.50, lookUp: 0.10, fov: -2 },
    // Side offsets are kept small: a large one puts the lens over the verge and
    // makes the road read as if the car had left it.
    low: { back: 0.62, up: 0.05, side: 0.10, ahead: 1.10, lookUp: 0.05, fov: 5 },
    front: { back: -0.72, up: 0.20, side: 0.08, ahead: -0.35, lookUp: 0.14, fov: 3 },
  };

  setFraming(name) {
    if (!ChaseCamera.FRAMINGS[name]) return;
    this.framing = name;
    for (const k of Object.keys(this.targetWeights)) {
      this.targetWeights[k] = k === name ? 1 : 0;
    }
  }

  cycle() {
    const order = ['chase', 'side', 'low', 'front'];
    const i = order.indexOf(this.framing);
    this.setFraming(order[(i + 1) % order.length]);
    return this.framing;
  }

  update(dt, car, opts = {}) {
    const speed = car.speed || 0;
    const speedN = THREE.MathUtils.clamp(speed / 60, 0, 1);

    let sum = 0;
    for (const k of Object.keys(this.frameWeights)) {
      const w = this.frameWeights;
      w[k] += (this.targetWeights[k] - w[k]) * Math.min(dt * 2.6, 1);
      sum += w[k];
    }
    if (sum < 1e-4) {
      this.frameWeights.chase = 1;
      sum = 1;
    }

    let back = 0, up = 0, side = 0, ahead = 0, lookUp = 0, fovOff = 0;
    for (const [k, spec] of Object.entries(ChaseCamera.FRAMINGS)) {
      const w = this.frameWeights[k] / sum;
      back += spec.back * w;
      up += spec.up * w;
      side += spec.side * w;
      ahead += spec.ahead * w;
      lookUp += spec.lookUp * w;
      fovOff += spec.fov * w;
    }

    // Chase distance must exceed the car's own length (4.5 m), or the lens ends
    // up inside the bodywork. 8-11 m keeps the whole car in frame.
    this.dist.step(8.2 + back * 2.4 + speedN * 2.6, dt);

    // Heading lags the car, and the yaw rate biases the aim so the camera swings
    // wide through a bend instead of tracking rigidly.
    // Track heading tightly. The weight of the shot comes from the position and
    // aim springs; a slow heading spring as well made the road swing across the
    // frame in every bend.
    // Stepping with a stretched dt pushes the spring past its stability limit, so
    // the camera oscillates. Stiffness carries the responsiveness instead.
    const laggedYaw = this._unwrap(car.yaw);
    this.yaw.step(laggedYaw, dt);

    const yaw = this.yaw.value;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const fx = cy, fz = sy;
    const lx = -sy, lz = cy;

    // Springs with different stiffness lag by different amounts, so a smoothed
    // position looking at a separately smoothed point drifts off the car. Drive
    // one point and place the camera behind it: the rig then always aims exactly
    // where it should, and the lag lives entirely in the aim point.
    const lookAheadM = 9 + ahead * 5;
    const baseY = opts.roadY || 0;
    this.lookX.step(car.x + fx * lookAheadM, dt);
    this.lookY.step(baseY + 0.55 + lookUp * 2.2, dt);
    this.lookZ.step(car.z + fz * lookAheadM, dt);

    const d = this.dist.value;
    this.posX.step(this.lookX.value - fx * (lookAheadM + d) + lx * side * d * 0.55, dt);
    this.posZ.step(this.lookZ.value - fz * (lookAheadM + d) + lz * side * d * 0.55, dt);
    this.posY.step(this.lookY.value + 1.5 + up * 1.2 + speedN * 0.45, dt);

    const shakeTarget = (opts.bump || 0) * speedN * 0.05 + (opts.impact || 0) * 0.2;
    this.shake.step(shakeTarget, dt);
    const t = performance.now() * 0.001;
    const sx = Math.sin(t * 37 + this.shakeSeed) * this.shake.value;
    const sy2 = Math.sin(t * 41 + this.shakeSeed * 2) * this.shake.value * 0.7;

    this._pos.set(this.posX.value + sx, this.posY.value + sy2, this.posZ.value);
    this._lookAt.set(this.lookX.value, this.lookY.value, this.lookZ.value);

    this.camera.position.copy(this._pos);
    this.camera.lookAt(this._lookAt);

    // Tip the horizon with the car so it reads as a body rolling on suspension
    // rather than a model pivoting in place.
    const camRoll = THREE.MathUtils.clamp(-(car.lateralG || 0) * 0.014, -0.05, 0.05);
    this.camera.rotateZ(camRoll);

    this.fov.step(52 + fovOff + speedN * 12, dt);
    if (Math.abs(this.camera.fov - this.fov.value) > 0.01) {
      this.camera.fov = this.fov.value;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Unwrap so crossing +-PI does not send the camera the long way round. */
  _unwrap(target) {
    let d = target - this.yaw.value;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return this.yaw.value + d;
  }

  snapTo(car) {
    const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    this.yaw.reset(car.yaw);
    this.dist.reset(9.0);
    this.posX.reset(car.x - cy * 9.0);
    this.posY.reset(2.6);
    this.posZ.reset(car.z - sy * 9.0);
    this.lookX.reset(car.x + cy * 12);
    this.lookY.reset(1.0);
    this.lookZ.reset(car.z + sy * 12);
    this.fov.reset(52);
    this._initialised = true;
  }
}
