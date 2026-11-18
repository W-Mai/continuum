// Blades of grass and their flowers, in the painted style. Nothing is laid
// down on the page: every frame the land round the lens is drawn from
// straight above into a small map (its colour as lit, how much of it grass
// grows on, its height in the depth), and the blades are three fixed meshes
// that follow the lens, a blade to a cell of the world, with the flowers a
// fourth. A blade's place, size and lean come from the integer hash of its
// cell in the vertex shader; its foot's height, colour and whether it grows
// there are read from the map. So a blade has the colour and the light of the
// ground under it, grows where the land's own shader says grass grows, and
// nothing is baked or kept. The wind bends the blades by one gust field
// moving over the land, and the flowers stand at the height of the blades'
// tips and sway with them.

import * as THREE from 'three';
import { WORLDS } from '../world/worlds.js';
import { withAtmosphere, warmHooks, compileAsDrawn } from './atmosphere.js';
import { MARK, WIND, grassHere } from './style.js';

// The ground map: its side in metres and its texels at each tier, and the near
// plane of the camera that draws it (the far one is set by the land under it).
const MAP = { size: 96, texels: { high: 256, mid: 192 }, near: 0.5 };

// A ring: the cell a blade stands in, how far out its cells go (m), where it
// comes in and goes out over (metres from the lens), the rows of a blade, the
// width of its foot (m) and whether a blade is one triangle.
const RINGS = [
  { id: 'near', cell: 0.18, reach: [0, 12], from: [0, 0], to: [9, 12], rows: 4, foot: 0.048 },
  { id: 'mid', cell: 0.26, reach: [9, 24], from: [9, 12], to: [19, 24], rows: 3, foot: 0.066 },
  { id: 'far', cell: 0.45, reach: [19, 44], from: [19, 24], to: [34, 44], rows: 2, foot: 0.10, triangle: true },
];
// How much farther apart the cells are at the middle tier: 0.6 of the blades.
const MID_CELL = 1.29;

// The flowers: a cell, how far they go, where they begin to thin out and end,
// and whether one is a hexagon (four triangles) or a diamond (two): at the
// middle tier fewer, nearer and plainer.
const FLOWERS = {
  high: { cell: 0.64, reach: 44, from: 30, to: 44, hex: true },
  mid: { cell: 0.83, reach: 30, from: 20, to: 30, hex: false },
};
// The flowers' four colours (sRGB), in the proportions they are drawn in, and
// how much of the ground's light they take: the share that makes a white
// flower in the sun as bright on the screen as a flower laid on the ground by
// the last pass.
const FLOWER_COLOURS = [[0.98, 0.97, 0.9], [1.0, 0.84, 0.25], [0.98, 0.62, 0.72], [0.6, 0.7, 1.0]];
const FLOWER_LIGHT = 3.2;

