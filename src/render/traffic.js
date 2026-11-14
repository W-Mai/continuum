// Traffic on the road.
//
// Cars are driven in arc-length space along their lane, each with the
// Intelligent Driver Model: it accelerates toward a speed the bends ahead
// allow and brakes for whatever is in front of it in its lane, the player
// included. Nothing drives through anything. Oncoming cars appear far ahead
// along the road (several kilometres of arc, which on a mountain is still out
// of sight round the shoulders) and are retired once they are well behind.
//
// What drives is the world's: each world has its own roster (a tractor on the
// hills' lanes, a snow plough in the Alps, taxis and buses in the city, jeeps
// and tankers in the desert, mine trucks underground, hover pods over the
// cloud, rovers on the moon road, rusted wrecks in the Upside Down), and each
// style draws them its own way (round and low-poly, rounder and softer for
// the painted style, boxes for the block one). A vehicle is a few dozen
// flat-shaded panels built here, with a kind a face (paint, glass, tyre,
// lamps...) so that one instanced mesh per type paints each car its own
// colour and lights its lamps in the dark.

import * as THREE from 'three';
import { LANE } from '../world/road.js';
import { WORLDS } from '../world/worlds.js';

const COUNT = 14;
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

// --- panels ------------------------------------------------------------------
//
// Kinds of face: 0 the paint (the car's own colour), 1 glass, 2 tyre, 3 a
// headlamp, 4 a tail lamp, 5 chrome and hubs, 6 an amber lamp or glow, 7 dark
// trim in the paint's hue, 8 a cargo box, 9 a dead lamp.

class Panels {
  constructor() {
    this.p = [];
    this.n = [];
    this.k = [];
  }

  tri(a, b, c, kind) {
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
      this.k.push(kind);
    }
  }

  // A quad that faces away from `ctr`.
  quad(a, b, c, d, kind, ctr) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const mx = (a[0] + b[0] + c[0] + d[0]) / 4 - ctr[0];
    const my = (a[1] + b[1] + c[1] + d[1]) / 4 - ctr[1];
    const mz = (a[2] + b[2] + c[2] + d[2]) / 4 - ctr[2];
    if (nx * mx + ny * my + nz * mz >= 0) {
      this.tri(a, b, c, kind);
      this.tri(a, c, d, kind);
    } else {
      this.tri(a, d, c, kind);
      this.tri(a, c, b, kind);
    }
  }

  // A fan over a ring of points, facing along `face` ([x, y, z]).
  cap(pts, kind, face) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const q of pts) {
      cx += q[0];
      cy += q[1];
      cz += q[2];
    }
    const c = [cx / pts.length, cy / pts.length, cz / pts.length];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      // The way round that faces the way asked.
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];
      const d = (uy * vz - uz * vy) * face[0] + (uz * vx - ux * vz) * face[1] + (ux * vy - uy * vx) * face[2];
      if (d >= 0) this.tri(a, b, c, kind);
      else this.tri(a, c, b, kind);
    }
  }

  box(cx, y0, cz, sx, sy, sz, kind) {
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const y1 = y0 + sy;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    const c = [cx, y0 + sy / 2, cz];
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], kind, c);
    this.quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], kind, c);
    this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], kind, c);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], kind, c);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], kind, c);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], kind, c);
  }

  // A wheel: an axle along z through (cx, cy, cz), width w. Boxes in the
  // block style.
  wheel(cx, cy, cz, r, w, kind, round) {
    if (!round) {
      this.box(cx, cy - r * 0.85, cz, r * 1.7, r * 1.7, w, kind);
      return;
    }
    const sides = 10;
    const a = [];
    const b = [];
    for (let i = 0; i < sides; i++) {
      const t = (i / sides) * Math.PI * 2;
      a.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r, cz - w / 2]);
      b.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r, cz + w / 2]);
    }
    const ctr = [cx, cy, cz];
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.quad(a[i], a[j], b[j], b[i], kind, ctr);
    }
    this.cap(a, kind, [0, 0, -1]);
    this.cap(b, kind, [0, 0, 1]);
  }

  done() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.k, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// A rounded rectangle seen from above, as points (x, z).
