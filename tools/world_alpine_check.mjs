// What the alpine world has of its own is there, where it should be, and costs what it should: the snow poles by
// the road, the waterfalls on the cliffs, the plumes of snow blown off the ridges, the cow bells and the rush of a
// waterfall to be heard, and the snow that stays under the snow line.
//
// In node, without a browser (world/alpineplan.js, and the render code read with three.js and no GL, on a road
// and a land made up for it), over three seeds:
//  - the poles: the same each time they are asked for; each stands 0.5 to 1.5 m outside the verge of the road
//    (6.4 m from its middle, so 6.9 to 7.9 m), on the ground, on a road that runs on the ground, 25 m of road from the
//    pole before it on its side; at the alpine place of tools/look.mjs (seed 7, 900 m) at least 40 within 2 km;
//  - the waterfalls: the same each time; each is down a face that is steeper than 0.9 at every point of it, falls more
//    than 25 m (and no more than 110), is 60 m or more from the road along its whole line, is 2 to 4 m wide; one in an 800 m
//    cell at most; at the alpine place one or more within 2 km;
//  - the plumes: from where the lens is, at most 6 within 2.4 km, 240 m or more apart, each from a crest over the snow line (the
//    land 50 m up and down the wind from it is lower by 10 m) and trailing downwind, 110 to 260 m long; at the places
//    `alpine` (seed 7, 900 m) and `valley` (seed 7, 5000 m) one or more (the land within 800 m of the first is under the
//    snow line, so it is ridges farther off that are seen);
//  - the bells: a ring every 8 to 20 s, of 2 to 4 strokes 0.28 to 0.7 s apart, each 520 to 790 Hz, the same ring for the same
//    number;
//  - the drawing: at the high tier the poles, the falls and the plumes are drawn, at the mid tier half of them, at the
//    low tier none; the blocks have square poles; a place out of reach of the alpine has none of it in the scene;
//    and what it made is let go of by dispose().
//
// In the page (headless, seed 7, software rendering; `--page`): the place `alpine` and the place `valley` of
// tools/look.mjs drawn in each style with it and without it, no GL error in any; what it adds to a frame (draw calls,
// triangles, programs), counted against the same frame at the low tier; a minute driven in the alpine below the tree
// line has 3 to 7 bell rings; the frame at the place `valley` in the real style has more white in its far ground
// (L over 0.85, chroma under 0.03) than the same frame at the low tier; dispose.
//
// And as sound (`--sound`, rendered offline in the page): a waterfall's rush is as loud as it is near and is put
// to the side it is on; with none within reach there is none of it; a bell's strokes are two sines that do not sit in
// tune and die in a fifth of a second; the minute does not clip.
//
// Usage: node tools/world_alpine_check.mjs [--node] [--page] [--sound] [--keep out/alpine-check]
// With none of the three named, all three are run; --node needs no browser.
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { register } from 'node:module';
import { makeWorldLand } from '../src/world/worlds.js';
import { Road, HALF_FLAT, GROUND } from '../src/world/road.js';
import { Corridor } from '../src/world/corridor.js';
import { AlpinePlan, ALPINE, BELL, FALL, PLUME, POLE, bellGap, bellRing } from '../src/world/alpineplan.js';

const ROOT = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const named = ['--node', '--page', '--sound'].filter((a) => args.includes(a));
const WANT = (part) => !named.length || named.includes(part);
const KEEP = args.includes('--keep') ? args[args.indexOf('--keep') + 1] : null;

let failed = 0;
const say = (ok, text) => {
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};
const f = (x, k = 2) => (typeof x === 'number' ? x.toFixed(k) : String(x));
const span = (a, k = 2) => (a.length ? `${f(Math.min(...a), k)}..${f(Math.max(...a), k)}` : 'none');
// The wind the clouds' shadows go by (render/style.js), and the places of tools/look.mjs.
const WIND = { x: 6.5, z: 2.8 };
const PLACES = { alpine: 900, valley: 5000 };

// --- in node: the plan ------------------------------------------------------------------------

// A land, a road (laid as far as the car has driven: update(s)), and the plan, for a seed.
function planOf(seed) {
  const land = makeWorldLand(seed, { start: 'alpine' });
  const road = new Road(land, seed);
  const corridor = new Corridor(road, land);
  const plan = new AlpinePlan({ land, road, corridor, worlds: land.worlds, seed, wind: WIND });
  return { land, road, corridor, plan };
}

// Where the lens is at a place of tools/look.mjs: 12 m behind the car. x, z: local; ax, az: absolute.
function lensAt(road, s) {
  const p = road.at(s);
  const o = road.origin;
  return { p, ax: p.x + o.x - Math.cos(p.theta) * 12, az: p.z + o.z - Math.sin(p.theta) * 12, x: p.x - Math.cos(p.theta) * 12, z: p.z - Math.sin(p.theta) * 12 };
}

