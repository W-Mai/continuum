/**
 * Presentation layer: everything that makes the car look driven rather than
 * dragged. Turns wheel nodes, tilts the body under load, and drives a camera
 * with mass.
 *
 * All state is smoothed with damped springs so nothing snaps when the physics
 * underneath is doing something abrupt.
 */

import * as THREE from 'three';
import { DIRECTED } from './director.js';
import { MARK } from './style.js';
import { mulberry32 } from '../world/noise.js';
import { mergeGeometries } from '../../tools/utils/BufferGeometryUtils.js';

// The car's parts by the model's material names (carmodel/materials.py), for
// a style that marks them (render/style.js): its body and the cabin seen
// through the glass, its wheels and the hover rings on them, its lamps, its
// trim. A name not here is body; the glass is not marked.
const CAR_MARK = {
  paint: MARK.body, paint_dark: MARK.body, paint_lo: MARK.body,
  leather: MARK.body, alcantara: MARK.body, carpet: MARK.body,
  rubber: MARK.wheel, rubber_side: MARK.wheel, alu: MARK.wheel, gunmetal: MARK.wheel,
  brake_disc: MARK.wheel, caliper: MARK.wheel, emitter: MARK.wheel,
  head_light: MARK.lamp, tail_light: MARK.lamp, tail_light_off: MARK.lamp,
  carbon: MARK.trim, black_trim: MARK.trim, chrome: MARK.trim, thruster: MARK.trim,
};

// The car in the painted style (render/style.js, the figures): three flat
// paints to a part, lit, shade and deep, by the model's material names. They
// are given as the colours (sRGB) the paints come to on the screen, a pixel
// being its paint times PAINT_LIGHT (the level of a world's sun and sky; the
// grade that comes after the light makes a colour a little fuller, so the numbers
// are a little less full than what they come to). The body is the accent's orange
// in the light and a red turned toward violet in the shade, never black; the
// deep paint is where nothing reaches (the underside, the arches' rims). The
// tyres and the trim are a dark blue, not black: a painter's palette has none,
// and a black mass would hide the shape of what is under the car. What is
// seen through the glass is one flat colour. shape: 1 the paint's highlight,
// 2 the glass's stripes (centred on the model's point `center`, mm).
const PAINT_LIGHT = 2.4;
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const onScreen = (rgb) => rgb.map((c) => linear(c) / PAINT_LIGHT);
const PAINTS = {
  body: { lit: [1.00, 0.45, 0.31], shade: [0.48, 0.19, 0.27], deep: [0.31, 0.11, 0.21], shape: 1 },
  glass: { lit: [0.31, 0.40, 0.49], shade: [0.10, 0.12, 0.17], deep: [0.07, 0.08, 0.12], shape: 2, center: [-275, 1166, 0] },
  tyre: { lit: [0.18, 0.19, 0.24], shade: [0.12, 0.13, 0.18], deep: [0.12, 0.13, 0.18] },
  hub: { lit: [0.78, 0.80, 0.82], shade: [0.34, 0.40, 0.52], deep: [0.20, 0.24, 0.34] },
  trim: { lit: [0.22, 0.23, 0.29], shade: [0.15, 0.16, 0.22], deep: [0.15, 0.16, 0.22] },
  cabin: { lit: [0.15, 0.16, 0.22], shade: [0.15, 0.16, 0.22], deep: [0.15, 0.16, 0.22] },
};
// Which of them each material of the model has. The lamps have no paints in
// the table: their own colour, and the same darker.
const CAR_PAINT = {
  paint: 'body', paint_dark: 'body', paint_lo: 'body', caliper: 'body', emitter: 'body', thruster: 'body',
  glass: 'glass',
  rubber: 'tyre', rubber_side: 'tyre',
  alu: 'hub', chrome: 'hub',
  carbon: 'trim', black_trim: 'trim', gunmetal: 'trim', brake_disc: 'trim',
  leather: 'cabin', alcantara: 'cabin', carpet: 'cabin',
};
function carPaints(material) {
  const key = CAR_PAINT[material.name];
  if (key) {
    const p = PAINTS[key];
    return { lit: onScreen(p.lit), shade: onScreen(p.shade), deep: onScreen(p.deep), shape: p.shape || 0, center: p.center };
  }
  const c = material.color ? material.color.toArray() : [0.5, 0.5, 0.5];
  return { lit: c, shade: c.map((x) => x * 0.5), deep: c.map((x) => x * 0.35), shape: 0 };
}

// How shut in each point of the body is, a number a vertex (0 open to 1 shut
// in), in the model's own frame (mm, +X the nose, +Y up): not a ray cast, an
// estimate from where the point is. Near the floor the body is under itself,
// and the paint round the lip of a wheel arch is in the arch's shadow. The paint
// chooses its deep paint where this is over a half (aOcc, render/style.js).
const AXLES = [1350, -1350];       // x of the axles, which are 340 mm up
const ARCH_LIP = 402;              // the arch's opening, from its axle
const FLOOR = [190, 290];          // the height the body's lower edge is shut in to, and open from
const ARCH_BAND = [0, 60];         // how far round the lip, from it
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function occlusionOf(geometry) {
  const pos = geometry.attributes.position;
  const occ = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    let o = 1 - smooth(FLOOR[0], FLOOR[1], y);
    for (const ax of AXLES) {
      o = Math.max(o, 1 - smooth(ARCH_LIP + ARCH_BAND[0], ARCH_LIP + ARCH_BAND[1], Math.hypot(x - ax, y - 340)));
    }
    occ[i] = o;
  }
  return new THREE.BufferAttribute(occ, 1);
}

