// What the cavern has of its own is there, where it should be, and costs what it should.
//
// In node first (no browser), over three seeds: the plan (world/cavernplan.js) is the
// same each time it is asked, every puddle lies in a hollow of the floor (concavity
// over 0.6), off the road and with water level over its lowest point, every skylight
// is a kilometre of road from the next and beside it, and every piece of the mine
// track is three metres outside the verge, on the ground, with its cart on the rails.
//
// Then in the page (the cavern, seed 7, the place `cavern` of tools/look.mjs): the pools of
// light under the crystals are as many as the crystals in reach (at most 80), each of the
// colour of its crystal (its hue within 15 degrees) and as wide as three times its height,
// as bright at the middle as half what the crystal glows; the puddles it draws are in
// hollows and off the road; one or two skylights are within a kilometre and the dust in
// one is lit four times (as much as three over the dust outside, seen from above, in the
// shader of the page); a minute driven in the cavern has 8 to 30 drops fall (and, rendered
// as sound, as many drips to be heard); at the tiers: all at high, half at mid, nothing at
// low, and what it adds to a frame (draw calls, triangles, programs) is counted against the
// same frame at low; the real style's frame has at least 3 points less of it darker than L 0.2 with them
// than without; and every style draws it. Last the cavern is disposed of and what it held is let go.
//
// Usage: node tools/world_cavern_check.mjs [--node-only] [--keep out/cavern-check]
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { makeWorldLand, WORLDS } from '../src/world/worlds.js';
import { Road } from '../src/world/road.js';
import { HALF_FLAT } from '../src/world/road.js';
import { Corridor } from '../src/world/corridor.js';
import { CavernPlan, CAVERN, DRIP, PUDDLE, SKYLIGHT, TRACK, concavity, dripGap } from '../src/world/cavernplan.js';

const ROOT = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const NODE_ONLY = args.includes('--node-only');
const KEEP = args.includes('--keep') ? args[args.indexOf('--keep') + 1] : null;

let failed = 0;
const say = (ok, text) => {
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};
const span = (a) => (a.length ? `${Math.min(...a).toFixed(2)}..${Math.max(...a).toFixed(2)}` : 'none');

// --- in node: the plan -------------------------------------------------------------

function planOf(seed) {
  const land = makeWorldLand(seed, { start: 'cavern' });
  const road = new Road(land, seed);
  const corridor = new Corridor(road, land);
  const plan = new CavernPlan({ land, road, corridor, worlds: land.worlds, seed });
  return { land, road, corridor, plan };
}

