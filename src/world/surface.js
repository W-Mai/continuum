// The grain of the road's surfaces, drawn in numbers: the stones of the asphalt,
// the gravel of the verge, the pores and the grain of the concrete of a parapet and
// the spangle of galvanized steel. Each is a square tile that repeats, made of a
// height (or, for the steel, of the tilt of its crystals) and read as the way the
// surface leans (two slopes), how rough it is, how deep in a hollow, and how light
// a stone is. A tile comes with all its mips; the mips are made here too, so
// that the slopes the eye cannot tell apart at a distance are not lost but turn
// into roughness (the further down the chain, the more of the slopes' spread is
// in the roughness: a surface seen far off is rough, not speckled).
//
// This file touches no three.js, so the page and a worker (world/bakeworker.js) run
// the same code and get the same bytes (tools/bake_check.mjs).
//
// What a tile is (bakeSurface): { size, a, b } where a is RGBA bytes, all the mips
// one after the other from the largest: red and green the slopes across and along
// the tile (128 flat), blue the roughness, alpha the cavity (255 open, less where
// the sky's light does not reach into it); and b, where there is one, two bytes
// a texel in the same order: the tone of a stone (128 as it is) and a tint (the
// asphalt's only).

export const SURFACES = {
  // size: texels across a tile; tile: metres across a tile; k: the slopes are
  // stored as this many times the slope, so that the steepest the tile has fit a byte.
  asphalt: { size: 512, tile: 1.6, k: 0.6, two: true },
  verge: { size: 256, tile: 1.6, k: 0.5, two: false },
  concrete: { size: 256, tile: 1.6, k: 1.0, two: false },
  steel: { size: 256, tile: 1.6, k: 1.0, two: false },
};
export const SURFACE_NAMES = Object.keys(SURFACES);

// The means of what a tile holds, which the shaders take as given (their colours are
// worked out as a lift or a drop from these, so that the road is as light as it was
// where a tile is not there yet): the asphalt's stones' tone (0 to 1) and its cavity,
// the verge's cavity (it holds the stones' tone too), the concrete's, the steel's and
// the asphalt's roughness. tools/surface_check.mjs holds the tiles to them.
export const MEANS = {
  asphalt: { tone: 0.436, cavity: 0.883, rough: 0.868 },
  verge: { cavity: 0.709 },
  concrete: { rough: 0.861 },
  steel: { rough: 0.402 },
};

// The mips of a square tile, from the largest to a single texel.
export function mipSizes(size) {
  const out = [];
  for (let s = size; s >= 1; s >>= 1) out.push(s);
  return out;
}

// Bytes of a tile's `a` (4 a texel) and `b` (2 a texel), all mips.
export function surfaceBytes(name) {
  const { size, two } = SURFACES[name];
  const texels = mipSizes(size).reduce((n, s) => n + s * s, 0);
  return texels * (two ? 6 : 4);
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wrap = (v, n) => ((v % n) + n) % n;

// A unit direction, drawn without a sine.
function turn(rand) {
  for (;;) {
    const u = rand() * 2 - 1;
    const v = rand() * 2 - 1;
    const q = u * u + v * v;
    if (q > 0.04 && q <= 1) {
      const m = Math.sqrt(q);
      return [u / m, v / m];
    }
  }
}

// Value noise that repeats: a grid of gx by gy random values read smoothly at
// each of the size by size texels.
function valueNoise(rand, size, gx, gy) {
  const g = new Float32Array(gx * gy);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y * gy) / size;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const wy = ty * ty * (3 - 2 * ty);
    const r0 = (y0 % gy) * gx;
    const r1 = ((y0 + 1) % gy) * gx;
    for (let x = 0; x < size; x++) {
      const fx = (x * gx) / size;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const wx = tx * tx * (3 - 2 * tx);
      const x1 = (x0 + 1) % gx;
      const a = g[r0 + (x0 % gx)] + (g[r0 + x1] - g[r0 + (x0 % gx)]) * wx;
      const b = g[r1 + (x0 % gx)] + (g[r1 + x1] - g[r1 + (x0 % gx)]) * wx;
      out[y * size + x] = a + (b - a) * wy;
    }
  }
  return out;
}

