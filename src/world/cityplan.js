// What the city's towers carry, worked out from the lot a tower stands on (render/city.js bakes
// it into a tile; render/citylife.js draws what stands on the roofs and the lamps of the parks,
// the towers' shader draws the signs): plain numbers, so that the checks run them in node.

import { hash2 } from './noise.js';

// The signs: on three in ten of the buildings, on one face of the block (the one toward the road), over the street floor
// (its bottom on the second or the third storey, as wide as a third to a half of the face and two
// metres or so high), a lit panel: on its dark ground a row of three or four plain shapes (a disc, a
// bar or a triangle, none of them a letter), all of one of four colours, under a thin edge of it;
// one in three of them goes out for a moment once every two to five seconds. They are drawn by the
// building's own shader (the panel is where it is on the facade, in metres, as the windows are),
// within SIGN.reach of the lens, and not at the low tier (signU.uSign.y). Where each is, and what it
// is, render/city.js works out (signOf) and gives the instance (aSignA, aSignB).
export const SIGN = {
  share: 0.3,
  reach: 150,
  fade: 20,
  // The colours (linear, as they glow in the real style, and as they are on the screen in the painted one).
  colours: [[1.0, 0.16, 0.3], [0.12, 0.8, 1.0], [1.0, 0.6, 0.1], [0.32, 1.0, 0.42]],
  painted: [[0.78, 0.2, 0.3], [0.2, 0.62, 0.78], [0.82, 0.55, 0.16], [0.36, 0.74, 0.38]],
  glow: 2.2,
  blink: 1 / 3,
  period: [2, 5],
  off: 0.18,          // s the sign is out for, when it blinks
};
// No sign: the face is -1.
export const NO_SIGN = [-1, 0, 0, 0, 0, 0, 0, 0];
// m kept between a tower and the middle of the railway, past the half of the tower's diagonal.
export const RAIL_CLEAR = 9;
export const STEAM_SHARE = 0.1;
// The lamps of the parks: every so many metres, where the park is at least so much, so high over the ground.
export const PARK_LAMP = { every: 30, park: 0.4, height: 0.9 };

// A building's sign (lot i, j): [face (0 +x, 1 -x, 2 +z, 3 -z of the box), its middle across the
// face (m from the face's edge), its bottom (m up the box, which stands 0.6 m into the ground),
// its width, its height, a seed, its colour (0..3), its period (s, 0 if it does not blink)].
// The face is the one given (the face toward the road, where render/city.js finds the road near), or one the hash picks.
export function signOf(i, j, seed, w, d, toward = -1) {
  const h = (k) => hash2(i, j, seed + 30 + k);
  const face = toward >= 0 ? toward : Math.min(3, Math.floor(h(0) * 4));
  const fw = face < 2 ? d : w;
  const width = Math.min(fw - 2.4, fw * (0.34 + 0.18 * h(1)));
  const height = 1.7 + 0.9 * h(2);
  const across = 1.2 + width / 2 + (fw - 2.4 - width) * h(3);
  const bottom = 0.6 + (h(4) < 0.5 ? 4.8 : 8.2);
  const colour = Math.min(3, Math.floor(h(5) * 4));
  const period = h(6) < SIGN.blink ? SIGN.period[0] + (SIGN.period[1] - SIGN.period[0]) * h(7) : 0;
  return [face, across, bottom, width, height, h(8), colour, period];
}

// What stands on a roof of w by d at y (the building's middle cx, cz, turned rot): as many things
// as its area has room for, 0 to 6 (one more for every 240 m2, give or take a hash), each in a slot
// of a three by two grid over the roof so that none stands in another: a lift's machine room (a
// box, on a roof of 400 m2 and more, in the first slot), water tanks (upright cylinders), the boxes
// of air conditioners and aerials (thin cylinders). Pushed onto out, nine numbers each:
// [x, y of its foot, z, size x, size y, size z, angle, shape (0 a box, 1 a cylinder), shade].
// Returns how many.
export const ROOF = { per: 240, most: 6, reach: 300 };
export function roofOf(out, i, j, seed, cx, y, cz, w, d, rot) {
  const h = (k) => hash2(i, j, seed + 40 + k);
  const n = Math.max(0, Math.min(ROOF.most, Math.floor((w * d) / ROOF.per + 1.4 * h(0) - 0.5)));
  if (!n) return 0;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const sw = w / 3;
  const sd = d / 2;
  // The slots, in an order the hash picks.
  const order = [0, 1, 2, 3, 4, 5];
  for (let k = 5; k > 0; k--) {
    const m = Math.floor(h(10 + k) * (k + 1));
    [order[k], order[m]] = [order[m], order[k]];
  }
  for (let q = 0; q < n; q++) {
    const slot = order[q];
    const r = (k) => h(20 + q * 8 + k);
    let kind = r(0) < 0.4 ? 1 : r(0) < 0.75 ? 2 : 3;
    if (q === 0 && w * d >= 400) kind = 0;
    let sx;
    let sy;
    let sz;
    let shape = 0;
    if (kind === 0) {
      sx = Math.min(sw * 0.9, 4 + 1.5 * r(1));
      sz = Math.min(sd * 0.9, 3.5 + 1.5 * r(2));
      sy = 3 + r(3);
    } else if (kind === 1) {
      sx = sz = Math.min(sw, sd) * 0.8 * (0.45 + 0.3 * r(1));
      sy = 2.4 + 1.6 * r(2);
      shape = 1;
    } else if (kind === 2) {
      sx = Math.min(sw * 0.8, 1.6 + 0.8 * r(1));
      sz = Math.min(sd * 0.8, 1.0 + 0.4 * r(2));
      sy = 1.0 + 0.3 * r(3);
    } else {
      sx = sz = 0.16;
      sy = 4 + 5 * r(1);
      shape = 1;
    }
    // The slot's middle on the roof, nudged within what the slot leaves of it.
    const ox = -w / 2 + sw * ((slot % 3) + 0.5) + (sw - sx) * 0.4 * (r(4) - 0.5);
    const oz = -d / 2 + sd * (Math.floor(slot / 3) + 0.5) + (sd - sz) * 0.4 * (r(5) - 0.5);
    out.push(cx + ox * cr + oz * sr, y, cz - ox * sr + oz * cr, sx, sy, sz, rot, shape, r(6));
  }
  return n;
}