function ringPts(L, W, r, n) {
  const hx = L / 2;
  const hz = W / 2;
  const rr = Math.min(r, hx * 0.98, hz * 0.98);
  if (rr < 1e-3 || n < 1) return [[hx, hz], [-hx, hz], [-hx, -hz], [hx, -hz]];
  const pts = [];
  const corners = [[hx - rr, hz - rr, 0], [-hx + rr, hz - rr, Math.PI / 2], [-hx + rr, -hz + rr, Math.PI], [hx - rr, -hz + rr, Math.PI * 1.5]];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]);
    }
  }
  return pts;
}

// A body from rings [y, cx, L, W, r] bottom to top: the sides between them,
// and caps. mode.round scales the corners, mode.n their segments.
function rings(m, list, kind, mode, caps = [true, true]) {
  const P = list.map(([y, cx, L, W, r]) => ringPts(L, W, r * mode.round, mode.n).map(([x, z]) => [x + cx, y, z]));
  const ymid = (list[0][0] + list[list.length - 1][0]) / 2;
  const xmid = list.reduce((s, q) => s + q[1], 0) / list.length;
  for (let k = 0; k < P.length - 1; k++) {
    for (let i = 0; i < P[k].length; i++) {
      const j = (i + 1) % P[k].length;
      m.quad(P[k][i], P[k][j], P[k + 1][j], P[k + 1][i], kind, [xmid, ymid, 0]);
    }
  }
  if (caps[1]) m.cap(P[P.length - 1], kind, [0, 1, 0]);
  if (caps[0]) m.cap(P[0], kind, [0, -1, 0]);
}

// --- the vehicles ------------------------------------------------------------
//
// In metres, nose toward +x, standing on y = 0. body: rings for the paint;
// cabin: rings for the glass over it, with a roof slab; boxes: [cx, y0, cz,
// sx, sy, sz, kind] (mirrored across the middle where `mirror`); wheels:
// [x, radius, width, z] (a pair, one each side).

function lamps(front, rear, y, hw, ty = y) {
  return [
    { at: [front, y, hw * 0.62, 0.07, 0.12, hw * 0.36, 3], mirror: true },
    { at: [rear, ty, hw * 0.66, 0.06, 0.12, hw * 0.4, 4], mirror: true },
  ];
}

