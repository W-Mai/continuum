// The real style's trees: the leaves and bark that world/foliage.js draws, and what the real page
// does with them.
//
// In node, without a browser:
//  - each tier's atlas of four cards and bark tile are the same bytes drawn twice, take the
//    processor under 150 ms together at high (a worker draws them: world/bakeworker.js), and hold as many
//    bytes with their mips as foliageBytes says; the tiers are 512, 256 and 128 texels across the atlas;
//  - each card has the coverage and the colour it is meant to: the mean of its alpha is in a range of
//    its own, and it and the mean colour are the FOLIAGE_MEANS the impostors and the shaders take; the mips
//    keep the alpha's mean down the chain, the cards keep a margin clear of paint against their neighbours, and
//    where nothing is painted the colour is not black;
//  - the bark repeats without a seam, has no normal that points into it, and has the mean cavity it
//    is meant to, which the mips keep.
//
// In the real page, headless (seed 7, the hills, drawn at each tier in turn):
//  - the textures are the two of the leaves and bark and the four of the impostors, they hold under
//    14 MB with their mips, and come from a worker where there is one;
//  - each kind's near build has at most 1800 triangles and its middle build 500; an impostor is two
//    triangles; the trees of the real style are one mesh to a tile for what is far, and the lists, the
//    casters and the tiles say they are drawn with the real style's material, and the casters with a depth
//    material that lets the light through the holes of the leaves;
//  - at the middle and low tier a near tree is the middle build; going back up gives the near one again, and
//    no texture is made again;
//  - the real style's trees come and go with the style: another style draws the trees it always drew, and
//    coming back to the real one makes no texture again;
//  - the same tree drawn as the middle build and as its impostor at 330 m, lit as this world's light lights
//    it, has the same mean colour, to 0.03 in OKLab;
//  - letting go of the foliage lets go of every one of its textures, on the GPU too.
//
// Usage: node tools/trees_check.mjs [--no-page]
// PORT=8206 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { FOLIAGE_MEANS, FOLIAGE_TIERS, LEAF_KINDS, bakeFoliage, foliageBytes, mipSizes } from '../src/world/foliage.js';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8207;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const say = (ok, text) => {
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};
const f3 = (v) => (typeof v === 'number' ? +v.toFixed(3) : v);

// --- the textures, in node ---------------------------------------------------------------

const MB = 1024 * 1024;
const cpu = () => {
  const u = (process.threadCpuUsage || process.cpuUsage)();
  return (u.user + u.system) / 1000;
};
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

// The ranges the mean alpha of each card is held to.
const COVER = { broadleaf: [0.55, 0.78], conifer: [0.4, 0.62], pine: [0.25, 0.55], dead: [0.08, 0.27] };

