// What the Upside Down has of its own along the way in and about the car: the
// markers on the winding, the rain that falls the way up is here, the flash that
// comes down to the ground, the pods that burst, and the hum that sinks.
//
// In node, without a browser (world/upsidefx.js and the render code read with
// three.js and no GL, on a road and a land made up for it):
//  - the markers: a wound stretch of 200 m has 20 poles a side (40 in all, 10 m apart, a
//    metre and a fifth high with a lamp on each) and 8 arches (25 m apart, their crowns 6.4 m up,
//    a lamp at each), and 60 m of the same before it and after it; they stand at the
//    road's edge, level with it, and on a bridge on the parapet; a stretch of 450 m has
//    90 poles and 18 arches; they are laid while the car is within 2.5 km of the stretch
//    and not else; the mid tier has every second pole, the low tier none; what they are made of is
//    let go of by dispose();
//  - the rain: the ash in the air is rain from 300 m before the stretch to 300 m after it, over
//    60 m either side of that; the streaks are 0.4 m long, rise at 7.5 m/s, 4080 of them
//    at the high tier, half at the mid one, none at the low one; as much of the ash as is
//    rain is not ash, and with no rain the air's points are the numbers they were;
//  - the flash: in 300 s of the Upside Down every fifth flash comes down on the ground,
//    200 to 600 m on from the car, on the land's own height, clear of the road, in the
//    Upside Down's own land, the same place for the same flash; the tentacles within 40 m of it shrink
//    to 0.4 of their height at once and grow back in 1.4 s, the others do not; its scorch is
//    9 m across and is not there after 20 s, each moment less than the one before; the sky's own line is left
//    out of that flash;
//  - the pods: a pod within 8 m of the car bursts in the frame it comes within, throwing 20
//    spores (10 at the mid tier, none at the low, where the pod stays), each lasting 6 to 9 s, thrown out and
//    then carried up the world's way, dark red; the pod is gone from the ground;
//  - the hum: the Upside Down's drone is 49 Hz at the start and 34 Hz when the car has been in it
//    a minute and a half, on the way between at every step, and no other world's changes.
//
// In the real page, headless (seed 7, software rendering):
//  - over the way in from space (worlds 1500 m long), the markers stand along the stretch the
//    road is wound over, one pole to each 10 m of it a side and one arch to each 25; in the
//    frame, the lamps make it redder where they are worked out to be; from 300 m before the stretch the lamps of one side
//    are a spiral round the road's line, their angle round it going from 0 to a half
//    turn along the stretch and never back, each within 0.15 rad of the angle the road itself
//    is wound by there;
//  - a road that bends (seed 11) has a stretch of 200 m, with 40 poles and 8 arches on it;
//  - the rain: the points of the air are streaks from 300 m before the stretch to 300 m past it and
//    ash outside; in the frame the streaks lie the way the world's up is on the screen, which
//    is the way the view is rolled (their angle within 0.2 rad of it at three places in the
//    winding);
//  - in the Upside Down, over 300 s: the flashes and the ones that came down, all on the land, none
//    on the road, each 200 to 600 m on; in the frame at the moment a flash comes down, the bolt is
//    bright along its line, the scorch seen from over it is less and less and not there at 20 s;
//    a pod is taken by the car and its spores are in the frame where they are worked out to be;
//  - the tiers: at the low tier none of it is drawn, at the mid one the poles are half, the streaks are
//    half, a pod throws 10;
//  - what it adds to a frame is at most 8 more draws and 60 thousand more triangles, and the
//    other worlds have none of it;
//  - every style draws it without an error.
//
// Usage: node tools/world_upside_check.mjs [--node] [--only way,bend,hills,upside]
// --node: only the part that is in node (no browser, a few seconds).
// --only: only these pages of the part in the browser: the way in (the stretch, its markers, the
// rain, the tiers, the styles), a bend (seed 11), the hills, the Upside Down.
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { register } from 'node:module';
import {
  MARKS, RAIN, STRIKE, SPORES, markLayout, rainShare, gapTo, strikeSpot, boltPath, forkPath, sporeBurst, sporeAt, flinchScale,
} from '../src/world/upsidefx.js';
import { HALF_FLAT, HALF_PAVED } from '../src/world/road.js';
import { WORLD_INDEX } from '../src/world/worlds.js';
import { Sound } from '../src/ui/sound.js';

let failed = 0;
const say = (ok, text) => {
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};
const f = (x, k = 2) => (typeof x === 'number' ? x.toFixed(k) : String(x));

const ROOT = new URL('..', import.meta.url).pathname;
const UP = WORLD_INDEX.upside;

// --- the numbers ------------------------------------------------------------------

{
  const lay = markLayout(200);
  const gaps = (a) => a.slice(1).map((v, i) => v - a[i]);
  say(lay.poles.length === 20 && lay.arches.length === 8, `a stretch of 200 m has ${lay.poles.length} poles a side (${2 * lay.poles.length} in all) and ${lay.arches.length} arches`);
  say(gaps(lay.poles).every((g) => Math.abs(g - MARKS.every) < 1e-9) && MARKS.every === 10 && gaps(lay.arches).every((g) => Math.abs(g - MARKS.arch) < 1e-9) && MARKS.arch === 25,
    'the poles are 10 m apart and the arches 25 m');
  say(lay.lead.length === 12 && lay.lead.every((o) => (o < 0 && o > -MARKS.lead) || (o > 200 && o < 200 + MARKS.lead)) && MARKS.lead === 60
    && lay.leadArches.length === 4 && lay.leadArches.every((o) => (o < 0 && o > -MARKS.lead) || (o > 200 && o < 200 + MARKS.lead)),
  'and the same for 60 m before the stretch and after it');
  const big = markLayout(450);
  say(big.poles.length === 45 && big.arches.length === 18, `a stretch of 450 m has ${2 * big.poles.length} poles and ${big.arches.length} arches`);
  say(MARKS.height === 1.2 && MARKS.crown === 6.4 && MARKS.sees === 2500, `the poles are ${MARKS.height} m, the crowns ${MARKS.crown} m, and they are laid for a car within ${MARKS.sees} m of the stretch`);
}

{
  const shares = [0, 100, 299.9, 300, 330, 359.9, 360, 1000].map(rainShare);
  say(shares[0] === 1 && shares[3] === 1 && shares[6] === 0 && shares[7] === 0 && shares.every((v, i) => i === 0 || v <= shares[i - 1] + 1e-12),
    `the ash is rain up to ${RAIN.reach} m from the stretch (${shares.map((v) => f(v)).join(', ')} at 0, 100, 300, 330, 360, 1000 m), and none ${RAIN.ramp} m past that`);
  say(gapTo(5, 100, 300) === 95 && gapTo(150, 100, 300) === 0 && gapTo(340, 100, 300) === 40, 'how far from the stretch the car is along the road: 95, 0 in it, 40 past it');
  say(RAIN.length === 0.4 && RAIN.density === 0.34 && RAIN.speed > 0, `a streak is ${RAIN.length} m long and rises at ${RAIN.speed} m/s`);
}

{
  // Where flashes come down: from the flash's number alone.
  let aLo = 1e9;
  let aHi = 0;
  let sLo = 1e9;
  let sHi = 0;
  let same = true;
  for (let k = 1; k < 4000; k++) {
    const [a, s] = strikeSpot(7, k, 0);
    aLo = Math.min(aLo, a);
    aHi = Math.max(aHi, a);
    sLo = Math.min(sLo, Math.abs(s));
    sHi = Math.max(sHi, Math.abs(s));
    const [a2, s2] = strikeSpot(7, k, 0);
    if (a2 !== a || s2 !== s) same = false;
  }
  say(aLo >= 200 && aHi <= 580 && Math.hypot(aHi, sHi) <= 600 && sLo >= HALF_FLAT + 8, `a flash comes down ${f(aLo, 0)} to ${f(aHi, 0)} m on and ${f(sLo, 0)} to ${f(sHi, 0)} m to the side, at most ${f(Math.hypot(aHi, sHi), 0)} m from the car (200 to 600), clear of the road`);
  say(same && STRIKE.every === 5, 'the same flash comes down in the same place, one flash in five');
  const p = boltPath(5, 400, 600);
  const q = forkPath(5, 400, p);
  say(p.across[p.across.length - 1] === 0 && p.along[p.along.length - 1] === 0 && p.up[0] === 600 && p.up[p.up.length - 1] === 0,
    'the bolt is on the ground at its foot and as high as the cloud looks at its head');
  say(q.length > 10 && q[0].i / (STRIKE.nodes - 1) >= STRIKE.forkFrom - 0.03 && q.every((n, k) => k === 0 || n.fade <= q[k - 1].fade + 1e-9), 'and has a branch that leaves it a third of the way down and fades');
  say(STRIKE.radius * 2 >= 6 && STRIKE.life === 20 && STRIKE.near === 40 && STRIKE.floor === 0.4 && STRIKE.over === 1.4,
    `the scorch is ${STRIKE.radius * 2} m across and goes in ${STRIKE.life} s; the tentacles within ${STRIKE.near} m shrink to ${STRIKE.floor} of their height and grow back in ${STRIKE.over} s`);
  say(flinchScale(0) === 1 && Math.abs(flinchScale(1) - 0.4) < 1e-12 && flinchScale(0.5) > flinchScale(1) && flinchScale(0.5) < 1, 'a tentacle that has shrunk is 0.4 of its height, and is back to all of it by degrees');
}