const TYPES = {
  sedan: {
    L: 4.6, W: 1.82, speed: 1,
    body: [[0.30, 0, 4.4, 1.70, 0.30], [0.55, 0, 4.6, 1.82, 0.42], [0.88, 0, 4.45, 1.72, 0.50]],
    cabin: [[0.88, -0.15, 2.60, 1.58, 0.35], [1.34, -0.28, 1.70, 1.34, 0.40]],
    roof: [1.33, -0.28, 1.74, 1.38, 0.40, 0.08],
    wheels: [[1.42, 0.33, 0.24, 0.8], [-1.42, 0.33, 0.24, 0.8]],
    boxes: [...lamps(2.28, -2.3, 0.62, 0.91), { at: [2.26, 0.34, 0, 0.10, 0.18, 1.5, 7] }, { at: [-2.26, 0.34, 0, 0.10, 0.18, 1.5, 7] }],
    colours: [0xdfe3e6, 0x2d3338, 0x7d8a96, 0x9a2a2a, 0x24456b, 0xc8c2b4, 0x3d5a45, 0x111418],
  },
  hatch: {
    L: 3.9, W: 1.72, speed: 1,
    body: [[0.30, 0, 3.7, 1.60, 0.28], [0.55, 0, 3.9, 1.72, 0.40], [0.85, 0, 3.75, 1.62, 0.45]],
    cabin: [[0.85, -0.2, 2.7, 1.5, 0.3], [1.38, -0.34, 1.9, 1.26, 0.35]],
    roof: [1.37, -0.34, 1.95, 1.3, 0.35, 0.08],
    wheels: [[1.2, 0.31, 0.22, 0.76], [-1.2, 0.31, 0.22, 0.76]],
    boxes: [...lamps(1.93, -1.95, 0.6, 0.86), { at: [1.92, 0.32, 0, 0.10, 0.17, 1.4, 7] }, { at: [-1.92, 0.32, 0, 0.10, 0.17, 1.4, 7] }],
    colours: [0xe8c33a, 0xc8472f, 0x3a6ea5, 0xdfe3e6, 0x6a9a58, 0xe08a4a, 0x8a8f96],
  },
  suv: {
    L: 4.7, W: 1.95, speed: 1,
    body: [[0.42, 0, 4.5, 1.85, 0.3], [0.78, 0, 4.7, 1.95, 0.4], [1.12, 0, 4.55, 1.85, 0.45]],
    cabin: [[1.1, -0.2, 3.1, 1.75, 0.3], [1.72, -0.34, 2.5, 1.55, 0.35]],
    roof: [1.71, -0.34, 2.55, 1.6, 0.35, 0.09],
    wheels: [[1.45, 0.4, 0.28, 0.84], [-1.4, 0.4, 0.28, 0.84]],
    boxes: [...lamps(2.33, -2.34, 0.82, 0.98), { at: [2.3, 0.46, 0, 0.12, 0.22, 1.6, 7] }, { at: [-2.3, 0.46, 0, 0.12, 0.22, 1.6, 7] },
      { at: [-0.34, 1.8, 0.62, 2.2, 0.05, 0.05, 7], mirror: true }],
    colours: [0x2f3a33, 0x1c2024, 0xb8bcc0, 0x6b5a45, 0x8a3a2a, 0x39485a, 0xdfe3e6],
  },
  pickup: {
    L: 5.3, W: 1.95, speed: 0.95,
    body: [[0.42, 0.65, 3.5, 1.85, 0.3], [0.8, 0.65, 3.6, 1.95, 0.4], [1.1, 0.65, 3.4, 1.85, 0.45]],
    cabin: [[1.1, 0.35, 1.9, 1.7, 0.3], [1.66, 0.22, 1.5, 1.45, 0.35]],
    roof: [1.65, 0.22, 1.55, 1.5, 0.35, 0.08],
    wheels: [[1.65, 0.4, 0.28, 0.84], [-1.5, 0.4, 0.28, 0.84]],
    boxes: [
      ...lamps(2.46, -2.66, 0.84, 0.98, 0.9),
      { at: [-1.92, 0.58, 0, 1.55, 0.07, 1.8, 7] },
      { at: [-1.92, 0.62, 0.9, 1.55, 0.5, 0.08, 0], mirror: true },
      { at: [-2.62, 0.62, 0, 0.08, 0.5, 1.8, 0] },
      { at: [-1.16, 0.62, 0, 0.08, 0.72, 1.8, 0] },
      { at: [2.5, 0.46, 0, 0.12, 0.22, 1.7, 7] },
    ],
    colours: [0xc0452f, 0x3b5f8a, 0xdfe3e6, 0x59634a, 0x2a2d31, 0xd4a537, 0x8a7a5a],
  },
  van: {
    L: 5.2, W: 1.98, speed: 0.9,
    body: [[0.38, 0, 5.0, 1.85, 0.3], [0.72, 0, 5.2, 1.98, 0.35], [1.2, 0, 5.15, 1.96, 0.4], [2.1, 0, 5.0, 1.86, 0.5]],
    cabin: [],
    roof: [2.09, 0, 5.0, 1.86, 0.5, 0.06],
    wheels: [[1.65, 0.36, 0.26, 0.84], [-1.5, 0.36, 0.26, 0.84]],
    boxes: [
      ...lamps(2.58, -2.6, 0.82, 0.99),
      { at: [2.6, 1.3, 0, 0.04, 0.72, 1.72, 1] },
      { at: [1.55, 1.3, 0.99, 1.2, 0.62, 0.02, 1], mirror: true },
      { at: [2.58, 0.4, 0, 0.12, 0.22, 1.7, 7] }, { at: [-2.58, 0.4, 0, 0.12, 0.22, 1.7, 7] },
    ],
    colours: [0xdfe3e6, 0xdfe3e6, 0x3a4a6a, 0xb8bcc0, 0xc8472f, 0x4a5a40],
  },
  bus: {
    L: 10.8, W: 2.5, speed: 0.8,
    body: [[0.5, 0, 10.4, 2.4, 0.3], [1.0, 0, 10.8, 2.5, 0.35], [3.0, 0, 10.7, 2.45, 0.5]],
    cabin: [],
    roof: [2.98, 0, 10.7, 2.45, 0.5, 0.08],
    wheels: [[3.6, 0.5, 0.34, 1.05], [-3.3, 0.5, 0.34, 1.05]],
    boxes: [
      ...lamps(5.4, -5.4, 0.85, 1.25),
      { at: [0, 1.5, 1.26, 9.8, 0.95, 0.03, 1], mirror: true },
      { at: [5.4, 1.45, 0, 0.04, 1.3, 2.2, 1] },
      { at: [5.4, 0.55, 0, 0.12, 0.3, 2.2, 7] }, { at: [-5.4, 0.55, 0, 0.12, 0.3, 2.2, 7] },
    ],
    colours: [0xe8e4d8, 0x2f6a8a, 0xc8472f, 0x4a8a5a, 0xd4a537],
  },
  truck: {
    L: 9.2, W: 2.5, speed: 0.8,
    body: [[0.9, 3.2, 2.3, 2.3, 0.3], [1.5, 3.2, 2.4, 2.4, 0.3], [2.5, 3.25, 2.1, 2.3, 0.35]],
    cabin: [],
    roof: [2.5, 3.25, 2.1, 2.3, 0.35, 0.08],
    wheels: [[3.3, 0.52, 0.36, 1.0], [-1.7, 0.52, 0.36, 1.0], [-3.1, 0.52, 0.36, 1.0]],
    boxes: [
      ...lamps(4.38, -4.55, 1.0, 1.25),
      { at: [4.38, 1.5, 0, 0.04, 0.8, 2.15, 1] },
      { at: [3.0, 1.6, 1.16, 1.0, 0.7, 0.02, 1], mirror: true },
      { at: [-1.0, 0.85, 0, 6.4, 0.2, 2.2, 2] },
      { at: [-1.2, 1.05, 0, 6.6, 2.45, 2.46, 8] },
    ],
    colours: [0x2a5a8a, 0xc8472f, 0xd4a537, 0x4a6a3a, 0xdfe3e6, 0x5a5f66],
  },
  sports: {
    L: 4.4, W: 1.9, speed: 1.2,
    body: [[0.22, 0, 4.2, 1.8, 0.3], [0.42, 0, 4.4, 1.9, 0.45], [0.66, 0, 4.2, 1.78, 0.5]],
    cabin: [[0.66, -0.35, 1.9, 1.5, 0.4], [0.98, -0.5, 1.3, 1.2, 0.45]],
    roof: [0.97, -0.5, 1.34, 1.24, 0.45, 0.06],
    wheels: [[1.32, 0.33, 0.28, 0.82], [-1.32, 0.33, 0.28, 0.82]],
    boxes: [...lamps(2.18, -2.2, 0.5, 0.95, 0.56), { at: [2.15, 0.26, 0, 0.12, 0.14, 1.6, 7] },
      { at: [-2.1, 0.92, 0, 0.3, 0.05, 1.7, 7] }, { at: [-2.05, 0.7, 0.8, 0.12, 0.24, 0.05, 7], mirror: true }],
    colours: [0xc8302a, 0xe8c33a, 0x24456b, 0xdfe3e6, 0x111418, 0x6a9a58, 0xe08a4a],
  },
  jeep: {
    L: 3.9, W: 1.82, speed: 1,
    body: [[0.45, 0, 3.7, 1.7, 0.1], [0.9, 0, 3.9, 1.82, 0.14], [1.15, 0, 3.8, 1.74, 0.18]],
    cabin: [[1.15, -0.3, 2.1, 1.66, 0.12], [1.78, -0.34, 1.95, 1.6, 0.12]],
    roof: [1.77, -0.34, 2.0, 1.64, 0.12, 0.07],
    wheels: [[1.28, 0.43, 0.3, 0.82], [-1.25, 0.43, 0.3, 0.82]],
    boxes: [...lamps(1.93, -1.95, 0.9, 0.9), { at: [1.98, 0.5, 0, 0.14, 0.2, 1.7, 7] }, { at: [-2.05, 0.9, 0, 0.3, 0.7, 0.7, 2] }],
    colours: [0x8a7a4a, 0x5a6a3a, 0xc8a46a, 0xc8472f, 0xdfe3e6, 0x6b5a45],
  },
  tractor: {
    L: 4.2, W: 2.1, speed: 0.42,
    body: [[0.75, 1.15, 2.2, 0.95, 0.15], [1.4, 1.15, 2.1, 0.9, 0.15]],
    cabin: [[0.95, -0.55, 1.5, 1.4, 0.1], [2.25, -0.55, 1.5, 1.4, 0.1]],
    roof: [2.25, -0.55, 1.7, 1.6, 0.1, 0.09],
    wheels: [[-0.9, 0.82, 0.5, 0.98], [1.7, 0.45, 0.28, 0.72]],
    boxes: [{ at: [2.25, 1.0, 0.45, 0.07, 0.14, 0.2, 3], mirror: true }, { at: [-1.5, 1.1, 0.5, 0.06, 0.12, 0.2, 4], mirror: true },
      { at: [1.6, 1.4, 0.2, 0.08, 0.8, 0.08, 5] }],
    colours: [0x2f7a3a, 0xc8472f, 0x2a5a8a, 0xd4a537],
  },
  pod: {
    L: 3.8, W: 1.6, speed: 1.05, hover: 0.45,
    body: [[0.3, 0, 3.2, 1.2, 0.6], [0.7, 0, 3.8, 1.6, 0.8], [1.05, 0, 3.4, 1.4, 0.7]],
    cabin: [[1.0, -0.1, 2.3, 1.2, 0.6], [1.5, -0.2, 1.3, 0.8, 0.4]],
    roof: [1.49, -0.2, 1.34, 0.84, 0.4, 0.05],
    wheels: [],
    boxes: [{ at: [0, 0.18, 0, 2.8, 0.06, 1.0, 6] }, { at: [1.86, 0.7, 0.5, 0.05, 0.1, 0.3, 3], mirror: true }, { at: [-1.86, 0.7, 0.45, 0.05, 0.1, 0.3, 4], mirror: true }],
    colours: [0xf2efe6, 0xe9e2d0, 0xd8e4ee, 0xf0d9b8, 0xdfe3e6],
  },
  rover: {
    L: 3.8, W: 2.0, speed: 0.85,
    body: [[0.7, 0, 3.4, 1.9, 0.15], [1.2, 0, 3.4, 1.9, 0.15], [1.7, 0, 3.2, 1.8, 0.2]],
    cabin: [],
    roof: [1.7, 0, 3.2, 1.8, 0.2, 0.06],
    wheels: [[1.35, 0.46, 0.34, 1.0], [0, 0.46, 0.34, 1.0], [-1.35, 0.46, 0.34, 1.0]],
    boxes: [
      { at: [1.7, 1.2, 0, 0.05, 0.4, 1.4, 1] },
      { at: [1.72, 0.8, 0.6, 0.06, 0.1, 0.3, 3], mirror: true },
      { at: [-1.6, 0.8, 0.6, 0.06, 0.1, 0.3, 4], mirror: true },
      { at: [-0.4, 1.76, 0, 2.2, 0.05, 1.6, 1] },
      { at: [-1.1, 1.76, 0.5, 0.06, 1.2, 0.06, 5] }, { at: [-1.1, 2.9, 0.5, 0.7, 0.05, 0.7, 5] },
    ],
    colours: [0xeae6dc, 0xe6c88a, 0xd8dee6],
  },
};

