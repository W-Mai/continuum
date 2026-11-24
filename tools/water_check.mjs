// The real style's water (render/water.js, render/waterback.js, render/waterlook.js).
//
// It asserts:
//  - node, before any page: which worlds have a swell and a flow (the river and the coast, and no other); the four swells (their shares
//    add to one, their heights over a long stretch and many seconds do not pass what is asked of them, their phases stay under a turn); where
//    the land says a river runs (a unit vector, down the road's axis, along the contour of the channel and not across it); the finer disc
//    (its rings are 1.6 m apart at the middle and no more than 5.4 m apart out to 90 m, and are the sea's own beyond; it has fewer than
//    twice the triangles of the sea's own); the text of the sea's three programs: the real one has the depth, the foam, the reflection
//    of the frame, the flow and the swell in it, and the painted one and the plain one the block style has have none of them;
//  - in a page at the river's bridge, at the sea off the beach and at the hills (a place where the land under the water of the next world
//    is farther off than the water is seen): the water is the real one in the real style at the high tier; where the land under the water
//    is in reach the frame is taken once a frame (the colour and the distances, two draws more, at half the frame's size), at the middle
//    tier the distances only (one draw), at the low tier not at all, and where none is no draw is made and the frame is the one the sea
//    as it was draws, pixel for pixel; the water makes the frame different over a good share of it where it is in reach;
//  - node, with the game's own terrain tiles built at the three places: the land under the water that the water gates the frame on
//    (Water._wetCells): hundreds of cells in reach, and in view, at the river's bridge and off the beach, with the finer disc; none at the hills,
//    where the nearest water is 1.28 km off and the real water is a twentieth of itself at 1.17 km;
//  - node, with a made-up world and lens: while the world is wound over the sea is the plain program, drawn from above, on the wound disc and with no frame
//    taken, and when it is unwound it is the real one again, on the flat disc;
//  - the program follows the style: the real one in the real, ink and pixel styles, and in the painted styles (paint, cel, print) and the block
//    style the plain ones, a frame drawn in each with no error;
//  - what the photo mode makes of it (a picture at twice the size) is whole, with no error;
//  - a river's pattern is carried the way the land says it runs;
//  - the water made, drawn and disposed leaves no texture, geometry or listener behind and no error.
// Times are written, not asserted (the machine is shared).
//
// Usage: node tools/water_check.mjs [--places riverlow,coastlow,hills] [--gpu] [--node]
//   --node   only what needs no page (no browser is started)
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const GPU = args.includes('--gpu');
const PLACES = {
  riverlow: { world: 'river', s: 4500, eye: { side: -60, up: 9, back: 30 }, wet: true, flow: true },
  coastlow: { world: 'coast', s: 900, eye: { side: -60, up: 9, back: 30 }, wet: true, flow: false },
  hills: { world: 'hills', s: 5000, eye: null, wet: false, flow: false },
};
const places = opt('--places', 'riverlow,coastlow,hills').split(',');

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8219;
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

// The page, headless, and a way to run code in it; what the page logs as an error comes back with it.
async function openPage(query) {
  const profile = `${tmpdir()}/continuum-water-${process.pid}-${Date.now()}`;
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
      logs.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 1500));
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