// The mean of a (2r + 1) square round every texel, the tile repeating.
function blur(src, size, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < size; y++) {
    const row = y * size;
    let s = 0;
    for (let d = -r; d <= r; d++) s += src[row + wrap(d, size)];
    for (let x = 0; x < size; x++) {
      tmp[row + x] = s * k;
      s += src[row + wrap(x + r + 1, size)] - src[row + wrap(x - r, size)];
    }
  }
  for (let x = 0; x < size; x++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += tmp[wrap(d, size) * size + x];
    for (let y = 0; y < size; y++) {
      out[y * size + x] = s * k;
      s += tmp[wrap(y + r + 1, size) * size + x] - tmp[wrap(y - r, size) * size + x];
    }
  }
  return out;
}

// A stone laid on the height field: an ellipse (rx, ry across, turned by the unit
// direction (ca, sa)) rising to `top` in the middle as a dome, where it is
// higher than what is there. The tone of the stone is kept where it shows.
function lay(H, T, size, cx, cy, rx, ry, ca, sa, top, tone) {
  const R = Math.ceil(Math.max(rx, ry)) + 1;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  for (let dy = -R; dy <= R; dy++) {
    const Y = y0 + dy;
    const v = Y + 0.5 - cy;
    const row = wrap(Y, size) * size;
    for (let dx = -R; dx <= R; dx++) {
      const X = x0 + dx;
      const u = X + 0.5 - cx;
      const a = (u * ca + v * sa) / rx;
      const b = (-u * sa + v * ca) / ry;
      const q = a * a + b * b;
      if (q >= 1) continue;
      const h = top * Math.sqrt(1 - q);
      const i = row + wrap(X, size);
      if (h > H[i]) {
        H[i] = h;
        T[i] = tone;
      }
    }
  }
}

// A field of stones: `count` of them, radii between lo and hi texels, no flatter
// than `flat` of round, rising `rise` of their radius; tones between t0 and t1.
function stones(H, T, size, rand, count, lo, hi, flat, rise, t0, t1) {
  for (let n = 0; n < count; n++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const r = lo + (hi - lo) * rand() * rand();
    const f = flat + (1 - flat) * rand();
    const [ca, sa] = turn(rand);
    lay(H, T, size, cx, cy, r, r * f, ca, sa, r * (rise[0] + (rise[1] - rise[0]) * rand()), t0 + (t1 - t0) * rand());
  }
}

// The slopes of a height field in texels of height a texel (the tile repeating).
function slopes(H, size) {
  const sx = new Float32Array(size * size);
  const sy = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const row = y * size;
    const up = wrap(y - 1, size) * size;
    const dn = wrap(y + 1, size) * size;
    for (let x = 0; x < size; x++) {
      sx[row + x] = (H[row + wrap(x + 1, size)] - H[row + wrap(x - 1, size)]) * 0.5;
      sy[row + x] = (H[dn + x] - H[up + x]) * 0.5;
    }
  }
  return { sx, sy };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const byte = (v) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));