function nodePlan() {
  const steepAt = (land, x, z) => Math.hypot((land.heightAt(x + 2.5, z) - land.heightAt(x - 2.5, z)) / 5, (land.heightAt(x, z + 2.5) - land.heightAt(x, z - 2.5)) / 5);
  for (const seed of [7, 42, 3]) {
    const name = `seed ${seed}`;
    const { land, road, corridor, plan } = planOf(seed);
    const again = planOf(seed);
    const wind = plan.wind;
    const poles = [];
    const outside = [];
    const kinds = [];
    const falls = [];
    const stats = [];
    const seenChunk = new Set();
    const seenFall = new Set();
    let same = true;
    let sameFalls = true;
    let places = 0;
    let withOne = 0;
    let most = 0;
    let spaced = true;
    let crest = true;
    const lengths = [];
    // The car drives the road: it is laid as far as the car has gone, and what is behind it is let go. Each thing is looked at as it comes.
    for (let sCar = 400; sCar <= 7000; sCar += 100) {
      road.update(sCar);
      again.road.update(sCar);
      for (let c = Math.floor((sCar - 200) / POLE.chunk); c <= Math.floor((sCar + 800) / POLE.chunk); c++) {
        if (seenChunk.has(c)) continue;
        const l = plan.poles(c);
        const m = again.plan.poles(c);
        if (l === undefined || m === undefined) continue;
        seenChunk.add(c);
        if (JSON.stringify(l) !== JSON.stringify(m)) same = false;
        for (const q of l) {
          poles.push(q);
          outside.push(plan.roadNear(q.ax, q.az, 30).dist - HALF_FLAT);
          kinds.push(road.at(q.s).kind === GROUND && Math.abs(q.y - corridor.heightAt(q.ax, q.az)) < 1e-6);
        }
      }
      for (let k = Math.floor((sCar - 800) / FALL.every); k <= Math.floor((sCar + 1600) / FALL.every); k++) {
        if (k < 0 || seenFall.has(k)) continue;
        const a = plan.fall(k);
        const b = again.plan.fall(k);
        if (a === undefined || b === undefined) continue;
        seenFall.add(k);
        if (JSON.stringify(a && [...a.pts]) !== JSON.stringify(b && [...b.pts])) sameFalls = false;
        if (!a) continue;
        falls.push({ k, fall: a });
        let least = Infinity;
        for (let i = 1; i < a.n - 1; i++) least = Math.min(least, steepAt(land, a.pts[i * 3], a.pts[i * 3 + 2]));
        let nearest = Infinity;
        for (let i = 0; i < a.n; i++) nearest = Math.min(nearest, plan.roadNear(a.pts[i * 3], a.pts[i * 3 + 2], FALL.off + 40).dist);
        stats.push({ least, drop: a.pts[4] - a.pts[(a.n - 2) * 3 + 1], nearest, width: a.width });
      }
      if (sCar % 400 === 0) {
        const lens = lensAt(road, sCar);
        const list = plan.plumesNear(lens.ax, lens.az);
        places++;
        if (list.length) withOne++;
        most = Math.max(most, list.length);
        for (let i = 0; i < list.length; i++) {
          const r = list[i];
          for (let j = 0; j < i; j++) if (Math.hypot(r.ax - list[j].ax, r.az - list[j].az) < PLUME.apart - 1e-6) spaced = false;
          const up = land.heightAt(r.ax - wind.x * PLUME.step, r.az - wind.z * PLUME.step);
          const down = land.heightAt(r.ax + wind.x * PLUME.step, r.az + wind.z * PLUME.step);
          if (!(r.y >= land.snowLine && r.y > up + PLUME.crest - 1e-6 && r.y > down + PLUME.crest - 1e-6)) crest = false;
          const dx = r.pts[(r.n - 1) * 3] - r.pts[0];
          const dz = r.pts[(r.n - 1) * 3 + 2] - r.pts[2];
          const len = Math.hypot(dx, dz);
          lengths.push(len);
          if (Math.abs(dx / len - wind.x) > 1e-6 || Math.abs(dz / len - wind.z) > 1e-6) crest = false;
          for (let m = 0; m < r.n; m++) if (r.pts[m * 3 + 1] < land.heightAt(r.pts[m * 3], r.pts[m * 3 + 2]) + PLUME.lift[0] - 1e-6) crest = false;
        }
      }
    }

    // The poles.
    say(same && poles.length > 150, `${name}: the poles are the same each time they are asked for (${poles.length} in 7 km of road)`);
    say(Math.min(...outside) >= POLE.off[0] - 0.05 && Math.max(...outside) <= POLE.off[1] + 0.05, `${name}: each stands outside the verge by ${span(outside)} m (0.5 to 1.5)`);
    say(kinds.every(Boolean), `${name}: on the ground, on a road that runs on the ground`);
    let apartOk = true;
    for (const side of [1, -1]) {
      const mine = poles.filter((q) => q.side === side).sort((a, b) => a.s - b.s);
      for (let i = 1; i < mine.length; i++) {
        const k = (mine[i].s - mine[i - 1].s) / POLE.every;
        if (k < 1 - 1e-6 || Math.abs(k - Math.round(k)) > 1e-6) apartOk = false;
      }
    }
    say(apartOk && POLE.every === 25 && POLE.height === 2.4, `${name}: 25 m of road, or a whole number of 25 m where the road is not ground, from one to the next on a side; ${POLE.height} m tall`);

    // The waterfalls.
    say(sameFalls && falls.length >= 3, `${name}: the waterfalls are the same each time (${falls.length} in the ${seenFall.size} cells of 800 m)`);
    say(stats.every((x) => x.least >= FALL.slope - 0.02), `${name}: each is down a face steeper than ${FALL.slope} all the way (the least is ${f(Math.min(...stats.map((x) => x.least)))})`);
    say(stats.every((x) => x.drop > FALL.drop && x.drop <= FALL.max + 3), `${name}: each falls more than ${FALL.drop} m and not more than ${FALL.max} m (${span(stats.map((x) => x.drop), 0)} m)`);
    say(stats.every((x) => x.nearest >= FALL.off), `${name}: and is ${FALL.off} m or more from the road along the whole of it (${f(Math.min(...stats.map((x) => x.nearest)), 0)} m at the least)`);
    say(stats.every((x) => x.width >= FALL.width[0] && x.width <= FALL.width[1]), `${name}: and ${span(stats.map((x) => x.width), 1)} m wide`);
    say(new Set(falls.map((e) => e.fall.key)).size === falls.length && falls.every((e) => e.fall.key === e.k), `${name}: one to a cell of ${FALL.every} m at most`);

    // The ridges the plumes trail from.
    say(most <= PLUME.max && spaced, `${name}: at most ${most} plumes from a lens (6), ${PLUME.apart} m or more apart`);
    say(crest && (!lengths.length || (Math.min(...lengths) >= PLUME.length[0] - 1e-6 && Math.max(...lengths) <= PLUME.length[1] + 1e-6)),
      `${name}: each from a crest over the snow line (${land.snowLine} m), trailing downwind over the land${lengths.length ? `, ${span(lengths, 0)} m long` : ''}`);
    // (Whether a ridge is over the snow line within reach of the road is up to the land: a seed's valley may have none for kilometres.)
    console.error(`     ${name}: ${withOne} of the ${places} places along 7 km have one or more plumes in reach`);
    if (seed === 7) say(withOne >= 3, `${name}: ${withOne} of the ${places} places along 7 km have a plume in reach (at least 3)`);
  }

  // The two places of tools/look.mjs (seed 7): a road laid as far as the car is, and what is within reach of it.
  {
    const { land, road, plan } = planOf(7);
    road.update(PLACES.alpine);
    const lens = lensAt(road, PLACES.alpine);
    const falls = [];
    for (let k = 0; k <= Math.floor((PLACES.alpine + 2500) / FALL.every); k++) {
      const fall = plan.fall(k);
      if (fall && Math.hypot(fall.ax - lens.ax, fall.az - lens.az) <= 2000) falls.push(fall);
    }
    let poles = 0;
    for (let c = 0; c <= Math.floor((PLACES.alpine + 2500) / POLE.chunk); c++) {
      for (const q of plan.poles(c) || []) if (Math.hypot(q.ax - lens.ax, q.az - lens.az) <= 2000) poles++;
    }
    say(poles >= 40, `the place alpine: ${poles} snow poles within 2 km (at least 40)`);
    say(falls.length >= 1, `the place alpine: ${falls.length} waterfalls within 2 km (at least 1; ${falls.map((x) => `${f(Math.hypot(x.ax - lens.ax, x.az - lens.az), 0)} m`).join(', ')})`);
    const here = plan.plumesNear(lens.ax, lens.az);
    say(here.length >= 1 && here.length <= PLUME.max, `the place alpine: ${here.length} plumes in reach (1 to 6; ${here.map((q) => `${f(Math.hypot(q.ax - lens.ax, q.az - lens.az), 0)} m`).join(', ')})`);
    // (From the road the ridges that are over the snow line are well over the top of the picture within 800 m: the highest land that near is under the line at the place alpine.)
    let top = -Infinity;
    for (let r = 50; r <= 800; r += 50) for (let a = 0; a < 360; a += 10) top = Math.max(top, land.heightAt(lens.ax + Math.cos((a * Math.PI) / 180) * r, lens.az + Math.sin((a * Math.PI) / 180) * r));
    console.error(`     (the highest land within 800 m of the place alpine is ${f(top, 0)} m, the snow line ${land.snowLine} m)`);
  }
  {
    const { land, road, plan } = planOf(7);
    for (let s = 400; s <= PLACES.valley; s += 100) road.update(s);
    const v = lensAt(road, PLACES.valley);
    const list = plan.plumesNear(v.ax, v.az);
    say(list.length >= 1 && list.length <= 6, `the place valley: ${list.length} plumes in reach (1 to 6)`);
    let ys = [];
    for (let s = 2400; s <= PLACES.valley; s += 100) ys.push(road.at(s).y);
    console.error(`     (the road of the alpine world runs ${span(ys, 0)} m high from 2400 to 5000 m; the tree line is ${land.treeLine} m and the snow line ${land.snowLine} m)`);
  }
}