function nodePart() {
  for (const seed of [7, 42, 3]) {
    const { land, road, corridor, plan } = planOf(seed);
    const again = planOf(seed);
    const puddles = [];
    const skylights = [];
    const tracks = [];
    const seen = new Set();
    let sameAgain = true;
    for (let sCar = 200; sCar <= 5400; sCar += 100) {
      road.update(sCar);
      again.road.update(sCar);
      const o = road.origin;
      for (let s = sCar; s < sCar + 100; s += 40) {
        const p = road.at(s);
        if (!p) continue;
        const ax = p.x + o.x;
        const az = p.z + o.z;
        for (let bx = Math.floor((ax - 170) / PUDDLE.block); bx <= Math.floor((ax + 170) / PUDDLE.block); bx++) {
          for (let bz = Math.floor((az - 170) / PUDDLE.block); bz <= Math.floor((az + 170) / PUDDLE.block); bz++) {
            const key = bx * 100003 + bz;
            if (seen.has(key)) continue;
            const list = plan.puddlesIn(bx, bz);
            if (list === undefined) continue;
            seen.add(key);
            const twice = again.plan.puddlesIn(bx, bz);
            if (twice === undefined || JSON.stringify(list, (k, v) => (v instanceof Float32Array ? [...v] : v)) !== JSON.stringify(twice, (k, v) => (v instanceof Float32Array ? [...v] : v))) sameAgain = false;
            for (const q of list) puddles.push(q);
          }
        }
      }
      const k = Math.floor((sCar + 300) / SKYLIGHT.every);
      const sk = plan.skylight(k);
      if (sk !== undefined && !skylights.some((e) => e.k === k)) skylights.push({ k, q: sk, lat: sk ? plan.roadNear(sk.ax, sk.az, 120).dist : 0 });
      const k2 = Math.floor((sCar + 300) / TRACK.every);
      const tr = plan.track(k2);
      if (tr !== undefined && !tracks.some((e) => e.k === k2)) {
        let off = 0;
        let ground = 0;
        if (tr) {
          for (let i = 0; i <= tr.n; i++) {
            off = Math.max(off, Math.abs(plan.roadNear(tr.pts[i * 4], tr.pts[i * 4 + 2], 40).dist - (HALF_FLAT + TRACK.off)));
            ground = Math.max(ground, Math.abs(tr.pts[i * 4 + 1] - corridor.heightAt(tr.pts[i * 4], tr.pts[i * 4 + 2])));
          }
        }
        tracks.push({ k: k2, t: tr, off, ground });
      }
    }
    const name = `seed ${seed}`;
    say(sameAgain && puddles.length > 100, `${name}: the puddles are the same each time they are asked for (${puddles.length} of them in 5 km)`);

    // The puddles: in hollows, level water over the lowest point, off the road.
    const h = (x, z) => land.heightAt(x, z);
    const low = puddles.filter((q) => concavity(h, q.ax, q.az) <= 0.6 - 1e-6);
    say(!low.length, `${name}: every puddle is in a hollow, concavity over 0.6 (${span(puddles.map((q) => concavity(h, q.ax, q.az)))})`);
    const onRoad = puddles.filter((q) => plan.roadNear(q.ax, q.az, 200).dist < HALF_FLAT + PUDDLE.margin);
    say(!onRoad.length, `${name}: none is on the road or its verge (the nearest centre is ${Math.min(...puddles.map((q) => plan.roadNear(q.ax, q.az, 200).dist)).toFixed(1)} m off the middle of the road)`);
    const dry = puddles.filter((q) => !(q.y > h(q.ax, q.az)));
    say(!dry.length, `${name}: the water stands over the lowest point of every puddle`);
    const shaped = puddles.filter((q) => !plan.unshaped(q.ax, q.az));
    say(!shaped.length, `${name}: all of them on land as the land made it, not as the road did`);
    const radii = puddles.map((q) => q.r);
    say(Math.min(...radii) >= 1 && Math.max(...radii) <= 4.2, `${name}: a puddle is one to four metres across on average (${span(radii)} m)`);
    // The shore is the contour: the ground at each point of it is at the water's level, or higher.
    let worst = 0;
    for (const q of puddles) {
      for (let k = 0; k < PUDDLE.dirs; k++) {
        const a = (k / PUDDLE.dirs) * Math.PI * 2;
        const g = h(q.ax + Math.cos(a) * q.ext[k], q.az + Math.sin(a) * q.ext[k]);
        worst = Math.max(worst, Math.abs(g - q.y));
      }
    }
    say(worst < 0.12, `${name}: the shore of each puddle is on the ground at the water's level (off by ${worst.toFixed(3)} m at the most)`);

    // The skylights: one in a kilometre of road, beside it, at least 700 m from the next.
    const found = skylights.filter((e) => e.q).sort((a, b) => a.q.s - b.q.s);
    const gaps = found.slice(1).map((e, i) => e.q.s - found[i].q.s);
    say(found.length >= 4 && Math.min(...gaps) >= 700, `${name}: ${found.length} skylights in ${skylights.length} kilometres, at least ${Math.min(...gaps).toFixed(0)} m from one to the next`);
    say(found.every((e) => e.q.r >= SKYLIGHT.r[0] && e.q.r <= SKYLIGHT.r[1] && e.lat >= 20 && e.lat <= 70),
      `${name}: each skylight is 6 to 10 m wide and 20 to 70 m from the road (${span(found.map((e) => e.lat))} m)`);

    // The track: three metres outside the verge, on the ground, a cart on its rails.
    const laid = tracks.filter((e) => e.t);
    say(laid.length >= 0.6 * tracks.length, `${name}: ${laid.length} of ${tracks.length} stretches of 500 m have a track`);
    const off = Math.max(...laid.map((e) => e.off));
    const ground = Math.max(...laid.map((e) => e.ground));
    let carts = 0;
    for (const { t } of laid) {
      if (t.cart >= 0) carts++;
      if (t.cart >= 0 && !(t.cart >= 3 && t.cart + 3 < t.n)) carts -= 1000;
    }
    say(off < 0.6 && ground < 1e-6, `${name}: every piece of track is ${HALF_FLAT + TRACK.off} m from the middle of the road (off by ${off.toFixed(2)} m at the most) and on the ground`);
    say(carts > 0, `${name}: ${carts} of the tracks have a cart on them, away from the ends`);
  }
}

nodePart();
if (NODE_ONLY) {
  if (failed) {
    console.error(`\n${failed} problem${failed > 1 ? 's' : ''}`);
    process.exit(1);
  }
  console.error('\nOK: the plan of the cavern');
  process.exit(0);
}

// --- in the page ----------------------------------------------------------------------

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8191;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve(port = PORT) {
  return spawn('node', [ROOT + 'tools/serve.mjs', String(port), ROOT], { stdio: ['ignore', 'ignore', 'inherit'] });
}

