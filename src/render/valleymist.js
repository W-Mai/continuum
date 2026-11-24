// The mist on the rivers: a thin haze that lies on the water, from its surface up to
// six metres over it, in wisps that go slowly down the river.
//
// It is sheets: horizontal squares of sixty metres, laid on a lattice over the water in
// absolute coordinates (so each stays where it is as the lens goes by), the nearest of
// those with water under them and in reach. Three heights of them near the lens, the
// lowest the thickest, and farther off the lowest only. Each is drawn blended over the
// frame in the colour of the haze, and the shader makes it what it is: a noise that is
// carried down the river with the water (the land's own flow, as the sea has it), the
// water's own map (the mask, from world/valleyplan.js's grid) so that none of it is over
// land, how far the lens is from it, so that a sheet is not a plane that ends (each
// sheet is told where the sheets stop, and has faded away before that), and how far it
// is over the lens's own height or under it, so that a sheet the lens is level with, which
// it sees edge-on, is not there. In the block style the wisps are cells of six metres in
// four steps.

import * as THREE from 'three';
import { WATER_GRID } from '../world/valleyplan.js';

// size: metres across a sheet; layers: the height of each over the water (m); top: where the mist ends (m over the
// water); sheets: how many squares of the lattice have every layer, at each tier; far: how many more, beyond those,
// have the lowest layer only; reach: how far off the lens a sheet is drawn, in metres (the water must be within it,
// too); alpha: how thick one sheet is at the water; drift: the speed the wisps go at (m/s); tile: the metres one
// tile of the noise covers.
export const MIST = {
  size: 60,
  layers: { high: [0.7, 2.3, 4.1], mid: [0.9, 3.2], low: [] },
  top: 6,
  sheets: { high: 12, mid: 8, low: 0 },
  far: { high: 24, mid: 8, low: 0 },
  reach: 300,
  alpha: 0.14,
  drift: 0.6,
  tile: 304,
};

// How far the lens may go (m) before the sheets are chosen again.
const RESELECT = 12;

const VERTEX = /* glsl */`
attribute vec4 aSheet;
uniform float uSize;
uniform float uWaterY;
varying vec3 vWorld;
varying float vH;
varying float vEnd;
void main() {
  vec3 p = vec3(aSheet.x + position.x * uSize, aSheet.z, aSheet.y + position.z * uSize);
  vWorld = p;
  vH = aSheet.z - uWaterY;
  vEnd = aSheet.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAGMENT = /* glsl */`
uniform sampler2D uMask;
uniform sampler2D uNoise;
uniform vec2 uOrigin;
uniform vec2 uDrift;
uniform vec3 uCam;
uniform vec3 uFog;
uniform float uAlpha;
uniform float uTop;
uniform float uBlock;
varying vec3 vWorld;
varying float vH;
varying float vEnd;

