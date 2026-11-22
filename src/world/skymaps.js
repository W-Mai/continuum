// The noise of the space world's band of the galaxy and of its two nebulae, worked
// out once into two small maps, so that the sky's shader reads each layer of it
// with one texture read and does not work it out for every pixel.
//
// Pure numbers, no three.js (render/spacesky.js makes the textures and the check
// reads the maps from here). The noise is the sky shader's own value noise
// (hash, vnoise and the octaves of fbm in render/atmosphere.js, written here the
// same way), laid out by what the shader reads it by:
//  - the band by where a direction is along it and across it: l, the angle round
//    the band's pole, and b, the angle off the band (world/skyspace.js,
//    galaxyFrame); the map is GALAXY_MAP.w by GALAXY_MAP.h texels over l from -pi
//    to pi and over b from -bmax to bmax, 4 bytes a texel: the first layer of the
//    band in 5 octaves (r) and in 3, which the painted night has (g), the second
//    layer (b) and the finer layer the dust is cut from (a);
//  - a nebula by where a direction is on the plane it faces, in its own radii
//    (x and y from -reach to reach); the two nebulae are side by side, each
//    NEBULA_MAP.n texels a side, 2 bytes a texel: how thick it is in 5 octaves for
//    the first layer (r) and in 3 (g, the painted night's).

export const GALAXY_MAP = { w: 640, h: 192, bmax: 0.35 };
export const NEBULA_MAP = { n: 128, reach: 1.15, seeds: [3.7, 9.1] };

const fract = (v) => v - Math.floor(v);

// The shader's hash, vnoise and rotation by 1.6, 1.2 and the weights of fbm.
function hash(x, y) {
  let a = fract(x * 0.1031);
  let b = fract(y * 0.1031);
  let c = a;
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  return fract((a + b) * c);
}

function vnoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

// The first three octaves of fbm at (x, y), and then the next two: [the three, the fourth and the fifth].
const octaves = new Float64Array(2);
function fbm5(x, y) {
  let v = 0;
  let a = 0.5;
  for (let i = 0; i < 3; i++) {
    v += a * vnoise(x, y);
    const nx = 1.6 * x - 1.2 * y;
    y = 1.2 * x + 1.6 * y;
    x = nx;
    a *= 0.5;
  }
  let w = 0;
  for (let i = 0; i < 2; i++) {
    w += a * vnoise(x, y);
    const nx = 1.6 * x - 1.2 * y;
    y = 1.2 * x + 1.6 * y;
    x = nx;
    a *= 0.5;
  }
  octaves[0] = v;
  octaves[1] = w;
  return v + w;
}

// Three octaves, scaled to span what five do (the layers the painted night has, and the second and the finer layers of the band).
function fbm3(x, y) {
  let v = 0;
  let a = 0.5;
  for (let i = 0; i < 3; i++) {
    v += a * vnoise(x, y);
    const nx = 1.6 * x - 1.2 * y;
    y = 1.2 * x + 1.6 * y;
    x = nx;
    a *= 0.5;
  }
  return v * 1.107;
}

const byte = (v) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));

// --- the band -----------------------------------------------------------------

// The four layers of the band at l, b (radians): [first (5 octaves), first (3), second, fine].
export function galaxyAt(l, b, out = [0, 0, 0, 0]) {
  const qx = l * 3;
  const qy = b * 8;
  const five = fbm5(qx + 1.7, qy + 4.2);
  out[0] = five;
  out[1] = octaves[0] * 1.107;
  out[2] = fbm3(qx * 2.4 + 7.1, qy * 2.4 + 0.3);
  out[3] = fbm3(l * 6 + 3.3, b * 26 + 3.3);
  return out;
}

// The l and b a texel of the map is at (its middle).
export const galaxyL = (x) => ((x + 0.5) / GALAXY_MAP.w - 0.5) * 2 * Math.PI;
export const galaxyB = (y) => ((y + 0.5) / GALAXY_MAP.h * 2 - 1) * GALAXY_MAP.bmax;

// --- the nebulae ----------------------------------------------------------------

// How thick the nebula with this seed is at (x, y), in its radii: [in 5 octaves, in 3].
export function nebulaAt(seed, x, y, out = [0, 0]) {
  const five = fbm5(x * 2.2 + seed, y * 2.2 + seed);
  const first5 = five;
  const first3 = octaves[0] * 1.107;
  const second = fbm3(x * 5.3 + seed + 11, y * 5.3 + seed + 11);
  out[0] = first5 * 0.65 + second * 0.45;
  out[1] = first3 * 0.65 + second * 0.45;
  return out;
}

