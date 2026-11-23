// The forest near the camera, instanced per 160 m tile: spruce, broadleaf,
// stone pine, cactus, crystal or kelp, whichever the world grows
// (world/vegetation.js).
//
// Trees are placed on a jittered grid wherever vegetation.js says the canopy
// grows, standing on the land the road has shaped (corridor.js), so none ends
// up in a cutting, on a fill or on the asphalt. Each kind has three levels of
// detail: tiles near the camera draw the full tree, the next ring a simpler
// one, farther tiles the simplest; past FAR the terrain paints the canopy
// itself from the same density function.
//
// Of the kinds that have a far shape (world/bakery.js, CROSS: spruce,
// broadleaf, stone pine, cactus and the dead trees) the level is told by how
// big a tree is on the screen, and the farthest is one plain mesh to a tile of
// flat shapes that cross on the tree's axis. What casts into the sun's shadow
// map is not the tiles but a list of the trees round the car (Forest._casters).
// A tile the near land hides from the lens is not drawn (render/horizon.js).
//
// The block style has the same tiers for trees built of boxes (BLOCK_TREES; there
// are several of a kind, and a world plants them in its own proportions): the full
// block tree and a coarse one from the lists, one list mesh to each block tree and
// level; far off the tile's far trees of a kind, all its block trees, are one plain
// mesh of each tree's far shape, a few boxes; and one casting mesh to a kind.
//
// Each tree carries how much sun reaches it past the ridges, from the same ray
// march the terrain and road use, so a stand in a valley's shadow is dark.

import * as THREE from 'three';
import { withAtmosphere, withSunMask, warmHooks, compileObjects } from './atmosphere.js';
import { MARK, pairProgram } from './style.js';
import { CRYSTAL_PAINTED, TREE_CYAN } from './crystals.js';
import { FLORA } from '../world/vegetation.js';
import { WORLDS } from '../world/worlds.js';
import { plantTrees, forestBox, FOREST_TILE, CROSS, crossLayout } from '../world/bakery.js';

const TILE = FOREST_TILE;
const NEAR = 190;           // tile centres closer than this draw the full tree
const MID = 330;            // ...closer than this a three-tier tree
export const FOREST_FAR = 1000;
// A tree of a kind that has a far shape is drawn full where it is taller on
// the screen than NEAR_PX pixels (more for a kind whose full tree has many
// branches, NEAR_OF), in three tiers down to MID_PX, and as the far shape
// under that, as far as trees are planted (the land paints the canopy
// beyond). H_REF is a kind's usual height, m, for working that out.
const NEAR_PX = 60;
const NEAR_OF = { dead: 90 };
const MID_PX = 40;
const H_REF = { spruce: 15, broadleaf: 11, pine: 12, cactus: 5, dead: 10 };
// Kinds with no tier between: the full tree, then the far shape.
const NO_MID = { dead: true };
// How far a crown reaches past the tile it was planted in, m.
const PAD = 10;
// How much a far shape's normal is leant toward the lens, in lengths of it.
const FAR_LEAN = 0.9;
// The lists of the trees the lens sees are made again when it has moved
// LIST_MOVE metres or turned so that the cosine of the angle is under
// LIST_TURN (a little more than a degree); a tree is in them if its crown, grown
// by LIST_PAD metres and LIST_ANGLE of its distance, reaches into the picture.
const LIST_MOVE = 4;
const LIST_TURN = 0.9998;
const LIST_PAD = 6;
const LIST_ANGLE = 0.03;
// Trees cast into the sun's shadow map only from tiles this near the car (the
// map covers 140 m about it, and a crown's shadow is a few tens of metres
// long): a tile is drawn into it whole, so the ones that cannot reach it are
// left out, and the shadow pass is not half trees that cast nothing in it.
// (The kinds that have a far shape cast from a list of trees instead.)
const SHADOW_REACH = 150;
// How long a frame may be spent on making tiles again for the other style's trees.
const REDO_MS = 3;

const srgb = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

// The painted style's kelp: three colours, as they come out on the screen
// (linear), by how far up its strand a pixel is: the dark of the foot, which
// is also its shade, the green of the middle and the yellow-green of the tip,
// the middle from `at[0]` of the strand's height and the tip from `at[1]`.
const KELP = { dark: [0.03, 0.12, 0.16], mid: [0.10, 0.40, 0.30], tip: [0.38, 0.70, 0.30], at: [0.34, 0.68] };
const glsl3 = (a) => `vec3(${a.map((x) => x.toFixed(3)).join(', ')})`;

// A spruce one unit tall: a short trunk and `whorls` overlapping tiers of
// drooping branches. Each tier's rim is ragged (alternate branches reach
// farther and hang lower), normals lean outward like a rounded crown so the
// tree shades as a mass of needles rather than as faceted cones, and colour
// darkens from the sunlit tips into the crown.
function spruceGeometry(whorls, segments) {
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];
  const needle = srgb(0x223319);
  const tipCol = srgb(0x3b5128);
  const bark = srgb(0x3b2d22);
  let n = 0;
  const push = (x, y, z, nx, ny, nz, c, k) => {
    pos.push(x, y, z);
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm.push(nx / l, ny / l, nz / l);
    col.push(c.r * k, c.g * k, c.b * k);
    return n++;
  };
  if (whorls > 2) {
    // Trunk.
    const r = 0.02;
    for (let s = 0; s < 5; s++) {
      const a0 = (s / 5) * Math.PI * 2;
      const a1 = ((s + 1) / 5) * Math.PI * 2;
      const v0 = push(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a0), 0, Math.sin(a0), bark, 1);
      const v1 = push(Math.cos(a1) * r, 0, Math.sin(a1) * r, Math.cos(a1), 0, Math.sin(a1), bark, 1);
      const v2 = push(Math.cos(a1) * r, 0.3, Math.sin(a1) * r, Math.cos(a1), 0, Math.sin(a1), bark, 1);
      const v3 = push(Math.cos(a0) * r, 0.3, Math.sin(a0) * r, Math.cos(a0), 0, Math.sin(a0), bark, 1);
      idx.push(v0, v2, v1, v0, v3, v2);
    }
  }
  const bottom = 0.09;
  for (let w = 0; w < whorls; w++) {
    const t = whorls === 1 ? 0 : w / whorls;
    const base = bottom + (1 - bottom) * t * 0.88;
    const top = whorls === 1 ? 1 : Math.min(1, base + 0.24 + 0.1 * (1 - t));
    const rad = 0.2 * Math.pow(1 - (base - bottom) / (1 - bottom), 0.75) + 0.014;
    const droop = rad * 0.34;
    const phase = w * 2.39;
    const tip = push(0, top, 0, 0, 1, 0, tipCol, 0.9);
    // Two rings: the rim, and a ring a third of the way in that bulges the
    // tier outward, so its profile is a drooping bough and not a straight cone.
    const rim = [];
    const mid = [];
    for (let s = 0; s < segments; s++) {
      const a = phase + (s / segments) * Math.PI * 2;
      const long = s % 2 === 0;
      const rr = rad * (long ? 1.0 : 0.86) * (0.9 + 0.2 * Math.sin(a * 3 + w * 1.7));
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      const y = base - droop * (long ? 1 : 0.7);
      const rc = whorls === 1 ? needle : tipCol;
      rim.push(push(x, y, z, x, rad * 0.75, z, rc, 0.62 + 0.3 * t));
      const mx = x * 0.62;
      const mz = z * 0.62;
      mid.push(push(mx, base + (top - base) * 0.38, mz, mx, rad * 0.8, mz, needle, 0.8 + 0.25 * t));
    }
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      if (whorls === 1) {
        idx.push(tip, rim[s1], rim[s]);
        continue;
      }
      idx.push(tip, mid[s1], mid[s]);
      idx.push(mid[s], mid[s1], rim[s1], mid[s], rim[s1], rim[s]);
    }
    // Underside, so a tree seen from the road above is not hollow.
    if (whorls > 2) {
      const hub = push(0, base + (top - base) * 0.2, 0, 0, -1, 0, needle, 0.4);
      for (let s = 0; s < segments; s++) idx.push(hub, rim[s], rim[(s + 1) % segments]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// A small mesh builder for the other trees: vertices with a colour each.
function builder() {
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];
  let n = 0;
  return {
    v(x, y, z, nx, ny, nz, c, k = 1) {
      pos.push(x, y, z);
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm.push(nx / l, ny / l, nz / l);
      col.push(c.r * k, c.g * k, c.b * k);
      return n++;
    },
    tri(a, b, c) { idx.push(a, b, c); },
    done() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      return g;
    },
  };
}

// A trunk: a tapered prism from y0 to y1, leaning by (lx, lz) at the top.
function trunk(b, segs, r0, r1, y0, y1, c, lx = 0, lz = 0) {
  const ring0 = [];
  const ring1 = [];
  for (let s = 0; s < segs; s++) {
    const a = (s / segs) * Math.PI * 2;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    ring0.push(b.v(cx * r0, y0, cz * r0, cx, 0, cz, c, 0.8));
    ring1.push(b.v(cx * r1 + lx, y1, cz * r1 + lz, cx, 0, cz, c, 1));
  }
  for (let s = 0; s < segs; s++) {
    const s1 = (s + 1) % segs;
    b.tri(ring0[s], ring1[s1], ring0[s1]);
    b.tri(ring0[s], ring1[s], ring1[s1]);
  }
}

// A lumpy blob of foliage: a sphere with its radius pushed in and out, normals
// leaning outward from the blob's centre so it shades as a mass of leaves,
// darker underneath and inside.
function blob(b, cx, cy, cz, rx, ry, rz, segs, rings, leaf, tip, seed) {
  const grid = [];
  for (let r = 0; r <= rings; r++) {
    const v = r / rings;
    const phi = v * Math.PI;
    const row = [];
    for (let s = 0; s < segs; s++) {
      const th = (s / segs) * Math.PI * 2;
      const bump = 1 + 0.16 * Math.sin(th * 3 + seed) * Math.sin(phi * 2 + seed * 1.7) + 0.08 * Math.sin(th * 5 - seed);
      const x = Math.sin(phi) * Math.cos(th) * bump;
      const y = Math.cos(phi) * bump;
      const z = Math.sin(phi) * Math.sin(th) * bump;
      const shade = 0.55 + 0.45 * (0.5 + 0.5 * y);
      const c = y > 0.2 ? tip : leaf;
      row.push(b.v(cx + x * rx, cy + y * ry, cz + z * rz, x, y + 0.25, z, c, shade));
    }
    grid.push(row);
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      b.tri(grid[r][s], grid[r][s1], grid[r + 1][s1]);
      b.tri(grid[r][s], grid[r + 1][s1], grid[r + 1][s]);
    }
  }
}

// Broadleaf: a short trunk and a rounded crown of a few overlapping lumps.
// One unit tall; the crown is about 0.6 across before the instance's width.
function broadleafGeometry(detail) {
  const b = builder();
  const leaf = srgb(0x2c4419);
  const tip = srgb(0x4f6e2c);
  const bark = srgb(0x4a3b2c);
  if (detail > 0) trunk(b, detail > 1 ? 6 : 4, 0.035, 0.022, 0, 0.42, bark);
  if (detail === 2) {
    blob(b, 0, 0.62, 0, 0.26, 0.22, 0.26, 9, 6, leaf, tip, 0.3);
    blob(b, 0.13, 0.55, 0.07, 0.18, 0.16, 0.18, 7, 5, leaf, tip, 1.9);
    blob(b, -0.12, 0.57, -0.08, 0.19, 0.17, 0.19, 7, 5, leaf, tip, 3.1);
    blob(b, 0.02, 0.8, -0.03, 0.17, 0.15, 0.17, 7, 5, leaf, tip, 4.4);
  } else if (detail === 1) {
    blob(b, 0, 0.62, 0, 0.28, 0.24, 0.28, 8, 5, leaf, tip, 0.3);
    blob(b, 0.05, 0.8, -0.02, 0.18, 0.15, 0.18, 6, 4, leaf, tip, 4.4);
  } else {
    blob(b, 0, 0.64, 0, 0.3, 0.3, 0.3, 6, 4, leaf, tip, 0.3);
  }
  return b.done();
}

