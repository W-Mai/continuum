// The numbers of what the heaven has of its own, and where and when each of
// them is: the cloud sea's thickness and the ring of colour on it, the cranes
// that fly over it in skeins, the bell of its temples. Each is a pure function
// of its index, the seed and the clock, so the same drive has the same skeins
// and the same bells every time; nothing here touches three.js.
//
//  - The cloud sea is three sheets of the one rolling noise: the sea itself and
//    two thin veils over it, at 6 and 14 m, each read where the line from the
//    lens to the sea passes through it, so that close by they part and show the
//    sea's depth and far off they lie on it as one. Where an island or a pier
//    goes down into it, it goes into the white over MIST m, not at a line.
//  - The ring: round the point of the sea straight away from the sun, two faint
//    rings of colour, blue inside and red outside, as bright at most as GAIN
//    over the cloud.
//  - The cranes: skeins of 5 to 9 in a V, each flying straight and slow, 40 to
//    120 m over the sea, in a box that rides with the lens.
//  - The bell: within 400 m of a temple, one stroke every 20 to 40 seconds.

import { WORLD_INDEX } from './worlds.js';

export const HEAVEN = WORLD_INDEX.heaven;

export function hash3(a, b, c) {
  let h = (Math.imul(a | 0, 0x8da6b343) ^ Math.imul(b | 0, 0xd8163841) ^ Math.imul(c | 0, 0x2545f491)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// The veils: their height over the sea (m), how opaque each is where it is
// thickest, and where in the noise each is read (m, so that the three sheets
// are not the same pattern stacked); mist: the depth (m) over which a thing
// going down into the cloud goes white.
export const SHELLS = [
  { y: 6, opacity: 0.35, shift: [173, -611] },
  { y: 14, opacity: 0.18, shift: [-937, 389] },
];
export const MIST = 8;

// The ring round the point away from the sun: the radius of each ring and its
// width (degrees), and how much brighter than the cloud it is at its brightest.
export const HALO = { rings: [1.2, 2.3], width: 0.4, gain: 0.06 };

// The cranes: how many skeins each tier flies, how many cranes are in one
// (least, most), how wide the V opens (degrees between its arms), the height
// over the sea (m), the speed (m/s), the gap between two along an arm (m), the
// wing beats a second, the span of a crane's wings (m); box: the side of the box
// that rides with the lens (m).
export const CRANES = {
  skeins: { high: 4, mid: 2, low: 0 },
  count: [5, 9], spread: [40, 90], height: [40, 120],
  speed: 11, gap: 5.5, beat: 0.75, span: 2.3, box: 1400,
};

// Skein f (0, 1, ...): how many cranes, how wide its V (radians between the
// arms), how high over the sea, which way it flies (radians from +x toward +z),
// where it starts in the box (0..1, 0..1) and its own phase.
export function skein(f) {
  const c = CRANES;
  const n = c.count[0] + Math.floor(hash3(f, 1, 0x6b) * (c.count[1] - c.count[0] + 1));
  const spread = (c.spread[0] + (c.spread[1] - c.spread[0]) * hash3(f, 2, 0x6b)) * Math.PI / 180;
  return {
    n: Math.min(n, c.count[1]),
    spread,
    height: c.height[0] + (c.height[1] - c.height[0]) * hash3(f, 3, 0x6b),
    heading: hash3(f, 4, 0x6b) * Math.PI * 2,
    at: [hash3(f, 5, 0x6b), hash3(f, 6, 0x6b)],
    phase: hash3(f, 7, 0x6b),
  };
}

// Where crane i of a skein is from its leader: metres back along the way it
// flies, and to its side (+ right of the way, - left). The leader (0) is at the
// point of the V; the others go back along the two arms in turn.
export function placeInSkein(sk, i) {
  if (i === 0) return { back: 0, side: 0 };
  const rank = Math.ceil(i / 2);
  const s = i % 2 ? 1 : -1;
  const half = sk.spread / 2;
  return { back: rank * CRANES.gap * Math.cos(half), side: s * rank * CRANES.gap * Math.sin(half) };
}

// The bell: how near a temple the lens has to be (m), the seconds between two
// strokes (least, most), the first after the lens comes in reach, and the bell
// itself: its pitch (Hz), its five partials (times the pitch), the level of each,
// and how long it takes to die away (s).
export const BELL = {
  reach: 400, apart: [20, 40], first: 3,
  pitch: 196, partials: [0.56, 1, 1.19, 1.71, 2.74], levels: [0.5, 1, 0.55, 0.4, 0.25], decay: 6,
};

// The seconds from stroke n - 1 to stroke n (n from 1) in the heaven of seed.
export function bellGap(n, seed) {
  if (n <= 1) return BELL.first;
  return BELL.apart[0] + (BELL.apart[1] - BELL.apart[0]) * hash3(n, 41, seed | 0);
}

// How loud a stroke is at d metres from its temple, 0 to 1.
export function bellLevel(d) {
  if (!(d < BELL.reach)) return 0;
  return Math.min(1, 1.15 - 0.75 * (d / BELL.reach));
}
