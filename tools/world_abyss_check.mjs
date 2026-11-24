// What the deep sea has of its own: the moving light on its floor, the beams that
// come down from the surface, the bubbles, the jellyfish and the whale.
//
// In node, without a browser (world/abyssplan.js and the render code read with
// three.js and no GL, on a road and a land made up for it):
//  - the light on the floor: two patterns 3 m to a cell, the lesser taken; the sun's light
//    swings about its mean with it (the mean over the land within 4%), 0.8 of it at 60 m
//    under the surface and less deeper (0.3 of that at 140 m), none 140 m from the lens and
//    none on what faces the side; in half a second it has changed at 40% of the points or
//    more; it is the same at the same place and time (it is the world's, not the lens's),
//    and the pattern's own repeat (867 m) does not show as a seam;
//  - the beams: 8 at the high tier, 6 to 14 m wide, from the surface 80 m down, in a box of
//    220 m round the lens, each in the same place in the world as the lens goes on, each
//    lit by the same noise as the floor;
//  - the bubbles: from each of the four pads 12 a second, lasting 3 s; always going up,
//    swaying, growing and gone at the end of their life; a vent in each 200 m of road at
//    most, clear of the road and on land as it was;
//  - the jellyfish: 30 in a box of 160 m round the lens, every one in the water (over the
//    floor, under the surface), its bell beating in 3 to 5 s, going up and down;
//  - the whale: at most once in each 5 km of road, for 50 s, over the car 60 to 120 m and
//    under the surface; its shadow is over the car for 10 to 40 s of it; it calls once;
//  - the tiers: all of it at high, half at mid (one pattern of the light), none at low; and
//    nothing of it outside the deep sea; dispose() lets go of what it holds;
//  - the call: the sound has a whale's call for each, sliding between 60 and 180 Hz for 8 s,
//    in the deep sea and in no other world.
//
// In the real page, headless (seed 7, the place abyss of tools/look.mjs, software rendering):
//  - the light on the floor is on the road and on the car's roof: of 200 pixels of the road, half a
//    second on, at least 25% are lighter or darker (much of it is in the kelp's shade), and of the roof 35%; the road's light goes with the pattern
//    worked out for its place in the world;
//  - the bubbles are all going up; the jellyfish are all in the water;
//  - with a whale going over, the top 30% of the frame is at least 10% darker for 10 to 40 s;
//  - the tiers; what it adds to a frame is at most 8 draws and 60 thousand triangles; every
//    style draws it without an error.
//
// Usage: node tools/world_abyss_check.mjs [--node]
// --node: only the part in node (no browser, a few seconds).
// PORT=8362 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { register } from 'node:module';
import {
  ABYSS, SURFACE, CAUSTIC, BEAMS, BUBBLE, VENT, JELLY, WHALE, AbyssPlan, causticAt, causticMean, causticShare, causticLight,
  beamTop, beamSeed, bubbleAt, bubbleRise, jellySeed, jellyY, jellyBeat, whaleSeed, whaleOffset, whaleShade,
} from '../src/world/abyssplan.js';
import { HALF_FLAT } from '../src/world/road.js';
import { WORLD_INDEX } from '../src/world/worlds.js';
import { Sound } from '../src/ui/sound.js';

let failed = 0;
const say = (ok, text) => {
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};
const f = (x, k = 2) => (typeof x === 'number' ? x.toFixed(k) : String(x));
const ROOT = new URL('..', import.meta.url).pathname;

// --- the light on the floor ----------------------------------------------------------------

