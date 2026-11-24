// Black rocks standing in the shallows off the beach, each with a ring of foam round the waterline of it.
//
// Where they stand comes from the plan (world/coastplan.js): a block of sea at a time, a rock to some of the squares of a
// lattice where the water is a quarter of a metre to three deep, off the road, gathered in patches. A rock is one
// instance of one mesh (a rough dome with a second, lower lump beside it, standing on the sea floor and coming out of the
// water), its foam another: a flat ring a little over the water, white at the rock and gone at its edge, that swells and
// shrinks with the waves of the beach (render/swash.js lifts the sea, and the ring is lifted with it). In the block style the rock
// is a box and the foam a square frame.

import * as THREE from 'three';
import { withAtmosphere, withSunMask } from './atmosphere.js';
import { MARK } from './style.js';
import { swashU, SWASH_FULL } from './swash.js';
import { REEF, swashLift, swashPhase, alongOf } from '../world/coastplan.js';

// How many are drawn and how far off, by tier; the rocks' colours (sRGB); how far over the water the foam lies (m); how much the
// foam's ring swells and shrinks (a share of its radius) with the swash.
export const REEFS = {
  max: { high: REEF.max, mid: REEF.max / 2, low: 0 },
  range: { high: REEF.range, mid: REEF.range * 0.6, low: 0 },
  rock: [0x2b2c2e, 0x353230, 0x25292b, 0x3b3937],
  float: 0.05,
  swell: 0.08,
};

// A deterministic wobble of a point of a unit sphere, 1 plus or minus `amount`.
function wobble(x, y, z, seed, amount) {
  const v = Math.sin((x + seed) * 12.9898 + (y - seed) * 78.233 + z * 37.719) * 43758.5453;
  return 1 + ((v - Math.floor(v)) - 0.5) * 2 * amount;
}

// One lump: a rough ellipsoid (semi-axes rx, ry, rz) about (cx, cy, cz), flat shaded, darker at its foot.
function lump(list, cx, cy, cz, rx, ry, rz, seed, shade) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const a = g.attributes.position.array;
  const at = (i) => {
    const x = a[i * 3];
    const y = a[i * 3 + 1];
    const z = a[i * 3 + 2];
    const j = wobble(Math.round(x * 40) / 40, Math.round(y * 40) / 40, Math.round(z * 40) / 40, seed, 0.2);
    return [cx + x * rx * j, cy + y * ry * j, cz + z * rz * j];
  };
  for (let i = 0; i < a.length / 9; i++) {
    const p = [at(i * 3), at(i * 3 + 1), at(i * 3 + 2)];
    const ux = p[1][0] - p[0][0];
    const uy = p[1][1] - p[0][1];
    const uz = p[1][2] - p[0][2];
    const vx = p[2][0] - p[0][0];
    const vy = p[2][1] - p[0][1];
    const vz = p[2][2] - p[0][2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    // (Facing out: away from the lump's middle.)
    const mx = (p[0][0] + p[1][0] + p[2][0]) / 3 - cx;
    const my = (p[0][1] + p[1][1] + p[2][1]) / 3 - cy;
    const mz = (p[0][2] + p[1][2] + p[2][2]) / 3 - cz;
    const flip = nx * mx + ny * my + nz * mz < 0;
    const order = flip ? [0, 2, 1] : [0, 1, 2];
    const s = flip ? -1 : 1;
    const k = shade * (0.62 + 0.55 * Math.min(1, Math.max(0, (my / ry + 1) / 2)));
    for (const q of order) {
      list.p.push(...p[q]);
      list.n.push(nx * s, ny * s, nz * s);
      list.c.push(k, k, k);
    }
  }
}

