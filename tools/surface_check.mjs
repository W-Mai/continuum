// The grain of the road's surfaces: the tiles that world/surface.js draws, and what
// the real page does with them.
//
// In node, without a browser:
//  - each of the four tiles (the asphalt's two textures, the verge's, the concrete's,
//    the steel's) is the same bytes drawn twice, takes the processor under 150 ms
//    together (a worker draws them: world/bakeworker.js), and holds under 8 MB with
//    its mips; a tier asks for what it uses: none at low, the asphalt and the verge at
//    mid, the four at high;
//  - a tile repeats without a seam (the step across the edge it wraps at is no bigger
//    than the steps inside it), leans no way on the whole, and has the slopes, the
//    roughness, the cavity and the tone it is meant to: the means the shaders take it to
//    have (world/surface.js, MEANS), slopes of a stone's size;
//  - the mips turn what the eye cannot tell apart into roughness: the slopes' mean is
//    the same down the chain, the roughness never goes down, the steel's goes up by more
//    than 0.01 by the fifth level, and the last texel is level;
//  - the worlds that are wet are the valley, the coast and the city, by 0.25, 0.15 and 0.6.
//
// In the real page, headless (seed 7, the city, drawn at each tier in turn):
//  - at high all four tiles are in hand, under 8 MB, in five textures; the tiles
//    read are the four at high, the asphalt's and the verge's at mid, none at low, and the
//    wet, the puddles and the lamps' reflections are on at high, the wet only at mid, none at
//    low; the tiles held are kept (none is drawn again going back up); the tiers are one set of
//    programs, not a program each (the road's materials are drawn with the same programs at
//    each);
//  - the road is no more than a mesh to a material in a span, the road's audit has nothing to
//    say, the city's poles are reflected, and letting go of the road's surfaces lets go of every
//    one of its textures, on the GPU too.
//
// Usage: node tools/surface_check.mjs [--no-page]
// PORT=8206 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { MEANS, SURFACES, SURFACE_NAMES, bakeSurface, mipSizes, surfaceBytes, surfacesOf } from '../src/world/surface.js';
import { WORLDS } from '../src/world/worlds.js';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8206;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const say = (ok, text) => {
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};
const f2 = (v) => (typeof v === 'number' ? +v.toFixed(3) : v);

// --- the tiles, in node -------------------------------------------------------------

const MB = 1024 * 1024;
// The processor's time of this thread (not the machine's other threads, nor a loaded machine's clock).
const cpu = () => {
  const u = (process.threadCpuUsage || process.cpuUsage)();
  return (u.user + u.system) / 1000;
};

// The ranges each tile is held to: the slopes it leans by (rms of the slope, as the
// tile means it: stored over k) and its roughness at the base; and the means the shaders
// are given of the tiles (world/surface.js, MEANS).
const WANT = {
  asphalt: { slope: [0.25, 0.5], rough: [0.8, 0.92] },
  verge: { slope: [0.3, 0.6], rough: [0.85, 0.97] },
  concrete: { slope: [0.08, 0.2], rough: [0.8, 0.95] },
  steel: { slope: [0.05, 0.2], rough: [0.3, 0.5] },
};