{
  const m2 = causticMean(2);
  const m1 = causticMean(1);
  // Its mean over another stretch of land, and the factor's.
  let sum = 0;
  let lo = 9;
  let hi = 0;
  const n = 40000;
  for (let i = 0; i < n; i++) {
    const x = 5000 + ((i * 0.6180339) % 1) * 600;
    const z = -3000 + ((i * 0.7548777) % 1) * 600;
    const k = causticLight(x, -60, z, 12.5, 10, 1, 2, m2);
    sum += k;
    lo = Math.min(lo, k);
    hi = Math.max(hi, k);
  }
  say(Math.abs(sum / n - 1) < 0.04 && m2 > 0.05 && m1 > 0.1,
    `the sun's light swings about its mean with the pattern: ${f(sum / n, 3)} on the whole (1, within 4%: the pattern's own mean goes 3% either way as the two lie on each other), from ${f(lo)} to ${f(hi)} at 60 m (the pattern's means ${f(m2, 3)} with two, ${f(m1, 3)} with one)`);
  say(CAUSTIC.strength === 0.8 && CAUSTIC.cell === 3, `${CAUSTIC.strength} of the sun's light, in cells of ${CAUSTIC.cell} m`);
  const sh = [-60, -100, -120, -140, -200].map((y) => causticShare(y, 0));
  say(Math.abs(sh[0] - 1) < 1e-9 && Math.abs(sh[3] - 0.3) < 1e-9 && Math.abs(sh[4] - 0.3) < 1e-9 && sh[1] < sh[0] && sh[2] < sh[1] && sh[3] < sh[2],
    `as much of it as the depth leaves: ${sh.map((v) => f(v)).join(', ')} at 60, 100, 120, 140, 200 m`);
  const far = [0, 80, 90, 120, 140, 200].map((d) => causticShare(-60, d));
  say(far[0] === 1 && far[2] === 1 && far[4] === 0 && far[5] === 0 && far[3] > 0 && far[3] < 1, `and as the distance leaves: ${far.map((v) => f(v)).join(', ')} at 0, 80, 90, 120, 140, 200 m from the lens (none past 140 m, so it does not shimmer far off)`);
  say(causticLight(10, -60, 10, 0, 10, 0.1) === 1 && causticLight(10, -60, 10, 0, 10, 1) !== 1, 'none on what faces the side');
  // It changes in half a second.
  let moved = 0;
  const m = 2000;
  for (let i = 0; i < m; i++) {
    const x = (i % 50) * 0.83 + 100;
    const z = Math.floor(i / 50) * 0.79 - 40;
    if (Math.abs(causticAt(x, z, 20.5) - causticAt(x, z, 20)) > 0.02) moved++;
  }
  say(moved / m >= 0.4, `in half a second it changes at ${f((100 * moved) / m, 0)}% of the points (40% or more)`);
  // The world's: the same at the same place and time, whoever asks; and its repeat is not a seam.
  const R = CAUSTIC.repeat * CAUSTIC.cell;
  let seam = 0;
  for (let i = 0; i < 200; i++) {
    const z = i * 0.37;
    seam = Math.max(seam, Math.abs(causticAt(R - 0.001, z, 3) - causticAt(-0.001, z, 3)));
  }
  say(causticAt(1234.5, -987.25, 77) === causticAt(1234.5, -987.25, 77) && seam < 1e-6 && R === 867,
    `the pattern is the world's, the same at the same place and time, and repeats every ${R} m with no seam (${seam.toExponential(1)})`);
}

// --- the bubbles, the beams, the jellyfish, the whale ----------------------------------------

{
  let up = true;
  let grows = true;
  for (let i = 0; i < 300; i++) {
    const a = (i / 300) * BUBBLE.ventLife;
    if (bubbleRise(a) <= 0) up = false;
    const p = bubbleAt(a, (i * 0.618) % 1, BUBBLE.ventLife);
    const q = bubbleAt(a + 0.01, (i * 0.618) % 1, BUBBLE.ventLife);
    if (p && q && !(q[1] > p[1])) up = false;
    if (p && q && !(q[3] > p[3])) grows = false;
  }
  say(up && grows && bubbleAt(BUBBLE.life, 0.3) === null && bubbleAt(BUBBLE.life - 0.01, 0.3) !== null,
    `a bubble rises the whole of its life (${f(bubbleRise(0))} m/s at its start, ${f(bubbleRise(BUBBLE.life))} at ${BUBBLE.life} s), grows, and is gone at ${BUBBLE.life} s`);
  say(BUBBLE.rate === 12 && BUBBLE.pads.length === 4 && BUBBLE.life === 3, `${BUBBLE.rate} a second from each of the ${BUBBLE.pads.length} pads, lasting ${BUBBLE.life} s`);
  const sway = Math.max(...Array.from({ length: 100 }, (_, i) => Math.hypot(bubbleAt(i * 0.029, 0.4)[0], bubbleAt(i * 0.029, 0.4)[2])));
  say(sway > 0.05 && sway <= BUBBLE.sway[0] * 1.5, `and sways from side to side, ${f(sway)} m at the most`);
}