{
  const b = sporeBurst(31);
  const lives = b.map((s) => s.life);
  say(b.length === SPORES.per && SPORES.per === 20 && Math.min(...lives) >= 6 && Math.max(...lives) <= 9 && SPORES.reach === 8,
    `a pod within ${SPORES.reach} m throws ${b.length} spores, each lasting ${f(Math.min(...lives), 1)} to ${f(Math.max(...lives), 1)} s`);
  // Out and then up: the way up is +y; at 4 s they have gone up and at 6 s further, however they were thrown.
  const p0 = [0, 0, 0];
  const meanY = (t) => b.reduce((s, sp) => s + sporeAt(p0, sp, t)[1], 0) / b.length;
  const rise = (meanY(6) - meanY(2)) / 4;
  say(meanY(6) > meanY(2) && meanY(2) > meanY(0.5) && Math.abs(rise - SPORES.rise) < 0.12, `they are carried up the world's way, ${f(rise)} m/s at the last (${f(SPORES.rise)})`);
  const far = b.map((sp) => Math.hypot(...sporeAt(p0, sp, 0.1).map((v, i) => v - (i === 1 ? 0 : 0))));
  say(Math.max(...b.map((sp) => Math.hypot(...sporeAt(p0, sp, 8)))) < 12 && Math.max(...far) < 1, 'slowly: none is more than a few metres from the pod, and in the first moment none has gone far');
  const r0 = ((SPORES.color >> 16) & 255) / 255;
  const g0 = ((SPORES.color >> 8) & 255) / 255;
  const b0 = (SPORES.color & 255) / 255;
  say(r0 > 0.6 && g0 < 0.15 && b0 < 0.1 && SPORES.glow > 1, `they shine dark red (${f(r0)}, ${f(g0)}, ${f(b0)})`);
}

// --- the hum -------------------------------------------------------------------------