// Stone pine: a tall bare trunk, a little leaning, and a broad flat crown.
function pineGeometry(detail) {
  const b = builder();
  const leaf = srgb(0x2b3d1c);
  const tip = srgb(0x48602c);
  const bark = srgb(0x5a4433);
  if (detail > 0) trunk(b, detail > 1 ? 6 : 4, 0.03, 0.02, 0, 0.78, bark, 0.04, 0.02);
  if (detail === 2) {
    blob(b, 0.04, 0.84, 0.02, 0.44, 0.12, 0.44, 12, 5, leaf, tip, 0.7);
    blob(b, -0.12, 0.8, 0.12, 0.24, 0.08, 0.24, 8, 4, leaf, tip, 2.3);
    blob(b, 0.2, 0.79, -0.1, 0.22, 0.08, 0.22, 8, 4, leaf, tip, 3.9);
  } else if (detail === 1) {
    blob(b, 0.04, 0.84, 0.02, 0.45, 0.13, 0.45, 9, 4, leaf, tip, 0.7);
  } else {
    blob(b, 0.04, 0.84, 0.02, 0.45, 0.14, 0.45, 6, 3, leaf, tip, 0.7);
  }
  return b.done();
}

// Saguaro: a ribbed column with two arms that turn up.
function cactusGeometry(detail) {
  const b = builder();
  const green = srgb(0x4c6a38);
  const segs = detail === 2 ? 10 : detail === 1 ? 7 : 5;
  const column = (x, z, y0, y1, r) => {
    const rings = [];
    for (const y of [y0, y1]) {
      const ring = [];
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        const rr = r * (s % 2 === 0 ? 1 : 0.86);
        ring.push(b.v(x + Math.cos(a) * rr, y, z + Math.sin(a) * rr, Math.cos(a), 0, Math.sin(a), green, y === y0 ? 0.75 : 1));
      }
      rings.push(ring);
    }
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      b.tri(rings[0][s], rings[1][s1], rings[0][s1]);
      b.tri(rings[0][s], rings[1][s], rings[1][s1]);
    }
    const top = b.v(x, y1 + r * 0.8, z, 0, 1, 0, green, 1.1);
    for (let s = 0; s < segs; s++) b.tri(top, rings[1][(s + 1) % segs], rings[1][s]);
  };
  column(0, 0, 0, 0.92, 0.07);
  if (detail > 0) {
    // Arms: out along x, then up.
    column(0.16, 0, 0.34, 0.68, 0.05);
    column(0.09, 0, 0.32, 0.38, 0.045);
    column(-0.14, 0.02, 0.46, 0.76, 0.045);
    column(-0.08, 0.01, 0.44, 0.5, 0.04);
  }
  return b.done();
}

// Crystals: a cluster of hexagonal prisms with pointed tips, leaning out from
// a common root, the tallest in the middle. They glow (Forest.glowMaterial).
function crystalGeometry(detail) {
  const b = builder();
  const cyan = srgb(TREE_CYAN);
  const deep = srgb(0x1c6f86);
  const prisms = detail === 2
    ? [[0, 0, 0, 0.09, 1.0], [0.6, 0.35, 0.5, 0.06, 0.62], [2.5, 0.4, 0.45, 0.05, 0.5], [4.1, 0.3, 0.4, 0.055, 0.56], [5.3, 0.45, 0.35, 0.04, 0.38]]
    : detail === 1 ? [[0, 0, 0, 0.09, 1.0], [0.6, 0.35, 0.5, 0.06, 0.62], [3.3, 0.4, 0.45, 0.05, 0.5]]
      : [[0, 0, 0, 0.1, 1.0]];
  for (const [az, tilt, , r, len] of prisms) {
    // Axis of the prism, tilted away from the root toward azimuth az.
    const ax = Math.sin(tilt) * Math.cos(az);
    const ay = Math.cos(tilt);
    const azz = Math.sin(tilt) * Math.sin(az);
    // Two vectors across the axis.
    let ux = -azz;
    let uz = ax;
    const ul = Math.hypot(ux, uz) || 1;
    ux = ul > 1e-6 ? ux / ul : 1;
    uz = ul > 1e-6 ? uz / ul : 0;
    const vx = ay * uz;
    const vy = azz * ux - ax * uz;
    const vz = -ay * ux;
    const ring = (h, rr, c, k) => {
      const out = [];
      for (let s = 0; s < 6; s++) {
        const a = (s / 6) * Math.PI * 2;
        const ca = Math.cos(a) * rr;
        const sa = Math.sin(a) * rr;
        const px = ax * h + ux * ca + vx * sa;
        const py = ay * h + vy * sa;
        const pz = azz * h + uz * ca + vz * sa;
        out.push(b.v(px, py, pz, ux * Math.cos(a) + vx * Math.sin(a), vy * Math.sin(a), uz * Math.cos(a) + vz * Math.sin(a), c, k));
      }
      return out;
    };
    const r0 = ring(0, r, deep, 0.7);
    const r1 = ring(len * 0.8, r * 0.92, cyan, 1);
    const tip = b.v(ax * len, ay * len, azz * len, ax, ay, azz, cyan, 1.3);
    for (let s = 0; s < 6; s++) {
      const s1 = (s + 1) % 6;
      b.tri(r0[s], r1[s1], r0[s1]);
      b.tri(r0[s], r1[s], r1[s1]);
      b.tri(r1[s], tip, r1[s1]);
    }
  }
  return b.done();
}

// Kelp: long ribbons rising from one holdfast, each leaning off the root,
// winding and twisting as it goes, widest in the middle; golden brown, dark
// at the foot. A ribbon has no thickness: the material draws both sides
// (Forest.kelpMaterial), which also sways them in the current.
function kelpGeometry(detail) {
  const b = builder();
  const foot = srgb(0x2a2612);
  const mid = srgb(0x7a6428);
  const tip = srgb(0xb09a48);
  const c = new THREE.Color();
  const strands = [2, 3, 5][detail];
  const levels = [2, 4, 8][detail];
  const rnd = (k) => {
    const s = Math.sin(k * 12.9898 + 4.1) * 43758.5453;
    return s - Math.floor(s);
  };
  for (let i = 0; i < strands; i++) {
    const az = (i / strands) * Math.PI * 2 + rnd(i) * 0.8;
    const root = 0.03 + 0.06 * rnd(i + 10);
    const len = i === 0 ? 1 : 0.62 + 0.33 * rnd(i + 20);
    const lean = 0.1 + 0.14 * rnd(i + 30);
    const twist = 1.5 + 2.5 * rnd(i + 40);
    const half = 0.06 + 0.03 * rnd(i + 50);
    const wind = 0.035 * (0.5 + rnd(i + 60));
    const phase = rnd(i + 70) * 6.28;
    let prev = null;
    let ex = 0;
    let ez = 0;
    for (let l = 0; l <= levels; l++) {
      const f = l / levels;
      const reach = root + lean * f * Math.sqrt(f);
      // Out from the root along az, winding to either side of that line.
      const side = wind * Math.sin(f * 7 + phase) * f;
      const cx = Math.cos(az) * reach - Math.sin(az) * side;
      const cz = Math.sin(az) * reach + Math.cos(az) * side;
      ex = cx;
      ez = cz;
      const th = az + Math.PI / 2 + twist * f;
      const w = half * (0.3 + 0.7 * Math.sin(Math.PI * (0.08 + 0.84 * f)));
      const dx = Math.cos(th) * w;
      const dz = Math.sin(th) * w;
      if (f < 0.35) c.lerpColors(foot, mid, f / 0.35);
      else c.lerpColors(mid, tip, (f - 0.35) / 0.65);
      const y = f * len;
      const row = [
        b.v(cx - dx, y, cz - dz, -Math.sin(th), 0.15, Math.cos(th), c),
        b.v(cx + dx, y, cz + dz, -Math.sin(th), 0.15, Math.cos(th), c),
      ];
      if (prev) {
        b.tri(prev[0], prev[1], row[1]);
        b.tri(prev[0], row[1], row[0]);
      }
      prev = row;
    }
    // A rounded end above the last row.
    if (detail > 0) {
      const th = az + Math.PI / 2 + twist;
      const top = b.v(ex, len * 1.04, ez, -Math.sin(th), 0.15, Math.cos(th), c);
      b.tri(prev[0], prev[1], top);
    }
  }
  return b.done();
}

// A tapered tube from one end to the other, with its own ring of `segs`.
function limb(b, x0, y0, z0, x1, y1, z1, r0, r1, segs, c, k0 = 0.7, k1 = 1) {
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
  let ux = hy * az - hz * ay;
  let uy = hz * ax - hx * az;
  let uz = hx * ay - hy * ax;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const vx = ay * uz - az * uy;
  const vy = az * ux - ax * uz;
  const vz = ax * uy - ay * ux;
  const rings = [];
  for (let e = 0; e < 2; e++) {
    const r = e ? r1 : r0;
    const cx = e ? x1 : x0;
    const cy = e ? y1 : y0;
    const cz = e ? z1 : z0;
    const ring = [];
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const dx = ux * Math.cos(a) + vx * Math.sin(a);
      const dy = uy * Math.cos(a) + vy * Math.sin(a);
      const dz = uz * Math.cos(a) + vz * Math.sin(a);
      ring.push(b.v(cx + dx * r, cy + dy * r, cz + dz * r, dx, dy, dz, c, e ? k1 : k0));
    }
    rings.push(ring);
  }
  for (let s = 0; s < segs; s++) {
    const s1 = (s + 1) % segs;
    b.tri(rings[0][s], rings[1][s1], rings[0][s1]);
    b.tri(rings[0][s], rings[1][s], rings[1][s1]);
  }
}

// A dead tree of the Upside Down: a grey, twisted trunk, and bare limbs
// reaching out and up from it, each forking at its end. One unit tall.
function deadGeometry(detail) {
  const b = builder();
  const wood = srgb(0x35312f);
  const pale = srgb(0x5a5551);
  const segs = detail === 2 ? 6 : detail === 1 ? 5 : 4;
  // The trunk, bent once.
  limb(b, 0, 0, 0, 0.03, 0.34, 0.01, 0.034, 0.026, segs, wood, 0.6, 0.9);
  limb(b, 0.03, 0.34, 0.01, 0.02, 0.62, -0.02, 0.026, 0.014, segs, wood, 0.9, 1);
  const arms = detail === 2 ? 8 : detail === 1 ? 5 : 3;
  for (let i = 0; i < arms; i++) {
    const t = (i + 0.5) / arms;
    const y = 0.26 + t * 0.4;
    const a = i * 2.399 + 0.7;
    const rise = 0.35 + 0.35 * ((i * 5) % 3) / 2;
    const len = (0.34 - 0.14 * t) * (0.85 + 0.3 * (((i * 7) % 5) / 4));
    const ox = 0.025 * (1 - t);
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const ex = ox + dx * len;
    const ez = dz * len;
    const ey = y + rise * len;
    limb(b, ox, y, 0, ex, ey, ez, 0.016 * (1.2 - t * 0.5), 0.007, 4, wood, 0.75, 1);
    if (detail > 0) {
      // Two forks, one turning up, one out.
      limb(b, ex, ey, ez, ex + Math.cos(a + 0.7) * len * 0.5, ey + len * 0.35, ez + Math.sin(a + 0.7) * len * 0.5, 0.007, 0.003, 3, pale, 0.8, 1);
      limb(b, ex, ey, ez, ex + Math.cos(a - 0.6) * len * 0.4, ey + len * 0.12, ez + Math.sin(a - 0.6) * len * 0.4, 0.006, 0.003, 3, pale, 0.8, 1);
    }
  }
  // The top: a crooked finger.
  limb(b, 0.02, 0.62, -0.02, -0.01, detail > 0 ? 0.98 : 0.86, 0.02, 0.014, 0.004, 4, pale, 0.9, 1);
  return b.done();
}

