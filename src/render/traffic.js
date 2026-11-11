// Traffic on the mountain road.
//
// Cars are driven in arc-length space along their lane, each with the
// Intelligent Driver Model: it accelerates toward a speed the bends ahead
// allow and brakes for whatever is in front of it in its lane, the player
// included. Nothing drives through anything. Oncoming cars appear far ahead
// along the road (several kilometres of arc, which on a mountain is still out
// of sight round the shoulders) and are retired once they are well behind.

import * as THREE from 'three';
import { LANE } from '../world/road.js';

const COUNT = 14;
const CAR_LEN = 4.4;
const CAR_WID = 1.85;
const CAR_HGT = 1.4;
const SPAN_AHEAD = 3200;
const SPAN_BEHIND = 500;

// IDM parameters.
const A_MAX = 1.6;
const B_COMF = 2.6;
const S0 = 4;
const T_HEAD = 1.6;

function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// A plain body with a cabin and wheels; one draw call for the whole stream.
function buildBody() {
  const parts = [];
  const lower = new THREE.BoxGeometry(CAR_LEN, CAR_HGT * 0.45, CAR_WID);
  lower.translate(0, CAR_HGT * 0.5, 0);
  parts.push(lower);
  const cabin = new THREE.BoxGeometry(CAR_LEN * 0.5, CAR_HGT * 0.38, CAR_WID * 0.86);
  cabin.translate(-CAR_LEN * 0.05, CAR_HGT * 0.9, 0);
  parts.push(cabin);
  const wheelR = 0.34;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new THREE.CylinderGeometry(wheelR, wheelR, 0.26, 12);
      w.rotateX(Math.PI / 2);
      w.translate(sx * CAR_LEN * 0.32, wheelR, sz * (CAR_WID * 0.5 - 0.1));
      parts.push(w);
    }
  }
  const pos = [];
  const nrm = [];
  const idx = [];
  let vo = 0;
  for (const g of parts) {
    pos.push(...g.attributes.position.array);
    nrm.push(...g.attributes.normal.array);
    for (let i = 0; i < g.index.count; i++) idx.push(g.index.array[i] + vo);
    vo += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setIndex(idx);
  return out;
}

export class Traffic {
  constructor(parent, road, seed = 0, material = null) {
    this.road = road;
    this.seed = seed;
    this.cars = [];
    this.spawned = 0;
    this.mesh = new THREE.InstancedMesh(
      buildBody(),
      material || new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.4, envMapIntensity: 1.0 }),
      COUNT,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    parent.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._e = new THREE.Euler();
    this._c = new THREE.Color();
    this.player = { s: 0, speed: 0 };
  }

  _spawn(sCar, initial) {
    const n = this.spawned++;
    const h = hash01(n * 3.7 + this.seed * 0.011);
    // Two in three come toward the player; the rest drive ahead of it.
    const dir = h < 0.66 ? -1 : 1;
    let s;
    if (initial) s = sCar + 150 + hash01(n * 9.1) * (SPAN_AHEAD - 300);
    else s = dir < 0 ? sCar + SPAN_AHEAD - hash01(n * 5.3) * 200 : sCar + 700 + hash01(n * 5.3) * 1800;
    const car = {
      id: n, s, dir, lane: dir > 0 ? LANE : -LANE,
      speed: 12, want: 0.85 + hash01(n * 7.7) * 0.3, hue: hash01(n * 11.3),
    };
    // Never drop a car on top of another one.
    for (const o of this.cars) {
      if (o.dir === car.dir && Math.abs(o.s - car.s) < 40) return null;
    }
    this.cars.push(car);
    this._paint(this.cars.length - 1);
    return car;
  }

  _paint(i) {
    const c = this.cars[i];
    // Mostly muted, a few saturated: real traffic, not a toy box.
    const vivid = c.hue > 0.8;
    this._c.setHSL(c.hue, vivid ? 0.7 : 0.08, vivid ? 0.42 : 0.18 + c.hue * 0.55);
    this.mesh.instanceColor.setXYZ(i, this._c.r, this._c.g, this._c.b);
    this.mesh.instanceColor.needsUpdate = true;
  }

  // Speed the bends ahead allow, in the car's own direction of travel.
  _limit(c) {
    let v = 24 * c.want;
    for (let d = 0; d <= 160; d += 8) {
      const p = this.road.at(c.s + c.dir * d);
      if (!p) break;
      const k = Math.abs(p.kappa);
      if (k > 1e-4) {
        const vc = Math.sqrt(0.36 * 9.81 / k);
        v = Math.min(v, Math.sqrt(vc * vc + 2 * 2.5 * d));
      }
    }
    return v;
  }

  update(dt, sCar, playerSpeed = 0) {
    this.player.s = sCar;
    this.player.speed = playerSpeed;
    if (!this.cars.length) {
      for (let i = 0; i < COUNT * 2 && this.cars.length < COUNT; i++) this._spawn(sCar, true);
    }

    // Leaders per lane, sorted by position along the direction of travel.
    for (const c of this.cars) {
      let gap = Infinity;
      let dv = 0;
      for (const o of this.cars) {
        if (o === c || o.dir !== c.dir) continue;
        const d = (o.s - c.s) * c.dir;
        if (d > 0 && d < gap) {
          gap = d;
          dv = c.speed - o.speed;
        }
      }
      // The player is a leader for same-direction cars behind it.
      if (c.dir > 0) {
        const d = sCar - c.s;
        if (d > 0 && d < gap) {
          gap = d;
          dv = c.speed - playerSpeed;
        }
      }
      const v0 = Math.max(4, this._limit(c));
      const sStar = S0 + c.speed * T_HEAD + (c.speed * dv) / (2 * Math.sqrt(A_MAX * B_COMF));
      const free = 1 - (c.speed / v0) ** 4;
      const inter = gap < Infinity ? (Math.max(0, sStar) / Math.max(0.5, gap - CAR_LEN)) ** 2 : 0;
      const acc = Math.max(-8, A_MAX * (free - inter));
      c.speed = Math.max(0, c.speed + acc * dt);
      c.s += c.dir * c.speed * dt;
    }

    // Retire what has gone out of range, and refill.
    this.cars = this.cars.filter((c) => c.s > sCar - SPAN_BEHIND && c.s < sCar + SPAN_AHEAD + 400
      && this.road.at(c.s));
    while (this.cars.length < COUNT) {
      if (!this._spawn(sCar, false)) break;
    }
    for (let i = 0; i < this.cars.length; i++) this._paint(i);

    const road = this.road;
    for (let i = 0; i < COUNT; i++) {
      const c = this.cars[i];
      const p = c ? road.at(c.s) : null;
      if (!c || !p) {
        this._m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this._m);
        continue;
      }
      const nx = -Math.sin(p.theta);
      const nz = Math.cos(p.theta);
      const y = road.surfaceAt(c.s, c.lane) + 0.04;
      this._p.set(p.x + nx * c.lane, y, p.z + nz * c.lane);
      const yaw = c.dir > 0 ? p.theta : p.theta + Math.PI;
      const pitch = Math.atan(p.grade) * c.dir;
      this._e.set(Math.atan(p.bank) * c.dir, -yaw, pitch, 'YXZ');
      this._q.setFromEuler(this._e);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.count = COUNT;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  nearestAhead(sCar, dir = 1, range = 120) {
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

  clearNear(sCar, range) {
    this.cars = this.cars.filter((c) => Math.abs(c.s - sCar) > range);
  }
}
