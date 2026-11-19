// Rivers, lakes and the sea: one water surface at the worlds' water level,
// centred on the camera and dense near it, nine kilometres across.
//
// It shows only where a world has water, decided per pixel from the same
// world palette the terrain reads (render/worldlook.js), and fades in across a
// border at the threshold the road uses to keep clear of it
// (world/worlds.js). Waves are two scrolling normal maps; the reflections are
// the sky's own environment map, so the water darkens and brightens with the
// world above it.

import * as THREE from 'three';
import { withAtmosphere } from './atmosphere.js';
import { twistU, twistLine } from './twist.js';
import { worldUniforms, WORLD_GLSL, PAL } from './worldlook.js';
import { styleU, pairProgram } from './style.js';

// The painted style's lava (in the worlds lit by night): molten rock in two
// colours, as they come out on the screen (linear), with a hard edge between
// them, and the crust, darker, beyond the second. The colours are laid by the
// height the surface is worked out from (the crust's own, in the water's
// shader): the core under coreTo, the rim under rimTo, the crust above. Far
// off the fine layer of that height is left out (from far[0] to far[1] metres:
// its cracks are a pixel or two across, and the edges of them shimmer), and the
// height is raised a little (farAdd), so that a distant river is more crust.
const LAVA = { core: [1.6, 1.1, 0.3], rim: [0.9, 0.25, 0.05], coreTo: 0.48, rimTo: 0.56, far: [60, 250], farAdd: 0.08 };

// (Where the water's shader works out its lava: in the painted style's program only.)
const LAVA_PAINTED = `
if (uPair * lava > 0.0) {
  float lavaFar = smoothstep(${LAVA.far[0].toFixed(1)}, ${LAVA.far[1].toFixed(1)}, wDist);
  float n = mix(w3.z * 0.55 + w1.z * 0.25 + w4.z * 0.2, (w3.z * 0.55 + w4.z * 0.2) * 1.3333, lavaFar) + ${LAVA.farAdd.toFixed(2)} * lavaFar;
  float e = fwidth(n) * 1.2 + 0.004;
  float inRim = 1.0 - smoothstep(${LAVA.rimTo.toFixed(2)} - e, ${LAVA.rimTo.toFixed(2)} + e, n);
  float inCore = 1.0 - smoothstep(${LAVA.coreTo.toFixed(2)} - e, ${LAVA.coreTo.toFixed(2)} + e, n);
  vec3 molten = mix(vec3(${LAVA.rim.map((x) => x.toFixed(3)).join(', ')}), vec3(${LAVA.core.map((x) => x.toFixed(3)).join(', ')}), inCore);
  diffuseColor.rgb = mix(diffuseColor.rgb, deep * (1.0 - inRim), uPair * lava);
  tLiquidGlow = mix(tLiquidGlow, molten * inRim * uPaintInv, uPair * lava);
}`;

const RADIUS = 9000;
const RINGS = 56;
const SEGMENTS = 128;
// While the world is wound over (render/twist.js) the sea is wound with the
// land, each corner of its disc by where it stands, and a triangle is drawn
// flat from corner to corner: the disc is then one of finer triangles
// (within some 100 m across where the fold is, against 300), so that the
// sea keeps to the land's own curve and its shore to the shore, and it is
// held on the middle of the wound stretch, where it is finest, and made
// WOUND_SCALE times as wide, to reach as far from the lens as the lens sees.
// And it is drawn from above only: the fold shows a great deal of the sea
// from underneath, where there is nothing of it to see, and the whole of
// the water's shader was worked at every pixel of that. (No lens is under a
// sea while anything is wound: the worlds either side of the Upside Down
// have none to be under.)
const WOUND_RINGS = 150;
const WOUND_SEGMENTS = 256;
const WOUND_SCALE = 1.8;
// A world's water shows where its share of the blend is over 0.35 (the
// fragment shader); under this at a corner there is none near it.
const DRY = 0.2;

