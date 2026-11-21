// The light a crystal lays on the floor: a pool of its own colour round each
// cluster, as wide as three times the cluster is tall, and half as bright at
// its middle as the crystal glows, falling away with the square of the
// distance (the light of a point does not stop at a radius: past the pool's
// own it goes on fading, to nothing by twice as far). Added on, as a lamp's
// pool on the road is (render/roadmesh.js): one buffer for all of them, rings of
// triangles to a pool laid on the ground it falls on.
//
// The crystals are the cavern's (the small ones that lie about the ground,
// render/clutter.js, and the ones that grow as trees, render/forest.js). A
// pool is laid for each of those in the picture (a pool whose disc is in the
// lens's view), as many as the tier allows, the ones that look biggest from the
// lens (a pool's radius over its distance) when there are more; one that goes
// out of the picture keeps its pool for a short while, so that a turn of the lens
// does not make them flicker. Each keeps the heights of the ground under it once
// they are found, so that the ring of triangles hugs it, and the ground under the
// nearest crystals is found before the lens turns toward them.
//
// In the painted style a pool is a flat ellipse of one colour with a clear
// edge and a soft ring past it, as the lamps' are; in the block style it is
// square.

import * as THREE from 'three';
import { twistU, TWIST_PARS } from './twist.js';
import { styleU } from './style.js';
import { atmo } from './atmosphere.js';
import { TREE_CYAN } from './crystals.js';
import { CAVERN } from '../world/cavernplan.js';

// radius: a pool's radius over the height of its crystals; level: its colour at
// the middle, over what the crystal glows in; glow: what a crystal glows in, over
// its colour (render/clutter.js, render/forest.js); max: the most pools drawn at
// each tier; tree: how far off the crystals that grow as trees are looked for
// (m); clutterH: the height of a cluster that lies about the ground, at the
// size one (render/clutter.js); lift: how far over the ground the pool lies (m); fadeFrom, gone: where
// the crystals on the ground begin to fade out and are gone (m; render/clutter.js); keep: how many
// frames a pool stays after its crystal has left the picture; build: how many pools have the ground under them found
// in one choice (the rest are found in the next, a frame or two after).

// core: how far from the middle a pool is half as bright as it is there, over its radius, in the real style
// (past it the light falls with the square of the distance); reach: how far the light goes, over the radius.
export const POOLS = { radius: 3, level: 0.5, glow: 1.6, max: { high: 80, mid: 40, low: 0 }, tree: 500, clutterH: 0.75, lift: 0.06, fadeFrom: 62, gone: 84, keep: 30, core: 0.3, reach: 2, build: 3 };

// The painted style's pool: an ellipse with a clear edge (out to this share of the
// pool's square radius) in one flat colour, a ring past it as bright as this at its
// edge, fading out, and the level the colour is laid at.
const PAINT = { edge: 0.5, ring: 0.3, level: 0.8 };

// The most crystals looked at together.
const CAP = 1024;

// The middle, and three rings of points, each at its share of the pool's reach.
const RINGS = [[0, 1], [8, 0.35], [16, 0.7], [16, 1]];
const VERTS = RINGS.reduce((n, [k]) => n + (k || 1), 0);
const TRIS = 8 + 24 + 32;

const colours = new Map();
const lin = (hex) => {
  let c = colours.get(hex);
  if (!c) colours.set(hex, c = new THREE.Color().setHex(hex, THREE.SRGBColorSpace));
  return c;
};

// The unit offsets of a pool's vertices (over its reach) and the triangles over them (the same for every pool).
const OFFSETS = (() => {
  const o = [[0, 0]];
  for (const [n, r] of RINGS.slice(1)) for (let k = 0; k < n; k++) o.push([Math.cos((k / n) * Math.PI * 2) * r, Math.sin((k / n) * Math.PI * 2) * r]);
  return o;
})();
const INDEX = (() => {
  const idx = [];
  for (let k = 0; k < 8; k++) idx.push(0, 1 + k, 1 + ((k + 1) % 8));
  // ring 1 (8 points) to ring 2 (16): each of its edges has three triangles
  for (let k = 0; k < 8; k++) {
    const a = 1 + k;
    const b = 1 + ((k + 1) % 8);
    const c = 9 + 2 * k;
    const d = 9 + 2 * k + 1;
    const e = 9 + ((2 * k + 2) % 16);
    idx.push(a, c, d, a, d, b, b, d, e);
  }
  // ring 2 to ring 3 (16 each): a quad to each edge
  for (let k = 0; k < 16; k++) {
    const a = 9 + k;
    const b = 9 + ((k + 1) % 16);
    const c = 25 + k;
    const d = 25 + ((k + 1) % 16);
    idx.push(a, c, b, b, c, d);
  }
  return idx;
})();

