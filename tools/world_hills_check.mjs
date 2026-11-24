// What the hills have of their own is there, where it should be, and costs what it should: the fields, the hedges on
// their banks, the stacks of straw, the dry-stone walls, the line of poles with its wires, and the farm tracks.
//
// In node first (no browser), on the real land and the real road (seeds 7, 42 and 3, the hills' place of tools/look.mjs,
// 5 km along the road, 1 km either way of it):
//  - the fields (world/fields.js): the same point is in the same field each time; a field is 120 to 200 m across; at least
//    four crops lie in the 2 km of land by the road where fields are laid (six or seven are); two points a metre apart are in
//    the same field unless one is within a metre of a border; the nearest border is a bank 1.5 m across; one in ten
//    of the fields that would be wheat is stubble;
//  - the hedges lie along the banks that have one, and the trees' density (world/vegetation.js) is a hedge's on them; the stacks of
//    straw stand in stubble fields only, six to fourteen to a field, in rows, in from its edges, each a stack 1.3 m across;
//  - the walls (world/hillsplan.js): each piece is 6 m long, 1.5 to 2.5 m outside the verge, on the ground, not on the
//    road, level along itself and not on the face of a cut; they are on one side of the road for a run and then not, and about
//    two in five of the length that can have one has one;
//  - the poles: 35 to 50 in the 2 km, 43 to 47 m apart along a side, a span that crosses the road a little longer, none on a bridge, in
//    a tunnel or in or by a bend tighter than 60 m; each wire hangs 0.6 m in a span of 45 m;
//  - the farm tracks leave the verge, 80 to 200 m long (a track the ground cuts short is not under 50 m), over level ground clear of
//    trees, one in a kilometre or so;
//  - what is laid is the same each time it is asked for, in node as in the page;
//  - the render code (render/hills.js with its walls and poles): all of it at the high tier, half the range at the mid one, none at the
//    low one; the triangles and the draws it adds; a car that is driven at a wall at 10 m/s, from the road and from the field, stops
//    in front of it (the real Game.stepPhysics, the real car and the real road); dispose() lets go of what it made.
//
// Then in the page (the hills, seed 7; --node leaves it out): the land's shader and the road's verge compile at every program (the real
// style's and the painted one's, wound and not, the grass's ground map) and the fields are the same in GLSL and in JS on 4096 points
// (which field, which across the nearest border, how far from it); what the hills add to a frame is at most 8 draws and 60 thousand
// triangles; and every style draws it without an error.
//
// Usage: node tools/world_hills_check.mjs [--node]
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { register } from 'node:module';

const ROOT = new URL('..', import.meta.url).pathname;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { if (s === 'three') return { url: ${JSON.stringify('file://' + ROOT + 'tools/vendor/three.module.js')}, shortCircuit: true }; if (s.startsWith('three/addons/')) return { url: ${JSON.stringify('file://' + ROOT + 'tools/vendor/')} + s.slice('three/addons/'.length), shortCircuit: true }; return n(s, c); }`));
const THREE = await import('three');
const { makeWorldLand, WORLD_INDEX } = await import('../src/world/worlds.js');
const { Road, HALF_FLAT, GROUND } = await import('../src/world/road.js');
const { Corridor } = await import('../src/world/corridor.js');
const { makeVegetation } = await import('../src/world/vegetation.js');
const { FIELD, CROPS, CROP, fieldAt, fieldMask, fieldPoint, hedgeAt, hedged, stacksOf, rowAt } = await import('../src/world/fields.js');
const { HillsPlan, WALL, POLE, TRACK, hang } = await import('../src/world/hillsplan.js');
const { Hills } = await import('../src/render/hills.js');
const { Clutter } = await import('../src/render/clutter.js');
const { Car } = await import('../src/core/car.js');
const { Game } = await import('../src/game.js');

let failed = 0;
const say = (ok, text) => {
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};
const f = (x, k = 2) => (typeof x === 'number' ? x.toFixed(k) : String(x));
const span = (a, k = 1) => (a.length ? `${f(Math.min(...a), k)}..${f(Math.max(...a), k)}` : 'none');
const HILLS = WORLD_INDEX.hills;

// --- the fields -------------------------------------------------------------------------

{
  const o = {};
  const p = {};
  const rand = (() => { let a = 99; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();
  let same = true;
  const count = new Array(CROPS.length).fill(0);
  let close = 0;
  let closeBad = 0;
  let bankLo = 1e9;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const x = (rand() - 0.5) * 4e5;
    const z = (rand() - 0.5) * 4e5;
    fieldAt(x, z, o);
    fieldAt(x, z, p);
    if (o.ix !== p.ix || o.iz !== p.iz || o.crop !== p.crop || o.edge !== p.edge) same = false;
    count[o.crop]++;
    bankLo = Math.min(bankLo, o.edge);
    // A metre off: the same field, or a border within that metre.
    fieldAt(x + 1, z, p);
    close++;
    if ((p.ix !== o.ix || p.iz !== o.iz) && o.edge > 1.0001) closeBad++;
  }
  say(same, 'the same point is in the same field each time it is asked for');
  say(closeBad === 0, `two points a metre apart are in the same field unless a border is within that metre (${close} pairs, ${closeBad} that are not)`);
  const cells = new Set();
  for (let x = 0; x < 3000; x += 10) for (let z = 0; z < 3000; z += 10) { fieldAt(x, z, o); cells.add(o.ix * 100003 + o.iz); }
  const side = Math.sqrt(9e6 / cells.size);
  say(side >= 120 && side <= 200 && FIELD.cell === 150, `a field is ${f(side, 0)} m across on average (the area is that of a square ${f(side, 0)} m on a side; 120 to 200)`);
  const share = count.map((c) => c / N);
  const wheat = share[CROP.wheat] + share[CROP.stubble];
  say(share.every((s, i) => Math.abs(s - CROPS[i].share) < 0.02) && Math.abs(share[CROP.stubble] / wheat - 0.1) < 0.02,
    `the crops are as common as they are said to be (${CROPS.map((c, i) => `${c.id} ${f(share[i], 3)}`).join(', ')}), one in ten of the wheat fields is stubble (${f(share[CROP.stubble] / wheat, 3)})`);
  say(FIELD.ridge === 1.5 && FIELD.furrow === 7 && bankLo >= 0, `a bank is ${FIELD.ridge} m across; the furrows of ploughed ground are ${FIELD.furrow} m apart`);
}

// The hedges on the banks, the stacks of straw.
{
  const o = {};
  const rand = (() => { let a = 7; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();
  let onBank = 0;
  let offBank = 0;
  let hedgedBanks = 0;
  let banks = 0;
  for (let i = 0; i < 20000; i++) {
    const x = rand() * 20000;
    const z = rand() * 20000;
    const h = hedgeAt(x, z, o);
    fieldAt(x, z, o);
    if (h > 0.5 && o.edge < 2.4 && hedged(o.ix, o.iz, o.jx, o.jz)) onBank++;
    else if (h > 0.5) offBank++;
    if (o.edge < 0.5) {
      banks++;
      if (hedged(o.ix, o.iz, o.jx, o.jz)) hedgedBanks++;
      if (hedged(o.ix, o.iz, o.jx, o.jz) !== hedged(o.jx, o.jz, o.ix, o.iz)) offBank += 1e6;
    }
  }
  say(onBank > 100 && offBank === 0, `a hedge is on a bank that has one and within ${f(2.4, 1)} m of its middle (${onBank} places, ${offBank} that are not)`);
  say(banks > 200 && Math.abs(hedgedBanks / banks - 0.55) < 0.1, `${f(hedgedBanks / banks * 100, 0)}% of the banks have a hedge (a bank is the same bank from either field)`);
  // Trees' density: a hedge in the vegetation's own numbers, none a bank over.
  const land = makeWorldLand(7, { start: 'hills' });
  const veg = makeVegetation(land, 7);
  let best = null;
  for (let i = 0; i < 4000 && !best; i++) {
    const x = rand() * 20000;
    const z = rand() * 20000;
    fieldAt(x, z, o);
    if (o.edge < 0.3 && hedged(o.ix, o.iz, o.jx, o.jz)) best = [x, z];
  }
  const dens = (x, z) => veg.density(x, z, 60, 0.005, 40, 0, 0);
  say(best && dens(best[0], best[1]) >= 0.74, `the trees' density on a bank that has a hedge is that of one (${f(best ? dens(best[0], best[1]) : 0, 2)})`);
}

