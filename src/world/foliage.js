// The foliage of the trees, drawn in numbers: an atlas of four cards (a twig of broad
// leaves, a spray of spruce needles, tufts of pine needles, the bare twigs of a dead
// tree) and a square tile of furrowed bark that repeats. Every texel comes out of the
// code below, from fixed seeds. The atlas and the bark come with all their mips, made
// here too: a card's colour is averaged in linear light, each texel weighted by its
// alpha, so that a far card is the colour of its leaves and not of the gaps between
// them, and its alpha, which a shader reads against a dither, keeps its mean down the
// chain; the bark's normals are averaged and made unit again.
//
// This file touches no three.js, so the page and a worker (world/bakeworker.js) run the
// same code and get the same bytes. For that it asks of the engine nothing that an
// engine may round its own way: no sine, no power, no exponential, no logarithm; the
// angles, the sRGB curve and its inverse are worked out from sums, products, quotients
// and square roots.
//
// What the atlas is (bakeFoliage(tier)[0]): { name: 'atlas', size, a } where a is RGBA
// bytes, all the mips one after the other from the largest. The atlas is 2 by 2 cards of
// size / 2 texels; card i is LEAF_KINDS[i], in column i % 2 and row i >> 1. Row r of the
// bytes is the texture's v = (r + 0.5) / size (the texture is not flipped), so a card
// grows up with its row: its twig is held at the foot of the card, in the small rows, at
// the middle of its width. RGB is the colour as sRGB bytes and A the coverage of a leaf,
// a needle or a twig (255 in it, 0 outside, a texel of grey between), not premultiplied.
// A texel with no coverage carries the colour of the nearest painted texel (the card's
// mean colour beyond a few texels of it), so that a filter never draws a dark fringe,
// and every card keeps a margin clear of paint against its neighbours: 2 texels at the
// largest size, 1 at the others.
//
// What the bark is (bakeFoliage(tier)[1]): { name: 'bark', size, a }, a square tile that
// repeats both ways, u round the trunk and v along it, the furrows running along v. RGB
// is a tangent-space normal as (n * 0.5 + 0.5) * 255, x toward +u, y toward +v, z out of
// the bark (no slope is steeper than 45 degrees), and is data, not a colour; A is the
// cavity, 255 on the top of a ridge and about 90 at the bottom of a furrow, which
// multiplies the colour of the wood.

export const LEAF_KINDS = ['broadleaf', 'conifer', 'pine', 'dead'];

// atlas: texels across the atlas (two cards across it); bark: texels across the bark's tile.
export const FOLIAGE_TIERS = {
  high: { atlas: 512, bark: 256 },
  mid: { atlas: 256, bark: 128 },
  low: { atlas: 128, bark: 64 },
};

// What the textures hold, which the shaders and the impostors take as given: for each
// card the mean of its alpha (0 to 1) over the card's texels, and the mean colour (linear)
// of its covered texels, each weighted by its alpha; for the bark the mean of its cavity
// (0 to 1). All of it at the largest size, from level 0 of the chain. A smaller tier
// keeps within 0.01 of the alpha, 0.001 of the colour and 0.002 of the cavity.
export const FOLIAGE_MEANS = {
  broadleaf: { alpha: 0.64, rgb: [0.0607, 0.1259, 0.0144] },
  conifer: { alpha: 0.521, rgb: [0.017, 0.0428, 0.0135] },
  pine: { alpha: 0.396, rgb: [0.0539, 0.1152, 0.0191] },
  dead: { alpha: 0.158, rgb: [0.0764, 0.0605, 0.0438] },
  bark: { cavity: 0.833 },
};

// The mips of a square texture, from the largest to a single texel.
export function mipSizes(size) {
  const out = [];
  for (let s = size; s >= 1; s >>= 1) out.push(s);
  return out;
}

// Bytes of the atlas's and the bark's `a` at a tier, all mips.
export function foliageBytes(tier) {
  const { atlas, bark } = FOLIAGE_TIERS[tier];
  const texels = (size) => mipSizes(size).reduce((n, s) => n + s * s, 0);
  return { atlas: texels(atlas) * 4, bark: texels(bark) * 4 };
}

// Where a card is in the atlas, as [u0, v0, u1, v1].
export function atlasRect(i) {
  const u = (i % 2) / 2;
  const v = (i >> 1) / 2;
  return [u, v, u + 0.5, v + 0.5];
}

// --- numbers --------------------------------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A number from three whole ones, 0 to 1.
function hash(x, y, z) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Value noise over a plane, 0 to 1, smooth between the lattice's points.
function vnoise(x, y, z) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const wx = fx * fx * (3 - 2 * fx);
  const wy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, z);
  const b = hash(x0 + 1, y0, z);
  const c = hash(x0, y0 + 1, z);
  const d = hash(x0 + 1, y0 + 1, z);
  return a + (b - a) * wx + (c - a) * wy + (a - b - c + d) * wx * wy;
}

const PI = 3.141592653589793;
const DEG = PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// [cos, sin] of an angle in radians, from the series.
function cs(a) {
  a -= 2 * PI * Math.round(a / (2 * PI));
  let sign = 1;
  if (a > PI / 2) {
    a = PI - a;
    sign = -1;
  } else if (a < -PI / 2) {
    a = -PI - a;
    sign = -1;
  }
  const a2 = a * a;
  let s = a;
  let c = 1;
  let ts = a;
  let tc = 1;
  for (let k = 1; k < 10; k++) {
    ts *= -a2 / ((2 * k) * (2 * k + 1));
    tc *= -a2 / ((2 * k - 1) * (2 * k));
    s += ts;
    c += tc;
  }
  return [sign * c, s];
}

// A direction (dx, dy) turned by `a` radians, counter-clockwise.
function turn(dx, dy, a) {
  const [c, s] = cs(a);
  return [dx * c - dy * s, dx * s + dy * c];
}

// The fifth root, by Newton's steps.
function root5(a) {
  let r = 1;
  for (let k = 0; k < 24; k++) {
    const r2 = r * r;
    r = (4 * r + a / (r2 * r2)) * 0.2;
  }
  return r;
}

// x to the 2.4 for x > 0: x squared times the fifth root of x squared.
function pow24(x) {
  const q = x * x;
  return q * root5(q);
}

// The sRGB curve, a coded value (0 to 1) to a linear one.
const toLinear = (x) => (x <= 0.04045 ? x / 12.92 : pow24((x + 0.055) / 1.055));

// The 256 bytes as linear values; EDGE[c] the linear value from which a byte rounds up
// to c + 1; ENC a table to start the search for a byte from; LIN the curve in steps of
// 1 / 1024 for colours given as numbers.
const BYTE = new Float64Array(256);
const EDGE = new Float64Array(255);
const ENC = new Uint8Array(4097);
const LIN = new Float64Array(1025);
for (let i = 0; i < 256; i++) BYTE[i] = toLinear(i / 255);
for (let i = 0; i < 255; i++) EDGE[i] = toLinear((i + 0.5) / 255);
for (let k = 0, c = 0; k <= 4096; k++) {
  while (c < 255 && k / 4096 >= EDGE[c]) c++;
  ENC[k] = c;
}
for (let k = 0; k <= 1024; k++) LIN[k] = toLinear(k / 1024);

// A coded colour (0 to 1) as linear light.
function lin(x) {
  const f = clamp(x, 0, 1) * 1024;
  const k = f >= 1024 ? 1023 : f | 0;
  return LIN[k] + (LIN[k + 1] - LIN[k]) * (f - k);
}

// A linear value (0 to 1) as the byte that is nearest in the sRGB curve.
function encode(l) {
  if (l <= 0) return 0;
  if (l >= 1) return 255;
  let c = ENC[(l * 4096) | 0];
  while (c < 255 && l >= EDGE[c]) c++;
  while (c > 0 && l < EDGE[c - 1]) c--;
  return c;
}

const lin3 = (c) => [lin(c[0]), lin(c[1]), lin(c[2])];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

// --- the brush ------------------------------------------------------------------------

// A card being drawn: the colour (premultiplied, linear) and the coverage of its T by T
// texels, row 0 at the foot of the card, a margin of m texels that is left clear, and a
// scratch that a stroke is built in.
function sheet(T, m) {
  return {
    T,
    m,
    halo: 0.011 * T,
    P: new Float32Array(T * T * 3),
    A: new Float32Array(T * T),
    sc: new Float32Array(T * T),
    su: new Float32Array(T * T),
    hit: new Int32Array(T * T),
    nHit: 0,
  };
}

