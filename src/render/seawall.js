// The low stone wall and the white fence on it where the road runs by the sea: a wall of stone 0.55 m outside the road's
// verge wherever water is within 15 m of the verge's outer edge (world/coastplan.js says where), with a fence on its top, a post
// of it every two metres and two rails between the posts.
//
// A piece of it is two metres of the wall, the posts at its two ends and the two rails between them: one instance of one
// mesh, laid on the ground from one station of the plan to the next, pitched with the ground along it. Where a run of the
// wall ends it ends in a post. Lit as what stands by the road is, so the painted style gives it its flat paints and the block
// style (all of it boxes) needs nothing. A car that goes off the road runs into it (`near`).

import * as THREE from 'three';
import { withAtmosphere, withSunMask } from './atmosphere.js';
import { MARK } from './style.js';
import { WALL } from '../world/coastplan.js';
import { hash2 } from '../world/noise.js';

// range: how far off a piece is drawn, at each tier (m); max: how many at each; the stone's colour, its coping's and the fence's; how much
// darker than the others a piece may be (each piece has a tint of its own from where it stands: the stone is not all of one colour); how far
// the foot of the wall is sunk in the ground (m); how much of the road ahead and behind the car the plan is laid for (m); the radius of what
// a car runs into at each piece (m).
export const SEAWALL = {
  range: { high: WALL.range, mid: WALL.range * 0.6, low: 0 },
  max: { high: 300, mid: 150, low: 0 },
  stone: 0xaea597,
  cap: 0xc9c2b4,
  paint: 0xf4f2ec,
  tint: [0.84, 1],
  sunk: 0.12,
  behind: 150,
  ahead: 520,
  solid: 0.6,
};

const lin = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

