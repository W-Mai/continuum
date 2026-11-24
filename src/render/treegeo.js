// The real style's trees: a trunk and branches of tubes, and the foliage as cards, each
// two quads that cross, laid with a picture of a twig of leaves or a spray of needles
// (world/foliage.js). One tree of each kind is built, one unit tall about the vertical axis; an
// instance's matrix sets its size and turn. Each kind has a near build and a middle one.
//
// A card's normal leans outward from the crown's middle (LEAN of the way), so that the whole
// crown is lit as a round mass, and keeps a part of the card's own, so that each card has
// a light of its own. The vertex colour is the crown's own shade: dark inside, lit outside.
// Every vertex says which of the two it is of (aPart: 0 bark, 1 foliage): one mesh, one program.
//
// The numbers of triangles, near and middle: spruce 1412 and 440, broadleaf 484 and 130, stone pine 532 and 148,
// dead 540 and 174 (tools/trees_check.mjs holds them to 1800 and 500). The cards of the broadleaf and the pine are
// as many as a layer budget asks (cardsFor): a crown more than a few layers thick has fragments shaded and not seen.

import * as THREE from 'three';
import { atlasRect, LEAF_KINDS, FOLIAGE_MEANS } from '../world/foliage.js';

// How far a card's normal leans from its own to the crown's outward one.
export const LEAN = 0.6;
// How many pixels of a crown's picture each is covered, on average, by a card's leaf (the part of a card the
// dither lets through): a crown thicker than that costs fragments that are shaded and not seen. How many cards
// that is, for a crown that shows `area` (unit tree: its picture side on) and cards `s` across, 2 quads each.
const LAYERS = { near: 8, mid: 6.5 };
const cardsFor = (kind, level, area, s) => {
  const m = FOLIAGE_MEANS[LEAF_KINDS[TREE_KINDS[kind].tile]];
  const alpha = Math.max(m && m.alpha > 0.05 ? m.alpha : 0.4, 0.1);
  return Math.max(8, Math.round((LAYERS[level === 0 ? 'near' : 'mid'] * area) / (2 * s * s * alpha)));
};
// The kinds, the card each shows (the order of world/foliage.js's LEAF_KINDS), and the crown: its middle and
// its three radii (a unit tree), how far it reaches across (the half width an impostor of it is drawn at), and the
// light the impostor is given over what it was drawn in, so that it has the colour of the build it stands for
// (tools/trees_check.mjs says how near it is).
export const TREE_KINDS = {
  spruce: { tile: 1, centre: [0, 0.5, 0], radii: [0.21, 0.46, 0.21], reach: 0.30, gain: 1.81 },
  broadleaf: { tile: 0, centre: [0, 0.66, 0], radii: [0.31, 0.29, 0.31], reach: 0.43, gain: 1.99 },
  pine: { tile: 2, centre: [0.04, 0.86, 0.02], radii: [0.46, 0.11, 0.46], reach: 0.60, gain: 2.31 },
  dead: { tile: 3, centre: [0, 0.62, 0], radii: [0.36, 0.38, 0.36], reach: 0.58, gain: 2.82 },
};
export const TREE_NAMES = Object.keys(TREE_KINDS);

// The colour of each kind's wood, linear.
const BARK = {
  spruce: [0.115, 0.072, 0.048],
  broadleaf: [0.105, 0.082, 0.062],
  pine: [0.17, 0.088, 0.056],
  dead: [0.105, 0.098, 0.092],
};

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// A mesh being made: its vertices, and how many triangles it has.
class Mesh {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.part = [];
    this.idx = [];
    this.n = 0;
  }

  vertex(p, n, u, v, c, part) {
    const l = len(n) || 1;
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0] / l, n[1] / l, n[2] / l);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
    this.part.push(part);
    return this.n++;
  }

  tri(a, b, c) {
    this.idx.push(a, b, c);
  }

  get triangles() {
    return this.idx.length / 3;
  }

  done() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 1));
    g.setIndex(new THREE.Uint16BufferAttribute(this.idx, 1));
    return g;
  }
}