export const nebulaXY = (i) => ((i + 0.5) / NEBULA_MAP.n * 2 - 1) * NEBULA_MAP.reach;

// --- the maps ------------------------------------------------------------------

// About how many noise lookups (hashes) a row of the galaxy's map and a row of the
// nebulae's take, to give a slice of the work a size.
const GALAXY_ROW = GALAXY_MAP.w * 44;
const NEBULA_ROW = NEBULA_MAP.n * 2 * 32;

export class SkyMaps {
  constructor() {
    this.galaxy = new Uint8Array(GALAXY_MAP.w * GALAXY_MAP.h * 4);
    this.nebula = new Uint8Array(NEBULA_MAP.n * 2 * NEBULA_MAP.n * 2);
    this.galaxyRows = 0;
    this.nebulaRows = 0;
  }

  get done() {
    return this.galaxyRows >= GALAXY_MAP.h && this.nebulaRows >= NEBULA_MAP.n;
  }

  // Works out rows of the maps, until about `units` hashes have been spent (all of it
  // for Infinity). Returns whether the maps are done.
  step(units = Infinity) {
    let spent = 0;
    const q = [0, 0, 0, 0];
    const n = [0, 0];
    while (this.galaxyRows < GALAXY_MAP.h && spent < units) {
      const y = this.galaxyRows++;
      const b = galaxyB(y);
      for (let x = 0; x < GALAXY_MAP.w; x++) {
        galaxyAt(galaxyL(x), b, q);
        const k = (y * GALAXY_MAP.w + x) * 4;
        this.galaxy[k] = byte(q[0]);
        this.galaxy[k + 1] = byte(q[1]);
        this.galaxy[k + 2] = byte(q[2]);
        this.galaxy[k + 3] = byte(q[3]);
      }
      spent += GALAXY_ROW;
    }
    const N = NEBULA_MAP.n;
    while (this.galaxyRows >= GALAXY_MAP.h && this.nebulaRows < N && spent < units) {
      const j = this.nebulaRows++;
      const y = nebulaXY(j);
      for (let side = 0; side < 2; side++) {
        for (let i = 0; i < N; i++) {
          nebulaAt(NEBULA_MAP.seeds[side], nebulaXY(i), y, n);
          const k = (j * N * 2 + side * N + i) * 2;
          this.nebula[k] = byte(n[0]);
          this.nebula[k + 1] = byte(n[1]);
        }
      }
      spent += NEBULA_ROW;
    }
    return this.done;
  }
}

// What the sky's shader reads from the maps (bilinear, as the texture is read), for
// the check: the band's four layers at l, b and a nebula's two at x, y (0 to 1 each).
export function readGalaxy(maps, l, b, out = [0, 0, 0, 0]) {
  const { w, h, bmax } = GALAXY_MAP;
  const fx = ((l / (2 * Math.PI) + 0.5) % 1 + 1) % 1 * w - 0.5;
  const fy = Math.min(Math.max((b + bmax) / (2 * bmax), 0), 1) * h - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (x, y, c) => maps.galaxy[(Math.min(Math.max(y, 0), h - 1) * w + (((x % w) + w) % w)) * 4 + c] / 255;
  for (let c = 0; c < 4; c++) {
    out[c] = (at(x0, y0, c) * (1 - tx) + at(x0 + 1, y0, c) * tx) * (1 - ty) + (at(x0, y0 + 1, c) * (1 - tx) + at(x0 + 1, y0 + 1, c) * tx) * ty;
  }
  return out;
}

export function readNebula(maps, side, x, y, out = [0, 0]) {
  const N = NEBULA_MAP.n;
  const clampN = (v) => Math.min(Math.max(v, 0.5 / N), 1 - 0.5 / N);
  const fx = clampN(x / (2 * NEBULA_MAP.reach) + 0.5) * N - 0.5;
  const fy = clampN(y / (2 * NEBULA_MAP.reach) + 0.5) * N - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (i, j, c) => maps.nebula[(Math.min(Math.max(j, 0), N - 1) * N * 2 + side * N + Math.min(Math.max(i, 0), N - 1)) * 2 + c] / 255;
  for (let c = 0; c < 2; c++) {
    out[c] = (at(x0, y0, c) * (1 - tx) + at(x0 + 1, y0, c) * tx) * (1 - ty) + (at(x0, y0 + 1, c) * (1 - tx) + at(x0 + 1, y0 + 1, c) * tx) * ty;
  }
  return out;
}