// Boxes [cx, cy, cz, sx, sy, sz, colour] as one geometry: flat faces, a colour to each box.
function boxes(list) {
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];
  for (const [cx, cy, cz, sx, sy, sz, hex] of list) {
    const c = lin(hex);
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const faces = [
      [[1, 0, 0], [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]], 0.8],
      [[-1, 0, 0], [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]], 0.8],
      [[0, 1, 0], [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]], 1.1],
      [[0, -1, 0], [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]], 0.6],
      [[0, 0, 1], [[hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [-hx, -hy, hz]], 0.9],
      [[0, 0, -1], [[-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz]], 0.9],
    ];
    for (const [n, v, k] of faces) {
      const b = pos.length / 3;
      for (const p of v) {
        pos.push(cx + p[0], cy + p[1], cz + p[2]);
        nrm.push(n[0], n[1], n[2]);
        col.push(c.r * k, c.g * k, c.b * k);
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// A piece: along z, WALL.every metres, the wall's stone under its coping and its fence. The foot of the stone is at y = 0. The stone and its coping
// are a little longer than the piece, so that the two ends of the pieces of a bend meet.
function pieceGeometry() {
  const L = WALL.every;
  const H = WALL.height;
  const cap = 0.08;
  const list = [
    [0, (H - cap) / 2, 0, WALL.thick, H - cap, L + 0.1, SEAWALL.stone],
    [0, H - cap / 2, 0, WALL.thick + 0.14, cap, L + 0.1, SEAWALL.cap],
  ];
  // The posts at the ends (a post at the end of one piece and at the start of the next stand in one place), and two rails.
  for (const z of [-L / 2, L / 2]) list.push([0, H + WALL.post / 2, z, 0.09, WALL.post, 0.09, SEAWALL.paint]);
  for (const y of [0.45, 0.85]) list.push([0, H + y, 0, 0.055, 0.055, L, SEAWALL.paint]);
  return boxes(list);
}

export class SeaWall {
  // env: plan (CoastPlan), origin() (the floating origin).
  constructor(scene, env) {
    this.env = env;
    this.scene = scene;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    mat.customProgramCacheKey = () => 'continuum-coast';
    mat.userData.mark = MARK.built;
    this.material = withSunMask(withAtmosphere(mat), false);
    this.pieces = new THREE.InstancedMesh(pieceGeometry(), this.material, SEAWALL.max.high);
    this.pieces.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // (A colour to each instance: the program is the one the boats and the rocks have.)
    this.pieces.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SEAWALL.max.high * 3).fill(1), 3);
    this.pieces.frustumCulled = false;
    this.pieces.castShadow = false;
    this.pieces.receiveShadow = true;
    this.pieces.count = 0;
    this.pieces.visible = false;
    scene.add(this.pieces);
    this.blocks = new Map();         // block key -> its runs, as the plan gives them
    this.list = [];                  // the pieces drawn: [ax, y, az, bx, y, bz] each, absolute
    this.count = 0;
    this.runs = 0;                   // runs of wall in the blocks that are laid
    this._key = '';
    this._tier = '';
    this._dirty = true;
    this._last = { x: 1e9, z: 1e9 };
    this._m = new THREE.Matrix4();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._x = new THREE.Vector3();
    this._y = new THREE.Vector3();
    this._z = new THREE.Vector3();
  }

  shift() {
    this._dirty = true;
  }

  // Forget the plan of what the road that is gone had (render/coast.js: the road is cut and laid again after a turn).
  forget(s) {
    for (const k of this.blocks.keys()) if ((k + 1) * WALL.block > s) this.blocks.delete(k);
    this._dirty = true;
  }

  // The matrix of the piece from a to b: its middle there, along the way from a to b, upright, as long as a and b are apart.
  _piece(ax, ay, az, bx, by, bz, o, out) {
    const a = this._a.set(ax - o.x, ay - SEAWALL.sunk, az - o.z);
    const b = this._b.set(bx - o.x, by - SEAWALL.sunk, bz - o.z);
    const z = this._z.copy(b).sub(a);
    const len = z.length();
    z.divideScalar(len || 1);
    // Across: level, at a right angle to the way along.
    const x = this._x.set(z.z, 0, -z.x);
    const n = x.length();
    if (n < 1e-6) x.set(1, 0, 0);
    else x.divideScalar(n);
    const y = this._y.crossVectors(z, x);
    out.makeBasis(x, y, z.multiplyScalar(len / WALL.every));
    out.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    return out;
  }

  // Every frame near the coast. on: the coast is in reach; tier; sCar: where the car is on the road (m); settle: the world stands
  // still (the photo mode): every block there is to lay is laid now.
  update(camera, on, tier, sCar, settle = false) {
    const max = SEAWALL.max[tier] || 0;
    if (!on || max === 0) {
      if (this.pieces.visible) {
        this.pieces.visible = false;
        this.count = 0;
        this.list = [];
        this._key = '';
      }
      this._dirty = true;
      return;
    }
    const B = WALL.block;
    const k0 = Math.floor((sCar - SEAWALL.behind) / B);
    const k1 = Math.floor((sCar + SEAWALL.ahead) / B);
    let changed = false;
    // The blocks of road round the car: those not laid yet, the nearest first, one a frame.
    for (let laid = settle ? 64 : 1; laid > 0; laid--) {
      let want = -1;
      let wantD = Infinity;
      for (let k = k0; k <= k1; k++) {
        if (this.blocks.has(k)) continue;
        const d = Math.abs((k + 0.5) * B - sCar);
        if (d < wantD) {
          wantD = d;
          want = k;
        }
      }
      if (want < 0) break;
      const runs = this.env.plan.wallRuns(want);
      if (runs === undefined) break;
      this.blocks.set(want, runs);
      changed = true;
    }
    if (this.blocks.size > 24) {
      for (const k of this.blocks.keys()) {
        if (k < k0 - 2 || k > k1 + 2) {
          this.blocks.delete(k);
          changed = true;
        }
      }
    }
    const o = this.env.origin();
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    const moved = Math.hypot(ax - this._last.x, az - this._last.z) > 12;
    if (!this._dirty && !changed && !moved && this._tier === tier) return;
    this._dirty = false;
    this._tier = tier;
    this._last.x = ax;
    this._last.z = az;
    // The pieces within range of the lens, the nearest as many as there is room for.
    const range = SEAWALL.range[tier];
    const found = [];
    let runs = 0;
    for (const list of this.blocks.values()) {
      for (const run of list) {
        runs++;
        const p = run.pts;
        for (let i = 0; i + 5 < p.length; i += 3) {
          const mx = (p[i] + p[i + 3]) / 2;
          const mz = (p[i + 2] + p[i + 5]) / 2;
          const d = Math.hypot(mx - ax, mz - az);
          if (d < range) found.push([d, p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5]]);
        }
      }
    }
    this.runs = runs;
    found.sort((p, q) => p[0] - q[0]);
    const take = found.slice(0, max);
    const m = this._m;
    this.list = [];
    for (let i = 0; i < take.length; i++) {
      const [, x0, y0, z0, x1, y1, z1] = take[i];
      this.pieces.setMatrixAt(i, this._piece(x0, y0, z0, x1, y1, z1, o, m));
      const t = SEAWALL.tint[0] + (SEAWALL.tint[1] - SEAWALL.tint[0]) * hash2(Math.round(x0), Math.round(z0), 0x3a77);
      this.pieces.instanceColor.setXYZ(i, t, t, t);
      this.list.push([x0, y0, z0, x1, y1, z1]);
    }
    this.count = take.length;
    this.pieces.count = this.count;
    this.pieces.instanceMatrix.needsUpdate = true;
    this.pieces.instanceColor.needsUpdate = true;
    this.pieces.visible = this.count > 0;
  }

  // The pieces within `range` of an absolute point, as [x, z, radius, ...] added to out: a car off the road runs into the wall.
  near(ax, az, range, out) {
    const reach = range + SEAWALL.solid + WALL.every;
    for (const [x0, , z0, x1, , z1] of this.list) {
      const x = (x0 + x1) / 2;
      const z = (z0 + z1) / 2;
      if ((x - ax) * (x - ax) + (z - az) * (z - az) < reach * reach) out.push(x, z, SEAWALL.solid);
    }
    return out;
  }

  dispose() {
    this.scene.remove(this.pieces);
    this.pieces.geometry.dispose();
    this.pieces.dispose();
    this.material.dispose();
    this.blocks.clear();
    this.list = [];
  }
}