// Variants that are the same body in other clothes.
const VARIANTS = {
  taxi: { of: 'sedan', colours: [0xe8b82a], extra: [{ at: [-0.3, 1.4, 0, 0.5, 0.14, 0.26, 6] }] },
  plough: { of: 'truck', colours: [0xe8741f], extra: [{ at: [4.9, 0.4, 0, 0.35, 1.0, 3.0, 6] }] },
  camper: { of: 'van', colours: [0xe9e2d0, 0xdfe3e6, 0x6a9a58], extra: [{ at: [-0.1, 2.15, 0, 3.6, 0.5, 1.7, 0] }] },
  dump: { of: 'truck', colours: [0xd4a537, 0xe8741f], extra: [{ at: [-1.2, 2.0, 0, 6.6, 0.1, 2.46, 7] }] },
  buggy: { of: 'jeep', colours: [0x3a1a14, 0x2a2d31, 0x5a2a1a], extra: [{ at: [0, 0.3, 0, 2.6, 0.06, 1.2, 6] }] },
  wreckSedan: { of: 'sedan', colours: [0x4a3a2c, 0x3a3226, 0x514a3c, 0x2a2622], wreck: true },
  wreckVan: { of: 'van', colours: [0x4a3a2c, 0x3a3226, 0x2a2622], wreck: true },
  wreckBus: { of: 'bus', colours: [0x3a3226, 0x4a3a2c], wreck: true },
};