const DEG = Math.PI / 180;
// Where the drone may stand, as shares of its full 62 m back, 34 m aside and
// 42 m up, tried in turn until its line to the car is open: off the shoulder
// as far out as it can be; then behind and high, looking down the gap the
// road itself cuts (a cutting's walls or a street of towers flank the car,
// and coming straight in keeps the same blocked angle); then closer. Past
// DRONE_CROSS spots it would rather cross to the other shoulder.
const DRONE_SPOTS = [
  [1, 1, 1], [0.8, 0.8, 0.8],
  [1, 0.3, 1.1], [0.7, 0, 1.25],
  [0.62, 0.62, 0.62], [0.46, 0.46, 0.46], [0.32, 0.32, 0.32],
];
const DRONE_CROSS = 2;
const DRONE_DISSOLVE = 0.45;  // s, the director's dissolve

// Chassis cross-section in metres. A roll turns width against height, so these are
// the two that matter; the length stays parallel to the roll axis.
const BODY_HALF_WIDTH = 0.9;
const BODY_HALF_HEIGHT = 0.65;

// A spring stepped with semi-implicit Euler stays stable only while each step
// is short against its stiffness: with critical damping, dt * sqrt(k) under
// about 0.83. The camera's height spring takes three times the frame time, so
// at 40 fps it passed that, and on any slower machine the camera flew off by
// thousands of kilometres within seconds. A long frame is now taken in as
// many shorter steps as it needs. At 60 fps every spring here takes one step,
// exactly as before.
const SPRING_STEP = 0.6;

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
    const n = Math.max(1, Math.ceil((dt * Math.sqrt(k)) / SPRING_STEP));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const accel = (target - this.value) * k - this.velocity * c;
      this.velocity += accel * h;
      this.value += this.velocity * h;
    }
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

// Where the lens sits on the hood, in the car's own frame (m: x along the nose,
// y up from the ground), and how far below the nose's axis it looks (rad): 1.0 m
// ahead of the middle of the car, which is 1.25 m back from the tip of the nose
// and 0.3 m ahead of the foot of the windscreen, and 1.44 m up, 0.88 m over the
// leading edge of the nose and 0.44 m over the paint under it. In a field of 62
// degrees the front edge of the hood is in the bottom of the frame (the paint
// fills 13% of its height in the middle at rest, 17% at 27 m/s, where the field
// has opened to 67 degrees), with the road above it, and nothing of the cabin,
// which is all behind the lens, is in it.
export const HOOD = { x: 1.0, y: 1.44, pitch: 3.5 * (Math.PI / 180) };

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

// The car at the low tier: parts of materials that look alike from the lens are joined into one mesh
// drawn with the first of them (the others' triangles take its colour), on the body and on each wheel,
// so it is drawn in 26 calls and not 49. Each group is of one paint of the painted style; the lamps,
// the glass, the paint and the hover rings (which light up) keep their own. The other tiers draw the
// parts as they are (setTier).
// shadeless: the joined parts that cast no shadow at the low tier (the cabin is inside the body, a wheel's
// hub and the dark parts behind it inside its tyre: the body and the tyres cast the car's shadow).
export const CAR_LOW = {
  body: [['leather', ['leather', 'alcantara', 'carpet']], ['carbon', ['carbon', 'black_trim']]],
  wheel: [['rubber', ['rubber', 'rubber_side']], ['alu', ['alu', 'chrome', 'caliper']], ['gunmetal', ['gunmetal', 'black_trim', 'brake_disc']]],
  shadeless: ['leather', 'alu', 'gunmetal'],
};

