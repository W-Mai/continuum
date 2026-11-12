// The worlds the road runs through, one after another by distance travelled.
//
// Every world is data (sky, light, ground colours, water, what grows) and a
// landform: a pure function of absolute position, like the alpine one. Which
// world a point belongs to depends only on where it is: its progress u along
// the direction the road set out in, with the borders bent by a slow noise so
// that none is a ruler line across the map. The last WORLD_BLEND metres of a
// world turn into the next one: the land reshapes, the ground changes colour,
// the trees change kind, water rises or drains. The sky and the light follow
// the camera across. Nothing is loaded and nothing is rebuilt.
//
// The same u is computed on the GPU (render/worldlook.js) from the same
// integer hash, so the ground colours change exactly where the land does.

import { makeSimplex, fbm, ridged, smoothstep } from './noise.js';
import { makeAlpine } from './landform.js';

export const WORLD_LEN = 7000;     // metres of progress per world
export const WORLD_BLEND = 1500;   // the last part of a world turns into the next
export const WARP_AMP = 700;       // borders bend this far either way...
export const WARP_SCALE = 3200;    // ...over about this distance
export const START_U = 600;        // the road sets out this far into its first world

// --- landforms ----------------------------------------------------------------
//
// Heights in metres around the same datum as the alpine valleys, so a road
// leaving one world does not have to climb a kilometre into the next. Each
// returns three variants, as the alpine land does: full, coarse (route search
// and sun shadows: the big shapes only) and far (distant tiles).

// Rolling farmland: swells two or three kilometres across, rounded on top and
// broad in the hollows, gentle enough for a road to ride over at its grade,
// with a steeper knoll here and there.
function makeHills(seed) {
  const nBase = makeSimplex(seed ^ 0x4111a);
  const nWarp = makeSimplex(seed ^ 0x4112b);
  const nKnoll = makeSimplex(seed ^ 0x4113c);
  const nDet = makeSimplex(seed ^ 0x4114d);
  function field(x, z, oct, detail) {
    const wx = x + 320 * fbm(nWarp, x / 2600, z / 2600, 2);
    const wz = z + 320 * fbm(nWarp, x / 2600 + 5.1, z / 2600 - 2.3, 2);
    const n = fbm(nBase, wx / 2400, wz / 2400, oct, 2.0, 0.44);
    let h = 50 + 80 * n + 30 * n * Math.abs(n);
    const k = ridged(nKnoll, wx / 900, wz / 900, 3, 2.0, 0.5, 1.0);
    h += 30 * smoothstep(0.45, 0.88, k);
    if (detail) h += 4 * fbm(nDet, x / 150, z / 150, 3);
    return h;
  }
  return {
    heightAt: (x, z) => field(x, z, 6, true),
    heightAtCoarse: (x, z) => field(x, z, 4, false),
    heightAtFar: (x, z) => field(x, z, 5, true),
  };
}

// A broad river winding through low hills: flat valley floors a few metres
// above the water, and the river itself in a channel cut into the floor.
// The rivers follow the zero lines of a noise stretched along the way the
// road is heading, so they meander and fork but mostly run the road's way,
// and the road, which looks for the flattest line, keeps to a valley beside
// one, crossing to the next on a bridge now and then. Their width swells and
// narrows along their length.
function makeRiver(seed, map) {
  const nBase = makeSimplex(seed ^ 0x5221a);
  const nWarp = makeSimplex(seed ^ 0x5222b);
  const nRiver = makeSimplex(seed ^ 0x5223c);
  const nWidth = makeSimplex(seed ^ 0x5224d);
  const nDet = makeSimplex(seed ^ 0x5225e);
  const uv = { along: 0, lat: 0 };
  function field(x, z, oct, detail) {
    const wx = x + 500 * fbm(nWarp, x / 3400, z / 3400, 2);
    const wz = z + 500 * fbm(nWarp, x / 3400 - 3.7, z / 3400 + 8.2, 2);
    const base = 75 + 120 * fbm(nBase, wx / 1900, wz / 1900, oct, 2.0, 0.48);
    map.axisUV(wx, wz, uv);
    const line = Math.abs(fbm(nRiver, uv.along / 6000, uv.lat / 2400, 3, 2.0, 0.4));
    const wide = 0.8 + 0.4 * (fbm(nWidth, uv.along / 3000, uv.lat / 3000, 2) * 0.5 + 0.5);
    // The valley: the hills fall to a floor two or three hundred metres across.
    const valley = 1 - smoothstep(0.1 * wide, 0.36 * wide, line);
    const floorH = 7 + (detail ? 1.6 * fbm(nDet, x / 120, z / 120, 2) : 0);
    let h = base + (floorH - base) * valley;
    // The channel: banks a few metres high, a bed five metres under the water.
    const chan = 1 - smoothstep(0.03 * wide, 0.046 * wide, line);
    h += (-5 - h) * chan;
    return h;
  }
  return {
    heightAt: (x, z) => field(x, z, 6, true),
    heightAtCoarse: (x, z) => field(x, z, 4, false),
    heightAtFar: (x, z) => field(x, z, 5, true),
  };
}