// What drives where, and how many of each in ten.
const ROSTER = {
  alpine: [['suv', 3], ['sedan', 2], ['van', 1], ['truck', 1], ['plough', 1]],
  hills: [['hatch', 3], ['sedan', 3], ['pickup', 2], ['tractor', 1], ['van', 1]],
  river: [['sedan', 2], ['hatch', 2], ['van', 2], ['truck', 1], ['camper', 1]],
  coast: [['camper', 2], ['sports', 2], ['hatch', 2], ['suv', 1], ['bus', 1]],
  desert: [['jeep', 3], ['pickup', 3], ['truck', 2], ['suv', 1]],
  city: [['taxi', 4], ['sedan', 3], ['bus', 2], ['van', 2], ['sports', 1]],
  cavern: [['dump', 2], ['jeep', 3], ['van', 1]],
  inferno: [['buggy', 3], ['dump', 2]],
  abyss: [['pod', 4], ['rover', 1]],
  heaven: [['pod', 4], ['sports', 1]],
  space: [['rover', 3], ['pod', 2]],
  upside: [['wreckSedan', 3], ['wreckVan', 2], ['wreckBus', 1]],
};

function spec(name) {
  const v = VARIANTS[name];
  if (!v) return { name, ...TYPES[name] };
  const base = TYPES[v.of];
  return { name, ...base, boxes: [...base.boxes, ...(v.extra || [])], colours: v.colours, wreck: !!v.wreck };
}