async function waitForServer(port = PORT, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/`)).ok) return true;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  return false;
}

async function openPage(query) {
  const profile = `${tmpdir()}/continuum-cavern-${process.pid}-${Date.now()}`;
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

// In the page: the car put on the road at the place `cavern` of tools/look.mjs (2200 m into the
// cavern), run for two and a half seconds, and the lens as the style gives it.
const PLACE = `
  const p = g.road.at(2200);
  g.autoMode = true;
  g.sCar = 2200;
  g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(2200, 1.9) + 0.3);
  g.car.vx = 22;
  g.setCamera('chase');
  g.chase.shaking = false;
  g.chase.lead = false;
  g.chase.snapTo(g.car, g.car.y || 0);
  g.atmosphere.uniforms.uTime.value = 100;
  for (let i = 0; i < 150; i++) { g.pilot.vMax = 22; g.update(1 / 60); }
  g.post.setStyle(g.style);
  g.atmosphere.bakeEnvironment();
  return { world: g.snapshot().world.id, s: g.sCar, cavern: g.cavern.stats() };
`;

// In the page: the pools of light, against the crystals counted here, not by the pools.
const POOLS = `
  const THREE = await import('three');
  const plan = await import('./src/world/cavernplan.js');
  const o = g.road.origin;
  const ax = g.camera.position.x + o.x;
  const az = g.camera.position.z + o.z;
  const crystals = [];
  for (const cell of g.clutter.cells.values()) {
    for (const it of cell.items) {
      if (it.kind !== 'crystal' || it.world !== plan.CAVERN || Math.hypot(it.x - ax, it.z - az) >= 84) continue;
      const c = new THREE.Color().setHex(it.colour, THREE.SRGBColorSpace);
      crystals.push({ x: it.x, z: it.z, y: it.y, h: 0.75 * it.size, rgb: [c.r, c.g, c.b], kind: 'clutter' });
    }
  }
  const trees = g.forest.crystalsNear(ax, az, 500, []);
  const cy = new THREE.Color().setHex(0x58d6e0, THREE.SRGBColorSpace);
  for (let i = 0; i < trees.length; i += 7) crystals.push({ x: trees[i], z: trees[i + 2], y: trees[i + 1], h: trees[i + 3], rgb: [cy.r * trees[i + 4], cy.g * trees[i + 5], cy.b * trees[i + 6]], kind: 'tree' });
  // The ones in the picture: a pool's disc, as a ball about its middle, in the lens's view.
  g.camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(g.camera.projectionMatrix, g.camera.matrixWorldInverse));
  const inView = crystals.filter((c) => frustum.intersectsSphere(new THREE.Sphere(new THREE.Vector3(c.x - o.x, c.y, c.z - o.z), 3 * c.h)));
  const P = g.cavern.pools;
  const hue = (c) => {
    const m = Math.max(...c), n = Math.min(...c), d = m - n;
    if (d === 0) return 0;
    const h = m === c[0] ? ((c[1] - c[2]) / d) % 6 : m === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const rows = [];
  for (let n = 0; n < P.count; n++) {
    const k = P.list[n].slot * (P.pos.count / 80);
    const x = P.pos.getX(k) + o.x;
    const z = P.pos.getZ(k) + o.z;
    const c = crystals.find((q) => Math.hypot(q.x - x, q.z - z) < 0.02);
    const tint = [P.tint.getX(k), P.tint.getY(k), P.tint.getZ(k)];
    rows.push({
      found: !!c, kind: c && c.kind, dist: Math.hypot(x - ax, z - az),
      hue: c ? Math.abs(((hue(tint) - hue(c.rgb) + 540) % 360) - 180) : null,
      radius: P.pool.getZ(k), want: c ? 3 * c.h : null,
      ratio: c ? tint.map((v, i) => v / c.rgb[i]) : null,
    });
  }
  return { count: P.count, crystals: crystals.length, inView: inView.length, drawn: P.mesh.visible, rows };
`;

// In the page: the puddles that are drawn, against the plan's own rules.
const PUDDLES = `
  const plan = await import('./src/world/cavernplan.js');
  const h = (x, z) => g.land.heightAt(x, z);
  const P = g.cavern.puddles;
  const list = P.list;
  const o = g.road.origin;
  // (What the buffer holds of the first: its level, and its middle.)
  const lift = [];
  for (const p of list) lift.push(P.pos.getY(p.slot * 13) - p.y);
  return {
    count: list.length, known: P.known, drawn: P.mesh.visible, lift,
    rows: list.map((p) => ({ conc: plan.concavity(h, p.ax, p.az), road: g.plan.roadNear(p.ax, p.az, 200).dist, above: p.y - h(p.ax, p.az), r: p.r, shaped: !g.plan.unshaped(p.ax, p.az) })),
  };
`;

// In the page: the skylights within a kilometre of the lens, counted from the plan.
const SKY = `
  const o = g.road.origin;
  const ax = g.camera.position.x + o.x;
  const az = g.camera.position.z + o.z;
  const within = [];
  for (let k = -1; k < 8; k++) {
    const q = g.plan.skylight(k);
    if (q && Math.hypot(q.ax - ax, q.az - az) < 1000) within.push({ k, d: Math.hypot(q.ax - ax, q.az - az), r: q.r });
  }
  return { within, drawn: g.cavern.skylights.count, list: g.cavern.skylights.list.map((s) => ({ d: s.dist, level: s.level, r: s.r, top: s.top, bottom: s.bottom })) };
`;

// In the page: the dust in a skylight. The lens stands in the middle of the first shaft and the box of
// dust round it is drawn from straight above, nothing else, twice: with the dust lit as it is, and with
// the light put out. What each pixel is, in the world, is known from where it is: the dust in the middle of
// the shaft is lit by the ratio of the first to the second, and the dust outside it is not.
const BEAM = `
  const THREE = await import('three');
  const sk = g.cavern.skylights;
  if (!sk.list.length) return { error: 'no skylight drawn' };
  const s = sk.list[0];
  const o = g.road.origin;
  const cx = s.ax - o.x;
  const cz = s.az - o.z;
  g.camera.position.set(cx, g.groundAt(cx, cz) + 2, cz);
  g.camera.lookAt(cx + 5, g.groundAt(cx, cz) + 8, cz);
  g.camera.updateMatrixWorld();
  const at = g._wl || g._lookAt;
  const ctx = { at, sCar: g.sCar, blocks: 0, motes: g.motes, px: 700 };
  g.cavern.update(g.camera, 0, ctx);
  g.motes.update(0, g.camera, at, o, 577);
  const R = s.r * 1.25;
  const lit = g.motes.beams.map((v) => v.toArray());
  const N = 256;
  const half = 20;
  const rt = new THREE.WebGLRenderTarget(N, N, { type: THREE.HalfFloatType, format: THREE.RGBAFormat });
  const fromHalf = (h) => {
    const e = (h >> 10) & 31;
    const f = h & 1023;
    const v = e === 0 ? (f / 1024) * 6.103515625e-5 : Math.pow(2, e - 15) * (1 + f / 1024);
    return h & 32768 ? -v : v;
  };
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 100);
  cam.position.set(g.camera.position.x, g.camera.position.y + 30, g.camera.position.z);
  cam.up.set(0, 0, -1);
  cam.lookAt(g.camera.position.x, g.camera.position.y, g.camera.position.z);
  cam.updateMatrixWorld();
  const sc = new THREE.Scene();
  const parent = g.motes.points.parent;
  sc.add(g.motes.points);
  const r = g.renderer;
  const was = r.getRenderTarget();
  const clearWas = r.getClearColor(new THREE.Color()).clone();
  const alphaWas = r.getClearAlpha();
  const draw = () => {
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(sc, cam);
    const raw = new Uint16Array(N * N * 4);
    r.readRenderTargetPixels(rt, 0, 0, N, N, raw);
    return Float32Array.from(raw, fromHalf);
  };
  const on = draw();
  const w = g.motes.beams.map((v) => v.w);
  g.motes.beams.forEach((v) => { v.w = 0; });
  const off = draw();
  g.motes.beams.forEach((v, i) => { v.w = w[i]; });
  r.setRenderTarget(was);
  r.setClearColor(clearWas, alphaWas);
  parent.add(g.motes.points);
  rt.dispose();
  const px = (i, j) => [g.camera.position.x - half + ((i + 0.5) / N) * 2 * half, g.camera.position.z + half - ((j + 0.5) / N) * 2 * half];
  let core = [0, 0], disc = [0, 0], outside = [0, 0], lit1 = 0, lit0 = 0, rest = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = on[(j * N + i) * 4] + on[(j * N + i) * 4 + 1] + on[(j * N + i) * 4 + 2];
      const b = off[(j * N + i) * 4] + off[(j * N + i) * 4 + 1] + off[(j * N + i) * 4 + 2];
      const [x, z] = px(i, j);
      const d = Math.hypot(x - cx, z - cz);
      if (d < 0.75 * R) { core[0] += a; core[1] += b; } else if (d > R) { outside[0] += a; outside[1] += b; }
      if (d < R) { disc[0] += a; disc[1] += b; }
    }
  }
  return { R, lit, core, disc, outside, level: s.level, motes: g.motes.shown };
