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
// All coordinates are the scene's (the floating origin's), y included.

const MAX_COLS = 400;
const MIN_STEP = 0.0105;           // a column is at least this wide, rad (0.6 degrees)
const BANDS = 76;                  // bands of distance, each 10% farther than the last
const BAND0 = 6;                   // m: where the first band begins
const LOG_BAND = Math.log(1.1);
const NONE = -1e9;
const TAU = Math.PI * 2;
// A tile is hidden only when what hides it clears its top by this much (tangent).
const MARGIN = 0.004;

const band = (d) => {
  const b = Math.floor(Math.log(d / BAND0) / LOG_BAND);
  return b < 0 ? 0 : b >= BANDS ? BANDS - 1 : b;
};

// An angle brought into (-PI, PI].
const wrap = (a) => {
  a %= TAU;
  return a > Math.PI ? a - TAU : a <= -Math.PI ? a + TAU : a;
};

export class Horizon {
  constructor() {
    this.ok = false;
    this.cols = 0;
    this.step = MIN_STEP;
    this.best = new Float32Array(MAX_COLS * BANDS);
    this.ix = new Float64Array(MAX_COLS + 2);
    this.iz = new Float64Array(MAX_COLS + 2);
    this.cx = 0;
    this.cy = 0;
    this.cz = 0;
    this.lo = 0;
    this.span = 0;
    // The last box's angular extent, as _extent leaves it: its middle (rel, in
    // (-PI, PI]) and the two ends beside it.
    this._c = 0;
    this._e0 = 0;
    this._e1 = 0;
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
    this.lo = lo;
    this.span = span;
    this.blocks = 0;
    this.tested = 0;
    this.hid = 0;
    this.ok = span > 0 && span < 2.6;
    if (!this.ok) return;
    this.step = Math.max(MIN_STEP, span / MAX_COLS);
    this.cols = Math.ceil(span / this.step);
    this.best.fill(NONE, 0, this.cols * BANDS);
    for (let j = 0; j <= this.cols; j++) {
      const a = lo + j * this.step;
      let ux = Math.cos(a);
      let uz = Math.sin(a);
      if (Math.abs(ux) < 1e-9) ux = ux < 0 ? -1e-9 : 1e-9;
      if (Math.abs(uz) < 1e-9) uz = uz < 0 ? -1e-9 : 1e-9;
      this.ix[j] = 1 / ux;
      this.iz[j] = 1 / uz;
    }
  }

  // The azimuth of a point's direction from the lens, relative to the view's
  // beginning, in (-PI, PI].
  rel(x, z) {
    return wrap(Math.atan2(z - this.cz, x - this.cx) - this.lo);
  }

  // Whether the lens is in the square (grown by pad).
  _inside(xa, za, xb, zb, pad = 0) {
    return this.cx >= xa - pad && this.cx <= xb + pad && this.cz >= za - pad && this.cz <= zb + pad;
  }

  // The angles a square subtends. Leaves its middle's azimuth in this._c, and
  // the ends' offsets from it in this._e0 and this._e1; false for a square
  // that is more than half the sky (the lens is next to it).
  _extent(xa, za, xb, zb) {
    const { cx, cz } = this;
    const th = Math.atan2((za + zb) * 0.5 - cz, (xa + xb) * 0.5 - cx);
    let e0 = 1e9;
    let e1 = -1e9;
    for (let k = 0; k < 4; k++) {
      const a = wrap(Math.atan2((k & 2 ? zb : za) - cz, (k & 1 ? xb : xa) - cx) - th);
      if (a < e0) e0 = a;
      if (a > e1) e1 = a;
    }
    if (e1 - e0 > 2.5) return false;
    this._c = wrap(th - this.lo);
    this._e0 = e0;
    this._e1 = e1;
    return true;
  }

  // Where ray j meets the square, the nearer way in; 0 for a miss.
  _entry(j, xa, za, xb, zb) {
    const ix = this.ix[j];
    const iz = this.iz[j];
    const tx0 = (xa - this.cx) * ix;
    const tx1 = (xb - this.cx) * ix;
    const tz0 = (za - this.cz) * iz;
    const tz1 = (zb - this.cz) * iz;
    const tin = Math.max(tx0 < tx1 ? tx0 : tx1, tz0 < tz1 ? tz0 : tz1);
    const tout = Math.min(tx0 < tx1 ? tx1 : tx0, tz0 < tz1 ? tz1 : tz0);
    return tout >= tin && tout > 0 ? Math.max(tin, 0) : 0;
  }

