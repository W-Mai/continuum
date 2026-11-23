// What the Upside Down has of its own along the way in and about the car, as
// numbers: the markers on the winding, the rain that falls the way up is here,
// the flash that comes down to the ground, the spores a pod throws.
//
// Pure functions and constants, with no three.js in them: the render code
// (render/waymarks.js, render/motes.js, render/strike.js, render/spores.js,
// render/upside.js) reads them, and tools/world_upside_check.mjs works the
// same things out here and finds them in the frame.

import { hash1, hash2, mulberry32 } from './noise.js';
import { HALF_FLAT } from './road.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// --- the markers on the winding -------------------------------------------------

// A pole stands each side of the road every `every` m of the wound stretch, a
// metre and a fifth high with a red lamp on it; an arch stands over the road
// every `arch` m, its crown `crown` m over it with a lamp on it. Both go on for
// `lead` m before the stretch and after it, where the road is still level. They
// are laid out while the car is within `sees` m of the stretch along the road.
export const MARKS = {
  every: 10,
  height: 1.2,
  arch: 25,
  crown: 6.4,
  lead: 60,
  sees: 2500,
};

// Where they stand, in metres along the road from the start of a stretch `run`
// m long (negative before it): the poles of the stretch, of the lead-in and of the
// lead-out, and the same for the arches. A pole is in the middle of each 10 m
// and an arch in the middle of each 25: a stretch of 200 m has 20 poles a side and
// 8 arches, and the lamps of the poles are 10 m apart all the way.
export function markLayout(run) {
  const poles = [];
  const arches = [];
  const lead = [];
  const leadArches = [];
  const n = Math.floor(run / MARKS.every);
  for (let k = 0; k < n; k++) poles.push(MARKS.every * (k + 0.5));
  const m = Math.floor(run / MARKS.arch);
  for (let k = 0; k < m; k++) arches.push(MARKS.arch * (k + 0.5));
  for (let o = MARKS.every / 2; o < MARKS.lead; o += MARKS.every) lead.push(-o, run + o);
  for (let o = MARKS.arch / 2; o < MARKS.lead; o += MARKS.arch) leadArches.push(-o, run + o);
  return { poles, arches, lead, leadArches };
}

// --- the rain -------------------------------------------------------------------

// The ash in the air is rain from `reach` m before the wound stretch to `reach` m
// past it, and the one gives way to the other over `ramp` m outside that. A
// streak is a point drawn `length` m long, along the way up, and rises at
// `speed` m/s (the three paces of the air's field go at 0.6, 1 and 1.5 of it).
export const RAIN = {
  reach: 300,
  ramp: 60,
  length: 0.4,
  speed: 7.5,
  density: 0.34,
  color: 0xc4d6ee,
  glow: 0.6,
  sway: 0.25,
  width: 1.3,           // px
};

// How much of the air's ash is rain, with the car `gap` m from the wound
// stretch along the road (0 in it): 1 within reach of it, none a ramp past that.
export function rainShare(gap) {
  return 1 - smooth(RAIN.reach, RAIN.reach + RAIN.ramp, Math.max(0, gap));
}

// How far from a stretch that starts at s0 and ends at s1 a place s of the road is.
export function gapTo(s, s0, s1) {
  return Math.max(s0 - s, s - s1, 0);
}

// --- the flash that comes down ----------------------------------------------------

// Every GROUND_EVERY'th flash comes down to the ground, a point `ahead` m on
// along the road from the car and `side` m to one side of it, which a hash of the
// flash's own number chooses (the lightning's own random draw says nothing
// about where; the same flash comes down in the same place). It leaves a mark on the
// ground that is `radius` m across and goes in `life` s, and the tentacles
// within `near` m of it shrink to `floor` of their height at once and grow back
// over `over` s.
export const STRIKE = {
  every: 5,
  ahead: [200, 580],
  side: [HALF_FLAT + 8, 80],
  tries: 6,
  radius: 4.5,
  life: 20,
  near: 40,
  floor: 0.4,
  over: 1.4,
  nodes: 72,             // in the bolt
  forkFrom: 0.34,        // where the branch leaves it, of its length
  forkReach: 0.45,
  width: [1.6, 0.9],     // m, at the top and at the ground
};

// Where flash number k (1, 2, ...) of a world seeded `seed` comes down: [ahead, side, try].
export function strikeSpot(seed, k, attempt) {
  const a = hash2(k, attempt * 3 + 1, seed ^ 0x51ee);
  const b = hash2(k, attempt * 3 + 2, seed ^ 0x51ee);
  const c = hash2(k, attempt * 3 + 3, seed ^ 0x51ee);
  const side = STRIKE.side[0] + (STRIKE.side[1] - STRIKE.side[0]) * Math.pow(b, 1.5);
  return [STRIKE.ahead[0] + (STRIKE.ahead[1] - STRIKE.ahead[0]) * a, c < 0.5 ? -side : side];
}

// How tall a tentacle stands, as a share of its height, `f` of its start (1) after
// the flash came down within `near` m of it, down to `floor` and back.
export function flinchScale(f) {
  return 1 - (1 - STRIKE.floor) * clamp01(f);
}