// Each kind of tree: its three levels of detail; its height and crown width
// are TREE_SIZE's (world/vegetation.js), shared with the worker that plants.
const KINDS = {
  spruce: { lod: () => [spruceGeometry(7, 8), spruceGeometry(3, 7), spruceGeometry(1, 6)] },
  broadleaf: { lod: () => [broadleafGeometry(2), broadleafGeometry(1), broadleafGeometry(0)] },
  pine: { lod: () => [pineGeometry(2), pineGeometry(1), pineGeometry(0)] },
  cactus: { lod: () => [cactusGeometry(2), cactusGeometry(1), cactusGeometry(0)] },
  crystal: { lod: () => [crystalGeometry(2), crystalGeometry(1), crystalGeometry(0)], glow: true },
  kelp: { lod: () => [kelpGeometry(2), kelpGeometry(1), kelpGeometry(0)], sway: true },
  dead: { lod: () => [deadGeometry(2), deadGeometry(1), deadGeometry(0)] },
};

// --- trees of blocks (the block style, render/style.js) ---------------------
//
// The same trees, in the same places and sizes (an instance's matrix sets
// both), built of boxes instead: a trunk of one block, leaves in layers of
// blocks. One block is 0.055 of a tree's height, so a tall tree has bigger
// ones: not cubes of a metre as a block world has them, but they read as
// cubes. Each box is a shade of its own, as the picture on each block of a
// leaf is. Each is built at the details 0 and 1 (the full tree), 2 (a coarse
// one: fewer layers) and FAR_SHAPE (what a tree is seen as from far off: a
// few boxes, no underside).

const BLK = 0.055;

// The far shape of a block tree (detail FAR_SHAPE, below) has no underside: it
// is only ever seen from above and from the side, and a box is two triangles
// to the face.
const FAR_SHAPE = 3;
let undersides = true;

// An axis-aligned box from (x0, y0, z0) to (x1, y1, z1), six flat faces.
function box(b, x0, y0, z0, x1, y1, z1, c, k = 1) {
  const face = (n, corners) => {
    const i = corners.map(([x, y, z]) => b.v(x, y, z, n[0], n[1], n[2], c, k));
    b.tri(i[0], i[1], i[2]);
    b.tri(i[0], i[2], i[3]);
  };
  face([1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]);
  face([-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]);
  face([0, 1, 0], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]);
  if (undersides) face([0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]);
  face([0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
  face([0, 0, -1], [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]]);
}

// A shade of its own for each block, the same every time.
const blockShade = (i) => {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return 0.86 + 0.28 * (s - Math.floor(s));
};

// A layer of leaves: a square of (2 r + 1) blocks across, centred on the trunk.
function layer(b, y0, y1, r, c, i) {
  const h = (r + 0.5) * BLK;
  box(b, -h, y0, -h, h, y1, h, c, blockShade(i));
}

// Spruce: a trunk and layers of leaves, wide and narrow in turn, narrowing to
// a single block at the top.
function blockSpruce(detail) {
  const b = builder();
  const bark = srgb(0x5d432b);
  const leaf = srgb(0x2c6a31);
  const far = detail === FAR_SHAPE;
  box(b, -BLK / 2, 0, -BLK / 2, BLK / 2, far ? 0.12 : 0.34, BLK / 2, bark, 0.9);
  // (Far off: a wide layer and a narrow one.)
  if (far) {
    layer(b, 0.12, 0.58, 3, leaf, 0);
    layer(b, 0.58, 1, 1, leaf, 1);
    return b.done();
  }
  const n = detail === 2 ? 5 : 15;
  const y0 = 0.12;
  const step = (1 - y0) / n;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const r = Math.max(0, Math.round(4 * Math.pow(1 - t, 0.9) - (i % 2) + 0.4));
    layer(b, y0 + i * step, y0 + (i + 1) * step, detail >= 2 ? Math.round(4 * (1 - t)) : r, leaf, i);
  }
  return b.done();
}

// Oak: a trunk and a crown of a few thick layers.
function blockOak(detail) {
  const b = builder();
  const bark = srgb(0x6b4b2c);
  const leaf = srgb(0x3d7d2c);
  box(b, -BLK / 2, 0, -BLK / 2, BLK / 2, detail === FAR_SHAPE ? 0.4 : 0.52, BLK / 2, bark, 0.9);
  const rows = detail === FAR_SHAPE ? [[0.4, 0.8, 3]]
    : detail === 2 ? [[0.4, 0.62, 3], [0.62, 0.78, 2]] : [[0.4, 0.51, 3], [0.51, 0.62, 3], [0.62, 0.73, 2], [0.73, 0.84, 1]];
  rows.forEach(([y0, y1, r], i) => layer(b, y0, y1, r, leaf, i + 3));
  return b.done();
}

// Stone pine: a tall bare trunk and a flat crown in two slabs, one off to a side.
function blockPine(detail) {
  const b = builder();
  const bark = srgb(0x6b4b2c);
  const leaf = srgb(0x477a2a);
  box(b, -BLK / 2, 0, -BLK / 2, BLK / 2, 0.84, BLK / 2, bark, 0.9);
  box(b, -0.36, 0.8, -0.36, 0.36, 0.86, 0.36, leaf, blockShade(1));
  if (detail < 2) box(b, -0.2, 0.86, -0.2, 0.3, 0.92, 0.26, leaf, blockShade(2));
  return b.done();
}

// Cactus: a column with an arm up each side.
function blockCactus(detail) {
  const b = builder();
  const green = srgb(0x3f7a38);
  box(b, -0.07, 0, -0.07, 0.07, 0.95, 0.07, green, blockShade(1));
  if (detail < 2) {
    box(b, 0.07, 0.42, -0.06, 0.28, 0.54, 0.06, green, blockShade(2));
    box(b, 0.2, 0.54, -0.06, 0.32, 0.78, 0.06, green, blockShade(3));
    box(b, -0.28, 0.5, -0.06, -0.07, 0.62, 0.06, green, blockShade(4));
    box(b, -0.32, 0.62, -0.06, -0.2, 0.84, 0.06, green, blockShade(5));
  }
  return b.done();
}

// A taller spruce, narrower and darker, its crown held high on a bare trunk.
function blockTallSpruce(detail) {
  const b = builder();
  const bark = srgb(0x4e3a26);
  const leaf = srgb(0x1f5a2c);
  const far = detail === FAR_SHAPE;
  box(b, -BLK / 2, 0, -BLK / 2, BLK / 2, far ? 0.2 : 0.4, BLK / 2, bark, 0.9);
  if (far) {
    layer(b, 0.2, 0.62, 2, leaf, 0);
    layer(b, 0.62, 1, 1, leaf, 1);
    return b.done();
  }
  const n = detail === 2 ? 6 : 17;
  const y0 = 0.2;
  const step = (1 - y0) / n;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const r = detail >= 2 ? Math.round(2.4 * (1 - t)) : Math.max(0, Math.round(2.6 * Math.pow(1 - t, 0.8) - (i % 2) + 0.3));
    layer(b, y0 + i * step, y0 + (i + 1) * step, r, leaf, i);
  }
  return b.done();
}

// A spruce with snow on every layer, for the high country.
function blockSnowSpruce(detail) {
  const b = builder();
  const bark = srgb(0x5d432b);
  const leaf = srgb(0x2c6a31);
  const snow = srgb(0xf1f5f8);
  const far = detail === FAR_SHAPE;
  box(b, -BLK / 2, 0, -BLK / 2, BLK / 2, far ? 0.12 : 0.34, BLK / 2, bark, 0.9);
  // (Far off: a wide layer of leaves with a slab of snow on it, and a narrow layer of leaves.)
  if (far) {
    layer(b, 0.12, 0.56, 3, leaf, 0);
    box(b, -3.5 * BLK, 0.56, -3.5 * BLK, 3.5 * BLK, 0.6, 3.5 * BLK, snow, 1);
    layer(b, 0.6, 1, 1, leaf, 2);
    return b.done();
  }
  const n = detail === 2 ? 5 : 13;
  const y0 = 0.12;
  const step = (1 - y0) / n;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const r = Math.max(0, Math.round(4 * Math.pow(1 - t, 0.9) - (i % 2) + 0.4));
    const h = (r + 0.5) * BLK;
    const top = y0 + (i + 1) * step;
    box(b, -h, y0 + i * step, -h, h, top - 0.012, h, leaf, blockShade(i));
    box(b, -h, top - 0.012, -h, h, top, h, snow, 1);
  }
  return b.done();
}

// Birch: a pale trunk with dark scars, a narrow crown of light leaves.
function blockBirch(detail) {
  const b = builder();
  const bark = srgb(0xe4e1d6);
  const scar = srgb(0x2e2b28);
  const leaf = srgb(0x72b040);
  box(b, -BLK / 2, 0, -BLK / 2, BLK / 2, detail === FAR_SHAPE ? 0.5 : 0.68, BLK / 2, bark, 1);
  if (detail < 2) {
    for (let i = 0; i < 6; i++) {
      const y = 0.06 + i * 0.1;
      box(b, -0.022, y, BLK / 2, 0.012, y + 0.016, BLK / 2 + 0.005, scar, 1);
      box(b, BLK / 2, y + 0.04, -0.012, BLK / 2 + 0.005, y + 0.056, 0.024, scar, 1);
    }
  }
  const rows = detail === FAR_SHAPE ? [[0.5, 1.0, 2]]
    : detail === 2 ? [[0.5, 0.74, 2], [0.74, 0.92, 1]] : [[0.5, 0.62, 2], [0.62, 0.74, 2], [0.74, 0.85, 1], [0.85, 0.94, 1], [0.94, 1.0, 0]];
  rows.forEach(([y0, y1, r], i) => layer(b, y0, y1, r, leaf, i + 9));
  return b.done();
}

// Dark oak: a trunk two blocks thick under a broad, low, flat crown.
function blockDarkOak(detail) {
  const b = builder();
  const bark = srgb(0x3b2a1b);
  const leaf = srgb(0x2b5e26);
  box(b, -BLK, 0, -BLK, BLK, detail === FAR_SHAPE ? 0.36 : 0.5, BLK, bark, 0.9);
  const rows = detail === FAR_SHAPE ? [[0.36, 0.84, 4]]
    : detail === 2 ? [[0.36, 0.6, 5], [0.6, 0.82, 3]]
    : [[0.36, 0.48, 4], [0.48, 0.6, 5], [0.6, 0.71, 4], [0.71, 0.8, 3], [0.8, 0.86, 1]];
  rows.forEach(([y0, y1, r], i) => layer(b, y0, y1, r, leaf, i + 20));
  return b.done();
}

// Cherry: grey-brown wood, a round crown in two pinks.
function blockCherry(detail) {
  const b = builder();
  const bark = srgb(0x5b4742);
  const pink = srgb(0xf2a8c4);
  const deep = srgb(0xe283ac);
  box(b, -BLK / 2, 0, -BLK / 2, BLK / 2, detail === FAR_SHAPE ? 0.4 : 0.5, BLK / 2, bark, 0.9);
  if (detail < 2) box(b, BLK / 2, 0.3, -0.03, 0.2, 0.36, 0.03, bark, 0.9);
  const rows = detail === FAR_SHAPE ? [[0.4, 0.86, 3]]
    : detail === 2 ? [[0.4, 0.64, 3], [0.64, 0.86, 2]]
    : [[0.4, 0.52, 3], [0.52, 0.64, 4], [0.64, 0.76, 3], [0.76, 0.86, 2]];
  rows.forEach(([y0, y1, r], i) => layer(b, y0, y1, r, i % 2 ? deep : pink, i + 30));
  return b.done();
}

// Willow: a crown that lets its vines hang down all round.
function blockWillow(detail) {
  const b = builder();
  const bark = srgb(0x5a4a30);
  const leaf = srgb(0x7fae4e);
  const vine = srgb(0x93c15f);
  box(b, -BLK / 2, 0, -BLK / 2, BLK / 2, 0.5, BLK / 2, bark, 0.9);
  const rows = detail >= 2 ? [[0.5, 0.8, 3]] : [[0.5, 0.62, 3], [0.62, 0.74, 3], [0.74, 0.84, 2]];
  rows.forEach(([y0, y1, r], i) => layer(b, y0, y1, r, leaf, i + 40));
  if (detail < 2) {
    const R = 3.5 * BLK;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x = Math.max(-R, Math.min(R, Math.cos(a) * R * 1.3));
      const z = Math.max(-R, Math.min(R, Math.sin(a) * R * 1.3));
      const len = 0.16 + 0.14 * ((i * 7) % 5) / 4;
      box(b, x - 0.016, 0.5 - len, z - 0.016, x + 0.016, 0.52, z + 0.016, vine, blockShade(i + 50));
    }
  }
  return b.done();
}