// Headlands and bays: long stretches of coast running the way the road is
// heading, so the sea stays beside it for kilometres; a beach where land
// meets sea, cliffs along some stretches, low hills inland, a shallow shelf
// offshore that shows turquoise through the water.
function makeCoast(seed, map) {
  const nLand = makeSimplex(seed ^ 0x6331a);
  const nBay = makeSimplex(seed ^ 0x6336f);
  const nWarp = makeSimplex(seed ^ 0x6332b);
  const nCliff = makeSimplex(seed ^ 0x6333c);
  const nHill = makeSimplex(seed ^ 0x6334d);
  const nDet = makeSimplex(seed ^ 0x6335e);
  const uv = { along: 0, lat: 0 };
  function field(x, z, oct, detail) {
    const wx = x + 600 * fbm(nWarp, x / 4200, z / 4200, 2);
    const wz = z + 600 * fbm(nWarp, x / 4200 + 6.6, z / 4200 - 1.9, 2);
    map.axisUV(wx, wz, uv);
    const land = fbm(nLand, uv.along / 9000, uv.lat / 2600, Math.min(oct, 4), 2.0, 0.5) + 0.05
      + 0.16 * fbm(nBay, wx / 1700, wz / 1700, 3, 2.0, 0.5);
    if (land < 0) return Math.max(-60, land * 140);          // the shelf, then the deep
    const cliff = smoothstep(0.18, 0.36, fbm(nCliff, x / 2100, z / 2100, 2));
    // Beach, then the land rising inland; along a cliffy stretch it rises at once.
    let h = 2.4 * smoothstep(0.0, 0.02, land);
    h += 28 * cliff * smoothstep(0.0, 0.01, land);
    h += 72 * Math.pow(smoothstep(0.02, 0.3, land), 1.3);
    h += 20 * smoothstep(0.04, 0.2, land) * fbm(nHill, wx / 700, wz / 700, 3);
    if (detail) h += 2 * fbm(nDet, x / 90, z / 90, 2) * smoothstep(0.0, 0.05, land);
    return h;
  }
  return {
    heightAt: (x, z) => field(x, z, 6, true),
    heightAtCoarse: (x, z) => field(x, z, 4, false),
    heightAtFar: (x, z) => field(x, z, 5, true),
  };
}

