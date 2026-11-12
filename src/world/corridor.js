// The land after the road was built through it.
//
// Every committed stretch of road imposes a band on the ground around it. On
// the ground the band is a level platform under the verge that widens into cut
// slopes above and fill slopes below, which is what a cutting and an
// embankment are. Under a bridge the land only has to stay below the girders;
// over a tunnel it only has to stay above the vault. Bands are applied from the
// farthest stretch to the nearest, so the road a point belongs to has the last
// word, and where two serpentine legs pass close together the ground between
// them is shaped by both.
//
// Terrain tiles, props, the camera and off-road physics all ask this one
// function, so the land everything stands on is the land that is drawn.

import { HALF_PAVED, HALF_FLAT, DECK_DEPTH, GROUND, BRIDGE, TUNNEL } from './road.js';

export const REACH = 44;           // metres from the centreline the road can reshape
const CUT = 1.25;                  // cut slope, rise per metre out
const FILL = 0.62;                 // fill slope, fall per metre out
const VERGE_DROP = 0.28;           // platform edge sits this far below the asphalt
export const TUNNEL_H = 7.2;       // running surface to the crown of the vault
// The foot of a cut is rounded over this many metres. The land is drawn on
// a 2 m grid, which cannot follow a sharp crease there: its triangles cut
// across the crease and stood up through the verge in teeth.
const FOOT = 3;
const footRamp = (e) => (e < FOOT ? (e * e) / (2 * FOOT) : e - FOOT / 2);

// Smooth clamp: rounds the crease where natural ground meets a cut or fill.
function softMin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function softMax(a, b, k) {
  return -softMin(-a, -b, k);
}

export class Corridor {
  constructor(road, land) {
    this.road = road;
    this.land = land;
  }

  // Collect the segments that can reach an axis-aligned box (absolute xz) and
  // bucket them on a small grid, so each vertex only tests its neighbours.
  // All typed arrays, so the lot can be handed to a worker (render/bakery.js):
  // seg holds 9 numbers a segment, and bucket b lists the segments in
  // bIds[bStart[b]] .. bIds[bStart[b + 1] - 1].
  prepare(x0, z0, size, bucket = 16) {
    const road = this.road;
    const pad = REACH + 4;
    const list = [];
    const cx = x0 + size / 2;
    const cz = z0 + size / 2;
    road.forEachSegmentNear(cx, cz, size * 0.71 + pad, (i) => list.push(i));
    const nb = Math.max(1, Math.ceil(size / bucket));
    const bsize = size / nb;
    const buckets = Array.from({ length: nb * nb }, () => []);
    // Packed segment data: ax az bx bz ya yb banka bankb kind
    const seg = new Float64Array(list.length * 9);
    let n = 0;
    let total = 0;
    for (const i of list) {
      const a = road.samples.get(i);
      const b = road.samples.get(i + 1);
      if (!a || !b) continue;
      const o = n * 9;
      seg[o] = a.ax; seg[o + 1] = a.az; seg[o + 2] = b.ax; seg[o + 3] = b.az;
      seg[o + 4] = a.y; seg[o + 5] = b.y; seg[o + 6] = a.bank; seg[o + 7] = b.bank;
      seg[o + 8] = a.kind;
      // Which buckets can this segment reach?
      const mx = (a.ax + b.ax) / 2 - x0;
      const mz = (a.az + b.az) / 2 - z0;
      const r = pad + 2;
      const i0 = Math.max(0, Math.floor((mx - r) / bsize));
      const i1 = Math.min(nb - 1, Math.floor((mx + r) / bsize));
      const j0 = Math.max(0, Math.floor((mz - r) / bsize));
      const j1 = Math.min(nb - 1, Math.floor((mz + r) / bsize));
      for (let bj = j0; bj <= j1; bj++) {
        for (let bi = i0; bi <= i1; bi++) {
          buckets[bj * nb + bi].push(n);
          total++;
        }
      }
      n++;
    }
    const bStart = new Int32Array(nb * nb + 1);
    const bIds = new Int32Array(total);
    for (let b = 0, k = 0; b < nb * nb; b++) {
      bStart[b] = k;
      for (const id of buckets[b]) bIds[k++] = id;
      bStart[b + 1] = k;
    }
    return { x0, z0, nb, bsize, seg, count: n, bStart, bIds };
  }

