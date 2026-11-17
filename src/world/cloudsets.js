// Where the clouds of a sky stand: heaps of balls (render/clouds.js bakes them
// into a cube map). A set is 10 to 16 heaps, each 14 to 52 balls; where they
// stand is given in azimuth from the world's axis (the way the road sets
// out), so the big ones are ahead of the car to either side, and it is a
// function of the seed and the set's name alone.
//
// Pure arithmetic, no three.

export const MAX_HEAPS = 16;
export const MAX_BALLS = 512;
// The most balls one heap may have: the bake's loop over a heap's balls is
// this long.
export const MAX_HEAP_BALLS = 52;
// How far two balls of a heap run together, in the heap's ball radius: less,
// and the heap is a pile of lobes; more, and it is one smooth mound.
export const HEAP_SMOOTH = 0.32;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nameHash(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return h >>> 0;
}

const RAD = Math.PI / 180;

// One heap: azimuth az (radians, in the world), distance and height of the
// base in metres, width w, height h and the number of balls. A ball is
// min(w * 0.3, h * 0.62) times 0.48, times 0.72 to 1.22, across its radius; the higher
// they sit the nearer the middle and the smaller the ground they cover, so a
// heap is a mound, flat under and heaped over.
function cumulus(rand, az, dist, base, w, h, n) {
  const cx = Math.cos(az) * dist;
  const cz = Math.sin(az) * dist;
  const r0 = 0.48 * Math.min(w * 0.3, h * 0.62);
  const balls = [];
  for (let i = 0; i < n; i++) {
    const r = r0 * (0.72 + 0.5 * rand());
    // The first few stand on the ground of the heap, so that its base is
    // wide whatever the rest does.
    const hf = i < Math.max(2, Math.floor(n * 0.22)) ? 0.04 * rand() : Math.pow(rand(), 1.35);
    const reach = Math.max(0, w * 0.5 - r * 0.9) * (1 - 0.82 * Math.pow(hf, 1.15));
    const rho = reach * Math.sqrt(rand());
    const th = rand() * Math.PI * 2;
    const y = base + r * 0.72 + hf * Math.max(0, h - r * 1.72);
    balls.push([cx + Math.cos(th) * rho, y, cz + Math.sin(th) * rho, r]);
  }
  return { cx, cz, base, w, h, r0, balls };
}

// Which heaps a set has: [azimuth from the axis in degrees (right of it
// positive), distance, base, width, height, balls], by kind.
const range = (rand, a, b) => a + (b - a) * rand();

const SETS = {
  // Four towers far off, standing on the horizon to either side of the road
  // and behind (a chase lens sees some fifteen degrees of sky over the
  // horizon: a tower nearer than this shows it only its underside), seven big
  // heaps nearer in all round, and a bank of five lower ones between them.
  fair(rand) {
    const out = [];
    for (const a of [25, -50, 155, -125]) {
      out.push([a + range(rand, -12, 12), range(rand, 44000, 52000), range(rand, 1200, 1500), range(rand, 27000, 35000), range(rand, 10000, 12500), 52]);
    }
    for (let i = 0; i < 7; i++) {
      out.push([-160 + i * 51.4 + range(rand, -14, 14), range(rand, 22000, 32000), range(rand, 1200, 1500), range(rand, 12000, 17000), range(rand, 4500, 6500), 28]);
    }
    for (let i = 0; i < 5; i++) {
      out.push([-144 + i * 72 + range(rand, -14, 14), range(rand, 34000, 42000), range(rand, 1100, 1400), range(rand, 11000, 16000), range(rand, 2800, 4000), 20]);
    }
    return out;
  },
  // A dry sky: five small heaps, all of them far.
  few(rand) {
    const out = [];
    for (let i = 0; i < 5; i++) {
      out.push([-150 + i * 70 + range(rand, -20, 20), range(rand, 10000, 18000), range(rand, 1200, 1800), range(rand, 1500, 4400), range(rand, 600, 2200), 16 + Math.floor(rand() * 10)]);
    }
    return out;
  },
  // Six towers standing on the horizon in a ring and none overhead.
  towers(rand) {
    const out = [];
    for (let i = 0; i < 6; i++) {
      out.push([i * 60 + range(rand, -12, 12), range(rand, 21000, 25000), range(rand, 700, 1100), range(rand, 9000, 12000), range(rand, 3500, 5500), 34 + Math.floor(rand() * 6)]);
    }
    return out;
  },
};

export const CLOUD_SETS = Object.keys(SETS);

// The heaps of a set for a seed and an axis (the azimuth, in radians, the
// road sets out in). Returns { name, heaps, balls: Float32Array of x, y, z, r,
// heap: Float32Array of 4 numbers each (first ball, ball count, the base,
// the smoothing) and bound: Float32Array of 4 each (the heap's bounding
// sphere), n heaps }.
export function layoutClouds(name, seed, axis) {
  const make = SETS[name];
  if (!make) throw new Error(`no cloud set called ${name}`);
  const rand = rng((nameHash(name) ^ Math.imul(seed | 0, 2654435761)) >>> 0);
  const heaps = make(rand).map((a) => cumulus(rand, axis + a[0] * RAD, a[1], a[2], a[3], a[4], a[5]));
  if (heaps.length > MAX_HEAPS) throw new Error('too many heaps');
  const total = heaps.reduce((s, h) => s + h.balls.length, 0);
  if (total > MAX_BALLS) throw new Error('too many balls');
  if (heaps.some((h) => h.balls.length > MAX_HEAP_BALLS)) throw new Error('too many balls in a heap');
  const balls = new Float32Array(MAX_BALLS * 4);
  const info = new Float32Array(MAX_HEAPS * 4);
  const bound = new Float32Array(MAX_HEAPS * 4);
  // A heap that is not there is a bound that is nowhere.
  for (let h = 0; h < MAX_HEAPS; h++) bound[h * 4 + 1] = -1e7;
  let at = 0;
  heaps.forEach((hp, h) => {
    let mx = 0;
    let my = 0;
    let mz = 0;
    for (const b of hp.balls) {
      mx += b[0];
      my += b[1];
      mz += b[2];
    }
    mx /= hp.balls.length;
    my /= hp.balls.length;
    mz /= hp.balls.length;
    let rad = 0;
    for (const b of hp.balls) {
      balls.set(b, at * 4);
      at++;
      rad = Math.max(rad, Math.hypot(b[0] - mx, b[1] - my, b[2] - mz) + b[3]);
    }
    // The bumps stand out of the balls by up to a fifth of the width's seventh,
    // and the balls run together.
    const pad = hp.w * 0.07 * 1.4 + hp.r0 * 0.3;
    bound.set([mx, my, mz, rad + pad], h * 4);
    info.set([at - hp.balls.length, hp.balls.length, hp.base, hp.r0 * HEAP_SMOOTH], h * 4);
  });
  return { name, heaps, count: heaps.length, balls, info, bound, widths: heaps.map((h) => h.w) };
}