// `cov` of the colour (r, g, b) laid over what is on the texel; `dark` of that coverage
// is how much the paint that was there is darkened.
function put(s, i, cov, r, g, b, dark) {
  const P = s.P;
  const j = i * 3;
  const keep = (1 - cov) * (1 - dark * cov);
  P[j] = P[j] * keep + r * cov;
  P[j + 1] = P[j + 1] * keep + g * cov;
  P[j + 2] = P[j + 2] * keep + b * cov;
  s.A[i] += cov * (1 - s.A[i]);
}

// How much of a texel a strip of half width hw lies over, the strip's axis d from the
// texel's middle (texels).
function strip(d, hw) {
  let a = d - 0.5;
  if (a < -hw) a = -hw;
  let b = d + 0.5;
  if (b > hw) b = hw;
  return b > a ? b - a : 0;
}

// Calls f(i, cov, u) for every texel that a straight segment of round ends touches (texel
// units, half widths h0 to h1): cov how much of the texel it covers, u how far along the
// segment the texel is. Nothing is touched within the sheet's margin.
function scan(s, x0, y0, x1, y1, h0, h1, f) {
  const T = s.T;
  const lo = s.m;
  const hi = T - s.m - 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return;
  const ux = dx / len;
  const uy = dy / len;
  const e = 0.5 * (Math.abs(ux) + Math.abs(uy));
  const R = Math.max(h0, h1) + e;
  const ya = Math.max(lo, Math.floor(Math.min(y0, y1) - R));
  const yb = Math.min(hi, Math.ceil(Math.max(y0, y1) + R));
  for (let Y = ya; Y <= yb; Y++) {
    const yc = Y + 0.5;
    let xl;
    let xr;
    if (dy > -1e-9 && dy < 1e-9) {
      xl = Math.min(x0, x1) - R;
      xr = Math.max(x0, x1) + R;
    } else {
      let ta = (yc - R - y0) / dy;
      let tb = (yc + R - y0) / dy;
      if (ta > tb) {
        const q = ta;
        ta = tb;
        tb = q;
      }
      if (ta < 0) ta = 0;
      if (tb > 1) tb = 1;
      if (ta > tb) continue;
      const xa = x0 + dx * ta;
      const xb = x0 + dx * tb;
      xl = Math.min(xa, xb) - R;
      xr = Math.max(xa, xb) + R;
    }
    const X0 = Math.max(lo, Math.floor(xl));
    const X1 = Math.min(hi, Math.ceil(xr));
    const py = yc - y0;
    for (let X = X0; X <= X1; X++) {
      const px = X + 0.5 - x0;
      const along = px * ux + py * uy;
      const across = Math.abs(py * ux - px * uy);
      let d;
      let u;
      if (along <= 0) {
        d = Math.sqrt(along * along + across * across);
        u = 0;
      } else if (along >= len) {
        const q = along - len;
        d = Math.sqrt(q * q + across * across);
        u = 1;
      } else {
        d = across;
        u = along / len;
      }
      const hw = h0 + (h1 - h0) * u;
      let a = d - e;
      if (a < -hw) a = -hw;
      let b = d + e;
      if (b > hw) b = hw;
      if (b <= a) continue;
      f(Y * s.T + X, (b - a) / (2 * e), u);
    }
  }
}

// A straight tapered line (tile units: wa and wb the widths), its colour going from ca to
// cb (linear), a grain of `grain` in the colour from texel to texel.
function line(s, ax, ay, bx, by, wa, wb, ca, cb, dark, grain) {
  const T = s.T;
  const r0 = ca[0];
  const g0 = ca[1];
  const b0 = ca[2];
  const dr = cb[0] - r0;
  const dg = cb[1] - g0;
  const db = cb[2] - b0;
  scan(s, ax * T, ay * T, bx * T, by * T, wa * T * 0.5, wb * T * 0.5, (i, cov, u) => {
    const k = grain ? 1 + grain * (hash(i, 7, 3) - 0.5) : 1;
    put(s, i, cov, (r0 + dr * u) * k, (g0 + dg * u) * k, (b0 + db * u) * k, dark);
  });
}

// A bent line through points [x0, y0, x1, y1, ...] (tile units), as wide as wa at its
// start and wb at its end. Its colour goes from ca to cb from `from` of its length on
// (0 to 1). Where its pieces meet they are one stroke: the texel takes the most of them.
function stroke(s, pts, wa, wb, ca, cb, from, dark, grain) {
  const T = s.T;
  const n = pts.length / 2;
  let total = 0;
  for (let k = 1; k < n; k++) {
    const dx = pts[2 * k] - pts[2 * k - 2];
    const dy = pts[2 * k + 1] - pts[2 * k - 1];
    total += Math.sqrt(dx * dx + dy * dy);
  }
  if (total < 1e-9) return;
  s.nHit = 0;
  let acc = 0;
  for (let k = 1; k < n; k++) {
    const x0 = pts[2 * k - 2];
    const y0 = pts[2 * k - 1];
    const x1 = pts[2 * k];
    const y1 = pts[2 * k + 1];
    const len = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
    const f0 = acc / total;
    const f1 = (acc + len) / total;
    scan(s, x0 * T, y0 * T, x1 * T, y1 * T, lerp(wa, wb, f0) * T * 0.5, lerp(wa, wb, f1) * T * 0.5, (i, cov, u) => {
      if (cov > s.sc[i]) {
        if (s.sc[i] === 0) s.hit[s.nHit++] = i;
        s.sc[i] = cov;
        s.su[i] = f0 + (f1 - f0) * u;
      }
    });
    acc += len;
  }
  for (let h = 0; h < s.nHit; h++) {
    const i = s.hit[h];
    const cov = s.sc[i];
    const t = smooth(from, 1, s.su[i]);
    const k = grain ? 1 + grain * (hash(i, 7, 3) - 0.5) : 1;
    s.sc[i] = 0;
    put(s, i, cov, lerp(ca[0], cb[0], t) * k, lerp(ca[1], cb[1], t) * k, lerp(ca[2], cb[2], t) * k, dark);
  }
}

