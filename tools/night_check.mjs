// The real style's night (render/headbeam.js, render/nightlight.js, the windows of render/city.js), drawn and
// left out of the same frames.
//
// Runs the real page headless in the city and the cavern at night and in the hills by day, a page for each,
// at the high tier, and draws a frame with the night's lights held off (night=0 in the address; in the page,
// game.nightOff) and with them on, the lens and the world as they were. It asserts:
//  - node, before any page: the beam's patch is on the spot light's colour and nothing else of the chunk is
//    changed, the tiers' numbers (twelve, six and no shafts under the road's lamps; eight, four and three
//    cars with their lamps, of them eight, three and no beams), the lights on a tower flash once in two
//    seconds;
//  - the lamps throw the dipped beam where the night is on and as they did where it is not: the spot light's
//    intensity is the real style's twelve times (and its cone, decay and range the beam's) at night, exactly
//    what it was with the lights held off in the other styles and by day; the pattern is on in the programs
//    that are not the painted style's and not in the painted style's;
//  - what a night draws: not more than four draws and two programs more than with it held off, the shafts
//    under the nearest lamps (at most twelve) and the lights on the towers, and the frame is lighter on the road
//    in front of the car;
//  - the windows are rooms: the lit windows within 150 m take twenty colours or more to paint (the old flat
//    panes took fewer), and far off the towers are as calm as they were or calmer;
//  - the lights on the towers flash: the same frame at ten moments in two seconds has a different count of
//    red lights each time, and the most is more than the least;
//  - cars: with cars put on the road facing the lens, their lamps are lit up and a beam goes out of the nearest,
//    at most as many as the tier has, and the wet road throws four of them back; away from the lens the
//    cars' lights are not drawn;
//  - every other style is the same with the lights held off and not (pixel for pixel), in the city, and the
//    real style by day in the hills; and with the style not the real one the lights are not drawn;
//  - the tiers: the middle one has fewer shafts and cars' lamps, the low one none of the shafts and the
//    rooms; the beam's pattern is in all three;
//  - the lights disposed of leave no geometry or program behind and no error.
// Times are written, not asserted (the machine is shared).
//
// Usage: node tools/night_check.mjs [--node] [--places city,cavern,hills] [--gpu] [--keep out/night]
//   --node   only the part that needs no browser
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const GPU = args.includes('--gpu');
const NODE_ONLY = args.includes('--node');
const KEEP = opt('--keep', null);
const PLACES = {
  city: { world: 'city', s: 2200 },
  cavern: { world: 'cavern', s: 2200 },
  hills: { world: 'hills', s: 5000 },
};
const places = opt('--places', 'city,cavern,hills').split(',');

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8209;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const say = (ok, msg) => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
};

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

// The page, headless, and a way to run code in it; what the page logs as an error comes back with it.
async function openPage(query) {
  const profile = `${tmpdir()}/continuum-night-${process.pid}-${Date.now()}`;
  const how = GPU
    ? ['--ignore-gpu-blocklist', '--enable-gpu', process.platform === 'darwin' ? '--use-angle=metal' : '--use-angle=vulkan']
    : ['--disable-gpu', '--enable-unsafe-swiftshader'];
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', ...how, '--mute-audio', '--hide-scrollbars',
    `--window-size=${GPU ? '1920,1223' : '1280,720'}`, '--remote-debugging-port=0', `--user-data-dir=${profile}`,
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
      logs.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 600));
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
      const out = await ev(`(async () => { const g = game; ${body} })().then((v) => JSON.stringify(v), (e) => JSON.stringify({ error: e.message + ' ' + (e.stack || '').slice(0, 400) }))`);
      return JSON.parse(out);
    },
    close: () => {
      chrome.kill();
      setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
    },
  };
}

// In the page: the car put on the road at s and run for two and a half seconds, in the style, as
// tools/look.mjs puts it down; the lens behind it, still.
const PLACE = (s, style = 'real') => `
  if (g.style.id !== ${JSON.stringify(style)}) { g.style.set(${JSON.stringify(style)}, true); g.style.applyScene(); }
  const p = g.road.at(${s});
  if (!p) return { error: 'no road at ${s}' };
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
  return { style: g.style.id };
`;

