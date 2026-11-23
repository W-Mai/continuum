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
export const STAY_MIN = 600;       // an asked-for border leaves a world this long unblended

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

// A cave the size of a country: a floor of dust and fallen rock under a roof
// a hundred and seventy metres up (render/ceiling.js), and stone columns
// standing from the floor into the roof. The road winds between them.
function makeCavern(seed) {
  const nBase = makeSimplex(seed ^ 0xc991a);
  const nMound = makeSimplex(seed ^ 0xc992b);
  const nPillar = makeSimplex(seed ^ 0xc993c);
  const nDet = makeSimplex(seed ^ 0xc994d);
  function field(x, z, oct, detail) {
    let h = 22 + 22 * fbm(nBase, x / 1800, z / 1800, Math.min(oct, 4), 2.0, 0.5);
    const m = ridged(nMound, x / 480, z / 480, detail ? 3 : 2, 2.0, 0.5, 1.0);
    h += 28 * m * m;
    const p = fbm(nPillar, x / 420, z / 420, 2, 2.0, 0.5);
    h = Math.max(h, 260 * smoothstep(0.5, 0.58, p));
    if (detail) h += 1.2 * fbm(nDet, x / 50, z / 50, 2);
    return h;
  }
  return {
    heightAt: (x, z) => field(x, z, 6, true),
    heightAtCoarse: (x, z) => field(x, z, 4, false),
    heightAtFar: (x, z) => field(x, z, 5, true),
  };
}

// The other side: this land gone dead and wrong. Swells and ridges that fork
// and wander like roots, a few tens of metres high, under a sky that does not
// clear.
function makeUpside(seed) {
  const nBase = makeSimplex(seed ^ 0xa711a);
  const nWarp = makeSimplex(seed ^ 0xa712b);
  const nRoot = makeSimplex(seed ^ 0xa713c);
  const nDet = makeSimplex(seed ^ 0xa714d);
  function field(x, z, oct, detail) {
    const wx = x + 420 * fbm(nWarp, x / 1800, z / 1800, 2);
    const wz = z + 420 * fbm(nWarp, x / 1800 + 3.3, z / 1800 - 7.7, 2);
    let h = 60 + 50 * fbm(nBase, wx / 2000, wz / 2000, oct, 2.0, 0.46);
    const r = ridged(nRoot, wx / 420, wz / 420, detail ? 3 : 2, 2.1, 0.5, 1.0);
    h += 26 * r * r * smoothstep(-0.2, 0.4, fbm(nBase, wx / 3000 + 9, wz / 3000, 2));
    if (detail) h += 2.4 * fbm(nDet, x / 55, z / 55, 3);
    return h;
  }
  return {
    heightAt: (x, z) => field(x, z, 6, true),
    heightAtCoarse: (x, z) => field(x, z, 4, false),
    heightAtFar: (x, z) => field(x, z, 5, true),
  };
}

// The underworld: black basalt in broken plateaus and sharp ridges, with
// rivers of lava in channels like the river world's water, mostly running
// the road's way, so the road rides beside them and bridges them.
function makeInferno(seed, map) {
  const nBase = makeSimplex(seed ^ 0x9661a);
  const nWarp = makeSimplex(seed ^ 0x9662b);
  const nRidge = makeSimplex(seed ^ 0x9663c);
  const nLava = makeSimplex(seed ^ 0x9664d);
  const nDet = makeSimplex(seed ^ 0x9665e);
  const uv = { along: 0, lat: 0 };
  function field(x, z, oct, detail) {
    const wx = x + 400 * fbm(nWarp, x / 2400, z / 2400, 2);
    const wz = z + 400 * fbm(nWarp, x / 2400 + 4.4, z / 2400 - 6.1, 2);
    let h = 45 + 55 * fbm(nBase, wx / 2000, wz / 2000, oct, 2.0, 0.5);
    const r = ridged(nRidge, wx / 760, wz / 760, detail ? 4 : 3, 2.1, 0.55, 1.0);
    h += 90 * r * r * r;
    map.axisUV(wx, wz, uv);
    const line = Math.abs(fbm(nLava, uv.along / 5200, uv.lat / 2000, 3, 2.0, 0.42));
    const valley = 1 - smoothstep(0.08, 0.3, line);
    h += (8 - h) * valley;
    h += (-4 - h) * (1 - smoothstep(0.028, 0.044, line));
    if (detail) h += 1.4 * fbm(nDet, x / 60, z / 60, 2);
    return h;
  }
  return {
    heightAt: (x, z) => field(x, z, 6, true),
    heightAtCoarse: (x, z) => field(x, z, 4, false),
    heightAtFar: (x, z) => field(x, z, 5, true),
  };
}

// The deep sea floor, a hundred and twenty metres down: a plain of silt with
// ridges of rock and the odd seamount. The road runs on the floor.
function makeAbyss(seed) {
  const nBase = makeSimplex(seed ^ 0xa771a);
  const nRock = makeSimplex(seed ^ 0xa772b);
  const nMount = makeSimplex(seed ^ 0xa773c);
  const nDet = makeSimplex(seed ^ 0xa774d);
  function field(x, z, oct, detail) {
    let h = -118 + 14 * fbm(nBase, x / 2600, z / 2600, Math.min(oct, 4), 2.0, 0.5);
    const r = ridged(nRock, x / 520, z / 520, detail ? 3 : 2, 2.0, 0.5, 1.0);
    h += 26 * smoothstep(0.55, 0.9, r);
    h += 70 * Math.pow(smoothstep(0.35, 0.75, fbm(nMount, x / 3000, z / 3000, 2) * 0.5 + 0.5), 2);
    if (detail) h += 0.9 * fbm(nDet, x / 50, z / 50, 2);
    return h;
  }
  return {
    heightAt: (x, z) => field(x, z, 6, true),
    heightAtCoarse: (x, z) => field(x, z, 4, false),
    heightAtFar: (x, z) => field(x, z, 5, true),
  };
}

// Above a sea of cloud: the land lies hidden below it, and only the tops of
// the mountains stand out of it as islands. The road keeps high over the
// cloud on long viaducts and rides the islands' ridges where it can.
function makeHeaven(seed) {
  const nBase = makeSimplex(seed ^ 0xb881a);
  const nPeak = makeSimplex(seed ^ 0xb882b);
  const nDet = makeSimplex(seed ^ 0xb883c);
  function field(x, z, oct, detail) {
    const n = fbm(nBase, x / 2800, z / 2800, Math.min(oct, 5), 2.0, 0.5);
    let h = -160 + 300 * Math.pow(smoothstep(-0.15, 0.55, n), 1.5);
    const p = ridged(nPeak, x / 900, z / 900, detail ? 3 : 2, 2.0, 0.5, 1.0);
    h += 120 * p * p * smoothstep(0.1, 0.45, n);
    if (detail) h += 2 * fbm(nDet, x / 90, z / 90, 2);
    return h;
  }
  return {
    heightAt: (x, z) => field(x, z, 6, true),
    heightAtCoarse: (x, z) => field(x, z, 4, false),
    heightAtFar: (x, z) => field(x, z, 5, true),
  };
}

