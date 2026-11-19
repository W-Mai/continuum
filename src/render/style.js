// Styles of drawing: the same world drawn as it is, or the way a painter of
// animated films, an ink painter, an animator, a woodblock cutter or an old
// console would draw it.
//
// A style is one set of numbers, read in four places:
//  - the light on every lit material (patchLighting, called from
//    withAtmosphere in atmosphere.js): the sun's light in bands, the shade
//    tinted, less shine, crisper cast shadows, and what each thing is (the
//    car, an animal, a leaf, a building) marked in the frame's alpha so the
//    last pass can find it (MARK);
//  - the sky (atmosphere.js): heaped, painted clouds, towers of cumulus and
//    a deeper blue;
//  - one pass after the final grade (render/post.js, STYLE_PASS): brush
//    strokes, ink, lines, a printer's few colours, pixels, greens and the
//    distance repainted, a world of square texels;
//  - and the very last pass (render/present.js): how clean the edges are
//    drawn (aa) and how crisp the detail (sharp).
// Two things besides come and go with a style: the trees built of blocks
// (render/forest.js; blocks), and which small animals there are
// (render/critters.js): every style has the animals of a wood, the block one
// has a farm's made of boxes instead (fauna, mobs).
// A change of style moves every number from one set to the other over
// SWITCH_SECONDS, so one style turns into the next instead of cutting. With
// the real style the first three are off, and the frame is the frame as it
// was before there were styles, with its animals in it and its edges drawn
// clean.

import * as THREE from 'three';

export const SWITCH_SECONDS = 1.4;

// The colour of the sky, and of the haze, in the flash of a painted night's
// lightning (linear, as it comes out on the screen).
export const FLASH_WASH = [0.86, 0.42, 0.50];

// The wind that takes the clouds' shadows across the land, metres a second.
export const WIND = [6.5, 2.8];

export const STYLES = [
  { id: 'real', name: '写实' },
  { id: 'paint', name: '手绘' },
  { id: 'ink', name: '水墨' },
  { id: 'cel', name: '赛璐璐' },
  { id: 'print', name: '版画' },
  { id: 'pixel', name: '像素' },
  { id: 'block', name: '方块' },
];
export const STYLE_INDEX = Object.fromEntries(STYLES.map((s, i) => [s.id, i]));

// What a pixel is, marked in the scene's alpha for a style's last pass, by a
// style that marks (mark): a material picks its mark with userData.mark =
// MARK.leaf, and writes it only when it draws without blending (an alpha a
// blended material wrote would change how it blends). Nothing marked is 1:
// the land, the road, the sky. The car is marked part by part, 0.02 apart
// (render/presentation.js, by the model's material names); its glass is not:
// it shows what is behind it. The liquids are drawn blended, and have no
// mark.
export const MARK = {
  leaf: 0.92,     // leaves and grass, and what else lies about the ground
  flower: 0.945,  // the grass's flowers: in the leaves' range, and left unpainted by the strokes (they are a few pixels across)
  built: 0.8,     // buildings, and the structures by the road
  trim: 0.58,     // the car: its trim
  lamp: 0.54,     // its lamps
  body: 0.5,      // its body (and what is inside it)
  wheel: 0.46,    // its wheels
  life: 0.3,      // the animals, the other cars, the Upside Down's roots
};

// The ranges a mark is read in: [from, to), a pixel's alpha at least from
// and under to. The whole car is one range; a blended thing drawn over a
// mark only ever raises it.
export const MARK_RANGE = {
  life: [0, 0.38],
  car: [0.38, 0.62],
  built: [0.77, 0.83],
  leaf: [0.89, 0.95],
};

// How much grass there is where the lens is (0 to 1, render/grass.js): the flowers
// the last pass lays on the ground give way to the grass's own.
export const grassHere = { value: 0 };

// The same, for a shader: markLife(a), markCar(a), markBuilt(a), markLeaf(a).
const MARK_GLSL = Object.entries(MARK_RANGE).map(([k, [lo, hi]]) =>
  `float mark${k[0].toUpperCase()}${k.slice(1)}(float a) { return step(${lo.toFixed(2)}, a) * (1.0 - step(${hi.toFixed(2)}, a)); }`)
  .join('\n    ');

// Everything off: the world as it is.
const BASE = {
  // Light (materials). lit: how far the sun's light is banded; rampAt: the
  // two band edges in the cosine of the sun's angle and their softness;
  // rampLv: the light in the dark, middle and lit band; sunTint: the sun's
  // light on the lit side, tinted; shade: the sky's light where the sun does
  // not reach, tinted, and shadeEnv: the environment's share of it; spec:
  // shine kept; shadow: how crisp a cast shadow's edge is; mark: what each
  // thing is marked in the alpha (MARK); albedoLift: the darkest greys
  // painted lighter; cloudShade: how dark the shadow of a cloud drifting over
  // the land is; clump: leaves lit as round clumps, each its own ball of light.
  lit: 0, rampAt: [0.2, 0.55, 0.06], rampLv: [0, 0.6, 1], sunTint: [1, 1, 1], shade: [1, 1, 1], shadeEnv: [1, 1, 1],
  spec: 1, shadow: 0, mark: 0, albedoLift: 0, cloudShade: 0, clump: 0,
  // pair (0 to 1): each thing has a lit paint and a shade paint of its own
  // (stylePair), the sun's share of a pixel (0 to 1) choosing between them,
  // the world's light only the level they are laid at; the sky's light and
  // the bands of lit and shade above are what it was where pair is 0. A
  // style that keeps other numbers in some worlds (a night's, the deep's,
  // space's: the ones with no painted sky, see paintedSky) lists what its
  // numbers are there in night: a preset's night holds only the numbers that
  // differ, and Style takes each number between night's and its own by how
  // much of a painted sky the world has.
  pair: 0,
  // Life: fauna, the small animals of a wood (birds, butterflies, deer,
  // rabbits, foxes, a cat), mobs, a block world's animals in their place;
  // blocks: the trees built of blocks; drift: wind drawn across the air in
  // long pale lines, and petals falling on it (render/drift.js).
  fauna: 1, mobs: 0, blocks: 0, drift: 0,
  // Sky and air: cumulus, a layer of heaps overhead and banks on the
  // horizon, skyPaint: fewer of them, whiter, with a darker shaded side,
  // and only in a day's sky; towers, cumulus standing on the horizon (a
  // day's sky only); deep: the blue deeper overhead; blue: a deep, full
  // blue coming down close to the horizon, and skySat: fuller all over (a
  // day's sky only, and not in the light the sky sheds); blockSky: a square
  // sun and square clouds, by day; fog: the haze, thinned; heaps: the clouds
  // baked into a cube map (render/clouds.js) laid over a day's sky, in
  // heapsTones colours (4: lit, middle, shade, underside; 3 flat ones; 2).
  // A sky that is not a day's keeps the clouds it was drawn with (night).
  cumulus: 0, skyPaint: 0, towers: 0, deep: 0, blue: 0, skySat: 0, blockSky: 0, fog: 1,
  heaps: 0, heapsTones: 4,
  // The clouds the sky's light is worked out with (a style with baked clouds
  // keeps the light of a sky with these: a cloud worked out for every pixel).
  lightCumulus: 0, lightPaint: 0, lightTowers: 0,
  // Exposure and tone: expose, the style's own exposure on the world's;
  // curve (0 to 1), the painter's curve for ACES: straight up to 0.62, so
  // the colours of a palette are the colours on the screen, and a white
  // pressed toward 1 rather than burnt; skyCol: a day's sky in the three
  // colours its world gives it (paintSky), not as the light would make it.
  // The exposure and the curve are for a world whose sky is painted so
  // (paintedSky): in one that is not (a night's, the inferno, the deep,
  // space) the frame is exposed and toned as it was (see night, below).
  expose: 1, curve: 0, skyCol: 0,
  // nightSky: how much the numbers of a world with a painted night's sky are
  // those of a day's (paintedNight), not of its night.
  nightSky: 0,
  // The last pass. paint: brush strokes (a Kuwahara filter in eight round
  // sectors, on a 5 by 5 grid), stroke: the grid's step in pixels at a
  // height of 1080 (a little shorter far off, and not laid on the sky, the
  // car and the animals, or what is flat already); flat: flat colour (a blur that keeps to
  // one surface), flatR: its reach; line: lines at edges, lineW px wide,
  // where the depth jumps (between jump[0] and jump[1] of it) or its slope
  // breaks (crease), only on the car with lineCar, in lineCol or the colour
  // under them darkened (lineDark), fading out by lineFar metres, broken
  // like a dry brush with brush; lineFig: a line drawn where the marks of a
  // figure (the car, the animals) change, round it and between its parts,
  // read from the alpha (a part covered by a thing in front is not outlined),
  // the depth's own lines kept at half for its creases; ridge: where the land
  // meets the sky, a line however far; ink: an ink wash in five tones on
  // paper, keep: the car keeps its colour; blank: the sky left as paper;
  // poster: brightness cut to levels; print: the shadows printed in indigo
  // and the lights left as paper, bokashi: the sky printed as a band of
  // indigo fading into the paper; pixel: blocks, rows of them down the
  // screen; dither: a console's
  // palette, dithered by ditherK; far: the distance turning blue in the last
  // pass (under a day's sky only); farPaint: the far land drawn in flat faces
  // and the air between laid in layers, in the materials (render/terrain.js,
  // atmosphere.js; in a world with a painted sky only: where it is 0 far
  // takes its place); lift: midtones raised; dark: the darkest greens a deep
  // blue-green, never black; green: greens warmer in the light and cooler
  // in the shade; greenPal: greens repainted from three, greenShade,
  // greenMid and greenLit, each at the brightness it was; satDark: the
  // saturation spared on the darkest tones; block: the world in blocks, the
  // picture taken at the middle of square texels laid on every face of the
  // world (a texel is blockK of its distance, in whole powers of two of a
  // metre, so about the same number of pixels across at any distance), each
  // with its own small variation (blockJit) and each face shaded by the way
  // it faces (blockFace); meadow: patches of lighter and darker, yellower and
  // bluer green laid on grass, and flowers: flowers in drifts close by, both
  // on the world; glow: a soft glow round what is bright.
  // Nothing in it is fixed to the screen but the pixel blocks' dither: a
  // grain laid on the screen stays put while the world moves under it, and
  // reads as dirt on the lens. The blocks are laid on the world, not on the
  // screen: they move with it.
  paint: 0, stroke: 1, flat: 0, flatR: 1.5,
  line: 0, lineW: 1, jump: [0.04, 0.12], crease: 0.8, lineCar: 0, lineCol: [0.1, 0.09, 0.08], lineDark: 0, lineFar: 600,
  lineFig: 0,
  brush: 0, ridge: 0,
  ink: 0, keep: 0, blank: 0, poster: 0, levels: 6, print: 0, bokashi: 0,
  pixel: 0, rows: 200, dither: 0, ditherK: 0.85,
  block: 0, blockK: 0.012, blockJit: 0.14, blockFace: 0.55, meadow: 0, flowers: 0, glow: 0,
  far: 0, farPaint: 0, lift: 0, dark: 0, green: 0,
  greenPal: 0, greenShade: [0.16, 0.42, 0.42], greenMid: [0.3, 0.6, 0.25], greenLit: [0.56, 0.78, 0.36],
  sat: 1, satDark: 0, contrast: 1, warm: 0, vignette: 0, paper: [0.95, 0.93, 0.88], inkCol: [0.1, 0.09, 0.085],
  // The last of all (render/present.js). aa: edges drawn clean, by an edge
  // search along each (FXAA); 0 leaves the stairs as they are, as a style of
  // hard blocks wants them. sharp: the detail between the edges made crisper
  // (CAS), the room a colour has before it clips taken into account.
  aa: 1, sharp: 0.2,
};