{
  let ok = true;
  let wide = [99, 0];
  for (let n = 0; n < BEAMS.count; n++) {
    const b = beamSeed(n, 7);
    wide = [Math.min(wide[0], b.width), Math.max(wide[1], b.width)];
    const [x, z] = beamTop(n, 7, 1000, 500);
    if (Math.abs(x - 1000) > BEAMS.box / 2 + 1e-9 || Math.abs(z - 500) > BEAMS.box / 2 + 1e-9) ok = false;
    // The lens goes on 30 m: a beam not at the wall of the box is where it was.
    const [x2, z2] = beamTop(n, 7, 1030, 500);
    if (Math.abs(x - 1030) < BEAMS.box / 2 - 1 && (x2 !== x || z2 !== z)) ok = false;
  }
  say(ok && BEAMS.count === 8 && wide[0] >= 6 && wide[1] <= 14 && BEAMS.length === 80,
    `${BEAMS.count} beams, ${f(wide[0], 1)} to ${f(wide[1], 1)} m wide, ${BEAMS.length} m down from the surface, in a box of ${BEAMS.box} m, each where it was in the world as the lens goes on`);
}

{
  let ok = true;
  let beats = 0;
  for (let n = 0; n < JELLY.count; n++) {
    const j = jellySeed(n, 7);
    for (let t = 0; t < 200; t += 0.7) {
      const y = jellyY(j, -120, t);
      if (y === null || y - j.size < -120 + JELLY.floor - 1e-9 || y + j.size > SURFACE - JELLY.top + 1e-9) ok = false;
    }
    if (j.pulse >= 3 && j.pulse <= 5 && jellyBeat(j, 0) >= 0 && jellyBeat(j, 0) <= 1) beats++;
  }
  // Over a seamount 6 m under the surface there is no room: none is drawn there.
  say(ok && beats === JELLY.count && jellyY(jellySeed(0, 7), -6, 0) === null,
    `${JELLY.count} jellyfish, each at every moment over the floor and under the surface (at a floor of 120 m), each bell beating in 3 to 5 s; none where there is no room`);
}

{
  let ok = true;
  for (let k = 0; k < 200; k++) {
    const w = whaleSeed(k, 7);
    if (w.s < k * WHALE.every || w.s >= (k + 1) * WHALE.every || w.over < 60 || w.over > 120) ok = false;
  }
  let dark = 0;
  for (let t = 0; t <= WHALE.time; t += 0.1) if (whaleShade(t) > 0.34) dark += 0.1;
  say(ok && WHALE.length === 25 && WHALE.speed === 4 && WHALE.time === 50 && whaleOffset(0) < 0 && whaleOffset(WHALE.time) > 0,
    `a whale ${WHALE.length} m long, in each 5 km of road at one place of it, ${WHALE.over[0]} to ${WHALE.over[1]} m over the car, going ${WHALE.speed} m/s faster than it from ${-whaleOffset(0)} m behind to ${whaleOffset(WHALE.time)} m ahead in ${WHALE.time} s`);
  say(dark >= 10 && dark <= 40, `its shadow is a third or more over the car for ${f(dark, 1)} s of it (10 to 40)`);
}

