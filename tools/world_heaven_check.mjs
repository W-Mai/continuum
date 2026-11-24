// The heaven has what it is meant to: a sea of cloud with two veils over it, the
// land and the piers going down into it white, a ring of colour round the point
// of the sea away from the sun, skeins of cranes over it, the bell of its
// temples; and none of it where it is not the heaven's.
//
// In node, without a browser, the numbers (world/heavenplan.js):
//  - the veils are at 6 and 14 m, 0.35 and 0.18 opaque at most, each read at a
//    place of its own in the noise; the land goes white over 8 m;
//  - the ring: two rings, 1.2 and 2.3 degrees out, 0.4 wide, at most 6% over the cloud;
//  - a skein has 5 to 9 cranes, its V opens 40 to 90 degrees (the angle between
//    its arms, from where the cranes are), it flies 40 to 120 m over the sea;
//    high has four skeins, mid two, low none;
//  - the bell: 20 to 40 seconds between two strokes (the first 3 s after the
//    lens comes in reach), loud near the temple, silent from 400 m.
//
// In the real page, headless (seed 7, the heaven world, software rendering), at
// the heaven shot (s = 2200, the lens of the chase), in the real style:
//  - where the land goes down into the sea of cloud (the pixels that are land and
//    become sea when the sea is raised 1.5 m: not the edge of an island against
//    the sea behind it), the largest step of lightness (OKLab L) from one pixel to
//    the next within 4 pixels either side of the line, among the
//    places along it, is at most JUNCTION;
//  - the ring: the lens on the road, turned to the point away from the sun, the sea
//    alone drawn: the lightness (OKLab L, in bands 0.11 degrees wide out from that
//    point) at each ring's radius is at least RING over the mean of that 0.4 degrees
//    inside and outside it (the blue inside and the red outside of the rings on a
//    cloud that is a little blue take as much chroma as they give: the chroma between
//    1 and 2.6 degrees and at 4 is said, not held);
//  - the cranes are drawn where the plan has them (the pixels that change when
//    they are put away are about where each of them is on the screen), as many as
//    the tier says;
//  - the bell: with a temple 150 m from the lens and the clock run on 120 s, 3 to 6
//    strokes, each with a level over 0 and under 1; with it 450 m off, none;
//  - the tiers: high draws both veils and the ring, mid the lower veil and the
//    ring, low none; the cranes four, two and no skeins;
//  - every style draws the heaven without a shader's error (real, paint, ink,
//    cel, print, pixel, block), and the frames are written to out/heaven/;
//  - in the hills nothing of it is drawn (no crane, no white on a pier);
//  - dispose() lets go of the cranes' mesh, its geometry and material.
//
// The falls off the islands (world/heavenplan.js, HeavenPlan; drawn by render/waterfalls.js):
//  - in node, seeds 7 and 42, the tiles round 6 km of road: every island that has falls has 1 to 3, each from a
//    face steeper than 0.7 at its foot and all down it, its foot a metre over the sea, 12 to 70 m tall, 30 m or more
//    from the road's middle and 80 m from the next of its island; a second plan of the same seed asked in another
//    order has the same falls to the bit; each looks toward the road;
//  - in the page, at the heaven shot: the falls the tier draws are drawn, their ribbons change at least 50 pixels of the
//    shot's frame, 70% of them within 12 px of where the plan has them (on the islands' edges; the rest is the glow the
//    bloom spreads round the white water), and their spray at least 30, 70% by their feet, in the cloud; from 300 m off
//    the face of the nearest, its ribbon changes at least 1000 pixels and its spray 200; the spray of the heaven's falls
//    is the cloud's colour, the alpine's is the white water's still, and the alpine's are drawn to 1000 m as they were.
//
// Usage: node tools/world_heaven_check.mjs [--site DIR] [--out DIR]
// --site DIR serves the page from another tree (an older build's export): the
// junction and the ring are measured there, the rest is left out.
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { SHELLS, MIST, HALO, CRANES, BELL, skein, placeInSkein, bellGap, bellLevel } from '../src/world/heavenplan.js';
import { HeavenPlan, ISLE } from '../src/world/heavenplan.js';
import { makeWorldLand } from '../src/world/worlds.js';
import { Road } from '../src/world/road.js';

const ROOT = new URL('..', import.meta.url).pathname;
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const SITE = arg('--site', null);
const OUT = arg('--out', ROOT + 'out/heaven').replace(/\/?$/, '/');
// The thresholds of the page (see above).
const JUNCTION = 0.15;
const RING = 0.003;

let failed = 0;
const say = (ok, text) => {
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};
const f = (x, k = 2) => (x === null || x === undefined ? String(x) : x.toFixed(k));

// --- the numbers, in node ---------------------------------------------------