// A tube along a path of [x, y, z, radius], `sides` round, its colour darker toward its foot (shade at the first
// point, 1 at the last). Its picture runs once round in `reps` repeats and `per` of them to a unit of its length.
function tube(m, path, sides, colour, foot = 0.7, reps = 2, per = 14) {
  const rings = [];
  let s = 0;
  let t = norm(sub(path[1], path[0]));
  let side = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = norm(cross(side, t));
  for (let i = 0; i < path.length; i++) {
    if (i > 0) s += len(sub(path[i], path[i - 1]));
    const prev = path[Math.max(i - 1, 0)];
    const next = path[Math.min(i + 1, path.length - 1)];
    t = norm(sub(next, prev));
    // The frame carried along: the last one's side, made square to the new direction.
    u = norm(sub(u, mul(t, dot(u, t))));
    const w = cross(t, u);
    const k = foot + (1 - foot) * (i / (path.length - 1));
    const ring = [];
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const d = add(mul(u, Math.cos(a)), mul(w, Math.sin(a)));
      const p = [path[i][0] + d[0] * path[i][3], path[i][1] + d[1] * path[i][3], path[i][2] + d[2] * path[i][3]];
      ring.push(m.vertex(p, d, (j / sides) * reps, s * per, [colour[0] * k, colour[1] * k, colour[2] * k], 0));
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < sides; j++) {
      m.tri(rings[i][j], rings[i + 1][j], rings[i + 1][j + 1]);
      m.tri(rings[i][j], rings[i + 1][j + 1], rings[i][j + 1]);
    }
  }
}

// A card of a kind: two quads that cross along `up`, standing on `at` (the middle of their foot; with `centred`,
// the middle of the card itself), `w` wide and `h` tall, in the picture of the kind's card. Its normals are the quads' own, turned to the outer side,
// leant toward where the crown's surface faces (`crown`: centre and radii), and its colour is the crown's
// shade where it stands, a little different for each card.
function card(m, kind, base, up, right, w, h, crown, rand, centred = false) {
  const [u0, v0, u1, v1] = atlasRect(TREE_KINDS[kind].tile);
  const at = centred ? sub(base, mul(up, h * 0.5)) : base;
  const fwd = cross(right, up);
  const tint = 0.8 + 0.4 * rand();
  const hue = rand();
  const mid = add(at, mul(up, h * 0.5));
  for (let q = 0; q < 2; q++) {
    const r = q ? fwd : right;
    const n0 = q ? right : fwd;
    const a = sub(at, mul(r, w / 2));
    const b = add(at, mul(r, w / 2));
    const corners = [[a, u0, v0], [b, u1, v0], [add(b, mul(up, h)), u1, v1], [add(a, mul(up, h)), u0, v1]];
    const ids = corners.map(([p, uu, vv]) => {
      const e = [(p[0] - crown.c[0]) / crown.r[0], (p[1] - crown.c[1]) / crown.r[1], (p[2] - crown.c[2]) / crown.r[2]];
      const rr = len(e);
      // Outward, as an ellipsoid's surface faces (its gradient).
      const out = norm([e[0] / crown.r[0], e[1] / crown.r[1], e[2] / crown.r[2]]);
      const own = dot(n0, out) < 0 ? mul(n0, -1) : n0;
      const n = norm(mix(own, out, LEAN));
      const sh = (0.14 + 0.86 * smooth(0.1, 1.0, rr)) * tint;
      // (Some cards are yellower, some bluer than the rest: red against blue.)
      return m.vertex(p, n, uu, vv, [sh * (0.75 + 0.5 * hue), sh, sh * (1.5 - hue)], 1);
    });
    m.tri(ids[0], ids[1], ids[2]);
    m.tri(ids[0], ids[2], ids[3]);
  }
  return mid;
}

// The crown a kind's cards are shaded and leant by.
const crownOf = (kind) => ({ c: TREE_KINDS[kind].centre, r: TREE_KINDS[kind].radii });

