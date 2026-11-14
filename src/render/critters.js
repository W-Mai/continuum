// Small animals, for the styles that ask for them (render/style.js: fauna,
// mobs). The real style has none, so its frame is the frame it always was.
//
//  - A painted wood's: deer, rabbits, a fox, a black cat sitting by the road,
//    birds wheeling in the sky and butterflies over the verge. Smooth round
//    shapes, for the brush to paint.
//  - A block world's: pigs, sheep, cows and chickens, made of boxes.
//
// The ones that walk stand off the road in the meadows ahead of the car, a
// handful at a time, found a little ahead, put on the ground there and
// taken away again once the car is well past. Deer, rabbits and foxes bolt
// away from the road when the car comes close. Everything is drawn in a few
// instanced meshes: a walker is a matrix and four numbers, and the bend of
// its legs, its head and its tail is done in the vertex shader from the
// pivot each vertex carries. The ones that fly (birds, butterflies) keep
// nothing on the CPU, as the fish do (render/fish.js): a fixed seed places
// each in a box riding with the camera, wrapped in absolute coordinates, and
// the vertex shader flies it.
//
// They mark themselves in the frame's alpha a little lower than the car does
// (0.3 against 0.5), so a style that inks the car inks them too, and the
// brush that paints a hillside does not wipe them out.

import * as THREE from 'three';
import { WORLDS } from '../world/worlds.js';
import { GROUND, HALF_FLAT } from '../world/road.js';
import { withAtmosphere, withSunMask, atmo } from './atmosphere.js';
import { styleU } from './style.js';

const srgb = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// --- models -----------------------------------------------------------------
//
// A model is a heap of parts, each with a colour a vertex, and for the parts
// that move a pivot and what moves them: limb = [px, py, pz, kind, phase],
// kind 1 a leg (swings about the pivot as the animal strides), 2 the head
// (bows to graze), 3 the tail (sways). Metres, feet on y = 0, facing +z.

class Model {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.piv = [];
    this.swg = [];
    this.idx = [];
    this.n = 0;
  }

  v(x, y, z, nx, ny, nz, c, k, limb) {
    this.pos.push(x, y, z);
    const l = Math.hypot(nx, ny, nz) || 1;
    this.nrm.push(nx / l, ny / l, nz / l);
    this.col.push(c.r * k, c.g * k, c.b * k);
    this.piv.push(limb ? limb[0] : 0, limb ? limb[1] : 0, limb ? limb[2] : 0);
    this.swg.push(limb ? limb[3] : 0, limb ? limb[4] : 0);
    return this.n++;
  }

  // A triangle that faces the way its vertices' normals do.
  tri(a, b, c) {
    const p = this.pos;
    const ux = p[b * 3] - p[a * 3];
    const uy = p[b * 3 + 1] - p[a * 3 + 1];
    const uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3];
    const vy = p[c * 3 + 1] - p[a * 3 + 1];
    const vz = p[c * 3 + 2] - p[a * 3 + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const q = this.nrm;
    const d = nx * (q[a * 3] + q[b * 3] + q[c * 3]) + ny * (q[a * 3 + 1] + q[b * 3 + 1] + q[c * 3 + 1])
      + nz * (q[a * 3 + 2] + q[b * 3 + 2] + q[c * 3 + 2]);
    if (d >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }

  // A rounded part: a sphere stretched to radii (rx, ry, rz), tilted about
  // x by o.tilt (positive bows the front down), darker toward its underside.
  ellipsoid(cx, cy, cz, rx, ry, rz, c, o = {}) {
    const segs = o.segs || 9;
    const rings = o.rings || 6;
    const ct = Math.cos(o.tilt || 0);
    const st = Math.sin(o.tilt || 0);
    const k = o.k === undefined ? 1 : o.k;
    const grid = [];
    for (let r = 0; r <= rings; r++) {
      const phi = (r / rings) * Math.PI;
      const row = [];
      for (let s = 0; s < segs; s++) {
        const th = (s / segs) * Math.PI * 2;
        const ux = Math.sin(phi) * Math.cos(th);
        const uy = Math.cos(phi);
        const uz = Math.sin(phi) * Math.sin(th);
        const y = uy * ry;
        const z = uz * rz;
        const ny = uy / ry;
        const nz = uz / rz;
        row.push(this.v(cx + ux * rx, cy + ct * y - st * z, cz + st * y + ct * z,
          ux / rx, ct * ny - st * nz, st * ny + ct * nz, c, k * (0.78 + 0.22 * (0.5 + 0.5 * uy)), o.limb));
      }
      grid.push(row);
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segs; s++) {
        const s1 = (s + 1) % segs;
        this.tri(grid[r][s], grid[r][s1], grid[r + 1][s1]);
        this.tri(grid[r][s], grid[r + 1][s1], grid[r + 1][s]);
      }
    }
  }

  // A tapered tube from one end to the other: a leg, a neck, an ear, a horn.
  tube(x0, y0, z0, x1, y1, z1, r0, r1, c, o = {}) {
    const segs = o.segs || 6;
    const k = o.k === undefined ? 1 : o.k;
    let ax = x1 - x0;
    let ay = y1 - y0;
    let az = z1 - z0;
    const len = Math.hypot(ax, ay, az) || 1;
    ax /= len;
    ay /= len;
    az /= len;
    // Two vectors across the axis.
    let hx = 0;
    let hy = 1;
    let hz = 0;
    if (Math.abs(ay) > 0.9) {
      hx = 1;
      hy = 0;
    }
    let vx = hy * az - hz * ay;
    let vy = hz * ax - hx * az;
    let vz = hx * ay - hy * ax;
    const vl = Math.hypot(vx, vy, vz) || 1;
    vx /= vl;
    vy /= vl;
    vz /= vl;
    const wx = ay * vz - az * vy;
    const wy = az * vx - ax * vz;
    const wz = ax * vy - ay * vx;
    const rings = [];
    for (let e = 0; e < 2; e++) {
      const r = e ? r1 : r0;
      const cx = x0 + (x1 - x0) * e;
      const cy = y0 + (y1 - y0) * e;
      const cz = z0 + (z1 - z0) * e;
      const ring = [];
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        const dx = vx * Math.cos(a) + wx * Math.sin(a);
        const dy = vy * Math.cos(a) + wy * Math.sin(a);
        const dz = vz * Math.cos(a) + wz * Math.sin(a);
        ring.push(this.v(cx + dx * r, cy + dy * r, cz + dz * r, dx, dy, dz, c, k * (e ? 1 : 0.85), o.limb));
      }
      rings.push(ring);
    }
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      this.tri(rings[0][s], rings[1][s1], rings[0][s1]);
      this.tri(rings[0][s], rings[1][s], rings[1][s1]);
    }
  }

  // A box centred on (cx, cy, cz), flat faces. o.rz turns it about the z axis
  // through its centre (the leg of a spider, bent out and down).
  box(cx, cy, cz, sx, sy, sz, c, o = {}) {
    const k = o.k === undefined ? 1 : o.k;
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const y0 = cy - sy / 2;
    const y1 = cy + sy / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    const ca = Math.cos(o.rz || 0);
    const sa = Math.sin(o.rz || 0);
    const turn = (x, y) => [cx + (x - cx) * ca - (y - cy) * sa, cy + (x - cx) * sa + (y - cy) * ca];
    const face = (n, corners, shade) => {
      const nn = turn(n[0] + cx, n[1] + cy);
      const i = corners.map(([x, y, z]) => {
        const [tx, ty] = turn(x, y);
        return this.v(tx, ty, z, nn[0] - cx, nn[1] - cy, n[2], c, k * shade, o.limb);
      });
      this.tri(i[0], i[1], i[2]);
      this.tri(i[0], i[2], i[3]);
    };
    face([1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], 1);
    face([-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], 1);
    face([0, 1, 0], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], 1);
    face([0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], 0.8);
    face([0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 1);
    face([0, 0, -1], [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], 1);
  }

  done() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aPivot', new THREE.Float32BufferAttribute(this.piv, 3));
    g.setAttribute('aSwing', new THREE.Float32BufferAttribute(this.swg, 2));
    g.setIndex(this.idx);
    return g;
  }
}

// A sika deer, spotted, the stag with antlers.
function buildDeer() {
  const m = new Model();
  const fur = srgb(0xa9733f);
  const dark = srgb(0x5d3d24);
  const belly = srgb(0xe8d6b4);
  const white = srgb(0xfff4e2);
  const nose = srgb(0x2a1d17);
  m.ellipsoid(0, 0.96, 0, 0.21, 0.23, 0.52, fur);
  m.ellipsoid(0, 0.82, 0.02, 0.17, 0.13, 0.42, belly);
  m.ellipsoid(0, 0.99, -0.4, 0.17, 0.2, 0.17, fur);
  // Spots along the back and flanks, on the surface of the body.
  const rnd = mulberry32(11);
  for (let i = 0; i < 16; i++) {
    const a = (rnd() - 0.5) * 2.1;
    const z = (rnd() - 0.5) * 0.8;
    const fz = Math.sqrt(1 - (z / 0.52) ** 2);
    m.ellipsoid(Math.sin(a) * 0.205 * fz, 0.96 + Math.cos(a) * 0.225 * fz, z, 0.028, 0.028, 0.034, white, { segs: 6, rings: 3 });
  }
  // Legs, the diagonal pairs together.
  for (const [sx, sz, ph] of [[-1, 1, 0], [1, 1, Math.PI], [-1, -1, Math.PI], [1, -1, 0]]) {
    const px = sx * 0.12;
    const pz = sz > 0 ? 0.34 : -0.36;
    const limb = [px, 0.86, pz, 1, ph];
    m.tube(px, 0.9, pz, px, 0.46, pz + 0.02 * sz, 0.062, 0.036, fur, { limb });
    m.tube(px, 0.46, pz + 0.02 * sz, px, 0.04, pz, 0.034, 0.024, dark, { limb });
    m.ellipsoid(px, 0.03, pz + 0.01, 0.034, 0.03, 0.05, nose, { limb, segs: 6, rings: 4 });
  }
  // Neck and head, bowed together to graze.
  const hp = [0, 1.06, 0.42, 2, 0];
  m.tube(0, 1.04, 0.4, 0, 1.5, 0.64, 0.11, 0.074, fur, { limb: hp });
  m.ellipsoid(0, 1.56, 0.74, 0.075, 0.088, 0.16, fur, { limb: hp, tilt: 0.7 });
  m.ellipsoid(0, 1.5, 0.88, 0.04, 0.045, 0.06, nose, { limb: hp, tilt: 0.7, segs: 7, rings: 4 });
  for (const sx of [-1, 1]) {
    m.ellipsoid(sx * 0.085, 1.66, 0.66, 0.014, 0.075, 0.05, fur, { limb: hp, tilt: -0.35, segs: 6, rings: 4 });
    m.tube(sx * 0.04, 1.65, 0.7, sx * 0.12, 1.98, 0.6, 0.014, 0.008, dark, { limb: hp, segs: 5 });
    m.tube(sx * 0.09, 1.84, 0.65, sx * 0.2, 1.97, 0.76, 0.01, 0.006, dark, { limb: hp, segs: 5 });
  }
  m.ellipsoid(0, 1.0, -0.56, 0.05, 0.08, 0.045, white, { limb: [0, 1.02, -0.52, 3, 0], segs: 7, rings: 4 });
  return m.done();
}