if (!SITE) {
  say(SHELLS.length === 2 && SHELLS[0].y === 6 && SHELLS[1].y === 14, `the veils are at ${SHELLS.map((v) => v.y).join(' and ')} m`);
  say(SHELLS[0].opacity === 0.35 && SHELLS[1].opacity === 0.18, `as opaque as ${SHELLS.map((v) => v.opacity).join(' and ')} at most`);
  say(Math.hypot(SHELLS[0].shift[0] - SHELLS[1].shift[0], SHELLS[0].shift[1] - SHELLS[1].shift[1]) > 200, 'each is read at a place of its own in the noise');
  say(MIST === 8, `the land goes white over ${MIST} m`);
  say(HALO.rings[0] === 1.2 && HALO.rings[1] === 2.3 && HALO.width === 0.4 && HALO.gain === 0.06, `the ring: ${HALO.rings.join(' and ')} degrees out, ${HALO.width} wide, ${HALO.gain * 100}% over the cloud`);
  let nLo = 99, nHi = 0, aLo = 999, aHi = 0, hLo = 1e9, hHi = 0, worst = 0;
  for (let k = 0; k < 64; k++) {
    const sk = skein(k);
    nLo = Math.min(nLo, sk.n); nHi = Math.max(nHi, sk.n);
    hLo = Math.min(hLo, sk.height); hHi = Math.max(hHi, sk.height);
    // The angle between the arms, from the last crane of each.
    const last = (side) => { let i = sk.n - 1; while (i > 0 && (i % 2 ? 1 : -1) !== side) i--; return placeInSkein(sk, i); };
    const r = last(1), l = last(-1);
    const ang = (Math.atan2(r.side, r.back) - Math.atan2(l.side, l.back)) * 180 / Math.PI;
    aLo = Math.min(aLo, ang); aHi = Math.max(aHi, ang);
    worst = Math.max(worst, Math.abs(ang - sk.spread * 180 / Math.PI));
    // No two cranes of a skein in one place.
    for (let i = 0; i < sk.n; i++) for (let j = i + 1; j < sk.n; j++) {
      const a = placeInSkein(sk, i), b = placeInSkein(sk, j);
      if (Math.hypot(a.back - b.back, a.side - b.side) < CRANES.gap * 0.5) worst = 99;
    }
  }
  say(nLo >= 5 && nHi <= 9, `a skein has ${nLo} to ${nHi} cranes (5 to 9)`);
  say(aLo >= 40 && aHi <= 90 && worst < 1e-6, `its V opens ${f(aLo, 1)} to ${f(aHi, 1)} degrees (40 to 90), as the plan says (the most off ${worst.toExponential(1)})`);
  say(hLo >= 40 && hHi <= 120, `it flies ${f(hLo, 0)} to ${f(hHi, 0)} m over the sea (40 to 120)`);
  say(CRANES.skeins.high === 4 && CRANES.skeins.mid === 2 && CRANES.skeins.low === 0, 'high flies four skeins, mid two, low none');
  let gLo = 1e9, gHi = 0, sum = 0;
  for (let n = 2; n < 500; n++) {
    const gp = bellGap(n, 7);
    gLo = Math.min(gLo, gp); gHi = Math.max(gHi, gp); sum += gp;
  }
  say(gLo >= 20 && gHi <= 40 && Math.abs(sum / 498 - 30) < 1.5, `between two strokes ${f(gLo, 1)} to ${f(gHi, 1)} s (20 to 40), ${f(sum / 498, 1)} on average`);
  say(bellGap(1, 7) === BELL.first && bellGap(5, 7) === bellGap(5, 7) && bellGap(5, 7) !== bellGap(5, 8), 'the first stroke 3 s in; the same bell every time for a seed, another for another');
  say(bellLevel(0) === 1 && bellLevel(399) > 0.3 && bellLevel(400) === 0 && bellLevel(Infinity) === 0, 'loud by the temple, silent from 400 m');
  say(BELL.partials.length === 5 && BELL.decay === 6, 'five partials, dying over 6 s');
}

