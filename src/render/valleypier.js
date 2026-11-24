// The valley's piers and the boats tied at them: a plank deck on posts from the bank
// out over the water, and a rowing boat lying off its head.
//
// Where a pier stands comes from the plan (world/valleyplan.js). A deck is built to its
// pier (the posts stand on the ground under it, which is no other pier's); decks and boats
// are baked into the mesh that holds all the valley's solid things (render/valleystruct.js),
// the bars' (render/valleybars.js) among them. All of them are lit as the things that stand
// by the road are, so the painted style gives them its flat paints; in the block style the
// boat is made of boxes, as the pier is in every style.
//
// A boat rides the surface of the water as the real style draws it: the four swells
// of render/waterlook.js, from the water's own clock, so that it rises and falls as the
// water under it does (a little more where there are none, for the styles that draw
// the water flat).

import * as THREE from 'three';
import { withAtmosphere, withSunMask } from './atmosphere.js';
import { MARK } from './style.js';
import { PIER } from '../world/valleyplan.js';
import { swellHeight } from './waterlook.js';

// range: how far off a pier is drawn (m); max: the piers and the boats there are room for;
// the colours (sRGB): the planks (three tones), the beams and posts, the boat's hull below
// and above its chine, its inside, its thwarts; solid: how far from the middle of the deck a
// car off the road is turned away (m); bob: how far a boat rises and falls where the water is
// flat (m).
export const PIERS = {
  range: 520,
  max: 3,
  planks: [0x8a6a45, 0x7c5f3e, 0x94714a],
  beam: 0x5a4430,
  hull: [0x8f3626, 0xe9e3d3],
  inside: 0xcdb98f,
  thwart: 0xb8a37a,
  solid: 1.3,
  bob: 0.012,
  // the swell's height (m, crest to trough) the boat follows: the water's own (world/worlds.js, liquid.wave)
  swell: 0.04,
};

const lin = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

// The look of a flat-shaded solid that the painted style takes its paints from: a colour for each
// face, shaded by which way it faces.
const SHADE = { top: 1.1, side: 0.85, end: 0.9, under: 0.6 };

// Boxes [cx, cy, cz, sx, sy, sz, colour] as one geometry: flat faces, a colour to each box.
export function boxes(list) {
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
      [[1, 0, 0], [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]], SHADE.side],
      [[-1, 0, 0], [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]], SHADE.side * 0.92],
      [[0, 1, 0], [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]], SHADE.top],
      [[0, -1, 0], [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]], SHADE.under],
      [[0, 0, 1], [[hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [-hx, -hy, hz]], SHADE.end],
      [[0, 0, -1], [[-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz]], SHADE.end * 0.9],
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
  return finish(pos, nrm, col, idx);
}

function finish(pos, nrm, col, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// The material of everything the valley stands: a flat-shaded solid, marked as a structure.
export function structureMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.02 });
  mat.customProgramCacheKey = () => 'continuum-valley-structure';
  mat.userData.mark = MARK.built;
  return withSunMask(withAtmosphere(mat), false);
}

// A pier, in its own frame: the end on the bank at the middle of the plane (y 0 the water's level), the way
// out over the water along +z. `p` is the plan's pier.
export function pierGeometry(p) {
  const list = [];
  const W = PIER.wide;
  const top = PIER.deck;
  // The deck: planks across, a finger's width between, in three tones.
  const step = 0.55;
  const n = Math.floor(p.len / step);
  for (let i = 0; i < n; i++) {
    const z = (i + 0.5) * (p.len / n);
    list.push([0, top - 0.05, z, W, 0.1, p.len / n - 0.04, PIERS.planks[(i * 7 + (i >> 2)) % 3]]);
  }
  // The beams under it, along it, and one across at each end.
  for (const x of [-W / 2 + 0.25, W / 2 - 0.25]) list.push([x, top - 0.22, p.len / 2, 0.14, 0.2, p.len - 0.1, PIERS.beam]);
  for (const z of [0.3, p.len - 0.3]) list.push([0, top - 0.24, z, W - 0.1, 0.12, 0.16, PIERS.beam]);
  // The posts: each stands on the ground it was found on, a little way into it, and comes up to the deck;
  // the two at the head stand a half metre over it to tie to.
  // (The frame turned about y by atan2(dx, dz): its z is the way out (dx, dz) and its x is (dz, -dx).)
  const last = p.posts.length / 3 - 2;
  for (let q = 0; q < p.posts.length; q += 3) {
    const rx = p.posts[q] - p.ax;
    const rz = p.posts[q + 1] - p.az;
    const lx = rx * p.dz - rz * p.dx;
    const lz = rx * p.dx + rz * p.dz;
    const foot = p.posts[q + 2] - p.y - 0.35;
    const head = q / 3 >= last;
    const to = top - 0.1 + (head ? 0.5 : 0);
    list.push([lx, (foot + to) / 2, lz, 0.22, to - foot, 0.22, PIERS.beam]);
  }
  return boxes(list);
}

