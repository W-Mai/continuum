// What the water of a frame does, in numbers (tools/look.mjs puts them in a shot's `water`, tools/water_check.mjs holds
// them to limits). They are read from the frame, the map of what each pixel is and how far off, and the lens:
//
//  - mirror, mirrorRows: how much of what stands above the far edge of the water is in it. For each column of
//    the frame, each run of water pixels is paired with the pixels above its top end, the picture turned over about
//    that end (a pixel the run's length down is paired with the pixel as far above its top); the number is the
//    correlation of the two lightnesses, over all the pairs, and with the mean of each row taken off both (the
//    detail of the reflection, not the way the whole sheet is darker than the sky);
//  - shore: the lightness of the water within 2 m of the shore against that of the water 20 m or more from it
//    (both between 6 and 250 m from the lens): the shallows are paler than the deep;
//  - foam: of the water within 3 pixels of the shore (not farther than 200 m), how much is light (L over 0.85),
//    and the same on both sides of the shore line;
//  - flow: how far the pattern of the water moved in a second, in metres on the water, from two frames of the
//    same place a second apart (drawn without the reflection of the frame in the water, which stays where it is as
//    the ripples go on), and how much of it is along the way the river runs.
//
// The shore is a water pixel next to land (the terrain, and what lies on the ground) at about the same distance:
// a tree or a bridge in front of the water is no shore.

const LAND_NEAR = 0.3;   // how far apart (as a share of the water's distance, and a metre) the water and the land of a shore are
const FAR_WATER = 1500;  // m: what is water here at all

// The point of a pixel in the lens's own space (the lens looks down -z), for a pixel's distance z along the axis.
function lens(w, h, fov, aspect) {
  const th = Math.tan((fov * Math.PI) / 360);
  return (i, z, out) => {
    const x = i % w;
    const y = (i / w) | 0;
    out[0] = ((x + 0.5) / w * 2 - 1) * th * aspect * z;
    out[1] = (1 - (y + 0.5) / h * 2) * th * z;
    out[2] = z;
  };
}