let cpuHigh = 0;
for (const tier of ['high', 'mid', 'low']) {
  bakeFoliage(tier);
  const t0 = cpu();
  const items = bakeFoliage(tier);
  const ms = cpu() - t0;
  if (tier === 'high') cpuHigh = ms;
  const again = bakeFoliage(tier);
  const same = items.every((t, i) => Buffer.compare(Buffer.from(t.a), Buffer.from(again[i].a)) === 0);
  say(same, `${tier}: drawn twice, the same bytes`);
  const want = foliageBytes(tier);
  const [atlas, bark] = items;
  say(atlas.size === FOLIAGE_TIERS[tier].atlas && bark.size === FOLIAGE_TIERS[tier].bark && atlas.a.length === want.atlas && bark.a.length === want.bark,
    `${tier}: the atlas is ${atlas.size} texels across and the bark ${bark.size}, ${((atlas.a.length + bark.a.length) / MB).toFixed(2)} MB with their mips, as foliageBytes says`);
  if (tier !== 'high') continue;

  // The cards.
  const S = atlas.size;
  const half = S / 2;
  const mips = mipSizes(S);
  const levelStart = [];
  let at = 0;
  for (const s of mips) {
    levelStart.push(at);
    at += s * s;
  }
  LEAF_KINDS.forEach((kind, i) => {
    const col = i % 2;
    const row = i >> 1;
    let a = 0;
    let n = 0;
    const rgb = [0, 0, 0];
    let edge = 0;
    let dark = 0;
    let clear = 0;
    for (let y = row * half; y < (row + 1) * half; y++) {
      for (let x = col * half; x < (col + 1) * half; x++) {
        const o = (y * S + x) * 4;
        const al = atlas.a[o + 3] / 255;
        a += al;
        n++;
        for (let c = 0; c < 3; c++) rgb[c] += lin(atlas.a[o + c] / 255) * al;
        const border = x - col * half < 2 || x - col * half >= half - 2 || y - row * half < 2 || y - row * half >= half - 2;
        if (border && atlas.a[o + 3] > 0) edge++;
        if (atlas.a[o + 3] === 0) {
          clear++;
          if (atlas.a[o] + atlas.a[o + 1] + atlas.a[o + 2] < 6) dark++;
        }
      }
    }
    const mean = a / n;
    const colour = rgb.map((v) => v / a);
    const m = FOLIAGE_MEANS[kind];
    say(mean >= COVER[kind][0] && mean <= COVER[kind][1], `${kind}: ${f3(mean)} of the card is leaf, between ${COVER[kind].join(' and ')}`);
    say(Math.abs(mean - m.alpha) <= 0.005 && colour.every((v, c) => Math.abs(v - m.rgb[c]) <= 0.004),
      `${kind}: the mean alpha ${f3(mean)} and the mean colour ${colour.map(f3).join(' ')} are the ${m.alpha} and ${m.rgb.join(' ')} that the impostors take`);
    say(edge === 0, `${kind}: nothing is painted in the margin against the other cards`);
    say(dark === 0, `${kind}: where nothing is painted the colour is not black (${clear} texels, ${dark} of them black)`);
    // The mips keep the alpha's mean.
    const keep = mips.map((s, l) => {
      const q = s / 2;
      if (q < 1) return mean;
      let t = 0;
      const base = levelStart[l];
      for (let y = row * q; y < (row + 1) * q; y++) for (let x = col * q; x < (col + 1) * q; x++) t += atlas.a[(base + y * s + x) * 4 + 3] / 255;
      return t / (q * q);
    });
    const off = Math.max(...keep.slice(0, -1).map((v) => Math.abs(v - mean)));
    say(off <= 0.01, `${kind}: the mean alpha is the same down the mips (${f3(off)} most off, ${keep.slice(0, 5).map(f3).join(' ')} ...)`);
  });

  // The bark.
  const B = bark.size;
  let cav = 0;
  let zlow = 0;
  for (let i = 0; i < B * B; i++) {
    cav += bark.a[i * 4 + 3] / 255;
    const nz = (bark.a[i * 4 + 2] / 255) * 2 - 1;
    if (nz <= 0.05) zlow++;
  }
  cav /= B * B;
  const step = (di, dj) => {
    let s = 0;
    for (let j = 0; j < B; j++) {
      for (let i = 0; i < B; i++) {
        const p = (j * B + i) * 4;
        const q = (((j + dj) % B) * B + ((i + di) % B)) * 4;
        s += Math.abs(bark.a[p] - bark.a[q]) + Math.abs(bark.a[p + 1] - bark.a[q + 1]) + Math.abs(bark.a[p + 3] - bark.a[q + 3]);
      }
    }
    return s / (B * B);
  };
  const inside = (step(1, 0) + step(0, 1)) / 2;
  let edge = 0;
  for (let t = 0; t < B; t++) {
    const p = (t * B + B - 1) * 4;
    const q = t * B * 4;
    edge += Math.abs(bark.a[p] - bark.a[q]) + Math.abs(bark.a[p + 1] - bark.a[q + 1]) + Math.abs(bark.a[p + 3] - bark.a[q + 3]);
    const p2 = ((B - 1) * B + t) * 4;
    const q2 = t * 4;
    edge += Math.abs(bark.a[p2] - bark.a[q2]) + Math.abs(bark.a[p2 + 1] - bark.a[q2 + 1]) + Math.abs(bark.a[p2 + 3] - bark.a[q2 + 3]);
  }
  edge /= 2 * B;
  say(edge / Math.max(inside, 1e-9) <= 1.6, `bark: no seam where it wraps (the step across the edge is ${f3(edge / Math.max(inside, 1e-9))} of the steps inside it, at most 1.6)`);
  say(zlow === 0, `bark: no normal points into the wood (${zlow} texels with a z of 0.05 or less)`);
  say(Math.abs(cav - FOLIAGE_MEANS.bark.cavity) <= 0.01, `bark: the mean cavity is ${f3(cav)}, the ${FOLIAGE_MEANS.bark.cavity} the shader takes it to be, to 0.01`);
  let last = 0;
  const lastAt = (mipSizes(B).reduce((n, s) => n + s * s, 0) - 1) * 4;
  last = bark.a[lastAt + 3] / 255;
  say(Math.abs(last - cav) <= 0.03, `bark: the last texel's cavity is ${f3(last)}, the mean to 0.03`);
}
say(cpuHigh <= 150, `the atlas and the bark at high take ${cpuHigh.toFixed(0)} ms of the processor, at most 150 (a worker's job)`);
const total = foliageBytes('high');
say(total.atlas + total.bark <= 2 * MB, `the leaves and the bark hold ${((total.atlas + total.bark) / MB).toFixed(2)} MB with their mips at high, at most 2`);

