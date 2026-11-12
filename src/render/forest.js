// The forest near the camera, instanced per 160 m tile: spruce, broadleaf,
// stone pine or cactus, whichever the world grows (world/vegetation.js).
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
import { sunVisibility } from '../world/sunlight.js';
import { hash2 } from '../world/noise.js';
import { FLORA } from '../world/vegetation.js';

const TILE = 160;
const SPACING = 5.0;
const NEAR = 190;           // tile centres closer than this draw the full tree
const MID = 330;            // ...closer than this a three-tier tree
export const FOREST_FAR = 1000;
const SUNGRID = 5;

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

// Each kind of tree: its three levels of detail, its height and crown width.
const KINDS = {
  spruce: { lod: () => [spruceGeometry(7, 8), spruceGeometry(3, 7), spruceGeometry(1, 6)],
    height: (r, d) => (12 + 16 * r * r) * (0.7 + 0.3 * d), width: (h, r) => h * (0.85 + 0.4 * r) },
  broadleaf: { lod: () => [broadleafGeometry(2), broadleafGeometry(1), broadleafGeometry(0)],
    height: (r, d) => (9 + 9 * r * r) * (0.75 + 0.25 * d), width: (h, r) => h * (1.0 + 0.45 * r) },
  pine: { lod: () => [pineGeometry(2), pineGeometry(1), pineGeometry(0)],
    height: (r) => 9 + 7 * r, width: (h, r) => h * (0.95 + 0.35 * r) },
  cactus: { lod: () => [cactusGeometry(2), cactusGeometry(1), cactusGeometry(0)],
    height: (r) => 3.2 + 4 * r, width: (h, r) => h * (0.9 + 0.3 * r) },
};

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
    this.sunDir = new THREE.Vector3(0.5, 0.6, 0.5).normalize();
    this.tiles = new Map();
    this.budgetMs = opts.budgetMs || 2;
    this.baking = null;
    this.kinds = FLORA.map((k) => KINDS[k]);
    this.lods = this.kinds.map((k) => k.lod());
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
    this.material = withSunMask(withAtmosphere(mat), true);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._c = new THREE.Color();
    this._out = {};
    this.trees = 0;
  }

  setSun(dir) {
    this.sunDir.copy(dir).normalize();
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
  *_bake(ix, iz) {
    const x0 = ix * TILE;
    const z0 = iz * TILE;
    const land = this.land;
    const ctx = this.corridor.prepare(x0, z0, TILE, 16);
    const out = this._out;
    // Sun on a coarse grid at crown height, interpolated per tree.
    const sun = new Float32Array(SUNGRID * SUNGRID);
    for (let j = 0; j < SUNGRID; j++) {
      for (let i = 0; i < SUNGRID; i++) {
        const sx = x0 + (i / (SUNGRID - 1)) * TILE;
        const sz = z0 + (j / (SUNGRID - 1)) * TILE;
        sun[j * SUNGRID + i] = sunVisibility(land, sx, sz, land.heightAtCoarse(sx, sz) + 9, this.sunDir);
      }
    }
    const N = Math.round(TILE / SPACING);
    // Per kind of tree: instance matrices, sun and tint.
    const per = this.kinds.map(() => ({ mats: [], suns: [], cols: [] }));
    const seed = this.seed;
    let ymin = Infinity;
    let ymax = -Infinity;
    for (let gj = 0; gj < N; gj++) {
      for (let gi = 0; gi < N; gi++) {
        const ci = ix * N + gi;
        const cj = iz * N + gj;
        const ax = x0 + (gi + 0.1 + 0.8 * hash2(ci, cj, seed)) * SPACING;
        const az = z0 + (gj + 0.1 + 0.8 * hash2(ci, cj, seed + 1)) * SPACING;
        const nat = land.heightAt(ax, az);
        const hx = land.heightAt(ax + 2, az) - nat;
        const hz = land.heightAt(ax, az + 2) - nat;
        const slope = 1 - 1 / Math.sqrt(1 + (hx * hx + hz * hz) / 4);
        this.corridor.shape(ctx, ax, az, nat, out);
        const d = this.veg.density(ax, az, out.h, slope, out.near, out.cut, out.fill);
        if (hash2(ci, cj, seed + 2) >= d) continue;
        const sp = this.veg.species ? this.veg.species(ax, az, hash2(ci, cj, seed + 8)) : 0;
        const kind = this.kinds[sp];
        const bin = per[sp];
        const r3 = hash2(ci, cj, seed + 3);
        const height = kind.height(r3, d);
        const width = kind.width(height, hash2(ci, cj, seed + 4));
        this._p.set(ax - x0, out.h - 0.5, az - z0);
        this._q.setFromAxisAngle(this._up, hash2(ci, cj, seed + 5) * Math.PI * 2);
        this._s.set(width, height, width);
        this._m.compose(this._p, this._q, this._s);
        bin.mats.push(...this._m.elements);
        const fx = ((ax - x0) / TILE) * (SUNGRID - 1);
        const fz = ((az - z0) / TILE) * (SUNGRID - 1);
        const i0 = Math.min(SUNGRID - 2, Math.floor(fx));
        const j0 = Math.min(SUNGRID - 2, Math.floor(fz));
        const tx = fx - i0;
        const tz = fz - j0;
        const a = sun[j0 * SUNGRID + i0] * (1 - tx) + sun[j0 * SUNGRID + i0 + 1] * tx;
        const b = sun[(j0 + 1) * SUNGRID + i0] * (1 - tx) + sun[(j0 + 1) * SUNGRID + i0 + 1] * tx;
        bin.suns.push(a * (1 - tz) + b * tz);
        // Per-tree tint: a few blue-green, a few olive, the odd yellowing one.
        const hue = hash2(ci, cj, seed + 6);
        const v = 0.72 + 0.34 * hash2(ci, cj, seed + 7);
        this._c.setRGB(v * (0.92 + 0.16 * hue), v, v * (1.06 - 0.16 * hue));
        bin.cols.push(this._c.r, this._c.g, this._c.b);
        ymin = Math.min(ymin, out.h - 1);
        ymax = Math.max(ymax, out.h + height);
      }
      if ((gj & 7) === 7) yield;
    }
    const group = new THREE.Group();
    group.position.set(x0 - this.origin.x, 0, z0 - this.origin.z);
    const count = per.reduce((n, p) => n + p.suns.length, 0);
    const tile = { x0, z0, group, meshes: [], count };
    const sphere = new THREE.Sphere(
      new THREE.Vector3(TILE / 2, (ymin + ymax) / 2, TILE / 2),
      Math.hypot(TILE / 2, TILE / 2, (ymax - ymin) / 2) + 4,
    );
    for (let k = 0; k < per.length; k++) {
      const bin = per[k];
      const n = bin.suns.length;
      if (!n) continue;
      const matrix = new THREE.InstancedBufferAttribute(new Float32Array(bin.mats), 16);
      const sunAttr = new THREE.InstancedBufferAttribute(new Float32Array(bin.suns), 1);
      const colAttr = new THREE.InstancedBufferAttribute(new Float32Array(bin.cols), 3);
      const lods = this.lods[k];
      for (let l = 0; l < lods.length; l++) {
        const src = lods[l];
        const geo = new THREE.BufferGeometry();
        for (const name of ['position', 'normal', 'color']) geo.setAttribute(name, src.getAttribute(name));
        geo.setIndex(src.getIndex());
        geo.setAttribute('aSun', sunAttr);
        const mesh = new THREE.InstancedMesh(geo, this.material, n);
        mesh.instanceMatrix = matrix;
        mesh.instanceColor = colAttr;
        mesh.boundingSphere = sphere;
        mesh.geometry.boundingSphere = sphere;
        mesh.castShadow = l < 2;
        mesh.receiveShadow = l < 2;
        mesh.visible = false;
        mesh.matrixAutoUpdate = false;
        mesh.userData.lod = l;
        group.add(mesh);
        tile.meshes.push(mesh);
      }
    }
    this.group.add(group);
    this.trees += count;
    return tile;
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
        if (!this.tiles.has(key)) missing.push([d, ix, iz, key]);
      }
    }
    missing.sort((a, b) => a[0] - b[0]);
    const t0 = performance.now();
    if (sync) {
      this.baking = null;
      for (const [, ix, iz, key] of missing) this.tiles.set(key, this._build(ix, iz));
    } else {
      if (this.baking && !missing.some((m) => m[3] === this.baking.key)) this.baking = null;
      let next = 0;
      while (performance.now() - t0 < this.budgetMs) {
        if (!this.baking) {
          while (next < missing.length && this.tiles.has(missing[next][3])) next++;
          if (next >= missing.length) break;
          const [, ix, iz, key] = missing[next++];
          this.baking = { key, gen: this._bake(ix, iz) };
        }
        const r = this.baking.gen.next();
        if (r.done) {
          this.tiles.set(this.baking.key, r.value);
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
        continue;
      }
      if (!t.meshes.length) continue;
      const lod = d < NEAR ? 0 : d < MID ? 1 : d < FOREST_FAR + TILE * 0.7 ? 2 : -1;
      for (const m of t.meshes) m.visible = m.userData.lod === lod;
    }
    return missing.length;
  }

  // New road was committed through ground some tiles were planted on.
  invalidate(ax0, az0, ax1, az1) {
    for (const [key, t] of this.tiles) {
      if (t.x0 > ax1 + 50 || t.x0 + TILE < ax0 - 50 || t.z0 > az1 + 50 || t.z0 + TILE < az0 - 50) continue;
      this.group.remove(t.group);
      for (const m of t.meshes) m.geometry.dispose();
      this.trees -= t.count;
      this.tiles.delete(key);
    }
  }
}