// Space: the land has fallen away under the cloud far below. Only the road
// is up here.
function makeSpace() {
  const h = () => -900;
  return { heightAt: h, heightAtCoarse: h, heightAtFar: h };
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
//   the sand band above the water. For the road: clear, its height over the
//   liquid on a bridge; swell, how far that height rises and falls along the
//   way, so a road out over a sea of cloud breathes instead of running dead
//   level; elevated, an expressway's height over dry ground; underwater, it
//   keeps to the floor; piers: false where it floats.
// look: sky, fog and light for render/atmosphere.js; the sun keeps one
//   direction in every world, because shadows are baked into the tiles. A day
//   world's look is its noon; look.skies says how its other skies differ (SKIES).
//   realSky: the sky of the real style at noon in three colours, the zenith's,
//   the middle's and the horizon's (linear RGB, as the sky goes into the tone
//   curve); realExpose, realLight, realFog: how much of the world's exposure, of
//   its sky's light (the hemisphere's and the environment's) and of its haze the
//   real style takes (1 where it says nothing).
// flora: what the forest plants: one of vegetation.js's FLORA, or 'none'.
// wet: how wet the road is, 0 to 1 (none: dry): the asphalt darker, its roughness down,
//   and over a few tenths water lying in the low places and the lamps in it
//   (render/roadmesh.js).

export const WORLDS = [
  {
    id: 'alpine',
    name: '山间',
    make: (seed) => makeAlpine(seed),
    flora: 'spruce',
    // What the air sounds like (ui/sound.js): a band of noise (Hz, Q, gain)
    // that swells (period s, depth), a drone (Hz, gain), the low-pass the
    // world puts on everything (muffle, Hz) and how much the car rings.
    sound: { air: [700, 0.5, 0.05], swell: [9, 0.55] },
    // Snow blown off the ridges, sinking slowly on the wind.
    motes: { maxPx: 2.4, density: 0.12, size: 0.045, rise: -0.25, current: 0.9, sway: 0.5, flicker: 0, glow: 0.55, color: 0xf2f6ff },
    ground: {
      grassLow: 0x52632f, grassHigh: 0x77744a, rock: 0x8a8173, rockDark: 0x4e4a44, scree: 0x958e82,
      snow: 0xf3f6fa, gravel: 0x77705f, fill: 0x676d40, forestFloor: 0x34321f, canopy: 0x223219, sand: 0xb9a888,
    },
    params: { roll: 0.3, snowLine: 720, treeLine: 520, water: null, vegetated: 1, shore: 0, strata: 1 },
    // The blades of grass (render/grass.js): how much of the open ground has them, how tall they stand (m), and how many flowers there are among them.
    grass: { amount: 0.8, height: 0.35, flowers: 0.6 },
    look: {
      // The pixel style's palette (render/pixelpal.js): six colours, each a hue, a chroma and three lightnesses, and six greys, a hue, a chroma and six lightnesses.
      pixel: {
        ramps: [[30, 0.16, 0.3, 0.48, 0.68], [92, 0.045, 0.56, 0.68, 0.78], [134, 0.11, 0.5, 0.64, 0.76], [165, 0.06, 0.3, 0.44, 0.6], [210, 0.035, 0.45, 0.6, 0.74], [240, 0.13, 0.55, 0.69, 0.8]],
        grey: [100, 0.012, 0.22, 0.38, 0.52, 0.62, 0.75, 0.95],
      },
      sunColor: 0xfff0dc, sunIntensity: 3.6, zenith: 0x2f63a8, horizon: 0xc4d6e6, ground: 0x6f6b5c,
      glow: 0xffd9ae, clouds: 0.55, fogDensity: 0.00017, fogBase: 0, fogFalloff: 720,
      skyLight: 0xb9c9dc, groundLight: 0x6e6550, hemiIntensity: 0.22, envIntensity: 1.0, exposure: 2.0,
      // The painted style's sky: zenith, middle and horizon, linear RGB.
      paintSky: [[0.028, 0.21, 0.60], [0.07, 0.36, 0.72], [0.42, 0.70, 0.86]],
      // The real style's sky at noon: zenith, middle and horizon, linear RGB, as the sky goes into the tone curve; and the share it takes of the world's exposure, of its sky's light and of its haze.
      realSky: [[0.07, 0.20, 0.52], [0.14, 0.30, 0.60], [0.52, 0.64, 0.81]], realExpose: 0.6, realLight: 1,
      cloudSet: 'fair',
      // Its other skies (SKIES): where this world's golden and grey differ from SKY_RECIPE's, { golden: {...}, grey: {...} }.
      skies: {},
    },
  },
  {
    id: 'hills',
    name: '丘陵',
    make: makeHills,
    flora: 'broadleaf',
    sound: { air: [900, 0.45, 0.035], swell: [11, 0.4] },
    // Pollen and seed down, drifting up on the warm air.
    motes: { maxPx: 2.4, density: 0.05, size: 0.04, rise: 0.12, current: 0.5, sway: 0.9, flicker: 0.2, glow: 0.7, color: 0xfff1b8 },
    ground: {
      grassLow: 0x5c7334, grassHigh: 0x7f8147, rock: 0x948a78, rockDark: 0x5a5349, scree: 0x9b937f,
      snow: 0xf3f6fa, gravel: 0x7b7362, fill: 0x6f7743, forestFloor: 0x36341e, canopy: 0x2d401d, sand: 0xb9a888,
    },
    params: { roll: 0.55, snowLine: 1e5, treeLine: 1e5, water: null, vegetated: 1, shore: 0, strata: 0.5 },
    // The blades of grass (render/grass.js): how much of the open ground has them, how tall they stand (m), and how many flowers there are among them.
    grass: { amount: 1, height: 0.5, flowers: 1 },
    look: {
      pixel: {
        ramps: [[24, 0.15, 0.3, 0.46, 0.65], [88, 0.05, 0.54, 0.66, 0.78], [135, 0.14, 0.56, 0.72, 0.84], [152, 0.085, 0.3, 0.48, 0.72], [238, 0.03, 0.56, 0.72, 0.86], [236, 0.12, 0.58, 0.71, 0.8]],
        grey: [92, 0.014, 0.2, 0.34, 0.48, 0.62, 0.78, 0.95],
      },
      sunColor: 0xfff0d4, sunIntensity: 3.5, zenith: 0x3a72b4, horizon: 0xd0e0e8, ground: 0x707058,
      glow: 0xffdcae, clouds: 0.66, fogDensity: 0.0002, fogBase: 0, fogFalloff: 600,
      skyLight: 0xbccbd8, groundLight: 0x6c6a4c, hemiIntensity: 0.24, envIntensity: 1.0, exposure: 2.0,
      // The painted style's sky: zenith, middle and horizon, linear RGB.
      paintSky: [[0.035, 0.25, 0.62], [0.08, 0.39, 0.72], [0.38, 0.70, 0.84]],
      // The real style's sky at noon, and its share of the exposure, of the sky's light and of the haze.
      realSky: [[0.08, 0.21, 0.53], [0.15, 0.31, 0.61], [0.55, 0.66, 0.82]], realExpose: 0.52, realLight: 0.84, realFog: 0.6,
      cloudSet: 'fair',
      // Its other skies (SKIES): where this world's golden and grey differ from SKY_RECIPE's, { golden: {...}, grey: {...} }.
      skies: {},
    },
  },
  {
    id: 'river',
    name: '河谷',
    make: makeRiver,
    flora: 'broadleaf',
    // The valley air is damp: the road a little wet.
    wet: 0.25,
    sound: { air: [1700, 0.9, 0.035], swell: [4, 0.15] },
    // Midges over the water, lit as they turn.
    motes: { maxPx: 2.4, density: 0.06, size: 0.035, rise: 0.02, current: 0.25, sway: 1.2, flicker: 0.5, glow: 0.5, color: 0xeef4e0 },
    ground: {
      grassLow: 0x4f6b30, grassHigh: 0x707b45, rock: 0x7f7a6e, rockDark: 0x4a4740, scree: 0x8b867b,
      snow: 0xf3f6fa, gravel: 0x78715f, fill: 0x64713f, forestFloor: 0x30331c, canopy: 0x27391b, sand: 0xa79c80,
    },
    params: { roll: 0.4, snowLine: 1e5, treeLine: 1e5, water: 0, vegetated: 1, shore: 1.6, strata: 0.6 },
    // The blades of grass (render/grass.js): how much of the open ground has them, how tall they stand (m), and how many flowers there are among them.
    grass: { amount: 1, height: 0.6, flowers: 0.7 },
    water: { waterDeep: 0x1d3a31, waterShallow: 0x4b6f5a },
    look: {
      pixel: {
        ramps: [[26, 0.15, 0.3, 0.46, 0.66], [92, 0.05, 0.56, 0.68, 0.8], [138, 0.13, 0.52, 0.67, 0.78], [160, 0.075, 0.32, 0.5, 0.72], [236, 0.03, 0.56, 0.72, 0.86], [236, 0.12, 0.58, 0.71, 0.8]],
        grey: [95, 0.012, 0.2, 0.34, 0.53, 0.62, 0.78, 0.95],
      },
      sunColor: 0xfff2dc, sunIntensity: 3.3, zenith: 0x41709f, horizon: 0xc8d8dc, ground: 0x5e6656,
      glow: 0xf6dcb6, clouds: 0.7, fogDensity: 0.00026, fogBase: 0, fogFalloff: 380,
      skyLight: 0xb6c8d4, groundLight: 0x5a6048, hemiIntensity: 0.26, envIntensity: 1.0, exposure: 2.05,
      // The painted style's sky: zenith, middle and horizon, linear RGB.
      paintSky: [[0.035, 0.25, 0.62], [0.08, 0.39, 0.72], [0.38, 0.70, 0.84]],
      // The real style's sky at noon, and its share of the exposure, of the sky's light and of the haze.
      realSky: [[0.08, 0.21, 0.53], [0.15, 0.31, 0.61], [0.55, 0.66, 0.82]], realExpose: 0.56, realLight: 0.88, realFog: 0.6,
      cloudSet: 'fair',
      // Its other skies (SKIES): where this world's golden and grey differ from SKY_RECIPE's, { golden: {...}, grey: {...} }.
      skies: {},
    },
  },
  {
    id: 'coast',
    name: '沿海',
    make: makeCoast,
    flora: 'pine',
    // Sea air: a damp road.
    wet: 0.15,
    sound: { air: [420, 0.6, 0.075], swell: [7, 0.85] },
    // Salt spray off the surf, going by fast.
    motes: { maxPx: 2.4, density: 0.09, size: 0.04, rise: 0.05, current: 1.6, sway: 0.4, flicker: 0, glow: 0.6, color: 0xffffff },
    ground: {
      grassLow: 0x7b7d45, grassHigh: 0x8f8552, rock: 0xb4a78e, rockDark: 0x6f6758, scree: 0xc2b498,
      snow: 0xf3f6fa, gravel: 0x8d8470, fill: 0x8a8550, forestFloor: 0x4d4a2c, canopy: 0x34401f, sand: 0xdccaa2,
    },
    params: { roll: 0.45, snowLine: 1e5, treeLine: 1e5, water: 0, vegetated: 0.75, shore: 2.2, strata: 0.7 },
    // The blades of grass (render/grass.js): how much of the open ground has them, how tall they stand (m), and how many flowers there are among them.
    grass: { amount: 0.5, height: 0.45, flowers: 0.2 },
    water: { waterDeep: 0x0e3d5a, waterShallow: 0x2f8e9c },
    look: {
      pixel: {
        ramps: [[28, 0.16, 0.3, 0.46, 0.66], [90, 0.06, 0.58, 0.74, 0.87], [120, 0.125, 0.55, 0.7, 0.82], [165, 0.06, 0.3, 0.47, 0.62], [215, 0.08, 0.58, 0.74, 0.86], [232, 0.12, 0.5, 0.71, 0.8]],
        grey: [93, 0.013, 0.22, 0.38, 0.52, 0.64, 0.8, 0.95],
      },
      sunColor: 0xfff6e6, sunIntensity: 3.8, zenith: 0x2c6fb0, horizon: 0xd9e8ee, ground: 0x8a8470,
      glow: 0xfff0d0, clouds: 0.35, fogDensity: 0.00014, fogBase: 0, fogFalloff: 300,
      skyLight: 0xc2d6e6, groundLight: 0x8a7a5c, hemiIntensity: 0.24, envIntensity: 1.05, exposure: 1.95,
      // The painted style's sky: zenith, middle and horizon, linear RGB.
      paintSky: [[0.035, 0.27, 0.62], [0.08, 0.40, 0.72], [0.46, 0.74, 0.82]],
      // The real style's sky at noon, and its share of the exposure, of the sky's light and of the haze.
      realSky: [[0.08, 0.22, 0.53], [0.14, 0.32, 0.62], [0.57, 0.69, 0.82]], realExpose: 0.43, realLight: 0.8, realFog: 0.6,
      cloudSet: 'fair',
      // Its other skies (SKIES): where this world's golden and grey differ from SKY_RECIPE's, { golden: {...}, grey: {...} }.
      skies: {},
    },
  },
  {
    id: 'desert',
    name: '沙漠',
    make: makeDesert,
    flora: 'cactus',
    sound: { air: [1150, 0.6, 0.045], swell: [6, 0.65] },
    // Sand blowing across the flats, grain by grain.
    motes: { maxPx: 2.4, density: 0.28, size: 0.03, rise: 0, current: 3.4, sway: 0.25, flicker: 0, glow: 0.55, color: 0xe8c58e },
    ground: {
      grassLow: 0xd3ad79, grassHigh: 0xc99f6d, rock: 0xb4744a, rockDark: 0x70412a, scree: 0xc28c5f,
      snow: 0xf3f6fa, gravel: 0x9e8160, fill: 0xbe9b6d, forestFloor: 0x8d7149, canopy: 0x5d6337, sand: 0xd8b582,
    },
    params: { roll: 0.6, snowLine: 1e5, treeLine: 1e5, water: null, vegetated: 0, shore: 0, strata: 1.3 },
    // The blades of grass (render/grass.js): how much of the open ground has them, how tall they stand (m), and how many flowers there are among them.
    grass: { amount: 0.08, height: 0.3, flowers: 0 },
    look: {
      pixel: {
        ramps: [[28, 0.16, 0.3, 0.46, 0.66], [50, 0.1, 0.46, 0.62, 0.76], [88, 0.085, 0.66, 0.82, 0.94], [125, 0.05, 0.3, 0.45, 0.6], [232, 0.04, 0.62, 0.78, 0.88], [235, 0.1, 0.55, 0.7, 0.78]],
        grey: [75, 0.01, 0.2, 0.34, 0.48, 0.61, 0.78, 0.92],
      },
      sunColor: 0xffe7c6, sunIntensity: 4.0, zenith: 0x3b6aa6, horizon: 0xeedbc0, ground: 0xb08a5c,
      glow: 0xffd2a0, clouds: 0.12, fogDensity: 0.00016, fogBase: 0, fogFalloff: 900,
      skyLight: 0xd6cdbd, groundLight: 0xa77f52, hemiIntensity: 0.26, envIntensity: 0.95, exposure: 1.9,
      // The painted style's sky: zenith, middle and horizon, linear RGB.
      paintSky: [[0.05, 0.27, 0.60], [0.14, 0.42, 0.68], [0.62, 0.72, 0.74]],
      // The real style's sky at noon, and its share of the exposure, of the sky's light and of the haze.
      realSky: [[0.08, 0.21, 0.52], [0.16, 0.31, 0.59], [0.68, 0.66, 0.62]], realExpose: 0.43, realLight: 0.8, realFog: 0.6,
      // The baked clouds (render/clouds.js): the set, and the paint of a heap's lit top, middle, shaded side and underside, linear RGB.
      cloudSet: 'few', cloudPaint: [[1.26, 1.20, 1.08], [0.70, 0.74, 0.80], [0.46, 0.52, 0.64], [0.38, 0.44, 0.58]],
      // Its other skies (SKIES): where this world's golden and grey differ from SKY_RECIPE's, { golden: {...}, grey: {...} }.
      skies: {},
    },
  },
  {
    // Blue hour: the sun gone down behind the haze, the sky deep blue over a
    // warm band at the horizon, and the towers lit window by window.
    id: 'city',
    name: '城市',
    make: makeCity,
    flora: 'broadleaf',
    // After rain: a wet road with water in the low places.
    wet: 0.6,
    sound: { air: [150, 0.7, 0.05], swell: [13, 0.2], drone: [55, 0.008] },
    // Dust in the light of the lamps.
    motes: { maxPx: 2.4, density: 0.04, size: 0.035, rise: 0.05, current: 0.3, sway: 0.6, flicker: 0.4, glow: 0.5, color: 0xffd9b0 },
    ground: {
      grassLow: 0x56604a, grassHigh: 0x5f6352, rock: 0x7b7974, rockDark: 0x4b4a47, scree: 0x86837c,
      snow: 0xf3f6fa, gravel: 0x5d5c58, fill: 0x5a5d4c, forestFloor: 0x34352b, canopy: 0x27331f, sand: 0x8f8a80,
    },
    params: { snowLine: 1e5, treeLine: 1e5, water: null, vegetated: 0.45, shore: 0, strata: 0.15, elevated: 12 },
    look: {
      pixel: {
        ramps: [[28, 0.16, 0.28, 0.46, 0.66], [62, 0.09, 0.42, 0.6, 0.78], [85, 0.1, 0.62, 0.78, 0.9], [274, 0.07, 0.2, 0.3, 0.42], [302, 0.11, 0.36, 0.47, 0.58], [118, 0.05, 0.24, 0.32, 0.44]],
        grey: [280, 0.015, 0.12, 0.22, 0.34, 0.5, 0.7, 0.9],
      },
      sunColor: 0xff9a62, sunIntensity: 0.9, zenith: 0x0d1830, horizon: 0x7e6260, ground: 0x1e1d21,
      glow: 0xff8a50, clouds: 0.22, fogDensity: 0.00016, fogBase: 0, fogFalloff: 420,
      skyLight: 0x4a5a80, groundLight: 0x2a2622, hemiIntensity: 0.3, envIntensity: 0.6, exposure: 2.0,
      // The painted style's night: the sky in three bands (zenith, middle, horizon,
      // linear RGB) and the heights the glow and the deep blue reach to, the stars
      // that are left, and what the paints do (render/worldlook.js, dusk).
      paintSky: [[0.03, 0.04, 0.16], [0.14, 0.07, 0.24], [0.58, 0.26, 0.12]],
      paintShape: [0.07, 0.21, 0.010],
      paintStars: 110,
      dusk: { shade: [0.05, 0.06, 0.14], lit: [1.4, 0.95, 0.65], level: 1, own: [1.05, 0.95, 0.85], line: [1, 0.9, 0.75] },
    },
    // The expressway is lit: a pole every 40 m, on alternate sides.
    lamps: { kind: 'pole', every: 40, color: 0xffd8a8, glow: 7, pool: 0.3 },
  },
  {
    // Underground: no sun, a roof of rock starred with glow-worm light, and
    // crystals glowing on the floor.
    id: 'cavern',
    name: '地底',
    make: makeCavern,
    flora: 'crystal',
    sound: { air: [240, 1.2, 0.022], swell: [17, 0.25], drone: [73, 0.014], echo: 0.35, drip: 1 },
    ground: {
      grassLow: 0x3b342d, grassHigh: 0x423a31, rock: 0x5c5249, rockDark: 0x221d1a, scree: 0x4b4139,
      snow: 0xf3f6fa, gravel: 0x35312d, fill: 0x3b352f, forestFloor: 0x2b2521, canopy: 0x2b2521, sand: 0x4b4339,
    },
    params: { snowLine: 1e5, treeLine: 1e5, water: null, vegetated: 0, shore: 0, strata: 0.9, cave: 1 },
    look: {
      pixel: {
        ramps: [[28, 0.16, 0.28, 0.46, 0.66], [240, 0.04, 0.26, 0.36, 0.5], [215, 0.06, 0.42, 0.55, 0.68], [185, 0.1, 0.5, 0.64, 0.78], [350, 0.14, 0.4, 0.56, 0.72], [60, 0.1, 0.55, 0.72, 0.88]],
        grey: [250, 0.012, 0.1, 0.22, 0.34, 0.5, 0.68, 0.92],
      },
      sunColor: 0xffb070, sunIntensity: 0.05, zenith: 0x060708, horizon: 0x2a1d14, ground: 0x0a0806,
      glow: 0x4a3018, clouds: 0, fogDensity: 0.0007, fogBase: 0, fogFalloff: 1e6,
      skyLight: 0x7a6248, groundLight: 0x2f7a82, hemiIntensity: 1.7, envIntensity: 0.35, exposure: 3.6,
      // The painted style's night: the roof is the sky here (render/ceiling.js), so
      // the three bands are what shows past its rim and across a border.
      paintSky: [[0.02, 0.05, 0.08], [0.03, 0.07, 0.11], [0.05, 0.10, 0.12]],
      paintShape: [0.06, 0.18, 0.012],
      dusk: { shade: [0.03, 0.075, 0.10], lit: [0.4, 1.0, 1.8], level: 4.5, own: [0.7, 0.9, 1.3], line: [0.8, 0.95, 1.2], figures: 1 },
    },
    // Dust hanging in the still air, catching the light now and then.
    motes: { density: 0.15, size: 0.03, rise: 0.02, current: 0.06, sway: 0.4, flicker: 0.6, glow: 0.6, color: 0xe0c89a },
    // Warm lamps down the road through the dark (torches, in the block style).
    lamps: { kind: 'pole', every: 48, color: 0xffc286, glow: 7, pool: 0.16, torch: true },
  },
  {
    // Lit from below: black basalt, rivers of lava, a sky of smoke.
    id: 'inferno',
    name: '地狱',
    make: makeInferno,
    flora: 'none',
    sound: { air: [90, 0.8, 0.09], swell: [5, 0.5], drone: [41, 0.016] },
    ground: {
      grassLow: 0x2a211d, grassHigh: 0x332822, rock: 0x3b2b25, rockDark: 0x150f0d, scree: 0x463630,
      snow: 0xf3f6fa, gravel: 0x2b2522, fill: 0x2c231f, forestFloor: 0x1a1412, canopy: 0x1a1412, sand: 0x40291d,
    },
    water: { waterDeep: 0x3a0c04, waterShallow: 0xff5a12 },
    liquid: { glow: 2.4, rough: 0.6, opacity: 1, cloud: 0, lava: 1 },
    params: { roll: 0.35, snowLine: 1e5, treeLine: 1e5, water: 0, vegetated: 0, shore: 1.0, strata: 0.6, clear: 9 },
    look: {
      pixel: {
        ramps: [[30, 0.18, 0.3, 0.48, 0.64], [18, 0.06, 0.15, 0.24, 0.34], [352, 0.125, 0.28, 0.38, 0.48], [40, 0.085, 0.5, 0.64, 0.78], [72, 0.1, 0.7, 0.82, 0.9], [20, 0.1, 0.36, 0.44, 0.54]],
        grey: [30, 0.012, 0.06, 0.14, 0.24, 0.36, 0.6, 0.9],
      },
      sunColor: 0xff6a30, sunIntensity: 0.7, zenith: 0x170603, horizon: 0x6e1c08, ground: 0x200805,
      glow: 0xff5a1c, clouds: 0.5, fogDensity: 0.00042, fogBase: 0, fogFalloff: 260,
      skyLight: 0x7a2610, groundLight: 0xff4a10, hemiIntensity: 0.6, envIntensity: 0.6, exposure: 2.1,
      // The painted style's night: the sky in three bands, the baked clouds of
      // the day worlds in the colours of the fire under them, and what the paints do.
      paintSky: [[0.14, 0.015, 0.06], [0.76, 0.06, 0.045], [1.0, 0.45, 0.12]],
      paintShape: [0.06, 0.17, 0.012],
      cloudSet: 'fair', cloudPaint: [[1.35, 0.75, 0.40], [0.85, 0.42, 0.34], [0.38, 0.14, 0.19], [0.14, 0.03, 0.07]],
      dusk: { shade: [0.10, 0.03, 0.07], lit: [3.4, 0.8, 1.0], level: 3, own: [0.45, 0.2, 0.28], line: [1, 0.55, 0.35] },
    },
    // Embers going up off the lava, flickering as they cool.
    motes: { density: 0.06, size: 0.1, rise: 1.6, current: 0.5, sway: 0.6, flicker: 0.7, glow: 6, color: 0xff6a1c },
  },
  {
    // A hundred and twenty metres under the sea: blue-green dusk, the
    // surface a bright ceiling far above, kelp standing in beds on the floor.
    id: 'abyss',
    name: '深海',
    make: makeAbyss,
    flora: 'kelp',
    sound: { air: [180, 0.9, 0.05], swell: [11, 0.3], drone: [62, 0.02], muffle: 900 },
    ground: {
      grassLow: 0x3c4b49, grassHigh: 0x44544f, rock: 0x42504f, rockDark: 0x1f2729, scree: 0x4e5b58,
      snow: 0xf3f6fa, gravel: 0x303a39, fill: 0x38443f, forestFloor: 0x2b3229, canopy: 0x3a3a22, sand: 0x5b6760,
    },
    water: { waterDeep: 0x06222e, waterShallow: 0x2a8a96 },
    liquid: { glow: 0, rough: 0.2, opacity: 0.9, cloud: 0, lava: 0 },
    params: { snowLine: 1e5, treeLine: 1e5, water: 0, vegetated: 0, shore: 0, strata: 0.3, underwater: true },
    look: {
      pixel: {
        ramps: [[28, 0.16, 0.3, 0.46, 0.66], [238, 0.08, 0.3, 0.42, 0.54], [208, 0.07, 0.4, 0.55, 0.7], [185, 0.08, 0.62, 0.76, 0.86], [145, 0.11, 0.45, 0.65, 0.85], [12, 0.14, 0.42, 0.58, 0.72]],
        grey: [210, 0.008, 0.1, 0.24, 0.38, 0.47, 0.66, 0.92],
      },
      sunColor: 0x8fd8e6, sunIntensity: 1.2, zenith: 0x0b4258, horizon: 0x0d4a56, ground: 0x041820,
      glow: 0x46b8c6, clouds: 0, fogDensity: 0.0022, fogBase: -2000, fogFalloff: 1e6,
      skyLight: 0x2c7c8c, groundLight: 0x0a2228, hemiIntensity: 0.6, envIntensity: 0.5, exposure: 2.2,
      // The painted style's night: the surface is the sky from under it
      // (render/water.js), a light teal at the top and the deep's darkest at the horizon.
      paintSky: [[0.10, 0.42, 0.50], [0.04, 0.22, 0.32], [0.02, 0.09, 0.16]],
      paintShape: [0.10, 0.24, 0.015],
      dusk: { shade: [0.02, 0.09, 0.16], lit: [0.7, 1.3, 1.5], level: 1.9, figures: 1 },
    },
    // Marine snow: flecks sinking through the water on a slow current.
    motes: { density: 1, size: 0.05, rise: -0.12, current: 0.25, sway: 0.15, flicker: 0, glow: 0.45, color: 0xcfeee8 },
    // Schools of small fish that light themselves.
    fish: { density: 1, size: 0.8, glow: 3, color: 0x5fe0ff },
  },
  {
    // 抟扶摇而上: out of the deep and above a sea of cloud, granite peaks with
    // pines standing out of it, in a light that is nearly white.
    id: 'heaven',
    name: '天堂',
    make: makeHeaven,
    flora: 'pine',
    sound: { air: [2400, 0.4, 0.018], swell: [14, 0.3], drone: [196, 0.006] },
    // Gold dust going up into the light.
    motes: { maxPx: 2.4, density: 0.14, size: 0.06, rise: 0.35, current: 0.2, sway: 1.0, flicker: 0.6, glow: 1.2, color: 0xffe2a0 },
    ground: {
      grassLow: 0x8d9868, grassHigh: 0xa09c76, rock: 0xd6d0c4, rockDark: 0x8a857c, scree: 0xc8c1b3,
      snow: 0xffffff, gravel: 0xb6b0a4, fill: 0x989878, forestFloor: 0x5a5a3a, canopy: 0x3a4a2a, sand: 0xe6e0d2,
    },
    water: { waterDeep: 0xaab2c8, waterShallow: 0xfff4e6 },
    liquid: { glow: 0.08, rough: 0.95, opacity: 1, cloud: 1, lava: 0 },
    params: { snowLine: 1e5, treeLine: 1e5, water: 0, vegetated: 0.7, shore: 0, strata: 0.4, clear: 55, swell: 30 },
    // The blades of grass (render/grass.js): how much of the open ground has them, how tall they stand (m), and how many flowers there are among them.
    grass: { amount: 0.6, height: 0.4, flowers: 0.8 },
    look: {
      pixel: {
        ramps: [[28, 0.16, 0.3, 0.46, 0.66], [88, 0.03, 0.7, 0.84, 0.93], [135, 0.06, 0.45, 0.62, 0.82], [232, 0.03, 0.6, 0.75, 0.88], [232, 0.1, 0.56, 0.72, 0.8], [190, 0.03, 0.55, 0.7, 0.86]],
        grey: [95, 0.008, 0.2, 0.34, 0.48, 0.55, 0.8, 0.95],
      },
      sunColor: 0xffe9c8, sunIntensity: 3.3, zenith: 0x2f6fc4, horizon: 0xdfe6ee, ground: 0xe6dccd,
      glow: 0xffd9a0, clouds: 0.18, fogDensity: 0.00007, fogBase: 0, fogFalloff: 700,
      skyLight: 0xc9d8ee, groundLight: 0xf2e6d2, hemiIntensity: 0.38, envIntensity: 1.0, exposure: 1.6,
      // The painted style's sky: zenith, middle and horizon, linear RGB.
      paintSky: [[0.05, 0.30, 0.68], [0.14, 0.46, 0.78], [0.56, 0.78, 0.90]],
      // The real style's sky at noon, and its share of the exposure, of the sky's light and of the haze.
      realSky: [[0.10, 0.23, 0.54], [0.17, 0.33, 0.64], [0.62, 0.72, 0.86]], realExpose: 0.5, realLight: 0.84,
      cloudSet: 'towers',
      // Its other skies (SKIES): where this world's golden and grey differ from SKY_RECIPE's, { golden: {...}, grey: {...} }.
      skies: {},
    },
  },
  {
    // Black sky, the stars out in daylight, the cloud sea three hundred
    // metres down, and a planet over the horizon. The road floats.
    id: 'space',
    name: '太空',
    make: makeSpace,
    flora: 'none',
    sound: { air: [3000, 0.5, 0.004], drone: [98, 0.008], muffle: 2500 },
    // Ice and star-dust, hardly moving, glinting.
    motes: { maxPx: 2.4, density: 0.12, size: 0.045, rise: 0, current: 0.1, sway: 0.2, flicker: 0.8, glow: 1.0, color: 0xcfe0ff },
    ground: {
      grassLow: 0x3a3c40, grassHigh: 0x3a3c40, rock: 0x55575c, rockDark: 0x2a2b2e, scree: 0x4a4c50,
      snow: 0xffffff, gravel: 0x3a3c40, fill: 0x3a3c40, forestFloor: 0x2a2b2e, canopy: 0x2a2b2e, sand: 0x55575c,
    },
    water: { waterDeep: 0x6e7e9c, waterShallow: 0xdfe6f2 },
    liquid: { glow: 0.06, rough: 0.95, opacity: 1, cloud: 1, lava: 0 },
    params: { snowLine: 1e5, treeLine: 1e5, water: 0, vegetated: 0, shore: 0, strata: 0, clear: 320, swell: 80, piers: false },
    look: {
      pixel: {
        ramps: [[28, 0.16, 0.3, 0.46, 0.66], [272, 0.075, 0.22, 0.33, 0.44], [275, 0.075, 0.5, 0.62, 0.74], [270, 0.04, 0.62, 0.78, 0.86], [285, 0.1, 0.3, 0.45, 0.58], [85, 0.1, 0.55, 0.72, 0.88]],
        grey: [272, 0.014, 0.08, 0.18, 0.3, 0.42, 0.65, 0.92],
      },
      sunColor: 0xffffff, sunIntensity: 4.2, zenith: 0x000000, horizon: 0x0b1c3c, ground: 0x05070c,
      glow: 0x141c2c, clouds: 0, fogDensity: 0.00002, fogBase: 0, fogFalloff: 3000,
      skyLight: 0x1a2236, groundLight: 0x7f8ea8, hemiIntensity: 0.28, envIntensity: 0.45, exposure: 1.7,
      stars: 1, planet: 1,
      // The painted style's night: a black that is blue, a few stars, a planet in bands.
      paintSky: [[0.012, 0.016, 0.05], [0.02, 0.03, 0.09], [0.05, 0.07, 0.18]],
      paintShape: [0.07, 0.20, 0.012],
      paintStars: 240,
      dusk: { shade: [0.06, 0.07, 0.14], lit: [1.0, 1.0, 1.1], level: 0.4, own: [0.85, 0.9, 1.15], line: [0.9, 0.95, 1.1], figures: 1 },
    },
    // A row of small lights along each parapet, every 16 m.
    lamps: { kind: 'bollard', every: 16, color: 0xcfe2ff, glow: 6 },
  },
  {
    // The other side. This world, turned over and dead: a sky of red cloud
    // with lightning in it, ash drifting through the air, trees without a
    // leaf, and things in the dark that lean toward the car. The road is wound
    // into a corkscrew on the way in, and the world is the other way up.
    id: 'upside',
    name: '颠倒',
    make: makeUpside,
    flora: 'dead',
    // The drone sinks to 34 Hz as the car stays in it (`sink`, Hz: render/upside.js `infect`).
    sound: { air: [160, 0.9, 0.07], swell: [7, 0.55], drone: [49, 0.022], sink: 34 },
    ground: {
      grassLow: 0x2b3036, grassHigh: 0x323a41, rock: 0x3a4148, rockDark: 0x121518, scree: 0x424b52,
      snow: 0xcfd8de, gravel: 0x262b30, fill: 0x30363c, forestFloor: 0x1a1d21, canopy: 0x1c2024, sand: 0x3d454b,
    },
    params: { roll: 0.4, grime: 1, snowLine: 1e5, treeLine: 1e5, water: null, vegetated: 0.5, shore: 0, strata: 0.5 },
    look: {
      pixel: {
        ramps: [[28, 0.16, 0.3, 0.46, 0.66], [335, 0.035, 0.15, 0.25, 0.36], [340, 0.115, 0.3, 0.4, 0.52], [358, 0.12, 0.38, 0.5, 0.62], [28, 0.05, 0.6, 0.72, 0.84], [311, 0.07, 0.2, 0.28, 0.38]],
        grey: [330, 0.01, 0.08, 0.16, 0.26, 0.4, 0.62, 0.9],
      },
      sunColor: 0xd0643e, sunIntensity: 0.3, zenith: 0x06080d, horizon: 0x2e2428, ground: 0x08090b,
      glow: 0x6a2e22, clouds: 0.95, fogDensity: 0.0012, fogBase: 0, fogFalloff: 350,
      skyLight: 0x48627a, groundLight: 0x4a2a26, hemiIntensity: 0.55, envIntensity: 0.45, exposure: 2.4,
      upside: 1,
      // The painted style's night: the red cloud as the day worlds' heaps in the
      // colours of the world, over bands of violet and red.
      paintSky: [[0.025, 0.008, 0.045], [0.12, 0.015, 0.10], [0.42, 0.04, 0.10]],
      paintShape: [0.10, 0.28, 0.02],
      cloudSet: 'fair', cloudPaint: [[0.92, 0.58, 0.55], [0.50, 0.12, 0.20], [0.18, 0.045, 0.12], [0.09, 0.02, 0.07]],
      dusk: { shade: [0.05, 0.03, 0.05], lit: [1.5, 0.8, 1.0], level: 6, own: [0.7, 0.45, 0.6], line: [1, 0.8, 0.8], figures: 1 },
    },
    // Ash and spores in the still air, falling the way up is here.
    motes: { density: 0.3, size: 0.07, rise: -0.35, current: 0.3, sway: 0.8, flicker: 0.3, glow: 1.4, color: 0xd9e2ea },
  },
];

export const WORLD_INDEX = Object.fromEntries(WORLDS.map((w, i) => [w.id, i]));

// --- skies -----------------------------------------------------------------------
//
// A day world has three skies: `noon`, the look it is written with, and `golden`
// and `grey`, which SKY_RECIPE makes of it and look.skies changes where the world
// asks. Which one it has goes by the lap: the first time the road comes to the
// world it is noon, the second time golden, the third grey, the fourth noon
// again (WorldMap.at says on which lap the two worlds a point is between are, and
// SkyChoice picks). A world can be held to one sky, and the address (sky=) can
// hold them all. The sun stands in the same place in every sky, because the
// shadows are baked into the tiles; what changes is its colour and strength, the
// colours of the sky, the haze and the clouds, and how much there is of a shadow.
// A night world has the one look.
//
// Besides the keys a look has, a sky may set: cloudShadow, how much of the
// shadow of a cloud there is on the land (1 as the style has it, 0 none);
// shadow, how much of a shadow there is where the sun is (1 as the sun gives it:
// the painted style takes it as how far its lit paints are from its shade
// paints); dayLight, the strength of the sun the lamps and the tunnel mouth go
// by (a sky does not light them: the sun is the world's); paintTint, { lit, shade },
// the colours the painted style's lit paints and shade paints are multiplied by (its
// paints take the light's strength and not its colour: this is where the sun's
// colour and the sky's get to them; 1 as they are drawn). A colour is written
// 0xRRGGBB (sRGB) or [r, g, b] (linear, and may be over 1).
export const SKIES = ['noon', 'golden', 'grey'];
export const SKY_INDEX = Object.fromEntries(SKIES.map((s, i) => [s, i]));

// How much golden lowers a world's exposure.
const GOLDEN_EXPOSURE = 0.7;

// What golden and grey are of a world's own look.
const SKY_RECIPE = {
  // The sun low and gold, the haze and the glow round it orange, the sky going
  // from gold at the horizon to violet-blue overhead, the clouds lit peach and
  // shaded violet; the light is less than noon's, and its shade is cool.
  golden: (l) => ({
    sunColor: [1, 0.633, 0.3],
    sunIntensity: l.sunIntensity * 0.85,
    zenith: [0.1, 0.15, 0.36],
    horizon: [0.96, 0.54, 0.24],
    glow: [1.8, 0.9, 0.4],
    skyLight: [0.52, 0.48, 0.55],
    fogDensity: l.fogDensity * 1.2,
    exposure: l.exposure * GOLDEN_EXPOSURE,
    dayLight: l.sunIntensity,
    // The real style has no sky of three colours of its own here (the sky is the
    // gradient above). It takes the world's own share of the sky's light and of the
    // haze (realLight, realFog), and of the exposure (realExpose) without the lowering
    // above: the sun, the light of the sky and the haze make the evening, and the
    // exposure is not stopped down for it as well.
    realSky: null,
    realExpose: l.realExpose === undefined ? 1 : l.realExpose / GOLDEN_EXPOSURE,
    paintSky: [[0.3, 0.22, 0.38], [0.9, 0.46, 0.22], [1, 0.7, 0.3]],
    cloudPaint: [[1.5, 1, 0.55], [0.85, 0.5, 0.4], [0.34, 0.32, 0.52], [0.26, 0.22, 0.38]],
    paintTint: { lit: [1.18, 1, 0.55], shade: [0.9, 0.9, 1.2] },
  }),
  // The sun behind cloud: a weak white light, a grey-blue sky of one tone, thick
  // haze, clouds that are the sky's own tone, and no shadows to speak of; the
  // paints are cooler and the shade of a thing is nearly as light as its light.
  grey: (l) => ({
    sunColor: [1, 1, 1],
    sunIntensity: l.sunIntensity * 0.35,
    zenith: [0.42, 0.46, 0.52],
    horizon: [0.66, 0.68, 0.7],
    glow: [0.72, 0.73, 0.75],
    clouds: 0.95,
    fogDensity: l.fogDensity * 1.8,
    exposure: l.exposure * 1.1,
    dayLight: l.sunIntensity,
    // The real style has no sky of three colours of its own here (the sky is the
    // gradient above). It takes the world's own share of the exposure, of the sky's
    // light and of the haze (realExpose, realLight, realFog), on the exposure above.
    realSky: null,
    cloudShadow: 0,
    shadow: 0.4,
    paintSky: [[0.4, 0.45, 0.52], [0.55, 0.59, 0.65], [0.7, 0.73, 0.77]],
    cloudPaint: [[0.74, 0.76, 0.79], [0.6, 0.62, 0.66], [0.5, 0.52, 0.56], [0.44, 0.46, 0.5]],
    paintTint: { lit: [0.94, 1, 1.06], shade: [0.96, 1, 1.08] },
  }),
};

// Whether a world has skies of its own: the day worlds do.
export const hasSkies = (world) => !!(world.look && world.look.skies);
const DAY = WORLDS.map(hasSkies);

// The look data of a world under a sky (one of SKIES): the world's own for noon,
// else what the recipe makes of it, then what the world says over that.
export function skyLook(look, id) {
  if (id === 'noon' || !look.skies) return look;
  const out = { ...look, ...SKY_RECIPE[id](look), ...(look.skies[id] || {}) };
  delete out.skies;
  return out;
}

// Which sky each world has: one of SKIES, as an index. `all`, the sky every day
// world is held to (-1: none is); `pins`, the sky each world is held to (-1:
// none); where there is neither, the lap's.
export class SkyChoice {
  constructor(all = -1, pins = null) {
    this.all = all;
    this.pins = new Int8Array(WORLDS.length).fill(-1);
    if (pins) this.setPins(pins);
  }

  // pins: { world id: sky id }, the worlds held; no other is. Returns whether anything changed.
  setPins(pins) {
    let changed = false;
    WORLDS.forEach((w, i) => {
      const k = DAY[i] && SKY_INDEX[pins[w.id]] !== undefined ? SKY_INDEX[pins[w.id]] : -1;
      if (k !== this.pins[i]) changed = true;
      this.pins[i] = k;
    });
    return changed;
  }

  // The sky of world w on its lap-th time (0 the first).
  of(w, lap) {
    if (!DAY[w]) return 0;
    const k = this.all >= 0 ? this.all : this.pins[w];
    return k >= 0 ? k : lap % SKIES.length;
  }
}

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
    this.loop = loopOf(opts.loop);
    this.first = WORLD_INDEX[opts.start] !== undefined ? WORLD_INDEX[opts.start] : this.loop[0];
    this.ox = 0;
    this.oz = 0;
    this.dx = 1;
    this.dz = 0;
    this.shift = 0;
    this.ready = false;
    this._t = { a: this.first, b: this.first, t: 0, u: 0, la: 0, lb: 0 };
    // The schedule: from segs[i].u on (progress, metres) the world is
    // segs[i].w; the last segs[i].blend metres before it turn the world
    // before into it. Laid out from the loop as far as anything asks, and
    // rewritten ahead when a world is asked for (ask, next, setLoop).
    // segs[i].lap is how many times the road has been in that world before
    // (0 the first time): what a day world's sky goes by (SKIES).
    this.segs = [{ u: this.first * this.len, w: this.first, blend: this.blend, asked: false, lap: 0 }];
    this.version = 0;            // bumped whenever the schedule ahead is rewritten
    this._hint = 0;
  }

  // Set by the road once it knows where it starts and which way it heads.
  // Until then everything is the first world.
  setAxis(ax, az, theta) {
    this.ox = ax;
    this.oz = az;
    this.dx = Math.cos(theta);
    this.dz = Math.sin(theta);
    this.shift = 0;
    this.shift = START_U + this.segs[0].u - this.rawU(ax, az);
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
    if (!this.ready) return START_U + this.segs[0].u;
    return Math.max(this.rawU(ax, az), this.segs[0].u);
  }

  // { a, b, t }: the world here, the one it is turning into, and how far;
  // la and lb, the laps they are on (a world's sky goes by its lap).
  at(ax, az, out = this._t) {
    const u = this.u(ax, az);
    const s = this.segs;
    if (s[s.length - 1].u <= u) this._reach(u);
    const i = this._find(u);
    const n = s[i + 1];
    out.u = u;
    out.a = s[i].w;
    out.b = n.w;
    out.t = smoothstep(n.u - n.blend, n.u, u);
    out.la = s[i].lap;
    out.lb = n.lap;
    return out;
  }

  // The world a point mostly belongs to.
  main(ax, az) {
    const w = this.at(ax, az);
    return w.t < 0.5 ? w.a : w.b;
  }

  // Whether a world that passes test(world) shows anywhere within `radius`
  // of a point: its stretch of progress, with the blend into it, overlaps
  // the progress the circle covers (the warp bends u by up to WARP_AMP either
  // way, at the centre and at the edge).
  reaches(ax, az, radius, test) {
    const u = this.u(ax, az);
    const lo = u - radius - 2 * WARP_AMP;
    const hi = u + radius + 2 * WARP_AMP;
    this._reach(hi);
    const s = this.segs;
    for (let i = this._find(Math.max(lo, s[0].u)); i < s.length - 1; i++) {
      if (s[i].u - s[i].blend >= hi) break;
      if (s[i + 1].u > lo && test(this.list[s[i].w])) return true;
    }
    return false;
  }

  // --- the schedule ---------------------------------------------------------------

  // The world that follows w in the loop. A world outside the loop (the one
  // a run starts in, say) is followed by the next loop world in the order of
  // WORLDS.
  after(w) {
    const L = this.loop;
    const j = L.indexOf(w);
    if (j >= 0) return L[(j + 1) % L.length];
    for (let d = 1; d <= this.count; d++) {
      if (L.includes((w + d) % this.count)) return (w + d) % this.count;
    }
    return w;
  }

  // A segment of world w starting at progress u, on the lap the schedule
  // before it makes it: the number of segments of w there already are.
  _seg(u, w, asked) {
    const s = this.segs;
    let lap = 0;
    for (let i = 0; i < s.length; i++) if (s[i].w === w) lap++;
    return { u, w, blend: this.blend, asked, lap };
  }

  // Lay out the loop until a segment starts beyond u.
  _reach(u) {
    const s = this.segs;
    while (s[s.length - 1].u <= u) {
      const last = s[s.length - 1];
      s.push(this._seg(last.u + this.len, this.after(last.w), false));
    }
  }

  // The segment u is in (the schedule already reaches past u).
  _find(u) {
    const s = this.segs;
    const h = this._hint;
    if (h < s.length - 1 && s[h].u <= u && u < s[h + 1].u) return h;
    if (u < s[0].u) return 0;
    let lo = 0;
    let hi = s.length - 2;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (s[m].u <= u) lo = m;
      else hi = m - 1;
    }
    this._hint = lo;
    return lo;
  }

  // The last segment that has to stay as it is when everything before
  // progress uFrom is built: the one uFrom is in, or the next one if the blend
  // into it is already under way there.
  _kept(uFrom) {
    this._reach(uFrom + 2 * this.len);
    const s = this.segs;
    const i = this._find(uFrom);
    return uFrom > s[i + 1].u - s[i + 1].blend ? i + 1 : i;
  }

  // The world the road will turn into next, once nothing before uFrom may
  // change: { w, u } of the next border that is still free to move.
  upcoming(uFrom) {
    const n = this.segs[this._kept(uFrom) + 1];
    return { w: n.w, u: n.u, asked: n.asked };
  }

  // Turn toward world w as early as allowed: the blend into it starts at
  // uFrom at the earliest, and the world before it lasts at least STAY_MIN.
  // Everything after is laid out from the loop again. Returns the border's
  // progress, or null when w is already the next border asked for.
  ask(w, uFrom) {
    const i = this._kept(uFrom);
    const s = this.segs;
    if (s[i + 1].asked && s[i + 1].w === w) return null;
    const ub = Math.max(uFrom + this.blend, s[i].u + this.blend + STAY_MIN);
    s.length = i + 1;
    s.push(this._seg(ub, w, true));
    this._hint = 0;
    this.version++;
    return ub;
  }

  // The next world in the loop, as early as allowed: brings the next border
  // forward, or, when that one was asked for already, goes one past it.
  next(uFrom) {
    const n = this.segs[this._kept(uFrom) + 1];
    return this.ask(n.asked ? this.after(n.w) : n.w, uFrom);
  }

  // A new loop. Borders not yet under way at uFrom are laid out again from it,
  // keeping a world asked for; a world left out of the loop is left as early
  // as allowed. Returns the progress from which anything changed, or null.
  setLoop(list, uFrom) {
    const loop = loopOf(list);
    if (loop.join() === this.loop.join()) return null;
    this.loop = loop;
    let i = this._kept(uFrom);
    const s = this.segs;
    if (s[i + 1].asked) i++;
    const from = s[i + 1].u - s[i + 1].blend;
    s.length = i + 1;
    this._hint = 0;
    this.version++;
    if (loop.includes(s[i].w)) return from;
    const ub = this.ask(this.after(s[i].w), uFrom);
    return ub === null ? from : Math.min(from, ub - this.blend);
  }

  // The segments that cover progress lo..hi, for the shaders: at most max of
  // them, from the one lo is in.
  window(lo, hi, max) {
    this._reach(hi);
    const s = this.segs;
    const i0 = this._find(Math.max(lo, s[0].u));
    const out = [];
    for (let i = i0; i < s.length && out.length < max; i++) {
      out.push(s[i]);
      if (s[i].u > hi) break;
    }
    return { from: i0, segs: out };
  }
}