// In the page: the car put on the road at s and stood still, as tools/look.mjs puts it down for a place that has the lens put by hand
// (eye: metres to the left of the road, over the ground there, behind the car).
const PLACE = (s, eye) => `
  const p = g.road.at(${s});
  if (!p) return { error: 'no road at ${s}' };
  g.autoMode = true;
  g.sCar = ${s};
  g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(${s}, 1.9) + 0.3);
  g.car.vx = 0;
  g.setCamera('chase');
  g.chase.shaking = false;
  g.chase.lead = false;
  g.chase.snapTo(g.car, g.car.y || 0);
  g.style.wind[0] = 1000;
  g.style.wind[1] = 400;
  g.atmosphere.uniforms.uTime.value = 100;
  for (let i = 0; i < 150; i++) { g.pilot.vMax = 0; g.update(1 / 60); }
  g.post.setStyle(g.style);
  g.atmosphere.bakeEnvironment();
  const eye = ${JSON.stringify(eye)};
  window.__eye = eye ? () => {
    const q = g.road.at(g.sCar - eye.back);
    const x = q.x - Math.sin(q.theta) * eye.side, z = q.z + Math.cos(q.theta) * eye.side;
    g.camera.position.set(x, g.groundAt(x, z) + eye.up, z);
    g.camera.up.set(0, 1, 0);
    g.camera.lookAt(g.car.x, g.car.y + 0.7, g.car.z);
    g.camera.updateMatrixWorld();
  } : null;
  return { style: g.style.id };
`;

// In the page, with the place set: what the water does, counted and measured.
const MEASURE = (place) => `
  const gl = g.renderer.getContext();
  const W = gl.drawingBufferWidth;
  const H = gl.drawingBufferHeight;
  const N = W * H;
  const water = g.water;
  const info = g.renderer.info;
  // The animals and the other cars are put away before each frame (the page's own update shows them again).
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
  const frame = () => {
    if (window.__eye) window.__eye();
    for (const o of hidden) o.visible = false;
    g.render();
  };
  const grab = () => {
    frame();
    const px = new Uint8Array(N * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const calls = () => info.render.calls;
  const out = { size: [W, H], tier: g.tier, style: g.style.id };
  // (The sea's clock and the rest of the page's are left where they are: a frame is the same frame twice.)
  const still = (f) => { const t0 = water.uniforms.uTime.value; const saved = water.save(); const r = f(); water.uniforms.uTime.value = t0; water.restore(saved); return r; };

  // The sea as it was (the real water held off) and as it is. The first frame of each builds its program: drawn before it is counted.
  // (Two frames of each, the dearer of the two being one in which a pass that is made every other frame was made: the fewer draws of the
  // two are the ones to compare.)
  const twice = () => { const px = still(() => grab()); const a = calls(); still(() => grab()); return { px, calls: Math.min(a, calls()) }; };
  water.setReal(false);
  water.update(0, g.camera);
  grab();
  const old0 = twice();
  const old = old0.px;
  out.callsOld = old0.calls;
  out.programsOld = info.programs.length;
  const texturesOld = info.memory.textures;
  water.setReal(true);
  water.update(0, g.camera);
  grab();
  const real0 = twice();
  const real = real0.px;
  out.callsReal = real0.calls;
  out.programs = info.programs.length - out.programsOld;
  out.textures = info.memory.textures - texturesOld;
  out.real = water.real;
  out.near = water.near;
  out.cells = water._cells.length;
  out.dry = water.uniforms.uSeaDry.value;
  out.disc = water.mesh.geometry === water.nearDisc ? 'near' : water.mesh.geometry === water.flat ? 'flat' : 'other';
  // How much of the frame the real water changes.
  {
    let d = 0;
    for (let i = 0; i < N; i++) {
      if (Math.abs(old[i * 4] - real[i * 4]) > 2 || Math.abs(old[i * 4 + 1] - real[i * 4 + 1]) > 2 || Math.abs(old[i * 4 + 2] - real[i * 4 + 2]) > 2) d++;
    }
    out.changed = d / N;
    let same = 0;
    for (let i = 0; i < real.length; i++) if (old[i] === real[i]) same++;
    out.sameBytes = same / real.length;
  }
  // The frame taken: how many times, and in what size.
  const back = water.back;
  const t0 = back.taken;
  const c0 = back.coloured;
  still(() => { frame(); frame(); frame(); });
  out.taken = back.taken - t0;
  out.coloured = back.coloured - c0;
  out.back = back.dist ? [back.dist.width, back.dist.height, back.colour.width, back.colour.height] : null;
  out.flags = water.uniforms.uBack.value.toArray();
  // The tiers.
  out.tiers = {};
  for (const tier of ['mid', 'low', 'high']) {
    g.setTier(tier);
    const a = back.taken;
    const b = back.coloured;
    still(() => grab());
    out.tiers[tier] = { calls: calls(), taken: back.taken - a, coloured: back.coloured - b, flags: water.uniforms.uBack.value.toArray() };
  }
  // The styles.
  out.styles = {};
  for (const id of ['paint', 'cel', 'print', 'block', 'ink', 'pixel', 'real']) {
    g.style.set(id, true);
    g.style.applyScene();
    for (let i = 0; i < 3; i++) g.update(1 / 60);
    g.post.setStyle(g.style);
    still(() => grab());
    out.styles[id] = { real: water.real, calls: calls() };
  }
  // The photo mode's picture, at twice the size.
  {
    const w = g.post.size.x * 2;
    const h = g.post.size.y * 2;
    g.post.setStyle(g.style);
    still(() => frame());
    let err = null;
    let lit = false;
    try {
      const shot = g.post.capture(Math.min(w, 2048), Math.min(h, 1152));
      for (let i = 0; i < shot.pixels.length; i += 4 * 97) if (shot.pixels[i] | shot.pixels[i + 1] | shot.pixels[i + 2]) { lit = true; break; }
    } catch (e) { err = String(e.message || e).slice(0, 200); }
    out.capture = { err, lit, back: back.dist ? [back.dist.width, back.dist.height] : null };
    still(() => frame());
    out.afterCapture = back.dist ? [back.dist.width, back.dist.height] : null;
  }
  // A river's pattern is carried along the way the land says it runs.
  {
    const o = water.uniforms.uOffset.value;
    const c = g.camera.position;
    const run = { x: 0, z: 0 };
    g.land.flowAt(c.x + o.x, c.z + o.y, run);
    // (The way is held to over a second or so: three seconds on, it is the land's.)
    for (let i = 0; i < 180; i++) water.update(1 / 60, g.camera);
    const s0 = water.save();
    for (let i = 0; i < 60; i++) water.update(1 / 60, g.camera);
    const s1 = water.save();
    const moved = [0, 1, 2].map((k) => [s1.flow[k * 2] - s0.flow[k * 2], s1.flow[k * 2 + 1] - s0.flow[k * 2 + 1]]);
    out.flow = { land: [run.x, run.z], dir: [water.flowDir.x, water.flowDir.z], moved, flowing: Math.hypot(run.x, run.z) > 0.5 };
    water.restore(s0);
  }
  // Left as it was found, and what the card says of its errors.
  g.setTier('high');
  g.style.set('real', true);
  g.style.applyScene();
  out.errors = [];
  let e;
  while ((e = gl.getError()) !== gl.NO_ERROR) out.errors.push(e);
  return out;
`;