// The fields of a tile (size by size floats): sx, sy the slopes, rough, cav (1 open),
// tone and tint (0.5 as it is, or null), all as the level 0 of a chain of mips; to the
// bytes of that chain. The mips average the slopes, the cavity, the tone and the tint,
// and the roughness is kept as two things (the grain's own, and the spread of the
// slopes it has lost to the mips), put together as the roughness of the level.
function chain(size, f, k, two) {
  const levels = mipSizes(size);
  const texels = levels.reduce((n, s) => n + s * s, 0);
  const a = new Uint8Array(texels * 4);
  const b = two ? new Uint8Array(texels * 2) : null;
  let sx = f.sx;
  let sy = f.sy;
  let ro = f.rough;
  let cv = f.cav;
  let tn = f.tone;
  let tt = f.tint;
  let va = new Float32Array(size * size);     // the spread of the slopes, summed over the mips so far
  let at = 0;
  let atB = 0;
  levels.forEach((s, level) => {
    const n = s * s;
    for (let i = 0; i < n; i++) {
      // The roughness of a level: the grain's own (alpha = r * r) with the spread
      // of the slopes added to alpha squared (twice the variance, of the slopes as
      // the shader lays them).
      const a2 = ro[i] * ro[i] * ro[i] * ro[i] + 2 * va[i] * k * k * 0.36;
      const r = Math.sqrt(Math.sqrt(a2));
      a[(at + i) * 4] = byte(0.5 + 0.5 * clamp(sx[i] * k, -1, 1));
      a[(at + i) * 4 + 1] = byte(0.5 + 0.5 * clamp(sy[i] * k, -1, 1));
      a[(at + i) * 4 + 2] = byte(r);
      a[(at + i) * 4 + 3] = byte(cv[i]);
      if (b) {
        b[(atB + i) * 2] = byte(tn[i]);
        b[(atB + i) * 2 + 1] = byte(tt[i]);
      }
    }
    at += n;
    atB += n;
    if (level === levels.length - 1) return;
    const h = s >> 1;
    const nsx = new Float32Array(h * h);
    const nsy = new Float32Array(h * h);
    const nro = new Float32Array(h * h);
    const ncv = new Float32Array(h * h);
    const ntn = tn ? new Float32Array(h * h) : null;
    const ntt = tt ? new Float32Array(h * h) : null;
    const nva = new Float32Array(h * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < h; x++) {
        const i0 = 2 * y * s + 2 * x;
        const i1 = i0 + 1;
        const i2 = i0 + s;
        const i3 = i2 + 1;
        const o = y * h + x;
        const mx = (sx[i0] + sx[i1] + sx[i2] + sx[i3]) * 0.25;
        const my = (sy[i0] + sy[i1] + sy[i2] + sy[i3]) * 0.25;
        nsx[o] = mx;
        nsy[o] = my;
        nro[o] = (ro[i0] + ro[i1] + ro[i2] + ro[i3]) * 0.25;
        ncv[o] = (cv[i0] + cv[i1] + cv[i2] + cv[i3]) * 0.25;
        if (ntn) ntn[o] = (tn[i0] + tn[i1] + tn[i2] + tn[i3]) * 0.25;
        if (ntt) ntt[o] = (tt[i0] + tt[i1] + tt[i2] + tt[i3]) * 0.25;
        // The spread of the four slopes about their mean, and the spread each of them
        // already had of its own.
        const between = ((sx[i0] - mx) ** 2 + (sx[i1] - mx) ** 2 + (sx[i2] - mx) ** 2 + (sx[i3] - mx) ** 2
          + (sy[i0] - my) ** 2 + (sy[i1] - my) ** 2 + (sy[i2] - my) ** 2 + (sy[i3] - my) ** 2) * 0.25;
        nva[o] = (va[i0] + va[i1] + va[i2] + va[i3]) * 0.25 + between;
      }
    }
    sx = nsx;
    sy = nsy;
    ro = nro;
    cv = ncv;
    tn = ntn;
    tt = ntt;
    va = nva;
  });
  return { a, b };
}

// --- the surfaces ---------------------------------------------------------------

// Asphalt: a mastic of tar and sand with stones of one to three centimetres laid
// in it, the stones rounded, lying every way, the biggest on top. A texel is
// 3 mm.
function asphalt(size) {
  const rand = rng(0xa5f417);
  const n = size * size;
  const H = new Float32Array(n);
  const T = new Float32Array(n);
  // The mastic: dark, a little uneven.
  const low = valueNoise(rand, size, 16, 16);
  const mid = valueNoise(rand, size, 64, 64);
  for (let i = 0; i < n; i++) {
    H[i] = -0.35 + 0.5 * mid[i] + 0.3 * low[i];
    T[i] = 0.30 + 0.12 * low[i];
  }
  // Sand and the smallest chips, then the stones, the big last.
  stones(H, T, size, rand, Math.round(n / 5), 0.7, 1.7, 0.6, [0.5, 0.9], 0.30, 0.62);
  stones(H, T, size, rand, Math.round(n / 40), 1.6, 3.4, 0.65, [0.5, 0.95], 0.28, 0.7);
  stones(H, T, size, rand, Math.round(n / 160), 2.8, 5.6, 0.7, [0.45, 0.8], 0.3, 0.72);
  const { sx, sy } = slopes(H, size);
  const around = blur(H, size, 4);
  const rough = new Float32Array(n);
  const cav = new Float32Array(n);
  const tint = valueNoise(rand, size, 8, 8);
  let hi = -1e9;
  for (let i = 0; i < n; i++) hi = Math.max(hi, H[i]);
  for (let i = 0; i < n; i++) {
    const up = clamp((H[i] + 0.4) / (hi + 0.4), 0, 1);
    // The tops of the stones are a little smoother, the mastic between them rougher.
    rough[i] = 0.9 - 0.14 * up;
    cav[i] = clamp(1 + (H[i] - around[i]) * 0.5, 0.3, 1);
    tint[i] = 0.5 + (tint[i] - 0.5) * 0.9;
  }
  return chain(size, { sx, sy, rough, cav, tone: T, tint }, SURFACES.asphalt.k, true);
}

