// The small strip in front of each world in the world menu: the two colours of
// its sky, zenith above horizon, and one colour of its ground. All three are
// read from the world's own data (its look and its palette, the colours the
// shaders are given), not from what is on the screen, so a strip is the same in
// every style. The dots that hold a day world to one of its skies are made the
// same way: the zenith and the horizon of that sky.

import { WORLDS, hasSkies, skyLook } from '../world/worlds.js';

// Which palette colour is the ground of a world's strip: what the road runs on
// or, where a liquid is the floor of the world, the liquid (the river's water,
// the sea, the lava, the sea of cloud). Chosen so that no two of the twelve
// strips are alike: the four daylight worlds have almost the same sky, and it
// is the ground that tells them apart.
export const GROUND = {
  alpine: 'rock',
  hills: 'grassLow',
  river: 'waterDeep',
  coast: 'waterShallow',
  desert: 'sand',
  city: 'gravel',
  cavern: 'rock',
  inferno: 'waterShallow',
  abyss: 'grassLow',
  heaven: 'waterShallow',
  space: 'grassLow',
  upside: 'grassLow',
};

// { sky: [zenith, horizon], ground }, each an 0xRRGGBB number.
export function swatchOf(world) {
  const key = GROUND[world.id] || 'grassLow';
  const palette = key.startsWith('water') ? world.water : world.ground;
  const ground = palette && palette[key] !== undefined ? palette[key] : world.ground.grassLow;
  return { sky: [world.look.zenith, world.look.horizon], ground };
}

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

// A colour a look is written with (0xRRGGBB, or [r, g, b] in linear light) as
// an 0xRRGGBB number.
const encode = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
export const rgbNumber = (c) => (Array.isArray(c) ? (encode(c[0]) << 16) | (encode(c[1]) << 8) | encode(c[2]) : c);

// [zenith, horizon] of one of the skies (an id of SKIES), each an 0xRRGGBB
// number, for the dots that hold a day world to it: the same three in every
// row, those of the first day world (the day worlds' skies differ from each
// other by a little and from one sky to the next by a lot, and the two ends of a
// dot are what tells them apart: a desert's noon is a warm sky already).
export function skySwatchOf(id) {
  const look = skyLook(WORLDS.find(hasSkies).look, id);
  return [rgbNumber(look.zenith), rgbNumber(look.horizon)];
}

// The three colours onto an element as custom properties; `#worlds .sw` in
// index.html lays them out as a strip: the sky in a gradient down to the
// horizon, then a band of ground.
export function paintSwatch(el, world) {
  const s = swatchOf(world);
  el.style.setProperty('--sky0', hex(s.sky[0]));
  el.style.setProperty('--sky1', hex(s.sky[1]));
  el.style.setProperty('--ground', hex(s.ground));
}

// A dot's two colours onto its element, as the strip's are (the same custom
// properties: `#worlds .dot` in index.html lays them out).
export function paintSkyDot(el, id) {
  const [zenith, horizon] = skySwatchOf(id);
  el.style.setProperty('--sky0', hex(zenith));
  el.style.setProperty('--sky1', hex(horizon));
}