// A palm leaning off the sea, its fronds in a cross.
function blockPalm(detail) {
  const b = builder();
  const bark = srgb(0x9a7b4f);
  const frond = srgb(0x3f8f3a);
  const nut = srgb(0x4a3322);
  const n = detail === FAR_SHAPE ? 2 : detail === 2 ? 4 : 10;
  let ox = 0;
  for (let i = 0; i < n; i++) {
    const y0 = (i / n) * 0.86;
    const y1 = ((i + 1) / n) * 0.86;
    box(b, ox - 0.03, y0, -0.03, ox + 0.03, y1, 0.03, bark, blockShade(i + 60));
    ox += 0.012 + i * 0.0018;
  }
  const top = 0.86;
  if (detail === FAR_SHAPE) {
    // Two fronds, each across the top.
    box(b, ox - 0.28, top, -0.035, ox + 0.28, top + 0.06, 0.035, frond, blockShade(70));
    box(b, ox - 0.035, top, -0.28, ox + 0.035, top + 0.06, 0.28, frond, blockShade(73));
    return b.done();
  }
  box(b, ox - 0.04, top, -0.04, ox + 0.04, top + 0.04, 0.04, frond, 1);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const L = 0.24;
    const w = 0.035;
    const ax = ox + dx * (0.04 + L / 2);
    const az = dz * (0.04 + L / 2);
    box(b, ax - (dx ? L / 2 : w), top + 0.02, az - (dz ? L / 2 : w), ax + (dx ? L / 2 : w), top + 0.06, az + (dz ? L / 2 : w), frond, blockShade(70 + dx * 2 + dz * 3));
    if (detail < 2) {
      const ex = ox + dx * (0.04 + L + 0.02);
      const ez = dz * (0.04 + L + 0.02);
      box(b, ex - 0.02, top - 0.09, ez - 0.02, ex + 0.02, top + 0.06, ez + 0.02, frond, 0.85);
    }
  }
  if (detail < 2) {
    box(b, ox - 0.03, top - 0.05, 0.02, ox + 0.01, top - 0.01, 0.06, nut, 1);
    box(b, ox + 0.01, top - 0.05, -0.05, ox + 0.05, top - 0.01, -0.01, nut, 1);
  }
  return b.done();
}
// Acacia: a trunk that steps aside once, and a flat crown held out on top.
function blockAcacia(detail) {
  const b = builder();
  const bark = srgb(0x7a5a3a);
  const leaf = srgb(0x7fa032);
  box(b, -BLK / 2, 0, -BLK / 2, BLK / 2, detail === FAR_SHAPE ? 0.64 : 0.4, BLK / 2, bark, 0.9);
  if (detail !== FAR_SHAPE) box(b, BLK * 0.4, 0.4, -BLK / 2, BLK * 1.4, 0.64, BLK / 2, bark, 0.85);
  const cx = BLK * 0.9;
  box(b, cx - 0.36, 0.64, -0.34, cx + 0.36, 0.71, 0.34, leaf, blockShade(80));
  if (detail < 2) box(b, cx - 0.22, 0.71, -0.2, cx + 0.22, 0.77, 0.2, leaf, blockShade(81));
  return b.done();
}

// A tree of cloud, for the high air: white blocks, a gold trunk.
function blockCloud(detail) {
  const b = builder();
  const bark = srgb(0xcaa860);
  const leaf = srgb(0xfbf8ee);
  box(b, -BLK / 2, 0, -BLK / 2, BLK / 2, detail === FAR_SHAPE ? 0.4 : 0.46, BLK / 2, bark, 1);
  const rows = detail >= 2 ? [[0.4, 0.82, 3]] : [[0.4, 0.54, 3], [0.54, 0.68, 4], [0.68, 0.82, 3]];
  rows.forEach(([y0, y1, r], i) => layer(b, y0, y1, r, leaf, i + 90));
  return b.done();
}

// A taller cactus with its arms raised higher.
function blockTallCactus(detail) {
  const b = builder();
  const green = srgb(0x3f7a38);
  box(b, -0.07, 0, -0.07, 0.07, 1.0, 0.07, green, blockShade(11));
  if (detail < 2) {
    box(b, 0.07, 0.5, -0.06, 0.3, 0.62, 0.06, green, blockShade(12));
    box(b, 0.22, 0.62, -0.06, 0.34, 0.9, 0.06, green, blockShade(13));
    box(b, -0.3, 0.3, -0.06, -0.07, 0.42, 0.06, green, blockShade(14));
    box(b, -0.34, 0.42, -0.06, -0.22, 0.62, 0.06, green, blockShade(15));
  }
  return b.done();
}

// A dead bush: a few bare sticks of wood out of the sand.
function blockBush(detail) {
  const b = builder();
  const wood = srgb(0x7a5a34);
  const n = detail === FAR_SHAPE ? 2 : detail === 2 ? 3 : 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.4;
    const x = Math.cos(a) * 0.12 * (i % 2 ? 1 : 0.5);
    const z = Math.sin(a) * 0.12 * (i % 2 ? 1 : 0.5);
    const h = 0.26 + 0.18 * ((i * 5) % 4) / 3;
    box(b, x - 0.012, 0, z - 0.012, x + 0.012, h, z + 0.012, wood, blockShade(i + 100));
    if (detail < 2) box(b, x - 0.012 + Math.cos(a) * 0.05, h * 0.55, z - 0.012 + Math.sin(a) * 0.05, x + 0.012 + Math.cos(a) * 0.05, h * 0.55 + 0.1, z + 0.012 + Math.sin(a) * 0.05, wood, 0.9);
  }
  return b.done();
}

// A dead tree of blocks: a thin dark trunk, a few arms stepping out and up.
function blockDead(detail) {
  const b = builder();
  const wood = srgb(0x3d3835);
  if (detail === FAR_SHAPE) {
    // A trunk and an arm, each one box.
    box(b, -BLK / 2, 0, -BLK / 2, BLK / 2, 0.8, BLK / 2, wood, 0.9);
    box(b, BLK / 2, 0.42, -BLK / 2, 3.5 * BLK, 0.42 + BLK, BLK / 2, wood, blockShade(121));
    return b.done();
  }
  box(b, -BLK / 2, 0, -BLK / 2, BLK / 2, 0.64, BLK / 2, wood, 0.9);
  const arms = detail === 2 ? 3 : 7;
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  for (let i = 0; i < arms; i++) {
    const [dx, dz] = dirs[i % 4];
    const y0 = 0.22 + (i / arms) * 0.4;
    const steps = detail === 2 ? 2 : 3;
    for (let k = 1; k <= steps; k++) {
      const x = dx * k * BLK;
      const z = dz * k * BLK;
      const y = y0 + k * BLK * 0.9;
      box(b, x - BLK / 2, y, z - BLK / 2, x + BLK / 2, y + BLK, z + BLK / 2, wood, blockShade(i * 4 + k + 120));
    }
  }
  box(b, -BLK / 2, 0.64, -BLK / 2, BLK / 2, 0.8, BLK / 2, wood, 0.9);
  return b.done();
}

// The block trees of each kind of flora, by name, and which each world
// plants of them: [name, weight, ...]. A tree of a kind its world does not
// list (across a border) is the kind's first.
const BLOCK_TREES = {
  spruce: { spruce: blockSpruce, tall: blockTallSpruce, snowy: blockSnowSpruce },
  broadleaf: { oak: blockOak, birch: blockBirch, darkoak: blockDarkOak, cherry: blockCherry, willow: blockWillow },
  pine: { pine: blockPine, palm: blockPalm, acacia: blockAcacia, cloud: blockCloud },
  cactus: { cactus: blockCactus, tall: blockTallCactus, bush: blockBush },
  dead: { dead: blockDead },
};
const BLOCK_STANDS = {
  alpine: [['spruce', 5], ['tall', 3], ['snowy', 2]],
  hills: [['oak', 4], ['birch', 2], ['darkoak', 2], ['cherry', 2]],
  river: [['oak', 3], ['birch', 2], ['willow', 4]],
  city: [['oak', 3], ['cherry', 3], ['birch', 2]],
  coast: [['pine', 3], ['palm', 5], ['acacia', 2]],
  heaven: [['cloud', 1]],
  desert: [['cactus', 5], ['tall', 2], ['bush', 3]],
  upside: [['dead', 1]],
};

// The names of each kind's block trees, in the order a tree's number among them counts.
const BLOCK_NAMES = Object.fromEntries(Object.entries(BLOCK_TREES).map(([kind, set]) => [kind, Object.keys(set)]));

// What the lists of trees and the casters keep a mesh for, one each: a kind of
// tree, or in the block style each of the block trees a kind has (and a kind
// that has none, itself). list[i] is { k, name }; base[k] the first slot of kind k.
function slotsOf(blocky) {
  const list = [];
  const base = [];
  FLORA.forEach((kind, k) => {
    base[k] = list.length;
    const names = blocky ? BLOCK_NAMES[kind] : null;
    if (names) for (const name of names) list.push({ k, name });
    else list.push({ k, name: null });
  });
  return { list, base };
}

// A block tree's far shape: the few boxes it is seen as from where the tile's
// far trees are drawn, as arrays for a mesh made of many (cached).
const FAR_SHAPES = {};
function farShape(kind, name) {
  const key = `${kind}:${name}`;
  let t = FAR_SHAPES[key];
  if (t) return t;
  undersides = false;
  let g;
  try {
    g = BLOCK_TREES[kind][name](FAR_SHAPE);
  } finally {
    undersides = true;
  }
  const normal = g.getAttribute('normal').array;
  const nrm = new Int8Array(normal.length);
  for (let i = 0; i < nrm.length; i++) nrm[i] = Math.round(normal[i] * 127);
  t = FAR_SHAPES[key] = { n: g.getAttribute('position').count, pos: g.getAttribute('position').array, nrm, col: g.getAttribute('color').array, idx: g.getIndex().array };
  g.dispose();
  return t;
}

// Which of a kind's block trees stands at a point of a world, by a roll r.
function blockVariant(kind, worldId, r) {
  const set = BLOCK_TREES[kind];
  if (!set) return null;
  const names = Object.keys(set);
  const list = (BLOCK_STANDS[worldId] || []).filter(([n]) => set[n]);
  if (!list.length) return names[0];
  let total = 0;
  for (const [, w] of list) total += w;
  let at = r * total;
  for (const [n, w] of list) {
    at -= w;
    if (at < 0) return n;
  }
  return list[list.length - 1][0];
}

// How thick a trunk is for the width a tree is planted with (the instance's
// x scale): what a car or an animal runs into. Kelp has none.
const TRUNK_R = { spruce: 0.024, broadleaf: 0.04, pine: 0.036, cactus: 0.075, crystal: 0.1, kelp: 0, dead: 0.04 };
const TRUNK_MIN = 0.3;

// A tile's trunks as [x, z, radius, ...] in absolute metres, from the
// matrices its trees were planted with.
function trunksOf(r, x0, z0) {
  const out = [];
  r.bins.forEach((bin, k) => {
    const c = TRUNK_R[FLORA[k]] || 0;
    if (!c) return;
    for (let i = 0; i < bin.n; i++) {
      const m = i * 16;
      out.push(x0 + bin.mats[m + 12], z0 + bin.mats[m + 14], Math.max(TRUNK_MIN, c * Math.hypot(bin.mats[m], bin.mats[m + 2])));
    }
  });
  return new Float32Array(out);
}

const _m = new THREE.Matrix4();
const _pv = new THREE.Matrix4();
const _fr = new THREE.Frustum();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();
const _dir = new THREE.Vector3();

// A bin's trees as the lists want them (made when first asked): for each, four
// numbers together: where its crown's sphere is (x and z in the tile, y) and how
// big it is (its radius).
function crownsOf(bin) {
  if (bin.crowns) return bin.crowns;
  const n = bin.n;
  const mats = bin.mats;
  const crowns = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const m = i * 16;
    const h = mats[m + 5];
    crowns[i * 4] = mats[m + 12];
    crowns[i * 4 + 1] = mats[m + 13] + 0.5 * h;
    crowns[i * 4 + 2] = mats[m + 14];
    crowns[i * 4 + 3] = 0.5 * Math.sqrt(h * h + 0.81 * (mats[m] * mats[m] + mats[m + 2] * mats[m + 2]));
  }
  bin.crowns = crowns;
  return crowns;
}