// The verge: gravel of two to seven centimetres, cut stone and rounded, with
// grit between. A texel is 6 mm.
function verge(size) {
  const rand = rng(0x6b3a29);
  const n = size * size;
  const H = new Float32Array(n);
  const T = new Float32Array(n);
  const low = valueNoise(rand, size, 8, 8);
  for (let i = 0; i < n; i++) {
    H[i] = -0.5 + 0.4 * low[i];
    T[i] = 0.4;
  }
  stones(H, T, size, rand, Math.round(n / 14), 0.8, 2.0, 0.6, [0.5, 0.9], 0.3, 0.75);
  stones(H, T, size, rand, Math.round(n / 50), 1.8, 4.0, 0.6, [0.45, 0.9], 0.25, 0.8);
  stones(H, T, size, rand, Math.round(n / 220), 3.2, 6.4, 0.65, [0.4, 0.8], 0.25, 0.85);
  const { sx, sy } = slopes(H, size);
  const around = blur(H, size, 5);
  const rough = new Float32Array(n);
  const cav = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    rough[i] = 0.92;
    // The light of the sky and the tone of the stone, together: a deep gap is dark and
    // so is a dark stone.
    cav[i] = clamp(1 + (H[i] - around[i]) * 0.45, 0.25, 1) * (0.55 + 0.6 * T[i]);
  }
  return chain(size, { sx, sy, rough, cav, tone: null, tint: null }, SURFACES.verge.k, false);
}

// Concrete poured against boards: pores of a few millimetres, the grain of the
// boards running along, the paste uneven. A texel is 6 mm.
function concrete(size) {
  const rand = rng(0xc0c4e7);
  const n = size * size;
  const H = new Float32Array(n);
  // The grain of the boards: long along the tile, thin across it.
  const grain = valueNoise(rand, size, 4, 96);
  const paste = valueNoise(rand, size, 12, 12);
  const mottle = valueNoise(rand, size, 40, 40);
  for (let i = 0; i < n; i++) H[i] = 0.7 * grain[i] + 0.5 * mottle[i] + 0.6 * paste[i];
  // Pores: round pits, a few of them deep, in all the sizes of air.
  const T = new Float32Array(n);
  const pit = new Float32Array(n);
  const hollow = (count, lo, hi, depth) => {
    for (let c = 0; c < count; c++) {
      const cx = rand() * size;
      const cy = rand() * size;
      const r = lo + (hi - lo) * rand() * rand();
      const R = Math.ceil(r) + 1;
      const d = depth * (0.4 + 0.6 * rand()) * r;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const u = Math.floor(cx) + dx + 0.5 - cx;
          const v = Math.floor(cy) + dy + 0.5 - cy;
          const q = (u * u + v * v) / (r * r);
          if (q >= 1) continue;
          const i = wrap(Math.floor(cy) + dy, size) * size + wrap(Math.floor(cx) + dx, size);
          pit[i] = Math.max(pit[i], d * (1 - q));
        }
      }
    }
  };
  hollow(Math.round(n / 160), 0.7, 2.6, 1.1);
  hollow(Math.round(n / 1200), 2.0, 4.5, 0.8);
  for (let i = 0; i < n; i++) H[i] -= pit[i];
  const { sx, sy } = slopes(H, size);
  const rough = new Float32Array(n);
  const cav = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    rough[i] = clamp(0.86 + 0.1 * (mottle[i] - 0.5) + 0.05 * Math.min(pit[i], 1), 0, 1);
    // A pore is dark inside; the paste is lighter or darker in clouds.
    cav[i] = clamp(1 - 0.5 * Math.min(pit[i] * 0.6, 1), 0.3, 1) * (0.82 + 0.3 * (paste[i] - 0.5) + 0.12 * (mottle[i] - 0.5));
    T[i] = 0.5;
  }
  return chain(size, { sx, sy, rough, cav, tone: null, tint: null }, SURFACES.concrete.k, false);
}