{
  let rowsOk = true;
  let inOk = true;
  let counts = [];
  let found = 0;
  const o = {};
  for (let i = -40; i < 40 && found < 60; i++) {
    for (let j = -40; j < 40 && found < 60; j++) {
      const list = stacksOf(i, j);
      const stubble = (fieldAt(...fieldPoint(i, j), o), o.ix === i && o.iz === j && o.crop === CROP.stubble);
      if (!stubble) {
        if (list.length) inOk = false;
        continue;
      }
      found++;
      counts.push(list.length);
      const a = rowAt(i, j);
      const [px, pz] = fieldPoint(i, j);
      const across = (s) => -Math.sin(a) * (s.x - px) + Math.cos(a) * (s.z - pz);
      for (const s of list) {
        fieldAt(s.x, s.z, o);
        if (o.ix !== i || o.iz !== j || o.edge < FIELD.stack.edge - 1e-6) inOk = false;
        const r = across(s) / FIELD.stack.rows;
        if (Math.abs(r - Math.round(r)) * FIELD.stack.rows > 0.8) rowsOk = false;
      }
    }
  }
  say(found > 5 && Math.min(...counts) >= 6 && Math.max(...counts) <= 14, `${found} stubble fields have ${span(counts, 0)} stacks of straw each (6 to 14)`);
  say(inOk && rowsOk, `a stack is in its own field, at least ${FIELD.stack.edge} m from its edge, and none is in a field of another crop; the stacks of a field lie in rows ${FIELD.stack.rows} m apart`);
  // A stack of straw, built as the clutter has it: 1.3 m across.
  const scene = new THREE.Scene();
  const env = { road: { origin: { x: 0, z: 0 } }, seed: 1, worlds: null, sCar: () => 0, heightAt: () => 0, waterAt: () => -1e9 };
  const c = new Clutter(scene, env);
  const geo = c._mesh('haystack').geometry;
  geo.computeBoundingBox();
  const w = geo.boundingBox.max.x - geo.boundingBox.min.x;
  const tris = geo.attributes.position.count / 3;
  say(Math.abs(w - 1.3) < 0.06 && tris < 80, `a stack of straw is ${f(w)} m across and ${tris} triangles`);
  c.setBlocky(true);
  const box = c._mesh('haystack').geometry;
  say(box.attributes.position.count / 3 === 24, `and in the block style it is two boxes (${box.attributes.position.count / 3} triangles)`);
  for (const m of c.meshes.values()) { scene.remove(m); m.geometry.dispose(); m.dispose(); }
}

// --- the plan, on the real road -----------------------------------------------------------