// The falls off the islands, in node.
if (!SITE) {
  const lay = (seed, reverse) => {
    const land = makeWorldLand(seed, { start: 'heaven' });
    const road = new Road(land, seed);
    const plan = new HeavenPlan({ land, road, worlds: land.worlds, seed });
    const tiles = new Map();
    for (let s = 600; s <= 6600; s += 300) {
      road.update(s);
      const p = road.at(s);
      if (!p) continue;
      const [tx, tz] = HeavenPlan.tileOf(p.x + road.origin.x, p.z + road.origin.z);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) tiles.set(`${tx + i},${tz + j}`, [tx + i, tz + j]);
    }
    const keys = [...tiles.values()];
    if (reverse) keys.reverse();
    const out = new Map();
    for (const [tx, tz] of keys) out.set(`${tx},${tz}`, plan.tile(tx, tz));
    return { plan, road, out };
  };
  for (const seed of [7, 42]) {
    const { plan, road, out } = lay(seed, false);
    const again = lay(seed, true).out;
    let isles = 0, none = 0, falls = 0, bad = [], same = true;
    const per = [0, 0, 0, 0];
    for (const [k, t] of out) {
      const u = again.get(k);
      if (JSON.stringify(t.falls.map((f) => [Array.from(f.pts), f.width, f.key])) !== JSON.stringify(u.falls.map((f) => [Array.from(f.pts), f.width, f.key]))) same = false;
      for (const isle of t.islands) {
        isles++;
        const n = isle.falls.length;
        if (n === 0) { none++; continue; }
        per[Math.min(n, 3)]++;
        if (n > 3) bad.push(`an island with ${n}`);
        for (const f of isle.falls) {
          falls++;
          const foot = f.pts[(f.n - 1) * 3 + 1];
          if (!(f.slope >= ISLE.slope)) bad.push(`a face of ${f.slope.toFixed(2)}`);
          if (!(foot >= plan.level + ISLE.foot - 0.01 && foot <= plan.level + ISLE.foot + 1.5)) bad.push(`a foot at ${foot.toFixed(2)} m`);
          if (!(f.drop >= ISLE.drop[0] && f.drop <= ISLE.drop[1] + 1.5)) bad.push(`a drop of ${f.drop.toFixed(1)}`);
          for (let i = 0; i < f.n; i++) if (plan.roadDist(f.pts[i * 3], f.pts[i * 3 + 2], ISLE.off + 10) < ISLE.off) { bad.push('a fall by the road'); break; }
          for (const g of isle.falls) if (g !== f && Math.hypot(g.ax - f.ax, g.az - f.az) < ISLE.apart) bad.push('two falls of an island too near');
          const r = plan.roadPoint(f.ax, f.az, ISLE.face);
          if (!r || ((f.out[0] * (r.x - f.ax) + f.out[1] * (r.z - f.az)) / (r.d || 1)) < ISLE.facing) bad.push('a fall that looks away from the road');
        }
      }
    }
    say(falls > 0 && bad.length === 0, `seed ${seed}: ${isles} islands, ${falls} falls (islands with 1, 2, 3: ${per[1]}, ${per[2]}, ${per[3]}; with no face steep enough at its shore, ${none}); each from a face steeper than ${ISLE.slope} at its foot, the foot a metre over the sea, ${ISLE.drop[0]} to ${ISLE.drop[1]} m tall, clear of the road and looking toward it${bad.length ? ': ' + bad.slice(0, 3).join(', ') : ''}`);
    say(same, `seed ${seed}: asked in another order, the same falls to the bit`);
  }
}

// --- the page ---------------------------------------------------------------

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8197;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage(query) {
  const profile = `${tmpdir()}/continuum-heaven-${process.pid}-${Date.now()}`;
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
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') logs.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
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
    run: async (body) => JSON.parse(await ev(`(async () => { const g = game; ${LIB} ${body} })().then((v) => JSON.stringify(v), (e) => JSON.stringify({ error: e.message + ' ' + (e.stack || '').slice(0, 300) }))`)),
    close: () => {
      chrome.kill();
      setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
    },
  };
}

// What every test of the page has: the car put on the road at the heaven shot (place), a style (setStyle), a frame as
// the post chain makes it (grab), a pixel in OKLab (oklab), everything but a list put out of sight (only).
const LIB = String.raw`
  const THREE = await import('three');
  const canvas = document.getElementById('view');
  const D2R = Math.PI / 180;
  const shaderErrors = window.__shaderErrors || (window.__shaderErrors = []);
  g.renderer.debug.onShaderError = (gl, program) => { shaderErrors.push(String(gl.getProgramInfoLog(program)).slice(0, 400)); };
  const place = (s) => {
    const p = g.road.at(s);
    g.autoMode = true;
    g.sCar = s;
    g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(s, 1.9) + 0.3);
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
  };
  const setStyle = (st) => { g.style.set(st, true); g.style.applyScene(); g.post.setStyle(g.style); g.atmosphere.bakeEnvironment(); };
  const grab = () => {
    g.render();
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(canvas, 0, 0);
    return { w: c.width, h: c.height, data: x.getImageData(0, 0, c.width, c.height).data };
  };
  const png = () => { g.render(); return canvas.toDataURL('image/png'); };
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const oklab = (r, gg, b) => {
    const R = lin(r), G = lin(gg), B = lin(b);
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const differs = (a, b, i, by = 10) => Math.abs(a.data[i] - b.data[i]) >= by || Math.abs(a.data[i + 1] - b.data[i + 1]) >= by || Math.abs(a.data[i + 2] - b.data[i + 2]) >= by;
  const only = (list) => {
    const hidden = [];
    for (const c of g.scene.children) if (!list.includes(c) && c.visible) { c.visible = false; hidden.push(c); }
    return () => { for (const c of hidden) c.visible = true; };
  };
  const pct = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
`;

