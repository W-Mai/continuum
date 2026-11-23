// The normal maps of the ground, as bytes (render/terrain.js lays them on the
// land): the rock's, and the fine ground's (gravel and wind ripples). Pure
// arithmetic with no three.js, so the page and the baking workers make the
// same bytes (render/bakers.js); a texture is made once, at the start, and
// tiles: each wraps at its edges, and the page gives them mips.
//
// A texel holds the slope of the surface there (the height's change a metre
// across it), 0.5 + slope / range of a byte:
//   rock: r, g the slopes across and up (blocks, cracks, grain); b the slope
//         up of the beds alone (world/strata.js: a step at each bed); a how
//         open to the sky the surface is (cracks and ledges are shut in);
//   fine: r, g the slopes of gravel, 1 to 8 cm stones; b, a those of wind
//         ripples, 12 cm a ridge, lying across the tile.

import { hash2, mulberry32 } from './noise.js';
import { stairs } from './strata.js';

// What a texture covers of the world (m), and the slope a byte's whole range is.
export const ROCK = { tile: 16, range: 1.5, beds: 5 };
export const FINE = { tile: 1.44, gravel: 2.0, ripple: 0.6 };
// The sizes (texels to a side) by tier: none at low.
export const GROUND_SIZE = { high: { rock: 512, fine: 256 }, mid: { rock: 256, fine: 128 }, low: null };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const sm = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const byte = (slope, range) => Math.round(clamp(0.5 + (0.5 * slope) / range, 0, 1) * 255);

// Smooth noise that wraps: a lattice of cx by cy values, -1 to 1.
function wrapNoise(u, v, cx, cy, seed) {
  const x = u * cx;
  const y = v * cy;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const h = (i, j) => hash2(((i % cx) + cx) % cx, ((j % cy) + cy) % cy, seed);
  const a = h(ix, iy);
  const b = h(ix + 1, iy);
  const c = h(ix, iy + 1);
  const d = h(ix + 1, iy + 1);
  const top = a + (b - a) * fx;
  return (top + (c + (d - c) * fx - top) * fy) * 2 - 1;
}

// The slopes of a height field that wraps (n by n, m metres across), by central differences.
function slopes(h, n, m) {
  const dx = m / n;
  const sx = new Float32Array(n * n);
  const sy = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const jl = ((j + n - 1) % n) * n;
    const jr = ((j + 1) % n) * n;
    for (let i = 0; i < n; i++) {
      const il = (i + n - 1) % n;
      const ir = (i + 1) % n;
      sx[j * n + i] = (h[j * n + ir] - h[j * n + il]) / (2 * dx);
      sy[j * n + i] = (h[jr + i] - h[jl + i]) / (2 * dx);
    }
  }
  return [sx, sy];
}