const COMMON = /* glsl */`
uniform ivec2 uCell0;
uniform vec2 uCellOrg;
uniform vec4 uRing;        // cell, foot, seed, ring
uniform vec4 uFade;
uniform vec4 uMapRect;     // left, bottom z, side, eye height
uniform vec3 uMapNF;       // near, far, texels
uniform sampler2D uMapTex;
uniform sampler2D uMapDepth;
uniform vec4 uTone;        // foot, tip, tip red, tip blue
uniform vec4 uLook;        // height, flat, one pixel's width at a metre
uniform vec4 uWind;        // heading x, z, speed
uniform vec2 uCloudDrift;
uniform vec4 uFl;          // flowers, light
uniform vec3 uFcol[4];
attribute ivec2 aCell;
uniform float uRows;
uniform vec2 uV;           // vertices to a blade or a flower, 1 for a blade of one triangle or a flower that is a hexagon
const vec2 HEX[6] = vec2[6](vec2(2.0, 0.0), vec2(1.0, 2.0), vec2(-1.0, 2.0), vec2(-2.0, 0.0), vec2(-1.0, -2.0), vec2(1.0, -2.0));
const vec2 DIA[4] = vec2[4](vec2(-2.0, 0.0), vec2(2.0, 0.0), vec2(0.0, 2.0), vec2(0.0, -2.0));
varying vec3 vBladeCol;
uvec3 pcg3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 draw3(ivec2 c, uint salt) {
  uvec3 h = pcg3(uvec3(uint(c.x), uint(c.y), salt + uint(uRing.z) * 7919u + uint(uRing.w) * 104729u));
  return vec3(h & 0xffffffu) / 16777216.0;
}
float vnoise(vec2 p, uint salt) {
  vec2 i = floor(p);
  vec2 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  return mix(mix(draw3(c, salt).x, draw3(c + ivec2(1, 0), salt).x, f.x), mix(draw3(c + ivec2(0, 1), salt).x, draw3(c + ivec2(1, 1), salt).x, f.x), f.y);
}
float mapDepth(ivec2 i) {
  return texelFetch(uMapDepth, clamp(i, ivec2(0), ivec2(int(uMapNF.z) - 1)), 0).r;
}
// The gust at a place: two fields, 61 m and 17 m across, carried downwind
// with the clouds' shadows (uCloudDrift moves with the time).
float gustAt(vec2 a) {
  vec2 d = uCloudDrift;
  float n = vnoise((a - d) / 61.0, 31u) * 0.6 + vnoise((a - d) / 17.0, 32u) * 0.4;
  return smoothstep(0.3, 0.7, n);
}
// How far a blade's tip is bent over by the wind, in radians: downwind more in
// a gust, and a tremble of its own.
float windBend(vec2 a, float phase, float rate) {
  float U = uWind.z;
  float t = dot(uCloudDrift, uWind.xy) / U;
  return U * mix(0.028, 0.105, gustAt(a)) + (0.028 + 0.013 * U) * sin(t * rate + phase);
}
`;