  // A square of ground over which the land is no lower than m: what it blocks.
  block(xa, za, xb, zb, m) {
    if (!this.ok || this._inside(xa, za, xb, zb) || !this._extent(xa, za, xb, zb)) return;
    const dn = Math.max(0.5, Math.hypot(Math.max(xa - this.cx, 0, this.cx - xb), Math.max(za - this.cz, 0, this.cz - zb)));
    const low = m - this.cy;
    const { step, cols, best } = this;
    for (let s = -1; s <= 1; s++) {
      const r0 = this._c + this._e0 + s * TAU;
      const r1 = this._c + this._e1 + s * TAU;
      if (r1 < 0 || r0 > this.span) continue;
      const j0 = Math.max(0, Math.ceil(r0 / step));
      const j1 = Math.min(cols, Math.floor(r1 / step));
      if (j1 <= j0) continue;
      let prev = this._entry(j0, xa, za, xb, zb);
      for (let j = j0 + 1; j <= j1; j++) {
        const d = this._entry(j, xa, za, xb, zb);
        if (d > 0 && prev > 0) {
          const far = d > prev ? d : prev;
          const e = low >= 0 ? low / far : low / dn;
          const at = (j - 1) * BANDS + band(far);
          if (e > best[at]) best[at] = e;
        }
        prev = d;
      }
    }
    this.blocks++;
  }

  // The blocks of a tile whose land is n x n cells, mins the lowest of each (row by
  // row). A tile out of the view has none that matter: it is left out.
  blockTile(x0, z0, size, mins, n = 8) {
    if (!this.ok) return;
    const x1 = x0 + size;
    const z1 = z0 + size;
    if (!this._inside(x0, z0, x1, z1) && this._extent(x0, z0, x1, z1) && !this._seen()) return;
    const per = size / n;
    for (let cj = 0; cj < n; cj++) {
      for (let ci = 0; ci < n; ci++) {
        this.block(x0 + ci * per, z0 + cj * per, x0 + (ci + 1) * per, z0 + (cj + 1) * per, mins[cj * n + ci]);
      }
    }
  }

  // Whether the square _extent last found is in the view at all.
  _seen() {
    for (let s = -1; s <= 1; s++) {
      const r0 = this._c + this._e0 + s * TAU;
      const r1 = this._c + this._e1 + s * TAU;
      if (r1 >= -this.step && r0 <= this.span + this.step) return true;
    }
    return false;
  }

  // Once every block is in: what is blocked at or nearer than a band, in each
  // column.
  seal() {
    if (!this.ok) return;
    const { best, cols } = this;
    for (let w = 0; w < cols; w++) {
      const o = w * BANDS;
      for (let b = 1; b < BANDS; b++) if (best[o + b - 1] > best[o + b]) best[o + b] = best[o + b - 1];
    }
  }

  // Whether a square of ground with something no higher than top over it
  // cannot be seen: it is out of the view, or every column across it is
  // blocked, by ground that is nearer than all of it, to above its top.
  hidden(xa, za, xb, zb, top) {
    if (!this.ok || this._inside(xa, za, xb, zb, 12) || !this._extent(xa, za, xb, zb)) return false;
    const { cx, cz, cy, step, cols, best } = this;
    const dn = Math.hypot(Math.max(xa - cx, 0, cx - xb), Math.max(za - cz, 0, cz - zb));
    const df = Math.hypot(Math.max(cx - xa, xb - cx), Math.max(cz - za, zb - cz));
    if (dn < BAND0 * 1.1) return false;
    const up = top - cy;
    const tan = up >= 0 ? up / dn : up / df;
    const want = tan + MARGIN;
    const b = band(dn) - 1;
    let seen = false;
    this.tested++;
    for (let s = -1; s <= 1; s++) {
      const r0 = this._c + this._e0 + s * TAU;
      const r1 = this._c + this._e1 + s * TAU;
      if (r1 < -step || r0 > this.span + step) continue;
      seen = true;
      if (b < 0) return false;
      const w0 = Math.max(0, Math.floor(r0 / step));
      const w1 = Math.min(cols - 1, Math.floor(r1 / step));
      for (let w = w0; w <= w1; w++) if (best[w * BANDS + b] < want) return false;
    }
    if (seen) this.hid++;
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
  const rx = e[0]; const ry = e[1]; const rz = e[2];
  const ux = e[4]; const uy = e[5]; const uz = e[6];
  const fx = -e[8]; const fy = -e[9]; const fz = -e[10];
  const N = 8;
  let first = 0;
  let lo = 1e9;
  let hi = -1e9;
  let n = 0;
  for (let k = 0; k < N * 4; k++) {
    // Round the border of the picture.
    const side = Math.floor(k / N);
    const q = ((k % N) / N) * 2 - 1;
    const sx = side === 0 ? q : side === 1 ? 1 : side === 2 ? -q : -1;
    const sy = side === 0 ? -1 : side === 1 ? q : side === 2 ? 1 : -q;
    const dx = fx + rx * sx * t * a + ux * sy * t;
    const dy = fy + ry * sx * t * a + uy * sy * t;
    const dz = fz + rz * sx * t * a + uz * sy * t;
    // Straight up or down, or near it, is in the picture's reach: no bound.
    if (Math.hypot(dx, dz) < 0.6 * Math.abs(dy)) {
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
  out[0] = first + lo - 0.05;
  out[1] = hi - lo + 0.1;
  return out;
}