function poolMaterial(shared) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
    uniforms: { ...twistU, uPair: styleU.uPair, uPaintInv: styleU.uPaintInv, uBlock: shared.uBlock, fogParams: atmo.fogParams },
    vertexShader: /* glsl */`
${TWIST_PARS}
attribute vec3 aPool;
attribute vec3 aTint;
uniform float uBlock;
uniform vec3 fogParams;
varying vec2 vPool;
varying vec3 vTint;
void main() {
  float k = mix(1.0, 1.4142, uBlock);
  vec3 p = position;
  p.xz += aPool.xy * aPool.z * (k - 1.0);
  vPool = aPool.xy * k;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vec4 mv = viewMatrix * wp;
  vTint = aTint * exp(-max(-mv.z, 0.0) * fogParams.x);
  gl_Position = projectionMatrix * twistView( mv );
}`,
    fragmentShader: /* glsl */`
uniform float uPair;
uniform float uPaintInv;
uniform float uBlock;
varying vec2 vPool;
varying vec3 vTint;
void main() {
  float r2 = dot(vPool, vPool);
  vec2 q = abs(vPool);
  r2 = mix(r2, max(q.x, q.y) * max(q.x, q.y), uBlock);
  // The real style's light: the square of the distance (from a core of ${POOLS.core.toFixed(2)} of the radius), to nothing by ${POOLS.reach.toFixed(1)} times as far.
  float win = max(0.0, 1.0 - r2 / ${(POOLS.reach * POOLS.reach).toFixed(2)});
  vec3 c = vTint * ( win * win / ( 1.0 + r2 / ${(POOLS.core * POOLS.core).toFixed(3)} ) );
  if (uPair > 0.0) {
    // The painted style's pool: an ellipse with a clear edge, one flat colour as it
    // comes out on the screen, and past the edge a ring that is soft.
    float e = fwidth(r2) * 1.2 + 1e-4;
    float disc = 1.0 - smoothstep(${PAINT.edge.toFixed(2)} - e, ${PAINT.edge.toFixed(2)} + e, r2);
    float ring = ${PAINT.ring.toFixed(2)} * (1.0 - smoothstep(${PAINT.edge.toFixed(2)}, 1.0, r2));
    c = mix(c, vTint * mix(ring, 1.0, disc) * ${PAINT.level.toFixed(2)} * uPaintInv, uPair);
  }
  gl_FragColor = vec4(c, 1.0);
}`,
  });
}

