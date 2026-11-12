// The city's towers: boxes on a street grid that runs the way the road set
// out, instanced per 768 m tile out to 3.6 km from the camera.
//
// A lot every 46 m; most hold a building, parks hold none (the trees grow
// there, world/vegetation.js). Heights rise toward the downtown clusters and
// shrink to nothing across the city's borders, so the skyline grows out of
// the plain as the road comes in. No building stands within reach of the
// road: every corner of a footprint is checked against the road's own
// corridor (world/corridor.js). Tall towers carry a setback crown.
//
// Windows are drawn in the shader from where a pixel is on the facade, in
// metres, so they line up with each building's edges at any size: a grid of
// floors and bays, some lit warm, some cool, the street floor lit as shops.
// Where a window would be smaller than a few pixels the grid gives way to its
// average, so a far skyline is a soft glow and not a shimmer.

import * as THREE from 'three';
import { withAtmosphere } from './atmosphere.js';
import { hash2 } from '../world/noise.js';
import { WORLD_INDEX, makeSkyline } from '../world/worlds.js';

const TILE = 768;
const FAR = 3600;
const LOT = 46;
const CITY = WORLD_INDEX.city;
const lotKey = (i, j) => (i + 1048576) * 2097152 + (j + 1048576);

const srgb = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
const FACADES = [0x8e8b85, 0x9b8f7c, 0x3a4652, 0x4d6177, 0x7c5848, 0xb6b2a9, 0x5f6266, 0x2e3640].map(srgb);