function nodeBells() {
  const gaps = [];
  let ok = true;
  const counts = new Set();
  const betweens = [];
  const pitches = [];
  for (let n = 1; n <= 400; n++) {
    gaps.push(bellGap(n, 7));
    const r = bellRing(n, 7);
    if (JSON.stringify(r) !== JSON.stringify(bellRing(n, 7))) ok = false;
    counts.add(r.strokes.length);
    r.strokes.forEach((st, i) => {
      pitches.push(st.pitch);
      if (i > 0) betweens.push(st.at - r.strokes[i - 1].at);
    });
  }
  say(Math.min(...gaps) >= BELL.apart[0] && Math.max(...gaps) <= BELL.apart[1], `a bell rings every ${span(gaps, 1)} s (8 to 20)`);
  say(ok && [...counts].every((c) => c >= 2 && c <= 4) && counts.size === 3, `a ring is ${[...counts].sort().join(', ')} strokes (2 to 4), the same ring for the same number`);
  say(Math.min(...betweens) >= BELL.between[0] - 1e-9 && Math.max(...betweens) <= BELL.between[1] + 1e-9, `the strokes of a ring are ${span(betweens)} s apart (0.28 to 0.7)`);
  say(Math.min(...pitches) >= BELL.pitch[0] * 0.95 - 1e-9 && Math.max(...pitches) <= BELL.pitch[1] * 1.05 + 1e-9, `and each is ${span(pitches, 0)} Hz (520 to 790, a stroke of a ring off its ring's by 5% at most)`);
  // How many rings a minute has, from the clock.
  let t = BELL.first;
  let counted = 0;
  for (let m = 1; t < 60; m++) {
    counted++;
    t += bellGap(m, 7);
  }
  say(counted >= 3 && counted <= 7, `a minute has ${counted} rings (3 to 7; the first at ${BELL.first} s)`);
}

