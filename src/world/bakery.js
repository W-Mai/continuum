// What a terrain tile and a forest tile are made of, as plain arrays: the
// land shaped by the road with its sun, sky and colours, and the trees with
// their places, sizes, sun and tints. No three.js here, so the same code runs
// on the page (render/terrain.js, render/forest.js, building the meshes from
// the arrays) and in the workers that bake ahead of it (render/bakers.js,
// world/bakeworker.js): a tile comes out the same either way.
//
// Both are generators, so the page can spread one over frames when there is
// no worker; a worker runs them to the end at once.
//
// env: { land, corridor, veg } (makeWorldLand, a Corridor for its shape(),
// makeVegetation). ctx: the corridor's prepare() for the tile, built where
// the road is (the page). sun: { x, y, z }.

import { sunVisibility } from './sunlight.js';
import { hash2 } from './noise.js';
import { TUNNEL, HALF_FLAT, GROUND } from './road.js';
import { REACH } from './corridor.js';
import { FLORA, TREE_SIZE } from './vegetation.js';

export const LAND_RES = 64;
export const LAND_LEVELS = [128, 256, 512, 1024, 2048, 4096];
const HORIZON_RADII = [45, 140, 420];
const HORIZON_DIRS = new Float32Array(16);
for (let d = 0; d < 8; d++) {
  HORIZON_DIRS[d * 2] = Math.cos((d / 8) * Math.PI * 2);
  HORIZON_DIRS[d * 2 + 1] = Math.sin((d / 8) * Math.PI * 2);
}

// The corridor box a land tile needs: one vertex of border each side.
export function landBox(level, ix, iz) {
  const size = LAND_LEVELS[level];
  const step = size / LAND_RES;
  return [ix * size - step, iz * size - step, size + 2 * step, Math.max(16, size / 24)];
}