// A second sea made, drawn, and disposed, in a page of its own: nothing is left of it.
const SECOND = `
  const THREE = await import('three');
  const { Water } = await import('./src/render/water.js');
  const { pairProgram } = await import('./src/render/style.js');
  const { warmHooks } = await import('./src/render/atmosphere.js');
  const r = g.renderer;
  const gl = r.getContext();
  const out = {};
  g.render();
  const before = { textures: r.info.memory.textures, geometries: r.info.memory.geometries, listeners: pairProgram.listeners.length, hooks: warmHooks.length, children: g.scene.children.length };
  g.water.dispose();
  g.render();
  const after = { textures: r.info.memory.textures, geometries: r.info.memory.geometries, listeners: pairProgram.listeners.length, hooks: warmHooks.length, children: g.scene.children.length, inScene: g.scene.children.includes(g.water.mesh) };
  out.before = before;
  out.after = after;
  out.errors = [];
  let e;
  while ((e = gl.getError()) !== gl.NO_ERROR) out.errors.push(e);
  return out;
`;

// The modules, in node: three is the copy the page has.
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s, c, n) { return s === 'three' ? { url: ${JSON.stringify(new URL('./vendor/three.module.js', import.meta.url).href)}, shortCircuit: true } : n(s, c); }`,
));
const THREE = await import('three');
const { WORLDS, makeWorldLand } = await import('../src/world/worlds.js');
const { Road } = await import('../src/world/road.js');
const { REAL, SWELLS, SWELL_K, swellHeight, swellPhases } = await import('../src/render/waterlook.js');
const { Water, nearDiscGeometry, NEAR_FINE, NEAR_SEGMENTS } = await import('../src/render/water.js');
const { pairProgram } = await import('../src/render/style.js');
const { twistU } = await import('../src/render/twist.js');

const server = serve();
let failed = 0;
const check = (ok, text) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};
const pc = (v, k = 2) => `${(v * 100).toFixed(k)}%`;
try {
  // --- worlds -------------------------------------------------------------------------------------------------
  const wet = WORLDS.filter((w) => w.liquid && w.liquid.wave > 0).map((w) => `${w.id} ${w.liquid.wave} m`);
  check(wet.length === 2 && WORLDS.find((w) => w.id === 'river').liquid.wave === 0.04 && WORLDS.find((w) => w.id === 'coast').liquid.wave === 0.15
    && WORLDS.find((w) => w.id === 'river').liquid.flow === 1 && !WORLDS.some((w) => w.id !== 'river' && w.liquid && w.liquid.flow),
  `the swell near the lens: ${wet.join(', ')} (4 cm and 15 cm, from crest to trough), and only the river flows`);

  // --- the swells -----------------------------------------------------------------------------------------------
  const sumShare = SWELLS.share.reduce((a, b) => a + b, 0);
  check(Math.abs(sumShare - 1) < 1e-9 && SWELLS.length.length === 4 && SWELLS.dir.every(([x, z]) => Math.abs(Math.hypot(x, z) - 1) < 0.005),
    `four swells of ${SWELLS.length.join(', ')} m, their shares ${sumShare.toFixed(2)} of the height, their ways unit vectors`);
  {
    const stat = (height) => {
      let lo = Infinity;
      let hi = -Infinity;
      let sq = 0;
      let n = 0;
      let slope = 0;
      for (let t = 0; t < 60; t += 3.7) {
        for (let x = 0; x < 4000; x += 0.37) {
          const z = x * 0.31;
          const h = swellHeight(x, z, t, height);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
          sq += h * h;
          n++;
          slope = Math.max(slope, Math.abs(swellHeight(x + 0.05, z, t, height) - h) / 0.05);
        }
      }
      return { span: hi - lo, rms: Math.sqrt(sq / n), slope };
    };
    const river = stat(0.04);
    const coast = stat(0.15);
    check(river.span <= 0.04 + 1e-9 && river.span > 0.025 && coast.span <= 0.15 + 1e-9 && coast.span > 0.1,
      `the swells' heights over 4 km and a minute: ${(river.span * 100).toFixed(1)} cm for the river's 4, ${(coast.span * 100).toFixed(1)} cm for the sea's 15, the steepest slope ${river.slope.toFixed(3)} and ${coast.slope.toFixed(3)}`);
    const ph = swellPhases(1e7);
    check(ph.every((p) => p >= 0 && p < 2 * Math.PI) && SWELL_K.every((k, i) => Math.abs(k - (2 * Math.PI) / SWELLS.length[i]) < 1e-9),
      `the swells' phases are taken mod a turn (${ph.map((p) => p.toFixed(2)).join(', ')} after 10^7 s)`);
  }

  // --- the way a river runs ---------------------------------------------------------------------------------------
  {
    const seed = 7;
    const land = makeWorldLand(seed, { start: 'river' });
    const road = new Road(land, seed);
    road.update(4600);
    const o = road.origin;
    const axis = [land.worlds.dx, land.worlds.dz];
    const out = { x: 0, z: 0 };
    // Along the road across the valley; where it is the bank of the channel (the bed 5 m down, the floor 7 m up), the way
    // the water runs is along the bank (the height changes little), and not across it.
    let n = 0;
    let along = 0;
    let across = 0;
    let unit = 0;
    let down = 0;
    for (let s = 4300; s < 4600; s += 5) {
      const p = road.at(s);
      if (!p) continue;
      for (const d of [-90, -80, -70, 50, 60, 70, 80]) {
        const x = p.x + o.x - Math.sin(p.theta) * d;
        const z = p.z + o.z + Math.cos(p.theta) * d;
        const h = land.heightAt(x, z);
        if (h < -4 || h > 4) continue;
        land.flowAt(x, z, out);
        n++;
        unit = Math.max(unit, Math.abs(Math.hypot(out.x, out.z) - 1));
        if (out.x * axis[0] + out.z * axis[1] > 0) down++;
        along += Math.abs(land.heightAt(x + out.x * 25, z + out.z * 25) - h);
        across += Math.abs(land.heightAt(x - out.z * 25, z + out.x * 25) - h);
      }
    }
    check(n >= 20 && unit < 1e-9 && down === n && along < 0.35 * across,
      `the river's way, at ${n} places on the banks of its channel: a unit vector, down the road's axis in all of them, and 25 m along it the ground changes by ${(along / n).toFixed(2)} m, 25 m across it by ${(across / n).toFixed(2)} m`);
    const dry = { x: 9, z: 9 };
    land.flowAt(o.x + 100, o.z + 100, dry);
    // A point of the hills world: no river there.
    const hills = makeWorldLand(seed, { start: 'hills' });
    new Road(hills, seed);
    hills.flowAt(1e5, 1e5, dry);
    check(Math.hypot(dry.x, dry.z) === 0, `where no world has a river the land has no way for it (${dry.x}, ${dry.z})`);
  }

  // --- the finer disc ---------------------------------------------------------------------------------------------
  {
    const g = nearDiscGeometry();
    const pos = g.getAttribute('position');
    const radii = [];
    for (let i = 1; i < pos.count; i += NEAR_SEGMENTS) radii.push(Math.hypot(pos.getX(i), pos.getZ(i)));
    let widest = 0;
    let inside = 0;
    for (let k = 1; k < radii.length; k++) {
      if (radii[k] <= NEAR_FINE) { widest = Math.max(widest, radii[k] - radii[k - 1]); inside++; }
    }
    const last = radii[radii.length - 1];
    check(Math.abs(radii[0] - 1.6) < 1e-4 && widest <= 5.4 && inside > 25 && Math.abs(last - 9000) < 1e-2 && g.index.count / 3 > 14208 && g.index.count / 3 < 2 * 14208,
      `the finer disc: ${radii.length} rings, the first ${radii[0].toFixed(1)} m out, ${inside} of them within ${NEAR_FINE} m, none more than ${widest.toFixed(1)} m past the one before, the last at ${last} m; ${g.index.count / 3} triangles (the sea's own 14208)`);
    g.dispose();
  }

  // --- the programs' text ---------------------------------------------------------------------------------------
  {
    const scene = new THREE.Scene();
    const w = new Water(scene, 0, null);
    const text = (painted, real) => {
      pairProgram.on = painted;
      w.setReal(real);
      const lib = THREE.ShaderLib.physical;
      const shader = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
      w.material.onBeforeCompile(shader, null);
      return { v: shader.vertexShader, f: shader.fragmentShader, key: w.material.customProgramCacheKey() };
    };
    const real = text(false, true);
    const plain = text(false, false);
    const painted = text(true, true);
    pairProgram.on = false;
    const has = (t, re) => re.test(t.f) || re.test(t.v);
    const parts = [/frameReflection/, /tBackDist/, /gerstner/, /uFlowA/, /foam/];
    check(parts.every((re) => has(real, re)) && parts.every((re) => !has(plain, re)) && parts.every((re) => !has(painted, re)),
      `the real program has the depth, the foam, the reflection of the frame, the flow and the swell in its text (${real.key}); the plain one (${plain.key}) and the painted one (${painted.key}) have none of it`);
    w.dispose();
  }

  // --- the land under the water, in reach -----------------------------------------------------------------------
  {
    const { Corridor } = await import('../src/world/corridor.js');
    const { TerrainField } = await import('../src/render/terrain.js');
    const { ALPINE_LOOK } = await import('../src/render/atmosphere.js');
    const cellsAt = (world, at, eye) => {
      const seed = 7;
      const land = makeWorldLand(seed, { start: world });
      const road = new Road(land, seed);
      const corridor = new Corridor(road, land);
      road.update(160, Infinity);
      for (let c = 0; c <= at + 400; c += 100) road.update(c);
      road.update(at + 400);
      const o = road.origin;
      const scene = new THREE.Scene();
      const terrain = new TerrainField(scene, land, corridor, ALPINE_LOOK, {});
      terrain.setOrigin(o.x, o.z);
      const car = road.at(at);
      let x = car.x + o.x;
      let z = car.z + o.z;
      let y = car.y + 4;
      if (eye) {
        const q = road.at(at - eye.back);
        x = q.x - Math.sin(q.theta) * eye.side + o.x;
        z = q.z + Math.cos(q.theta) * eye.side + o.z;
        y = corridor.heightAt(x, z) + eye.up;
      }
      const lens = new THREE.PerspectiveCamera(52, 1280 / 577, 0.3, 14000);
      lens.position.set(x - o.x, y, z - o.z);
      lens.lookAt(car.x, car.y + 0.7, car.z);
      lens.updateMatrixWorld();
      terrain.update(x, z, true);
      const w = new Water(scene, 0, land.worlds, { terrain, land, tier: 'high' });
      w.setOrigin(o.x, o.z);
      for (let i = 0; i < 4; i++) w.update(0.6, lens);
      const out = { near: w.near, cells: w._cells.length, close: w.close, seen: w._wetInView(lens), tiles: terrain.tiles.size };
      w.dispose();
      return out;
    };
    const eye = { side: -60, up: 9, back: 30 };
    const river = cellsAt('river', 4500, eye);
    const coast = cellsAt('coast', 900, eye);
    const hills = cellsAt('hills', 5000, null);
    check(river.cells > 100 && river.close && river.seen && coast.cells > 100 && coast.close && coast.seen,
      `the land under the water, in reach: ${river.cells} cells at the river's bridge, ${coast.cells} off the beach (the finer disc, in view: ${river.seen}, ${coast.seen}), of ${river.tiles} and ${coast.tiles} tiles`);
    check(hills.near && hills.cells === 0 && !hills.close && !hills.seen,
      `at the hills the next world with real water is ahead on the road (${hills.near}) but no land under the water is within ${REAL.view} m: ${hills.cells} cells, nothing to take the frame for (${hills.tiles} tiles)`);
  }

  // --- a world wound over --------------------------------------------------------------------------------------
  {
    const scene = new THREE.Scene();
    const worlds = { reaches: () => true };
    const lens = new THREE.PerspectiveCamera(55, 2.2, 0.3, 14000);
    lens.position.set(100, 5, 200);
    lens.updateMatrixWorld();
    const w = new Water(scene, 0, worlds, { land: { flowAt: (x, z, o) => { o.x = 1; o.z = 0; return o; } }, tier: 'high' });
    for (let i = 0; i < 30; i++) w.update(1 / 60, lens);
    const before = { real: w.real, geometry: w.mesh.geometry === w.flat, side: w.material.side === THREE.DoubleSide };
    twistU.uTwist.value[0] = 1;
    for (let i = 0; i < 30; i++) w.update(1 / 60, lens);
    const wound = { real: w.real, near: w.near, geometry: w.mesh.geometry === w.fine, side: w.material.side === THREE.FrontSide, define: w.material.defines.FOLD_ALPHA !== undefined };
    twistU.uTwist.value[0] = 0;
    for (let i = 0; i < 30; i++) w.update(1 / 60, lens);
    const after = { real: w.real, geometry: w.mesh.geometry === w.flat, side: w.material.side === THREE.DoubleSide, define: w.material.defines.FOLD_ALPHA !== undefined };
    check(before.real && before.geometry && before.side && !wound.real && !wound.near && wound.geometry && wound.side && wound.define
      && after.real && after.geometry && after.side && !after.define,
    `a world wound over: the real water gives way to the plain program (${wound.real ? 'real' : 'plain'}), drawn from above on the wound disc (${wound.geometry}), no frame wanted (near ${wound.near}); unwound it is the real one (${after.real}) on the flat disc (${after.geometry}), drawn on both sides again`);
    w.dispose();
  }

  if (args.includes('--node')) throw new Error('node only');
  if (!(await waitForServer())) throw new Error('the server did not come up');
  // The one that answers is the one started here (a port another run has is not).
  const served = await (await fetch(`http://localhost:${PORT}/src/render/water.js`)).text();
  if ((await import('node:fs')).readFileSync(ROOT + 'src/render/water.js', 'utf8') !== served) throw new Error(`port ${PORT} is served by something else`);
  for (const place of places) {
    const P = PLACES[place];
    if (!P) throw new Error(`no place ${place}`);
    const page = await openPage(`seed=7&world=${P.world}&s=${P.s}&cam=chase&style=real&run=60`);
    try {
      const put = await page.run(PLACE(P.s, P.eye));
      if (put.error) throw new Error(`${place}: ${put.error}`);
      const r = await page.run(MEASURE(place));
      if (r.error) throw new Error(`${place}: ${r.error}`);
      const tag = `${place}:`;
      const [w, h] = r.size;
      const half = [Math.ceil(w / 2), Math.ceil(h / 2)];
      check(r.real && (r.cells > 0) === P.wet && r.tier === 'high' && r.disc === (P.wet ? 'near' : 'flat'),
        `${tag} the real water, ${r.cells} cells of land under the water in reach (a world with real water is ${r.near ? '' : 'not '}ahead on the road), the disc is the ${r.disc} one`);
      if (P.wet) {
        // (The programs and the two targets are built ahead, before the first frame the check counts: the real program and the two that take the
        // frame as the lens comes within reach of the water. What they add is counted by look.mjs's cost.programs and cost.textures.)
        check(r.callsReal - r.callsOld === 2,
          `${tag} the frame taken costs ${r.callsReal - r.callsOld} draws (${r.callsOld} without the real water, ${r.callsReal} with it), ${r.programs} programs and ${r.textures} textures more than the frames of the sea as it was`);
        check(r.taken === 3 && r.coloured === 3 && JSON.stringify(r.back) === JSON.stringify([...half, ...half]),
          `${tag} taken once a frame, in colour: ${r.taken} of 3, ${r.coloured} with the colour, the two targets ${r.back && r.back.join(' x ')} (half of ${w} x ${h})`);
        check(r.changed > 0.05, `${tag} the real water changes ${pc(r.changed, 1)} of the frame (more than 2 of 255 in a channel)`);
        check(r.tiers.mid.taken === 1 && r.tiers.mid.coloured === 0 && r.tiers.mid.flags[2] === 0 && r.tiers.mid.flags[3] === 1
          && r.tiers.low.taken === 0 && r.tiers.low.flags[2] === 0 && r.tiers.low.flags[3] === 0
          && r.tiers.high.taken === 1 && r.tiers.high.coloured === 1 && r.tiers.high.flags[2] === 1 && r.tiers.high.flags[3] === 1,
        `${tag} the tiers: the middle takes the distances (${r.tiers.mid.taken} draw of the frame, ${r.tiers.mid.coloured} with colour), the low tier none (${r.tiers.low.taken}), the high both (${r.tiers.high.taken}, ${r.tiers.high.coloured} with colour)`);
      } else {
        check(r.callsReal === r.callsOld && r.taken === 0 && r.sameBytes > 0.999,
          `${tag} no land under the water in reach: ${r.callsReal} draws as many as without the real water (${r.callsOld}), ${r.taken} frames taken, ${pc(r.sameBytes, 3)} of the frame's bytes the same`);
      }
      const want = { paint: false, cel: false, print: false, block: false, ink: true, pixel: true, real: true };
      check(Object.entries(want).every(([id, v]) => r.styles[id].real === v),
        `${tag} the program by the style: ${Object.entries(r.styles).map(([id, v]) => `${id} ${v.real ? 'real' : 'plain'}`).join(', ')}`);
      check(!r.capture.err && r.capture.lit,
        `${tag} the photo mode's picture is whole${r.capture.err ? ` (${r.capture.err})` : ''}, its targets ${r.capture.back ? r.capture.back.join(' x ') : 'none'} at that size and ${r.afterCapture ? r.afterCapture.join(' x ') : 'none'} after`);
      if (P.flow) {
        const d = r.flow.dir[0] * r.flow.land[0] + r.flow.dir[1] * r.flow.land[1];
        const along = r.flow.moved.map(([x, z], k) => [x * 37 / [37, 13, REAL.ripple.size][k], z]);
        const sizes = [37, 13, REAL.ripple.size];
        const metres = r.flow.moved.map(([x, z], k) => Math.hypot(((x + 1.5) % 1 - 0.5) * sizes[k], ((z + 1.5) % 1 - 0.5) * sizes[k]));
        check(r.flow.flowing && d > 0.9 && metres.every((m, k) => Math.abs(m - REAL.flow.speed[k]) < 0.1 * REAL.flow.speed[k] + 0.02),
          `${tag} the pattern is carried the way the land says the river runs (${d.toFixed(3)} of it), ${metres.map((m) => m.toFixed(2)).join(', ')} m in a second at the three scales (${REAL.flow.speed.join(', ')} m/s)`);
        void along;
      }
      check(r.errors.length === 0, `${tag} ${r.errors.length} errors from the card`);
      if (page.logs.length) check(false, `${place}: the page logged errors: ${page.logs.slice(0, 2).join(' | ')}`);
    } finally {
      page.close();
    }
  }
  {
    const P = PLACES.riverlow;
    const page = await openPage(`seed=7&world=${P.world}&s=${P.s}&cam=chase&style=real&run=60`);
    try {
      const put = await page.run(PLACE(P.s, P.eye));
      if (put.error) throw new Error(`second: ${put.error}`);
      const r = await page.run(SECOND);
      if (r.error) throw new Error(`second: ${r.error}`);
      check(r.after.textures < r.before.textures && r.after.geometries < r.before.geometries && r.after.listeners === r.before.listeners - 1
        && r.after.hooks === r.before.hooks - 1 && !r.after.inScene && r.errors.length === 0,
      `a sea disposed gives back its textures (${r.before.textures} to ${r.after.textures}) and geometries (${r.before.geometries} to ${r.after.geometries}), its listener and its hook, and leaves the scene (${r.errors.length} errors)`);
      if (page.logs.length) check(false, `second: the page logged errors: ${page.logs.slice(0, 2).join(' | ')}`);
    } finally {
      page.close();
    }
  }
} catch (e) {
  if (e.message !== 'node only') throw e;
} finally {
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
// (Not process.exit: the timer that removes the last page's profile has to fire first.)
process.exitCode = failed ? 1 : 0;