function corr(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

const r4 = (v) => (v === null || v === undefined || Number.isNaN(v) ? null : +v.toFixed(4));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// lab: { w, h, n, L }; kind, dist: the map (rows from the top); K: the numbers of the kinds.
export function waterMetrics({ lab, kind, dist, K, fov, aspect }) {
  const { w, h, n, L } = lab;
  const isWater = (i) => kind[i] === K.water && dist[i] < FAR_WATER;
  const isLand = (j, z) => (kind[j] === K.terrain || kind[j] === K.ground) && Math.abs(dist[j] - z) <= LAND_NEAR * z + 1;
  let waterN = 0;
  for (let i = 0; i < n; i++) if (isWater(i)) waterN++;
  if (waterN < 400) return null;

  // --- the reflection of what is above the far edge --------------------------------------------------------
  const rows = new Map();
  let pairs = 0;
  const a = [];
  const b = [];
  const isSheet = (i) => kind[i] === K.water;
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!isSheet(y * w + x)) { y++; continue; }
      const y0 = y;
      while (y < h && isSheet(y * w + x)) y++;
      const y1 = y - 1;
      // A run's top end is a shore (or the horizon): not a rail or a car that stands over it.
      const over = y0 === 0 ? -1 : kind[(y0 - 1) * w + x];
      if (y1 - y0 < 5 || y0 === 0 || over === K.car || over === K.life || over === K.road || over === K.other) continue;
      for (let yy = y0 + 2; yy <= y1; yy++) {
        const y2 = 2 * y0 - yy;
        if (y2 < 0) break;
        const i = yy * w + x;
        const j = y2 * w + x;
        if (!isWater(i) || kind[j] === K.water || kind[j] === K.car || kind[j] === K.life) continue;
        let r = rows.get(yy);
        if (!r) rows.set(yy, r = { a: [], b: [] });
        r.a.push(L[i]);
        r.b.push(L[j]);
        a.push(L[i]);
        b.push(L[j]);
        pairs++;
      }
    }
  }
  let mirror = null;
  let mirrorRows = null;
  if (pairs >= 400) {
    mirror = r4(corr(a, b));
    const ra = [];
    const rb = [];
    for (const r of rows.values()) {
      const ma = mean(r.a);
      const mb = mean(r.b);
      for (let k = 0; k < r.a.length; k++) {
        ra.push(r.a[k] - ma);
        rb.push(r.b[k] - mb);
      }
    }
    mirrorRows = r4(corr(ra, rb));
  }

  // --- the shore, and the water by how far it is from it ---------------------------------------------------
  const edge = new Uint8Array(n);       // 1: a water pixel on a shore, 2: the land pixel it meets
  const step4 = [-1, 1, -w, w];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!isWater(i) || dist[i] > 400) continue;
      for (const d of step4) {
        const j = i + d;
        if (isLand(j, dist[i])) {
          edge[i] = 1;
          if (!edge[j]) edge[j] = 2;
        }
      }
    }
  }
  // Breadth first, over the water from its shore pixels (src: the shore pixel that reached it first) and over
  // the land from the land pixels of a shore, three pixels.
  const src = new Int32Array(n).fill(-1);
  const dpx = new Int16Array(n).fill(-1);
  const queue = [];
  let edges = 0;
  for (let i = 0; i < n; i++) {
    if (edge[i] === 1) { src[i] = i; dpx[i] = 0; queue.push(i); edges++; }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % w;
    const y = (i / w) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? -1 : k === 1 ? 1 : 0);
      const ny = y + (k === 2 ? -1 : k === 3 ? 1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (dpx[j] >= 0 || !isWater(j)) continue;
      dpx[j] = dpx[i] + 1;
      src[j] = src[i];
      queue.push(j);
    }
  }
  const landD = new Int16Array(n).fill(-1);
  const lq = [];
  for (let i = 0; i < n; i++) {
    if (edge[i] === 2) { landD[i] = 0; lq.push(i); }
  }
  for (let q = 0; q < lq.length; q++) {
    const i = lq[q];
    if (landD[i] >= 3) continue;
    const x = i % w;
    const y = (i / w) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? -1 : k === 1 ? 1 : 0);
      const ny = y + (k === 2 ? -1 : k === 3 ? 1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (landD[j] >= 0 || !(kind[j] === K.terrain || kind[j] === K.ground)) continue;
      landD[j] = landD[i] + 1;
      lq.push(j);
    }
  }
  const view = lens(w, h, fov, aspect);
  const pa = [0, 0, 0];
  const pb = [0, 0, 0];
  const metres = (i, j) => {
    view(i, dist[i], pa);
    view(j, dist[j], pb);
    return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
  };
  const near = [];
  const far = [];
  let foamN = 0;
  let foamLit = 0;
  let sidesN = 0;
  let sidesLit = 0;
  for (let i = 0; i < n; i++) {
    if (dpx[i] >= 0 && dist[i] >= 6 && dist[i] <= 250) {
      const d = metres(i, src[i]);
      if (d <= 2) near.push(L[i]);
      else if (d >= 20) far.push(L[i]);
    }
    if (dpx[i] >= 0 && dpx[i] <= 3 && dist[i] <= 200) {
      foamN++;
      sidesN++;
      if (L[i] > 0.85) { foamLit++; sidesLit++; }
    } else if (landD[i] >= 0 && dist[i] <= 200) {
      sidesN++;
      if (L[i] > 0.85) sidesLit++;
    }
  }
  const NEAR_MIN = 150;
  const shore = {
    near: near.length >= NEAR_MIN ? r4(mean(near)) : null,
    far: far.length >= NEAR_MIN ? r4(mean(far)) : null,
    dL: near.length >= NEAR_MIN && far.length >= NEAR_MIN ? r4(mean(near) - mean(far)) : null,
    nNear: near.length,
    nFar: far.length,
    edge: edges,
  };
  const foam = {
    share: foamN >= NEAR_MIN ? r4(foamLit / foamN) : null,
    sides: sidesN >= NEAR_MIN ? r4(sidesLit / sidesN) : null,
    n: foamN,
  };
  return { mirror, mirrorRows, mirrorN: pairs, shore, foam };
}

// --- the pattern of the water, a second on --------------------------------------------------------------------

// The point on the water of each pixel of the region (water, 6 to 30 m off), in metres on the water's plane
// (x, z), from the lens's place and turn (a quaternion x, y, z, w) and the pixel's distance.
function onWater({ w, h, kind, dist, K, fov, aspect, p, q }) {
  const th = Math.tan((fov * Math.PI) / 360);
  const [qx, qy, qz, qw] = q;
  const rot = (x, y, z) => {
    // v' = v + 2 w (u x v) + 2 u x (u x v), u = (qx, qy, qz)
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)];
  };
  const out = [];
  for (let i = 0; i < w * h; i++) {
    if (kind[i] !== K.water || !(dist[i] >= 6 && dist[i] <= 30)) continue;
    const z = dist[i];
    const x = i % w;
    const y = (i / w) | 0;
    const v = rot(((x + 0.5) / w * 2 - 1) * th * aspect * z, (1 - (y + 0.5) / h * 2) * th * z, -z);
    out.push([i, p[0] + v[0], p[2] + v[2]]);
  }
  return out;
}

