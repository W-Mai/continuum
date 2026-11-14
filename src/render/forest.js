// The forest near the camera, instanced per 160 m tile: spruce, broadleaf,
// stone pine, cactus, crystal or kelp, whichever the world grows
// (world/vegetation.js).
//
// Trees are placed on a jittered grid wherever vegetation.js says the canopy
// grows, standing on the land the road has shaped (corridor.js), so none ends
// up in a cutting, on a fill or on the asphalt. Each kind has three levels of
// detail: tiles near the camera draw the full tree, the next ring a simpler
// one (both cast shadows), farther tiles the simplest; past FAR the terrain
// paints the canopy itself from the same density function.
//
// Each tree carries how much sun reaches it past the ridges, from the same ray
// march the terrain and road use, so a stand in a valley's shadow is dark.

import * as THREE from 'three';
import { withAtmosphere, withSunMask } from './atmosphere.js';
import { FLORA } from '../world/vegetation.js';
import { plantTrees, forestBox, FOREST_TILE } from '../world/bakery.js';

const TILE = FOREST_TILE;
const NEAR = 190;           // tile centres closer than this draw the full tree
const MID = 330;            // ...closer than this a three-tier tree
export const FOREST_FAR = 1000;

const srgb = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

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
  const cyan = srgb(0x58d6e0);
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

// Each kind of tree: its three levels of detail; its height and crown width
// are TREE_SIZE's (world/vegetation.js), shared with the worker that plants.
const KINDS = {
  spruce: { lod: () => [spruceGeometry(7, 8), spruceGeometry(3, 7), spruceGeometry(1, 6)] },
  broadleaf: { lod: () => [broadleafGeometry(2), broadleafGeometry(1), broadleafGeometry(0)] },
  pine: { lod: () => [pineGeometry(2), pineGeometry(1), pineGeometry(0)] },
  cactus: { lod: () => [cactusGeometry(2), cactusGeometry(1), cactusGeometry(0)] },
  crystal: { lod: () => [crystalGeometry(2), crystalGeometry(1), crystalGeometry(0)], glow: true },
  kelp: { lod: () => [kelpGeometry(2), kelpGeometry(1), kelpGeometry(0)], sway: true },
};

// --- trees of blocks (the block style, render/style.js) ---------------------
//
// The same trees, in the same places and sizes (an instance's matrix sets
// both), built of boxes instead: a trunk of one block, leaves in layers of
// blocks. One block is 0.055 of a tree's height, so a tall tree has bigger
// ones: not cubes of a metre as a block world has them, but they read as
// cubes. Each box is a shade of its own, as the picture on each block of a
// leaf is.

const BLK = 0.055;

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
  face([0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]);
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
  box(b, -BLK / 2, 0, -BLK / 2, BLK / 2, 0.34, BLK / 2, bark, 0.9);
  const n = detail === 2 ? 5 : 15;
  const y0 = 0.12;
  const step = (1 - y0) / n;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const r = Math.max(0, Math.round(4 * Math.pow(1 - t, 0.9) - (i % 2) + 0.4));
    layer(b, y0 + i * step, y0 + (i + 1) * step, detail === 2 ? Math.round(4 * (1 - t)) : r, leaf, i);
  }
  return b.done();
}