// A boat, in its own frame: its bow along +z, the water's level at y 0, 3.6 m long and 1.3 across. Lofted from
// seven stations, a hull outside and in; of boxes where `blocky`.
export function boatGeometry(blocky = false) {
  const [below, above] = PIERS.hull.map(lin);
  const wood = lin(PIERS.inside);
  const seat = lin(PIERS.thwart);
  if (blocky) {
    return boxes([
      [0, -0.02, 0, 0.9, 0.12, 3.2, PIERS.hull[0]],
      [-0.52, 0.12, 0, 0.12, 0.5, 3.4, PIERS.hull[1]],
      [0.52, 0.12, 0, 0.12, 0.5, 3.4, PIERS.hull[1]],
      [0, 0.14, 1.65, 0.9, 0.46, 0.14, PIERS.hull[1]],
      [0, 0.14, -1.7, 0.9, 0.46, 0.12, PIERS.hull[1]],
      [0, 0.04, 0, 0.84, 0.05, 3.0, PIERS.inside],
      [0, 0.2, 0.3, 0.9, 0.07, 0.34, PIERS.thwart],
      [0, 0.2, -0.7, 0.9, 0.07, 0.34, PIERS.thwart],
    ]);
  }
  const S = 7;
  const L = 3.6;
  const ramp = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  // Half the beam, the keel's height and the gunwale's, at a place t along it (the stern 0, the bow 1).
  const half = (t) => 0.65 * (0.82 + 0.18 * ramp(0, 0.35, t)) * Math.max(0.03, 1 - 0.97 * Math.pow(ramp(0.45, 1, t), 2));
  const keel = (t) => -0.16 + (t > 0.4 ? 0.15 * Math.pow((t - 0.4) / 0.6, 2) : 0.04 * Math.pow((0.4 - t) / 0.4, 2));
  const gun = (t) => 0.3 + 0.2 * t * t * t + 0.02 * (1 - t);
  const inner = (p) => [p[0] * 0.9, p[1] + 0.08, p[2]];
  const st = [];
  for (let i = 0; i < S; i++) {
    const t = i / (S - 1);
    const z = -L / 2 + L * t;
    const w = half(t);
    const yk = keel(t);
    const yg = gun(t);
    const yc = yk + (yg - yk) * 0.38;
    // The outline of the cross-section: one gunwale, the chine, the keel, the chine, the other gunwale.
    st.push([[-w, yg, z], [-w * 0.86, yc, z], [0, yk, z], [w * 0.86, yc, z], [w, yg, z]]);
  }
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];
  // A quad of four corners, flat, with a colour; turned so that it faces `out` if that is given.
  const quad = (a, b, c, d, color, k, out) => {
    let pts = [a, b, c, d];
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    if (out && nx * out[0] + ny * out[1] + nz * out[2] < 0) {
      pts = [d, c, b, a];
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    const base = pos.length / 3;
    for (const p of pts) {
      pos.push(p[0], p[1], p[2]);
      nrm.push(nx / l, ny / l, nz / l);
      col.push(color.r * k, color.g * k, color.b * k);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let i = 0; i < S - 1; i++) {
    const A = st[i];
    const B = st[i + 1];
    for (let j = 0; j < 4; j++) {
      const low = j === 1 || j === 2;
      // Outside, the chine splitting the two colours; inside, laid in a hand's breadth.
      quad(A[j], A[j + 1], B[j + 1], B[j], low ? below : above, low ? 0.9 : 0.96);
      quad(inner(B[j]), inner(B[j + 1]), inner(A[j + 1]), inner(A[j]), low ? seat : wood, 0.95);
    }
    // The rim along each gunwale, facing up and out.
    quad(A[0], inner(A[0]), inner(B[0]), B[0], above, 1.1, [-0.4, 1, 0]);
    quad(A[4], inner(A[4]), inner(B[4]), B[4], above, 1.1, [0.4, 1, 0]);
  }
  // The transom closes the stern: a fan over its outline.
  const T = st[0];
  for (let j = 1; j < 3; j++) quad(T[0], T[j], T[j + 1], T[j + 1], above, 0.85, [0, 0, -1]);
  quad(T[0], T[3], T[4], T[4], above, 0.85, [0, 0, -1]);
  // Two thwarts across and the stern seat.
  const seats = boxes([
    [0, 0.17, 0.35, 1.0, 0.06, 0.32, PIERS.thwart],
    [0, 0.17, -0.55, 1.0, 0.06, 0.32, PIERS.thwart],
    [0, 0.2, -1.5, 1.0, 0.06, 0.4, PIERS.thwart],
  ]);
  return mergeGeometries([finish(pos, nrm, col, idx), seats]);
}

// Geometries (indexed, with position, normal and colour) joined into one.
function mergeGeometries(list) {
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];
  for (const g of list) {
    const base = pos.length / 3;
    pos.push(...g.getAttribute('position').array);
    nrm.push(...g.getAttribute('normal').array);
    col.push(...g.getAttribute('color').array);
    for (const i of g.getIndex().array) idx.push(base + i);
    g.dispose();
  }
  return finish(pos, nrm, col, idx);
}