// In the page, with the place set: the frames and the numbers. The animals and the other cars are put away
// before each frame (the page's own update shows them again), unless a step wants the cars.
const MEASURE = (place) => `
  const THREE = await import('three');
  const hb = await import('./src/render/headbeam.js');
  const nl = await import('./src/render/nightlight.js');
  const r = g.renderer;
  const gl = r.getContext();
  const W = gl.drawingBufferWidth;
  const H = gl.drawingBufferHeight;
  const N = W * H;
  const hidden = [];
  {
    const seen = new Set();
    const walk = (v, d) => {
      if (!v || typeof v !== 'object' || seen.has(v) || ArrayBuffer.isView(v)) return;
      seen.add(v);
      if (v.isObject3D) { let o = v; while (o.parent && o.parent !== g.scene) o = o.parent; if (o.parent === g.scene) hidden.push(o); return; }
      if (d <= 0) return;
      if (v instanceof Map || v instanceof Set) { for (const x of v.values()) walk(x, d - 1); return; }
      if (Array.isArray(v)) { for (const x of v) walk(x, d - 1); return; }
      for (const k of Object.keys(v)) walk(v[k], d - 1);
    };
    walk(g.traffic, 2);
    walk(g.critters, 2);
  }
  let cars = false;
  const frame = () => {
    if (!cars) for (const o of hidden) o.visible = false;
    g.render();
  };
  const grab = () => {
    frame();
    const px = new Uint8Array(N * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const luma = (a, i) => 0.2126 * a[i * 4] + 0.7152 * a[i * 4 + 1] + 0.0722 * a[i * 4 + 2];
  const differ = (a, b, k = 1) => {
    let n = 0;
    for (let i = 0; i < N; i++) {
      if (Math.abs(a[i * 4] - b[i * 4]) >= k || Math.abs(a[i * 4 + 1] - b[i * 4 + 1]) >= k || Math.abs(a[i * 4 + 2] - b[i * 4 + 2]) >= k) n++;
    }
    return n / N;
  };
  const out = { place: ${JSON.stringify(place)}, size: [W, H] };
  const calls = () => r.info.render.calls;
  const night = g.night;
  const lamp = g.headlight;

  // Held off and on, the same frame; the state of the lights in each.
  g.nightOff = true;
  g.update(1 / 60);
  const off = grab();
  out.off = { calls: calls(), programs: r.info.programs.length, k: nl.nightU.uNightK.value, intensity: lamp.intensity, angle: lamp.angle,
    beamK: hb.beamU.uBeamK.value, shafts: night.shafts.mesh.visible, halos: night.halos.mesh.visible, real: g.style.now.real };
  g.nightOff = false;
  g.update(1 / 60);
  const on = grab();
  out.on = { calls: calls(), programs: r.info.programs.length, k: nl.nightU.uNightK.value, intensity: lamp.intensity, angle: lamp.angle, decay: lamp.decay,
    distance: lamp.distance, level: hb.beamU.uBeamLevel.value, beamK: hb.beamU.uBeamK.value, shafts: night.shafts.mesh.visible, halos: night.halos.mesh.visible,
    shaftCount: night.shafts.count, beacons: night.stat.beacons, lamps: night.stat.lamps, drawn: night.halos.count };
  out.differ = differ(off, on, 3);
  out.again = (() => { g.update(1 / 60); const a = grab(); return differ(on, a, 1); })();
  // The road in front of the car, 8 to 60 m: lighter with the beam. The pixels of the lower half of the frame, in the middle third.
  {
    let a = 0;
    let b = 0;
    let n = 0;
    for (let y = Math.floor(H * 0.0); y < Math.floor(H * 0.42); y++) {
      for (let x = Math.floor(W * 0.33); x < Math.floor(W * 0.66); x++) {
        const i = y * W + x;
        a += luma(off, i);
        b += luma(on, i);
        n++;
      }
    }
    out.road = { off: a / n, on: b / n };
  }

  // The lights on the towers flash: the frame at ten moments of two seconds, the count of red ones.
  {
    const counts = [];
    for (let k = 0; k < 10; k++) {
      night.update(g.camera, { share: g._night, time: 50 + k * 0.2, origin: g.road.origin });
      const px = grab();
      let n = 0;
      for (let i = 0; i < N; i++) {
        const R = px[i * 4];
        const G = px[i * 4 + 1];
        const B = px[i * 4 + 2];
        if (R > 150 && G < 70 && B < 70 && R > G * 3) n++;
      }
      counts.push(n);
    }
    out.flash = { counts, least: Math.min(...counts), most: Math.max(...counts) };
  }
  g.update(1 / 60);

  // The tiers.
  out.tiers = {};
  for (const t of ['mid', 'low', 'high']) {
    g.setTier(t);
    g.update(1 / 60);
    const px = grab();
    out.tiers[t] = { shafts: night.shafts.count, room: nl.nightU.uNightRoom.value, beamK: hb.beamU.uBeamK.value, calls: calls(), d: differ(off, px, 3) };
  }

  // The cars: four put on the road facing the lens and one going away; their lamps and beams, then the cars gone.
  {
    const { LANE } = await import('./src/world/road.js');
    g.traffic.cars.length = 0;
    const add = (id, ds, dir, type, colour) => {
      const s = g.traffic._spec(type);
      g.traffic.cars.push({ id, s: g.sCar + ds, dir, lane: dir > 0 ? LANE : -LANE, type, len: s.L, wid: s.W, hover: 0, speed: 14, want: 1, hue: 0.3, colour, tilt: 0 });
    };
    for (let k = 0; k < 10; k++) add(9100 + k, 60 + k * 40, -1, k % 2 ? 'taxi' : 'sedan', 0xc8472f);
    add(9200, 35, 1, 'sedan', 0x2a5a8a);
    cars = true;
    g.update(1 / 60);
    grab();
    const glow = g.traffic.glow;
    out.cars = glow ? { halos: glow.halos.count, beams: glow.shafts.count, reflections: glow.reflections.length, stat: glow.stat, shown: g.traffic.shown,
      visible: [glow.halos.mesh.visible, glow.shafts.mesh.visible], calls: calls(), meshes: g.traffic.glowMeshes.length } : null;
    const withCars = grab();
    g.setTier('mid'); g.update(1 / 60); grab();
    out.carsMid = { halos: glow.halos.count, beams: glow.shafts.count, stat: glow.stat };
    g.setTier('low'); g.update(1 / 60); grab();
    out.carsLow = { halos: glow.halos.count, beams: glow.shafts.count, stat: glow.stat };
    g.setTier('high');
    // The cars away from the lens are not lit up: all of them put 3 km off.
    g.traffic.cars.forEach((c) => { c.s = g.sCar + 3000; });
    g.update(1 / 60);
    out.carsFar = { halos: glow.halos.count, beams: glow.shafts.count };
    // Held off, the lights of the cars are not drawn.
    g.traffic.cars.length = 0;
    add(9300, 70, -1, 'taxi', 0xe8b82a);
    g.nightOff = true; g.update(1 / 60); grab();
    out.carsOff = { halos: glow.halos.count, visible: [glow.halos.mesh.visible, glow.shafts.mesh.visible] };
    g.nightOff = false;
    g.traffic.cars.length = 0;
    cars = false;
    g.update(1 / 60);
  }

  // Every other style, the lights held off and not.
  out.styles = {};
  if (${JSON.stringify(place)} !== 'cavern') {
    for (const st of ['ink', 'paint', 'cel', 'print', 'pixel', 'block']) {
      g.style.set(st, true);
      g.style.applyScene();
      g.update(1 / 60);
      g.nightOff = true;
      g.update(1 / 60);
      const a = grab();
      g.nightOff = false;
      g.update(1 / 60);
      const b = grab();
      out.styles[st] = { differ: differ(a, b, 1), k: nl.nightU.uNightK.value, shafts: night.shafts.mesh.visible, halos: night.halos.mesh.visible, beam: hb.beamU.uBeamK.value, intensity: lamp.intensity };
    }
    g.style.set('real', true);
    g.style.applyScene();
    g.update(1 / 60);
  }
  return out;
`;