const PRESETS = {
  real: {},
  // After the painted backgrounds of hand-drawn animated films: a deep,
  // full blue sky with towers of white cumulus on the horizon, clear air
  // with the distance turning blue, a warm sun, shade light and blue-grey
  // rather than dark, no black (the asphalt laid on a little lighter),
  // greens from a painter's three (blue-green, emerald, a fresh yellow-
  // green), crisp shapes of light and shadow, everything laid on in round
  // gouache strokes; only the car is inked, as a character on a painted
  // ground is.
  paint: {
    lit: 0.9, rampAt: [0.02, 0.12, 0.05], rampLv: [0, 0.5, 1], sunTint: [1.04, 1.0, 0.92], pair: 1,
    shade: [1, 1, 1], shadeEnv: [1, 1, 1], spec: 0.3, shadow: 1, mark: 1, albedoLift: 0.06,
    cloudShade: 0.5, clump: 1, drift: 1,
    cumulus: 0, skyPaint: 1, towers: 0, heaps: 1, lightCumulus: 1, lightPaint: 1, lightTowers: 1, blue: 0.85, skySat: 0.7, fog: 0.25,
    paint: 1, stroke: 3.0, line: 1, lineW: 1.4, lineCar: 1, lineCol: [0.17, 0.12, 0.1], lineDark: 0.55, lineFar: 300, lineFig: 1,
    far: 0, farPaint: 1, lift: 0, dark: 0, greenPal: 0, meadow: 1, flowers: 1, glow: 0.3,
    expose: 0.85, curve: 1, skyCol: 1, nightSky: 1,
    // The worlds with no painted sky (the nights, the inferno, the deep,
    // space, the Upside Down) keep the light of one colour lit more or less:
    // the bands and the sky's tint of light, the greens repainted in the
    // last pass, the exposure, the curve, the glow and the lift.
    night: {
      pair: 0, rampAt: [0.04, 0.3, 0.06], rampLv: [0, 0.82, 1], shade: [1.0, 1.05, 1.3], shadeEnv: [1.8, 1.7, 1.55],
      shadow: 0.9, dark: 0.55, greenPal: 0.7, green: 0, glow: 0.8, lift: 0.08, expose: 1, curve: 0,
      cumulus: 1, towers: 1, heaps: 0, far: 1, farPaint: 0,
    },
    greenMid: [0.27, 0.57, 0.24], greenLit: [0.5, 0.74, 0.33],
    sat: 1.12, satDark: 1, contrast: 1.06, sharp: 0.15,
  },
  // Ink on paper: five tones of ink (焦 浓 重 淡 清) and the paper, sky and
  // haze left blank, near things and every ridge against the sky drawn with
  // a brush that runs dry, the forest far off only dabs of ink; the car's
  // orange the only colour on the page.
  ink: {
    mark: 1, flat: 1, flatR: 2.4, line: 1, lineW: 1.6, jump: [0.1, 0.3], crease: 0.25, lineFar: 700, ridge: 1,
    brush: 1, lineCol: [0.07, 0.065, 0.06],
    ink: 1, keep: 1, blank: 1, paper: [0.95, 0.92, 0.85], inkCol: [0.075, 0.07, 0.065], vignette: 0.16,
    sharp: 0,
  },
  // Cel animation: two hard tones and a highlight, flat colour, dark lines
  // in the colour of what they outline, a deep sky with heaped clouds.
  cel: {
    lit: 1, rampAt: [0.2, 0.8, 0.012], rampLv: [0, 0.82, 1], shade: [0.8, 0.88, 1.24], spec: 0.25, shadow: 1,
    cumulus: 0, heaps: 1, heapsTones: 2, lightCumulus: 1, deep: 0.85,
    night: { cumulus: 1, heaps: 0 },
    flat: 1, flatR: 2, line: 1, lineW: 1.3, lineDark: 0.82, lineFar: 1800, ridge: 0.8,
    sat: 1.25, contrast: 1.05, poster: 0.35, levels: 6, green: 0.3, sharp: 0,
  },
  // A woodblock print: a few flat colours, the shadows in indigo and the
  // lights left as paper, the sky a band of indigo fading into the paper
  // (bokashi), black key lines, cream paper.
  print: {
    lit: 0.6, rampAt: [0.12, 0.5, 0.03], rampLv: [0, 0.7, 1], shade: [0.9, 0.93, 1.08], spec: 0.2, shadow: 0.8,
    flat: 1, flatR: 2.2, line: 1, lineW: 1.4, jump: [0.06, 0.18], crease: 0.5, lineCol: [0.1, 0.09, 0.085], lineFar: 1500, ridge: 1,
    poster: 1, levels: 4, print: 1, bokashi: 1, lift: 0.24, sat: 1.08, contrast: 1.0, paper: [0.95, 0.91, 0.81], vignette: 0.1,
    heaps: 1, heapsTones: 3, night: { heaps: 0 },
    aa: 0.8, sharp: 0,
  },
  // An old console: 180 rows of blocks, eight levels a channel, ordered
  // dithering.
  pixel: { pixel: 1, rows: 180, dither: 1, ditherK: 0.45, levels: 8, sat: 1.18, contrast: 1.06, aa: 0, sharp: 0 },
  // A world of blocks: every face of the land and the trees laid with square
  // texels that stay where they are on the world, each shaded by the way it
  // faces; hard light and shade, no shine, a plain light-blue sky with a
  // square sun and square white clouds, trees built of blocks, and a
  // farm's animals built of boxes.
  block: {
    lit: 1, rampAt: [0.08, 0.5, 0.01], rampLv: [0, 0.78, 1], sunTint: [1.02, 1.0, 0.94],
    shade: [1.0, 1.02, 1.1], shadeEnv: [1.5, 1.5, 1.45], spec: 0, shadow: 1, albedoLift: 0.06,
    // Blue-green sky: pale at the horizon, a full light blue above. The clouds below are few.
    fauna: 0, mobs: 1, blocks: 1, blockSky: 1, blue: 0.85, skySat: 0.7, fog: 0.5,
    block: 1, poster: 0.5, levels: 10, lift: 0.04,
    greenPal: 0.8, greenShade: [0.14, 0.34, 0.12], greenMid: [0.3, 0.58, 0.2], greenLit: [0.48, 0.74, 0.28],
    sat: 1.25, satDark: 1, contrast: 1.02, aa: 0, sharp: 0,
  },
};

const clone = (o) => JSON.parse(JSON.stringify(o));

// Between a number of a style in the dark and its own, k of the way (0 at
// night, 1 under a painted sky): the ends are what they are, to the bit.
const mixNight = (dark, day, k) => (dark === day || k >= 1 ? day : k <= 0 ? dark : dark * (1 - k) + day * k);

// out = a + (b - a) * k, number by number (the numbers of night as well).
function blend(out, a, b, k) {
  for (const key of Object.keys(b)) {
    if (Array.isArray(b[key])) {
      for (let i = 0; i < b[key].length; i++) out[key][i] = a[key][i] + (b[key][i] - a[key][i]) * k;
    } else if (typeof b[key] === 'object') {
      blend(out[key], a[key], b[key], k);
    } else {
      out[key] = a[key] + (b[key] - a[key]) * k;
    }
  }
}

// The numbers any style gives a world with no painted sky of its own.
const NIGHT_KEYS = [...new Set(Object.values(PRESETS).flatMap((p) => Object.keys(p.night || {})))];

// A style's numbers: the base, the preset on it, and night: every one of
// NIGHT_KEYS with its value in a world with no painted sky (the style's own
// where its preset does not say).
export const styleParams = (id) => {
  const p = { ...clone(BASE), ...clone(PRESETS[id] || {}) };
  const night = (PRESETS[id] && PRESETS[id].night) || {};
  p.night = {};
  for (const k of NIGHT_KEYS) p.night[k] = clone(night[k] !== undefined ? night[k] : p[k]);
  return p;
};

// The lit materials' share of a style (atmosphere.js assigns these to every
// material it hooks).
export const styleU = {
  uStyleLit: { value: 0 },
  uRampAt: { value: new THREE.Vector3(0.2, 0.55, 0.06) },
  uRampLv: { value: new THREE.Vector3(0, 0.6, 1) },
  uSunTint: { value: new THREE.Vector3(1, 1, 1) },
  uShadeTint: { value: new THREE.Vector3(1, 1, 1) },
  uShadeEnv: { value: new THREE.Vector3(1, 1, 1) },
  // The same five as they were before the paired paints, and a pair that is 0:
  // withAtmosphere binds them to what is marked as life or as the car, which
  // keeps the light it had.
  uPairOff: { value: 0 },
  uRampAtL: { value: new THREE.Vector3(0.2, 0.55, 0.06) },
  uRampLvL: { value: new THREE.Vector3(0, 0.6, 1) },
  uShadeTintL: { value: new THREE.Vector3(1, 1, 1) },
  uShadeEnvL: { value: new THREE.Vector3(1, 1, 1) },
  uShadowKL: { value: 0 },
  uSpecK: { value: 1 },
  uShadowK: { value: 0 },
  uStyleMark: { value: 0 },
  uAlbedoLift: { value: 0 },
  // The shadow of a cloud: how dark, where the wind has taken it, the sun's
  // direction (world), and the floating origin (absolute metres: low
  // frequencies do not mind the digits).
  uCloudShade: { value: 0 },
  uCloudDrift: { value: new THREE.Vector2() },
  uSunDirW: { value: new THREE.Vector3(0, 1, 0) },
  uOriginAbs: { value: new THREE.Vector3() },
  uClump: { value: 0 },
  // The paired paints (pair): how far they are what a pixel is, and the sun's
  // light in the units the sky's is in (atmosphere.js sets it with each
  // frame's light), for the share of the sun a pixel has.
  uPair: { value: 0 },
  // How far the air is the painted style's (farPaint), and the tone it
  // thins toward: the world's painted horizon, over the exposure it is drawn
  // under, as the sky is (uPaintInv is the sky's own).
  uAir: { value: 0 },
  uAirH: { value: new THREE.Vector3(0.4, 0.7, 0.85) },
  // The colour the haze is for as long as a painted night's flash is bright, and how much of it.
  uAirFlash: { value: new THREE.Vector4(...FLASH_WASH, 0) },
  uPairSun: { value: 1 },
  uPairInvSun: { value: 1 },
  uSunDirV: { value: new THREE.Vector3(0, 1, 0) },
  // The paired paints in a world lit by night (the dusk of its look,
  // render/worldlook.js): the colour its dark sides are pulled to and (w) how
  // much of the world is one lit by night (0: none, 1: all), the tint its lit
  // sides are laid in and the level (w) they are laid at.
  uDuskDark: { value: new THREE.Vector4(0, 0, 0, 0) },
  uDuskLit: { value: new THREE.Vector4(1, 1, 1, 1) },
  // The tint of the paints that materials give themselves (the road's), and
  // of the lines painted on it, in such a world: laid by those materials.
  uDuskOwn: { value: new THREE.Vector3(1, 1, 1) },
  uDuskLine: { value: new THREE.Vector3(1, 1, 1) },
  // How much of their paints the figures have in such a world (0 none, 1 all).
  uDuskFig: { value: 0 },
};

// The floating origin modulo 1024 m, worked out in double precision: the
// blocks' texels are hashed by where they are in a 1 km square that repeats,
// so a texel keeps its picture when the origin moves, and the digits stay
// few enough for a texel a sixteenth of a metre across.
export const originMod = { value: new THREE.Vector3() };

// The sky's (atmosphere.js's sky material).
export const skyStyle = {
  uCumulus: { value: 0 },
  uSkyPaint: { value: 0 },
  uSkyDeep: { value: 0 },
  uSkyBlue: { value: 0 },
  uSkySat: { value: 0 },
  uTowers: { value: 0 },
  uHeaps: { value: 0 },
  uHeapsTones: { value: 4 },
  uBlockSky: { value: 0 },
  // A day's sky in three colours of its own (the world's paintSky, mixed
  // across a border in uPaint*): how far the style paints it (skyCol), and
  // the inverse of the exposure the sky is drawn under.
  uSkyCol: { value: 0 },
  uPaintInv: { value: 1 },
};

styleU.uPaintInv = skyStyle.uPaintInv;

// How much of a day's sky the world has (1 by day, 0 for a night, the
// inferno's or space's): set by atmosphere.js with each change of light.
export const skyDay = { value: 1 };

// The clouds the sky's light is worked out with (a style's lightCumulus,
// lightPaint, lightTowers), for atmosphere.js.
export const skyLight = { cumulus: 0, skyPaint: 0, towers: 0 };

// How much the world's sky is one a style paints in colours of its own (1
// in a world that gives a paintSky, 0 in one that does not: the nights, the
// inferno, the deep, space, the Upside Down; between, across a border).
// A style's exposure, tone curve and glow by day go by this.
export const paintedSky = { value: 0 };

// How much of the world's painted sky is a night's (a world that gives its sky
// as bands, render/atmosphere.js's uPaintShape): the city's, the inferno's. A
// style takes such a world's numbers as a day's when it says so (nightSky, 1:
// the painted style, whose paired paints are laid for the night too); one that
// does not goes on keeping the numbers of its night there, as it did before the
// world had a painted sky.
export const paintedNight = { value: 0 };

// Whether the lit materials' programs are the ones that have the paired paints
// in them (a style with a pair is drawn: the code of the pair, for styles with
// no pair, is a cost they would pay for nothing). When it changes, the
// listeners (atmosphere.js) have the materials compiled again.
export const pairProgram = { on: false, listeners: [] };

