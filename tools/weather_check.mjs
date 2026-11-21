// The weather changes from one world to the next the way weather does.
//
// Runs the page headless (seed 7) on a road of two worlds at a time, and walks
// a point along the road from well before the border to past it, reading the
// sky, the light and the weather round the camera (render/weather.js) every
// twelve metres, without drawing:
//  - nothing jumps: the most any of them (the sun, the exposure, the
//    horizon's colour overhead and in all twenty-four directions) moves in
//    twelve metres is a few hundredths of all the way from one world's to the
//    other's;
//  - the front is seen coming: at the start of the border the horizon ahead
//    is already part-way to the next world's, and the one behind is still the
//    last world's;
//  - the whole thing is the next world's once the border is past, and was the
//    last world's before the front showed;
//  - the clouds baked into the sky (render/clouds.js) are ready in 60 frames,
//    crossed to another set over twenty seconds, wanted by the world a little
//    ahead of the lens, and still from one frame to the next;
//  - a day world has three skies (world/worlds.js, SKIES), and a sky comes in as
//    a front does. In node: only the six day worlds have skies, a sky keeps its
//    world's cloud set and its sun's direction and is weaker in the sun and
//    nearer to grey than the one before it, the schedule counts the laps of
//    each world and a sky goes by its lap (or the pin, or the address). In the
//    page, walked along the world's axis every twelve metres as the borders
//    above are: from one sky to the next (noon to golden, golden to grey, grey
//    to noon, over the borders of two worlds' laps), and over the border each
//    day world has with the one after it under each of the skies held: the most
//    any of the sun, the exposure, the horizon, the zenith, the glow, the
//    haze, the clouds and their paint, the shadow, the painted sky, the real style's sky
//    and exposure and the colour of the light on the painted paints moves in twelve metres is under 6 % of the way, and each side of a border is under
//    the sky it should be; the three laps of a world come in turn (the
//    numbers of its look read in the middle of each lap), a pin holds one world
//    to one sky for every lap and lets go, and the address holds all.
//
// Usage: node tools/weather_check.mjs
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { WORLDS, SKIES, SKY_INDEX, SkyChoice, WorldMap, skyLook, hasSkies } from '../src/world/worlds.js';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8185;
const ROOT = new URL('..', import.meta.url).pathname;
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
  const profile = `${tmpdir()}/continuum-weather-${process.pid}-${Date.now()}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--window-size=800,450', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
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
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  });
  const ev = (expression) => new Promise((resolve) => {
    pending.set(++id, (r) => resolve(r && r.result ? (r.result.value !== undefined ? r.result.value : r.result.description) : r));
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  let title = '';
  for (let i = 0; i < 600; i++) {
    title = await ev('document.title');
    if (title === 'GAME_DONE' || String(title).startsWith('GAME_FAIL')) break;
    await sleep(500);
  }
  if (title !== 'GAME_DONE') throw new Error(`page: ${title}`);
  return {
    run: async (body) => {
      const out = await ev(`(async () => { const g = game; ${body} })().then((v) => JSON.stringify(v), (e) => JSON.stringify({ error: e.message }))`);
      return JSON.parse(out);
    },
    close: () => {
      chrome.kill();
      setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
    },
  };
}

// In the page: the first border of the road, walked from 2.4 km before it to
// 300 m past it.
const WALK = `
  const W = g.worlds;
  const o = g.road.origin;
  const top = g.road.classified * 2 - 4;
  let s0 = null, s1 = null;
  for (let s = 60; s < top; s += 4) {
    const p = g.road.at(s);
    if (!p) continue;
    const w = W.at(p.x + o.x, p.z + o.z);
    if (w.a !== w.b && w.t > 0.001) {
      if (s0 === null) s0 = s;
      s1 = s;
    } else if (s0 !== null) break;
  }
  if (s0 === null) return { error: 'no border on this road' };
  const R = await import('./src/render/ring.js');
  const N = R.RING_N;
  const at = (s) => {
    const p = g.road.at(s);
    g._updateLook(p.x, p.z, 0.02, true);
    const l = g._look;
    return { s, sun: l.sunIntensity, exp: l.exposure, hz: [l.horizon.r, l.horizon.g, l.horizon.b], ring: Array.from(R.ringU.uRingH.value) };
  };
  const from = Math.max(60, s0 - 2400);
  const rows = [];
  for (let s = from; s <= s1 + 300 && s < top; s += 12) rows.push(at(s));
  const fwd = Math.floor((Math.atan2(W.dz, W.dx) / (2 * Math.PI) + 0.5) * N) % N;
  const back = (fwd + N / 2) % N;
  const start = at(s0);
  return { s0, s1, rows, fwd, back, N, start, a: g._lookAt.a, b: g._lookAt.b };