// A loop of worlds: indices in the order of WORLDS, from ids or indices;
// every world when none is given.
function loopOf(list) {
  const ids = (list || []).map((x) => (typeof x === 'number' ? x : WORLD_INDEX[x])).filter((i) => i !== undefined);
  const set = new Set(ids);
  const out = WORLDS.map((_, i) => i).filter((i) => set.has(i));
  return out.length ? out : WORLDS.map((_, i) => i);
}

// --- the land of all the worlds ------------------------------------------------------

// The water a point would be under, or -Infinity. A world's water shows where
// its share of the blend is over a third, the same threshold the water surface
// fades in at (render/water.js), so the road keeps clear of every water drawn.
export const WATER_SHOW = 0.35;
export const WATER_CLEAR = 6.5;      // a bridge's running surface over the water
const SWELL_SCALE = 2600;            // metres between a swell's crests, roughly

export function makeWorldLand(seed, opts = {}) {
  const map = new WorldMap(opts);
  const fields = WORLDS.map((w) => w.make(seed, map));
  const water = WORLDS.map((w) => w.params.water);
  const raised = WORLDS.map((w) => w.params.elevated || 0);
  // Bridge clearance over each world's liquid, how far it swells, and
  // whether the road runs under the liquid instead (the deep sea).
  const clear = WORLDS.map((w) => (w.params.clear !== undefined ? w.params.clear : WATER_CLEAR));
  const swell = WORLDS.map((w) => w.params.swell || 0);
  const nSwell = makeSimplex(seed ^ 0x5e11a);
  const sunk = WORLDS.map((w) => !!w.params.underwater);
  // Cloud and lava hide what is under them; water does not.
  const opaque = WORLDS.map((w) => (w.liquid && (w.liquid.cloud || w.liquid.lava) ? 1 : 0));
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
    // a world that carries the road on an expressway; over water, lava or a
    // sea of cloud, bridge height (that world's clearance, rising and falling
    // with its swell), eased in across the shore so the target has no step.
    // Under the deep sea the road keeps to the floor, and across that border
    // it sinks to it.
    designAt(x, z, g) {
      map.at(x, z, tmp);
      const t = tmp.t;
      const lift = raised[tmp.a] + (raised[tmp.b] - raised[tmp.a]) * t;
      const under = (sunk[tmp.a] ? 1 - t : 0) + (sunk[tmp.b] ? t : 0);
      let ca = clear[tmp.a] + (clear[tmp.b] - clear[tmp.a]) * t;
      const sw = swell[tmp.a] + (swell[tmp.b] - swell[tmp.a]) * t;
      if (sw) ca = Math.max(WATER_CLEAR, ca + sw * fbm(nSwell, x / SWELL_SCALE, z / SWELL_SCALE, 2));
      const w = waterLevel(x, z);
      if (w === -Infinity) return g + lift;
      const above = Math.max(g + lift, w + ca * smoothstep(w + 1.5, w - 1.0, g));
      return above + (g - above) * under;
    },
    // Under water, for the route search: crossing it means a bridge. Not
    // under the deep sea, where the road runs on the floor.
    wetAt(x, z, g) {
      const w = waterLevel(x, z);
      if (w === -Infinity || g >= w + 0.5) return false;
      map.at(x, z, tmp);
      return ((sunk[tmp.a] ? 1 - tmp.t : 0) + (sunk[tmp.b] ? tmp.t : 0)) < 0.5;
    },
    // Under the surface of a liquid, for cameras: in cloud, lava or open water
    // there is nothing to see. Only the deep sea is drawn from under its
    // water, and as far into a border as its share reaches the road is
    // already sinking toward it, so under the surface there is open too.
    submerged(x, y, z) {
      const w = waterLevel(x, z);
      if (w === -Infinity || y >= w) return false;
      map.at(x, z, tmp);
      return ((sunk[tmp.a] ? 1 - tmp.t : 0) + (sunk[tmp.b] ? tmp.t : 0)) < 0.02;
    },
    // The surface of a liquid nothing shows through (cloud, lava), where it is
    // drawn at full strength (render/water.js), or -Infinity: land under it
    // need not be drawn at all.
    opaqueLevel(x, z) {
      const w = waterLevel(x, z);
      if (w === -Infinity) return -Infinity;
      map.at(x, z, tmp);
      const share = (water[tmp.a] === null ? 0 : 1 - tmp.t) + (water[tmp.b] === null ? 0 : tmp.t);
      const o = opaque[tmp.a] * (1 - tmp.t) + opaque[tmp.b] * tmp.t;
      return share >= 0.65 && o > 0.999 ? w : -Infinity;
    },
    setAxis: (ax, az, theta) => map.setAxis(ax, az, theta),
    // How likely a stretch of road is to roll here (road.js, _rollSection): the
    // two worlds' own odds, blended.
    roll(x, z) {
      map.at(x, z, tmp);
      const ra = WORLDS[tmp.a].params.roll || 0;
      const rb = WORLDS[tmp.b].params.roll || 0;
      return ra + (rb - ra) * tmp.t;
    },
    // Whether the road floats here, with no piers under it: mostly space.
    floats(x, z) {
      map.at(x, z, tmp);
      const fa = WORLDS[tmp.a].params.piers === false ? 1 - tmp.t : 0;
      const fb = WORLDS[tmp.b].params.piers === false ? tmp.t : 0;
      return fa + fb > 0.5;
    },
    // The lowest the road may run here: clear of the surface of a liquid that
    // shows, unless the deep sea is in the blend, where it goes under. The
    // design aims well above it anyway; this only stops the profile solver
    // from starting the way down to low land past a shore while still over
    // the liquid.
    floorAt(x, z) {
      const w = waterLevel(x, z);
      if (w === -Infinity) return -Infinity;
      map.at(x, z, tmp);
      if (sunk[tmp.a] || (tmp.t > 0 && sunk[tmp.b])) return -Infinity;
      return w + 1.2;
    },
    // The first world's, for whatever still reads one number.
    snowLine: alpine.snowLine,
    treeLine: alpine.treeLine,
  };
}