function worldOf(seed) {
  const land = makeWorldLand(seed, { start: 'hills' });
  const road = new Road(land, seed);
  const corridor = new Corridor(road, land);
  const veg = makeVegetation(land, seed);
  const plan = new HillsPlan({ land, road, corridor, worlds: land.worlds, seed, wood: (ax, az, h, slope) => veg.density(ax, az, h, slope, 30, 0, 0) });
  for (let s = 200; s <= 5000; s += 200) road.update(s);
  return { land, road, corridor, veg, plan, seed };
}

// The stacks of straw and what the fields keep off, as the clutter lays them (render/clutter.js), on the real land.
function clutterPart() {
  const w = worldOf(7);
  const { land, road, corridor, veg } = w;
  const o = road.origin;
  const fake = { land, road, vegetation: veg, sCar: 5000 };
  const farmland = (ax, az) => Game.prototype.farmland.call(fake, ax, az);
  const scene = new THREE.Scene();
  const make = (tier) => new Clutter(scene, {
    road, seed: 7, worlds: land.worlds, sCar: () => 5000, heightAt: (ax, az) => corridor.heightAt(ax, az), naturalAt: (ax, az) => land.heightAt(ax, az),
    waterAt: () => -1e9, solidAt: () => false, farmland, tier,
  });
  // A stubble field by the road, in the hills, with its stacks on land that is a field's.
  const p = road.at(5000);
  const f = {};
  let field = null;
  for (let r = -1500; r <= 1500 && !field; r += 150) {
    for (let d = 40; d <= 1200 && !field; d += 60) {
      for (const side of [-1, 1]) {
        const q = road.at(5000 + r);
        if (!q) continue;
        const ax = q.x + o.x - Math.sin(q.theta) * d * side;
        const az = q.z + o.z + Math.cos(q.theta) * d * side;
        fieldAt(ax, az, f);
        if (f.crop === CROP.stubble && stacksOf(f.ix, f.iz).filter((s) => farmland(s.x, s.z) >= 0.5).length >= 5) { field = { ix: f.ix, iz: f.iz }; break; }
      }
    }
  }
  if (!field) {
    say(false, 'the clutter: no stubble field with its stacks on land of a field by the road');
    return;
  }
  const want = stacksOf(field.ix, field.iz).filter((s) => farmland(s.x, s.z) >= 0.5);
  const lay = (clutter) => {
    let n = 0;
    const kinds = {};
    const [px, pz] = fieldPoint(field.ix, field.iz);
    for (let cx = Math.floor((px - 100) / 10); cx <= Math.floor((px + 100) / 10); cx++) {
      for (let cz = Math.floor((pz - 100) / 10); cz <= Math.floor((pz + 100) / 10); cz++) {
        const items = clutter._lay(cx, cz);
        for (const it of items) {
          kinds[it.kind] = (kinds[it.kind] || 0) + 1;
          if (it.kind === 'haystack') n++;
        }
      }
    }
    return { n, kinds };
  };
  const high = lay(make('high'));
  say(high.n === want.length && want.length >= 5, `the stubble field at ${Math.round(fieldPoint(field.ix, field.iz)[0])}, ${Math.round(fieldPoint(field.ix, field.iz)[1])} has its ${want.length} stacks of straw laid by the clutter (${high.n})`);
  const mid = lay(make('mid'));
  const low = lay(make('low'));
  say(mid.n < high.n && mid.n >= 0 && low.n === 0, `at the mid tier ${mid.n} of them, at the low tier none`);
  // No stone, bush, log or toadstool in a field: out of every cell of the 200 m about a field's point, none stands where the
  // land's shader has a field (more than half).
  const clutter = make('high');
  let inField = 0;
  let seen = 0;
  const [px, pz] = fieldPoint(field.ix, field.iz);
  for (let cx = Math.floor((px - 200) / 10); cx <= Math.floor((px + 200) / 10); cx++) {
    for (let cz = Math.floor((pz - 200) / 10); cz <= Math.floor((pz + 200) / 10); cz++) {
      for (const it of clutter._lay(cx, cz)) {
        if (['rock', 'bush', 'log', 'mushroom'].includes(it.kind)) {
          seen++;
          if (farmland(it.x, it.z) > 0.5) inField++;
        }
      }
    }
  }
  say(seen > 0 && inField === 0, `${seen} stones, bushes, logs and toadstools lie in the 400 m about it, none in a field (${inField})`);
}