`;


// In the page (the paint style, a road of hills and then desert): the clouds
// baked into the sky (render/clouds.js). A set is baked a strip a frame and
// is ready within 60 frames; a set asked for after it is baked into the free
// cube and crossed to over twenty seconds, steadily; which set the sky wants
// goes by the world a little ahead of the lens; the sky of a car that stands
// still is the same picture a second on; and a face of the cube holds the
// shares of cloud the sets are for (a set of towers stands on the horizon and
// has none high up; a dry sky has little).
const CLOUDS = `
  const { Clouds } = await import('./src/render/clouds.js');
  const axis = Math.atan2(g.worlds.dz, g.worlds.dx);
  const out = {};
  const c = new Clouds(g.renderer, { seed: 7, axis, sync: false, tier: 'high' });
  c.want('fair');
  let frames = 0;
  while (!c.baked && frames < 400) { c.update(1 / 60, true); frames++; }
  out.frames = frames;
  out.strips = c.frames;
  c.want('few');
  let ask = 0;
  while (!c.crossing && ask < 400) { c.update(1 / 60, true); ask++; }
  out.ask = ask;
  let steps = 0;
  let last = 0;
  let steady = true;
  let most = 0;
  while (c.crossing && steps < 3000) {
    c.update(1 / 60, true);
    steps++;
    if (!c.crossing) break;
    const t = c.uniforms.uCloudT.value;
    if (t < last - 1e-9) steady = false;
    most = Math.max(most, t - last);
    last = t;
  }
  out.cross = steps / 60;
  out.steady = steady;
  out.step = most;
  out.set = c.set;
  out.done = !c.crossing && c.uniforms.uCloudT.value === 0;
  // A low tier draws no crossing: the new set is simply the one in use.
  const low = new Clouds(g.renderer, { seed: 7, axis, sync: false, tier: 'low' });
  low.want('fair');
  for (let i = 0; i < 400 && !low.baked; i++) low.update(1 / 60, true);
  low.want('few');
  let lowCross = false;
  for (let i = 0; i < 400 && low.set !== 'few'; i++) { low.update(1 / 60, true); lowCross = lowCross || low.crossing; }
  out.low = { set: low.set, crossed: lowCross, size: low.size };
  c.dispose();
  low.dispose();

  // The shares of cloud in the set's cube, weighted by solid angle: of the
  // sky above the horizon, and above 20 degrees of elevation.
  const share = (name) => {
    const cl = new Clouds(g.renderer, { seed: 7, axis, sync: true, tier: 'mid' });
    cl.want(name);
    cl.update(1 / 60, true);
    cl.update(1 / 60, true);
    const rt = cl.cubes[cl.live];
    const S = rt.width;
    const buf = new Uint8Array(S * S * 4);
    const sin20 = Math.sin(20 * Math.PI / 180);
    const dir = (f, a, b) => [[1, -b, -a], [-1, -b, a], [a, 1, b], [a, -1, -b], [a, -b, 1], [-a, -b, -1]][f];
    let wAll = 0, cAll = 0, wHigh = 0, cHigh = 0;
    for (const f of [0, 1, 2, 4, 5]) {
      g.renderer.readRenderTargetPixels(rt, 0, 0, S, S, buf, f);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const a = (x + 0.5) / S * 2 - 1, b = (y + 0.5) / S * 2 - 1;
        const d = dir(f, a, b);
        const n = Math.hypot(d[0], d[1], d[2]);
        const el = d[1] / n;
        if (el <= 0) continue;
        const w = 1 / Math.pow(1 + a * a + b * b, 1.5);
        const cover = buf[(y * S + x) * 4 + 3] / 255 > 0.5 ? 1 : 0;
        wAll += w; cAll += w * cover;
        if (el > sin20) { wHigh += w; cHigh += w * cover; }
      }
    }
    cl.dispose();
    return { all: cAll / wAll, high: cHigh / wHigh };
  };
  out.share = { fair: share('fair'), few: share('few'), towers: share('towers') };

  // The sky on its own, from where the lens is, a second apart with the car
  // standing: not a pixel of it moves.
  g.autoMode = true;
  g.car.vx = 0;
  g.pilot.vMax = 0;
  for (let i = 0; i < 400 && Math.abs(g.car.speed) > 0.001; i++) g.update(1 / 60);
  out.speed = g.car.speed;
  const THREE = await import('three');
  const W = 256, H = 144;
  const rt = new THREE.WebGLRenderTarget(W, H);
  const scene = new THREE.Scene();
  const dome = new THREE.Mesh(g.atmosphere.sky.geometry, g.atmosphere.sky.material);
  dome.frustumCulled = false;
  dome.scale.setScalar(4000);
  scene.add(dome);
  const lens = g.camera.clone();
  lens.position.set(0, 0, 0);
  lens.lookAt(Math.cos(1.1), 0.35, Math.sin(1.1));
  lens.updateMatrixWorld();
  const shot = () => {
    dome.material = g.atmosphere.sky.material;
    const b = new Uint8Array(W * H * 4);
    g.renderer.setRenderTarget(rt);
    g.renderer.clear();
    g.renderer.render(scene, lens);
    g.renderer.readRenderTargetPixels(rt, 0, 0, W, H, b);
    g.renderer.setRenderTarget(null);
    return b;
  };
  const one = shot();
  for (let i = 0; i < 60; i++) g.update(1 / 60);
  const two = shot();
  let apart = 0, cloudPx = 0;
  for (let i = 0; i < one.length; i += 4) {
    if (one[i] !== two[i] || one[i + 1] !== two[i + 1] || one[i + 2] !== two[i + 2]) apart++;
    if (one[i] > 200 && one[i + 1] > 200) cloudPx++;
  }
  rt.dispose();
  out.still = { apart, cloudPx, material: [g.atmosphere.skyPlainHeaps, g.atmosphere.skyPlainPure].includes(g.atmosphere.sky.material) };
  return out;