void main() {
  vec2 w = vWorld.xz + uOrigin;
  float m = texture2D(uMask, w / ${(WATER_GRID.cell * WATER_GRID.n).toFixed(1)}).r;
  float over = smoothstep(0.5, 0.9, m);
  if (over <= 0.003) discard;
  // Wisps: the noise at two scales, carried down the river; cells of six metres, in steps, in the block style.
  vec2 q = (w - uDrift) / ${MIST.tile.toFixed(1)};
  q = mix(q, (floor(q * ${(MIST.tile / 6).toFixed(2)}) + 0.5) / ${(MIST.tile / 6).toFixed(2)}, uBlock);
  float n = 0.5 + (texture2D(uNoise, q).r + texture2D(uNoise, q * 2.0 + 0.37).r - 1.0) * 0.7071;
  float wisp = smoothstep(0.32, 0.78, n);
  wisp = mix(wisp, floor(wisp * 4.0 + 0.5) / 4.0, uBlock);
  // Thicker toward the water, none at the top; none where the sheets stop (away) and close to the lens (close), and none
  // where the lens is level with the sheet (level).
  float low = 1.0 - clamp(vH / uTop, 0.0, 1.0);
  float dist = length(w - (uCam.xz + uOrigin));
  float away = 1.0 - smoothstep(vEnd * 0.45, vEnd, dist);
  float close = smoothstep(1.5, 14.0, length(vWorld - uCam));
  float level = smoothstep(0.4, 2.2, abs(vWorld.y - uCam.y));
  float a = uAlpha * over * (0.22 + 0.78 * wisp) * low * away * close * level;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(uFog, a);
}
`;

// A tile of noise that repeats: three octaves of smooth value noise, the finest a thirty-second of the tile across.
function noiseTexture(n = 128, seed = 11) {
  const data = new Uint8Array(n * n);
  const octaves = [[8, 0.55], [16, 0.3], [32, 0.15]].map(([c, k], o) => {
    const v = new Float32Array(c * c);
    let s = (Math.imul(seed, 2654435761) + o * 40503) >>> 0;
    for (let i = 0; i < v.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      v[i] = s / 4294967296;
    }
    return { c, k, v };
  });
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let sum = 0;
      for (const { c, k, v } of octaves) {
        const u = (x / n) * c;
        const t = (y / n) * c;
        const i0 = Math.floor(u);
        const j0 = Math.floor(t);
        let fu = u - i0;
        let ft = t - j0;
        fu = fu * fu * (3 - 2 * fu);
        ft = ft * ft * (3 - 2 * ft);
        const a = v[(j0 % c) * c + (i0 % c)];
        const b = v[(j0 % c) * c + ((i0 + 1) % c)];
        const d = v[((j0 + 1) % c) * c + (i0 % c)];
        const e = v[((j0 + 1) % c) * c + ((i0 + 1) % c)];
        sum += k * ((a + (b - a) * fu) * (1 - ft) + (d + (e - d) * fu) * ft);
      }
      data[y * n + x] = Math.round(Math.min(1, Math.max(0, sum)) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export class Mist {
  // env: grid (WaterGrid), origin().
  constructor(scene, env) {
    this.env = env;
    this.scene = scene;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5], 3));
    geo.setIndex([0, 2, 1, 0, 3, 2]);
    const max = MIST.sheets.high * MIST.layers.high.length + MIST.far.high;
    this.max = max;
    this.sheets = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.sheets.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSheet', this.sheets);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.mask = new THREE.DataTexture(env.grid.mask, env.grid.n, env.grid.n, THREE.RedFormat, THREE.UnsignedByteType);
    this.mask.wrapS = this.mask.wrapT = THREE.RepeatWrapping;
    this.mask.magFilter = THREE.LinearFilter;
    this.mask.minFilter = THREE.LinearFilter;
    this.mask.generateMipmaps = false;
    this.mask.needsUpdate = true;
    this.noise = noiseTexture();
    this.uniforms = {
      uMask: { value: this.mask },
      uNoise: { value: this.noise },
      uOrigin: { value: new THREE.Vector2() },
      uDrift: { value: new THREE.Vector2() },
      uCam: { value: new THREE.Vector3() },
      uFog: { value: new THREE.Vector3(0.7, 0.78, 0.8) },
      uAlpha: { value: MIST.alpha },
      uTop: { value: MIST.top },
      uSize: { value: MIST.size },
      uWaterY: { value: 0 },
      uBlock: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      // Over what is there, and what it says of itself (the alpha) kept.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.count = 0;              // sheets drawn
    this.cells = 0;              // squares of the lattice they are laid on
    this.ends = [0, 0];          // how far off the lens the upper sheets and the lowest ones stop (m)
    this.near = false;           // the lens is within reach of water
    this._at = { x: 1e9, z: 1e9, tier: '', version: -1, ox: 1e9, oz: 1e9 };
    this._drift = [0, 0];
    this._maskVersion = -1;
  }

  // Every frame in the valley. tier: 'high', 'mid' or 'low'; fog: the frame's haze colour; blocks: 0 to 1, how far the
  // style is the block's; dt: s; flow: [x, z], the way the river runs at the lens; nearest: how far the nearest water is (m).
  update(camera, on, tier, { fog, blocks = 0, dt, flow, nearest, level }) {
    const layers = MIST.layers[tier] || [];
    const shown = on && layers.length > 0 && nearest !== null && nearest <= MIST.reach;
    this.near = shown;
    this.mesh.visible = shown;
    if (!shown) {
      this.count = 0;
      this.cells = 0;
      this.mesh.geometry.instanceCount = 0;
      return;
    }
    const o = this.env.origin();
    const u = this.uniforms;
    const g = this.env.grid;
    if (this._maskVersion !== g.version) {
      this._maskVersion = g.version;
      this.mask.needsUpdate = true;
    }
    // The wisps are carried down the river, slowly, and wrapped where a whole number of the noise's tiles has gone.
    const wrap = MIST.tile * 8;
    this._drift[0] = (this._drift[0] + flow[0] * MIST.drift * dt) % wrap;
    this._drift[1] = (this._drift[1] + flow[1] * MIST.drift * dt) % wrap;
    u.uDrift.value.set(this._drift[0], this._drift[1]);
    u.uOrigin.value.set(o.x, o.z);
    u.uCam.value.copy(camera.position);
    u.uFog.value.set(fog.r, fog.g, fog.b);
    u.uBlock.value = blocks;
    u.uWaterY.value = level;
    // The sheets: the squares of the lattice with water under them, nearest the lens first.
    const a = this._at;
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    if (Math.hypot(ax - a.x, az - a.z) < RESELECT && a.tier === tier && a.version === g.version && a.ox === o.x && a.oz === o.z) return;
    a.x = ax;
    a.z = az;
    a.tier = tier;
    a.version = g.version;
    a.ox = o.x;
    a.oz = o.z;
    const S = MIST.size;
    const R = MIST.reach + S;
    const found = [];
    for (let j = Math.floor((az - R) / S); j <= Math.floor((az + R) / S); j++) {
      for (let i = Math.floor((ax - R) / S); i <= Math.floor((ax + R) / S); i++) {
        const cx = (i + 0.5) * S;
        const cz = (j + 0.5) * S;
        const d = Math.hypot(cx - ax, cz - az);
        if (d > R) continue;
        if (!this._wetIn(g, i * S, j * S, S)) continue;
        found.push([d, cx, cz]);
      }
    }
    found.sort((p, q) => p[0] - q[0]);
    const near = Math.min(MIST.sheets[tier], found.length);
    const far = Math.min(MIST.far[tier], found.length - near);
    // Where the sheets stop: short of the nearest square that is left out, for what is left out is not there to go on (a
    // square's nearest point is half its diagonal nearer than its middle, and the lens may have moved on since).
    const stop = (i) => (i < found.length ? Math.max(30, Math.min(MIST.reach, found[i][0] - 0.71 * S - RESELECT)) : MIST.reach);
    const endUp = stop(near);
    const endLow = stop(near + far);
    this.ends[0] = endUp;
    this.ends[1] = endLow;
    const arr = this.sheets.array;
    let n = 0;
    const put = (c, h, end) => {
      arr[n * 4] = found[c][1] - o.x;
      arr[n * 4 + 1] = found[c][2] - o.z;
      arr[n * 4 + 2] = level + h;
      arr[n * 4 + 3] = end;
      n++;
    };
    for (let c = 0; c < near; c++) layers.forEach((h, k) => put(c, h, k === 0 ? endLow : endUp));
    for (let c = near; c < near + far; c++) put(c, layers[0], endLow);
    this.cells = near + far;
    this.count = n;
    this.mesh.geometry.instanceCount = n;
    this.sheets.needsUpdate = true;
  }

  // Whether any of the grid's cells in the square of `size` metres from (x0, z0) is water.
  _wetIn(g, x0, z0, size) {
    const n = g.n;
    const c = g.cell;
    for (let j = Math.floor(z0 / c); j < Math.ceil((z0 + size) / c); j++) {
      for (let i = Math.floor(x0 / c); i < Math.ceil((x0 + size) / c); i++) {
        const k = (j & (n - 1)) * n + (i & (n - 1));
        if (g.ci[k] === i && g.cj[k] === j && g.mask[k]) return true;
      }
    }
    return false;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mask.dispose();
    this.noise.dispose();
  }
}