// How a style draws them: the corners' roundness and segments, and whether
// the wheels are round.
const MODES = {
  round: { round: 1, n: 2, wheels: true },
  soft: { round: 1.7, n: 3, wheels: true },
  block: { round: 0, n: 0, wheels: false },
};

function buildVehicle(sp, mode) {
  const m = new Panels();
  rings(m, sp.body, 0, mode);
  if (sp.cabin.length) rings(m, sp.cabin, 1, mode, [false, true]);
  if (sp.roof) {
    const [y, cx, L, W, r, t] = sp.roof;
    rings(m, [[y, cx, L, W, r], [y + t, cx, L - 0.06, W - 0.06, r]], 0, mode);
  }
  for (const [x, r, w, z] of sp.wheels) {
    for (const side of [-1, 1]) {
      m.wheel(x, r, side * z, r, w, 2, mode.wheels);
      m.wheel(x, r, side * (z + w / 2 + 0.005), r * 0.55, 0.02, 5, mode.wheels);
    }
  }
  for (const { at, mirror } of sp.boxes) {
    const [cx, y0, cz, sx, sy, sz, kind] = at;
    // A wrecked car's lamps are dead.
    const k = sp.wreck && (kind === 3 || kind === 4) ? 9 : kind;
    m.box(cx, y0, cz, sx, sy, sz, k);
    if (mirror) m.box(cx, y0, -cz, sx, sy, sz, k);
  }
  return m.done();
}