// A sand plain with dune fields and flat-topped mesas standing out of it, the
// kind of desert a road threads between buttes. The mesas have a cap rock and
// a lower step, so their walls read as bands of sandstone.
function makeDesert(seed) {
  const nPlain = makeSimplex(seed ^ 0x7441a);
  const nWarp = makeSimplex(seed ^ 0x7442b);
  const nMesa = makeSimplex(seed ^ 0x7443c);
  const nDune = makeSimplex(seed ^ 0x7444d);
  const nField = makeSimplex(seed ^ 0x7445e);
  const nDet = makeSimplex(seed ^ 0x7446f);
  const wind = 0.6;                     // dunes stand across this direction
  const cw = Math.cos(wind);
  const sw = Math.sin(wind);
  function field(x, z, oct, detail) {
    const wx = x + 500 * fbm(nWarp, x / 3000, z / 3000, 2);
    const wz = z + 500 * fbm(nWarp, x / 3000 + 2.2, z / 3000 + 7.4, 2);
    let h = 28 + 26 * fbm(nPlain, wx / 3600, wz / 3600, Math.min(oct, 4), 2.0, 0.5);
    const m = fbm(nMesa, wx / 1700, wz / 1700, 3, 2.0, 0.5);
    h += 42 * smoothstep(0.20, 0.235, m);                     // the lower step
    h += 88 * smoothstep(0.30, 0.325, m);                     // the cap rock
    h += 6 * smoothstep(0.235, 0.30, m);                      // talus between
    // Transverse dunes: sharp crests across the wind, in fields.
    const along = x * cw + z * sw;
    const across = -x * sw + z * cw;
    const fieldW = smoothstep(-0.05, 0.3, fbm(nField, x / 2400, z / 2400, 2)) * (1 - smoothstep(0.12, 0.2, m));
    if (fieldW > 0) h += 15 * fieldW * ridged(nDune, along / 210, across / 640, detail ? 3 : 2, 2.0, 0.5, 1.0);
    if (detail) h += 0.8 * fbm(nDet, x / 40, z / 40, 2);
    return h;
  }
  return {
    heightAt: (x, z) => field(x, z, 6, true),
    heightAtCoarse: (x, z) => field(x, z, 4, false),
    heightAtFar: (x, z) => field(x, z, 5, true),
  };
}

// A city on a wide plain: almost flat, tilting a few metres over kilometres.
// The towers stand on it (render/city.js); the road crosses it on an
// elevated expressway (params.elevated).
function makeCity(seed) {
  const nBase = makeSimplex(seed ^ 0x8551a);
  const nDet = makeSimplex(seed ^ 0x8552b);
  function field(x, z, detail) {
    let h = 14 + 10 * fbm(nBase, x / 4200, z / 4200, 3, 2.0, 0.5);
    if (detail) h += 0.6 * fbm(nDet, x / 180, z / 180, 2);
    return h;
  }
  return {
    heightAt: (x, z) => field(x, z, true),
    heightAtCoarse: (x, z) => field(x, z, false),
    heightAtFar: (x, z) => field(x, z, true),
  };
}

// How much of the city's towers stand at a point (0..1): the downtown
// clusters are tallest. Parks are left open, and the trees grow there.
export function makeSkyline(seed) {
  const nCore = makeSimplex(seed ^ 0x8553c);
  const nBlock = makeSimplex(seed ^ 0x8554d);
  const nPark = makeSimplex(seed ^ 0x8555e);
  return {
    core: (x, z) => smoothstep(-0.25, 0.55, fbm(nCore, x / 2600, z / 2600, 2)),
    block: (x, z) => fbm(nBlock, x / 300, z / 300, 2),
    park: (x, z) => smoothstep(0.22, 0.34, fbm(nPark, x / 800, z / 800, 2)),
  };
}

// --- the worlds -----------------------------------------------------------------//
// ground: sRGB colours for the terrain shader's layers ('grass' is whatever
//   covers the open ground: turf, dry grass, sand).
// params: snowLine/treeLine in metres; water: level, or null for none;
//   vegetated: 1 where the open ground is living turf (the shader tints it
//   lusher in hollows and drier on spurs), 0 for bare sand; shore: height of
//   the sand band above the water.
// look: sky, fog and light for render/atmosphere.js; the sun keeps one
//   direction in every world, because shadows are baked into the tiles.
// flora: what the forest plants ('spruce', 'broadleaf', 'pine', 'cactus').