// The corners of a far shape's tree and the triangles over them, by kind.
const LAYOUT = {};
function layoutOf(name) {
  return LAYOUT[name] || (LAYOUT[name] = crossLayout(CROSS[name]));
}

// How high the trees stand over each of 4 x 4 cells of the tile grown by PAD
// each side, row by row (a tree counts in the cells its crown can reach), for
// what the land hides (render/horizon.js); -Infinity where there is none.
function topsOf(r) {
  const size = TILE + 2 * PAD;
  const cell = size / 4;
  const own = new Float32Array(16).fill(-Infinity);
  for (const bin of r.bins) {
    for (let i = 0; i < bin.n; i++) {
      const m = i * 16;
      const ci = Math.min(3, Math.max(0, Math.floor((bin.mats[m + 12] + PAD) / cell)));
      const cj = Math.min(3, Math.max(0, Math.floor((bin.mats[m + 14] + PAD) / cell)));
      const top = bin.mats[m + 13] + bin.mats[m + 5];
      if (top > own[cj * 4 + ci]) own[cj * 4 + ci] = top;
    }
  }
  // A crown can reach into the next cell.
  const out = new Float32Array(16).fill(-Infinity);
  for (let cj = 0; cj < 4; cj++) {
    for (let ci = 0; ci < 4; ci++) {
      let t = -Infinity;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const a = ci + di;
          const b = cj + dj;
          if (a >= 0 && a < 4 && b >= 0 && b < 4 && own[b * 4 + a] > t) t = own[b * 4 + a];
        }
      }
      out[cj * 4 + ci] = t;
    }
  }
  return out;
}

// A mesh of a tile goes: its geometry and, if it is instanced, the matrices and colours
// it holds on the GPU, which three.js lets go of with the mesh and not with the geometry.
function release(mesh) {
  mesh.geometry.dispose();
  if (mesh.isInstancedMesh) mesh.dispose();
}

