// What the near land hides is hidden, and stays hidden while the lens goes on.
//
// render/horizon.js says a tile, or a cell of one, is out of sight when the
// land nearer the lens stands in the way of every ray to it, and says it for
// the lens as it may be some frames later too: moved by up to MOVE_H along the
// ground and MOVE_V up or down, and turned so that the picture takes in
// azimuths TURN either side of those it was found for (Horizon.holds). This
// holds it to that: on made-up land (hills, hollows and bumps, at three
// heights), tiles as the quadtree picks them (render/terrain.js: 128 m to
// 4 km, 64 x 64 vertices, triangles as the index there lays them), and lenses
// at random places, it builds the skyline of the land's cells and asks of
// every tile and every cell of it whether it is hidden. Each one that is is
// then tried the hard way: rays to a couple of dozen points of the land in it
// and of the air over it (up to the height it was told of; a third of them the
// point of the square nearest the lens, at that height, the hardest to hide),
// from the lens and from
// places up to MOVE_H and MOVE_V off (the corners of that range, and some
// inside it), marched over the triangles of the nearer land step by step; every
// ray that is in the picture, as it may have turned, must go under the land
// before it gets to the tile. One that does not is a leak. Also failed: a run
// in which little is hidden (the check would be vacuous).
//
// Usage: node tools/horizon_check.mjs [lenses per land] [--exact]
// --exact finds the skyline for the lens where it is only, and tries the rays
// from the places it may move to all the same: it fails, which is the check
// having the bite it should.

import { Horizon, viewSpan, coarser, COARSE_LEVEL, MOVE_H, MOVE_V, TURN } from '../src/render/horizon.js';

const LENSES = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a))) || 16;
const EXACT = process.argv.includes('--exact');
const LEVELS = [128, 256, 512, 1024, 2048, 4096];
const RES = 64;
const CELLS = 8;
const TAU = Math.PI * 2;

let seed = 12345;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

// The land, scaled by amp.
const land = (amp) => (x, z) => amp * (40 * Math.sin(x / 310 + 0.7) * Math.cos(z / 270) + 26 * Math.sin(x / 95 + z / 140)
  + 11 * Math.sin(x / 41) * Math.sin(z / 37 + 1) + 60 * Math.sin(x / 1300 + 1) * Math.sin(z / 1100)
  + 120 * Math.max(0, Math.sin(x / 900 + z / 1500 + 2)) ** 3);

function tileOf(height, level, ix, iz) {
  const size = LEVELS[level];
  const step = size / RES;
  const x0 = ix * size;
  const z0 = iz * size;
  const N = RES + 1;
  const h = new Float32Array(N * N);
  let top = -1e9;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const v = Math.fround(height(x0 + i * step, z0 + j * step));
      h[j * N + i] = v;
      if (v > top) top = v;
    }
  }
  const mins = new Float32Array(CELLS * CELLS).fill(1e9);
  const maxs = new Float32Array(CELLS * CELLS).fill(-1e9);
  const per = RES / CELLS;
  for (let cj = 0; cj < CELLS; cj++) {
    for (let ci = 0; ci < CELLS; ci++) {
      for (let j = cj * per; j <= (cj + 1) * per; j++) {
        for (let i = ci * per; i <= (ci + 1) * per; i++) {
          const v = h[j * N + i];
          if (v < mins[cj * CELLS + ci]) mins[cj * CELLS + ci] = v;
          if (v > maxs[cj * CELLS + ci]) maxs[cj * CELLS + ci] = v;
        }
      }
    }
  }
  return { level, ix, iz, size, step, x0, z0, h, top, mins, maxs };
}

// The tiles the quadtree draws for a lens at (cx, cz).
function select(cx, cz) {
  const out = [];
  const visit = (level, ix, iz) => {
    const s = LEVELS[level];
    const d = Math.hypot(Math.max(ix * s - cx, 0, cx - (ix + 1) * s), Math.max(iz * s - cz, 0, cz - (iz + 1) * s));
    if (level > 0 && d < s * 1.15) {
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) visit(level - 1, ix * 2 + i, iz * 2 + j);
    } else if (d < 6500) out.push([level, ix, iz]);
  };
  const top = LEVELS.length - 1;
  const rx = Math.floor(cx / LEVELS[top]);
  const rz = Math.floor(cz / LEVELS[top]);
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) visit(top, rx + i, rz + j);
  return out;
}