// The length of a path (flat [x, y, ...]).
function pathLength(pts) {
  let total = 0;
  for (let k = 1; k < pts.length / 2; k++) {
    const dx = pts[2 * k] - pts[2 * k - 2];
    const dy = pts[2 * k + 1] - pts[2 * k - 1];
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

// The points and the heading of a path (flat [x, y, ...]) at a length along it.
function along(pts, d) {
  let acc = 0;
  const n = pts.length / 2;
  for (let k = 1; k < n; k++) {
    const dx = pts[2 * k] - pts[2 * k - 2];
    const dy = pts[2 * k + 1] - pts[2 * k - 1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (acc + len >= d || k === n - 1) {
      const t = len > 0 ? clamp((d - acc) / len, 0, 1) : 0;
      return [pts[2 * k - 2] + dx * t, pts[2 * k - 1] + dy * t, dx / len, dy / len];
    }
    acc += len;
  }
  return [pts[0], pts[1], 0, 1];
}

// A path from (x, y) heading (dx, dy), `len` long in steps of about `step`; it turns
// toward the vertical by `bend` radians a unit of length and wanders by up to `wob`
// radians a step.
function walk(rand, x, y, dx, dy, len, step, bend, wob) {
  const n = Math.max(2, Math.round(len / step));
  const h = len / n;
  const pts = [x, y];
  for (let k = 0; k < n; k++) {
    const a = (dx > 0.02 ? 1 : dx < -0.02 ? -1 : 0) * bend * h + (rand() * 2 - 1) * wob;
    [dx, dy] = turn(dx, dy, a);
    x += dx * h;
    y += dy * h;
    pts.push(x, y);
  }
  return pts;
}

// A path (flat [x, y, ...]) cut where it first leaves the box [x0, x1] by [y0, y1].
function trim(pts, x0, x1, y0, y1) {
  for (let k = 0; k < pts.length / 2; k++) {
    const x = pts[2 * k];
    const y = pts[2 * k + 1];
    if (x < x0 || x > x1 || y < y0 || y > y1) return pts.slice(0, Math.max(2, 2 * k));
  }
  return pts;
}

// A path (flat [x, y, ...]) as far as `len` along it.
function cut(pts, len) {
  const out = [pts[0], pts[1]];
  let acc = 0;
  for (let k = 1; k < pts.length / 2; k++) {
    const dx = pts[2 * k] - pts[2 * k - 2];
    const dy = pts[2 * k + 1] - pts[2 * k - 1];
    const l = Math.sqrt(dx * dx + dy * dy);
    if (acc + l >= len) {
      const t = l > 0 ? (len - acc) / l : 0;
      out.push(pts[2 * k - 2] + dx * t, pts[2 * k - 1] + dy * t);
      return out;
    }
    out.push(pts[2 * k], pts[2 * k + 1]);
    acc += l;
  }
  return out;
}

// --- leaves ---------------------------------------------------------------------------

const NP = 64;

// x to the power k / 4, for x >= 0.
function pw4(x, k) {
  const h = Math.sqrt(x);
  const q = Math.sqrt(h);
  let w = 1;
  for (let i = 0; i < k >> 2; i++) w *= x;
  return w * [1, q, h, h * q][k & 3];
}

// How wide a leaf is along its length, a table of NP + 1 numbers, 1 at the widest: s to
// the power ka / 4 from its base (2 is round, the square root) times (1 - s) to the power
// kb / 4 to its tip (the larger, the longer the point).
function profile(ka, kb) {
  const t = new Float64Array(NP + 1);
  let top = 0;
  for (let i = 0; i <= NP; i++) {
    t[i] = pw4(i / NP, ka) * pw4(1 - i / NP, kb);
    if (t[i] > top) top = t[i];
  }
  for (let i = 0; i <= NP; i++) t[i] /= top;
  return t;
}

// A leaf, as the card's drawing leaves it: base (x, y) and unit direction (dx, dy), length L
// and greatest width W (tile units), its linear colour (r, g, b), the table of its width
// (prof), asym how much wider its left is than its right, bend how far the tip lies off
// the line of the base (in lengths), ser the teeth of its edge, nv the veins on a side, fold
// which half is the lighter, `spot` a patch gone brown as [along, across, size] (or null),
// and `sh` how dark it is round its edge on what lies under.
function drawLeaf(s, lf) {
  const T = s.T;
  const Lt = lf.L * T;
  const hm = lf.W * T * 0.5;
  const x0 = lf.x * T;
  const y0 = lf.y * T;
  const ex = lf.dx;
  const ey = lf.dy;
  const halo = s.halo;
  const prof = lf.prof;
  const asym = lf.asym;
  const bend = lf.bend * Lt;
  const reach = hm * (1 + Math.abs(asym)) * (1 + lf.ser) + Math.abs(bend) + halo + 1.5;
  const l0 = -halo - 1.5;
  const l1 = Lt + halo + 1.5;
  let xa = 1e9;
  let xb = -1e9;
  let ya = 1e9;
  let yb = -1e9;
  for (let c = 0; c < 4; c++) {
    const l = c & 1 ? l1 : l0;
    const t = c & 2 ? reach : -reach;
    const X = x0 + ex * l - ey * t;
    const Y = y0 + ey * l + ex * t;
    if (X < xa) xa = X;
    if (X > xb) xb = X;
    if (Y < ya) ya = Y;
    if (Y > yb) yb = Y;
  }
  const lo = s.m;
  const hi = T - s.m - 1;
  const X0 = Math.max(lo, Math.floor(xa));
  const X1 = Math.min(hi, Math.ceil(xb));
  const Y0 = Math.max(lo, Math.floor(ya));
  const Y1 = Math.min(hi, Math.ceil(yb));
  const veinStep = Lt * 0.62 / Math.max(lf.nv, 1);
  const veinCot = lf.vc;
  const veinPerp = 1 / Math.sqrt(1 + veinCot * veinCot);
  const ribHalf = 0.0032 * T;
  const veinHalf = 0.0011 * T;
  const nz = 41 / T;
  const P = s.P;
  const A = s.A;
  for (let Y = Y0; Y <= Y1; Y++) {
    const py = Y + 0.5 - y0;
    for (let X = X0; X <= X1; X++) {
      const px = X + 0.5 - x0;
      const l = px * ex + py * ey;
      if (l < l0 || l > l1) continue;
      const t0 = py * ex - px * ey;
      let u = l / Lt;
      if (u < 0) u = 0;
      else if (u > 1) u = 1;
      const fs = u * NP;
      let k = fs | 0;
      if (k > NP - 1) k = NP - 1;
      const p0 = prof[k];
      const p1 = prof[k + 1];
      const t = t0 - bend * u * u;
      const sg = t >= 0 ? 1 : -1;
      const at = t * sg;
      const wide = 1 + asym * sg;
      let hw = (p0 + (p1 - p0) * (fs - k)) * hm * wide;
      const slope = (p1 - p0) * NP * hm * wide / Lt;
      if (lf.ser > 0) {
        // Teeth that point to the tip, or rounded lobes.
        const q = u * lf.teeth + lf.phase;
        const f = q - Math.floor(q);
        let wave = f * 2 - 1;
        if (lf.lobed) {
          wave = Math.abs(f - 0.5) * 4 - 1;
          wave *= 1.5 - 0.5 * wave * wave;
        }
        hw *= 1 + lf.ser * wave * smooth(0.05, 0.25, u) * (1 - smooth(0.8, 0.98, u));
      }
      let d = (at - hw) / Math.sqrt(1 + slope * slope);
      if (l < 0 && -l > d) d = -l;
      else if (l > Lt && l - Lt > d) d = l - Lt;
      const i = Y * T + X;
      if (d >= 0.5) {
        // Round a leaf's edge, it darkens what lies under it.
        if (d < halo && A[i] > 0) {
          const q = 1 - d / halo;
          const f = 1 - lf.sh * q * q;
          const j = i * 3;
          P[j] *= f;
          P[j + 1] *= f;
          P[j + 2] *= f;
        }
        continue;
      }
      const cov = d <= -0.5 ? 1 : 0.5 - d;
      const e = hw > 1e-6 ? at / hw : 1;
      let shade = (1 - 0.22 * smooth(0.55, 1.0, e)) * (0.9 + 0.14 * smooth(0, 0.5, u)) * (1 + 0.07 * sg * lf.fold);
      shade *= 1 + 0.2 * (vnoise(X * nz, Y * nz, lf.seed) - 0.5);
      let vein = 0;
      if (lf.nv > 0 && u > 0.1 && e < 0.92) {
        const q = (l - veinCot * at - 0.3 * at * at / hm - 0.12 * Lt) / veinStep;
        const kk = Math.round(q);
        if (kk >= 0 && kk < lf.nv) vein = strip(Math.abs(q - kk) * veinStep * veinPerp, veinHalf) * (1 - smooth(0.6, 0.92, e));
      }
      let rib = 0;
      if (u < 0.94) rib = strip(at, ribHalf * (1.15 - 0.6 * u)) * smooth(0, 0.08, u) * (1 - smooth(0.8, 0.94, u));
      const lift = vein * 0.3 * lf.vs + rib * 0.6 * lf.rb;
      // A blemish: a patch gone brown.
      let tint = 0;
      if (lf.spot) {
        const du = l - lf.spot[0] * Lt;
        const dv = t - lf.spot[1] * hm;
        const q = Math.sqrt(du * du + dv * dv) / (lf.spot[2] * Lt);
        if (q < 1) tint = 1 - smooth(0.3, 1, q);
      }
      put(s, i, cov, lf.r * shade * (1 + lift * 1.1 + tint * 0.5), lf.g * shade * (1 + lift - tint * 0.3), lf.b * shade * (1 + lift * 0.6 - tint * 0.1), lf.sh);
    }
  }
}

// --- the cards ------------------------------------------------------------------------

// The seeds each card, and the bark, is drawn from.
const SEED = { broadleaf: 0x1e0a5f, conifer: 0x5b2c7d, pine: 0x91e3b7, dead: 2, bark: 0xba2c11 };

// Whether a point lies in the ellipse a card's picture keeps to: across the middle of
// the card, radii rx and ry, its middle at height cy.
const within = (x, y, rx, ry, cy) => {
  const u = (x - 0.5) / rx;
  const v = (y - cy) / ry;
  return u * u + v * v < 1;
};

// Broadleaf: a twig of an oak or a lime, its side twigs one after the other, each with
// leaves on stalks, in layers: the farthest leaves, the twigs, the nearest leaves.
function broadleaf(s) {
  const rand = rng(SEED.broadleaf);
  const G0 = [0.17, 0.30, 0.10];
  const G1 = [0.34, 0.47, 0.16];
  const YOUNG = [0.47, 0.58, 0.15];
  const PALE = [0.34, 0.45, 0.27];
  const WOOD = lin3([0.24, 0.17, 0.11]);
  const TIP = lin3([0.31, 0.25, 0.13]);
  const STALK = lin3([0.27, 0.24, 0.11]);
  const shapes = [profile(2, 5), profile(2, 4), profile(3, 4), profile(3, 6), profile(2, 3)];
  const far = [];
  const near = [];
  const twigs = [];
  const fits = (x, y) => within(x, y, 0.512, 0.512, 0.5) && x > 0.014 && x < 0.986 && y > 0.014 && y < 0.986;

  // A leaf on a node (nx, ny) of a twig, on a stalk, pointing (dx, dy), L long, at height
  // `h` (0 to 1) on the card, which is how young it is.
  const leaf = (nx, ny, dx, dy, L, h) => {
    const sl = 0.010 + 0.014 * rand();
    const bx = nx + dx * sl;
    const by = ny + dy * sl;
    const r = rand();
    const W = L * (0.86 - 0.42 * r * Math.sqrt(r));
    const mx = bx + dx * L * 0.5;
    const my = by + dy * L * 0.5;
    const hw = W * 0.5;
    const ox = (mx - 0.5) / 0.46;
    const oy = (my - 0.5) / 0.48;
    const z = Math.min(1, 0.5 * rand() + 0.5 * Math.sqrt(ox * ox + oy * oy));
    const under = rand() < 0.1;
    let c = mix3(G0, G1, rand());
    const light = 1 + 0.12 * (rand() * 2 - 1);
    const hue = (rand() - 0.5) * 0.03;
    c = [c[0] * light + hue, c[1] * light, c[2] * light - hue * 0.5];
    c = mix3(c, YOUNG, clamp(h * 1.1 - 0.35 + (rand() - 0.5) * 0.4, 0, 0.8) * 0.6);
    if (under) c = mix3(c, PALE, 0.38);
    const col = lin3(c);
    const sh = (0.66 + 0.34 * z) * (0.92 + 0.16 * my);
    const lobed = rand() < 0.28;
    const lf = {
      x: bx, y: by, dx, dy, L, W, z,
      r: col[0] * sh, g: col[1] * sh, b: col[2] * sh,
      prof: shapes[(rand() * shapes.length) | 0],
      asym: (rand() - 0.5) * 0.2,
      bend: (rand() - 0.5) * 0.2,
      lobed,
      ser: lobed ? 0.1 + 0.06 * rand() : 0.035 + 0.035 * rand(),
      teeth: lobed ? 4 + ((rand() * 2) | 0) : 12 + ((rand() * 8) | 0),
      phase: rand(),
      nv: 4 + ((rand() * 3) | 0),
      vc: 0.62 + 0.3 * rand(),
      vs: under ? 1.5 : 1,
      rb: 1,
      fold: rand() * 2 - 1,
      spot: rand() < 0.12 ? [0.3 + 0.6 * rand(), (rand() < 0.5 ? -1 : 1) * (0.45 + 0.4 * rand()), 0.1 + 0.08 * rand()] : null,
      sh: 0.34,
      seed: (rand() * 1000) | 0,
      stalk: [nx, ny, bx, by],
    };
    const tx = bx + dx * L;
    const ty = by + dy * L;
    if (!fits(tx, ty) || !fits(mx - dy * hw, my + dx * hw) || !fits(mx + dy * hw, my - dx * hw) || !fits(bx, by)) return false;
    (z < 0.34 ? far : near).push(lf);
    return true;
  };

  // The leaves along a twig (`pts`, `len` long): alternately on its two sides, a node
  // every `gap`, smaller toward the tip, with a little twig now and then on the other side
  // from a leaf, and one leaf at the end.
  const along2 = (pts, len, gap, size) => {
    let reach = 0;
    for (let a = 0.03 + 0.02 * rand(), j = 0; a < len - 0.03; a += gap * (0.8 + 0.4 * rand()), j++) {
      const [x, y, tx, ty] = along(pts, a);
      const sg = j & 1 ? 1 : -1;
      const [dx, dy] = turn(tx, ty, sg * (36 + 32 * rand()) * DEG);
      if (leaf(x, y, dx, dy, lerp(0.18, 0.115, a / len) * size * (0.85 + 0.3 * rand()), y)) reach = a;
      if (j > 0 && rand() < 0.55) {
        const [ux, uy] = turn(tx, ty, -sg * (48 + 24 * rand()) * DEG);
        const sl = 0.05 + 0.04 * rand();
        const sub = walk(rand, x, y, ux, uy, sl, 0.02, 0.9, 0.05);
        const e = along(sub, sl);
        if (leaf(e[0], e[1], e[2], e[3], 0.115 * size * (0.8 + 0.4 * rand()), e[1])) {
          twigs.push({ pts: sub, wa: 0.0048, wb: 0.0028 });
          reach = a;
        }
        if (rand() < 0.6) {
          const m = along(sub, sl * 0.5);
          const [vx, vy] = turn(m[2], m[3], sg * 55 * DEG);
          leaf(m[0], m[1], vx, vy, 0.1 * size * (0.8 + 0.4 * rand()), m[1]);
        }
      }
    }
    const e = along(pts, len);
    if (leaf(e[0], e[1], e[2], e[3], 0.13 * size * (0.85 + 0.3 * rand()), e[1])) reach = len;
    return reach;
  };

  // The main twig, from the foot of the card, and the side twigs from it.
  const lean = (rand() - 0.5) * 0.16;
  const main = walk(rand, 0.5, 0.012, lean, 1, 0.86, 0.03, 0, 0.06);
  twigs.push({ pts: main, wa: 0.0125, wb: 0.0055 });
  const K = 12;
  for (let k = 0; k < K; k++) {
    const d = 0.05 + 0.062 * k;
    const [x, y, mx, my] = along(main, d);
    const sg = k & 1 ? 1 : -1;
    const phi = (64 - 28 * (d / 0.76) + (rand() - 0.5) * 12) * DEG;
    const [dx, dy] = turn(mx, my, -sg * phi);
    // As long as the ellipse of the twigs' ends lets it be.
    let len = 0.06;
    const trial = walk(rand, x, y, dx, dy, 0.6, 0.02, 1.0, 0);
    for (let q = 2; q < trial.length / 2; q++) {
      if (!within(trial[2 * q], trial[2 * q + 1], 0.445, 0.47, 0.5)) break;
      len = q * 0.02;
    }
    len *= 0.9 + 0.1 * rand();
    const pts = walk(rand, x, y, dx, dy, len, 0.025, 1.0, 0.05);
    const reach = along2(pts, len, 0.044, 1);
    if (reach > 0.02) twigs.push({ pts: cut(pts, reach + 0.01), wa: 0.0085, wb: 0.0035 });
    // A leaf on the main twig between the side twigs.
    const [ax, ay, bx, by] = along(main, d + 0.031);
    const [lx, ly] = turn(bx, by, sg * 52 * DEG);
    leaf(ax, ay, lx, ly, 0.115 * (0.85 + 0.3 * rand()), ay);
  }
  const top = along(main, 1);
  for (const a of [-36, 0, 36]) {
    const [dx, dy] = turn(top[2], top[3], a * DEG);
    leaf(top[0], top[1], dx, dy, 0.12 * (0.85 + 0.3 * rand()), top[1]);
  }

  far.sort((p, q) => p.z - q.z);
  near.sort((p, q) => p.z - q.z);
  const paint = (lf) => {
    line(s, lf.stalk[0], lf.stalk[1], lf.stalk[2], lf.stalk[3], 0.0042, 0.0032, STALK, STALK, 0.1, 0.1);
    drawLeaf(s, lf);
  };
  for (const lf of far) paint(lf);
  for (const tw of twigs) stroke(s, tw.pts, tw.wa, tw.wb, WOOD, TIP, 0.5, 0.15, 0.2);
  for (const lf of near) paint(lf);
}

// Conifer: a spray of spruce, a stem with twigs in a herringbone, twigs on the twigs, and
// short needles all along them, darker in the middle, the new growth at the tips lighter.
function conifer(s) {
  const rand = rng(SEED.conifer);
  const DARK = [0.09, 0.19, 0.12];
  const LIGHT = [0.22, 0.35, 0.17];
  const WOOD = lin3([0.19, 0.14, 0.10]);
  const WOODTIP = lin3([0.27, 0.22, 0.13]);
  // How needles sit on a shoot of each order: the gap between them and their length.
  const SET = [{ gap: 0.0050, len: 0.040 }, { gap: 0.0036, len: 0.040 }, { gap: 0.0037, len: 0.030 }, { gap: 0.0034, len: 0.023 }];
  const WIDTH = [[0.0095, 0.004], [0.0058, 0.0028], [0.0038, 0.0022], [0.0028, 0.0018]];
  const shoots = [];
  const shoot = (x, y, dx, dy, len, order, z, bend, fresh) => {
    const pts = trim(walk(rand, x, y, dx, dy, len, 0.025, bend, 0.05), 0.04, 0.96, 0, 0.945);
    if (pts.length < 4) return null;
    const sh = { pts, len: Math.min(len, pathLength(pts)), order, z, fresh };
    shoots.push(sh);
    return sh;
  };

  // The needles on one side of a shoot, swept toward its tip; a few shorter ones lie
  // along it, as the needles that point at the eye do.
  const needles = (sh, sgn) => {
    const { pts, len, order, z } = sh;
    const set = SET[order];
    for (let a = 0.006 + set.gap * rand(); a < len; a += set.gap * (0.7 + 0.6 * rand())) {
      const [x, y, tx, ty] = along(pts, a);
      const f = a / len;
      const lay = rand() < 0.45 && order < 3;
      const ang = (lay ? 10 + 16 * rand() : 44 + 32 * rand() - 8 * f) * DEG * sgn;
      const [dx, dy] = turn(tx, ty, ang);
      const nl = set.len * (lay ? 0.6 : 0.78 + 0.4 * rand()) * (1 - 0.5 * smooth(0.82, 1, f)) * (0.45 + 0.55 * smooth(0, 0.14, f));
      const g = clamp(smooth(0.42, 0.95, f) * 1.0 + (order === 3 ? 0.5 : 0) + sh.fresh + 0.2 * rand() - 0.08 + 0.3 * (vnoise(x * 6, y * 6, 3) - 0.5), 0, 1);
      const inner = 0.84 + 0.16 * smooth(0.04, 0.34, Math.abs(x - 0.5));
      const light = (1 + 0.14 * (rand() * 2 - 1)) * (0.78 + 0.22 * z) * inner;
      const c0 = lin3(mul3(mix3(DARK, LIGHT, g * 0.85), light));
      const c1 = lin3(mul3(mix3(DARK, LIGHT, Math.min(1, g * 0.85 + 0.3)), light));
      const w = 0.0054 * (0.9 + 0.3 * rand());
      const off = 0.0022;
      const ox = x - ty * sgn * off;
      const oy = y + tx * sgn * off;
      line(s, ox, oy, ox + dx * nl, oy + dy * nl, w, w * 0.4, c0, c1, 0.04, 0);
    }
  };
  const paint = (sh) => {
    needles(sh, 1);
    stroke(s, sh.pts, WIDTH[sh.order][0], WIDTH[sh.order][1], WOOD, WOODTIP, 0.6, 0.05, 0.2);
    needles(sh, -1);
  };

  const lean = (rand() - 0.5) * 0.06;
  const stem = shoot(0.5, 0.012, lean, 1, 0.94, 0, 0.5, 0, 0);
  const n = 46;
  for (let k = 0; k < n; k++) {
    if (rand() < 0.06) continue;
    const d = 0.045 + (0.88 * (k + 0.4 * rand())) / n;
    const [x, y, mx, my] = along(stem.pts, d);
    const sg = k & 1 ? 1 : -1;
    const phi = (66 - 28 * d + (rand() - 0.5) * 18) * DEG;
    const [dx, dy] = turn(mx, my, -sg * phi);
    const len = 0.6 * Math.sqrt(1 - d) * Math.sqrt(Math.sqrt(1 - d)) * smooth(0, 0.12, d + 0.05) * (0.84 + 0.32 * vnoise(d * 9, sg + 2, 11)) * (0.92 + 0.16 * rand());
    if (len < 0.04) continue;
    const tw = shoot(x, y, dx, dy, len, 1, rand(), 0.3 + 0.6 * rand(), rand() < 0.22 ? 0.5 : 0);
    if (!tw) continue;
    // Twigs of the twig, on the longer ones, and the shortest on those.
    if (tw.len > 0.1) {
      for (const at of [0.2, 0.34, 0.48, 0.62, 0.76]) {
        if (rand() < 0.18) continue;
        const [qx, qy, qx2, qy2] = along(tw.pts, tw.len * at);
        const so = (at * 10 + k) & 1 ? 1 : -1;
        const [ex, ey] = turn(qx2, qy2, so * (44 + 18 * rand()) * DEG);
        const sl = tw.len * (0.5 - 0.4 * at) * (0.7 + 0.5 * rand());
        if (sl < 0.035) continue;
        const sub = shoot(qx, qy, ex, ey, sl, 2, tw.z * (0.8 + 0.2 * rand()), 0.6 + 0.5 * rand(), tw.fresh);
        if (sub && sub.len > 0.07 && rand() < 0.6) {
          const [px, py, px2, py2] = along(sub.pts, sub.len * 0.55);
          const [fx, fy] = turn(px2, py2, -so * (50 + 14 * rand()) * DEG);
          shoot(px, py, fx, fy, sub.len * 0.42, 3, sub.z * 0.95, 0.5, tw.fresh);
        }
      }
    }
  }
  shoots.sort((p, q) => p.z - q.z);
  for (const sh of shoots) paint(sh);
}

// A path from (x0, y0) to (x1, y1) that bows to one side by `bow` of its length: nine
// points on a curve.
function steer(x0, y0, x1, y1, bow) {
  const mx = (x0 + x1) / 2 - (y1 - y0) * bow;
  const my = (y0 + y1) / 2 + (x1 - x0) * bow;
  const pts = [];
  for (let k = 0; k <= 8; k++) {
    const f = k / 8;
    pts.push((1 - f) * (1 - f) * x0 + 2 * (1 - f) * f * mx + f * f * x1, (1 - f) * (1 - f) * y0 + 2 * (1 - f) * f * my + f * f * y1);
  }
  return pts;
}

// Pine: tufts of long needles in pairs, drooping, at the ends of brown twigs.
function pine(s) {
  const rand = rng(SEED.pine);
  const BASE = [0.19, 0.33, 0.14];
  const TIPC = [0.30, 0.42, 0.16];
  const NEWC = [0.34, 0.46, 0.17];
  const WOOD = lin3([0.26, 0.18, 0.11]);
  const WOODTIP = lin3([0.32, 0.23, 0.14]);
  const SHEATH = lin3([0.44, 0.36, 0.24]);
  // A path a little uneven.
  const uneven = (pts, amp) => {
    for (let k = 1; k < pts.length / 2 - 1; k++) {
      pts[2 * k] += (rand() * 2 - 1) * amp;
      pts[2 * k + 1] += (rand() * 2 - 1) * amp;
    }
    return pts;
  };
  const twig = (pts, wa, wb) => stroke(s, uneven(pts, 0.0035), wa, wb, WOOD, WOODTIP, 0.7, 0.1, 0.2);
  // The tufts: where each sits and which way it points (degrees), how big.
  const tufts = [
    { x: 0.23, y: 0.44, a: 152, size: 1.1 },
    { x: 0.8, y: 0.33, a: 24, size: 1.0 },
    { x: 0.4, y: 0.66, a: 114, size: 1.05 },
    { x: 0.69, y: 0.58, a: 64, size: 1.15 },
    { x: 0.55, y: 0.8, a: 86, size: 0.95 },
    { x: 0.3, y: 0.21, a: 198, size: 0.62 },
    { x: 0.64, y: 0.27, a: 328, size: 0.55 },
    { x: 0.47, y: 0.44, a: 100, size: 0.8 },
  ];
  // The twigs reaching them: from the trunk, which rises and leans a little.
  const trunk = uneven(steer(0.5, 0.012, 0.47, 0.42, 0.06), 0.003);
  twig(trunk, 0.0125, 0.0085);
  const feed = [[0.12, 5], [0.17, 6], [0.27, 0], [0.24, 1], [0.38, 2], [0.4, 3], [0.33, 4], [0.42, 7]];
  for (const [d, k] of feed) {
    const t = tufts[k];
    const at = along(trunk, d);
    twig(steer(at[0], at[1], t.x, t.y, (rand() < 0.5 ? 1 : -1) * (0.03 + 0.06 * rand())), 0.0092, 0.0062);
  }
  for (const t of tufts) {
    const [dx, dy] = turn(1, 0, t.a * DEG);
    const sl = 0.06 * t.size;
    stroke(s, [t.x, t.y, t.x + dx * sl, t.y + dy * sl], 0.0085, 0.0058, WOOD, WOODTIP, 0.5, 0.1, 0.2);
    const nf = Math.round(185 * t.size);
    for (let j = 0; j < nf; j++) {
      const p = (j + rand()) / nf;
      const bx = t.x + dx * sl * (0.1 + 0.9 * p);
      const by = t.y + dy * sl * (0.1 + 0.9 * p);
      // The fascicles fan out about the shoot's way, most of them near it.
      const spread = (rand() + rand() - 1) * lerp(104, 58, p) * DEG;
      const bow = (rand() * 2 - 1) * 0.12;
      const ym = smooth(0.8, 1, p) * 0.85;
      const c = (1 + 0.2 * (rand() * 2 - 1)) * (0.86 + 0.14 * smooth(0, 0.6, p));
      const hue = (rand() - 0.5) * 0.05;
      const tint = (a) => [a[0] * c + hue, a[1] * c, a[2] * c - hue * 0.6];
      const c0 = lin3(tint(mix3(BASE, NEWC, ym * 0.9)));
      const c1 = lin3(tint(mix3(TIPC, NEWC, ym)));
      for (let q = 0; q < 2; q++) {
        const sp = spread + (q ? 1 : -1) * (1.5 + 3.5 * rand()) * DEG;
        const [nx, ny] = turn(dx, dy, sp * 0.9);
        const [mx, my] = turn(dx, dy, sp * 0.45);
        const lr = rand();
        let L = 0.42 * (1 - 0.5 * lr * lr) * t.size * (1 - 0.25 * Math.abs(spread) / (104 * DEG));
        // Not past the edge of the card: where the needle would leave, it is as long as
        // the room.
        const room = Math.min(nx > 0 ? (0.985 - bx) / nx : nx < 0 ? (0.015 - bx) / nx : 9, ny > 0 ? (0.985 - by) / ny : ny < 0 ? (0.015 - by) / ny : 9);
        L = Math.min(L, room * 0.9) * (1 - 0.45 * Math.max(0, -ny));
        if (L < 0.06) continue;
        const droop = (0.1 + 0.18 * rand()) * L;
        // A needle arches as it goes, leaving the shoot nearly along it and turning out and
        // down: a curve through its base, a point along it and its tip.
        const px = -ny * bow * L;
        const py = nx * bow * L;
        const x1 = bx + mx * L * 0.5;
        const y1 = by + my * L * 0.5 - droop * 0.1;
        const x2 = bx + nx * L * 0.95 + px;
        const y2 = by + ny * L * 0.95 + py - droop;
        const pts = [];
        for (let k = 0; k <= 7; k++) {
          const f = k / 7;
          pts.push((1 - f) * (1 - f) * bx + 2 * (1 - f) * f * x1 + f * f * x2, (1 - f) * (1 - f) * by + 2 * (1 - f) * f * y1 + f * f * y2);
        }
        stroke(s, pts, 0.0066, 0.0022, c0, c1, 0.45, 0.04, 0);
      }
      line(s, bx, by, bx + dx * 0.01, by + dy * 0.01, 0.0042, 0.0042, SHEATH, SHEATH, 0.05, 0);
    }
  }
}

// Dead: a bare network of forking twigs, grey-brown with paler tips, kinked, with
// short spurs, and a few dry leaves hanging.
function dead(s) {
  const rand = rng(SEED.dead);
  const DARK = [0.20, 0.18, 0.16];
  const PALE = [0.34, 0.31, 0.27];
  const DRY = [0.36, 0.28, 0.17];
  const dry = [lin3(DRY), lin3(mul3(DRY, 0.78)), lin3(mul3(DRY, 1.1)), lin3([0.30, 0.22, 0.14])];
  const twigs = [];
  const knots = [];
  const shape = profile(2, 4);
  const room = (x, y) => within(x, y, 0.475, 0.495, 0.5) && y > 0.01;

  // A twig from (x, y) heading (dx, dy): a few pieces with a kink between them, as dry
  // wood grows; it stops at the edge of the picture. It forks at its end and spurs off
  // at its pieces.
  const grow = (x, y, dx, dy, len, w, depth) => {
    const pts = [x, y];
    const pieces = 2 + ((rand() * 3) | 0);
    let cx = x;
    let cy = y;
    for (let k = 0; k < pieces; k++) {
      [dx, dy] = turn(dx, dy, (rand() * 2 - 1) * 24 * DEG);
      const l = (len / pieces) * (0.7 + 0.6 * rand());
      if (!room(cx + dx * l, cy + dy * l)) break;
      cx += dx * l;
      cy += dy * l;
      pts.push(cx, cy);
    }
    if (pts.length < 4) return;
    const f0 = Math.min(1, depth / 6);
    const f1 = Math.min(1, (depth + 1) / 6);
    twigs.push({ pts, wa: w, wb: w * 0.78, c0: lin3(mix3(DARK, PALE, f0)), c1: lin3(mix3(DARK, PALE, f1)), depth });
    const n = pts.length / 2 - 1;
    if (depth >= 5 || len < 0.03) {
      knots.push([cx, cy, dx, dy, depth]);
      return;
    }
    const nk = depth < 3 ? 3 : rand() < 0.3 ? 3 : 2;
    for (let k = 0; k < nk; k++) {
      const a = (k === 0 ? -1 : k === 1 ? 1 : 0.15) * (18 + 26 * rand()) * DEG;
      const [ex, ey] = turn(dx, dy, a);
      grow(cx, cy, ex, ey, len * (0.55 + 0.3 * rand()), w * 0.78, depth + 1);
    }
    for (let k = 1; k < n; k++) {
      if (rand() < 0.75) {
        const px = pts[2 * k];
        const py = pts[2 * k + 1];
        const [ex, ey] = turn(dx, dy, (rand() < 0.5 ? -1 : 1) * (45 + 35 * rand()) * DEG);
        grow(px, py, ex, ey, len * (0.3 + 0.22 * rand()), w * 0.66, depth + 2);
      }
    }
  };
  // The trunk rises and forks at once into limbs to the left, the right and on up.
  const base = steer(0.5, 0.012, 0.5, 0.17, 0.08);
  twigs.push({ pts: base, wa: 0.0165, wb: 0.0135, c0: lin3(DARK), c1: lin3(DARK), depth: 0 });
  for (const [a, len] of [[-34, 0.3], [30, 0.3], [-4, 0.28]]) {
    const [dx, dy] = turn(0, 1, (a + (rand() - 0.5) * 12) * DEG);
    grow(0.5, 0.17, dx, dy, len, 0.014, 1);
  }
  for (const tw of twigs) stroke(s, tw.pts, tw.wa, tw.wb, tw.c0, tw.c1, 0, 0.1, 0.25);
  // Dry leaves, hung from the nodes of the outer twigs, mostly hanging down.
  const nodes = [];
  for (const tw of twigs) if (tw.depth >= 3) for (let k = 1; k < tw.pts.length / 2; k++) nodes.push([tw.pts[2 * k], tw.pts[2 * k + 1]]);
  for (const k of knots) nodes.push([k[0], k[1]]);
  const STALK = lin3([0.27, 0.22, 0.14]);
  for (let q = 0; q < 18 && nodes.length; q++) {
    const [nx, ny] = nodes[(rand() * nodes.length) | 0];
    const [dx, dy] = turn(0, -1, (rand() * 2 - 1) * 75 * DEG);
    const L = 0.04 + 0.03 * rand();
    const W = L * (0.38 + 0.2 * rand());
    const sl = 0.008 + 0.008 * rand();
    const bx = nx + dx * sl;
    const by = ny + dy * sl;
    if (!room(bx + dx * L, by + dy * L)) continue;
    const col = dry[(rand() * 4) | 0];
    line(s, nx, ny, bx, by, 0.0036, 0.003, STALK, STALK, 0.1, 0.1);
    drawLeaf(s, {
      x: bx, y: by, dx, dy, L, W, z: 0, r: col[0], g: col[1], b: col[2], prof: shape,
      asym: (rand() - 0.5) * 0.3, bend: (rand() - 0.5) * 0.6, lobed: true, ser: 0.06 + 0.06 * rand(), teeth: 5 + ((rand() * 4) | 0), phase: rand(),
      nv: 3, vc: 0.7, vs: 0.7, rb: 0.35, fold: rand() * 2 - 1, spot: null, sh: 0.2, seed: (rand() * 1000) | 0,
    });
  }
}

// --- the card to bytes ----------------------------------------------------------------

// A finished sheet to the atlas: its coverage as bytes, its colour as sRGB bytes, the colour
// of the texels with no coverage taken from the nearest ones that have it.
function writeCard(s, a, S, col, row) {
  const T = s.T;
  const n = T * T;
  const m = s.m;
  const R = new Float32Array(n);
  const G = new Float32Array(n);
  const B = new Float32Array(n);
  const has = new Uint8Array(n);
  let sa = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const i = y * T + x;
      if (x < m || x >= T - m || y < m || y >= T - m) {
        s.A[i] = 0;
        continue;
      }
      const al = s.A[i];
      if (al > 1e-5) {
        has[i] = 1;
        R[i] = s.P[i * 3] / al;
        G[i] = s.P[i * 3 + 1] / al;
        B[i] = s.P[i * 3 + 2] / al;
        sa += al;
        sr += s.P[i * 3];
        sg += s.P[i * 3 + 1];
        sb += s.P[i * 3 + 2];
      }
    }
  }
  const mean = sa > 0 ? [sr / sa, sg / sa, sb / sa] : [0.05, 0.08, 0.03];
  // Out from the painted texels, a ring at a time, each taking the mean of its painted
  // neighbours; what no ring reaches is the mean.
  const rings = Math.max(3, Math.round(T / 32));
  let edge = [];
  const queued = new Uint8Array(n);
  const add = (i) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = (i % T) + dx;
        const y = ((i / T) | 0) + dy;
        if (x < 0 || y < 0 || x >= T || y >= T) continue;
        const j = y * T + x;
        if (!has[j] && !queued[j]) {
          queued[j] = 1;
          edge.push(j);
        }
      }
    }
  };
  for (let i = 0; i < n; i++) if (has[i]) add(i);
  for (let ring = 0; ring < rings && edge.length; ring++) {
    const cur = edge;
    edge = [];
    const val = new Float32Array(cur.length * 3);
    for (let k = 0; k < cur.length; k++) {
      const i = cur[k];
      const x0 = i % T;
      const y0 = (i / T) | 0;
      let c = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = x0 + dx;
          const y = y0 + dy;
          if (x < 0 || y < 0 || x >= T || y >= T) continue;
          const j = y * T + x;
          if (!has[j]) continue;
          c++;
          r += R[j];
          g += G[j];
          b += B[j];
        }
      }
      val[k * 3] = r / c;
      val[k * 3 + 1] = g / c;
      val[k * 3 + 2] = b / c;
    }
    for (let k = 0; k < cur.length; k++) {
      const i = cur[k];
      R[i] = val[k * 3];
      G[i] = val[k * 3 + 1];
      B[i] = val[k * 3 + 2];
      has[i] = 1;
    }
    for (let k = 0; k < cur.length; k++) add(cur[k]);
  }
  const mr = encode(mean[0]);
  const mg = encode(mean[1]);
  const mb = encode(mean[2]);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const i = y * T + x;
      const o = ((row * T + y) * S + col * T + x) * 4;
      if (has[i]) {
        a[o] = encode(R[i]);
        a[o + 1] = encode(G[i]);
        a[o + 2] = encode(B[i]);
      } else {
        a[o] = mr;
        a[o + 1] = mg;
        a[o + 2] = mb;
      }
      a[o + 3] = Math.round(clamp(s.A[i], 0, 1) * 255);
    }
  }
}