`;


// In the page: the cavern's tier changed alone (the rest of the frame is as it was), its things
// brought to the lens with the clock standing still, and the frame drawn.
const TIER_FRAME = (tier) => `
  g.cavern.setTier(${JSON.stringify(tier)});
  const ctx = { at: g._wl || g._lookAt, sCar: g.sCar, blocks: g.style.cur.blocks, motes: g.motes, px: g.post.size.y / (2 * Math.tan(g.camera.fov * Math.PI / 360)) };
  for (let i = 0; i < 600; i++) g.cavern.update(g.camera, 0, ctx);
  g.render();
`;

// In the page: what is drawn at a tier, against the same frame at the lowest.
const COST = (tier) => `${TIER_FRAME(tier)}
  const r = g.renderer;
  const s = g.cavern.stats();
  return { tier: ${JSON.stringify(tier)}, calls: r.info.render.calls, triangles: r.info.render.triangles, programs: r.info.programs.length, geometries: r.info.memory.geometries, stats: s,
    visible: { pools: g.cavern.pools.mesh.visible, puddles: g.cavern.puddles.mesh.visible, skylights: g.cavern.skylights.mesh.visible, worms: g.cavern.worms.points.visible, pieces: g.cavern.track.pieces.visible, carts: g.cavern.track.carts.visible } };