// A unit box standing on y = 0, without a floor.
function boxGeometry() {
  const pos = [];
  const nrm = [];
  const idx = [];
  const face = (corners, n) => {
    const b = pos.length / 3;
    for (const c of corners) {
      pos.push(...c);
      nrm.push(...n);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const h = 0.5;
  face([[-h, 0, h], [h, 0, h], [h, 1, h], [-h, 1, h]], [0, 0, 1]);
  face([[h, 0, -h], [-h, 0, -h], [-h, 1, -h], [h, 1, -h]], [0, 0, -1]);
  face([[h, 0, h], [h, 0, -h], [h, 1, -h], [h, 1, h]], [1, 0, 0]);
  face([[-h, 0, -h], [-h, 0, h], [-h, 1, h], [-h, 1, -h]], [-1, 0, 0]);
  face([[-h, 1, h], [h, 1, h], [h, 1, -h], [-h, 1, -h]], [0, 1, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

export const windowGlow = { value: 1.25 };

function makeMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.05 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindow = windowGlow;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aBld;
varying vec3 vBox;
varying vec3 vBoxN;
varying vec3 vSize;
varying vec2 vBld;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vBox = position;
vBoxN = normal;
vBld = aBld;
vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uWindow;
varying vec3 vBox;
varying vec3 vBoxN;
varying vec3 vSize;
varying vec2 vBld;
vec3 tGlow;
float tGlass;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  float roof = step(0.5, vBoxN.y);
  // Metres across the face and up it.
  vec2 fc = vec2(abs(vBoxN.x) > 0.5 ? (vBox.z + 0.5) * vSize.z : (vBox.x + 0.5) * vSize.x, vBox.y * vSize.y);
  vec2 bay = vec2(3.2, 3.6);
  vec2 cell = floor(fc / bay);
  vec2 f = fract(fc / bay);
  float win = step(0.16, f.x) * step(f.x, 0.84) * step(0.24, f.y) * step(f.y, 0.86);
  float px = max(fwidth(fc.x / bay.x), fwidth(fc.y / bay.y));
  float detail = 1.0 - smoothstep(0.3, 0.7, px);
  win = mix(0.42, win, detail);
  float faceSeed = dot(vBoxN, vec3(1.7, 0.0, 2.3)) + vBld.x * 37.0;
  float h = fract(sin(dot(cell + faceSeed, vec2(12.9898, 78.233))) * 43758.5453);
  float lit = mix(vBld.y, step(h, vBld.y), detail);
  float street = (1.0 - step(4.2, fc.y)) * step(0.6, fc.y) * (1.0 - roof);
  float parapet = step(vSize.y - 2.2, fc.y);
  win *= (1.0 - roof) * (1.0 - parapet) * step(4.2, fc.y);
  vec3 warm = vec3(1.0, 0.62, 0.3);
  vec3 cool = vec3(0.62, 0.78, 1.0);
  vec3 wc = mix(warm, cool, step(0.72, fract(h * 7.31)));
  // The street floor is shop glass, bay by bay, dimly lit.
  float shop = street * step(0.07, f.x) * step(f.x, 0.93) * step(0.3, fract(h * 3.7));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.025, 0.03, 0.04), max(win, street) * 0.8);
  tGlass = max(win, street);
  // A lit room is brighter toward its ceiling.
  float room = 0.55 + 0.45 * smoothstep(0.24, 0.86, f.y);
  tGlow = (wc * win * lit * mix(0.8, room, detail) + warm * shop * 0.14) * uWindow;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.18, tGlass);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += tGlow;`);
  };
  mat.customProgramCacheKey = () => 'continuum-city';
  return withAtmosphere(mat);
}

export class City {
  constructor(scene, land, corridor, seed, opts = {}) {
    this.land = land;
    this.corridor = corridor;
    this.seed = seed;
    this.worlds = land.worlds;
    this.skyline = makeSkyline(seed);
    this.group = new THREE.Group();
    this.group.name = 'city';
    scene.add(this.group);
    this.origin = { x: 0, z: 0 };
    this.far = FAR;              // how far towers are built and drawn (setDetail)
    this.geo = boxGeometry();
    this.material = makeMaterial();
    this.tiles = new Map();
    // Every baked building by its lot, in grid coordinates, so a camera can
    // ask whether a point is inside one: [along, lat, half along, half lat,
    // bottom, top] for the block and its crown.
    this.lots = new Map();
    this.budgetMs = opts.budgetMs || 2;
    this.baking = null;
    this.stale = new Set();      // tiles to build again, drawn until then (markStale)
    this.holdStale = false;
    this.buildings = 0;
    this._out = {};
    this._w = { a: 0, b: 0, t: 0, u: 0 };
    this._uv = { along: 0, lat: 0 };
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  setOrigin(x, z) {
    this.origin.x = x;
    this.origin.z = z;
    for (const t of this.tiles.values()) t.group.position.set(t.x0 - x, 0, t.z0 - z);
  }

  // How much of a point is city, 0..1.
  share(ax, az) {
    const w = this.worlds.at(ax, az, this._w);
    return (w.a === CITY ? 1 - w.t : 0) + (w.b === CITY ? w.t : 0);
  }

  // Whether an absolute point is inside a building. Every building stands
  // inside its own lot, so one lot is all there is to look at.
  solidAt(ax, y, az) {
    if (!this.lots.size) return false;
    const uv = this.worlds.axisUV(ax, az, this._uv);
    const boxes = this.lots.get(lotKey(Math.floor(uv.along / LOT), Math.floor(uv.lat / LOT)));
    if (!boxes) return false;
    for (const b of boxes) {
      if (y > b[4] && y < b[5] && Math.abs(uv.along - b[0]) < b[2] && Math.abs(uv.lat - b[1]) < b[3]) return true;
    }
    return false;
  }

  *_bake(ix, iz) {
    const x0 = ix * TILE;
    const z0 = iz * TILE;
    const tile = { x0, z0, group: new THREE.Group(), count: 0, mesh: null, lots: [] };
    tile.group.position.set(x0 - this.origin.x, 0, z0 - this.origin.z);
    // Most of the map is not city: test the corners and centre first.
    let any = 0;
    for (const [fx, fz] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) any = Math.max(any, this.share(x0 + fx * TILE, z0 + fz * TILE));
    if (any < 0.02) return tile;
    yield;

    const map = this.worlds;
    const dx = map.dx;
    const dz = map.dz;
    const angle = -Math.atan2(dz, dx);
    // The tile's corners in grid coordinates (along, across the city's axis).
    const uv = this._uv;
    let a0 = Infinity;
    let a1 = -Infinity;
    let l0 = Infinity;
    let l1 = -Infinity;
    for (const [cx, cz] of [[x0, z0], [x0 + TILE, z0], [x0, z0 + TILE], [x0 + TILE, z0 + TILE]]) {
      map.axisUV(cx, cz, uv);
      a0 = Math.min(a0, uv.along);
      a1 = Math.max(a1, uv.along);
      l0 = Math.min(l0, uv.lat);
      l1 = Math.max(l1, uv.lat);
    }
    const ctx = this.corridor.prepare(x0 - 40, z0 - 40, TILE + 80, 32);
    const out = this._out;
    const mats = [];
    const cols = [];
    const blds = [];
    const seed = this.seed;
    let ymax = 0;
    const put = (cx, cy, cz, w, h, d, rot, col, bseed, lit) => {
      this._p.set(cx - x0, cy, cz - z0);
      this._q.setFromAxisAngle(this._up, rot);
      this._s.set(w, h, d);
      this._m.compose(this._p, this._q, this._s);
      mats.push(...this._m.elements);
      cols.push(col.r, col.g, col.b);
      blds.push(bseed, lit);
      ymax = Math.max(ymax, cy + h);
    };
    for (let i = Math.floor(a0 / LOT); i <= Math.ceil(a1 / LOT); i++) {
      for (let j = Math.floor(l0 / LOT); j <= Math.ceil(l1 / LOT); j++) {
        // The lot's centre, back in absolute coordinates.
        const ga = (i + 0.5) * LOT + (hash2(i, j, seed + 11) - 0.5) * 6;
        const gl = (j + 0.5) * LOT + (hash2(i, j, seed + 12) - 0.5) * 6;
        const cx = map.ox + ga * dx - gl * dz;
        const cz = map.oz + ga * dz + gl * dx;
        if (cx < x0 || cx >= x0 + TILE || cz < z0 || cz >= z0 + TILE) continue;
        const share = this.share(cx, cz);
        if (share < 0.05 || hash2(i, j, seed + 13) > 0.9) continue;
        if (this.skyline.park(cx, cz) > 0.25) continue;
        const r1 = hash2(i, j, seed + 14);
        const r2 = hash2(i, j, seed + 15);
        const r3 = hash2(i, j, seed + 16);
        const r4 = hash2(i, j, seed + 17);
        const w = 16 + 22 * r1;
        const d = 16 + 22 * r2;
        const core = this.skyline.core(cx, cz);
        const tower = core * core * (50 + 170 * r4 * r4) * (0.75 + 0.25 * this.skyline.block(cx, cz));
        const h = (9 + 26 * r3 * r3 + Math.max(0, tower)) * share;
        if (h < 4) continue;
        // Clear of the road at every corner, with room to spare at the centre.
        const rot = angle + (r3 > 0.85 ? Math.PI / 2 : 0);
        const cr = Math.cos(rot);
        const sr = Math.sin(rot);
        let clear = true;
        let base = Infinity;
        for (const [ox, oz] of [[0, 0], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
          const px = cx + (ox * w) * cr + (oz * d) * sr;
          const pz = cz - (ox * w) * sr + (oz * d) * cr;
          this.corridor.shape(ctx, px, pz, this.land.heightAt(px, pz), out);
          if (out.near < (ox === 0 && oz === 0 ? 30 : 13)) {
            clear = false;
            break;
          }
          base = Math.min(base, out.h);
        }
        if (!clear) continue;
        const col = FACADES[Math.floor(hash2(i, j, seed + 18) * FACADES.length)];
        const bseed = hash2(i, j, seed + 19);
        const lit = 0.18 + 0.4 * hash2(i, j, seed + 20);
        put(cx, base - 0.6, cz, w, h + 0.6, d, rot, col, bseed, lit);
        // A crown: a setback storey block on the taller towers.
        const crown = h * (0.06 + 0.1 * r1);
        if (h > 60) put(cx, base + h, cz, w * 0.68, crown, d * 0.68, rot, col, bseed + 0.5, lit * 0.8);
        // The same boxes for the cameras, in grid coordinates: the block's
        // width runs along the grid unless it is turned a quarter.
        const ha = (r3 > 0.85 ? d : w) / 2;
        const hl = (r3 > 0.85 ? w : d) / 2;
        const boxes = [[ga, gl, ha, hl, base - 0.6, base + h]];
        if (h > 60) boxes.push([ga, gl, ha * 0.68, hl * 0.68, base + h, base + h + crown]);
        tile.lots.push([lotKey(i, j), boxes]);
      }
      yield;
    }
    const n = blds.length / 2;
    tile.count = n;
    if (n) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', this.geo.getAttribute('position'));
      geo.setAttribute('normal', this.geo.getAttribute('normal'));
      geo.setIndex(this.geo.getIndex());
      geo.setAttribute('aBld', new THREE.InstancedBufferAttribute(new Float32Array(blds), 2));
      const mesh = new THREE.InstancedMesh(geo, this.material, n);
      mesh.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(mats), 16);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cols), 3);
      const sphere = new THREE.Sphere(new THREE.Vector3(TILE / 2, ymax / 2, TILE / 2), Math.hypot(TILE / 2, TILE / 2, ymax / 2) + 40);
      mesh.boundingSphere = sphere;
      geo.boundingSphere = sphere;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      tile.group.add(mesh);
      tile.mesh = mesh;
      this.buildings += n;
    }
    for (const [key, boxes] of tile.lots) this.lots.set(key, boxes);
    this.group.add(tile.group);
    return tile;
  }

  update(camAbsX, camAbsZ, sync = false) {
    const r = Math.ceil(this.far / TILE) + 1;
    const cx = Math.floor(camAbsX / TILE);
    const cz = Math.floor(camAbsZ / TILE);
    const missing = [];
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        const ix = cx + i;
        const iz = cz + j;
        const d = Math.hypot((ix + 0.5) * TILE - camAbsX, (iz + 0.5) * TILE - camAbsZ);
        if (d > this.far + TILE * 0.7) continue;
        const key = ix + ':' + iz;
        if (!this.tiles.has(key) || (!this.holdStale && this.stale.has(key))) missing.push([d, ix, iz, key]);
      }
    }
    missing.sort((a, b) => a[0] - b[0]);
    const t0 = performance.now();
    const ready = (key) => this.tiles.has(key) && (this.holdStale || !this.stale.has(key));
    // A tile baked again replaces the old one; the new one has already put
    // its lots in, so only the old lots it no longer has are taken out.
    const put = (key, tile) => {
      const old = this.tiles.get(key);
      if (old) {
        this.group.remove(old.group);
        if (old.mesh) old.mesh.geometry.dispose();
        const kept = new Set(tile.lots.map(([k]) => k));
        for (const [k] of old.lots) if (!kept.has(k)) this.lots.delete(k);
        this.buildings -= old.count;
      }
      this.stale.delete(key);
      this.tiles.set(key, tile);
    };
    if (sync) {
      this.baking = null;
      for (const [, ix, iz, key] of missing) {
        const gen = this._bake(ix, iz);
        let res = gen.next();
        while (!res.done) res = gen.next();
        put(key, res.value);
      }
    } else {
      if (this.baking && !missing.some((m) => m[3] === this.baking.key)) this.baking = null;
      let next = 0;
      while (performance.now() - t0 < this.budgetMs) {
        if (!this.baking) {
          while (next < missing.length && ready(missing[next][3])) next++;
          if (next >= missing.length) break;
          const [, ix, iz, key] = missing[next++];
          this.baking = { key, gen: this._bake(ix, iz) };
        }
        const res = this.baking.gen.next();
        if (res.done) {
          put(this.baking.key, res.value);
          this.baking = null;
        }
      }
    }
    for (const [key, t] of this.tiles) {
      const d = Math.hypot(t.x0 + TILE / 2 - camAbsX, t.z0 + TILE / 2 - camAbsZ);
      if (d > FAR + TILE * 2) {
        this.group.remove(t.group);
        if (t.mesh) t.mesh.geometry.dispose();
        for (const [k] of t.lots) this.lots.delete(k);
        this.buildings -= t.count;
        this.tiles.delete(key);
        this.stale.delete(key);
        continue;
      }
      t.group.visible = d <= this.far + TILE * 0.7;
    }
  }

  // Mark the tiles test(x0, z0, size) picks to be built again, drawn as
  // they are until then (as the terrain's, see TerrainField.markStale).
  markStale(test) {
    for (const [key, t] of this.tiles) if (test(t.x0, t.z0, TILE)) this.stale.add(key);
    if (this.baking) {
      const [ix, iz] = this.baking.key.split(':').map(Number);
      if (test(ix * TILE, iz * TILE, TILE)) this.baking = null;
    }
  }

  // At lower quality the skyline is drawn less far (to 60% of the full
  // 3.6 km); tiles already built stay, hidden, in case it comes back.
  setDetail(f) {
    this.far = FAR * Math.max(0.6, Math.min(1, f));
  }
}
