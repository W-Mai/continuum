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

// Matches carmodel/params.py: WHEEL_R = 340 mm, wheelbase 2700 mm.
const WHEEL_RADIUS = 0.34;
const WHEELBASE = 2.7;

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

    // No separate steering-wheel node exists in the export (detail_interior is the
    // whole cabin), so there is nothing to turn. Left null rather than spinning
    // the seats and dashboard around the car.
    this.steeringWheel = null;
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
    const targetPitch = THREE.MathUtils.clamp(-accelG * 5.0, -6.5, 6.5) * DEG;
    const targetRoll = THREE.MathUtils.clamp((car.lateralG || 0) * 5.5, -9, 9) * DEG;

    const bump = roadInfo.bump || 0;
    const speedFactor = Math.min(speed / 30, 1);
    this._t = (this._t || 0) + dt;

    // Heave is three frequencies, not one: a single sine reads as a wobble, while
    // stacked ones read as a road surface. Road speed scales it, so the car is
    // calm at a crawl and busy at 150.
    // No synthetic heave. The car's height already follows the road through car.y,
    // and adding a spring on top of that was the vibration: a 130-stiffness spring
    // driven at centimetre amplitude rings at a few Hz, which against a chase
    // camera reads as the whole car shaking. The road profile is the feel.
    const t = this._t;

    this.pitch.step(targetPitch, dt);
    this.roll.step(targetRoll, dt);
    this.heave.step(0, dt);

    // Axes are not interchangeable here: the nose is +X and up is +Y, so rotating
    // about X banks the car and rotating about Z pitches it. Feeding the pitch
    // value to X made every impact tumble the body around its length instead of
    // rolling it over.
    this.body.rotation.x = this.roll.value + (car.rollAngle || 0);
    this.body.rotation.z = this.pitch.value;
    this.body.position.y = this.heave.value;

    this.steerAngle.step(car.steer || 0, dt);
    const visualSteer = THREE.MathUtils.clamp(this.steerAngle.value * 1.35, -0.6, 0.6);

    this.wheelSpin += (speed / WHEEL_RADIUS) * dt;

    for (const w of this.wheels) {
      const phase = w.left ? 0 : Math.PI * 0.7;
      const travel = Math.sin(car.x * 0.8 + phase) * 0.018 * bump
        * Math.min(speed / 25, 1);
      w.bounce.step(travel, dt);

      // The chassis is yawed by -car.yaw, so a left turn (steer < 0) must point
      // the wheels toward -Z, which is rotation.y > 0.
      if (w.front) w.steer.rotation.y = -visualSteer;
      // The axle runs along the node's local Z after the Z-up to Y-up bake, so
      // spinning about Z rolls the wheel.
      w.spin.rotation.z = -this.wheelSpin;
      w.spin.position.y = w.bounce.value;
    }

    // Both axles get their own road height. Seating the car on one height and
    // tilting it about that point put the rear wheels under the surface on a
    // grade: 2.7 m of wheelbase is a large height difference.
    const base = car.y !== undefined ? car.y : (roadInfo.roadY || 0);
    const hubF = roadInfo.hubF !== undefined ? roadInfo.hubF : base + WHEEL_RADIUS;
    const hubR = roadInfo.hubR !== undefined ? roadInfo.hubR : base + WHEEL_RADIUS;

    // The body's pitch is the angle between the two axle heights. Deriving it from
    // the surface rather than from a grade sample keeps the wheels and the body
    // agreeing by construction.
    const surfacePitch = Math.atan2(hubF - hubR, WHEELBASE);
    const pitch = car.airborne ? (car.pitchSlope || 0) : surfacePitch;
    this.root.rotation.order = 'YXZ';
    this.root.rotation.y = -car.yaw;
    this.root.rotation.z = pitch;

    // Seat on the mean hub height, then account for the tilt about that point:
    // the lower axle is half a wheelbase away and drops by sin(pitch) * halfBase.
    const meanHub = (hubF + hubR) * 0.5;
    const tiltDrop = Math.abs(Math.sin(pitch)) * WHEELBASE * 0.5;
    this.root.position.set(car.x, meanHub - WHEEL_RADIUS + tiltDrop, car.z);
  }

  setVisible(v) {
    this.root.visible = v;
  }

  // Blink the body during a reset. Passing null restores normal rendering.
  setBlink(alpha) {
    if (!this.model) return;
    const opaque = alpha === null;
    this.model.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (opaque) {
          if (m.userData.wasTransparent === undefined) continue;
          m.transparent = m.userData.wasTransparent;
          m.opacity = m.userData.wasOpacity;
          m.depthWrite = m.userData.wasDepthWrite;
          delete m.userData.wasTransparent;
        } else {
          if (m.userData.wasTransparent === undefined) {
            m.userData.wasTransparent = m.transparent;
            m.userData.wasOpacity = m.opacity;
            m.userData.wasDepthWrite = m.depthWrite;
          }
          m.transparent = true;
          m.opacity = alpha;
          m.depthWrite = false;
        }
        m.needsUpdate = true;
      }
    });
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

    this.posX = new Spring(0, 120, 1.0);
    this.posY = new Spring(2.6, 140, 1.0);
    this.posZ = new Spring(0, 120, 1.0);
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
    // The aim point sits 9 m ahead; on a climb that ground is above the car, and
    // aiming at the car's height tilted the lens down into the road.
    const lookGround = opts.groundAt
      ? opts.groundAt(car.x + fx * lookAheadM, car.z + fz * lookAheadM)
      : baseY;
    this.lookX.step(car.x + fx * lookAheadM, dt);
    this.lookY.step(Math.max(baseY, lookGround) + 0.55 + lookUp * 2.2, dt * 3);
    this.lookZ.step(car.z + fz * lookAheadM, dt);

    // Camera position follows the car directly. Springing the position as well as
    // the aim point stacked two lags: at 82 km/h the camera fell 24 m behind, so
    // the shot showed the road back where the car had been. All the weight of the
    // move lives in the aim point now.
    const d = this.dist.value;
    const wantX = car.x - fx * d + lx * side * d * 0.55;
    const wantZ = car.z - fz * d + lz * side * d * 0.55;
    this.posX.step(wantX, dt);
    this.posZ.step(wantZ, dt);

    // The camera rides its OWN patch of road, not the car's. It sits 8-11 m back, so
    // on a 15% downgrade the asphalt under the lens is nearly 1.8 m higher than under
    // the car; adding its height to the car's put the camera inside the surface and
    // the near plane cut a black wall across the shot.
    const camGround = opts.groundAt
      ? opts.groundAt(this.posX.value, this.posZ.value)
      : baseY;
    const clearance = Math.max(baseY, camGround);
    this.posY.step(clearance + 2.05 + up * 1.7 + speedN * 0.5, dt * 3);

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