// The mips of an RGBA texture whose level 0 is already in `a`: the colour averaged in
// linear light, each texel weighted by its alpha (the plain mean where there is none),
// the alpha its plain mean.
function colourMips(a, size) {
  const levels = mipSizes(size);
  let n = size * size;
  let lr = new Float32Array(n);
  let lg = new Float32Array(n);
  let lb = new Float32Array(n);
  let la = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lr[i] = BYTE[a[i * 4]];
    lg[i] = BYTE[a[i * 4 + 1]];
    lb[i] = BYTE[a[i * 4 + 2]];
    la[i] = a[i * 4 + 3] / 255;
  }
  let at = n;
  for (let L = 1; L < levels.length; L++) {
    const s = levels[L];
    const p = levels[L - 1];
    n = s * s;
    const nr = new Float32Array(n);
    const ng = new Float32Array(n);
    const nb = new Float32Array(n);
    const na = new Float32Array(n);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const i0 = 2 * y * p + 2 * x;
        const i1 = i0 + 1;
        const i2 = i0 + p;
        const i3 = i2 + 1;
        const a0 = la[i0];
        const a1 = la[i1];
        const a2 = la[i2];
        const a3 = la[i3];
        const sum = a0 + a1 + a2 + a3;
        let r;
        let g;
        let b;
        if (sum > 0) {
          r = (lr[i0] * a0 + lr[i1] * a1 + lr[i2] * a2 + lr[i3] * a3) / sum;
          g = (lg[i0] * a0 + lg[i1] * a1 + lg[i2] * a2 + lg[i3] * a3) / sum;
          b = (lb[i0] * a0 + lb[i1] * a1 + lb[i2] * a2 + lb[i3] * a3) / sum;
        } else {
          r = (lr[i0] + lr[i1] + lr[i2] + lr[i3]) * 0.25;
          g = (lg[i0] + lg[i1] + lg[i2] + lg[i3]) * 0.25;
          b = (lb[i0] + lb[i1] + lb[i2] + lb[i3]) * 0.25;
        }
        const o = y * s + x;
        nr[o] = r;
        ng[o] = g;
        nb[o] = b;
        na[o] = sum * 0.25;
        const w = (at + o) * 4;
        a[w] = encode(r);
        a[w + 1] = encode(g);
        a[w + 2] = encode(b);
        a[w + 3] = Math.round(clamp(sum * 0.25, 0, 1) * 255);
      }
    }
    lr = nr;
    lg = ng;
    lb = nb;
    la = na;
    at += n;
  }
}