{
  const param = () => ({ value: 0, last: null, setTargetAtTime(v, t, tau) { this.last = [v, t, tau]; }, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = (kind) => ({ kind, edges: [], gain: param(), frequency: param(), Q: param(), connect(to) { this.edges.push(to); return to; }, start() {}, stop() {} });
  const ctx = {
    sampleRate: 4000, currentTime: 0, destination: node('destination'),
    createGain: () => node('gain'), createBiquadFilter: () => node('filter'), createOscillator: () => node('osc'),
    createBufferSource: () => ({ ...node('source'), playbackRate: param() }), createConvolver: () => node('convolver'),
    createDynamicsCompressor: () => ({ ...node('comp'), threshold: param(), ratio: param(), knee: param(), attack: param(), release: param() }),
    createStereoPanner: () => ({ ...node('panner'), pan: param() }),
    createBuffer: (ch, n) => ({ getChannelData: () => new Float32Array(n) }),
  };
  const hum = (world, sink, sound = new Sound(ctx)) => {
    sound.update({ speed: 20, throttle: 0.5, lift: 1, a: world, b: world, blend: 0, inside: 0, distance: 8, on: 1, sink }, 1);
    const bed = sound.beds.find((b) => b.world === world);
    return [bed.drone[0].frequency.last && bed.drone[0].frequency.last[0], bed.drone[1].frequency.last && bed.drone[1].frequency.last[0]];
  };
  const hz = [0, 0.25, 0.5, 0.75, 1].map((k) => hum(UP, k)[0]);
  say(Math.abs(hz[0] - 49) < 1e-9 && Math.abs(hz[4] - 34) < 1e-9 && hz.every((v, i) => i === 0 || v < hz[i - 1]),
    `the Upside Down's hum is ${f(hz[0], 1)} Hz at the start and ${f(hz[4], 1)} Hz at the end of the way in, ${hz.map((v) => f(v, 1)).join(', ')} between`);
  say(Math.abs(hum(UP, 1)[1] - 34 * 1.505) < 1e-9, 'with its second voice a fifth above it, as it was');
  const others = [...Array(12).keys()].filter((w) => w !== UP && w !== WORLD_INDEX.inferno).map((w) => hum(w, 1)[0]);
  say(others.every((v) => v === null), 'no other world\'s hum is touched by it');
  const st = Sound.state({
    camera: { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }, car: { x: 0, y: 0, z: 0, speed: 0 }, presentation: {}, traffic: { cars: [] }, road: {},
    _lookAt: { a: UP, b: UP, t: 0 }, upside: { strikes: 0, rate: 0, roll: 0, infect: 0.7 },
  });
  say(st.sink === 0.7, 'the hum is read off how far the Upside Down has spread (infect)');
}

// --- the render code, read in node ------------------------------------------------------

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { if (s === 'three') return { url: ${JSON.stringify('file://' + ROOT + 'tools/vendor/three.module.js')}, shortCircuit: true }; return n(s, c); }`));
const THREE = await import('three');
const { Waymarks } = await import('../src/render/waymarks.js');
const { Motes } = await import('../src/render/motes.js');
const { Upside } = await import('../src/render/upside.js');
const { Clutter } = await import('../src/render/clutter.js');
const { Spores } = await import('../src/render/spores.js');
const { Strike } = await import('../src/render/strike.js');

// A road along +x with a bend, level at 3 m: the parts of it the markers and the
// flashes ask about.
function makeRoad(kind = 0) {
  const road = {
    origin: { x: 0, z: 0 },
    start: 0,
    classified: 25000,
    cuts: 0,
    at(s) {
      if (s < 0 || s > 49000) return null;
      return { x: s, z: Math.sin(s / 300) * 30, y: 3, theta: Math.atan(Math.cos(s / 300) * 0.1), bank: 0, kind: typeof kind === 'function' ? kind(s) : kind };
    },
    surfaceAt() { return 3; },
    nearestS(x, z, hint, span = 40) {
      let best = Infinity;
      let bs = hint;
      for (let s = Math.max(0, hint - span); s <= hint + span; s += 2) {
        const p = this.at(s);
        if (!p) continue;
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < best) { best = d; bs = s; }
      }
      return { s: bs, dist: best };
    },
  };
  return road;
}

{
  const lampsOf = (w) => w.lampList();
  const scene = new THREE.Scene();
  const road = makeRoad();
  const w = new Waymarks(scene, { road }, 'high');
  const zone = { s: 1000, run: 200 };
  w.update(0.016, zone, 800, 700);
  const c = w.counts;
  say(c.onPoles === 40 && c.onArches === 8 && c.poles === 64 && c.arches === 12, `laid along a stretch of 200 m: ${c.onPoles} poles and ${c.onArches} arches on it, ${c.poles} and ${c.arches} with 60 m before and after, ${c.lamps} lamps`);
  const ls = lampsOf(w);
  // The lamps of the poles are at the road's edge, a metre and a bit up; the lamps of the arches over the middle of the road.
  const poleLamps = ls.filter((l) => Math.abs(Math.abs(l[2] - road.at(l[0]).z) - 6.1) < 0.2);
  const archLamps = ls.filter((l) => l[1] > 3 + MARKS.crown);
  say(poleLamps.length === 64 && archLamps.length === 12, `the lamps are ${poleLamps.length} on poles, ${archLamps.length} at the crowns`);
  const left = poleLamps.filter((l) => l[2] - road.at(l[0]).z > 0).map((l) => l[0]).sort((a, b) => a - b);
  say(left.slice(1).every((x, i) => Math.abs(x - left[i] - 10) < 0.3) && left.length === 32, 'one side\'s lamps are 10 m apart, from 55 m before the stretch to 55 m past it');
  const crowns = archLamps.map((l) => l[0]).sort((a, b) => a - b);
  say(crowns.slice(1).every((x, i) => { const d = x - crowns[i]; return Math.abs(d - 25) < 0.5 || d > 50; }), 'the arches are 25 m apart');
  say(Math.abs(poleLamps[0][1] - (3 - 0.22 + MARKS.height - 0.07)) < 0.02 && Math.abs(archLamps[0][1] - (3 - 0.22 + MARKS.crown + 0.3)) < 0.02, 'a pole lamp is a metre and a fifth over the verge and an arch lamp 6.7 m over it');
  // A pole is across the road's way, an arch across it.
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const ps = new THREE.Vector3();
  w.arches.getMatrixAt(0, m);
  m.decompose(ps, q, sc);
  const across = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const p0 = road.at(ps.x);
  say(Math.abs(across.x - -Math.sin(p0.theta)) < 1e-6 && Math.abs(across.z - Math.cos(p0.theta)) < 1e-6 && Math.abs(ps.z - p0.z) < 1e-6, 'an arch is square across the road and in the middle of it');
  // The car further than 2.5 km from it: not laid.
  w.update(0.016, zone, 1000 - 100 - MARKS.sees - 10, 700);
  say(!w.poles.visible && !w.arches.visible && !w.lamps.visible, `with the car more than ${MARKS.sees} m from the stretch none of it is drawn`);
  w.update(0.016, zone, 1000 - 100 - MARKS.sees + 10, 700);
  say(w.poles.visible && w.arches.visible && w.lamps.visible && w.uniforms.uFade.value < 0.01, 'and within it all of it is, the lamps still dark at the edge of it');
  const fades = [500, 400, 250, 100].map((d) => { w.update(0.016, zone, 1000 - 100 - MARKS.sees + d, 700); return w.uniforms.uFade.value; });
  w.update(0.016, zone, 800, 700);
  say(fades.every((v, i) => i === 0 || v < fades[i - 1]) && fades[0] > 0.999 && fades[3] < 0.2 && w.uniforms.uFade.value === 1,
    `the lamps come up over the last 500 m of their range: ${fades.map((v) => f(v)).join(', ')} at 500, 400, 250 and 100 m inside its edge, all of them nearer`);
  // The mid tier: every second pole; the low tier: none.
  w.setTier('mid');
  w.update(0.016, zone, 800, 700);
  say(w.counts.poles === 32 && w.counts.arches === 12, `the mid tier has half the poles (${w.counts.poles}) and the arches (${w.counts.arches})`);
  w.setTier('low');
  w.update(0.016, zone, 800, 700);
  say(!w.poles.visible && !w.arches.visible && !w.lamps.visible, 'the low tier none');
  w.setTier('high');
  // A longer stretch, and a road that has a bridge in it.
  const bridge = new Waymarks(new THREE.Scene(), { road: makeRoad((s) => (s > 1100 && s < 1200 ? 1 : s > 1055 && s < 1080 ? 2 : 0)) }, 'high');
  bridge.update(0.016, { s: 1000, run: 450 }, 800, 700);
  say(bridge.counts.onArches === 17 && bridge.counts.onPoles === 86, `a stretch of 450 m has ${bridge.counts.onArches} arches and ${bridge.counts.onPoles} poles on it with 25 m of tunnel in it (none stand in it: 18 and 90 without)`);
  const deckLamp = bridge.lampList().find((l) => l[0] > 1130 && l[0] < 1170 && Math.abs(Math.abs(l[2] - road.at(l[0]).z) - (HALF_PAVED + 0.54)) < 0.2);
  say(!!deckLamp && Math.abs(deckLamp[1] - (3 + 0.95 + MARKS.height - 0.07)) < 0.02, 'on a bridge they stand on the parapet');
  // What it made is let go of.
  const before = scene.children.length;
  const geos = [w.poles.geometry, w.arches.geometry, w.lamps.geometry];
  let freed = 0;
  for (const g of geos) g.addEventListener('dispose', () => freed++);
  w.dispose();
  bridge.dispose();
  say(scene.children.length === before - 3 && freed === 3, `dispose() takes ${before - scene.children.length} meshes out of the scene and lets go of ${freed} geometries`);
}

{
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.3, 14000);
  cam.position.set(10, 5, 10);
  const at = { a: UP, b: UP, t: 0 };
  const o = { x: 0, z: 0 };
  const dry = new Motes(scene, 'high');
  const same = new Motes(scene, 'high');
  dry.update(0.016, cam, at, o, 577, 0);
  same.update(0.016, cam, at, o, 577);
  const u = (m) => JSON.stringify([m.uniforms.uDensity.value.toArray(), m.uniforms.uSize.value.toArray(), m.shown, m.points.visible, m.rain.visible]);
  say(u(dry) === u(same) && !dry.rain.visible && dry.streaks === 0 && dry.shown === Math.round(0.3 * 12000), `with no rain the air's points are as they were (${dry.shown} of them) and no streak is drawn`);
  dry.update(0.016, cam, at, o, 577, 1);
  say(dry.streaks === Math.round(12000 * RAIN.density) && !dry.points.visible && dry.shown === 0 && dry.rain.visible && dry.rain.geometry.instanceCount === dry.streaks,
    `in the rain there are ${dry.streaks} streaks (${RAIN.density} of the 12000 points) and no ash`);
  dry.update(0.016, cam, at, o, 577, 0.5);
  say(dry.shown === Math.round(0.3 * 0.5 * 12000) && Math.abs(dry.streaks - 0.5 * 12000 * RAIN.density) <= 1, `half way, half of each (${dry.shown} ash, ${dry.streaks} streaks)`);
  dry.setTier('mid');
  dry.update(0.016, cam, at, o, 577, 1);
  say(Math.abs(dry.streaks - 0.5 * 12000 * RAIN.density) <= 1, `the mid tier has ${dry.streaks} streaks, half`);
  dry.setTier('low');
  dry.update(0.016, cam, at, o, 577, 1);
  say(dry.streaks === 0 && !dry.rain.visible && dry.shown === Math.round(0.3 * 12000), 'the low tier has none, and the ash stays');
  dry.dispose();
  same.dispose();
  say(scene.children.length === 0, 'dispose() takes the points and the streaks out of the scene');
}

// 300 s in the Upside Down: the flashes, the ones that come down, the tentacles near them, and pods the car comes up to.
{
  const scene = new THREE.Scene();
  const road = makeRoad();
  const worlds = { main: () => UP, at: (x, z, out) => Object.assign(out, { a: UP, b: UP, t: 0, u: 0 }), rawU: () => 0, dx: 1, dz: 0, warp: () => 0 };
  const land = (x) => 5 + Math.sin(x / 50) * 2;
  const env = { road, seed: 7, worlds, groundAt: land, terrainAt: land, tier: 'high' };
  const up = new Upside(scene, env);
  let s = 1000;
  const clutter = new Clutter(scene, { road, seed: 7, worlds, sCar: () => s, heightAt: land, waterAt: () => -1e9, solidAt: () => false });
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.3, 14000);
  const car = { x: 0, y: 3, z: 0, yaw: 0 };
  const dt = 0.1;
  const seen = [];
  let flinched = null;
  for (let t = 0; t < 3000; t++) {
    s += 22 * dt;
    const p = road.at(s);
    car.x = p.x;
    car.z = p.z;
    car.yaw = p.theta;
    camera.position.set(p.x - 8, 6, p.z);
    camera.lookAt(p.x + 50, 3, p.z);
    camera.updateMatrixWorld();
    const g0 = up.groundStrikes;
    // A tentacle by every place a flash is to come down (the tentacles are fewer than the flashes, a hundred metres away).
    if (g0 < 99 && up._strikes % 5 === 4 && up._next < dt * 1.01) {
      for (let a = 0; a < 6; a++) {
        const [ahead, side] = strikeSpot(7, up._strikes + 1, 0);
        const q = road.at(s + ahead);
        const x = q.x - Math.sin(q.theta) * side;
        const z = q.z + Math.cos(q.theta) * side;
        up.tentacles.push({ x: x + (a - 3) * 9, z: z + (a % 2 ? 7 : -7) * (a + 1), y: land(x), size: 4, grow: 1, leaving: false, wait: 0 });
      }
    }
    clutter.update(camera, dt);
    up.update(dt, { camera, car, sCar: s, origin: road.origin, upside: 1, fogColor: new THREE.Color(0x222222), clutter, heightPx: 600 });
    if (up.groundStrikes > g0) {
      const l = up.strikeLog[up.strikeLog.length - 1];
      const near = road.nearestS(l.x, l.z, l.s, 300);
      seen.push({
        n: l.n, dist: Math.hypot(l.x - car.x, l.z - car.z), road: near.dist, high: Math.abs(l.y - land(l.x)), world: worlds.main(l.x, l.z), age: up.strike.age,
        scorch: up.strike.scorch.visible, bolt: up.strike.bolt.visible, sky: up.bolt.y,
      });
      // The tentacles in reach shrink at once; the ones further do not.
      const a = up.strike.at;
      const flinch = up.tentacles.map((te) => ({ d: Math.hypot(te.x - a.x, te.z - a.z), f: te.flinch || 0 }));
      if (!flinched) flinched = { near: flinch.filter((q) => q.d < STRIKE.near), far: flinch.filter((q) => q.d >= STRIKE.near), strike: up.strike, hit: up.strikeLog.length };
    }
  }
  say(up.groundStrikes >= 5 && up.groundStrikes === Math.floor(up.strikes / STRIKE.every) && seen.every((e) => e.n % 5 === 0),
    `in 300 s of the Upside Down there were ${up.strikes} flashes and ${up.groundStrikes} of them came down (every fifth: ${seen.map((e) => e.n).join(', ')})`);
  say(seen.length > 0 && seen.every((e) => e.dist >= 200 && e.dist <= 600), `each was ${f(Math.min(...seen.map((e) => e.dist)), 0)} to ${f(Math.max(...seen.map((e) => e.dist)), 0)} m from the car (200 to 600)`);
  say(seen.every((e) => e.road > HALF_FLAT + 6 && e.high < 1e-9 && e.world === UP),
    `on the land's own height (at most ${(Math.max(...seen.map((e) => e.high))).toExponential(0)} m off), ${f(Math.min(...seen.map((e) => e.road)), 0)} m or more from the road, in the Upside Down's land`);
  say(seen.every((e) => e.scorch && e.bolt && e.sky === -1), 'the bolt and the scorch were drawn, and the sky\'s own line was left out of that flash');
  const fl = flinched || { near: [], far: [] };
  say(fl.near.length > 0 && fl.near.every((q) => q.f > 0.9) && fl.far.every((q) => q.f === 0), `the ${fl.near.length} tentacles within ${STRIKE.near} m shrank at once, the ${fl.far.length} further off did not`);
  const sIdx = up.strikeLog.length;
  say(sIdx > 0, 'the flashes are kept for a look');

  // A tentacle shrinks to 0.4 and is back in 1.4 s: its height in the mesh.
  // (The mesh is written from the last tentacle to the first.)
  const heightOf = (te) => {
    const i = up.tentacles.length - 1 - up.tentacles.indexOf(te);
    const m = new THREE.Matrix4();
    up.mesh.getMatrixAt(i, m);
    return new THREE.Vector3().setFromMatrixScale(m).y;
  };
  const here = road.at(s);
  const te = { x: here.x + 15, z: here.z + 9, y: land(here.x), size: 4, grow: 1, leaving: false, wait: 0, flinch: 1 };
  up.tentacles.push(te);
  const at0 = { camera, car, sCar: s, origin: road.origin, upside: 1, fogColor: new THREE.Color(0x222222), clutter, heightPx: 600 };
  up._next = 1e9;
  up.update(0.001, at0);
  const h0 = heightOf(te) / te.size;
  const hs = [];
  for (let i = 0; i < 7; i++) {
    up.update(0.2, at0);
    hs.push(heightOf(te) / te.size);
  }
  say(Math.abs(h0 - 0.4) < 0.02 && hs.every((h, i) => i === 0 || h >= hs[i - 1] - 1e-6) && Math.abs(hs[6] - 1) < 0.02 && hs[2] < 0.9,
    `a tentacle that shrinks is ${f(h0)} of its height, and ${hs.map((h) => f(h)).join(', ')} every 0.2 s after: back in ${STRIKE.over} s`);
  up.dispose();
}