`;

// In the page: the drops of a minute of driving in the cavern.
const MINUTE = `
  g.cavern.setTier('high');
  const t = [];
  let n = g.cavern.drips;
  const start = n;
  let falling = 0, rippled = 0;
  for (let i = 0; i < 3600; i++) {
    g.pilot.vMax = 22;
    g.update(1 / 60);
    if (g.cavern.drips !== n) { n = g.cavern.drips; t.push(+g.cavern.clock.toFixed(2)); }
    if (g.cavern.worms.drops.length) falling++;
  }
  return { drips: n - start, at: t, falling, world: g.snapshot().world.id, s: g.sCar };
`;

// In the page: each style draws the cavern, with it and without.
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
    g.cavern.setTier(tier);
    const ctx = { at: g._wl || g._lookAt, sCar: g.sCar, blocks: g.style.cur.blocks, motes: g.motes, px: g.post.size.y / (2 * Math.tan(g.camera.fov * Math.PI / 360)) };
    for (let i = 0; i < 600; i++) g.cavern.update(g.camera, 0, ctx);
    errors();
    g.render();
    const e = errors();
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const x = c.getContext('2d');
    x.drawImage(canvas, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return { errors: e, mean: sum / (d.length / 4), png: canvas.toDataURL('image/png') };
  };
  const low = shot('low');
  const high = shot('high');
  // How many pixels the cavern's things changed.
  const a = new Image(), b = new Image();
  a.src = low.png; b.src = high.png;
  await Promise.all([a.decode(), b.decode()]);
  const cv = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
  const da = cv(a), db = cv(b);
  let diff = 0;
  for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 6) diff++;
  // The share of the frame darker than L 0.2 in OKLab (tools/look.mjs's 'dark'), at low and at high.
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const dark = (d) => {
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = lin(d[i]), g_ = lin(d[i + 1]), b_ = lin(d[i + 2]);
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g_ + 0.0514459929 * b_);
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g_ + 0.1073969566 * b_);
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g_ + 0.6299787005 * b_);
      if (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s < 0.2) n++;
    }
    return n / (d.length / 4);
  };
  return { style: ${JSON.stringify(id)}, lowErrors: low.errors, highErrors: high.errors, lowMean: low.mean, highMean: high.mean, changed: diff / (da.length / 4), lowDark: dark(da), highDark: dark(db), lowPng: low.png, highPng: high.png, drawn: g.cavern.stats() };
`;

// In the page: the cavern let go.
const DISPOSE = `
  g.cavern.setTier('high');
  g.update(1 / 60);
  g.render();
  const r = g.renderer;
  const before = { geometries: r.info.memory.geometries, children: g.scene.children.length };
  g.cavern.dispose();
  g.render();
  const after = { geometries: r.info.memory.geometries, children: g.scene.children.length };
  let thrown = null;
  try { for (let i = 0; i < 4; i++) { g.update(1 / 60); g.render(); } } catch (e) { thrown = e.message; }
  return { before, after, thrown };
`;

// The sound of a minute in the cavern, rendered by the page (tools/sound_demo.mjs), and the drips found
// in it: a band of 1.4 to 6 kHz, rectified and smoothed over 5 ms, and the peaks of it that stand
// 6 times over its median, at least a second and a half apart (the tail of the hall rings for a second or
// so, and a drop never falls sooner than 2.2 s after the one before). Returns their times (s).
function biquad(type, f, rate, q = 0.7071) {
  const w = (2 * Math.PI * f) / rate;
  const al = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const [b0, b1, b2] = type === 'hp' ? [(1 + c) / 2, -(1 + c), (1 + c) / 2] : [(1 - c) / 2, 1 - c, (1 - c) / 2];
  const a0 = 1 + al;
  const [a1, a2] = [(-2 * c) / a0, (1 - al) / a0];
  return (x) => {
    const y = new Float32Array(x.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = (b0 / a0) * x[i] + (b1 / a0) * x1 + (b2 / a0) * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x[i];
      y2 = y1;
      y1 = v;
      y[i] = v;
    }
    return y;
  };
}