// --- the real page ----------------------------------------------------------------------

if (!process.argv.includes('--no-page')) {
  const profile = `${tmpdir()}/continuum-trees-${process.pid}-${Date.now()}`;
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
    `http://localhost:${PORT}/index.html?seed=7&world=hills&s=3600&cam=chase&style=real&run=60`], { stdio: ['ignore', 'ignore', 'pipe'], env: CHROME_ENV });
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
        say(r.ready && r.textures === 6, `the foliage is ready: ${r.textures} textures (the leaves, the bark and the impostors of ${r.impostors} kinds)`);
        say(r.bytes <= 14 * 1e6, `the foliage holds ${(r.bytes / 1e6).toFixed(1)} MB of textures with their mips, at most 14`);
        say(r.page === 0 || r.noWorker, `the textures come from a worker where there is one (${r.page} drawn on the page)`);
        for (const [kind, k] of Object.entries(r.kinds)) {
          say(k.near <= 1800 && k.mid <= 500 && k.near > k.mid, `${kind}: the near build has ${k.near} triangles (at most 1800), the middle one ${k.mid} (at most 500)`);
        }
        say(r.far.every((f) => f.triangles === f.trees * 2), `an impostor is two triangles: ${r.far.length} tiles' far trees, ${r.far.reduce((n, f) => n + f.trees, 0)} trees, ${r.far.reduce((n, f) => n + f.triangles, 0)} triangles`);
        say(r.drawn.lists > 0 && r.drawn.listsReal === r.drawn.lists, `the lists of trees are drawn with the real style's material (${r.drawn.listsReal} of ${r.drawn.lists})`);
        say(r.drawn.casters > 0 && r.drawn.casterDepth === r.drawn.casters, `the casters have the depth material that lets the light through the leaves' holes (${r.drawn.casterDepth} of ${r.drawn.casters})`);
        const wood = r.kinds.broadleaf;
        say(r.tiers.mid.nearTriangles === wood.mid && r.tiers.low.nearTriangles === wood.mid && r.tiers.high.nearTriangles === wood.near && r.tiers.again.nearTriangles === wood.near,
          `the near trees are the middle build at mid and low (${r.tiers.mid.nearTriangles}, ${r.tiers.low.nearTriangles} triangles of ${wood.mid}) and the near one at high (${r.tiers.high.nearTriangles} of ${wood.near}); back up they are the near one again (${r.tiers.again.nearTriangles})`);
        say(r.tiers.made === 0, `going up and down draws no texture again (${r.tiers.made} drawn on the page since)`);
        say(r.styles.paint.real === false && r.styles.paint.far === 'old' && r.styles.back.real === true && r.styles.back.far === 'real' && r.styles.back.made === 0,
          `another style draws the trees it always drew (${r.styles.paint.far}), the real style's come back with no texture drawn again (${r.styles.back.made})`);
        for (const [kind, h] of Object.entries(r.handoff)) {
          const mean = h.dE.reduce((x, y) => x + y, 0) / h.dE.length;
          say(mean <= 0.03 && h.worst <= 0.06, `${kind}: at 330 m, seen from four sides, the middle build and its impostor (light ${f3(h.gain)}) have the same mean colour to ${h.dE.map(f3).join(', ')} in OKLab, ${f3(mean)} on the mean (at most 0.03; and no side over 0.06; the impostor has ${h.light.map(f3).join(', ')} of the build's light; ${h.cover.join(', ')} of the frame covered); with the light at ${f3(h.suggested)}: ${h.again.dE.map(f3).join(', ')}`);
        }
        say(r.letGo.fired === r.letGo.textures && r.letGo.freed === r.letGo.uploaded, `letting go of the foliage lets go of all its ${r.letGo.textures} textures, ${r.letGo.uploaded} of them on the GPU, ${r.letGo.freed} gone from it`);
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