// A direction as a card's growing way: `out` with some of the way up, turned by chance.
function growing(out, upBy, rand, spread = 0.35) {
  const d = norm(add(add(out, [0, upBy, 0]), [(rand() - 0.5) * spread * 2, (rand() - 0.5) * spread * 2, (rand() - 0.5) * spread * 2]));
  const right = norm(cross(d, Math.abs(d[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]));
  const turn = rand() * Math.PI * 2;
  const up2 = cross(right, d);
  return { up: d, right: norm(add(mul(right, Math.cos(turn)), mul(up2, Math.sin(turn)))) };
}

// A point inside a crown, `lo` to `hi` of the way out to its surface, toward a direction chosen by chance.
function inCrown(crown, rand, lo, hi, flat = 1) {
  const z = rand() * 2 - 1;
  const a = rand() * Math.PI * 2;
  const rr = Math.sqrt(1 - z * z);
  const dir = [rr * Math.cos(a), z, rr * Math.sin(a)];
  const f = lo + (hi - lo) * rand();
  return add(crown.c, [dir[0] * crown.r[0] * f, dir[1] * crown.r[1] * f * flat, dir[2] * crown.r[2] * f]);
}

// --- the kinds ----------------------------------------------------------------------

// Broadleaf: a short trunk that forks into limbs, each ending in twigs, and a round crown of cards on them.
function broadleaf(level) {
  const near = level === 0;
  const m = new Mesh();
  const rand = rng(0x6b1d);
  const bark = BARK.broadleaf;
  const crown = crownOf('broadleaf');
  const sides = near ? 8 : 5;
  tube(m, [[0, -0.03, 0, 0.05], [0.004, 0.12, 0.002, 0.036], [-0.004, 0.26, 0.003, 0.028], [0.0, 0.40, 0, 0.022]], sides, bark, 0.62, near ? 3 : 2);
  const limbs = near ? 6 : 3;
  const ends = [];
  for (let i = 0; i < limbs; i++) {
    const a = i * 2.399 + 0.6;
    const y0 = 0.33 + 0.1 * (i / limbs);
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const reach = 0.12 + 0.07 * rand();
    const p0 = [0, y0, 0, 0.02];
    const p1 = [dx * reach * 0.5, y0 + 0.1, dz * reach * 0.5, 0.0135];
    const p2 = [dx * reach, y0 + 0.2 + 0.07 * rand(), dz * reach, 0.0075];
    tube(m, near ? [p0, p1, p2] : [p0, p2], near ? 6 : 4, bark, 0.8, 1);
    ends.push(p2, p1);
    if (near) {
      for (let k = 0; k < 2; k++) {
        const b = a + (k ? 0.7 : -0.7);
        const q0 = p2;
        const q1 = [p2[0] + Math.cos(b) * 0.07, p2[1] + 0.06, p2[2] + Math.sin(b) * 0.07, 0.0035];
        tube(m, [[q0[0], q0[1], q0[2], 0.007], q1], 4, bark, 0.8, 1);
        ends.push(q1);
      }
    }
  }
  // Cards: a handful at the ends of the limbs, the rest through the crown, mostly at its skin.
  const size = near ? 0.18 : 0.26;
  const count = cardsFor('broadleaf', level, 0.28, size * 1.05);
  for (let i = 0; i < count; i++) {
    let at;
    if (i < ends.length * 3) {
      const e = ends[i % ends.length];
      at = add([e[0], e[1], e[2]], [(rand() - 0.5) * 0.12, (rand() - 0.5) * 0.1, (rand() - 0.5) * 0.12]);
    } else {
      at = inCrown(crown, rand, 0.25, 0.8);
    }
    const out = norm([(at[0] - crown.c[0]) / crown.r[0], (at[1] - crown.c[1]) / crown.r[1], (at[2] - crown.c[2]) / crown.r[2]]);
    const { up, right } = growing(out, 0.25, rand);
    const s = size * (0.8 + 0.5 * rand());
    card(m, 'broadleaf', at, up, right, s, s * (0.9 + 0.2 * rand()), crown, rand, true);
  }
  return m;
}

// Spruce: a straight trunk, whorls of branches that run out and droop, each under a spray of needles.
function spruce(level) {
  const near = level === 0;
  const m = new Mesh();
  const rand = rng(0x59c3);
  const bark = BARK.spruce;
  const crown = crownOf('spruce');
  const sides = near ? 8 : 6;
  const trunk = near
    ? [[0, -0.03, 0, 0.026], [0.003, 0.25, 0, 0.0185], [-0.003, 0.5, 0.002, 0.0125], [0.002, 0.75, 0, 0.0075], [0, 1.0, 0, 0.002]]
    : [[0, -0.03, 0, 0.026], [0.002, 0.4, 0, 0.0155], [0, 0.72, 0, 0.0085], [0, 1.0, 0, 0.002]];
  tube(m, trunk, sides, bark, 0.62, near ? 3 : 2, 12);
  const whorls = near ? 14 : 8;
  const per = near ? 6 : 5;
  for (let k = 0; k < whorls; k++) {
    const y = 0.1 + 0.84 * Math.pow(k / whorls, 0.95);
    const rad = 0.2 * Math.pow(1 - (y - 0.09) / 0.91, 0.75) + 0.014;
    const phase = k * 2.399;
    for (let j = 0; j < per; j++) {
      const a = phase + (j / per) * Math.PI * 2 + (rand() - 0.5) * 0.5;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const L = rad * (0.8 + 0.3 * rand());
      const droop = L * (0.28 + 0.2 * rand());
      const p0 = [0, y, 0, 0.0045 + 0.012 * L];
      const p1 = [dx * L * 0.55, y + 0.015 - droop * 0.2, dz * L * 0.55, 0.0028 + 0.006 * L];
      const p2 = [dx * L, y - droop, dz * L, 0.0012];
      tube(m, near ? [p0, p1, p2] : [p0, p2], 3, bark, 0.8, 1, 10);
      // The spray lies along the branch, over it, on its flat and on its edge.
      const dir = norm(sub(p2, p0));
      const right = norm(cross(dir, [0, 1, 0]));
      const at = add([p0[0], p0[1], p0[2]], mul(dir, L * 0.1));
      card(m, 'spruce', at, dir, right, L * 0.95, L * 1.05, crown, rand);
    }
  }
  // The leader.
  card(m, 'spruce', [0, 0.9, 0], [0, 1, 0], [1, 0, 0], 0.07, 0.12, crown, rand);
  return m;
}

// Stone pine: a tall bare trunk with a little lean, and at its top a few limbs spread flat, under pads of needles.
function pine(level) {
  const near = level === 0;
  const m = new Mesh();
  const rand = rng(0x71f5);
  const bark = BARK.pine;
  const crown = crownOf('pine');
  const sides = near ? 8 : 5;
  tube(m, [[0, -0.03, 0, 0.036], [0.012, 0.2, 0.004, 0.027], [0.026, 0.45, 0.01, 0.021], [0.036, 0.66, 0.016, 0.0165], [0.042, 0.8, 0.02, 0.012]], sides, bark, 0.62, near ? 3 : 2, 10);
  const limbs = near ? 6 : 3;
  const tops = [];
  for (let i = 0; i < limbs; i++) {
    const a = i * 2.399 + 0.3;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const y0 = 0.68 + 0.08 * rand();
    const reach = 0.16 + 0.2 * rand();
    const p0 = [0.04, y0, 0.02, 0.0125];
    const p1 = [0.04 + dx * reach * 0.5, y0 + 0.07, 0.02 + dz * reach * 0.5, 0.0085];
    const p2 = [0.04 + dx * reach, y0 + 0.12 + 0.04 * rand(), 0.02 + dz * reach, 0.004];
    tube(m, near ? [p0, p1, p2] : [p0, p2], near ? 6 : 4, bark, 0.8, 1);
    tops.push(p2, p1);
    if (near) {
      for (let k = 0; k < 2; k++) {
        const b = a + (k ? 0.6 : -0.6);
        const q = [p2[0] + Math.cos(b) * 0.1, p2[1] + 0.03, p2[2] + Math.sin(b) * 0.1, 0.002];
        tube(m, [[p2[0], p2[1], p2[2], 0.0035], q], 4, bark, 0.8, 1);
        tops.push(q);
      }
    }
  }
  // Pads of needles over the limbs: a card lies nearly flat, a second stands up through it.
  const size = near ? 0.2 : 0.3;
  const count = cardsFor('pine', level, 0.25, size * 1.05);
  for (let i = 0; i < count; i++) {
    let at;
    if (i < tops.length * 4) {
      const e = tops[i % tops.length];
      at = add([e[0], e[1], e[2]], [(rand() - 0.5) * 0.14, -0.015 + (rand() - 0.5) * 0.04, (rand() - 0.5) * 0.14]);
    } else {
      at = inCrown(crown, rand, 0.15, 0.8, 0.8);
    }
    const out = norm([(at[0] - crown.c[0]) / crown.r[0], (at[1] - crown.c[1]) / crown.r[1], (at[2] - crown.c[2]) / crown.r[2]]);
    const flat = norm([out[0] * 0.8, 0.35 + 0.2 * rand(), out[2] * 0.8]);
    const { up, right } = growing(flat, 0, rand, 0.12);
    const s = size * (0.85 + 0.4 * rand());
    card(m, 'pine', at, up, right, s, s * 0.85, crown, rand, true);
  }
  return m;
}

// A dead tree: a grey trunk bent once, limbs that fork, and a few cards of bare twigs.
function dead(level) {
  const near = level === 0;
  const m = new Mesh();
  const rand = rng(0x2a07);
  const bark = BARK.dead;
  const crown = crownOf('dead');
  const sides = near ? 7 : 5;
  tube(m, [[0, -0.03, 0, 0.045], [0.01, 0.15, 0.004, 0.034], [0.03, 0.34, 0.01, 0.026], [0.026, 0.5, -0.006, 0.02], [0.02, 0.62, -0.02, 0.014]], sides, bark, 0.62, near ? 3 : 2, 10);
  tube(m, [[0.02, 0.62, -0.02, 0.014], [0.0, 0.8, 0.004, 0.0085], [-0.012, 0.98, 0.02, 0.0025]], near ? 5 : 4, bark, 0.85, 1);
  const arms = near ? 9 : 5;
  const forks = [];
  for (let i = 0; i < arms; i++) {
    const t = (i + 0.5) / arms;
    const y = 0.26 + t * 0.4;
    const a = i * 2.399 + 0.7;
    const rise = 0.35 + 0.35 * (((i * 5) % 3) / 2);
    const L = (0.34 - 0.14 * t) * (0.85 + 0.3 * (((i * 7) % 5) / 4));
    const ox = 0.025 * (1 - t);
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const e = [ox + dx * L, y + rise * L, dz * L];
    const mid = [ox + dx * L * 0.5, y + rise * L * 0.45, dz * L * 0.5];
    tube(m, near ? [[ox, y, 0, 0.0145 * (1.2 - t * 0.5)], [mid[0], mid[1], mid[2], 0.009], [e[0], e[1], e[2], 0.0035]] : [[ox, y, 0, 0.0145 * (1.2 - t * 0.5)], [e[0], e[1], e[2], 0.0035]], near ? 5 : 3, bark, 0.8, 1);
    forks.push(e);
    if (near) {
      for (const [turn, up, k] of [[0.7, 0.35, 0.34], [-0.6, 0.12, 0.28]]) {
        const f = [e[0] + Math.cos(a + turn) * L * k, e[1] + L * up, e[2] + Math.sin(a + turn) * L * k];
        tube(m, [[e[0], e[1], e[2], 0.0045], [f[0], f[1], f[2], 0.0015]], 3, bark, 0.85, 1);
        forks.push(f);
      }
    }
  }
  const cards = near ? 44 : 22;
  for (let i = 0; i < cards; i++) {
    const e = forks[Math.floor(rand() * forks.length)];
    const at = add(e, [(rand() - 0.5) * 0.04, (rand() - 0.5) * 0.04, (rand() - 0.5) * 0.04]);
    const out = norm([(at[0] - crown.c[0]) / crown.r[0], (at[1] - crown.c[1]) / crown.r[1], (at[2] - crown.c[2]) / crown.r[2]]);
    const { up, right } = growing(out, 0.5, rand, 0.4);
    const s = (near ? 0.11 : 0.17) * (0.8 + 0.5 * rand());
    card(m, 'dead', at, up, right, s, s, crown, rand, true);
  }
  return m;
}

const MAKE = { broadleaf, spruce, pine, dead };

// A kind's tree built at a level (0 near, 1 middle), as a geometry with its triangle count in userData.
export function treeGeometry(kind, level) {
  const m = MAKE[kind](level);
  const g = m.done();
  g.userData.triangles = m.triangles;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 0.9);
  return g;
}
