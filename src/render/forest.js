// Spruce forest near the camera, instanced per 160 m tile.
//
// Trees are placed on a jittered grid wherever vegetation.js says the canopy
// grows, standing on the land the road has shaped (corridor.js), so none ends
// up in a cutting, on a fill or on the asphalt. Tiles near the camera draw a
// seven-tier tree, the next ring a three-tier one (both cast shadows), farther
// tiles a single cone; past FAR the terrain paints the canopy itself from the
// same density function.
//
// Each tree carries how much sun reaches it past the ridges, from the same ray
// march the terrain and road use, so a stand in a valley's shadow is dark.

import * as THREE from 'three';
import { withAtmosphere, withSunMask } from './atmosphere.js';
import { sunVisibility } from '../world/sunlight.js';
import { hash2 } from '../world/noise.js';

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
    this.budgetMs = opts.budgetMs || 3;
    this.lod = [spruceGeometry(7, 8), spruceGeometry(3, 7), spruceGeometry(1, 6)];
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
    const mats = [];
    const suns = [];
    const cols = [];
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
        const r3 = hash2(ci, cj, seed + 3);
        const height = (12 + 16 * r3 * r3) * (0.7 + 0.3 * d);
        const width = height * (0.85 + 0.4 * hash2(ci, cj, seed + 4));
        this._p.set(ax - x0, out.h - 0.5, az - z0);
        this._q.setFromAxisAngle(this._up, hash2(ci, cj, seed + 5) * Math.PI * 2);
        this._s.set(width, height, width);
        this._m.compose(this._p, this._q, this._s);
        mats.push(...this._m.elements);
        const fx = ((ax - x0) / TILE) * (SUNGRID - 1);
        const fz = ((az - z0) / TILE) * (SUNGRID - 1);
        const i0 = Math.min(SUNGRID - 2, Math.floor(fx));
        const j0 = Math.min(SUNGRID - 2, Math.floor(fz));
        const tx = fx - i0;
        const tz = fz - j0;
        const a = sun[j0 * SUNGRID + i0] * (1 - tx) + sun[j0 * SUNGRID + i0 + 1] * tx;
        const b = sun[(j0 + 1) * SUNGRID + i0] * (1 - tx) + sun[(j0 + 1) * SUNGRID + i0 + 1] * tx;
        suns.push(a * (1 - tz) + b * tz);
        // Per-tree tint: a few blue-green, a few olive, the odd yellowing one.
        const hue = hash2(ci, cj, seed + 6);
        const v = 0.72 + 0.34 * hash2(ci, cj, seed + 7);
        this._c.setRGB(v * (0.92 + 0.16 * hue), v, v * (1.06 - 0.16 * hue));
        cols.push(this._c.r, this._c.g, this._c.b);
        ymin = Math.min(ymin, out.h - 1);
        ymax = Math.max(ymax, out.h + height);
      }
    }
    const group = new THREE.Group();
    group.position.set(x0 - this.origin.x, 0, z0 - this.origin.z);
    const count = suns.length;
    const tile = { x0, z0, group, meshes: [], count };
    if (count) {
      const matrix = new THREE.InstancedBufferAttribute(new Float32Array(mats), 16);
      const sunAttr = new THREE.InstancedBufferAttribute(new Float32Array(suns), 1);
      const colAttr = new THREE.InstancedBufferAttribute(new Float32Array(cols), 3);
      const sphere = new THREE.Sphere(
        new THREE.Vector3(TILE / 2, (ymin + ymax) / 2, TILE / 2),
        Math.hypot(TILE / 2, TILE / 2, (ymax - ymin) / 2) + 4,
      );
      for (let l = 0; l < this.lod.length; l++) {
        const src = this.lod[l];
        const geo = new THREE.BufferGeometry();
        for (const name of ['position', 'normal', 'color']) geo.setAttribute(name, src.getAttribute(name));
        geo.setIndex(src.getIndex());
        geo.setAttribute('aSun', sunAttr);
        const mesh = new THREE.InstancedMesh(geo, this.material, count);
        mesh.instanceMatrix = matrix;
        mesh.instanceColor = colAttr;
        mesh.boundingSphere = sphere;
        mesh.geometry.boundingSphere = sphere;
        mesh.castShadow = l < 2;
        mesh.receiveShadow = l < 2;
        mesh.visible = false;
        mesh.matrixAutoUpdate = false;
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
    for (const [, ix, iz, key] of missing) {
      if (!sync && performance.now() - t0 > this.budgetMs) break;
      this.tiles.set(key, this._build(ix, iz));
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
      for (let l = 0; l < t.meshes.length; l++) t.meshes[l].visible = l === lod;
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