// Galvanized steel: crystals of zinc a few centimetres across, each lying a
// little differently, and fine scratches along the sheet (the way a beam is
// rolled), which smear a highlight along the beam. A texel is 6 mm.
function steel(size) {
  const rand = rng(0x57ee11);
  const n = size * size;
  const G = 20;
  // The crystals: a point in each cell of a grid, the nearest taking a texel.
  const px = new Float32Array(G * G);
  const py = new Float32Array(G * G);
  const tx = new Float32Array(G * G);
  const ty = new Float32Array(G * G);
  const tn = new Float32Array(G * G);
  const rr = new Float32Array(G * G);
  for (let c = 0; c < G * G; c++) {
    px[c] = 0.15 + 0.7 * rand();
    py[c] = 0.15 + 0.7 * rand();
    const [ca, sa] = turn(rand);
    const lean = 0.03 + 0.09 * rand();
    tx[c] = ca * lean;
    ty[c] = sa * lean;
    tn[c] = 0.5 + 0.22 * (rand() - 0.5);
    rr[c] = 0.34 + 0.12 * rand();
  }
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const rough = new Float32Array(n);
  const cav = new Float32Array(n);
  const tone = new Float32Array(n);
  const scratch = valueNoise(rand, size, 3, 170);
  const cell = size / G;
  for (let y = 0; y < size; y++) {
    const gy = Math.floor(y / cell);
    for (let x = 0; x < size; x++) {
      const gx = Math.floor(x / cell);
      let d1 = 1e9;
      let d2 = 1e9;
      let best = 0;
      for (let j = -1; j <= 1; j++) {
        const cy = wrap(gy + j, G);
        for (let i = -1; i <= 1; i++) {
          const cx = wrap(gx + i, G);
          const c = cy * G + cx;
          const dx = (gx + i + px[c]) * cell - (x + 0.5);
          const dy = (gy + j + py[c]) * cell - (y + 0.5);
          const d = dx * dx + dy * dy;
          if (d < d1) {
            d2 = d1;
            d1 = d;
            best = c;
          } else if (d < d2) {
            d2 = d;
          }
        }
      }
      const o = y * size + x;
      // How near the border of its crystal a texel is: a seam, a little darker.
      const edge = clamp((Math.sqrt(d2) - Math.sqrt(d1)) / (0.12 * cell), 0, 1);
      const yn = wrap(y + 1, size) * size + x;
      const yp = wrap(y - 1, size) * size + x;
      const sc = (scratch[yn] - scratch[yp]) * 0.5;
      sx[o] = tx[best];
      sy[o] = ty[best] + sc * 0.3;
      rough[o] = clamp(rr[best] + 0.05 * (scratch[o] - 0.5), 0, 1);
      cav[o] = 0.82 + 0.18 * edge;
      tone[o] = tn[best];
    }
  }
  // The tone of a crystal rides in the cavity (the steel has no tone of its own to read).
  for (let i = 0; i < n; i++) cav[i] *= 0.88 + 0.24 * tone[i];
  return chain(size, { sx, sy, rough, cav, tone: null, tint: null }, SURFACES.steel.k, false);
}

const MAKE = { asphalt, verge, concrete, steel };

// One surface: { name, size, a, b }. The same bytes whoever draws it.
export function bakeSurface(name) {
  const { size } = SURFACES[name];
  const { a, b } = MAKE[name](size);
  return { name, size, a, b };
}

// Several, for a worker's reply: the names asked for, in the order given.
export function bakeSurfaces(names) {
  return names.map(bakeSurface);
}

// The surfaces a tier uses: none of them at low (the road is plain grey with
// its paint and its patches), the road and the verge at mid, all at high.
export function surfacesOf(tier) {
  return tier === 'high' ? SURFACE_NAMES : tier === 'mid' ? ['asphalt', 'verge'] : [];
}