function stats(name, tile) {
  const { size, k } = SURFACES[name];
  const n = size * size;
  const a = tile.a;
  let sx = 0;
  let sy = 0;
  let s2 = 0;
  let rough = 0;
  let cav = 0;
  let tone = 0;
  for (let i = 0; i < n; i++) {
    const x = (a[i * 4] / 255 * 2 - 1) / k;
    const y = (a[i * 4 + 1] / 255 * 2 - 1) / k;
    sx += x;
    sy += y;
    s2 += x * x + y * y;
    rough += a[i * 4 + 2] / 255;
    cav += a[i * 4 + 3] / 255;
    if (tile.b) tone += tile.b[i * 2] / 255;
  }
  // The step across the wrap against the steps inside, of the slopes and the cavity.
  const step = (di, dj) => {
    let s = 0;
    let c = 0;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const i2 = (i + di) % size;
        const j2 = (j + dj) % size;
        const p = (j * size + i) * 4;
        const q = (j2 * size + i2) * 4;
        s += Math.abs(a[p] - a[q]) + Math.abs(a[p + 1] - a[q + 1]) + Math.abs(a[p + 3] - a[q + 3]);
        c++;
      }
    }
    return s / c;
  };
  // Mean step to the next texel in a row (the wrap's is one of the size of them), and the one
  // to the next row, taken at the edge only: row `size - 1` to row 0, and column `size - 1` to 0.
  const inside = (step(1, 0) + step(0, 1)) / 2;
  const edge = (() => {
    let s = 0;
    for (let t = 0; t < size; t++) {
      const p = (t * size + size - 1) * 4;
      const q = (t * size) * 4;
      s += Math.abs(a[p] - a[q]) + Math.abs(a[p + 1] - a[q + 1]) + Math.abs(a[p + 3] - a[q + 3]);
      const p2 = ((size - 1) * size + t) * 4;
      const q2 = t * 4;
      s += Math.abs(a[p2] - a[q2]) + Math.abs(a[p2 + 1] - a[q2 + 1]) + Math.abs(a[p2 + 3] - a[q2 + 3]);
    }
    return s / (2 * size);
  })();
  return {
    lean: Math.hypot(sx, sy) / n, rms: Math.sqrt(s2 / n / 2), rough: rough / n, cav: cav / n, tone: tile.b ? tone / n : null,
    seam: edge / Math.max(inside, 1e-9),
  };
}

// The mean of a channel of `a` at each mip level.
function levelMeans(name, tile, ch) {
  const { size } = SURFACES[name];
  const out = [];
  let at = 0;
  for (const s of mipSizes(size)) {
    let m = 0;
    for (let i = 0; i < s * s; i++) m += tile.a[(at + i) * 4 + ch] / 255;
    out.push(m / (s * s));
    at += s * s;
  }
  return out;
}

const tiles = {};
let cpuAll = 0;
let bytesAll = 0;
for (const name of SURFACE_NAMES) {
  const t0 = cpu();
  const tile = bakeSurface(name);
  const ms = cpu() - t0;
  cpuAll += ms;
  const again = bakeSurface(name);
  const same = Buffer.compare(Buffer.from(tile.a), Buffer.from(again.a)) === 0
    && (!tile.b || Buffer.compare(Buffer.from(tile.b), Buffer.from(again.b)) === 0);
  const bytes = tile.a.length + (tile.b ? tile.b.length : 0);
  bytesAll += bytes;
  tiles[name] = tile;
  say(same, `${name}: drawn twice, the same bytes`);
  say(bytes === surfaceBytes(name), `${name}: ${(bytes / MB).toFixed(2)} MB with its mips, as surfaceBytes says (${size(name)} texels a side, ${mipSizes(SURFACES[name].size).length} mips)`);
  const st = stats(name, tile);
  say(st.lean < 0.03, `${name}: leans no way on the whole (the mean slope is ${f2(st.lean)}, under 0.03)`);
  say(st.rms >= WANT[name].slope[0] && st.rms <= WANT[name].slope[1], `${name}: the slope of its grain is ${f2(st.rms)} rms, between ${WANT[name].slope.join(' and ')}`);
  say(st.rough >= WANT[name].rough[0] && st.rough <= WANT[name].rough[1], `${name}: its roughness is ${f2(st.rough)}, between ${WANT[name].rough.join(' and ')}`);
  say(st.seam <= 1.6, `${name}: no seam where it wraps (the step across the edge is ${f2(st.seam)} of the steps inside it, at most 1.6)`);
  // The means the shaders take.
  const mean = MEANS[name];
  if (mean.tone !== undefined) say(Math.abs(st.tone - mean.tone) <= 0.01, `${name}: the mean tone of its stones is ${f2(st.tone)}, the ${mean.tone} the shader takes it to be, to 0.01`);
  if (mean.cavity !== undefined) say(Math.abs(st.cav - mean.cavity) <= 0.01, `${name}: the mean cavity is ${f2(st.cav)}, the ${mean.cavity} the shader takes it to be, to 0.01`);
  if (mean.rough !== undefined) say(Math.abs(st.rough - mean.rough) <= 0.01, `${name}: the mean roughness is ${f2(st.rough)}, the ${mean.rough} the shader takes it to be, to 0.01`);
  // The mips.
  const sxm = levelMeans(name, tile, 0);
  const rgh = levelMeans(name, tile, 2);
  const lastLean = Math.abs(sxm[sxm.length - 1] - 0.5);
  say(sxm.every((m) => Math.abs(m - sxm[0]) < 0.01), `${name}: the slopes' mean is the same down the mips (${f2(Math.max(...sxm.map((m) => Math.abs(m - sxm[0]))))} most off)`);
  say(rgh.every((r, i) => i === 0 || r >= rgh[i - 1] - 0.002), `${name}: the roughness never goes down the mips (${rgh.map(f2).join(' ')})`);
  say(lastLean < 0.05, `${name}: the last texel leans ${f2(lastLean)}, level to 0.05`);
  if (name === 'steel') say(rgh[4] - rgh[0] >= 0.01, `steel: its roughness is ${f2(rgh[4] - rgh[0])} more by the fifth mip, at least 0.01: crystals seen from afar are a rougher metal`);
}
function size(name) {
  return SURFACES[name].size;
}
say(cpuAll <= 150, `the four tiles take ${cpuAll.toFixed(0)} ms of the processor, at most 150 (a worker's job)`);
say(bytesAll <= 8 * MB, `the four tiles hold ${(bytesAll / MB).toFixed(2)} MB with their mips, at most 8`);
say(surfacesOf('low').length === 0, 'at low no tile is wanted');
say(surfacesOf('mid').join() === 'asphalt,verge', `at mid the asphalt's and the verge's (${surfacesOf('mid').join()})`);
say(surfacesOf('high').join() === SURFACE_NAMES.join(), `at high all four (${surfacesOf('high').join()})`);