`;

// In the page: the set the sky wants, read at each step of a walk from 600 m
// before the first border to 600 m past it (the look is the world a little
// ahead of the lens).
const SETS = `
  const W = g.worlds;
  const o = g.road.origin;
  const top = g.road.classified * 2 - 4;
  let s0 = null, s1 = null;
  for (let s = 60; s < top; s += 4) {
    const p = g.road.at(s);
    if (!p) continue;
    const w = W.at(p.x + o.x, p.z + o.z);
    if (w.a !== w.b && w.t > 0.001) {
      if (s0 === null) s0 = s;
      s1 = s;
    } else if (s0 !== null) break;
  }
  if (s0 === null) return { error: 'no border on this road' };
  const seq = [];
  for (let s = Math.max(60, s0 - 600); s <= s1 + 600 && s < top; s += 12) {
    const p = g.road.at(s);
    g._updateLook(p.x, p.z, 0.02, true);
    seq.push(g._look.cloudSet);
  }
  const flips = seq.filter((v, i) => i > 0 && v !== seq[i - 1]).length;
  return { first: seq[0], last: seq[seq.length - 1], flips, n: seq.length };
`;

// In the page: the k-th border of the schedule, found along the world's axis
// (so that it is as far on as the loop goes, whatever of the road is laid), and
// walked from 2.4 km before it to 300 m past it every 12 m, as WALK does the
// first border of the road: the same numbers, and with them the zenith, the
// glow, the colour of the sun, the haze, the shadow of a cloud and of the sun,
// the paint of the clouds and of the painted sky, the colours the painted
// style's paints are lit in, and which sky each side of the border is under.
const AXIS = (k) => `
  const W = g.worlds;
  const o = g.road.origin;
  const R = await import('./src/render/ring.js');
  const N = R.RING_N;
  const tmp = { a: 0, b: 0, t: 0, u: 0, la: 0, lb: 0 };
  const borders = [];
  let cur = null;
  for (let d = -1200; d < 60000; d += 4) {
    const w = W.at(W.ox + W.dx * d, W.oz + W.dz * d, tmp);
    if (w.t > 0.001 && (w.a !== w.b || w.la !== w.lb)) {
      if (!cur) borders.push(cur = [d, d]);
      cur[1] = d;
    } else {
      cur = null;
    }
  }
  const border = borders[${k}];
  if (!border) return { error: 'no border ${k} on this loop (it has ' + borders.length + ')' };
  const [s0, s1] = border;
  const at = (d) => {
    g._updateLook(W.ox + W.dx * d - o.x, W.oz + W.dz * d - o.z, 0.02, true);
    const l = g._look;
    const c = (x) => [x.r, x.g, x.b];
    // The skies of the two worlds the lens is between (the look is of those a little ahead).
    const w = W.at(W.ox + W.dx * d, W.oz + W.dz * d, tmp);
    return {
      s: d, sun: l.sunIntensity, exp: l.exposure, hz: c(l.horizon), ring: Array.from(R.ringU.uRingH.value),
      more: [...c(l.zenith).map((v) => [v]), ...c(l.glow).map((v) => [v]), ...c(l.sunColor).map((v) => [v]),
        [Math.log(l.fogDensity)], [l.shadow], [l.cloudShadow], [l.hemiIntensity], [l.envIntensity], Array.from(l.cloudPaint), Array.from(l.paint), Array.from(l.tint),
        [l.realExpose], [l.realLight], [l.realFog], [l.realK], Array.from(l.real)],
      sky: [g.skies.of(w.a, w.la), g.skies.of(w.b, w.lb)],
    };
  };
  const rows = [];
  for (let d = Math.max(-1200, s0 - 2400); d <= s1 + 300; d += 12) rows.push(at(d));
  const fwd = Math.floor((Math.atan2(W.dz, W.dx) / (2 * Math.PI) + 0.5) * N) % N;
  return { s0, s1, rows, N, fwd, start: at(s0) };