// The rock: courses of blocks, cut by joints, in beds that stand out of the
// face by turns, with grain and hairline cracks over them. n texels to a side.
export function makeRock(n) {
  const M = ROCK.tile;
  const B = ROCK.beds;
  // The courses: the beds' edges, and in each bed up to two more, as a count of beds up the tile.
  const edges = [];
  for (let k = 0; k < B; k++) {
    edges.push({ at: k, bed: true });
    const extra = Math.floor(hash2(k, 0x21, 0x5) * 4);
    for (let e = 1; e <= extra; e++) edges.push({ at: k + (e + 0.9 * (hash2(k, e, 0x22) - 0.5)) / (extra + 1), bed: false });
  }
  edges.sort((a, b) => a.at - b.at);
  const rows = edges.length;
  // The joints of each course: where the blocks of it end, across the tile, and how they lean.
  const joints = edges.map((_, r) => {
    // Some courses are a few great slabs, most are broken into blocks of every size.
    const slab = hash2(r, 0x27, 0x5) < 0.18;
    const count = slab ? 1 + Math.floor(hash2(r, 0x23, 0x5) * 2) : 3 + Math.floor(hash2(r, 0x23, 0x5) * 8);
    const raw = [];
    let sum = 0;
    for (let c = 0; c < count; c++) {
      const w = 0.25 + Math.pow(hash2(r, c, 0x24), 1.7) * 2.2;
      raw.push(w);
      sum += w;
    }
    const at = [];
    let run = hash2(r, 0x25, 0x5);
    for (let c = 0; c < count; c++) {
      at.push(run - Math.floor(run));
      run += raw[c] / sum;
    }
    at.sort((a, b) => a - b);
    return { at, lean: (hash2(r, 0x26, 0x5) - 0.5) * 0.5 };
  });
  // A feature point to each cell of a small lattice, for the hairline cracks.
  const HC = 22;
  const hx = new Float64Array(HC * HC);
  const hy = new Float64Array(HC * HC);
  for (let j = 0; j < HC; j++) {
    for (let i = 0; i < HC; i++) {
      hx[j * HC + i] = 0.1 + 0.8 * hash2(i, j, 0x37);
      hy[j * HC + i] = 0.1 + 0.8 * hash2(i, j, 0x38);
    }
  }
  const iso = new Float32Array(n * n);
  const bed = new Float32Array(n * n);
  const crack = new Float32Array(n * n);
  const bedM = M / B;
  for (let j = 0; j < n; j++) {
    const v = (j + 0.5) / n;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const k = j * n + i;
      // How far up the beds this texel is, the beds wandering a little across the face.
      const wob = 0.45 * wrapNoise(u, v, 3, 2, 0x51) + 0.2 * wrapNoise(u, v, 7, 3, 0x52);
      let p = v * B + wob;
      p -= Math.floor(p / B) * B;
      // Its course, and the way to the course's two edges (m).
      let r = rows - 1;
      while (r > 0 && edges[r].at > p) r--;
      const lo = edges[r].at;
      const hi = r + 1 < rows ? edges[r + 1].at : B;
      const dLo = (p - lo) * bedM;
      const dHi = (hi - p) * bedM;
      // Its block, and the way to the block's two joints (m): the joints lean with the course.
      const jr = joints[r];
      const uu = u - jr.lean * ((p - (lo + hi) / 2) * bedM / M) + 1;
      const x = uu - Math.floor(uu);
      const at = jr.at;
      let c = at.length - 1;
      while (c >= 0 && at[c] > x) c--;
      let left;
      let right;
      if (c < 0) {
        // Before the first joint: the block that goes round from the last.
        c = at.length - 1;
        left = at[c] - 1;
        right = at[0];
      } else {
        left = at[c];
        right = c + 1 < at.length ? at[c + 1] : at[0] + 1;
      }
      const dL = (x - left) * M;
      const dR = (right - x) * M;
      const id = r * 16 + c;
      const dBed = Math.min(edges[r].bed ? dLo : 9, r + 1 < rows ? (edges[r + 1].bed ? dHi : 9) : dHi);
      const dEdge = Math.min(dLo, dHi, dL, dR);
      const w = 0.02 + 0.045 * hash2(id, 0x31, 0x6) * hash2(id, 0x36, 0x6) + (dBed < 9 ? 0.03 : 0);
      const groove = 1 - sm(0, w, dEdge);
      const lip = 1 - sm(0, 0.3, dEdge);
      // The block: a face tilted its own way, standing out a little or less.
      const ta = (hash2(id, 0x32, 0x6) - 0.5) * 0.24;
      const tb = (hash2(id, 0x33, 0x6) - 0.5) * 0.24;
      const stand = (hash2(id, 0x34, 0x6) - 0.5) * 0.05;
      const cx = (dL - dR) * 0.5;
      const cy = (dLo - dHi) * 0.5;
      // Hairline cracks across it, a lattice of cells 55 cm.
      const px = u * HC;
      const py = v * HC;
      const bx = Math.floor(px);
      const by = Math.floor(py);
      let d1 = 1e9;
      let d2 = 1e9;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const cI = bx + di;
          const cJ = by + dj;
          const q = (((cJ % HC) + HC) % HC) * HC + (((cI % HC) + HC) % HC);
          const ex = (cI + hx[q] - px) * (M / HC);
          const ey = (cJ + hy[q] - py) * (M / HC);
          const d = ex * ex + ey * ey;
          if (d < d1) {
            d2 = d1;
            d1 = d;
          } else if (d < d2) d2 = d;
        }
      }
      const hair = 1 - sm(0, 0.012, Math.sqrt(d2) - Math.sqrt(d1));
      crack[k] = Math.max(groove, 0.5 * hair);
      iso[k] = ta * cx + tb * cy + stand - 0.04 * lip - 0.04 * groove - 0.012 * hair
        + 0.014 * wrapNoise(u, v, 32, 32, 0x41) + 0.007 * wrapNoise(u, v, 64, 64, 0x42) + 0.0035 * wrapNoise(u, v, 128, 128, 0x43);
      // The beds themselves: a step at each.
      bed[k] = 0.11 * stairs(p, 0x7c, 0.1, B);
    }
  }
  const [sx, sy] = slopes(iso, n, M);
  const [, by] = slopes(bed, n, M);
  const data = new Uint8Array(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    data[k * 4] = byte(sx[k], ROCK.range);
    data[k * 4 + 1] = byte(sy[k], ROCK.range);
    data[k * 4 + 2] = byte(by[k], ROCK.range);
    // Open to the sky: shut in by a crack, and under a ledge where the step turns the way it does.
    const ledge = clamp(by[k] / ROCK.range, 0, 1);
    data[k * 4 + 3] = Math.round(clamp(1 - 0.5 * crack[k] - 0.2 * ledge, 0.35, 1) * 255);
  }
  return data;
}