function dripsIn(wavFile) {
  const wav = readFileSync(wavFile);
  const rate = wav.readUInt32LE(24);
  const channels = wav.readUInt16LE(22);
  const n = Math.floor((wav.length - 44) / (2 * channels));
  const mono = new Float32Array(n);
  let loudest = 0;
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let c = 0; c < channels; c++) {
      const x = wav.readInt16LE(44 + (i * channels + c) * 2) / 32768;
      v += x;
      loudest = Math.max(loudest, Math.abs(x));
    }
    mono[i] = v / channels;
  }
  let y = biquad('hp', 1400, rate)(mono);
  y = biquad('hp', 1400, rate)(y);
  y = biquad('lp', 6000, rate)(y);
  const env = new Float32Array(n);
  const k = 1 - Math.exp(-1 / (0.005 * rate));
  let e = 0;
  for (let i = 0; i < n; i++) {
    e += (Math.abs(y[i]) - e) * k;
    env[i] = e;
  }
  const sorted = Float32Array.from(env).sort();
  const median = sorted[Math.floor(n / 2)];
  const limit = Math.max(6 * median, 2e-3);
  const hits = [];
  let last = -1e9;
  const win = Math.round(0.05 * rate);
  for (let i = 0; i < n; i++) {
    if (env[i] < limit) continue;
    let top = true;
    for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win) && top; j++) if (env[j] > env[i]) top = false;
    if (!top) continue;
    // (the onset: back to where it first stood over the limit)
    let o = i;
    while (o > 0 && env[o - 1] >= limit * 0.5) o--;
    const t = o / rate;
    if (t - last >= 1.5) {
      hits.push(t);
      last = t;
    }
  }
  return { hits, median, limit, seconds: n / rate, loudest };
}

