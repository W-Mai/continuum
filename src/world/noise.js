// Seeded 2D simplex noise and the fractal sums built on it.
//
// Everything the world generator places is a pure function of a seed and a
// world position, so these are deterministic and allocation free: the road
// planner, the terrain tiles and the props all ask the same functions and get
// the same answer.

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = new Float64Array([
  1, 1, -1, 1, 1, -1, -1, -1,
  1, 0, -1, 0, 0, 1, 0, -1,
  0.7071, 0.7071, -0.7071, 0.7071, 0.7071, -0.7071, -0.7071, -0.7071,
]);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash of an integer pair to [0, 1). Used for per-cell decisions (prop sites,
// set-piece rolls) where a whole noise lookup would be wasted.
export function hash2(ix, iy, seed = 0) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function hash1(n, seed = 0) {
  return hash2(n, 0x5bd1e995, seed);
}

export function makeSimplex(seed) {
  const perm = new Uint8Array(512);
  const permG = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  const rand = mulberry32(seed);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permG[i] = (perm[i] % 12) * 2;
  }

  // Returns roughly [-1, 1].
  return function simplex(xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = 1 - i1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = permG[ii + perm[jj]];
      t0 *= t0;
      n += t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = permG[ii + i1 + perm[jj + j1]];
      t1 *= t1;
      n += t1 * t1 * (GRAD[g] * x1 + GRAD[g + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = permG[ii + 1 + perm[jj + 1]];
      t2 *= t2;
      n += t2 * t2 * (GRAD[g] * x2 + GRAD[g + 1] * y2);
    }
    return 70 * n;
  };
}

// Simplex noise that also returns its analytic gradient, for fractals that need
// the slope of the octaves below them (erosion-like sums). Writes [n, dn/dx,
// dn/dy] into `out` so a hot loop allocates nothing.
export function makeSimplexD(seed) {
  const perm = new Uint8Array(512);
  const permG = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  const rand = mulberry32(seed);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permG[i] = (perm[i] % 12) * 2;
  }

  return function simplexD(xin, yin, out) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = 1 - i1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let dx = 0;
    let dy = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = permG[ii + perm[jj]];
      const gx = GRAD[g];
      const gy = GRAD[g + 1];
      const dot = gx * x0 + gy * y0;
      const t2 = t0 * t0;
      const t4 = t2 * t2;
      n += t4 * dot;
      const k = -8 * t2 * t0 * dot;
      dx += k * x0 + t4 * gx;
      dy += k * y0 + t4 * gy;
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = permG[ii + i1 + perm[jj + j1]];
      const gx = GRAD[g];
      const gy = GRAD[g + 1];
      const dot = gx * x1 + gy * y1;
      const t2 = t1 * t1;
      const t4 = t2 * t2;
      n += t4 * dot;
      const k = -8 * t2 * t1 * dot;
      dx += k * x1 + t4 * gx;
      dy += k * y1 + t4 * gy;
    }
    let tt = 0.5 - x2 * x2 - y2 * y2;
    if (tt > 0) {
      const g = permG[ii + 1 + perm[jj + 1]];
      const gx = GRAD[g];
      const gy = GRAD[g + 1];
      const dot = gx * x2 + gy * y2;
      const t2 = tt * tt;
      const t4 = t2 * t2;
      n += t4 * dot;
      const k = -8 * t2 * tt * dot;
      dx += k * x2 + t4 * gx;
      dy += k * y2 + t4 * gy;
    }
    out[0] = 70 * n;
    out[1] = 70 * dx;
    out[2] = 70 * dy;
    return out;
  };
}

// Erosion-style fractal (after Inigo Quilez): each octave is damped by the
// slope accumulated from the octaves below it, so steep flanks stay clean and
// detail collects in valleys and on crests. Returns roughly [-1, 1].
const _nd = new Float64Array(3);
export function erosionFbm(noiseD, x, y, octaves, gain = 0.5, damping = 1.0) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let gx = 0;
  let gy = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    noiseD(x, y, _nd);
    // The derivative is with respect to the rotated, scaled coordinates; for a
    // damping term only its magnitude matters, so the rotation can be ignored.
    gx += _nd[1] * amp * freq;
    gy += _nd[2] * amp * freq;
    sum += amp * _nd[0] / (1 + damping * (gx * gx + gy * gy));
    norm += amp;
    amp *= gain;
    freq *= 2;
    const nx = x * 1.6 - y * 1.2;
    const ny = x * 1.2 + y * 1.6;
    x = nx + 11.9;
    y = ny - 4.3;
  }
  return sum / norm;
}

// Fractal sum, normalised to roughly [-1, 1].
export function fbm(noise, x, y, octaves, lacunarity = 2.0, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x, y) * amp;
    norm += amp;
    amp *= gain;
    // Rotate each octave a little so the lattice directions do not line up.
    const nx = x * 1.6 - y * 1.2;
    const ny = x * 1.2 + y * 1.6;
    x = nx * (lacunarity / 2) + 17.3;
    y = ny * (lacunarity / 2) - 9.1;
  }
  return sum / norm;
}

// Ridged multifractal (Musgrave): sharp crests where the noise crosses zero,
// and each octave weighted by the one before so detail gathers on the ridges
// and the valleys stay smooth, which is what erosion does.
export function ridged(noise, x, y, octaves, lacunarity = 2.0, gain = 0.5, offset = 1.0) {
  let sum = 0;
  let amp = 0.5;
  let weight = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    let n = offset - Math.abs(noise(x, y));
    n *= n;
    n *= weight;
    weight = Math.min(1, Math.max(0, n * 2));
    sum += n * amp;
    norm += amp;
    amp *= gain;
    const nx = x * 1.6 - y * 1.2;
    const ny = x * 1.2 + y * 1.6;
    x = nx * (lacunarity / 2) + 31.7;
    y = ny * (lacunarity / 2) + 5.3;
  }
  return sum / norm;
}

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
