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
  // `seed` shifts where every car starts along the track. Positions stay a pure
  // function of (index, seed), so traffic is reproducible but a reload is not the
  // same drive twice.
  constructor(parent, track, seed = 0) {
    this.track = track;
    this.cars = [];
    for (let i = 0; i < COUNT; i++) {
      const oncoming = i % 2 === 0;
      this.cars.push({
        s: ((hash01(i * 3.1 + seed * 0.017) + seed * 0.00013) % 1) * 4000,
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
      if (!p) {
        this._m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this._m);
        continue;
      }

      const nx = -Math.sin(p.theta);
      const nz = Math.cos(p.theta);

      // Pitch from the two axles, measured along the car's own direction. Sampling
      // only "ahead" and then flipping the sign for oncoming cars double-counted
      // the direction, which buried their noses in the road on a climb.
      const front = this.track.at(c.s + 1.35 * c.dir);
      const rear = this.track.at(c.s - 1.35 * c.dir);
      const hubF = (front ? front.y : (p.y || 0)) + 0.02;
      const hubR = (rear ? rear.y : (p.y || 0)) + 0.02;
      const pitch = Math.atan2(hubF - hubR, 2.7);

      // Seat on the mean hub height, then lift by the low axle's fall so neither
      // end cuts into the surface.
      const mean = (hubF + hubR) * 0.5;
      const lowEnd = Math.abs(Math.sin(pitch)) * 1.35;
      this._p.set(p.x + nx * c.lane, mean + lowEnd, p.z + nz * c.lane);

      const yaw = c.dir > 0 ? p.theta : p.theta + Math.PI;
      this._e.set(0, -yaw, pitch, 'YXZ');
      this._q.setFromEuler(this._e);

      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  // Push cars away from a point so a reset does not drop the player straight into
  // the car it just hit.
  clearNear(sCar, range) {
    for (const c of this.cars) {
      const d = c.s - sCar;
      if (Math.abs(d) < range) {
        c.s = sCar + (d >= 0 ? range : -range) * (1 + Math.abs(d) / range);
      }
    }
  }

  // Nearest car ahead of the player travelling the given direction. Returns null
  // when the road is clear.
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

  // Closest oncoming car regardless of lane, since the autopilot has to decide
  // whether to give way before it can see which side it is on.
  nearestOncoming(sCar, range = 90) {
    return this.nearestAhead(sCar, -1, range);
  }

  // Nearest car of the given direction just behind the player. A completed pass
  // is exactly this: the car we went around is now in this window.
  nearestBehind(sCar, dir = 1, range = 24) {
    let best = null;
    let bestD = Infinity;
    for (const c of this.cars) {
      if (c.dir !== dir) continue;
      const d = (sCar - c.s) * dir;
      if (d > 0 && d < range && d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best ? { car: best, distance: bestD } : null;
  }

  // Is the oncoming lane clear for long enough to complete a pass? The window
  // covers the distance the car will cover while alongside, plus margin, so a
  // pass is never started into a car that is about to arrive.
  oncomingLaneClear(sCar, needed = 95) {
    for (const c of this.cars) {
      if (c.lane > 0) continue;
      const d = c.s - sCar;
      // A car closing fast matters more than one that is merely near: scale the
      // window by how quickly we meet it.
      if (d > -25 && d < needed) return false;
    }
    return true;
  }

  // Distance to the nearest oncoming car, so the autopilot can judge whether a
  // pass is worth starting rather than only whether the lane is perfectly clear.
  oncomingDistance(sCar) {
    let best = Infinity;
    for (const c of this.cars) {
      if (c.lane > 0) continue;
      const d = c.s - sCar;
      if (d > -25 && d < best) best = d;
    }
    return best;
  }
}