// Where the land goes down into the sea, at the heaven shot: the pixels of land that are sea once the sea is raised
// 1.5 m; along each, 4 pixels to the sea side and 4 to the land side (along the row or the column the sea is on), the
// largest step of L from one pixel to the next, and the change of L from one end to the other.
const JUNCTION_NOW = String.raw`
  place(2200);
  const water = g.water.mesh;
  const A = grab();
  water.visible = false;
  const B = grab();
  water.visible = true;
  const y0 = water.position.y;
  water.position.y = y0 + 1.5;
  const E = grab();
  water.position.y = y0;
  const w = A.w, h = A.h, n = w * h;
  const sea = new Uint8Array(n), seaUp = new Uint8Array(n), L = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    sea[i] = differs(A, B, i * 4) ? 1 : 0;
    seaUp[i] = differs(E, B, i * 4) ? 1 : 0;
    L[i] = oklab(A.data[i * 4], A.data[i * 4 + 1], A.data[i * 4 + 2])[0];
  }
  const steps = [], spans = [];
  let contact = 0;
  for (let y = 5; y < h - 5; y++) {
    for (let x = 5; x < w - 5; x++) {
      const i = y * w + x;
      if (sea[i] || !seaUp[i]) continue;
      contact++;
      // The sea next to it: along the row or the column.
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!sea[i + dy * w + dx]) continue;
        let big = 0;
        for (let k = -4; k < 4; k++) {
          const a = L[(y - dy * k) * w + (x - dx * k)], b = L[(y - dy * (k + 1)) * w + (x - dx * (k + 1))];
          big = Math.max(big, Math.abs(a - b));
        }
        steps.push(big);
        spans.push(Math.abs(L[(y - dy * 4) * w + (x - dx * 4)] - L[(y + dy * 5) * w + (x + dx * 5)]));
        break;
      }
    }
  }
  let seaN = 0; for (let i = 0; i < n; i++) seaN += sea[i];
  return { errors: shaderErrors.slice(0, 3), contact, n: steps.length, sea: seaN / n, step50: pct(steps, 0.5), step90: pct(steps, 0.9), span50: pct(spans, 0.5) };
`;

// The ring: the lens 4 m over the road at the shot, turned to the point away from the sun, the sea alone drawn, a
// narrow lens (12 degrees) for the rings' few pixels; the mean chroma by how far each pixel is from that point.
const RING_NOW = String.raw`
  place(2200);
  const c = g.camera;
  const anti = g.atmosphere.sunDir.clone().negate();
  const fov = c.fov;
  const back = only([g.water.mesh]);
  c.position.y += 4;
  c.up.set(0, 1, 0);
  c.lookAt(c.position.clone().add(anti.clone().multiplyScalar(100)));
  c.fov = 12; c.updateProjectionMatrix(); c.updateMatrixWorld();
  const F = grab();
  c.fov = fov; c.updateProjectionMatrix();
  back();
  const e = c.matrixWorld.elements;
  const R = [e[0], e[1], e[2]], U = [e[4], e[5], e[6]], Fw = [-e[8], -e[9], -e[10]];
  const th = Math.tan(12 * Math.PI / 360), asp = F.w / F.h;
  const bands = { inner: [0, 0], outer: [0, 0], at: [] };
  for (let i = 0; i < 40; i++) bands.at.push([0, 0]);
  for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) {
    const a = ((x + 0.5) / F.w * 2 - 1) * th * asp, b = (1 - (y + 0.5) / F.h * 2) * th;
    const dx = Fw[0] + R[0] * a + U[0] * b, dy = Fw[1] + R[1] * a + U[1] * b, dz = Fw[2] + R[2] * a + U[2] * b;
    const ang = Math.acos(Math.min(1, (dx * anti.x + dy * anti.y + dz * anti.z) / Math.hypot(dx, dy, dz))) / D2R;
    if (ang > 4.4) continue;
    const i = (y * F.w + x) * 4;
    const lab = oklab(F.data[i], F.data[i + 1], F.data[i + 2]);
    const C = Math.hypot(lab[1], lab[2]);
    if (ang >= 1 && ang <= 2.6) { bands.inner[0] += C; bands.inner[1]++; }
    if (ang >= 3.8 && ang <= 4.2) { bands.outer[0] += C; bands.outer[1]++; }
    const k = Math.floor(ang / 0.11);
    if (k < 40) { bands.at[k][0] += lab[0]; bands.at[k][1]++; }
  }
  return {
    anti: anti.toArray(), inner: bands.inner[0] / Math.max(1, bands.inner[1]), outer: bands.outer[0] / Math.max(1, bands.outer[1]),
    n: [bands.inner[1], bands.outer[1]], L: bands.at.map((b) => b[1] ? +(b[0] / b[1]).toFixed(4) : null),
    png: canvas.toDataURL('image/png'),
  };
`;