// A land tile: heights from the natural land shaped by the road; everything
// the shader needs per vertex. Returns { buried } for a tile all under cloud
// or lava, else { pos, nrm, shade, surf, hmin, hmax, drop }: (RES+1)^2
// vertices of the grid, then 4 * (RES+1) of the skirts hanging under its
// edges.
export function* bakeLand(env, level, ix, iz, ctx, sun) {
  const RES = LAND_RES;
  const size = LAND_LEVELS[level];
  const step = size / RES;
  const x0 = ix * size;
  const z0 = iz * size;
  const G = RES + 3;            // one extra vertex of border each side
  const H = new Float32Array(G * G);
  const cut = new Float32Array(G * G);
  const fill = new Float32Array(G * G);
  const near = new Float32Array(G * G);
  const overTunnel = new Uint8Array(G * G);
  const nearKind = new Int8Array(G * G);
  const { land, corridor, veg } = env;
  const fine = level <= 2;
  const out = {};
  let hmin = Infinity;
  let hmax = -Infinity;
  // Under a sea of cloud or lava nothing of the land shows: a tile that is
  // all under it is left empty, without its sun, its sky or its colours.
  const opaque = land.opaqueLevel;
  let buried = !!opaque;
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const ax = x0 + (i - 1) * step;
      const az = z0 + (j - 1) * step;
      const nat = fine ? land.heightAt(ax, az) : (land.heightAtFar || land.heightAtCoarse)(ax, az);
      corridor.shape(ctx, ax, az, nat, out);
      const k = j * G + i;
      H[k] = out.h;
      cut[k] = out.cut;
      fill[k] = out.fill;
      near[k] = out.near;
      overTunnel[k] = out.kind === TUNNEL && out.near < HALF_FLAT + 10 ? 1 : 0;
      nearKind[k] = out.kind;
      if (i > 0 && j > 0 && i < G - 1 && j < G - 1) {
        if (out.h < hmin) hmin = out.h;
        if (out.h > hmax) hmax = out.h;
      }
      if (buried && !(opaque(ax, az) > out.h + 1)) buried = false;
    }
    if ((j & 7) === 7) yield;
  }
  if (buried) return { buried: true, hmin, hmax };

  // Sun visibility, marched on a coarse sub-grid toward the sun over the
  // natural land (sunlight.js, the same march the road and the car use), then
  // interpolated. On the same sub-grid, how much of the sky each point sees
  // past the land around it (the highest horizon in eight directions, out to
  // half a kilometre): gullies and valley floors get less skylight than
  // spurs and crests, which is what keeps a face in shadow from going flat.
  const SUB = 8;
  const S = RES / SUB + 1;
  const vis = new Float32Array(S * S);
  const sky = new Float32Array(S * S);
  const relief = land.heightAtFar || land.heightAtCoarse;
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const gi = 1 + i * SUB;
      const gj = 1 + j * SUB;
      const px = x0 + (gi - 1) * step;
      const pz = z0 + (gj - 1) * step;
      const h0 = H[gj * G + gi];
      vis[j * S + i] = sunVisibility(land, px, pz, h0, sun);
      let occ = 0;
      for (let d = 0; d < 8; d++) {
        const dx = HORIZON_DIRS[d * 2];
        const dz = HORIZON_DIRS[d * 2 + 1];
        let tanMax = 0;
        for (const r of HORIZON_RADII) {
          const t = (relief(px + dx * r, pz + dz * r) - h0) / r;
          if (t > tanMax) tanMax = t;
        }
        occ += tanMax / Math.sqrt(1 + tanMax * tanMax);
      }
      sky[j * S + i] = 1 - occ / 8;
    }
    if (j % 3 === 2) yield;
  }

  const N = RES + 1;
  const vertCount = N * N + 4 * N;
  const pos = new Float32Array(vertCount * 3);
  const nrm = new Float32Array(vertCount * 3);
  const shade = new Float32Array(vertCount * 3);
  const surf = new Float32Array(vertCount * 3);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const gi = i + 1;
      const gj = j + 1;
      const k = gj * G + gi;
      const v = j * N + i;
      const h = H[k];
      pos[v * 3] = i * step;
      pos[v * 3 + 1] = h;
      pos[v * 3 + 2] = j * step;
      const hx = H[k + 1] - H[k - 1];
      const hz = H[k + G] - H[k - G];
      const nx = -hx / (2 * step);
      const nz = -hz / (2 * step);
      const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
      nrm[v * 3] = nx * inv;
      nrm[v * 3 + 1] = inv;
      nrm[v * 3 + 2] = nz * inv;
      // Interpolated sun visibility.
      const fx = i / SUB;
      const fz = j / SUB;
      const i0 = Math.min(S - 2, Math.floor(fx));
      const j0 = Math.min(S - 2, Math.floor(fz));
      const tx = fx - i0;
      const tz = fz - j0;
      const a = vis[j0 * S + i0] + (vis[j0 * S + i0 + 1] - vis[j0 * S + i0]) * tx;
      const b = vis[(j0 + 1) * S + i0] + (vis[(j0 + 1) * S + i0 + 1] - vis[(j0 + 1) * S + i0]) * tx;
      shade[v * 3] = a + (b - a) * tz;
      const sa = sky[j0 * S + i0] + (sky[j0 * S + i0 + 1] - sky[j0 * S + i0]) * tx;
      const sb = sky[(j0 + 1) * S + i0] + (sky[(j0 + 1) * S + i0 + 1] - sky[(j0 + 1) * S + i0]) * tx;
      const skyVis = sa + (sb - sa) * tz;
      // Cavity: how far this vertex sits below the mean of its neighbours.
      const lap = (H[k + 1] + H[k - 1] + H[k + G] + H[k - G]) * 0.25 - h;
      const cavity = Math.max(0.5, Math.min(1.12, 1 - lap / (step * 0.9 + 1.5) * 0.5));
      shade[v * 3 + 1] = cavity * (0.55 + 0.45 * skyVis * skyVis);
      shade[v * 3 + 2] = veg
        ? veg.density(x0 + i * step, z0 + j * step, h, 1 - inv, near[k], cut[k], fill[k]) : 0;
      surf[v * 3] = cut[k];
      surf[v * 3 + 1] = fill[k];
      // Distance to the road, for painting verges and embankments: only
      // where the road runs on the ground. Under a viaduct or over a tunnel
      // the land is just land.
      surf[v * 3 + 2] = nearKind[k] === GROUND ? near[k] : REACH;
    }
    if ((j & 7) === 7) yield;
  }
  // Skirts: a curtain hanging under each edge hides the cracks where a tile
  // meets a coarser neighbour. Not over a tunnel, where it would hang
  // through the vault into the bore.
  const drop = level <= 1 ? step * 1.6 + 2 : step * 2.5 + 4;
  let sv = N * N;
  for (const [ia, ja, di, dj] of LAND_EDGES) {
    for (let t = 0; t < N; t++) {
      const i = ia + di * t;
      const j = ja + dj * t;
      const src = j * N + i;
      const bore = overTunnel[(j + 1) * G + (i + 1)];
      pos[sv * 3] = pos[src * 3];
      pos[sv * 3 + 1] = pos[src * 3 + 1] - (bore ? 0.4 : drop);
      pos[sv * 3 + 2] = pos[src * 3 + 2];
      nrm[sv * 3] = nrm[src * 3];
      nrm[sv * 3 + 1] = nrm[src * 3 + 1];
      nrm[sv * 3 + 2] = nrm[src * 3 + 2];
      shade[sv * 3] = shade[src * 3];
      shade[sv * 3 + 1] = shade[src * 3 + 1] * 0.8;
      shade[sv * 3 + 2] = shade[src * 3 + 2];
      surf[sv * 3] = surf[src * 3];
      surf[sv * 3 + 1] = surf[src * 3 + 1];
      surf[sv * 3 + 2] = surf[src * 3 + 2];
      sv++;
    }
  }
  return { pos, nrm, shade, surf, hmin, hmax, drop };
}