// The sound's own part, in node: a made-up audio context that remembers what is made and set, and the states of a drive
// given to src/ui/sound.js.
async function nodeSound() {
  const { Sound } = await import('../src/ui/sound.js');
  const oscillators = [];
  const gains = [];
  const param = () => ({ value: 0, last: null, calls: [], setTargetAtTime(v, t, tau) { this.last = [v, t, tau]; this.calls.push(['target', v, t, tau]); }, setValueAtTime(v, t) { this.calls.push(['set', v, t]); }, linearRampToValueAtTime(v, t) { this.calls.push(['ramp', v, t]); }, exponentialRampToValueAtTime() {} });
  const node = (kind) => ({ kind, gain: param(), frequency: param(), Q: param(), connect(to) { return to; }, start(t) { this.started = t; }, stop(t) { this.stopped = t; } });
  const ctx = {
    sampleRate: 4000, currentTime: 0, destination: node('destination'),
    createGain: () => { const g = node('gain'); gains.push(g); return g; }, createBiquadFilter: () => node('filter'),
    createOscillator: () => { const o = node('osc'); oscillators.push(o); return o; },
    createBufferSource: () => ({ ...node('source'), playbackRate: param() }), createConvolver: () => node('convolver'),
    createDynamicsCompressor: () => ({ ...node('comp'), threshold: param(), ratio: param(), knee: param(), attack: param(), release: param() }),
    createStereoPanner: () => ({ ...node('panner'), pan: param() }),
    createBuffer: (ch, n) => ({ getChannelData: () => new Float32Array(n) }),
  };
  const state = (extra = {}) => ({ speed: 20, throttle: 0.5, lift: 1, a: ALPINE, b: ALPINE, blend: 0, inside: 0, distance: 8, on: 1, time: 0, ...extra });
  const sound = new Sound(ctx);
  const base = oscillators.length;
  const gainBase = gains.length;
  const ring = { pan: -0.4, strokes: [{ at: 0, pitch: 600, level: 1 }, { at: 0.5, pitch: 640, level: 0.8 }, { at: 1.1, pitch: 620, level: 0.6 }] };
  // A ring in the alpine: three strokes, each two sines that are not in tune (the second 2.32 times the first), at their times.
  sound.update(state({ bells: 0, ring: null }), 10);
  say(oscillators.length === base, 'no bell has rung: no sine is made');
  sound.update(state({ bells: 1, ring }), 11);
  const made = oscillators.slice(base);
  const freq = made.map((o) => o.frequency.calls[0][1]);
  const at = made.map((o) => o.frequency.calls[0][2]);
  say(made.length === 6 && ring.strokes.every((st, i) => Math.abs(freq[2 * i] - st.pitch) < 1e-9 && Math.abs(freq[2 * i + 1] - st.pitch * 2.32) < 1e-9 && Math.abs(at[2 * i] - (11 + st.at)) < 1e-9),
    `a ring of 3 strokes is 6 sines: each stroke at its pitch and 2.32 times it, at its time (${freq.map((v) => f(v, 0)).join(', ')} Hz)`);
  const decay = made.map((o) => o.stopped - o.started);
  // (The envelope of each sine: up in 2 ms, down toward nothing with a time constant of 0.12 s, the higher with 0.055 s.)
  const envelopes = gains.slice(gainBase).filter((g) => g.gain.calls.some((c) => c[0] === 'ramp'));
  const taus = envelopes.map((g) => g.gain.calls.find((c) => c[0] === 'target')[3]);
  say(envelopes.length === 6 && taus.every((t, i) => Math.abs(t - (i % 2 === 0 ? 0.12 : 0.055)) < 1e-9) && decay.every((d) => d > 0.3 && d < 1.5),
    `each dies away fast, in 0.12 s and the higher in 0.055 s, and is let go of in ${span(decay, 2)} s`);
  // The same number again rings nothing; one more does.
  sound.update(state({ bells: 1, ring }), 12);
  say(oscillators.length === base + 6, 'a bell rings once');
  sound.update(state({ bells: 2, ring }), 13);
  say(oscillators.length === base + 12, 'and the next rings again');
  // In a world that has no bells: none.
  const hills = new Sound(ctx);
  const hillsBase = oscillators.length;
  hills.update(state({ a: 1, b: 1, bells: 0 }), 1);
  hills.update(state({ a: 1, b: 1, bells: 1, ring }), 2);
  say(oscillators.length === hillsBase, 'in the hills no bell rings');
  // Half of the lens in the alpine, half in the hills: it rings, at half the loudness.
  const half = new Sound(ctx);
  half.update(state({ a: ALPINE, b: 1, blend: 0.5, bells: 0 }), 1);
  const halfBase = oscillators.length;
  const halfGains = gains.length;
  half.update(state({ a: ALPINE, b: 1, blend: 0.5, bells: 1, ring }), 2);
  const peakOf = (g) => Math.max(...g.gain.calls.filter((c) => c[0] === 'ramp').map((c) => c[1]));
  const full = peakOf(envelopes[0]);
  const hall = peakOf(gains.slice(halfGains).find((g) => g.gain.calls.some((c) => c[0] === 'ramp')));
  say(oscillators.length > halfBase && Math.abs(hall / full - 0.5) < 1e-6, `at the border it rings at half the loudness (${f(hall / full)} of what it is inside)`);

  // The rush of a waterfall: as loud as the lens is near, put to its side, none in a world that has none, halved at the border.
  const target = (snd) => snd.fallGain.gain.last[0];
  const pan = (snd) => snd.fallPlace.pan.last[0];
  const rush = new Sound(ctx);
  rush.update(state({ fall: 0 }), 1);
  const none = target(rush);
  rush.update(state({ fall: 0.5, fallPan: -0.6 }), 2);
  const mid = target(rush);
  const midPan = pan(rush);
  rush.update(state({ fall: 1, fallPan: 0.8 }), 3);
  const top = target(rush);
  say(none === 0 && mid > 0 && Math.abs(mid / top - 0.5) < 1e-6 && top > 0 && top <= 0.5, `the rush is 0, ${f(mid, 3)} and ${f(top, 3)} at 0, 0.5 and 1 (as loud as it is near)`);
  say(midPan === -0.6 && pan(rush) === 0.8, 'and put to the side it is on');
  rush.update(state({ a: 1, b: 1, fall: 1 }), 4);
  say(target(rush) === 0, 'in the hills there is none of it');
  rush.update(state({ a: ALPINE, b: 1, blend: 0.5, fall: 1 }), 5);
  say(Math.abs(target(rush) / top - 0.5) < 1e-6, 'and half of it at the border');
  const st = Sound.state({
    camera: { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }, car: { x: 0, y: 0, z: 0, speed: 0 }, presentation: {}, traffic: { cars: [] }, road: {},
    _lookAt: { a: ALPINE, b: ALPINE, t: 0 }, upside: { strikes: 0, rate: 0, roll: 0, infect: 0 },
    alpine: { bells: 3, ring, hearing: { level: 0.4, x: 1, y: 0, z: 5 } },
  });
  say(st.bells === 3 && st.ring === ring && st.fall === 0.4 && Math.abs(st.fallPan) <= 0.85, 'the state of a drive says how many times a bell has rung, how, and how near a waterfall is');
  const away = oscillators.length;
  sound.skip({ bells: 9 });
  sound.update(state({ bells: 9, ring }), 20);
  say(oscillators.length === away, 'a bell rung while the sound was away is not heard when it comes back');
}