// The cranes: each skein's leader looked at from 160 m off its side, level; where the plan has each crane of it on
// the screen, and whether the pixels that change when the cranes are put away are by them.
const CRANES_NOW = String.raw`
  place(2200);
  const hv = g.heaven;
  const cr = hv.cranes;
  const o = g.road.origin;
  const c = g.camera;
  const out = { tier: g.tier, shown: cr.shown, count: cr.count(), instances: cr.geometry.instanceCount, skeins: [] };
  for (let f = 0; f < 4; f++) {
    const sk = cr.skeins[f];
    const p0 = cr.where(f, 0, c, o);
    const dir = [Math.cos(sk.heading), Math.sin(sk.heading)];
    const mid = cr.where(f, sk.n - 1, c, o);
    const cx = (p0.x + mid.x) / 2, cz = (p0.z + mid.z) / 2;
    // The lens 160 m off, a little above, looking at the middle of the V.
    const eye = new THREE.Vector3(cx - dir[1] * 120 + dir[0] * 40, p0.y + 40, cz + dir[0] * 120 + dir[1] * 40);
    const fov = c.fov;
    const rig = g.chase.update;
    g.chase.update = function () {};
    c.position.copy(eye); c.up.set(0, 1, 0); c.lookAt(cx, p0.y, cz); c.fov = 30; c.updateProjectionMatrix(); c.updateMatrixWorld();
    cr.update(0, c, hv.share, g.water.level, g.scene.fog.color, o);
    const back = only([cr.mesh, g.atmosphere.sky]);
    const A = grab();
    const shot = f === 0 ? canvas.toDataURL('image/png') : null;
    cr.mesh.visible = false;
    const B = grab();
    cr.mesh.visible = true;
    back();
    let near = 0, changed = 0, onEach = 0;
    const pts = [];
    for (let i = 0; i < sk.n; i++) {
      const q = cr.where(f, i, c, o);
      const v = new THREE.Vector3(q.x, q.y, q.z).project(c);
      pts.push([(v.x * 0.5 + 0.5) * A.w, (1 - (v.y * 0.5 + 0.5)) * A.h]);
    }
    for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
      if (!differs(A, B, (y * A.w + x) * 4, 12)) continue;
      changed++;
      if (pts.some((p) => Math.hypot(p[0] - x, p[1] - y) < 14)) near++;
    }
    for (const p of pts) {
      let hit = false;
      for (let y = Math.max(0, Math.round(p[1]) - 6); y <= Math.min(A.h - 1, Math.round(p[1]) + 6) && !hit; y++)
        for (let x = Math.max(0, Math.round(p[0]) - 6); x <= Math.min(A.w - 1, Math.round(p[0]) + 6) && !hit; x++)
          if (differs(A, B, (y * A.w + x) * 4, 12)) hit = true;
      if (hit) onEach++;
    }
    c.fov = fov; c.updateProjectionMatrix();
    g.chase.update = rig;
    out.skeins.push({ n: sk.n, spread: sk.spread / D2R, height: sk.height, changed, near, onEach, png: shot });
    g.render();
  }
  place(2200);
  return out;
`;

// The bell: the nearest temple, and the clock of the bell run on 120 s with the lens kept by it.
const BELL_NOW = String.raw`
  place(2200);
  const hv = g.heaven;
  const o = g.road.origin;
  // A temple laid by the road ahead, if one is within 300 m of the lens somewhere along it; and a temple stood 150 m
  // from the lens for the clock (the props' own are where the road is on the ground, which on the heaven's bridges is seldom).
  let real = null;
  for (let s = 2200; s < 12000 && !real && g.road.at(s + 200); s += 150) {
    place(s);
    const c = g.camera.position;
    const t = g.props.nearestOf('temple', c.x + o.x, c.z + o.z);
    if (t && t.d < 300) real = { s, d: t.d };
  }
  const c = g.camera.position;
  const props = hv.env.props;
  hv.env.props = { nearestOf: (id, ax, az, out) => Object.assign(out || {}, { d: 150, x: ax + 150, z: az }) };
  const ctx = { camera: g.camera, at: g._lookAt, origin: o, fogColor: g.scene.fog.color, level: g.water.level };
  const was = hv.bells;
  const levels = [];
  for (let i = 0; i < 1200; i++) {
    const n = hv.bells;
    hv.update(0.1, ctx);
    if (hv.bells > n) levels.push(hv.bell.level);
  }
  // Out of reach: the clock stops.
  hv.env.props = { nearestOf: (id, ax, az, out) => Object.assign(out || {}, { d: 450, x: ax + 450, z: az }) };
  const mid = hv.bells;
  for (let i = 0; i < 600; i++) hv.update(0.1, ctx);
  hv.env.props = props;
  return { real, strokes: mid - was, after: hv.bells - mid, levels, share: hv.share };
`;