// The paired paints (pair). Each thing is given a lit paint and a shade
// paint worked out from its albedo, as a painter mixes two colours for a
// thing, not as one colour more or less lit. The lit one is the albedo. The
// shade: the greens and the yellow-greens turned toward blue, by more on
// what is marked as leaves than on the land and the road, a little fuller,
// and darker; a grey is not turned, it is made a little blue. The turn is a
// rotation about the grey axis of the colour's RGB (Rodrigues), by an angle
// that is a constant of the material (a leaf's or not), not a trip through
// HSV and not a hue read off the colour: the weight is how green it is.
const PAIR = {
  shadeTurn: 24,         // degrees, toward blue, for a green or a yellow-green
  litShare: 0.6,         // how much of that turn the lit paint of a green takes, on the land and the small things on it: their albedo is a yellower green than a painted meadow (the reference's is 132 to 139 degrees; with none of the turn the hills' was 124, with this 131). A tree's lit paint takes none
  treeTurn: 54,          // the same for a tree (leaves in clumps, styleClump): its shade is bluer than a hill's
  shadeL: 0.58,          // the shade's brightness on the lit one's
  shadeSat: 1.08,
  tree: { lit: 1.15, shadeL: 0.82, shadeSat: 0.72, floor: 0.040 },   // a tree is laid brighter in the light, and its shade is lighter and less full than the land's (the reference's trees: a soft blue-green, not a dark teal), with a floor of its own
  shadeFloor: 0.036,     // the shade at darkest of a small thing marked as leaves (MARK.leaf: a bush, a tuft of grass, a flower); the land's and the road's go as dark as their albedo
  grey: [0.86, 0.93, 1.08],
  duskPull: 0.8,         // how far a world lit by night pulls the colour of a dark side to the colour of its own dark (render/worldlook.js, dusk)
  step: [0.3, 0.7],      // where the sun's share goes from the shade paint to the lit one (a share short of 1 in a sun's light is the shadow map's soft edge and the bake's)
  level: 1,              // the level the two are laid at, on the light's
};
const f6 = (x) => x.toFixed(6);
const cosd = (d) => Math.cos(d * Math.PI / 180);
const sind = (d) => Math.sin(d * Math.PI / 180);

// The figures: the car, the other cars and the animals (what is marked under
// 0.62), in the painted style. A figure is flat paints and a line: two for an
// animal or another car (a lit paint and a shade paint, worked out from its
// colour), three for the car, which gives its own (userData.paints: lit,
// shade, deep) and chooses between them by where the light falls on a pixel:
// the lit paint where the normal faces the sun and the sun's light gets
// through (the shadow map's edge cut hard, a cloud's shadow taking its share,
// as the land's does), the deep paint on what faces down and where the model's
// occlusion is over a half (the wheel arches, the underside), the shade paint
// everywhere else. The paint has one highlight (a shape, where the normal is
// near the half vector between the sun and the lens, on what faces up) and the
// glass two stripes. No shine of the physical model is left: the reflection of
// the sky, the clear coat.
const FIG = {
  litAt: [0.0, 0.012], litBias: 0.05,   // the lit paint where N.L + litBias passes this
  shareAt: [0.35, 0.6],                 // and the sun's share of the pixel (shadow, ridges) passes this
  downAt: [-0.23, -0.17],               // the deep paint where the normal's y is under this: it faces down
  occAt: [0.46, 0.54],                  // and where the model's occlusion passes this
  hlAt: [0.915, 0.925], hlK: 2.0,       // the paint's highlight: N.H over 0.92, the lit paint this much lighter
  hlUp: [0.25, 0.4],                    // and only on what faces up: the normal's y passes this
  peak: 0.95,                           // no figure is brighter than this (luminance, in the scene's light before the exposure): under the bloom's threshold, 1.04, or a white van glows over the road and the tyres beside it
  // The glass's stripes: lines at this angle to the horizontal on the screen
  // (degrees), at these places across the glass (shares of its height, glassH
  // metres, from its centre) and this wide (shares of its height, never under a
  // few pixels), in this paint and this much of it. They are laid on the glass
  // where it is in the view, so they slide over it as the view turns.
  glassH: 0.292, stripeAngle: 58, stripeAt: [0.0, 0.30], stripeW: [0.06, 0.02], stripePx: [2.4, 1.2], stripeCol: [0.36, 0.42, 0.48], stripeK: 0.85,
  // The shade of an animal's or another car's colour: its brightness on the
  // lit one's, how far it is turned toward violet (degrees: back for the warm
  // colours, which go toward magenta; on for the greens, which go toward blue).
  shadeL: 0.52, turnWarm: 22, turnGreen: 28, grey: [0.86, 0.9, 1.1],
};

// The lines round a figure and between its parts (STYLE_PASS, figureInk): the
// least change of mark that counts and the change that is the whole line, how
// much nearer than a figure a thing that is not one has to be to cover it, the
// colour of the ink (one colour over every colour: it is the line of the
// drawing, not a darker part of what it is laid on), and how much of the depth's
// own crease line is kept beside it.
const FIG_INK = { at: [0.008, 0.022], front: 1.02, col: [0.2, 0.1, 0.12], crease: 0.5 };
// The numbers of a material's paints, for its uniforms (withAtmosphere): [the lit
// paint's brightness on the albedo, the shade paint's, how full it is, its
// floor] and [the cosine and the sine of the turn, the share of it the lit
// paint takes]. A tree is turned further, laid brighter in the light, lighter
// and less full in the shade, and its lit paint is not turned. The small
// things marked as leaves are turned as the land they stand on is, and keep a
// floor: turned as far as a tree, a bush in the shade was a teal clump on
// green grass, 40 to 65 degrees of hue from it and lighter than it.
export function pairParams(leaf, tree) {
  const t = tree ? PAIR.tree : null;
  const turn = tree ? PAIR.treeTurn : PAIR.shadeTurn;
  return {
    p: [t ? t.lit : 1, t ? t.shadeL : PAIR.shadeL, t ? t.shadeSat : PAIR.shadeSat, t ? t.floor : (leaf ? PAIR.shadeFloor : 0)],
    t: [cosd(turn), sind(turn), t ? 0 : PAIR.litShare],
  };
}
export const STYLE_PAIR_GLSL = `
uniform vec4 uPairP;
uniform vec3 uPairT;
vec3 styleTurn( vec3 a, float c, float s ) {
  vec3 cr = vec3( a.b - a.g, a.r - a.b, a.g - a.r ) * 0.57735027;
  return max( a * c + cr * s + vec3( ( a.r + a.g + a.b ) * 0.33333333 ) * ( 1.0 - c ), 0.0 );
}
// How much lighter than the land's own the shade paint is laid (a wood's is).
float stShadeK = 1.0;
void stylePair( const in vec3 a, out vec3 lit, out vec3 shade ) {
  const vec3 lw = vec3( 0.2126, 0.7152, 0.0722 );
  float mx = max( a.r, max( a.g, a.b ) );
  float lm = dot( a, lw );
  float imx = 1.0 / max( mx, 1e-4 );
  float full = clamp( ( ( mx - min( a.r, min( a.g, a.b ) ) ) * imx - 0.08 ) * 5.882353, 0.0, 1.0 );
  float gn = clamp( ( a.g - 0.5 * ( a.r + a.b ) ) * imx * 3.0, 0.0, 1.0 );
  // The lit paint: the albedo, a green part of the way to where the shade is
  // turned (uPairT.z), at the albedo's own brightness.
  vec3 tr = styleTurn( a, uPairT.x, uPairT.y );
  lit = mix( a, tr, gn * uPairT.z );
  lit *= uPairP.x * lm / max( dot( lit, lw ), 1e-5 );
  vec3 rs = mix( a, tr, gn );
  rs = mix( vec3( dot( rs, lw ) ), rs, uPairP.z );
  rs *= max( uPairP.y * lm, uPairP.w ) / max( dot( rs, lw ), 1e-5 );
  shade = mix( a * vec3( ${PAIR.grey.map(f6).join(', ')} ) * ${f6(PAIR.shadeL)}, rs, full ) * stShadeK;
}
#ifdef STYLE_FIG
// The paints of an animal or another car, from its colour: the lit one is the
// colour, the shade one a colour of its own, not the lit one darkened: turned
// toward violet (the warm ones back, toward magenta, the greens on, toward
// blue) and darker, a grey made a little blue.
void stylePairFig( const in vec3 a, out vec3 lit, out vec3 shade ) {
  const vec3 lw = vec3( 0.2126, 0.7152, 0.0722 );
  float mx = max( a.r, max( a.g, a.b ) );
  float lm = dot( a, lw );
  float imx = 1.0 / max( mx, 1e-4 );
  float full = clamp( ( ( mx - min( a.r, min( a.g, a.b ) ) ) * imx - 0.08 ) * 5.882353, 0.0, 1.0 );
  float gn = clamp( ( a.g - 0.5 * ( a.r + a.b ) ) * imx * 3.0, 0.0, 1.0 );
  float ang = mix( ${f6(-FIG.turnWarm * Math.PI / 180)}, ${f6(FIG.turnGreen * Math.PI / 180)}, gn );
  vec3 t = styleTurn( a, cos( ang ), sin( ang ) );
  t *= ${f6(FIG.shadeL)} * lm / max( dot( t, lw ), 1e-5 );
  lit = a;
  shade = mix( a * vec3( ${FIG.grey.map(f6).join(', ')} ) * ${f6(FIG.shadeL)}, t, full );
}
#endif`;

