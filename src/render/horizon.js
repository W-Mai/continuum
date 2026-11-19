// What the near land hides from the lens: a skyline of the ground in front of
// it, against which the tiles farther off (the land's, the forest's) are
// tested, so that what is behind a ridge is not sent to the GPU.
//
// The land is solid under its surface. Take a square of ground over which it
// is nowhere lower than m. A ray from the lens that comes to the square lower
// than m has already gone into the ground there, whatever lies past it. So the
// square blocks every ray that goes through the whole of it and comes to it
// lower than (m - the lens's height) / (the distance it comes at), in tangent
// of the angle up.
//
// The view is cut into columns of azimuth, 0.6 degrees each, and each column
// into bands of distance, each 10% farther than the last. A square is entered
// in the columns it is wholly across (two rays, one each side of the column,
// both go through it), in the band it comes at, with what it blocks; then each
// column's bands are made to hold the most that is blocked nearer. A tile, or
// a cell of one, whose highest point is lower than what is blocked nearer than
// it in every column it spans, is hidden. Nothing here is a guess: a square
// that is not wholly across a column, or is where the lens stands, blocks
// nothing, and a tile it cannot be sure of is drawn.
//
// What is found for a lens holds for a lens that has moved a little, and
// turned a little, so it does not have to be found again each frame (holds()).
// A ray from the lens that has moved, to a point of a tile, goes through the
// same place as the ray from where the lens was, to within the lens's move, at
// every distance along it. So a square blocks for both when it is taken
// smaller by the move on every side and its lowest point lower by the
// move up or down: a ray that goes into the ground there from the one place
// goes into the ground in the whole square from the other. A tile is taken
// against the azimuths the picture can come to take in, and the directions to
// it are those to the tile as it was, turned by at most the move over its
// distance; a tile nearer than NEAR_HIDE is not hidden at all, so that turn
// has a bound.
//
// All coordinates are the scene's (the floating origin's), y included.

const MAX_COLS = 400;
const MIN_STEP = 0.0105;           // a column is at least this wide, rad (0.6 degrees)
const BANDS = 76;                  // bands of distance, each 10% farther than the last
const BAND0 = 6;                   // m: where the first band begins
const LOG_BAND = Math.log(1.1);
const NONE = -1e9;
const PI = Math.PI;
const TAU = PI * 2;
// A tile is hidden only when what hides it clears its top by this much (tangent).
const MARGIN = 0.004;
// Around the azimuths the picture takes in (rad).
const VIEW_PAD = 0.02;

// How far the lens may go and turn before what was found for it is found
// again: along the ground and up or down (m), and the azimuths the picture
// takes in at either end (rad). And how near a tile can be and still be hidden.
export const MOVE_H = 1;
export const MOVE_V = 0.3;
export const TURN = 0.0175;
export const NEAR_HIDE = 40;
// The tiles of this level of the land's quadtree block in cells a fourth of
// their side (coarser(mins)): about as much is hidden, and less is made.
export const COARSE_LEVEL = 2;

// The angle a distance d off to the side subtends at 1 (asin), more than it is.
const slip = (x) => x * (1 + x * x * 0.17);

// atan2, with an error of at most ATAN_ERR (4.4.49 of Abramowitz and Stegun).
const ATAN_ERR = 2e-5;
function atan2(y, x) {
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  const big = ax > ay ? ax : ay;
  if (big === 0) return 0;
  const r = (ax > ay ? ay : ax) / big;
  const s = r * r;
  let a = r * (0.999866 + s * (-0.3302995 + s * (0.180141 + s * (-0.085133 + s * 0.0208351))));
  if (ay > ax) a = PI / 2 - a;
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}

// The band of a distance. Told by a table of half metres, one for a distance
// rounded down and one for it rounded up: a square that blocks is put in the
// later band of the two, a square that is tested is put against the earlier,
// so a band's squares are never nearer than they are said to be.
const TAB = 16384;
const bandAt = (d) => {
  const b = Math.floor(Math.log(d / BAND0) / LOG_BAND);
  return b < 0 ? 0 : b >= BANDS ? BANDS - 1 : b;
};
const BAND_LO = new Uint8Array(TAB + 1);
const BAND_HI = new Uint8Array(TAB + 1);
for (let k = 0; k <= TAB; k++) {
  BAND_LO[k] = bandAt(Math.max(k * 0.5, 1e-3));
  BAND_HI[k] = bandAt((k + 1) * 0.5);
}
const bandLo = (d) => {
  const k = (d * 2) | 0;
  return BAND_LO[k < TAB ? k : TAB];
};
const bandHi = (d) => {
  const k = (d * 2) | 0;
  return BAND_HI[k < TAB ? k : TAB];
};