// What a vertex of a blade does: find its cell, read the map under its foot,
// and stand and bend the blade there. Out of the clip volume when it is not
// to be seen.
const BLADE = /* glsl */`
vec3 transformed;
{
  int vid = gl_VertexID % int(uV.x);
  float px = uV.y > 0.5 ? (vid == 2 ? 0.0 : (vid == 0 ? -1.0 : 1.0)) : float(vid & 1) * 2.0 - 1.0;
  float py = uV.y > 0.5 ? (vid == 2 ? 1.0 : 0.0) : float(vid >> 1);
  ivec2 cell = uCell0 + aCell;
  vec3 r1 = draw3(cell, 1u);
  vec3 r2 = draw3(cell, 2u);
  vec2 foot2 = uCellOrg + (vec2(aCell) + r1.xy) * uRing.x;
  vec2 abs2 = (vec2(cell) + r1.xy) * uRing.x;
  vec2 uv = vec2(foot2.x - uMapRect.x, uMapRect.y - foot2.y) / uMapRect.z;
  vec2 tc = uv * uMapNF.z - 0.5;
  ivec2 i0 = ivec2(floor(tc));
  vec2 f = tc - vec2(i0);
  float y0 = mix(mix(mapDepth(i0), mapDepth(i0 + ivec2(1, 0)), f.x), mix(mapDepth(i0 + ivec2(0, 1)), mapDepth(i0 + ivec2(1, 1)), f.x), f.y);
  float gy = uMapRect.w - (uMapNF.x + y0 * (uMapNF.y - uMapNF.x)) - 0.02;
  vec4 g = textureLod(uMapTex, uv, 0.0);
  vec3 foot = vec3(foot2.x, gy, foot2.y);
  float bd = distance(foot, cameraPosition);
  float keep = smoothstep(uFade.x, max(uFade.y, uFade.x + 1e-3), bd) * (1.0 - smoothstep(uFade.z, uFade.w, bd));
  if (uFade.y <= uFade.x) keep = 1.0 - smoothstep(uFade.z, uFade.w, bd);
  float width0 = uRing.y * mix(0.72, 1.3, r2.x);
  float wmin = 1.2 * bd * uLook.z;
  keep *= min(1.0, width0 / wmin);
  float live = smoothstep(0.0, 0.18, keep * g.a - r2.z * 0.82);
  bool gone = live <= 0.0 || uv.x < 0.01 || uv.x > 0.99 || uv.y < 0.01 || uv.y > 0.99 || g.a < 0.001;
  vec4 clip0 = projectionMatrix * viewMatrix * vec4(foot + vec3(0.0, 0.3, 0.0), 1.0);
  gone = gone || clip0.w < -1.0 || abs(clip0.x) > clip0.w + 1.5 || abs(clip0.y) > clip0.w + 1.5;
  float clump = 0.5 + 0.5 * draw3(ivec2(floor(vec2(cell) * uRing.x / 0.44)), 3u).x;
  float hgt = uLook.x * clump * mix(0.7, 1.22, r2.y) * mix(0.55, 1.0, live);
  float wid = max(width0, wmin) * mix(0.5, 1.0, live);
  float yaw = atan(uWind.y, uWind.x) + (r1.z - 0.5) * 1.1;
  vec2 lean2 = vec2(cos(yaw), sin(yaw));
  float lean = min(mix(0.2, 0.65, fract(r2.y * 7.31 + r1.x)) + windBend(abs2, r1.z * 6.2832, mix(5.0, 9.0, r2.x)), 1.35);
  vec2 vdir = normalize(cameraPosition.xz - foot2 + 1e-4);
  vec2 face = normalize(mix(lean2 * (dot(lean2, vdir) < 0.0 ? -1.0 : 1.0), vdir, 0.68));
  vec2 axis = vec2(-face.y, face.x);
  float t = py / (uRows - 1.0);
  float taper = 1.0 - smoothstep(0.35, 1.0, t);
  vec3 p = foot;
  p.xz += lean2 * hgt * t * sin(lean * t) + axis * px * wid * 0.5 * taper;
  p.y += hgt * t * cos(lean * t);
  transformed = gone ? vec3(1e9) : p;
  float shade = mix(uTone.x, uTone.y, t);
  vec3 col = g.rgb * mix(1.0, shade, 1.0 - uLook.y) * mix(0.9, 1.1, fract(r1.x * 3.7 + r2.x));
  col.r *= 1.0 + (uTone.z - 1.0) * t * (1.0 - uLook.y);
  col.b *= 1.0 + (uTone.w - 1.0) * t * (1.0 - uLook.y);
  vBladeCol = col;
}
`;

