// The gravel bars of the valley's rivers: long low mounds of stones in the middle of
// the channel, their tops a hand's depth under the water or a little over it. The
// water over them is the shallows: the real style reads how deep it is from the frame
// behind it (render/waterlook.js), so it shows the bar through it, with the foam of a
// shallow and the fine ripples round it, and in every style a stone or two stands
// out of it.
//
// Where a bar lies comes from the plan (world/valleyplan.js). Each is one mound, a unit
// long and a unit across, stretched to the bar's length and width and turned to the way
// the river runs, and baked into the mesh that holds all the valley's solid things
// (render/valleystruct.js).

import * as THREE from 'three';
import { BAR } from '../world/valleyplan.js';

// range: how far off a bar is drawn (m); max: the bars there is room for; the stones' colours,
// from the pale of the dry top to the dark of the wet (sRGB).
export const BARS = {
  range: 560,
  max: 8,
  stones: [0xb4ab94, 0x978f7a, 0x7a7363, 0x5f5a4d],
  bed: 0x4a463c,
  nu: 22,
  nv: 10,
};

const lin = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

// A value that wanders from 0 to 1 over the plane, the same every time.
function noise(x, z, seed) {
  const s = Math.sin(x * 12.9898 + z * 78.233 + seed * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

function smooth(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

// The mound, in its own frame: u (-0.5 to 0.5) along the river and v across it, mapped to metres by the
// instance's scale, its heights in metres over the water's level; flat-shaded, each face its own stone.
export function barGeometry() {
  const { nu, nv } = BARS;
  const stones = BARS.stones.map(lin);
  const bed = lin(BARS.bed);
  const h = (iu, iv) => {
    const u = iu / nu - 0.5;
    const v = iv / nv - 0.5;
    // The outline: an oval, the mound standing up to its top inside the outer half of it.
    const r = Math.hypot(u * 2, v * 2);
    const rise = smooth((1 - r) / 0.45);
    // Its top: low swells along the river and a few stones standing out.
    const swell = 0.07 * Math.sin(u * 23 + 1.3) * Math.cos(v * 17 - 0.4) + 0.05 * Math.sin(u * 41 + v * 29);
    const stone = 0.42 * Math.max(0, (noise(Math.floor(u * 9), Math.floor(v * 7), 3) - 0.62) / 0.38);
    const top = BAR.top + swell + stone;
    // (A little under the bed at the rim, so that no seam shows between the mound and the ground.)
    return -5.25 + (top + 5.25) * rise;
  };
  const pos = [];
  const nrm = [];
  const col = [];
  const P = (iu, iv) => [(iu / nu - 0.5), h(iu, iv), (iv / nv - 0.5)];
  // (u runs along z in the instance's frame: the river runs along +z, the width is across x.)
  const swap = (p) => [p[2], p[1], p[0]];
  for (let iu = 0; iu < nu; iu++) {
    for (let iv = 0; iv < nv; iv++) {
      const a = swap(P(iu, iv));
      const b = swap(P(iu + 1, iv));
      const c = swap(P(iu + 1, iv + 1));
      const d = swap(P(iu, iv + 1));
      for (const tri of [[a, c, b], [a, d, c]]) {
        let [p, q, r] = tri;
        // The face's normal in the mound's own frame (the instance's scale, which is not square, is taken into it by the
        // vertex shader as it is for any normal).
        const normal = (p0, q0, r0) => {
          const ux = q0[0] - p0[0];
          const uy = q0[1] - p0[1];
          const uz = q0[2] - p0[2];
          const vx = r0[0] - p0[0];
          const vy = r0[1] - p0[1];
          const vz = r0[2] - p0[2];
          return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
        };
        let [nx, ny, nz] = normal(p, q, r);
        // Wound so that it faces up.
        if (ny < 0) {
          [q, r] = [r, q];
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        // Each face a stone's colour: the pale ones on the dry top, the dark of the wet below.
        const y = (p[1] + q[1] + r[1]) / 3;
        const wet = smooth((-0.15 - y) / 1.1);
        const pick = noise(p[0] * 31 + q[2] * 17, p[2] * 29 + r[0] * 13, 7);
        const base = stones[Math.min(stones.length - 1, Math.floor(pick * pick * stones.length * (0.55 + 0.45 * wet) + wet * 1.4))];
        const c0 = base.clone().lerp(bed, smooth((-y - 0.7) / 2.2));
        const k = 0.88 + 0.24 * noise(p[2] * 53, q[0] * 47, 11);
        for (const v of [p, q, r]) {
          pos.push(v[0], v[1], v[2]);
          nrm.push(nx, ny, nz);
          col.push(c0.r * k, c0.g * k, c0.b * k);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);
  return g;
}

export class Bars {
  // env: plan (ValleyPlan), origin().
  constructor(env) {
    this.env = env;
    this.geo = barGeometry();
    this.list = [];             // the bars drawn: the plan's, [{ ax, az, len, wide, yaw, key }]
    this.count = 0;
    this.version = 0;           // goes up when the set drawn changes, or has to be put in again
    this.level = 0;             // the water's height, m
    this._key = '';
    this._dirty = true;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  shift() {
    this._dirty = true;
  }

  // Every frame in the valley. tier: 'high' draws all there are in reach, 'mid' half of them (the nearer), 'low' none; level: the
  // water's height (m); `settle`: every stretch there is to work out is worked out at once.
  update(camera, on, tier, sCar, level, settle = false) {
    const cap = tier === 'high' ? BARS.max : tier === 'mid' ? BARS.max >> 1 : 0;
    if (!on || !cap) {
      if (this.list.length) {
        this.list = [];
        this.count = 0;
        this._key = '';
        this.version++;
      }
      return;
    }
    const o = this.env.origin();
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    const E = BAR.every;
    const have = [];
    let looked = 0;
    for (let k = Math.floor((sCar - 800) / E); k <= Math.floor((sCar + 1300) / E); k++) {
      if (!settle && !this.env.plan.bars.has(k) && looked++ > 0) continue;
      const list = this.env.plan.barsIn(k);
      if (!list) continue;
      for (const b of list) {
        const d = Math.hypot(b.ax - ax, b.az - az);
        if (d < BARS.range) have.push({ b, d });
      }
    }
    have.sort((p, q) => p.d - q.d);
    have.length = Math.min(have.length, cap);
    const key = have.map((e) => e.b.key).join(',');
    if (key === this._key && !this._dirty && level === this.level) return;
    this._key = key;
    this._dirty = false;
    this.level = level;
    this.list = have.map((e) => e.b);
    this.count = this.list.length;
    this.version++;
  }

  // The bars put into the merged mesh (render/valleystruct.js), in the frame of the lens (o: the floating origin).
  bake(merged, o) {
    for (const b of this.list) {
      this._q.setFromAxisAngle(this._v.set(0, 1, 0), b.yaw);
      this._v.set(b.ax - o.x, this.level, b.az - o.z);
      this._s.set(b.wide, 1, b.len);
      this._m.compose(this._v, this._q, this._s);
      merged.add(this.geo, this._m);
    }
  }

  dispose() {
    this.geo.dispose();
  }
}