// An angle brought into (-PI, PI].
const wrap = (a) => {
  a %= TAU;
  return a > PI ? a - TAU : a <= -PI ? a + TAU : a;
};

// The azimuth of (dx, dz) from alo, in (-PI, PI] (alo is in it too).
const rel = (dz, dx, alo) => {
  const r = atan2(dz, dx) - alo;
  return r > PI ? r - TAU : r <= -PI ? r + TAU : r;
};

// The cells of a tile as four by four, each the lowest of the four of eight by
// eight that it is made of.
export function coarser(mins) {
  const out = new Float32Array(16);
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      out[j * 4 + i] = Math.min(mins[j * 16 + i * 2], mins[j * 16 + i * 2 + 1], mins[j * 16 + 8 + i * 2], mins[j * 16 + 8 + i * 2 + 1]);
    }
  }
  return out;
}

export class Horizon {
  // move and turn: how far the lens may go and turn for what is found to hold
  // (0 for it to hold only where it is found).
  constructor(opts = {}) {
    this.h = opts.h === undefined ? MOVE_H : opts.h;
    this.v = opts.v === undefined ? MOVE_V : opts.v;
    this.turn = opts.turn === undefined ? TURN : opts.turn;
    this.nearHide = opts.nearHide === undefined ? (this.h > 0 ? NEAR_HIDE : BAND0 * 1.1) : opts.nearHide;
    // The most a direction to a tile that can be hidden can turn as the lens moves.
    this.shift = this.h > 0 ? slip(this.h / this.nearHide) : 0;
    this.widen = this.turn + this.shift;
    this.ok = false;
    this.cols = 0;
    this.step = MIN_STEP;
    this.best = new Float32Array(MAX_COLS * BANDS);
    this.ix = new Float64Array(MAX_COLS + 2);
    this.iz = new Float64Array(MAX_COLS + 2);
    this.cx = 0;
    this.cy = 0;
    this.cz = 0;
    // The azimuths of the picture this was begun for, and those it takes in.
    this.vlo = 0;
    this.vspan = 0;
    this.alo = 0;
    this.aspan = 0;
    // The farthest band anything blocks in.
    this.maxBand = 0;
    // The last square's angular extent, as _ext leaves it.
    this._e = new Float64Array(2);
    // Counts since begin(), for the diagnostics.
    this.blocks = 0;
    this.tested = 0;
    this.hid = 0;
  }

  // The lens at (cx, cy, cz) sees the azimuths from lo (rad, atan2(z, x)) to
  // lo + span. Off when span is too wide to be a view that the ground can hide
  // anything from.
  begin(cx, cy, cz, lo, span) {
    this.cx = cx;
    this.cy = cy;
    this.cz = cz;
    this.vlo = lo;
    this.vspan = span;
    this.blocks = 0;
    this.tested = 0;
    this.hid = 0;
    this.maxBand = 0;
    this.ok = span > 0 && span < 2.6;
    if (!this.ok) return;
    const w = this.widen;
    this.alo = wrap(lo - w);
    this.aspan = span + 2 * w;
    this.step = Math.max(MIN_STEP, this.aspan / MAX_COLS);
    this.cols = Math.ceil(this.aspan / this.step);
    this.best.fill(NONE, 0, this.cols * BANDS);
    for (let j = 0; j <= this.cols; j++) {
      const a = this.alo + j * this.step;
      let ux = Math.cos(a);
      let uz = Math.sin(a);
      if (Math.abs(ux) < 1e-9) ux = ux < 0 ? -1e-9 : 1e-9;
      if (Math.abs(uz) < 1e-9) uz = uz < 0 ? -1e-9 : 1e-9;
      this.ix[j] = 1 / ux;
      this.iz[j] = 1 / uz;
    }
  }

  // Whether what was found at begin() holds for a lens at (cx, cy, cz) that
  // sees the azimuths from lo to lo + span: it has not gone farther than it may,
  // and the picture is within the one found for, turned by as much as it may.
  holds(cx, cy, cz, lo, span) {
    if (!this.ok || !(span > 0 && span < 2.6)) return false;
    const dx = cx - this.cx;
    const dz = cz - this.cz;
    const dy = cy - this.cy;
    if (dx * dx + dz * dz > this.h * this.h || dy > this.v || dy < -this.v) return false;
    const d = wrap(lo - this.vlo);
    return d >= -this.turn && d + span <= this.vspan + this.turn;
  }

  // The azimuth of a point's direction from the lens, relative to the
  // beginning of the picture begin() was given, in (-PI, PI].
  viewRel(x, z) {
    return wrap(Math.atan2(z - this.cz, x - this.cx) - this.vlo);
  }