export class Forest {
  constructor(scene, land, corridor, vegetation, seed, opts = {}) {
    this.land = land;
    this.corridor = corridor;
    this.veg = vegetation;
    this.seed = seed;
    this.group = new THREE.Group();
    this.group.name = 'forest';
    scene.add(this.group);
    this.origin = { x: 0, z: 0 };
    this.detail = 1;           // scales the near and middle levels of detail
    this.sunDir = new THREE.Vector3(0.5, 0.6, 0.5).normalize();
    this.tiles = new Map();
    this.budgetMs = opts.budgetMs || 2;
    this.baking = null;
    this.stale = new Set();      // tiles to plant again, drawn until then (markStale)
    this.holdStale = false;
    this.kinds = FLORA.map((k) => KINDS[k]);
    this.lods = this.kinds.map((k) => k.lod());
    this.focus = null;         // where the shadow map is centred (setShadowFocus)
    this.blocky = false;       // trees of blocks, for the block style (setBlocky)
    this.reach = 0;            // how far off they are drawn, m, where a style has the land paint the far wood (setReach)
    this.blockLods = null;
    this._todo = [];           // the tiles still to be made again the style's way (_redo), the nearest last
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
    // A style may light the leaves in clumps, and marks the trees (MARK.tree, in
    // the leaves' range: render/style.js).
    mat.userData.styleClump = true;
    mat.userData.mark = MARK.tree;
    this.material = withSunMask(withAtmosphere(mat), true);
    // Crystals light themselves: their vertex colour is also their glow.
    const glow = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.1 });
    glow.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor * 1.6;');
      // The painted style draws a crystal in three flat colours (render/crystals.js),
      // with a line round it, which the last pass draws round what is marked as life
      // (render/style.js).
      if (pairProgram.on) shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>${CRYSTAL_PAINTED}`);
      // (The mark is read by whichever program is drawn: three keeps the uniforms of the
      // program a material built last, also when it goes back to another.)
      shader.uniforms.uMarkSelf = { get value() { return pairProgram.on ? MARK.life : 0; } };
    };
    glow.customProgramCacheKey = () => 'continuum-crystal' + (pairProgram.on ? '-painted' : '');
    this.glowMaterial = withSunMask(withAtmosphere(glow), true);
    // Kelp sways in the current, more the higher up the ribbon; the phase
    // runs across the bed with the plant's place in it, and along the ribbon.
    const kelp = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
    const sway = this.sway = { value: 0 };
    kelp.onBeforeCompile = (shader) => {
      const paintOn = pairProgram.on;
      shader.uniforms.uSway = sway;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uSway;${paintOn ? '\nvarying float vKelpH;' : ''}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>${paintOn ? '\nvKelpH = position.y;' : ''}
#ifdef USE_INSTANCING
float kPhase = instanceMatrix[3].x * 0.071 + instanceMatrix[3].z * 0.053 + (position.x + position.z) * 5.0;
#else
float kPhase = (position.x + position.z) * 5.0;
#endif
float kBend = transformed.y * transformed.y;
transformed.x += kBend * 0.14 * sin(uSway * 0.8 + kPhase);
transformed.z += kBend * 0.09 * sin(uSway * 0.6 + kPhase * 1.3 + 1.7);`);
      if (paintOn) {
        // The painted style's paints of a strand, by its height (three flat colours, a pixel wide between them).
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vKelpH;')
          .replace('#include <map_fragment>', `#include <map_fragment>
{
  float kw = fwidth( vKelpH ) + 1e-4;
  stOwnLit = mix( mix( ${glsl3(KELP.dark)}, ${glsl3(KELP.mid)}, smoothstep( ${KELP.at[0].toFixed(2)} - kw, ${KELP.at[0].toFixed(2)} + kw, vKelpH ) ),
    ${glsl3(KELP.tip)}, smoothstep( ${KELP.at[1].toFixed(2)} - kw, ${KELP.at[1].toFixed(2)} + kw, vKelpH ) );
  stOwnShade = ${glsl3(KELP.dark)};
}`);
      }
    };
    kelp.customProgramCacheKey = () => 'continuum-kelp' + (pairProgram.on ? '-painted' : '');
    kelp.userData.paints = { lit: KELP.mid, shade: KELP.dark };
    kelp.userData.mark = MARK.leaf;
    this.kelpMaterial = withSunMask(withAtmosphere(kelp), true);
    // The far shapes are flat and seen from either side, each side lit as the
    // shape's own normals say (a rounded crown), not as the side it faces, and
    // the normals are leant toward the lens (as the front of a crown is, which
    // the shape's own normals, all across the view, have none of).
    const far = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, side: THREE.DoubleSide });
    far.userData.styleClump = true;
    far.userData.mark = MARK.tree;
    far.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>',
        THREE.ShaderChunk.normal_fragment_begin
          .replace('normal *= faceDirection;', '')
          .replace('vec3 nonPerturbedNormal = normal;', `normal = normalize( normal + ${FAR_LEAN.toFixed(2)} * normalize( vViewPosition ) );
vec3 nonPerturbedNormal = normal;`));
    };
    far.customProgramCacheKey = () => 'continuum-far-tree';
    this.farMaterial = withSunMask(withAtmosphere(far), true);
    // The block style's far trees are boxes, lit as boxes are: the faces' own normals, one side.
    const farBox = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
    farBox.userData.styleClump = true;
    farBox.userData.mark = MARK.leaf;
    farBox.customProgramCacheKey = () => 'continuum-far-block';
    this.blockFarMaterial = withSunMask(withAtmosphere(farBox), true);
    // Its program is built ahead, while the page is drawn in a style that has no such trees: the one of the lit
    // materials that are not of the paired paints (the kind the real style and the block style share), whichever
    // kind is being warmed when this is called.
    warmHooks.push((renderer, scene, camera) => {
      const was = pairProgram.on;
      pairProgram.on = false;
      const geo = new THREE.BufferGeometry();
      try {
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(9), 3, true));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9), 3));
        geo.setAttribute('aSun', new THREE.BufferAttribute(new Float32Array(3), 1));
        compileObjects(renderer, scene, camera, [new THREE.Mesh(geo, this.blockFarMaterial)]);
      } finally {
        geo.dispose();
        pairProgram.on = was;
      }
    });
    this.light = null;           // the sun, whose shadow map the trees cast into (setLight)
    this.view = { x: 0, z: 0, k: 1000 };   // the lens, abs, and pixels a metre makes at a metre
    this.version = 0;            // changes with the tiles that are up
    this.hidden = 0;             // tiles the near land hides (arrange)
    // What the lists and the casters keep a mesh for, each of its own: a kind of
    // tree, or in the block style each block tree of a kind (slotsOf).
    this._slots = slotsOf(false);
    this.casters = this._slots.list.map(() => null);
    this.lists = this._slots.list.map(() => null);   // per slot, [full, three-tier]: the trees the lens sees (_viewLists)
    this._arr = { version: -1, det: 0, twisted: false, blocky: false, fov: 0, aspect: 0, k: 0, x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 0, ux: 0, uy: 0, uz: 0 };
    // Room the lists and the arrangement use again each time.
    this._lim2 = new Float64Array(FLORA.length);
    this._near = new Float64Array(FLORA.length);
    this._planes = new Float64Array(24);
    this._picks = this._slots.list.map(() => [[], []]);
    this._castPicks = this._slots.list.map(() => [[], []]);
    this._cast = { version: -1, fx: 0, fz: 0, vx: 0, vz: 0, sun: new THREE.Vector3(), k: 0, detail: 0 };
    this.trees = 0;
    this.env = { land, corridor, veg: vegetation };
    // Workers that plant tiles off the page (render/bakers.js), as the
    // terrain's: the jobs out with them, and what came back.
    this.bakers = null;
    this.inflight = new Map();   // key -> id of the job out for it
    this.done = [];              // { key, ix, iz, id, r }
  }

  setSun(dir) {
    this.sunDir.copy(dir).normalize();
  }

  // The absolute point the sun's shadow map is centred on, the car.
  setShadowFocus(ax, az) {
    this.focus = { x: ax, z: az };
  }

  // The sun: the light whose shadow map the trees cast into.
  setLight(light) {
    this.light = light;
  }

  // At lower quality the full and three-tier trees come in closer; the
  // forest reaches as far, where the land paints the canopy.
  setDetail(f) {
    this.detail = f;
  }

  // The kelp's clock. Wrapped where both of its waves come round together.
  animate(dt) {
    this.sway.value = (this.sway.value + dt) % (Math.PI * 20);
  }

  setOrigin(x, z) {
    this.origin.x = x;
    this.origin.z = z;
    for (const t of this.tiles.values()) t.group.position.set(t.x0 - x, 0, t.z0 - z);
    this.version++;
  }

  _build(ix, iz) {
    const gen = this._bake(ix, iz);
    let r = gen.next();
    while (!r.done) r = gen.next();
    return r.value;
  }

  // A generator, like the terrain's: update() spreads a tile over frames.
  // The trees are planted by world/bakery.js, on the page or in a worker.
  *_bake(ix, iz) {
    const ctx = this.corridor.prepare(...forestBox(ix, iz));
    const r = yield* plantTrees(this.env, ix, iz, ctx, this.sunDir, this.seed);
    return this._meshes(ix, iz, r);
  }

  // Send one tile out to the workers, as TerrainField._send does.
  _send(ix, iz, key) {
    const ctx = this.corridor.prepare(...forestBox(ix, iz));
    const s = this.sunDir;
    const job = { type: 'trees', ix, iz, ctx, sun: { x: s.x, y: s.y, z: s.z }, seed: this.seed };
    const id = this.bakers.post(job, [ctx.seg.buffer, ctx.bStart.buffer, ctx.bIds.buffer],
      (r) => this.done.push({ key, ix, iz, id, r }));
    if (id) this.inflight.set(key, id);
  }

  // A tile from its planted arrays: its group, the trunks a car or an animal
  // can run into, and the meshes (_fill).
  _meshes(ix, iz, r) {
    const x0 = ix * TILE;
    const z0 = iz * TILE;
    const group = new THREE.Group();
    group.position.set(x0 - this.origin.x, 0, z0 - this.origin.z);
    const tile = { x0, z0, group, meshes: [], count: r.count, trunks: trunksOf(r, x0, z0), tops: topsOf(r), r, gone: false, built: this.blocky };
    this._fill(tile, r);
    this.group.add(group);
    this.trees += r.count;
    this._touch(tile);
    return tile;
  }

  // The tiles that are up have changed: the lists made of them are to be made
  // again if the tile is near enough to be in one.
  _touch(t) {
    const v = this.view;
    if (Math.hypot(t.x0 + TILE / 2 - v.x, t.z0 + TILE / 2 - v.z) < 900) this.version++;
  }

  // A tile's meshes: a kind that has a far shape has one plain mesh of its far
  // trees, the others one set of instances (matrices, sun, tint) drawn at each
  // of three levels of detail.
  _fill(tile, r) {
    const { x0, z0, group } = tile;
    const sphere = new THREE.Sphere(
      new THREE.Vector3(TILE / 2, (r.ymin + r.ymax) / 2, TILE / 2),
      Math.hypot(TILE / 2, TILE / 2, (r.ymax - r.ymin) / 2) + 4,
    );
    for (let k = 0; k < r.bins.length; k++) {
      const bin = r.bins[k];
      if (!bin.n) continue;
      const kind = this.kinds[k];
      const name = FLORA[k];
      // A kind with a far shape is told by size on the screen: its trees are
      // drawn from lists (_viewLists) or, far off, as the tile's far shape,
      // one plain mesh (of boxes in the block style, one mesh for all the
      // block trees of the kind).
      if (bin.far) {
        const mesh = this.blocky
          ? new THREE.Mesh(this._blockFarGeometry(tile, k, bin), this.blockFarMaterial)
          : new THREE.Mesh(this._farGeometry(name, bin), this.farMaterial);
        mesh.geometry.boundingSphere = sphere;
        mesh.visible = false;
        mesh.matrixAutoUpdate = false;
        mesh.userData.lod = 2;
        mesh.userData.kind = k;
        mesh.userData.variant = null;
        mesh.userData.far = true;
        group.add(mesh);
        tile.meshes.push(mesh);
        continue;
      }
      // (The kinds with no far shape, the crystals and the kelp, are drawn by the
      // tile at each of three levels of detail in every style.)
      const material = kind.glow ? this.glowMaterial : kind.sway ? this.kelpMaterial : this.material;
      const lods = this.lods[k];
      const matrix = new THREE.InstancedBufferAttribute(bin.mats, 16);
      const sunAttr = new THREE.InstancedBufferAttribute(bin.suns, 1);
      const colAttr = new THREE.InstancedBufferAttribute(bin.cols, 3);
      for (let l = 0; l < lods.length; l++) {
        const geo = this._geo(k, l, sunAttr);
        const mesh = new THREE.InstancedMesh(geo, material, bin.n);
        mesh.instanceMatrix = matrix;
        mesh.instanceColor = colAttr;
        mesh.boundingSphere = sphere;
        mesh.geometry.boundingSphere = sphere;
        mesh.castShadow = l < 2;
        mesh.receiveShadow = l < 2;
        mesh.visible = false;
        mesh.matrixAutoUpdate = false;
        mesh.userData.lod = l;
        mesh.userData.kind = k;
        mesh.userData.variant = null;
        group.add(mesh);
        tile.meshes.push(mesh);
      }
    }
  }

  // A tile's far trees of one kind as a plain mesh: their corners and the
  // triangles over them, a copy of the kind's layout for each tree.
  _farGeometry(name, bin) {
    const lay = layoutOf(name);
    const n = bin.n;
    const per = lay.index.length;
    const idx = n * lay.corners < 65536 ? new Uint16Array(n * per) : new Uint32Array(n * per);
    for (let i = 0; i < n; i++) {
      const base = i * lay.corners;
      for (let j = 0; j < per; j++) idx[i * per + j] = lay.index[j] + base;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(bin.far.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(bin.far.nrm, 3, true));
    geo.setAttribute('color', new THREE.BufferAttribute(bin.far.col, 3));
    geo.setAttribute('aSun', new THREE.BufferAttribute(bin.far.sun, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return geo;
  }

  // Which block tree each tree of a tile's bin is (a number among BLOCK_NAMES of
  // the kind), by where it stands in the world it stands in: the same every
  // time. Made once for a bin, and kept with it, with which of them there are
  // (varsUsed, a bit each).
  _vars(t, k) {
    const bin = t.r.bins[k];
    if (bin.vars) return bin.vars;
    const worlds = this.land.worlds;
    const names = BLOCK_NAMES[FLORA[k]];
    const vars = new Uint8Array(bin.n);
    let used = 0;
    if (names) {
      for (let i = 0; i < bin.n; i++) {
        const ax = t.x0 + bin.mats[i * 16 + 12];
        const az = t.z0 + bin.mats[i * 16 + 14];
        const s = Math.sin(ax * 12.9898 + az * 78.233) * 43758.5453;
        const v = names.indexOf(blockVariant(FLORA[k], WORLDS[worlds ? worlds.main(ax, az) : 0].id, s - Math.floor(s)));
        vars[i] = v;
        used |= 1 << v;
      }
    }
    bin.varsUsed = used;
    bin.vars = vars;
    return vars;
  }

  // A tile's far block trees of a kind as one plain mesh: each tree's far shape
  // (its block tree's) turned, sized and put where the tree stands, in the tree's
  // tint, with the sun on it: the same placing the instances are given, done once
  // for each corner.
  _blockFarGeometry(t, k, bin) {
    const kind = FLORA[k];
    const shapes = BLOCK_NAMES[kind].map((name) => farShape(kind, name));
    const vars = this._vars(t, k);
    let nv = 0;
    let ni = 0;
    for (let i = 0; i < bin.n; i++) {
      const s = shapes[vars[i]];
      nv += s.n;
      ni += s.idx.length;
    }
    const pos = new Float32Array(nv * 3);
    const nrm = new Int8Array(nv * 3);
    const col = new Float32Array(nv * 3);
    const sun = new Float32Array(nv);
    const idx = nv < 65536 ? new Uint16Array(ni) : new Uint32Array(ni);
    const { mats, cols, suns } = bin;
    let v = 0;
    let e = 0;
    for (let i = 0; i < bin.n; i++) {
      const s = shapes[vars[i]];
      const m = i * 16;
      const x0 = mats[m]; const y0 = mats[m + 1]; const z0 = mats[m + 2];
      const x1 = mats[m + 4]; const y1 = mats[m + 5]; const z1 = mats[m + 6];
      const x2 = mats[m + 8]; const y2 = mats[m + 9]; const z2 = mats[m + 10];
      const tx = mats[m + 12]; const ty = mats[m + 13]; const tz = mats[m + 14];
      // As the instance's matrix turns a normal: each axis by the inverse of its length squared.
      const l0 = 1 / (x0 * x0 + y0 * y0 + z0 * z0 || 1);
      const l1 = 1 / (x1 * x1 + y1 * y1 + z1 * z1 || 1);
      const l2 = 1 / (x2 * x2 + y2 * y2 + z2 * z2 || 1);
      const c0 = cols[i * 3]; const c1 = cols[i * 3 + 1]; const c2 = cols[i * 3 + 2];
      for (let j = 0; j < s.n; j++) {
        const a = j * 3;
        const px = s.pos[a]; const py = s.pos[a + 1]; const pz = s.pos[a + 2];
        const o = (v + j) * 3;
        pos[o] = x0 * px + x1 * py + x2 * pz + tx;
        pos[o + 1] = y0 * px + y1 * py + y2 * pz + ty;
        pos[o + 2] = z0 * px + z1 * py + z2 * pz + tz;
        const nx = s.nrm[a] * l0; const ny = s.nrm[a + 1] * l1; const nz = s.nrm[a + 2] * l2;
        const wx = x0 * nx + x1 * ny + x2 * nz;
        const wy = y0 * nx + y1 * ny + y2 * nz;
        const wz = z0 * nx + z1 * ny + z2 * nz;
        const len = (Math.hypot(wx, wy, wz) || 1) / 127;
        nrm[o] = Math.round(wx / len);
        nrm[o + 1] = Math.round(wy / len);
        nrm[o + 2] = Math.round(wz / len);
        col[o] = s.col[a] * c0;
        col[o + 1] = s.col[a + 1] * c1;
        col[o + 2] = s.col[a + 2] * c2;
        sun[v + j] = suns[i];
      }
      for (let j = 0; j < s.idx.length; j++) idx[e + j] = s.idx[j] + v;
      v += s.n;
      e += s.idx.length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSun', new THREE.BufferAttribute(sun, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return geo;
  }

  // The geometry of kind k at level of detail l for a tile's instances, with the
  // set's sun attribute. (What the kinds with a far shape are drawn as, near, is
  // in the lists: _source.)
  _geo(k, l, sunAttr) {
    const src = this.lods[k][l];
    const geo = new THREE.BufferGeometry();
    for (const attr of ['position', 'normal', 'color']) geo.setAttribute(attr, src.getAttribute(attr));
    geo.setIndex(src.getIndex());
    geo.setAttribute('aSun', sunAttr);
    return geo;
  }

  // The geometry a slot's lists and casters draw at one of their two levels: the
  // full tree and the three-tier one, or in the block style the block tree
  // built in full and the one built coarse (made when first asked).
  _source(slot, lod) {
    const { k, name } = this._slots.list[slot];
    if (!name) return this.lods[k][lod];
    if (!this.blockLods) this.blockLods = new Map();
    const key = `${FLORA[k]}:${name}`;
    let pair = this.blockLods.get(key);
    if (!pair) {
      const make = BLOCK_TREES[FLORA[k]][name];
      pair = [make(0), make(2)];
      this.blockLods.set(key, pair);
    }
    return pair[lod];
  }

  // How many kinds of tree are standing, counting each block tree of a kind
  // of its own: for the diagnostics.
  kindsShown() {
    const seen = new Set();
    for (const t of this.tiles.values()) {
      t.r.bins.forEach((bin, k) => {
        if (!bin.n) return;
        if (!this.blocky || !BLOCK_NAMES[FLORA[k]]) seen.add(String(k));
        else {
          this._vars(t, k);
          BLOCK_NAMES[FLORA[k]].forEach((_, v) => { if (bin.varsUsed & (1 << v)) seen.add(`${k}:${v}`); });
        }
      });
    }
    return seen.size;
  }

  // The trunks within range of an absolute point, as [x, z, radius, ...] in
  // out (emptied first), from the tiles that are up.
  trunksNear(ax, az, range, out) {
    out.length = 0;
    const i0 = Math.floor((ax - range - 4) / TILE);
    const i1 = Math.floor((ax + range + 4) / TILE);
    const j0 = Math.floor((az - range - 4) / TILE);
    const j1 = Math.floor((az + range + 4) / TILE);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const t = this.tiles.get(i + ':' + j);
        if (!t || !t.trunks) continue;
        const a = t.trunks;
        for (let k = 0; k < a.length; k += 3) {
          const dx = a[k] - ax;
          const dz = a[k + 1] - az;
          const reach = range + a[k + 2];
          if (dx * dx + dz * dz < reach * reach) out.push(a[k], a[k + 1], a[k + 2]);
        }
      }
    }
    return out;
  }

  // The crystals standing within range of an absolute point, as [x, y, z,
  // height, r, g, b, ...] in out (emptied first), from the tiles that are up: the
  // foot of each, how tall it stands and the tint of the tree it is (the colour
  // it glows in is the crystal's own, TREE_CYAN, times it).
  crystalsNear(ax, az, range, out) {
    out.length = 0;
    const k = FLORA.indexOf('crystal');
    const i0 = Math.floor((ax - range) / TILE);
    const i1 = Math.floor((ax + range) / TILE);
    const j0 = Math.floor((az - range) / TILE);
    const j1 = Math.floor((az + range) / TILE);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const t = this.tiles.get(i + ':' + j);
        const bin = t && t.r && t.r.bins[k];
        if (!bin || !bin.n) continue;
        const m = bin.mats;
        for (let n = 0; n < bin.n; n++) {
          const x = t.x0 + m[n * 16 + 12];
          const z = t.z0 + m[n * 16 + 14];
          if ((x - ax) * (x - ax) + (z - az) * (z - az) > range * range) continue;
          out.push(x, m[n * 16 + 13] + 0.5, z, m[n * 16 + 5], bin.cols[n * 3], bin.cols[n * 3 + 1], bin.cols[n * 3 + 2]);
        }
      }
    }
    return out;
  }

  // Trees of blocks, or the trees as they were: every tile's meshes are made
  // again, and the tiles still to come are made so.
  setBlocky(on) {
    if (on === this.blocky) return;
    this.blocky = on;
    this.version++;
    // What the lists and the casters keep a mesh for is not the same.
    for (const set of [...this.lists, ...this.casters]) {
      if (!set) continue;
      for (const m of set) {
        if (!m) continue;
        this.group.remove(m);
        // (A list has a geometry of its own; a block tree's casting mesh draws the shape
        // kept for it, which is made again on the GPU when it is next drawn.)
        if (m.userData.list || m.userData.block) m.geometry.dispose();
        m.dispose();
      }
    }
    this._slots = slotsOf(on);
    this.lists = this._slots.list.map(() => null);
    this.casters = this._slots.list.map(() => null);
    this._picks = this._slots.list.map(() => [[], []]);
    this._castPicks = this._slots.list.map(() => [[], []]);
    this._arr.version = -1;
    this._cast.version = -1;
    // The tiles' own meshes are made again the new way a few at a time, the
    // nearest first (_redo): a tile drawn the old way meanwhile is drawn.
    const v = this.view;
    this._todo = [...this.tiles.entries()]
      .map(([key, t]) => [key, Math.hypot(t.x0 + TILE / 2 - v.x, t.z0 + TILE / 2 - v.z)])
      .sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  }

  // Make the tiles that are drawn the other style's way again, the nearest first,
  // for REDO_MS of a frame (all of them when the world is stepped by hand).
  _redo(all) {
    const todo = this._todo;
    const t0 = performance.now();
    while (todo.length && (all || performance.now() - t0 < REDO_MS)) {
      const t = this.tiles.get(todo.pop());
      if (!t || t.built === this.blocky) continue;
      for (const m of t.meshes) {
        t.group.remove(m);
        release(m);
      }
      t.meshes = [];
      this._fill(t, t.r);
      t.built = this.blocky;
    }
  }

  // A style whose far wood is laid on the land (render/style.js, inkWood) has the trees drawn to this
  // far (m; 0: as far as there are any), the land taking the wood over from there.
  setReach(m) {
    if (m === this.reach) return;
    this.reach = m;
    this.version++;
  }

  // first: the page is starting; returns how many tiles are still to come.
  update(camAbsX, camAbsZ, sync = false, first = false) {
    const r = Math.ceil(FOREST_FAR / TILE) + 1;
    const cx = Math.floor(camAbsX / TILE);
    const cz = Math.floor(camAbsZ / TILE);
    const missing = [];
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        const ix = cx + i;
        const iz = cz + j;
        const d = Math.hypot((ix + 0.5) * TILE - camAbsX, (iz + 0.5) * TILE - camAbsZ);
        if (d > FOREST_FAR + TILE * 0.7) continue;
        const key = ix + ':' + iz;
        if (!this.tiles.has(key) || (!this.holdStale && this.stale.has(key))) missing.push([d, ix, iz, key]);
      }
    }
    missing.sort((a, b) => a[0] - b[0]);
    const t0 = performance.now();
    const ready = (key) => this.tiles.has(key) && (this.holdStale || !this.stale.has(key));
    const put = (key, tile) => {
      const old = this.tiles.get(key);
      if (old) {
        this.group.remove(old.group);
        for (const m of old.meshes) release(m);
        this.trees -= old.count;
        this._touch(old);
      }
      this.stale.delete(key);
      this.tiles.set(key, tile);
    };
    if (sync) {
      this.baking = null;
      for (const [, ix, iz, key] of missing) put(key, this._build(ix, iz));
    } else if (this.bakers && this.bakers.ready) {
      // Planted in the workers (see TerrainField.update).
      this.baking = null;
      const keys = new Set(missing.map((m) => m[3]));
      while (this.done.length && performance.now() - t0 < this.budgetMs) {
        const d = this.done.shift();
        if (this.inflight.get(d.key) !== d.id) continue;
        this.inflight.delete(d.key);
        if (keys.has(d.key) && !ready(d.key)) put(d.key, this._meshes(d.ix, d.iz, d.r));
      }
      for (const [, ix, iz, key] of missing) {
        if (!this.bakers.free) break;
        if (!this.inflight.has(key) && !ready(key)) this._send(ix, iz, key);
      }
    } else {
      this.inflight.clear();
      this.done.length = 0;
      if (this.baking && !missing.some((m) => m[3] === this.baking.key)) this.baking = null;
      let next = 0;
      while (performance.now() - t0 < this.budgetMs) {
        if (!this.baking) {
          while (next < missing.length && ready(missing[next][3])) next++;
          if (next >= missing.length) break;
          const [, ix, iz, key] = missing[next++];
          this.baking = { key, gen: this._bake(ix, iz) };
        }
        const r = this.baking.gen.next();
        if (r.done) {
          put(this.baking.key, r.value);
          this.baking = null;
        }
      }
    }
    for (const [key, t] of this.tiles) {
      const d = Math.hypot(t.x0 + TILE / 2 - camAbsX, t.z0 + TILE / 2 - camAbsZ);
      if (d > FOREST_FAR + TILE * 2) {
        this.group.remove(t.group);
        for (const m of t.meshes) release(m);
        this.trees -= t.count;
        this.tiles.delete(key);
        this.stale.delete(key);
        this._touch(t);
      }
    }
    this._redo(sync);
    return first ? missing.filter((m) => !ready(m[3])).length : missing.length;
  }

  // Which of the tiles' meshes are drawn, for the lens as it is now (camera,
  // and height: the picture's height in pixels): each tile is drawn at the
  // level of detail its distance gives (for a kind that has a far shape, by
  // the size its trees are on the screen), or not at all where the near land
  // hides it (hz, render/horizon.js). Fresh, the tiles are asked of hz, which
  // was begun for this frame; not fresh, hz was begun for a lens a little way
  // off, and the tiles it hid are hid still. Last, the trees that cast into
  // the sun's shadow map.
  arrange(camera, height, hz, twisted = false, fresh = true) {
    const o = this.origin;
    const cx = camera.position.x + o.x;
    const cz = camera.position.z + o.z;
    // How many pixels a metre makes at a metre.
    const k = height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const v = this.view;
    v.x = cx;
    v.z = cz;
    v.k = k;
    const det = this.detail;
    // Where each kind that has a far shape goes over to it, m from the lens to
    // the nearest edge of a tile (squared; -1 for a kind that has none); it is
    // drawn to where the trees end.
    const lim2 = this._lim2;
    for (let i = 0; i < lim2.length; i++) {
      const h = H_REF[FLORA[i]];
      if (h) {
        const l = ((h * k) / (NO_MID[FLORA[i]] ? NEAR_OF[FLORA[i]] || NEAR_PX : MID_PX)) * det;
        lim2[i] = l * l;
      } else {
        lim2[i] = -1;
      }
    }
    const end = (this.reach || FOREST_FAR) + TILE * 0.7;
    const end2 = end * end;
    const near2 = NEAR * det * NEAR * det;
    const mid2 = MID * det * MID * det;
    const reach2 = SHADOW_REACH * SHADOW_REACH;
    const f = this.focus;
    const asked = hz && hz.ok;
    let changed = false;
    let hidden = 0;
    for (const t of this.tiles.values()) {
      const meshes = t.meshes;
      if (!meshes.length) continue;
      const ex = Math.max(t.x0 - cx, 0, cx - (t.x0 + TILE));
      const ez = Math.max(t.z0 - cz, 0, cz - (t.z0 + TILE));
      const dn2 = ex * ex + ez * ez;
      const mx = t.x0 + TILE / 2 - cx;
      const mz = t.z0 + TILE / 2 - cz;
      const dc2 = mx * mx + mz * mz;
      if (asked && fresh) t.gone = hz.hiddenTile(t.x0 - o.x - PAD, t.z0 - o.z - PAD, TILE + 2 * PAD, t.r.ymax, t.tops, 4);
      else if (!asked) t.gone = false;
      const gone = t.gone;
      if (gone) hidden++;
      // How far the tile's nearest edge is from where the shadow map is.
      let reaches = true;
      if (f) {
        const sx = Math.max(t.x0 - f.x, 0, f.x - (t.x0 + TILE));
        const sz = Math.max(t.z0 - f.z, 0, f.z - (t.z0 + TILE));
        reaches = sx * sx + sz * sz < reach2;
      }
      if (!t.modes) t.modes = [];
      for (let i = 0; i < meshes.length; i++) {
        const m = meshes[i];
        const u = m.userData;
        const l2 = lim2[u.kind];
        if (l2 >= 0) {
          // The trees come from the lists up to lim, then it is the far shape.
          const mode = gone ? 3 : dn2 < l2 ? 0 : dn2 < end2 ? 1 : 2;
          m.visible = mode === 1;
          if (t.modes[u.kind] !== mode) {
            // Only a tile that has trees in the lists, or is to have, changes them.
            if (t.modes[u.kind] === 0 || mode === 0) changed = true;
            t.modes[u.kind] = mode;
          }
        } else {
          const lod = dc2 < near2 ? 0 : dc2 < mid2 ? 1 : dc2 < end2 ? 2 : -1;
          m.visible = !gone && u.lod === lod;
          if (m.isInstancedMesh) m.castShadow = reaches && u.lod < 2;
        }
      }
    }
    this.hidden = hidden;
    // The lists are made again as the lens moves a little, turns a little,
    // or a tile's trees change over from one way of being drawn to the other.
    const a = this._arr;
    const e = camera.matrixWorld.elements;
    const p = camera.position;
    const mdx = p.x - a.x;
    const mdy = p.y - a.y;
    const mdz = p.z - a.z;
    if (changed || a.version !== this.version || a.det !== det || a.twisted !== twisted || a.blocky !== this.blocky
      || Math.abs(k - a.k) > 0.05 * a.k || Math.abs(camera.fov - a.fov) > 0.4 || camera.aspect !== a.aspect
      || mdx * mdx + mdy * mdy + mdz * mdz > LIST_MOVE * LIST_MOVE
      || -e[8] * a.fx - e[9] * a.fy - e[10] * a.fz < LIST_TURN || e[4] * a.ux + e[5] * a.uy + e[6] * a.uz < LIST_TURN) {
      a.version = this.version;
      a.det = det;
      a.twisted = twisted;
      a.blocky = this.blocky;
      a.fov = camera.fov;
      a.aspect = camera.aspect;
      a.k = k;
      a.x = p.x;
      a.y = p.y;
      a.z = p.z;
      a.fx = -e[8];
      a.fy = -e[9];
      a.fz = -e[10];
      a.ux = e[4];
      a.uy = e[5];
      a.uz = e[6];
      this._viewLists(camera, twisted);
    }
    this._casters(camera);
  }

  // The trees of the tiles that are drawn from lists, those the lens can see
  // (not tested where the world is wound: every one there is), at the level
  // their size on the screen gives: the full tree from NEAR_PX pixels, the
  // three-tier tree under it. A tree is tested by its crown's sphere, grown
  // for the lens moving and turning a little before the lists are made again.
  _viewLists(camera, twisted) {
    const lists = this.lists;
    const o = this.origin;
    const v = this.view;
    const det = this.detail;
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _fr.setFromProjectionMatrix(_pv);
    // The frustum's planes as numbers: a normal and a constant each.
    const P = this._planes;
    for (let i = 0; i < 6; i++) {
      const pl = _fr.planes[i];
      P[i * 4] = pl.normal.x;
      P[i * 4 + 1] = pl.normal.y;
      P[i * 4 + 2] = pl.normal.z;
      P[i * 4 + 3] = pl.constant;
    }
    const camx = camera.position.x;
    const camz = camera.position.z;
    const vk = v.k;
    const near = this._near;
    for (let i = 0; i < near.length; i++) near[i] = (NEAR_OF[FLORA[i]] || NEAR_PX) / det;
    const picks = this._picks;
    const slotBase = this._slots.base;
    for (const pair of picks) {
      pair[0].length = 0;
      pair[1].length = 0;
    }
    for (const t of this.tiles.values()) {
      if (!t.modes) continue;
      const bx = t.x0 - o.x;
      const bz = t.z0 - o.z;
      if (!twisted) {
        // The tile's own sphere, for all of it at once.
        const rise = (t.r.ymax - t.r.ymin) / 2;
        const rad = Math.sqrt(TILE * TILE / 2 + rise * rise) + 18;
        const sx = bx + TILE / 2;
        const sy = (t.r.ymin + t.r.ymax) / 2;
        const sz = bz + TILE / 2;
        let seen = true;
        for (let q = 0; q < 24; q += 4) {
          if (P[q] * sx + P[q + 1] * sy + P[q + 2] * sz + P[q + 3] < -rad) {
            seen = false;
            break;
          }
        }
        if (!seen) continue;
      }
      for (let k = 0; k < t.r.bins.length; k++) {
        if (t.modes[k] !== 0) continue;
        const bin = t.r.bins[k];
        const mats = bin.mats;
        const crowns = crownsOf(bin);
        const nk = near[k];
        // (In the block style each tree goes to the list of its own block tree.)
        const vars = this.blocky && BLOCK_NAMES[FLORA[k]] ? this._vars(t, k) : null;
        const first = slotBase[k];
        for (let i = 0; i < bin.n; i++) {
          const q4 = i * 4;
          const tx = bx + crowns[q4];
          const tz = bz + crowns[q4 + 2];
          const dx = tx - camx;
          const dz = tz - camz;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (!twisted) {
            // The crown's sphere, and a margin of metres and of angle.
            const rad = crowns[q4 + 3] + LIST_PAD + LIST_ANGLE * dist;
            const ty = crowns[q4 + 1];
            let out = false;
            for (let q = 0; q < 24; q += 4) {
              if (P[q] * tx + P[q + 1] * ty + P[q + 2] * tz + P[q + 3] < -rad) {
                out = true;
                break;
              }
            }
            if (out) continue;
          }
          picks[vars ? first + vars[i] : first][mats[i * 16 + 5] * vk >= nk * (dist > 1 ? dist : 1) ? 0 : 1].push(t, i);
        }
      }
    }
    for (let slot = 0; slot < picks.length; slot++) {
      const k = this._slots.list[slot].k;
      for (let lod = 0; lod < 2; lod++) {
        const list = picks[slot][lod];
        const n = list.length / 2;
        if (!n && !(lists[slot] && lists[slot][lod])) continue;
        const mesh = this._list(slot, lod, n);
        const geo = mesh.geometry;
        const outM = mesh.instanceMatrix.array;
        const outS = geo.getAttribute('aSun').array;
        const outC = mesh.instanceColor.array;
        for (let j = 0; j < n; j++) {
          const t = list[j * 2];
          const i = list[j * 2 + 1];
          const bin = t.r.bins[k];
          const m = i * 16;
          const w = j * 16;
          for (let e = 0; e < 16; e++) outM[w + e] = bin.mats[m + e];
          outM[w + 12] = t.x0 - o.x + bin.mats[m + 12];
          outM[w + 14] = t.z0 - o.z + bin.mats[m + 14];
          outS[j] = bin.suns[i];
          outC[j * 3] = bin.cols[i * 3];
          outC[j * 3 + 1] = bin.cols[i * 3 + 1];
          outC[j * 3 + 2] = bin.cols[i * 3 + 2];
        }
        mesh.count = n;
        mesh.visible = n > 0;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
        geo.getAttribute('aSun').needsUpdate = true;
      }
    }
  }

  // A slot's mesh for the lens, at a level of detail, with room for n trees.
  _list(slot, lod, n) {
    let set = this.lists[slot];
    if (!set) set = this.lists[slot] = [null, null];
    let mesh = set[lod];
    if (mesh && mesh.userData.cap >= n) return mesh;
    if (mesh) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      mesh.dispose();
    }
    const cap = Math.max(64, Math.ceil(n * 1.5));
    const { k, name } = this._slots.list[slot];
    const src = this._source(slot, lod);
    const geo = new THREE.BufferGeometry();
    for (const attr of ['position', 'normal', 'color']) geo.setAttribute(attr, src.getAttribute(attr));
    geo.setIndex(src.getIndex());
    geo.setAttribute('aSun', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
    mesh = new THREE.InstancedMesh(geo, this.material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.count = 0;
    mesh.userData.cap = cap;
    mesh.userData.lod = lod;
    mesh.userData.kind = k;
    mesh.userData.variant = name;
    mesh.userData.list = true;
    this.group.add(mesh);
    set[lod] = mesh;
    return mesh;
  }

  // The trees that cast into the sun's shadow map, as lists: of each kind that
  // has a far shape, the trees the map's frustum takes in (grown by a few
  // metres for the car's moving on), the full tree for those that are big on
  // the screen and the three-tier tree for the rest. They are drawn into the
  // map and nowhere else (their count is nothing but while the map is drawn),
  // so no tile is drawn whole into it. Made again when the car or the lens
  // has moved some metres, the sun has turned, or the tiles have changed.
  _casters(camera) {
    const L = this.light;
    const f = this.focus;
    const c = this._cast;
    if (!L || !f) {
      for (const set of this.casters) if (set) for (const m of set) if (m) m.userData.n = 0;
      c.version = -1;
      return;
    }
    const v = this.view;
    _dir.copy(L.position).sub(L.target.position).normalize();
    const fdx = f.x - c.fx;
    const fdz = f.z - c.fz;
    const vdx = v.x - c.vx;
    const vdz = v.z - c.vz;
    if (c.version === this.version && c.detail === this.detail && fdx * fdx + fdz * fdz < 16
      && vdx * vdx + vdz * vdz < 64 && _dir.dot(c.sun) > 0.9999 && Math.abs(v.k - c.k) < 0.08 * c.k) return;
    c.version = this.version;
    c.detail = this.detail;
    c.fx = f.x;
    c.fz = f.z;
    c.vx = v.x;
    c.vz = v.z;
    c.k = v.k;
    c.sun.copy(_dir);
    const o = this.origin;
    // The map's own axes, as the light looks at its target.
    _m.lookAt(L.position, L.target.position, L.up);
    _m.extractBasis(_bx, _by, _bz);
    const half = L.shadow.camera.right + 6;
    const det = this.detail;
    const lx = L.position.x;
    const ly = L.position.y;
    const lz = L.position.z;
    const lists = this._castPicks;
    const slotBase = this._slots.base;
    for (const pair of lists) {
      pair[0].length = 0;
      pair[1].length = 0;
    }
    // Where a kind's tree goes over to the three-tier one, in metres per metre of its height.
    const nearM = this._near;
    for (let i = 0; i < nearM.length; i++) nearM[i] = (v.k / (NEAR_OF[FLORA[i]] || NEAR_PX)) * det;
    for (const t of this.tiles.values()) {
      const nx = Math.max(t.x0 - f.x, 0, f.x - (t.x0 + TILE));
      const nz = Math.max(t.z0 - f.z, 0, f.z - (t.z0 + TILE));
      if (nx * nx + nz * nz > 250 * 250) continue;
      const bx = t.x0 - o.x;
      const bz = t.z0 - o.z;
      // The tile's own sphere against the map's prism, for all of it at once.
      const tdx = bx + TILE / 2 - lx;
      const tdy = (t.r.ymin + t.r.ymax) / 2 - ly;
      const tdz = bz + TILE / 2 - lz;
      const rise = (t.r.ymax - t.r.ymin) / 2;
      const reach = half + Math.sqrt(TILE * TILE / 2 + rise * rise) + 24;
      if (Math.abs(tdx * _bx.x + tdy * _bx.y + tdz * _bx.z) > reach || Math.abs(tdx * _by.x + tdy * _by.y + tdz * _by.z) > reach) continue;
      for (let k = 0; k < t.r.bins.length; k++) {
        const bin = t.r.bins[k];
        if (!bin.n || !bin.far) continue;
        const mats = bin.mats;
        const crowns = crownsOf(bin);
        const nm = nearM[k];
        // (In the block style every tree of a kind casts the shadow of the kind's first coarse block tree:
        // one casting mesh to a kind, not one to each block tree.)
        const blocks = this.blocky && !!BLOCK_NAMES[FLORA[k]];
        const first = slotBase[k];
        for (let i = 0; i < bin.n; i++) {
          const q4 = i * 4;
          const tx = bx + crowns[q4];
          const tz = bz + crowns[q4 + 2];
          const dx = tx - lx;
          const dy = crowns[q4 + 1] - ly;
          const dz = tz - lz;
          const rho = crowns[q4 + 3] + 1;
          if (Math.abs(dx * _bx.x + dy * _bx.y + dz * _bx.z) > half + rho
            || Math.abs(dx * _by.x + dy * _by.y + dz * _by.z) > half + rho) continue;
          const ex = tx + o.x - v.x;
          const ez = tz + o.z - v.z;
          lists[first][blocks || !(Math.sqrt(ex * ex + ez * ez) < mats[i * 16 + 5] * nm) ? 1 : 0].push(t, i);
        }
      }
    }
    for (let slot = 0; slot < lists.length; slot++) {
      const k = this._slots.list[slot].k;
      for (let lod = 0; lod < 2; lod++) {
        const list = lists[slot][lod];
        const n = list.length / 2;
        if (!n && !(this.casters[slot] && this.casters[slot][lod])) continue;
        const mesh = this._caster(slot, lod, n);
        const out = mesh.instanceMatrix.array;
        for (let j = 0; j < n; j++) {
          const t = list[j * 2];
          const m = list[j * 2 + 1] * 16;
          const mats = t.r.bins[k].mats;
          const w = j * 16;
          for (let e = 0; e < 16; e++) out[w + e] = mats[m + e];
          out[w + 12] = t.x0 - o.x + mats[m + 12];
          out[w + 14] = t.z0 - o.z + mats[m + 14];
        }
        mesh.userData.n = n;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  // A slot's casting mesh at a level of detail with room for n trees.
  _caster(slot, lod, n) {
    let set = this.casters[slot];
    if (!set) set = this.casters[slot] = [null, null];
    let mesh = set[lod];
    if (mesh && mesh.instanceMatrix.count >= n) return mesh;
    if (mesh) {
      this.group.remove(mesh);
      mesh.dispose();
    }
    const cap = Math.max(64, Math.ceil(n * 1.5));
    mesh = new THREE.InstancedMesh(this._source(slot, lod), this.material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // As the tiles' meshes have it, so the same programs are drawn with.
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.count = 0;
    mesh.userData.n = 0;
    mesh.userData.caster = true;
    mesh.userData.block = !!this._slots.list[slot].name;
    mesh.onBeforeShadow = function () { this.count = this.userData.n; };
    mesh.onAfterShadow = function () { this.count = 0; };
    this.group.add(mesh);
    set[lod] = mesh;
    return mesh;
  }

  // New road was committed through ground some tiles were planted on.
  invalidate(ax0, az0, ax1, az1) {
    const hit = (x0, z0) => !(x0 > ax1 + 50 || x0 + TILE < ax0 - 50 || z0 > az1 + 50 || z0 + TILE < az0 - 50);
    for (const key of [...this.inflight.keys()]) {
      const [ix, iz] = key.split(':').map(Number);
      if (hit(ix * TILE, iz * TILE)) this.inflight.delete(key);
    }
    for (const [key, t] of this.tiles) {
      if (!hit(t.x0, t.z0)) continue;
      this.group.remove(t.group);
      for (const m of t.meshes) release(m);
      this.trees -= t.count;
      this.tiles.delete(key);
      this.stale.delete(key);
      this._touch(t);
    }
  }

  // Mark the tiles test(x0, z0, size) picks to be planted again, drawn as
  // they are until then (as the terrain's, see TerrainField.markStale).
  markStale(test) {
    for (const [key, t] of this.tiles) if (test(t.x0, t.z0, TILE)) this.stale.add(key);
    for (const key of [...this.inflight.keys()]) {
      const [ix, iz] = key.split(':').map(Number);
      if (test(ix * TILE, iz * TILE, TILE)) this.inflight.delete(key);
    }
    if (this.baking) {
      const [ix, iz] = this.baking.key.split(':').map(Number);
      if (test(ix * TILE, iz * TILE, TILE)) this.baking = null;
    }
  }
}
