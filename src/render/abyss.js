// What the deep sea has of its own, beside its fish (render/fish.js), its snow
// (render/motes.js) and its kelp: the moving light on its floor (the caustic
// chunk in render/atmosphere.js, which this sets going), the beams that come
// down from the surface, the bubbles from the car's four pads and from vents in
// the floor (the Bubbles of render/motes.js), thirty jellyfish about the lens and
// now and then a whale going over. Where each is and how it moves is
// world/abyssplan.js.
//
// The beams and the jellyfish ride with the lens: each has a place in a box round
// it, wrapped in world coordinates, so it stays where it is as the car goes on.
// A jellyfish is held between the floor and the surface (its floor is read where
// it is, once each time it wraps). The whale comes at most once in each 5 km of
// road: it goes over the car along the road for 50 s, from behind to ahead and
// from one side to the other, a silhouette against the light, and while it is
// over, its shadow takes some of the light (dim(): a factor on the exposure),
// and it calls once (calls goes up by one; ui/sound.js answers it).
//
// None of it is drawn off the deep sea: out of reach of it nothing is drawn,
// nothing is worked out, and the programs are built the first time it is in
// reach. Each draws by the tier (render/quality.js): all of it at 'high', half
// at 'mid' (four beams, fifteen jellyfish, half the bubbles, one pattern of the
// light on the floor), none at 'low'.

import * as THREE from 'three';
import {
  ABYSS, SURFACE, CAUSTIC, BEAMS, BUBBLE, VENT, JELLY, WHALE, AbyssPlan,
  beamSeed, beamTop, beamLight, jellySeed, jellyXZ, jellyY, jellyBeat, whaleOffset, whaleShade,
} from '../world/abyssplan.js';
import { Bubbles } from './motes.js';
import { atmo, causticU, compileObjects } from './atmosphere.js';
import { twistU, TWIST_PARS } from './twist.js';

// reach: how far off (m, in the worlds' own progress) the deep sea may be, for what it has to be drawn.
export const ABYSS_VIEW = { reach: 700 };

// The share of each thing a tier draws.
const TIER = { high: 1, mid: 0.5, low: 0 };

// --- the beams --------------------------------------------------------------------------------

const BEAM_VERTEX = /* glsl */`
${TWIST_PARS}
attribute vec4 aBeam;    // the top (local x, z), how wide (m), how lit (0 to 1)
uniform vec3 uSlant;     // from the top to the foot (m)
uniform vec3 fogParams;
uniform float uBox;
varying vec2 vQ;
varying float vLit;
void main() {
  vec3 top = vec3(aBeam.x, ${SURFACE.toFixed(1)}, aBeam.y);
  vec3 axis = normalize(uSlant);
  vec3 p = top + uSlant * position.y;
  // Turned about its own line to face the lens.
  vec3 side = cross(axis, cameraPosition - p);
  side = length(side) > 1e-3 ? normalize(side) : vec3(1.0, 0.0, 0.0);
  p += side * position.x * aBeam.z;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * twistView(mv);
  float d = length(p - cameraPosition);
  vec2 off = top.xz + uSlant.xz * 0.5 - cameraPosition.xz;
  // Into the water far off, out where the box wraps, and away from the lens when it is in the beam.
  vLit = aBeam.w * exp(-d * fogParams.x * 0.6) * (1.0 - smoothstep(uBox * 0.36, uBox * 0.48, length(off)))
    * (1.0 - smoothstep(${BEAMS.fade[0].toFixed(1)}, ${BEAMS.fade[1].toFixed(1)}, d)) * smoothstep(3.0, 12.0, d);
  vQ = position.xy;
}
`;

const BEAM_FRAGMENT = /* glsl */`
uniform vec3 uColor;
varying vec2 vQ;
varying float vLit;
void main() {
  float across = 1.0 - 4.0 * vQ.x * vQ.x;
  across *= across;
  float along = smoothstep(0.0, 0.06, vQ.y) * pow(1.0 - vQ.y, 1.6);
  gl_FragColor = vec4(uColor * vLit * across * along, 1.0);
}
`;

