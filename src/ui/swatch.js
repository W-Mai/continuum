// The small strip in front of each world in the world menu: the two colours of
// its sky, zenith above horizon, and one colour of its ground. All three are
// read from the world's own data (its look and its palette, the colours the
// shaders are given), not from what is on the screen, so a strip is the same in
// every style.

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

// The three colours onto an element as custom properties; `#worlds .sw` in
// index.html lays them out as a strip: the sky in a gradient down to the
// horizon, then a band of ground.
export function paintSwatch(el, world) {
  const s = swatchOf(world);
  el.style.setProperty('--sky0', hex(s.sky[0]));
  el.style.setProperty('--sky1', hex(s.sky[1]));
  el.style.setProperty('--ground', hex(s.ground));
}