function discGeometry(rings, segments) {
  const pos = [0, 0, 0];
  const idx = [];
  for (let r = 1; r <= rings; r++) {
    const rad = RADIUS * Math.pow(r / rings, 2.3);
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    }
  }
  const ring = (r, s) => 1 + (r - 1) * segments + (s % segments);
  for (let s = 0; s < segments; s++) idx.push(0, ring(1, s + 1), ring(1, s));
  for (let r = 1; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      idx.push(ring(r, s), ring(r, s + 1), ring(r + 1, s + 1));
      idx.push(ring(r, s), ring(r + 1, s + 1), ring(r + 1, s));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

// In-place radix-2 FFT of n complex values held in two arrays, n a power of two.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const wr = Math.cos((2 * Math.PI) / len);
    const wi = Math.sin((2 * Math.PI) / len);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

// Tileable wave heights as a normal map, with the heights themselves in blue.
// They are made as a spectrum and turned back into space, so they have no
// lattice: value noise lines its slopes up along its cells, and seen edge-on
// from high over the cloud the lines read as a grid.
function waveTexture() {
  const N = 256;
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const unit = (v) => Math.min(1, Math.max(0, v));
  // Wavelengths from a quarter of the tile down to a few pixels, amplitude
  // falling as 1/k², so every octave carries the same share of the slope.
  const re = new Float64Array(N * N);
  const im = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    const ky = y < N / 2 ? y : y - N;
    for (let x = 0; x < N; x++) {
      const kx = x < N / 2 ? x : x - N;
      const k = Math.hypot(kx, ky);
      const a = k < 1 ? 0 : (unit((k - 2.4) / 1.6) * unit((56 - k) / 16.8)) / (k * k);
      re[y * N + x] = gauss() * a;
      im[y * N + x] = gauss() * a;
    }
  }
  const lr = new Float64Array(N);
  const li = new Float64Array(N);
  for (const across of [true, false]) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const at = across ? j * N + i : i * N + j;
        lr[i] = re[at];
        li[i] = im[at];
      }
      fft(lr, li);
      for (let i = 0; i < N; i++) {
        const at = across ? j * N + i : i * N + j;
        re[at] = lr[i];
        im[at] = li[i];
      }
    }
  }
  const h = re;
  const at = (x, y) => h[((y + N) % N) * N + ((x + N) % N)];
  let mean = 0;
  for (const v of h) mean += v;
  mean /= N * N;
  let spread = 0;
  let slope = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      spread += (at(x, y) - mean) ** 2;
      slope += (at(x + 1, y) - at(x - 1, y)) ** 2;
    }
  }
  spread = Math.sqrt(spread / (N * N));
  // The slope and the spread of heights the value noise had, so water, lava
  // and cloud keep their look.
  const gain = 14.2 / Math.sqrt(slope / (N * N));
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const k = (y * N + x) * 4;
      data[k] = Math.max(0, Math.min(255, 128 - (at(x + 1, y) - at(x - 1, y)) * gain));
      data[k + 1] = Math.max(0, Math.min(255, 128 - (at(x, y + 1) - at(x, y - 1)) * gain));
      data[k + 2] = Math.round(255 * unit(0.53 + (0.19 * (at(x, y) - mean)) / spread));
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// How often it is asked whether any world in the disc's reach has a sea.
const DRY_EVERY = 0.5;       // s
const hasSea = (world) => world.params.water !== null && world.params.water !== undefined;

export class Water {
  // worlds: the map of the worlds (world/worlds.js), for where there is a sea.
  constructor(scene, level = 0, worlds = null) {
    this.level = level;
    this.worlds = worlds;
    this._dry = 0;
    this.uniforms = {
      uWave: { value: waveTexture() },
      uTime: { value: 0 },
      uOffset: { value: new THREE.Vector2() },
      // 1: no world in the disc's reach has a sea, and none of it is drawn.
      uSeaDry: { value: 0 },
    };
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.1, metalness: 0, transparent: true, depthWrite: true,
      side: THREE.DoubleSide,
    });
    // What a winding lifts into the sky is drawn thinner, not hazed (the
    // haze, render/atmosphere.js: FOLD_ALPHA, defined while anything is
    // wound, update).
    const uniforms = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      const paintOn = pairProgram.on;
      Object.assign(shader.uniforms, uniforms, worldUniforms, { uPair: styleU.uPair, uPaintInv: styleU.uPaintInv });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform vec2 uOffset;