export class Piers {
  // env: plan (ValleyPlan), origin().
  constructor(env) {
    this.env = env;
    this.boatGeo = [boatGeometry(false), boatGeometry(true)];
    this.list = [];          // the piers drawn: { k, p, geo (its deck), part (its boat's place in the merged mesh), h (the boat's height over the water, m) }
    this.blocky = false;
    this.version = 0;        // goes up when the set drawn changes, or has to be put in again
    this._key = '';
    this._dirty = true;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._y = new THREE.Vector3(0, 1, 0);
    this.count = 0;
  }

  shift() {
    this._dirty = true;
  }

  setBlocky(on) {
    this.blocky = on;
  }

  _drop(e) {
    e.geo.dispose();
  }

  // Every frame in the valley. tier: 'high' and 'mid' draw them (the middle one a pier fewer, the nearest first), `settle`: the
  // clock is standing still (the photo mode): every pier there is to work out is worked out at once.
  update(camera, on, tier, sCar, settle = false) {
    const max = tier === 'high' ? PIERS.max : tier === 'mid' ? Math.max(1, PIERS.max >> 1) : 0;
    const o = this.env.origin();
    if (!on || !max) {
      if (this.list.length) {
        for (const e of this.list) this._drop(e);
        this.list = [];
        this._key = '';
        this.version++;
      }
      this.count = 0;
      return;
    }
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    const E = PIER.every;
    const have = [];
    let looked = 0;
    for (let k = Math.floor((sCar - 800) / E); k <= Math.floor((sCar + 1500) / E); k++) {
      // (One that is not worked out yet is worked out, one a frame.)
      if (!settle && !this.env.plan.piers.has(k) && looked++ > 0) continue;
      const p = this.env.plan.pier(k);
      if (!p) continue;
      if (Math.hypot(p.hx - ax, p.hz - az) < PIERS.range) have.push({ k, p, d: Math.hypot(p.hx - ax, p.hz - az) });
    }
    have.sort((a, b) => a.d - b.d);
    have.length = Math.min(have.length, max);
    const key = have.map((e) => e.k).join(',') + (this.blocky ? 'b' : 's');
    if (key === this._key && !this._dirty) return;
    this._key = key;
    this._dirty = false;
    const keep = new Map(this.list.map((e) => [e.k, e]));
    this.list = have.map((e) => {
      const old = keep.get(e.k);
      if (old) {
        keep.delete(e.k);
        return old;
      }
      return { k: e.k, p: e.p, geo: pierGeometry(e.p), part: null, h: 0 };
    });
    for (const e of keep.values()) this._drop(e);
    this.count = this.list.length;
    this.version++;
  }

  // The decks (and the boats, as they lie to begin with) put into the merged mesh (render/valleystruct.js), in the
  // frame of the lens (o: the floating origin).
  bake(merged, o) {
    const boat = this.boatGeo[this.blocky ? 1 : 0];
    for (const e of this.list) {
      const p = e.p;
      this._q.setFromAxisAngle(this._y, Math.atan2(p.dx, p.dz));
      this._v.set(p.ax - o.x, p.y, p.az - o.z);
      this._m.compose(this._v, this._q, this._s);
      merged.add(e.geo, this._m);
      e.part = merged.add(boat, this._m.identity());
    }
  }

  // Every frame: the boats ride the water, the way the real style draws it (the swells of render/waterlook.js from the water's own
  // clock, and a slow bob of their own for water that is flat), at time t (s).
  pose(merged, t) {
    const o = this.env.origin();
    for (const e of this.list) {
      const p = e.p;
      const b = p.boat;
      const h = swellHeight(b.ax, b.az, t, PIERS.swell) + PIERS.bob * Math.sin(t * 1.1 + p.k);
      const rock = 0.012 * Math.sin(t * 0.9 + p.k * 2);
      this._e.set(rock * 0.6, b.yaw, rock, 'YXZ');
      this._q.setFromEuler(this._e);
      this._v.set(b.ax - o.x, p.y + h, b.az - o.z);
      this._m.compose(this._v, this._q, this._s);
      merged.pose(e.part, this._m);
      e.h = h;
    }
  }

  // The decks within range of an absolute point, as [x, z, radius, ...] added to out: a car off the road
  // is turned away from them.
  near(ax, az, range, out) {
    for (const { p } of this.list) {
      for (let t = PIER.onLand * 0.5; t <= p.len; t += 2) {
        const x = p.ax + p.dx * t;
        const z = p.az + p.dz * t;
        const reach = range + PIERS.solid;
        if ((x - ax) * (x - ax) + (z - az) * (z - az) < reach * reach) out.push(x, z, PIERS.solid);
      }
    }
    return out;
  }

  dispose() {
    for (const e of this.list) this._drop(e);
    this.list = [];
    for (const g of this.boatGeo) g.dispose();
  }
}