// In the page: the lights disposed of, a second set made and disposed of again: nothing left behind.
const DISPOSE = `
  const nl = await import('./src/render/nightlight.js');
  const r = g.renderer;
  const geos = () => r.info.memory.geometries;
  g.render();
  const before = geos();
  const sc = g.scene;
  const again = new nl.NightLight(sc, { road: g.roadMesh, city: g.city, tier: 'high' });
  again.update(g.camera, { share: 1, time: 1, origin: g.road.origin });
  g.render();
  const during = geos();
  const kids = sc.children.length;
  again.dispose();
  g.render();
  return { before, during, after: geos(), kidsBack: sc.children.length - kids };
`;

const server = serve();
if (!(await waitForServer())) {
  console.error('the server did not come up');
  process.exit(2);
}
try {
  // Node, before any page.
  {
    register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { if (s === 'three') return { url: ${JSON.stringify('file://' + ROOT + 'tools/vendor/three.module.js')}, shortCircuit: true }; return n(s, c); }`));
    const THREE = await import('three');
    const hb = await import(ROOT + 'src/render/headbeam.js');
    const nightMod = await (async () => {
      globalThis.window = globalThis;
      globalThis.document = { createElement: () => ({ getContext: () => null, style: {} }), getElementById: () => null };
      globalThis.devicePixelRatio = 1;
      return import(ROOT + 'src/render/nightlight.js');
    })();
    const chunk = THREE.ShaderChunk.lights_pars_begin;
    const patched = hb.patchBeam('x\n#include <lights_pars_begin>\ny');
    say(patched.startsWith('x\n') && patched.endsWith('\ny') && patched.includes('beamPattern( - light.direction, lightDistance )'),
      'the beam is laid on the spot light\'s colour, by a function of the direction from the lamp');
    // The chunk with the one line of the pattern taken out, and what comes before it, is the chunk as it was.
    const body = patched.slice(patched.indexOf('uniform bool receiveShadow;'), patched.length - 2)
      .split('\n').filter((l) => !l.includes('uBeamK > 0.0')).join('\n');
    say(body === chunk, 'nothing else of the spot light\'s function, or of the chunk, is changed');
    say(hb.patchBeam('no include here') === 'no include here', 'a shader with no lights is left as it is');
    const N = nightMod.NIGHT;
    say(N.lampShafts.high === 12 && N.lampShafts.mid === 6 && N.lampShafts.low === 0, `shafts under the lamps: ${N.lampShafts.high}, ${N.lampShafts.mid}, ${N.lampShafts.low}`);
    say(N.cars.high === 8 && N.cars.mid === 4 && N.cars.low === 3 && N.carBeams.high === 8 && N.carBeams.mid === 3 && N.carBeams.low === 0,
      `cars with their lamps ${N.cars.high}, ${N.cars.mid}, ${N.cars.low}; beams ${N.carBeams.high}, ${N.carBeams.mid}, ${N.carBeams.low}`);
    say(N.beacon.period === 2, `the lights on the towers flash once in ${N.beacon.period} s`);
    say(hb.BEAM.boost > 1 && hb.BEAM.cut[0] < hb.BEAM.cut[1], `the beam: ${hb.BEAM.boost} times the light, its top lower on the oncoming side (${hb.BEAM.cut.join(', ')})`);
  }

  const results = {};
  for (const name of NODE_ONLY ? [] : places) {
    const place = PLACES[name];
    const page = await openPage(`seed=7&world=${place.world}&s=${place.s}&cam=chase&style=real&run=60`);
    try {
      const put = await page.run(PLACE(place.s));
      if (put.error) throw new Error(`${name}: ${put.error}`);
      const t0 = Date.now();
      const m = await page.run(MEASURE(name));
      if (m.error) throw new Error(`${name}: ${m.error}`);
      results[name] = m;
      console.log(`\n== ${name}: ${((Date.now() - t0) / 1000).toFixed(0)} s, ${m.size.join('x')}`);
      const night = name !== 'hills';
      if (night) {
        say(m.off.k === 0 && m.off.beamK === 0 && Math.abs(m.off.intensity - 25.5) < 1e-9 && !m.off.shafts && !m.off.halos, `${name}: held off: the lamps' light as it was (${m.off.intensity}), no pattern, nothing drawn`);
        say(m.on.k === 1 && m.on.beamK === 1 && Math.abs(m.on.intensity / m.off.intensity - m.on.level) < 1e-9 && m.on.level > 4 && m.on.angle > 0.6,
          `${name}: on: the beam, ${m.on.level} times the light, its cone ${m.on.angle}, decay ${m.on.decay}, range ${m.on.distance}`);
        say(m.on.calls - m.off.calls <= 4 && m.on.calls - m.off.calls >= 1 && m.on.programs - m.off.programs <= 2, `${name}: ${m.on.calls - m.off.calls} draws and ${m.on.programs - m.off.programs} programs more than with the lights held off`);
        say(m.on.shafts && m.on.shaftCount > 0 && m.on.shaftCount <= 12, `${name}: ${m.on.shaftCount} shafts under the lamps nearest the lens (${m.on.lamps} laid), ${m.on.beacons} lights on the towers`);
        say(m.differ > 0.02 && m.road.on > m.road.off + 1, `${name}: the frame differs in ${(m.differ * 100).toFixed(1)}% of its pixels, the road in front of the car ${m.road.off.toFixed(1)} to ${m.road.on.toFixed(1)}`);
        say(m.again === 0 || m.again < 0.002, `${name}: a second frame of the same moment is the same (${(m.again * 100).toFixed(3)}% differ)`);
      } else {
        say(m.on.k === 0 && m.on.beamK === 0 && m.on.intensity === m.off.intensity && !m.on.shafts && !m.on.halos, `${name}: by day nothing is on and the lamps' light is what it was (${m.on.intensity})`);
        say(m.differ === 0, `${name}: by day the frame is the same with the lights held off and not (${m.differ} differ)`);
        say(m.on.calls === m.off.calls && m.on.programs === m.off.programs, `${name}: the same draws and programs by day`);
      }
      if (name === 'city') {
        const f = m.flash;
        say(f.most > f.least && new Set(f.counts).size >= 3, `the lights on the towers flash: red pixels at ten moments of two seconds ${f.counts.join(', ')}`);
      }
      const T = m.tiers;
      if (night) {
        say(T.mid.shafts <= 6 && T.low.shafts === 0 && T.high.shafts > T.mid.shafts && T.mid.room < T.high.room && T.low.room === 0,
          `${name}: the tiers: shafts ${T.high.shafts}, ${T.mid.shafts}, ${T.low.shafts}; the reach of the rooms ${T.high.room}, ${T.mid.room}, ${T.low.room}`);
        say(T.high.beamK === 1 && T.mid.beamK === 1 && T.low.beamK === 1, `${name}: the beam's pattern is in all three tiers`);
      }
      if (name === 'city') {
        const c = m.cars;
        say(!!c && c.meshes === 2 && c.halos > 0 && c.beams > 0 && c.beams <= 8, `cars: ${c && c.halos} lamps lit up, ${c && c.beams} beams, ${c && c.reflections} thrown back by the wet road (${c && c.stat.cars} cars of ${c && c.shown})`);
        say(!!c && c.stat.cars <= 8 && c.reflections <= 4 && c.halos <= 8 * 4, `cars: at most eight with their lamps, four thrown back`);
        say(m.carsMid.stat.cars <= 4 && m.carsMid.beams <= 3 && m.carsLow.beams === 0 && m.carsLow.stat.cars <= 3, `cars by tier: ${c.stat.cars}, ${m.carsMid.stat.cars}, ${m.carsLow.stat.cars} with lamps; beams ${c.beams}, ${m.carsMid.beams}, ${m.carsLow.beams}`);
        say(m.carsFar.halos === 0 || m.carsFar.halos <= 8, `cars 3 km off: ${m.carsFar.halos} lamps drawn`);
        say(m.carsOff.halos === 0 && !m.carsOff.visible[0] && !m.carsOff.visible[1], 'cars with the lights held off: none of their lights drawn');
      }
      if (name === 'city') {
        for (const [st, v] of Object.entries(m.styles)) {
          say(v.differ === 0 && v.k === 0 && v.beam === 0 && !v.shafts && !v.halos, `city, ${st}: the same frame with the lights held off and not (${v.differ} differ), nothing of the night drawn, the lamps' light ${v.intensity}`);
        }
      }
      if (KEEP) {
        mkdirSync(KEEP, { recursive: true });
        writeFileSync(`${KEEP}/${name}.json`, JSON.stringify(m, null, 1));
      }
      if (name === 'city') {
        const d = await page.run(DISPOSE);
        say(!d.error && d.after === d.before && d.kidsBack === 0, `a second set of the lights made and disposed of: geometries ${d.before}, ${d.during}, ${d.after}`);
      }
      say(page.logs.length === 0, `${name}: no error in the page${page.logs.length ? ': ' + page.logs[0] : ''}`);
    } finally {
      page.close();
    }
  }
} finally {
  server.kill();
}
console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