// The scorch: its heat is out in a few seconds, and it thins to nothing in 20.
const N_MAIN = STRIKE.nodes;
{
  const scene = new THREE.Scene();
  const st = new Strike(scene, { groundAt: () => 5 }, 'high');
  st.hit(100, 5, 50, new THREE.Vector3(0, 6, 0), 1.0, 5);
  st.update(0, 0);
  const heat = [];
  const soot = [];
  for (let t = 0; t <= 20.01; t += 1) {
    heat.push(st.scorchUniforms.uHeat.value);
    soot.push(st.scorchUniforms.uSoot.value);
    st.update(1, 0);
  }
  say(heat[0] > 0.9 && heat[10] < 0.15 && heat.every((v, i) => i === 0 || v <= heat[i - 1] + 1e-9) && soot.every((v, i) => i === 0 || v <= soot[i - 1] + 1e-9) && soot[19] < 0.2,
    `the scorch cools: its heat ${f(heat[0])}, ${f(heat[5])}, ${f(heat[10])}, ${f(heat[19])} at 0, 5, 10, 19 s; its soot ${f(soot[0])}, ${f(soot[10])}, ${f(soot[19])}, each less than the one before`);
  say(!st.scorch.visible && !st.bolt.visible, 'and at 20 s it is not drawn');
  const mid = new Strike(scene, { groundAt: () => 5 }, 'mid');
  mid.hit(100, 5, 50, new THREE.Vector3(0, 6, 0), 1.0, 5);
  const brightness = (s) => { const a = s.bolt.geometry.attributes.aN; let top = 0; for (let i = 0; i < a.count; i++) if (a.getW(i) > 0 && a.getZ(i) > 0) top++; return top; };
  say(brightness(mid) === N_MAIN * 2 && brightness(st) > N_MAIN * 2, 'at the mid tier the bolt has no branch');
  const low = new Strike(scene, { groundAt: () => 5 }, 'low');
  say(low.hit(100, 5, 50, new THREE.Vector3(0, 6, 0), 1.0, 5) === false && !low.scorch.visible, 'and at the low tier none: the flash is the sky\'s');
  for (const x of [st, mid, low]) x.dispose();
}

// The pods: the car comes up to a pod and it bursts.
{
  const scene = new THREE.Scene();
  const road = makeRoad();
  const worlds = { main: () => UP, at: (x, z, out) => Object.assign(out, { a: UP, b: UP, t: 0, u: 0 }), rawU: () => 0, dx: 1, dz: 0, warp: () => 0 };
  const land = (x) => 5 + Math.sin(x / 50) * 2;
  const run = (tier) => {
    const env = { road, seed: 7, worlds, groundAt: land, terrainAt: land, tier };
    const up = new Upside(scene, env);
    let s = 1000;
    const clutter = new Clutter(scene, { road, seed: 7, worlds, sCar: () => s, heightAt: land, waterAt: () => -1e9, solidAt: () => false });
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.3, 14000);
    const car = { x: 0, y: 3, z: 0, yaw: 0 };
    const dt = 1 / 60;
    // The pods within reach of the car, counted by the check itself.
    const inReach = () => {
      let n = 0;
      for (const cell of clutter.cells.values()) {
        for (const it of cell.items) {
          if (it.kind === 'spore' && !it.gone && Math.hypot(it.x - car.x, it.z - car.z, it.y + 0.6 * it.size - (car.y + 0.5)) < SPORES.reach) n++;
        }
      }
      return n;
    };
    const log = [];
    for (let t = 0; t < 60 * 40; t++) {
      s += 22 * dt;
      const p = road.at(s);
      car.x = p.x - Math.sin(p.theta) * 1.9;
      car.z = p.z + Math.cos(p.theta) * 1.9;
      camera.position.set(p.x - 8, 6, p.z);
      camera.lookAt(p.x + 50, 3, p.z);
      camera.updateMatrixWorld();
      clutter.update(camera, dt);
      const before = inReach();
      const pods = up.pods;
      const thrown = up.spores.thrown;
      up.update(dt, { camera, car, sCar: s, origin: road.origin, upside: 1, fogColor: new THREE.Color(0x222222), clutter, heightPx: 600 });
      if (before > 0) log.push({ before, after: inReach(), took: up.pods - pods, thrown: up.spores.thrown - thrown, alive: up.spores.count() });
    }
    return { up, log, clutter };
  };
  const hi = run('high');
  const taken = hi.log.reduce((n, e) => n + e.took, 0);
  say(hi.up.pods >= 3 && hi.up.pods === taken, `in 40 s of the road ${hi.up.pods} pods came within ${SPORES.reach} m of the car, each burst in the frame it came within reach (${hi.log.filter((e) => e.took === 0).length} frames with one in reach and not taken)`);
  say(hi.log.every((e) => e.after === 0) && hi.up.pods > 0, 'and was gone from the ground: none is left within reach after a frame');
  say(hi.log.every((e) => e.thrown === SPORES.per * e.took), `each threw ${SPORES.per} spores (${hi.up.spores.thrown} in all, ${hi.up.spores.bursts} bursts), ${Math.max(...hi.log.map((e) => e.alive))} out at the most at a time (${SPORES.max} places for them)`);
  const mid = run('mid');
  say(mid.up.pods >= 3 && mid.log.every((e) => e.thrown === (SPORES.per / 2) * e.took), 'at the mid tier a pod throws 10');
  const low = run('low');
  say(low.up.pods === 0 && low.up.spores.thrown === 0 && low.log.length > 0 && low.log.every((e) => e.took === 0), 'at the low tier the pod stays where it is');
  for (const r of [hi, mid, low]) r.up.dispose();
}

// --- in the page ---------------------------------------------------------------------

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
const PORT = Number(process.env.PORT) || 8191;
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
  const profile = `${tmpdir()}/continuum-upside-world-${process.pid}-${Date.now()}`;
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