// The land's surface as the triangles of the tiles give it (the grid's
// squares are cut along their other diagonal, from a+1 to a+N).
function surfaceOf(tiles) {
  const by = new Map(tiles.map((t) => [t.level + ':' + t.ix + ':' + t.iz, t]));
  const N = RES + 1;
  return (x, z) => {
    for (let level = 0; level < LEVELS.length; level++) {
      const s = LEVELS[level];
      const t = by.get(level + ':' + Math.floor(x / s) + ':' + Math.floor(z / s));
      if (!t) continue;
      const fx = (x - t.x0) / t.step;
      const fz = (z - t.z0) / t.step;
      const i = Math.min(RES - 1, Math.floor(fx));
      const j = Math.min(RES - 1, Math.floor(fz));
      const u = fx - i;
      const v = fz - j;
      const h00 = t.h[j * N + i];
      const h10 = t.h[j * N + i + 1];
      const h01 = t.h[(j + 1) * N + i];
      const h11 = t.h[(j + 1) * N + i + 1];
      return u + v <= 1 ? h00 + u * (h10 - h00) + v * (h01 - h00) : h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
    }
    return -1e9;
  };
}

// Whether the ray from the lens to q goes under the land before it comes to the box.
function blocked(surface, c, q, box) {
  const dx = q[0] - c.x;
  const dz = q[2] - c.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return false;
  const ux = dx / len;
  const uz = dz / len;
  const tx0 = (box[0] - c.x) / (ux || 1e-12);
  const tx1 = (box[2] - c.x) / (ux || 1e-12);
  const tz0 = (box[1] - c.z) / (uz || 1e-12);
  const tz1 = (box[3] - c.z) / (uz || 1e-12);
  const stop = Math.min(len, Math.max(Math.min(tx0, tx1), Math.min(tz0, tz1), 0));
  const slope = (q[1] - c.y) / len;
  for (let t = 0.5; t <= stop; t += Math.max(0.5, t * 0.006)) {
    if (surface(c.x + ux * t, c.z + uz * t) > c.y + slope * t + 1e-4) return true;
  }
  return false;
}

// An angle brought into (-PI, PI].
const wrap = (a) => {
  a %= TAU;
  return a > Math.PI ? a - TAU : a <= -Math.PI ? a + TAU : a;
};

// The places the lens may be when what was found for it is used: where it was,
// the corners of the range it may go (eight ways round, up and down), and some
// places inside it.
function posesOf() {
  const out = [{ dx: 0, dy: 0, dz: 0 }];
  for (let k = 0; k < 8; k++) {
    for (const dy of [-MOVE_V, MOVE_V]) out.push({ dx: Math.cos((k * Math.PI) / 4) * MOVE_H, dy, dz: Math.sin((k * Math.PI) / 4) * MOVE_H });
  }
  for (let k = 0; k < 6; k++) {
    const a = rnd() * TAU;
    const r = Math.sqrt(rnd()) * MOVE_H;
    out.push({ dx: Math.cos(a) * r, dy: (rnd() * 2 - 1) * MOVE_V, dz: Math.sin(a) * r });
  }
  return out;
}