function nodePart() {
  for (const seed of [7, 42, 3]) {
    const w = worldOf(seed);
    const again = worldOf(seed);
    const { land, road, corridor, veg, plan } = w;
    const o = road.origin;
    const name = `seed ${seed}`;
    const lateral = (s, ax, az) => road.lateralOf(s, ax - o.x, az - o.z);
    // The crops in the 2 km: the land by the road, up to 200 m out, where a field is laid (the same mask as the land's shader).
    {
      const kinds = new Set();
      const o2 = {};
      let laid = 0;
      for (let s = 4000; s <= 6000; s += 20) {
        const p = road.at(s);
        for (const side of [-1, 1]) {
          for (const d of [30, 60, 100, 150, 200]) {
            const ax = p.x + o.x - Math.sin(p.theta) * d * side;
            const az = p.z + o.z + Math.cos(p.theta) * d * side;
            const gx = (land.heightAt(ax + 2, az) - land.heightAt(ax - 2, az)) / 4;
            const gz = (land.heightAt(ax, az + 2) - land.heightAt(ax, az - 2)) / 4;
            const slope = 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz);
            const wood = veg.density(ax, az, land.heightAt(ax, az), slope, d, 0, 0);
            if (fieldMask(slope, Math.min(d, 44), wood) > 0.5) {
              laid++;
              kinds.add(CROPS[fieldAt(ax, az, o2).crop].id);
            }
          }
        }
      }
      say(kinds.size >= 4, `${name}: ${kinds.size} crops (${[...kinds].join(', ')}) in the 2 km of land by the road where a field is laid (${laid} places looked at; at least 4)`);
    }
    // The walls in the 2 km of road about 5000 m.
    const pieces = [];
    for (let k = Math.floor(4000 / WALL.chunk); k < Math.floor(6000 / WALL.chunk); k++) {
      const list = plan.walls(k);
      for (const p of list) pieces.push(p);
      const twice = again.plan.walls(k);
      if (JSON.stringify(list) !== JSON.stringify(twice)) say(false, `${name}: the walls of the chunk ${k} are the same each time`);
    }
    say(pieces.length >= 30, `${name}: ${pieces.length} pieces of wall in the 2 km, ${f(pieces.length * WALL.unit / 20, 0)}% of the length`);
    const offs = pieces.map((p) => Math.abs(lateral(p.s, p.ax, p.az)) - HALF_FLAT);
    say(offs.every((d) => d >= 1.5 && d <= 2.5), `${name}: each piece is 1.5 to 2.5 m outside the verge (${span(offs)} m), none on the road`);
    const chords = pieces.map((p) => Math.hypot(p.x1 - p.x0, p.z1 - p.z0));
    // (A piece is six metres of the road's middle; along the line two metres outside the verge it is a little more or less in a bend, and
    // is laid as long as the ground it is on.)
    say(chords.every((c) => Math.abs(c - WALL.unit) < 0.9), `${name}: each is ${WALL.unit} m long as the road runs, a little over or under on a bend (${span(chords)} m)`);
    const onGround = pieces.every((p) => road.at(p.s).kind === GROUND);
    const rises = pieces.map((p) => Math.abs(p.y1 - p.y0) / WALL.unit);
    say(onGround && Math.max(...rises) <= WALL.grade + 1e-9, `${name}: all on road that is on the ground, none steeper than ${WALL.grade} along itself (${f(Math.max(...rises), 3)})`);
    // Which side: one for a run.
    const runs = new Map();
    for (const p of pieces) {
      const r = Math.floor(p.s / WALL.run);
      if (!runs.has(r)) runs.set(r, new Set());
      runs.get(r).add(p.side);
    }
    say([...runs.values()].every((s) => s.size === 1), `${name}: a run of ${WALL.run} m has its wall on one side of the road`);
    // How much of the road has a wall: the share of the runs that draw one, and how much of each they cover.
    let covered = 0;
    let drawn = 0;
    const RUNS = 4000;
    for (let r = 0; r < RUNS; r++) {
      const q = plan.wallRun(r);
      if (q) {
        drawn++;
        covered += (q.to - q.from) / WALL.run;
      }
    }
    say(Math.abs(covered / RUNS - 0.4) < 0.04, `${name}: ${f(drawn * 100 / RUNS, 0)}% of the runs have a wall, and a wall covers ${f(covered * 100 / RUNS, 0)}% of the road's length where the ground can have one (two in five)`);
    say(pieces.length * WALL.unit / 2000 >= 0.15 && pieces.length * WALL.unit / 2000 <= 0.6, `${name}: in these 2 km ${f(pieces.length * WALL.unit / 20, 0)}% of the length has a piece of wall (the ground by the road is not always level, and a run is 240 m)`);

    // The poles.
    const poles = [];
    for (let r = Math.floor(3900 / POLE.run); r <= Math.floor(6100 / POLE.run); r++) {
      const list = plan.poleRun(r);
      if (JSON.stringify(list) !== JSON.stringify(again.plan.poleRun(r))) say(false, `${name}: the poles of the run ${r} are the same each time`);
      for (const p of list) if (p.s >= 4000 && p.s <= 6000) poles.push(p);
    }
    poles.sort((a, b) => a.s - b.s);
    const gaps = [];
    const crossing = [];
    for (let i = 1; i < poles.length; i++) {
      if (poles[i].s - poles[i - 1].s > 80) continue;
      const d = Math.hypot(poles[i].ax - poles[i - 1].ax, poles[i].az - poles[i - 1].az);
      (poles[i].side === poles[i - 1].side ? gaps : crossing).push(d);
    }
    if (seed === 7 || seed === 42) say(poles.length >= 35 && poles.length <= 50, `${name}: ${poles.length} poles in the 2 km (35 to 50)`);
    else say(poles.length >= 30 && poles.length <= 50, `${name}: ${poles.length} poles in the 2 km (the road has bridges and bends)`);
    say(gaps.every((d) => d >= 43 && d <= 47), `${name}: neighbours on one side are ${span(gaps)} m apart (43 to 47)`);
    say(crossing.every((d) => d > 45 && d < 50), `${name}: a span that crosses the road is ${span(crossing)} m (the way across it too)`);
    const offsP = poles.map((p) => Math.abs(lateral(p.s, p.ax, p.az)));
    say(offsP.every((d) => Math.abs(d - (HALF_FLAT + POLE.off)) < 0.6), `${name}: a pole stands ${f(POLE.off, 1)} m outside the verge (${span(offsP)} m from the middle of the road)`);
    let bad = 0;
    for (const p of poles) {
      for (let d = -POLE.every; d <= POLE.every; d += 9) {
        const q = road.at(p.s + d);
        if (!q || q.kind !== GROUND || Math.abs(q.kappa) > 1 / POLE.tight + 1e-12) bad++;
      }
    }
    say(bad === 0, `${name}: none on a bridge or in a tunnel, or in or by a bend tighter than ${POLE.tight} m`);
    const sag = hang(0, 45, POLE.sag);
    say(Math.abs(sag - 0.6) < 1e-6 && Math.abs(hang(22.5, 45, POLE.sag)) < 1e-6 && hang(11, 45, POLE.sag) < sag && POLE.height === 8 && POLE.every === 45,
      `${name}: the poles are ${POLE.height} m, ${POLE.every} m apart, and a wire hangs ${f(sag, 3)} m in the middle of a span and none at its ends`);

    // The farm tracks.
    const tracks = [];
    for (let k = Math.floor(2400 / TRACK.every); k < Math.floor(6000 / TRACK.every); k++) {
      const t = plan.track(k);
      if (JSON.stringify(t) !== JSON.stringify(again.plan.track(k))) say(false, `${name}: the track of the cell ${k} is the same each time`);
      if (t) tracks.push(t);
    }
    say(tracks.length >= 2, `${name}: ${tracks.length} farm tracks in 3.6 km`);
    const mouth = tracks.map((t) => Math.abs(lateral(t.s, t.pts[0], t.pts[1])));
    say(mouth.every((d) => Math.abs(d - HALF_FLAT) < 0.05), `${name}: each leaves the road at its verge's outer edge (${span(mouth, 2)} m from the middle)`);
    say(tracks.every((t) => t.len >= 50 && t.len <= TRACK.length[1] + 1), `${name}: each is ${span(tracks.map((t) => t.len), 0)} m long`);
    const ground = tracks.every((t) => {
      for (let i = 0; i < t.n; i++) {
        const x = t.pts[i * 2];
        const z = t.pts[i * 2 + 1];
        const gx = (land.heightAt(x + 2, z) - land.heightAt(x - 2, z)) / 4;
        const gz = (land.heightAt(x, z + 2) - land.heightAt(x, z - 2)) / 4;
        const slope = 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz);
        if (i > 0 && (slope > TRACK.slope + 1e-9 || veg.density(x, z, land.heightAt(x, z), slope, 30, 0, 0) >= 0.1)) return false;
      }
      return true;
    });
    say(ground, `${name}: over level ground, clear of trees`);
    // prune and forget
    plan.forget(5000);
    say(![...plan.chunks.keys()].some((k) => (k + 1) * WALL.chunk > 5000) && ![...plan.runs.keys()].some((k) => (k + 1) * POLE.run > 5000), `${name}: what is worked out for the road after a place is let go of when the road is laid again`);
    void corridor;
  }
}

