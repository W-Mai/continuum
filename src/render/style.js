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
// the real style the first three are off, and the frame is the frame the light
// makes, with its animals in it and its edges drawn clean (by day it has a sky,
// an exposure, a sky light, a haze and a grade of its own: real, below).

import * as THREE from 'three';
import { COLOURS, INK } from './pixelpal.js';

export const SWITCH_SECONDS = 1.4;

// The least a row of the ink style's far wood is from the next, m (render/terrain.js, inkWoodCover).
const INK_ROW = 1.5;

// The colour of the sky, and of the haze, in the flash of a painted night's
// lightning (linear, as it comes out on the screen).
export const FLASH_WASH = [0.86, 0.42, 0.50];

// The wind that takes the clouds' shadows across the land, metres a second.
export const WIND = [6.5, 2.8];

// The level of the one water surface the worlds have, metres (render/water.js).
export const SEA_LEVEL = 0;

// The six inks of a woodblock print as they are on the page (sRGB): indigo,
// blue, green, ochre, vermilion and black. A world's look says its own
// (look.print); these are the ones it leaves unsaid, and the ones the page has
// before a look is given (render/atmosphere.js keeps printInks to the look's).
export const PRINT_INKS = [0.10, 0.17, 0.33, 0.22, 0.42, 0.62, 0.30, 0.46, 0.30, 0.70, 0.52, 0.30, 0.78, 0.26, 0.16, 0.07, 0.065, 0.06];
export const printInks = Float32Array.from(PRINT_INKS);
// A cloud's three flat tones: the paper, a pale blue, and the pale blue with
// this share of the first ink in it.
export const PRINT_CLOUD = { pale: [0.62, 0.72, 0.82], shade: 0.3 };

// A colour as the last pass tells colours apart: OKLab, from a colour as it is
// on the screen. The curve of sRGB is a cubic that is right to a hundredth of
// the colour; the same one is in the shader (inkLab), so that a pixel and an
// ink are measured with the same ruler.
export function inkLab(c, out) {
  const f = (x) => Math.max(x, 0) * (Math.max(x, 0) * (Math.max(x, 0) * 0.305306011 + 0.682171111) + 0.012522878);
  const r = f(c.x);
  const g = f(c.y);
  const b = f(c.z);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return out.set(
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  );
}

export const STYLES = [
  { id: 'real', name: '写实' },
  { id: 'paint', name: '手绘' },
  { id: 'ink', name: '水墨' },
  { id: 'qianjiang', name: '浅绛' },
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
  tree: 0.93,     // trees: in the leaves' range, and told from what lies about the ground by the ink style, which dots them
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
  tree: [0.925, 0.935],
};

// How much grass there is where the lens is (0 to 1, render/grass.js): the flowers
// the last pass lays on the ground give way to the grass's own.
export const grassHere = { value: 0 };

// The same, for a shader: markLife(a), markCar(a), markBuilt(a), markLeaf(a).
const markEdge = (x) => (Math.abs(x * 100 - Math.round(x * 100)) < 1e-9 ? x.toFixed(2) : x.toFixed(3));
const MARK_GLSL = Object.entries(MARK_RANGE).map(([k, [lo, hi]]) =>
  `float mark${k[0].toUpperCase()}${k.slice(1)}(float a) { return step(${markEdge(lo)}, a) * (1.0 - step(${markEdge(hi)}, a)); }`)
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
  // The paints' own numbers (PAIR is the ones of a style that has no
  // others): how far the shade of a green is turned toward blue, on the land
  // and on a tree, degrees, and how bright the shade is on the lit paint's
  // (the land's, a tree's).
  pairTurn: 24, pairTreeTurn: 54, pairL: 0.58, pairTreeL: 0.82,
  // Where the sun's share of a pixel (the band of the light, what the shadow
  // and the ridges leave of it) goes from the shade paint to the lit one: the
  // wider, the softer the edge of a shadow.
  pairStep: [0.3, 0.7],
  // hand: how much the paints are laid with a hand (the marks of a brush on a
  // road, a line that strays and wears): 1, and 0 for what is made by a rule.
  hand: 1,
  // flatLand: how far the land, and what grows on it, is flat paints: the
  // land one colour for each thing it is (render/terrain.js), the leaves in
  // a few steps of brightness (patchLighting).
  flatLand: 0,
  // The painted style's air (farPaint) is cut into layers: how far (0 to 1: 1
  // is steps, 0 a smooth haze) and how wide the edge of a step is (between
  // these two places in its share).
  airCut: 0.5, airEdge: [0.35, 0.65],
  // figDeep: how much of its deep paint (the underside, the arches' rims) a
  // figure has: 1, or 0 for a style of two paints and a highlight.
  figDeep: 1,
  // Life: fauna, the small animals of a wood (birds, butterflies, deer,
  // rabbits, foxes, a cat), mobs, a block world's animals in their place;
  // blocks: the trees built of blocks; drift: wind drawn across the air in
  // long pale lines, and petals falling on it (render/drift.js); speedLines:
  // the thin white lines along the way a fast car goes (the same file).
  fauna: 1, mobs: 0, blocks: 0, drift: 0, speedLines: 0,
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
  // How wide a star of a painted night is, in pixels of the scene: 2.2, or the one cell
  // of a console's frame.
  starPx: 2.2,
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
  // bloom: the glow round what is bright (1 is on, 0 off: the shapes a console draws have none).
  bloom: 1,
  // skyStep: a day's painted sky as two flat bands (0 to 1: how much), the
  // middle's colour from the height skyAt[0] and the zenith's from skyAt[1]
  // (the sine of the elevation), each of the world's three colours times
  // skyBands (zenith, middle, horizon, three numbers each).
  skyStep: 0, skyAt: [0.12, 0.26], skyBands: [1, 1, 1, 1, 1, 1, 1, 1, 1],
  // real (0 to 1): the real style, which takes what the look gives it alone: a
  // day sky in three colours (realSky) and a share of the exposure, of the sky's
  // light and of the haze (realExpose, realLight, realFog); darks (0 to 1; the
  // real style's, by day only: see night): how hard the darkest tones are
  // pressed down at the last grade (render/post.js).
  real: 0, darks: 0,
  // The real style's air and clouds, by day (see its preset): cloudReal, the baked clouds
  // (heaps) coloured as the light on them would colour them, with the edge soft and a
  // silver one toward the sun, and not in the style's own paints; cirrus, a thin high veil
  // of streaks over the sky; shafts, the light that comes out of the bright places of the
  // sky toward the sun (render/shafts.js); fogVar, how uneven the haze is (0 even; 0.5 a
  // haze half as thick again in some places and half as thick in others, over drifts some
  // hundreds of metres across).
  cloudReal: 0, cirrus: 0, shafts: 0, fogVar: 0,
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
  // like a dry brush with brush; lineThin: the line fades out between this
  // far (m) and lineFar (0: between 0.4 of lineFar and lineFar); jumpNet: the
  // jump of the depth is taken net of the slope (1), so that ground seen at a
  // grazing angle is not an edge;
  // lineFig: a line drawn where the marks of a
  // figure (the car, the animals) change, round it and between its parts,
  // read from the alpha (a part covered by a thing in front is not outlined),
  // the depth's own lines kept at half for its creases; ridge: where the land
  // meets the sky, a line however far (ink lays its lines another way, inkLine,
  // and keeps this one for the car and the animals); ink: an ink wash in five
  // tones on paper, keep: the car keeps its colour; blank: the sky left as paper;
  // poster: brightness cut to levels; print: a woodblock print (the numbers
  // below); bokashi: a day's sky printed as steps of the first ink fading into
  // the paper, and the clouds' marks left for it to find; pixel: a console's frame (PIXEL_PASS), 0 to
  // 1: how far the picture is cells of a grid rows high laid in a palette of
  // 24 colours (render/pixelpal.js), dithered by ditherK; far: the distance turning blue in the last
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
  // it faces (blockFace), the edge of each texel that is next to another face
  // of the world (a wall's foot, a trunk's, a block's) darkened by blockAO
  // over blockAOWidth of the texel, and the texels given way to the frame as
  // it is between the two distances blockFade, in metres (far off a texel is
  // many metres across, and the frame under it shimmers as the lens goes);
  // meadow: patches of lighter and darker, yellower and
  // bluer green laid on grass, and flowers: flowers in drifts close by, both
  // on the world; glow: a soft glow round what is bright.
  // Nothing in it is fixed to the screen but the pixel style's dither: a
  // grain laid on the screen stays put while the world moves under it, and
  // reads as dirt on the lens. The blocks are laid on the world, not on the
  // screen: they move with it. finalVignette: how much of the corners'
  // darkening the final grade has (render/post.js): 1, or 0 for a style whose
  // flat colours are flat to the edge of the frame.
  paint: 0, stroke: 1, flat: 0, flatR: 1.5,
  line: 0, lineW: 1, jump: [0.04, 0.12], crease: 0.8, lineCar: 0, lineCol: [0.1, 0.09, 0.08], lineDark: 0, lineFar: 600,
  lineFig: 0, figJump: 0, lineThin: 0, jumpNet: 0,
  brush: 0, ridge: 0,
  ink: 0, keep: 0, blank: 0, poster: 0, levels: 6, print: 0, bokashi: 0,
  // cun: strokes laid in the ink on rock and slope, down the way the ground
  // falls, a tone deeper than the wash they lie on. cun: how much of them (0
  // none); cunReach: the distances (m) they begin to thin and are gone by;
  // cunSlope: the slope (rise over run) they begin at and the slope where the
  // short cuts of a steep face take over from the long fibres of a gentle one;
  // cunGrass: the share of the strokes left on grass.
  cun: 0, cunReach: [150, 600], cunSlope: [0.15, 0.5], cunGrass: 0.2,
  // ink: how the ink is laid by brightness, distance and height. inkCurve: the
  // brightness at which the five tones begin and the brightness at which there
  // is only paper, and the power of what is between (a lower power thickens the
  // ink sooner), near and far; inkReach: the distances (m) the power goes from
  // its near to its far value over; inkFade: from where a wash thins (m), to
  // where it has thinned the most, the share of it left there, and the darkest
  // a wash goes (a line is darker); inkMist: low land far off lies in a mist of
  // blank paper, from where it begins (m), to where it is whole, how much of
  // the ink it takes, and how far its top wavers (m); inkMistH: where the top
  // of the mist is, in metres above the lens: it is whole under the first
  // number and none over the second, each of them growing with the distance by
  // the third and the fourth number's share of it; inkSky: the one pale wash a
  // dark sky is.
  inkCurve: [0.04, 0.8, 2.4, 2.4], inkReach: [40, 400], inkFade: [60, 2400, 1, 0.9],
  inkMist: [300, 1200, 0, 30], inkMistH: [-50, 10, 0, 0], inkSky: 0.4,
  // ink: how the lines are laid. A line is on the nearer side of a jump in the
  // depth, lineW wide close by and thinning to the last number of inkLine (px,
  // at a height of 900) with the logarithm of the distance, between the first
  // two numbers (m). inkLineTone: its ink is full up to the first number (m),
  // thins to the pale tone (third) at the second and is gone at the fourth;
  // the numbers are 0 to 1, paper to ink. inkDye: far ridges have no line, the
  // land under their edge is dyed instead: from the first distance (m) to the
  // second it comes in, the third number is how far down it reaches (px, at a
  // height of 900) and the fourth its tone at the edge, thinning to none.
  inkLine: [30, 300, 1.8], inkLineTone: [80, 800, 0.4, 1500], inkDye: [600, 1500, 0, 0],
  // ink: water, cloud and snow. inkWater: how far the face of a liquid is left to the
  // paper (0 not at all, 1 whole). inkWave: the strokes laid on it: their ink (0 paper
  // to 1 ink), the share of the cells that hold one, how many pixels thick one is, how
  // many tall and how many wide a cell is (all at a height of 900), and how soft the
  // edge of a stroke is (pixels). inkWaveFar: from how far (m) the cells grow and fewer
  // have a stroke, how far (m) they are done growing, by how much (a share of their
  // size more) and the share of them that have a stroke there; the strokes are gone by
  // 2.5 km. inkSea: what a sea of cloud keeps of the strokes (their ink, their number),
  // how far up (m) the feet of what stands in it are in its mist, and the pale wash it
  // is, not quite the paper. inkMirror: how much of its ink the shore has in the water
  // under it. inkCloud: heads of cloud drawn in a day's sky (0 none, 1 as many as the
  // world's sky has) in a line of this ink, this many pixels thick, with this ink of
  // wash at the foot. inkSnow: the land over the snow line left to the paper (0 none,
  // 1 whole), from this brightness of the frame to this one.
  inkWater: 0, inkWave: [0.32, 0.9, 2.4, 8, 150, 1.5], inkWaveFar: [40, 600, 1, 0.5], inkSea: [0.5, 0.4, 30, 0.07], inkMirror: 0,
  inkCloud: 0, inkCloudLine: [0.38, 1.6, 0.09],
  inkSnow: 0, inkSnowLit: [0.45, 0.7],
  // print (0 to 1: how far): a woodblock print cut from the frame, every
  // pixel that is not the sky's taking the nearest of the world's six inks and
  // the paper (look.print), from the mean of its 3 by 3 over the surface it
  // is on, with the lights of the frame at snapGain times their brightness, a grey (no colour
  // in it, and not a light one) leaned toward blue by snapLean (the red-green
  // and the yellow-blue of OKLab: a grey is printed in blue), and snapW the
  // weights of the lightness, the red-green and the yellow-blue in the
  // distance between two colours. bokAt: the three steps of a day's sky, at
  // these heights (the sine of the elevation), each this wide either way, and
  // cloudAt: where a cloud's three tones part, in brightness on the screen
  // (the light one's and the shaded one's). wood: the grain of the wood in the
  // blocks of one ink, its share of the colour (it runs twenty times as long as
  // it is wide, on the world: along x and across by z and the height, in the
  // sky by the way it is looked at, and it is left out where a cell of it is a
  // few pixels across); regist: how far the plates of colour stand
  // off the key plate, pixels, to the right and down; key: the key plate, the
  // black line, as wide as lineW and wavering by keyJit of its width along its
  // length; foot and footH: low land far off lies in a mist of blank paper (the
  // ink's mist, in the same numbers); sea: the sea blue where it is near and
  // paper far off, in three steps at these distances (m).
  snapGain: 0.8, snapLean: [-0.03, -0.09], snapW: [0.8, 1, 1], bokAt: [0.09, 0.16, 0.23, 0.012], cloudAt: [0.83, 0.6],
  wood: 0, regist: 0, key: 0, keyJit: 0.25,
  foot: [300, 1200, 0, 30], footH: [-10, 30, 0.02, 0.12], sea: 0, seaAt: [60, 140, 300],
  // ink, the leaves: how far what is marked as leaves is laid as dots of ink on a wash (0 to 1: 0 is the
  // brightness cut into five tones, like all else); inkLeafT: the ink of the wash between the dots in the
  // light and in the shade, and of a dot in the light and in the shade (0 is the paper, 1 the thickest ink);
  // inkDot: the cell a dot has (m) near the lens and far off, and the two distances (m) between which the one
  // gives way to the other. inkWood, the far wood: how far it is rows of flat dots laid on the land (0 or 1,
  // render/terrain.js), from where the land paints it (m), where it is whole, how many pixels a row is from the
  // next (px, at a height of 1), where the trees that stand on it end (m), and the ink of its wash and of its dots.
  inkLeaf: 0, inkLeafT: [0.38, 0.52, 0.82, 0.93], inkDot: [0.9, 2.8, 55, 95], inkWood: [0, 330, 480, 11, 400, 0.26, 0.46],
  // ink, a pale colour laid over it (浅绛): where there is ink on the land (not on the paper, the sky, the
  // water or the car), the frame's own colour sorts it into three, and each is laid over with one colour at
  // the brightness the ink is (so the ink is no darker or lighter for it): leaves and what is green with the
  // first of qianInks (sRGB, 汁绿), what is far off (between the two distances of qianFar, m) and what is blue
  // with the second (花青), all else (rock, earth, the road) with the third (赭). qian: how much of the
  // colour (0 none: the ink as it is), and qianTone: the tones of ink (0 to 1) it comes in over.
  qian: 0, qianInks: [0.45, 0.55, 0.30, 0.30, 0.42, 0.55, 0.72, 0.52, 0.34], qianFar: [600, 900], qianTone: [0, 0.05],
  pixel: 0, rows: 180, ditherK: 0.85, pixelSat: 1,
  block: 0, blockK: 0.012, blockJit: 0.14, blockFace: 0.55, blockAO: 0, blockAOWidth: 0.125, blockFade: [200, 480], meadow: 0, flowers: 0, glow: 0,
  // haze: how much of the desert's heat haze the style has (render/post.js, HAZE): the real and the painted styles have it.
  haze: 0,
  far: 0, farPaint: 0, lift: 0, dark: 0, green: 0,
  greenPal: 0, greenShade: [0.16, 0.42, 0.42], greenMid: [0.3, 0.6, 0.25], greenLit: [0.56, 0.78, 0.36],
  sat: 1, satDark: 0, contrast: 1, warm: 0, vignette: 0, finalVignette: 1, paper: [0.95, 0.93, 0.88], inkCol: [0.1, 0.09, 0.085],
  // The last of all (render/present.js). aa: edges drawn clean, by an edge
  // search along each (FXAA); 0 leaves the stairs as they are, as a style of
  // hard blocks wants them. sharp: the detail between the edges made crisper
  // (CAS), the room a colour has before it clips taken into account.
  aa: 1, sharp: 0.2,
};

