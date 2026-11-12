// The cavern's roof: a disc of rock over the camera, nine kilometres across,
// a hundred and seventy metres over the floor's datum, drawn only where a
// world has a roof (the palette's cave flag, render/worldlook.js).
//
// Its height is shaped in the vertex shader from a tileable noise: broad
// domes, ribs, and stalactites hanging from it near the camera, where the
// rings are dense enough to carry them. Across a border the roof rises away
// into the sky, so coming out of the city the sky closes over, and going on
// into the inferno it opens again. Faces are shaded flat, like broken rock,
// lit from below by the crystals' light (the hemisphere's ground colour),
// and the rock is starred with glow-worm light.

import * as THREE from 'three';
import { withAtmosphere } from './atmosphere.js';
import { worldUniforms, WORLD_GLSL, PAL_P3 } from './worldlook.js';
import { WORLDS } from '../world/worlds.js';

const RADIUS = 9000;
const RINGS = 80;
const SEGMENTS = 160;
const ROOF = 168;            // metres, the roof's mean height
const AWAY = 2600;           // where the roof goes across a border

function discGeometry() {
  const pos = [0, 0, 0];
  const idx = [];
  for (let r = 1; r <= RINGS; r++) {
    const rad = RADIUS * Math.pow(r / RINGS, 2.4);
    for (let s = 0; s < SEGMENTS; s++) {
      const a = (s / SEGMENTS) * Math.PI * 2;
      pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    }
  }
  const ring = (r, s) => 1 + (r - 1) * SEGMENTS + (s % SEGMENTS);
  // Wound to face down.
  for (let s = 0; s < SEGMENTS; s++) idx.push(0, ring(1, s), ring(1, s + 1));
  for (let r = 1; r < RINGS; r++) {
    for (let s = 0; s < SEGMENTS; s++) {
      idx.push(ring(r, s), ring(r + 1, s + 1), ring(r, s + 1));
      idx.push(ring(r, s), ring(r + 1, s), ring(r + 1, s + 1));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? -1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

// R: broad shapes, G: ribs, B: stalactite field, A: glow-worm spots.
const N = 256;
function rockData() {
  const layers = [[6, 11], [24, 23], [64, 37], [128, 53]];
  const data = new Uint8Array(N * N * 4);
  layers.forEach(([cells, seed0], ch) => {
    let seed = seed0 * 2654435761 >>> 0;
    const g = new Float32Array(cells * cells).map(() => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    });
    for (let y = 0; y < N; y++) {
      const fy = (y / N) * cells;
      const y0 = Math.floor(fy);
      let ty = fy - y0;
      ty = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < N; x++) {
        const fx = (x / N) * cells;
        const x0 = Math.floor(fx);
        let tx = fx - x0;
        tx = tx * tx * (3 - 2 * tx);
        const at = (i, j) => g[(j % cells) * cells + (i % cells)];
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        data[(y * N + x) * 4 + ch] = Math.round((a + (b - a) * ty) * 255);
      }
    }
  });
  return data;
}
const ROCK = rockData();

function rockTexture() {
  const tex = new THREE.DataTexture(ROCK, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// The texture as the vertex shader reads it at level 0: bilinear, repeating.
function rock(ch, u, v) {
  const x = u * N - 0.5;
  const y = v * N - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const at = (i, j) => ROCK[((((j % N) + N) % N) * N + (((i % N) + N) % N)) * 4 + ch];
  const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
  const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
  return (a + (b - a) * ty) / 255;
}

export class Ceiling {
  constructor(scene, worlds) {
    this.worlds = worlds;
    this._w = { a: 0, b: 0, t: 0, u: 0 };
    this.uniforms = {
      uRock: { value: rockTexture() },
    };
    const mat = new THREE.MeshStandardMaterial({ color: 0x5a5048, roughness: 0.95, metalness: 0, flatShading: true });
    const uniforms = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms, worldUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform sampler2D uRock;
varying float vCave;
varying vec2 vAP;
${WORLD_GLSL}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec2 ap = (modelMatrix * vec4(transformed, 1.0)).xz + uWorldOrigin;
  worldAt(ap);
  float cave = mix(texelFetch(uWorldPal, ivec2(${PAL_P3}, wA), 0).y, texelFetch(uWorldPal, ivec2(${PAL_P3}, wB), 0).y, wT);
  vec4 n = textureLod(uRock, ap / 2400.0, 0.0);
  vec4 m = textureLod(uRock, ap / 310.0, 0.0);
  vec4 s = textureLod(uRock, ap / 41.0, 0.0);
  float spikes = pow(max(0.0, s.b - 0.55) / 0.45, 2.0);
  float roof = ${ROOF.toFixed(1)} + 70.0 * (n.r - 0.5) + 26.0 * (m.g - 0.5) - 30.0 * spikes;
  transformed.y = mix(${AWAY.toFixed(1)}, roof, smoothstep(0.0, 1.0, cave));
  vCave = cave;
  vAP = ap;
}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D uRock;
varying float vCave;
varying vec2 vAP;
vec3 tWorm;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
if (vCave < 0.02) discard;
vec4 r1 = texture2D(uRock, vAP / 23.0);
vec4 r2 = texture2D(uRock, vAP / 170.0);
diffuseColor.rgb *= (0.55 + 0.6 * r1.g) * (0.75 + 0.4 * r2.r);
// Glow-worms: blue-green points in clusters across the rock, each about
// half a metre, so they still read from the floor.
float spot = texture2D(uRock, vAP / 70.0).a;
float cluster = smoothstep(0.4, 0.7, r2.a);
tWorm = vec3(0.35, 1.0, 0.85) * smoothstep(0.78, 0.86, spot) * cluster * 5.0 * vCave;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += tWorm;`);
    };
    mat.customProgramCacheKey = () => 'continuum-ceiling';
    this.material = withAtmosphere(mat);
    this.mesh = new THREE.Mesh(discGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
  }

  // Centred over the camera, and drawn only while a world with a roof is
  // within reach of its rim (ax, az: the camera's absolute position).
  update(camera, ax, az) {
    const step = 16;
    this.mesh.position.set(Math.round(camera.position.x / step) * step, 0,
      Math.round(camera.position.z / step) * step);
    this.mesh.visible = this.worlds.reaches(ax, az, RADIUS, (w) => !!w.params.cave);
  }

  // How low the roof can hang over an absolute point: the shader's height
  // with every stalactite at its longest, so a camera kept under it never
  // ends up in the rock. Infinity where no world has a roof.
  roofAt(ax, az) {
    const w = this.worlds.at(ax, az, this._w);
    const cave = (WORLDS[w.a].params.cave || 0) * (1 - w.t) + (WORLDS[w.b].params.cave || 0) * w.t;
    if (cave < 0.02) return Infinity;
    const roof = ROOF + 70 * (rock(0, ax / 2400, az / 2400) - 0.5) + 26 * (rock(1, ax / 310, az / 310) - 0.5) - 30;
    const k = cave * cave * (3 - 2 * cave);
    return AWAY + (roof - AWAY) * k;
  }
}