// How far the pattern of the water has moved between two frames of one place, a second apart (a, b: the frames'
// OKLab lightness, from tools/look.mjs's toLab), in metres on the water: (dx, dz), and the share of it along
// `flow` (a unit vector (x, z): the way the river runs) and across it. The pixels are laid on a grid of the
// water's own plane (0.1 m a cell), and the second frame's is found in the first's by the shift that
// correlates them best (searched up to 3 m either way: coarsely, then finely, then between the cells).
export function flowShift({ a, b, kind, dist, K, fov, aspect, p, q, flow }) {
  const { w, h } = a;
  const pts = onWater({ w, h, kind, dist, K, fov, aspect, p, q });
  if (pts.length < 2000) return null;
  // The window: 32 m square about the middle (median) of the points.
  const xs = pts.map((t) => t[1]).sort((u, v) => u - v);
  const zs = pts.map((t) => t[2]).sort((u, v) => u - v);
  const cx = xs[xs.length >> 1];
  const cz = zs[zs.length >> 1];
  const CELL = 0.1;
  const N = 320;
  const x0 = cx - (N * CELL) / 2;
  const z0 = cz - (N * CELL) / 2;
  const grid = (frame) => {
    const sum = new Float32Array(N * N);
    const cnt = new Uint16Array(N * N);
    for (const [i, x, z] of pts) {
      const gx = Math.floor((x - x0) / CELL);
      const gz = Math.floor((z - z0) / CELL);
      if (gx < 0 || gz < 0 || gx >= N || gz >= N) continue;
      sum[gz * N + gx] += frame.L[i];
      cnt[gz * N + gx]++;
    }
    const val = new Float32Array(N * N).fill(NaN);
    for (let k = 0; k < N * N; k++) if (cnt[k]) val[k] = sum[k] / cnt[k];
    // Holes where the pixels are farther apart than a cell: the mean of the cells about them.
    const out = val.slice();
    for (let z = 1; z < N - 1; z++) {
      for (let x = 1; x < N - 1; x++) {
        const k = z * N + x;
        if (!Number.isNaN(val[k])) continue;
        let s = 0;
        let c = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const v = val[k + dz * N + dx];
            if (!Number.isNaN(v)) { s += v; c++; }
          }
        }
        if (c >= 3) out[k] = s / c;
      }
    }
    return out;
  };
  const GA = grid(a);
  const GB = grid(b);
  // B(x) = A(x - shift): the normalised cross-correlation of the two over the cells they share.
  const ncc = (sx, sz, step = 1) => {
    let n = 0;
    let sa = 0;
    let sb = 0;
    let saa = 0;
    let sbb = 0;
    let sab = 0;
    for (let z = Math.max(0, sz); z < Math.min(N, N + sz); z += step) {
      for (let x = Math.max(0, sx); x < Math.min(N, N + sx); x += step) {
        const vb = GB[z * N + x];
        const va = GA[(z - sz) * N + (x - sx)];
        if (Number.isNaN(va) || Number.isNaN(vb)) continue;
        n++;
        sa += va;
        sb += vb;
        saa += va * va;
        sbb += vb * vb;
        sab += va * vb;
      }
    }
    if (n < 800) return -1;
    const cov = sab - (sa * sb) / n;
    const va = saa - (sa * sa) / n;
    const vb = sbb - (sb * sb) / n;
    return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : -1;
  };
  const MAX = Math.round(3 / CELL);
  let best = { v: -2, x: 0, z: 0 };
  for (let sz = -MAX; sz <= MAX; sz += 3) {
    for (let sx = -MAX; sx <= MAX; sx += 3) {
      const v = ncc(sx, sz, 2);
      if (v > best.v) best = { v, x: sx, z: sz };
    }
  }
  let fine = best;
  for (let sz = best.z - 3; sz <= best.z + 3; sz++) {
    for (let sx = best.x - 3; sx <= best.x + 3; sx++) {
      const v = ncc(sx, sz, 1);
      if (v > fine.v) fine = { v, x: sx, z: sz };
    }
  }
  // Between the cells: a parabola through the peak and its neighbours, each way.
  const peak = (axis) => {
    const c0 = fine.v;
    const lo = axis === 0 ? ncc(fine.x - 1, fine.z) : ncc(fine.x, fine.z - 1);
    const hi = axis === 0 ? ncc(fine.x + 1, fine.z) : ncc(fine.x, fine.z + 1);
    const d = lo - 2 * c0 + hi;
    return d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (lo - hi)) / d)) : 0;
  };
  const dx = (fine.x + peak(0)) * CELL;
  const dz = (fine.z + peak(1)) * CELL;
  const along = flow ? dx * flow[0] + dz * flow[1] : null;
  const across = flow ? dx * -flow[1] + dz * flow[0] : null;
  return { dx: r4(dx), dz: r4(dz), along: r4(along), across: r4(across), ncc: r4(fine.v), n: pts.length };
}