nodePart();
clutterPart();

// --- the render code, and a car at a wall -------------------------------------------------------

{
  const w = worldOf(7);
  const { road, plan, land } = w;
  const o = road.origin;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.3, 14000);
  const lay = (tier) => {
    const hills = new Hills(scene, { plan, road, worlds: land.worlds }, tier);
    const p = road.at(5000);
    cam.position.set(p.x - 8, p.y + 4, p.z);
    cam.updateMatrixWorld();
    hills.update(cam, 1 / 60, { sCar: 5000, blocks: 0, px: 700, settle: true });
    return hills;
  };
  const tri = (m) => (m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3);
  const trisOf = (h) => tri(h.walls.mesh) * h.walls.mesh.count + tri(h.lines.poles) * h.lines.poles.count + h.lines.wires.geometry.drawRange.count / 3;
  const hi = lay('high');
  const mid = lay('mid');
  const low = lay('low');
  const s = hi.stats();
  say(s.on && s.walls >= 20 && s.poles >= 15 && s.spans >= 10 && s.drawn === 3, `at the high tier ${s.walls} pieces of wall, ${s.poles} poles and ${s.spans} spans of wire are drawn, in 3 draws`);
  say(trisOf(hi) < 60000, `they are ${trisOf(hi)} triangles (at most 60 thousand): ${tri(hi.walls.mesh)} to a piece of wall, ${tri(hi.lines.poles)} to a pole`);
  const m = mid.stats();
  say(m.walls < s.walls * 0.75 && m.poles < s.poles * 0.75 && trisOf(mid) < trisOf(hi) * 0.6, `at the mid tier the range is half: ${m.walls} pieces, ${m.poles} poles, ${trisOf(mid)} triangles`);
  const l = low.stats();
  say(l.walls === 0 && l.poles === 0 && l.spans === 0 && l.drawn === 0 && trisOf(low) === 0, 'at the low tier none of it is drawn');
  // A line of poles: the wires' ribbons are at least a pixel and a quarter across wherever they are (the shader's width).
  const ribbon = hi.lines.wires.geometry;
  say(ribbon.attributes.aSide && ribbon.index && ribbon.drawRange.count > 0 && !(ribbon.drawRange.count % 6), 'the wires are ribbons of triangles, not line primitives');
  say(hi.lines.wires.material.userData.mark > 0.7, 'and are marked as built, as a pole is');
  // The solid things: circles along each piece of wall, one for each pole.
  const p = road.at(5000);
  const buf = [];
  hi.near(p.x + o.x, p.z + o.z, 200, buf);
  const rings = [];
  for (let i = 0; i < buf.length; i += 3) rings.push(buf[i + 2]);
  say(rings.includes(WALL.solid) && rings.includes(POLE.solid), `a car off the road is told of ${rings.filter((r) => r === WALL.solid).length} circles of wall and ${rings.filter((r) => r === POLE.solid).length} poles within 200 m`);
  const geos = [hi.walls.mesh.geometry, hi.lines.poles.geometry, hi.lines.wires.geometry];
  let freed = 0;
  for (const g of geos) g.addEventListener('dispose', () => freed++);
  const before = scene.children.length;
  for (const h of [hi, mid, low]) h.dispose();
  say(freed === 3 && scene.children.length === before - 6 + 0 || scene.children.length === 0, `dispose() takes the meshes out of the scene (${before} to ${scene.children.length}) and lets go of their geometries (${freed})`);

  // A car at a wall: the real car and the real road, Game.stepPhysics and its obstacles.
  const run = (fromField) => {
    const world = worldOf(7);
    const hills = new Hills(new THREE.Scene(), { plan: world.plan, road: world.road, worlds: world.land.worlds }, 'high');
    const g = Object.create(Game.prototype);
    const car = new Car();
    Object.assign(g, {
      road: world.road, corridor: world.corridor, land: world.land, vegetation: world.veg, hills, car, autoMode: false, sCar: 5000,
      forest: { trunksNear: (ax, az, r, out) => { out.length = 0; } }, props: { near: () => {} }, cavern: { near: () => {} }, valley: { near: () => {} }, city: { solidAt: () => false },
      haptics: { hit() {}, animal() {}, land() {} }, driver: { read: () => ({ steer: 0, throttle: 0.5, brake: 0 }) },
      collisions: { update: () => null }, traffic: { nearestAhead: () => null, clearNear() {} }, pilot: {}, presentation: {},
      upside: { roll: 0 }, _lookAt: { a: HILLS, b: HILLS, t: 0 }, simTime: 0, bumps: 0, hits: 0, lands: 0, _landFx: 0, offRoad: false, opts: {},
    });
    car.groundFn = (x, z) => g._groundFor(x, z);
    const ro = world.road.origin;
    const cm = new THREE.PerspectiveCamera(55, 16 / 9, 0.3, 14000);
    const q = world.road.at(5000);
    cm.position.set(q.x, q.y + 4, q.z);
    cm.updateMatrixWorld();
    hills.update(cm, 1 / 60, { sCar: 5000, blocks: 0, px: 700, settle: true });
    // Four pieces in a row, and the middle of them.
    const list = hills.walls.pieces;
    let pick = null;
    for (let i = 2; i + 2 < list.length && !pick; i++) {
      if ([-2, -1, 1, 2].every((d) => Math.abs(list[i + d].i - list[i].i) === Math.abs(d) && list[i + d].side === list[i].side)) pick = list[i];
    }
    if (!pick) return null;
    const pm = world.road.at(pick.s);
    const out = [-Math.sin(pm.theta) * pick.side, Math.cos(pm.theta) * pick.side];
    const mid0 = [pick.ax - ro.x, pick.az - ro.z];
    const start = fromField ? 14 : -14;
    const x0 = mid0[0] + out[0] * start;
    const z0 = mid0[1] + out[1] * start;
    const yaw = Math.atan2(out[1], out[0]) + (fromField ? Math.PI : 0);
    g.sCar = pick.s;
    car.reset(x0, z0, yaw, g._groundFor(x0, z0));
    car.vx = 10;
    let nose = -Infinity;
    let bumped = 0;
    for (let i = 0; i < 360; i++) {
      g.stepPhysics(1 / 60);
      const nx = car.x + Math.cos(car.yaw) * 2.2 - mid0[0];
      const nz = car.z + Math.sin(car.yaw) * 2.2 - mid0[1];
      const across = (nx * out[0] + nz * out[1]) * (fromField ? -1 : 1);
      nose = Math.max(nose, across);
      bumped = g.bumps;
    }
    hills.dispose();
    return { nose, speed: car.speed, bumped, kind: g._lastBump && g._lastBump.kind };
  };
  for (const fromField of [false, true]) {
    const r = run(fromField);
    // (The wall's near face is a quarter of a metre from its middle, toward the side the car comes from.)
    say(r && r.nose < WALL.thick / 2 + 0.1 && r.speed < 1 && r.bumped >= 1 && r.kind === 'wall',
      r ? `a car driven at a wall at 10 m/s from ${fromField ? 'the field' : 'the road'} stops short of it (its nose ${f(r.nose)} m from the wall's middle, ${f(r.speed)} m/s, ${r.bumped} bump, ${r.kind})` : 'a car driven at a wall: no wall of four pieces in a row');
  }
}