  // The angles a square subtends, from the azimuth the skyline begins at: the
  // least in this._e[0], the greatest in this._e[1]. False for a square that
  // is more than half the sky (the lens is next to it).
  _ext(xa, za, xb, zb) {
    const dxa = xa - this.cx;
    const dxb = xb - this.cx;
    const dza = za - this.cz;
    const dzb = zb - this.cz;
    const alo = this.alo;
    const r0 = rel(dza, dxa, alo);
    const r1 = rel(dza, dxb, alo);
    const r2 = rel(dzb, dxa, alo);
    const r3 = rel(dzb, dxb, alo);
    const lo = Math.min(Math.min(r0, r1), Math.min(r2, r3));
    const hi = Math.max(Math.max(r0, r1), Math.max(r2, r3));
    this._e[0] = lo;
    this._e[1] = hi;
    return hi - lo <= 2.5;
  }

  // A square of ground over which the land is no lower than m: what it blocks.
  block(xa, za, xb, zb, m) {
    if (!this.ok) return;
    // As the lens may move: the square is smaller and its lowest point lower.
    const g = this.h;
    xa += g;
    za += g;
    xb -= g;
    zb -= g;
    if (xb <= xa || zb <= za) return;
    const cx = this.cx;
    const cz = this.cz;
    if (cx >= xa && cx <= xb && cz >= za && cz <= zb) return;
    if (!this._ext(xa, za, xb, zb)) return;
    const r0 = this._e[0];
    const r1 = this._e[1];
    if (r1 < 0 || r0 > this.aspan) return;
    const step = this.step;
    const cols = this.cols;
    const j0 = Math.max(0, Math.ceil(r0 / step));
    const j1 = Math.min(cols, Math.floor(r1 / step));
    if (j1 <= j0) return;
    const ax = xa - cx;
    const bx = xb - cx;
    const az = za - cz;
    const bz = zb - cz;
    const nx = Math.max(Math.max(ax, 0), -bx);
    const nz = Math.max(Math.max(az, 0), -bz);
    const dn = Math.max(0.5, Math.sqrt(nx * nx + nz * nz));
    const low = m - this.v - this.cy;
    const ixs = this.ix;
    const izs = this.iz;
    const best = this.best;
    let top = this.maxBand;
    let prev = 0;
    for (let j = j0; j <= j1; j++) {
      // Where ray j meets the square, the nearer way in; 0 for a miss.
      const ixj = ixs[j];
      const izj = izs[j];
      const tx0 = ax * ixj;
      const tx1 = bx * ixj;
      const tz0 = az * izj;
      const tz1 = bz * izj;
      const tin = Math.max(tx0 < tx1 ? tx0 : tx1, tz0 < tz1 ? tz0 : tz1);
      const tout = Math.min(tx0 < tx1 ? tx1 : tx0, tz0 < tz1 ? tz1 : tz0);
      const d = tout >= tin && tout > 0 ? (tin > 0 ? tin : 0) : 0;
      if (j > j0 && d > 0 && prev > 0) {
        const far = d > prev ? d : prev;
        const e = low >= 0 ? low / far : low / dn;
        const b = bandHi(far);
        const at = (j - 1) * BANDS + b;
        if (e > best[at]) best[at] = e;
        if (b > top) top = b;
      }
      prev = d;
    }
    this.maxBand = top;
    this.blocks++;
  }

  // The blocks of a tile whose land is n x n cells, mins the lowest of each (row by
  // row). A tile out of the view has none that matter: it is left out.
  blockTile(x0, z0, size, mins, n = 8) {
    if (!this.ok) return;
    const x1 = x0 + size;
    const z1 = z0 + size;
    const inside = this.cx >= x0 && this.cx <= x1 && this.cz >= z0 && this.cz <= z1;
    if (!inside && this._ext(x0, z0, x1, z1) && (this._e[1] < -this.step || this._e[0] > this.aspan + this.step)) return;
    const per = size / n;
    for (let cj = 0; cj < n; cj++) {
      for (let ci = 0; ci < n; ci++) {
        this.block(x0 + ci * per, z0 + cj * per, x0 + (ci + 1) * per, z0 + (cj + 1) * per, mins[cj * n + ci]);
      }
    }
  }

  // Once every block is in: what is blocked at or nearer than a band, in each
  // column.
  seal() {
    if (!this.ok) return;
    const best = this.best;
    const cols = this.cols;
    const top = this.maxBand;
    for (let w = 0; w < cols; w++) {
      const o = w * BANDS;
      let run = best[o];
      for (let b = 1; b <= top; b++) {
        const v = best[o + b];
        if (v < run) best[o + b] = run;
        else run = v;
      }
    }
  }