const PRESETS = {
  // The frame as the light makes it: by day it takes the look's sky in three
  // colours, exposure, sky light and haze (realSky, realExpose, realLight,
  // realFog), and the last grade presses its darkest tones a little further down.
  // The clouds are the baked ones (heaps), lit by the light and not painted (cloudReal),
  // with a veil of cirrus over them, the light of the sun's glare in the air
  // (shafts) and a haze that is thicker in some places than in others (fogVar). A world
  // with no painted sky keeps the sky it had: the old clouds, no shafts, an even haze.
  real: {
    real: 1, darks: 0.08, haze: 1, heaps: 1, cloudReal: 1, cirrus: 1, shafts: 1, fogVar: 0.5,
    night: { darks: 0, heaps: 0, cirrus: 0, shafts: 0, fogVar: 0 },
  },
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
    sat: 1.12, satDark: 1, contrast: 1.06, sharp: 0.15, haze: 1,
  },
  // Ink on paper: five tones of ink (焦 浓 重 淡 清) and the paper, sky and
  // haze left blank, thick ink near and a pale wash far off; lines laid with
  // a brush that runs dry, wide and dark close by and thin and pale far off,
  // the far ridges without one and their edge dyed; the car's orange the only
  // colour on the page.
  ink: {
    mark: 1, flat: 1, flatR: 2.4, line: 1, lineW: 2.4, jump: [0.1, 0.3], crease: 0.25, lineFar: 700, ridge: 1,
    brush: 1, lineCol: [0.07, 0.065, 0.06],
    inkLine: [30, 300, 1.8], inkLineTone: [80, 800, 0.4, 1500], inkDye: [600, 1500, 6, 0.45],
    ink: 1, keep: 1, blank: 1, paper: [0.95, 0.92, 0.85], inkCol: [0.075, 0.07, 0.065], vignette: 0.16,
    inkCurve: [0.04, 0.9, 1.0, 2.4], inkReach: [40, 400], inkFade: [60, 2400, 0.28, 0.93],
    inkMist: [300, 1200, 0.85, 30], inkMistH: [-10, 30, 0.02, 0.12], inkSky: 0.4,
    inkWater: 1, inkCloud: 1, inkSnow: 1, inkMirror: 0.2,
    cun: 1,
    inkLeaf: 1, inkWood: [1, 330, 480, 11, 400, 0.26, 0.46],
    // The last pass smooths half as much: a line a pixel or two wide, smoothed
    // whole, is left paler than the ink it was drawn in.
    aa: 0.5, sharp: 0,
  },
  // Cel animation: every thing two flat paints, a lit one and a shade one with
  // a hard step between them, and a highlight on the car; dark lines in the
  // colour of what they outline, fading out between 80 m and 260 m; a deep
  // sky in two bands with heaped clouds of two tones; a land of flat colours,
  // the far land clean; wind drawn as thin white lines when the car is fast. It
  // is laid on the painted style's numbers (the paired paints, the painter's
  // curve, the far land in faces, the nights painted) with no brush.
  cel: {
    lit: 1, rampAt: [0.2, 0.2, 0.012], rampLv: [0, 0.5, 1], sunTint: [1.04, 1.0, 0.92], pair: 1,
    shade: [1, 1, 1], shadeEnv: [1, 1, 1], spec: 0.25, shadow: 1, mark: 1, albedoLift: 0.06, clump: 0.7,
    cumulus: 0, heaps: 1, heapsTones: 2, lightCumulus: 1, blue: 0.85, skySat: 0.7, fog: 0.25,
    line: 1, lineDark: 0.82, lineFar: 260, lineThin: 80, crease: 0, jumpNet: 1, lineFig: 1, figJump: 1,
    pairTurn: 32, pairTreeTurn: 62, pairL: 0.55, pairTreeL: 0.62, pairStep: [0.46, 0.54], hand: 0, figDeep: 0, flatLand: 1, airCut: 1, airEdge: [0.45, 0.55],
    farPaint: 1, speedLines: 1,
    expose: 0.85, curve: 1, skyCol: 1, nightSky: 1,
    skyStep: 1, skyAt: [0.12, 0.26], skyBands: [0.571, 0.64, 0.903, 0.625, 0.769, 0.972, 0.789, 0.886, 1.024],
    sat: 1.12, contrast: 1.06, finalVignette: 0, sharp: 0,
  },
  // A woodblock print in colours: the world's six inks and the paper, a
  // block to an ink. It is laid on the cel style's numbers (every thing two
  // flat paints, the far land in flat faces and layers of air, the nights
  // painted), and the last pass cuts what that draws into the inks: each pixel
  // the nearest ink, the sky steps of indigo fading into the paper with
  // flat clouds of three tones, a black key line round what is near and plates
  // of colour that stand a pixel off it, a grain of wood in the flat blocks,
  // low land far off lost in blank paper and the sea paler the farther it is.
  print: {
    lit: 1, rampAt: [0.2, 0.2, 0.012], rampLv: [0, 0.5, 1], sunTint: [1.04, 1.0, 0.92], pair: 1,
    shade: [1, 1, 1], shadeEnv: [1, 1, 1], spec: 0.2, shadow: 1, mark: 1, albedoLift: 0.06, clump: 0.5,
    cumulus: 0, heaps: 1, heapsTones: 3, lightCumulus: 1, blue: 0.85, skySat: 0.7, fog: 0.25,
    lineW: 1.4, lineDark: 0, lineFar: 260, lineThin: 80, lineFig: 1,
    pairTurn: 32, pairTreeTurn: 62, pairL: 0.55, pairTreeL: 0.62, pairStep: [0.46, 0.54], hand: 0, figDeep: 0, flatLand: 1, airCut: 1, airEdge: [0.45, 0.55],
    farPaint: 1,
    expose: 0.85, curve: 1, skyCol: 1, nightSky: 1,
    print: 1, bokashi: 1, wood: 0.03, regist: 1, key: 1, foot: [300, 1200, 0.85, 30], sea: 1,
    paper: [0.95, 0.91, 0.81], inkCol: [0.07, 0.065, 0.06],
    finalVignette: 0, aa: 0.8, sharp: 0,
  },
  // An old console: the scene is drawn at twice the cells of a frame 180 rows tall,
  // brought down to the cells (the mean of four) and laid in the 24 colours of the
  // world's palette, the two nearest dithered in a 4 by 4 pattern. What it is
  // laid on is the painted style's light (two paints to a thing in three bands
  // of light, the land in flat colours, the far land in layers of air, a sky in
  // its world's three colours) with no strokes, no lines and no glow, so that
  // a cell has few colours to choose from; the line round the car is the pass's own.
  pixel: {
    lit: 0.9, rampAt: [0.02, 0.12, 0.05], rampLv: [0, 0.5, 1], sunTint: [1.04, 1.0, 0.92], pair: 1,
    shade: [1, 1, 1], shadeEnv: [1, 1, 1], spec: 0.2, shadow: 1, mark: 1, albedoLift: 0.06, clump: 0.7,
    cumulus: 0, heaps: 1, heapsTones: 2, lightCumulus: 1, blue: 0.85, skySat: 0.7, fog: 0.25,
    pairTurn: 28, pairTreeTurn: 58, pairL: 0.56, pairTreeL: 0.7, hand: 0, figDeep: 0, flatLand: 1, airCut: 1, airEdge: [0.4, 0.6],
    farPaint: 1, expose: 0.85, curve: 1, skyCol: 1, nightSky: 1, starPx: 1.2,
    pixel: 1, rows: 180, ditherK: 0.85, pixelSat: 1, bloom: 0, finalVignette: 0, aa: 0, sharp: 0,
  },
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
    block: 1, blockAO: 0.15, poster: 0.5, levels: 10, lift: 0.04,
    greenPal: 0.8, greenShade: [0.14, 0.34, 0.12], greenMid: [0.3, 0.58, 0.2], greenLit: [0.48, 0.74, 0.28],
    sat: 1.25, satDark: 1, contrast: 1.02, aa: 0, sharp: 0,
  },
};

// Ink with a pale colour over it (浅绛): the ink style as it is, and its three colours laid on.
PRESETS.qianjiang = { ...PRESETS.ink, qian: 0.45 };

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
  uHand: { value: 1 },
  uPairStep: { value: new THREE.Vector2(0.3, 0.7) },
  uFlatLand: { value: 0 },
  uAirCut: { value: 0.5 },
  uAirEdge: { value: new THREE.Vector2(0.35, 0.65) },
  uFigDeep: { value: 1 },
  // How far the air is the painted style's (farPaint), and the tone it
  // thins toward: the world's painted horizon, over the exposure it is drawn
  // under, as the sky is (uPaintInv is the sky's own).
  uAir: { value: 0 },
  uAirH: { value: new THREE.Vector3(0.4, 0.7, 0.85) },
  // What the style makes of that tone (the cel style's horizon band): 1.
  uAirTint: { value: new THREE.Vector3(1, 1, 1) },
  // The colour the haze is for as long as a painted night's flash is bright, and how much of it.
  uAirFlash: { value: new THREE.Vector4(...FLASH_WASH, 0) },
  uPairSun: { value: 1 },
  uPairInvSun: { value: 1 },
  // The colour of the light on the paints, from the look (render/atmosphere.js): the lit paints
  // are multiplied by uSkyLit and the shade paints by uSkyShade, the colours of the sun and of
  // the sky's light where they are not the ones the paints are drawn in (1: they are).
  uSkyLit: { value: new THREE.Vector3(1, 1, 1) },
  uSkyShade: { value: new THREE.Vector3(1, 1, 1) },
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
  // The block style's liquids and torches (render/water.js, render/roadmesh.js): how far the
  // style is the block's (x), and how much there is to draw at the tier (y: 1, a half, 0).
  uBlockLiq: { value: new THREE.Vector2(0, 1) },
  // The ink style's far wood, laid on the land (inkWood: whether, from where, whole where, and how fast the rows
  // grow with the distance: the width of a pixel at a metre, times the pixels between rows, over the least a row is).
  uInkWood: { value: new THREE.Vector4(0, 330, 480, 0.1) },
  // The sun's shadow in two maps (render/atmosphere.js): the far one's depth, the matrix that takes a point in
  // the near map's coordinates to the far map's, the biases (x: the near map's per unit of the tangent of the
  // angle between a face's normal and the sun, y: the far map's, z: the far map's constant, each as a share of
  // the depth range; w: how wide the blend at the near map's edge is, as a share of its width), the far map's
  // size in texels, and whether there is a far map (1) or the near one is all there is (0).
  uShFar: { value: null },
  uShFarM: { value: new THREE.Matrix4() },
  uShBias: { value: new THREE.Vector4() },
  uShFarSize: { value: new THREE.Vector2(2048, 2048) },
  uShFarOn: { value: 0 },
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
  uSkyStep: { value: 0 },
  uStarPx: { value: 2.2 },
  uSkyAt: { value: new THREE.Vector2(0.12, 0.26) },
  uBandZ: { value: new THREE.Vector3(1, 1, 1) },
  uBandM: { value: new THREE.Vector3(1, 1, 1) },
  uBandH: { value: new THREE.Vector3(1, 1, 1) },
  // How far the style paints the sky in the three colours of the look's realSky
  // (the real style does; a look with none does not take it).
  uSkyReal: { value: 0 },
  uPaintInv: { value: 1 },
  // How far the baked clouds are the real style's (coloured by the light, a soft edge, a
  // silver one), and how much cirrus there is over the sky.
  uCloudReal: { value: 0 },
  uCirrus: { value: 0 },
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