// --- in the page ---------------------------------------------------------------------------

if (process.argv.includes('--node')) {
  console.error(failed ? `\nFAILED: ${failed} check(s)` : '\nOK (the part in node)');
  process.exit(failed ? 1 : 0);
}

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8192;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  return spawn('node', [ROOT + 'tools/serve.mjs', String(PORT), ROOT], { stdio: ['ignore', 'ignore', 'inherit'] });
}

async function waitForServer(tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return true;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  return false;
}

async function openPage(query) {
  const profile = `${tmpdir()}/continuum-hills-world-${process.pid}-${Date.now()}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--mute-audio',
    '--hide-scrollbars', '--window-size=1280,720', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    `http://localhost:${PORT}/index.html?${query}`], { stdio: ['ignore', 'ignore', 'pipe'], env: CHROME_ENV });
  const devtools = await new Promise((resolve) => {
    let text = '';
    chrome.stderr.on('data', (d) => {
      text += d;
      const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(text);
      if (m) resolve(new URL(m[1]));
    });
  });
  let page = null;
  for (let i = 0; i < 100 && !page; i++) {
    const list = await (await fetch(`http://${devtools.host}/json/list`)).json();
    page = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
    if (!page) await sleep(200);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      logs.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    }
    if (msg.method === 'Runtime.exceptionThrown') logs.push(String(msg.params.exceptionDetails.text).slice(0, 300));
    if (pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  });
  ws.send(JSON.stringify({ id: 9999, method: 'Runtime.enable' }));
  const ev = (expression) => new Promise((resolve) => {
    pending.set(++id, (r) => resolve(r && r.result ? (r.result.value !== undefined ? r.result.value : r.result.description) : r));
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  let title = '';
  for (let i = 0; i < 900; i++) {
    title = await ev('document.title');
    if (title === 'GAME_DONE' || String(title).startsWith('GAME_FAIL')) break;
    await sleep(500);
  }
  if (title !== 'GAME_DONE') {
    chrome.kill();
    throw new Error(`page: ${title}`);
  }
  return {
    logs,
    run: async (body) => {
      const out = await ev(`(async () => { const g = game; ${body} })().then((v) => JSON.stringify(v), (e) => JSON.stringify({ error: e.message + ' ' + (e.stack || '').slice(0, 300) }))`);
      return JSON.parse(out);
    },
    close: () => {
      chrome.kill();
      setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
    },
  };
}

// In the page: every program of the land's shader and of the farm's materials built on a canvas of its own, as the game builds them
// (terrain real and painted, wound and not, the grass's ground map), the road's verge snippet, and the fields in GLSL against the fields in JS
// on 4096 points.
const PROGRAMS = String.raw`
  const THREE = await import('three');
  const T = await import('./src/render/terrain.js');
  const G = await import('./src/render/ground.js');
  const S = await import('./src/render/style.js');
  const F = await import('./src/render/farmparts.js');
  const FS = await import('./src/render/fieldshade.js');
  const FL = await import('./src/world/fields.js');
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 64;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.shadowMap.enabled = true;
  let errs = [];
  renderer.debug.onShaderError = (gl, program, vs, fs) => { errs.push((gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs) || gl.getProgramInfoLog(program)).slice(0, 600)); };
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xbfd2e2, 0.0001);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  scene.add(sun, sun.target, new THREE.HemisphereLight(0xffffff, 0x444444, 0.5));
  const camera = new THREE.PerspectiveCamera(55, 1.5, 0.3, 14000);
  camera.position.set(0, 5, 20);
  camera.lookAt(0, 0, 0);
  const geo = new THREE.PlaneGeometry(40, 40, 4, 4);
  geo.rotateX(-Math.PI / 2);
  const n = geo.attributes.position.count;
  geo.setAttribute('aShade', new THREE.BufferAttribute(new Float32Array(n * 3).fill(0.5), 3));
  geo.setAttribute('aSurf', new THREE.BufferAttribute(new Float32Array(n * 3).fill(30), 3));
  const maps = new G.GroundMaps('high');
  const mat = T.makeTerrainMaterial({ debug: false }, null, null, maps.uniforms);
  const gmat = T.makeTerrainMaterial({ debug: false }, null, { uniforms: mat.userData.uniforms, detail: mat.userData.detail });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  const was = S.pairProgram.on;
  const results = {};
  const attempt = (name) => {
    errs = [];
    try { renderer.render(scene, camera); } catch (e) { errs.push('thrown ' + e.message); }
    results[name] = errs.slice();
  };
  const paint = (on, m = mat) => { S.pairProgram.on = on; for (const f of S.pairProgram.listeners) f(); m.needsUpdate = true; };
  paint(false);
  attempt('terrain real');
  paint(true);
  attempt('terrain paint');
  paint(false);
  mat.defines = { FOLD_ALPHA: '' };
  mat.blending = THREE.CustomBlending;
  mat.needsUpdate = true;
  attempt('terrain real wound');
  paint(true);
  attempt('terrain paint wound');
  mat.defines = {};
  mat.blending = THREE.NormalBlending;
  paint(false);
  mesh.material = gmat;
  gmat.needsUpdate = true;
  attempt('ground map');
  paint(true, gmat);
  attempt('ground map paint');
  paint(false, gmat);
  mesh.visible = false;
  const farm = F.farmMaterial();
  const poles = new THREE.InstancedMesh(F.poleGeometry(false), farm, 2);
  const walls = new THREE.InstancedMesh(F.wallGeometry(), farm, 2);
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 5, 0, 0, 5, 0, 10, 5, 0, 10, 5, 0]), 3));
  wg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  wg.setAttribute('aDir', new THREE.BufferAttribute(new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]), 3));
  wg.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array([-1, 1, -1, 1]), 1));
  wg.setIndex([0, 1, 3, 0, 3, 2]);
  const wires = new THREE.Mesh(wg, F.wireMaterial());
  wires.frustumCulled = false;
  scene.add(poles, walls, wires);
  attempt('farm real');
  paint(true);
  attempt('farm paint');
  paint(false);
  poles.visible = walls.visible = wires.visible = false;
  const toy = new THREE.ShaderMaterial({
    uniforms: { uJunction: FS.fieldU.uJunction, uJunctions: FS.fieldU.uJunctions },
    vertexShader: 'varying vec2 vVergeXZ; void main() { vVergeXZ = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec2 vVergeXZ;\n' + FS.JUNCTION_PARS + '\nvoid main() { vec4 diffuseColor = vec4(0.5, 0.5, 0.5, 1.0);\n' + FS.JUNCTION_MAP + '\n gl_FragColor = diffuseColor; }',
  });
  scene.add(new THREE.Mesh(geo, toy));
  attempt('verge');
  // The fields: GLSL against JS.
  const N = 4096;
  const pts = new Float32Array(N * 4);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < N; i++) {
    pts[i * 4] = (rnd() - 0.5) * (i % 2 ? 4e5 : 4000);
    pts[i * 4 + 1] = (rnd() - 0.5) * (i % 2 ? 4e5 : 4000);
  }
  const tex = new THREE.DataTexture(pts, N, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  const rt = new THREE.WebGLRenderTarget(N, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
  const twin = new THREE.ShaderMaterial({
    uniforms: { tPts: { value: tex } },
    glslVersion: THREE.GLSL3,
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'precision highp float;\nprecision highp int;\nuniform sampler2D tPts;\nlayout(location = 0) out highp vec4 outColor;\n' + FS.FIELD_COMMON
      + '\nvoid main() {\n vec2 p = texelFetch(tPts, ivec2(gl_FragCoord.xy), 0).xy;\n ivec2 ca; ivec2 cb; float e;\n fieldCell(p, ca, cb, e);\n outColor = vec4(float(ca.x), float(ca.y), e, float(fCrop(ca)));\n}',
  });
  const s2 = new THREE.Scene();
  s2.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), twin));
  errs = [];
  renderer.setRenderTarget(rt);
  renderer.render(s2, new THREE.Camera());
  renderer.setRenderTarget(null);
  results['twin shader'] = errs.slice();
  const got = new Float32Array(N * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, N, 1, got);
  let differ = 0;
  let worst = 0;
  const o = {};
  for (let i = 0; i < N; i++) {
    FL.fieldAt(Math.fround(pts[i * 4]), Math.fround(pts[i * 4 + 1]), o);
    if (o.ix !== got[i * 4] || o.iz !== got[i * 4 + 1] || o.crop !== got[i * 4 + 3]) { if (Math.abs(o.edge) >= 0.05) differ++; } else worst = Math.max(worst, Math.abs(o.edge - got[i * 4 + 2]));
  }
  S.pairProgram.on = was;
  for (const f of S.pairProgram.listeners) f();
  renderer.dispose();
  return { results, differ, worst, points: N };
`;

// In the page: what the hills add to a frame (their three meshes hidden against shown, in the same frame), and every style drawing it.
const FRAME = (style, frames) => String.raw`
  g.setCamera('chase');
  g.chase.shaking = false;
  g.chase.lead = false;
  if (g.style.id !== ${JSON.stringify(style)}) { g.style.set(${JSON.stringify(style)}, true); g.style.applyScene(); }
  g.post.setStyle(g.style);
  const errors = window.__hillsErrors || (window.__hillsErrors = []);
  g.renderer.debug.onShaderError = (gl, program) => { errors.push(String(gl.getProgramInfoLog(program)).slice(0, 300)); };
  const p = g.road.at(5000);
  g.autoMode = true;
  g.sCar = 5000;
  g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(5000, 1.9) + 0.3);
  g.car.vx = 22;
  g.chase.snapTo(g.car, g.car.y || 0);
  for (let i = 0; i < ${frames}; i++) { g.pilot.vMax = 22; g.update(1 / 60); }
  const meshes = g.hills.meshes();
  const count = () => { g.renderer.info.reset(); g.render(); return { calls: g.renderer.info.render.calls, triangles: g.renderer.info.render.triangles }; };
  count();
  const shown = count();
  const keep = meshes.map((m) => m.visible);
  for (const m of meshes) m.visible = false;
  const hidden = count();
  meshes.forEach((m, i) => { m.visible = keep[i]; });
  return { shown, hidden, stats: g.hills.stats(), errors: errors.slice() };
`;

const server = serve();
try {
  if (!(await waitForServer())) throw new Error('the dev server did not come up');
  const page = await openPage('seed=7&world=hills&s=5000&run=60&style=real');
  try {
    const pr = await page.run(PROGRAMS);
    if (pr.error) throw new Error(pr.error);
    const names = Object.keys(pr.results);
    say(names.every((k) => !pr.results[k].length), `the land's shader, the farm's materials and the verge's ruts build at every program (${names.join(', ')})${names.filter((k) => pr.results[k].length).map((k) => `\n    ${k}: ${pr.results[k][0]}`).join('')}`);
    say(pr.differ === 0 && pr.worst < 1e-3, `the fields are the same in GLSL and in JS on ${pr.points} points (${pr.differ} differ; the nearest border's distance off by ${pr.worst.toExponential(1)} m at the most)`);
    const r = await page.run(FRAME('real', 150));
    if (r.error) throw new Error(r.error);
    const dCalls = r.shown.calls - r.hidden.calls;
    const dTris = r.shown.triangles - r.hidden.triangles;
    say(r.stats.walls > 0 && r.stats.poles > 0 && r.stats.spans > 0, `the hills' place has ${r.stats.walls} pieces of wall, ${r.stats.poles} poles, ${r.stats.spans} spans of wire and ${r.stats.tracks} farm tracks in the frame`);
    say(dCalls >= 3 && dCalls <= 8 && dTris > 0 && dTris <= 60000, `they add ${dCalls} draws and ${dTris} triangles to the frame (at most 8 and 60 thousand, the shadow pass counted)`);
    for (const style of ['paint', 'ink', 'cel', 'print', 'pixel', 'block']) {
      const q = await page.run(FRAME(style, 50));
      if (q.error) throw new Error(`${style}: ${q.error}`);
      say(!q.errors.length && q.stats.walls > 0, `${style}: the hills draw without a shader error${q.errors.length ? ` (${q.errors[0]})` : ''}`);
    }
    say(!page.logs.length, `the page logged no errors${page.logs.length ? `: ${page.logs.slice(0, 2).join(' | ')}` : ''}`);
  } finally {
    page.close();
  }
} finally {
  server.kill();
}

console.error(failed ? `\nFAILED: ${failed} check(s)` : '\nOK');
process.exit(failed ? 1 : 0);