// What every test of the page has: the car put on the road (put) and driven on
// steady (drive: the lightning held off, the clouds' and the wind's clocks held), the
// frame as the post chain makes it (grab), what the scene shows of what is asked for
// alone (only), where a place of the scene is on the screen as it is drawn (screen),
// the stretch that is wound (found).
const LIB = String.raw`
  const THREE = await import('three');
  const tw = await import('./src/render/twist.js');
  const up = g.upside;
  const canvas = document.getElementById('view');
  const PI = Math.PI;
  const shaderErrors = window.__shaderErrors || (window.__shaderErrors = []);
  g.renderer.debug.onShaderError = (gl, program) => { shaderErrors.push(String(gl.getProgramInfoLog(program)).slice(0, 400)); };
  g.chase.shaking = false;
  g.chase.lead = false;
  const still = () => { up._next = 1e9; up._age = 99; g.atmosphere.uniforms.uTime.value = 100; g.style.wind[0] = 1000; g.style.wind[1] = 400; };
  const put = (s) => {
    const p = g.road.at(s);
    g.autoMode = true;
    g.sCar = s;
    g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(s, 1.9) + 0.3);
    g.car.vx = 22;
    g.chase.snapTo(g.car, g.car.y || 0);
  };
  const drive = (n, v = 22) => { for (let i = 0; i < n; i++) { still(); g.pilot.vMax = v; g.update(1 / 60); } };
  const setStyle = (st) => { g.style.set(st, true); g.style.applyScene(); g.post.setStyle(g.style); g.atmosphere.bakeEnvironment(); };
  const grab = () => {
    g.render();
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(canvas, 0, 0);
    return { w: c.width, h: c.height, data: x.getImageData(0, 0, c.width, c.height).data };
  };
  const only = (list) => {
    const hidden = [];
    for (const c of g.scene.children) if (!list.includes(c) && c.visible) { c.visible = false; hidden.push(c); }
    return () => { for (const c of hidden) c.visible = true; };
  };
  // Where a place of the scene is on the screen, as it is drawn (wound), in pixels, y up.
  const screen = (x, y, z) => {
    const v = up.drawn(new THREE.Vector3(x, y, z), g.camera).project(g.camera);
    return { x: (v.x * 0.5 + 0.5) * canvas.width, y: (v.y * 0.5 + 0.5) * canvas.height, z: v.z };
  };
  // The stretch the road is wound over that the car is by.
  const found = () => { const z = up.zone; return z && { cross: z.cross, s: z.s, run: z.run, len: z.len, s0: z.s - z.run / 2, s1: z.s + z.run / 2 }; };
  const crossing = (into) => {
    const o = g.road.origin;
    const look = () => {
      const top = g.road.classified * 2 - 4;
      let pv = -1;
      for (let s = Math.max(g.road.start + 2, g.sCar); s < top; s += 2) {
        const p = g.road.at(s);
        if (!p) continue;
        const v = up.shareAt(p.x + o.x, p.z + o.z);
        if (pv >= 0 && (into ? pv < 0.5 && v >= 0.5 : pv >= 0.5 && v < 0.5)) return s;
        pv = v;
      }
      return null;
    };
    let mid = look();
    for (let k = 0; k < 20 && mid === null; k++) {
      const s = g.road.classified * 2 - 900;
      const p = g.road.at(s);
      g.sCar = s;
      g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(s, 1.9) + 0.3);
      g.car.vx = 22;
      for (let i = 0; i < 30; i++) g.update(1 / 60);
      mid = look();
    }
    drive(2);
    const z = found();
    if (!z || Math.abs(z.cross - mid) > 20) throw new Error('the stretch by ' + mid + ' is not the one in reach');
    return z;
  };
  // The car at s, the stretch's own place: put 33 m back and driven up to it.
  const at = (s) => { put(s - 33); drive(90); };
  const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  // How many pixels of two frames differ by at least 'by' levels in some channel.
  const differ = (a, b, by = 24) => {
    let n = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      if (Math.abs(a.data[i] - b.data[i]) >= by || Math.abs(a.data[i + 1] - b.data[i + 1]) >= by || Math.abs(a.data[i + 2] - b.data[i + 2]) >= by) n++;
    }
    return n;
  };
  // The most of a red lamp's hue in a few pixels about (x, y) (y up): red over the other two.
  const redAt = (f, x, y, r = 3) => {
    let best = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const px = Math.round(x) + dx, py = f.h - 1 - Math.round(y) + dy;
      if (px < 0 || py < 0 || px >= f.w || py >= f.h) continue;
      const i = (py * f.w + px) * 4;
      best = Math.max(best, f.data[i] - Math.max(f.data[i + 1], f.data[i + 2]));
    }
    return best;
  };
  const hold = (what) => { const keep = what.map((o) => o.visible); return () => what.forEach((o, i) => { o.visible = keep[i]; }); };
  const mine = () => [up.waymarks.poles, up.waymarks.arches, up.waymarks.lamps, g.motes.rain, up.strike.bolt, up.strike.scorch, up.spores.points];
`;

// A level lens on the stretch's line (4 m over the road, the line the winding turns the world about), `back` m before its
// start, looking along it, for the frames that follow: the lens is put there after the rig has put it
// where it goes, every frame.
const ALONG = (back, up = 4) => String.raw`
  const zz = found();
  const cam = g.camera;
  const rig = g.chase.update;
  g.chase.update = function (...a) {
    rig.apply(this, a);
    const z = up.zone || zz;
    const y0 = g.road.at(z.s).y;
    cam.up.set(0, 1, 0);
    cam.position.set(z.p.x - z.d.x * ${back}, y0 + ${up}, z.p.z - z.d.z * ${back});
    cam.lookAt(z.p.x + z.d.x * 400, y0 + ${up}, z.p.z + z.d.z * 400);
    cam.updateMatrixWorld();
  };
`;
const LET_GO = 'g.chase.update = rig;';

// In the stretch: how many poles and arches there are, where, and how they are laid.
const MARKS_NOW = String.raw`
  const z = found();
  at(z.s0 - 150);
  const w = up.waymarks;
  const road = g.road;
  const lamps = w.lampList();
  // The lamps of poles (not the arches' crowns), by which side of the road they are on.
  const ofPole = lamps.filter((l) => { const n = road.nearestS(l[0], l[2], z.s0 + 100, 700); return l[1] < road.at(n.s).y + 3; });
  const side = (l) => road.lateralOf(road.nearestS(l[0], l[2], z.s0 + 100, 700).s, l[0], l[2]);
  return { z, counts: w.counts, shown: [w.poles.visible, w.arches.visible, w.lamps.visible], lamps: lamps.length, tier: g.tier,
    sides: [ofPole.filter((l) => side(l) > 5).length, ofPole.filter((l) => side(l) < -5).length] };
`;

// From 300 m before the stretch, along its line: where the lamps of the poles of one side are on
// the screen against where the road's middle at the same place is, the angle round it (y up), against how far the
// winding itself has turned that place.
const SPIRAL = String.raw`
  const z = found();
  at(z.s0 - 300);
  ${ALONG(300)}
  drive(3);
  const w = up.waymarks;
  const road = g.road;
  const all = w.lampList().filter((l) => l[3] > 0 && l[3] < 1);
  const left = all.filter((l) => { const s = z.s0 + l[3] * z.run; return road.lateralOf(s, l[0], l[2]) > 5 && l[1] < road.at(s).y + 3; });
  const want = 40;
  const pick = Array.from({ length: Math.min(want, left.length) }, (_, i) => left[Math.round(i * (left.length - 1) / (Math.min(want, left.length) - 1))]);
  const rows = pick.map((l) => {
    const s = z.s0 + l[3] * z.run;
    const c = road.at(s);
    const a = screen(l[0], l[1], l[2]);
    const b = screen(c.x, c.y, c.z);
    return { s: s - z.s0, ang: Math.atan2(a.y - b.y, a.x - b.x), turn: up.angleAt(l[0], l[2]), depth: a.z, x: a.x, y: a.y };
  });
  ${LET_GO}
  return { rows, n: left.length, run: z.run };
`;

// The rain: how many streaks there are by how far from the stretch the car is, and the ash with them.
const RAIN_AT = (gaps) => String.raw`
  const z = found();
  const out = [];
  for (const gap of ${JSON.stringify(gaps)}) {
    at(gap < 0 ? z.s0 + gap : z.s1 + gap);
    out.push({ gap, rain: up.rain, streaks: g.motes.streaks, ash: g.motes.shown, drawn: g.motes.rain.visible, points: g.motes.points.visible });
  }
  return out;
`;

// The streaks seen alone: the way they lie on the screen in the central part of the frame (the structure
// of the picture's lines, mod a half turn), against the screen's way of the world's up, at three places in the winding.
const RAIN_WAY = (fracs) => String.raw`
  const z = found();
  const out = [];
  for (const fr of ${JSON.stringify(fracs)}) {
    at(z.s0 + fr * z.run);
    const restore = only([g.motes.rain]);
    const f = grab();
    restore();
    // The lines: the gradients of the frame's brightness, weighted by their size, over the middle of it.
    const W = f.w, H = f.h;
    const L = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) L[i] = lum(f.data, i * 4);
    let jxx = 0, jyy = 0, jxy = 0, weight = 0, bright = 0;
    for (let y = Math.floor(H * 0.25); y < Math.floor(H * 0.75); y++) for (let x = Math.floor(W * 0.25); x < Math.floor(W * 0.75); x++) {
      const i = y * W + x;
      const gx = (L[i + 1] - L[i - 1]);
      const gy = -(L[i + W] - L[i - W]);          // y up
      jxx += gx * gx; jyy += gy * gy; jxy += gx * gy; weight += Math.hypot(gx, gy);
      if (L[i] > 40) bright++;
    }
    const grad = 0.5 * Math.atan2(2 * jxy, jxx - jyy);
    const line = grad + PI / 2;
    // Where the world's up goes on the screen at the middle of the frame (two ends of a streak, 10 m on).
    const fwd = new THREE.Vector3(); g.camera.getWorldDirection(fwd);
    const c = g.camera.position.clone().addScaledVector(fwd, 10);
    const a = screen(c.x, c.y - 0.2, c.z), b = screen(c.x, c.y + 0.2, c.z);
    const upAng = Math.atan2(b.y - a.y, b.x - a.x);
    out.push({ fr, roll: up.roll, line, upAng, weight, bright, streaks: g.motes.streaks });
  }
  return out;
`;