export const WORLDS = [
  {
    id: 'alpine',
    name: '山间',
    make: (seed) => makeAlpine(seed),
    flora: 'spruce',
    ground: {
      grassLow: 0x52632f, grassHigh: 0x77744a, rock: 0x8a8173, rockDark: 0x4e4a44, scree: 0x958e82,
      snow: 0xf3f6fa, gravel: 0x77705f, fill: 0x676d40, forestFloor: 0x34321f, canopy: 0x223219, sand: 0xb9a888,
    },
    params: { snowLine: 720, treeLine: 520, water: null, vegetated: 1, shore: 0, strata: 1 },
    look: {
      sunColor: 0xfff0dc, sunIntensity: 3.6, zenith: 0x2f63a8, horizon: 0xc4d6e6, ground: 0x6f6b5c,
      glow: 0xffd9ae, clouds: 0.55, fogDensity: 0.00017, fogBase: 0, fogFalloff: 720,
      skyLight: 0xb9c9dc, groundLight: 0x6e6550, hemiIntensity: 0.22, envIntensity: 1.0, exposure: 2.0,
    },
  },
  {
    id: 'hills',
    name: '丘陵',
    make: makeHills,
    flora: 'broadleaf',
    ground: {
      grassLow: 0x5c7334, grassHigh: 0x7f8147, rock: 0x948a78, rockDark: 0x5a5349, scree: 0x9b937f,
      snow: 0xf3f6fa, gravel: 0x7b7362, fill: 0x6f7743, forestFloor: 0x36341e, canopy: 0x2d401d, sand: 0xb9a888,
    },
    params: { snowLine: 1e5, treeLine: 1e5, water: null, vegetated: 1, shore: 0, strata: 0.5 },
    look: {
      sunColor: 0xfff0d4, sunIntensity: 3.5, zenith: 0x3a72b4, horizon: 0xd0e0e8, ground: 0x707058,
      glow: 0xffdcae, clouds: 0.66, fogDensity: 0.0002, fogBase: 0, fogFalloff: 600,
      skyLight: 0xbccbd8, groundLight: 0x6c6a4c, hemiIntensity: 0.24, envIntensity: 1.0, exposure: 2.0,
    },
  },
  {
    id: 'river',
    name: '河谷',
    make: makeRiver,
    flora: 'broadleaf',
    ground: {
      grassLow: 0x4f6b30, grassHigh: 0x707b45, rock: 0x7f7a6e, rockDark: 0x4a4740, scree: 0x8b867b,
      snow: 0xf3f6fa, gravel: 0x78715f, fill: 0x64713f, forestFloor: 0x30331c, canopy: 0x27391b, sand: 0xa79c80,
    },
    params: { snowLine: 1e5, treeLine: 1e5, water: 0, vegetated: 1, shore: 1.6, strata: 0.6 },
    water: { waterDeep: 0x1d3a31, waterShallow: 0x4b6f5a },
    look: {
      sunColor: 0xfff2dc, sunIntensity: 3.3, zenith: 0x41709f, horizon: 0xc8d8dc, ground: 0x5e6656,
      glow: 0xf6dcb6, clouds: 0.7, fogDensity: 0.00026, fogBase: 0, fogFalloff: 380,
      skyLight: 0xb6c8d4, groundLight: 0x5a6048, hemiIntensity: 0.26, envIntensity: 1.0, exposure: 2.05,
    },
  },
  {
    id: 'coast',
    name: '沿海',
    make: makeCoast,
    flora: 'pine',
    ground: {
      grassLow: 0x7b7d45, grassHigh: 0x8f8552, rock: 0xb4a78e, rockDark: 0x6f6758, scree: 0xc2b498,
      snow: 0xf3f6fa, gravel: 0x8d8470, fill: 0x8a8550, forestFloor: 0x4d4a2c, canopy: 0x34401f, sand: 0xdccaa2,
    },
    params: { snowLine: 1e5, treeLine: 1e5, water: 0, vegetated: 0.75, shore: 2.2, strata: 0.7 },
    water: { waterDeep: 0x0e3d5a, waterShallow: 0x2f8e9c },
    look: {
      sunColor: 0xfff6e6, sunIntensity: 3.8, zenith: 0x2c6fb0, horizon: 0xd9e8ee, ground: 0x8a8470,
      glow: 0xfff0d0, clouds: 0.35, fogDensity: 0.00014, fogBase: 0, fogFalloff: 300,
      skyLight: 0xc2d6e6, groundLight: 0x8a7a5c, hemiIntensity: 0.24, envIntensity: 1.05, exposure: 1.95,
    },
  },
  {
    id: 'desert',
    name: '沙漠',
    make: makeDesert,
    flora: 'cactus',
    ground: {
      grassLow: 0xd3ad79, grassHigh: 0xc99f6d, rock: 0xb4744a, rockDark: 0x70412a, scree: 0xc28c5f,
      snow: 0xf3f6fa, gravel: 0x9e8160, fill: 0xbe9b6d, forestFloor: 0x8d7149, canopy: 0x5d6337, sand: 0xd8b582,
    },
    params: { snowLine: 1e5, treeLine: 1e5, water: null, vegetated: 0, shore: 0, strata: 1.3 },
    look: {
      sunColor: 0xffe7c6, sunIntensity: 4.0, zenith: 0x3b6aa6, horizon: 0xeedbc0, ground: 0xb08a5c,
      glow: 0xffd2a0, clouds: 0.12, fogDensity: 0.00016, fogBase: 0, fogFalloff: 900,
      skyLight: 0xd6cdbd, groundLight: 0xa77f52, hemiIntensity: 0.26, envIntensity: 0.95, exposure: 1.9,
    },
  },
  {
    // Blue hour: the sun gone down behind the haze, the sky deep blue over a
    // warm band at the horizon, and the towers lit window by window.
    id: 'city',
    name: '城市',
    make: makeCity,
    flora: 'broadleaf',
    ground: {
      grassLow: 0x56604a, grassHigh: 0x5f6352, rock: 0x7b7974, rockDark: 0x4b4a47, scree: 0x86837c,
      snow: 0xf3f6fa, gravel: 0x5d5c58, fill: 0x5a5d4c, forestFloor: 0x34352b, canopy: 0x27331f, sand: 0x8f8a80,
    },
    params: { snowLine: 1e5, treeLine: 1e5, water: null, vegetated: 0.45, shore: 0, strata: 0.15, elevated: 12 },
    look: {
      sunColor: 0xff9a62, sunIntensity: 0.9, zenith: 0x0d1830, horizon: 0x7e6260, ground: 0x1e1d21,
      glow: 0xff8a50, clouds: 0.22, fogDensity: 0.00016, fogBase: 0, fogFalloff: 420,
      skyLight: 0x4a5a80, groundLight: 0x2a2622, hemiIntensity: 0.3, envIntensity: 0.6, exposure: 2.0,
    },
  },
];