  // Whether a square of ground with something no higher than top over it
  // cannot be seen: it is out of the view, or every column across it is
  // blocked, by ground that is nearer than all of it, to above its top.
  hidden(xa, za, xb, zb, top) {
    if (!this.ok) return false;
    const cx = this.cx;
    const cz = this.cz;
    const nx = Math.max(Math.max(xa - cx, 0), cx - xb);
    const nz = Math.max(Math.max(za - cz, 0), cz - zb);
    const dn = Math.sqrt(nx * nx + nz * nz);
    if (dn < this.nearHide || !this._ext(xa, za, xb, zb)) return false;
    const fx = Math.max(cx - xa, xb - cx);
    const fz = Math.max(cz - za, zb - cz);
    const df = Math.sqrt(fx * fx + fz * fz);
    const up = top - this.cy;
    const want = (up >= 0 ? up / dn : up / df) + MARGIN;
    // What of the picture it can be in, as the lens may have moved.
    const nl = this.h > 0 ? this.shift - slip(this.h / dn) : 0;
    const nh = this.aspan - nl;
    const r0 = this._e[0] - ATAN_ERR;
    const r1 = this._e[1] + ATAN_ERR;
    const step = this.step;
    if (r1 < nl - step || r0 > nh + step) return true;
    this.tested++;
    const b = Math.min(bandLo(dn) - 1, this.maxBand);
    if (b < 0) return false;
    const w0 = Math.max(0, Math.floor((r0 > nl ? r0 : nl) / step));
    const w1 = Math.min(this.cols - 1, Math.floor((r1 < nh ? r1 : nh) / step));
    const best = this.best;
    for (let w = w0; w <= w1; w++) if (best[w * BANDS + b] < want) return false;
    this.hid++;
    return true;
  }

  // The same for a tile of n x n cells, maxs the highest of each: hidden as a
  // whole, or in every one of its cells.
  hiddenTile(x0, z0, size, top, maxs, n = 8) {
    if (!this.ok) return false;
    if (this.hidden(x0, z0, x0 + size, z0 + size, top)) return true;
    const per = size / n;
    for (let cj = 0; cj < n; cj++) {
      for (let ci = 0; ci < n; ci++) {
        if (!this.hidden(x0 + ci * per, z0 + cj * per, x0 + (ci + 1) * per, z0 + (cj + 1) * per, maxs[cj * n + ci])) return false;
      }
    }
    return true;
  }
}

// The azimuths the lens sees, as begin() takes them: from the camera's own
// matrices, by where the edges of the picture go. Returns [lo, span], with a
// span of 0 where the picture takes in straight up or down, or is not a view
// that can be bounded.
export function viewSpan(camera, out = [0, 0]) {
  const e = camera.matrixWorld.elements;
  const t = Math.tan((camera.fov * Math.PI) / 360);
  const a = camera.aspect;
  // The camera looks down its -z; x is right, y up (columns of the matrix).
  const rx = e[0] * t * a;
  const ry = e[1] * t * a;
  const rz = e[2] * t * a;
  const ux = e[4] * t;
  const uy = e[5] * t;
  const uz = e[6] * t;
  const fx = -e[8];
  const fy = -e[9];
  const fz = -e[10];
  const N = 8;
  let first = 0;
  let lo = 1e9;
  let hi = -1e9;
  let n = 0;
  for (let k = 0; k < N * 4; k++) {
    // Round the border of the picture.
    const side = k >> 3;
    const q = ((k & 7) / N) * 2 - 1;
    const sx = side === 0 ? q : side === 1 ? 1 : side === 2 ? -q : -1;
    const sy = side === 0 ? -1 : side === 1 ? q : side === 2 ? 1 : -q;
    const dx = fx + rx * sx + ux * sy;
    const dy = fy + ry * sx + uy * sy;
    const dz = fz + rz * sx + uz * sy;
    // Straight up or down, or near it, is in the picture's reach: no bound.
    if (Math.sqrt(dx * dx + dz * dz) < 0.6 * Math.abs(dy)) {
      out[0] = 0;
      out[1] = 0;
      return out;
    }
    const az = Math.atan2(dz, dx);
    if (n === 0) first = az;
    const r = wrap(az - first);
    if (r < lo) lo = r;
    if (r > hi) hi = r;
    n++;
  }
  // A picture that takes in a pole has a border that goes all the way round the
  // azimuths, and a span too wide for begin() to take.
  out[0] = first + lo - VIEW_PAD;
  out[1] = hi - lo + 2 * VIEW_PAD;
  return out;
}