// Runs in the page: the hills' wood in the real style.
async function PAGE() {
  const THREE = await import('three');
  const g = window.game;
  const f = g.foliage;
  const info = g.renderer.info;
  const props = g.renderer.properties;
  const frame = (n = 2) => {
    for (let i = 0; i < n; i++) {
      g.update(1 / 60);
      g.render();
    }
  };
  frame(3);
  const out = {};
  out.ready = f.ready;
  out.impostors = f.impostors.size;
  out.textures = (f.tex ? 2 : 0) + f.impostors.size;
  out.bytes = f.bytes.bytes;
  out.page = f.page;
  out.noWorker = !g.bakers;
  const names = ['spruce', 'broadleaf', 'pine', 'dead'];
  out.kinds = {};
  for (const k of names) out.kinds[k] = { near: f.geometry(k, 0).userData.triangles, mid: f.geometry(k, 1).userData.triangles };
  // The far trees: a card to a tree; the lists and the casters.
  out.far = [];
  out.drawn = { lists: 0, listsReal: 0, casters: 0, casterDepth: 0 };
  const visit = () => {
    out.far = [];
    out.drawn = { lists: 0, listsReal: 0, casters: 0, casterDepth: 0 };
    for (const t of g.forest.tiles.values()) {
      for (const m of t.meshes) {
        if (!m.userData.far) continue;
        const real = m.material === f.bill.get(names[0]) || [...f.bill.values()].includes(m.material);
        if (!real) continue;
        out.far.push({ trees: m.geometry.getAttribute('position').count / 4, triangles: m.geometry.index.count / 3 });
      }
    }
    for (const set of g.forest.lists) for (const m of set || []) if (m && m.count > 0) {
      out.drawn.lists++;
      if (m.material === f.lit) out.drawn.listsReal++;
    }
    for (const set of g.forest.casters) for (const m of set || []) if (m) {
      out.drawn.casters++;
      if (m.customDepthMaterial === f.depth) out.drawn.casterDepth++;
    }
  };
  visit();
  // The tiers.
  const nearOf = () => {
    let most = 0;
    for (const set of g.forest.lists) for (const m of set || []) if (m && m.userData.lod === 0 && m.count > 0) most = Math.max(most, m.geometry.index.count / 3);
    return most;
  };
  const made = f.page;
  out.tiers = {};
  for (const t of ['high', 'mid', 'low', 'high']) {
    g.setTier(t);
    frame(3);
    out.tiers[out.tiers[t] ? 'again' : t] = { nearTriangles: nearOf() };
  }
  out.tiers.made = f.page - made;
  // The styles.
  const farKind = () => {
    for (const t of g.forest.tiles.values()) for (const m of t.meshes) if (m.userData.far) return [...f.bill.values()].includes(m.material) ? 'real' : 'old';
    return 'none';
  };
  g.style.set('paint', true);
  g.style.applyScene();
  frame(4);
  const paint = { real: !!g.forest.real, far: farKind() };
  g.style.set('real', true);
  g.style.applyScene();
  frame(4);
  out.styles = { paint, back: { real: !!g.forest.real, far: farKind(), made: f.page - made } };
  // The same tree two ways at 330 m.
  out.handoff = {};
  const scene = g.scene;
  const lin = (r, gg, b) => {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * gg + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * gg + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * gg + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const rt = new THREE.WebGLRenderTarget(256, 256, { type: THREE.HalfFloatType });
  const hidden = [];
  for (const c of scene.children) if (!c.isLight && !c.isCamera && c.visible) {
    hidden.push(c);
    c.visible = false;
  }
  const o = g.camera.position;
  const ground = g.groundAt(o.x + 330, o.z);
  const exposure = g.post._expose || 2;
  for (const kind of names) {
    const h = 11;
    const w = 12.5;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(o.x + 330, ground - 0.5, o.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.9), new THREE.Vector3(w, h, w));
    const src = f.geometry(kind, 1);
    const geo = new THREE.BufferGeometry();
    for (const a of Object.keys(src.attributes)) geo.setAttribute(a, src.getAttribute(a));
    geo.setIndex(src.getIndex());
    geo.setAttribute('aSun', new THREE.InstancedBufferAttribute(new Float32Array([1]), 1));
    const a = new THREE.InstancedMesh(geo, f.lit, 1);
    a.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3);
    a.setMatrixAt(0, m);
    a.frustumCulled = false;
    const bg = f.billboards(kind, { n: 1, mats: Float32Array.from(m.elements), cols: new Float32Array([1, 1, 1]), suns: new Float32Array([1]) });
    const b = new THREE.Mesh(bg, f.bill.get(kind));
    b.frustumCulled = false;
    const read = (mesh, cam) => {
      scene.add(mesh);
      g.renderer.setRenderTarget(rt);
      g.renderer.setClearColor(0x000000, 0);
      g.renderer.clear();
      g.renderer.render(scene, cam);
      const buf = new Uint16Array(256 * 256 * 4);
      g.renderer.readRenderTargetPixels(rt, 0, 0, 256, 256, buf);
      g.renderer.setRenderTarget(null);
      scene.remove(mesh);
      let n = 0;
      const sum = [0, 0, 0];
      for (let i = 0; i < 256 * 256; i++) {
        if (THREE.DataUtils.fromHalfFloat(buf[i * 4 + 3]) < 0.5) continue;
        n++;
        for (let c = 0; c < 3; c++) sum[c] += THREE.DataUtils.fromHalfFloat(buf[i * 4 + c]);
      }
      const mean = sum.map((v) => (v / Math.max(n, 1)) * exposure);
      return { lab: lin(...mean), cover: n / (256 * 256) };
    };
    const rec = { dE: [], light: [], cover: [], worst: 0, again: null, gain: f.bill.get(kind).userData.uniforms.uBillGain.value };
    const gain = f.bill.get(kind).userData.uniforms.uBillGain;
    // Twice: with the impostor's light as it is, and with the light that would make its mean the build's, as the first
    // round measured it (what the light should be, to the number).
    for (let round = 0; round < 2; round++) {
      const rounds = round === 0 ? rec : (rec.again = { dE: [], worst: 0 });
      if (round === 1) gain.value = rec.gain / (rec.light.reduce((x, y) => x + y, 0) / rec.light.length);
      for (let k = 0; k < 4; k++) {
        // The lens 330 m off, on each side of the tree in turn.
        const az = (k * Math.PI) / 2;
        const cam = new THREE.PerspectiveCamera(4.6, 1, 10, 4000);
        cam.position.set(o.x + 330 + Math.cos(az) * 330, ground + 5, o.z + Math.sin(az) * 330);
        cam.lookAt(o.x + 330, ground + h * 0.55, o.z);
        cam.updateMatrixWorld();
        const A = read(a, cam);
        const B = read(b, cam);
        const dE = Math.hypot(A.lab[0] - B.lab[0], A.lab[1] - B.lab[1], A.lab[2] - B.lab[2]);
        rounds.dE.push(dE);
        if (round === 0) {
          // How much of the build's light the impostor has, as a share of the light (L is about the cube root of it).
          rec.light.push((B.lab[0] / A.lab[0]) ** 3);
          rec.cover.push(+A.cover.toFixed(3) + '/' + +B.cover.toFixed(3));
        }
        rounds.worst = Math.max(rounds.worst, dE);
      }
    }
    rec.suggested = gain.value;
    gain.value = rec.gain;
    out.handoff[kind] = rec;
    a.dispose();
    geo.dispose();
    bg.dispose();
  }
  for (const c of hidden) c.visible = true;
  rt.dispose();
  // Letting go.
  const texs = [f.tex.atlas, f.tex.bark, ...[...f.impostors.values()].map((r) => r.texture)];
  const owners = [f.tex.atlas, f.tex.bark, ...f.impostors.values()];
  const uploaded = texs.filter((t) => props.get(t).__webglTexture).length;
  let fired = 0;
  for (const t of owners) t.addEventListener('dispose', () => fired++);
  const before = info.memory.textures;
  f.dispose();
  out.letGo = { textures: texs.length, fired, uploaded, freed: before - info.memory.textures };
  return out;
}