// The skirts, in order: from a corner along an edge. Skirt e's vertices are
// (RES+1)^2 + e * (RES+1) onward.
export const LAND_EDGES = [[0, 0, 1, 0], [LAND_RES, 0, 0, 1], [LAND_RES, LAND_RES, -1, 0], [0, LAND_RES, 0, -1]];

// --- trees far off ----------------------------------------------------------------
//
// Far off a tree is a few flat shapes crossing on its axis: a plane for each
// part of a turn, each a polygon whose corners carry what the tree has there
// (its colour, how it is lit as a rounded crown is). A forest tile's far trees
// of a kind are made into one plain mesh, with the tree's own turn, size,
// tint and sun. A corner is [u, v, nu, nv, colour, shade]: u across the plane
// in units of the tree's width, v up it in units of its height, the normal's
// part across and up, a colour (from 0 to 1 a blend of the palette's first
// two, 2 the palette's third) and a factor on it.
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (h) => [lin(((h >> 16) & 255) / 255), lin(((h >> 8) & 255) / 255), lin((h & 255) / 255)];

// A convex polygon on an ellipse: n corners from angle a0, about (0, cv), the
// colours and the light by where on the ellipse they are (a lump of foliage:
// brighter at the top, the normal leaning up). The colour goes from the
// palette's first to its second over the top of the ellipse: from where it is
// level with the middle (v 0) up to tipAt, or all at once above 0.2 if there
// is none.
function lump(n, a0, ru, rv, cv, tipAt = 0, lean = 0.25) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    const eu = Math.cos(a);
    const ev = Math.sin(a);
    const tip = tipAt ? Math.min(1, Math.max(0, ev / tipAt)) : ev > 0.2 ? 1 : 0;
    out.push([eu * ru, cv + ev * rv, eu, ev + lean, tip, 0.55 + 0.45 * (0.5 + 0.5 * ev)]);
  }
  return out;
}

// A shape: planes of polygons (each a fan of its corners), a palette, and a
// factor on the light the palette gives.
export const CROSS = {
  spruce: {
    planes: 3,
    gain: 1.05,
    palette: [rgb(0x223319), rgb(0x3b5128)],
    polys: [[[0, 1, 0, 1, 1, 0.9], [-0.205, 0.03, -0.205, 0.16, 0, 0.62], [0.205, 0.03, 0.205, 0.16, 0, 0.62]]],
  },
  broadleaf: {
    planes: 3,
    gain: 1.07,
    palette: [rgb(0x2c4419), rgb(0x4f6e2c), rgb(0x4a3b2c)],
    polys: [
      [[-0.03, 0, -1, 0, 2, 0.8], [0.03, 0, 1, 0, 2, 0.8], [0.018, 0.42, 1, 0, 2, 1], [-0.018, 0.42, -1, 0, 2, 1]],
      lump(10, 0, 0.3, 0.3 / 0.951, 0.64, 0.707),
    ],
  },
  pine: {
    planes: 3,
    gain: 1.05,
    palette: [rgb(0x2b3d1c), rgb(0x48602c), rgb(0x5a4433)],
    polys: [
      [[-0.03, 0, -1, 0, 2, 0.8], [0.03, 0, 1, 0, 2, 0.8], [0.02, 0.8, 1, 0, 2, 1], [-0.02, 0.8, -1, 0, 2, 1]],
      lump(6, Math.PI / 6, 0.46, 0.145, 0.84),
    ],
  },
  cactus: {
    planes: 3,
    gain: 1,
    palette: [rgb(0x4c6a38)],
    polys: [[[-0.065, 0, -1, 0.2, 0, 0.75], [0.065, 0, 1, 0.2, 0, 0.75], [0.065, 0.92, 1, 0.2, 0, 1], [0, 0.976, 0, 1, 0, 1.1], [-0.065, 0.92, -1, 0.2, 0, 1]]],
  },
  // Bare wood: a trunk, its crooked top, and two boughs. Two planes are
  // enough for what is thin.
  dead: {
    planes: 2,
    gain: 0.78,
    palette: [rgb(0x35312f), rgb(0x5a5551)],
    polys: [
      [[-0.05, 0, -1, 0.1, 0, 0.6], [0.05, 0, 1, 0.1, 0, 0.6], [0.02, 0.62, 1, 0.3, 0, 1], [-0.02, 0.62, -1, 0.3, 0, 1]],
      [[-0.02, 0.6, -1, 0.3, 0, 0.9], [0.02, 0.6, 1, 0.3, 0, 0.9], [0.006, 0.98, 0.3, 1, 1, 1], [-0.006, 0.98, -0.3, 1, 1, 1]],
      [[0, 0.4, 0, 1, 0, 0.9], [0.028, 0.46, 1, 0.5, 0, 0.9], [0.34, 0.64, 1, 0.5, 1, 1]],
      [[0, 0.52, 0, 1, 0, 0.9], [-0.028, 0.58, -1, 0.5, 0, 0.9], [-0.32, 0.76, -1, 0.5, 1, 1]],
    ],
  },
};

