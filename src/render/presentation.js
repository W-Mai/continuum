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
// Chassis cross-section in metres. A roll turns width against height, so these are
// the two that matter; the length stays parallel to the roll axis.
const BODY_HALF_WIDTH = 0.9;
const BODY_HALF_HEIGHT = 0.65;

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

// Hover. Above TAKEOFF the body rises, the wheels swing flat under the floor,
// and the body settles to its cruise height; below LAND, or in a wreck, it
// plays backwards. The gap between the two speeds keeps it from flapping at a
// hairpin. The swing needs more room under the car than the cruise, which is
// why the body rises higher first and then settles.
const TAKEOFF = 40 / 3.6;
const LAND = 20 / 3.6;
const LIFT_TIME = 0.6;        // s, body rise to the swing height
const FOLD_TIME = 0.9;        // s, wheel swing
const SETTLE_TIME = 0.7;      // s, down to the cruise height
const IDLE_SPIN = 2.5;        // rad/s, a folded wheel turning over
const BOB = 0.010;            // m, hover float, at 0.7 Hz
const GLOW = 0xff6a3d;

// Smootherstep: starts and stops like a mechanism, not a spring.
const ease = (t) => t * t * t * (t * (t * 6 - 15) + 10);

function glowTexture() {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.2)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class CarPresentation {
  constructor(parent) {
    this.root = new THREE.Group();      // world position + heading
    this.body = new THREE.Group();      // suspension pitch / roll / heave
    this.root.add(this.body);
    parent.add(this.root);

    this.wheels = [];
    this.pools = [];
    this.steeringWheel = null;
    this.loaded = false;

    this.pitch = new Spring(0, 110, 0.85);
    this.roll = new Spring(0, 95, 0.8);
    this.heave = new Spring(0, 130, 1.0);
    this.steerAngle = new Spring(0, 140, 0.95);
    this.wheelSpin = 0;
    this.spinRate = 0;

    this.hover = false;   // what the car wants to be doing
    this.lift = 0;        // 0..1, body rise progress
    this.fold = 0;        // 0..1, wheel swing progress
    this.settle = 0;      // 0..1, down to the cruise height
    this.liftAmount = 0;  // eased
    this.foldAmount = 0;
    this.hoverLift = 0.20;
    this.swingLift = 0.26;
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
    // there). Three pivots stack on it: the fold hinge, which swings the wheel
    // flat under the floor; the steer pivot through the axle centre; and the
    // node itself, which spins. The hinge comes from the model's own extras,
    // so the animation uses the geometry the build checked.
    const tex = glowTexture();
    for (const name of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
      const node = byName[name];
      if (!node) continue;
      const fold = node.userData.fold || null;
      const parentOf = node.parent;
      const hinge = new THREE.Group();
      hinge.name = name + '_hinge';
      if (fold) hinge.position.fromArray(fold.hinge);
      else hinge.position.copy(node.position);
      parentOf.add(hinge);
      const steerPivot = new THREE.Group();
      steerPivot.name = name + '_steer';
      steerPivot.position.copy(node.position).sub(hinge.position);
      hinge.add(steerPivot);
      node.position.set(0, 0, 0);
      steerPivot.add(node);
      if (fold && fold.lift) {
        this.hoverLift = fold.lift * scale;
        this.swingLift = (fold.swingLift || fold.lift) * scale;
      }

      // The light the folded wheel throws on the road, laid in road space.
      let pool = null;
      if (fold) {
        pool = new THREE.Mesh(
          new THREE.PlaneGeometry(1.05, 1.05).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({
            map: tex, color: GLOW, transparent: true, opacity: 0, fog: false,
            blending: THREE.AdditiveBlending, depthWrite: false,
            polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
          }),
        );
        pool.position.set(fold.centre[0] * scale, 0.02, fold.centre[2] * scale);
        pool.renderOrder = 2;
        pool.visible = false;
        this.root.add(pool);
        this.pools.push(pool);
      }
      this.wheels.push({
        name,
        front: name.endsWith('_fl') || name.endsWith('_fr'),
        left: name.endsWith('_fl') || name.endsWith('_rl'),
        hinge,
        foldAngle: fold ? fold.angle : 0,
        steer: steerPivot,
        spin: node,
        pool,
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

    // Hover: rise, fold, settle; and back. Each stage waits for the one before
    // it to finish, so a tyre never swings through the road.
    if (!this.hover && speed > TAKEOFF && !car.wrecked) this.hover = true;
    else if (this.hover && (speed < LAND || car.wrecked)) this.hover = false;
    if (this.hover) {
      if (this.lift < 1) this.lift = Math.min(1, this.lift + dt / LIFT_TIME);
      else if (this.fold < 1) this.fold = Math.min(1, this.fold + dt / FOLD_TIME);
      else this.settle = Math.min(1, this.settle + dt / SETTLE_TIME);
    } else if (this.settle > 0) {
      this.settle = Math.max(0, this.settle - dt / SETTLE_TIME);
    } else if (this.fold > 0) {
      this.fold = Math.max(0, this.fold - dt / FOLD_TIME);
    } else {
      this.lift = Math.max(0, this.lift - dt / LIFT_TIME);
    }
    const lift = ease(this.lift);
    const fold = ease(this.fold);
    const rise = this.swingLift * lift - (this.swingLift - this.hoverLift) * ease(this.settle);
    this.liftAmount = lift;
    this.foldAmount = fold;

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
    // Afloat, the body drifts a little on its own: a slow bob and a slower sway,
    // at frequencies far below anything that reads as vibration.
    const bob = Math.sin(t * Math.PI * 2 * 0.7) * BOB * lift;
    const sway = Math.sin(t * Math.PI * 2 * 0.43) * 0.25 * DEG * lift;
    const nod = Math.sin(t * Math.PI * 2 * 0.31 + 1.0) * 0.18 * DEG * lift;
    const rollAngle = this.roll.value + (car.rollAngle || 0) + sway;
    this.body.rotation.x = rollAngle;
    this.body.rotation.z = this.pitch.value + nod;

    // A body on its side rests on its roof edge, so its centre sits higher than when
    // it is level. Lift by exactly that difference: zero upright, a quarter of a
    // metre at 90 degrees.
    const half = Math.abs(Math.sin(rollAngle)) * BODY_HALF_WIDTH
      + Math.abs(Math.cos(rollAngle)) * BODY_HALF_HEIGHT;
    this.body.position.y = this.heave.value + Math.max(0, half - BODY_HALF_HEIGHT)
      + rise + bob;

    this.steerAngle.step(car.steer || 0, dt);
    const visualSteer = THREE.MathUtils.clamp(this.steerAngle.value * 1.35, -0.6, 0.6);

    // On the road a wheel turns with the road. Off it, the brakes bring it down
    // to a slow idle before it folds, and it keeps turning over there.
    const wantSpin = (speed / WHEEL_RADIUS) * (1 - lift) + IDLE_SPIN * lift;
    this.spinRate += (wantSpin - this.spinRate) * Math.min(1, dt * 6);
    this.wheelSpin += this.spinRate * dt;

    for (const w of this.wheels) {
      const phase = w.left ? 0 : Math.PI * 0.7;
      const travel = Math.sin(car.x * 0.8 + phase) * 0.018 * bump
        * Math.min(speed / 25, 1) * (1 - lift);
      w.bounce.step(travel, dt);

      w.hinge.rotation.x = w.foldAngle * fold;
      // The chassis is yawed by -car.yaw, so a left turn (steer < 0) must point
      // the wheels toward -Z, which is rotation.y > 0. A folded wheel is a
      // hover pad and does not steer.
      if (w.front) w.steer.rotation.y = -visualSteer * (1 - fold);
      // The axle runs along the node's local Z after the Z-up to Y-up bake, so
      // spinning about Z rolls the wheel.
      w.spin.rotation.z = -this.wheelSpin;
      w.spin.position.y = w.bounce.value;

      if (w.pool) {
        // Brightest when the pad is lowest in its bob.
        w.pool.material.opacity = 0.5 * fold * (1 - bob / BOB * 0.12);
        w.pool.visible = fold > 0.01;
      }
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
    // The body leans with the road's banking: the inside of the bend is lower.
    this.root.rotation.x = Math.atan(roadInfo.bank || 0);

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
    this.frameWeights = { chase: 1, side: 0, low: 0, front: 0, drone: 0 };
    this.targetWeights = { chase: 1, side: 0, low: 0, front: 0, drone: 0 };

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
    // A high, wide shot from a drone trailing the car: the serpentines, the
    // viaducts and the valley below. Blended in separately (see update).
    drone: { back: 1.0, up: 0.42, side: 0.0, ahead: 1.0, lookUp: 0.16, fov: 0 },
  };

  setFraming(name) {
    if (!ChaseCamera.FRAMINGS[name]) return;
    this.framing = name;
    for (const k of Object.keys(this.targetWeights)) {
      this.targetWeights[k] = k === name ? 1 : 0;
    }
  }

  cycle() {
    const order = ['chase', 'drone', 'side', 'low', 'front'];
    const i = order.indexOf(this.framing);
    this.setFraming(order[(i + 1) % order.length]);
    return this.framing;
  }

  // A biome change can move the asphalt several metres in one frame. The height
  // springs would take seconds to catch up, and until they do the lens sits inside
  // the road. Call this when the ground steps so the rig starts from the new level.
  snapToGround(car, opts = {}) {
    const baseY = opts.roadY || 0;
    const ground = opts.groundAt
      ? Math.max(baseY, opts.groundAt(car.x, car.z))
      : baseY;
    this.posY.reset(ground + 2.05);
    this.lookY.reset(ground + 0.55);
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

    // Drone: trail high and wide off the car's shoulder, looking down the road
    // ahead. Its position is smoothed on its own so the shot glides.
    const dw = this.frameWeights.drone / sum;
    if (dw > 0.001) {
      const baseYd = opts.roadY || 0;
      const want = this._droneWant || (this._droneWant = new THREE.Vector3());
      want.set(car.x - fx * 62 + lx * 34, baseYd + 42, car.z - fz * 62 + lz * 34);
      if (opts.groundAt) want.y = Math.max(want.y, opts.groundAt(want.x, want.z) + 18);
      const dp = this._dronePos || (this._dronePos = want.clone());
      dp.lerp(want, Math.min(1, dt * 1.2));
      const look = this._droneLook || (this._droneLook = new THREE.Vector3());
      look.set(car.x + fx * 30, baseYd, car.z + fz * 30);
      this._pos.lerp(dp, dw);
      this._lookAt.lerp(look, dw);
    } else if (this._dronePos) {
      this._dronePos.copy(this._pos);
    }

    // Inside a tunnel the vault is the ceiling.
    if (opts.ceilingAt) {
      const ceil = opts.ceilingAt(this._pos.x, this._pos.z);
      if (ceil !== null && this._pos.y > ceil - 0.8) this._pos.y = ceil - 0.8;
    }

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

  snapTo(car, baseY = 0) {
    const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    this.yaw.reset(car.yaw);
    this.dist.reset(9.0);
    this.posX.reset(car.x - cy * 9.0);
    this.posY.reset(baseY + 2.6);
    this.posZ.reset(car.z - sy * 9.0);
    this.lookX.reset(car.x + cy * 12);
    this.lookY.reset(baseY + 1.0);
    this.lookZ.reset(car.z + sy * 12);
    this.fov.reset(52);
    this._initialised = true;
  }
}