const CARDS = [broadleaf, conifer, pine, dead];

// A sheet averaged down by a whole number of times: the premultiplied colour and the
// coverage, which is how much of each is in a texel.
function shrink(s, T) {
  const k = s.T / T;
  const P = new Float32Array(T * T * 3);
  const A = new Float32Array(T * T);
  const w = 1 / (k * k);
  for (let y = 0; y < s.T; y++) {
    for (let x = 0; x < s.T; x++) {
      const i = y * s.T + x;
      const o = ((y / k) | 0) * T + ((x / k) | 0);
      A[o] += s.A[i] * w;
      P[o * 3] += s.P[i * 3] * w;
      P[o * 3 + 1] += s.P[i * 3 + 1] * w;
      P[o * 3 + 2] += s.P[i * 3 + 2] * w;
    }
  }
  return { T, m: s.m / k, P, A };
}

// The cards of a tier. A card is drawn at no fewer than 128 texels across and averaged down
// to the size asked, so that the needles, which are narrower than a texel of a small card,
// cover as much of it as they do of a large one.
function atlas(size) {
  const T = size >> 1;
  const D = Math.max(T, 128);
  const margin = Math.max(1, T >> 7);
  const a = new Uint8Array(mipSizes(size).reduce((n, s) => n + s * s, 0) * 4);
  CARDS.forEach((draw, i) => {
    let s = sheet(D, (margin * D) / T);
    draw(s);
    if (D > T) s = shrink(s, T);
    writeCard(s, a, size, i % 2, i >> 1);
  });
  colourMips(a, size);
  return a;
}