// The render code in node, over a road and a land made up for it: three.js with no GL, a scene that nothing draws.
async function nodeRender() {
  register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { if (s === 'three') return { url: ${JSON.stringify('file://' + ROOT + 'tools/vendor/three.module.js')}, shortCircuit: true }; return n(s, c); }`));
  const THREE = await import('three');
  const { Alpine } = await import('../src/render/alpine.js');
  const { POLES } = await import('../src/render/snowpoles.js');
  const seed = 7;
  const { land, road, plan } = planOf(seed);
  for (let s = 400; s <= PLACES.valley; s += 100) road.update(s);
  const scene = new THREE.Scene();
  const alpine = new Alpine(scene, { plan, road, worlds: land.worlds, seed }, 'high');
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.3, 14000);
  const look = { a: ALPINE, b: ALPINE, t: 0 };
  const at = (s) => {
    const p = road.at(s);
    camera.position.set(p.x - Math.cos(p.theta) * 12, p.y + 3.5, p.z - Math.sin(p.theta) * 12);
    camera.lookAt(p.x + Math.cos(p.theta) * 60, p.y + 1, p.z + Math.sin(p.theta) * 60);
    camera.updateMatrixWorld();
    return s;
  };
  // What the lens sees, as the plumes are picked by it: a plume's sphere against the lens's frustum.
  const sees = (key, margin) => {
    const q = plan.cells.get(key);
    const m = (q.n >> 1) * 3;
    const o = road.origin;
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    return frustum.intersectsSphere(new THREE.Sphere(new THREE.Vector3(q.pts[m] - o.x, q.pts[m + 1], q.pts[m + 2] - o.z), q.len * 0.6 + q.width + margin));
  };
  const frame = (s, extra = {}) => alpine.update(camera, 1 / 60, { at: look, sCar: s, blocks: 0, px: 700, light: 1, fog: [0.7, 0.8, 0.9], settle: true, ...extra });
  const drawn = () => alpine.meshes().filter((m) => m.parent && m.visible).length;

  // Before the alpine has been in reach: nothing is in the scene.
  say(scene.children.length === 0 && drawn() === 0, 'before it is in reach of the alpine, none of it is in the scene');

  // The place valley, at the three tiers.
  const rows = {};
  for (const tier of ['low', 'mid', 'high']) {
    alpine.setTier(tier);
    frame(at(PLACES.valley));
    for (let i = 0; i < 90; i++) frame(PLACES.valley);
    rows[tier] = { ...alpine.stats(), meshes: drawn() };
  }
  const { low, mid, high } = rows;
  say(low.poles === 0 && low.falls === 0 && low.plumes === 0 && low.meshes === 0, `at the low tier none of it is drawn (${low.poles} poles, ${low.falls} waterfalls, ${low.plumes} plumes, ${low.meshes} meshes)`);
  say(high.poles >= 40 && high.poles <= POLES.max && high.falls >= 1 && high.plumes >= 1 && high.plumes <= PLUME.max,
    `at the high tier ${high.poles} poles, ${high.falls} waterfalls (${high.mist} points of spray) and ${high.plumes} plumes are drawn`);
  say(mid.poles <= Math.ceil(high.poles / 2) + 2 && mid.poles >= 1 && mid.falls <= 2 && mid.falls <= high.falls && mid.plumes <= PLUME.max / 2 && mid.plumes >= 1,
    `at the mid tier half of that: ${mid.poles} poles, ${mid.falls} waterfalls, ${mid.plumes} plumes`);
  // The plumes are the ones the lens sees: every one that is drawn is in its view, and when the lens turns round the ones in view are others.
  alpine.setTier('high');
  frame(at(PLACES.valley));
  const ahead = [...alpine.plumes.held()];
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  say(ahead.length >= 1 && ahead.every((k) => sees(k, 120)), `the plumes drawn are in the lens's view: ${ahead.length} of them, each within the frustum`);
  const here = road.at(PLACES.valley);
  camera.lookAt(here.x - Math.cos(here.theta) * 400, here.y + 1, here.z - Math.sin(here.theta) * 400);
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  frame(PLACES.valley);
  const behind = [...alpine.plumes.held()];
  say(behind.every((k) => sees(k, 600)) && ahead.some((k) => !behind.includes(k)), `turned round, the ones drawn are the ones in view then (${behind.length}, none out of view), and ${ahead.filter((k) => !behind.includes(k)).length} of the ${ahead.length} that were drawn are let go`);
  at(PLACES.valley);
  say(high.meshes === 4 && alpine.meshes().length === 4, `${high.meshes} of its ${alpine.meshes().length} meshes are drawn at the high tier (poles, ribbons, spray, plumes: four draws)`);

  // A minute of the world's clock with the lens in the open below the tree line: the bells ring (3 to 7 times), by the draws' own gaps.
  alpine.setTier('high');
  at(PLACES.valley);
  const rings0 = alpine.bells;
  const times = [];
  let n0 = rings0;
  for (let i = 0; i < 3600; i++) {
    frame(PLACES.valley, { settle: false });
    if (alpine.bells !== n0) {
      n0 = alpine.bells;
      times.push(alpine.clock);
    }
  }
  const gapsHeard = times.slice(1).map((t, i) => t - times[i]);
  say(n0 - rings0 >= 3 && n0 - rings0 <= 7 && gapsHeard.every((g) => g >= BELL.apart[0] - 0.02 && g <= BELL.apart[1] + 0.02), `a minute in the open below the tree line has ${n0 - rings0} rings, ${span(gapsHeard, 1)} s apart`);
  const rung = alpine.bells;
  frame(PLACES.valley, { at: { a: 1, b: 1, t: 0 } });
  for (let i = 0; i < 1800; i++) frame(PLACES.valley, { at: { a: 1, b: 1, t: 0 }, settle: false });
  say(alpine.bells === rung, 'none rings while the lens is in another world');

  // Driving: the lens goes along the road at 22 m/s for 2.5 s, as the place is put down in tools/look.mjs, each frame doing no more than a frame does
  // (nothing is settled), on a land and a plan that have been asked for nothing; the plumes are drawn by the end of it, at both places.
  const driven = [];
  for (const place of [PLACES.alpine, PLACES.valley]) {
    const fresh = planOf(seed);
    for (let s0 = 400; s0 <= place; s0 += 100) fresh.road.update(s0);
    const sc = new THREE.Scene();
    const car = new Alpine(sc, { plan: fresh.plan, road: fresh.road, worlds: fresh.land.worlds, seed }, 'high');
    let first = -1;
    for (let i = 0; i < 150; i++) {
      const s0 = place - 55 + (22 * i) / 60;
      const p = fresh.road.at(s0);
      camera.position.set(p.x - Math.cos(p.theta) * 9, p.y + 3.4, p.z - Math.sin(p.theta) * 9);
      camera.lookAt(p.x + Math.cos(p.theta) * 30, p.y + 1.2, p.z + Math.sin(p.theta) * 30);
      camera.updateMatrixWorld();
      car.update(camera, 1 / 60, { at: look, sCar: s0, blocks: 0, px: 700, light: 1, fog: [0.7, 0.8, 0.9], settle: false });
      if (first < 0 && car.plumes.count > 0) first = i;
    }
    driven.push({ place, count: car.plumes.count, first });
    car.dispose();
  }
  say(driven.every((d) => d.count >= 1), `driving into each place, the plumes are there by the end of 2.5 s: ${driven.map((d) => `${d.count} at ${d.place} m (the first at frame ${d.first})`).join(', ')}`);

  // What is heard: the rush is nothing 120 m or more off and louder the nearer.
  alpine.setTier('high');
  const probe = plan.fall(Math.floor(PLACES.valley / FALL.every));
  if (probe) {
    const foot = (probe.n - 1) * 3;
    const o = road.origin;
    const levels = [];
    for (const d of [130, 100, 60, 20]) {
      // A lens `d` m from the foot of the fall (its nearest point), out from the face.
      camera.position.set(probe.pts[foot] - o.x + probe.out[0] * d, probe.pts[foot + 1] + 1, probe.pts[foot + 2] - o.z + probe.out[1] * d);
      camera.updateMatrixWorld();
      frame(PLACES.valley);
      levels.push(alpine.hearing.level);
    }
    say(levels[0] === 0 && levels[1] > 0 && levels[1] < levels[2] && levels[2] < levels[3] && levels[3] <= 1, `a waterfall is heard within ${FALL.hear} m and more the nearer: ${levels.map((v) => f(v)).join(', ')} at 130, 100, 60 and 20 m`);
  } else say(false, 'a waterfall in the cell of the place valley to be heard');

  // The place alpine: poles, drawn on the ground outside the verge.
  const alpineRoad = planOf(seed);
  alpineRoad.road.update(PLACES.alpine);
  const scene2 = new THREE.Scene();
  const second = new Alpine(scene2, { plan: alpineRoad.plan, road: alpineRoad.road, worlds: alpineRoad.land.worlds, seed }, 'high');
  const p0 = alpineRoad.road.at(PLACES.alpine);
  camera.position.set(p0.x - Math.cos(p0.theta) * 12, p0.y + 3.5, p0.z - Math.sin(p0.theta) * 12);
  camera.lookAt(p0.x + Math.cos(p0.theta) * 60, p0.y + 1, p0.z + Math.sin(p0.theta) * 60);
  camera.updateMatrixWorld();
  second.update(camera, 1 / 60, { at: look, sCar: PLACES.alpine, blocks: 0, px: 700, light: 1, fog: [0.7, 0.8, 0.9], settle: true });
  const list = second.poles.list;
  const edge = list.map((q) => alpineRoad.plan.roadNear(q.ax, q.az, 30).dist - HALF_FLAT);
  say(list.length >= 40 && Math.min(...edge) >= 0.45 && Math.max(...edge) <= 1.55, `at the place alpine ${list.length} poles are drawn, ${span(edge)} m outside the verge`);
  const tallest = Math.max(...second.poles.round.attributes.position.array.filter((v, i) => i % 3 === 1));
  say(Math.abs(tallest - 2.4) < 1e-6, `a pole is ${f(tallest)} m tall`);
  second.poles.setBlocky(true);
  say(second.poles.mesh.geometry === second.poles.square && second.poles.square.index.count < second.poles.round.index.count, 'in the block style the poles are square columns: four sides, not eight');
  second.poles.setBlocky(false);
  const sides = (g) => g.attributes.position.count;
  say(sides(second.poles.round) > sides(second.poles.square), `(${sides(second.poles.round)} corners to a round pole, ${sides(second.poles.square)} to a square one)`);

  // Out of reach of the alpine nothing is in the scene, drawn or heard.
  const far = new THREE.Scene();
  const elsewhere = new Alpine(far, { plan, road, worlds: { reaches: () => false }, seed }, 'high');
  elsewhere.update(camera, 1 / 60, { at: { a: 1, b: 1, t: 0 }, sCar: PLACES.valley, blocks: 0, px: 700, settle: true });
  say(far.children.length === 0 && elsewhere.stats().poles === 0 && elsewhere.stats().falls === 0 && elsewhere.hearing.level === 0, 'out of reach of the alpine nothing is in the scene, drawn or heard');

  // Let go.
  frame(at(PLACES.valley));
  const before = scene.children.length;
  alpine.dispose();
  say(before >= 4 && scene.children.length === 0, `dispose() takes ${before} objects out of the scene`);
  second.dispose();
}