// --- the render code, read in node ------------------------------------------------------

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { if (s === 'three') return { url: ${JSON.stringify('file://' + ROOT + 'tools/vendor/three.module.js')}, shortCircuit: true }; return n(s, c); }`));
const THREE = await import('three');
const { Abyss } = await import('../src/render/abyss.js');
const { causticU } = await import('../src/render/atmosphere.js');

// A road along +x that winds a little, on a floor 120 m down with a seamount; all of it the deep
// sea's, or none of it (for the other worlds).
function makeEnv(world = ABYSS) {
  const road = {
    origin: { x: 0, z: 0 },
    at(s) {
      if (s < -500 || s > 60000) return null;
      return { x: s, z: Math.sin(s / 300) * 30, y: -118, theta: Math.atan(Math.cos(s / 300) * 0.1), bank: 0, kind: 0 };
    },
  };
  const land = { heightAt: (x, z) => -120 + 3 * Math.sin(x / 40) * Math.cos(z / 55) + (Math.hypot(x - 3000, z - 400) < 300 ? 100 : 0) };
  const at = { a: world, b: world, t: 0, u: 0 };
  const worlds = { at: () => at, reaches: (x, z, r, test) => test({ id: world === ABYSS ? 'abyss' : 'hills' }) };
  return { road, land, worlds, corridor: { heightAt: land.heightAt }, seed: 7, at };
}

function drive(abyss, env, seconds, { tier = 'high', from = 1000, speed = 22, dt = 1 / 30, each } = {}) {
  abyss.setTier(tier);
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 9000);
  const car = { x: 0, y: -118, z: 0, yaw: 0 };
  let s = from;
  for (let i = 0; i < seconds / dt; i++) {
    s += speed * dt;
    const p = env.road.at(s);
    car.x = p.x;
    car.z = p.z;
    car.yaw = p.theta;
    camera.position.set(p.x - 9, -114, p.z);
    camera.lookAt(p.x + 40, -117, p.z);
    camera.updateMatrixWorld();
    abyss.update(camera, dt, { at: env.at, sCar: s, car, camera, blocks: 0, px: 600, fogColor: new THREE.Color(0x0d4a56), sunColor: new THREE.Color(0x8fd8e6) });
    if (each) each(abyss, s, camera);
  }
  return { s, camera, car };
}

{
  const env = makeEnv();
  const scene = new THREE.Scene();
  const abyss = new Abyss(scene, env, 'high');
  let up = true;
  let inWater = true;
  let jellies = 0;
  let maxBubbles = 0;
  let prev = null;
  drive(abyss, env, 6, {
    each: (a) => {
      const now = a.bubbles.list(a.clock);
      maxBubbles = Math.max(maxBubbles, now.length);
      prev = now;
      for (const j of a.jellies.list) {
        if (!(j[1] - j[3] > j[4] && j[1] + j[3] < SURFACE)) inWater = false;
      }
      jellies = Math.max(jellies, a.jellies.count);
    },
  });
  // The bubbles a moment on: each that is still about is higher.
  const t0 = abyss.clock;
  const before = abyss.bubbles.list(t0);
  const after = abyss.bubbles.list(t0 + 0.05);
  for (let i = 0; i < Math.min(before.length, after.length); i++) if (!(after[i][1] > before[i][1])) up = false;
  const st = abyss.stats();
  say(st.on && st.caustic > 0.79 && st.layers === 2 && st.beams === BEAMS.count && jellies === JELLY.count && inWater,
    `at the high tier in the deep sea: the light on the floor (${st.caustic}, ${st.layers} patterns), ${st.beams} beams, ${jellies} jellyfish, every one in the water`);
  const pads = BUBBLE.rate * BUBBLE.pads.length * BUBBLE.life;
  say(up && prev && maxBubbles >= pads * 0.9 && maxBubbles <= BUBBLE.slots && st.vents >= 1,
    `${maxBubbles} bubbles about at the most (${pads} from the pads, the rest from ${st.vents} vents near), every one going up`);
  // The vents: one in each 200 m at most, clear of the road, on land as it was.
  let vents = 0;
  let clear = true;
  for (let k = 0; k < 100; k++) {
    const v = abyss.plan.vent(k);
    if (!v) continue;
    vents++;
    const p = env.road.at(v.s);
    if (Math.hypot(v.ax - p.x, v.az - p.z) < HALF_FLAT + 8 || v.y !== env.land.heightAt(v.ax, v.az)) clear = false;
  }
  say(vents >= 60 && vents <= 100 && clear, `${vents} vents in 20 km of road (one in each ${VENT.every} m at most), each clear of the road, on the floor`);
  abyss.dispose();
}

{
  // 30 km of road: the whales, their shadow and their calls.
  const env = makeEnv();
  const abyss = new Abyss(new THREE.Scene(), env, 'high');
  const cells = new Map();
  let dark = 0;
  let darkRuns = [];
  let over = [99, 0];
  let lastPass = 0;
  drive(abyss, env, 30000 / 22, {
    dt: 0.25,
    each: (a, s, cam) => {
      if (a.passes !== lastPass) {
        lastPass = a.passes;
        const k = Math.floor(s / WHALE.every);
        cells.set(k, (cells.get(k) || 0) + 1);
      }
      if (a.whale.mesh.visible) {
        const h = a.whale.mesh.position.y - -118;
        over = [Math.min(over[0], h), Math.max(over[1], h)];
        if (a.whale.mesh.position.y > SURFACE - WHALE.under) over[1] = 999;
      }
      if (a.shade > 0.34) dark += 0.25;
      else if (dark > 0) {
        darkRuns.push(dark);
        dark = 0;
      }
    },
  });
  const most = Math.max(...cells.values());
  say(abyss.passes >= 4 && abyss.passes <= 6 && most === 1, `${abyss.passes} whales in 30 km, none twice in the same 5 km`);
  say(darkRuns.length === abyss.passes && darkRuns.every((d) => d >= 10 && d <= 40), `its shadow over the car for ${darkRuns.map((d) => f(d, 1)).join(', ')} s (10 to 40)`);
  say(over[0] >= 60 - 1e-6 && over[1] <= 120 + 1e-6, `${f(over[0], 0)} to ${f(over[1], 0)} m over the car, under the surface`);
  say(abyss.calls === abyss.passes, `one call each (${abyss.calls})`);
  abyss.dispose();
}

{
  // The tiers, and the other worlds.
  const env = makeEnv();
  const abyss = new Abyss(new THREE.Scene(), env, 'mid');
  drive(abyss, env, 4, { tier: 'mid' });
  const mid = abyss.stats();
  drive(abyss, env, 4, { tier: 'low' });
  const low = abyss.stats();
  const lowDrawn = abyss.meshes().some((m) => m.visible);
  say(mid.beams === BEAMS.count / 2 && mid.jellies === JELLY.count / 2 && mid.layers === 1 && mid.caustic > 0 && mid.bubbles > 0 && mid.bubbles < BUBBLE.rate * 4 * BUBBLE.life * 0.75,
    `at the mid tier: ${mid.beams} beams, ${mid.jellies} jellyfish, ${mid.layers} pattern of the light, ${mid.bubbles} bubbles about`);
  say(low.caustic === 0 && !lowDrawn && low.beams === 0 && low.jellies === 0, 'at the low tier none of it is drawn and the light on the floor is what it was');
  abyss.dispose();
  const hills = makeEnv(WORLD_INDEX.hills);
  const other = new Abyss(new THREE.Scene(), hills, 'high');
  drive(other, hills, 4);
  const o = other.stats();
  say(!o.on && o.caustic === 0 && !other.meshes().some((m) => m.visible) && o.bubbles === 0, 'out of reach of the deep sea none of it is drawn or worked out');
  // dispose lets go of the geometry and the materials.
  let gone = 0;
  for (const m of other.meshes()) {
    m.geometry.addEventListener('dispose', () => gone++);
    m.material.addEventListener('dispose', () => gone++);
  }
  other.dispose();
  say(gone === 2 * other.meshes().length && other.meshes().every((m) => !m.parent) && causticU.uCaustic.value.x === 0, `dispose() lets go of ${gone} geometries and materials and takes them out of the scene`);
}

{
  // The call.
  const param = () => ({ value: 0, ramps: [], setTargetAtTime() {}, setValueAtTime(v) { this.ramps.push(v); }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime(v) { this.ramps.push(v); } });
  const made = [];
  const node = (kind) => { const n = { kind, edges: [], gain: param(), frequency: param(), Q: param(), connect(to) { this.edges.push(to); return to; }, start() {}, stop(t) { this.end = t; } }; made.push(n); return n; };
  const ctx = {
    sampleRate: 4000, currentTime: 0, destination: node('destination'),
    createGain: () => node('gain'), createBiquadFilter: () => node('filter'), createOscillator: () => node('osc'),
    createBufferSource: () => ({ ...node('source'), playbackRate: param() }), createConvolver: () => node('convolver'),
    createDynamicsCompressor: () => ({ ...node('comp'), threshold: param(), ratio: param(), knee: param(), attack: param(), release: param() }),
    createStereoPanner: () => ({ ...node('panner'), pan: param() }),
    createBuffer: (ch, n) => ({ getChannelData: () => new Float32Array(n) }),
  };
  const calls = (world) => {
    const sound = new Sound(ctx);
    const st = { speed: 20, throttle: 0.5, lift: 1, a: world, b: world, blend: 0, inside: 0, distance: 8, on: 1 };
    sound.update({ ...st, whales: 0 }, 1);
    const n0 = made.length;
    sound.update({ ...st, whales: 1 }, 2);
    return made.slice(n0).filter((n) => n.kind === 'osc' && n.frequency.ramps.length >= 3);
  };
  const deep = calls(ABYSS);
  const hz = deep.length ? deep[0].frequency.ramps : [];
  say(deep.length >= 1 && Math.min(...hz) >= 60 && Math.max(...hz) <= 180 && Math.abs(deep[0].end - 2 - 8.1) < 0.01,
    `a whale's call in the deep sea: a slide through ${hz.map((v) => f(v, 0)).join(', ')} Hz, 8 s long`);
  say(calls(WORLD_INDEX.hills).length === 0, 'and none in another world');
}