// --- the bark -------------------------------------------------------------------------

const wrap = (v, n) => ((v % n) + n) % n;

// Gradient noise that repeats: a unit direction at each point of a gx by gy lattice (the
// noise is read at lattice coordinates, about -0.7 to 0.7, smooth, zero on average).
function lattice(rand, gx, gy) {
  const g = new Float32Array(gx * gy * 2);
  for (let i = 0; i < gx * gy; i++) {
    for (;;) {
      const u = rand() * 2 - 1;
      const v = rand() * 2 - 1;
      const q = u * u + v * v;
      if (q > 0.04 && q <= 1) {
        const m = Math.sqrt(q);
        g[2 * i] = u / m;
        g[2 * i + 1] = v / m;
        break;
      }
    }
  }
  return { g, gx, gy };
}

function noise(L, x, y) {
  const g = L.g;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const xa = wrap(x0, L.gx);
  const xb = wrap(x0 + 1, L.gx);
  const ya = wrap(y0, L.gy) * L.gx;
  const yb = wrap(y0 + 1, L.gy) * L.gx;
  const a = (ya + xa) * 2;
  const b = (ya + xb) * 2;
  const c = (yb + xa) * 2;
  const d = (yb + xb) * 2;
  const n00 = g[a] * tx + g[a + 1] * ty;
  const n10 = g[b] * (tx - 1) + g[b + 1] * ty;
  const n01 = g[c] * tx + g[c + 1] * (ty - 1);
  const n11 = g[d] * (tx - 1) + g[d + 1] * (ty - 1);
  const sx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
  const sy = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
  const top = n00 + (n10 - n00) * sx;
  return top + (n01 + (n11 - n01) * sx - top) * sy;
}