function buildRabbit() {
  const m = new Model();
  const fur = srgb(0xb59878);
  const light = srgb(0xece0c8);
  const white = srgb(0xffffff);
  const dark = srgb(0x2c211b);
  m.ellipsoid(0, 0.16, 0, 0.085, 0.1, 0.17, fur);
  m.ellipsoid(0, 0.12, 0.03, 0.065, 0.06, 0.12, light);
  for (const sx of [-1, 1]) {
    m.ellipsoid(sx * 0.075, 0.12, -0.09, 0.05, 0.07, 0.09, fur, { limb: [sx * 0.075, 0.14, -0.08, 1, sx > 0 ? 0 : 0.5], segs: 8, rings: 5 });
    m.tube(sx * 0.04, 0.1, 0.12, sx * 0.04, 0.0, 0.14, 0.02, 0.016, fur, { limb: [sx * 0.04, 0.1, 0.12, 1, Math.PI], segs: 5 });
  }
  const hp = [0, 0.2, 0.12, 2, 0];
  m.ellipsoid(0, 0.25, 0.18, 0.056, 0.056, 0.078, fur, { limb: hp, tilt: 0.15 });
  m.ellipsoid(0, 0.24, 0.255, 0.02, 0.02, 0.025, dark, { limb: hp, segs: 6, rings: 4 });
  for (const sx of [-1, 1]) {
    m.ellipsoid(sx * 0.03, 0.37, 0.15, 0.017, 0.09, 0.03, fur, { limb: hp, tilt: -0.3, segs: 6, rings: 4 });
    m.ellipsoid(sx * 0.03, 0.37, 0.158, 0.009, 0.07, 0.02, light, { limb: hp, tilt: -0.3, segs: 6, rings: 3 });
    m.ellipsoid(sx * 0.048, 0.27, 0.205, 0.011, 0.014, 0.011, dark, { limb: hp, segs: 5, rings: 3 });
  }
  m.ellipsoid(0, 0.17, -0.19, 0.04, 0.04, 0.04, white, { limb: [0, 0.17, -0.17, 3, 0], segs: 7, rings: 4 });
  return m.done();
}

function buildFox() {
  const m = new Model();
  const orange = srgb(0xdb7a2a);
  const white = srgb(0xf6f0e6);
  const black = srgb(0x2a201b);
  m.ellipsoid(0, 0.36, 0, 0.1, 0.12, 0.3, orange);
  m.ellipsoid(0, 0.31, 0.16, 0.08, 0.09, 0.14, white);
  for (const [sx, sz, ph] of [[-1, 1, 0], [1, 1, Math.PI], [-1, -1, Math.PI], [1, -1, 0]]) {
    const px = sx * 0.07;
    const pz = sz > 0 ? 0.2 : -0.2;
    const limb = [px, 0.34, pz, 1, ph];
    m.tube(px, 0.36, pz, px, 0.17, pz, 0.036, 0.024, orange, { limb, segs: 5 });
    m.tube(px, 0.17, pz, px, 0.01, pz + 0.01, 0.022, 0.018, black, { limb, segs: 5 });
  }
  const hp = [0, 0.4, 0.28, 2, 0];
  m.ellipsoid(0, 0.45, 0.37, 0.075, 0.072, 0.1, orange, { limb: hp, tilt: 0.25 });
  m.ellipsoid(0, 0.425, 0.47, 0.034, 0.034, 0.07, white, { limb: hp, tilt: 0.25, segs: 7, rings: 4 });
  m.ellipsoid(0, 0.435, 0.54, 0.014, 0.014, 0.014, black, { limb: hp, segs: 5, rings: 3 });
  for (const sx of [-1, 1]) {
    m.tube(sx * 0.05, 0.5, 0.34, sx * 0.065, 0.63, 0.33, 0.034, 0.005, orange, { limb: hp, segs: 5 });
    m.tube(sx * 0.05, 0.5, 0.325, sx * 0.065, 0.61, 0.32, 0.026, 0.004, black, { limb: hp, segs: 5 });
  }
  const tp = [0, 0.36, -0.3, 3, 0];
  m.ellipsoid(0, 0.35, -0.5, 0.075, 0.075, 0.23, orange, { limb: tp, tilt: -0.1 });
  m.ellipsoid(0, 0.33, -0.71, 0.062, 0.062, 0.1, white, { limb: tp, tilt: -0.1, segs: 7, rings: 4 });
  return m.done();
}

// A black cat, sitting upright by the road, its tail curled round it.
function buildCat() {
  const m = new Model();
  const black = srgb(0x1c1b24);
  const eye = srgb(0xf2dc4a);
  m.ellipsoid(0, 0.2, -0.03, 0.1, 0.2, 0.12, black, { tilt: -0.15 });
  for (const sx of [-1, 1]) {
    m.ellipsoid(sx * 0.09, 0.09, -0.05, 0.07, 0.09, 0.12, black, { segs: 8, rings: 5 });
    m.tube(sx * 0.05, 0.3, 0.08, sx * 0.05, 0.0, 0.1, 0.028, 0.026, black, { segs: 5 });
  }
  const hp = [0, 0.4, 0.0, 2, 0];
  m.ellipsoid(0, 0.47, 0.05, 0.088, 0.078, 0.078, black, { limb: hp });
  for (const sx of [-1, 1]) {
    m.tube(sx * 0.05, 0.52, 0.04, sx * 0.068, 0.62, 0.04, 0.032, 0.005, black, { limb: hp, segs: 4 });
    m.ellipsoid(sx * 0.037, 0.48, 0.12, 0.015, 0.02, 0.008, eye, { limb: hp, k: 1.9, segs: 6, rings: 4 });
  }
  const tp = [0, 0.05, -0.13, 3, 0];
  const arc = [[0.0, 0.05, -0.13], [0.07, 0.04, -0.23], [0.15, 0.08, -0.29], [0.2, 0.17, -0.27], [0.19, 0.28, -0.2]];
  for (let i = 0; i < arc.length - 1; i++) {
    m.tube(...arc[i], ...arc[i + 1], 0.03 - i * 0.003, 0.027 - i * 0.003, black, { limb: tp, segs: 5 });
  }
  return m.done();
}

function buildPig() {
  const m = new Model();
  const pink = srgb(0xf0a6a2);
  const snout = srgb(0xe28c8c);
  const dark = srgb(0x2a1a1a);
  m.box(0, 0.58, 0, 0.62, 0.5, 0.92, pink);
  const hp = [0, 0.7, 0.42, 2, 0];
  m.box(0, 0.7, 0.66, 0.5, 0.46, 0.44, pink, { limb: hp });
  m.box(0, 0.62, 0.9, 0.24, 0.18, 0.08, snout, { limb: hp });
  for (const sx of [-1, 1]) m.box(sx * 0.15, 0.78, 0.885, 0.07, 0.07, 0.02, dark, { limb: hp });
  for (const [sx, sz, ph] of [[-1, 1, 0], [1, 1, Math.PI], [-1, -1, Math.PI], [1, -1, 0]]) {
    m.box(sx * 0.2, 0.2, sz * 0.3, 0.2, 0.4, 0.2, pink, { limb: [sx * 0.2, 0.4, sz * 0.3, 1, ph], k: 0.92 });
  }
  return m.done();
}

function buildSheep() {
  const m = new Model();
  const wool = srgb(0xefefea);
  const skin = srgb(0xb9a595);
  const dark = srgb(0x2a1f1c);
  m.box(0, 0.76, 0, 0.76, 0.66, 0.98, wool);
  const hp = [0, 0.8, 0.5, 2, 0];
  m.box(0, 0.82, 0.66, 0.4, 0.4, 0.38, skin, { limb: hp });
  m.box(0, 1.04, 0.6, 0.44, 0.14, 0.3, wool, { limb: hp });
  for (const sx of [-1, 1]) m.box(sx * 0.11, 0.86, 0.855, 0.07, 0.07, 0.02, dark, { limb: hp });
  for (const [sx, sz, ph] of [[-1, 1, 0], [1, 1, Math.PI], [-1, -1, Math.PI], [1, -1, 0]]) {
    m.box(sx * 0.2, 0.22, sz * 0.32, 0.16, 0.44, 0.16, skin, { limb: [sx * 0.2, 0.44, sz * 0.32, 1, ph], k: 0.9 });
  }
  return m.done();
}