// How much of the shadow of a cloud there is under the sky of the look (1: as
// the style has it, 0: none): set by atmosphere.js with each change of light.
export const skyCloudShade = { value: 1 };

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
export const PAIR = {
  shadeTurn: 24,         // degrees, toward blue, for a green or a yellow-green
  litShare: 0.6,         // how much of that turn the lit paint of a green takes, on the land and the small things on it: their albedo is a yellower green than a painted meadow (the reference's is 132 to 139 degrees; with none of the turn the hills' was 124, with this 131). A tree's lit paint takes none
  treeTurn: 54,          // the same for a tree (leaves in clumps, styleClump): its shade is bluer than a hill's
  shadeL: 0.58,          // the shade's brightness on the lit one's
  shadeSat: 1.08,
  tree: { lit: 1.15, shadeL: 0.82, shadeSat: 0.72, floor: 0.040 },   // a tree is laid brighter in the light, and its shade is lighter and less full than the land's (the reference's trees: a soft blue-green, not a dark teal), with a floor of its own
  shadeFloor: 0.036,     // the shade at darkest of a small thing marked as leaves (MARK.leaf: a bush, a tuft of grass, a flower); the land's and the road's go as dark as their albedo
  grey: [0.86, 0.93, 1.08],
  duskPull: 0.8,         // how far a world lit by night pulls the colour of a dark side to the colour of its own dark (render/worldlook.js, dusk)
  step: [0.3, 0.7],      // where the sun's share goes from the shade paint to the lit one (a share short of 1 in a sun's light is the shadow map's soft edge and the bake's); a style may say another (pairStep)
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

// The strokes of the ink on rock and slope (STYLE_PASS, cunTone), in metres at
// the scale of 1. hemp: the long fibre of a gentle slope, a stroke `across`
// wide in a cell `cell` wide and `along` long, swaying by `wander` of a cell.
// axe: the short cut of a steep face, `across` wide at its head and `taper`
// of that narrower at its foot, with a ragged edge, in a cell `cell` wide and
// `along` long, tilted off the fall of the slope by up to `tilt` (rise over
// run). long: how many pixels long a stroke is on the screen at the least (a
// stroke is made as long as that on the ground, however slantwise it is seen).
// dirs: the ways round that a stroke may lie (the way the ground falls is taken
// to the two it lies between). px: the least a stroke is across, in pixels at a
// height of 900: the cells grow, a power of two at a time, as the pixels cover
// more of the ground. bright: the brightness (of the frame under the ink) at
// which the strokes begin to thin, and from which there are none. dens: of the
// cells of the fibre and of the cut, the share that hold a stroke where the
// ground is darkest. deeper, deepest: how much deeper a tone than the one under
// it a stroke is, and the deepest it goes (the fourth of the five tones).
const CUN = {
  dirs: 24,
  hemp: { across: 0.35, cell: 1.1, along: 8, long: 96, wander: 0.15 },
  axe: { across: 0.5, cell: 1.2, along: 2.2, long: 29, tilt: 0.47, taper: 0.55 },
  px: 3.2,
  bright: [0.5, 0.88],
  dens: [1.0, 0.95],
  deeper: 0.2, deepest: 0.8,
};

// Water in the ink (STYLE_PASS, inkWater): a pixel is on the face of a liquid when the point
// the depth puts it at is within tol[0] + tol[1] * its distance of the level of the liquid, in
// a world that has one. The strokes laid on it are of the world: the plane is cut in cells (the
// way across the view and the way along it each a power of two, as wide and as tall on the screen
// as the preset says, inkWave), and a stroke in a cell lives `life` seconds, fading in and out;
// its half length is `length[0]` to `length[0] + length[1]` of the cell's width (at most `span`
// pixels), it wavers by `waver` of a pixel and is `taper` thinner at its ends, and the paper round
// it is `gap` times as wide as the stroke. Cells are `cells` powers of two at the most and
// least; the strokes are gone by `gone` m; the pattern is taken along by the wind `drift` of a
// metre for a metre of it. Where the lens is under `low` metres over the level (or under it) the
// water is left to the style's own tones.
const WATER = { tol: [0.1, 0.00015], life: 16, span: 130, length: [0.14, 0.28], waver: 0.8, taper: 0.7, gap: 2.2, gone: 2500, low: 0.3, drift: 0.03, cells: [-1, 10] };
// The reflection of a shore in water (inkMirror): the edge of the water is looked for up the
// column of pixels in `steps` steps that double from `first` pixels, and halved back `halves`
// times; the reflection thins out from `reach[0]` of the frame's height under the edge, and is gone
// by `reach[1]`. `gap` (above) is how many times as wide as a stroke the paper round it is.
const MIRROR = { first: 3, steps: 7, halves: 6, reach: [0.12, 0.3] };

// Heads of cloud in the ink (STYLE_PASS, inkCloud): the dome of the sky is cut in rows
// `row` radians high, and each row in as many cells `col` radians wide as go round at its
// height; a cell has a cloud in it by the share of the sky that is cloud (the world's)
// times `share`, less `thin` of it a row; the cloud is a heap of 4 puffs on a flat base,
// each `puff` of a row for a radius. The line round a puff is gone below `open` of its radius
// over the base (the heads are open at the foot). The drift is how many radians the sky turns for a
// metre the wind has gone. arc: the shade in a puff is a circle `at` of its radius, on the lower
// left (dir).
const CLOUD = { row: 0.2, col: 0.5, share: 0.8, thin: 0.16, puff: 0.19, open: [0.15, 0.9], drift: 0.0006, arc: { at: 0.6, dir: [-0.55, -0.83] } };
// Snow in the ink (STYLE_PASS, inkSnowAt): the edge of it is scattered by a noise `cell` metres across
// (never finer than `px` pixels).
const SNOW = { cell: 7, px: 4 };
// The numbers the worlds give the ink (render/style.js, Style.setWorld): the level of the
// liquid, how much of the world under the lens has one (0 to 1: where its share is what
// the liquid's shader shows) and how much of that is a sea of cloud and how much lava;
// the snow line and how much of the world has snow; how much cloud the sky has.
export const inkWorld = {
  sea: { value: new THREE.Vector4(SEA_LEVEL, 0, 0, 0) },
  snow: { value: new THREE.Vector2(1e5, 0) },
  cloud: { value: 0 },
};
// Whether a world (the data of world/worlds.js) has a liquid, and whether it has snow.
const hasLiquid = (w) => (w.params.water === null || w.params.water === undefined ? 0 : 1);
const hasSnow = (w) => (w.params.snowLine < 1e4 ? 1 : 0);

// The numbers of a material's paints, for its uniforms (withAtmosphere): [the lit
// paint's brightness on the albedo, the shade paint's, how full it is, its
// floor] and [the cosine and the sine of the turn, the share of it the lit
// paint takes]. A tree is turned further, laid brighter in the light, lighter
// and less full in the shade, and its lit paint is not turned. The small
// things marked as leaves are turned as the land they stand on is, and keep a
// floor: turned as far as a tree, a bush in the shade was a teal clump on
// green grass, 40 to 65 degrees of hue from it and lighter than it.
export function pairParams(leaf, tree, n = PAIR_OF_PAINT) {
  const t = tree ? n.tree : null;
  const turn = tree ? n.treeTurn : n.shadeTurn;
  return {
    p: [t ? t.lit : 1, t ? t.shadeL : n.shadeL, t ? t.shadeSat : n.shadeSat, t ? t.floor : (leaf ? n.shadeFloor : 0)],
    // (The fourth: the brightness of the shade of a grey, which has no hue to turn.)
    t: [cosd(turn), sind(turn), t ? 0 : n.litShare, n.shadeL],
  };
}
// The numbers a style gives (the pair... of its numbers), in the form PAIR is.
const PAIR_OF_PAINT = PAIR;
const pairOf = (c) => ({
  ...PAIR, shadeTurn: c.pairTurn, treeTurn: c.pairTreeTurn, shadeL: c.pairL, tree: { ...PAIR.tree, shadeL: c.pairTreeL },
});
// The materials' paints' numbers, one pair of uniforms for each kind of
// material (the land and what is on it, what is marked as leaves, the trees),
// shared by all of them: a style moves them (Style.applyScene).
const PAIR_KINDS = { land: [false, false], leaf: [true, false], tree: [false, true] };
const pairUniform = {};
for (const [k, [leaf, tree]] of Object.entries(PAIR_KINDS)) {
  const pp = pairParams(leaf, tree);
  pairUniform[k] = { p: { value: new THREE.Vector4(...pp.p) }, t: { value: new THREE.Vector4(...pp.t) } };
}
// The uniforms of a material's kind: a tree (it is lit in clumps), a leaf (marked as
// leaves), or the rest.
export const pairUniforms = (leaf, tree) => pairUniform[tree ? 'tree' : leaf ? 'leaf' : 'land'];
// Where the clumps of light in a crown fade out, metres from the lens (a style of flat paints).
const CLUMP_FAR = [25, 90];
// How many steps of brightness a leaf's colour is cut into in an octave of it
// (a style of flat paints): 1.5 is steps of 1.59 times.
const FLAT_STEPS = 1.5;
// Where the sun's share goes from the shade paint to the lit one, as the style
// drawn has it now (Style.applyScene): PAIR.step for a style that does not say.
export const pairStepNow = [...PAIR.step];
export const STYLE_PAIR_GLSL = `
uniform vec4 uPairP;
uniform vec4 uPairT;
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
  shade = mix( a * vec3( ${PAIR.grey.map(f6).join(', ')} ) * uPairT.w, rs, full ) * stShadeK;
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
uniform vec2 uPairStep;
uniform float uFlatLand;
uniform float uFigDeep;
uniform float uPairSun;
uniform float uPairInvSun;
uniform vec3 uSunDirV;
uniform vec3 uPairLit;
uniform vec3 uPairShade;
uniform vec3 uSkyLit;
uniform vec3 uSkyShade;
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
}
#ifdef STYLE_PAIR
// Leaves, and what lies about the ground, in a style of flat paints (uFlatLand):
// the brightness of the colour in steps, not the run of it from tree to tree and
// leaf to leaf.
if ( uFlatLand > 0.0 && ( uClumpSelf > 0.0 || ( uMarkSelf > 0.89 && uMarkSelf < 0.95 ) ) ) {
  float fl = max( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 );
  float fq = exp2( floor( log2( fl ) * ${FLAT_STEPS.toFixed(1)} + 0.5 ) / ${FLAT_STEPS.toFixed(1)} );
  diffuseColor.rgb *= mix( 1.0, fq / fl, uFlatLand );
}
#endif`)
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
uniform sampler2D uShFar;
uniform mat4 uShFarM;
uniform vec4 uShBias;
uniform vec2 uShFarSize;
uniform float uShFarOn;
varying float vShSlope;
// The sun's shadow from the two maps. The near map holds what is close; where a point
// is nearer its edge than the blend is wide the far map takes over, to its own edge
// (a point past that is lit: the land's baked shadow is all there is of it). A face
// turned from the sun is biased by how far it is turned (vShSlope, the tangent of the
// angle between its normal and the sun), as a map's texel is wide: a flat land at a
// low sun needs more than a wall.
float getShadowCascades( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
  float nearBias = shadowBias - uShBias.x * vShSlope;
#ifdef STYLE_FIG
  // A figure in the painted styles takes its paints by what the sun reaches of it: with the land's bias its
  // own parts would lay their shadows on one another (a spoiler's on the boot) and cut the paints with them.
  nearBias -= 0.00059;
#endif
  if ( uShFarOn < 0.5 ) return getShadow( shadowMap, shadowMapSize, nearBias, shadowRadius, shadowCoord );
  vec3 c = shadowCoord.xyz / shadowCoord.w;
  float wn = smoothstep( 0.0, uShBias.w, min( min( c.x, 1.0 - c.x ), min( c.y, 1.0 - c.y ) ) );
  float v = 1.0;
  if ( wn > 0.0 ) v = getShadow( shadowMap, shadowMapSize, nearBias, shadowRadius, shadowCoord );
  if ( wn < 1.0 ) {
    vec4 f = uShFarM * vec4( c, 1.0 );
    float vf = getShadow( uShFar, uShFarSize, - uShBias.z - uShBias.y * vShSlope, shadowRadius, vec4( f.xyz, 1.0 ) );
    vf = mix( 1.0, vf, smoothstep( 0.0, 0.04, min( min( f.x, 1.0 - f.x ), min( f.y, 1.0 - f.y ) ) ) );
    v = mix( vf, v, wn );
  }
  return v;
}
// A cast shadow's soft edge drawn crisp.
float getShadowStyle( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
  float v = getShadowCascades( shadowMap, shadowMapSize, shadowBias, shadowRadius, shadowCoord );
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
  // (In a style of flat paints the clumps are for the trees that are near: far off they are a speckle a pixel or two across.)
  float clumpK = 1.0;
#ifdef STYLE_PAIR
  clumpK = 1.0 - uFlatLand * smoothstep( ${CLUMP_FAR[0].toFixed(1)}, ${CLUMP_FAR[1].toFixed(1)}, length( vViewPosition ) );
#endif
  normal = normalize( normal + bn * 0.6 * uClump * uClumpSelf * leafy * clumpK );
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
  pLit *= uSkyLit;
  pShade *= uSkyShade;
  pDeep *= uSkyShade;
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
  vec3 tone = mix( mix( pShade, pLit, lk ), pDeep, dk * uFigDeep );
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
  pLit *= uSkyLit;
  pShade *= uSkyShade;
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
  float pk = smoothstep( uPairStep.x, uPairStep.y, saturate( stPairK ) ) * stPairC;
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
    uFigJump: { value: 0 },
    uLineCol: { value: new THREE.Vector3() },
    uLineDark: { value: 0 },
    uLineFar: { value: 600 },
    uLineThin: { value: 0 },
    uJump: { value: new THREE.Vector2(0.04, 0.12) },
    uJumpNet: { value: 0 },
    uCrease: { value: 0.8 },
    uRidge: { value: 0 },
    uCun: { value: 0 },
    uCunReach: { value: new THREE.Vector2(150, 600) },
    uCunSlope: { value: new THREE.Vector2(0.15, 0.5) },
    uCunGrass: { value: 0.2 },
    uCunPx: { value: CUN.px },
    uBrush: { value: 0 },
    uInk: { value: 0 },
    uInkCurve: { value: new THREE.Vector4(0.04, 0.8, 2.4, 2.4) },
    uInkReach: { value: new THREE.Vector2(40, 400) },
    uInkFade: { value: new THREE.Vector4(60, 2400, 1, 0.9) },
    uInkMist: { value: new THREE.Vector4(300, 1200, 0, 30) },
    uInkMistH: { value: new THREE.Vector4(-50, 10, 0, 0) },
    uInkSky: { value: 0.4 },
    uInkLine: { value: new THREE.Vector4(30, 300, 1.8, 1) },
    uInkLineT: { value: new THREE.Vector4(80, 800, 0.4, 1500) },
    uInkDye: { value: new THREE.Vector4(600, 1500, 0, 0) },
    uInkLeaf: { value: 0 },
    uInkLeafT: { value: new THREE.Vector4(0.38, 0.52, 0.82, 0.93) },
    uInkLand: { value: new THREE.Vector2(0.26, 0.46) },
    uInkDot: { value: new THREE.Vector4(1138, 366, 55, 95) },
    uInkH: { value: 900 },
    uInkWater: { value: 0 },
    uInkSea: { value: new THREE.Vector4(SEA_LEVEL, 0, 0, 0) },
    uInkWave: { value: new THREE.Vector4(0.32, 0.9, 2.4, 8) },
    uInkWaveB: { value: new THREE.Vector2(150, 1.5) },
    uInkWaveFar: { value: new THREE.Vector4(40, 600, 1, 0.5) },
    uInkSeaLook: { value: new THREE.Vector4(0.5, 0.4, 30, 0.07) },
    uInkMode: { value: new THREE.Vector3(0, 0, 0) },
    uInkMirror: { value: 0 },
    uInkCloud: { value: new THREE.Vector4(0, 0.38, 1.6, 0.09) },
    uInkSnow: { value: new THREE.Vector4(1e5, 0, 0.45, 0.7) },
    uInkWind: { value: new THREE.Vector2() },
    uOriginAbs: { value: new THREE.Vector3() },
    uKeep: { value: 0 },
    uQian: { value: 0 },
    uQianInks: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    uQianAt: { value: new THREE.Vector4(600, 900, 0, 0.05) },
    uPoster: { value: 0 },
    uLevels: { value: 6 },
    uPrint: { value: 0 },
    uGrade: { value: new THREE.Vector4(1, 1, 0, 0) },
    uPaper: { value: new THREE.Vector3(1, 1, 1) },
    uInkCol: { value: new THREE.Vector3() },
    uBlank: { value: 0 },
    uBokashi: { value: 0 },
    uSkyDay: { value: 1 },
    uSnapGain: { value: 1 },
    uSnapW: { value: new THREE.Vector3(0.8, 1, 1) },
    uSnapLean: { value: new THREE.Vector2(-0.03, -0.09) },
    uSnapR: { value: 1 },
    uInks: { value: Array.from({ length: 7 }, () => new THREE.Vector3()) },
    uInkLab: { value: Array.from({ length: 7 }, () => new THREE.Vector3()) },
    uCloudInk: { value: Array.from({ length: 3 }, () => new THREE.Vector3()) },
    uCloudAt: { value: new THREE.Vector2(0.83, 0.6) },
    uBokAt: { value: new THREE.Vector4(0.09, 0.16, 0.23, 0.012) },
    uWood: { value: 0 },
    uRegist: { value: 0 },
    uKey: { value: 0 },
    uKeyJit: { value: 0.25 },
    uFoot: { value: new THREE.Vector4(300, 1200, 0, 30) },
    uFootH: { value: new THREE.Vector4(-10, 30, 0.02, 0.12) },
    uSea: { value: new THREE.Vector2(SEA_LEVEL, 0) },
    uSeaAt: { value: new THREE.Vector3(60, 140, 300) },
    uFar: { value: 0 },
    uLift: { value: 0 },
    uDark: { value: 0 },
    uGreen: { value: 0 },
    uGreenPal: { value: 0 },
    uGreenShade: { value: new THREE.Vector3() },
    uGreenMid: { value: new THREE.Vector3() },
    uGreenLit: { value: new THREE.Vector3() },
    uSatDark: { value: 0 },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uViewProj: { value: new THREE.Matrix4() },
    uOriginMod: { value: new THREE.Vector3() },
    uBlock: { value: 0 },
    uBlockK: { value: 0.012 },
    uBlockJit: { value: 0.14 },
    uBlockFace: { value: 0.55 },
    uBlockAO: { value: new THREE.Vector3(0, 0.125, 1) },
    uBlockFade: { value: new THREE.Vector2(200, 480) },
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
    uniform float uFigJump;
    uniform vec3 uLineCol;
    uniform float uLineDark;
    uniform float uLineFar;
    uniform float uLineThin;
    uniform vec2 uJump;
    uniform float uJumpNet;
    uniform float uCrease;
    uniform float uRidge;
#ifdef FLAT
    uniform float uCun;
    uniform vec2 uCunReach;
    uniform vec2 uCunSlope;
    uniform float uCunGrass;
    uniform float uCunPx;
    uniform float uInkWater;
    uniform vec4 uInkSea;
    uniform vec4 uInkWave;
    uniform vec2 uInkWaveB;
    uniform vec4 uInkWaveFar;
    uniform vec4 uInkSeaLook;
    uniform vec3 uInkMode;
    uniform float uInkMirror;
    uniform vec4 uInkCloud;
    uniform vec4 uInkSnow;
    uniform vec2 uInkWind;
#endif
    uniform float uBrush;
    uniform float uInk;
    uniform vec4 uInkCurve;
    uniform vec2 uInkReach;
    uniform vec4 uInkFade;
    uniform vec4 uInkMist;
    uniform vec4 uInkMistH;
    uniform float uInkSky;
    uniform vec4 uInkLine;
    uniform vec4 uInkLineT;
    uniform vec4 uInkDye;
    uniform float uInkLeaf;
    uniform vec4 uInkLeafT;
    uniform vec2 uInkLand;
    uniform vec4 uInkDot;
    uniform float uInkH;
    uniform vec3 uOriginAbs;
    uniform float uKeep;
    uniform float uQian;
    uniform vec3 uQianInks[3];
    uniform vec4 uQianAt;
    uniform float uPoster;
    uniform float uLevels;
    uniform float uPrint;
    uniform vec4 uGrade;
    uniform vec3 uPaper;
    uniform vec3 uInkCol;
    uniform float uBlank;
    uniform float uBokashi;
    uniform float uSkyDay;
    uniform float uSnapGain;
    uniform vec3 uSnapW;
    uniform vec2 uSnapLean;
    uniform float uSnapR;
    uniform vec3 uInks[7];
    uniform vec3 uInkLab[7];
    uniform vec3 uCloudInk[3];
    uniform vec2 uCloudAt;
    uniform vec4 uBokAt;
    uniform float uWood;
    uniform float uRegist;
    uniform float uKey;
    uniform float uKeyJit;
    uniform vec4 uFoot;
    uniform vec4 uFootH;
    uniform vec2 uSea;
    uniform vec3 uSeaAt;
    uniform float uFar;
    uniform float uLift;
    uniform float uDark;
    uniform float uGreen;
    uniform float uGreenPal;
    uniform vec3 uGreenShade;
    uniform vec3 uGreenMid;
    uniform vec3 uGreenLit;
    uniform float uSatDark;
    uniform mat4 uInvProj;
    uniform mat4 uCamWorld;
    uniform mat4 uViewProj;
    uniform vec3 uOriginMod;
    uniform float uBlock;
    uniform float uBlockK;
    uniform float uBlockJit;
    uniform float uBlockFace;
    uniform vec3 uBlockAO;
    uniform vec2 uBlockFade;
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
    // A dot of ink on a face of the world, a leaf's. The face's two axes (metres, with the floating origin's digits
    // modulo a kilometre added) are cut into cells (1024 / per) across, as many to the kilometre as there are whole
    // ones, so that they come round again where the origin does; each cell has one dot, its middle a little off the
    // cell's, its long side up and down or leaning to either side, as the three strokes of the character ge do. aa is
    // how far, in metres, an edge is soft (a pixel and a bit). 1 where the dot is, 0 where it is not.
#ifdef FLAT
    // A dot is an ellipse 0.18 by 0.42 of a cell (half sides), a quarter of it.
    const vec2 LEAF_DOT = vec2(0.18, 0.42);
    const float LEAF_MEAN = 0.2375;
    float inkDotAt(vec2 q, float per, float aa, float dens0, float nper) {
      float s = 1024.0 / per;
      vec2 c = q / s;
      vec2 ic = floor(c);
      vec2 f = c - ic - 0.5;
      vec2 cm = mod(ic, per);
      float h0 = hash13(vec3(cm, 3.0));
      float h1 = hash13(vec3(cm, 7.0));
      float h2 = hash13(vec3(cm, 11.0));
      float h3 = hash13(vec3(cm, 17.0));
      float h4 = hash13(vec3(cm, 23.0));
      // Dots come in clusters: more of the cells have one where a slow noise (nper cells to the kilometre) is high, and in the shade.
      float dens = clamp(dens0 + (pnoise(q * nper / 1024.0, nper) - 0.5) * 0.9, 0.0, 1.0);
      f -= vec2(h1 - 0.5, h2 - 0.5) * 0.14;
      float a = (floor(h0 * 3.0) - 1.0) * 0.62;
      float ca = cos(a);
      float sa = sin(a);
      vec2 r = vec2(ca * f.x + sa * f.y, ca * f.y - sa * f.x);
      float k = 0.8 + 0.3 * h3;
      float e = length(r / (LEAF_DOT * k));
      float w = aa / (s * LEAF_DOT.x * k);
      return (1.0 - smoothstep(1.0 - w, 1.0 + w, e)) * step(h4, dens);
    }
#endif

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

#ifdef FLAT
    // The same, with the steps a pixel takes to the right and up along the
    // surface (what one pixel covers of it).
    vec3 depthSurface(vec2 uv, float zc, float wc, vec3 P, out vec3 ex, out vec3 ey) {
      vec2 d = 1.0 / uRes;
      vec2 ox = vec2(d.x, 0.0);
      vec2 oy = vec2(0.0, d.y);
      float zr = texture2D(tDepth, uv + ox).r;
      float zl = texture2D(tDepth, uv - ox).r;
      float zu = texture2D(tDepth, uv + oy).r;
      float zd = texture2D(tDepth, uv - oy).r;
      ex = abs(invFromZ(zr) - wc) < abs(wc - invFromZ(zl)) ? worldFromZ(uv + ox, zr) - P : P - worldFromZ(uv - ox, zl);
      ey = abs(invFromZ(zu) - wc) < abs(wc - invFromZ(zd)) ? worldFromZ(uv + oy, zu) - P : P - worldFromZ(uv - oy, zd);
      vec3 n = cross(ex, ey);
      float nl = length(n);
      if (nl < 1e-9) return vec3(0.0);
      n /= nl;
      return dot(n, uCamWorld[3].xyz - P) < 0.0 ? -n : n;
    }

    // Strokes of ink on rock and slope. q is where a pixel is on a sheet of the
    // world laid with cells, across and down the way the ground falls (metres);
    // su and sv the sizes of the cells across and down (powers of two, the
    // pixels make them as big as they need be); fp the metres a pixel covers
    // across and down; seed which sheet it is; dens the share of cells that hold
    // a stroke. What comes back is how much of the pixel the stroke takes, and
    // how heavy it is there.
    // The fibre: a long thin stroke, each column of cells a length of its own
    // down the slope, thin at both ends, swaying a little as it goes.
    float cunHemp(vec2 q, float su, float sv, vec2 fp, float seed, float dens) {
      vec2 cell = vec2(${CUN.hemp.cell.toFixed(3)} * su, ${CUN.hemp.along.toFixed(3)} * sv);
      float ci = floor(q.x / cell.x);
      float ph = hash12(vec2(ci, seed));
      float rj = floor(q.y / cell.y + ph);
      float h = hash12(vec2(ci + seed * 17.0, rj + 0.5));
      float on = clamp((dens - h) * 8.0, 0.0, 1.0);
      if (on <= 0.0) return 0.0;
      float r = fract(h * 97.3 + 0.37);
      vec2 l = vec2(fract(q.x / cell.x), fract(q.y / cell.y + ph));
      float x0 = (0.5 + (fract(r * 13.7) - 0.5) * 0.3 + ${CUN.hemp.wander.toFixed(3)} * sin(l.y * 6.2832 * (1.0 + fract(r * 3.3)) + r * 40.0)) * cell.x;
      float hw = ${(CUN.hemp.across / 2).toFixed(4)} * su * (0.7 + 0.6 * fract(r * 5.3)) * (0.8 + 0.4 * sin(l.y * 9.0 + r * 20.0));
      // How much of the pixel's width across (fp.x) the stroke covers, from the
      // stroke's edges and the pixel's: a stroke narrower than a pixel is faint,
      // not a wide soft band.
      float dx = l.x * cell.x - x0;
      float across = max(min(hw, dx + 0.5 * fp.x) - max(-hw, dx - 0.5 * fp.x), 0.0) / max(fp.x, 1e-3);
      float len = 0.55 + 0.45 * fract(r * 7.9);
      float top = (1.0 - len) * fract(r * 3.1);
      float ew = clamp(fp.y / cell.y, 0.02, 0.5);
      float down = smoothstep(top, top + 0.25 + ew, l.y) * (1.0 - smoothstep(top + len - 0.3, top + len + ew, l.y));
      return across * down * on * (0.65 + 0.35 * fract(r * 17.3));
    }
    // The cut: a short stroke, wide at its head and thinning to its foot, heavy
    // at the head and light at the foot, each leaning its own way; each row of
    // cells begins its columns somewhere else.
    float cunAxe(vec2 q, float su, float sv, vec2 fp, float seed, float dens) {
      vec2 cell = vec2(${CUN.axe.cell.toFixed(3)} * su, ${CUN.axe.along.toFixed(3)} * sv);
      float rj = floor(q.y / cell.y);
      float off = hash12(vec2(rj, seed + 0.3));
      float ci = floor(q.x / cell.x + off);
      float h = hash12(vec2(ci + seed * 17.0, rj));
      float on = clamp((dens - h) * 8.0, 0.0, 1.0);
      if (on <= 0.0) return 0.0;
      float r = fract(h * 97.3 + 0.37);
      vec2 l = vec2(fract(q.x / cell.x + off), fract(q.y / cell.y));
      float tilt = (fract(r * 11.3) * 2.0 - 1.0) * ${CUN.axe.tilt.toFixed(3)};
      float x0 = (0.5 + (fract(r * 5.7) - 0.5) * 0.3) * cell.x;
      float len = 0.5 + 0.45 * fract(r * 7.1);
      float top = (1.0 - len) * fract(r * 2.3);
      float t = clamp((l.y - top) / len, 0.0, 1.0);
      float dx = l.x * cell.x - x0 - tilt * (l.y - 0.5) * cell.y;
      float hw = ${(CUN.axe.across / 2).toFixed(4)} * su * (1.0 - ${CUN.axe.taper.toFixed(2)} * t) * (0.75 + 0.5 * hash12(vec2(floor(l.y * 7.0) + ci, rj + seed)));
      float across = max(min(hw, dx + 0.5 * fp.x) - max(-hw, dx - 0.5 * fp.x), 0.0) / max(fp.x, 1e-3);
      float ew = clamp(fp.y / cell.y, 0.02, 0.5);
      float down = smoothstep(top - ew, top + ew, l.y) * (1.0 - smoothstep(top + len - ew, top + len + ew, l.y));
      return across * down * on * (1.0 - 0.6 * t);
    }
    // One kind of stroke (0 the fibre, 1 the cut) laid on the sheet: lu is how big
    // the cells are across (as a power of two, from the pixels: a stroke is not
    // less than uCunPx pixels across), and down they are as big as a stroke needs to
    // be to be as many pixels long on the screen (${CUN.hemp.long} for a fibre, ${CUN.axe.long} for a cut, at
    // ${CUN.px} pixels across), however slantwise the ground is seen. The two sizes
    // either side of each are blended.
    float cunLayer(int kind, vec2 q, vec2 fp, float lu, float seed, float dens) {
      float lv = max(lu, log2(max(fp.y, 1e-4) * uCunPx * (kind == 0 ? ${(CUN.hemp.long / CUN.px / (0.75 * CUN.hemp.along)).toFixed(4)} : ${(CUN.axe.long / CUN.px / (0.75 * CUN.axe.along)).toFixed(4)})));
      float lu0 = floor(lu);
      float lv0 = floor(lv);
      float wu = 1.0 - smoothstep(0.3, 0.7, lu - lu0);
      float wv = 1.0 - smoothstep(0.3, 0.7, lv - lv0);
      float acc = 0.0;
      for (int a = 0; a < 2; a++) {
        float wa = a == 0 ? wu : 1.0 - wu;
        if (wa < 0.002) continue;
        for (int b = 0; b < 2; b++) {
          float wb = b == 0 ? wv : 1.0 - wv;
          if (wb < 0.002) continue;
          float la = lu0 + float(a);
          float lb = max(lv0 + float(b), la);
          float sd = seed + la * 7.3 + lb * 3.1 + (kind == 0 ? 0.0 : 0.7);
          acc += wa * wb * (kind == 0 ? cunHemp(q, exp2(la), exp2(lb), fp, sd, dens) : cunAxe(q, exp2(la), exp2(lb), fp, sd, dens));
        }
      }
      return acc;
    }
    // The tone of the ink at a pixel with the strokes laid on it: where one
    // is, the tone is a step deeper than the wash (no deeper than deepest). The
    // way the ground falls comes from the depth; the strokes are of the world,
    // so they move with it.
    float cunTone(float tone, vec2 uv, float zc, float wc, float dist, float lum, vec3 col) {
      float reach = 1.0 - smoothstep(uCunReach.x, uCunReach.y, dist);
      float dark = 1.0 - smoothstep(${CUN.bright[0].toFixed(2)}, ${CUN.bright[1].toFixed(2)}, lum);
      // How much deeper a stroke is than the wash: none where the wash is as deep as it goes.
      float room = min(tone + ${CUN.deeper.toFixed(2)}, ${CUN.deepest.toFixed(2)}) - tone;
      if (reach * dark < 0.01 || room < 0.04) return tone;
      vec3 P = worldFromZ(uv, zc);
      vec3 ex;
      vec3 ey;
      vec3 n = depthSurface(uv, zc, wc, P, ex, ey);
      float hz = length(n.xz);
      float slope = hz / max(n.y, 0.02);
      float gentle = smoothstep(uCunSlope.x - 0.05, uCunSlope.x + 0.05, slope) * step(0.02, n.y);
      if (gentle <= 0.0) return tone;
      float steep = smoothstep(uCunSlope.y - 0.12, uCunSlope.y + 0.12, slope);
      vec2 f = n.xz / max(hz, 1e-4);
      // The two of the ways round that the fall lies between, and how far it
      // is toward the second.
      float at = atan(f.y, f.x) * ${(CUN.dirs / (2 * Math.PI)).toFixed(6)};
      float k0 = floor(at);
      float wb = smoothstep(0.3, 0.7, at - k0);
      // How big the cells are across (a power of two): a stroke is uCunPx pixels
      // wide where a pixel covers 2 tan(fov / 2) dist / height metres of the
      // ground. From the distance, not from the steps of the surface: they jump
      // from one facet of the land to the next.
      float lu = max(log2(uCunPx * dist * 2.0 * uInvProj[1][1] / uRes.y / ${CUN.hemp.across.toFixed(3)}), -1.0);
      vec2 pa = P.xz + uOriginAbs.xz;
      // Grass has few of them (green, and facing up).
      float gm = clamp((col.g - 0.5 * (col.r + col.b)) * 4.0, 0.0, 1.0)
        * smoothstep(0.0, 0.04, col.g - col.r) * smoothstep(0.0, 0.04, col.g - col.b);
      float keep = mix(1.0, uCunGrass, gm * smoothstep(0.75, 0.93, n.y));
      float densH = ${CUN.dens[0].toFixed(2)} * dark * keep;
      float densA = ${CUN.dens[1].toFixed(2)} * dark * keep;
      float acc = 0.0;
      for (int i = 0; i < 2; i++) {
        float wd = i == 0 ? 1.0 - wb : wb;
        if (wd < 0.002) continue;
        float kk = k0 + float(i);
        float ang = kk * ${(2 * Math.PI / CUN.dirs).toFixed(7)};
        vec2 d = vec2(cos(ang), sin(ang));
        vec2 e = vec2(-d.y, d.x);
        vec2 q = vec2(dot(pa, e), dot(pa, d) - P.y);
        vec2 fp = vec2(abs(dot(ex.xz, e)) + abs(dot(ey.xz, e)), abs(dot(ex.xz, d) - ex.y) + abs(dot(ey.xz, d) - ey.y));
        float seed = mod(kk, ${CUN.dirs.toFixed(1)}) * 31.7;
        float c = 0.0;
        if (steep < 0.998) c += (1.0 - steep) * cunLayer(0, q, fp, lu, seed, densH);
        if (steep > 0.002) c += steep * cunLayer(1, q, fp, lu, seed, densA);
        acc += wd * c;
      }
      float cov = clamp(acc, 0.0, 1.0) * reach * gentle * (0.4 + 0.6 * dark);
      return tone + room * cov * uCun;
    }

    // The ray from the lens through a point of the screen, in the world, and the
    // point where it meets the plane y = level (below the lens).
    vec3 inkRay(vec2 uv) {
      vec4 r = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
      return (uCamWorld * vec4(r.xyz / r.w, 0.0)).xyz;
    }
    vec3 inkPlane(vec2 uv, float level) {
      vec3 d = inkRay(uv);
      return uCamWorld[3].xyz + d * ((level - uCamWorld[3].y) / min(d.y, -1e-4));
    }
    // The strokes on the water. A stroke is a long thin line across the view, in a cell of a lattice laid on the
    // plane of the liquid: the lattice is of the world, its cells are as wide and as tall on the screen
    // as the style says wherever the water is (a power of two of metres either way, one size passing into the
    // next as the water goes off), and it is cut along a way across the view that is one of eight
    // (whole numbers, so that it stays put when the floating origin moves a kilometre and has no seam
    // when it does); the lens between two of them has the strokes of both, one coming in as the other
    // goes. a and b are where the pixel is along the lattice and across it, in the lattice's own units, fa and fb how
    // many of them a pixel covers, sx and sy the size of a cell (and kx, ky its powers of two), share the
    // share of cells that hold a stroke. The first of the two numbers that come back is how much of the pixel
    // the stroke covers, 0 to 1, the second how much the paper round it, a few lines wide, does.
    vec2 inkWaveCell(float a0, float b, float sx, float sy, float kx, float ky, float fa, float fb, float clock, float share, float thick, float soft) {
      float cy = floor(b / sy);
      float my = mod(cy, 1024.0 / sy);
      // Every row of cells begins somewhere else along its length.
      float a = a0 + hash12(vec2(my + ky * 1.9 + 41.7, kx * 3.3 + 2.1)) * sx;
      float cx = floor(a / sx);
      float mx = mod(cx, 1024.0 / sx);
      float ph = clock * ${(1 / WATER.life).toFixed(5)} + hash12(vec2(mx + kx * 7.31 + 3.3, my + ky * 3.7 + 1.7));
      float cyc = floor(ph);
      float life = ph - cyc;
      float s1 = cyc * 3.17;
      float s2 = kx * 5.71 + ky * 2.3;
      float on = 1.0 - smoothstep(share - 0.06, share, hash12(vec2(mx + s1, my + s2)));
      if (on <= 0.0) return vec2(0.0);
      float ha = hash12(vec2(my + s1 + 11.0, mx + s2 + 11.0));
      float hb = hash12(vec2(mx * 1.7 + s2 + 5.0, my * 1.7 + s1 + 5.0));
      float hc = hash12(vec2(mx * 0.9 + s1 + 23.0, my * 0.9 + s2 + 23.0));
      // The stroke is whole in its cell: its middle is where its ends stay in.
      float hlc = ${WATER.length[0].toFixed(2)} + ${WATER.length[1].toFixed(2)} * hc;
      float hl = min(sx * hlc, ${WATER.span.toFixed(1)} * fa);
      float u = (a - (cx + 0.5 + (2.0 * ha - 1.0) * (0.5 - hlc)) * sx) / hl;
      if (abs(u) >= 1.0) return vec2(0.0);
      float across = (b - (cy + 0.15 + 0.7 * hb) * sy) / fb + ${WATER.waver.toFixed(2)} * sin(u * 2.6 + hb * 6.2832);
      float w = 0.5 * thick * (1.0 - ${WATER.taper.toFixed(2)} * u * u);
      float k = clamp((1.0 - abs(u)) * hl / max(fa, 1e-4), 0.0, 1.0) * on * (0.75 + 0.5 * hc);
      float f = sin(3.14159 * life);
      vec2 y = clamp(vec2(w - abs(across), ${WATER.gap.toFixed(1)} * w - abs(across)) / soft + 0.5, 0.0, 1.0);
      return y * y * (3.0 - 2.0 * y) * (k * f * f);
    }
    // One lattice of them, along v (whole numbers), the plane's point q and how far a pixel to the right and a pixel up lands from it.
    vec2 inkWaveLattice(vec2 q, vec2 v, vec3 Jx, vec3 Jy, float clock, float share, float thick, float grow) {
      vec2 n = vec2(-v.y, v.x);
      float fa = abs(dot(Jx.xz, v)) + abs(dot(Jy.xz, v));
      float fb = abs(dot(Jx.xz, n)) + abs(dot(Jy.xz, n));
      float lx = clamp(log2(max(grow * uInkWaveB.x * max(uInkLine.w, 1.0) * fa, 1e-3)), ${WATER.cells[0].toFixed(1)}, ${WATER.cells[1].toFixed(1)});
      float ly = clamp(log2(max(grow * uInkWave.w * max(uInkLine.w, 1.0) * fb, 1e-3)), ${WATER.cells[0].toFixed(1)}, ${WATER.cells[1].toFixed(1)});
      float kx = floor(lx);
      float ky = floor(ly);
      float wx = 1.0 - smoothstep(0.3, 0.7, lx - kx);
      float wy = 1.0 - smoothstep(0.3, 0.7, ly - ky);
      float a = dot(q, v);
      float b = dot(q, n);
      vec2 c = vec2(0.0);
      for (int i = 0; i < 2; i++) {
        for (int j = 0; j < 2; j++) {
          float wt = (i == 0 ? wx : 1.0 - wx) * (j == 0 ? wy : 1.0 - wy);
          if (wt < 0.001) continue;
          float x = kx + float(i);
          float y = ky + float(j);
          c += wt * inkWaveCell(a, b, exp2(x), exp2(y), x, y, fa, fb, clock, share, thick, uInkWaveB.y);
        }
      }
      return c;
    }
    const vec2 INK_WAVE_DIR[8] = vec2[8](vec2(1.0, 0.0), vec2(2.0, 1.0), vec2(1.0, 1.0), vec2(1.0, 2.0), vec2(0.0, 1.0), vec2(-1.0, 2.0), vec2(-1.0, 1.0), vec2(-2.0, 1.0));
    const float INK_WAVE_ANG[8] = float[8](0.0, 0.46365, 0.78540, 1.10715, 1.57080, 2.03444, 2.35619, 2.67795);
    // The strokes on the water at a pixel, in ink (0 paper to 1), and the paper round them.
    vec2 inkWaveAt(vec2 uv, float share, float grow) {
      if (share < 0.02) return vec2(0.0);
      float level = uInkSea.x;
      vec2 px = 1.0 / uRes;
      vec3 P0 = inkPlane(uv, level);
      vec3 Jx = inkPlane(uv + vec2(px.x, 0.0), level) - P0;
      vec3 Jy = inkPlane(uv + vec2(0.0, px.y), level) - P0;
      vec2 q = P0.xz + uOriginMod.xz + uInkWind * ${WATER.drift.toFixed(3)};
      float clock = uInkWind.x * ${(1 / WIND[0]).toFixed(5)};
      float thick = uInkWave.z * max(uInkLine.w, 1.0);
      vec2 r = uCamWorld[0].xz + vec2(1e-5);
      float psi = mod(atan(r.y, r.x), 3.14159265);
      int m0 = 0;
      for (int i = 1; i < 8; i++) {
        if (psi >= INK_WAVE_ANG[i]) m0 = i;
      }
      int m1 = m0 == 7 ? 0 : m0 + 1;
      float a1 = m0 == 7 ? 3.14159265 : INK_WAVE_ANG[m1];
      float w1 = smoothstep(0.3, 0.7, (psi - INK_WAVE_ANG[m0]) / (a1 - INK_WAVE_ANG[m0]));
      vec2 c = vec2(0.0);
      if (w1 < 0.999) c += (1.0 - w1) * inkWaveLattice(q, INK_WAVE_DIR[m0], Jx, Jy, clock, share, thick, grow);
      if (w1 > 0.001) c += w1 * inkWaveLattice(q, INK_WAVE_DIR[m1], Jx, Jy, clock, share, thick, grow);
      return c;
    }

    // The ink a pixel of the frame has by its brightness and distance, before what is laid on it.
    float inkToneOf(float lum, float dist) {
      float dens = pow(1.0 - smoothstep(uInkCurve.x, uInkCurve.y, lum), mix(uInkCurve.z, uInkCurve.w, smoothstep(uInkReach.x, uInkReach.y, dist)));
      float q = dens * 5.0;
      float qi = floor(q);
      return max(min((qi + smoothstep(0.25, 0.75, q - qi)) / 5.0, uInkFade.w), 0.12) * mix(1.0, uInkFade.z, smoothstep(uInkFade.x, uInkFade.y, dist));
    }
    // Whether a point of the screen is the face of the liquid (1) or something else (0).
    float inkIsWater(vec2 uv) {
      float z = texture2D(tDepth, uv).r;
      if (z >= 0.999995) return 0.0;
      float tol = ${WATER.tol[0].toFixed(3)} + ${WATER.tol[1].toFixed(5)} / invFromZ(z);
      return (1.0 - smoothstep(tol, 2.0 * tol, abs(worldFromZ(uv, z).y - uInkSea.x))) * step(0.97, texture2D(tDiffuse, uv).a);
    }
    // The reflection of the shore: what stands at the edge of the water (the first thing up the
    // column of pixels that is not water, and no nearer than the water is) laid down into the water
    // under the edge, turned over, as far below it as it stands above it, and a few tones paler. The
    // edge is looked for by steps that double, and then halved back toward the pixel.
    float inkMirrorAt(vec2 uv, float dist) {
      vec2 px = 1.0 / uRes;
      float s = max(uInkLine.w, 1.0);
      float lo = 0.0;
      float hi = 0.0;
      float k = ${MIRROR.first.toFixed(1)} * s;
      bool found = false;
      for (int i = 0; i < ${MIRROR.steps}; i++) {
        if (uv.y + k * px.y > 1.0) break;
        if (inkIsWater(uv + vec2(0.0, k * px.y)) < 0.5) {
          hi = k;
          found = true;
          break;
        }
        lo = k;
        k *= 2.0;
      }
      if (!found) return 0.0;
      for (int i = 0; i < ${MIRROR.halves}; i++) {
        float mid = 0.5 * (lo + hi);
        if (inkIsWater(uv + vec2(0.0, mid * px.y)) < 0.5) hi = mid; else lo = mid;
      }
      float zb = texture2D(tDepth, uv + vec2(0.0, hi * px.y)).r;
      if (zb >= 0.999995 || 1.0 / invFromZ(zb) < dist * 0.98) return 0.0;
      vec2 at = uv + vec2(0.0, 2.0 * hi * px.y);
      if (at.y > 1.0) return 0.0;
      float za = texture2D(tDepth, at).r;
      vec4 src = texture2D(tDiffuse, at);
      if (za >= 0.999995 || markFigure(src.a) > 0.5) return 0.0;
      return inkToneOf(luma(src.rgb), 1.0 / invFromZ(za)) * uInkMirror * (1.0 - smoothstep(${MIRROR.reach[0].toFixed(2)}, ${MIRROR.reach[1].toFixed(2)}, hi / uRes.y));
    }

    // Heads of cloud in a day's sky. d is the way the pixel looks, pxAng how wide a
    // pixel is (radians). The dome is cut in rows and each row in cells (as many as go
    // round it there); a cell holds a heap of 4 puffs on a flat base, or nothing. The
    // line is drawn along the edge of the heap above its base, and fades out as it comes
    // down to it; inside the heap, low down, is a wash, and in the biggest two puffs an
    // arc of shade, when detail is on. What comes back is the ink at the pixel.
    float inkCloudAt(vec3 d, float pxAng, float amount, float detail) {
      float el = asin(clamp(d.y, -1.0, 1.0));
      float row = floor(el / ${CLOUD.row});
      if (row < 0.0 || row > 5.0) return 0.0;
      float cols = max(floor(6.2832 * cos((row + 0.5) * ${CLOUD.row}) / ${CLOUD.col}), 1.0);
      float colf = mod(atan(d.z, d.x) + 3.14159 + uInkWind.x * ${CLOUD.drift}, 6.2832) / 6.2832 * cols;
      float colN = min(floor(colf), cols - 1.0);
      vec2 cid = vec2(colN, row);
      if (hash12(cid + vec2(17.3, 4.1)) >= amount * ${CLOUD.share} * (1.0 - ${CLOUD.thin} * row)) return 0.0;
      float h1 = hash12(cid + vec2(2.9, 8.7));
      float h2 = hash12(cid + vec2(6.1, 1.3));
      float h3 = hash12(cid + vec2(9.5, 5.5));
      float colW = 6.2832 / cols * cos(el);
      float r0 = ${(CLOUD.row * CLOUD.puff).toFixed(4)} * (0.8 + 0.4 * h1);
      float y0 = -${(CLOUD.row * 0.5).toFixed(3)} + 0.02 + 0.03 * h3;
      vec2 p = vec2((colf - colN - 0.5) * colW - (h2 - 0.5) * max(colW - 6.6 * r0, 0.0), el - (row + 0.5) * ${CLOUD.row} - y0);
      float edge = 1e9;
      float arc = 1e9;
      for (int j = 0; j < 4; j++) {
        float fj = float(j);
        float hj = hash12(cid + vec2(fj * 3.7 + 1.1, 12.9));
        float rj = r0 * (0.78 + 0.5 * hj) * (j == 1 || j == 2 ? 1.18 : 0.92);
        vec2 cj = vec2((fj - 1.5) * 1.3 * r0 * (0.9 + 0.2 * hj), rj * 0.9 + 0.35 * r0 * (hj - 0.5));
        vec2 v = p - cj;
        float lj = length(v);
        edge = min(edge, lj - rj);
        if (detail > 0.0 && (j == 1 || j == 2)) {
          // The arc is on the lower left of the puff, a little in from its edge.
          float side = dot(v, vec2(${CLOUD.arc.dir[0].toFixed(2)}, ${CLOUD.arc.dir[1].toFixed(2)})) / max(lj, 1e-5);
          arc = min(arc, abs(lj - ${CLOUD.arc.at.toFixed(2)} * rj) + 18.0 * pxAng * (1.0 - smoothstep(0.3, 0.7, side)));
        }
      }
      float lineW = 0.5 * uInkCloud.z * uInkLine.w;
      float above = smoothstep(${CLOUD.open[0].toFixed(2)} * r0, ${CLOUD.open[1].toFixed(2)} * r0, p.y);
      float ink = uInkCloud.y * clamp(lineW - abs(edge) / pxAng + 0.5, 0.0, 1.0) * above;
      if (detail > 0.0) {
        ink = max(ink, 0.85 * uInkCloud.y * clamp(lineW - arc / pxAng + 0.5, 0.0, 1.0) * (1.0 - smoothstep(-pxAng, pxAng, edge + 0.3 * r0)));
        float inside = 1.0 - smoothstep(-pxAng, pxAng, edge);
        ink = max(ink, uInkCloud.w * inside * (1.0 - smoothstep(0.0, 1.1 * r0, p.y)) * smoothstep(-pxAng, pxAng, p.y));
      }
      return ink;
    }

    // How much of the land at a point is under snow, as the land's own shader has it: by the
    // height over the snow line, wavered by a broad noise and a finer, and not where it is
    // steep (n is the way the land faces there). The edge of it is scattered by a noise of a few metres,
    // so that the ink does not stop along a line but gives out. lit is how bright the frame is.
    float inkSnowAt(vec3 P, vec3 n, float lit, float dist) {
      vec2 w = P.xz + uOriginAbs.xz;
      float alt = P.y + (vnoise(w / 211.0) - 0.5) * 160.0 + (vnoise(w / 1400.0 + 3.0) - 0.5) * 120.0;
      float k = smoothstep(uInkSnow.x - 70.0, uInkSnow.x + 40.0, alt);
      if (k <= 0.0) return 0.0;
      // The scatter is a noise of ${SNOW.cell} m, and no finer than ${SNOW.px} pixels: the cells grow by powers
      // of two as the land goes off, one into the next, so that no cell is a speck a step of the lens changes.
      float lv = log2(max(${SNOW.px.toFixed(1)} * dist * 2.0 * uInvProj[1][1] / uRes.y / ${SNOW.cell.toFixed(1)}, 1.0));
      float l0 = floor(lv);
      float sc = ${SNOW.cell.toFixed(1)} * exp2(l0);
      float sn = mix(vnoise(w / sc), vnoise(w / (2.0 * sc) + 17.0), lv - l0);
      k = smoothstep(0.35, 0.65, k + (sn - 0.5) * 0.7);
      return k * (1.0 - smoothstep(0.3, 0.5, 1.0 - n.y)) * step(0.02, n.y) * smoothstep(uInkSnow.z, uInkSnow.w, lit);
    }
#endif

    // A world of blocks. The face of the world a pixel is on is found from
    // the depth (the way its neighbours' points lie), and laid with square
    // texels s metres across on the plane of that face: the colour of the
    // frame where the middle of the texel is, a little lighter or darker by
    // the texel's own draw, as the picture on a block's face is. Texels stay
    // where they are on the world, so the world moves under them; their
    // draw comes from where they are in a 1 km square that repeats.

    // The block's light at a pixel: 1 where another face of the world bends
    // toward the lens within o pixels (an eighth of a texel), as a wall does
    // from the ground at its foot, a trunk from the ground, a block from the
    // block it stands on, and 0 elsewhere. The pixels o away, up, down, left
    // and right, are put in the world by their depth; one counts when it is
    // above this face's plane by a fifth or more of its distance from the
    // pixel (a face that bends away is below the plane: it is an edge, not a
    // fold) and not a great way nearer or farther (a thing in front of this,
    // or behind it, is not a face joined to it).
    float blockFold(vec2 uv, vec3 P, vec3 n, float wc, float o) {
      vec2 d = o / uRes;
      float e = 0.0;
      for (int i = 0; i < 4; i++) {
        vec2 q = uv + (i == 0 ? vec2(d.x, 0.0) : (i == 1 ? vec2(-d.x, 0.0) : (i == 2 ? vec2(0.0, d.y) : vec2(0.0, -d.y))));
        float zq = texture2D(tDepth, q).r;
        if (zq >= 0.999995) continue;
        vec3 v = worldFromZ(q, zq) - P;
        float wq = invFromZ(zq);
        if (dot(v, n) > 0.2 * length(v) && abs(wq - wc) < 0.12 * wc) e = 1.0;
      }
      return e;
    }
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
      c *= mix(1.0, face, uBlockFace);
      // The block's light: where another face meets this one, darker for an eighth
      // of a texel (in pixels, at the high tier; one pixel at the middle one), up to
      // 160 m off.
      if (uBlockAO.x > 0.0 && dist < 160.0) {
        float o = uBlockAO.z > 0.5 ? clamp(floor(uBlockAO.y * exp2(L0) / (dist * 2.0 * uInvProj[1][1] / uRes.y) + 0.5), 1.0, 4.0) : 1.0;
        c *= 1.0 - uBlockAO.x * (1.0 - smoothstep(90.0, 160.0, dist)) * blockFold(uv, P, n, wc, o);
      }
      return c;
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

    // A woodblock print. A colour as the eye tells colours apart (OKLab, from a
    // colour as it is on the screen: the same cubic for sRGB's curve and the
    // same matrices as inkLab in style.js, so that a pixel and an ink are
    // measured with one ruler).
    // Ink m (a line, a dye: the paper as far as it is not laid) laid on the ink of the frame c. On grey ink the
    // darker of the two, channel by channel; under a pale colour (uQian) the colour darkened as the paper is
    // (a channel brighter than the paper's would be cut to the paper's, and the colour turned).
    vec3 inkOver(vec3 c, vec3 m) {
      return uQian > 0.0 ? c * min(vec3(1.0), m / uPaper) : min(c, m);
    }

    vec3 inkLab(vec3 c) {
      vec3 l = max(c, 0.0);
      l = l * (l * (l * 0.305306011 + 0.682171111) + 0.012522878);
      vec3 m = pow(vec3(
        dot(l, vec3(0.4122214708, 0.5363325363, 0.0514459929)),
        dot(l, vec3(0.2119034982, 0.6806995451, 0.1073969566)),
        dot(l, vec3(0.0883024619, 0.2817188376, 0.6299787005))), vec3(1.0 / 3.0));
      return vec3(
        dot(m, vec3(0.2104542553, 0.793617785, -0.0040720468)),
        dot(m, vec3(1.9779984951, -2.428592205, 0.4505937099)),
        dot(m, vec3(0.0259040371, 0.7827717662, -0.808675766)));
    }
    // A frame colour as the inks are chosen for it: the lights of the frame at uSnapGain of their
    // brightness (a colour that is dark already is left as it is, and so is a white), and a grey (no
    // colour in it, and not a light one) leaned toward blue by uSnapLean.
    vec3 inkKey(vec3 c) {
      float lu = luma(c);
      vec3 lab = inkLab(c * mix(1.0, uSnapGain, smoothstep(0.15, 0.5, lu) * (1.0 - smoothstep(0.8, 0.97, lu))));
      float grey = (1.0 - smoothstep(0.02, 0.06, length(lab.yz))) * (1.0 - smoothstep(0.65, 0.85, lab.x));
      lab.yz += grey * uSnapLean;
      return lab;
    }
    // The ink nearest to a colour (in OKLab, by the weights uSnapW): the six, or the paper (6).
    int nearestInk(vec3 lab) {
      int best = 0;
      float bd = 1e9;
      for (int i = 0; i < 7; i++) {
        vec3 d = (lab - uInkLab[i]) * uSnapW;
        float s = dot(d, d);
        if (s < bd) {
          bd = s;
          best = i;
        }
      }
      return best;
    }
    // The mean of the pixel's 3 by 3 (s pixels apart) that are on the surface it is on (the weight
    // falls by a thirtieth of the inverse depth), so that a block is one colour and not grains of
    // it; same: 1 where those are all the colour it is, 0 where they differ.
    vec3 snapMean(ivec2 at, ivec2 last, float wc, int s, out float same) {
      vec3 c0 = texelFetch(tDiffuse, at, 0).rgb;
      vec3 acc = c0;
      float sum = 1.0;
      float spread = 0.0;
      float per = 1.0 / (0.03 * wc + 1e-7);
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          if (i == 0 && j == 0) continue;
          ivec2 q = clamp(at + ivec2(i, j) * s, ivec2(0), last);
          float k = exp(-abs(invFromZ(texelFetch(tDepth, q, 0).r) - wc) * per);
          vec3 c = texelFetch(tDiffuse, q, 0).rgb;
          acc += c * k;
          sum += k;
          vec3 d = abs(c - c0);
          spread = max(spread, k * max(d.r, max(d.g, d.b)));
        }
      }
      same = 1.0 - smoothstep(0.02, 0.08, spread);
      return acc / sum;
    }
    // Value noise that repeats every period.x by period.y cells, for what is laid on the
    // world in a grain that is longer one way (it does not jump when the floating origin wraps).
    float pnoise2(vec2 p, vec2 period) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      vec2 a = mod(i, period);
      vec2 b = mod(i + 1.0, period);
      return mix(mix(hash12(a), hash12(vec2(b.x, a.y)), f.x), mix(hash12(vec2(a.x, b.y)), hash12(b), f.x), f.y);
    }
    // The lines the marks of a figure make round it and between its parts, s pixels out.
    float printFigure(ivec2 at, ivec2 last, float aC, float zC, int s) {
      float fC = markFigure(aC);
      float invC = invFromZ(zC);
      return max(max(figureInkAt(clamp(at + ivec2(s, 0), ivec2(0), last), aC, fC, invC), figureInkAt(clamp(at - ivec2(s, 0), ivec2(0), last), aC, fC, invC)),
        max(figureInkAt(clamp(at + ivec2(0, s), ivec2(0), last), aC, fC, invC), figureInkAt(clamp(at - ivec2(0, s), ivec2(0), last), aC, fC, invC)));
    }
    // The key plate at a pixel: the black line where what stands out of what is behind it ends. A
    // pixel nearer than the one s pixels away across an edge is all line; the one on the far
    // side has a share of it (so that the line is uLineW wide), and that share wavers along the
    // line by the world's own noise (the knife's); the depth's own slope is no edge, and
    // from uLineThin to uLineFar metres the line goes. The figures (the car) have the
    // lines their marks make, between their parts as well.
    float printKey(ivec2 at, ivec2 last) {
      at = clamp(at, ivec2(0), last);
      int s = max(1, int(floor(uLineW * 0.6 + 0.5)));
      float zc = texelFetch(tDepth, at, 0).r;
      float wc = invFromZ(zc);
      float wl = invFromZ(texelFetch(tDepth, clamp(at - ivec2(s, 0), ivec2(0), last), 0).r);
      float wr = invFromZ(texelFetch(tDepth, clamp(at + ivec2(s, 0), ivec2(0), last), 0).r);
      float wd = invFromZ(texelFetch(tDepth, clamp(at - ivec2(0, s), ivec2(0), last), 0).r);
      float wu = invFromZ(texelFetch(tDepth, clamp(at + ivec2(0, s), ivec2(0), last), 0).r);
      float wmax = max(max(max(wl, wr), max(wd, wu)), wc);
      float sx = wl + wr - 2.0 * wc;
      float sy = wd + wu - 2.0 * wc;
      float fade = 1.0 - smoothstep(uLineThin > 0.0 ? uLineThin : uLineFar * 0.4, uLineFar, 1.0 / wmax);
      float front = smoothstep(uJump.x, uJump.y, max(-sx, -sy) / wmax);
      float back = smoothstep(uJump.x, uJump.y, max(sx, sy) / wmax);
      float e = front;
      if (back > 0.01 && fade > 0.01) {
        vec2 uvAt = (vec2(at) + 0.5) / uRes;
        vec3 Pk = worldFromZ(uvAt, zc) + uOriginMod;
        float n = pnoise2(vec2(Pk.x + Pk.y * 0.7, Pk.z - Pk.y * 0.4) / 0.8, vec2(1280.0));
        float part = clamp(uLineW / float(s) - 1.0 + uKeyJit * uLineW / float(s) * (2.0 * n - 1.0), 0.0, 1.0);
        e = max(e, back * part);
      }
      e *= fade;
      if (uLineFig > 0.0) e = max(e, printFigure(at, last, texelFetch(tDiffuse, at, 0).a, zc, s) * uLineFig);
      return e;
    }

    void main() {
      vec2 px = 1.0 / uRes;
      vec2 uv = vUv;
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
      if (uBlock > 0.0 && sky < 0.5) {
        // Far off the texels give way to the frame as it is.
        float bk = uBlock * (1.0 - smoothstep(uBlockFade.x, max(uBlockFade.y, uBlockFade.x + 1.0), dist));
        if (bk > 0.0) col = mix(col, blockColor(uv, col, zc, wc), bk);
      }

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

      // Ink on paper: five tones of ink and the paper, cut from the brightness.
      // What is near is laid in thick ink and what is far in a pale wash, the
      // ink thinning with the distance; the land is never quite the paper, but
      // low land far off lies in a mist, the paper left blank. A wash never
      // goes as dark as a line. A bright sky is left blank, and so are the
      // stars in a dark one, which is a pale wash, thinner where it is brighter.
      float inkMist = 0.0;
      float inkWaterK = 0.0;
      float qianLeaf = 0.0;
      if (uInk > 0.0) {
        float lum = luma(col);
        float tone = uInkSky * (1.6 - 2.5 * lum) * (1.0 - uBlank * smoothstep(0.3, 0.5, lum));
        // Where a leaf's dots are laid (below) the way the face goes: the point, and its change from a pixel
        // to the next in both ways, crossed (worked out for every pixel, not under a branch that only some
        // take: a change from one pixel to the next is not worked out there).
#ifdef FLAT
        vec3 leafP = vec3(0.0);
        vec3 leafN = vec3(0.0);
        if (uInkLeaf > 0.0 && uInkDot.x > 0.0) {
          leafP = worldFromZ(uv, zc);
          leafN = abs(cross(dFdx(leafP), dFdy(leafP)));
        }
#endif
        if (sky < 0.5) {
          float dens = pow(1.0 - smoothstep(uInkCurve.x, uInkCurve.y, lum), mix(uInkCurve.z, uInkCurve.w, smoothstep(uInkReach.x, uInkReach.y, dist)));
          float q = dens * 5.0;
          float qi = floor(q);
          tone = (qi + smoothstep(0.25, 0.75, q - qi)) / 5.0;
          // Leaves are not cut from the brightness: a wash, thicker in the shade, with dots on it, of thick
          // ink or of thicker, by the brightness, in clusters; and where they are too small to be dots (far
          // off) the wash they would make. Only what is green is (a rock is marked as leaves too, and a leaf
          // far off has no green left in it). The far wood the land paints (render/terrain.js) is read as it
          // is marked in the alpha (a mark of 0.935 and the share of dots in the twelve thousandths over it).
          // A trunk and a bough, brown where the leaves are green, are one stroke of the thickest ink.
#ifdef FLAT
          float land = step(0.935, src.a) * markLeaf(src.a);
          float leafMark = uInkLeaf * max(markTree(src.a), land);
          if (leafMark > 0.0) {
            float ratio = src.g / max(src.r, 1e-3);
            float green = max(smoothstep(1.0, 1.25, ratio), smoothstep(100.0, 200.0, dist));
            // (Light and shade: crisp near, and far off gentle, where the brightness has a noise of its own that
            // a step would make a speckle of.)
            float sw = mix(0.07, 0.17, smoothstep(60.0, 250.0, dist));
            float shade = 1.0 - smoothstep(0.42 - sw, 0.42 + sw, lum);
            float dens0 = mix(0.5, 1.0, shade);
            float cover = LEAF_MEAN * dens0;
            if (land > 0.5) {
              cover = clamp((src.a - 0.935) / 0.012, 0.0, 1.0);
            } else if (uInkDot.x > 0.0) {
              vec3 pw = leafP + uOriginMod;
              vec2 face = (leafN.y >= leafN.x && leafN.y >= leafN.z) ? pw.xz : (leafN.x >= leafN.z ? pw.zy : pw.xy);
              float foot = dist * 2.0 * uInvProj[1][1];
              float pxm = foot / uRes.y;
              float pxs = foot / uInkH;
              float grow = smoothstep(uInkDot.z, uInkDot.w, dist);
              float seeN = smoothstep(1.2, 3.0, 2.0 * LEAF_DOT.x * 1024.0 / (uInkDot.x * pxs));
              float seeF = smoothstep(1.2, 3.0, 2.0 * LEAF_DOT.x * 1024.0 / (uInkDot.y * pxs));
              float coverN = cover;
              float coverF = cover;
              if (grow < 1.0 && seeN > 0.0) coverN = mix(cover, inkDotAt(face, uInkDot.x, 0.5 * pxm, dens0, 400.0), seeN);
              if (grow > 0.0 && seeF > 0.0 && uInkDot.y > 0.0) coverF = mix(cover, inkDotAt(face, uInkDot.y, 0.5 * pxm, dens0, 200.0), seeF);
              cover = mix(coverN, coverF, grow);
            }
            // (The far wood the land paints has two inks of its own: its brightness is a noise of the land's.)
            float wash = mix(mix(uInkLeafT.x, uInkLeafT.y, shade), uInkLand.x, land);
            float dotT = mix(mix(uInkLeafT.z, uInkLeafT.w, shade), uInkLand.y, land);
            // (A leaf lost in the haze is as bright as the haze: the brightness cut makes of it what it makes of the haze,
            // gently, over a wide run of brightness, for the brightness of the far land has a noise of its own.)
            float lost = smoothstep(0.3, 0.8, lum) * smoothstep(60.0, 200.0, dist);
            // (And what is in the deepest shade of a crown is the thickest ink, wash and dots both.)
            float deep = (1.0 - smoothstep(0.1, 0.18, lum)) * (1.0 - land) * 0.85;
            wash = mix(wash, uInkLeafT.w, deep);
            dotT = mix(dotT, uInkLeafT.w, deep);
            tone = mix(tone, mix(wash, dotT, cover), leafMark * green * (1.0 - lost));
            qianLeaf = leafMark * green;
            // (Only near and dark: the haze far off has no green or brown in it, and takes a leaf for a bough.)
            float bark = (1.0 - smoothstep(0.72, 0.8, ratio)) * (1.0 - smoothstep(60.0, 140.0, dist)) * (1.0 - smoothstep(0.18, 0.3, luma(src.rgb)));
            tone = mix(tone, 1.0, leafMark * bark * (1.0 - land));
          }
#endif
          // Strokes of ink on rock and slope: what no mark is on, where it
          // is not flat, near enough to be drawn (the style pass with flat colour
          // is the one that has them).
#ifdef FLAT
          // The face of a liquid is where the point the depth puts the pixel at is at the liquid's
          // level (and what is marked is not), in a world that shows one and with the lens over it.
          float up = 0.0;
          float wk = 0.0;
          bool wet = uInkSea.y > 0.0 && uInkWater > 0.0 && uCamWorld[3].y > uInkSea.x + ${WATER.low.toFixed(1)};
          if (wet) {
            up = worldFromZ(uv, zc).y - uInkSea.x;
            float tol = ${WATER.tol[0].toFixed(3)} + ${WATER.tol[1].toFixed(5)} * dist;
            wk = (1.0 - smoothstep(tol, 2.0 * tol, abs(up))) * step(0.97, src.a) * uInkSea.y * uInkWater * (1.0 - smoothstep(0.3, 0.7, uInkSea.w));
          }
          if (uCun > 0.0 && src.a > 0.97 && dist < uCunReach.y && wk < 0.5) tone = cunTone(tone, uv, zc, wc, dist, lum, col);
#endif
          // The ink thins with the distance, and low land far off lies in a
          // mist: under a top that rises with the distance, and is a little
          // different from one place to the next (the world's own noise, 900
          // m across, and a finer one, 70 m). The distance is uneven by the
          // same noise: a wash that thinned by the row of the screen the land
          // is on would stand still on the screen while the world turned.
          float away = dist;
          float mist = 0.0;
          if (uInkMist.z > 0.0 && dist > uInkMist.x) {
            vec3 Pm = worldFromZ(uv, zc);
            vec2 Wm = Pm.xz + uOriginAbs.xz;
            float top = Pm.y + uInkMist.w * vnoise(Wm / 900.0) + 6.0 * vnoise(Wm / 70.0);
            float lens = uCamWorld[3].y;
            float low = lens + uInkMistH.x + uInkMistH.z * dist;
            float high = lens + uInkMistH.y + uInkMistH.w * dist;
            mist = (1.0 - smoothstep(low, high, top)) * smoothstep(uInkMist.x, uInkMist.y, dist);
            away *= 1.0 + 0.04 * (vnoise(Wm / 60.0 + 7.0) - 0.5);
          }
          tone = max(min(tone, uInkFade.w), 0.12) * mix(1.0, uInkFade.z, smoothstep(uInkFade.x, uInkFade.y, away)) * (1.0 - uInkMist.z * mist);
          inkMist = uInkMist.z * mist;
#ifdef FLAT
          // The water is paper, with a few strokes on it (fewer and paler on a sea of cloud, whose
          // islands stand in a mist to their feet). Snow is paper too, but for the rock and
          // the trees it has not covered.
          if (wk > 0.0) {
            float cs = uInkSea.z;
            float stroke = 0.0;
            float grown = smoothstep(uInkWaveFar.x, uInkWaveFar.y, dist);
            float reach = 1.0 - smoothstep(uInkWaveFar.y, ${WATER.gone.toFixed(1)}, dist);
            if (uInkMode.x > 0.5 && reach > 0.0) {
              vec2 wv = inkWaveAt(uv, uInkWave.y * mix(1.0, uInkWaveFar.w, grown) * reach * mix(1.0, uInkSeaLook.y, cs), 1.0 + uInkWaveFar.z * grown);
              stroke = wv.x * uInkWave.x * mix(1.0, uInkSeaLook.x, cs);
              if (uInkMode.z > 0.5 && cs < 0.5 && wv.y < 0.95) stroke = max(stroke, inkMirrorAt(uv, dist) * (1.0 - wv.y));
            }
            tone = mix(tone, max(stroke, cs * uInkSeaLook.w), wk);
            inkMist = max(inkMist, 0.65 * wk);
            inkWaterK = wk;
          } else if (wet && uInkSea.z > 0.0) {
            tone *= 1.0 - 0.92 * uInkSea.z * uInkSea.y * uInkWater * (1.0 - smoothstep(0.0, uInkSeaLook.z, up));
          }
          if (uInkSnow.y > 0.0 && src.a > 0.97 && wk < 0.5) {
            vec3 Ps = worldFromZ(uv, zc);
            if (Ps.y > uInkSnow.x - 260.0) tone *= 1.0 - uInkSnow.y * inkSnowAt(Ps, depthNormal(uv, zc, wc, Ps), lum, dist);
          }
#endif
        }
#ifdef FLAT
        // Heads of cloud in a day's sky.
        if (sky > 0.5 && uInkCloud.x > 0.0 && uSkyDay > 0.0) {
          tone = max(tone, inkCloudAt(normalize(inkRay(uv)), 2.0 * uInvProj[1][1] / uRes.y, uInkCloud.x * uSkyDay, uInkMode.y));
        }
#endif
        vec3 ink = mix(uPaper, uInkCol, clamp(tone, 0.0, 1.0));
        // A pale colour over the ink, by what the frame's colour was: green (a hue of OKLab between 80 and
        // 175 degrees, or a leaf the ink dots) the first, blue (210 to 300 degrees) or far the second, the
        // rest the third. Each is laid at the ink's own lightness (OKLab's), so that the tone is the ink's,
        // and the paper's own warmth is not kept under it (a blue laid over a warm grey is grey). Where one
        // colour gives way to the next it thins to none and comes in again, so that no fourth hue is made
        // between two of them.
        if (uQian > 0.0 && sky < 0.5) {
          vec3 lb = inkLab(base);
          float ch = smoothstep(0.015, 0.025, length(lb.yz));
          float hue = atan(lb.z, lb.y);
          float hg = smoothstep(1.35, 1.45, hue) * (1.0 - smoothstep(3.0, 3.1, hue)) * ch;
          float hb = smoothstep(-2.7, -2.6, hue) * (1.0 - smoothstep(-1.1, -1.0, hue)) * ch;
          float qFar = smoothstep(uQianAt.x, uQianAt.y, dist);
          float wg = smoothstep(0.4, 0.6, max(qianLeaf, hg));
          float wb = max(smoothstep(0.4, 0.6, hb), qFar);
          vec3 tint = wb < 0.5 ? (wg < 0.5 ? uQianInks[2] : uQianInks[0]) : uQianInks[1];
          float amt = wb < 0.5 ? abs(2.0 * wg - 1.0) * (1.0 - 2.0 * wb) : 2.0 * wb - 1.0;
          float g = luma(ink);
          vec3 laid = g * mix(vec3(1.0), tint / luma(tint), uQian * amt);
          // (OKLab's lightness goes as about the 0.733rd power of a colour on the screen.)
          laid *= pow(inkLab(ink).x / max(inkLab(laid).x, 1e-3), 1.364);
          // (A channel over 1 is not cut, which would turn the colour: the colour is thinned toward its grey.)
          float top = max(max(laid.r, laid.g), laid.b);
          if (top > 1.0) {
            float gl = luma(laid);
            laid = gl + (laid - gl) * (1.0 - gl) / max(top - gl, 1e-4);
          }
          float k = smoothstep(uQianAt.z, uQianAt.w, tone) * (1.0 - inkWaterK);
          ink = mix(ink, clamp(laid, 0.0, 1.0), k);
        }
        vec3 keep = mix(base, base * uPaper, 0.25);
        col = mix(col, mix(ink, keep, car * uKeep), uInk);
      }

      if (uPoster > 0.0) {
        float l = max(luma(col), 1e-4);
        float q = l * uLevels;
        float lq = (floor(q) + smoothstep(0.4, 0.6, fract(q))) / uLevels;
        float k = uPoster * (1.0 - sky);
        col = mix(col, clamp(col * (lq / l), 0.0, 1.0), k);
      }

      // A woodblock print: the colour plates, cut from the frame into the six inks and the paper, and the
      // key plate, the black line, printed a pixel off them. What each plate is, by what the
      // pixel is:
      //  - a day's sky (uSkyDay) is steps of the first ink fading into the paper, higher up the more of it
      //    (bokAt), and a night's sky the ink it is nearest;
      //  - a cloud (the sky shader marks it in the alpha, 0.7) is one of three flat tones, by how bright it was drawn;
      //  - the rest is the ink nearest the mean of its 3 by 3 on the same surface, the sea the first blue ink
      //    paler the farther it is, low land far off lost in the paper, and a grain of wood in the flat of it.
      // The plates of colour have the line's footprint cut out of them, and stand uRegist
      // pixels to the right and down of it: on one side of a line the colour runs over it, on the other a
      // thread of paper is bare. The inks and their tones are what is printed, whatever the frame
      // was.
      if (uPrint > 0.0) {
        ivec2 pAt = ivec2(floor(uv * uRes));
        ivec2 pLast = ivec2(uRes) - 1;
        vec3 plate = col;
        // Where on the world the pixel is, and the grain of the wood there. The grain is read here, where
        // every pixel runs the same code (a derivative is only good there): a cell that a pixel crosses a
        // tenth of or more is a stripe of speckle and not a grain, so it fades out between a tenth and a fifth.
        vec3 P = worldFromZ(uv, zc);
        float grain = 0.0;
        if (uWood > 0.0) {
          vec3 Pw = P + uOriginMod;
          vec2 gc = vec2(Pw.x / 12.8, (Pw.z + 2.0 * Pw.y) / 0.64);
          grain = (pnoise2(gc, vec2(80.0, 1600.0)) * 2.0 - 1.0) * uWood * (1.0 - smoothstep(0.08, 0.2, max(fwidth(gc.x), fwidth(gc.y))));
        }
        float pCloud = step(0.62, src.a) * (1.0 - step(0.77, src.a));
        if (sky > 0.5) {
          vec4 ray = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
          vec3 dir = normalize((uCamWorld * vec4(ray.xyz / ray.w, 0.0)).xyz);
          // A night's sky, and the stars in it: the ink each is nearest.
          plate = uInks[nearestInk(inkKey(col))];
          float day = uBokashi * uSkyDay;
          if (day > 0.0) {
            float w = uBokAt.w;
            float t = (smoothstep(uBokAt.x - w, uBokAt.x + w, dir.y) + smoothstep(uBokAt.y - w, uBokAt.y + w, dir.y) + smoothstep(uBokAt.z - w, uBokAt.z + w, dir.y)) / 3.0;
            // (The grain along the way the sky is looked: round the horizon, 28 degrees to a cell, and 1.6 degrees up it.)
            float g = pnoise2(vec2(atan(dir.z, dir.x) / 0.48332, dir.y / 0.028), vec2(13.0, 4096.0)) * 2.0 - 1.0;
            // The paper, then a pale blue, the blue and the indigo: the ink wiped thinner toward the horizon.
            vec3 bok = t < 0.33333 ? mix(uPaper, uCloudInk[1], t * 3.0) : t < 0.66667 ? mix(uCloudInk[1], uInks[1], t * 3.0 - 1.0) : mix(uInks[1], uInks[0], t * 3.0 - 2.0);
            plate = mix(plate, bok * (1.0 + uWood * g), day);
          }
          if (pCloud > 0.5) {
            float lc = luma(col);
            plate = lc > uCloudAt.x ? uCloudInk[0] : lc > uCloudAt.y ? uCloudInk[1] : uCloudInk[2];
          }
        } else {
          int ss = max(1, int(floor(uSnapR + 0.5)));
          float same;
          vec3 mean = snapMean(pAt, pLast, wc, ss, same);
          int ink = nearestInk(inkKey(mean));
          plate = uInks[ink];
          if (car < 0.5) {
            // The sea: the one water surface, in blue where it is near and in paper far off, in steps.
            if (uSea.y > 0.0 && ink < 3 && abs(P.y - uSea.x) < 0.15 + 0.0005 * dist) {
              float sw = 0.25;
              float st = (smoothstep(uSeaAt.x * (1.0 - sw), uSeaAt.x * (1.0 + sw), dist) + smoothstep(uSeaAt.y * (1.0 - sw), uSeaAt.y * (1.0 + sw), dist)
                + smoothstep(uSeaAt.z * (1.0 - sw), uSeaAt.z * (1.0 + sw), dist)) / 3.0;
              plate = mix(plate, mix(uInks[1], uPaper, st), uSea.y);
            }
            // Low land far off lies in a mist of blank paper: under a top that rises with the distance
            // and is a little different from one place to the next.
            if (uFoot.z > 0.0 && dist > uFoot.x) {
              vec2 Wm = P.xz + uOriginAbs.xz;
              float top = P.y + uFoot.w * vnoise(Wm / 900.0) + 6.0 * vnoise(Wm / 70.0);
              float lens = uCamWorld[3].y;
              float mist = (1.0 - smoothstep(lens + uFootH.x + uFootH.z * dist, lens + uFootH.y + uFootH.w * dist, top)) * smoothstep(uFoot.x, uFoot.y, dist);
              // In three steps of the paper's, the way the sky is wiped.
              mist = (smoothstep(0.12, 0.2, mist) + smoothstep(0.45, 0.53, mist) + smoothstep(0.78, 0.86, mist)) / 3.0;
              plate = mix(plate, uPaper, mist * uFoot.z);
            }
            // The grain of the wood, in the blocks that are one colour.
            plate *= 1.0 + grain * same;
          }
        }
        float hollow = 0.0;
        float line = 0.0;
        if (uKey > 0.0) {
          int off = int(floor(uRegist + 0.5));
          hollow = printKey(pAt, pLast);
          line = off > 0 ? printKey(pAt + ivec2(off, -off), pLast) : hollow;
        }
        vec3 key = uInks[5];
        vec3 printed = mix(plate, mix(uPaper, key, line), hollow * uKey);
        printed = mix(printed, mix(plate, key, 0.8), line * (1.0 - hollow) * uKey);
        col = mix(col, printed, uPrint);
      }

      // Lines at the edges of things: where the depth jumps (outlines) or
      // its slope breaks (creases), fading with distance.
      if (uLine > 0.0) {
        vec2 o = px * uLineW;
        float wl = invDepth(uv - vec2(o.x, 0.0));
        float wr = invDepth(uv + vec2(o.x, 0.0));
        float wd = invDepth(uv - vec2(0.0, o.y));
        float wu = invDepth(uv + vec2(0.0, o.y));
        float wmax = max(max(max(wl, wr), max(wd, wu)), wc);
        float jump = max(max(abs(wl - wc), abs(wr - wc)), max(abs(wd - wc), abs(wu - wc))) / wmax;
        // Net of the slope: a plane seen at a grazing angle changes its depth from pixel to pixel (a twentieth of it, a pixel
        // under the horizon's ten) and is no edge; only what the depth changes by more than it was going to counts.
        if (uJumpNet > 0.0) jump = max(abs(wl + wr - 2.0 * wc), abs(wd + wu - 2.0 * wc)) / wmax;
        float crease = (abs(wl + wr - 2.0 * wc) + abs(wd + wu - 2.0 * wc)) / wc;
        float ej = smoothstep(uJump.x, uJump.y, jump);
        float ec = smoothstep(0.012, 0.04, crease) * uCrease;
        // A figure's outline and the lines between its parts are drawn from its
        // marks (figureInk below); the depth's own lines are kept for what the
        // marks do not tell apart, its creases, the seams of its doors and bonnet,
        // at half.
        if (uLineFig > 0.0) {
          ej *= uFigJump;
          ec *= ${FIG_INK.crease.toFixed(3)};
        }
        float e = max(ej, ec);
        e *= 1.0 - smoothstep(uLineThin > 0.0 ? uLineThin : uLineFar * 0.4, uLineFar, 1.0 / wmax);
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
        // Ink lays its lines with a brush of its own (below), everywhere but at
        // the car and the animals: they keep the line they had, a pixel that is
        // one or has one within a line's width where the depth jumps.
        bool laid = false;
        if (uInk > 0.5) {
          bool fig = car > 0.5;
          if (!fig && jump > uJump.x) {
            ivec2 at = ivec2(floor(uv * uRes));
            ivec2 last = ivec2(uRes) - 1;
            int kk = int(max(1.0, floor(uLineW + 0.5)));
            float am = min(min(texelFetch(tDiffuse, clamp(at + ivec2(kk, 0), ivec2(0), last), 0).a, texelFetch(tDiffuse, clamp(at - ivec2(kk, 0), ivec2(0), last), 0).a),
              min(texelFetch(tDiffuse, clamp(at + ivec2(0, kk), ivec2(0), last), 0).a, texelFetch(tDiffuse, clamp(at - ivec2(0, kk), ivec2(0), last), 0).a));
            fig = am < 0.75;
          }
          laid = !fig;
          if (laid && sky < 0.5) {
            // The line is on the nearer side of a jump in the depth (a pixel
            // with a further one a line's width away), as wide as the brush is
            // at that distance and as dark. Two rings of taps tell how wide:
            // one pixel out (a line a pixel wide) and where the old stencil is
            // (lineW, two pixels), and the line between a pixel and two wide
            // has the second pixel in the share it is wide over the first.
            float v2 = max(max(wc - wl, wc - wr), max(wc - wd, wc - wu)) / wc;
            float c2 = smoothstep(uJump.x, uJump.y, v2);
            // A slope's break is a line where the surface goes on; at a jump
            // in the depth the line is the jump's, on the nearer side only.
            float ecs = ec * (1.0 - smoothstep(0.5 * uJump.x, uJump.x, jump));
            if (max(c2, ecs) > 0.0) {
              float scale = uInkLine.w;
              float lw = mix(uLineW, uInkLine.z * scale, clamp(log(dist / uInkLine.x) / log(uInkLine.y / uInkLine.x), 0.0, 1.0));
              float r1 = max(1.0, floor(scale + 0.5));
              float r2 = max(r1 + 1.0, floor(uLineW + 0.5));
              vec2 o1 = px * r1;
              float v1 = max(max(wc - invDepth(uv - vec2(o1.x, 0.0)), wc - invDepth(uv + vec2(o1.x, 0.0))),
                max(wc - invDepth(uv - vec2(0.0, o1.y)), wc - invDepth(uv + vec2(0.0, o1.y)))) / wc;
              float c1 = smoothstep(uJump.x, uJump.y, v1);
              // A brush, thicker and thinner along the stroke and now and then
              // running dry: noise laid on the world where the line is, so it
              // moves with the line. Far off the line is even.
              float nz = 1.0;
              float dry = 1.0;
              if (uBrush > 0.0) {
                vec4 vp = uInvProj * vec4(uv * 2.0 - 1.0, zc * 2.0 - 1.0, 1.0);
                vec3 wp = (uCamWorld * vec4(vp.xyz / vp.w, 1.0)).xyz;
                float n1 = vnoise(wp.xz / 7.0) * 0.5 + vnoise(wp.xy / 7.0 + 13.0) * 0.5;
                float n2 = vnoise(wp.zy / 3.0 + 29.0) * 0.5 + vnoise(wp.xz / 3.0 + 41.0) * 0.5;
                float nb = uBrush * (1.0 - smoothstep(150.0, 450.0, dist));
                nz = mix(1.0, 0.8 + 0.5 * n1, nb);
                dry = mix(1.0, mix(1.0, smoothstep(0.12, 0.34, n2), 0.85), nb);
              }
              float k2 = clamp((lw * nz - r1) / (r2 - r1), 0.0, 1.0);
              float cov = max(mix(c1 * min(1.0, lw * nz / r1), c2, k2), ecs) * dry * (1.0 - inkWaterK);
              float lx = clamp((dist - uInkLineT.x) / (uInkLineT.y - uInkLineT.x), 0.0, 1.0);
              float lt = (1.0 - (1.0 - uInkLineT.z) * pow(lx, 2.5)) * (1.0 - smoothstep(uInkLineT.y, uInkLineT.w, dist));
              col = inkOver(col, mix(uPaper, uLineCol, clamp(lt * cov, 0.0, 1.0) * uLine));
            }
            // Far ridges have no line: the land under the edge is dyed, thickest
            // at the edge and gone a few pixels down. It is there where the
            // land has a further thing (the sky, a further ridge) over it, within
            // the dye's reach; the farthest tap first, for most pixels have none.
            if (dist > uInkDye.x && uInkDye.w > 0.0) {
              float ds = uInkDye.z * uInkLine.w * px.y / 6.0;
              float dye = 0.0;
              if (smoothstep(uJump.x, uJump.y, (wc - invDepth(uv + vec2(0.0, 6.0 * ds))) / wc) > 0.0) {
                for (int k = 1; k <= 6; k++) {
                  float f = smoothstep(uJump.x, uJump.y, (wc - invDepth(uv + vec2(0.0, float(k) * ds))) / wc);
                  dye = max(dye, f * (1.0 - (float(k) - 0.5) / 6.0));
                }
              }
              col = inkOver(col, mix(uPaper, uInkCol, dye * uInkDye.w * smoothstep(uInkDye.x, uInkDye.y, dist) * (1.0 - inkMist)));
            }
          }
        }
        if (!laid) {
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
        }
        // Only where a figure is within a line's width (near, above).
        if (uLineFig > 0.0 && near > 0.5) {
          float fink = figureInk(ivec2(floor(uv * uRes)), src.a, zc);
          if (fink > 0.0) col = mix(col, vec3(${FIG_INK.col.map((x) => x.toFixed(3)).join(', ')}), fink * uLineFig);
        }
      }

      vec2 v = vUv - 0.5;
      col *= 1.0 - uGrade.w * dot(v, v) * 2.0;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

// The pixel style's frame is a grid of cells, a block of whole screen pixels each,
// `rows` cells tall (render/post.js, PostChain.setSize). The scene is drawn at
// k times the cells across and up (two: a cell is the mean of four of its
// pixels, one on a screen so small that a cell is a pixel). A change of style
// takes the block from one pixel to the whole of it in PIXEL_STEPS steps, so
// that the scene is a different size three times in the second and a half, and
// not at every frame of it.
export const PIXEL_STEPS = 3;

// Which step a frame is at, for how far into the style the numbers are (0 to 1).
export const pixelLevel = (amount) => Math.floor(Math.min(1, Math.max(0, amount)) * PIXEL_STEPS + 0.5);

// The grid on a canvas w by h pixels at a step (0: none, no pixel style): the block,
// its cells across and up, and the scene's pixels to a cell.
export function pixelGrid(w, h, rows, level) {
  if (level <= 0) return null;
  const whole = Math.max(1, Math.round(h / rows));
  const block = Math.max(1, Math.round(1 + (whole - 1) * Math.min(level, PIXEL_STEPS) / PIXEL_STEPS));
  return { block, cols: Math.ceil(w / block), rows: Math.ceil(h / block), k: Math.min(2, block) };
}

// The pixel style's pass: a fragment to a cell of the frame (the scene's four pixels
// of it, in the colour of the frame the last pass left, the marks in its alpha, and
// the scene's depth), out in the colour of one of the 24 of the palette.
//  - The colour of a cell is the mean of its pixels (in the sky, the brightest of them:
//    a star is a cell), taken to the nearest two of
//    the palette in OKLab; the one of the two is chosen by where the cell's colour
//    is between them and a threshold from a 4 by 4 pattern laid on the grid (so, on
//    the screen: the one thing in the style that stays put as the world moves);
//    ditherK is how much of the way between two the pattern is at work over, and
//    pixelSat how much fuller than it is the colour is taken for the choice.
//  - Across a border two palettes are in the uniforms, the world's behind and the
//    world's ahead, and a cell takes one or the other by a threshold of its own
//    (uPalT is the share of the second): no cell has a colour of neither.
//  - The line round the car: a cell that is not the car's (none of its pixels is) and has
//    a cell of the car's beside it (up, down, left or right) takes the darkest grey,
//    unless what is in it is nearer the lens than the car by more than an eighth (the
//    grass in front of it; the road in front of its wheels is nearer by less).
// uPixel (0 to 1) is how much of the palette's colour a cell has in a change of style.
export const PIXEL_PASS = {
  uniforms: {
    tDiffuse: { value: null },
    tStyled: { value: null },
    tDepth: { value: null },
    uStyled: { value: 0 },
    uK: { value: 2 },
    uGrid: { value: new THREE.Vector2(1, 1) },
    uNearFar: { value: new THREE.Vector2(0.3, 14000) },
    uPixel: { value: 1 },
    uDitherK: { value: 0.85 },
    uSat: { value: 1 },
    uPalT: { value: 0 },
    uPalLab: { value: new Float32Array(COLOURS * 6) },
    uPalRgb: { value: new Float32Array(COLOURS * 6) },
  },
  vertexShader: /* glsl */`
    void main() {
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tStyled;
    uniform sampler2D tDepth;
    uniform float uStyled;
    uniform float uK;
    uniform vec2 uGrid;
    uniform vec2 uNearFar;
    uniform float uPixel;
    uniform float uDitherK;
    uniform float uSat;
    uniform float uPalT;
    uniform vec3 uPalLab[${COLOURS * 2}];
    uniform vec3 uPalRgb[${COLOURS * 2}];
    ${MARK_GLSL}

    float invFromZ(float zb) {
      float z = zb * 2.0 - 1.0;
      float n = uNearFar.x;
      float f = uNearFar.y;
      return (f + n - z * (f - n)) / (2.0 * n * f);
    }
    // Ordered dithering, 4 by 4: a threshold in (0, 1) for a cell.
    float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
    float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
    float threshold(vec2 cell) { return bayer4(mod(cell, 4.0)) + 0.03125; }
    // OKLab of an sRGB colour.
    vec3 labOf(vec3 c) {
      vec3 l = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
      vec3 q = pow(max(vec3(dot(l, vec3(0.4122214708, 0.5363325363, 0.0514459929)),
        dot(l, vec3(0.2119034982, 0.6806995451, 0.1073969566)),
        dot(l, vec3(0.0883024619, 0.2817188376, 0.6299787005))), 1e-8), vec3(1.0 / 3.0));
      return vec3(dot(q, vec3(0.2104542553, 0.793617785, -0.0040720468)),
        dot(q, vec3(1.9779984951, -2.428592205, 0.4505937099)),
        dot(q, vec3(0.0259040371, 0.7827717662, -0.808675766)));
    }
    // The colour of a cell: the mean of its scene pixels, the other style's frame if
    // one is drawn; in the sky (all its pixels are) the brightest of them, so that a
    // star a pixel or two across is a cell, not four dim ones. And whether any of it is
    // the car's, and the nearest thing in it (the inverse of its depth, the biggest).
    vec3 readCell(ivec2 c, out float car, out float inv) {
      int k = int(uK + 0.5);
      ivec2 o = c * k;
      vec3 sum = vec3(0.0);
      vec3 best = vec3(0.0);
      float bestL = -1.0;
      float sky = 1.0;
      car = 0.0;
      inv = 0.0;
      for (int j = 0; j < 2; j++) {
        for (int i = 0; i < 2; i++) {
          if (i >= k || j >= k) continue;
          ivec2 p = o + ivec2(i, j);
          vec4 t = texelFetch(tDiffuse, p, 0);
          vec3 col = uStyled > 0.5 ? texelFetch(tStyled, p, 0).rgb : t.rgb;
          float z = texelFetch(tDepth, p, 0).r;
          sum += col;
          inv = max(inv, invFromZ(z));
          car = max(car, markCar(t.a));
          sky = min(sky, step(0.999995, z));
          float l = dot(col, vec3(0.299, 0.587, 0.114));
          if (l > bestL) {
            bestL = l;
            best = col;
          }
        }
      }
      return mix(sum / float(k * k), best, sky);
    }
    // Whether any pixel of a cell is the car's, and how near the nearest of them is.
    float carCell(ivec2 c, out float invCar) {
      int k = int(uK + 0.5);
      ivec2 o = c * k;
      float car = 0.0;
      invCar = 0.0;
      for (int j = 0; j < 2; j++) {
        for (int i = 0; i < 2; i++) {
          if (i >= k || j >= k) continue;
          ivec2 p = o + ivec2(i, j);
          if (markCar(texelFetch(tDiffuse, p, 0).a) > 0.5) {
            car = 1.0;
            invCar = max(invCar, invFromZ(texelFetch(tDepth, p, 0).r));
          }
        }
      }
      return car;
    }
    // Whether the cell has a cell of the car's beside it, up, down, left or right, and
    // nothing in it nearer than the car, by an eighth.
    float ringAt(ivec2 c, float inv) {
      ivec2 last = ivec2(uGrid) - 1;
      float ring = 0.0;
      for (int n = 0; n < 4; n++) {
        ivec2 d = n == 0 ? ivec2(1, 0) : (n == 1 ? ivec2(-1, 0) : (n == 2 ? ivec2(0, 1) : ivec2(0, -1)));
        float invCar;
        if (carCell(clamp(c + d, ivec2(0), last), invCar) > 0.5 && inv <= invCar * 1.12) ring = 1.0;
      }
      return ring;
    }

    void main() {
      ivec2 cell = ivec2(gl_FragCoord.xy);
      vec2 cf = vec2(cell);
      float car;
      float inv;
      vec3 mean = readCell(cell, car, inv);
      // The world's own palette, or across a border the other's, by a threshold of the cell's own.
      int base = 0;
      if (uPalT > 0.0 && threshold(cf.yx + vec2(2.0, 1.0)) < uPalT) base = ${COLOURS};
      vec3 q;
      if (car < 0.5 && ringAt(cell, inv) > 0.5) {
        q = uPalRgb[base + ${INK}];
      } else {
        vec3 lab = labOf(mean);
        lab.yz *= uSat;
        float d1 = 1e9;
        float d2 = 1e9;
        int i1 = 0;
        int i2 = 0;
        for (int k = 0; k < ${COLOURS}; k++) {
          vec3 d = lab - uPalLab[base + k];
          float dd = dot(d, d);
          if (dd < d1) {
            d2 = d1;
            i2 = i1;
            d1 = dd;
            i1 = k;
          } else if (dd < d2) {
            d2 = dd;
            i2 = k;
          }
        }
        vec3 p1 = uPalLab[base + i1];
        vec3 e = uPalLab[base + i2] - p1;
        float t = clamp(dot(lab - p1, e) / max(dot(e, e), 1e-6), 0.0, 1.0);
        float th = 0.5 + (threshold(cf) - 0.5) * uDitherK;
        q = uPalRgb[base + (t > th ? i2 : i1)];
      }
      gl_FragColor = vec4(mix(mean, q, uPixel), 1.0);
    }
  `,
};

// The palettes the pass lays the frame in: the world's behind (a) and the world's ahead
// (b), as render/pixelpal.js makes them, and how much of the second (t, 0 to 1).
export function setPalettes(a, b, t) {
  const u = PIXEL_PASS.uniforms;
  u.uPalLab.value.set(a.lab, 0);
  u.uPalLab.value.set(b.lab, COLOURS * 3);
  u.uPalRgb.value.set(a.rgb, 0);
  u.uPalRgb.value.set(b.rgb, COLOURS * 3);
  u.uPalT.value = t;
}

// The style being drawn, and the move from one to the next.
export class Style {
  constructor(id = 'real') {
    this.id = STYLE_INDEX[id] !== undefined ? id : 'real';
    this.cur = styleParams(this.id);
    this.from = clone(this.cur);
    this.to = clone(this.cur);
    this.t = 1;
    this.wind = [0, 0];   // how far the wind has taken the clouds' shadows
    this._tier = 'high';   // how much there is to draw (render/quality.js)
    this.now = {};   // cur as this world has it (resolve)
    this._nightArr = {};
    this._sceneK = -1;
    this.resolve();
  }

  // How much there is to draw: 'high', 'mid' or 'low'. The liquids and torches
  // of the block style read it from the style's uniforms.
  get tier() {
    return this._tier;
  }

  set tier(t) {
    this._tier = t;
    styleU.uBlockLiq.value.y = t === 'low' ? 0 : t === 'mid' ? 0.5 : 1;
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
    else styleU.uCloudShade.value = this.now.cloudShade * skyCloudShade.value;
  }

  // The floating origin has moved: its digits for the shaders (absolute, for
  // broad things; modulo 1 km, for the blocks' texels).
  setOrigin(x, z) {
    styleU.uOriginAbs.value.set(x, 0, z);
    originMod.value.set(((x % 1024) + 1024) % 1024, 0, ((z % 1024) + 1024) % 1024);
  }

  // What the worlds under the lens are, for the ink: a and b are the two worlds (the data of
  // world/worlds.js) it is between and t how far into b it has gone, clouds how much cloud
  // the sky has there. Where the world has a liquid, the share of it a liquid's shader shows
  // (a third of the blend, as render/water.js has it), the kind of liquid, and the snow line,
  // where there is snow.
  setWorld(a, b, t, clouds) {
    const wa = hasLiquid(a) * (1 - t);
    const wb = hasLiquid(b) * t;
    const share = wa + wb;
    const k = Math.min(1, Math.max(0, (share - 0.35) / 0.3));
    const la = (a.liquid && a.liquid.cloud) || 0;
    const lb = (b.liquid && b.liquid.cloud) || 0;
    const ma = (a.liquid && a.liquid.lava) || 0;
    const mb = (b.liquid && b.liquid.lava) || 0;
    inkWorld.sea.value.set(
      share > 0 ? (wa * (a.params.water || 0) + wb * (b.params.water || 0)) / share : SEA_LEVEL,
      k * k * (3 - 2 * k),
      share > 0 ? (wa * la + wb * lb) / share : 0,
      share > 0 ? (wa * ma + wb * mb) / share : 0,
    );
    const sa = hasSnow(a) * (1 - t);
    const sb = hasSnow(b) * t;
    inkWorld.snow.value.set(sa + sb > 0 ? (sa * a.params.snowLine + sb * b.params.snowLine) / (sa + sb) : 1e5, sa + sb);
    inkWorld.cloud.value = clouds;
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
    const pairN = pairOf(c);
    for (const [k, [leaf, tree]] of Object.entries(PAIR_KINDS)) {
      const pp = pairParams(leaf, tree, pairN);
      pairUniform[k].p.value.set(...pp.p);
      pairUniform[k].t.value.set(...pp.t);
    }
    u.uHand.value = c.hand;
    u.uPairStep.value.fromArray(c.pairStep);
    pairStepNow[0] = c.pairStep[0];
    pairStepNow[1] = c.pairStep[1];
    u.uFlatLand.value = c.flatLand;
    u.uAirCut.value = c.airCut;
    u.uAirEdge.value.fromArray(c.airEdge);
    u.uFigDeep.value = c.figDeep;
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
    u.uCloudShade.value = c.cloudShade * skyCloudShade.value;
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
    skyStyle.uSkyStep.value = c.skyStep;
    skyStyle.uStarPx.value = c.starPx;
    skyStyle.uSkyAt.value.fromArray(c.skyAt);
    skyStyle.uBandZ.value.fromArray(c.skyBands, 0);
    skyStyle.uBandM.value.fromArray(c.skyBands, 3);
    skyStyle.uBandH.value.fromArray(c.skyBands, 6);
    u.uAirTint.value.fromArray(c.skyBands, 6);
    skyStyle.uSkyReal.value = c.real;
    skyStyle.uCloudReal.value = c.cloudReal;
    skyStyle.uCirrus.value = c.cirrus;
    u.uBlockLiq.value.x = c.block;
  }

  // How far off the trees are drawn one by one (m); 0 for as far as there are trees. A style whose far wood is
  // laid on the land (inkWood) draws them to where the land takes it over, and not at the low tier.
  get treeReach() {
    const w = this.cur.inkWood;
    return w[0] > 0.5 && this.tier !== 'low' ? w[4] : 0;
  }

  // Whether the last pass has anything to do.
  get drawn() {
    const c = this.now;
    return c.paint > 0 || c.flat > 0 || c.line > 0 || c.ink > 0 || c.poster > 0 || c.print > 0 || c.bokashi > 0
      || c.far > 0 || c.lift > 0 || c.dark > 0 || c.green > 0 || c.greenPal > 0 || c.block > 0
      || c.sat !== 1 || c.contrast !== 1 || c.warm !== 0 || c.vignette > 0;
  }

  // The inks the page is printed in (a print): the six of the look and the paper, and the three
  // tones of a cloud, as colours.
  _inks(u, c) {
    const inks = u.uInks.value;
    for (let i = 0; i < 6; i++) inks[i].fromArray(printInks, i * 3);
    inks[6].fromArray(c.paper);
    for (let i = 0; i < 7; i++) inkLab(inks[i], u.uInkLab.value[i]);
    const cl = u.uCloudInk.value;
    cl[0].fromArray(c.paper);
    cl[1].fromArray(PRINT_CLOUD.pale);
    cl[2].copy(cl[1]).lerp(inks[0], PRINT_CLOUD.shade);
  }

  // The last pass's numbers.
  applyPass(u, height, fov = 55) {
    const c = this.now;
    u.uBlock.value = c.block;
    u.uBlockK.value = c.blockK;
    u.uBlockJit.value = c.blockJit;
    u.uBlockFace.value = c.blockFace;
    // The low tier has none of the block's light; the middle one has it one pixel wide.
    u.uBlockAO.value.set(this.tier === 'low' ? 0 : c.blockAO, c.blockAOWidth, this.tier === 'high' ? 1 : 0);
    u.uBlockFade.value.fromArray(c.blockFade);
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
    u.uFigJump.value = c.figJump;
    u.uLineCol.value.fromArray(c.lineCol);
    u.uLineDark.value = c.lineDark;
    u.uLineFar.value = c.lineFar;
    u.uLineThin.value = c.lineThin;
    u.uJump.value.fromArray(c.jump);
    u.uJumpNet.value = c.jumpNet;
    u.uCrease.value = c.crease;
    u.uRidge.value = c.ridge;
    // The low tier lays no strokes; the middle one lays them over half the distance.
    u.uCun.value = this.tier === 'low' ? 0 : c.cun;
    u.uCunReach.value.fromArray(c.cunReach);
    if (this.tier === 'mid') u.uCunReach.value.multiplyScalar(0.5);
    u.uCunSlope.value.fromArray(c.cunSlope);
    u.uCunGrass.value = c.cunGrass;
    u.uCunPx.value = CUN.px * Math.max(1, height / 900);
    u.uBrush.value = c.brush;
    u.uInk.value = c.ink;
    u.uInkCurve.value.fromArray(c.inkCurve);
    u.uInkReach.value.fromArray(c.inkReach);
    u.uInkFade.value.fromArray(c.inkFade);
    u.uInkMist.value.fromArray(c.inkMist);
    u.uInkMistH.value.fromArray(c.inkMistH);
    u.uInkSky.value = c.inkSky;
    const s = Math.max(1, height / 900);
    u.uInkLine.value.set(c.inkLine[0], c.inkLine[1], c.inkLine[2], s);
    u.uInkLineT.value.fromArray(c.inkLineTone);
    u.uInkDye.value.fromArray(c.inkDye);
    // Leaves as dots of ink: at the low tier a wash only (no cells, and none of the work of finding the way a face goes).
    u.uInkLeaf.value = c.inkLeaf;
    u.uInkLeafT.value.fromArray(c.inkLeafT);
    u.uInkLand.value.set(c.inkWood[5], c.inkWood[6]);
    u.uInkDot.value.set(this.tier === 'low' ? 0 : Math.round(1024 / c.inkDot[0]), this.tier === 'high' ? Math.round(1024 / c.inkDot[1]) : 0, c.inkDot[2], c.inkDot[3]);
    u.uInkH.value = height;
    // The far wood on the land, the same at the low tier as it was (the land's colour, the trees to the far).
    styleU.uInkWood.value.set(this.tier === 'low' ? 0 : c.inkWood[0], c.inkWood[1], c.inkWood[2],
      2 * Math.tan(fov * Math.PI / 360) / height * c.inkWood[3] / INK_ROW);
    // Water, cloud and snow: the strokes on the water at the middle tier and the high one, the
    // clouds with the middle one's line and the high one's shade as well.
    u.uInkWater.value = c.inkWater;
    u.uInkSea.value.copy(inkWorld.sea.value);
    u.uInkWave.value.fromArray(c.inkWave);
    u.uInkWaveB.value.set(c.inkWave[4], c.inkWave[5]);
    u.uInkWaveFar.value.fromArray(c.inkWaveFar);
    u.uInkSeaLook.value.fromArray(c.inkSea);
    u.uInkMode.value.set(this.tier === 'low' ? 0 : 1, this.tier === 'high' ? 1 : 0, this.tier === 'high' ? 1 : 0);
    u.uInkMirror.value = c.inkMirror;
    u.uInkCloud.value.set(this.tier === 'low' ? 0 : c.inkCloud * inkWorld.cloud.value, c.inkCloudLine[0], c.inkCloudLine[1], c.inkCloudLine[2]);
    u.uInkSnow.value.set(inkWorld.snow.value.x, c.inkSnow * inkWorld.snow.value.y, c.inkSnowLit[0], c.inkSnowLit[1]);
    u.uInkWind.value.copy(styleU.uCloudDrift.value);
    u.uOriginAbs.value.copy(styleU.uOriginAbs.value);
    u.uKeep.value = c.keep;
    // The pale colour over the ink, but at the low tier.
    u.uQian.value = this.tier === 'low' ? 0 : c.qian;
    for (let i = 0; i < 3; i++) u.uQianInks.value[i].fromArray(c.qianInks, i * 3);
    u.uQianAt.value.set(c.qianFar[0], c.qianFar[1], c.qianTone[0], c.qianTone[1]);
    u.uPoster.value = c.poster;
    u.uLevels.value = c.levels;
    u.uPrint.value = c.print;
    u.uGrade.value.set(c.sat, c.contrast, c.warm, c.vignette);
    u.uPaper.value.fromArray(c.paper);
    u.uInkCol.value.fromArray(c.inkCol);
    u.uBlank.value = c.blank;
    u.uBokashi.value = c.bokashi;
    u.uSkyDay.value = skyDay.value;
    u.uSnapGain.value = c.snapGain;
    u.uSnapW.value.fromArray(c.snapW);
    u.uSnapLean.value.fromArray(c.snapLean);
    u.uSnapR.value = Math.max(1, height / 1000);
    u.uCloudAt.value.fromArray(c.cloudAt);
    u.uBokAt.value.fromArray(c.bokAt);
    // The low tier prints without the grain and with the plates in register (the key plate is
    // read once, not twice).
    u.uWood.value = this.tier === 'low' ? 0 : c.wood;
    u.uRegist.value = this.tier === 'low' ? 0 : c.regist * Math.max(1, height / 900);
    u.uKey.value = c.key;
    u.uKeyJit.value = c.keyJit;
    u.uFoot.value.fromArray(c.foot);
    u.uFootH.value.fromArray(c.footH);
    u.uSea.value.set(SEA_LEVEL, c.sea);
    u.uSeaAt.value.fromArray(c.seaAt);
    if (c.print > 0) this._inks(u, c);
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
  }
}