// Oak: a trunk and a crown of a few thick layers.
function blockOak(detail) {
  const b = builder();
  const bark = srgb(0x6b4b2c);
  const leaf = srgb(0x3d7d2c);
  box(b, -BLK / 2, 0, -BLK / 2, BLK / 2, 0.52, BLK / 2, bark, 0.9);
  const rows = detail === 2 ? [[0.4, 0.62, 3], [0.62, 0.78, 2]] : [[0.4, 0.51, 3], [0.51, 0.62, 3], [0.62, 0.73, 2], [0.73, 0.84, 1]];
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

const BLOCKY = { spruce: blockSpruce, broadleaf: blockOak, pine: blockPine, cactus: blockCactus };

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
    this.blocky = false;       // trees of blocks, for the block style (setBlocky)
    this.blockLods = null;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
    // A style may light the leaves in clumps (render/style.js).
    mat.userData.styleClump = true;
    this.material = withSunMask(withAtmosphere(mat), true);
    // Crystals light themselves: their vertex colour is also their glow.
    const glow = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.1 });
    glow.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor * 1.6;');
    };
    glow.customProgramCacheKey = () => 'continuum-crystal';
    this.glowMaterial = withSunMask(withAtmosphere(glow), true);
    // Kelp sways in the current, more the higher up the ribbon; the phase
    // runs across the bed with the plant's place in it, and along the ribbon.
    const kelp = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
    const sway = this.sway = { value: 0 };
    kelp.onBeforeCompile = (shader) => {
      shader.uniforms.uSway = sway;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uSway;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
float kPhase = instanceMatrix[3].x * 0.071 + instanceMatrix[3].z * 0.053 + (position.x + position.z) * 5.0;
#else
float kPhase = (position.x + position.z) * 5.0;
#endif
float kBend = transformed.y * transformed.y;
transformed.x += kBend * 0.14 * sin(uSway * 0.8 + kPhase);
transformed.z += kBend * 0.09 * sin(uSway * 0.6 + kPhase * 1.3 + 1.7);`);
    };
    kelp.customProgramCacheKey = () => 'continuum-kelp';
    this.kelpMaterial = withSunMask(withAtmosphere(kelp), true);
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

  // A tile's instanced meshes from its planted arrays: per kind of tree one
  // set of instances (matrices, sun, tint) drawn at each level of detail.
  _meshes(ix, iz, r) {
    const x0 = ix * TILE;
    const z0 = iz * TILE;
    const group = new THREE.Group();
    group.position.set(x0 - this.origin.x, 0, z0 - this.origin.z);
    const tile = { x0, z0, group, meshes: [], count: r.count, trunks: trunksOf(r, x0, z0) };
    const sphere = new THREE.Sphere(
      new THREE.Vector3(TILE / 2, (r.ymin + r.ymax) / 2, TILE / 2),
      Math.hypot(TILE / 2, TILE / 2, (r.ymax - r.ymin) / 2) + 4,
    );
    for (let k = 0; k < r.bins.length; k++) {
      const bin = r.bins[k];
      if (!bin.n) continue;
      const matrix = new THREE.InstancedBufferAttribute(bin.mats, 16);
      const sunAttr = new THREE.InstancedBufferAttribute(bin.suns, 1);
      const colAttr = new THREE.InstancedBufferAttribute(bin.cols, 3);
      const kind = this.kinds[k];
      const material = kind.glow ? this.glowMaterial : kind.sway ? this.kelpMaterial : this.material;
      const lods = this.lods[k];
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
        mesh.userData.sun = sunAttr;
        group.add(mesh);
        tile.meshes.push(mesh);
      }
    }
    this.group.add(group);
    this.trees += r.count;
    return tile;
  }

  // The geometry of kind k at level of detail l for one tile's instances:
  // the tree's, or its block-built twin, with the tile's sun attribute.
  _geo(k, l, sunAttr) {
    if (this.blocky && !this.blockLods) {
      this.blockLods = FLORA.map((name, i) => (BLOCKY[name] ? [0, 1, 2].map((d) => BLOCKY[name](d)) : this.lods[i]));
    }
    const src = (this.blocky ? this.blockLods : this.lods)[k][l];
    const geo = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color']) geo.setAttribute(name, src.getAttribute(name));
    geo.setIndex(src.getIndex());
    geo.setAttribute('aSun', sunAttr);
    return geo;
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

  // Trees of blocks, or the trees as they were: every tile's meshes change
  // their geometry, and the tiles still to come are made so.
  setBlocky(on) {
    if (on === this.blocky) return;
    this.blocky = on;
    for (const t of this.tiles.values()) {
      for (const m of t.meshes) {
        const old = m.geometry;
        m.geometry = this._geo(m.userData.kind, m.userData.lod, m.userData.sun);
        m.geometry.boundingSphere = m.boundingSphere;
        old.dispose();
      }
    }
  }

  update(camAbsX, camAbsZ, sync = false) {
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
        for (const m of old.meshes) m.geometry.dispose();
        this.trees -= old.count;
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
        for (const m of t.meshes) m.geometry.dispose();
        this.trees -= t.count;
        this.tiles.delete(key);
        this.stale.delete(key);
        continue;
      }
      if (!t.meshes.length) continue;
      const lod = d < NEAR * this.detail ? 0 : d < MID * this.detail ? 1 : d < FOREST_FAR + TILE * 0.7 ? 2 : -1;
      for (const m of t.meshes) m.visible = m.userData.lod === lod;
    }
    return missing.length;
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
      for (const m of t.meshes) m.geometry.dispose();
      this.trees -= t.count;
      this.tiles.delete(key);
      this.stale.delete(key);
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