// How many corners a tree of a shape has, and the triangles over them (the
// same for every tree of the shape).
export function crossLayout(shape) {
  let v = 0;
  const idx = [];
  for (let p = 0; p < shape.planes; p++) {
    for (const poly of shape.polys) {
      for (let i = 1; i < poly.length - 1; i++) idx.push(v, v + i, v + i + 1);
      v += poly.length;
    }
  }
  return { corners: v, index: idx };
}

// The far tree of a shape at (x, y, z), width w and height h, turned psi, its
// tint and the sun on it, added to out ({ pos, nrm, col, sun } arrays).
function addCross(out, shape, x, y, z, w, h, psi, t0, t1, t2, sun) {
  const g = shape.gain;
  for (let p = 0; p < shape.planes; p++) {
    const a = psi + (p * Math.PI) / shape.planes;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    for (const poly of shape.polys) {
      for (const [u, v, nu, nv, ci, k] of poly) {
        out.pos.push(x + u * w * cs, y + v * h, z + u * w * sn);
        // As the instance's matrix turns a normal: by the inverse of its scale.
        const nx = (nu * cs) / w;
        const ny = nv / h;
        const nz = (nu * sn) / w;
        const l = Math.hypot(nx, ny, nz) || 1;
        out.nrm.push(Math.round((nx / l) * 127), Math.round((ny / l) * 127), Math.round((nz / l) * 127));
        // The colour is a blend of the palette's first two (0 to 1), or the
        // palette's third as it is (2).
        const own = ci >= 2;
        const c0 = shape.palette[own ? 2 : 0];
        const c1 = shape.palette[own ? 2 : ci > 0 ? 1 : 0];
        const f = own ? 0 : ci;
        out.col.push((c0[0] + (c1[0] - c0[0]) * f) * k * g * t0, (c0[1] + (c1[1] - c0[1]) * f) * k * g * t1, (c0[2] + (c1[2] - c0[2]) * f) * k * g * t2);
        out.sun.push(sun);
      }
    }
  }
}

// The far trees of a kind planted in a tile (bin: n, mats, suns, cols) as the
// arrays of one mesh, or null for a kind with no far shape.
export function farOf(name, bin) {
  const shape = CROSS[name];
  if (!shape) return null;
  const out = { pos: [], nrm: [], col: [], sun: [] };
  const { mats, cols, suns } = bin;
  for (let i = 0; i < bin.n; i++) {
    const m = i * 16;
    // The matrix is a turn about the vertical scaled by the tree's width and
    // height, placed from the tile's corner.
    addCross(out, shape, mats[m + 12], mats[m + 13], mats[m + 14], Math.hypot(mats[m], mats[m + 2]), mats[m + 5],
      Math.atan2(-mats[m + 2], mats[m]), cols[i * 3], cols[i * 3 + 1], cols[i * 3 + 2], suns[i]);
  }
  return { pos: new Float32Array(out.pos), nrm: new Int8Array(out.nrm), col: new Float32Array(out.col), sun: new Float32Array(out.sun) };
}

export const FOREST_TILE = 160;
const SPACING = 5.0;
const SUNGRID = 5;

// The corridor box a forest tile needs.
export function forestBox(ix, iz) {
  return [ix * FOREST_TILE, iz * FOREST_TILE, FOREST_TILE, 16];
}