export const WORLD_INDEX = Object.fromEntries(WORLDS.map((w, i) => [w.id, i]));

// --- where a point is --------------------------------------------------------------

// The same integer hash as the shader's (render/worldlook.js), so both sides
// bend the borders identically.
function lattice(ix, iz) {
  let h = (Math.imul(ix, 0x8da6b343) ^ Math.imul(iz, 0xd8163841)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h & 0xffffff) / 16777216;
}

export class WorldMap {
  constructor(opts = {}) {
    this.list = WORLDS;
    this.count = WORLDS.length;
    this.len = opts.len || WORLD_LEN;
    this.blend = Math.min(opts.blend || WORLD_BLEND, this.len * 0.45);
    this.first = Math.max(0, WORLD_INDEX[opts.start] || 0);
    this.ox = 0;
    this.oz = 0;
    this.dx = 1;
    this.dz = 0;
    this.shift = 0;
    this.ready = false;
    this._t = { a: this.first, b: this.first, t: 0, u: 0 };
  }

  // Set by the road once it knows where it starts and which way it heads.
  // Until then everything is the first world.
  setAxis(ax, az, theta) {
    this.ox = ax;
    this.oz = az;
    this.dx = Math.cos(theta);
    this.dz = Math.sin(theta);
    this.shift = 0;
    this.shift = START_U + this.first * this.len - this.rawU(ax, az);
    this.ready = true;
  }

  warp(ax, az) {
    const qx = ax / WARP_SCALE;
    const qz = az / WARP_SCALE;
    const ix = Math.floor(qx);
    const iz = Math.floor(qz);
    let fx = qx - ix;
    let fz = qz - iz;
    fx = fx * fx * (3 - 2 * fx);
    fz = fz * fz * (3 - 2 * fz);
    const a = lattice(ix, iz);
    const b = lattice(ix + 1, iz);
    const c = lattice(ix, iz + 1);
    const d = lattice(ix + 1, iz + 1);
    const v = a + (b - a) * fx + (c + (d - c) * fx - (a + (b - a) * fx)) * fz;
    return (v - 0.5) * 2 * WARP_AMP;
  }