// A value that wanders along a line, in [0, 1): lattice values with a smooth step
// between them.
function wander(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash2(i, 0x3c6e, seed) * (1 - u) + hash2(i + 1, 0x3c6e, seed) * u;
}

// The same, with a corner at each lattice value instead of a smooth step: the bends of
// the finest sizes of a bolt are corners.
function kink(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  return hash2(i, 0x3c6e, seed) * (1 - f) + hash2(i + 1, 0x3c6e, seed) * f;
}

// How far across its own line a bolt is a point t of the way down it, as a share
// of its distance, in 4 sizes (the sky's bolt wanders the same way in 3; the
// 2 finest are corners).
export function boltOff(t, seed) {
  return 0.07 * (wander(t * 6, seed) - 0.5) + 0.025 * (wander(t * 19, seed + 5) - 0.5)
    + 0.008 * (kink(t * 61, seed + 9) - 0.5) + 0.005 * (kink(t * 143, seed + 13) - 0.5);
}

// The bolt from `height` m over the place it comes down to that place, as
// STRIKE.nodes points from the top (t 0) to the ground (t 1): how far across the
// lens's way to it, how high over the ground, and how far along it. The ground end is
// held to its place. `dist` is how far off the lens is.
export function boltPath(seed, dist, height, n = STRIKE.nodes) {
  const across = new Float32Array(n);
  const up = new Float32Array(n);
  const along = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const pin = Math.min(1, (1 - t) / 0.1);
    across[i] = dist * boltOff(t, seed) * pin;
    along[i] = dist * boltOff(t, seed + 31) * 0.45 * pin;
    up[i] = height * (1 - t);
  }
  return { across, up, along };
}

// The branch: from where it leaves the bolt, which of the two ways it goes by the
// flash's number, as many nodes as the bolt has to its reach. [{ i: the bolt's node
// it leaves, across, along (the bolt's own plus its own), up, fade }].
export function forkPath(seed, dist, path, n = STRIKE.nodes) {
  const sign = hash1(seed, 0x7f) > 0.5 ? 1 : -1;
  const out = [];
  const i0 = Math.round(STRIKE.forkFrom * (n - 1));
  const i1 = Math.min(n - 1, Math.round((STRIKE.forkFrom + STRIKE.forkReach) * (n - 1)));
  for (let i = i0; i <= i1; i++) {
    const t = i / (n - 1);
    const t2 = t - STRIKE.forkFrom;
    out.push({
      i,
      across: path.across[i] + dist * (boltOff(t, seed + 17) * 0.8 + sign * 0.22 * t2),
      along: path.along[i],
      up: path.up[i],
      fade: 1 - smooth(0.2, 0.7, t2),
    });
  }
  return out;
}

// --- the spores ------------------------------------------------------------------

// A pod within `reach` m of the car bursts; it throws `per` points that glow
// dark red, out and then slowly up (the way up of the world, not the screen's),
// each lasting `life` s.
export const SPORES = {
  reach: 8,
  per: 20,
  life: [6, 9],
  rise: 0.7,
  throw: [1.6, 4.2],
  drag: 1.8,
  size: [0.07, 0.13],
  color: 0xc01408,
  glow: 3.0,
  max: 480,
};

// What one burst of n spores is: for each, how it is thrown (a velocity, m/s), how
// long it lasts, how big it is and a number of its own. A burst is the same for
// the same pod.
export function sporeBurst(seed, n = SPORES.per) {
  const rand = mulberry32((seed ^ 0x5b0e) >>> 0);
  const out = [];
  for (let i = 0; i < n; i++) {
    // Out in every way, and some up: a ball squashed down.
    const az = rand() * Math.PI * 2;
    const el = (rand() * 0.9 - 0.25) * Math.PI / 2;
    const v = SPORES.throw[0] + (SPORES.throw[1] - SPORES.throw[0]) * rand();
    out.push({
      v: [Math.cos(az) * Math.cos(el) * v, Math.sin(el) * v, Math.sin(az) * Math.cos(el) * v],
      life: SPORES.life[0] + (SPORES.life[1] - SPORES.life[0]) * rand(),
      size: SPORES.size[0] + (SPORES.size[1] - SPORES.size[0]) * rand(),
      seed: rand(),
    });
  }
  return out;
}

// Where a spore is, `age` s after the burst, from where it began and how it was
// thrown: thrown out against the drag of the air and carried up by it.
export function sporeAt(p0, spec, age, out = [0, 0, 0]) {
  const k = SPORES.drag;
  const slide = (1 - Math.exp(-k * age)) / k;
  const sway = Math.min(age, 3) / 3 * 0.3;
  out[0] = p0[0] + spec.v[0] * slide + sway * Math.sin(age * 1.3 + spec.seed * 6.28);
  out[1] = p0[1] + spec.v[1] * slide + SPORES.rise * (age - slide);
  out[2] = p0[2] + spec.v[2] * slide + sway * Math.cos(age * 1.1 + spec.seed * 12.5);
  return out;
}