// A forest tile: a tree on a jittered 5 m grid wherever the stand's density
// says so, of the kind its worlds grow. Returns { bins, ymin, ymax, count },
// a bin per kind of FLORA with n trees: mats (16 n, column-major instance
// matrices placed from the tile's corner), suns (n) and cols (3 n, linear).
export function* plantTrees(env, ix, iz, ctx, sun, seed) {
  const TILE = FOREST_TILE;
  const x0 = ix * TILE;
  const z0 = iz * TILE;
  const { land, corridor, veg } = env;
  const out = {};
  // Sun on a coarse grid at crown height, interpolated per tree.
  const sunAt = new Float32Array(SUNGRID * SUNGRID);
  for (let j = 0; j < SUNGRID; j++) {
    for (let i = 0; i < SUNGRID; i++) {
      const sx = x0 + (i / (SUNGRID - 1)) * TILE;
      const sz = z0 + (j / (SUNGRID - 1)) * TILE;
      sunAt[j * SUNGRID + i] = sunVisibility(land, sx, sz, land.heightAtCoarse(sx, sz) + 9, sun);
    }
  }
  const N = Math.round(TILE / SPACING);
  const sizes = FLORA.map((k) => TREE_SIZE[k]);
  const per = FLORA.map(() => ({ mats: [], suns: [], cols: [] }));
  let ymin = Infinity;
  let ymax = -Infinity;
  for (let gj = 0; gj < N; gj++) {
    for (let gi = 0; gi < N; gi++) {
      const ci = ix * N + gi;
      const cj = iz * N + gj;
      const ax = x0 + (gi + 0.1 + 0.8 * hash2(ci, cj, seed)) * SPACING;
      const az = z0 + (gj + 0.1 + 0.8 * hash2(ci, cj, seed + 1)) * SPACING;
      const nat = land.heightAt(ax, az);
      const hx = land.heightAt(ax + 2, az) - nat;
      const hz = land.heightAt(ax, az + 2) - nat;
      const slope = 1 - 1 / Math.sqrt(1 + (hx * hx + hz * hz) / 4);
      corridor.shape(ctx, ax, az, nat, out);
      const d = veg.density(ax, az, out.h, slope, out.near, out.cut, out.fill);
      if (hash2(ci, cj, seed + 2) >= d) continue;
      const sp = veg.species ? veg.species(ax, az, hash2(ci, cj, seed + 8), out.h) : 0;
      const size = sizes[sp];
      const bin = per[sp];
      const height = size.height(hash2(ci, cj, seed + 3), d);
      const width = size.width(height, hash2(ci, cj, seed + 4));
      // A turn about the vertical, the crown scaled: as THREE's
      // Matrix4.compose(position, quaternion about y, scale) writes it.
      const half = hash2(ci, cj, seed + 5) * Math.PI;
      const s = Math.sin(half);
      const c = Math.cos(half);
      const cos = 1 - 2 * s * s;
      const sin = 2 * s * c;
      bin.mats.push(
        cos * width, 0, -sin * width, 0,
        0, height, 0, 0,
        sin * width, 0, cos * width, 0,
        ax - x0, out.h - 0.5, az - z0, 1,
      );
      const fx = ((ax - x0) / TILE) * (SUNGRID - 1);
      const fz = ((az - z0) / TILE) * (SUNGRID - 1);
      const i0 = Math.min(SUNGRID - 2, Math.floor(fx));
      const j0 = Math.min(SUNGRID - 2, Math.floor(fz));
      const tx = fx - i0;
      const tz = fz - j0;
      const a = sunAt[j0 * SUNGRID + i0] * (1 - tx) + sunAt[j0 * SUNGRID + i0 + 1] * tx;
      const b = sunAt[(j0 + 1) * SUNGRID + i0] * (1 - tx) + sunAt[(j0 + 1) * SUNGRID + i0 + 1] * tx;
      bin.suns.push(a * (1 - tz) + b * tz);
      // Per-tree tint: a few blue-green, a few olive, the odd yellowing one.
      const hue = hash2(ci, cj, seed + 6);
      const v = 0.72 + 0.34 * hash2(ci, cj, seed + 7);
      bin.cols.push(v * (0.92 + 0.16 * hue), v, v * (1.06 - 0.16 * hue));
      ymin = Math.min(ymin, out.h - 1);
      ymax = Math.max(ymax, out.h + height);
    }
    if ((gj & 7) === 7) yield;
  }
  let count = 0;
  const bins = per.map((p, k) => {
    count += p.suns.length;
    const bin = { n: p.suns.length, mats: new Float32Array(p.mats), suns: new Float32Array(p.suns), cols: new Float32Array(p.cols), far: null };
    bin.far = farOf(FLORA[k], bin);
    return bin;
  });
  return { bins, ymin, ymax, count };
}