`;

// In the page: the look read where the sky is steady (the world a little ahead
// of the lens has no border to it yet), along the world's axis, for each lap of
// each world: which sky it is under and the sun's strength there. pins: the
// worlds held to a sky, { world id: sky id }, put first.
const LAPS = (pins) => `
  g.setSkyPins(${JSON.stringify(pins)});
  const W = g.worlds;
  const o = g.road.origin;
  const seen = new Map();
  const order = [];
  for (let d = -1200; d < 30000; d += 8) {
    g._updateLook(W.ox + W.dx * d - o.x, W.oz + W.dz * d - o.z, 0.02, true);
    const w = g._wl;
    if (w.t > 0) continue;
    const key = w.a + '#' + w.la;
    let e = seen.get(key);
    if (!e) {
      e = { world: w.a, lap: w.la, sky: g.skies.of(w.a, w.la), sun: [Infinity, -Infinity], n: 0 };
      seen.set(key, e);
      order.push(e);
    }
    const sun = g._look.sunIntensity;
    e.sun[0] = Math.min(e.sun[0], sun);
    e.sun[1] = Math.max(e.sun[1], sun);
    e.n++;
  }
  return { order, pins: Array.from(g.skies.pins), all: g.skies.all };
`;

const PAIRS = [['hills', 'desert'], ['river', 'city'], ['city', 'cavern'], ['abyss', 'heaven'], ['heaven', 'space'], ['space', 'upside']];

// The skies' borders (AXIS): from one sky to the next, over the borders between
// the laps of a loop of two worlds (the second border is into the second lap of
// the first world: noon to golden; the fourth, golden to grey; the sixth, grey
// to noon); and every border a day world has (the loop of all twelve worlds from
// the alpine, a border is the k-th: alpine to hills 0, hills to river 1, river
// to coast 2, coast to desert 3, desert to city 4, abyss to heaven 8, heaven to
// space 9, upside to alpine 11), with every day world held to golden and then to
// grey by the address (a night world is under its own).
const LAP_BORDERS = [[1, 'noon', 'golden'], [3, 'golden', 'grey'], [5, 'grey', 'noon']];
const DAY_BORDERS = [0, 1, 2, 3, 4, 8, 9, 11];

let failed = 0;
const say = (ok, text) => {
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};

// The kinds of number a walk reads in each row, each against how far it goes at
// all on the walk (the most and the least it is anywhere, in the sky and in
// every direction round): the sun, the exposure, the horizon, and the horizon
// and the clouds in each of the n directions of the ring.
const classesOf = (n) => (r) => [[r.sun], [r.exp], [r.hz[0]], [r.hz[1]], [r.hz[2]],
  ...[0, 1, 2, 3].map((c) => Array.from({ length: n }, (_, k) => r.ring[k * 4 + c])),
  ...(r.more || [])];

// The most any kind of number moves in twelve metres (a step of the walk) as a
// share of how far it goes at all, and where; a kind that goes less than 0.03
// altogether is left out.
function worstStep(rows, classes) {
  const lo = classes(rows[0]).map(() => Infinity);
  const hi = classes(rows[0]).map(() => -Infinity);
  for (const r of rows) {
    classes(r).forEach((vs, i) => {
      for (const v of vs) {
        if (v < lo[i]) lo[i] = v;
        if (v > hi[i]) hi[i] = v;
      }
    });
  }
  let jump = 0;
  let where = 0;
  for (let k = 1; k < rows.length; k++) {
    const x = classes(rows[k - 1]);
    const y = classes(rows[k]);
    for (let i = 0; i < x.length; i++) {
      const range = hi[i] - lo[i];
      if (range < 0.03) continue;
      for (let j = 0; j < x[i].length; j++) {
        const f = Math.abs(y[i][j] - x[i][j]) / range;
        if (f > jump) {
          jump = f;
          where = rows[k].s;
        }
      }
    }
  }
  return { jump, where };
}

// --- the skies, in node ---------------------------------------------------------

const DAY_WORLDS = ['alpine', 'hills', 'river', 'coast', 'desert', 'heaven'];
// A colour of a look (0xRRGGBB, or [r, g, b] in linear light) in linear light, and how far it is
// from grey (0: grey; 1: a single primary).
const linear = (c) => (Array.isArray(c) ? c : [(c >> 16) & 255, (c >> 8) & 255, c & 255].map((v) => {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}));
const colourful = (c) => {
  const v = linear(c);
  const m = Math.max(...v);
  return m > 0 ? (m - Math.min(...v)) / m : 0;
};

function skiesInNode() {
  const day = WORLDS.filter(hasSkies);
  say(day.map((w) => w.id).join() === DAY_WORLDS.join() && SKIES.join() === 'noon,golden,grey',
    `the ${day.length} day worlds (${day.map((w) => w.name).join(' ')}) have the three skies ${SKIES.join(', ')} and no night world has any`);
  const worse = [];
  for (const w of day) {
    const [noon, golden, grey] = SKIES.map((id) => skyLook(w.look, id));
    // The sun stands where it stands and the sky is the same world's: the cloud set
    // is the one the baked cube holds (render/clouds.js bakes the light and the form of
    // a set, and the paint of the sky's colours is the shader's), and no sky says where the sun is.
    if (!SKIES.every((id) => skyLook(w.look, id).cloudSet === w.look.cloudSet)) worse.push(`${w.id}: the cloud set`);
    if (SKIES.some((id) => 'sunElev' in skyLook(w.look, id) || 'sunAz' in skyLook(w.look, id))) worse.push(`${w.id}: the sun's direction`);
    // Weaker in the sun from noon to golden to grey; golden warmer, grey as near to grey as light is.
    if (!(noon.sunIntensity > golden.sunIntensity && golden.sunIntensity > grey.sunIntensity)) worse.push(`${w.id}: the sun's strength`);
    const hg = linear(golden.horizon);
    if (!(hg[0] > hg[1] && hg[1] > hg[2]) || !(colourful(golden.sunColor) > colourful(noon.sunColor))) worse.push(`${w.id}: golden is not warm`);
    if (![grey.sunColor, grey.zenith, grey.horizon, grey.glow].every((c) => colourful(c) <= 0.25)) worse.push(`${w.id}: grey has a colour`);
    if (!(grey.clouds > noon.clouds - 1e-9 && grey.fogDensity > golden.fogDensity && golden.fogDensity > noon.fogDensity)) worse.push(`${w.id}: the haze`);
    const shadow = (l) => (l.shadow === undefined ? 1 : l.shadow);
    const cloudShadow = (l) => (l.cloudShadow === undefined ? 1 : l.cloudShadow);
    if (!(cloudShadow(grey) === 0 && shadow(grey) < shadow(golden) && shadow(golden) <= shadow(noon) && cloudShadow(golden) > 0)) worse.push(`${w.id}: the shadows`);
    // The painted style: a sky of three bands and clouds of four paints, in every sky.
    for (const [id, l] of [['noon', noon], ['golden', golden], ['grey', grey]]) {
      const sky = l.paintSky.flat();
      const cloud = l.cloudPaint ? l.cloudPaint.flat() : null;
      if (l.paintSky.length !== 3 || sky.length !== 9 || !sky.every((v) => v > 0 && v < 4)) worse.push(`${w.id} ${id}: the painted sky`);
      if (id !== 'noon' && (!cloud || cloud.length !== 12 || !cloud.every((v) => v > 0 && v < 4))) worse.push(`${w.id} ${id}: the painted clouds`);
    }
    // The real style: noon has a sky of three colours of its own, a blue one (the zenith the
    // bluest, the horizon the palest) and takes less than all of the world's exposure; golden and
    // grey have none, and the exposure the world gives them.
    const rs = noon.realSky ? noon.realSky : [];
    const blueness = (c) => (c[2] - Math.max(c[0], c[1])) / c[2];
    if (rs.length !== 3 || rs.flat().length !== 9 || !rs.flat().every((v) => v > 0 && v < 1)) worse.push(`${w.id}: the real sky`);
    else if (!(blueness(rs[0]) > blueness(rs[1]) && blueness(rs[1]) > 0 && rs[2].every((v, i) => v >= rs[1][i]))) worse.push(`${w.id}: the real sky is not blue above and pale below`);
    const hazeShare = noon.realFog === undefined ? 1 : noon.realFog;
    if (!(noon.realExpose > 0.3 && noon.realExpose < 1 && noon.realLight > 0.3 && noon.realLight <= 1 && hazeShare > 0.3 && hazeShare <= 1)) worse.push(`${w.id}: the real style's exposure, sky light and haze`);
    if (golden.realSky !== null || grey.realSky !== null || [golden, grey].some((l) => l.realExpose !== 1 || l.realLight !== 1 || l.realFog !== 1)) worse.push(`${w.id}: the real style's sky, exposure, sky light and haze in golden and grey`);
    const tint = (l) => (l.paintTint ? [l.paintTint.lit, l.paintTint.shade] : [[1, 1, 1], [1, 1, 1]]);
    const [tg, tn] = [tint(golden), tint(noon)];
    if (!(tn[0].every((v) => v === 1) && tn[1].every((v) => v === 1))) worse.push(`${w.id}: noon is tinted`);
    if (!(tg[0][0] > tg[0][2] && tg[1][2] > tg[1][0])) worse.push(`${w.id}: golden is lit warm and its shade is cool`);
    if (!tint(grey).every((c) => colourful(c) <= 0.15)) worse.push(`${w.id}: grey's paints are tinted`);
    const bands = grey.paintSky;
    if (!bands.every((c) => colourful(c) <= 0.4)) worse.push(`${w.id}: grey's painted sky has a colour`);
    const warm = golden.paintSky;
    if (!(warm[1][0] > warm[1][2] && warm[2][0] > warm[2][2])) worse.push(`${w.id}: golden's painted sky is not warm`);
  }
  say(!worse.length, `each sky of a day world is its world's own look with the sun where it stands and the cloud set it has (so no clouds are baked for a sky), golden is warm and weaker in the sun, grey is a grey light and a thicker haze with no shadow of a cloud and less of the sun's, and both have a painted sky and painted clouds, noon has a blue sky of three colours for the real style and a share of the exposure, of the sky's light and of the haze, and the other two have all of each${worse.length ? ' (' + worse.slice(0, 4) + ')' : ''}`);
  say(day.every((w) => skyLook(w.look, 'noon') === w.look), 'noon is the look the world is written with, as it is');

  // The schedule counts the laps. Two worlds taking turns, walked along their
  // axis: each time one comes it is on the lap its visits so far make it.
  const map = new WorldMap({ loop: ['hills', 'river'], start: 'hills', len: 1000 });
  map.setAxis(0, 0, 0);
  const at = { a: 0, b: 0, t: 0, u: 0, la: 0, lb: 0 };
  const visits = {};
  const order = [];
  let prev = null;
  let counted = true;
  for (let x = 0; x < 12000; x += 40) {
    map.at(x, 0, at);
    const key = at.a + ':' + at.la;
    if (key === prev) continue;
    prev = key;
    const w = WORLDS[at.a].id;
    visits[w] = (visits[w] || 0) + 1;
    counted = counted && at.la === visits[w] - 1;
    order.push(w + '#' + at.la);
  }
  say(order.length >= 10 && counted && order.every((n, i) => n.startsWith(i % 2 ? 'river' : 'hills')),
    `the laps are counted from the schedule: ${order.slice(0, 6).join(' ')} ... (a world's lap is how many times the road has been in it before)`);
  // The schedule rewritten (a world asked for) keeps the laps of what is kept and
  // counts the one asked for.
  const m2 = new WorldMap({ start: 'alpine', len: 1000 });
  m2.setAxis(0, 0, 0);
  m2.at(5000, 0, at);
  const name = (m) => m.segs.map((x) => WORLDS[x.w].id + '#' + x.lap);
  const before = name(m2);
  m2.ask(WORLDS.findIndex((w) => w.id === 'hills'), 2500);
  const after = name(m2);
  m2.at(40000, 0, at);
  say(after.slice(0, -1).join() === before.slice(0, after.length - 1).join() && after[after.length - 1] === 'hills#1'
    && m2.segs.every((x, i) => x.lap === m2.segs.slice(0, i).filter((y) => y.w === x.w).length),
  `a world asked for is on its next lap (${after[after.length - 1]} after ${after.slice(-2, -1)}), the laps already made are as they were, and every segment has the number of the ones of its world before it`);

  // The sky of a lap, a pin and the address.
  const sc = new SkyChoice();
  const idx = (id) => WORLDS.findIndex((w) => w.id === id);
  const seq = (w) => [0, 1, 2, 3, 4, 5].map((l) => SKIES[sc.of(idx(w), l)]).join();
  const rotation = seq('hills');
  const nights = seq('city');
  sc.setPins({ hills: 'golden', coast: 'night', city: 'grey' });
  const pinned = seq('hills');
  const others = seq('river');
  sc.setPins({});
  const let_go = seq('hills');
  sc.all = SKY_INDEX.grey;
  say(rotation === 'noon,golden,grey,noon,golden,grey' && nights === 'noon,noon,noon,noon,noon,noon' && pinned === 'golden,golden,golden,golden,golden,golden'
    && others === 'noon,golden,grey,noon,golden,grey' && let_go === rotation && seq('hills') === 'grey,grey,grey,grey,grey,grey' && seq('city') === nights,
  `a day world has noon, golden and grey in turn by lap, one it is held to on every lap and the next lap's again once let go, the address (grey) over all of them, and a night world only its own`);
}
skiesInNode();