// A flower: a small hexagon facing the lens at the height of the tips round
// it, in a colour of its own, as light as the ground under it.
const FLOWER_MAIN = /* glsl */`
vec3 transformed;
{
  int vid = gl_VertexID % int(uV.x);
  ivec2 cell = uCell0 + aCell;
  vec3 r1 = draw3(cell, 11u);
  vec3 r2 = draw3(cell, 12u);
  vec3 r3 = draw3(cell, 13u);
  vec2 foot2 = uCellOrg + (vec2(aCell) + r1.xy) * uRing.x;
  vec2 abs2 = (vec2(cell) + r1.xy) * uRing.x;
  vec2 uv = vec2(foot2.x - uMapRect.x, uMapRect.y - foot2.y) / uMapRect.z;
  vec2 tc = uv * uMapNF.z - 0.5;
  ivec2 i0 = ivec2(floor(tc));
  vec2 f = tc - vec2(i0);
  float y0 = mix(mix(mapDepth(i0), mapDepth(i0 + ivec2(1, 0)), f.x), mix(mapDepth(i0 + ivec2(0, 1)), mapDepth(i0 + ivec2(1, 1)), f.x), f.y);
  float gy = uMapRect.w - (uMapNF.x + y0 * (uMapNF.y - uMapNF.x)) - 0.02;
  vec4 g = textureLod(uMapTex, uv, 0.0);
  vec3 foot = vec3(foot2.x, gy, foot2.y);
  float bd = distance(foot, cameraPosition);
  // Where there are flowers: in drifts, ten metres across.
  float drift = smoothstep(0.42, 0.68, vnoise(abs2 / 10.0 + 11.0, 41u));
  float chance = uFl.x * (0.04 + 0.5 * drift);
  float keep = 1.0 - smoothstep(uFade.z, uFade.w, bd);
  float shrink = smoothstep(0.0, 0.18, keep - r2.y * 0.82);
  bool gone = r2.x > chance || g.a < 0.5 || shrink <= 0.0 || uv.x < 0.01 || uv.x > 0.99 || uv.y < 0.01 || uv.y > 0.99;
  vec4 clip0 = projectionMatrix * viewMatrix * vec4(foot + vec3(0.0, 0.3, 0.0), 1.0);
  gone = gone || clip0.w < -1.0 || abs(clip0.x) > clip0.w + 1.5 || abs(clip0.y) > clip0.w + 1.5;
  // The colour: one of the four, mostly the one the seven metre square round
  // it has.
  float pick = r3.y;
  float main = draw3(ivec2(floor(abs2 / 7.0)), 21u).x;
  float u = r3.x < 0.8 ? main : pick;
  int k = u < 0.4 ? 0 : (u < 0.66 ? 1 : (u < 0.86 ? 2 : 3));
  vec3 base = uFcol[k];
  float lum = dot(g.rgb, vec3(0.2126, 0.7152, 0.0722));
  vBladeCol = base * lum * uFl.y;
  float tip = uLook.x * 0.75 * mix(0.8, 1.1, r3.z);
  float lean = min(mix(0.2, 0.65, r3.z) + windBend(abs2, r1.z * 6.2832, mix(5.0, 9.0, r2.x)), 1.35);
  float yaw = atan(uWind.y, uWind.x) + (r1.z - 0.5) * 1.1;
  vec3 c = foot + vec3(cos(yaw) * tip * 0.9 * sin(lean * 0.9), tip * cos(lean * 0.9), sin(yaw) * tip * 0.9 * sin(lean * 0.9));
  float size = max(mix(0.09, 0.14, r2.z), 2.5 * bd * uLook.z) * mix(0.5, 1.0, shrink);
  vec3 toCam = cameraPosition - c;
  vec3 right = normalize(vec3(-toCam.z, 0.0, toCam.x) + vec3(1e-5, 0.0, 0.0));
  vec2 corner = uV.y > 0.5 ? HEX[vid] : DIA[vid];
  vec3 p = c + right * corner.x * size * 0.25 + vec3(0.0, 1.0, 0.0) * corner.y * size * 0.25;
  transformed = gone ? vec3(1e9) : p;
}
`;