// --- in the page --------------------------------------------------------------------------------

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8197;
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
  const profile = `${tmpdir()}/continuum-alpine-${process.pid}-${Date.now()}`;
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
    // (Three.js says what is wrong with a shader on the console.)
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') logs.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
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
      const out = await ev(`(async () => { const g = game; ${body} })().then((v) => JSON.stringify(v), (e) => JSON.stringify({ error: e.message + ' ' + (e.stack || '').slice(0, 500) }))`);
      return JSON.parse(out);
    },
    close: () => {
      chrome.kill();
      setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
    },
  };
}

// In the page: the car put on the road at s (as tools/look.mjs puts it), run for two and a half seconds.
const PLACE = (s) => `
  const p = g.road.at(${s});
  if (!p) return { missing: true };
  g.autoMode = true;
  g.sCar = ${s};
  g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(${s}, 1.9) + 0.3);
  g.car.vx = 22;
  g.setCamera('chase');
  g.chase.shaking = false;
  g.chase.lead = false;
  g.chase.snapTo(g.car, g.car.y || 0);
  g.style.wind[0] = 1000;
  g.style.wind[1] = 400;
  g.atmosphere.uniforms.uTime.value = 100;
  for (let i = 0; i < 150; i++) { g.pilot.vMax = 22; g.update(1 / 60); }
  g.post.setStyle(g.style);
  g.atmosphere.bakeEnvironment();
  return { s: ${s}, world: g.snapshot().world.id, alpine: g.snapshot().alpine };
`;

// In the page: the alpine's tier set alone, its things brought to the lens with the clock standing still, the frame drawn, and
// what it cost: draw calls, triangles and programs.
const TIER = (tier) => `
  g.alpine.setTier(${JSON.stringify(tier)});
  const ctx = g._alpineCtx(g.sceneHeight, true);
  for (let i = 0; i < 90; i++) g.alpine.update(g.camera, 0, ctx);
  g.render();
  const r = g.renderer;
  return { tier: ${JSON.stringify(tier)}, calls: r.info.render.calls, triangles: r.info.render.triangles, programs: r.info.programs.length, stats: g.alpine.stats() };
`;

// In the page: a style drawn at the place with the alpine's things (high) and without (low), the share of the frame that
// differs, and what the far ground has of white.
const STYLED = (id) => `
  g.style.set(${JSON.stringify(id)}, true);
  g.style.applyScene();
  g.post.setStyle(g.style);
  g.atmosphere.bakeEnvironment();
  for (let i = 0; i < 20; i++) g.style.update(0.1);
  g.style.applyScene();
  g.atmosphere.bakeEnvironment();
  const gl = g.renderer.getContext();
  const canvas = document.getElementById('view');
  const errors = () => { let n = 0; while (gl.getError() !== gl.NO_ERROR && n < 50) n++; return n; };
  const shot = (tier) => {
    g.alpine.setTier(tier);
    const ctx = g._alpineCtx(g.sceneHeight, true);
    for (let i = 0; i < 90; i++) g.alpine.update(g.camera, 0, ctx);
    errors();
    g.render();
    const e = errors();
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const x = c.getContext('2d');
    x.drawImage(canvas, 0, 0);
    return { errors: e, data: x.getImageData(0, 0, c.width, c.height).data, png: canvas.toDataURL('image/png') };
  };
  const low = shot('low');
  const high = shot('high');
  let diff = 0;
  for (let i = 0; i < low.data.length; i += 4) if (Math.abs(low.data[i] - high.data[i]) + Math.abs(low.data[i + 1] - high.data[i + 1]) + Math.abs(low.data[i + 2] - high.data[i + 2]) > 6) diff++;
  // The share of the picture's upper two thirds (the far land and the sky are there) that is white and has no colour (OKLab L over 0.85, chroma under 0.03), against the same without the alpine's things.
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const white = (d, h, w) => {
    let n = 0, all = 0;
    for (let y = 0; y < h * 0.66; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = lin(d[i]), g_ = lin(d[i + 1]), b = lin(d[i + 2]);
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g_ + 0.0514459929 * b);
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g_ + 0.1073969566 * b);
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g_ + 0.6299787005 * b);
      const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
      const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
      const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
      all++;
      if (L > 0.85 && Math.hypot(A, B) < 0.03) n++;
    }
    return n / all;
  };
  return { style: ${JSON.stringify(id)}, lowErrors: low.errors, highErrors: high.errors, changed: diff / (low.data.length / 4), lowWhite: white(low.data, canvas.height, canvas.width), highWhite: white(high.data, canvas.height, canvas.width), drawn: g.alpine.stats(), lowPng: low.png, highPng: high.png };
`;

