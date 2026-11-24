// Sailing boats out on the sea: a white sail and a hull each, each boat going slowly round a circle of its own (the
// plan, world/coastplan.js, puts it on water far from land) and rocking on the swell. At most twelve are drawn, the
// nearest to the lens, as two instanced meshes (the hulls, the sails); in the block style the hull is a box and
// the sail a slab.
//
// A boat is 39 triangles: the hull is nine points of a deck and nine of a keel's line (27), the sails two triangles seen from both
// sides (4) and the mast a four-sided post (8).

import * as THREE from 'three';
import { withAtmosphere, withSunMask } from './atmosphere.js';
import { MARK } from './style.js';
import { swashU, SWASH_FULL } from './swash.js';
import { BOATS, boatAt, boatRock, swashLift, alongOf } from '../world/coastplan.js';

// Boats drawn at each tier; the colours of a hull (sRGB); the sail's, and the mast's; how often the boats near the lens are
// looked for again (s); how many cells of sea are worked out in a frame; how far over the water the middle of a boat is (m).
export const BOAT = {
  max: { high: BOATS.max, mid: BOATS.max / 2, low: 0 },
  hulls: [0xf2efe6, 0x2f5d8a, 0xf2efe6, 0xa8402e, 0x1f6b62, 0xe8e2d2, 0xd9b45b, 0x34495e],
  sail: 0xfaf7ef,
  mast: 0x6a5846,
  every: 0.5,
  cells: 3,
  float: 0.05,
};

const lin = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

// Flat triangles: positions and colours of a list of them, a normal to each.
class Bits {
  constructor() {
    this.p = [];
    this.n = [];
    this.c = [];
  }

  tri(a, b, c, col, k = 1) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (const q of [a, b, c]) {
      this.p.push(q[0], q[1], q[2]);
      this.n.push(nx, ny, nz);
      this.c.push(col.r * k, col.g * k, col.b * k);
    }
  }

  // A triangle seen from both sides: the same and the other way round.
  both(a, b, c, col, k = 1) {
    this.tri(a, b, c, col, k);
    this.tri(a, c, b, col, k * 0.85);
  }

  // A four-sided post standing on y0, r wide at the foot, h tall, its eight triangles facing away from its middle.
  post(cx, y0, cz, r, h, col, k = 1) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const b = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4;
      const p0 = [cx + r * Math.cos(a), y0, cz + r * Math.sin(a)];
      const p1 = [cx + r * Math.cos(b), y0, cz + r * Math.sin(b)];
      const q0 = [p0[0], y0 + h, p0[2]];
      const q1 = [p1[0], y0 + h, p1[2]];
      const mx = (p0[0] + p1[0]) / 2 - cx;
      const mz = (p0[2] + p1[2]) / 2 - cz;
      // (The way round that has the face's normal point out.)
      const nx = (p1[1] - p0[1]) * (q1[2] - p0[2]) - (p1[2] - p0[2]) * (q1[1] - p0[1]);
      const nz = (p1[0] - p0[0]) * (q1[1] - p0[1]) - (p1[1] - p0[1]) * (q1[0] - p0[0]);
      const out = nx * mx + nz * mz > 0;
      if (out) {
        this.tri(p0, p1, q1, col, k);
        this.tri(p0, q1, q0, col, k);
      } else {
        this.tri(p1, p0, q1, col, k);
        this.tri(p0, q0, q1, col, k);
      }
    }
  }

  // A box (cx, cy, cz its middle) with a colour; its twelve triangles face out.
  box(cx, cy, cz, sx, sy, sz, col, k = 1) {
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const P = (x, y, z) => [cx + x * hx, cy + y * hy, cz + z * hz];
    const faces = [
      [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1], 0.8],
      [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1], 0.8],
      [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1], 1.1],
      [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1], 0.6],
      [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1], 0.9],
      [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1], 0.9],
    ];
    for (const [a, b, c, d, s] of faces) {
      this.tri(P(...a), P(...b), P(...c), col, k * s);
      this.tri(P(...a), P(...c), P(...d), col, k * s);
    }
  }

  done() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// The hull: nine points round the deck, a keel's line of nine below them (narrower and shorter), the sides between and the deck
// over them. Bow toward +z, the waterline at y = 0.
const DECK = [[0, 4.7], [1.0, 2.9], [1.5, 0.0], [1.35, -2.6], [0.9, -3.7], [-0.9, -3.7], [-1.35, -2.6], [-1.5, 0.0], [-1.0, 2.9]];

function hullGeometry(blocky) {
  const b = new Bits();
  const white = new THREE.Color(1, 1, 1);
  if (blocky) {
    b.box(0, -0.05, 0.5, 3.0, 1.3, 8.4, white);
    return b.done();
  }
  const top = DECK.map(([x, z]) => [x, 0.6, z]);
  const low = DECK.map(([x, z]) => [x * 0.45, -0.8, z * 0.86 - 0.2]);
  const mid = [0, 0.6, -0.2];
  for (let i = 0; i < DECK.length; i++) {
    const j = (i + 1) % DECK.length;
    // The deck, lighter than the sides; the sides darker the lower they go.
    b.tri(mid, top[j], top[i], white, 1.08);
    b.tri(top[i], top[j], low[j], white, 0.93);
    b.tri(top[i], low[j], low[i], white, 0.86);
  }
  return b.done();
}