async function soundPart() {
  const wav = `${ROOT}out/cavern-check-drips.wav`;
  mkdirSync(`${ROOT}out`, { recursive: true });
  const code = await new Promise((resolve) => {
    const p = spawn('node', [ROOT + 'tools/sound_demo.mjs', '60', 'seed=7&world=cavern&cam=chase', wav],
      { env: { ...process.env, PORT: String(PORT + 1) }, stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('exit', resolve);
  });
  if (code !== 0) {
    say(false, `the sound of a minute in the cavern could not be rendered (tools/sound_demo.mjs exited ${code})`);
    return;
  }
  const found = dripsIn(wav);
  // When the drops fall, by the schedule: the first DRIP.first s after the first step in the cavern (a
  // step is 1/60 s, and the page has made one before the minute begins).
  const due = [];
  let t = 1 / 60 + DRIP.first;
  for (let n = 0; t < 60; n++) {
    if (n > 0) t += dripGap(n, 7);
    if (t < 59) due.push(t - 2 / 60);
  }
  const missed = due.filter((d) => !found.hits.some((h) => Math.abs(h - d) < 0.15));
  const stray = found.hits.filter((h) => !due.some((d) => Math.abs(h - d) < 0.15));
  say(found.hits.length >= 8 && found.hits.length <= 30, `rendered as sound, a minute in the cavern has ${found.hits.length} drips to be heard (8 to 30; ${due.length} are due), found by the peaks of 1.4 to 6 kHz over ${found.limit.toFixed(4)}`);
  say(!missed.length && stray.length <= 1, `each is heard when its drop falls: ${missed.length} due and not heard, ${stray.length} heard that were not due`);
  say(found.loudest < 0.9, `and the minute does not clip: its loudest sample is ${found.loudest.toFixed(3)} of full scale, under 0.9 (the drips are no louder than the drive)`);
}

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
    // The pools, the puddles, the skylights: the place `cavern`.
    page = await openPage('seed=7&world=cavern&s=2200&run=60&cam=chase&style=real&tier=low');
    const placed = await page.run(PLACE);
    if (placed.error) throw new Error(placed.error);
    say(placed.world === 'cavern', `the place is in the cavern (${placed.world}, ${placed.s} m)`);
    // (The lowest tier draws none of it: the page began so, for what it adds to be counted.)
    const lowCost = await page.run(COST('low'));
    say(lowCost.stats.pools === 0 && lowCost.stats.puddles === 0 && lowCost.stats.skylights === 0 && lowCost.stats.threads === 0 && lowCost.stats.track === 0
      && !Object.values(lowCost.visible).some(Boolean), `at the lowest tier none of it is drawn (${JSON.stringify(lowCost.stats)})`);
    const midCost = await page.run(COST('mid'));
    const highCost = await page.run(COST('high'));
    const add = (a, b) => ({ calls: a.calls - b.calls, triangles: a.triangles - b.triangles, programs: a.programs - b.programs });
    const addHigh = add(highCost, lowCost);
    const addMid = add(midCost, lowCost);
    console.error(`     what it adds to a frame: at high ${addHigh.calls} calls and ${addHigh.triangles} triangles, at mid ${addMid.calls} calls and ${addMid.triangles} triangles; programs built when it was first drawn: ${addHigh.programs} (the others are built ahead, as the page settles)`);
    say(addHigh.calls >= 1 && addHigh.calls <= 8, `at the high tier it adds at most 8 draw calls (${addHigh.calls})`);
    say(addHigh.triangles > 0 && addHigh.triangles <= 60000, `and at most 60 000 triangles (${addHigh.triangles})`);
    say(addMid.calls <= 4 && addMid.triangles <= 30000, `at the middle tier half of that: at most 4 calls and 30 000 triangles (${addMid.calls}, ${addMid.triangles})`);
    say(highCost.stats.pools <= 80 && midCost.stats.pools <= 40, `pools of light: at most 80 at high, 40 at mid (${highCost.stats.pools}, ${midCost.stats.pools})`);
    say(midCost.stats.skylights <= 1 && midCost.stats.track === 0, `at mid one skylight at most and no track (${midCost.stats.skylights}, ${midCost.stats.track})`);

    // The pools of light.
    const pools = await page.run(POOLS);
    if (pools.error) throw new Error(pools.error);
    const want = Math.min(80, pools.inView);
    say(pools.count === want && pools.drawn, `the pools of light are as many as the crystals in the picture, at most 80: ${pools.count} pools for ${pools.inView} crystals in the picture (${pools.crystals} in reach)`);
    const lost = pools.rows.filter((r) => !r.found);
    say(!lost.length, `every pool is under a crystal (${lost.length} are not)`);
    const hues = pools.rows.filter((r) => r.found).map((r) => r.hue);
    say(Math.max(...hues) <= 15, `each pool is the colour of its crystal: its hue off by ${Math.max(...hues).toFixed(2)} degrees at the most, at most 15`);
    const wide = pools.rows.filter((r) => r.found).map((r) => Math.abs(r.radius / r.want - 1));
    say(Math.max(...wide) < 1e-3, `each is as wide as three times its crystal is tall (off by ${(Math.max(...wide) * 100).toFixed(3)}% at the most)`);
    // As bright at its middle as half of what its crystal glows in (1.6 times its colour); less where the clutter fades out (62 to 84 m).
    const near = pools.rows.filter((r) => r.found && r.dist < 60);
    const mids = near.map((r) => r.ratio[1] > 0.05 ? r.ratio[1] : r.ratio[0]);
    say(near.length > 0 && Math.max(...mids) <= 0.8 + 1e-3 && Math.min(...mids) >= 0.8 - 1e-3, `the middle of each pool within 60 m is half of 1.6 times its crystal's colour (${span(mids)}, at 0.8)`);
    console.error(`     ${pools.rows.filter((r) => r.kind === 'tree').length} of the ${pools.count} are under crystals that grow as trees`);

    // The puddles.
    const pud = await page.run(PUDDLES);
    if (pud.error) throw new Error(pud.error);
    say(pud.count >= 6 && pud.drawn, `puddles are drawn (${pud.count} of the ${pud.known} within reach)`);
    say(pud.rows.every((r) => r.conc > 0.6 - 1e-6), `each lies in a hollow, concavity over 0.6 (${span(pud.rows.map((r) => r.conc))})`);
    say(pud.rows.every((r) => r.road > HALF_FLAT + 2.5), `none is on the road: the nearest is ${Math.min(...pud.rows.map((r) => r.road)).toFixed(1)} m from its middle`);
    say(pud.rows.every((r) => r.above > 0) && pud.rows.every((r) => !r.shaped) && pud.lift.every((l) => l > 0 && l < 0.05), 'and its water is over its lowest point, flat, on land the road did not shape');

    // The skylights.
    const sky = await page.run(SKY);
    if (sky.error) throw new Error(sky.error);
    say(sky.within.length >= 1 && sky.within.length <= 2, `one or two skylights within a kilometre: ${sky.within.length} (${sky.within.map((w) => `${w.d.toFixed(0)} m`).join(', ')}), ${sky.drawn} drawn`);
    say(sky.list.every((s) => s.r >= 6 && s.r <= 10 && s.top > s.bottom + 60), `each is 6 to 10 m wide at the roof and ${sky.list.map((s) => (s.top - s.bottom).toFixed(0)).join(', ')} m tall`);

    // The dust in the light.
    const beam = await page.run(BEAM);
    if (beam.error) {
      say(false, `the dust: ${beam.error}`);
    } else {
      const ratio = (a) => a[0] / Math.max(a[1], 1e-9);
      const core = ratio(beam.core);
      const disc = ratio(beam.disc);
      const outside = ratio(beam.outside);
      say(beam.core[1] > 0 && core >= 3, `the dust in the middle of a shaft is ${core.toFixed(2)} times as bright as with the light out (at least 3; the gain is 4 where the light is full, ${beam.level.toFixed(2)} of it now)`);
      say(beam.disc[1] > 0 && disc >= 3 * (beam.level > 0.99 ? 1 : 0) + (beam.level > 0.99 ? 0 : 1), `over the whole width of the shaft ${disc.toFixed(2)} times`);
      say(Math.abs(outside - 1) < 1e-3, `and the dust outside it is as it was (${outside.toFixed(4)} times)`);
    }
    // (Back to the place.)
    await page.run(PLACE);

    // The page is kept for the styles, the cost and the end.
    const styles = [];
    for (const id of ['real', 'paint', 'ink', 'cel', 'print', 'pixel', 'block']) {
      const r = await page.run(STYLED(id));
      if (r.error) {
        say(false, `${id}: ${r.error}`);
        continue;
      }
      styles.push(r);
      say(r.highErrors <= r.lowErrors && r.changed > 0.0005 && r.highMean > 0.5, `${id}: it draws with the cavern's things (${(r.changed * 100).toFixed(2)}% of the frame is different from the frame at low, ${r.highErrors} GL errors against ${r.lowErrors}, mean ${r.highMean.toFixed(1)})`);
      if (id === 'real') {
        say(r.highDark <= r.lowDark - 0.03, `real: what the cavern has of its own lights the dark floor: ${(r.lowDark * 100).toFixed(1)}% of the frame is darker than L 0.2 without it, ${(r.highDark * 100).toFixed(1)}% with it (at least 3 points less)`);
      }
      if (keep) {
        writeFileSync(`${keep}${id}-low.png`, Buffer.from(r.lowPng.replace(/^data:image\/png;base64,/, ''), 'base64'));
        writeFileSync(`${keep}${id}-high.png`, Buffer.from(r.highPng.replace(/^data:image\/png;base64,/, ''), 'base64'));
      }
    }
    await page.run("g.style.set('real', true); g.style.applyScene(); return 1;");

    // A minute of driving.
    await page.run(PLACE);
    const minute = await page.run(MINUTE);
    if (minute.error) throw new Error(minute.error);
    say(minute.world === 'cavern' && minute.drips >= 8 && minute.drips <= 30, `a minute driven in the cavern has ${minute.drips} drops fall (8 to 30; one every 2.2 to 5.8 s), the world there is ${minute.world}, ${minute.falling} steps of it with one falling to be seen`);
    const gaps = minute.at.slice(1).map((t, i) => t - minute.at[i]);
    say(gaps.every((g) => g >= 2.19 && g <= 5.81), `and the time from one to the next is ${span(gaps)} s`);
    say(minute.falling >= 150, `a drop is in the air to be seen for ${(minute.falling / 60).toFixed(1)} s of the minute (0.5 s before each of them, where a puddle is in front of the lens)`);

    // Let go.
    const gone = await page.run(DISPOSE);
    say(!gone.thrown && gone.before.geometries - gone.after.geometries >= 5 && gone.before.children - gone.after.children >= 6,
      `disposed of: ${gone.before.geometries - gone.after.geometries} geometries and ${gone.before.children - gone.after.children} objects gone from the renderer and the scene, and the game goes on (${gone.thrown || 'no error'})`);
  } finally {
    if (page) page.close();
    server.kill();
  }
}

