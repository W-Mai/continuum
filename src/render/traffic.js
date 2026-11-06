// Oncoming and lane traffic.
//
// Cars are driven in arc-length space, not by physics: they follow the same
// centreline the player does, offset into a lane, paced by a speed that varies
// with curvature. That keeps them on the road through any profile and costs
// almost nothing, which is what makes a continuous stream affordable.

import * as THREE from 'three';

// Cars are spread over a rolling window of arc length and wrap at its edges, so
// the stream never runs out. The window is wide enough that a wrap always
// happens behind the player or past the fog.
const COUNT = 26;
const WINDOW = 1400;

const LANE_OFFSET = 3.0;     // metres from centreline to lane centre
const CAR_LEN = 4.4;
const CAR_WID = 1.85;
const CAR_HGT = 1.28;

function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// A single low-poly body: lower box, cabin, four wheels as flat discs. Built once
// and shared through InstancedMesh, so 26 cars cost one draw call.
function buildBody() {
  const parts = [];

  const lower = new THREE.BoxGeometry(CAR_LEN, CAR_HGT * 0.46, CAR_WID);
  lower.translate(0, CAR_HGT * 0.52, 0);
  parts.push(lower);

  const cabin = new THREE.BoxGeometry(CAR_LEN * 0.46, CAR_HGT * 0.42, CAR_WID * 0.86);
  cabin.translate(-CAR_LEN * 0.06, CAR_HGT * 0.88, 0);
  parts.push(cabin);

  // Bumpers front and rear, slightly proud of the body.
  for (const sx of [-1, 1]) {
    const b = new THREE.BoxGeometry(0.28, CAR_HGT * 0.26, CAR_WID * 0.94);
    b.translate(sx * (CAR_LEN * 0.5 - 0.1), CAR_HGT * 0.44, 0);
    parts.push(b);
  }

  // Wheels. Without them the silhouette reads as a crate rather than a car, and
  // four dark discs are cheap enough to keep the whole thing in one draw call.
  const wheelR = CAR_HGT * 0.30;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new THREE.CylinderGeometry(wheelR, wheelR, CAR_WID * 0.16, 10);
      // A cylinder's axis is Y; rotate so it lies along the car's lateral axis.
      w.rotateX(Math.PI / 2);
      w.translate(sx * CAR_LEN * 0.32, wheelR, sz * (CAR_WID * 0.5 - 0.08));
      parts.push(w);
    }
  }

  const pos = [];
  const nrm = [];
  const idx = [];
  let vo = 0;
  for (const g of parts) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    pos.push(...p.array);
    nrm.push(...n.array);
    const gi = g.index;
    for (let i = 0; i < gi.count; i++) idx.push(gi.array[i] + vo);
    vo += p.count;
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  out.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  out.setIndex(idx);
  return out;
}

export class Traffic {
  constructor(parent, track) {
    this.track = track;
    this.cars = [];
    for (let i = 0; i < COUNT; i++) {
      const oncoming = i % 2 === 0;
      this.cars.push({
        s: hash01(i * 3.1) * 4000,
        // Half travel with the player, half against, so both directions appear.
        dir: oncoming ? -1 : 1,
        lane: oncoming ? -LANE_OFFSET : LANE_OFFSET,
        speed: 16 + hash01(i * 7.7) * 16,
        // Per-car colour, applied through instanceColor.
        hue: hash01(i * 11.3),
      });
    }

    this.mesh = new THREE.InstancedMesh(
      buildBody(),
      new THREE.MeshStandardMaterial({
        roughness: 0.42, metalness: 0.35, envMapIntensity: 0.9,
      }),
      COUNT,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(COUNT * 3), 3,
    );
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._e = new THREE.Euler();
    this._c = new THREE.Color();

    for (let i = 0; i < COUNT; i++) this._paint(i);
  }

  _paint(i) {
    const c = this.cars[i];
    // Mostly muted, a few saturated: a road full of primary colours looks like a
    // toy set, but zero colour looks like traffic cones.
    const sat = c.hue > 0.78 ? 0.72 : 0.16;
    const light = c.hue > 0.78 ? 0.5 : 0.28 + c.hue * 0.4;
    this._c.setHSL(c.hue, sat, light);
    this.mesh.instanceColor.setXYZ(i, this._c.r, this._c.g, this._c.b);
  }

  update(dt, sCar) {
    const span = WINDOW * 0.5;

    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];

      // Keep every car inside a window around the player by wrapping in
      // arc-length space. Wrapping behind the player is invisible; wrapping in
      // front would pop, so the window is centred and the count is high enough
      // that a wrap always happens out of sight.
      c.s += c.dir * c.speed * dt;
      let rel = c.s - sCar;
      if (rel < -span) c.s += span * 2;
      else if (rel > span) c.s -= span * 2;
      rel = c.s - sCar;

      // Out of the render window entirely: park it at the far edge and hide it.
      const visible = Math.abs(rel) < 620;
      if (!visible) {
        this._m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this._m);
        continue;
      }

      const p = this.track.at(c.s);
      const ahead = this.track.at(c.s + 4 * c.dir);
      if (!p) {
        this._m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this._m);
        continue;
      }

      const nx = -Math.sin(p.theta);
      const nz = Math.cos(p.theta);

      this._p.set(p.x + nx * c.lane, (p.y || 0) + 0.02, p.z + nz * c.lane);

      // Heading: an oncoming car faces the opposite way, so its yaw is flipped.
      const yaw = c.dir > 0 ? p.theta : p.theta + Math.PI;
      // Pitch follows the grade so cars climb and crest with the road.
      const pitch = ahead ? Math.atan2((ahead.y || 0) - (p.y || 0), 4) : 0;
      this._e.set(0, -yaw, c.dir > 0 ? pitch : -pitch, 'YXZ');
      this._q.setFromEuler(this._e);

      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  // Nearest car ahead of the player within a lane, for the autopilot to reason
  // about. Returns null when the road is clear.
  nearestAhead(sCar, dir = 1, range = 90) {
    let best = null;
    let bestD = Infinity;
    for (const c of this.cars) {
      if (c.dir !== dir) continue;
      const d = (c.s - sCar) * dir;
      if (d > 0 && d < range && d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best ? { car: best, distance: bestD } : null;
  }
}