export class CrystalPools {
  // env: clutter (its cells), forest (crystalsNear), groundAt(x, z) (local), world index.
  constructor(scene, env, shared) {
    this.env = env;
    const max = POOLS.max.high;
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * VERTS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.pool = new THREE.BufferAttribute(new Float32Array(max * VERTS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.tint = new THREE.BufferAttribute(new Float32Array(max * VERTS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('aPool', this.pool);
    geo.setAttribute('aTint', this.tint);
    const idx = new Uint16Array(max * TRIS * 3);
    const index = new THREE.BufferAttribute(idx, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setIndex(index);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    geo.setDrawRange(0, 0);
    this.material = poolMaterial(shared);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.scene = scene;
    this.count = 0;                  // the pools that are drawn
    this.found = 0;                  // the crystals there were to make pools of, of the last choice
    this.list = [];                  // and what each is: { x, z (absolute), y, r, tint: [r, g, b], height, kind }
    this._trees = [];
    const f = (n) => new Float32Array(n);
    this._c = { x: new Float64Array(CAP), z: new Float64Array(CAP), y: f(CAP), h: f(CAP), r: f(CAP), g: f(CAP), b: f(CAP), k: new Uint8Array(CAP), d: f(CAP), score: f(CAP), key: new Float64Array(CAP) };
    this._picks = new Uint16Array(CAP);
    this._heights = new Map();       // by place: the ground under a pool's vertices, kept
    this._slots = new Array(max).fill(null);     // the place each slot of the buffer holds a pool of
    this._sig = new Array(max).fill('');         // and what was written there (its brightness and the origin)
    this._index = index;
    this._written = false;
    this._seen = new Map();          // by place: the frame its crystal was last in the picture
    this._frustum = new THREE.Frustum();
    this._pv = new THREE.Matrix4();
    this._ball = new THREE.Sphere();
    this._dir = new THREE.Vector3(0, 0, -1);
    this._look = new THREE.Vector3();
    this._pt = new THREE.Vector3();
    this._frame = 0;
    this._pending = 0;               // pools whose ground is yet to be found
    this._dirty = true;
    this._origin = 0;                // changes with the floating origin
    this._last = { x: 1e9, z: 1e9 };
    this._tier = '';
  }

  // The floating origin has moved: what is laid out is laid out again.
  shift() {
    this._dirty = true;
    this._origin++;
  }

  // The crystals of the cavern within reach of an absolute point, in the arrays the pools are chosen
  // from: x, z, y (the foot), height, the colour they glow in (r, g, b) and the kind (0 the clutter's,
  // 1 a tree's). Returns how many.
  _gather(ax, az) {
    const C = this._c;
    let n = 0;
    const put = (x, z, y, h, r, g, b, kind) => {
      if (n >= CAP) return;
      C.x[n] = x;
      C.z[n] = z;
      C.y[n] = y;
      C.h[n] = h;
      C.r[n] = r;
      C.g[n] = g;
      C.b[n] = b;
      C.k[n] = kind;
      n++;
    };
    for (const cell of this.env.clutter.cells.values()) {
      for (const it of cell.items) {
        if (it.kind !== 'crystal' || it.world !== CAVERN) continue;
        const c = lin(it.colour);
        put(it.x, it.z, it.y, POOLS.clutterH * it.size, c.r, c.g, c.b, 0);
      }
    }
    const trees = this.env.forest.crystalsNear(ax, az, POOLS.tree, this._trees);
    const base = lin(TREE_CYAN);
    for (let i = 0; i < trees.length; i += 7) put(trees[i], trees[i + 2], trees[i + 1], trees[i + 3], base.r * trees[i + 4], base.g * trees[i + 5], base.b * trees[i + 6], 1);
    return n;
  }

  // The ground under the vertices of a pool (nominal radius r, its reach): found once. The outer ring
  // (where the light is gone) takes the heights of the ring inside it.
  _ground(c, r) {
    const key = c.key;
    let e = this._heights.get(key);
    if (!e) {
      const o = this.env.origin();
      const h = new Float32Array(VERTS);
      for (let v = 0; v < VERTS - RINGS[3][0]; v++) h[v] = this.env.groundAt(c.x - o.x + OFFSETS[v][0] * r, c.z - o.z + OFFSETS[v][1] * r);
      for (let v = VERTS - RINGS[3][0]; v < VERTS; v++) h[v] = h[v - RINGS[3][0]];
      e = { h, used: 0 };
      this._heights.set(key, e);
    }
    e.used = this._frame;
    return e;
  }

  // Every frame in the cavern (on: it is within reach). tier: 'high', 'mid', 'low'.
  // settle: the clock is standing still (the photo mode): everything there is to find is found at once.
  update(camera, on, tier, shown = true, settle = false) {
    const mesh = this.mesh;
    const max = POOLS.max[tier] || 0;
    if (!on || !shown || max === 0) {
      if (mesh.visible) {
        mesh.visible = false;
        this.count = 0;
        this.list.length = 0;
      }
      this._dirty = true;
      return;
    }
    const o = this.env.origin();
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    this._frame++;
    // The set is chosen again every few frames (every other frame while the ground under some pool is still
    // to be found), or when the lens has gone on or turned, the origin has moved or the tier has changed.
    const look = camera.getWorldDirection(this._look);
    const moved = Math.hypot(ax - this._last.x, az - this._last.z) > 2 || look.dot(this._dir) < 0.9994;
    const due = this._pending > 0 ? this._frame % 2 === 0 : this._frame % 8 === 0;
    if (!settle && !this._dirty && !moved && this._tier === tier && !due) return;
    this._dir.copy(look);
    this._tier = tier;
    this._last.x = ax;
    this._last.z = az;
    const total = this._gather(ax, az);
    const C = this._c;
    const picks = this._picks;
    let wantedN = 0;
    camera.updateMatrixWorld();
    this._pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._pv);
    const slotKeys = new Set(this._slots);
    for (let i = 0; i < total; i++) {
      const d = Math.hypot(C.x[i] - ax, C.z[i] - az);
      C.d[i] = d;
      const r = POOLS.radius * C.h[i];
      const key = Math.round(C.x[i] * 4 + 4e6) * 8388608 + Math.round(C.z[i] * 4 + 4e6);
      C.key[i] = key;
      // In the picture: the pool's disc, as a ball about its middle. (A crystal on the ground is gone by 84 m:
      // the clutter does not draw it, so it has no pool.)
      let wanted = !(C.k[i] === 0 && d >= POOLS.gone) && this._frustum.intersectsSphere(this._ball.set(this._pt.set(C.x[i] - o.x, C.y[i], C.z[i] - o.z), r));
      if (wanted) this._seen.set(key, this._frame);
      else if (!(C.k[i] === 0 && d >= POOLS.gone) && slotKeys.has(key) && this._frame - (this._seen.get(key) || 0) < POOLS.keep) wanted = true;
      C.score[i] = wanted ? r / Math.max(d, 4) : -1;
      if (wanted) picks[wantedN++] = i;
    }
    // (Only those wanted are put in order: the biggest to the lens first.)
    const sorted = picks.subarray(0, wantedN).sort((a, b) => C.score[b] - C.score[a]);
    const reach = wantedN;
    this.found = reach;
    const cand = [];
    for (let i = 0; i < Math.min(max, reach); i++) {
      const j = sorted[i];
      cand.push({
        x: C.x[j], z: C.z[j], y: C.y[j], height: C.h[j], r: POOLS.radius * C.h[j], dist: C.d[j], kind: C.k[j],
        tint: [C.r[j], C.g[j], C.b[j]], key: C.key[j],
      });
    }
    // The pools wanted keep the slots they have; the rest of the slots are let go, and the pools new
    // to the set are given them, the ground under each found first (as many as POOLS.build at a time).
    const take = cand;
    const kept = new Set(take.map((c) => c.key));
    const free = [];
    for (let i = 0; i < this._slots.length; i++) {
      if (this._slots[i] !== null && !kept.has(this._slots[i])) {
        this._slots[i] = null;
        this._sig[i] = '';
      }
      if (this._slots[i] === null) free.push(i);
    }
    const slotOf = new Map();
    this._slots.forEach((key, i) => key !== null && slotOf.set(key, i));
    let built = 0;
    let waiting = 0;
    const budget = settle ? Infinity : POOLS.build;
    const list = [];
    for (const c of take) {
      let slot = slotOf.get(c.key);
      if (slot === undefined) {
        // (not drawn before the ground under it is found)
        if (!this._heights.has(c.key)) {
          if (built >= budget) {
            waiting++;
            continue;
          }
          built++;
        }
        slot = free.shift();
        if (slot === undefined) continue;
        this._slots[slot] = c.key;
        slotOf.set(c.key, slot);
      }
      const g = this._ground(c, c.r * POOLS.reach);
      const fade = 1 - Math.min(1, Math.max(0, (c.dist - POOLS.fadeFrom) / (POOLS.gone - POOLS.fadeFrom))) * (c.kind === 0 ? 1 : 0);
      const level = POOLS.level * POOLS.glow * fade;
      const sig = Math.round(fade * 64) + ':' + this._origin;
      if (this._sig[slot] !== sig) {
        this._sig[slot] = sig;
        for (let v = 0; v < VERTS; v++) {
          const k = slot * VERTS + v;
          this.pos.setXYZ(k, c.x - o.x + OFFSETS[v][0] * c.r * POOLS.reach, g.h[v] + POOLS.lift, c.z - o.z + OFFSETS[v][1] * c.r * POOLS.reach);
          this.pool.setXYZ(k, OFFSETS[v][0] * POOLS.reach, OFFSETS[v][1] * POOLS.reach, c.r);
          this.tint.setXYZ(k, c.tint[0] * level, c.tint[1] * level, c.tint[2] * level);
        }
        this._written = true;
      }
      list.push({ x: c.x, z: c.z, y: c.y, r: c.r, height: c.height, tint: c.tint, kind: c.kind, slot });
    }
    // The slots in use are drawn: their triangles, in the order of the slots, are the index buffer's first.
    const n = list.length;
    const used = list.map((e) => e.slot).sort((a, b) => a - b);
    const idx = this._index.array;
    for (let i = 0; i < n; i++) for (let k = 0; k < TRIS * 3; k++) idx[i * TRIS * 3 + k] = used[i] * VERTS + INDEX[k];
    this._index.needsUpdate = true;
    // The ground under the nearest crystals that are not in the picture is found, one a time the picture's own
    // did not need, for the lens to turn to them.
    if (built === 0) {
      for (let i = 0; i < total; i++) {
        if (C.score[i] > 0 || C.d[i] > 70 || this._heights.has(C.key[i])) continue;
        this._ground({ x: C.x[i], z: C.z[i], key: C.key[i] }, POOLS.radius * C.h[i] * POOLS.reach);
        break;
      }
    }
    this.list = list;
    this.count = n;
    this._pending = waiting;
    this._dirty = false;
    if (this._written) {
      for (const a of [this.pos, this.pool, this.tint]) a.needsUpdate = true;
      this._written = false;
    }
    this.mesh.geometry.setDrawRange(0, n * TRIS * 3);
    mesh.visible = n > 0;
    // The ground kept is the ground of the places lately near.
    if (this._heights.size > 260) for (const [k, e] of this._heights) if (this._frame - e.used > 900) this._heights.delete(k);
    if (this._seen.size > 600) for (const [k, f] of this._seen) if (this._frame - f > 600) this._seen.delete(k);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this._heights.clear();
  }
}