// The mean of a (2r + 1) square round every texel, the tile repeating.
function blur(src, size, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < size; y++) {
    const row = y * size;
    let s = 0;
    for (let d = -r; d <= r; d++) s += src[row + wrap(d, size)];
    for (let x = 0; x < size; x++) {
      tmp[row + x] = s * k;
      s += src[row + wrap(x + r + 1, size)] - src[row + wrap(x - r, size)];
    }
  }
  for (let x = 0; x < size; x++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += tmp[wrap(d, size) * size + x];
    for (let y = 0; y < size; y++) {
      out[y * size + x] = s * k;
      s += tmp[wrap(y + r + 1, size) * size + x] - tmp[wrap(y - r, size) * size + x];
    }
  }
  return out;
}

// The bark: plates between furrows that run along the trunk, the furrows of each of three
// sizes wandering and crossing one another so that they fork and close, cut across by
// cracks here and there, with fibres along the plates. The height is 0 at the bottom of a
// furrow and about 1 on a plate.
function barkMap(B) {
  const rand = rng(SEED.bark);
  const n = B * B;
  const warpU = lattice(rand, 3, 2);
  const warpV = lattice(rand, 4, 3);
  const oct = [lattice(rand, 9, 2), lattice(rand, 18, 4), lattice(rand, 36, 8), lattice(rand, 72, 16)];
  const across = lattice(rand, 2, 16);
  const gateB = lattice(rand, 5, 3);
  const mass = lattice(rand, 3, 2);
  const roll = lattice(rand, 12, 3);
  const fibre = lattice(rand, Math.min(72, B >> 2), Math.min(6, B >> 4));
  const H = new Float32Array(n);
  for (let y = 0; y < B; y++) {
    const v = (y + 0.5) / B;
    for (let x = 0; x < B; x++) {
      const u = (x + 0.5) / B;
      const wu = noise(warpU, u * 3, v * 2) * 0.05;
      const wv = noise(warpV, u * 4, v * 3) * 0.08;
      // The furrows lie where a field of four sizes of noise is zero.
      let f = 0;
      let amp = 1;
      let g = 9;
      let h = 2;
      for (let k = 0; k < 4; k++) {
        f += amp * noise(oct[k], (u + wu) * g, (v + wv) * h);
        amp *= 0.5;
        g *= 2;
        h *= 2;
      }
      const d = noise(across, u * 2 + wu * 4, (v + wv * 0.5) * 16);
      const gb = smooth(0.0, 0.25, noise(gateB, u * 5 + 0.3, v * 3));
      const s1 = smooth(0, 0.16 + 0.07 * noise(mass, u * 3, v * 2), Math.abs(f));
      let ht = 0.62 * s1 * (2 - s1) + 0.5 * Math.min(Math.abs(f), 0.9);
      ht -= 0.14 * gb * (1 - smooth(0, 0.07, Math.abs(d)));
      H[y * B + x] = ht + 0.05 * noise(roll, u * 12, v * 3) + 0.035 * noise(fibre, u * fibre.gx, v * fibre.gy);
    }
  }
  const around = blur(H, B, Math.max(2, B >> 6));
  const a = new Uint8Array(mipSizes(B).reduce((m, s) => m + s * s, 0) * 4);
  const cav = new Float32Array(n);
  for (let i = 0; i < n; i++) cav[i] = 0.2 + 0.8 * smooth(0.0, 0.6, H[i]) + 1.1 * (H[i] - around[i]);
  const k = (B / 256) * 10;
  for (let y = 0; y < B; y++) {
    const up = wrap(y - 1, B) * B;
    const dn = wrap(y + 1, B) * B;
    for (let x = 0; x < B; x++) {
      const i = y * B + x;
      let sx = (H[y * B + wrap(x + 1, B)] - H[y * B + wrap(x - 1, B)]) * 0.5 * k;
      let sy = (H[dn + x] - H[up + x]) * 0.5 * k;
      const m = 1 / (1 + Math.sqrt(sx * sx + sy * sy));
      sx *= m;
      sy *= m;
      const il = 1 / Math.sqrt(sx * sx + sy * sy + 1);
      a[i * 4] = Math.round((-sx * il * 0.5 + 0.5) * 255);
      a[i * 4 + 1] = Math.round((-sy * il * 0.5 + 0.5) * 255);
      a[i * 4 + 2] = Math.round((il * 0.5 + 0.5) * 255);
      a[i * 4 + 3] = Math.round(90 + 165 * clamp((cav[i] + 0.4) / 1.7, 0, 1));
    }
  }
  normalMips(a, B);
  return a;
}