uniform float uSeaDry;
varying vec3 vWPos;
${WORLD_GLSL}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz + vec3(uOffset.x, 0.0, uOffset.y);`)
        // No sea where no world has one. The disc is drawn all round the
        // lens, and the pixels of it over a dry world are thrown away one
        // by one, each after the worth of a pixel's work: where the land
        // hides them that is little, but it is not nothing, and wound over
        // (render/twist.js) the dry side of the disc hangs across the whole
        // sky. So with no world that has a sea anywhere in the disc's reach
        // (uSeaDry, update) every corner of it is put past the far plane,
        // and none of it is drawn; and while the world is wound over, each
        // corner that stands in a dry world is (a triangle of three such is
        // not drawn; one with a wet corner is, all of it that shows).
        .replace('#include <fog_vertex>', `#include <fog_vertex>
if (uSeaDry > 0.5) {
  gl_Position.z = 2.0 * gl_Position.w;
} else if (uTwist.x > 0.5) {
  worldAt(vWPos.xz);
  if (worldWet() < ${DRY.toFixed(2)}) gl_Position.z = 2.0 * gl_Position.w;
}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D uWave;
uniform float uTime;
uniform vec2 uOffset;${paintOn ? '\nuniform float uPair;\nuniform float uPaintInv;' : ''}
varying vec3 vWPos;
${WORLD_GLSL}
vec3 tWaterN;
vec3 tLiquidGlow;
float tLiquidRough;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
worldAt(vWPos.xz);
float wShow = smoothstep(0.35, 0.65, worldWet());
if (wShow < 0.01) discard;
vec4 liq = worldPar(2);     // glow, roughness, opacity, cloud
float lava = worldPar(3).x;
float cloud = liq.w;
vec3 camW = cameraPosition + vec3(uOffset.x, 0.0, uOffset.y);
float wDist = length(vWPos - camW);
// Water: two wave trains crossing, finer close up, flattened with distance,
// where they would only shimmer. Lava creeps and cloud drifts, both slowly,
// in broad swells.
vec2 q = vWPos.xz;
float speed = mix(1.0, 0.12, max(lava, cloud));
// The broad layers are turned against each other, so the repeats of the
// texture never line up into a grid, which from high over the cloud they would.
const mat2 R1 = mat2(0.8, 0.6, -0.6, 0.8);
const mat2 R2 = mat2(0.92, -0.39, 0.39, 0.92);
vec4 w1 = texture2D(uWave, q / 37.0 + vec2(uTime * 0.012, uTime * 0.007) * speed);
vec4 w2 = texture2D(uWave, q / 13.0 + vec2(-uTime * 0.017, uTime * 0.021) * speed);
vec4 w3 = texture2D(uWave, R1 * q / 230.0 + vec2(uTime * 0.003, -uTime * 0.002) * speed);
vec4 w4 = texture2D(uWave, R2 * q / 900.0 + vec2(uTime * 0.0012, uTime * 0.0007));
vec4 w5 = texture2D(uWave, R2 * R2 * q / 3700.0 + vec2(-uTime * 0.0004, uTime * 0.0003));
vec2 fine = (w1.xy - 0.5) * 0.9 + (w2.xy - 0.5) * 0.55;
vec2 slope = fine * (1.0 - smoothstep(120.0, 900.0, wDist)) + (w3.xy - 0.5) * 0.5;
vec2 swell = (w3.xy - 0.5) * 1.4 + (w4.xy - 0.5) * 1.1;
slope = mix(slope, swell, max(cloud, lava * 0.6));
tWaterN = normalize(vec3(-slope.x, 1.0, -slope.y));
vec3 deep = worldPal(${PAL.waterDeep});
vec3 shallow = worldPal(${PAL.waterShallow});
vec3 viewDir = normalize(camW - vWPos);
float down = clamp(viewDir.y, 0.0, 1.0);
vec3 waterCol = mix(deep, shallow, pow(down, 1.5) * 0.8);
// Cloud: bright tops, shadowed hollows. Lava: a dark crust broken by molten
// cracks that glow.
float tops = w3.z * 0.45 + w4.z * 0.33 + w5.z * 0.22;
vec3 cloudCol = mix(deep, shallow, smoothstep(0.25, 0.75, tops));
float crust = smoothstep(0.38, 0.6, w3.z * 0.55 + w1.z * 0.25 + w4.z * 0.2);
vec3 lavaCol = mix(shallow * 0.6, deep, crust);
diffuseColor.rgb = mix(mix(waterCol, cloudCol, cloud), lavaCol, lava);
tLiquidGlow = shallow * liq.x * mix(1.0, (1.0 - crust) * 1.6 + 0.05, lava) * mix(1.0, 0.5 + 0.5 * tops, cloud);${paintOn ? LAVA_PAINTED : ''}
// Seen from below (the deep sea), the surface is the brightest thing there is.
if (!gl_FrontFacing) tLiquidGlow += shallow * 1.4;
tLiquidRough = liq.y;
diffuseColor.a = wShow * clamp(mix(liq.z + 0.06, liq.z - 0.05, down) + max(lava, cloud), 0.0, 1.0);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = tLiquidRough;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += tLiquidGlow;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize((viewMatrix * vec4(tWaterN, 0.0)).xyz);`);
    };
    mat.customProgramCacheKey = () => 'continuum-water' + (pairProgram.on ? '-painted' : '');
    // Drawn blended, so it has no mark in the alpha (render/style.js's MARK):
    // one would change how it blends.
    this.material = withAtmosphere(mat);
    this.flat = discGeometry(RINGS, SEGMENTS);
    this.fine = null;
    this.wound = false;
    this.mesh = new THREE.Mesh(this.flat, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }

  setOrigin(x, z) {
    this.uniforms.uOffset.value.set(x, z);
  }

  // Centred under the camera, stepped so the rings do not crawl over the
  // waves; while the world is wound over, held on the wound stretch.
  update(dt, camera) {
    this.uniforms.uTime.value += dt;
    const mesh = this.mesh;
    const wound = twistU.uTwist.value[0] > 0.5;
    const turned = wound !== this.wound;
    if (turned) {
      this.wound = wound;
      this.material.side = wound ? THREE.FrontSide : THREE.DoubleSide;
      // Its shader for a wound world is another (the haze): anywhere else
      // it is the one it always was. three keeps both once they are built.
      if (wound) this.material.defines.FOLD_ALPHA = '';
      else delete this.material.defines.FOLD_ALPHA;
      this.material.needsUpdate = true;
      // The disc not drawn is not kept on the GPU: it is given again when
      // it is next wanted.
      const idle = wound ? this.flat : this.fine;
      if (idle) idle.dispose();
    }
    if (wound) {
      const l = twistLine;
      if (!this.fine) this.fine = discGeometry(WOUND_RINGS, WOUND_SEGMENTS);
      mesh.geometry = this.fine;
      mesh.position.set(l.x + l.dx * l.len / 2, this.level, l.z + l.dz * l.len / 2);
      mesh.scale.setScalar(WOUND_SCALE);
    } else {
      mesh.geometry = this.flat;
      mesh.scale.setScalar(1);
      const step = 32;
      mesh.position.set(Math.round(camera.position.x / step) * step, this.level,
        Math.round(camera.position.z / step) * step);
    }
    // Whether any world the disc reaches has a sea: now and then, and when
    // the disc is put somewhere else.
    this._dry -= dt;
    if (this.worlds && (this._dry <= 0 || turned)) {
      this._dry = DRY_EVERY;
      const o = this.uniforms.uOffset.value;
      // A disc under the lens is as far on by the next time this is asked.
      const reach = RADIUS * mesh.scale.x + 400;
      this.uniforms.uSeaDry.value = this.worlds.reaches(mesh.position.x + o.x, mesh.position.z + o.y, reach, hasSea) ? 0 : 1;
    }
  }
}