// The tiers: the veils and the ring as the water's uniform has them, and the cranes.
const TIERS_NOW = String.raw`
  const out = {};
  for (const t of ['mid', 'low', 'high']) {
    g.setTier(t);
    g.update(1 / 60);
    out[t] = { veil: g.water.uniforms.uVeil.value.toArray(), instances: g.heaven.cranes.geometry.instanceCount, shown: g.heaven.cranes.shown, visible: g.heaven.cranes.mesh.visible };
  }
  return out;
`;

// Every style at the shot: no shader's error, and the frame.
const STYLES_NOW = String.raw`
  const out = {};
  for (const st of ['real', 'paint', 'ink', 'cel', 'print', 'pixel', 'block']) {
    const before = shaderErrors.length;
    setStyle(st);
    place(2200);
    for (let i = 0; i < 100; i++) { g.update(1 / 60); }
    g.post.setStyle(g.style);
    g.atmosphere.bakeEnvironment();
    out[st] = { errors: shaderErrors.length - before, png: png() };
  }
  setStyle('real');
  return out;
`;

// dispose(): the cranes' mesh out of the scene and its geometry and material let go of.
const DISPOSE_NOW = String.raw`
  const hv = g.heaven;
  const mesh = hv.cranes.mesh;
  let geo = 0, mat = 0;
  hv.cranes.geometry.addEventListener('dispose', () => geo++);
  hv.cranes.material.addEventListener('dispose', () => mat++);
  hv.dispose();
  return { inScene: !!mesh.parent, geo, mat, mist: (await import('./src/render/roadmesh.js')).pierMist.uPierMist.value.w };
`;

// The falls off the islands at the heaven shot: how many are drawn, and where the pixels their ribbons and their spray
// change are against where the plan has them on the screen; the spray's colour, and the alpine's.
const FALLS_NOW = String.raw`
  place(2200);
  const hv = g.heaven;
  const wf = hv.falls;
  const o = g.road.origin;
  const c = g.camera;
  const drawn = wf.count;
  // The plan's falls that are drawn, the nearest first.
  const near = hv._known.map((k) => k.fall).map((f) => ({ f, d: Math.hypot(f.ax - c.position.x - o.x, f.az - c.position.z - o.z) })).sort((a, b) => a.d - b.d).slice(0, drawn);
  // The frame, with the ribbons and with the spray put away: the pixels each changes, and how many of them are by where the
  // plan has the falls on the screen (every point of each; the feet).
  const look = () => {
    const A = grab();
    const png = canvas.toDataURL('image/png');
    wf.ribbon.visible = false;
    const B = grab();
    wf.ribbon.visible = wf.count > 0;
    wf.mist.visible = false;
    const C = grab();
    wf.mist.visible = wf.count > 0;
    const pts = [], feet = [];
    for (const { f } of near) {
      for (let i = 0; i < f.n; i++) {
        const v = new THREE.Vector3(f.pts[i * 3] - o.x, f.pts[i * 3 + 1], f.pts[i * 3 + 2] - o.z).project(c);
        if (v.z < 1) pts.push([(v.x * 0.5 + 0.5) * A.w, (1 - (v.y * 0.5 + 0.5)) * A.h]);
      }
      const v = new THREE.Vector3(f.ax - o.x, f.pts[(f.n - 1) * 3 + 1], f.az - o.z).project(c);
      if (v.z < 1) feet.push([(v.x * 0.5 + 0.5) * A.w, (1 - (v.y * 0.5 + 0.5)) * A.h]);
    }
    let rib = 0, ribNear = 0, mist = 0, mistNear = 0;
    for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
      const i = (y * A.w + x) * 4;
      if (differs(A, B, i, 3)) { rib++; if (pts.some((p) => Math.hypot(p[0] - x, p[1] - y) < 12)) ribNear++; }
      if (differs(A, C, i, 3)) { mist++; if (feet.some((p) => Math.hypot(p[0] - x, p[1] - y) < 60)) mistNear++; }
    }
    return { rib, ribNear, mist, mistNear, png };
  };
  const shot = look();
  // And a lens 300 m off the face of the nearest, 35 m over the sea, looking at the middle of it (the update that would put
  // the lens back is not run: the falls drawn are the shot's).
  let close = null;
  if (near.length) {
    const f = near[0].f;
    const m = f.n >> 1;
    const fov = c.fov;
    c.position.set(f.ax - o.x + f.out[0] * 300, g.water.level + 35, f.az - o.z + f.out[1] * 300);
    c.up.set(0, 1, 0);
    c.lookAt(f.pts[m * 3] - o.x, f.pts[m * 3 + 1] * 0.6, f.pts[m * 3 + 2] - o.z);
    c.fov = 30; c.updateProjectionMatrix(); c.updateMatrixWorld();
    close = look();
    c.fov = fov; c.updateProjectionMatrix();
  }
  const spray = wf.mistMaterial.uniforms.uFoam.value.getHex();
  const water = wf.ribbonMaterial.uniforms.uFoam.value.getHex();
  const alpine = g.alpine.falls.mistMaterial.uniforms.uFoam.value.getHex();
  const out = { drawn, known: hv._known.length, range: wf.range, alpineRange: g.alpine.falls.range, near: near.map((n) => Math.round(n.d)), shot, close, spray, water, alpine };
  place(2200);
  return out;
`;