// In the page: a minute driven in the alpine below the tree line.
const MINUTE = `
  g.alpine.setTier('high');
  const start = g.alpine.bells;
  const at = [];
  let n = start;
  let world = null;
  for (let i = 0; i < 3600; i++) {
    g.pilot.vMax = 22;
    g.update(1 / 60);
    if (g.alpine.bells !== n) { n = g.alpine.bells; at.push(+g.alpine.clock.toFixed(2)); }
    if (i === 3599) world = g.snapshot().world.id;
  }
  return { rings: n - start, at, world, s: g.sCar, y: g.car.y };
`;

// In the page: the alpine let go.
const DISPOSE = `
  g.alpine.setTier('high');
  g.update(1 / 60);
  g.render();
  const r = g.renderer;
  const before = { geometries: r.info.memory.geometries, children: g.scene.children.length };
  g.alpine.dispose();
  g.render();
  const after = { geometries: r.info.memory.geometries, children: g.scene.children.length };
  return { before, after };
`;

async function pagePart() {
  const server = serve();
  if (!(await waitForServer())) {
    console.error('FAIL: no server');
    server.kill();
    process.exit(1);
  }
  const keep = KEEP ? (mkdirSync(KEEP, { recursive: true }), KEEP.replace(/\/?$/, '/')) : null;
  let page = null;
  try {
    page = await openPage('seed=7&world=alpine&s=900&run=60&cam=chase&style=real&tier=low');
    for (const [name, s] of Object.entries(PLACES)) {
      const placed = await page.run(PLACE(s));
      if (placed.error || placed.missing) throw new Error(`the place ${name}: ${JSON.stringify(placed)}`);
      say(placed.world === 'alpine', `the place ${name} is in the alpine (${placed.world}, ${s} m)`);
      const low = await page.run(TIER('low'));
      const mid = await page.run(TIER('mid'));
      const high = await page.run(TIER('high'));
      const add = (a, b) => ({ calls: a.calls - b.calls, triangles: a.triangles - b.triangles, programs: a.programs - b.programs });
      const addHigh = add(high, low);
      const addMid = add(mid, low);
      console.error(`     the place ${name}: what it adds to a frame: at high ${addHigh.calls} calls and ${addHigh.triangles} triangles, ${addHigh.programs} programs; at mid ${addMid.calls} calls and ${addMid.triangles} triangles`);
      say(low.stats.poles === 0 && low.stats.falls === 0 && low.stats.plumes === 0, `${name}: at the lowest tier none of it is drawn`);
      say(addHigh.calls >= 1 && addHigh.calls <= 8 && addHigh.triangles > 0 && addHigh.triangles <= 60000, `${name}: at the high tier at most 8 draw calls and 60 000 triangles (${addHigh.calls}, ${addHigh.triangles})`);
      say(addMid.calls <= 4 && addMid.triangles <= 30000, `${name}: at the mid tier half of that (${addMid.calls}, ${addMid.triangles})`);
      say(high.stats.poles >= 40, `${name}: ${high.stats.poles} poles drawn, ${high.stats.falls} waterfalls, ${high.stats.plumes} plumes`);
      if (name === 'valley') say(high.stats.falls >= 1 && high.stats.plumes >= 1 && high.stats.plumes <= 6, `${name}: waterfalls and plumes are drawn`);
    }
    // The styles, at the place valley.
    await page.run(PLACE(PLACES.valley));
    for (const id of ['real', 'paint', 'ink', 'cel', 'print', 'pixel', 'block']) {
      const r = await page.run(STYLED(id));
      if (r.error) {
        say(false, `${id}: ${r.error}`);
        continue;
      }
      say(r.highErrors <= r.lowErrors && r.changed > 0.0002, `${id}: it draws with the alpine's things (${(r.changed * 100).toFixed(2)}% of the frame is different from the frame at low, ${r.highErrors} GL errors against ${r.lowErrors})`);
      if (id === 'real') say(r.highWhite >= r.lowWhite - 1e-9, `real: the upper frame has ${(r.highWhite * 100).toFixed(2)}% white with them, ${(r.lowWhite * 100).toFixed(2)}% without`);
      if (id === 'block') say(r.drawn.poles > 0, 'block: the poles are drawn (square columns)');
      if (keep) {
        writeFileSync(`${keep}${id}-low.png`, Buffer.from(r.lowPng.replace(/^data:image\/png;base64,/, ''), 'base64'));
        writeFileSync(`${keep}${id}-high.png`, Buffer.from(r.highPng.replace(/^data:image\/png;base64,/, ''), 'base64'));
      }
    }
    await page.run("g.style.set('real', true); g.style.applyScene(); return 1;");
    say(!page.logs.some((l) => /shader|program|THREE\.WebGL/i.test(l)), `no shader or program error on the console (${page.logs.length} errors in all${page.logs.length ? ': ' + page.logs[0].slice(0, 160) : ''})`);

    // A minute of driving in the alpine, in the open, from the place valley: the bells.
    await page.run(PLACE(PLACES.valley));
    const minute = await page.run(MINUTE);
    if (minute.error) throw new Error(minute.error);
    say(minute.world === 'alpine' && minute.rings >= 3 && minute.rings <= 7, `a minute driven in the alpine has ${minute.rings} bell rings (3 to 7), the world there is ${minute.world}, at ${span(minute.at, 1)} s`);

    // Let go.
    const gone = await page.run(DISPOSE);
    say(gone.before.children - gone.after.children >= 1, `disposed of: ${gone.before.geometries - gone.after.geometries} geometries and ${gone.before.children - gone.after.children} objects gone`);
  } finally {
    if (page) page.close();
    server.kill();
  }
}

// --- the sound, rendered offline in the page --------------------------------------------------------