function buildCow() {
  const m = new Model();
  const brown = srgb(0x44301f);
  const white = srgb(0xf2eee6);
  const pinkish = srgb(0xe8c2b4);
  const horn = srgb(0xe6dcc0);
  const dark = srgb(0x1f1512);
  m.box(0, 0.88, 0, 0.72, 0.7, 1.2, brown);
  m.box(0.365, 0.94, 0.12, 0.02, 0.42, 0.5, white);
  m.box(-0.365, 0.82, -0.2, 0.02, 0.4, 0.46, white);
  m.box(0.1, 1.235, -0.1, 0.4, 0.02, 0.4, white);
  const hp = [0, 1.0, 0.64, 2, 0];
  m.box(0, 1.02, 0.84, 0.5, 0.5, 0.46, brown, { limb: hp });
  m.box(0, 0.92, 1.08, 0.34, 0.22, 0.06, pinkish, { limb: hp });
  for (const sx of [-1, 1]) {
    m.box(sx * 0.29, 1.3, 0.82, 0.08, 0.1, 0.08, horn, { limb: hp });
    m.box(sx * 0.13, 1.1, 1.065, 0.07, 0.07, 0.02, dark, { limb: hp });
  }
  for (const [sx, sz, ph] of [[-1, 1, 0], [1, 1, Math.PI], [-1, -1, Math.PI], [1, -1, 0]]) {
    m.box(sx * 0.22, 0.3, sz * 0.44, 0.2, 0.6, 0.2, brown, { limb: [sx * 0.22, 0.6, sz * 0.44, 1, ph], k: 0.9 });
  }
  return m.done();
}

function buildChicken() {
  const m = new Model();
  const white = srgb(0xf4f4ee);
  const grey = srgb(0xd8d8d0);
  const yellow = srgb(0xf0c030);
  const red = srgb(0xc83030);
  const dark = srgb(0x1f1a18);
  m.box(0, 0.42, 0, 0.28, 0.28, 0.4, white);
  m.box(0, 0.56, -0.24, 0.08, 0.2, 0.1, white);
  for (const sx of [-1, 1]) m.box(sx * 0.155, 0.44, 0, 0.04, 0.2, 0.3, grey);
  const hp = [0, 0.56, 0.18, 2, 0];
  m.box(0, 0.66, 0.2, 0.16, 0.22, 0.16, white, { limb: hp });
  m.box(0, 0.64, 0.3, 0.1, 0.06, 0.08, yellow, { limb: hp });
  m.box(0, 0.55, 0.28, 0.04, 0.08, 0.04, red, { limb: hp });
  m.box(0, 0.79, 0.2, 0.04, 0.08, 0.1, red, { limb: hp });
  for (const sx of [-1, 1]) m.box(sx * 0.085, 0.69, 0.275, 0.03, 0.04, 0.02, dark, { limb: hp });
  for (const sx of [-1, 1]) m.box(sx * 0.06, 0.14, 0, 0.04, 0.28, 0.04, yellow, { limb: [sx * 0.06, 0.28, 0, 1, sx > 0 ? 0 : Math.PI] });
  return m.done();
}

// A goat of the high meadows: cream, horned, bearded.
function buildGoat() {
  const m = new Model();
  const wool = srgb(0xf1e8d6);
  const grey = srgb(0xb9ae9c);
  const dark = srgb(0x2f2622);
  const horn = srgb(0xcdbd9a);
  m.ellipsoid(0, 0.64, 0, 0.17, 0.19, 0.4, wool);
  for (const [sx, sz, ph] of [[-1, 1, 0], [1, 1, Math.PI], [-1, -1, Math.PI], [1, -1, 0]]) {
    const px = sx * 0.1;
    const pz = sz > 0 ? 0.26 : -0.26;
    const limb = [px, 0.56, pz, 1, ph];
    m.tube(px, 0.6, pz, px, 0.3, pz, 0.05, 0.03, wool, { limb, segs: 5 });
    m.tube(px, 0.3, pz, px, 0.02, pz, 0.028, 0.022, dark, { limb, segs: 5 });
  }
  const hp = [0, 0.74, 0.34, 2, 0];
  m.tube(0, 0.72, 0.3, 0, 0.98, 0.5, 0.08, 0.06, wool, { limb: hp });
  m.ellipsoid(0, 1.02, 0.58, 0.06, 0.07, 0.12, wool, { limb: hp, tilt: 0.5 });
  m.ellipsoid(0, 0.9, 0.64, 0.025, 0.07, 0.025, grey, { limb: hp, segs: 5, rings: 4 });
  for (const sx of [-1, 1]) {
    m.tube(sx * 0.04, 1.08, 0.5, sx * 0.07, 1.26, 0.38, 0.018, 0.008, horn, { limb: hp, segs: 5 });
    m.tube(sx * 0.07, 1.26, 0.38, sx * 0.08, 1.3, 0.24, 0.01, 0.005, horn, { limb: hp, segs: 5 });
    m.ellipsoid(sx * 0.07, 1.02, 0.48, 0.015, 0.05, 0.03, grey, { limb: hp, tilt: -0.9, segs: 5, rings: 3 });
  }
  m.ellipsoid(0, 0.78, -0.4, 0.03, 0.06, 0.03, wool, { limb: [0, 0.8, -0.38, 3, 0], segs: 5, rings: 3 });
  return m.done();
}

// A tanuki: round, grey-brown, a dark mask, a ringed tail.
function buildTanuki() {
  const m = new Model();
  const fur = srgb(0x8c7b66);
  const pale = srgb(0xcdbfa6);
  const dark = srgb(0x2a2420);
  const Y = 0.08;
  m.ellipsoid(0, 0.3 + Y, 0, 0.2, 0.19, 0.27, fur);
  m.ellipsoid(0, 0.25 + Y, 0.05, 0.16, 0.13, 0.22, pale);
  for (const [sx, sz, ph] of [[-1, 1, 0], [1, 1, Math.PI], [-1, -1, Math.PI], [1, -1, 0]]) {
    const px = sx * 0.1;
    const pz = sz > 0 ? 0.16 : -0.18;
    const limb = [px, 0.3, pz, 1, ph];
    m.tube(px, 0.32, pz, px, 0.17, pz, 0.062, 0.042, fur, { limb, segs: 5 });
    m.tube(px, 0.17, pz, px, 0.012, pz + 0.01, 0.036, 0.03, dark, { limb, segs: 5 });
  }
  const hp = [0, 0.38 + Y, 0.22, 2, 0];
  m.ellipsoid(0, 0.43 + Y, 0.31, 0.12, 0.1, 0.13, fur, { limb: hp, tilt: 0.2 });
  m.ellipsoid(0, 0.39 + Y, 0.42, 0.05, 0.04, 0.06, pale, { limb: hp, segs: 7, rings: 4 });
  m.ellipsoid(0, 0.4 + Y, 0.47, 0.016, 0.014, 0.016, dark, { limb: hp, segs: 5, rings: 3 });
  for (const sx of [-1, 1]) {
    m.ellipsoid(sx * 0.055, 0.45 + Y, 0.39, 0.032, 0.05, 0.02, dark, { limb: hp, tilt: 0.3, segs: 6, rings: 4 });
    m.ellipsoid(sx * 0.1, 0.52 + Y, 0.26, 0.04, 0.04, 0.02, fur, { limb: hp, segs: 6, rings: 4 });
  }
  const tp = [0, 0.32 + Y, -0.26, 3, 0];
  m.ellipsoid(0, 0.3 + Y, -0.42, 0.09, 0.09, 0.2, fur, { limb: tp, tilt: -0.1 });
  for (let i = 0; i < 3; i++) m.ellipsoid(0, 0.3 + Y, -0.34 - i * 0.09, 0.094, 0.094, 0.03, dark, { limb: tp, segs: 8, rings: 3 });
  return m.done();
}

// A grey heron, standing: a long neck in an S, a yellow bill, long legs.
function buildHeron() {
  const m = new Model();
  const grey = srgb(0x8fa0ae);
  const wing = srgb(0x6f8090);
  const white = srgb(0xeef0f0);
  const dark = srgb(0x242a33);
  const bill = srgb(0xd9a441);
  const leg = srgb(0x6d5a3c);
  m.ellipsoid(0, 0.82, 0, 0.09, 0.13, 0.28, grey, { tilt: -0.25 });
  for (const sx of [-1, 1]) {
    m.ellipsoid(sx * 0.085, 0.83, -0.05, 0.03, 0.1, 0.22, wing, { tilt: -0.25, segs: 7, rings: 4 });
    m.tube(sx * 0.04, 0.72, -0.02, sx * 0.04, 0.02, 0.0, 0.014, 0.01, leg, { limb: [sx * 0.04, 0.72, -0.02, 1, sx > 0 ? 0 : Math.PI], segs: 4 });
  }
  const hp = [0, 0.9, 0.2, 2, 0];
  m.tube(0, 0.9, 0.2, 0, 1.12, 0.3, 0.032, 0.028, white, { limb: hp, segs: 5 });
  m.tube(0, 1.12, 0.3, 0, 1.28, 0.2, 0.028, 0.024, white, { limb: hp, segs: 5 });
  m.tube(0, 1.28, 0.2, 0, 1.44, 0.3, 0.026, 0.024, white, { limb: hp, segs: 5 });
  m.ellipsoid(0, 1.47, 0.34, 0.035, 0.035, 0.07, white, { limb: hp, tilt: 0.3, segs: 7, rings: 4 });
  m.tube(0, 1.46, 0.4, 0, 1.42, 0.66, 0.016, 0.004, bill, { limb: hp, segs: 4 });
  m.tube(0, 1.5, 0.3, 0, 1.54, 0.12, 0.01, 0.003, dark, { limb: hp, segs: 4 });
  return m.done();
}