// Patch a lit material's fragment shader with the style's light. Every
// change is behind a uniform: with the real style the material lights as it
// always did, to the bit. The physical model's direct, diffuse sky and
// reflected light functions are swapped for ones that band, tint and dim
// them; three's light loops call them by name, so no other hook on the same
// chunks is disturbed.
export function patchLighting(fs) {
  return fs
    .replace('#include <common>', `#include <common>
#ifdef STYLE_PAIR
${STYLE_PAIR_GLSL}
#endif
uniform float uStyleLit;
uniform vec3 uRampAt;
uniform vec3 uRampLv;
uniform vec3 uSunTint;
uniform vec3 uShadeTint;
uniform vec3 uShadeEnv;
uniform float uSpecK;
uniform float uShadowK;
uniform float uStyleMark;
uniform float uAlbedoLift;
uniform float uMarkSelf;
uniform float uLiftSelf;
uniform float uCloudShade;
uniform vec2 uCloudDrift;
uniform vec3 uSunDirW;
uniform vec3 uOriginAbs;
uniform float uClump;
uniform float uClumpSelf;
#ifdef STYLE_PAIR
uniform float uPair;
uniform float uPairSun;
uniform float uPairInvSun;
uniform vec3 uSunDirV;
uniform vec3 uPairLit;
uniform vec3 uPairShade;
uniform vec4 uDuskDark;
uniform vec4 uDuskLit;
uniform vec3 uDuskOwn;
uniform vec3 uDuskLine;
uniform float uDuskFig;
// How far a pixel takes the paired paints. A figure does not in a world lit by
// night, unless the world's dusk gives it them (uDuskFig): the light there is
// lamplight, lava and the glow of a low sun, coloured, and its paints take the
// light as a level only, so it stays lit as it is in the styles with no paints,
// and the sun's light is added to it as to those.
#ifdef STYLE_FIG
#define ST_PAIR ( uPair * ( 1.0 - uDuskDark.w * ( 1.0 - uDuskFig ) ) )
#else
#define ST_PAIR uPair
#endif
#endif
// A material that gives its own paints (userData.paints) sets the pair a
// pixel has, from the uniforms above and what it knows of the pixel.
#ifdef STYLE_PAIR_OWN
vec3 stOwnLit;
vec3 stOwnShade;
#endif
// A figure (the car, the other cars, the animals): the sun's share of the
// pixel as the shadow map and the ridges leave it, and for one with paints of
// its own the third paint, what it does to the paint (uFigShape: 1 a
// highlight, 2 two stripes), where the model is occluded (worked out when it is
// loaded, one number a vertex) and where the glass's stripes are centred.
#ifdef STYLE_FIG
float stFigShare = 0.0;
#ifdef STYLE_PAIR_OWN
uniform vec3 uPairDeep;
uniform float uFigShape;
varying float vFigOcc;
varying vec3 vFigC;
#endif
#endif
// What the material is, for the paired paints: marked as leaves or not. (What is
// marked as life or as the car, and is not a figure, is given the light it had
// by its uniforms, withAtmosphere: pair 0 and the old bands, so that the shader
// does not choose.)
#ifdef STYLE_PAIR
// The sun's share of the pixel, and the other lights' diffuse (the car's
// lamp), as the paired paints (pair) take them; only worked out where pair is.
float stPairK = 0.0;
float stPairC = 1.0;
float stPairLev = 0.0;
#endif
float stHash( vec3 p ) {
  p = fract( p * 0.1031 );
  p += dot( p, p.zyx + 31.32 );
  return fract( ( p.x + p.y ) * p.z );
}
float stNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( stHash( vec3( i, 1.0 ) ), stHash( vec3( i + vec2( 1.0, 0.0 ), 1.0 ) ), f.x ),
    mix( stHash( vec3( i + vec2( 0.0, 1.0 ), 1.0 ) ), stHash( vec3( i + vec2( 1.0, 1.0 ), 1.0 ) ), f.x ), f.y );
}
// The shadow of a cloud on the land: broad soft patches, moved by the wind.
float stCloudShadow( vec2 xz ) {
  vec2 q = ( xz + uCloudDrift ) * 0.0017;
  float n = stNoise( q ) * 0.56 + stNoise( q * 2.31 + 7.1 ) * 0.3 + stNoise( q * 5.3 + 3.7 ) * 0.14;
  return smoothstep( 0.5, 0.62, n );
}`)
    .replace('#include <color_fragment>', `#include <color_fragment>
// A painter's palette has no black in it: a dark grey (the asphalt; a
// material opts in with userData.styleLift) laid on lighter and a little
// warm, the lighter the darker it was, and still in its order.
if ( uAlbedoLift * uLiftSelf > 0.0 ) {
  vec3 a = diffuseColor.rgb;
  float hi = max( a.r, max( a.g, a.b ) );
  float grey = 1.0 - smoothstep( 0.015, 0.05, hi - min( a.r, min( a.g, a.b ) ) );
  float under = max( 1.0 - hi / 0.3, 0.0 );
  diffuseColor.rgb = a + vec3( 1.0, 0.94, 0.86 ) * uAlbedoLift * under * under * grey;
}`)
    .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
// How much of a light a face gets, in bands: dark, middle, lit.
float styleRamp( float x ) {
  float w = uRampAt.z;
  return uRampLv.x + ( uRampLv.y - uRampLv.x ) * smoothstep( uRampAt.x - w, uRampAt.x + w, x )
    + ( uRampLv.z - uRampLv.y ) * smoothstep( uRampAt.y - w, uRampAt.y + w, x );
}
void RE_Direct_Style( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  if ( uStyleLit <= 0.0 ) {
    RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
    return;
  }
  // The diffuse light is linear in the light's colour, so banding it is a
  // factor on the result; the shine keeps the light as it is, only less of it.
  ReflectedLight r = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, r );
  float d = saturate( dot( geometryNormal, directLight.direction ) );
  // A cloud's shadow over the land: only the sun's light (the light whose
  // direction is the sun's) goes dim.
  float csPair = 1.0;
  if ( uCloudShade > 0.0 && dot( directLight.direction, normalize( mat3( viewMatrix ) * uSunDirW ) ) > 0.995 ) {
    vec3 cw = cameraPosition + geometryPosition * mat3( viewMatrix ) + uOriginAbs;
    float cs = 1.0 - uCloudShade * stCloudShadow( cw.xz );
    r.directDiffuse *= cs;
    r.directSpecular *= cs;
    csPair = cs;
  }
  float ramp = styleRamp( d );
  vec3 banded = r.directDiffuse * mix( vec3( 1.0 ), uSunTint * ( ramp / max( d, 1e-3 ) ), uStyleLit );
  // Where the paired paints are, the sun's light is not added as it is: how
  // much of it this pixel has (the band, and what the shadow, the ridges and
  // the cloud have left of it) is kept, and the paints take it at the end.
#ifdef STYLE_PAIR
  if ( ST_PAIR > 0.0 ) {
    float sun = ST_PAIR * step( 0.995, dot( directLight.direction, uSunDirV ) );
    reflectedLight.directDiffuse += banded * ( 1.0 - sun );
    stPairK += sun * ramp * min( dot( directLight.color, vec3( 0.2126, 0.7152, 0.0722 ) ) * uPairInvSun, 1.0 );
    stPairC = mix( stPairC, csPair, sun );
#ifdef STYLE_FIG
    stFigShare += step( 0.995, dot( directLight.direction, uSunDirV ) ) * min( dot( directLight.color, vec3( 0.2126, 0.7152, 0.0722 ) ) * uPairInvSun, 1.0 );
#endif
  } else {
    reflectedLight.directDiffuse += banded;
  }
#else
  reflectedLight.directDiffuse += banded;
#endif
  reflectedLight.directSpecular += r.directSpecular * uSpecK;
}
void RE_IndirectDiffuse_Style( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
#ifdef STYLE_PAIR
  if ( ST_PAIR > 0.0 ) stPairLev += dot( irradiance, vec3( 0.2126, 0.7152, 0.0722 ) );
#endif
  vec3 e = uStyleLit > 0.0 ? irradiance * mix( vec3( 1.0 ), uShadeTint, uStyleLit ) : irradiance;
  RE_IndirectDiffuse_Physical( e, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
}
void RE_IndirectSpecular_Style( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  if ( uStyleLit > 0.0 ) {
    // The environment's diffuse light comes in here: its share of the shade.
    vec3 e = irradiance * mix( vec3( 1.0 ), uShadeEnv, uStyleLit );
    // The paired paints take the diffuse light of the environment themselves;
    // what the specular function adds of it (the multiple scattering's share,
    // a veil of the sky's colour over a dark paint) is left out.
#ifdef STYLE_PAIR
    if ( ST_PAIR > 0.0 ) {
      stPairLev += dot( irradiance, vec3( 0.2126, 0.7152, 0.0722 ) );
      e *= 1.0 - ST_PAIR;
    }
#endif
    RE_IndirectSpecular_Physical( radiance * uSpecK, e, clearcoatRadiance * uSpecK, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  } else {
    RE_IndirectSpecular_Physical( radiance, irradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  }
}
#undef RE_Direct
#define RE_Direct RE_Direct_Style
#undef RE_IndirectDiffuse
#define RE_IndirectDiffuse RE_IndirectDiffuse_Style
#undef RE_IndirectSpecular
#define RE_IndirectSpecular RE_IndirectSpecular_Style`)
    .replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>
#ifdef USE_SHADOWMAP
// A cast shadow's soft edge drawn crisp.
float getShadowStyle( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
  float v = getShadow( shadowMap, shadowMapSize, shadowBias, shadowRadius, shadowCoord );
  if ( uShadowK <= 0.0 ) return v;
  float edge = smoothstep( 0.3, 0.7, v );
  // The paired paints (pair) have a harder edge.
#ifdef STYLE_PAIR
  if ( ST_PAIR > 0.0 ) edge = mix( edge, smoothstep( 0.42, 0.58, v ), ST_PAIR );
#endif
  return mix( v, edge, uShadowK );
}
#define getShadow getShadowStyle
#endif`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
// Leaves in clumps (a material opts in with userData.styleClump): the
// light on a crown breaks into clusters, a metre or so across, as a
// painter lays the leaves, not into the facets of the model. A smooth
// swirl of bumps laid on the world (two scales of it), so it stays on the
// tree and has no seams.
if ( uClump * uClumpSelf > 0.0 ) {
  vec3 cw = cameraPosition + ( - vViewPosition ) * mat3( viewMatrix ) + uOriginAbs;
  vec3 p = cw * 3.8;
  vec3 g1 = vec3( sin( p.y + 1.7 * cos( 0.83 * p.z ) ), sin( p.z + 1.7 * cos( 0.83 * p.x ) ), sin( p.x + 1.7 * cos( 0.83 * p.y ) ) );
  vec3 q = cw * 8.3 + 3.1;
  vec3 g2 = vec3( sin( q.y + 1.3 * cos( 0.9 * q.z ) ), sin( q.z + 1.3 * cos( 0.9 * q.x ) ), sin( q.x + 1.3 * cos( 0.9 * q.y ) ) );
  vec3 bn = mat3( viewMatrix ) * ( g1 + 0.5 * g2 + vec3( 0.0, 0.3, 0.0 ) );
  // Leaves only: a trunk is brown (its red over its green), and stays smooth.
  float leafy = smoothstep( -0.01, 0.03, diffuseColor.g - diffuseColor.r );
  normal = normalize( normal + bn * 0.6 * uClump * uClumpSelf * leafy );
}
// A figure's paints are flat, so the sky's light is the same over all of it:
// the light of the sky is taken at the normal that faces up, and the sun's
// share is read from the normal the surface has (stFigN).
#ifdef STYLE_FIG
vec3 stFigN = normal;
{
  vec3 nf = mix( normal, viewMatrix[ 1 ].xyz, ST_PAIR );
  float nl = dot( nf, nf );
  if ( nl > 1e-4 ) normal = nf * inversesqrt( nl );
}
#endif`)
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
#if defined( RE_IndirectSpecular )
// The paired paints: the shade paint where the sun does not reach, the lit
// paint where it does, the two mixed by the sun's share of the pixel, at
// the level of the light the world has here (the sun's, and the sky's: the
// hemisphere's and the environment's). The lit paint is the direct light's
// and the shade paint the sky's, so the shade of a crevice (the occlusion
// laid on the sky's light further on) still goes dark. Where pair is part
// of the way, the light as it was is mixed in (the sun's, which was left
// out of the direct light by the same share).
#ifdef STYLE_PAIR
#ifdef STYLE_FIG
// A figure is its paints and nothing of the physical model's shine: the paint
// the pixel is in (lit, shade, deep) at the level of the light, and for the
// car's paint one highlight, for its glass two stripes.
if ( ST_PAIR > 0.0 ) {
  vec3 pLit, pShade, pDeep;
#ifdef STYLE_PAIR_OWN
  pLit = stOwnLit; pShade = stOwnShade; pDeep = uPairDeep;
#else
  stylePairFig( diffuseColor.rgb, pLit, pShade );
  pDeep = pShade;
#endif
  float lev = ( uPairSun + stPairLev ) * ${f6(PAIR.level)} * RECIPROCAL_PI;
  // (In a world lit by night that gives its figures their paints: at the level of its own.)
  lev *= mix( 1.0, uDuskLit.w, uDuskDark.w * uDuskFig );
  float upN = dot( stFigN, viewMatrix[ 1 ].xyz );
  float lk = smoothstep( ${f6(FIG.litAt[0])}, ${f6(FIG.litAt[1])}, dot( stFigN, uSunDirV ) + ${f6(FIG.litBias)} )
    * smoothstep( ${f6(FIG.shareAt[0])}, ${f6(FIG.shareAt[1])}, stFigShare ) * stPairC;
  float dk = 1.0 - smoothstep( ${f6(FIG.downAt[0])}, ${f6(FIG.downAt[1])}, upN );
#ifdef STYLE_PAIR_OWN
  dk = max( dk, smoothstep( ${f6(FIG.occAt[0])}, ${f6(FIG.occAt[1])}, vFigOcc ) );
#endif
  vec3 tone = mix( mix( pShade, pLit, lk ), pDeep, dk );
#ifdef STYLE_PAIR_OWN
  if ( uFigShape > 1.5 ) {
    vec3 sr = -vViewPosition - vFigC;
    float ss = ( sr.x * ${f6(Math.sin(FIG.stripeAngle * Math.PI / 180))} - sr.y * ${f6(Math.cos(FIG.stripeAngle * Math.PI / 180))} ) / ${f6(FIG.glassH)};
    float sp = max( fwidth( ss ), 1e-5 );
    float w0 = max( ${f6(FIG.stripeW[0])}, ${f6(FIG.stripePx[0])} * sp ) * 0.5;
    float w1 = max( ${f6(FIG.stripeW[1])}, ${f6(FIG.stripePx[1])} * sp ) * 0.5;
    float st = max( 1.0 - smoothstep( w0 - sp, w0 + sp, abs( ss - ${f6(FIG.stripeAt[0])} ) ),
      1.0 - smoothstep( w1 - sp, w1 + sp, abs( ss - ${f6(FIG.stripeAt[1])} ) ) );
    tone = mix( tone, vec3( ${FIG.stripeCol.map(f6).join(', ')} ), st * ${f6(FIG.stripeK)} );
  } else if ( uFigShape > 0.5 ) {
    float nh = dot( stFigN, normalize( uSunDirV + geometryViewDir ) );
    tone *= 1.0 + ${f6(FIG.hlK - 1)} * smoothstep( ${f6(FIG.hlAt[0])}, ${f6(FIG.hlAt[1])}, nh )
      * smoothstep( ${f6(FIG.hlUp[0])}, ${f6(FIG.hlUp[1])}, upN ) * lk * ( 1.0 - dk );
  }
#endif
  tone *= min( 1.0, ${f6(FIG.peak)} / max( dot( tone, vec3( 0.299, 0.587, 0.114 ) ) * lev, 1e-4 ) );
  reflectedLight.indirectDiffuse = mix( reflectedLight.indirectDiffuse, tone * lev, ST_PAIR );
  reflectedLight.directSpecular *= 1.0 - ST_PAIR;
  reflectedLight.indirectSpecular *= 1.0 - ST_PAIR;
#ifdef USE_CLEARCOAT
  clearcoatSpecularDirect *= 1.0 - ST_PAIR;
  clearcoatSpecularIndirect *= 1.0 - ST_PAIR;
  material.clearcoat *= 1.0 - ST_PAIR;
#endif
}
#else
if ( uPair > 0.0 ) {
  vec3 pLit, pShade;
#ifdef STYLE_PAIR_OWN
  pLit = stOwnLit; pShade = stOwnShade;
#else
  stylePair( material.diffuseColor, pLit, pShade );
#endif
  float lev = ( uPairSun + stPairLev ) * ${f6(PAIR.level)} * RECIPROCAL_PI;
  // In a world lit by night: the dark side is the colour the world's dark is
  // (at the paint's own tone, and not under that dark itself), the lit side of
  // what is made from an albedo is tinted (a paint a material gives itself is
  // tinted by the material), and all is laid at the level of the world's night.
  if ( uDuskDark.w > 0.0 ) {
    const vec3 lw = vec3( 0.2126, 0.7152, 0.0722 );
    float dl = max( dot( uDuskDark.rgb, lw ), 1e-4 );
    pShade = mix( pShade, uDuskDark.rgb * ( max( dot( pShade, lw ), dl ) / dl ), ${f6(PAIR.duskPull)} * uDuskDark.w );
#ifndef STYLE_PAIR_OWN
    pLit *= uDuskLit.rgb;
#endif
    lev *= uDuskLit.w;
  }
  float pk = smoothstep( ${f6(PAIR.step[0])}, ${f6(PAIR.step[1])}, saturate( stPairK ) ) * stPairC;
  reflectedLight.directDiffuse += pLit * ( lev * pk * uPair );
  reflectedLight.indirectDiffuse = mix( reflectedLight.indirectDiffuse, pShade * ( lev * ( 1.0 - pk ) ), uPair );
}
#endif
#endif
#endif`)
    .replace('#include <dithering_fragment>', `#include <dithering_fragment>
// What this is (MARK), marked in the alpha for the last pass (render/post.js),
// by a style that marks: uMarkSelf is the material's mark, 0 for none.
if ( uStyleMark * uMarkSelf > 0.0 ) gl_FragColor.a = uMarkSelf;`);
}

// The vertex side of a figure with paints of its own (withAtmosphere): the
// model's occlusion, one number a vertex (aOcc: worked out when the model is
// loaded, render/presentation.js), and where the glass's stripes are centred
// in the view (uFigC, a point of the model, in its own units).
export function patchFigureVertex(vs) {
  return vs
    .replace('#include <common>', `#include <common>
attribute float aOcc;
uniform vec3 uFigC;
varying float vFigOcc;
varying vec3 vFigC;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
vFigOcc = aOcc;
vFigC = ( modelViewMatrix * vec4( uFigC, 1.0 ) ).xyz;`);
}

// The brush strokes' taps (kuwahara in STYLE_PASS): the 25 points of a 5 by 5
// grid, a step apart, each with its Gaussian weight shared out among the
// eight sectors of the disc round the pixel it falls in: all of it to its own
// sector, and up to half of it to the next one round on its nearer side, so
// neighbouring sectors overlap. Worked out once here, and written out as the
// shader's code, one line to a sector a tap falls in: a tap reaches one or
// two sectors, so nothing is added that is not needed, and no table is
// indexed. The first KUWAHARA_MID of them are the cross and the grid's four
// corners (and the pixel itself), the taps of the middle tier, which stops
// there: it still has a tap or more in every sector.
//
// Two things make 25 taps lay a wash as flat as 49 did. Each tap but the
// pixel's own is read where four pixels meet, so it is the four of them (the
// filter that reads a texture does the adding). And the pixel's own counts
// for little in a sector (KUWAHARA_SELF of a tap) under a bell that is
// nearly flat (KUWAHARA_BELL): a sector here is three or four taps, and with
// the pixel itself a full tap in each of them more than a third of every
// sector was the pixel as it was, and a hillside's strata came through.
const KUWAHARA_MID = 13;
const KUWAHARA_SELF = 0.15;
const KUWAHARA_BELL = 12;      // a tap rr steps squared off weighs exp(-rr / this)
const KUWAHARA_TAPS = (() => {
  const num = (v) => v.toFixed(6);
  const grid = [];
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) grid.push([i, j]);
  const outer = ([i, j]) => (i === 0 || j === 0 || (Math.abs(i) === 2 && Math.abs(j) === 2) ? 0 : 1);
  grid.sort((p, q) => outer(p) - outer(q) || (p[1] - q[1]) || (p[0] - q[0]));
  const comp = 'xyzw';
  const sums = [new Array(8).fill(0), new Array(8).fill(0)];
  const code = [[], []];
  grid.forEach(([i, j], t) => {
    const rr = i * i + j * j;
    const g = rr < 0.5 ? KUWAHARA_SELF : Math.exp(-rr / KUWAHARA_BELL);
    const w = new Array(8).fill(0);
    if (rr < 0.5) w.fill(g);
    else {
      // Rounded so a tap on a sector's edge falls the same way every time.
      const a = Math.round((Math.atan2(j, i) + Math.PI) / (Math.PI / 4) * 1e6) / 1e6;
      const k0 = Math.floor(a) & 7;
      const f = a - Math.floor(a);
      w[k0] += g;
      w[(k0 + (f < 0.5 ? 7 : 1)) & 7] += g * (0.5 - Math.abs(f - 0.5));
    }
    const part = t < KUWAHARA_MID ? 0 : 1;
    // The pixel itself, whole; any other where four pixels meet, nearest the
    // tap and the same way either side of the pixel (half a pixel past a
    // whole number of them: on a line through the pixel, between two).
    const lines = [rr < 0.5 ? 'c = texelFetch(tDiffuse, at, 0).rgb;'
      : `o = vec2(${i}.0, ${j}.0) * s; c = texture2D(tDiffuse, (ctr + sign(o) * (floor(abs(o)) + 0.5)) * inv).rgb;`];
    if (rr > 0.5) lines.push('q = dot(c, c);');
    if (rr < 0.5) {
      // To every sector alike, at its small weight.
      lines.push(`q = ${num(g)} * dot(c, c); c *= ${num(g)};`, 'rA += c.r; gA += c.g; bA += c.b; rB += c.r; gB += c.g; bB += c.b;', 'qA += q; qB += q;');
    } else {
      w.forEach((v, k) => {
        if (v <= 0) return;
        const side = k < 4 ? 'A' : 'B';
        const x = comp[k & 3];
        lines.push(`rg = ${num(v)}; r${side}.${x} += rg * c.r; g${side}.${x} += rg * c.g; b${side}.${x} += rg * c.b; q${side}.${x} += rg * q;`);
      });
    }
    w.forEach((v, k) => { sums[part][k] += v; });
    code[part].push(lines.join('\n        '));
  });
  const total = sums[0].map((v, k) => v + sums[1][k]);
  const vec = (a) => `vec4(${a.slice(0, 4).map(num).join(', ')}), vec4(${a.slice(4).map(num).join(', ')})`;
  return { n: grid.length, mid: code[0].join('\n        '), rest: code[1].join('\n        '),
    nMid: vec(sums[0]), nAll: vec(total) };
})();

// The first half of the flat colour (STYLE_PASS, flatten): along each row, the
// mean of the pixels on the same surface, and the weight they took, for the
// column through the rows to go on with. A pixel of the sky (the depth on the
// far plane) is handed on as it is.
export const FLAT_PASS = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uNearFar: { value: new THREE.Vector2(0.3, 14000) },
    uFlatR: { value: 1 },
    uFlatN: { value: 3 },
    uSkyEps: { value: 0.002 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 uRes;
    uniform vec2 uNearFar;
    uniform float uFlatR;
    uniform int uFlatN;
    uniform float uSkyEps;
    varying vec2 vUv;
    // exp(-n * n / 9) for n = 0 to 3: the weight of a step either side.
    const float GAUSS[4] = float[4](1.0, 0.894839, 0.641180, 0.367879);

    // How much a difference of two depth buffer values counts against a
    // pixel's own (see STYLE_PASS, depthPer).
    float depthPer(float zc) {
      float n = uNearFar.x;
      float f = uNearFar.y;
      float inv = (f - zc * (f - n)) / (n * f);
      return ((f - n) / (n * f)) / (inv * 0.03 + 1e-7);
    }

    void main() {
      float sx = uFlatR / uRes.x;
      vec3 c0 = texture2D(tDiffuse, vUv).rgb;
      // The sky: its colour is its own, and it is flat along a row unless
      // a cloud's edge is within reach (the colour is not on a straight
      // line across the reach).
      if (texture2D(tDepth, vUv).r >= 0.999995) {
        vec3 a = texture2D(tDiffuse, vUv - vec2(3.0 * sx, 0.0)).rgb + texture2D(tDiffuse, vUv + vec2(3.0 * sx, 0.0)).rgb - 2.0 * c0;
        vec3 b = texture2D(tDiffuse, vUv - vec2(2.0 * sx, 0.0)).rgb + texture2D(tDiffuse, vUv + vec2(2.0 * sx, 0.0)).rgb - 2.0 * c0;
        vec3 e = texture2D(tDiffuse, vUv - vec2(sx, 0.0)).rgb + texture2D(tDiffuse, vUv + vec2(sx, 0.0)).rgb - 2.0 * c0;
        vec3 d = max(abs(a), max(abs(b), abs(e)));
        if (max(d.r, max(d.g, d.b)) < uSkyEps) {
          // The weight it would have taken: the sky is all one depth.
          float w = 1.0;
          for (int i = 1; i <= uFlatN; i++) w += 2.0 * GAUSS[i];
          gl_FragColor = vec4(c0, w);
          return;
        }
      }
      float zc = texture2D(tDepth, vUv).r;
      float per = depthPer(zc);
      vec3 acc = vec3(0.0);
      float sum = 0.0;
      for (int i = -uFlatN; i <= uFlatN; i++) {
        vec2 uv = vUv + vec2(float(i) * sx, 0.0);
        float k = exp(-abs(texture2D(tDepth, uv).r - zc) * per) * GAUSS[abs(i)];
        acc += texture2D(tDiffuse, uv).rgb * k;
        sum += k;
      }
      gl_FragColor = vec4(acc / max(sum, 1e-5), sum);
    }
  `,
};

// The last pass: reads the graded frame (its alpha what each thing marked
// itself, MARK) and the scene's depth.
export const STYLE_PASS = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    tFlat: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uNearFar: { value: new THREE.Vector2(0.3, 14000) },
    uPaint: { value: 0 },
    uPaintR: { value: 1 },
    uTaps: { value: KUWAHARA_TAPS.n },
    uFlatEps: { value: 0.003 },
    uFlat: { value: 0 },
    uFlatR: { value: 1 },
    uFlatN: { value: 3 },
    uSkyEps: { value: 0.002 },
    uPart: { value: new THREE.Vector2(0.25, 0.75) },
    uSplit: { value: 0.9 },
    uLine: { value: 0 },
    uLineW: { value: 1 },
    uLineCar: { value: 0 },
    uLineFig: { value: 0 },
    uLineCol: { value: new THREE.Vector3() },
    uLineDark: { value: 0 },
    uLineFar: { value: 600 },
    uJump: { value: new THREE.Vector2(0.04, 0.12) },
    uCrease: { value: 0.8 },
    uRidge: { value: 0 },
    uBrush: { value: 0 },
    uInk: { value: 0 },
    uKeep: { value: 0 },
    uPoster: { value: 0 },
    uLevels: { value: 6 },
    uPrint: { value: 0 },
    uPixel: { value: 1 },
    uRows: { value: 200 },
    uDither: { value: 0 },
    uGrade: { value: new THREE.Vector4(1, 1, 0, 0) },
    uPaper: { value: new THREE.Vector3(1, 1, 1) },
    uInkCol: { value: new THREE.Vector3() },
    uBlank: { value: 0 },
    uBokashi: { value: 0 },
    uFar: { value: 0 },
    uLift: { value: 0 },
    uDark: { value: 0 },
    uGreen: { value: 0 },
    uGreenPal: { value: 0 },
    uGreenShade: { value: new THREE.Vector3() },
    uGreenMid: { value: new THREE.Vector3() },
    uGreenLit: { value: new THREE.Vector3() },
    uSatDark: { value: 0 },
    uDitherK: { value: 0.85 },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uViewProj: { value: new THREE.Matrix4() },
    uOriginMod: { value: new THREE.Vector3() },
    uBlock: { value: 0 },
    uBlockK: { value: 0.012 },
    uBlockJit: { value: 0.14 },
    uBlockFace: { value: 0.55 },
    uMeadow: { value: 0 },
    uFlowers: { value: 0 },
    uGrassHere: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform sampler2D tFlat;
    uniform vec2 uRes;
    uniform vec2 uNearFar;
    uniform float uPaint;
    uniform float uPaintR;
    uniform int uTaps;
    uniform float uFlatEps;
    uniform float uFlat;
    uniform float uFlatR;
    uniform int uFlatN;
    uniform float uSkyEps;
    uniform vec2 uPart;
    uniform float uSplit;
    uniform float uLine;
    uniform float uLineW;
    uniform float uLineCar;
    uniform float uLineFig;
    uniform vec3 uLineCol;
    uniform float uLineDark;
    uniform float uLineFar;
    uniform vec2 uJump;
    uniform float uCrease;
    uniform float uRidge;
    uniform float uBrush;
    uniform float uInk;
    uniform float uKeep;
    uniform float uPoster;
    uniform float uLevels;
    uniform float uPrint;
    uniform float uPixel;
    uniform float uRows;
    uniform float uDither;
    uniform vec4 uGrade;
    uniform vec3 uPaper;
    uniform vec3 uInkCol;
    uniform float uBlank;
    uniform float uBokashi;
    uniform float uFar;
    uniform float uLift;
    uniform float uDark;
    uniform float uGreen;
    uniform float uGreenPal;
    uniform vec3 uGreenShade;
    uniform vec3 uGreenMid;
    uniform vec3 uGreenLit;
    uniform float uSatDark;
    uniform float uDitherK;
    uniform mat4 uInvProj;
    uniform mat4 uCamWorld;
    uniform mat4 uViewProj;
    uniform vec3 uOriginMod;
    uniform float uBlock;
    uniform float uBlockK;
    uniform float uBlockJit;
    uniform float uBlockFace;
    uniform float uMeadow;
    uniform float uFlowers;
    uniform float uGrassHere;
    varying vec2 vUv;

    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    // What a pixel is, by its mark in the scene's alpha (MARK, MARK_RANGE):
    // 1 in the range, 0 out of it. With a style that does not mark, the
    // alpha is 1, nothing.
    ${MARK_GLSL}
    // What a style draws apart: the car, and the animals with it.
    float markFigure(float a) { return markCar(a) + markLife(a); }
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    // Ordered dithering, 4 by 4.
    float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
    float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

    // Inverse depth: straight across a plane in screen space, so a crease is
    // where its slope breaks and a silhouette where it jumps.
    float invDepth(vec2 uv) {
      float z = texture2D(tDepth, uv).r * 2.0 - 1.0;
      float n = uNearFar.x;
      float f = uNearFar.y;
      return (f + n - z * (f - n)) / (2.0 * n * f);
    }
    float invFromZ(float zb) {
      float z = zb * 2.0 - 1.0;
      float n = uNearFar.x;
      float f = uNearFar.y;
      return (f + n - z * (f - n)) / (2.0 * n * f);
    }
    // The line round a figure and between its parts, at a pixel: where the mark
    // in the alpha changes against a neighbour a line's width away (read where
    // the pixel is, not between two: a filtered read would make a third mark of
    // two), and one of the two is a figure. Between two parts of a figure the
    // line is on the one with the lower mark (the body's, round a lamp or a
    // trim, not the lamp's own); between a figure and what is not one it is on
    // both. Not where the other is in front of it and is not one (the grass
    // over the car): that edge is the grass's.
    float figureInkAt(ivec2 q, float aC, float fC, float invC) {
      float aN = texelFetch(tDiffuse, q, 0).a;
      float fN = markFigure(aN);
      float d = abs(aC - aN);
      if (max(fC, fN) < 0.5 || d < ${FIG_INK.at[0].toFixed(3)} || (fN == fC && aC >= aN)) return 0.0;
      float invN = invFromZ(texelFetch(tDepth, q, 0).r);
      float front = fC > fN ? step(invC * ${FIG_INK.front.toFixed(3)}, invN) : (fN > fC ? step(invN * ${FIG_INK.front.toFixed(3)}, invC) : 0.0);
      return smoothstep(${FIG_INK.at[0].toFixed(3)}, ${FIG_INK.at[1].toFixed(3)}, d) * (1.0 - front);
    }
    float figureInk(ivec2 at, float aC, float zC) {
      int w = int(max(1.0, floor(uLineW + 0.5)));
      ivec2 last = ivec2(uRes) - 1;
      float fC = markFigure(aC);
      float invC = invFromZ(zC);
      return max(max(figureInkAt(clamp(at + ivec2(w, 0), ivec2(0), last), aC, fC, invC), figureInkAt(clamp(at - ivec2(w, 0), ivec2(0), last), aC, fC, invC)),
        max(figureInkAt(clamp(at + ivec2(0, w), ivec2(0), last), aC, fC, invC), figureInkAt(clamp(at - ivec2(0, w), ivec2(0), last), aC, fC, invC)));
    }
    vec3 worldFromZ(vec2 uv, float zb) {
      vec4 vp = uInvProj * vec4(uv * 2.0 - 1.0, zb * 2.0 - 1.0, 1.0);
      return (uCamWorld * vec4(vp.xyz / vp.w, 1.0)).xyz;
    }
    float hash13(vec3 p3) {
      p3 = fract(p3 * 0.1031);
      p3 += dot(p3, p3.zyx + 31.32);
      return fract((p3.x + p3.y) * p3.z);
    }
    // Value noise that repeats every 'period' cells, so what is laid on the
    // world by it does not jump when the floating origin wraps its 1 km.
    float pnoise(vec2 p, float period) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      vec2 a = mod(i, period);
      vec2 b = mod(i + 1.0, period);
      return mix(mix(hash12(a), hash12(vec2(b.x, a.y)), f.x), mix(hash12(vec2(a.x, b.y)), hash12(b), f.x), f.y);
    }

    // The way the surface at a pixel faces, from the depth: its neighbours'
    // points (the near side of a jump), crossed. Zero where it cannot say.
    vec3 depthNormal(vec2 uv, float zc, float wc, vec3 P) {
      vec2 d = 1.0 / uRes;
      vec2 ox = vec2(d.x, 0.0);
      vec2 oy = vec2(0.0, d.y);
      float zr = texture2D(tDepth, uv + ox).r;
      float zl = texture2D(tDepth, uv - ox).r;
      float zu = texture2D(tDepth, uv + oy).r;
      float zd = texture2D(tDepth, uv - oy).r;
      vec3 ex = abs(invFromZ(zr) - wc) < abs(wc - invFromZ(zl)) ? worldFromZ(uv + ox, zr) - P : P - worldFromZ(uv - ox, zl);
      vec3 ey = abs(invFromZ(zu) - wc) < abs(wc - invFromZ(zd)) ? worldFromZ(uv + oy, zu) - P : P - worldFromZ(uv - oy, zd);
      vec3 n = cross(ex, ey);
      float nl = length(n);
      if (nl < 1e-9) return vec3(0.0);
      n /= nl;
      return dot(n, uCamWorld[3].xyz - P) < 0.0 ? -n : n;
    }

    // A world of blocks. The face of the world a pixel is on is found from
    // the depth (the way its neighbours' points lie), and laid with square
    // texels s metres across on the plane of that face: the colour of the
    // frame where the middle of the texel is, a little lighter or darker by
    // the texel's own draw, as the picture on a block's face is. Texels stay
    // where they are on the world, so the world moves under them; their
    // draw comes from where they are in a 1 km square that repeats.
    vec3 blockTexel(vec3 P, vec3 n, int k, float s, vec3 col0, float dist) {
      int a = (k + 1) % 3;
      int b = (k + 2) % 3;
      vec3 Pw = P + uOriginMod;
      float ia = floor(Pw[a] / s);
      float ib = floor(Pw[b] / s);
      vec3 Q = Pw;
      Q[a] = (ia + 0.5) * s;
      Q[b] = (ib + 0.5) * s;
      // On the plane the pixel's own point and normal give, so the middle of
      // the texel is on the same surface, not in front of or behind it.
      Q[k] = Pw[k] - (n[a] * (Q[a] - Pw[a]) + n[b] * (Q[b] - Pw[b])) / n[k];
      vec4 cp = uViewProj * vec4(Q - uOriginMod, 1.0);
      vec3 c = col0;
      if (cp.w > 0.0) {
        vec2 q = cp.xy / cp.w * 0.5 + 0.5;
        if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
          float wq = invFromZ(texture2D(tDepth, q).r);
          float we = 1.0 / cp.w;
          // Only if that is the same surface; at an edge it is the pixel's own.
          if (abs(wq - we) < we * (0.012 + 1.5 * s / dist)) c = texture2D(tDiffuse, q).rgb;
        }
      }
      float per = 1024.0 / s;
      float h = hash13(vec3(mod(ia, per), mod(ib, per), float(k) * 7.0 + log2(s) + 20.0));
      // Where a texel is no wider than a pixel or two the variation would
      // only be noise.
      float vis = smoothstep(1.0, 3.0, s / (dist * 0.0018));
      return c * (1.0 + (h - 0.5) * uBlockJit * vis);
    }
    vec3 blockColor(vec2 uv, vec3 col0, float zc, float wc) {
      vec3 P = worldFromZ(uv, zc);
      vec3 n = depthNormal(uv, zc, wc, P);
      if (dot(n, n) < 0.5) return col0;
      vec3 cam = uCamWorld[3].xyz;
      vec3 an = abs(n);
      int k = (an.y >= an.x && an.y >= an.z) ? 1 : (an.x >= an.z ? 0 : 2);
      float dist = length(P - cam);
      // Texels in whole powers of two of a metre, two scales at a time and
      // the one blended into the other, so no seam where the scale changes.
      float L = log2(max(dist * uBlockK, 1.0 / 32.0));
      float L0 = floor(L);
      float f = L - L0;
      vec3 c = blockTexel(P, n, k, exp2(L0), col0, dist);
      if (f > 0.3) c = mix(c, blockTexel(P, n, k, exp2(L0 + 1.0), col0, dist), smoothstep(0.3, 0.7, f));
      // Each face shaded by the way it faces: the top full, the sides less,
      // the underside least.
      float face = k == 1 ? (n.y > 0.0 ? 1.0 : 0.5) : (k == 0 ? 0.78 : 0.62);
      return c * mix(1.0, face, uBlockFace);
    }

    // Brush strokes: a Kuwahara filter over eight sectors of a disc, taken
    // at the points of a 5 by 5 grid a step s apart (13 of the 25 when all is
    // false: the middle tier). Each sector's mean is weighted by how even the sector
    // is, so flat areas stay flat and edges stay sharp; the round sectors lay
    // round dabs where the four squares of the plain filter laid streaks and
    // blocks. The sectors go four to a vec4: 0-3 in the A sums, 4-7 in the B
    // ones; the taps' weights are in the code (KUWAHARA_TAPS), and so is
    // where each is read: the pixel itself whole, the others where four
    // pixels meet.
    vec3 kuwahara(vec2 uv, vec2 s, bool all) {
      ivec2 at = ivec2(floor(uv * uRes));
      vec2 ctr = vec2(at) + 0.5;
      vec2 inv = 1.0 / uRes;
      vec2 o;
      s *= uRes;
      vec4 rA = vec4(0.0);
      vec4 gA = vec4(0.0);
      vec4 bA = vec4(0.0);
      vec4 rB = vec4(0.0);
      vec4 gB = vec4(0.0);
      vec4 bB = vec4(0.0);
      vec4 qA = vec4(0.0);
      vec4 qB = vec4(0.0);
      vec3 c;
      float q;
      float rg;
      ${KUWAHARA_TAPS.mid}
      vec4 nA;
      vec4 nB;
      if (all) {
        ${KUWAHARA_TAPS.rest}
        nA = ${KUWAHARA_TAPS.nAll.split('), ')[0]});
        nB = ${KUWAHARA_TAPS.nAll.split('), ')[1]};
      } else {
        nA = ${KUWAHARA_TAPS.nMid.split('), ')[0]});
        nB = ${KUWAHARA_TAPS.nMid.split('), ')[1]};
      }
      rA /= nA;
      gA /= nA;
      bA /= nA;
      rB /= nB;
      gB /= nB;
      bB /= nB;
      // How uneven each sector is (its variance, the channels summed), and
      // its weight from that.
      vec4 xA = 1.0 + 500.0 * max(qA / nA - (rA * rA + gA * gA + bA * bA), 0.0);
      vec4 xB = 1.0 + 500.0 * max(qB / nB - (rB * rB + gB * gB + bB * bB), 0.0);
      xA *= xA;
      xB *= xB;
      vec4 wA = 1.0 / (xA * xA);
      vec4 wB = 1.0 / (xB * xB);
      vec3 acc = vec3(dot(rA, wA) + dot(rB, wB), dot(gA, wA) + dot(gB, wB), dot(bA, wA) + dot(bB, wB));
      return acc / (dot(wA, vec4(1.0)) + dot(wB, vec4(1.0)));
    }

#ifdef FLAT
    // exp(-n * n / 9) for n = 0 to 3: the weight of a step either side.
    const float GAUSS[4] = float[4](1.0, 0.894839, 0.641180, 0.367879);
    // How much a difference of two depth buffer values counts against a
    // pixel's own: the inverse depth is a straight line of the buffer's value,
    // so this is the difference over a thirtieth of the pixel's inverse depth.
    float depthPer(float zc) {
      float n = uNearFar.x;
      float f = uNearFar.y;
      float inv = (f - zc * (f - n)) / (n * f);
      return ((f - n) / (n * f)) / (inv * 0.03 + 1e-7);
    }
    // Flat colour: the neighbourhood's mean over the same surface only (by
    // depth), so the texture of grass and rock goes and the edges of things
    // stay where they are. Done in two passes, a row and then a column: the
    // rows are in tFlat already (FLAT_PASS), each with the weight it took,
    // and this is the column through them.
    vec3 flatten(vec2 uv, vec2 s, float zc) {
      float per = depthPer(zc);
      vec3 acc = vec3(0.0);
      float sum = 0.0;
      for (int j = -uFlatN; j <= uFlatN; j++) {
        vec2 o = vec2(0.0, float(j) * s.y);
        float dk = exp(-abs(texture2D(tDepth, uv + o).r - zc) * per);
        float g = GAUSS[abs(j)];
        // A filtered read of tFlat here blends two rows, the nearest and the
        // one beside it. The one beside it counts when it takes a tenth of
        // the read or more and is not on this pixel's surface.
        bool part = abs(j) <= 2 && dk > uPart.x && dk < uPart.y;
        if (!part && abs(j) <= 2) {
          float t = (uv.y + o.y) * uRes.y - 0.5;
          float f = t - floor(t);
          if (min(f, 1.0 - f) > 0.1) {
            float zb = texture2D(tDepth, uv + o + vec2(0.0, f < 0.5 ? s.y / uFlatR : -s.y / uFlatR)).r;
            part = exp(-abs(zb - zc) * per) < uSplit;
          }
        }
        if (part) {
          // One of the rows next to this pixel's, partly on this surface or
          // blended with one that is not: it was taken against the depth at
          // its own middle, not this pixel's, and is done again against this
          // one's. (The rows further out weigh too little for it to show.)
          for (int i = -uFlatN; i <= uFlatN; i++) {
            vec2 p = uv + o + vec2(float(i) * s.x, 0.0);
            float k = exp(-abs(texture2D(tDepth, p).r - zc) * per) * GAUSS[abs(i)] * g;
            acc += texture2D(tDiffuse, p).rgb * k;
            sum += k;
          }
        } else {
          vec4 row = texture2D(tFlat, uv + o);
          float k = dk * g * row.a;
          acc += row.rgb * k;
          sum += k;
        }
      }
      return acc / max(sum, 1e-5);
    }
#endif

    void main() {
      vec2 px = 1.0 / uRes;
      vec2 uv = vUv;
      // Blocks: every pixel of one takes the colour at its middle. A block is
      // a whole number of screen pixels, so its edges are crisp.
      float block = 1.0;
      if (uPixel > 0.0) {
        block = mix(1.0, max(1.0, floor(uRes.y / uRows + 0.5)), uPixel);
        vec2 b = block * px;
        uv = (floor(vUv / b) + 0.5) * b;
      }
      vec4 src = texture2D(tDiffuse, uv);
      vec3 col = src.rgb;
      float car = markFigure(src.a);
      // The sky is drawn on the far plane; the land ends well short of it.
      float zc = texture2D(tDepth, uv).r;
      float sky = step(0.999995, zc);
      float wc = invDepth(uv);
      float dist = 1.0 / wc;
      // Not the sky, nor the car and the animals (they keep their own
      // colours and edges, a pixel beside one is left as it is, and so is the
      // glass over the car), nor a flower of the grass (a few pixels across: a
      // stroke would take it), nor what is already flat (no neighbour of the
      // four differs by more than a hair: the strokes would not show on it).
      // The step of the grid is a little shorter far off, half as long near
      // the lens (blades of grass keep their shapes), and half on a building
      // and on leaves.
      if (uPaint > 0.0 && sky < 0.5) {
        vec4 nl = texture2D(tDiffuse, uv - vec2(px.x, 0.0));
        vec4 nr = texture2D(tDiffuse, uv + vec2(px.x, 0.0));
        vec4 nd = texture2D(tDiffuse, uv - vec2(0.0, px.y));
        vec4 nu = texture2D(tDiffuse, uv + vec2(0.0, px.y));
        vec3 d4 = max(max(abs(nl.rgb - col), abs(nr.rgb - col)), max(abs(nd.rgb - col), abs(nu.rgb - col)));
        vec4 na = vec4(nl.a, nr.a, nd.a, nu.a);
        float am = min(src.a, min(min(na.x, na.y), min(na.z, na.w)));
        vec4 gl4 = step(0.835, na) * (1.0 - step(0.89, na));
        float glass = max(max(gl4.x, gl4.y), max(gl4.z, gl4.w));
        glass = max(glass, step(0.835, src.a) * (1.0 - step(0.89, src.a)));
        if (am > 0.75 && glass < 0.5 && max(d4.r, max(d4.g, d4.b)) > uFlatEps && !(src.a > 0.935 && src.a < 0.955)) {
          float ps = mix(1.0, 0.7, smoothstep(140.0, 400.0, dist)) * mix(0.5, 1.0, smoothstep(12.0, 20.0, dist))
            * (1.0 - 0.5 * (markBuilt(src.a) + markLeaf(src.a)));
          col = mix(col, kuwahara(uv, px * uPaintR * ps, uTaps > ${KUWAHARA_MID}), uPaint);
        }
      }
#ifdef FLAT
      if (uFlat > 0.0) {
        // In the sky, where nothing in the rows or down the column bends
        // (the colour is on a straight line across the reach), it is left.
        bool bend = true;
        if (sky > 0.5) {
          vec2 sy = vec2(0.0, uFlatR * px.y);
          vec3 c0 = texture2D(tFlat, uv).rgb;
          vec3 a = texture2D(tFlat, uv - 3.0 * sy).rgb + texture2D(tFlat, uv + 3.0 * sy).rgb - 2.0 * c0;
          vec3 b = texture2D(tFlat, uv - 2.0 * sy).rgb + texture2D(tFlat, uv + 2.0 * sy).rgb - 2.0 * c0;
          vec3 e = texture2D(tFlat, uv - sy).rgb + texture2D(tFlat, uv + sy).rgb - 2.0 * c0;
          vec3 d = max(abs(a), max(abs(b), abs(e)));
          bend = max(d.r, max(d.g, d.b)) >= uSkyEps;
        }
        if (bend) col = mix(col, flatten(uv, px * uFlatR, zc), uFlat);
      }
#endif
      if (uBlock > 0.0 && sky < 0.5) col = mix(col, blockColor(uv, col, zc, wc), uBlock);

      // Grade: saturation (spared on the darkest tones with satDark: there
      // it turns a dark grey ink-blue), contrast, a warmer light, midtones
      // raised.
      float sk = uGrade.x;
      if (uSatDark > 0.0) sk = mix(sk, mix(1.0, sk, smoothstep(0.08, 0.3, luma(col))), uSatDark);
      col = mix(vec3(luma(col)), col, sk);
      col = (col - 0.5) * uGrade.y + 0.5;
      col *= vec3(1.0 + uGrade.z, 1.0 + uGrade.z * 0.3, 1.0 - uGrade.z);
      col = clamp(col, 0.0, 1.0);
      if (uLift > 0.0) col = pow(col, vec3(1.0 - uLift));
      // The darkest greens a deep blue-green, not black: a painter's shade
      // under trees is a colour. Grey and blue-grey (a road, a rock) stay.
      if (uDark > 0.0) {
        float greenish = smoothstep(-0.01, 0.05, col.g - max(col.r, col.b));
        col += vec3(0.05, 0.12, 0.13) * (1.0 - smoothstep(0.0, 0.32, luma(col))) * greenish * uDark;
      }
      // Greens: warmer in the light, cooler in the shade.
      if (uGreen > 0.0) {
        float gm = clamp((col.g - max(col.r, col.b)) * 5.0, 0.0, 1.0);
        vec3 warm = col * vec3(1.16, 1.05, 0.74);
        vec3 cool = col * vec3(0.8, 0.96, 1.14);
        col = mix(col, mix(cool, warm, smoothstep(0.16, 0.5, luma(col))), gm * uGreen);
      }
      // Greens repainted from a painter's three, each at the brightness it
      // was: a blue-green in the shade, an emerald, a fresh yellow-green in
      // the sun. A meadow's yellow-green counts; a yellow does not.
      if (uGreenPal > 0.0) {
        float gy = clamp((col.g - 0.5 * (col.r + col.b)) * 4.0, 0.0, 1.0)
          * smoothstep(0.0, 0.04, col.g - col.r) * smoothstep(0.0, 0.04, col.g - col.b);
        float l = luma(col);
        vec3 pal = mix(uGreenShade, uGreenMid, smoothstep(0.06, 0.34, l));
        pal = mix(pal, uGreenLit, smoothstep(0.36, 0.78, l));
        pal *= (l + uGreenPal * 0.03) / max(luma(pal), 1e-4);
        col = mix(col, clamp(pal, 0.0, 1.0), gy * uGreenPal);
      }
      // A meadow painted, not flat: patches of lighter and darker, yellower
      // and bluer green a few metres across, laid on the ground; and, close
      // by, flowers in drifts. Both stay where they are on the world, and
      // are only on grass (green, facing up).
      if (uMeadow > 0.0 && sky < 0.5) {
        float gm = clamp((col.g - 0.5 * (col.r + col.b)) * 4.0, 0.0, 1.0)
          * smoothstep(0.0, 0.04, col.g - col.r) * smoothstep(0.0, 0.04, col.g - col.b);
        if (gm > 0.01 && dist < 300.0) {
          vec3 P = worldFromZ(uv, zc);
          vec3 Pw = P + uOriginMod;
          float v = (pnoise(Pw.xz / 8.0, 128.0) - 0.5) * 0.8 + (pnoise(Pw.xz / 3.2 + 5.0, 320.0) - 0.5) * 0.4;
          float reach = 1.0 - smoothstep(60.0, 300.0, dist);
          col = mix(col, col * vec3(1.0 + v * 0.5, 1.0 + v * 0.3, 1.0 - v * 0.7), gm * uMeadow * reach);
          if (uFlowers > 0.0 && dist < 48.0) {
            vec3 n = depthNormal(uv, zc, wc, P);
            float up = smoothstep(0.78, 0.92, n.y);
            vec2 g = Pw.xz / 0.64;
            vec2 ci = floor(g);
            vec2 cm = mod(ci, 1600.0);
            float h0 = hash13(vec3(cm, 1.0));
            float drift = smoothstep(0.42, 0.68, pnoise(Pw.xz / 10.0 + 11.0, 102.0));
            float on = step(1.0 - (0.04 + 0.5 * drift), h0);
            vec2 jit = vec2(hash13(vec3(cm, 2.0)), hash13(vec3(cm, 3.0))) - 0.5;
            float dd = length((fract(g) - 0.5 - jit * 0.5) * 0.64);
            float r = 0.075 + 0.04 * hash13(vec3(cm, 4.0));
            float spot = 1.0 - smoothstep(r * 0.65, r, dd);
            float pick = hash13(vec3(cm, 5.0));
            vec3 fc = pick < 0.4 ? vec3(0.98, 0.97, 0.9) : pick < 0.66 ? vec3(1.0, 0.84, 0.25) : pick < 0.86 ? vec3(0.98, 0.62, 0.72) : vec3(0.6, 0.7, 1.0);
            col = mix(col, fc, spot * on * up * gm * uFlowers * (1.0 - smoothstep(0.0, 0.3, uGrassHere)) * (1.0 - smoothstep(20.0, 48.0, dist)));
          }
        }
      }
      // The distance turning blue, layer behind layer, from a little way off.
      if (uFar > 0.0) {
        float f = (1.0 - exp(-max(dist - 150.0, 0.0) / 2600.0)) * (1.0 - sky);
        col = mix(col, vec3(0.5, 0.64, 0.84) * (0.55 + 0.65 * luma(col)), f * uFar * 0.7);
      }
      col = clamp(col, 0.0, 1.0);
      vec3 base = col;

      // Ink on paper: five tones of ink and the paper. Sky and haze stay
      // blank; only what is dark takes the ink, and a wash never goes as
      // dark as a line.
      if (uInk > 0.0) {
        float dens = pow(1.0 - smoothstep(0.04, 0.8, luma(col)), 2.4);
        float q = dens * 5.0;
        float qi = floor(q);
        float tone = (qi + smoothstep(0.25, 0.75, q - qi)) / 5.0;
        tone = min(tone, 0.9);
        // The land never quite the paper: far hills a pale wash. A bright sky
        // is left blank; a dark one (space) keeps its ink, the stars paper.
        tone = max(tone, 0.12 * (1.0 - sky));
        tone *= 1.0 - sky * uBlank * smoothstep(0.3, 0.5, luma(col));
        vec3 ink = mix(uPaper, uInkCol, clamp(tone, 0.0, 1.0));
        vec3 keep = mix(base, base * uPaper, 0.25);
        col = mix(col, mix(ink, keep, car * uKeep), uInk);
      }

      // A woodblock's few colours: the shadows printed in indigo, the lights
      // left as paper, the brightness cut to a few flat levels (the hue
      // kept); its sky a band of indigo printed fading into the paper.
      if (uPrint > 0.0) {
        float l = luma(col);
        col = mix(col, vec3(0.13, 0.2, 0.33) * (0.45 + l), (1.0 - smoothstep(0.06, 0.32, l)) * 0.45 * uPrint);
        col = mix(col, uPaper, smoothstep(0.6, 0.95, l) * 0.7 * uPrint);
      }
      if (uPoster > 0.0) {
        float l = max(luma(col), 1e-4);
        float q = l * uLevels;
        float lq = (floor(q) + smoothstep(0.4, 0.6, fract(q))) / uLevels;
        // A print grades its haze smoothly, as its sky.
        float k = uPoster * (1.0 - sky) * (1.0 - smoothstep(0.6, 0.85, l) * uPrint);
        col = mix(col, clamp(col * (lq / l), 0.0, 1.0), k);
      }
      if (uBokashi > 0.0 && sky > 0.0) {
        vec4 ray = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
        vec3 dir = normalize((uCamWorld * vec4(ray.xyz / ray.w, 0.0)).xyz);
        float e = smoothstep(0.0, 0.42, dir.y);
        float band = floor(e * 4.0) / 4.0;
        vec3 bok = mix(uPaper, vec3(0.12, 0.25, 0.45), mix(e, band, 0.35) * 0.95);
        // Only a day's sky: a night, the inferno's or space's keeps its own.
        // Where the sky has a cloud in it (the sky shader marks it in the alpha, 0.7) the cloud stays.
        float cloud = step(0.62, src.a) * (1.0 - step(0.77, src.a));
        col = mix(col, bok, uBokashi * sky * smoothstep(0.3, 0.5, luma(base)) * (1.0 - cloud));
      }

      // Lines at the edges of things: where the depth jumps (outlines) or
      // its slope breaks (creases), fading with distance.
      if (uLine > 0.0) {
        vec2 o = px * max(uLineW, block);
        float wl = invDepth(uv - vec2(o.x, 0.0));
        float wr = invDepth(uv + vec2(o.x, 0.0));
        float wd = invDepth(uv - vec2(0.0, o.y));
        float wu = invDepth(uv + vec2(0.0, o.y));
        float wmax = max(max(max(wl, wr), max(wd, wu)), wc);
        float jump = max(max(abs(wl - wc), abs(wr - wc)), max(abs(wd - wc), abs(wu - wc))) / wmax;
        float crease = (abs(wl + wr - 2.0 * wc) + abs(wd + wu - 2.0 * wc)) / wc;
        float ej = smoothstep(uJump.x, uJump.y, jump);
        float ec = smoothstep(0.012, 0.04, crease) * uCrease;
        // A figure's outline and the lines between its parts are drawn from its
        // marks (figureInk below); the depth's own lines are kept for what the
        // marks do not tell apart, its creases, the seams of its doors and bonnet,
        // at half.
        if (uLineFig > 0.0) {
          ej = 0.0;
          ec *= ${FIG_INK.crease.toFixed(3)};
        }
        float e = max(ej, ec);
        e *= 1.0 - smoothstep(uLineFar * 0.4, uLineFar, 1.0 / wmax);
        // Where the land meets the sky, and where one ridge stands in front of
        // another far behind it: a line however far off it is.
        if (uRidge > 0.0) {
          float wsky = 1.0005 / uNearFar.y;
          float skyN = max(max(step(wl, wsky), step(wr, wsky)), max(step(wd, wsky), step(wu, wsky)));
          e = max(e, max((1.0 - sky) * skyN, smoothstep(0.3, 0.55, jump) * (1.0 - sky)) * uRidge);
        }
        float near = 1.0;
        if (uLineCar > 0.0) {
          near = car;
          near = max(near, 1.0 - step(0.75, texture2D(tDiffuse, uv - vec2(o.x, 0.0)).a));
          near = max(near, 1.0 - step(0.75, texture2D(tDiffuse, uv + vec2(o.x, 0.0)).a));
          near = max(near, 1.0 - step(0.75, texture2D(tDiffuse, uv - vec2(0.0, o.y)).a));
          near = max(near, 1.0 - step(0.75, texture2D(tDiffuse, uv + vec2(0.0, o.y)).a));
          e *= mix(1.0, near, uLineCar);
        }
        if (uBrush > 0.0 && sky < 0.5) {
          // A brush, thicker and thinner along the stroke and now and then
          // running dry: noise laid on the world where the line is, so it
          // moves with the line. Far off the line is even.
          vec4 vp = uInvProj * vec4(uv * 2.0 - 1.0, zc * 2.0 - 1.0, 1.0);
          vec3 wp = (uCamWorld * vec4(vp.xyz / vp.w, 1.0)).xyz;
          float n1 = vnoise(wp.xz / 7.0) * 0.5 + vnoise(wp.xy / 7.0 + 13.0) * 0.5;
          float n2 = vnoise(wp.zy / 3.0 + 29.0) * 0.5 + vnoise(wp.xz / 3.0 + 41.0) * 0.5;
          float nearB = 1.0 - smoothstep(150.0, 450.0, dist);
          e *= mix(1.0, (0.6 + 0.7 * n1) * mix(1.0, smoothstep(0.12, 0.34, n2), 0.85), uBrush * nearB);
        }
        vec3 lc = mix(uLineCol, base * 0.32, uLineDark);
        col = mix(col, lc, clamp(e, 0.0, 1.0) * uLine);
        // Only where a figure is within a line's width (near, above).
        if (uLineFig > 0.0 && near > 0.5) {
          float fink = figureInk(ivec2(floor(uv * uRes)), src.a, zc);
          if (fink > 0.0) col = mix(col, vec3(${FIG_INK.col.map((x) => x.toFixed(3)).join(', ')}), fink * uLineFig);
        }
      }

      // A console's palette, dithered block by block.
      if (uDither > 0.0) {
        float d = bayer4(mod(floor(gl_FragCoord.xy / block), 4.0)) - 0.5;
        float n = uLevels - 1.0;
        vec3 qc = floor(col * n + 0.5 + d * uDitherK) / n;
        col = mix(col, qc, uDither);
      }

      vec2 v = vUv - 0.5;
      col *= 1.0 - uGrade.w * dot(v, v) * 2.0;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

// The style being drawn, and the move from one to the next.
export class Style {
  constructor(id = 'real') {
    this.id = STYLE_INDEX[id] !== undefined ? id : 'real';
    this.cur = styleParams(this.id);
    this.from = clone(this.cur);
    this.to = clone(this.cur);
    this.t = 1;
    this.wind = [0, 0];   // how far the wind has taken the clouds' shadows
    this.tier = 'high';   // how much there is to draw (render/quality.js)
    this.now = {};   // cur as this world has it (resolve)
    this._nightArr = {};
    this._sceneK = -1;
    this.resolve();
  }

  // The numbers as this world has them: each of the ones a style gives a
  // world with no painted sky of its own (night) is taken between that and
  // the style's own, by how much of a painted sky the world has. Every place
  // that reads these numbers reads now, not cur. A number the same either way
  // is left alone, so a style with no night of its own is drawn as it is.
  // How much of a painted sky the world has, for this style: a painted night
  // counts for the style that takes it as a day (nightSky).
  _skyK() {
    return paintedSky.value + this.cur.nightSky * paintedNight.value;
  }

  resolve() {
    const k = this._skyK();
    const c = this.cur;
    const n = c.night;
    const e = this.now;
    for (const key of Object.keys(c)) if (key !== 'night' && !NIGHT_KEYS.includes(key)) e[key] = c[key];
    for (const key of NIGHT_KEYS) {
      const day = c[key];
      const dark = n[key];
      if (Array.isArray(day)) {
        const out = this._nightArr[key] || (this._nightArr[key] = day.slice());
        for (let i = 0; i < day.length; i++) out[i] = mixNight(dark[i], day[i], k);
        e[key] = out;
      } else {
        e[key] = mixNight(dark, day, k);
      }
    }
    return e;
  }

  // The scene's numbers again when the world's sky has changed under them.
  sync() {
    this.resolve();
    if (this._skyK() !== this._sceneK) this.applyScene();
  }

  // The floating origin has moved: its digits for the shaders (absolute, for
  // broad things; modulo 1 km, for the blocks' texels).
  setOrigin(x, z) {
    styleU.uOriginAbs.value.set(x, 0, z);
    originMod.value.set(((x % 1024) + 1024) % 1024, 0, ((z % 1024) + 1024) % 1024);
  }

  // Every frame: the wind takes the clouds' shadows over the land.
  tick(dt) {
    this.wind[0] = (this.wind[0] + dt * WIND[0]) % 65536;
    this.wind[1] = (this.wind[1] + dt * WIND[1]) % 65536;
    styleU.uCloudDrift.value.set(this.wind[0], this.wind[1]);
  }

  // Draw in style id, turning into it over SWITCH_SECONDS (at once with
  // instant). Returns whether anything changed.
  set(id, instant = false) {
    if (STYLE_INDEX[id] === undefined || (id === this.id && this.t >= 1)) return false;
    this.id = id;
    this.from = clone(this.cur);
    this.to = styleParams(id);
    this.t = instant ? 1 : 0;
    if (instant) this.cur = clone(this.to);
    return true;
  }

  next() {
    return STYLES[(STYLE_INDEX[this.id] + 1) % STYLES.length].id;
  }

  get moving() {
    return this.t < 1;
  }

  // Every frame. Returns whether the numbers moved.
  update(dt) {
    if (this.t >= 1) return false;
    this.t = Math.min(1, this.t + dt / SWITCH_SECONDS);
    const k = this.t * this.t * (3 - 2 * this.t);
    blend(this.cur, this.from, this.to, k);
    if (this.t >= 1) this.cur = clone(this.to);
    return true;
  }

  // The lit materials' and the sky's numbers.
  applyScene() {
    const c = this.resolve();
    this._sceneK = this._skyK();
    const u = styleU;
    u.uPair.value = c.pair;
    u.uAir.value = c.farPaint;
    const want = this.cur.pair > 0;
    if (want !== pairProgram.on) {
      pairProgram.on = want;
      for (const f of pairProgram.listeners) f();
    }
    u.uStyleLit.value = c.lit;
    u.uRampAt.value.fromArray(c.rampAt);
    u.uRampLv.value.fromArray(c.rampLv);
    u.uSunTint.value.fromArray(c.sunTint);
    u.uShadeTint.value.fromArray(c.shade);
    u.uShadeEnv.value.fromArray(c.shadeEnv);
    u.uSpecK.value = c.spec;
    u.uShadowK.value = c.shadow;
    const old = this.cur.night;
    u.uRampAtL.value.fromArray(old.rampAt);
    u.uRampLvL.value.fromArray(old.rampLv);
    u.uShadeTintL.value.fromArray(old.shade);
    u.uShadeEnvL.value.fromArray(old.shadeEnv);
    u.uShadowKL.value = old.shadow;
    u.uStyleMark.value = c.mark > 0.5 ? 1 : 0;
    u.uAlbedoLift.value = c.albedoLift;
    u.uCloudShade.value = c.cloudShade;
    u.uClump.value = c.clump;
    skyStyle.uCumulus.value = c.cumulus;
    skyStyle.uSkyPaint.value = c.skyPaint;
    skyStyle.uSkyDeep.value = c.deep;
    skyStyle.uSkyBlue.value = c.blue;
    skyStyle.uSkySat.value = c.skySat;
    skyStyle.uTowers.value = c.towers;
    skyStyle.uHeaps.value = c.heaps;
    skyLight.cumulus = c.lightCumulus;
    skyLight.skyPaint = c.lightPaint;
    skyLight.towers = c.lightTowers;
    skyStyle.uHeapsTones.value = c.heapsTones;
    skyStyle.uBlockSky.value = c.blockSky;
    skyStyle.uSkyCol.value = c.skyCol;
  }

  // Whether the last pass has anything to do.
  get drawn() {
    const c = this.now;
    return c.paint > 0 || c.flat > 0 || c.line > 0 || c.ink > 0 || c.poster > 0 || c.print > 0 || c.bokashi > 0 || c.pixel > 0
      || c.dither > 0 || c.far > 0 || c.lift > 0 || c.dark > 0 || c.green > 0 || c.greenPal > 0 || c.block > 0
      || c.sat !== 1 || c.contrast !== 1 || c.warm !== 0 || c.vignette > 0;
  }

  // The last pass's numbers.
  applyPass(u, height) {
    const c = this.now;
    u.uBlock.value = c.block;
    u.uBlockK.value = c.blockK;
    u.uBlockJit.value = c.blockJit;
    u.uBlockFace.value = c.blockFace;
    u.uMeadow.value = c.meadow;
    u.uFlowers.value = c.flowers;
    u.uGrassHere.value = grassHere.value;
    u.uOriginMod.value.copy(originMod.value);
    // The low tier draws no strokes; the middle one takes 13 taps of the 25.
    u.uPaint.value = this.tier === 'low' ? 0 : c.paint;
    u.uPaintR.value = c.stroke * height / 1080;
    u.uTaps.value = this.tier === 'mid' ? KUWAHARA_MID : KUWAHARA_TAPS.n;
    u.uFlat.value = c.flat;
    u.uFlatR.value = c.flatR * Math.max(1, height / 760);
    // The middle and low tiers reach two pixels' steps either side, not three.
    u.uFlatN.value = this.tier === 'high' ? 3 : 2;
    u.uLine.value = c.line;
    u.uLineW.value = c.lineW * Math.max(1, height / 900);
    u.uLineCar.value = c.lineCar;
    u.uLineFig.value = c.lineFig;
    u.uLineCol.value.fromArray(c.lineCol);
    u.uLineDark.value = c.lineDark;
    u.uLineFar.value = c.lineFar;
    u.uJump.value.fromArray(c.jump);
    u.uCrease.value = c.crease;
    u.uRidge.value = c.ridge;
    u.uBrush.value = c.brush;
    u.uInk.value = c.ink;
    u.uKeep.value = c.keep;
    u.uPoster.value = c.poster;
    u.uLevels.value = c.levels;
    u.uPrint.value = c.print;
    u.uPixel.value = c.pixel;
    u.uRows.value = c.rows;
    u.uDither.value = c.dither;
    u.uGrade.value.set(c.sat, c.contrast, c.warm, c.vignette);
    u.uPaper.value.fromArray(c.paper);
    u.uInkCol.value.fromArray(c.inkCol);
    u.uBlank.value = c.blank;
    u.uBokashi.value = c.bokashi;
    // The distance turns blue under a day's sky only; a night's, the
    // inferno's or space's air keeps its own colour.
    u.uFar.value = c.far * skyDay.value;
    u.uLift.value = c.lift;
    u.uDark.value = c.dark;
    u.uGreen.value = c.green;
    u.uGreenPal.value = c.greenPal;
    u.uGreenShade.value.fromArray(c.greenShade);
    u.uGreenMid.value.fromArray(c.greenMid);
    u.uGreenLit.value.fromArray(c.greenLit);
    u.uSatDark.value = c.satDark;
    u.uDitherK.value = c.ditherK;
  }
}