// The bark of a size: drawn at no fewer than 128 texels across, so that the finest furrows
// are not lost to a small tile, and averaged down to the size asked.
function bark(B) {
  const base = Math.max(B, 128);
  const a = barkMap(base);
  if (base === B) return a;
  let skip = 0;
  for (let s = base; s > B; s >>= 1) skip += s * s;
  return a.slice(skip * 4);
}

// The mips of a texture of normals (bytes in RGB) with a cavity in the alpha: the normals
// averaged and made unit, the cavity its plain mean.
function normalMips(a, size) {
  const levels = mipSizes(size);
  let n = size * size;
  let nx = new Float32Array(n);
  let ny = new Float32Array(n);
  let nz = new Float32Array(n);
  let nc = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    nx[i] = a[i * 4] / 255 * 2 - 1;
    ny[i] = a[i * 4 + 1] / 255 * 2 - 1;
    nz[i] = a[i * 4 + 2] / 255 * 2 - 1;
    nc[i] = a[i * 4 + 3];
  }
  let at = n;
  for (let L = 1; L < levels.length; L++) {
    const s = levels[L];
    const p = levels[L - 1];
    n = s * s;
    const mx = new Float32Array(n);
    const my = new Float32Array(n);
    const mz = new Float32Array(n);
    const mc = new Float32Array(n);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const i0 = 2 * y * p + 2 * x;
        const i1 = i0 + 1;
        const i2 = i0 + p;
        const i3 = i2 + 1;
        let vx = nx[i0] + nx[i1] + nx[i2] + nx[i3];
        let vy = ny[i0] + ny[i1] + ny[i2] + ny[i3];
        let vz = nz[i0] + nz[i1] + nz[i2] + nz[i3];
        const il = 1 / Math.sqrt(vx * vx + vy * vy + vz * vz);
        vx *= il;
        vy *= il;
        vz *= il;
        const o = y * s + x;
        mx[o] = vx;
        my[o] = vy;
        mz[o] = vz;
        mc[o] = (nc[i0] + nc[i1] + nc[i2] + nc[i3]) * 0.25;
        const w = (at + o) * 4;
        a[w] = Math.round((vx * 0.5 + 0.5) * 255);
        a[w + 1] = Math.round((vy * 0.5 + 0.5) * 255);
        a[w + 2] = Math.round((vz * 0.5 + 0.5) * 255);
        a[w + 3] = Math.round(mc[o]);
      }
    }
    nx = mx;
    ny = my;
    nz = mz;
    nc = mc;
    at += n;
  }
}

// The atlas and the bark of a tier: [{ name: 'atlas', size, a }, { name: 'bark', size, a }].
// The same bytes whoever draws them.
export function bakeFoliage(tier) {
  const t = FOLIAGE_TIERS[tier];
  if (!t) throw new Error(`foliage: no tier ${tier}`);
  return [
    { name: 'atlas', size: t.atlas, a: atlas(t.atlas) },
    { name: 'bark', size: t.bark, a: bark(t.bark) },
  ];
}