if (process.argv.includes('--node')) {
  console.error(failed ? `\nFAILED: ${failed} check(s)` : '\nOK (the part in node)');
  process.exit(failed ? 1 : 0);
}

// --- in the page ---------------------------------------------------------------------

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8197;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const profile = `${tmpdir()}/continuum-abyss-world-${process.pid}-${Date.now()}`;
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

// What every test of the page has: the frame as the post chain makes it (grab), its luminance at a
// pixel (lum, y up), where a place of the scene is on the screen (screen), the deep sea's clock moved on
// alone with the rest standing (hold).
const LIB = String.raw`
  const THREE = await import('three');
  const P = await import('./src/world/abyssplan.js');
  const A = g.abyss;
  const canvas = document.getElementById('view');
  const shaderErrors = window.__shaderErrors || (window.__shaderErrors = []);
  g.renderer.debug.onShaderError = (gl, program) => { shaderErrors.push(String(gl.getProgramInfoLog(program)).slice(0, 400)); };
  const grab = () => {
    g.render();
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(canvas, 0, 0);
    return { w: c.width, h: c.height, data: x.getImageData(0, 0, c.width, c.height).data };
  };
  const lum = (fr, x, y) => {
    const px = Math.round(x), py = fr.h - 1 - Math.round(y);
    if (px < 0 || py < 0 || px >= fr.w || py >= fr.h) return null;
    const i = (py * fr.w + px) * 4;
    return (0.2126 * fr.data[i] + 0.7152 * fr.data[i + 1] + 0.0722 * fr.data[i + 2]) / 255;
  };
  const screen = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(g.camera);
    return { x: (v.x * 0.5 + 0.5) * canvas.width, y: (v.y * 0.5 + 0.5) * canvas.height, z: v.z };
  };
  const ctx = () => g._abyssCtx(g.sceneHeight);
  const hold = (dt) => { A.update(g.camera, dt, ctx()); g._light(0, 0); };
`;