// --- the material ------------------------------------------------------------

const lampsU = { value: 0 };

export function makeTrafficMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.45 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCarLamps = lampsU;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aKind;
varying float vKind;
varying vec3 vPaint;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vKind = aKind;
#ifdef USE_INSTANCING_COLOR
vPaint = instanceColor;
#else
vPaint = vec3( 0.5 );
#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uCarLamps;
varying float vKind;
varying vec3 vPaint;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float k = vKind;
  vec3 c = vPaint;
  if ( k > 0.5 ) c = vec3( 0.035, 0.045, 0.06 );
  if ( k > 1.5 ) c = vec3( 0.022 );
  if ( k > 2.5 ) c = vec3( 1.0, 0.94, 0.8 );
  if ( k > 3.5 ) c = vec3( 0.9, 0.06, 0.04 );
  if ( k > 4.5 ) c = vec3( 0.62, 0.64, 0.68 );
  if ( k > 5.5 ) c = vec3( 1.0, 0.68, 0.22 );
  if ( k > 6.5 ) c = vPaint * 0.35 + 0.01;
  if ( k > 7.5 ) c = vec3( 0.78, 0.8, 0.82 );
  if ( k > 8.5 ) c = vec3( 0.12, 0.1, 0.09 );
  diffuseColor.rgb = c;
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float k = vKind;
  float lit = ( k > 2.5 && k < 3.5 ) ? 1.0 : ( k > 3.5 && k < 4.5 ) ? 0.6 : ( k > 5.5 && k < 6.5 ) ? 0.9 : 0.0;
  totalEmissiveRadiance += diffuseColor.rgb * lit * ( 0.15 + 2.6 * uCarLamps );
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
if ( vKind > 0.5 && vKind < 1.5 ) roughnessFactor = 0.08;
if ( vKind > 1.5 && vKind < 2.5 ) roughnessFactor = 0.9;`);
  };
  mat.customProgramCacheKey = () => 'continuum-traffic';
  // Drawn as the animals are: a style that inks the car inks these.
  mat.userData.styleMark = true;
  mat.userData.styleCreature = true;
  return mat;
}

// --- the stream --------------------------------------------------------------

export class Traffic {
  // worlds: the schedule (world/worlds.js), to know what drives where.
  constructor(parent, road, seed = 0, material = null, worlds = null) {
    this.road = road;
    this.seed = seed;
    this.worlds = worlds;
    this.cars = [];
    this.spawned = 0;
    this.parent = parent;
    this.material = material || makeTrafficMaterial();
    this.mode = 'round';
    this.meshes = new Map();       // `${type}:${mode}` -> InstancedMesh
    this.specs = new Map();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._e = new THREE.Euler();
    this._c = new THREE.Color();
    this.player = { s: 0, speed: 0 };
    this.shown = 0;
    this._tmp = { a: 0, b: 0, t: 0, u: 0 };
  }

  // How the style draws them: 'round', 'soft' (the painted style) or 'block'.
  setMode(mode) {
    if (mode === this.mode || !MODES[mode]) return;
    this.mode = mode;
  }

  // The lamps' brightness: 0 in daylight, 1 in a bore or a dark world.
  setLamps(k) {
    lampsU.value = k;
  }

  _spec(name) {
    let sp = this.specs.get(name);
    if (!sp) {
      sp = spec(name);
      this.specs.set(name, sp);
    }
    return sp;
  }

  _mesh(name, mode) {
    const key = `${name}:${mode}`;
    let mesh = this.meshes.get(key);
    if (!mesh) {
      const sp = this._spec(name);
      mesh = new THREE.InstancedMesh(buildVehicle(sp, MODES[mode]), this.material, COUNT);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      this.parent.add(mesh);
      this.meshes.set(key, mesh);
    }
    return mesh;
  }

  // What drives at a point of the road: the world's roster, picked by a draw.
  _pick(s, draw) {
    let id = 'alpine';
    if (this.worlds) {
      const p = this.road.at(s);
      if (p) {
        const o = this.road.origin;
        id = WORLDS[this.worlds.main(p.x + o.x, p.z + o.z)].id;
      }
    }
    const list = ROSTER[id] || ROSTER.alpine;
    const total = list.reduce((a, [, w]) => a + w, 0);
    let r = draw * total;
    for (const [name, w] of list) {
      r -= w;
      if (r <= 0) return name;
    }
    return list[0][0];
  }

  _spawn(sCar, initial) {
    const n = this.spawned++;
    const h = hash01(n * 3.7 + this.seed * 0.011);
    // Two in three come toward the player; the rest drive ahead of it.
    const dir = h < 0.66 ? -1 : 1;
    let s;
    if (initial) s = sCar + 150 + hash01(n * 9.1) * (SPAN_AHEAD - 300);
    else s = dir < 0 ? sCar + SPAN_AHEAD - hash01(n * 5.3) * 200 : sCar + 700 + hash01(n * 5.3) * 1800;
    const type = this._pick(s, hash01(n * 2.31 + 5.1));
    const sp = this._spec(type);
    const car = {
      id: n, s, dir, lane: dir > 0 ? LANE : -LANE, type,
      len: sp.L, wid: sp.W, hover: sp.hover || 0,
      speed: 12, want: (0.85 + hash01(n * 7.7) * 0.3) * sp.speed, hue: hash01(n * 11.3),
      colour: sp.colours[Math.floor(hash01(n * 13.7) * sp.colours.length) % sp.colours.length],
      tilt: sp.wreck ? (hash01(n * 4.1) - 0.5) * 0.12 : 0,
    };
    // Never drop a car on top of another one.
    for (const o of this.cars) {
      if (o.dir === car.dir && Math.abs(o.s - car.s) < 40) return null;
    }
    this.cars.push(car);
    return car;
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
      const inter = gap < Infinity ? (Math.max(0, sStar) / Math.max(0.5, gap - c.len)) ** 2 : 0;
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

    // Each type is one instanced mesh, for the mode now: the others stand
    // down.
    const mode = this.mode;
    const used = new Map();
    const road = this.road;
    for (const c of this.cars) {
      const p = road.at(c.s);
      if (!p) continue;
      const mesh = this._mesh(c.type, mode);
      const i = used.get(mesh) || 0;
      if (i >= COUNT) continue;
      used.set(mesh, i + 1);
      const nx = -Math.sin(p.theta);
      const nz = Math.cos(p.theta);
      const y = road.surfaceAt(c.s, c.lane) + 0.04 + c.hover;
      this._p.set(p.x + nx * c.lane, y, p.z + nz * c.lane);
      const yaw = c.dir > 0 ? p.theta : p.theta + Math.PI;
      const pitch = Math.atan(p.grade) * c.dir;
      this._e.set(Math.atan(p.bank) * c.dir + c.tilt, -yaw, pitch, 'YXZ');
      this._q.setFromEuler(this._e);
      this._m.compose(this._p, this._q, this._s);
      mesh.setMatrixAt(i, this._m);
      this._c.setHex(c.colour, THREE.SRGBColorSpace);
      mesh.instanceColor.setXYZ(i, this._c.r, this._c.g, this._c.b);
    }
    let shown = 0;
    for (const [key, mesh] of this.meshes) {
      const n = key.endsWith(':' + mode) ? used.get(mesh) || 0 : 0;
      mesh.count = n;
      mesh.visible = n > 0;
      shown += n;
      if (n > 0) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
      }
    }
    this.shown = shown;
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

  // The types now on the road, for the checks.
  kinds() {
    const out = {};
    for (const c of this.cars) out[c.type] = (out[c.type] || 0) + 1;
    return out;
  }
}