// The lamps in the frame where they are: from 120 m before the stretch, 6 m over the road, looking along it.
const LAMPS_SEEN = String.raw`
  const z = found();
  at(z.s0 - 120);
  ${ALONG(120, 6)}
  drive(3);
  const w = up.waymarks;
  const f = grab();
  w.lamps.visible = false;
  const bare = grab();
  w.lamps.visible = true;
  const lamps = w.lampList().map((l) => ({ ...screen(l[0], l[1], l[2]), l }));
  const inView = lamps.filter((l) => l.z > -1 && l.z < 1 && l.x > 8 && l.x < f.w - 8 && l.y > 8 && l.y < f.h - 8);
  // A lamp is where it is worked out to be if the frame with the lamps is redder there than the frame without them.
  const redder = (x, y) => redAt(f, x, y) - redAt(bare, x, y) > 30;
  const red = inView.filter((l) => redder(l.x, l.y));
  // The same count with every lamp's place moved 40 to 60 px (in 4 directions): what a lamp put anywhere else finds.
  const control = [[53, 31], [-47, 29], [41, -37], [-59, -43]].map(([dx, dy]) => inView.filter((l) => l.x + dx > 4 && l.x + dx < f.w - 4 && l.y + dy > 4 && l.y + dy < f.h - 4 && redder(l.x + dx, l.y + dy)).length);
  ${LET_GO}
  return { all: lamps.length, inView: inView.length, red: red.length, control };
`;

// What the new things cost a frame in the stretch: draws and triangles, with them all out of sight and
// with the air's own points in the place of the rain (what the frame had), and with them.
const COST = String.raw`
  const z = found();
  at(z.s0 + 0.3 * z.run);
  const r = g.renderer;
  const count = () => { g.render(); return { calls: r.info.render.calls, triangles: r.info.render.triangles, points: r.info.render.points, programs: r.info.programs.length }; };
  const o = g.road.origin;
  const motes = (rain) => g.motes.update(0, g.camera, g._wl || g._lookAt, o, g.post.size.y, rain);
  const all = count();
  const wet = { streaks: g.motes.streaks, rain: up.rain };
  const keep = hold(mine());
  for (const m of mine()) m.visible = false;
  motes(0);
  const bare = count();
  keep();
  motes(up.rain);
  const again = count();
  return { all, bare, again, wet, geometries: r.info.memory.geometries, programs: r.info.programs.map((p) => p.name || p.cacheKey).length };
`;