// In the page: the sound over states made up for it (src/ui/sound.js), each rendered offline to 32 kHz stereo and handed back as a 16-bit
// WAV in base64 (a few seconds of each: a float for every sample would be tens of millions of them over the wire).
const SOUND = `
  const { Sound } = await import('./src/ui/sound.js');
  const RATE = 32000;
  const pack = (buf) => {
    const ch = buf.numberOfChannels;
    const n = buf.length;
    const bytes = new Uint8Array(44 + n * ch * 2);
    const v = new DataView(bytes.buffer);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVEfmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * ch * 2, true);
    v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * ch * 2, true);
    const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
    let peak = 0;
    for (let i = 0, o = 44; i < n; i++) {
      for (let c = 0; c < ch; c++, o += 2) {
        peak = Math.max(peak, Math.abs(data[c][i]));
        v.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 32767, true);
      }
    }
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { wav: btoa(s), peak };
  };
  const render = async (seconds, step) => {
    const ctx = new OfflineAudioContext(2, Math.ceil(RATE * seconds), RATE);
    const snd = new Sound(ctx);
    for (let i = 0, n = Math.round(seconds * 60); i < n; i++) snd.update(step(i, i / 60), i / 60);
    return pack(await ctx.startRendering());
  };
  const base = (extra) => (i, t) => ({ speed: 22, throttle: 0.3, lift: 1, a: 0, b: 0, blend: 0, inside: 0, distance: 8, on: 1, air: 0, time: t, ...extra(i, t) });
  const out = {};
  // A waterfall at 0 (none), 0.15, 0.5 and 1, on the left (-1), each for 3 s; and at 1 on the right.
  const levels = [0, 0.15, 0.5, 1];
  out.fall = await render(3 * levels.length, base((i, t) => ({ fall: levels[Math.min(levels.length - 1, Math.floor(t / 3))], fallPan: -1 })));
  out.fallRight = await render(3, base(() => ({ fall: 1, fallPan: 1 })));
  // The same in the hills, where there are none of them, and the hills with no waterfall to hear.
  out.fallHills = await render(3, base(() => ({ a: 1, b: 1, fall: 1, fallPan: 0 })));
  out.hillsNone = await render(3, base(() => ({ a: 1, b: 1, fall: 0, fallPan: 0 })));
  // A bell rings at 5 s (bells counts up, ring is the ring of that number): two strokes, 0.5 s apart.
  const ring = { pan: 0, strokes: [{ at: 0, pitch: 600, level: 1 }, { at: 0.5, pitch: 640, level: 0.8 }] };
  out.bells = await render(10, base((i, t) => ({ bells: t < 5 ? 0 : 1, ring })));
  out.bellsHills = await render(10, base((i, t) => ({ a: 1, b: 1, bells: t < 5 ? 0 : 1, ring })));
  return out;
`;

async function soundPart() {
  const { readWav, level } = await import('./sound_measure.mjs');
  const server = serve();
  if (!(await waitForServer())) {
    console.error('FAIL: no server');
    server.kill();
    process.exit(1);
  }
  let page = null;
  try {
    page = await openPage('seed=7&world=alpine&run=1&cam=chase');
    const r = await page.run(SOUND);
    if (r.error) throw new Error(r.error);
    const w = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, readWav(v.wav)]));
    const band = (x, t0, t1, lo = 800, hi = 6000) => level(x.mono, x.rate, t0, t1, lo, hi);
    // (Sound.update eases its levels: 0.25 s.)
    const steps = [0, 1, 2, 3].map((k) => band(w.fall, k * 3 + 1.3, k * 3 + 2.9));
    say(steps[1] > steps[0] && steps[2] > steps[1] && steps[3] > steps[2] && steps[3] > steps[0] + 6,
      `the rush of a waterfall is louder the nearer: ${steps.map((v) => f(v, 1)).join(', ')} dBFS between 0.8 and 6 kHz at 0, 0.15, 0.5 and 1 (the last at least 6 dB over the first)`);
    const ear = (x, c, t0, t1) => level(x.data[c], x.rate, t0, t1, 800, 6000);
    const left = ear(w.fall, 0, 10.3, 11.9) - ear(w.fall, 1, 10.3, 11.9);
    const right = ear(w.fallRight, 1, 1.3, 2.9) - ear(w.fallRight, 0, 1.3, 2.9);
    say(left > 3 && right > 3, `and put to the side it is on: ${f(left, 1)} dB louder in the left ear from the left, ${f(right, 1)} dB in the right from the right`);
    const hills = Math.abs(band(w.fallHills, 1.3, 2.9) - band(w.hillsNone, 1.3, 2.9));
    say(hills < 1, `where the world has none of it there is none: ${f(hills, 2)} dB between a waterfall and none, in the hills`);
    // The bells: a ring at 5 s, two strokes (at 5 s and 5.5 s), in 450 to 2500 Hz, in windows of 50 ms.
    const win = (x, from, to) => {
      const out = [];
      for (let t = from; t < to; t += 0.05) out.push(level(x.mono, x.rate, t, t + 0.05, 450, 2500));
      return out;
    };
    const before = Math.max(...win(w.bells, 1, 4.9));
    const first = Math.max(...win(w.bells, 5, 5.2));
    say(first > before + 6, `a bell is heard when it rings: ${f(first, 1)} dBFS in the first 0.2 s against ${f(before, 1)} before it (at least 6 dB over)`);
    const later = Math.max(...win(w.bells, 5.3, 5.45));
    say(later < first - 6, `and dies away: ${f(later, 1)} dBFS from 0.3 s on (at least 6 dB under)`);
    const second = Math.max(...win(w.bells, 5.5, 5.7));
    say(second > later + 6, `the second stroke is heard again: ${f(second, 1)} dBFS`);
    const hillsBells = Math.max(...win(w.bellsHills, 5, 7)) - Math.max(...win(w.bellsHills, 1, 4.9));
    say(hillsBells < 3, `none of it in the hills (${f(hillsBells, 1)} dB over what was there before)`);
    const peak = Math.max(r.bells.peak, r.fall.peak, r.fallRight.peak);
    say(peak < 0.9, `and nothing clips: the loudest sample is ${f(peak, 3)} of full scale (under 0.9)`);
  } finally {
    if (page) page.close();
    server.kill();
  }
}

// --- run ------------------------------------------------------------------------------------------

if (WANT('--node')) {
  nodePlan();
  nodeBells();
  await nodeSound();
  await nodeRender();
}
if (WANT('--page')) await pagePart();
if (WANT('--sound')) await soundPart();

if (failed) {
  console.error(`\n${failed} problem${failed > 1 ? 's' : ''}`);
  process.exit(1);
}
console.error('\nOK: the alpine has its snow poles, waterfalls, plumes and bells, where and as many as it should');
process.exit(0);