const server = serve();
if (!(await waitForServer())) {
  console.error('FAIL: no server');
  server.kill();
  process.exit(1);
}
let exitCode = 0;
try {
  for (const [a, b] of PAIRS) {
    const page = await openPage(`seed=7&world=${a}&loop=${a},${b}&worldlen=4000&run=5&cam=chase`);
    const d = await page.run(WALK);
    page.close();
    if (d.error) {
      say(false, `${a} to ${b}: ${d.error}`);
      continue;
    }
    const rows = d.rows;
    const first = rows[0];
    const last = rows[rows.length - 1];
    const { jump, where } = worstStep(rows, classesOf(d.N));
    say(jump < 0.06, `${a} to ${b}: nothing jumps (the most in 12 m is ${(jump * 100).toFixed(1)} % of the way, at ${where} m)`);
    const hzA = first.hz;
    const hzB = last.hz;
    const l1 = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
    const way = l1(hzA, hzB);
    const bin = (r, k) => [r.ring[k * 4], r.ring[k * 4 + 1], r.ring[k * 4 + 2]];
    if (way > 0.08) {
      const ahead = l1(bin(d.start, d.fwd), hzA) / way;
      const behind = l1(bin(d.start, d.back), hzA) / way;
      say(ahead > 0.25, `${a} to ${b}: the front is seen coming (at the start of the border the horizon ahead is ${(ahead * 100).toFixed(0)} % of the way to the next world's)`);
      say(behind < 0.1, `${a} to ${b}: and behind it is still the last world's (${(behind * 100).toFixed(0)} % of the way)`);
    }
    const end = l1(last.hz, bin(last, d.fwd)) / Math.max(way, 0.08);
    say(end < 0.15, `${a} to ${b}: past the border it is all the next world's (the horizon ahead is within ${(end * 100).toFixed(0)} % of the sky overhead)`);
  }

  // The clouds baked into the sky.
  {
    const page = await openPage('seed=7&world=hills&loop=hills,desert&worldlen=4000&run=5&cam=chase&style=paint');
    try {
      const d = await page.run(CLOUDS);
      if (d.error) {
        say(false, `clouds: ${d.error}`);
      } else {
        say(d.frames <= 60, `a set of clouds is baked and ready within 60 frames (${d.frames}: ${d.strips} strips)`);
        say(d.set === 'few' && d.done && d.ask <= 60, `a set asked for after it is baked into the free cube in ${d.ask} frames and is the one in use after the crossing`);
        say(Math.abs(d.cross - 20) < 0.2 && d.steady && d.step < 0.01, `the two cubes are crossed over ${d.cross.toFixed(1)} s (20), and steadily (${(d.step * 100).toFixed(2)} % at most in a frame)`);
        say(d.low.set === 'few' && !d.low.crossed && d.low.size === 384, `at the low tier (${d.low.size} texels a face) the new set is the one in use with no crossing`);
        say(d.share.towers.high <= 0.05, `of the sky above 20 degrees, the towers on the horizon are ${(d.share.towers.high * 100).toFixed(1)} % cloud (at most 5 %)`);
        say(d.share.few.all < d.share.fair.all * 0.6 && d.share.fair.all > 0.05, `a dry sky has less cloud than a fair one (${(d.share.few.all * 100).toFixed(1)} % of the sky against ${(d.share.fair.all * 100).toFixed(1)} %)`);
        say(d.still.material && d.still.apart === 0 && d.still.cloudPx > 200, `the sky of a car standing still is the same picture a second on: ${d.still.apart} pixels apart of the ${d.still.cloudPx} that are cloud or its light`);
      }
      const q = await page.run(SETS);
      say(!q.error && q.first === 'fair' && q.last === 'few' && q.flips === 1, `the set the sky wants goes by the world a little ahead of the lens: ${q.first} before the border of the hills and the desert, ${q.last} past it, changed ${q.flips} time${q.flips === 1 ? '' : 's'}${q.error ? ' ' + q.error : ''}`);
    } finally {
      page.close();
    }
  }

  // The skies of the day worlds.
  const sunOf = (world, sky) => skyLook(WORLDS[world].look, SKIES[sky]).sunIntensity;
  const steady = (e) => Math.abs(e.sun[0] - sunOf(e.world, e.sky)) < 1e-9 && Math.abs(e.sun[1] - sunOf(e.world, e.sky)) < 1e-9;
  const named = (order) => order.map((e) => `${WORLDS[e.world].id}#${e.lap} ${SKIES[e.sky]}`);
  const walk = async (page, label, k, skies) => {
    const d = await page.run(AXIS(k));
    if (d.error) {
      say(false, `${label}: ${d.error}`);
      return;
    }
    const { jump, where } = worstStep(d.rows, classesOf(d.N));
    say(jump < 0.06, `${label}: nothing jumps, in the sun, the horizon, the zenith, the glow, the haze, the clouds and what they are painted in, the shadows and the painted sky (the most in 12 m is ${(jump * 100).toFixed(1)} % of the way, at ${where} m)`);
    say(d.start.sky.map((v) => SKIES[v]).join() === skies.join(), `${label}: the two sides of the border are under ${d.start.sky.map((v) => SKIES[v]).join(' and ')} (${skies.join(' and ')} wanted)`);
  };

  // From one sky to the next, over the laps; the laps in turn, held and let go.
  {
    const page = await openPage('seed=7&world=hills&loop=hills,river&worldlen=2000&run=5&cam=chase');
    try {
      for (const [k, from, to] of LAP_BORDERS) await walk(page, `${from} to ${to} (border ${k} of the hills and the river)`, k, [from, to]);
      const rotation = await page.run(LAPS({}));
      const hills = rotation.order.filter((e) => WORLDS[e.world].id === 'hills');
      const river = rotation.order.filter((e) => WORLDS[e.world].id === 'river');
      say(hills.length >= 4 && river.length >= 4 && [...hills, ...river].every((e) => e.sky === e.lap % 3 && steady(e)),
        `the laps come in turn and the sky is read in the middle of each: ${named(rotation.order).slice(0, 8).join(', ')} ... (the sun is steady in each, and the look's own: ${hills.slice(0, 3).map((e) => e.sun[0].toFixed(3)).join(', ')} for the hills)`);
      const held = await page.run(LAPS({ hills: 'grey' }));
      say(held.order.filter((e) => WORLDS[e.world].id === 'hills').every((e) => e.sky === SKY_INDEX.grey && steady(e))
        && held.order.filter((e) => WORLDS[e.world].id === 'river').every((e, i) => e.sky === e.lap % 3 && steady(e))
        && held.order.filter((e) => WORLDS[e.world].id === 'hills').length >= 4,
      `the hills held to grey are grey on every lap and the river goes on in turn: ${named(held.order).slice(0, 8).join(', ')}`);
      const letGo = await page.run(LAPS({}));
      say(JSON.stringify(letGo.order) === JSON.stringify(rotation.order) && letGo.pins.every((v) => v === -1), 'let go, the hills are in turn again, as they were');
    } finally {
      page.close();
    }
  }
  // The border of each day world with its neighbours, under golden and under grey.
  for (const held of ['golden', 'grey']) {
    const page = await openPage(`seed=7&loop=${WORLDS.map((w) => w.id).join(',')}&worldlen=4000&run=5&cam=chase&sky=${held}`);
    try {
      for (const k of DAY_BORDERS) {
        const [a, b] = [WORLDS[k % 12], WORLDS[(k + 1) % 12]];
        await walk(page, `${a.id} to ${b.id} under ${held}`, k, [a, b].map((w) => (hasSkies(w) ? held : 'noon')));
      }
    } finally {
      page.close();
    }
  }
  // The address over everything: every day world golden, whatever the laps and what a world is held to; a night world its own.
  {
    const page = await openPage('seed=7&world=hills&loop=hills,city&worldlen=2000&run=5&cam=chase&sky=golden');
    try {
      const plain = await page.run(LAPS({}));
      const pinned = await page.run(LAPS({ hills: 'grey' }));
      const ok = (r) => r.order.length >= 6 && r.order.every((e) => (WORLDS[e.world].id === 'hills' ? e.sky === SKY_INDEX.golden : e.sky === 0) && steady(e))
        && r.order.filter((e) => WORLDS[e.world].id === 'city').every((e) => Math.abs(e.sun[0] - 0.9) < 1e-9);
      say(ok(plain) && ok(pinned) && plain.all === SKY_INDEX.golden, `with sky=golden in the address the hills are golden on every lap, held to grey or not, and the city (sun 0.9) is its own`);
    } finally {
      page.close();
    }
  }
} catch (e) {
  console.error(`FAIL: ${e.message}`);
  failed++;
  exitCode = 1;
} finally {
  server.kill();
}
if (failed) {
  console.error(`\n${failed} problem${failed > 1 ? 's' : ''}`);
  process.exit(1);
}
console.error('\nOK: the weather changes smoothly, is seen coming, and is the next world\'s once the border is past');
process.exit(exitCode);