// A camel with one hump, the colour of what it walks on.
function buildCamel() {
  const m = new Model();
  const fur = srgb(0xc9a56e);
  const pale = srgb(0xdfc590);
  const dark = srgb(0x7b5d38);
  const nose = srgb(0x3a2b1f);
  m.ellipsoid(0, 1.2, 0, 0.3, 0.3, 0.78, fur);
  m.ellipsoid(0, 1.05, 0.04, 0.25, 0.14, 0.64, pale);
  m.ellipsoid(0, 1.52, -0.12, 0.19, 0.24, 0.25, fur);
  for (const [sx, sz, ph] of [[-1, 1, 0], [1, 1, Math.PI], [-1, -1, Math.PI], [1, -1, 0]]) {
    const px = sx * 0.2;
    const pz = sz > 0 ? 0.52 : -0.52;
    const limb = [px, 1.05, pz, 1, ph];
    m.tube(px, 1.1, pz, px, 0.58, pz, 0.11, 0.065, fur, { limb, segs: 6 });
    m.tube(px, 0.58, pz, px, 0.05, pz + 0.02, 0.06, 0.05, dark, { limb, segs: 6 });
    m.ellipsoid(px, 0.04, pz + 0.04, 0.07, 0.04, 0.09, dark, { limb, segs: 6, rings: 3 });
  }
  const hp = [0, 1.32, 0.66, 2, 0];
  m.tube(0, 1.3, 0.55, 0, 1.6, 0.9, 0.17, 0.12, fur, { limb: hp });
  m.tube(0, 1.6, 0.9, 0, 1.92, 1.04, 0.12, 0.085, fur, { limb: hp });
  m.ellipsoid(0, 2.0, 1.22, 0.085, 0.09, 0.19, fur, { limb: hp, tilt: 0.3 });
  m.ellipsoid(0, 1.94, 1.4, 0.062, 0.052, 0.075, nose, { limb: hp, tilt: 0.3, segs: 6, rings: 4 });
  for (const sx of [-1, 1]) m.ellipsoid(sx * 0.065, 2.1, 1.06, 0.022, 0.045, 0.02, dark, { limb: hp, segs: 5, rings: 3 });
  m.ellipsoid(0, 1.1, -0.82, 0.04, 0.14, 0.04, dark, { limb: [0, 1.2, -0.76, 3, 0], segs: 5, rings: 4 });
  return m.done();
}

// A little white spirit of the woods, its head tilting as it looks.
function buildKodama() {
  const m = new Model();
  const white = srgb(0xf4f0e4);
  const dark = srgb(0x2b2622);
  m.ellipsoid(0, 0.28, 0, 0.1, 0.17, 0.09, white, { k: 1.25 });
  for (const sx of [-1, 1]) m.tube(sx * 0.08, 0.34, 0, sx * 0.13, 0.16, 0.02, 0.025, 0.02, white, { k: 1.15, segs: 5, limb: [sx * 0.08, 0.34, 0, 3, sx] });
  const hp = [0, 0.44, 0, 2, 0];
  m.ellipsoid(0, 0.56, 0, 0.14, 0.12, 0.12, white, { limb: hp, k: 1.3 });
  for (const sx of [-1, 1]) m.ellipsoid(sx * 0.05, 0.58, 0.108, 0.018, 0.026, 0.01, dark, { limb: hp, segs: 5, rings: 3 });
  m.ellipsoid(0, 0.52, 0.114, 0.02, 0.016, 0.01, dark, { limb: hp, segs: 5, rings: 3 });
  return m.done();
}

// The same animals of boxes, as a block world has them.
function buildHorse() {
  const m = new Model();
  const coat = srgb(0x8a5a36);
  const mane = srgb(0x2b1d14);
  const white = srgb(0xf0e6d6);
  m.box(0, 1.05, 0, 0.55, 0.6, 1.3, coat);
  m.box(0, 1.4, -0.7, 0.14, 0.14, 0.4, mane);
  const hp = [0, 1.3, 0.6, 2, 0];
  m.box(0, 1.5, 0.62, 0.28, 0.7, 0.3, coat, { limb: hp });
  m.box(0, 1.8, 0.88, 0.26, 0.3, 0.56, coat, { limb: hp });
  m.box(0, 1.66, 0.5, 0.08, 0.5, 0.1, mane, { limb: hp });
  m.box(0, 1.76, 1.18, 0.2, 0.2, 0.06, white, { limb: hp });
  for (const sx of [-1, 1]) m.box(sx * 0.13, 2.02, 0.7, 0.07, 0.14, 0.07, mane, { limb: hp });
  for (const [sx, sz, ph] of [[-1, 1, 0], [1, 1, Math.PI], [-1, -1, Math.PI], [1, -1, 0]]) {
    m.box(sx * 0.18, 0.37, sz * 0.52, 0.17, 0.75, 0.17, coat, { limb: [sx * 0.18, 0.75, sz * 0.52, 1, ph], k: 0.9 });
  }
  return m.done();
}

function buildWolf() {
  const m = new Model();
  const fur = srgb(0x8d8f93);
  const dark = srgb(0x3a3b3f);
  const pale = srgb(0xdcdcd8);
  m.box(0, 0.62, 0, 0.4, 0.4, 0.9, fur);
  const hp = [0, 0.72, 0.42, 2, 0];
  m.box(0, 0.78, 0.6, 0.34, 0.32, 0.34, fur, { limb: hp });
  m.box(0, 0.7, 0.86, 0.16, 0.14, 0.2, pale, { limb: hp });
  m.box(0, 0.72, 0.97, 0.07, 0.06, 0.04, dark, { limb: hp });
  for (const sx of [-1, 1]) m.box(sx * 0.12, 1.0, 0.56, 0.1, 0.14, 0.06, dark, { limb: hp });
  m.box(0, 0.74, -0.56, 0.12, 0.12, 0.5, fur, { limb: [0, 0.74, -0.4, 3, 0] });
  for (const [sx, sz, ph] of [[-1, 1, 0], [1, 1, Math.PI], [-1, -1, Math.PI], [1, -1, 0]]) {
    m.box(sx * 0.13, 0.22, sz * 0.32, 0.12, 0.44, 0.12, dark, { limb: [sx * 0.13, 0.44, sz * 0.32, 1, ph] });
  }
  return m.done();
}

function buildRabbitBlock() {
  const m = new Model();
  const fur = srgb(0xb59878);
  const white = srgb(0xf4efe6);
  const dark = srgb(0x2c211b);
  m.box(0, 0.2, 0, 0.22, 0.2, 0.34, fur);
  const hp = [0, 0.26, 0.14, 2, 0];
  m.box(0, 0.32, 0.2, 0.18, 0.16, 0.16, fur, { limb: hp });
  for (const sx of [-1, 1]) {
    m.box(sx * 0.05, 0.52, 0.18, 0.05, 0.22, 0.04, fur, { limb: hp });
    m.box(sx * 0.07, 0.34, 0.285, 0.03, 0.03, 0.02, dark, { limb: hp });
    m.box(sx * 0.09, 0.09, -0.1, 0.08, 0.16, 0.14, fur, { limb: [sx * 0.09, 0.17, -0.1, 1, sx > 0 ? 0 : 0.5] });
    m.box(sx * 0.07, 0.07, 0.16, 0.06, 0.14, 0.06, fur, { limb: [sx * 0.07, 0.14, 0.16, 1, Math.PI] });
  }
  m.box(0, 0.22, -0.2, 0.08, 0.08, 0.08, white, { limb: [0, 0.22, -0.18, 3, 0] });
  return m.done();
}

function buildCamelBlock() {
  const m = new Model();
  const fur = srgb(0xc9a56e);
  const dark = srgb(0x7b5d38);
  m.box(0, 1.25, 0, 0.7, 0.7, 1.5, fur);
  m.box(0, 1.76, -0.2, 0.45, 0.36, 0.5, fur);
  const hp = [0, 1.5, 0.8, 2, 0];
  m.box(0, 1.9, 0.9, 0.3, 0.9, 0.3, fur, { limb: hp });
  m.box(0, 2.4, 1.1, 0.3, 0.34, 0.56, fur, { limb: hp });
  m.box(0, 2.3, 1.38, 0.2, 0.14, 0.04, dark, { limb: hp });
  m.box(0, 1.1, -0.8, 0.1, 0.5, 0.1, dark, { limb: [0, 1.5, -0.78, 3, 0] });
  for (const [sx, sz, ph] of [[-1, 1, 0], [1, 1, Math.PI], [-1, -1, Math.PI], [1, -1, 0]]) {
    m.box(sx * 0.24, 0.45, sz * 0.58, 0.2, 0.9, 0.2, fur, { limb: [sx * 0.24, 0.9, sz * 0.58, 1, ph], k: 0.92 });
  }
  return m.done();
}

function buildVillager() {
  const m = new Model();
  const robe = srgb(0x6b4a30);
  const skin = srgb(0xc9977a);
  const dark = srgb(0x40291b);
  const eye = srgb(0x3f7a3a);
  m.box(0, 0.9, 0, 0.5, 0.9, 0.3, robe);
  m.box(0, 1.2, 0.15, 0.7, 0.2, 0.2, dark);
  const hp = [0, 1.45, 0, 2, 0];
  m.box(0, 1.68, 0, 0.34, 0.4, 0.34, skin, { limb: hp });
  m.box(0, 1.6, 0.22, 0.1, 0.22, 0.1, skin, { limb: hp, k: 0.85 });
  m.box(0, 1.76, 0.0, 0.36, 0.06, 0.36, dark, { limb: hp });
  for (const sx of [-1, 1]) m.box(sx * 0.09, 1.7, 0.175, 0.07, 0.05, 0.02, eye, { limb: hp });
  for (const sx of [-1, 1]) m.box(sx * 0.12, 0.3, 0, 0.2, 0.6, 0.2, dark, { limb: [sx * 0.12, 0.6, 0, 1, sx > 0 ? 0 : Math.PI] });
  return m.done();
}