// The sails and the mast: a mainsail and a jib in the plane over the keel, and the mast.
function sailGeometry(blocky) {
  const b = new Bits();
  const sail = lin(BOAT.sail);
  const mast = lin(BOAT.mast);
  if (blocky) {
    b.box(0, 5.2, -1.2, 0.3, 7.6, 3.7, sail);
    b.box(0, 4.0, 2.7, 0.25, 5.6, 2.8, sail, 0.95);
    return b.done();
  }
  b.both([0, 1.5, 0.7], [0, 9.2, 0.7], [0, 1.5, -3.2], sail);
  b.both([0, 1.2, 4.3], [0, 7.8, 1.0], [0, 1.2, 1.0], sail, 0.96);
  b.post(0, 0.6, 0.9, 0.09, 8.7, mast);
  return b.done();
}

function boatMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0, color: 0xffffff });
  // (Lit as the rocks and the wall are, with a colour to each instance: one program for all of them.)
  mat.customProgramCacheKey = () => 'continuum-coast';
  mat.userData.mark = MARK.built;
  return withSunMask(withAtmosphere(mat), false);
}

export class Boats {
  // env: plan (CoastPlan), origin() (the floating origin), level(x, z) (the sea's level, absolute).
  constructor(scene, env) {
    this.env = env;
    this.scene = scene;
    this.max = BOAT.max.high;
    this.blocky = false;
    this.material = boatMaterial();
    this.hulls = this._make(hullGeometry(false));
    this.sails = this._make(sailGeometry(false));
    this.sails.instanceColor.array.fill(1);
    this.list = [];                  // the boats drawn: the plan's
    this.count = 0;
    this._since = 1e9;
    this._cap = -1;
    this._last = { x: 1e9, z: 1e9 };
    this._d = new THREE.Object3D();
    this._d.rotation.order = 'YXZ';
    this._c = new THREE.Color();
    this._pos = {};
    this._rock = {};
  }

  _make(geometry) {
    const m = new THREE.InstancedMesh(geometry, this.material, this.max);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.castShadow = false;
    m.receiveShadow = false;
    m.count = 0;
    m.visible = false;
    this.scene.add(m);
    return m;
  }

  // The block style's boats are boxes.
  setBlocky(on) {
    if (on === this.blocky) return;
    this.blocky = on;
    this.hulls.geometry.dispose();
    this.sails.geometry.dispose();
    this.hulls.geometry = hullGeometry(on);
    this.sails.geometry = sailGeometry(on);
  }

  // The floating origin has moved.
  shift() {
    this._last.x = 1e9;
  }

  // Every frame. on: the coast is in reach; tier; clock (s): the sea's; dt: the time the frame is (s); settle: the world stands
  // still (the photo mode), so what is to be found is found now.
  update(camera, on, tier, clock, dt = 0, settle = false) {
    const cap = BOAT.max[tier] || 0;
    if (!on || cap === 0) {
      if (this.hulls.visible) {
        this.hulls.visible = false;
        this.sails.visible = false;
        this.count = 0;
        this.list = [];
        this._last.x = 1e9;
      }
      return;
    }
    const o = this.env.origin();
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    // The boats nearest the lens, looked for again when it has gone a hundred metres or it is time.
    this._since += dt;
    if (settle || cap !== this._cap || Math.hypot(ax - this._last.x, az - this._last.z) > 100 || this._since > BOAT.every) {
      this._since = 0;
      this._cap = cap;
      this._last.x = ax;
      this._last.z = az;
      this.list = this.env.plan.boatsNear(ax, az, BOATS.range, cap, settle ? Infinity : BOAT.cells);
      // (Cells not worked out yet are worked out a few a frame: it is looked again next frame.)
      if (this.list.incomplete) this._since = BOAT.every;
      for (let i = 0; i < this.list.length; i++) {
        const b = this.list[i];
        this._c.setHex(BOAT.hulls[Math.floor((Math.imul(b.key, 2654435761) >>> 0) / 4294967296 * BOAT.hulls.length)], THREE.SRGBColorSpace);
        this.hulls.instanceColor.setXYZ(i, this._c.r, this._c.g, this._c.b);
      }
      this.hulls.instanceColor.needsUpdate = true;
    }
    const d = this._d;
    const lift = swashU.uSwash.value.y * SWASH_FULL;
    const map = this.env.worlds;
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      boatAt(b, clock, this._pos);
      const p = this._pos;
      boatRock(p.x, p.z, clock, this._rock);
      const r = this._rock;
      const y = this.env.level(p.x, p.z) + BOAT.float + r.heave + (lift > 0 ? swashLift(lift, clock, alongOf(map, p.x, p.z)) : 0);
      d.position.set(p.x - o.x, y, p.z - o.z);
      d.rotation.set(r.pitch, Math.PI / 2 - p.yaw, r.roll + 0.07 * b.dir);
      d.scale.setScalar(b.length / 8.4);
      d.updateMatrix();
      this.hulls.setMatrixAt(i, d.matrix);
      this.sails.setMatrixAt(i, d.matrix);
    }
    this.count = this.list.length;
    this.hulls.count = this.count;
    this.sails.count = this.count;
    this.hulls.instanceMatrix.needsUpdate = true;
    this.sails.instanceMatrix.needsUpdate = true;
    this.hulls.visible = this.count > 0;
    this.sails.visible = this.count > 0;
  }

  meshes() {
    return [this.hulls, this.sails];
  }

  dispose() {
    for (const m of [this.hulls, this.sails]) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.dispose();
    }
    this.material.dispose();
    this.list = [];
  }
}
