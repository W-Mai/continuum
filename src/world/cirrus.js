// The high cloud of the real style's sky: one tile of thin streaks of ice
// cloud, 1024 by 256 texels in a byte each, that repeats both ways. The sky
// lays it on a plane 9 km over the lens (render/atmosphere.js), a texel 35 m
// across, so a streak is some kilometres long and a hundred to four hundred
// metres wide seen from the road, and takes it along with the wind.
//
// This file touches no three.js, so the page and a worker (world/bakeworker.js)
// run the same code and get the same bytes (tools/bake_check.mjs). It is
// arithmetic of plain sums, products and floors, so that they come out the same
// in any engine.

export const CIRRUS = {
  width: 1024,
  height: 256,
  // Metres a tile is across, along it (the way the streaks run) and across it.
  tile: [36000, 9000],
  // Where it lies over the lens, metres.
  altitude: 9000,
};

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

// A grid of gx by gy random values, which repeats: read smoothly (`at`).
class Grid {
  constructor(rand, gx, gy) {
    this.gx = gx;
    this.gy = gy;
    this.v = new Float32Array(gx * gy);
    for (let i = 0; i < this.v.length; i++) this.v[i] = rand();
  }

  // The value at x, y in the grid's own units (a number of cells), the grid repeating.
  at(x, y) {
    const { gx, gy, v } = this;
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const tx = x - fx;
    const ty = y - fy;
    const wx = tx * tx * (3 - 2 * tx);
    const wy = ty * ty * (3 - 2 * ty);
    const x0 = ((fx % gx) + gx) % gx;
    const y0 = ((fy % gy) + gy) % gy;
    const x1 = (x0 + 1) % gx;
    const y1 = (y0 + 1) % gy;
    const a = v[y0 * gx + x0] + (v[y0 * gx + x1] - v[y0 * gx + x0]) * wx;
    const b = v[y1 * gx + x0] + (v[y1 * gx + x1] - v[y1 * gx + x0]) * wx;
    return a + (b - a) * wy;
  }
}

const ramp = (a, b, v) => {
  const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return t * t * (3 - 2 * t);
};

// The tile: width * height bytes, row by row, 255 where the cloud is thickest.
export function bakeCirrus() {
  const { width: W, height: H } = CIRRUS;
  const rand = rng(0x5c1b45);
  // How the streaks are laid: four sizes of stripe, each long across the tile and
  // thin down it (a cell 205, 102, 51 and 26 texels long and 14, 7, 3.5 and 1.7
  // across), bent by two slow fields so that none of them is straight, and over
  // them patches of more and of less.
  const stripes = [
    { g: new Grid(rand, 5, 18), k: 0.40 },
    { g: new Grid(rand, 10, 36), k: 0.32 },
    { g: new Grid(rand, 20, 72), k: 0.18 },
    { g: new Grid(rand, 40, 150), k: 0.10 },
  ];
  const bendX = new Grid(rand, 3, 2);
  const bendY = new Grid(rand, 5, 3);
  const patch = new Grid(rand, 3, 2);
  const dense = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const u = i / W;
      const v = j / H;
      // The bend, in texels: along the streaks a good deal, across them by a few of their widths.
      const x = i + (bendX.at(u * 3, v * 2) - 0.5) * 2 * 150;
      const y = j + (bendY.at(u * 5, v * 3) - 0.5) * 2 * 20;
      let f = 0;
      for (const s of stripes) f += s.k * s.g.at((x / W) * s.g.gx, (y / H) * s.g.gy);
      const m = patch.at(u * 3, v * 2);
      // Thin where the stripe is weak, thick where it is strong, more of it where the patch is.
      dense[j * W + i] = ramp(0.58, 0.9, f + (m - 0.5) * 0.4);
    }
  }
  // A streak is soft across: each texel is a quarter of the row over it, a half of its own and a
  // quarter of the row under (the tile repeating).
  const out = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    const up = ((j + H - 1) % H) * W;
    const dn = ((j + 1) % H) * W;
    for (let i = 0; i < W; i++) {
      const d = 0.25 * dense[up + i] + 0.5 * dense[j * W + i] + 0.25 * dense[dn + i];
      out[j * W + i] = Math.round(255 * d);
    }
  }
  return out;
}

// The tile's bytes, in the texture's size, for the checks.
export const CIRRUS_BYTES = CIRRUS.width * CIRRUS.height;