class Beams {
  constructor(scene, seed) {
    const geo = new THREE.InstancedBufferGeometry();
    const P = [];
    const n = 6;
    for (let j = 0; j <= n; j++) P.push(-0.5, j / n, 0, 0.5, j / n, 0);
    const idx = [];
    for (let j = 0; j < n; j++) idx.push(j * 2, j * 2 + 1, j * 2 + 3, j * 2, j * 2 + 3, j * 2 + 2);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setIndex(idx);
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(BEAMS.count * 4), 4);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aBeam', this.attr);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.uniforms = {
      uSlant: { value: new THREE.Vector3(BEAMS.slant[0] * BEAMS.length, -BEAMS.length, BEAMS.slant[1] * BEAMS.length) },
      uColor: { value: new THREE.Color() },
      uBox: { value: BEAMS.box },
      fogParams: atmo.fogParams,
      ...twistU,
    };
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: BEAM_VERTEX,
      fragmentShader: BEAM_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      // (Added light that writes no depth: one pass of both faces is the same picture as two.)
      forceSinglePass: true,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.seed = seed;
    this.count = 0;
    this.tops = [];     // [absolute x, z, width, light] of each beam drawn
  }

  // n: how many; at: the absolute place of the lens (x, z); o: the floating origin; t: the clock;
  // color: the sun's colour; k: how much of the deep sea there is about the lens (0 to 1).
  update(n, ax, az, o, t, color, k) {
    this.count = n;
    this.mesh.visible = n > 0 && k > 0.01;
    this.mesh.geometry.instanceCount = this.mesh.visible ? n : 0;
    this.tops.length = 0;
    if (!this.mesh.visible) return;
    const a = this.attr.array;
    for (let i = 0; i < n; i++) {
      const [x, z] = beamTop(i, this.seed, ax, az);
      const lit = beamLight(x, z, t);
      const w = beamSeed(i, this.seed).width;
      a.set([x - o.x, z - o.z, w, lit], i * 4);
      this.tops.push([x, z, w, lit]);
    }
    this.attr.needsUpdate = true;
    this.uniforms.uColor.value.copy(color).multiplyScalar(BEAMS.light * k);
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// --- the jellyfish ----------------------------------------------------------------------------

// A jellyfish a metre wide: a bell of rings (aPart 0, aV from the top to the rim), and six
// tentacles hanging from under the rim (aPart 1, aV from the rim to the tip).
const RINGS = 5;
const AROUND = 12;
const TENTACLES = 6;
const STEPS = 7;
function jellyGeometry() {
  const P = [];
  const V = [];
  const part = [];
  const idx = [];
  P.push(0, 0, 0);
  V.push(0);
  part.push(0);
  for (let r = 1; r <= RINGS; r++) {
    for (let k = 0; k < AROUND; k++) {
      const a = (k / AROUND) * Math.PI * 2;
      P.push(Math.cos(a), 0, Math.sin(a));
      V.push(r / RINGS);
      part.push(0);
    }
  }
  const ring = (r, k) => (r === 0 ? 0 : 1 + (r - 1) * AROUND + (k % AROUND));
  for (let k = 0; k < AROUND; k++) idx.push(0, ring(1, k + 1), ring(1, k));
  for (let r = 1; r < RINGS; r++) {
    for (let k = 0; k < AROUND; k++) idx.push(ring(r, k), ring(r, k + 1), ring(r + 1, k + 1), ring(r, k), ring(r + 1, k + 1), ring(r + 1, k));
  }
  for (let t = 0; t < TENTACLES; t++) {
    const a = ((t + 0.5) / TENTACLES) * Math.PI * 2;
    const base = P.length / 3;
    for (let j = 0; j <= STEPS; j++) {
      for (const s of [-1, 1]) {
        P.push(Math.cos(a), s, Math.sin(a));
        V.push(j / STEPS);
        part.push(1);
      }
    }
    for (let j = 0; j < STEPS; j++) {
      const q = base + j * 2;
      idx.push(q, q + 1, q + 3, q, q + 3, q + 2);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aV', new THREE.Float32BufferAttribute(V, 1));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  return g;
}

const JELLY_VERTEX = /* glsl */`
${TWIST_PARS}
attribute float aV;
attribute float aPart;
attribute vec4 aJelly;    // where (local metres) and how wide (m)
attribute vec4 aJelly2;   // how far its bell is drawn in (0 to 1), its phase, how lit, 0
uniform float uTime;
uniform float uBlock;
uniform vec3 fogParams;
varying float vLit;
varying float vV;
varying float vPart;
void main() {
  float beat = aJelly2.x;
  float ph = aJelly2.y * 6.2832;
  float s = aJelly.w;
  vec3 p;
  if (aPart < 0.5) {
    // The bell: a dome, narrower and taller when it is drawn in, the rim most of all.
    float th = aV * 1.75;
    float rr = sin(th) * (1.0 - 0.24 * beat * aV * aV);
    float hh = cos(th) * 0.62 * (1.0 + 0.16 * beat);
    p = vec3(position.x * rr, hh, position.z * rr) * 0.5;
    if (uBlock > 0.5) {
      // A box in the block style.
      vec3 q = vec3(position.x * sin(th), cos(th), position.z * sin(th));
      p = q / max(max(abs(q.x), abs(q.y)), abs(q.z)) * vec3(0.42, 0.3, 0.42) + vec3(0.0, 0.05, 0.0);
    }
  } else {
    // A tentacle: a ribbon from under the rim, swaying as the bell beats.
    float rim = 0.36 * (1.0 - 0.2 * beat);
    float len = 1.7;
    float sway = 0.18 * aV * sin(uTime * 1.3 - aV * 4.0 + ph + position.x * 2.0);
    p = vec3(position.x * rim + sway, -0.08 - aV * len * (1.0 - 0.12 * beat), position.z * rim + 0.6 * sway);
    p.x += position.y * 0.025 * position.z;
    p.z -= position.y * 0.025 * position.x;
  }
  vec3 wp = aJelly.xyz + p * s;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * twistView(mv);
  float d = -mv.z;
  vLit = aJelly2.z * exp(-max(d, 0.0) * fogParams.x * 0.9);
  vV = aV;
  vPart = aPart;
}
`;

const JELLY_FRAGMENT = /* glsl */`
uniform vec3 uColor;
uniform vec3 uCore;
varying float vLit;
varying float vV;
varying float vPart;
void main() {
  // The bell is a thin skin, brightest at its rim; the tentacles dim to their tips.
  vec3 c = vPart < 0.5 ? mix(uCore, uColor, vV * vV) * (0.35 + 0.65 * vV * vV * vV) : uColor * 0.45 * (1.0 - vV);
  gl_FragColor = vec4(c * vLit, 1.0);
}
`;

class Jellies {
  constructor(scene, seed, floorAt) {
    const geo = jellyGeometry();
    this.a1 = new THREE.InstancedBufferAttribute(new Float32Array(JELLY.count * 4), 4);
    this.a2 = new THREE.InstancedBufferAttribute(new Float32Array(JELLY.count * 4), 4);
    this.a1.setUsage(THREE.DynamicDrawUsage);
    this.a2.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aJelly', this.a1);
    geo.setAttribute('aJelly2', this.a2);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    const color = new THREE.Color(JELLY.color);
    this.uniforms = {
      uTime: { value: 0 },
      uBlock: { value: 0 },
      uColor: { value: color.clone().multiplyScalar(JELLY.glow) },
      uCore: { value: new THREE.Color(0x6fd8ff).multiplyScalar(JELLY.glow * 0.5) },
      fogParams: atmo.fogParams,
      ...twistU,
    };
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: JELLY_VERTEX,
      fragmentShader: JELLY_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      // (Added light that writes no depth: one pass of both faces is the same picture as two.)
      forceSinglePass: true,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.seeds = Array.from({ length: JELLY.count }, (_, i) => jellySeed(i, seed));
    this.floorAt = floorAt;
    this._floor = this.seeds.map(() => ({ x: NaN, z: NaN, y: 0 }));
    this.count = 0;
    this.list = [];     // [absolute x, y, z, size, floor] of each drawn
  }

  // n: how many; ax, az: the lens (absolute); o: the floating origin; t: the clock; mine(ax, az, u):
  // whether a thing there with its own draw u is the deep sea's; blocks: the block style.
  update(n, ax, az, o, t, mine, blocks) {
    this.uniforms.uTime.value = t % 3600;
    this.uniforms.uBlock.value = blocks > 0.5 ? 1 : 0;
    this.list.length = 0;
    let m = 0;
    if (n > 0) {
      const a1 = this.a1.array;
      const a2 = this.a2.array;
      for (let i = 0; i < n; i++) {
        const j = this.seeds[i];
        const [x, z] = jellyXZ(j, ax, az);
        if (!mine(x, z, j.draw)) continue;
        const f = this._floor[i];
        if (f.x !== x || f.z !== z) {
          f.x = x;
          f.z = z;
          f.y = this.floorAt(x, z);
        }
        const y = jellyY(j, f.y, t);
        if (y === null) continue;
        a1.set([x - o.x, y, z - o.z, j.size], m * 4);
        a2.set([jellyBeat(j, t), j.phase, 1, 0], m * 4);
        this.list.push([x, y, z, j.size, f.y]);
        m++;
      }
      this.a1.needsUpdate = true;
      this.a2.needsUpdate = true;
    }
    this.count = m;
    this.mesh.geometry.instanceCount = m;
    this.mesh.visible = m > 0;
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// --- the whale --------------------------------------------------------------------------------

// A whale WHALE.length long along +x (its nose at +x): a body of rings, flattened a little, two
// flippers and the flukes. aU is how far along it a vertex is, from the nose (0) to the flukes (1).
function whaleGeometry() {
  const L = WHALE.length;
  const P = [];
  const U = [];
  const idx = [];
  const ALONG = 16;
  const ROUND = 10;
  const radius = (u) => {
    if (u < 0.12) return 2.6 * Math.sqrt(u / 0.12) * (0.7 + 0.3 * u / 0.12);
    if (u < 0.4) return 2.6 + 0.2 * Math.sin(((u - 0.12) / 0.28) * Math.PI);
    return 2.6 * Math.pow(1 - (u - 0.4) / 0.6, 1.4) + 0.22;
  };
  for (let i = 0; i <= ALONG; i++) {
    const u = i / ALONG;
    const r = i === 0 ? 0.05 : radius(u);
    for (let k = 0; k < ROUND; k++) {
      const a = (k / ROUND) * Math.PI * 2;
      P.push(L * (0.5 - u), Math.sin(a) * r * 0.82, Math.cos(a) * r);
      U.push(u);
    }
  }
  for (let i = 0; i < ALONG; i++) {
    for (let k = 0; k < ROUND; k++) {
      const a = i * ROUND + k;
      const b = i * ROUND + ((k + 1) % ROUND);
      idx.push(a, b, b + ROUND, a, b + ROUND, a + ROUND);
    }
  }
  const tri = (pts, us) => {
    const base = P.length / 3;
    for (let i = 0; i < pts.length; i++) {
      P.push(...pts[i]);
      U.push(us[i]);
    }
    for (let i = 1; i + 1 < pts.length; i++) idx.push(base, base + i, base + i + 1);
  };
  // Flippers, long and narrow, a third of the way back.
  for (const s of [-1, 1]) {
    tri([[L * 0.18, -1.2, s * 2.2], [L * 0.1, -2.4, s * 7.0], [L * 0.03, -2.0, s * 7.4], [L * 0.08, -1.4, s * 2.3]], [0.32, 0.36, 0.4, 0.36]);
  }
  // The flukes, flat and wide.
  tri([[-L * 0.48, 0, 0], [-L * 0.56, 0, 3.8], [-L * 0.6, 0, 4.0], [-L * 0.54, 0, 0.4]], [1, 1, 1, 1]);
  tri([[-L * 0.48, 0, 0], [-L * 0.54, 0, -0.4], [-L * 0.6, 0, -4.0], [-L * 0.56, 0, -3.8]], [1, 1, 1, 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aU', new THREE.Float32BufferAttribute(U, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), L);
  return g;
}

const WHALE_VERTEX = /* glsl */`
${TWIST_PARS}
attribute float aU;
uniform float uTime;
uniform float uBlock;
varying float vDist;
void main() {
  vec3 p = position;
  // The flukes go up and down, the body after them.
  p.y += 1.3 * aU * aU * sin(uTime * 0.9 - aU * 2.4);
  if (uBlock > 0.5) p = floor(p / 1.4 + 0.5) * 1.4;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * twistView(mv);
  vDist = -mv.z;
}
`;

const WHALE_FRAGMENT = /* glsl */`
uniform vec3 uDark;
uniform vec3 uFogColor;
uniform vec3 fogParams;
varying float vDist;
void main() {
  // A shape against the light, with as much of the water before it as it is far.
  float f = 1.0 - exp(-max(vDist, 0.0) * fogParams.x * 0.8);
  gl_FragColor = vec4(mix(uDark, uFogColor, f), 1.0);
}
`;

class Whale {
  constructor(scene) {
    this.uniforms = {
      uTime: { value: 0 },
      uBlock: { value: 0 },
      uDark: { value: new THREE.Color() },
      uFogColor: { value: new THREE.Color() },
      fogParams: atmo.fogParams,
      ...twistU,
    };
    this.mesh = new THREE.Mesh(whaleGeometry(), new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: WHALE_VERTEX,
      fragmentShader: WHALE_FRAGMENT,
      side: THREE.DoubleSide,
      fog: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// --- what holds them ------------------------------------------------------------------------

export class Abyss {
  // env: road, worlds, land, corridor, seed; tier: the one to begin with.
  constructor(scene, env, tier = 'high') {
    this.env = env;
    this.scene = scene;
    this.seed = env.seed | 0;
    this.plan = new AbyssPlan({ road: env.road, worlds: env.worlds, land: env.land, corridor: env.corridor, seed: this.seed });
    const floorAt = (ax, az) => Math.max(env.land.heightAt(ax, az), env.corridor ? env.corridor.heightAt(ax, az) : -Infinity);
    this.beams = new Beams(scene, this.seed);
    this.jellies = new Jellies(scene, this.seed, floorAt);
    this.whale = new Whale(scene);
    this.bubbles = new Bubbles(scene);
    this.tier = tier;
    this.on = false;          // the deep sea is in reach
    this.inside = false;      // the world under the lens is the deep sea's
    this.share = 0;           // how much of it, at the lens
    this.clock = 0;           // s
    this.shade = 0;           // how much of the whale's shadow is over the car (0 to 1)
    this.calls = 0;           // the whale's calls, since the start
    this.passes = 0;          // the whales that have gone over, since the start
    this.pass = null;         // the whale going over now: { w (world/abyssplan.js's whaleSeed), t0 }
    this._done = new Set();   // the 5 km of road whose whale has come
    this._emit = { pads: 0, vents: new Map() };
    this._vents = [];
    this._rand = mulberry32(this.seed ^ 0xb0bb1e);
    this._light = new THREE.Vector3(0.5, 0.62, 0.64);
    this._warmed = false;
  }

  setTier(t) {
    if (TIER[t] !== undefined) this.tier = t;
  }

  // The floating origin has moved by (dx, dz).
  shift(dx, dz) {
    this.bubbles.shift(dx, dz);
  }

  // How much of the world under a look ({ a, b, t }) is the deep sea's.
  static share(at) {
    if (!at || at.a < 0) return 0;
    const t = at.a === at.b ? 0 : at.t;
    return (at.a === ABYSS ? 1 - t : 0) + (at.b === ABYSS ? t : 0);
  }

  // The factor its shadow puts on the exposure.
  dim() {
    return 1 - WHALE.shade * this.shade;
  }

  // Every frame. dt: s (0 in the photo mode: the world stands still); ctx: { at (the look the small
  // things in the air go by), sCar, car, blocks (0 to 1), px (the pixels a metre makes at a metre),
  // fogColor, sunColor, renderer, scene (to build the programs the first time it is in reach) }.
  update(camera, dt, ctx) {
    const o = this.env.road.origin;
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    const k = TIER[this.tier] || 0;
    this.on = k > 0 && this.env.worlds.reaches(ax, az, ABYSS_VIEW.reach, (w) => w.id === 'abyss');
    this.share = this.on ? Abyss.share(ctx.at) : 0;
    this.inside = this.share >= 0.5;
    if (this.on && (this._frames = (this._frames || 0) + 1) % 600 === 0) this.plan.prune(ctx.sCar);
    this.clock += dt;
    // (Kept small: the bubbles' starts are taken back with it.)
    if (this.clock > 3600) {
      this.clock -= 3600;
      this.bubbles.rewind(3600);
    }
    const t = this.clock;
    // The light on the floor.
    const cu = causticU.uCaustic.value;
    const layers = k >= 1 ? 2 : 1;
    cu.set(this.on ? CAUSTIC.strength * this.share : 0, layers, 1 / this.plan.mean[layers - 1], 0);
    const R = CAUSTIC.repeat * CAUSTIC.cell;
    const wrap = (v) => ((v % R) + R) % R;
    causticU.uCausticOff.value.set(wrap(CAUSTIC.drift[0][0] * t), wrap(CAUSTIC.drift[0][1] * t), wrap(CAUSTIC.drift[1][0] * t), wrap(CAUSTIC.drift[1][1] * t));
    if (this.on && !this._warmed && ctx.renderer) {
      this._warmed = true;
      compileObjects(ctx.renderer, ctx.scene, camera, this.meshes());
    }
    // The beams, the jellyfish.
    const sun = ctx.sunColor || new THREE.Color(1, 1, 1);
    this.beams.update(this.on ? Math.round(BEAMS.count * k) : 0, ax, az, o, t, sun, this.share);
    this.jellies.update(this.on ? Math.round(JELLY.count * k) : 0, ax, az, o, t, (x, z, u) => this.plan.mine(x, z, u), ctx.blocks || 0);
    // The bubbles.
    this._bubbles(dt, ctx, k);
    // The whale.
    this._whale(ctx, t, k);
  }

  _bubbles(dt, ctx, k) {
    const B = BUBBLE;
    const o = this.env.road.origin;
    const car = ctx.car;
    const t = this.clock;
    const rand = this._rand;
    if (this.on && dt > 0 && car) {
      const cx = car.x + o.x;
      const cz = car.z + o.z;
      const cy = car.y || 0;
      // From the pads, while the car is in the deep sea's water.
      if (this.plan.share(cx, cz) >= 0.5 && cy < SURFACE - 1) {
        this._emit.pads += dt * B.rate * k;
        const c = Math.cos(car.yaw);
        const s = Math.sin(car.yaw);
        while (this._emit.pads >= 1) {
          this._emit.pads -= 1;
          for (const [fx, fz] of B.pads) {
            const a = rand() * dt;
            this.bubbles.emit(car.x + c * fx - s * fz + (rand() - 0.5) * 0.2, cy + B.padY, car.z + s * fx + c * fz + (rand() - 0.5) * 0.2, t - a, rand(), B.life);
          }
        }
      } else this._emit.pads = 0;
      // From the vents near the lens.
      const cam = ctx.camera.position;
      this.plan.ventsNear(cam.x + o.x, cam.z + o.z, ctx.sCar, VENT.reach, this._vents);
      for (const v of this._vents) {
        const e = (this._emit.vents.get(v.key) || 0) + dt * B.vent * k;
        let n = Math.floor(e);
        this._emit.vents.set(v.key, e - n);
        while (n-- > 0) {
          const r = 0.35 * Math.sqrt(rand());
          const a = rand() * Math.PI * 2;
          this.bubbles.emit(v.ax - o.x + Math.cos(a) * r, v.y + 0.15, v.az - o.z + Math.sin(a) * r, t - rand() * dt, rand(), B.ventLife);
        }
      }
      if (this._emit.vents.size > 64) this._emit.vents.clear();
    } else if (!this.on) this._vents.length = 0;
    const lit = ctx.sunColor ? this._light.set(ctx.sunColor.r, ctx.sunColor.g, ctx.sunColor.b).multiplyScalar(0.55) : null;
    this.bubbles.update(this.on, t, ctx.px || 700, lit, ctx.blocks || 0);
  }

  _whale(ctx, t, k) {
    const W = WHALE;
    const road = this.env.road;
    const mesh = this.whale.mesh;
    // A whale comes when the car is past its place in its 5 km and the lens is in the deep sea.
    if (!this.pass && this.inside && k > 0 && ctx.sCar !== undefined) {
      const cell = Math.floor(ctx.sCar / W.every);
      if (!this._done.has(cell)) {
        const w = this.plan.whale(cell);
        if (w && ctx.sCar >= w.s && ctx.sCar < w.s + 1500) {
          this._done.add(cell);
          this.pass = { w, t0: t, called: false };
          this.passes++;
        }
      }
    }
    this.shade = 0;
    mesh.visible = false;
    const p = this.pass;
    if (!p) return;
    const tau = t - p.t0;
    if (tau > W.time || !this.on) {
      this.pass = null;
      return;
    }
    if (!p.called && tau >= W.call) {
      p.called = true;
      this.calls++;
    }
    const at = (tt) => {
      const s = ctx.sCar + whaleOffset(tt);
      const q = road.at(s);
      if (!q) return null;
      const lat = p.w.side * W.lat * (1 - (2 * tt) / W.time);
      const car = ctx.car;
      const y = Math.min((car ? car.y || 0 : q.y) + p.w.over, SURFACE - W.under - 3);
      return [q.x - Math.sin(q.theta) * lat, y, q.z + Math.cos(q.theta) * lat];
    };
    const a = at(tau);
    const b = at(tau + 0.5);
    if (!a || !b) return;
    mesh.position.set(a[0], a[1], a[2]);
    mesh.rotation.set(0, -Math.atan2(b[2] - a[2], b[0] - a[0]), 0);
    mesh.visible = true;
    const u = this.whale.uniforms;
    u.uTime.value = t % 3600;
    u.uBlock.value = (ctx.blocks || 0) > 0.5 ? 1 : 0;
    if (ctx.fogColor) {
      u.uFogColor.value.copy(ctx.fogColor);
      u.uDark.value.copy(ctx.fogColor).multiplyScalar(0.12);
    }
    this.shade = whaleShade(tau) * this.share;
  }

  // The meshes whose programs are built the first time the deep sea is in reach.
  meshes() {
    return [this.beams.mesh, this.jellies.mesh, this.whale.mesh, this.bubbles.points];
  }

  stats() {
    const t = this.clock;
    return {
      on: this.on, inside: this.inside, tier: this.tier, caustic: +causticU.uCaustic.value.x.toFixed(3),
      layers: causticU.uCaustic.value.y, beams: this.beams.mesh.visible ? this.beams.count : 0,
      jellies: this.jellies.count, bubbles: this.bubbles.alive(t), vents: this._vents.length,
      whale: !!this.pass, shade: +this.shade.toFixed(3), calls: this.calls, passes: this.passes,
    };
  }

  dispose() {
    for (const m of [this.beams, this.jellies, this.whale, this.bubbles]) m.dispose();
    causticU.uCaustic.value.x = 0;
  }
}

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