function buildSpider() {
  const m = new Model();
  const body = srgb(0x4a3a34);
  const dark = srgb(0x2c2321);
  const red = srgb(0xe83030);
  m.box(0, 0.5, -0.1, 0.5, 0.38, 0.56, body);
  m.box(0, 0.5, -0.1, 0.24, 0.4, 0.58, dark);
  const hp = [0, 0.5, 0.3, 2, 0];
  m.box(0, 0.55, 0.4, 0.36, 0.3, 0.3, body, { limb: hp });
  for (const sx of [-1, 1]) {
    m.box(sx * 0.1, 0.62, 0.56, 0.08, 0.06, 0.02, red, { limb: hp, k: 2.2 });
    m.box(sx * 0.1, 0.5, 0.56, 0.06, 0.04, 0.02, red, { limb: hp, k: 2 });
  }
  // Eight legs bent like a "^": out and up from the body, then down.
  for (let i = 0; i < 4; i++) {
    for (const sx of [-1, 1]) {
      const z = 0.3 - i * 0.2;
      const limb = [sx * 0.25, 0.5, z, 1, (i % 2 ? Math.PI : 0) + (sx > 0 ? 0 : 1.2)];
      m.box(sx * 0.5, 0.67, z, 0.56, 0.07, 0.07, dark, { limb, rz: sx * 0.42 });
      m.box(sx * 0.9, 0.41, z, 0.8, 0.07, 0.07, dark, { limb, rz: sx * -1.15 });
    }
  }
  return m.done();
}

function buildMagma() {
  const m = new Model();
  const shell = srgb(0x2a0d08);
  const glow = srgb(0xff7a1a);
  m.box(0, 0.5, 0, 0.9, 0.9, 0.9, shell);
  m.box(0, 0.62, 0.455, 0.62, 0.12, 0.02, glow, { k: 3 });
  m.box(0, 0.4, 0.455, 0.3, 0.1, 0.02, glow, { k: 2.4 });
  for (const sx of [-1, 1]) m.box(sx * 0.455, 0.5, 0, 0.02, 0.5, 0.5, glow, { k: 2.2 });
  m.box(0, 0.955, 0, 0.5, 0.02, 0.5, glow, { k: 2.2 });
  return m.done();
}

function buildEnderman() {
  const m = new Model();
  const black = srgb(0x15101a);
  const eye = srgb(0xd24cf0);
  m.box(0, 1.9, 0, 0.4, 0.7, 0.2, black);
  const hp = [0, 2.25, 0, 2, 0];
  m.box(0, 2.5, 0, 0.34, 0.34, 0.34, black, { limb: hp });
  for (const sx of [-1, 1]) {
    m.box(sx * 0.09, 2.52, 0.175, 0.1, 0.04, 0.02, eye, { limb: hp, k: 3 });
    m.box(sx * 0.27, 1.55, 0, 0.1, 1.2, 0.1, black, { limb: [sx * 0.27, 2.15, 0, 1, sx > 0 ? 0 : Math.PI] });
    m.box(sx * 0.1, 0.8, 0, 0.12, 1.6, 0.12, black, { limb: [sx * 0.1, 1.6, 0, 1, sx > 0 ? Math.PI : 0] });
  }
  return m.done();
}

// What each kind of walker is. size: how much bigger or smaller one may be;
// flee: how close the car may come before it bolts (0: it stays); speed: m/s
// when it bolts or wanders; stride: radians of leg swing for each metre; hop:
// how high it bounds (rabbits); sit: it does not walk; mass (kg) and hitR (m):
// what a car that runs into it feels, and how near it must be to be hit.
const SPECIES = {
  deer: { set: 'wood', build: buildDeer, size: [0.88, 1.08], flee: 36, speed: 10, stride: 2.9, max: 5, mass: 80, hitR: 0.5 },
  rabbit: { set: 'wood', build: buildRabbit, size: [1.5, 1.9], flee: 20, speed: 6.5, stride: 2.4, hop: 0.45, max: 6, mass: 3, hitR: 0.3 },
  fox: { set: 'wood', build: buildFox, size: [1.15, 1.35], flee: 28, speed: 8.5, stride: 2.8, max: 3, mass: 8, hitR: 0.35 },
  cat: { set: 'wood', build: buildCat, size: [1.25, 1.4], flee: 0, speed: 0, stride: 0, sit: true, max: 2, mass: 4, hitR: 0.25 },
  goat: { set: 'wood', build: buildGoat, size: [1.0, 1.2], flee: 30, speed: 9, stride: 3.0, max: 4, mass: 60, hitR: 0.45 },
  tanuki: { set: 'wood', build: buildTanuki, size: [1.3, 1.5], flee: 22, speed: 5.5, stride: 3.2, max: 3, mass: 6, hitR: 0.35 },
  heron: { set: 'wood', build: buildHeron, size: [1.1, 1.3], flee: 24, speed: 4.5, stride: 2.2, max: 3, mass: 2, hitR: 0.3 },
  camel: { set: 'wood', build: buildCamel, size: [0.95, 1.1], flee: 0, speed: 1.0, stride: 3.0, max: 3, mass: 500, hitR: 0.8 },
  kodama: { set: 'wood', build: buildKodama, size: [1.4, 1.7], flee: 0, speed: 0, stride: 0, sit: true, max: 5, mass: 2, hitR: 0.25 },
  pig: { set: 'block', build: buildPig, size: [0.9, 1.1], flee: 0, speed: 0.8, stride: 6, max: 4, mass: 120, hitR: 0.5 },
  sheep: { set: 'block', build: buildSheep, size: [0.9, 1.1], flee: 0, speed: 0.7, stride: 6, max: 5, mass: 70, hitR: 0.5 },
  cow: { set: 'block', build: buildCow, size: [0.95, 1.1], flee: 0, speed: 0.6, stride: 5.5, max: 4, mass: 600, hitR: 0.7 },
  chicken: { set: 'block', build: buildChicken, size: [0.9, 1.1], flee: 0, speed: 0.9, stride: 9, max: 5, mass: 3, hitR: 0.25 },
  horse: { set: 'block', build: buildHorse, size: [0.95, 1.05], flee: 0, speed: 1.0, stride: 4.5, max: 3, mass: 450, hitR: 0.7 },
  wolf: { set: 'block', build: buildWolf, size: [0.95, 1.05], flee: 26, speed: 9, stride: 4, max: 3, mass: 40, hitR: 0.45 },
  rabbitb: { set: 'block', build: buildRabbitBlock, size: [1.5, 1.9], flee: 18, speed: 6, stride: 3, hop: 0.4, max: 4, mass: 3, hitR: 0.3 },
  camelb: { set: 'block', build: buildCamelBlock, size: [0.95, 1.1], flee: 0, speed: 0.9, stride: 3.5, max: 3, mass: 500, hitR: 0.9 },
  villager: { set: 'block', build: buildVillager, size: [0.95, 1.05], flee: 0, speed: 0.7, stride: 5, max: 3, mass: 70, hitR: 0.35 },
  spider: { set: 'block', build: buildSpider, size: [1.2, 1.5], flee: 0, speed: 1.4, stride: 5, max: 4, mass: 60, hitR: 0.9 },
  magma: { set: 'block', build: buildMagma, size: [1.2, 1.8], flee: 0, speed: 1.5, stride: 0, hop: 0.7, max: 4, mass: 150, hitR: 0.7 },
  enderman: { set: 'block', build: buildEnderman, size: [1.0, 1.1], flee: 0, speed: 0.8, stride: 3.5, max: 3, mass: 60, hitR: 0.35 },
};
const KINDS = Object.keys(SPECIES);

// How many of each a world has about its road, by world id: the painted
// wood's (WILD) and the block world's (FARM).
const WILD = {
  alpine: { deer: 2, goat: 3, fox: 1, rabbit: 2 },
  hills: { deer: 3, rabbit: 4, fox: 1, tanuki: 2, cat: 1 },
  river: { deer: 2, rabbit: 3, heron: 2, tanuki: 1, cat: 1 },
  coast: { rabbit: 2, fox: 1, heron: 1, cat: 1 },
  desert: { camel: 2 },
  cavern: { kodama: 5 },
};
const FARM = {
  alpine: { sheep: 3, cow: 1, wolf: 2, rabbitb: 2 },
  hills: { pig: 2, sheep: 3, cow: 2, chicken: 3, horse: 2, villager: 1 },
  river: { cow: 2, sheep: 2, chicken: 2, horse: 1 },
  coast: { sheep: 3, pig: 1, chicken: 2 },
  desert: { camelb: 3, rabbitb: 2 },
  cavern: { spider: 4 },
  inferno: { magma: 4 },
  space: { enderman: 3 },
};
// Birds and butterflies over each world: a share of the full number.
const SKY = {
  alpine: [0.8, 0.5], hills: [1, 1], river: [0.9, 0.9], coast: [1, 0.4], desert: [0.25, 0], heaven: [0.7, 0],
};

// --- the walkers' material ---------------------------------------------------

function critterMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  mat.userData.styleMark = true;
  mat.userData.styleCreature = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCrTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 aPivot;