// The fine ground: gravel and ripples. n texels to a side.
export function makeFine(n) {
  const M = FINE.tile;
  const gravel = new Float32Array(n * n);
  const rand = mulberry32(0x6a5e1);
  const px = M / n;
  // Stones, 1 to 8 cm across (a radius of 0.5 to 4), each a low dome on its side, the highest holding.
  const count = Math.round(520 * (M * M) / (1.44 * 1.44));
  for (let s = 0; s < count; s++) {
    const cx = rand() * n;
    const cy = rand() * n;
    const r = (0.005 + 0.035 * Math.pow(rand(), 2.2)) / px;
    const stretch = 0.7 + 0.6 * rand();
    const turn = rand() * Math.PI;
    const co = Math.cos(turn);
    const si = Math.sin(turn);
    const tall = 0.65 + 0.3 * rand();
    const reach = Math.ceil(r * Math.max(stretch, 1 / stretch)) + 1;
    for (let dj = -reach; dj <= reach; dj++) {
      for (let di = -reach; di <= reach; di++) {
        const x = (di * co + dj * si) / (r * stretch);
        const y = (-di * si + dj * co) / (r / stretch);
        const q = x * x + y * y;
        if (q >= 1) continue;
        const i = (((Math.round(cx) + di) % n) + n) % n;
        const j = (((Math.round(cy) + dj) % n) + n) % n;
        const h = tall * r * px * Math.sqrt(1 - q);
        if (h > gravel[j * n + i]) gravel[j * n + i] = h;
      }
    }
  }
  const ripple = new Float32Array(n * n);
  const RIPPLES = 12;
  for (let j = 0; j < n; j++) {
    const v = (j + 0.5) / n;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      // A phase that wanders: the ridges bend, and some end where the wander is quick.
      const phase = RIPPLES * u + 0.9 * wrapNoise(u, v, 3, 3, 0x61) + 0.35 * wrapNoise(u, v, 9, 9, 0x62);
      const f = phase - Math.floor(phase);
      // A long gentle back and a short steep face, as ripples have.
      const h = f < 0.7 ? sm(0, 1, f / 0.7) : 1 - sm(0, 1, (f - 0.7) / 0.3);
      ripple[j * n + i] = 0.007 * h * (0.8 + 0.2 * wrapNoise(u, v, 5, 5, 0x63));
    }
  }
  const [gx, gy] = slopes(gravel, n, M);
  const [rx, ry] = slopes(ripple, n, M);
  const data = new Uint8Array(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    data[k * 4] = byte(gx[k], FINE.gravel);
    data[k * 4 + 1] = byte(gy[k], FINE.gravel);
    data[k * 4 + 2] = byte(rx[k], FINE.ripple);
    data[k * 4 + 3] = byte(ry[k], FINE.ripple);
  }
  return data;
}

// Both of a tier, as { rock, fine, size: { rock, fine } }, or null where the tier has none.
export function makeGround(tier) {
  const size = GROUND_SIZE[tier];
  if (!size) return null;
  return { rock: makeRock(size.rock), fine: makeFine(size.fine), size };
}