function rockGeometry(blocky) {
  const list = { p: [], n: [], c: [] };
  if (blocky) {
    // Boxes: the main block, and a lower one beside it.
    const box = (cx, y0, cz, sx, sy, sz, k) => {
      const hx = sx / 2;
      const hz = sz / 2;
      const v = [[-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz], [-hx, sy, -hz], [hx, sy, -hz], [hx, sy, hz], [-hx, sy, hz]].map(([x, y, z]) => [cx + x, y0 + y, cz + z]);
      const f = [[0, 1, 2, 3, 0.6, [0, -1, 0]], [4, 7, 6, 5, 1.1, [0, 1, 0]], [0, 4, 5, 1, 0.8, [0, 0, -1]], [1, 5, 6, 2, 0.9, [1, 0, 0]], [2, 6, 7, 3, 0.8, [0, 0, 1]], [3, 7, 4, 0, 0.9, [-1, 0, 0]]];
      for (const [a, b, c, d, s, n] of f) {
        for (const q of [a, c, b, a, d, c]) {
          list.p.push(...v[q]);
          list.n.push(...n);
          list.c.push(k * s, k * s, k * s);
        }
      }
    };
    box(0, 0, 0, 1.7, 1, 1.7, 1);
    box(1.1, 0, 0.3, 0.8, 0.55, 0.8, 0.9);
  } else {
    lump(list, 0, 0.5, 0, 1, 0.5, 1, 1, 1);
    lump(list, 0.95, 0.3, 0.25, 0.5, 0.3, 0.45, 2, 0.92);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(list.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(list.n, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(list.c, 3));
  g.computeBoundingSphere();
  return g;
}

// The foam: a flat ring from 0.42 of its radius out to the whole of it, white and a little clear at the rock, gone at the edge, which is
// ragged (every other point of it a fifth in). A square frame in the block style.
const SEGMENTS = 22;
function foamGeometry(blocky) {
  const pos = [];
  const col = [];
  const idx = [];
  const n = blocky ? 4 : SEGMENTS;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (blocky ? Math.PI / 4 : 0);
    const c = Math.cos(a);
    const s = Math.sin(a);
    const k = blocky ? Math.SQRT2 : 1;
    const out = blocky ? 1 : i % 2 ? 0.8 : 1;
    pos.push(c * 0.42 * k, 0, s * 0.42 * k, c * out * k, 0, s * out * k);
    col.push(1, 1, 1, blocky ? 0.92 : 0.9, 1, 1, 1, blocky ? 0.92 : 0);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i * 2, i * 2 + 1, j * 2 + 1, i * 2, j * 2 + 1, j * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export class Reefs {
  // env: plan (CoastPlan), origin() (the floating origin), level(x, z) (the sea's level, absolute).
  constructor(scene, env) {
    this.env = env;
    this.scene = scene;
    this.max = REEFS.max.high;
    this.blocky = false;
    const rock = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    rock.customProgramCacheKey = () => 'continuum-coast';
    rock.userData.mark = MARK.leaf;
    this.rockMaterial = withSunMask(withAtmosphere(rock), false);
    const foam = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    foam.customProgramCacheKey = () => 'continuum-reef-foam';
    this.foamMaterial = withSunMask(withAtmosphere(foam), false);
    this.rocks = new THREE.InstancedMesh(rockGeometry(false), this.rockMaterial, this.max);
    this.rocks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    this.foam = new THREE.InstancedMesh(foamGeometry(false), this.foamMaterial, this.max);
    for (const m of [this.rocks, this.foam]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
      m.count = 0;
      m.visible = false;
      scene.add(m);
    }
    this.rocks.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.foam.renderOrder = 2;
    this.blocks = new Map();          // block key -> { bx, bz, list }
    this.list = [];                   // the reefs drawn, nearest first
    this.count = 0;
    this.known = 0;                   // reefs in the blocks that are laid
    this._dirty = true;
    this._tier = '';
    this._last = { x: 1e9, z: 1e9 };
    this._d = new THREE.Object3D();
    this._c = new THREE.Color();
  }

  setBlocky(on) {
    if (on === this.blocky) return;
    this.blocky = on;
    this.rocks.geometry.dispose();
    this.foam.geometry.dispose();
    this.rocks.geometry = rockGeometry(on);
    this.foam.geometry = foamGeometry(on);
  }

  // The floating origin has moved: the rocks are laid out again.
  shift() {
    this._dirty = true;
  }

  // The road is cut and laid again (a turn to another world): the blocks laid are asked for again.
  forget() {
    this.blocks.clear();
    this._dirty = true;
  }

  // Every frame. on: the coast is in reach; tier; clock (s): the sea's; settle: the world stands still, so every block there is
  // to lay is laid now.
  update(camera, on, tier, clock, settle = false) {
    const max = REEFS.max[tier] || 0;
    if (!on || max === 0) {
      if (this.rocks.visible) {
        this.rocks.visible = false;
        this.foam.visible = false;
        this.count = 0;
        this.list = [];
      }
      this._dirty = true;
      return;
    }
    const range = REEFS.range[tier];
    const o = this.env.origin();
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    const B = REEF.block;
    let changed = false;
    // The blocks round the lens: the nearest one not laid yet is, one a frame.
    const bx0 = Math.floor((ax - range) / B);
    const bx1 = Math.floor((ax + range) / B);
    const bz0 = Math.floor((az - range) / B);
    const bz1 = Math.floor((az + range) / B);
    for (let laid = settle ? 200 : 2; laid > 0; laid--) {
      let want = null;
      let wantD = Infinity;
      for (let bx = bx0; bx <= bx1; bx++) {
        for (let bz = bz0; bz <= bz1; bz++) {
          const d = Math.hypot((bx + 0.5) * B - ax, (bz + 0.5) * B - az);
          if (d > range + B * 0.71 || this.blocks.has(bx * 100003 + bz)) continue;
          if (d < wantD) {
            wantD = d;
            want = [bx, bz];
          }
        }
      }
      if (!want) break;
      const found = this.env.plan.reefsIn(want[0], want[1]);
      if (found === undefined) break;
      this.blocks.set(want[0] * 100003 + want[1], { bx: want[0], bz: want[1], list: found });
      changed = true;
    }
    if (this.blocks.size > 120) {
      for (const [k, b] of this.blocks) {
        if (Math.hypot((b.bx + 0.5) * B - ax, (b.bz + 0.5) * B - az) > range + B * 2.5) {
          this.blocks.delete(k);
          changed = true;
        }
      }
    }
    const moved = Math.hypot(ax - this._last.x, az - this._last.z) > 8;
    if (this._dirty || changed || moved || this._tier !== tier) {
      this._dirty = false;
      this._tier = tier;
      this._last.x = ax;
      this._last.z = az;
      const all = [];
      for (const b of this.blocks.values()) {
        for (const r of b.list) {
          r.dist = Math.hypot(r.ax - ax, r.az - az);
          if (r.dist < range) all.push(r);
        }
      }
      this.known = all.length;
      all.sort((p, q) => p.dist - q.dist || p.key - q.key);
      this.list = all.slice(0, max);
      const d = this._d;
      d.rotation.set(0, 0, 0);
      for (let i = 0; i < this.list.length; i++) {
        const r = this.list[i];
        const h = r.depth + r.top + 0.25;
        d.position.set(r.ax - o.x, r.y - 0.25, r.az - o.z);
        d.rotation.y = r.yaw;
        d.scale.set(r.r * (0.85 + 0.3 * r.lump), h, r.r * (1.15 - 0.3 * r.lump));
        d.updateMatrix();
        this.rocks.setMatrixAt(i, d.matrix);
        this._c.setHex(REEFS.rock[Math.floor(r.lump * 4096) % REEFS.rock.length], THREE.SRGBColorSpace);
        this.rocks.instanceColor.setXYZ(i, this._c.r, this._c.g, this._c.b);
      }
      this.count = this.list.length;
      this.rocks.count = this.count;
      this.foam.count = this.count;
      this.rocks.instanceMatrix.needsUpdate = true;
      this.rocks.instanceColor.needsUpdate = true;
      this.rocks.visible = this.count > 0;
      this.foam.visible = this.count > 0;
    }
    // The foam rides the sea: lifted with it and swelling and shrinking with the swash.
    const lift = swashU.uSwash.value.y * SWASH_FULL;
    const map = this.env.worlds;
    const d = this._d;
    d.rotation.set(0, 0, 0);
    for (let i = 0; i < this.list.length; i++) {
      const r = this.list[i];
      const along = alongOf(map, r.ax, r.az);
      const swell = 1 + REEFS.swell * Math.sin(swashPhase(clock, along) + r.lump * 6.2831853);
      d.position.set(r.ax - o.x, this.env.level(r.ax, r.az) + REEFS.float + (lift > 0 ? swashLift(lift, clock, along) : 0), r.az - o.z);
      d.scale.set(r.r * REEF.foam * swell, 1, r.r * REEF.foam * swell);
      d.updateMatrix();
      this.foam.setMatrixAt(i, d.matrix);
    }
    this.foam.instanceMatrix.needsUpdate = true;
  }

  meshes() {
    return [this.rocks, this.foam];
  }

  dispose() {
    for (const m of [this.rocks, this.foam]) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.dispose();
    }
    this.rockMaterial.dispose();
    this.foamMaterial.dispose();
    this.blocks.clear();
    this.list = [];
  }
}