  // Ground height at an absolute point, given the natural height there.
  // Returns into `out`: h, cut (m removed), fill (m added), near (distance to
  // the nearest centreline, capped at REACH), kind of that nearest stretch.
  shape(ctx, ax, az, natural, out) {
    out.h = natural;
    out.near = REACH;
    out.kind = -1;
    if (!ctx || ctx.count === 0) {
      out.cut = 0;
      out.fill = 0;
      return out;
    }
    const bi = Math.min(ctx.nb - 1, Math.max(0, Math.floor((ax - ctx.x0) / ctx.bsize)));
    const bj = Math.min(ctx.nb - 1, Math.max(0, Math.floor((az - ctx.z0) / ctx.bsize)));
    const b = bj * ctx.nb + bi;
    const k0 = ctx.bStart[b];
    const k1 = ctx.bStart[b + 1];
    if (k0 === k1) {
      out.cut = 0;
      out.fill = 0;
      return out;
    }
    // Gather the reaching segments with their distances, farthest first.
    const seg = ctx.seg;
    const ids = ctx.bIds;
    const hits = this._hits || (this._hits = []);
    hits.length = 0;
    for (let k = k0; k < k1; k++) {
      const o = ids[k] * 9;
      const exx = seg[o + 2] - seg[o];
      const ezz = seg[o + 3] - seg[o + 1];
      const len2 = exx * exx + ezz * ezz || 1;
      let t = ((ax - seg[o]) * exx + (az - seg[o + 1]) * ezz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = seg[o] + exx * t;
      const pz = seg[o + 1] + ezz * t;
      const d = Math.hypot(ax - px, az - pz);
      if (d > REACH) continue;
      // Signed lateral offset: positive toward the left normal (-ez, ex).
      const lat = ((ax - px) * -ezz + (az - pz) * exx) / Math.sqrt(len2);
      hits.push(d, o, t, lat);
    }
    if (!hits.length) {
      out.cut = 0;
      out.fill = 0;
      return out;
    }
    // Sort the quadruples by distance, descending (few entries: insertion sort).
    const m = hits.length / 4;
    for (let a = 1; a < m; a++) {
      const d = hits[a * 4];
      const o = hits[a * 4 + 1];
      const t = hits[a * 4 + 2];
      const l = hits[a * 4 + 3];
      let b = a - 1;
      while (b >= 0 && hits[b * 4] < d) {
        hits[(b + 1) * 4] = hits[b * 4];
        hits[(b + 1) * 4 + 1] = hits[b * 4 + 1];
        hits[(b + 1) * 4 + 2] = hits[b * 4 + 2];
        hits[(b + 1) * 4 + 3] = hits[b * 4 + 3];
        b--;
      }
      hits[(b + 1) * 4] = d;
      hits[(b + 1) * 4 + 1] = o;
      hits[(b + 1) * 4 + 2] = t;
      hits[(b + 1) * 4 + 3] = l;
    }

    let h = natural;
    let nearKind = -1;
    let nearD = REACH;
    for (let a = 0; a < m; a++) {
      const d = hits[a * 4];
      const o = hits[a * 4 + 1];
      const t = hits[a * 4 + 2];
      const lat = hits[a * 4 + 3];
      const yc = seg[o + 4] + (seg[o + 5] - seg[o + 4]) * t;
      const bank = seg[o + 6] + (seg[o + 7] - seg[o + 6]) * t;
      const kind = seg[o + 8];
      const latC = lat < -HALF_FLAT ? -HALF_FLAT : lat > HALF_FLAT ? HALF_FLAT : lat;
      const surface = yc - bank * latC;
      const e = Math.max(0, d - HALF_FLAT);
      if (kind === GROUND) {
        const level = surface - (d > HALF_PAVED ? VERGE_DROP : 0.05);
        const lo = level - FILL * e;
        const hi = level + CUT * footRamp(e);
        // Rounding is tight on the platform, where it must not lift the ground
        // into the asphalt, and loosens out on the slopes.
        const k = 0.15 + 0.25 * Math.min(e, 4);
        h = softMax(softMin(h, hi, k), lo, k);
      } else if (kind === BRIDGE) {
        // Only the deck's footprint is protected; the girder must clear the land.
        if (d < HALF_FLAT + 3) h = softMin(h, surface - DECK_DEPTH - 1.6 - e * 0.5, 1.0);
      } else if (kind === TUNNEL) {
        // The vault needs cover; elsewhere the mountain is left alone.
        if (d < HALF_FLAT + 4) h = softMax(h, surface + TUNNEL_H + 2.0 + e * 0.8, 1.0);
      }
      if (a === m - 1) {
        nearKind = kind;
        nearD = d;
      }
    }
    out.h = h;
    out.cut = Math.max(0, natural - h);
    out.fill = Math.max(0, h - natural);
    out.near = nearD;
    out.kind = nearKind;
    return out;
  }

  // One-off query for a single point (camera, off-road physics, prop checks).
  heightAt(ax, az, natural = this.land.heightAt(ax, az)) {
    const ctx = this.prepare(ax - 1, az - 1, 2, 2);
    return this.shape(ctx, ax, az, natural, this._one || (this._one = {})).h;
  }
}