// The worlds that are wet.
const wet = Object.fromEntries(WORLDS.map((w) => [w.id, w.wet || 0]));
say(wet.river === 0.25 && wet.coast === 0.15 && wet.city === 0.6, `the valley is wet by ${wet.river}, the coast by ${wet.coast}, the city by ${wet.city}`);
say(WORLDS.filter((w) => !['river', 'coast', 'city'].includes(w.id)).every((w) => !w.wet), 'the other worlds are dry');

// --- the real page ---------------------------------------------------------------------

if (!process.argv.includes('--no-page')) {
  const profile = `${tmpdir()}/continuum-surface-${process.pid}-${Date.now()}`;
  const server = spawn('node', [ROOT + 'tools/serve.mjs', String(PORT), ROOT], { stdio: ['ignore', 'ignore', 'inherit'] });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    try {
      up = (await fetch(`http://localhost:${PORT}/`)).ok;
    } catch { /* not up yet */ }
    if (!up) await sleep(100);
  }
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--mute-audio',
    '--hide-scrollbars', '--window-size=1280,720', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    `http://localhost:${PORT}/index.html?seed=7&world=city&s=2200&cam=chase&style=real&run=60`], { stdio: ['ignore', 'ignore', 'pipe'], env: CHROME_ENV });
  try {
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
    say(title === 'GAME_DONE', `the page comes up (${title})`);
    if (title === 'GAME_DONE') {
      const r = JSON.parse(await ev(`(${PAGE.toString()})().then((v) => JSON.stringify(v), (e) => JSON.stringify({ error: e.message + ' ' + (e.stack || '').slice(0, 400) }))`));
      if (r.error) {
        say(false, `the page part: ${r.error}`);
      } else {
        const t = r.tiers;
        say(t.high.held.length === 4 && t.high.bytes <= 8 * MB, `high: ${t.high.held.length} tiles in hand, ${(t.high.bytes / MB).toFixed(2)} MB, at most 8`);
        say(t.high.textures === 5, `high: ${t.high.textures} textures in hand (the asphalt's two, the verge's, the concrete's, the steel's)`);
        say(t.high.has.join() === '1,1,1,1' && t.mid.has.join() === '1,1,0,0' && t.low.has.join() === '0,0,0,0', `the tiles read: high ${t.high.has.join('')}, mid ${t.mid.has.join('')}, low ${t.low.has.join('')}`);
        say(t.high.k.join() === '1,1,1,0' && t.mid.k.join() === '1,0,0,0' && t.low.k.join() === '0,0,0,0', `wet, puddles, lamps: high ${t.high.k.slice(0, 3).join('')}, mid ${t.mid.k.slice(0, 3).join('')}, low ${t.low.k.slice(0, 3).join('')}`);
        say(r.programs[0] === r.programs[1] && r.programs[1] === r.programs[2], `the tiers are one set of programs: the road's materials are drawn with the same ${r.programs[0].split(',').filter((p) => p !== '0').length} at high, mid and low`);
        say(r.again === 0, `going back up draws no tile again (${r.again} drawn on the page since)`);
        say(r.meshes <= 9, `a span of the road is ${r.meshes} meshes at most (one to a material)`);
        say(r.audit.length === 0, `the road's audit has nothing to say${r.audit.length ? ': ' + r.audit.join('; ') : ''}`);
        say(r.reflectors > 0 && r.reflectors <= r.lamps, `the city's lamps are reflected: ${r.reflectors} of its ${r.lamps} poles`);
        say(r.letGo.fired === r.letGo.textures && r.letGo.textures >= 5, `letting go of the road's surfaces lets go of all ${r.letGo.textures} of its textures (the five of the tiles and the flat ones that stand in for them)`);
        say(r.letGo.freed === r.letGo.uploaded, `of them ${r.letGo.uploaded} were on the GPU, and ${r.letGo.freed} are gone from it`);
      }
    }
    if (logs.length) say(false, `errors in the page: ${logs.slice(0, 3).join(' | ')}`);
  } finally {
    chrome.kill();
    server.kill();
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
    await sleep(700);
  }
}