const hz = EXACT ? new Horizon({ h: 0, v: 0, turn: 0 }) : new Horizon();
let leaks = 0;
let rays = 0;
let hid = 0;
let held = 0;
for (const amp of [1, 0.4, 2.2]) {
  const height = land(amp);
  for (let n = 0; n < LENSES; n++) {
    const cx = (rnd() - 0.5) * 6000;
    const cz = (rnd() - 0.5) * 6000;
    const tiles = select(cx, cz).map(([l, i, j]) => tileOf(height, l, i, j));
    const surface = surfaceOf(tiles);
    const c = { x: cx, y: height(cx, cz) + 3 + rnd() * 2, z: cz };
    // A lens that looks along (cos yaw, sin pitch, sin yaw).
    const yaw = rnd() * Math.PI * 2;
    const pitch = (rnd() - 0.5) * 0.3;
    const f = [Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)];
    const rl = Math.hypot(f[2], f[0]);
    const r = [-f[2] / rl, 0, f[0] / rl];
    const up = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const e = new Array(16).fill(0);
    [e[0], e[1], e[2]] = r;
    [e[4], e[5], e[6]] = up;
    [e[8], e[9], e[10]] = [-f[0], -f[1], -f[2]];
    const [lo, span] = viewSpan({ matrixWorld: { elements: e }, fov: 56 + rnd() * 10, aspect: 1280 / 577 });
    hz.begin(c.x, c.y, c.z, lo, span);
    if (!hz.ok) continue;
    // What holds() takes as the same picture, and as not: at the ends of what it takes.
    if (!EXACT) {
      const at = (dx, dy, dz, a, b) => hz.holds(c.x + dx, c.y + dy, c.z + dz, lo + a, span + b - a);
      const ok = at(MOVE_H * 0.99, 0, 0, -TURN * 0.99, TURN * 0.99) && at(0, MOVE_V * 0.99, 0, TURN * 0.99, TURN * 0.99)
        && at(0, -MOVE_V * 0.99, MOVE_H * 0.7, -TURN * 0.99, -TURN * 0.99);
      const no = at(MOVE_H * 1.01, 0, 0, 0, 0) || at(0, MOVE_V * 1.01, 0, 0, 0) || at(0, 0, 0, -TURN * 1.01, 0) || at(0, 0, 0, 0, TURN * 1.01);
      if (!ok || no) {
        console.log(`holds() is wrong: takes the range as ${ok ? 'right' : 'too narrow'}, and a lens or a picture past it as ${no ? 'the same' : 'not'}`);
        process.exit(1);
      }
      held++;
    }
    const poses = posesOf();
    for (const t of tiles) {
      if (t.level > 2) continue;
      if (t.level === COARSE_LEVEL) hz.blockTile(t.x0, t.z0, t.size, coarser(t.mins), CELLS / 2);
      else hz.blockTile(t.x0, t.z0, t.size, t.mins, CELLS);
    }
    hz.seal();
    for (const t of tiles) {
      const per = t.size / CELLS;
      const claims = [];
      if (hz.hidden(t.x0, t.z0, t.x0 + t.size, t.z0 + t.size, t.top)) {
        claims.push([[t.x0, t.z0, t.x0 + t.size, t.z0 + t.size], t.top]);
      } else {
        for (let cj = 0; cj < CELLS; cj++) {
          for (let ci = 0; ci < CELLS; ci++) {
            const b = [t.x0 + ci * per, t.z0 + cj * per, t.x0 + (ci + 1) * per, t.z0 + (cj + 1) * per];
            if (hz.hidden(b[0], b[1], b[2], b[3], t.maxs[cj * CELLS + ci])) claims.push([b, t.maxs[cj * CELLS + ci]]);
          }
        }
      }
      for (const [b, top] of claims) {
        for (let k = 0; k < 24; k++) {
          // From the lens where it was a quarter of the time, else from a place it may have gone to.
          const pose = k % 4 === 0 ? poses[0] : poses[1 + Math.floor(rnd() * (poses.length - 1))];
          const c1 = { x: c.x + pose.dx, y: c.y + pose.dy, z: c.z + pose.dz };
          // Eight in a claim's twenty-four are the hardest to hide: the point of its square nearest the lens
          // that is, at the greatest height it was told of.
          const hard = k >= 16;
          const qx = hard ? Math.min(Math.max(c1.x, b[0]), b[2]) : b[0] + rnd() * (b[2] - b[0]);
          const qz = hard ? Math.min(Math.max(c1.z, b[1]), b[3]) : b[1] + rnd() * (b[3] - b[1]);
          // Out of the picture, as it may have turned, there is nothing to hide.
          const rel = wrap(Math.atan2(qz - c1.z, qx - c1.x) - hz.vlo);
          if (rel < -TURN || rel > hz.vspan + TURN) continue;
          const g = surface(qx, qz);
          const q = [qx, hard ? top : k % 3 === 0 ? g : g + rnd() * Math.max(0, top - g), qz];
          rays++;
          if (!blocked(surface, c1, q, b)) {
            leaks++;
            if (leaks <= 5) console.log(`LEAK lens (${c.x.toFixed(0)}, ${c.y.toFixed(1)}, ${c.z.toFixed(0)}) moved (${pose.dx.toFixed(1)}, ${pose.dy.toFixed(1)}, ${pose.dz.toFixed(1)}), tile ${t.level}:${t.ix}:${t.iz} box ${b.map((v) => v.toFixed(0))}, top ${top.toFixed(1)}, point ${q.map((v) => v.toFixed(1))}`);
            break;
          }
        }
      }
      hid += claims.length;
    }
  }
}
const vacuous = rays < 50000;
console.log(`${rays} rays tried over ${hid} hidden tiles and cells${EXACT ? ' (found for the lens where it is only)' : ''}, ${leaks} leaks${vacuous ? ', too few rays: nothing was hidden' : ''}`);
process.exit(leaks || vacuous ? 1 : 0);