// The cells of a ring, as the vertices of its blades: a vertex has the cell it
// belongs to, in 16 bits a side; where in the blade it is, the shader takes
// from the vertex's number (a blade's vertices come in order, a pair to a row).
function bladeGeometry(ring, cell) {
  const cells = [];
  const r0 = ring.reach[0] / cell;
  const r1 = ring.reach[1] / cell;
  const n = Math.ceil(r1);
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const d = Math.hypot(i + 0.5, j + 0.5);
      if (d >= r0 && d < r1) cells.push(i, j);
    }
  }
  const N = cells.length / 2;
  const R = ring.rows;
  const V = ring.triangle ? 3 : R * 2;
  const cel = new Int16Array(N * V * 2);
  const idx = new Uint32Array(N * (ring.triangle ? 3 : (R - 1) * 6));
  let ii = 0;
  for (let b = 0; b < N; b++) {
    const base = b * V;
    for (let v = 0; v < V; v++) {
      cel[(base + v) * 2] = cells[b * 2];
      cel[(base + v) * 2 + 1] = cells[b * 2 + 1];
    }
    if (ring.triangle) {
      idx.set([base, base + 1, base + 2], ii);
      ii += 3;
    } else {
      for (let r = 0; r < R - 1; r++) {
        const k = base + r * 2;
        idx.set([k, k + 1, k + 2, k + 1, k + 3, k + 2], ii);
        ii += 6;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  const a = new THREE.Int16BufferAttribute(cel, 2);
  a.gpuType = THREE.IntType;
  g.setAttribute('aCell', a);
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.userData = { blades: N, triangles: idx.length / 3, vertices: N * V, perBlade: V, bytes: cel.byteLength + idx.byteLength };
  return g;
}

// The flowers' cells: a hexagon each, of six vertices and four triangles, or a
// diamond of four and two.
function flowerGeometry(fl) {
  const cells = [];
  const r1 = fl.reach / fl.cell;
  const n = Math.ceil(r1);
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) if (Math.hypot(i + 0.5, j + 0.5) < r1) cells.push(i, j);
  }
  const N = cells.length / 2;
  const V = fl.hex ? 6 : 4;
  const T = fl.hex ? 4 : 2;
  const cel = new Int16Array(N * V * 2);
  const idx = new Uint32Array(N * T * 3);
  for (let b = 0; b < N; b++) {
    for (let v = 0; v < V; v++) {
      cel[(b * V + v) * 2] = cells[b * 2];
      cel[(b * V + v) * 2 + 1] = cells[b * 2 + 1];
    }
    const k = b * V;
    idx.set(fl.hex ? [k, k + 1, k + 2, k, k + 2, k + 3, k, k + 3, k + 4, k, k + 4, k + 5] : [k, k + 1, k + 2, k, k + 3, k + 1], b * T * 3);
  }
  const g = new THREE.BufferGeometry();
  const a = new THREE.Int16BufferAttribute(cel, 2);
  a.gpuType = THREE.IntType;
  g.setAttribute('aCell', a);
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.userData = { blades: N, triangles: N * T, vertices: N * V, perBlade: V, bytes: cel.byteLength + idx.byteLength };
  return g;
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const WIND_LEN = Math.hypot(WIND[0], WIND[1]);

export class Grass {
  // env: terrain (the land: its group and groundMaterial()), road (the
  // origin), worlds (the map of them), seed, lights (the lights of the scene,
  // by name), tier() (how much there is to draw).
  constructor(scene, env) {
    this.env = env;
    this.scene = scene;
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
    this.off = q.get('grass') === '0';
    this.flat = q.get('grassflat') === '1';
    this.group = new THREE.Group();
    this.group.name = 'grass';
    this.group.visible = false;
    scene.add(this.group);
    this.active = false;
    this.tier = null;
    this.rt = null;
    this.rtSize = 0;
    this.rings = [];
    this.flowers = null;
    this.stats = { blades: 0, triangles: 0, vertices: 0, flowers: 0, bytes: 0 };
    // The land is seen by the eye alone on layer 1, with the lights that shine on it.
    this.eye = new THREE.OrthographicCamera(-MAP.size / 2, MAP.size / 2, MAP.size / 2, -MAP.size / 2, MAP.near, 400);
    this.eye.layers.set(1);
    this.eye.rotation.x = -Math.PI / 2;
    for (const l of env.lights) l.layers.enable(1);
    this.uniforms = {
      uMapRect: { value: new THREE.Vector4() },
      uMapNF: { value: new THREE.Vector3(MAP.near, 400, 256) },
      uMapTex: { value: null },
      uMapDepth: { value: null },
      uTone: { value: new THREE.Vector4(0.78, 1.3, 1.12, 0.88) },
      uLook: { value: new THREE.Vector4(0.5, this.flat ? 1 : 0, 0.001, 0) },
      uWind: { value: new THREE.Vector4(WIND[0] / WIND_LEN, WIND[1] / WIND_LEN, WIND_LEN, 0) },
      uFl: { value: new THREE.Vector4(1, FLOWER_LIGHT, 0, 0) },
      uFcol: { value: FLOWER_COLOURS.map((c) => new THREE.Vector3(srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2]))) },
    };
    this.shadowAt = { x: 1e9, z: 1e9 };
    this._one = null;
    this._clear = new THREE.Color();
    this._w = { a: 0, b: 0, t: 0, u: 0 };
    warmHooks.push((renderer, sc, camera) => this.warm(renderer, sc, camera));
  }

  _material(id, ringIndex, mark, vert, fade, cell, foot, rows, shape) {
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    mat.userData.mark = mark;
    const u = {
      uCell0: { value: new THREE.Vector2() },
      uCellOrg: { value: new THREE.Vector2() },
      uRing: { value: new THREE.Vector4(cell, foot, this.env.seed || 0, ringIndex) },
      uFade: { value: new THREE.Vector4(...fade) },
      uRows: { value: rows },
      uV: { value: new THREE.Vector2(...shape) },
    };
    mat.userData.u = u;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u, this.uniforms);
      const swap = (src, from, to) => {
        if (src.split(from).length !== 2) throw new Error(`grass: ${JSON.stringify(from)} is not once in the ${id} shader`);
        return src.replace(from, to);
      };
      shader.vertexShader = swap(swap(shader.vertexShader, '#include <common>', `#include <common>\n${COMMON}`), '#include <begin_vertex>', vert);
      shader.fragmentShader = swap(swap(shader.fragmentShader, '#include <common>', '#include <common>\nvarying vec3 vBladeCol;'), '#include <color_fragment>', 'diffuseColor.rgb = vBladeCol;');
    };
    mat.customProgramCacheKey = () => `continuum-grass-${id}`;
    return withAtmosphere(mat);
  }

  // The meshes for a tier: the blades' cells farther apart at the middle one,
  // and a smaller map.
  _build(tier) {
    for (const r of this.rings) { r.geo.dispose(); r.mat.dispose(); this.group.remove(r.mesh); }
    if (this.flowers) { this.flowers.geo.dispose(); this.flowers.mat.dispose(); this.group.remove(this.flowers.mesh); }
    this.rings = [];
    const k = tier === 'mid' ? MID_CELL : 1;
    this.stats = { blades: 0, triangles: 0, vertices: 0, flowers: 0, bytes: 0 };
    RINGS.forEach((r, i) => {
      const cell = r.cell * k;
      const geo = bladeGeometry(r, cell);
      const mat = this._material(`blade-${r.id}`, i, MARK.leaf, BLADE, [...r.from, ...r.to], cell, r.foot, r.rows, [geo.userData.perBlade, r.triangle ? 1 : 0]);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.name = `grass-${r.id}`;
      this.group.add(mesh);
      this.rings.push({ ...r, cell, geo, mat, mesh });
      this.stats.blades += geo.userData.blades;
      this.stats.triangles += geo.userData.triangles;
      this.stats.vertices += geo.userData.vertices;
      this.stats.bytes += geo.userData.bytes;
    });
    const fl = FLOWERS[tier];
    const fgeo = flowerGeometry(fl);
    const fmat = this._material('flower', 3, MARK.flower, FLOWER_MAIN, [0, 0, fl.from, fl.to], fl.cell, 0, 2, [fgeo.userData.perBlade, fl.hex ? 1 : 0]);
    const fmesh = new THREE.Mesh(fgeo, fmat);
    fmesh.frustumCulled = false;
    fmesh.name = 'grass-flowers';
    this.group.add(fmesh);
    this.flowers = { geo: fgeo, mat: fmat, mesh: fmesh, cell: fl.cell };
    this.stats.flowers = fgeo.userData.blades;
    this.stats.triangles += fgeo.userData.triangles;
    this.stats.bytes += fgeo.userData.bytes;
    this.tier = tier;
    this._target(MAP.texels[tier]);
  }

  _target(texels) {
    if (this.rt && this.rtSize === texels) return this.rt;
    if (this.rt) { this.rt.depthTexture.dispose(); this.rt.dispose(); }
    const rt = new THREE.WebGLRenderTarget(texels, texels, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      generateMipmaps: false,
    });
    rt.depthTexture = new THREE.DepthTexture(texels, texels);
    rt.depthTexture.minFilter = THREE.NearestFilter;
    rt.depthTexture.magFilter = THREE.NearestFilter;
    this.rt = rt;
    this.rtSize = texels;
    this.uniforms.uMapTex.value = rt.texture;
    this.uniforms.uMapDepth.value = rt.depthTexture;
    this.uniforms.uMapNF.value.z = texels;
    return rt;
  }

  // What the worlds at the lens say: how much grass (0 to 1), how tall, how
  // many flowers; the two worlds of a border mixed by how far across it is.
  _worlds(ax, az) {
    const w = this.env.worlds.at(ax, az, this._w);
    const A = WORLDS[w.a].grass;
    const B = WORLDS[w.b].grass;
    const t = w.t;
    const amount = (A ? A.amount : 0) * (1 - t) + (B ? B.amount : 0) * t;
    const height = A && B ? A.height * (1 - t) + B.height * t : (A || B || { height: 0.5 }).height;
    const flowers = (A ? A.flowers : 0) * (1 - t) + (B ? B.flowers : 0) * t;
    return { amount, height, flowers };
  }

  // The land's tiles that reach into a square of the map, and how high and how
  // low they go: the eye is put above the highest, its far plane under the lowest.
  _reach(terrain, x0, z0, x1, z1) {
    let top = -1e9;
    let bottom = 1e9;
    for (const m of terrain.group.children) {
      if (!m.isMesh) continue;
      const g = m.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox;
      if (b.isEmpty()) continue;
      if (m.position.x + b.max.x < x0 || m.position.x + b.min.x > x1 || m.position.z + b.max.z < z0 || m.position.z + b.min.z > z1) continue;
      top = Math.max(top, b.max.y);
      bottom = Math.min(bottom, b.min.y);
    }
    return top > bottom ? [top, bottom] : null;
  }

  // The land's tiles drawn with the ground map's material, and put back.
  _swap(terrain, ground, tiles) {
    for (const m of terrain.group.children) {
      if (!m.isMesh) continue;
      m.layers.enable(1);
      if (m.material === terrain.material) {
        m.material = ground;
        tiles.push(m);
      }
    }
  }

  // Build ahead what turning to the painted style would build at its first
  // frame: the ground map's land material, the blades' programs, the meshes
  // (drawn once, so that they are on the GPU) and the map's target. Called while
  // the other kind of paint is the one drawn with (render/atmosphere.js).
  warm(renderer, scene, camera) {
    const tier = this.env.tier();
    if (tier === 'low') return;
    const terrain = this.env.terrain;
    const tile = terrain.group.children.find((m) => m.isMesh);
    if (tile) {
      const ground = terrain.groundMaterial();
      const was = tile.material;
      tile.layers.enable(1);
      tile.material = ground;
      this.eye.updateMatrixWorld(true);
      compileAsDrawn(renderer, scene, this.eye);
      tile.material = was;
    }
    if (this.tier !== tier) this._build(tier);
    const one = this._one || (this._one = new THREE.WebGLRenderTarget(1, 1));
    const back = renderer.getRenderTarget();
    const shown = this.group.visible;
    this.group.visible = true;
    renderer.setRenderTarget(one);
    renderer.render(scene, camera);
    renderer.setRenderTarget(back);
    this.group.visible = shown;
    renderer.info.reset();
  }

  // Draw the land round the lens from above into the ground map, then put the
  // blades where the lens is. Before the frame is drawn.
  render(renderer, camera, opts = {}) {
    const tier = this.env.tier();
    const painted = opts.style === 'paint' && !this.off && tier !== 'low';
    const o = this.env.road.origin;
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    const here = painted ? this._worlds(ax, az) : null;
    const on = painted && here.amount > 0.001;
    this.active = on;
    this.group.visible = on;
    grassHere.value = on ? Math.min(1, here.amount) : 0;
    if (!on) return;
    if (this.tier !== tier) this._build(tier);
    const terrain = this.env.terrain;
    const texel = MAP.size / this.rtSize;
    const cxA = Math.floor(ax / texel) * texel;
    const czA = Math.floor(az / texel) * texel;
    const cx = cxA - o.x;
    const cz = czA - o.z;
    const half = MAP.size / 2;
    const reach = this._reach(terrain, cx - half, cz - half, cx + half, cz + half);
    const sun = this.env.lights[0];
    if (!reach) { this.group.visible = false; this.active = false; return; }
    const eyeY = reach[0] + 5;
    const far = eyeY - (reach[1] - 5);
    const u = this.uniforms;
    u.uMapRect.value.set(cx - half, cz + half, MAP.size, eyeY);
    u.uMapNF.value.set(MAP.near, far, this.rtSize);
    u.uLook.value.x = here.height;
    const fov = camera.fov * Math.PI / 180;
    u.uLook.value.z = 2 * Math.tan(fov / 2) / (opts.height || 720);
    u.uFl.value.x = here.flowers;
    const rings = [...this.rings.map((r) => ({ r, cell: r.cell })), { r: this.flowers, cell: this.flowers.cell }];
    for (const { r, cell } of rings) {
      const ru = r.mat.userData.u;
      const c0x = Math.floor(ax / cell);
      const c0z = Math.floor(az / cell);
      ru.uCell0.value.set(c0x, c0z);
      ru.uCellOrg.value.set(c0x * cell - o.x, c0z * cell - o.z);
    }
    // The sun's shadow map is the one of the frame before: where the lens has
    // come from far (a place put down, a turn) or there is none yet, the scene
    // is drawn once into a target of a single pixel to make it for this place.
    if (!(sun.shadow && sun.shadow.map) || Math.hypot(ax - this.shadowAt.x, az - this.shadowAt.z) > 8) {
      if (!this._one) this._one = new THREE.WebGLRenderTarget(1, 1);
      const back = renderer.getRenderTarget();
      renderer.setRenderTarget(this._one);
      renderer.render(this.scene, camera);
      renderer.setRenderTarget(back);
      renderer.info.reset();
    }
    this.shadowAt.x = ax;
    this.shadowAt.z = az;
    const ground = terrain.groundMaterial();
    const rt = this.rt;
    const tiles = [];
    this._swap(terrain, ground, tiles);
    terrain.material.userData.uniforms.uEye.value.copy(camera.position);
    this.eye.far = far;
    this.eye.updateProjectionMatrix();
    this.eye.position.set(cx, eyeY, cz);
    this.eye.updateMatrixWorld(true);
    const was = { target: renderer.getRenderTarget(), alpha: renderer.getClearAlpha(), auto: renderer.shadowMap.autoUpdate };
    renderer.getClearColor(this._clear);
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(this.scene, this.eye);
    renderer.setRenderTarget(was.target);
    renderer.setClearColor(this._clear, was.alpha);
    renderer.shadowMap.autoUpdate = was.auto;
    for (const m of tiles) m.material = terrain.material;
  }

  dispose() {
    for (const r of this.rings) { r.geo.dispose(); r.mat.dispose(); }
    if (this.flowers) { this.flowers.geo.dispose(); this.flowers.mat.dispose(); }
    if (this.rt) { this.rt.depthTexture.dispose(); this.rt.dispose(); }
    if (this._one) this._one.dispose();
    this.group.removeFromParent();
  }
}