console.error(failed ? `\n${failed} FAILED` : '\nOK');
process.exit(failed ? 1 : 0);

// Runs in the page: the city drawn at each of the three tiers.
async function PAGE() {
  const g = window.game;
  const road = g.roadMesh;
  const info = g.renderer.info;
  const props = g.renderer.properties;
  // The programs the road's own materials are drawn with (their ids, 0 where one is not drawn).
  const programsOf = () => {
    const mats = new Set(Object.values(road.mat));
    for (const sp of road.spans.values()) for (const m of sp.meshes) mats.add(m.material);
    return [...mats].map((m) => (props.get(m).currentProgram ? props.get(m).currentProgram.id : 0)).join();
  };
  const tiers = {};
  const programs = [];
  for (const t of ['high', 'mid', 'low']) {
    g.setTier(t);
    for (let i = 0; i < 2; i++) {
      g.update(1 / 60);
      g.render();
    }
    const s = road.surfaces;
    tiers[t] = {
      held: [...s.held.keys()], bytes: s.bytes, textures: s.count,
      has: s.uniforms.uSurfHas.value.toArray(), k: s.uniforms.uRoadK.value.toArray(),
    };
    programs.push(programsOf());
  }
  // Back to high: nothing drawn again.
  const made = road.surfaces.page;
  g.setTier('high');
  for (let i = 0; i < 3; i++) {
    g.update(1 / 60);
    g.render();
  }
  let meshes = 0;
  for (const sp of road.spans.values()) meshes = Math.max(meshes, sp.meshes.length);
  const out = {
    tiers, programs, again: road.surfaces.page - made, meshes, audit: road.audit(),
    reflectors: road._refl.length, lamps: road.lamps, letGo: null,
  };
  // Letting go: every texture, the ones on the GPU gone from it.
  const texs = [...road.surfaces.held.values()].flat().concat(road.surfaces.flats);
  const uploaded = texs.filter((t) => props.get(t).__webglTexture).length;
  let fired = 0;
  for (const t of texs) t.addEventListener('dispose', () => fired++);
  const before = info.memory.textures;
  road.surfaces.dispose();
  out.letGo = { textures: texs.length, fired, uploaded, freed: before - info.memory.textures };
  return out;
}