  rawU(ax, az) {
    return (ax - this.ox) * this.dx + (az - this.oz) * this.dz + this.warp(ax, az) + this.shift;
  }

  // Unwarped coordinates along the road's heading and across it, for
  // landforms whose features run the road's way (rivers, coastlines).
  axisUV(ax, az, out) {
    const x = ax - this.ox;
    const z = az - this.oz;
    out.along = x * this.dx + z * this.dz;
    out.lat = -x * this.dz + z * this.dx;
    return out;
  }

  // Progress into the worlds, metres. Behind the start, the first world.
  u(ax, az) {
    if (!this.ready) return START_U + this.first * this.len;
    return Math.max(this.rawU(ax, az), this.first * this.len);
  }

  // { a, b, t }: the world here, the one it is turning into, and how far.
  at(ax, az, out = this._t) {
    const u = this.u(ax, az);
    const k = Math.floor(u / this.len);
    const f = u - k * this.len;
    out.u = u;
    out.a = k % this.count;
    out.b = (k + 1) % this.count;
    out.t = smoothstep(this.len - this.blend, this.len, f);
    return out;
  }

  // The world a point mostly belongs to.
  main(ax, az) {
    const w = this.at(ax, az);
    return w.t < 0.5 ? w.a : w.b;
  }
}

// --- the land of all the worlds ------------------------------------------------------

// The water a point would be under, or -Infinity. A world's water shows where
// its share of the blend is over a third, the same threshold the water surface
// fades in at (render/water.js), so the road keeps clear of every water drawn.
export const WATER_SHOW = 0.35;
export const WATER_CLEAR = 6.5;      // a bridge's running surface over the water

export function makeWorldLand(seed, opts = {}) {
  const map = new WorldMap(opts);
  const fields = WORLDS.map((w) => w.make(seed, map));
  const water = WORLDS.map((w) => w.params.water);
  const raised = WORLDS.map((w) => w.params.elevated || 0);
  const tmp = { a: 0, b: 0, t: 0, u: 0 };
  const blended = (key) => (x, z) => {
    map.at(x, z, tmp);
    const ha = fields[tmp.a][key](x, z);
    if (tmp.t < 1e-4) return ha;
    const hb = fields[tmp.b][key](x, z);
    return ha + (hb - ha) * tmp.t;
  };
  const waterLevel = (x, z) => {
    map.at(x, z, tmp);
    const la = water[tmp.a];
    const lb = water[tmp.b];
    const share = (la === null ? 0 : 1 - tmp.t) + (lb === null ? 0 : tmp.t);
    if (share < WATER_SHOW) return -Infinity;
    if (la === null) return lb;
    if (lb === null) return la;
    return la + (lb - la) * tmp.t;
  };
  const alpine = fields[0];
  return {
    id: 'worlds',
    worlds: map,
    heightAt: blended('heightAt'),
    heightAtCoarse: blended('heightAtCoarse'),
    heightAtFar: blended('heightAtFar'),
    waterLevel,
    // Where the road's grade line aims: the ground on dry land, or above it in
    // a world that carries the road on an expressway; over water, bridge
    // height, eased in across the shore so the target has no step.
    designAt(x, z, g) {
      map.at(x, z, tmp);
      const lift = raised[tmp.a] + (raised[tmp.b] - raised[tmp.a]) * tmp.t;
      const w = waterLevel(x, z);
      if (w === -Infinity) return g + lift;
      return Math.max(g + lift, w + WATER_CLEAR * smoothstep(w + 1.5, w - 1.0, g));
    },
    // Under water, for the route search: crossing it means a bridge.
    wetAt(x, z, g) {
      const w = waterLevel(x, z);
      return w !== -Infinity && g < w + 0.5;
    },
    setAxis: (ax, az, theta) => map.setAxis(ax, az, theta),
    // The first world's, for whatever still reads one number.
    snowLine: alpine.snowLine,
    treeLine: alpine.treeLine,
  };
}