attribute vec2 aSwing;
attribute vec4 aAnim;   // per animal: gait phase, stride 0..1, head bowed 0..1, own draw
uniform float uCrTime;
mat3 crRot() {
  float kind = aSwing.x;
  if ( kind < 0.5 ) return mat3( 1.0 );
  if ( kind > 2.5 ) {
    // The tail sways to either side.
    float t = 0.4 * sin( uCrTime * 2.3 + aAnim.w * 6.2832 + aSwing.y );
    return mat3( cos( t ), 0.0, -sin( t ), 0.0, 1.0, 0.0, sin( t ), 0.0, cos( t ) );
  }
  float a = kind < 1.5
    ? sin( aAnim.x + aSwing.y ) * 0.8 * aAnim.y
    : aAnim.z * 0.95 + 0.04 * sin( uCrTime * 1.3 + aAnim.w * 6.2832 );
  float c = cos( a );
  float s = sin( a );
  return mat3( 1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c );
}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
mat3 crR = crRot();
objectNormal = crR * objectNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed = aPivot + crR * ( transformed - aPivot );`);
  };
  mat.customProgramCacheKey = () => 'continuum-critter';
  return withSunMask(withAtmosphere(mat), false);
}
const timeUniform = { value: 0 };

// --- the ones that fly -------------------------------------------------------

// A bird a unit across, wings out, nose at +z. aWing says how far a vertex
// flaps (0 at the body, 1 at a wingtip); aShade its colour.
function birdGeometry() {
  const P = [];
  const wing = [];
  const shade = [];
  const idx = [];
  const add = (x, y, z, w, s) => {
    P.push(x, y, z);
    wing.push(w);
    shade.push(s);
    return P.length / 3 - 1;
  };
  // Body: a flat diamond; head; tail.
  const n0 = add(0, 0.015, 0.3, 0, 0.9);
  const l = add(-0.045, 0, 0.04, 0, 1);
  const r = add(0.045, 0, 0.04, 0, 1);
  const b = add(0, 0.01, -0.2, 0, 0.9);
  idx.push(n0, l, r, l, b, r);
  const t0 = add(-0.035, 0, -0.18, 0, 0.9);
  const t1 = add(0.035, 0, -0.18, 0, 0.9);
  const t2 = add(0, 0, -0.36, 0, 0.55);
  idx.push(t0, t2, t1);
  // Wings: a root and a tip each side, the leading edge forward of the trailing.
  for (const s of [-1, 1]) {
    const f = add(s * 0.04, 0.005, 0.15, 0, 1);
    const k = add(s * 0.04, 0.005, -0.12, 0, 1);
    const m1 = add(s * 0.27, 0.01, 0.0, 0.55, 0.95);
    const m2 = add(s * 0.27, 0.01, -0.2, 0.55, 0.85);
    const tipF = add(s * 0.5, 0.02, -0.04, 1, 0.3);
    const tipB = add(s * 0.46, 0.02, -0.22, 1, 0.2);
    idx.push(f, k, m2, f, m2, m1, m1, m2, tipB, m1, tipB, tipF);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  g.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 1));
  g.setIndex(idx);
  return g;
}

function butterflyGeometry() {
  const P = [];
  const wing = [];
  const shade = [];
  const idx = [];
  const add = (x, y, z, w, s) => {
    P.push(x, y, z);
    wing.push(w);
    shade.push(s);
    return P.length / 3 - 1;
  };
  const a = add(0, 0, 0.3, 0, 0.5);
  const b = add(-0.03, 0, 0, 0, 0.45);
  const c = add(0.03, 0, 0, 0, 0.45);
  const d = add(0, 0, -0.34, 0, 0.45);
  idx.push(a, b, c, b, d, c);
  for (const s of [-1, 1]) {
    const root = add(s * 0.03, 0, 0.04, 0, 1);
    const f1 = add(s * 0.26, 0, 0.34, 0.7, 1);
    const f2 = add(s * 0.5, 0, 0.2, 1, 0.9);
    const f3 = add(s * 0.4, 0, -0.04, 0.9, 0.95);
    const h1 = add(s * 0.34, 0, -0.1, 0.8, 0.85);
    const h2 = add(s * 0.22, 0, -0.42, 0.55, 0.7);
    const rb = add(s * 0.03, 0, -0.06, 0, 1);
    idx.push(root, f1, f2, root, f2, f3, root, f3, h1, root, h1, h2, root, h2, rb);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  g.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 1));
  g.setIndex(idx);
  return g;
}

const FLY_COMMON = /* glsl */`
attribute float aWing;
attribute float aShade;
uniform vec3 uCam;
uniform vec3 uCamMod;
uniform float uTime;
uniform float uShare;
uniform float uSize;
uniform vec3 fogParams;
uniform vec3 uFogCol;
varying vec3 vCol;
vec3 flyBank( vec3 fwd, vec3 inward, out vec3 side ) {
  side = normalize( cross( vec3( 0.0, 1.0, 0.0 ), fwd ) + vec3( 1e-4, 0.0, 0.0 ) );
  return normalize( cross( fwd, side ) + inward );
}
`;

// Flocks of birds wheeling round on slow circles, high over the road.
const BIRD_BOX = 200;
const BIRD_VERTEX = /* glsl */`${FLY_COMMON}
attribute vec4 aFlock;   // where the flock's circle is in the box (xz, 0..1), its height, its own draw
attribute vec4 aBird;    // where in the flock (xyz, -1..1) and the bird's phase
vec3 centre( float t ) {
  float ph = aFlock.w * 6.2832;
  float R = 35.0 + 55.0 * fract( aFlock.w * 7.7 );
  float w = ( 4.0 + 2.5 * fract( aFlock.w * 3.3 ) ) / R * ( fract( aFlock.w * 5.1 ) < 0.5 ? 1.0 : -1.0 );
  return vec3( cos( t * w + ph ) * R, 5.0 * sin( t * 0.13 + ph * 3.0 ), sin( t * w + ph ) * R );
}
void main() {
  vCol = vec3( 0.0 );
  if ( fract( aFlock.w * 3.17 ) >= uShare ) {
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    return;
  }
  vec2 anchor = mod( aFlock.xz * ${BIRD_BOX}.0 - uCamMod.xz, ${BIRD_BOX}.0 ) - ${BIRD_BOX / 2}.0;
  vec3 c0 = centre( uTime );
  vec3 c1 = centre( uTime + 0.25 );
  vec3 fwd = normalize( c1 - c0 + vec3( 1e-5 ) );
  vec3 side;
  vec3 inward = vec3( -c0.x, 0.0, -c0.z ) / max( length( c0.xz ), 1.0 ) * 0.4;
  vec3 up = flyBank( fwd, inward, side );
  float ph = aBird.w * 6.2832;
  vec3 o = aBird.xyz * vec3( 9.0, 2.5, 9.0 )
    + vec3( sin( uTime * 0.7 + ph ), 0.5 * sin( uTime * 0.9 + ph * 1.7 ), cos( uTime * 0.6 + ph * 2.3 ) ) * 1.6;
  // Flapping in bursts, with glides between them.
  float flap = smoothstep( -0.2, 0.4, sin( uTime * 0.5 + ph * 3.0 ) );
  float beat = sin( uTime * 17.0 + ph );
  vec3 lp = position;
  lp.y += aWing * ( 0.34 * beat * flap + 0.1 * ( 1.0 - flap ) );
  lp.z += aWing * 0.05 * beat * flap;
  float edge = smoothstep( ${BIRD_BOX / 2}.0, ${(BIRD_BOX * 0.36).toFixed(1)}, length( anchor ) );
  // Not right up at the lens: a bird that close would be the size of a sail.
  vec3 centreW = vec3( uCam.x + anchor.x, uCam.y + 2.0 + aFlock.y * 22.0, uCam.z + anchor.y ) + c0 + o;
  float far = smoothstep( 18.0, 45.0, length( centreW - uCam ) );
  float size = uSize * edge * far * ( 0.9 + 0.2 * fract( aBird.w * 13.0 ) );
  vec3 wp = centreW
    + ( side * lp.x + up * lp.y + fwd * lp.z ) * size;
  vec4 mv = viewMatrix * vec4( wp, 1.0 );
  gl_Position = projectionMatrix * mv;
  float dark = step( 0.78, fract( aFlock.w * 9.7 ) );
  vec3 body = mix( vec3( 0.97, 0.96, 0.92 ), vec3( 0.2, 0.22, 0.3 ), dark );
  vec3 tip = mix( vec3( 0.28, 0.3, 0.38 ), vec3( 0.12, 0.13, 0.2 ), dark );
  vec3 col = mix( body, tip, smoothstep( 0.5, 1.0, aWing ) * 0.85 ) * mix( 0.62, 1.0, aShade );
  float d = -mv.z;
  vCol = mix( col, uFogCol, 1.0 - exp( -max( d, 0.0 ) * fogParams.x * 0.9 ) );
}
`;

// Butterflies over the verge, close to the ground.
const BFLY_BOX = 64;
const BFLY_VERTEX = /* glsl */`${FLY_COMMON}
attribute vec4 aSeed;   // where in the box (xz, 0..1), a height, its own draw
uniform float uGround;
vec3 flutter( float t, float ph ) {
  return vec3( sin( t * 0.6 + ph ) * 3.0 + sin( t * 1.7 + ph * 2.0 ) * 0.8,
    0.45 + 0.45 * sin( t * 0.9 + ph * 1.3 ) + 0.25 * sin( t * 3.1 + ph ),
    cos( t * 0.5 + ph * 1.5 ) * 3.0 + cos( t * 1.3 + ph * 3.1 ) * 0.8 );
}
void main() {
  vCol = vec3( 0.0 );
  if ( fract( aSeed.w * 3.17 ) >= uShare ) {
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    return;
  }
  vec2 anchor = mod( aSeed.xz * ${BFLY_BOX}.0 - uCamMod.xz, ${BFLY_BOX}.0 ) - ${BFLY_BOX / 2}.0;
  float ph = aSeed.w * 6.2832;
  vec3 f0 = flutter( uTime, ph );
  vec3 f1 = flutter( uTime + 0.1, ph );
  vec3 fwd = normalize( vec3( f1.x - f0.x, ( f1.y - f0.y ) * 0.4, f1.z - f0.z ) + vec3( 1e-5 ) );
  vec3 side;
  vec3 up = flyBank( fwd, vec3( 0.0 ), side );
  vec3 lp = position;
  // Wings opening and closing about the body, in a V.
  lp.y += aWing * 0.55 * sin( uTime * 15.0 + ph * 3.0 );
  float edge = 1.0 - smoothstep( ${(BFLY_BOX * 0.3).toFixed(1)}, ${(BFLY_BOX * 0.5).toFixed(1)}, length( anchor ) );
  float size = uSize * edge * ( 0.85 + 0.3 * fract( aSeed.w * 11.0 ) );
  vec3 wp = vec3( uCam.x + anchor.x + f0.x, uGround + 0.4 + aSeed.y * 1.8 + f0.y, uCam.z + anchor.y + f0.z )
    + ( side * lp.x + up * lp.y + fwd * lp.z ) * size;
  vec4 mv = viewMatrix * vec4( wp, 1.0 );
  gl_Position = projectionMatrix * mv;
  float pick = fract( aSeed.w * 5.3 );
  vec3 wing = pick < 0.3 ? vec3( 0.97, 0.97, 0.9 ) : pick < 0.6 ? vec3( 1.0, 0.82, 0.22 )
    : pick < 0.85 ? vec3( 0.5, 0.72, 1.0 ) : vec3( 1.0, 0.5, 0.16 );
  vec3 col = mix( vec3( 0.18, 0.14, 0.12 ), wing, smoothstep( 0.1, 0.5, aWing ) ) * mix( 0.7, 1.0, aShade );
  float d = -mv.z;
  vCol = mix( col, uFogCol, 1.0 - exp( -max( d, 0.0 ) * fogParams.x * 0.9 ) );
}
`;

const FLY_FRAGMENT = /* glsl */`
uniform float uStyleMark;
varying vec3 vCol;
void main() {
  // Marked a little lower than the car, as the walkers are (render/critters.js).
  gl_FragColor = vec4( vCol, mix( 1.0, 0.3, uStyleMark ) );
}
`;

class Flyers {
  constructor(scene, { geometry, vertex, count, size, box, seeds }) {
    this.count = count;
    this.box = box;
    const geo = geometry;
    for (const [name, data, n] of seeds) geo.setAttribute(name, new THREE.InstancedBufferAttribute(data, n));
    geo.instanceCount = count;
    this.uniforms = {
      uCam: { value: new THREE.Vector3() },
      uCamMod: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uShare: { value: 0 },
      uSize: { value: size },
      uGround: { value: 0 },
      uFogCol: { value: new THREE.Color() },
      uStyleMark: styleU.uStyleMark,
      fogParams: atmo.fogParams,
    };
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vertex,
      fragmentShader: FLY_FRAGMENT,
      side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.shown = 0;
  }

  // share: how much of the full number, 0..1; ground: the road's height.
  update(dt, camera, share, ground, fogColor, origin) {
    const u = this.uniforms;
    this.shown = share > 0.01 ? Math.round(share * this.count) : 0;
    this.mesh.visible = share > 0.01;
    if (!this.mesh.visible) return;
    u.uTime.value = (u.uTime.value + dt) % 7200;
    u.uShare.value = share;
    const c = camera.position;
    u.uCam.value.copy(c);
    const wrap = (v) => ((v % this.box) + this.box) % this.box;
    u.uCamMod.value.set(wrap(c.x + origin.x), 0, wrap(c.z + origin.z));
    u.uGround.value = ground;
    u.uFogCol.value.copy(fogColor);
  }
}

function makeBirds(scene) {
  const rand = mulberry32(0xb12d);
  const FLOCKS = 9;
  const PER = 7;
  const n = FLOCKS * PER;
  const flock = new Float32Array(n * 4);
  const bird = new Float32Array(n * 4);
  for (let f = 0; f < FLOCKS; f++) {
    const seed = [rand(), rand(), rand(), rand()];
    for (let k = 0; k < PER; k++) {
      const i = f * PER + k;
      flock.set(seed, i * 4);
      bird.set([rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1, rand()], i * 4);
    }
  }
  return new Flyers(scene, {
    geometry: birdGeometry(), vertex: BIRD_VERTEX, count: n, size: 3.4, box: BIRD_BOX,
    seeds: [['aFlock', flock, 4], ['aBird', bird, 4]],
  });
}

function makeButterflies(scene) {
  const rand = mulberry32(0xbf1e);
  const n = 40;
  const seed = new Float32Array(n * 4).map(rand);
  return new Flyers(scene, {
    geometry: butterflyGeometry(), vertex: BFLY_VERTEX, count: n, size: 0.45, box: BFLY_BOX,
    seeds: [['aSeed', seed, 4]],
  });
}

// --- the whole of it ---------------------------------------------------------

export class Critters {
  // env: road, groundAt(x, z), waterAt(x, z) (the liquid's surface, or
  // -Infinity), treesAt(x, z, near) (forest cover), seed.
  constructor(scene, env) {
    this.env = env;
    this.rand = mulberry32((env.seed || 0) ^ 0x51ca);
    this.time = 0;
    this.spawnClock = 0;
    this.material = critterMaterial();
    this.pools = {};
    this.dummy = new THREE.Object3D();
    this.dummy.rotation.order = 'YXZ';
    for (const id of KINDS) {
      const sp = SPECIES[id];
      const geo = sp.build();
      const mesh = new THREE.InstancedMesh(geo, this.material, sp.max);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(sp.max * 4), 4);
      anim.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAnim', anim);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.visible = false;
      scene.add(mesh);
      this.pools[id] = { id, sp, mesh, anim, walkers: [] };
    }
    this.birds = makeBirds(scene);
    this.butterflies = makeButterflies(scene);
    this.shown = 0;
    this.knocked = 0;        // animals a car has run into
    this._trunks = [];
    this._dq = new THREE.Quaternion();
  }

  // The floating origin has moved: so have the walkers' coordinates.
  shift(dx, dz) {
    for (const pool of Object.values(this.pools)) {
      for (const w of pool.walkers) {
        w.x -= dx;
        w.z -= dz;
      }
    }
  }

  // A car that runs into an animal throws it: off the front and to the
  // side it was on, the lighter the faster and the higher, turning over as it
  // goes; it bounces, comes to rest, and goes. The car feels it by the
  // animal's weight, and a heavy one at speed gives it a jolt.
  _hitCar(car, fx, fz) {
    if (car.speed < 1.2) return;
    const vwx = car.vx * fx - car.vy * fz;
    const vwz = car.vx * fz + car.vy * fx;
    for (const pool of Object.values(this.pools)) {
      const sp = pool.sp;
      for (const w of pool.walkers) {
        if (w.state === 'flung' || w.leaving) continue;
        const dx = w.x - car.x;
        const dz = w.z - car.z;
        if (dx * dx + dz * dz > 36) continue;
        const u = dx * fx + dz * fz;
        const v = -dx * fz + dz * fx;
        const r = sp.hitR * w.scale;
        if (Math.abs(u) > 2.3 + r || Math.abs(v) > 1.0 + r || Math.abs(w.y - car.y) > 2.2) continue;
        const speed = Math.hypot(vwx, vwz);
        const light = Math.max(0.55, Math.min(1.3, 1.25 - sp.mass / 700));
        const kick = (v >= 0 ? 1 : -1) * (2 + speed * 0.12);
        w.state = 'flung';
        w.vxw = vwx * 0.72 * light - fz * kick;
        w.vzw = vwz * 0.72 * light + fx * kick;
        w.vyw = Math.min(11, 3 + speed * 0.22) * light;
        w.spinAxis = new THREE.Vector3(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).normalize();
        w.spin = 8 + speed * 0.5;
        w.q = new THREE.Quaternion().setFromEuler(new THREE.Euler(w.pitch, w.yaw, 0, 'YXZ'));
        w.rest = 0;
        w.y += 0.25;
        w.stride = 1;
        this.knocked++;
        car.vx *= 1 - Math.min(0.3, (sp.mass / 1380) * 0.5 + 0.02);
        if (sp.mass > 200 && car.speed > 10) car.applyImpact((sp.mass / 1380) * car.speed * 0.6, v > 0);
      }
    }
  }

  // How many of kind id this world keeps about its road, for the style.
  _target(id, worldId, fauna, mobs) {
    const table = SPECIES[id].set === 'wood' ? WILD : FARM;
    const n = (table[worldId] || {})[id] || 0;
    return (SPECIES[id].set === 'wood' ? fauna : mobs) > 0.5 ? n : 0;
  }

  update(dt, ctx) {
    const { camera, car, sCar, style, at, origin } = ctx;
    this.time += dt;
    timeUniform.value = this.time;
    const fauna = style.fauna;
    const mobs = style.mobs;
    const main = at.a < 0 ? 0 : (at.t < 0.5 ? at.a : at.b);
    const worldId = WORLDS[main].id;

    // The ones that fly.
    const A = SKY[WORLDS[at.a < 0 ? 0 : at.a].id] || [0, 0];
    const B = SKY[WORLDS[at.b < 0 ? 0 : at.b].id] || [0, 0];
    const t = at.a === at.b ? 0 : at.t;
    const f = smooth(0.02, 0.9, fauna);
    const fog = ctx.fogColor;
    this.birds.update(dt, camera, f * (A[0] * (1 - t) + B[0] * t), 0, fog, origin);
    this.butterflies.update(dt, camera, f * (A[1] * (1 - t) + B[1] * t), ctx.ground, fog, origin);

    // The ones that walk: found a little ahead of the car and taken away
    // behind it.
    this.spawnClock -= dt;
    if (this.spawnClock <= 0) {
      this.spawnClock = 0.25;
      this._spawn(ctx, worldId);
    }
    const fx = Math.cos(car.yaw);
    const fz = Math.sin(car.yaw);
    this._hitCar(car, fx, fz);
    let alive = 0;
    for (const id of KINDS) {
      const pool = this.pools[id];
      const setValue = pool.sp.set === 'wood' ? fauna : mobs;
      const present = smooth(0.02, 0.9, setValue);
      pool.mesh.visible = pool.walkers.length > 0;
      for (let i = pool.walkers.length - 1; i >= 0; i--) {
        const w = pool.walkers[i];
        this._step(w, pool.sp, dt, car, fx, fz, present);
        if (w.fade <= 0 && w.leaving) pool.walkers.splice(i, 1);
      }
      pool.mesh.count = pool.walkers.length;
      alive += pool.walkers.length;
      for (let i = 0; i < pool.walkers.length; i++) this._write(pool, i, pool.walkers[i], present);
      if (pool.walkers.length) {
        pool.mesh.instanceMatrix.needsUpdate = true;
        pool.anim.needsUpdate = true;
      }
    }
    this.shown = alive;
  }

  // One more animal, if the world wants one: somewhere off the road ahead,
  // on ground a deer could stand on.
  _spawn(ctx, worldId) {
    const { car, sCar, style } = ctx;
    const env = this.env;
    const order = KINDS.filter((id) => {
      const pool = this.pools[id];
      return pool.walkers.filter((w) => !w.leaving).length < Math.min(pool.sp.max, this._target(id, worldId, style.fauna, style.mobs));
    });
    if (!order.length) return;
    const id = order[Math.floor(this.rand() * order.length)];
    const pool = this.pools[id];
    for (let attempt = 0; attempt < 8; attempt++) {
      const s = sCar + 70 + this.rand() * 150;
      const p = env.road.at(s);
      if (!p || p.kind !== GROUND) continue;
      const q = env.road.at(s + 25);
      const o = env.road.at(s - 25);
      if (!q || !o || q.kind !== GROUND || o.kind !== GROUND) continue;
      const side = this.rand() < 0.5 ? -1 : 1;
      // On the verge and the meadow beside it, where the forest has not come
      // up to the road.
      const lat = HALF_FLAT + 1.5 + this.rand() * 16;
      const nx = -Math.sin(p.theta) * side;
      const nz = Math.cos(p.theta) * side;
      const x = p.x + nx * lat;
      const z = p.z + nz * lat;
      const y = env.groundAt(x, z);
      if (!(y > env.waterAt(x, z) + 0.4)) continue;
      // Level enough to stand on, and out of the trees.
      if (Math.abs(env.groundAt(x + 2, z) - y) > 0.7 || Math.abs(env.groundAt(x, z + 2) - y) > 0.7) continue;
      if (env.treesAt(x, z, lat) > 0.12) continue;
      if (env.trunks(x, z, 1.8, this._trunks).length) continue;
      let crowded = false;
      for (const other of Object.values(this.pools)) {
        for (const w of other.walkers) if (Math.hypot(w.x - x, w.z - z) < 7) crowded = true;
      }
      if (crowded) continue;
      const sp = pool.sp;
      const yaw = this.rand() < 0.6 ? Math.atan2(-nx, -nz) + (this.rand() - 0.5) * 1.2 : this.rand() * Math.PI * 2;
      pool.walkers.push({
        x, z, y, yaw, away: [nx, nz], aim: yaw,
        scale: sp.size[0] + (sp.size[1] - sp.size[0]) * this.rand(),
        state: 'idle', timer: 1 + this.rand() * 4, speed: 0, gait: this.rand() * 6.28, stride: 0,
        bow: 0, bowTo: 0, hop: 0, pitch: 0, groundClock: 0, fade: 0, leaving: false,
        draw: this.rand(), ground: y,
      });
      return;
    }
  }

  _step(w, sp, dt, car, fx, fz, present) {
    const dx = w.x - car.x;
    const dz = w.z - car.z;
    const dist = Math.hypot(dx, dz);
    const ahead = dx * fx + dz * fz;
    const env = this.env;
    // Away behind the car, too far, or the style gone: leave.
    if (!w.leaving && w.state !== 'flung' && (ahead < -60 || dist > 330 || present <= 0.02)) w.leaving = true;
    if (w.state === 'flung' && present <= 0.02) w.leaving = true;
    w.fade += ((w.leaving ? 0 : 1) - w.fade) * Math.min(1, dt * (w.leaving ? 2 : 1.2));
    if (w.leaving && w.fade < 0.02) w.fade = 0;

    // Thrown by a car: through the air, bouncing, turning over, at rest.
    if (w.state === 'flung') {
      w.vyw -= 9.81 * dt;
      // The air takes some of it back.
      const drag = Math.max(0, 1 - 0.45 * dt);
      w.vxw *= drag;
      w.vzw *= drag;
      w.x += w.vxw * dt;
      w.z += w.vzw * dt;
      w.y += w.vyw * dt;
      w.gait += dt * 22;
      this._dq.setFromAxisAngle(w.spinAxis, w.spin * dt);
      w.q.premultiply(this._dq).normalize();
      const g = env.groundAt(w.x, w.z);
      if (w.y <= g) {
        w.y = g;
        if (w.vyw < -2) {
          w.vyw *= -0.38;
          w.vxw *= 0.72;
          w.vzw *= 0.72;
          w.spin *= 0.65;
        } else {
          w.vyw = 0;
          const f = Math.max(0, 1 - dt * 3.5);
          w.vxw *= f;
          w.vzw *= f;
          w.spin *= f;
        }
      }
      if (w.y <= g + 0.05 && Math.hypot(w.vxw, w.vzw) < 0.6) {
        w.rest += dt;
        if (w.rest > 1.6) w.leaving = true;
      }
      w.hop = 0;
      return;
    }

    if (w.state === 'flee') {
      w.timer -= dt;
      w.speed += (sp.speed - w.speed) * Math.min(1, dt * 4);
      if (w.timer <= 0) w.leaving = true;
    } else {
      if (sp.flee > 0 && dist < sp.flee && ahead > -8) {
        w.state = 'flee';
        w.timer = 5;
        // Away from the road, with a little to one side.
        const side = (w.draw - 0.5) * 0.7;
        const ax = w.away[0] * Math.cos(side) - w.away[1] * Math.sin(side);
        const az = w.away[0] * Math.sin(side) + w.away[1] * Math.cos(side);
        w.yaw = Math.atan2(ax, az);
        w.aim = w.yaw;
      }
      w.timer -= dt;
      if (w.state === 'idle') {
        w.speed += (0 - w.speed) * Math.min(1, dt * 5);
        if (w.timer <= 0) {
          // Now and then a farm animal wanders, an animal that grazes bows its head.
          if (!sp.sit && sp.speed > 0 && sp.flee === 0 && this.rand() < 0.55) {
            w.state = 'walk';
            w.timer = 2 + this.rand() * 3;
            w.yaw += (this.rand() - 0.5) * 2.4;
            w.aim = w.yaw;
          } else {
            w.timer = 2 + this.rand() * 5;
            w.bowTo = !sp.sit && this.rand() < 0.5 ? 1 : 0;
          }
        }
      } else if (w.state === 'walk') {
        w.speed += (sp.speed - w.speed) * Math.min(1, dt * 3);
        if (w.timer <= 0) {
          w.state = 'idle';
          w.timer = 2 + this.rand() * 6;
        }
      }
    }
    if (w.state === 'flee') w.bowTo = 0;
    w.bow += (w.bowTo - w.bow) * Math.min(1, dt * 3);
    if (w.speed > 0.02) {
      let hx = Math.sin(w.yaw);
      let hz = Math.cos(w.yaw);
      // Round the trunks: one ahead and in the way turns the animal from it,
      // the nearer the harder; clear of them it comes back to where it was
      // going.
      const buf = this._trunks;
      env.trunks(w.x, w.z, 5, buf);
      const r0 = sp.hitR * w.scale * 0.8;
      let turn = 0;
      for (let k = 0; k < buf.length; k += 3) {
        const tx = buf[k] - w.x;
        const tz = buf[k + 1] - w.z;
        const along = tx * hx + tz * hz;
        if (along < -0.3 || along > 5) continue;
        const lateral = tx * hz - tz * hx;
        const gap = Math.abs(lateral) - (buf[k + 2] + r0 + 0.5);
        if (gap > 1.2) continue;
        const sgn = Math.abs(lateral) < 0.05 ? (w.draw < 0.5 ? -1 : 1) : Math.sign(lateral);
        turn -= sgn * (1 - along / 5) * (gap < 0 ? 1.4 : 0.8);
      }
      if (turn) w.yaw += Math.max(-1, Math.min(1, turn)) * 3.6 * dt;
      else if (w.aim !== undefined) w.yaw += Math.max(-1, Math.min(1, Math.atan2(Math.sin(w.aim - w.yaw), Math.cos(w.aim - w.yaw)))) * 1.4 * dt;
      hx = Math.sin(w.yaw);
      hz = Math.cos(w.yaw);
      w.x += hx * w.speed * dt;
      w.z += hz * w.speed * dt;
      w.gait += dt * w.speed * sp.stride;
      // Never in one.
      for (let k = 0; k < buf.length; k += 3) {
        const px = w.x - buf[k];
        const pz = w.z - buf[k + 1];
        const d = Math.hypot(px, pz) || 1e-3;
        const min = buf[k + 2] + r0;
        if (d < min) {
          w.x += (px / d) * (min - d);
          w.z += (pz / d) * (min - d);
        }
      }
    }
    w.stride += ((sp.speed > 0 ? Math.min(1, w.speed / Math.max(sp.speed, 0.1)) : 0) - w.stride) * Math.min(1, dt * 8);
    // On the ground, and level with it: while it moves every frame, at rest now and then.
    w.groundClock -= dt;
    if (w.speed > 0.1 || w.groundClock <= 0) {
      w.groundClock = 0.6;
      const hx = Math.sin(w.yaw);
      const hz = Math.cos(w.yaw);
      const yF = env.groundAt(w.x + hx * 0.5, w.z + hz * 0.5);
      const yB = env.groundAt(w.x - hx * 0.5, w.z - hz * 0.5);
      w.ground = (yF + yB) / 2;
      w.pitch = -Math.atan(Math.max(-0.6, Math.min(0.6, yF - yB)));
    }
    w.y = w.ground;
    // A rabbit bounds.
    w.hop = sp.hop ? Math.abs(Math.sin(w.gait * 0.5)) * sp.hop * Math.min(1, w.speed / 2) : 0;
  }

  _write(pool, i, w, present) {
    const d = this.dummy;
    const sp = pool.sp;
    const grow = w.fade * present;
    d.position.set(w.x, w.y + w.hop, w.z);
    if (w.state === 'flung') {
      d.quaternion.copy(w.q);
    } else {
      const lean = sp.hop ? -0.35 * Math.min(1, w.speed / 2) * Math.cos(w.gait * 0.5) : 0;
      d.rotation.set(w.pitch + lean, w.yaw, 0);
    }
    d.scale.setScalar(Math.max(1e-3, w.scale * grow));
    d.updateMatrix();
    pool.mesh.setMatrixAt(i, d.matrix);
    pool.anim.setXYZW(i, w.gait, w.stride, w.bow, w.draw);
  }
}