const write = (name, url) => {
  if (!url) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(OUT + name, Buffer.from(url.split(',')[1], 'base64'));
};

{
  const server = spawn('node', [ROOT + 'tools/serve.mjs', String(PORT), SITE || ROOT], { stdio: ['ignore', 'ignore', 'inherit'] });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    try { up = (await fetch(`http://localhost:${PORT}/`)).ok; } catch { /* not up yet */ }
    if (!up) await sleep(100);
  }
  let page = null;
  try {
    page = await openPage('seed=7&world=heaven&s=2200&cam=chase&style=real&run=60');
    const j = await page.run(JUNCTION_NOW);
    if (j.error) throw new Error(j.error);
    if (j.errors.length) console.error('     shader errors: ' + j.errors.join(' | '));
    console.error(`     junction: ${j.contact} pixels of land at the sea's edge, ${j.n} measured; the sea ${f(j.sea, 3)} of the frame`);
    say(j.n > 200 && j.step90 <= JUNCTION, `where the land goes into the cloud, the largest step of L within 4 px either side: ${f(j.step90, 3)} at the 90th of the places along it (at most ${JUNCTION}), ${f(j.step50, 3)} in the median; from end to end ${f(j.span50, 3)}`);
    const r = await page.run(RING_NOW);
    if (r.error) throw new Error(r.error);
    write('ring.png', r.png);
    console.error(`     ring: L by 0.11 degrees out from the point: ${r.L.slice(0, 32).map((x) => f(x, 3)).join(' ')}`);
    // Each ring is lighter than the cloud 0.4 degrees inside and outside it: L at its radius over the mean of the two.
    const at = (deg) => r.L[Math.floor(deg / 0.11)];
    const bump = HALO.rings.map((d) => at(d) - (at(d - 0.4) + at(d + 0.4)) / 2);
    say(r.n[0] > 500 && r.n[1] > 100 && bump.every((b) => b >= RING), `the ring: each ring lighter than the cloud either side of it by ${bump.map((b) => f(b, 4)).join(' and ')} (at least ${RING}); its chroma ${f(r.inner, 4)} between 1 and 2.6 degrees, ${f(r.outer, 4)} at 4`);
    if (!SITE) {
      const c = await page.run(CRANES_NOW);
      if (c.error) throw new Error(c.error);
      say(c.shown === c.count && c.count >= 20 && c.count <= 36 && c.instances === 36, `${c.count} cranes in four skeins at the high tier (${c.instances} drawn, the rest of each nine put away)`);
      for (const [k, s] of c.skeins.entries()) {
        write(`cranes-${k}.png`, s.png);
        say(s.n >= 5 && s.n <= 9 && s.spread >= 40 && s.spread <= 90 && s.height >= 40 && s.height <= 120 && s.onEach === s.n && s.changed > 20 && s.near / s.changed > 0.95,
          `skein ${k}: ${s.n} cranes, its V ${f(s.spread, 1)} degrees, ${f(s.height, 0)} m up; drawn by each of them (${s.onEach} of ${s.n}), ${s.changed} pixels, ${f(100 * s.near / Math.max(1, s.changed), 1)}% of them by where they are meant to be`);
      }
      const fl = await page.run(FALLS_NOW);
      if (fl.error) throw new Error(fl.error);
      write('falls-shot.png', fl.shot.png);
      if (fl.close) write('falls-close.png', fl.close.png);
      const sh = fl.shot;
      const cl = fl.close || { rib: 0, ribNear: 0, mist: 0, mistNear: 0 };
      say(fl.drawn >= 1 && sh.rib >= 50 && sh.ribNear / sh.rib >= 0.7, `the falls off the islands at the heaven shot: ${fl.drawn} drawn of ${fl.known} the plan has round the lens (${fl.near.join(', ')} m off); in the shot's frame their ribbons change ${sh.rib} pixels (at least 50), ${f(100 * sh.ribNear / Math.max(1, sh.rib), 1)}% of them within 12 px of where the plan has them, on the islands' edges (at least 70%: the rest is the glow the frame's bloom spreads round the white water)`);
      say(sh.mist >= 30 && sh.mistNear / sh.mist >= 0.7, `their spray changes ${sh.mist} pixels of it (at least 30), ${f(100 * sh.mistNear / Math.max(1, sh.mist), 1)}% of them within 60 px of their feet, in the cloud (at least 70%)`);
      say(cl.rib >= 1000 && cl.mist >= 200, `300 m off the nearest one's face: its ribbon changes ${cl.rib} pixels (at least 1000; ${f(100 * cl.ribNear / Math.max(1, cl.rib), 1)}% within 12 px of it, the rest its glow), its spray ${cl.mist} (at least 200; ${f(100 * cl.mistNear / Math.max(1, cl.mist), 1)}% by its foot)`);
      say(fl.spray !== fl.water && fl.alpine === fl.water && fl.range === 2000 && fl.alpineRange === 1000, `the heaven's spray is the cloud's colour (#${fl.spray.toString(16)}), the alpine's the white water's (#${fl.alpine.toString(16)}); drawn to ${fl.range} m, the alpine's to ${fl.alpineRange}`);
      const t = await page.run(TIERS_NOW);
      if (t.error) throw new Error(t.error);
      say(t.high.veil.join() === '2,1' && t.mid.veil.join() === '1,1' && t.low.veil.join() === '0,0', `the veils and the ring: high ${t.high.veil}, mid ${t.mid.veil}, low ${t.low.veil}`);
      say(t.high.instances === 36 && t.mid.instances === 18 && t.low.instances === 0 && !t.low.visible, `the cranes drawn: high ${t.high.instances}, mid ${t.mid.instances}, low ${t.low.instances}`);
      const st = await page.run(STYLES_NOW);
      if (st.error) throw new Error(st.error);
      for (const [k, v] of Object.entries(st)) write(`style-${k}.png`, v.png);
      say(Object.values(st).every((v) => v.errors === 0), `every style draws the heaven without a shader's error (${Object.entries(st).map(([k, v]) => `${k} ${v.errors}`).join(', ')}); the frames in ${OUT}`);
      const b = await page.run(BELL_NOW);
      if (b.error) throw new Error(b.error);
      console.error(`     a temple of the road within 300 m of the lens: ${b.real ? `at s = ${b.real.s}, ${f(b.real.d, 0)} m` : 'none in the stretch laid'}`);
      say(b.strokes >= 3 && b.strokes <= 6 && b.levels.every((x) => x > 0 && x <= 1) && b.after === 0, `the bell, 150 m from a temple, 120 s: ${b.strokes} strokes (3 to 6), levels ${b.levels.map((x) => f(x)).join(' ')}; at 450 m, 60 s: ${b.after}`);
      await page.run(String.raw`const wf = g.heaven.falls; window.__fd = 0; for (const x of [wf.ribbon.geometry, wf.mist.geometry, wf.ribbonMaterial, wf.mistMaterial]) x.addEventListener('dispose', () => window.__fd++); return 0;`);
      const d = await page.run(DISPOSE_NOW);
      if (d.error) throw new Error(d.error);
      say(!d.inScene && d.geo === 1 && d.mat === 1 && d.mist === 0, 'dispose() takes the cranes out of the scene, lets go of their geometry and material, and the piers have no white');
      const fd = await page.run(String.raw`const wf = g.heaven.falls; return { n: window.__fd, inScene: !!wf.ribbon.parent || !!wf.mist.parent };`);
      say(fd.n === 4 && !fd.inScene, `dispose() lets go of the falls' two geometries and two materials (${fd.n}) and takes them out of the scene`);
      say(page.logs.length === 0, `no errors in the page${page.logs.length ? ': ' + page.logs.slice(0, 3).join(' | ') : ''}`);
    }
    page.close();
    page = null;
    if (!SITE) {
      // The hills: none of it.
      page = await openPage('seed=7&world=hills&s=2200&cam=chase&style=real&run=60');
      const h = await page.run(String.raw`place(2200); const cr = g.heaven.cranes; const { pierMist } = await import('./src/render/roadmesh.js');
        return { shown: cr.shown, visible: cr.mesh.visible, mist: pierMist.uPierMist.value.w, share: g.heaven.share, bells: g.heaven.bells };`);
      if (h.error) throw new Error(h.error);
      say(h.shown === 0 && !h.visible && h.mist === 0 && h.share === 0 && h.bells === 0, 'in the hills no crane is drawn, no pier goes white and no bell is struck');
      page.close();
      page = null;
    }
  } catch (e) {
    say(false, `the page: ${e.message}`);
  } finally {
    if (page) page.close();
    server.kill();
  }
}

console.error(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