// The meshes under `parent` (its own children) of each group joined into one, in the parent's frame: the
// joined meshes, hidden, and the parts they stand for. Only the attributes every part has are kept.
function joinParts(parent, groups, nameOf) {
  const by = {};
  for (const o of parent.children) if (o.isMesh && !Array.isArray(o.material)) by[nameOf(o)] = o;
  const joined = [];
  const parts = [];
  for (const [keep, names] of groups) {
    const meshes = names.map((n) => by[n]).filter(Boolean);
    if (meshes.length < 2 || !by[keep]) continue;
    const geos = meshes.map((o) => {
      o.updateMatrix();
      return o.geometry.clone().applyMatrix4(o.matrix);
    });
    const shared = Object.keys(geos[0].attributes).filter((a) => geos.every((g) => g.attributes[a]));
    for (const g of geos) for (const a of Object.keys(g.attributes)) if (!shared.includes(a)) g.deleteAttribute(a);
    const merged = mergeGeometries(geos);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, by[keep].material);
    mesh.name = by[keep].name + '_low';
    mesh.castShadow = !CAR_LOW.shadeless.includes(keep);
    mesh.receiveShadow = true;
    mesh.visible = false;
    parent.add(mesh);
    joined.push(mesh);
    parts.push(...meshes);
  }
  return { joined, parts };
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
    // The low tier's joined parts and the parts they stand for (joinLow, CAR_LOW), and the tier.
    this.low = null;
    this.tier = 'high';

    this.pitch = new Spring(0, 110, 0.85);
    this.roll = new Spring(0, 95, 0.8);
    this.heave = new Spring(0, 130, 1.0);
    // The body on its springs after a landing: pressed down, it comes up and
    // settles in a bounce or two (underdamped); the nose that came down with
    // the way it flew comes back to the ground's slope.
    this.squat = new Spring(0, 150, 0.32);
    this.landPitch = new Spring(0, 85, 0.55);
    this._flying = false;
    this._flightPitch = 0;
    this.airHeight = 0;     // m the tyres are above the ground, 0 on it
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

  /**
   * The parts that never move relative to the body, one mesh to a material
   * (by the model's name for it: the loader may have made several of one):
   * the model is drawn in a dozen calls rather than one per part. The wheels
   * keep their own meshes, which turn, steer and fold; parts of different
   * materials stay apart, so a style that marks the car part by part (the
   * mark is on the material) finds each part as it was.
   */
  _joinFixed(model) {
    model.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const byMaterial = new Map();
    const moving = (o) => {
      for (let p = o; p && p !== model; p = p.parent) if (/^wheel_/.test(p.name)) return true;
      return false;
    };
    model.traverse((o) => {
      if (!o.isMesh || Array.isArray(o.material) || moving(o)) return;
      const key = o.material.name || o.material.uuid;
      if (!byMaterial.has(key)) byMaterial.set(key, []);
      byMaterial.get(key).push(o);
    });
    for (const meshes of byMaterial.values()) {
      const material = meshes[0].material;
      const geos = meshes.map((o) => o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)));
      const merged = mergeGeometries(geos);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      for (const o of meshes) {
        o.parent.remove(o);
        o.geometry.dispose();
      }
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = 'car_' + material.name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      model.add(mesh);
    }
  }

  attach(gltfScene, scale = 0.001) {
    gltfScene.scale.setScalar(scale);
    this.body.add(gltfScene);
    this._joinFixed(gltfScene);
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
        } else if (o.material) {
          // Marked only where it draws without blending: the glass shows
          // what is behind it.
          o.material.userData.mark = CAR_MARK[o.material.name] || MARK.body;
        }
        if (o.material && !o.material.userData.figure) {
          // The painted style draws the car in flat paints of its own.
          o.material.userData.figure = true;
          o.material.userData.paints = carPaints(o.material);
        }
        // Its occlusion, for the paints: the parts that turn with the wheels
        // have none (their own frame is the wheel's).
        if (!o.geometry.attributes.aOcc) {
          let turning = false;
          for (let p = o; p && p !== gltfScene; p = p.parent) if (/^wheel_/.test(p.name)) turning = true;
          o.geometry.setAttribute('aOcc', turning ? new THREE.BufferAttribute(new Float32Array(o.geometry.attributes.position.count), 1) : occlusionOf(o.geometry));
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
    this.squat.step(0, dt);

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
    this.body.position.y = this.heave.value + this.squat.value + Math.max(0, half - BODY_HALF_HEIGHT)
      + rise + bob;

    this.steerAngle.step(car.steer || 0, dt);
    const visualSteer = THREE.MathUtils.clamp(this.steerAngle.value * 1.35, -0.6, 0.6);

    // On the road a wheel turns with the road. Off it, the brakes bring it down
    // to a slow idle before it folds, and it keeps turning over there.
    const wantSpin = (speed / WHEEL_RADIUS) * (1 - lift) + IDLE_SPIN * lift;
    this.spinRate += (wantSpin - this.spinRate) * Math.min(1, dt * 6);
    this.wheelSpin += this.spinRate * dt;

    const air = roadInfo.air || 0;
    this.airHeight = air;
    for (const w of this.wheels) {
      const phase = w.left ? 0 : Math.PI * 0.7;
      // Off the ground the wheels hang to the end of their travel.
      const travel = Math.sin(car.x * 0.8 + phase) * 0.018 * bump
        * Math.min(speed / 25, 1) * (1 - lift) + 0.07 * Math.min(1, air * 4) * (1 - lift);
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
        // Brightest when the pad is lowest in its bob; the further the car is
        // from the ground, the less of its light reaches it.
        w.pool.material.opacity = 0.5 * fold * (1 - bob / BOB * 0.12) / (1 + air * 1.6);
        w.pool.visible = fold > 0.01 && air < 4;
        w.pool.position.y = 0.02 - air;
      }
    }

    // Both axles get their own road height. Seating the car on one height and
    // tilting it about that point put the rear wheels under the surface on a
    // grade: 2.7 m of wheelbase is a large height difference.
    const base = car.y !== undefined ? car.y : (roadInfo.roadY || 0);
    // Both axles stand on the ground's height there, and in the air on what
    // the car has risen above it.
    const hubF = (roadInfo.hubF !== undefined ? roadInfo.hubF : base + WHEEL_RADIUS) + air;
    const hubR = (roadInfo.hubR !== undefined ? roadInfo.hubR : base + WHEEL_RADIUS) + air;

    // The body's pitch is the angle between the two axle heights. Deriving it from
    // the surface rather than from a grade sample keeps the wheels and the body
    // agreeing by construction.
    const surfacePitch = Math.atan2(hubF - hubR, WHEELBASE);
    let pitch;
    if (car.airborne && air > 0.03) {
      // In the air a car keeps the attitude it left the ground with and turns
      // only slowly toward the way it is flying: nose up on the way up, down
      // on the way down.
      if (!this._flying) {
        this._flying = true;
        this._flightPitch = surfacePitch;
      }
      const aim = Math.atan2(car.vyWorld || 0, Math.max(car.vx || 0, 6)) * 0.85;
      this._flightPitch += (aim - this._flightPitch) * Math.min(1, dt * 1.4);
      pitch = this._flightPitch;
    } else {
      if (this._flying) {
        // Down: the nose is where it was in the air, and the springs bring it
        // to the ground.
        this._flying = false;
        this.landPitch.value = this._flightPitch - surfacePitch;
        this.landPitch.velocity = 0;
      }
      this.landPitch.step(0, dt);
      pitch = surfacePitch + this.landPitch.value;
    }
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

  // The parts joined for the low tier (CAR_LOW), the first time the model is drawn at it (its materials
  // are what they are to be by then): the body's fixed parts by their material's name, each wheel's by its own.
  _joinLow() {
    const body = joinParts(this.model, CAR_LOW.body, (o) => o.material.name);
    const joined = [...body.joined];
    const parts = [...body.parts];
    for (const w of this.wheels) {
      const wheel = joinParts(w.spin, CAR_LOW.wheel, (o) => o.material.name);
      joined.push(...wheel.joined);
      parts.push(...wheel.parts);
    }
    this.low = { joined, parts };
  }

  // How much there is to draw (render/quality.js): the low tier draws the joined parts in place of theirs.
  // (Game.loadCar hands it the tier again once the model is dressed.)
  setTier(tier) {
    this.tier = tier;
    const low = tier === 'low';
    if (low && this.model && !this.low) this._joinLow();
    if (!this.low) return;
    for (const m of this.low.joined) m.visible = low;
    for (const m of this.low.parts) m.visible = !low;
  }

  // The meshes of the car drawn now (for the checks).
  meshes() {
    const out = [];
    if (this.model) this.model.traverse((o) => { if (o.isMesh && o.visible) out.push(o); });
    return out;
  }

  // What joinLow made is let go of.
  dispose() {
    if (!this.low) return;
    for (const m of this.low.joined) {
      m.parent.remove(m);
      m.geometry.dispose();
    }
    for (const m of this.low.parts) m.visible = true;
    this.low = null;
  }

  // Where the hood's lens (HOOD) is in the world, left in `out`, and the way the
  // nose points, left in `axis`: the lens is a point of the body, so it goes with
  // the car's heading and pitch and with the body on its springs. The matrices
  // are the ones update() has just set, not the ones the next frame will draw with.
  hood(out, axis) {
    this.root.updateMatrix();
    this.body.updateMatrix();
    if (axis) axis.set(1, 0, 0).transformDirection(this.body.matrix).transformDirection(this.root.matrix);
    return out.set(HOOD.x, HOOD.y, 0).applyMatrix4(this.body.matrix).applyMatrix4(this.root.matrix);
  }

  // The car comes down from the air at `impact` m/s: the body goes down on its
  // springs and comes back up, in proportion.
  land(impact) {
    this.squat.value = Math.min(this.squat.value, -Math.min(0.22, 0.03 + impact * 0.02));
    this.squat.velocity = 0;
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

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

// What the lens does with the drive; each number is the strength of one thing.
// All of them but the first two go to zero while `shaking` is off (the settings),
// so a lens held still keeps still and only turns with the road.
//
// Into the bend: the rig is turned toward the road's curvature `lead` seconds of
// travel ahead, by curvature * speed * gain rad, at most `max`, through a spring
// of this stiffness (a bend 60 m in radius at 20 m/s: 0.117 rad).
const BEND = { lead: 0.9, gain: 0.35, max: 0.14, stiffness: 12 };
// Looking round with the right button: the rig is turned about the car by what
// is dragged (rad a pixel), within these limits; the view is kept for `hold` s
// after the button is let go and brought back over `back` s. The pivot is
// `pivot` m above the car.
const ROUND = {
  yaw: 140 * DEG, up: 50 * DEG, down: -10 * DEG, rate: 0.3 * DEG, hold: 2, back: 1.2, pivot: 1.0,
};
// Out of the bend: the lens rolls about the line of sight by this many rad for
// each m/s^2 of lateral acceleration, at most `max` (2.5 degrees), to the outside.
const LEAN = { gain: 0.004, max: 0.044, stiffness: 60 };
// Rumble: above `from` m/s the lens is moved by (speed - from) * gain m, at most
// `max`, by three sines at these frequencies (Hz), none a multiple of another:
// one sideways, one up, one along the line of sight. Off the road it is more.
const RUMBLE = { from: 42, gain: 0.0012, max: 0.02, offRoad: 2.5, hz: [9.7, 13.1, 16.9] };
// A landing: the lens goes down by `gain` m for each m/s of the fall, at most
// `max`, and comes back on a spring with a bounce (a damping of 0.6, a period of
// half a second: a dip of 6 cm is under 5 mm again within a third of a second);
// the field of view opens by `fov` degrees and closes the same way.
const SINK = { gain: 0.02, max: 0.18, fov: 2, stiffness: 144 };
// A car going by close: the lens turns toward it by `angle` and back in `time` s.
const BRUSH = { angle: 0.4 * DEG, time: 0.3 };
// The hood lens looks along a line this long (m), which only has to be far.
const HOOD_AIM = 30;

/**
 * The curvature of the road `lead` seconds of travel ahead of a car at arc
 * length s, signed so that a bend the heading grows into (a right turn) is
 * positive whichever way along the road the car points.
 */
export function bendAhead(road, s, car, lead = BEND.lead) {
  const here = road.at(s);
  if (!here) return 0;
  const way = Math.cos(car.yaw - here.theta) >= 0 ? 1 : -1;
  const ahead = road.at(s + way * (car.speed || 0) * lead);
  return ahead ? way * ahead.kappa : 0;
}

export class ChaseCamera {
  /**
   * Cinematic chase rig. Position, heading and look-at each have their own
   * spring, so the camera lags the car, swings wide through corners, pulls back
   * with speed, and eases between framings instead of cutting. It looks into
   * the bend ahead, leans out of it, rumbles at speed, goes down on a landing
   * and leans toward a car going by; the right button drags it round the car.
   *
   * What shakes it is the game's clock (opts.time of update) and phases taken
   * from the seed, so the same drive shakes it the same way every time.
   */
  constructor(camera, opts = {}) {
    this.camera = camera;

    this.posX = new Spring(0, 120, 1.0);
    this.posY = new Spring(2.6, 140, 1.0);
    this.posZ = new Spring(0, 120, 1.0);
    this.lookX = new Spring(0, 40, 1.0);
    this.lookY = new Spring(1.2, 40, 1.0);
    this.lookZ = new Spring(0, 40, 1.0);

    this.yaw = new Spring(0, 30, 1.0);
    this.lookIn = new Spring(0, BEND.stiffness, 1.0);   // how far the rig has turned into the bend ahead, rad
    this.dist = new Spring(9.0, 22, 0.9);
    this.fov = new Spring(52, 25, 0.95);
    this.shake = new Spring(0, 60, 0.5);
    const rand = mulberry32((opts.seed || 0) ^ 0x5ca3e1);
    this.shakeSeed = rand() * 1000;
    this.phase = RUMBLE.hz.map(() => rand() * TAU);
    this.shaking = true;     // false: the lens keeps still over bumps, landings, speed and bends (the settings)
    this.lead = true;        // false: the lens points where the car does and does not turn into the bend ahead (the frames taken of a place, not of a drive)
    this.lean = new Spring(0, LEAN.stiffness, 1.0);     // rad, out of the bend
    this.sink = new Spring(0, SINK.stiffness, 0.6);     // m, a landing's dip (negative: down)
    this.punch = new Spring(0, SINK.stiffness, 0.9);    // degrees, what a landing opens the field by
    this._brush = null;      // a car going by: { side, age }
    this._clock = 0;         // the lens's own time, for a caller that gives none

    // Looking round: how far the rig is turned about the car, and the button.
    this.view = { yaw: 0, pitch: 0, held: false, idle: 0, from: null };

    // The hood lens turns with the car, a little behind it.
    this.hoodYaw = new Spring(0, 250, 1.0);

    this.framing = 'chase';
    this.frameWeights = { chase: 1, low: 0, drone: 0, hood: 0 };
    this.targetWeights = { chase: 1, low: 0, drone: 0, hood: 0 };

    this._initialised = false;
    this._lookAt = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._hoodPos = new THREE.Vector3();
    this._hoodAxis = new THREE.Vector3();
    this._hoodLook = new THREE.Vector3();
    this._pivot = new THREE.Vector3();
    this._axis = new THREE.Vector3();
    this._away = new THREE.Vector3();
    this._qa = new THREE.Quaternion();
    this._qb = new THREE.Quaternion();
  }

  static FRAMINGS = {
    // back, up, side are unit offsets; ahead/lookUp shape the aim point.
    chase: { back: 1.0, up: 0.42, side: 0.0, ahead: 1.0, lookUp: 0.16, fov: 0 },
    // Side offsets are kept small: a large one puts the lens over the verge and
    // makes the road read as if the car had left it.
    low: { back: 0.62, up: 0.05, side: 0.10, ahead: 1.10, lookUp: 0.05, fov: 5 },
    // A high, wide shot from a drone trailing the car: the serpentines, the
    // viaducts and the valley below. Blended in separately (see update).
    drone: { back: 1.0, up: 0.42, side: 0.0, ahead: 1.0, lookUp: 0.16, fov: 0 },
    // The lens on the hood (HOOD), looking down the road, in a field of 62
    // degrees. Its place is the car's, blended in separately (see update); the
    // numbers here are what the rig under it holds meanwhile.
    hood: { back: 1.0, up: 0.42, side: 0.0, ahead: 1.0, lookUp: 0.16, fov: 10 },
  };

  // Framings the director drives (side, front and the director itself, see
  // director.js); this rig keeps a chase running underneath them for the
  // director to start from.
  setFraming(name) {
    const directed = DIRECTED.includes(name);
    if (!ChaseCamera.FRAMINGS[name] && !directed) return;
    this.framing = name;
    const rig = directed ? 'chase' : name;
    for (const k of Object.keys(this.targetWeights)) {
      this.targetWeights[k] = k === rig ? 1 : 0;
    }
    // Only the chase lens looks round: leaving it, the view starts back at once.
    if (name !== 'chase') this.letGo(true);
  }

  // Set a framing with no blend in, for a page that opens on it.
  snapFraming(name) {
    this.setFraming(name);
    for (const k of Object.keys(this.frameWeights)) this.frameWeights[k] = this.targetWeights[k];
  }

  cycle() {
    const order = ['chase', 'director', 'drone', 'side', 'low', 'front', 'hood'];
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

  // A jolt to the lens, a landing's: metres of shake, which dies away.
  kick(amount) {
    this.shake.value += Math.min(0.2, amount);
  }

  // The car has come down from the air at `impact` m/s: the lens goes down on
  // its springs in proportion, with the field of view a little wider, and
  // both come back. Nothing while the lens is held still.
  land(impact) {
    if (!this.shaking) return;
    this.sink.value = Math.min(this.sink.value, -Math.min(SINK.max, impact * SINK.gain));
    this.sink.velocity = 0;
    this.punch.value = Math.max(this.punch.value, SINK.fov);
    this.punch.velocity = 0;
  }

  // A car goes by close: the lens turns toward it (side 1: to the right of the
  // car, -1: to the left) and back. Nothing while the lens is held still.
  brush(side) {
    if (!this.shaking) return;
    this._brush = { side: side < 0 ? -1 : 1, age: 0 };
  }

  // Looking round. The right button held down and dragged turns the rig about
  // the car: dragging right takes the lens round to the car's left, dragging
  // down takes it up. Only the chase lens does it; the others keep the button
  // for the browser. Let go, the view stays for ROUND.hold s and then goes back.
  grab() {
    const v = this.view;
    v.held = true;
    v.idle = 0;
    v.from = null;
  }

  drag(dx, dy) {
    if (this.framing !== 'chase') return;
    this.grab();
    const v = this.view;
    v.yaw = THREE.MathUtils.clamp(v.yaw + dx * ROUND.rate, -ROUND.yaw, ROUND.yaw);
    v.pitch = THREE.MathUtils.clamp(v.pitch + dy * ROUND.rate, ROUND.down, ROUND.up);
  }

  // The button is let go (now: the view starts back at once).
  letGo(now = false) {
    const v = this.view;
    v.held = false;
    v.idle = now ? ROUND.hold : 0;
  }

  // The right button on `target` (the canvas): pressed and moved, it looks
  // round; the browser's menu for it stays shut while the chase lens is the one
  // in use. The pointer is held by the target while it is down, so a drag that
  // leaves the page still ends when the button is let go.
  listen(target) {
    let pointer = null;
    // Some systems open the menu when the button is let go, where the pointer
    // may be over a button of the page: the menu that follows a drag is shut
    // wherever it comes, once, and not for the next press.
    let owed = false;
    const end = () => {
      pointer = null;
      owed = true;
      this.letGo();
    };
    target.addEventListener('pointerdown', (e) => {
      if (e.button !== 2 || e.pointerType !== 'mouse' || this.framing !== 'chase') return;
      pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.grab();
      if (target.setPointerCapture) {
        try { target.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
      }
      e.preventDefault();
    });
    target.addEventListener('pointermove', (e) => {
      if (!pointer || e.pointerId !== pointer.id) return;
      // A button let go where nobody saw it (another window had the focus).
      if (!(e.buttons & 2)) {
        end();
        return;
      }
      this.drag(e.clientX - pointer.x, e.clientY - pointer.y);
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    });
    const up = (e) => {
      if (pointer && e.pointerId === pointer.id) end();
    };
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
    target.addEventListener('lostpointercapture', up);
    target.addEventListener('contextmenu', (e) => {
      if (this.framing === 'chase') e.preventDefault();
    });
    const page = target.ownerDocument;
    if (page) {
      page.addEventListener('pointerdown', () => { owed = false; }, true);
      page.addEventListener('contextmenu', (e) => {
        if (pointer || owed) {
          e.preventDefault();
          owed = false;
        }
      }, true);
    }
  }

  /**
   * @param dt    frame seconds
   * @param car   physics state ({ x, z, yaw, speed, lateralG })
   * @param opts  the ground and the road round the car (roadY, air, groundAt,
   *              ceilingAt, ...), and for the feel of the drive: time (the
   *              game's clock in s, which the shakes go by), curvature (of the
   *              road 0.9 s ahead, 1/m, positive to the right: bendAhead),
   *              offRoad, and hood (a function that leaves the hood lens's place
   *              in the world in the vector it is given and the way the nose
   *              points in a second one)
   */
  update(dt, car, opts = {}) {
    const speed = car.speed || 0;
    const speedN = THREE.MathUtils.clamp(speed / 60, 0, 1);
    const time = opts.time !== undefined ? opts.time : (this._clock += dt);

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

    // Into the bend: the rig is turned further the way the road ahead bends,
    // by how sharp it is and how fast the car comes to it, so the lens is
    // already looking round the bend when the car gets there. This is where
    // the car points, not a shake: it holds with the lens held still.
    this.lookIn.step(
      this.lead ? THREE.MathUtils.clamp((opts.curvature || 0) * speed * BEND.gain, -BEND.max, BEND.max) : 0, dt,
    );
    // The drone keeps to where the car points; the rest of the rig is aimed
    // a little further round.
    const heading = this.yaw.value;
    const hx = Math.cos(heading), hz = Math.sin(heading);
    const yaw = heading + this.lookIn.value;
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
    // aiming at the car's height tilted the lens down into the road. Only as
    // far as a road climbs, though: in a bending bore the point ahead falls
    // off the road, and the ground there is the hill over the tunnel, which
    // turned the lens up at the vault and lost the car.
    const lookGround = opts.groundAt
      ? Math.min(opts.groundAt(car.x + fx * lookAheadM, car.z + fz * lookAheadM), baseY + lookAheadM * 0.16)
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
    // A car in the air rises out of the shot instead of taking the lens up with it.
    const clearance = Math.max(baseY - Math.max(0, opts.air || 0) * 0.6, camGround);
    this.posY.step(clearance + 2.05 + up * 1.7 + speedN * 0.5, dt * 3);

    const shakeTarget = (opts.bump || 0) * speedN * 0.05 + (opts.impact || 0) * 0.2;
    this.shake.step(shakeTarget, dt);
    const shaken = this.shaking ? this.shake.value : 0;
    const sx = Math.sin(time * 37 + this.shakeSeed) * shaken;
    const sy2 = Math.sin(time * 41 + this.shakeSeed * 2) * shaken * 0.7;

    this._pos.set(this.posX.value + sx, this.posY.value + sy2, this.posZ.value);
    this._lookAt.set(this.lookX.value, this.lookY.value, this.lookZ.value);

    // Looking round, in the chase lens, about the car.
    this._lookRound(dt, car, opts, this.frameWeights.chase / sum);

    // Drone: trail high and wide off the car's shoulder, looking down the road
    // ahead. Its position is smoothed on its own so the shot glides.
    const dw = this.frameWeights.drone / sum;
    if (dw > 0.001) {
      const baseYd = opts.roadY || 0;
      const want = this._droneWant || (this._droneWant = new THREE.Vector3());
      const replanned = this._droneSpot(want, car, baseYd, hx, hz, -hz, hx, dt, opts);
      const dp = this._dronePos || (this._dronePos = want.clone());
      if (this._droneCut) {
        // The last frame was held: the jump happens under a dissolve.
        this._droneCut = false;
        dp.copy(want);
        opts.post.dissolve(DRONE_DISSOLVE);
      } else if (replanned && this._droneLost && opts.post && !this._dronePathClear(dp, want, opts)) {
        // Lost, and the way to the new spot runs through a tower: no drone
        // flies through one, so cut to it, as the director would.
        opts.post.hold();
        this._droneCut = true;
      } else {
        // A drone that has lost the car gets out of there faster than it
        // glides.
        dp.lerp(want, Math.min(1, dt * (this._droneLost ? 4 : 1.2)));
      }
      // Where it is, not where it is going: it trails its spot by a few
      // metres, and that is enough to put a tower or a rise of the land in
      // the way. Asked every frame; a hit makes it look for a new spot at
      // once.
      if (opts.sees && !this._droneLost && !this._droneCut && !this._droneSeesNow(dp, car, baseYd, opts)) {
        this._droneLost = true;
        this._droneClock = 0;
      }
      const look = this._droneLook || (this._droneLook = new THREE.Vector3());
      look.set(car.x + hx * 30, baseYd, car.z + hz * 30);
      this._pos.lerp(dp, dw);
      this._lookAt.lerp(look, dw);
    } else if (this._dronePos) {
      this._dronePos.copy(this._pos);
    }

    // Hood: the lens is a point of the car, looking along the nose (its pitch,
    // so the hood keeps its place in the frame) a little downward, and turned
    // with the car's heading, tightly, and into the bend as the rest are.
    this.hoodYaw.step(this._unwrap(car.yaw, this.hoodYaw.value), dt);
    const hw = this.frameWeights.hood / sum;
    if (hw > 0.001) {
      const at = this._hoodPos;
      const axis = this._hoodAxis;
      if (opts.hood) opts.hood(at, axis);
      else {
        at.set(car.x + Math.cos(car.yaw) * HOOD.x, baseY + HOOD.y, car.z + Math.sin(car.yaw) * HOOD.x);
        axis.set(Math.cos(car.yaw), 0, Math.sin(car.yaw));
      }
      const turn = this.hoodYaw.value + this.lookIn.value;
      const tilt = Math.asin(THREE.MathUtils.clamp(axis.y, -1, 1)) - HOOD.pitch;
      const flat = Math.cos(tilt) * HOOD_AIM;
      const aim = this._hoodLook.set(at.x + Math.cos(turn) * flat, at.y + Math.sin(tilt) * HOOD_AIM, at.z + Math.sin(turn) * flat);
      this._pos.lerp(at, hw);
      this._lookAt.lerp(aim, hw);
    }

    // Inside a tunnel the vault is the ceiling.
    if (opts.ceilingAt) {
      const ceil = opts.ceilingAt(this._pos.x, this._pos.z);
      if (ceil !== null && this._pos.y > ceil - 0.8) this._pos.y = ceil - 0.8;
    }

    this.camera.position.copy(this._pos);
    this.camera.lookAt(this._lookAt);

    // A car going by close: the lens turns toward it and back.
    const brush = this._brushBy(dt);
    if (brush !== 0) this.camera.quaternion.premultiply(this._qa.setFromAxisAngle(UP, brush));

    // Tip the horizon with the car so it reads as a body rolling on suspension
    // rather than a model pivoting in place. And out of the bend the lens rolls
    // the other way, to the outside: rotateZ turns the lens counter-clockwise,
    // its up toward its left, which in a right-hand bend (lateralG above zero)
    // is the outside.
    const camRoll = THREE.MathUtils.clamp(-(car.lateralG || 0) * 0.014, -0.05, 0.05);
    const lateral = (car.lateralG || 0) * 9.81;
    this.lean.step(THREE.MathUtils.clamp(lateral * LEAN.gain, -LEAN.max, LEAN.max), dt);
    this.camera.rotateZ(camRoll + (this.shaking ? this.lean.value : 0));

    // Speed makes the lens rumble: three sines at frequencies none of which is
    // a multiple of another, on the game's clock, one sideways, one up, one
    // along the line of sight.
    const over = speed - RUMBLE.from;
    if (this.shaking && over > 0) {
      const amount = Math.min(RUMBLE.max, over * RUMBLE.gain) * (opts.offRoad ? RUMBLE.offRoad : 1);
      const a = Math.sin(TAU * RUMBLE.hz[0] * time + this.phase[0]) * amount;
      const b = Math.sin(TAU * RUMBLE.hz[1] * time + this.phase[1]) * amount;
      const c = Math.sin(TAU * RUMBLE.hz[2] * time + this.phase[2]) * amount;
      this.camera.position.x += lx * a + fx * c;
      this.camera.position.y += b;
      this.camera.position.z += lz * a + fz * c;
    }

    // A landing presses the lens down and opens the field; both come back.
    this.sink.step(0, dt);
    this.punch.step(0, dt);
    if (this.shaking) this.camera.position.y += this.sink.value;

    this.fov.step(52 + fovOff + speedN * 12, dt);
    const fov = this.fov.value + (this.shaking ? this.punch.value : 0);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // How far the lens is turned by a car that went by close just now, rad (to
  // the left for a car on the right): half a sine over BRUSH.time.
  _brushBy(dt) {
    const b = this._brush;
    if (!b) return 0;
    if (!this.shaking) {
      this._brush = null;
      return 0;
    }
    b.age += dt;
    if (b.age >= BRUSH.time) {
      this._brush = null;
      return 0;
    }
    return -b.side * BRUSH.angle * Math.sin((Math.PI * b.age) / BRUSH.time);
  }

  // The rig turned about the car by the view that was dragged: the lens and
  // what it looks at are turned together, about the vertical through the car
  // and then about the horizontal at right angles to where the lens now
  // stands, so the car stays where the lens looks. `share` is how much of the
  // blend the chase lens is. After ROUND.hold s with the button let go the view
  // goes back to where it was over ROUND.back s.
  _lookRound(dt, car, opts, share) {
    const v = this.view;
    if (!v.held && (v.yaw !== 0 || v.pitch !== 0)) {
      v.idle += dt;
      if (v.idle > ROUND.hold) {
        if (!v.from) v.from = [v.yaw, v.pitch];
        const k = Math.min(1, (v.idle - ROUND.hold) / ROUND.back);
        const left = k >= 1 ? 0 : 1 - ease(k);
        v.yaw = v.from[0] * left;
        v.pitch = v.from[1] * left;
        if (k >= 1) v.from = null;
      }
    }
    const yaw = v.yaw * share;
    const pitch = v.pitch * share;
    if (yaw === 0 && pitch === 0) return;

    const pivot = this._pivot.set(car.x, (opts.roadY || 0) + ROUND.pivot, car.z);
    const round = this._qa.setFromAxisAngle(UP, -yaw);
    const away = this._away.copy(this._pos).sub(pivot).applyQuaternion(round);
    const bearing = Math.atan2(away.z, away.x);
    const over = this._axis.set(-Math.sin(bearing), 0, Math.cos(bearing));
    const turn = this._qb.setFromAxisAngle(over, pitch).multiply(round);
    this._pos.sub(pivot).applyQuaternion(turn).add(pivot);
    this._lookAt.sub(pivot).applyQuaternion(turn).add(pivot);
    // The lens may be turned down into the road, or into a cutting's wall.
    if (opts.groundAt) {
      const floor = opts.groundAt(this._pos.x, this._pos.z) + 0.8;
      if (this._pos.y < floor) this._pos.y = floor;
    }
  }

  // Where the drone wants to be: 62 m back, 34 m off one shoulder and 42 m
  // up, with an open line down to the car. Something in the way (a tower, the
  // cavern's roof, a rise of the land) sends it to the next spot in
  // DRONE_SPOTS; if that is not enough, it crosses to the other shoulder and
  // stays there a while, so a street of towers does not swing it to and fro.
  // Once the line clears it drifts back out. In a tunnel nothing sees the
  // car: it keeps its place. The line is the director's own sight test
  // (opts.sees), looked at five times a second. Returns whether it looked
  // this frame.
  _droneSpot(out, car, baseY, fx, fz, lx, lz, dt, opts) {
    if (this._droneSide === undefined) {
      this._droneSide = 1;
      this._droneShare = DRONE_SPOTS[0].slice();
      this._droneIdx = 0;
      this._droneHold = 0;
      this._droneClock = 0;
    }
    const place = (p, sgn, [b, s, u]) => {
      p.set(car.x - fx * 62 * b + lx * 34 * s * sgn, baseY + 42 * u, car.z - fz * 62 * b + lz * 34 * s * sgn);
      if (opts.groundAt) p.y = Math.max(p.y, opts.groundAt(p.x, p.z) + 18 * Math.min(1, u));
      return p;
    };
    this._droneHold = Math.max(0, this._droneHold - dt);
    this._droneClock -= dt;
    let looked = false;
    const inBore = opts.ceilingAt && opts.ceilingAt(car.x, car.z) !== null;
    if (!opts.sees || inBore) {
      this._droneIdx = 0;
      this._droneLost = false;
    } else if (this._droneClock <= 0) {
      looked = true;
      this._droneClock = 0.2;
      // The car's point first: on the frame the drone is taken it has no
      // position of its own yet, and the spots are all looked at from here.
      const at = this._droneFrom || (this._droneFrom = new THREE.Vector3());
      at.set(car.x, baseY + 0.8, car.z);
      this._droneLost = !!this._dronePos && !opts.sees(this._dronePos, at);
      // Nowhere open (the car just out of a bore, the hill still behind
      // it): coming closer keeps it behind the same hill, so it stays put.
      let idx = this._droneIdx;
      for (let i = 0; i < DRONE_SPOTS.length; i++) {
        if (i === DRONE_CROSS && this._droneHold === 0 && opts.sees(place(out, -this._droneSide, DRONE_SPOTS[0]), at)) {
          this._droneSide = -this._droneSide;
          this._droneHold = 4;
          idx = 0;
          break;
        }
        if (opts.sees(place(out, this._droneSide, DRONE_SPOTS[i]), at)) { idx = i; break; }
      }
      // A worse spot is taken at once (the smoothing of the drone's position
      // carries the move); a better one is eased back to.
      if (idx > this._droneIdx) this._droneShare = DRONE_SPOTS[idx].slice();
      this._droneIdx = idx;
    }
    const want = DRONE_SPOTS[this._droneIdx];
    const sh = this._droneShare;
    for (let j = 0; j < 3; j++) sh[j] += THREE.MathUtils.clamp(want[j] - sh[j], -dt * 0.25, dt * 0.25);
    place(out, this._droneSide, sh);
    return looked;
  }

  // Whether a drone can fly straight from a to b without passing through
  // anything solid or the land.
  _dronePathClear(a, b, opts) {
    if (!opts.solidAt) return true;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / 4));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = a.x + dx * t, y = a.y + dy * t, z = a.z + dz * t;
      if (opts.solidAt(x, y, z)) return false;
      if (opts.terrainAt && i % 2 === 0 && opts.terrainAt(x, z) > y - 2) return false;
    }
    return true;
  }

  // Whether a drone at p sees the car. Leaves the car's point in _droneFrom.
  _droneSeesNow(p, car, baseY, opts) {
    const from = this._droneFrom || (this._droneFrom = new THREE.Vector3());
    from.set(car.x, baseY + 0.8, car.z);
    return opts.sees(p, from);
  }

  /** Unwrap so crossing +-PI does not send the camera the long way round. */
  _unwrap(target, from = this.yaw.value) {
    let d = target - from;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return from + d;
  }

  snapTo(car, baseY = 0) {
    const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    this.yaw.reset(car.yaw);
    this.hoodYaw.reset(car.yaw);
    this.lookIn.reset(0);
    this.lean.reset(0);
    this.sink.reset(0);
    this.punch.reset(0);
    this._brush = null;
    this.view.yaw = 0;
    this.view.pitch = 0;
    this.view.from = null;
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
