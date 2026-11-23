// The palettes of the pixel style: 24 colours to a world, picked in OKLab (L the
// lightness 0 to 1, C the chroma, h the hue in degrees: 30 red, 110 yellow, 140
// green, 250 blue), the way a console's palette is laid out: six hues in three
// lightnesses each, and six greys.
//
// A world gives them as data (look.pixel in world/worlds.js):
//   ramps: six of [hue, chroma, dark, middle, light]: a colour and the three
//          lightnesses it is in (a colour that does not go in sRGB at that
//          lightness is taken as full as it goes);
//   grey:  [hue, chroma, six lightnesses]: the greys, darkest first, tinted a
//          little toward a hue.
// The colours are rounded to the eight bits a canvas has, so the colours of a
// frame are exactly these and no others. Entries 0 to 17 are the ramps, in
// order (three to a ramp, dark first), 18 to 23 the greys; the darkest of the
// greys (INK) is the colour of the line round the car.

export const COLOURS = 24;
export const INK = 18;

const RAD = Math.PI / 180;
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

// sRGB (0 to 1) to OKLab.
export function toOklab(r, g, b) {
  const lr = lin(r);
  const lg = lin(g);
  const lb = lin(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

// OKLab to sRGB (0 to 1; outside it where the colour does not go in sRGB).
export function fromOklab(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const inside = (c) => c.every((v) => v >= -0.0005 && v <= 1.0005);

// The colour at lightness L, chroma C and hue h, taken as full as sRGB has it where it
// has less than C there.
export function fromOklch(L, C, h) {
  let hi = C;
  let c = fromOklab(L, hi * Math.cos(h * RAD), hi * Math.sin(h * RAD));
  if (!inside(c)) {
    let lo = 0;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inside(fromOklab(L, mid * Math.cos(h * RAD), mid * Math.sin(h * RAD)))) lo = mid;
      else hi = mid;
    }
    c = fromOklab(L, lo * Math.cos(h * RAD), lo * Math.sin(h * RAD));
  }
  return c.map((v) => Math.min(1, Math.max(0, v)));
}

// A world's palette from its spec: the colours in sRGB (rgb, three numbers each)
// and in OKLab (lab), 24 of each.
export function paletteOf(spec) {
  const colours = [];
  for (const [h, c, ...ls] of spec.ramps) for (const l of ls) colours.push(fromOklch(l, c, h));
  const [gh, gc, ...gl] = spec.grey;
  for (const l of gl) colours.push(fromOklch(l, gc, gh));
  const rgb = new Float32Array(COLOURS * 3);
  const lab = new Float32Array(COLOURS * 3);
  colours.forEach((c, i) => {
    const q = c.map((v) => Math.round(v * 255) / 255);
    rgb.set(q, i * 3);
    lab.set(toOklab(q[0], q[1], q[2]), i * 3);
  });
  return { rgb, lab };
}

// What a world with no palette of its own is drawn in.
export const DEFAULT_SPEC = {
  ramps: [
    [40, 0.16, 0.40, 0.56, 0.70],
    [75, 0.08, 0.44, 0.60, 0.76],
    [118, 0.13, 0.42, 0.60, 0.78],
    [148, 0.09, 0.28, 0.40, 0.54],
    [205, 0.05, 0.46, 0.62, 0.78],
    [252, 0.12, 0.46, 0.62, 0.80],
  ],
  grey: [250, 0.01, 0.18, 0.32, 0.47, 0.62, 0.80, 0.95],
};