const web = spawn('node', [ROOT + 'tools/serve.mjs', String(PORT), ROOT], { stdio: ['ignore', 'ignore', 'inherit'] });
try {
  if (!(await waitForServer())) throw new Error('no server');
  const page = await openPage('seed=7&world=abyss&s=2200&cam=chase&style=real&run=60');
  try {
    const light = await page.run(`${LIB}
      const st = g.snapshot().abyss;
      // 200 points of the road 12 to 40 m ahead and 200 of the car's roof, in the frame, and half a second on.
      const o = g.road.origin;
      const road = [];
      for (let i = 0; road.length < 200 && i < 4000; i++) {
        const s = g.sCar + 12 + ((i * 0.618) % 1) * 28;
        const p = g.road.at(s);
        const lat = (((i * 0.382) % 1) - 0.5) * 6;
        const x = p.x - Math.sin(p.theta) * lat, z = p.z + Math.cos(p.theta) * lat, y = g.road.surfaceAt(s, lat);
        const q = screen(x, y + 0.02, z);
        if (q.z > -1 && q.z < 1 && q.x > 2 && q.y > 2 && q.x < canvas.width - 2 && q.y < canvas.height - 2) road.push({ q, x: x + o.x, z: z + o.z, y });
      }
      const box = new THREE.Box3().setFromObject(g.carModel);
      const roof = [];
      const ray = new THREE.Raycaster();
      for (let i = 0; roof.length < 200 && i < 4000; i++) {
        const x = box.min.x + (box.max.x - box.min.x) * (0.25 + 0.5 * ((i * 0.618) % 1));
        const z = box.min.z + (box.max.z - box.min.z) * (0.25 + 0.5 * ((i * 0.382) % 1));
        ray.set(new THREE.Vector3(x, box.max.y + 1, z), new THREE.Vector3(0, -1, 0));
        const hit = ray.intersectObject(g.carModel, true)[0];
        if (!hit || hit.face.normal.y < 0.5) continue;
        const q = screen(hit.point.x, hit.point.y, hit.point.z);
        const v = new THREE.Vector3().subVectors(hit.point, g.camera.position).normalize();
        ray.set(g.camera.position, v);
        const seen = ray.intersectObject(g.carModel, true)[0];
        if (seen && seen.point.distanceTo(hit.point) < 0.05) roof.push({ q });
      }
      const a = grab();
      hold(0.5);
      const b = grab();
      const changed = (pts) => pts.filter((p) => Math.abs(lum(a, p.q.x, p.q.y) - lum(b, p.q.x, p.q.y)) >= 0.008).length / Math.max(pts.length, 1);
      // The road's light against the pattern worked out for its place: the more of it, the lighter.
      const t = A.clock;
      const xs = road.map((p) => P.causticAt(p.x, p.z, t));
      const ys = road.map((p) => lum(b, p.q.x, p.q.y));
      const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
      return { st, road: road.length, roof: roof.length, roadChanged: changed(road), roofChanged: changed(roof), corr: sxy / Math.sqrt(sxx * syy), errors: shaderErrors.length };`);
    say(!light.error && light.st && light.st.on && light.st.caustic > 0.3 && light.errors === 0, `in the page the deep sea's things are on (${JSON.stringify(light.st)})${light.error ? ' ' + light.error : ''}`);
    say(!light.error && light.road >= 200 && light.roadChanged >= 0.25, `the light on the road: ${f(100 * light.roadChanged, 0)}% of ${light.road} pixels changed in half a second (25% or more: much of the road is in the kelp's shade, where the change is under a level)`);
    say(!light.error && light.roof >= 100 && light.roofChanged >= 0.35, `and on the car's roof: ${f(100 * light.roofChanged, 0)}% of ${light.roof} pixels (35% or more; 38% measured)`);
    say(!light.error && light.corr > 0.2, `the road is lighter where the pattern worked out for its place in the world is (correlation ${f(light.corr)})`);

    const things = await page.run(`${LIB}
      for (let i = 0; i < 60; i++) g.update(1 / 30);
      const t = A.clock;
      const b0 = A.bubbles.list(t), b1 = A.bubbles.list(t + 0.05);
      let up = 0;
      for (let i = 0; i < Math.min(b0.length, b1.length); i++) if (b1[i][1] > b0[i][1]) up++;
      const jl = A.jellies.list;
      const wet = jl.filter((j) => j[1] - j[3] > j[4] && j[1] + j[3] < P.SURFACE).length;
      // What it adds: the frame with its things and without them.
      const info = g.renderer.info;
      info.autoReset = false;
      const count = () => { info.reset(); g.render(); return [info.render.calls, info.render.triangles]; };
      const withIt = count();
      const keep = A.meshes().map((m) => m.visible);
      A.meshes().forEach((m) => { m.visible = false; });
      const without = count();
      A.meshes().forEach((m, i) => { m.visible = keep[i]; });
      info.autoReset = true;
      return { bubbles: b0.length, up, jellies: jl.length, wet, calls: withIt[0] - without[0], tris: withIt[1] - without[1] };`);
    say(!things.error && things.bubbles > 50 && things.up === Math.min(things.bubbles, things.bubbles), `${things.up} of ${things.bubbles} bubbles going up`);
    say(!things.error && things.jellies >= 20 && things.wet === things.jellies, `${things.wet} of ${things.jellies} jellyfish in the water`);
    say(!things.error && things.calls <= 8 && things.tris <= 60000, `they add ${things.calls} draws and ${things.tris} triangles to the frame (8 and 60 thousand at most)`);

    const whale = await page.run(`${LIB}
      const top = (fr) => { let s = 0, n = 0; for (let y = Math.floor(fr.h * 0.7); y < fr.h; y += 3) for (let x = 0; x < fr.w; x += 5) { s += lum(fr, x, y); n++; } return s / n; };
      const before = top(grab());
      A.pass = { w: P.whaleSeed(99, 7), t0: A.clock, called: false };
      const lit = [];
      for (let k = 0; k <= P.WHALE.time; k++) { hold(k === 0 ? 0 : 1); lit.push(top(grab())); }
      return { before, lit, calls: A.calls };`);
    const darker = whale.error ? [] : whale.lit.filter((v) => v <= whale.before * 0.9).length;
    say(!whale.error && darker >= 10 && darker <= 40, `with a whale going over, the top 30% of the frame is 10% darker or more for ${darker} s (10 to 40; ${f(whale.before, 3)} before, ${f(Math.min(...(whale.lit || [0])), 3)} at the darkest)`);

    const tiers = await page.run(`${LIB}
      g.setTier('mid'); hold(0.1); const mid = g.snapshot().abyss;
      g.setTier('low'); hold(0.1); const low = g.snapshot().abyss; const drawn = A.meshes().some((m) => m.visible);
      g.setTier('high'); hold(0.1);
      return { mid, low, drawn };`);
    say(!tiers.error && tiers.mid.beams === 4 && tiers.mid.jellies <= 15 && tiers.mid.layers === 1 && tiers.low.caustic === 0 && !tiers.drawn, `the tiers: ${JSON.stringify(tiers.mid)}; at low nothing`);

    const styles = await page.run(`${LIB}
      const out = {};
      for (const st of ['paint', 'ink', 'cel', 'print', 'pixel', 'block', 'real']) {
        g.style.set(st, true); g.style.applyScene(); g.post.setStyle(g.style);
        for (let i = 0; i < 3; i++) g.update(1 / 30);
        grab();
        out[st] = shaderErrors.length;
      }
      return out;`);
    say(!styles.error && Object.values(styles).every((v) => v === 0), `every style draws it without an error (${JSON.stringify(styles)})`);
    say(page.logs.length === 0, `with no error in the page (${page.logs[0] || 'none'})`);
  } finally {
    page.close();
  }
} finally {
  web.kill();
}

console.error(failed ? `\nFAILED: ${failed} check(s)` : '\nOK');
process.exit(failed ? 1 : 0);