// Every style: the markers in the frame (the frame with them, and without), the streaks (with, without).
const STYLED = (style) => String.raw`
  setStyle('${style}');
  const z = found();
  at(z.s0 - 100);
  const o = g.road.origin;
  const motes = (rain) => g.motes.update(0, g.camera, g._wl || g._lookAt, o, g.post.size.y, rain);
  const w = up.waymarks;
  const wm = [w.poles, w.arches, w.lamps];
  const full = grab();
  const keep = hold(wm);
  for (const m of wm) m.visible = false;
  const bare = grab();
  keep();
  const noRain = (() => { motes(0); const f = grab(); motes(up.rain); return f; })();
  return { style: g.style.id, marks: differ(full, bare), rain: differ(full, noRain), rainShare: up.rain, errors: shaderErrors.length };
`;

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const want = (name) => !only || only.includes(name);
const web = serve();
try {
  if (!(await waitForServer())) throw new Error('the dev server did not come up');

  // Over the way in from space, in worlds 1500 m long.
  if (want('way')) {
    const page = await openPage('seed=7&world=space&worldlen=1500&run=60&cam=chase&style=real');
    try {
      const z = await page.run(`${LIB} return crossing(true);`);
      say(!z.error && z.run >= 200 && z.run <= 500, `the road is wound over a stretch of ${f(z.run, 0)} m of it, from ${f(z.s0, 0)} m`);
      const m = await page.run(`${LIB} ${MARKS_NOW}`);
      const lay = markLayout(z.run);
      say(!m.error && m.counts.onPoles === 2 * lay.poles.length && m.counts.onArches === lay.arches.length && m.counts.poles >= m.counts.onPoles + 20,
        `along it stand ${m.counts && m.counts.onPoles} poles (${lay.poles.length} to a side, one to each 10 m of road) and ${m.counts && m.counts.onArches} arches (one to each 25 m), and ${m.counts && m.counts.poles - m.counts.onPoles} poles and ${m.counts && m.counts.arches - m.counts.onArches} arches in the 60 m before and after${m.error ? ' ' + m.error : ''}`);
      say(!m.error && m.shown.every(Boolean) && m.lamps === m.counts.poles + m.counts.arches && m.sides[0] > 10 && m.sides[1] > 10,
        `with a lamp on each (${m.lamps}), poles on both sides of the road (${m.sides && m.sides.join(' and ')} lamps)`);

      // From 300 m before the stretch the lamps are a spiral.
      const sp = await page.run(`${LIB} ${SPIRAL}`);
      const rows = sp.rows || [];
      const unwrap = [];
      let prev = rows.length ? rows[0].ang : 0;
      let acc = 0;
      for (const r of rows) {
        let d = r.ang - prev;
        d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
        acc += d;
        prev = r.ang;
        unwrap.push(acc);
      }
      const sign = unwrap.length && unwrap[unwrap.length - 1] < 0 ? -1 : 1;
      const turn0 = rows.length ? rows[0].turn : 0;
      const err = rows.map((r, i) => Math.abs(sign * unwrap[i] - (r.turn - turn0)));
      // (The winding goes a hair past the half turn at its end and comes back, 0.06 rad.)
      const back = unwrap.slice(1).filter((u, i) => sign * (u - unwrap[i]) < -0.09).length;
      say(!sp.error && rows.length >= 30 && Math.abs(sign * unwrap[unwrap.length - 1] - Math.PI) < 0.15 && back === 0 && Math.max(...err) <= 0.15,
        `from 300 m before it the lamps of one side (${rows.length} of ${sp.n}) are a spiral round the road's line: their angle goes ${f(unwrap[0] || 0)} to ${f(unwrap[unwrap.length - 1] || 0)} rad along it (a half turn is ${f(Math.PI)}), never back but for the hair the winding goes past its end and comes back (${back} steps further back than 0.09 rad), at most ${f(Math.max(...err))} rad from the angle the road is wound by there (0.15)${sp.error ? ' ' + sp.error : ''}`);

      // The lamps are in the frame where they are, red.
      const seen = await page.run(`${LIB} ${LAMPS_SEEN}`);
      const ctl = seen.control ? seen.control.slice().sort((x, y) => x - y)[seen.control.length >> 1] : Infinity;
      say(!seen.error && seen.inView >= 60 && seen.red >= 40 && seen.red >= 5 * Math.max(1, ctl),
        `${seen.red} of the ${seen.inView} lamps in view (of ${seen.all}) make the frame redder where they are worked out to be (the rest are behind the road, the land or a pole's own arch), against ${ctl} (the middle of 4 counts: ${seen.control && seen.control.join(', ')}) when each place is moved 40 to 60 px; at least 40, and 5 times that${seen.error ? ' ' + seen.error : ''}`);

      // The rain, by how far from the stretch the car is.
      const gaps = [-400, -340, -290, 0, 290, 340, 400];
      const rain = await page.run(`${LIB} ${RAIN_AT(gaps)}`);
      const full = Math.round(12000 * RAIN.density);
      const byGap = Object.fromEntries((rain.error ? [] : rain).map((r) => [r.gap, r]));
      say(!rain.error && byGap[-400].streaks === 0 && byGap[-400].ash > 0 && byGap[-290].streaks === full && byGap[-290].ash === 0 && byGap[0].streaks === full
        && byGap[290].streaks === full && byGap[290].ash === 0 && byGap[400].streaks === 0 && byGap[400].ash > 0,
      `the air is rain from 300 m before the stretch to 300 m past it, ash outside: streaks ${gaps.map((g0) => (byGap[g0] ? byGap[g0].streaks : '?')).join(', ')}, ash ${gaps.map((g0) => (byGap[g0] ? byGap[g0].ash : '?')).join(', ')} at ${gaps.join(', ')} m${rain.error ? ' ' + rain.error : ''}`);
      say(!rain.error && byGap[-340].streaks > 0 && byGap[-340].streaks < full && byGap[340].streaks > 0 && byGap[340].streaks < full && byGap[-340].ash > 0 && byGap[-340].ash < 3600,
        `and over 60 m it gives way (${byGap[-340] && byGap[-340].streaks} streaks and ${byGap[-340] && byGap[-340].ash} points of ash at 340 m before)`);

      // The streaks lie the way the world's up is on the screen, which the roll of the view says.
      const way = await page.run(`${LIB} ${RAIN_WAY([0.2, 0.5, 0.8])}`);
      const wrapPi = (a) => { let d = a % Math.PI; if (d < -Math.PI / 2) d += Math.PI; if (d > Math.PI / 2) d -= Math.PI; return d; };
      const wrap2 = (a) => { let d = a % (2 * Math.PI); if (d < -Math.PI) d += 2 * Math.PI; if (d > Math.PI) d -= 2 * Math.PI; return d; };
      const rw = way.error ? [] : way;
      const lineErr = rw.map((r) => Math.abs(wrapPi(r.line - r.upAng)));
      const rollErr = rw.map((r) => Math.abs(wrap2(r.upAng - (Math.PI / 2 - r.roll))));
      say(!way.error && rw.length === 3 && rw.every((r) => r.streaks > 3000 && r.bright > 400) && Math.max(...lineErr) <= 0.2 && Math.max(...rollErr) <= 0.2,
        `the streaks lie as the world's up does on the screen: at ${rw.map((r) => `${f(r.roll)} rad of roll`).join(', ')} their lines are ${f(Math.max(...lineErr))} rad at the most from it (0.2), and it is ${f(Math.max(...rollErr))} from a quarter turn less the roll${way.error ? ' ' + way.error : ''}`);

      // What it adds to a frame.
      const cost = await page.run(`${LIB} ${COST}`);
      const dc = cost.again && cost.bare ? cost.again.calls - cost.bare.calls : NaN;
      const dt = cost.again && cost.bare ? cost.again.triangles - cost.bare.triangles : NaN;
      say(!cost.error && dc <= 8 && dt <= 60000 && dc >= 2, `in the stretch the markers, the streaks and what goes with them add ${dc} draws and ${dt} triangles to the frame (at most 8 and 60000)${cost.error ? ' ' + cost.error : ''}`);

      // The tiers.
      const tiers = {};
      for (const tier of ['mid', 'low', 'high']) {
        tiers[tier] = await page.run(`${LIB} g.setTier(${JSON.stringify(tier)}); const z = found(); at(z.s0 - 100); const w = up.waymarks; return { poles: w.counts.poles, shown: w.poles.visible || w.lamps.visible, streaks: g.motes.streaks, ash: g.motes.shown, rain: g.motes.rain.visible };`);
      }
      say(!tiers.mid.error && tiers.high.poles > 0 && tiers.mid.poles < tiers.high.poles * 0.7 && tiers.mid.poles > tiers.high.poles * 0.4 && tiers.mid.streaks === Math.round(full / 2) && tiers.low.poles === tiers.low.poles && !tiers.low.shown && tiers.low.streaks === 0 && !tiers.low.rain && tiers.low.ash > 0,
        `the tiers: high ${tiers.high.poles} poles and ${tiers.high.streaks} streaks, mid ${tiers.mid.poles} and ${tiers.mid.streaks}, low none (${tiers.low.shown ? 'drawn' : 'not drawn'}, ${tiers.low.streaks} streaks, the ash stays: ${tiers.low.ash})`);

      // Every style draws it.
      const styled = [];
      for (const style of ['real', 'paint', 'ink', 'cel', 'print', 'pixel', 'block']) {
        const r = await page.run(`${LIB} ${STYLED(style)}`);
        styled.push(r);
      }
      say(styled.every((r) => !r.error && r.marks > 150 && r.rain > 300 && r.errors === 0),
        `in every style the markers and the streaks are in the frame (pixels that change with them: ${styled.map((r) => `${r.style} ${r.marks}/${r.rain}`).join(', ')})${styled.find((r) => r.error) ? ' ' + styled.find((r) => r.error).error : ''}`);

      // What it made is let go of.
      const gone = await page.run(`${LIB}
        const before = { geometries: g.renderer.info.memory.geometries, children: g.scene.children.length };
        const owned = mine();
        up.dispose();
        g.motes.dispose();
        return { before, after: { geometries: g.renderer.info.memory.geometries, children: g.scene.children.length }, inScene: owned.filter((o) => o.parent !== null).length };`);
      say(!gone.error && gone.inScene === 0 && gone.before.children - gone.after.children >= 5,
        `dispose() takes what is in the scene of the markers, the lamps, the streaks and the ash out of it, and what the flash and the pods add with it (${gone.error ? gone.error : `${gone.before.children - gone.after.children} meshes less, ${gone.inScene} left`})`);
      say(page.logs.length === 0, `with no error (${page.logs[0] || 'none'})`);
    } finally {
      page.close();
    }
  }

  // A road that bends (seed 11): the stretch is 200 m, with 40 poles and 8 arches on it.
  if (want('bend')) {
    const page = await openPage('seed=11&world=space&run=60&cam=chase&style=real');
    try {
      const r = await page.run(`${LIB} const z = crossing(true); at(z.s0 - 150); const c = up.waymarks.counts; return { run: z.run, poles: c.onPoles, arches: c.onArches, all: c.poles };`);
      say(!r.error && r.run === 200 && r.poles >= 38 && r.poles <= 42 && r.arches === 8, `on a bend (seed 11) the stretch is ${r.run} m, with ${r.poles} poles (38 to 42) and ${r.arches} arches (8) on it${r.error ? ' ' + r.error : ''}`);
      say(page.logs.length === 0, `with no error (${page.logs[0] || 'none'})`);
    } finally {
      page.close();
    }
  }

  // In the hills: none of it.
  if (want('hills')) {
    const page = await openPage('seed=7&world=hills&run=120&cam=chase&style=real');
    try {
      const r = await page.run(`${LIB} return { mine: mine().map((o) => o.visible), rain: up.rain, streaks: g.motes.streaks, ash: g.motes.shown, grounded: up.groundStrikes, pods: up.pods, marks: up.waymarks.counts.lamps };`);
      say(!r.error && r.mine.every((v) => !v) && r.rain === 0 && r.streaks === 0 && r.ash > 0 && r.grounded === 0 && r.pods === 0 && r.marks === 0, `in the hills none of it is drawn (${r.error || 'no markers, no streaks, the ash as it was, no flash down, no pod'})`);
      // Their programs, built ahead as the game does when a winding comes within reach (nothing of it is in the scene before): one for each material.
      const built = await page.run(`${LIB}
        const A = await import('./src/render/atmosphere.js');
        const list = [...up.meshes(), g.motes.rain];
        const materials = new Set(list.map((o) => o.material)).size;
        const n0 = g.renderer.info.programs.length;
        const inScene = list.filter((o) => o.parent !== null).length;
        await A.compileObjects(g.renderer, g.scene, g.camera, list);
        return { materials, programs: g.renderer.info.programs.length - n0, inScene };`);
      say(!built.error && built.inScene === 0 && built.materials === 6 && built.programs === built.materials,
        `building their programs ahead makes ${built.programs}, one for each of the ${built.materials} materials (the markers' lit one, the lamps, the streaks, the bolt, the scorch, the spores), none twice for a two-sided pass, with none of them in the scene${built.error ? ' ' + built.error : ''}`);
    } finally {
      page.close();
    }
  }

  // In the Upside Down: 300 s of it, and what a flash that comes down does in the frame.
  if (want('upside')) {
    const page = await openPage('seed=7&world=upside&worldlen=60000&run=60&cam=chase&style=real');
    try {
      const r = await page.run(`${LIB}
        put(800); drive(60);
        up._next = 3;
        up._age = 99;
        const road = g.road;
        const o = road.origin;
        const n0 = up._strikes, t0 = g.simTime;
        const rec = [];
        for (let i = 0; i < 3000; i++) {
          g.pilot.vMax = 22;
          const k0 = up.groundStrikes;
          g.update(0.1);
          if (up.groundStrikes > k0) {
            const l = up.strikeLog[up.strikeLog.length - 1];
            const near = road.nearestS(l.x - o.x, l.z - o.z, l.s, 300);
            rec.push({ n: l.n, dist: Math.hypot(l.x - o.x - g.car.x, l.z - o.z - g.car.z), road: near.dist, high: Math.abs(l.y - g.corridor.heightAt(l.x, l.z)), world: g.worlds.main(l.x, l.z), sky: up.bolt.y });
          }
        }
        return { seconds: g.simTime - t0, n0, n1: up._strikes, grounded: up.groundStrikes, rec, upside: g.worlds.list.findIndex((w) => w.id === 'upside'), flashes: up.strikes };`);
      const rec = r.rec || [];
      const expect = r.error ? 0 : Math.floor(r.n1 / STRIKE.every) - Math.floor(r.n0 / STRIKE.every);
      say(!r.error && r.seconds > 290 && r.grounded >= 5 && r.grounded <= expect && r.grounded >= expect - 1 && rec.every((e) => e.n % STRIKE.every === 0),
        `in ${f(r.seconds, 0)} s of the Upside Down there were ${r.n1 - r.n0} flashes and ${r.grounded} came down (every fifth: ${expect}; the flashes come 3 to 10 s apart, so a fifth of 300 s of them is 7 to 11)${r.error ? ' ' + r.error : ''}`);
      say(rec.length > 0 && rec.every((e) => e.dist >= 200 && e.dist <= 600 && e.road > HALF_FLAT + 6 && e.high < 1e-6 && e.world === r.upside && e.sky === -1),
        `each came down on the land (at most ${rec.length ? Math.max(...rec.map((e) => e.high)).toExponential(0) : '?'} m off its height), ${rec.length ? f(Math.min(...rec.map((e) => e.road)), 0) : '?'} m or more from the road, in the Upside Down, ${rec.length ? f(Math.min(...rec.map((e) => e.dist)), 0) : '?'} to ${rec.length ? f(Math.max(...rec.map((e) => e.dist)), 0) : '?'} m from the car, with no line of the sky's for it`);

      say(page.logs.length === 0, `with no error (${page.logs[0] || 'none'})`);
    } finally {
      page.close();
    }
    // The bolt, the scorch and the pod in a page of their own (what the 300 s left of the scorch and the spores is not in them).
    const page2 = await openPage('seed=7&world=upside&worldlen=60000&run=60&cam=chase&style=real');
    try {
      // The bolt in the frame, at the moment it comes down: white along its line.
      const bolt = await page2.run(`${LIB}
        put(1500); drive(120);
        const k0 = up.groundStrikes;
        up._strikes = 4;
        for (let i = 0; i < 5; i++) { up._next = i === 0 ? 0.0001 : 1e9; g.pilot.vMax = 22; g.update(1 / 60); }
        const b = up.strike.bolt;
        const f1 = grab();
        b.visible = false;
        const f0 = grab();
        b.visible = true;
        const pos = up.strike.pos;
        const N = ${STRIKE.nodes};
        let inView = 0, lit = 0;
        for (let i = 0; i < N; i++) {
          const p = screen(pos[i * 6], pos[i * 6 + 1], pos[i * 6 + 2]);
          if (!(p.z > -1 && p.z < 1) || p.x < 5 || p.x > f1.w - 5 || p.y < 5 || p.y > f1.h - 5) continue;
          inView++;
          let best = 0;
          for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
            const px = Math.round(p.x) + dx, py = f1.h - 1 - Math.round(p.y) + dy;
            const k = (py * f1.w + px) * 4;
            best = Math.max(best, Math.min(f1.data[k], f1.data[k + 1], f1.data[k + 2]));
          }
          if (best > 150) lit++;
        }
        return { inView, lit, differ: differ(f1, f0, 40), grounded: up.groundStrikes - k0, sky: g.atmosphere.uniforms.uBolt.value.y, age: up._age, at: up.strike.at };`);
      say(!bolt.error && bolt.grounded === 1 && bolt.sky === -1 && bolt.inView >= 8 && bolt.lit >= 0.6 * bolt.inView && bolt.differ > 150,
        `the bolt is in the frame: white along ${bolt.lit} of the ${bolt.inView} places on its line that are in view, ${bolt.differ} pixels change with it, and the sky has no line for that flash${bolt.error ? ' ' + bolt.error : ''}`);

      // The scorch seen from over it: its light is less and less, and at 20 s it is not there.
      const scorch = await page2.run(`${LIB}
        put(g.sCar - 40); drive(120);
        const k0 = up.groundStrikes;
        up._strikes = 4;
        for (let i = 0; i < 5; i++) { up._next = i === 0 ? 0.0001 : 1e9; g.pilot.vMax = 22; g.update(1 / 60); }
        const P = up.strike.at;
        const cam = g.camera;
        const rig = g.chase.update;
        g.chase.update = function (...a) {
          rig.apply(this, a);
          cam.up.set(1, 0, 0);
          cam.position.set(P.x, P.y + 14, P.z + 0.01);
          cam.lookAt(P.x, P.y, P.z);
          cam.updateMatrixWorld();
        };
        const sc = up.strike.scorch;
        const mean = (a, b) => {
          let n = 0, sum = 0;
          for (let y = Math.floor(a.h * 0.3); y < Math.floor(a.h * 0.7); y++) for (let x = Math.floor(a.w * 0.3); x < Math.floor(a.w * 0.7); x++) {
            const i = (y * a.w + x) * 4;
            sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
            n += 3;
          }
          return sum / n;
        };
        const out = [];
        const upTo = (age) => { for (let i = 0; i < 2400 && up.strike.age < Math.min(age, 20.05); i++) drive(1); };
        for (const age of [1, 6, 12, 18, 21]) {
          upTo(age);
          const on = grab();
          const was = sc.visible;
          sc.visible = false;
          const off = grab();
          sc.visible = was;
          out.push({ age: up.strike.age, light: mean(on, off), drawn: was, heat: up.strike.scorchUniforms.uHeat.value, soot: up.strike.scorchUniforms.uSoot.value });
        }
        g.chase.update = rig;
        return { out, grounded: up.groundStrikes - k0, at: up.strike.at, cam: [cam.position.x, cam.position.y, cam.position.z] };`);
      const sl = scorch.error ? [] : scorch.out;
      say(!scorch.error && sl.length === 5 && sl[0].light > 1 && sl.slice(0, 4).every((e, i) => i === 0 || e.light < sl[i - 1].light) && sl[3].light > 0 && sl[4].light === 0 && !sl[4].drawn,
        `the scorch, seen from over it, is ${sl.map((e) => `${f(e.light)} at ${f(e.age, 0)} s`).join(', ')} (the pixels it changes, less each time), and not drawn at 20 s${scorch.error ? ' ' + scorch.error : ''}${sl.length && !(sl[0].light > 1) ? ' ' + JSON.stringify({ grounded: scorch.grounded, at: scorch.at, cam: scorch.cam, first: sl[0] }) : ''}`);

      // A pod: the car comes within 8 m of it and it bursts in that moment, 20 dark red spores in the frame where they are worked out to be.
      const pod = await page2.run(`${LIB}
        const U = await import('./src/world/upsidefx.js');
        put(g.sCar - 40); drive(60);
        const o = g.road.origin;
        let best = null;
        for (let t = 0; t < 40 && !best; t++) {
          for (const cell of g.clutter.cells.values()) for (const it of cell.items) {
            if (it.kind !== 'spore' || it.gone) continue;
            const n = g.road.nearestS(it.x - o.x, it.z - o.z, g.sCar, 200);
            // On the side the car drives on (its lane is 1.9 m to the left of the middle), near enough to come within 8 m.
            const lat = g.road.lateralOf(n.s, it.x - o.x, it.z - o.z);
            if (lat > 0 && lat < 9.4 && n.s > g.sCar + 40 && (!best || n.s < best.s)) best = { s: n.s, it };
          }
          if (!best) drive(30);
        }
        if (!best) return { none: true };
        put(best.s - 70);
        drive(60);
        const car = g.car;
        const kinds0 = g.clutter.counts.spore || 0;
        let came = -1, burst = -1;
        for (let i = 0; i < 600 && burst < 0; i++) {
          drive(1);
          const d = Math.hypot(best.it.x - o.x - car.x, best.it.z - o.z - car.z, best.it.y + 0.6 * best.it.size - (car.y + 0.5));
          if (came < 0 && d < 8) came = i;
          if (best.it.gone) burst = i;
        }
        const sp = up.spores;
        const last = sp._bursts[sp._bursts.length - 1];
        const thrown = sp.count();
        // The lens by the burst, looking at it (the car has gone on).
        const cam = g.camera;
        const rig = g.chase.update;
        g.chase.update = function (...a) {
          rig.apply(this, a);
          cam.up.set(0, 1, 0);
          cam.position.set(last.x + 6, last.y + 3, last.z + 4);
          cam.lookAt(last.x, last.y + 0.6, last.z);
          cam.updateMatrixWorld();
        };
        drive(24);
        g.chase.update = rig;
        const age = sp.clock - last.at;
        const spec = U.sporeBurst(last.seed);
        const f = grab();
        const pts = spec.map((s0) => { const p = U.sporeAt([last.x, last.y, last.z], s0, age); return screen(p[0], p[1], p[2]); });
        const view = pts.filter((p) => p.z > -1 && p.z < 1 && p.x > 6 && p.x < f.w - 6 && p.y > 6 && p.y < f.h - 6);
        const red = view.filter((p) => redAt(f, p.x, p.y, 4) > 25);
        const goneFromClutter = (g.clutter.counts.spore || 0) <= kinds0;
        return { came, burst, thrown, age, view: view.length, red: red.length, pods: up.pods, goneFromClutter };`);
      say(!pod.error && !pod.none && pod.came >= 0 && pod.burst >= pod.came && pod.burst - pod.came <= 30 && pod.thrown >= SPORES.per,
        `a pod came within ${SPORES.reach} m of the car at step ${pod.came} and burst at step ${pod.burst}, ${pod.burst - pod.came} steps (a sixtieth of a second each) after, 0.5 s at the most, throwing ${pod.thrown} spores${pod.error ? ' ' + pod.error : ''}`);
      say(!pod.error && !pod.none && pod.view >= 8 && pod.red >= 0.6 * pod.view, `${pod.red} of the ${pod.view} spores in view are red in the frame where they are worked out to be, ${f(pod.age)} s on${pod.error ? ' ' + pod.error : ''}`);

      say(page2.logs.length === 0, `with no error (${page2.logs[0] || 'none'})`);
    } finally {
      page2.close();
    }
    const page3 = await openPage('seed=7&world=upside&worldlen=60000&run=60&cam=chase&style=real');
    try {
      // At the low tier a flash that is the fifth stays in the sky, and the pod stays where it is.
      const low = await page3.run(`${LIB}
        g.setTier('low');
        put(1500); drive(60);
        const k0 = up.groundStrikes, h0 = up.strike.hits, p0 = up.pods, t0 = up.spores.thrown;
        up._strikes = 9;
        for (let i = 0; i < 5; i++) { up._next = i === 0 ? 0.0001 : 1e9; g.pilot.vMax = 22; g.update(1 / 60); }
        drive(600);
        return { grounded: up.groundStrikes - k0, hits: up.strike.hits - h0, scorch: up.strike.scorch.visible, sky: up.bolt.y, pods: up.pods - p0, spores: up.spores.thrown - t0, shown: up.spores.points.visible };`);
      say(!low.error && low.grounded === 0 && low.hits === 0 && !low.scorch && low.sky > 0 && low.pods === 0 && low.spores === 0,
        `at the low tier the fifth flash is the sky's (${low.grounded} came down, its line is in the sky) and no pod bursts (${low.pods})${low.error ? ' ' + low.error : ''}`);
      say(page3.logs.length === 0, `with no error (${page3.logs[0] || 'none'})`);
    } finally {
      page3.close();
    }
  }
} finally {
  web.kill();
}

console.error(failed ? `\nFAILED: ${failed} check(s)` : '\nOK');
process.exit(failed ? 1 : 0);