// The frame of the place `cavern`, as tools/look.mjs measures it: the share of the real style's frame that is
// darker than L 0.2 (printed), how much of it is burnt out, and what the painted night keeps.
async function lookPart() {
  const file = `${ROOT}out/cavern-check-look.json`;
  mkdirSync(`${ROOT}out`, { recursive: true });
  const code = await new Promise((resolve) => {
    const p = spawn('node', [ROOT + 'tools/look.mjs', '--shots', 'cavern', '--styles', 'real,paint', '--write', file],
      { env: { ...process.env, PORT: String(PORT + 2) }, stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('exit', resolve);
  });
  if (code !== 0) {
    say(false, `the place cavern could not be measured (tools/look.mjs exited ${code})`);
    return;
  }
  const m = JSON.parse(readFileSync(file, 'utf8'));
  const real = m['cavern:real'];
  const paint = m['cavern:paint'];
  console.error(`     the real style's frame at the place cavern has ${(real.frame.dark * 100).toFixed(1)}% of it darker than L 0.2 (59.6% without the cavern's own things)`);
  say(real.frame.white <= 0.002, `and ${(real.frame.white * 100).toFixed(3)}% of it burnt out (at most 0.2%)`);
  say(paint.frame.dark <= 0.25 && paint.frame.L01 >= 0.1 && paint.frame.flat >= 0.7 && paint.frame.tones <= 16,
    `the painted night keeps its rules: dark ${paint.frame.dark.toFixed(3)} (at most 0.25), L01 ${paint.frame.L01.toFixed(3)} (at least 0.10), flat ${paint.frame.flat.toFixed(3)} (at least 0.70), tones ${paint.frame.tones} (at most 16)`);
  console.error(`     the place cavern costs ${real.cost.calls} calls and ${(real.cost.triangles / 1e6).toFixed(3)} M triangles in the real style (285 and 0.898 M without the cavern's own things)`);
}

await pagePart();
await soundPart();
await lookPart();

if (failed) {
  console.error(`\n${failed} problem${failed > 1 ? 's' : ''}`);
  process.exit(1);
}
console.error('\nOK: the cavern has its pools of light, its puddles and drops, its skylights, threads and track, where and as many as it should');
process.exit(0);
