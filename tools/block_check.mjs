// The block style (render/style.js) draws what it says it draws, in the places
// the look rules (tools/look/block.json) cannot reach:
//  - the grass (render/blockgrass.js): tufts of two crossed sheets, one draw
//    call for all of them and the flowers, between 3000 and 12000 sheets in a
//    frame in the hills, fewer at the middle tier and none at the low one, the
//    pictures taken as they are (the nearest texel) and cut out, not blended,
//    nothing of them in the other styles, and all of it let go by dispose();
//  - the trees (render/forest.js): the far trees of a tile of one kind are one
//    mesh whatever block trees they are, the nearer ones are drawn from lists
//    that are one mesh to each block tree, the ones that cast a shadow are one
//    mesh to each kind, and a change back to the real style takes the block
//    trees away;
//  - the programs: the sheets' and the far trees' shader programs are among
//    those the page builds ahead, in the kind the real style shares with this
//    one, so that the first change to the block style has them built;
//  - the block's light (render/style.js, blockAO): a fold between two faces is
//    darker, and nothing is lighter;
//  - the liquids (render/water.js): the water is laid in cells a metre across
//    that change colour four times a second, so that between two frames a
//    quarter of a second apart between three tenths and seven tenths of the
//    water's pixels have changed; at the low tier it stands still;
//  - the torches (render/roadmesh.js): where a world's lamps are torches (the
//    cavern's) a post and a block stand in place of the poles in the block
//    style and the poles come back with the real one; at the low tier only the
//    light of them is drawn.
//
// Usage: node tools/block_check.mjs [--frames <dir>]
//   --frames  also writes the frames it looked at to that directory
// PORT=8199 moves the server it starts. CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8176;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const framesDir = args.includes('--frames') ? args[args.indexOf('--frames') + 1].replace(/\/?$/, '/') : null;
if (framesDir) mkdirSync(framesDir, { recursive: true });

const server = spawn('node', [ROOT + 'tools/serve.mjs', String(PORT), ROOT], { stdio: ['ignore', 'ignore', 'inherit'] });

async function waitForServer(tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return true;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  return false;
}

// The page, headless, and a way to run code in it (game is the page's).
async function openPage(query) {
  const profile = `${tmpdir()}/continuum-block-${process.pid}-${Date.now()}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--mute-audio',
    '--hide-scrollbars', '--window-size=960,540', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
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
  const close = () => {
    chrome.kill();
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
  };
  let title = '';
  for (let i = 0; i < 900; i++) {
    title = await ev('document.title');
    if (title === 'GAME_DONE' || String(title).startsWith('GAME_FAIL')) break;
    await sleep(500);
  }
  if (title !== 'GAME_DONE') {
    close();
    throw new Error(`page: ${title}`);
  }
  return {
    logs,
    run: async (body) => JSON.parse(await ev(`(async () => { const g = game; ${body} })().then((v) => JSON.stringify(v), (e) => JSON.stringify({ error: e.message + ' ' + (e.stack || '').slice(0, 400) }))`)),
    close,
  };
}

// A frame of the page as it is now, written to --frames' directory (when there is one).
async function keep(page, name) {
  if (!framesDir) return;
  const url = await page.run('g.render(); return document.getElementById("view").toDataURL("image/png");');
  if (typeof url === 'string') writeFileSync(`${framesDir}${name}.png`, Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64'));
}

const problems = [];
const say = (ok, line) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`);
  if (!ok) problems.push(line);
};
const f2 = (v) => (typeof v === 'number' ? v.toFixed(2) : String(v));
const f3 = (v) => (typeof v === 'number' ? v.toFixed(3) : String(v));

// In the page: the car put on the road at s in a style, and run for two and a half
// seconds (the lens by it), the clocks the wind and the clouds go by held. still: the car
// stands where it is put and nothing moves but what is moved by a clock.
const PLACE = (s, style, still = false) => `
  if (g.style.id !== ${JSON.stringify(style)}) { g.style.set(${JSON.stringify(style)}, true); g.style.applyScene(); }
  const p = g.road.at(${s});
  if (!p) return { missing: true };
  g.autoMode = true;
  g.sCar = ${s};
  g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(${s}, 1.9) + 0.3);
  g.car.vx = ${still ? 0 : 22};
  g.setCamera('chase');
  g.chase.shaking = false;
  g.chase.lead = false;
  g.chase.snapTo(g.car, g.car.y || 0);
  g.style.wind[0] = 1000;
  g.style.wind[1] = 400;
  g.atmosphere.uniforms.uTime.value = 100;
  for (let i = 0; i < 150; i++) { g.pilot.vMax = ${still ? 0 : 22}; g.update(1 / 60); }
  g.post.setStyle(g.style);
  g.atmosphere.bakeEnvironment();
  return { style: g.style.id };
`;

// In the page: the same place in another style (the car where it is), the world stepped twice so
// that what goes by the style (the trees, the torches) is made again, and a frame drawn.
const RESTYLE = (style) => `
  g.style.set(${JSON.stringify(style)}, true);
  g.style.applyScene();
  g.update(1 / 60);
  g.update(1 / 60);
  g.render();
  return { style: g.style.id };
`;

// In the page: how many sheets of the grass are in the frame. Each tuft's cell is found as the
// vertex shader finds it (the same integer hash), its foot read from the ground map, and it counts when the
// shader would draw it (it is thinned out by its own random number, it stands where grass grows,
// and its foot is in the view); a tuft is two sheets.
const SHEETS = `
  g.render();
  const THREE = await import('three');
  const { FullScreenQuad } = await import('./tools/vendor/postprocessing/Pass.js');
  const gr = g.grass;
  if (!gr.sheets || !gr.sheets.mesh) return { error: 'no sheets' };
  const r = g.renderer;
  const rt = gr.rt;
  const N = rt.width;
  const enc = new THREE.WebGLRenderTarget(N, N);
  const mk = (frag, tex) => new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { t: { value: tex } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'precision highp float; uniform sampler2D t; varying vec2 vUv; void main() { ' + frag + ' }',
    depthTest: false, depthWrite: false }));
  const readMap = (quad) => { r.setRenderTarget(enc); quad.render(r); const b = new Uint8Array(N * N * 4); r.readRenderTargetPixels(enc, 0, 0, N, N, b); r.setRenderTarget(null); return b; };
  const alpha = readMap(mk('float a = texture2D(t, vUv).a; gl_FragColor = vec4(a, a, a, 1.0);', rt.texture));
  const R = gr.uniforms.uMapRect.value;
  const pcg3 = (x, y, z) => {
    const m = (a, b) => Math.imul(a, b) >>> 0;
    x = (m(x, 1664525) + 1013904223) >>> 0; y = (m(y, 1664525) + 1013904223) >>> 0; z = (m(z, 1664525) + 1013904223) >>> 0;
    x = (x + m(y, z)) >>> 0; y = (y + m(z, x)) >>> 0; z = (z + m(x, y)) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0; z = (z ^ (z >>> 16)) >>> 0;
    x = (x + m(y, z)) >>> 0; y = (y + m(z, x)) >>> 0; z = (z + m(x, y)) >>> 0;
    return [x, y, z];
  };
  const seed = gr.sheets.uniforms.uSheet.value.z;
  const draw = (cx, cz, salt, ring) => pcg3(cx >>> 0, cz >>> 0, (salt + (seed >>> 0) * 7919 + ring * 104729) >>> 0).map((v) => (v & 0xffffff) / 16777216);
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const cam = g.camera;
  cam.updateMatrixWorld();
  const pv = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const o = g.road.origin;
  const noise = (px, pz, salt) => {
    const ix = Math.floor(px), iz = Math.floor(pz);
    let fx = px - ix, fz = pz - iz;
    fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    const d = (a, b) => draw(ix + a, iz + b, salt, 9)[0];
    return (d(0, 0) * (1 - fx) + d(1, 0) * fx) * (1 - fz) + (d(0, 1) * (1 - fx) + d(1, 1) * fx) * fz;
  };
  const sa = gr.sheets.uniforms.uSA.value, sb = gr.sheets.uniforms.uSB.value, sl = gr.sheets.uniforms.uSL.value;
  const flowersAmount = gr.sheets.uniforms.uSheet.value.y;
  const counts = [];
  gr.sheets.rings.forEach((ring, k) => {
    const A = sa[k], B = sb[k], L = sl[k];
    const flower = B.z > 0.5;
    const r0 = ring.reach[0] / ring.cell, r1 = ring.reach[1] / ring.cell, n = Math.ceil(r1);
    let seen = 0, all = 0;
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        const d = Math.hypot(i + 0.5, j + 0.5);
        if (d < r0 || d >= r1) continue;
        all++;
        const cx = L.x + i, cz = L.y + j;
        const r1v = draw(cx, cz, 1, B.w), r2v = draw(cx, cz, 2, B.w);
        const fx = L.z + (i + r1v[0]) * A.x, fz = L.w + (j + r1v[1]) * A.x;
        const u = (fx - R.x) / R.z, v = (R.y - fz) / R.z;
        if (u < 0.01 || u > 0.99 || v < 0.01 || v > 0.99) continue;
        const mi = Math.min(N - 1, Math.floor(u * N)), mj = Math.min(N - 1, Math.floor(v * N));
        const a = alpha[(mj * N + mi) * 4] / 255;
        const dx = fx - cam.position.x, dz = fz - cam.position.z;
        const bd = Math.hypot(dx, dz);
        const keep = (A.z <= A.y ? 1 : smooth(A.y, A.z, bd)) * (1 - smooth(B.x, B.y, bd));
        const live = smooth(0, 0.18, keep * (flower ? 1 : a) - r2v[2] * 0.82);
        if (live <= 0 || a < (flower ? 0.5 : 0.001)) continue;
        if (flower) {
          const absx = (cx + r1v[0]) * A.x, absz = (cz + r1v[1]) * A.x;
          const drift = smooth(0.42, 0.68, noise(absx / 10 + 11, absz / 10 + 11, 41));
          if (r2v[0] > flowersAmount * (0.04 + 0.5 * drift)) continue;
        }
        const c = new THREE.Vector4(fx, g.groundAt(fx, fz) + 0.4, fz, 1).applyMatrix4(pv);
        if (c.w < 0.5 || Math.abs(c.x) > c.w * 1.05 || Math.abs(c.y) > c.w * 1.05) continue;
        seen++;
      }
    }
    counts.push({ flower, cells: all, seen });
  });
  enc.dispose();
  const grass = counts.filter((c) => !c.flower).reduce((a, c) => a + c.seen, 0);
  const flowers = counts.filter((c) => c.flower).reduce((a, c) => a + c.seen, 0);
  return { counts, tufts: grass + flowers, sheets: 2 * (grass + flowers), grassSheets: 2 * grass, flowerSheets: 2 * flowers };
`;

// In the page: what the grass is: its meshes, how it is drawn.
const GRASS = `
  g.render();
  const gr = g.grass;
  const m = gr.sheets && gr.sheets.mesh;
  const meshes = gr.group.visible ? gr.group.children.filter((c) => c.visible) : [];
  return { visible: gr.group.visible, meshes: meshes.map((c) => c.name), active: gr.active, stats: gr.stats,
    sheet: m ? { transparent: m.material.transparent, depthWrite: m.material.depthWrite, side: m.material.side, magFilter: gr.sheets.atlas.magFilter,
      minFilter: gr.sheets.atlas.minFilter, mips: gr.sheets.atlas.generateMipmaps, tufts: m.geometry.userData.tufts, perRing: m.geometry.userData.perRing,
      calls: g.renderer.info.render.calls } : null,
    tier: g.tier, map: gr.rt ? gr.rt.width : 0 };
`;

// In the page: the forest, as the block style has it.
const TREES = `
  g.render();
  const f = g.forest;
  let far = 0, perKind = 0, farKinds = new Set(), tilesWithFar = 0, multi = 0;
  const seen = new Map();
  for (const t of f.tiles.values()) {
    for (const m of t.meshes) {
      if (!m.userData.far) continue;
      far++;
      const key = t.x0 + ':' + t.z0 + ':' + m.userData.kind;
      seen.set(key, (seen.get(key) || 0) + 1);
    }
  }
  for (const n of seen.values()) if (n > 1) multi++;
  const listMeshes = [];
  f.lists.forEach((set, slot) => { if (set) set.forEach((m, lod) => { if (m && m.visible && m.count) listMeshes.push(f._slots.list[slot].k + ':' + f._slots.list[slot].name + ':' + lod); }); });
  const casterMeshes = [];
  f.casters.forEach((set, slot) => { if (set) set.forEach((m, lod) => { if (m && m.userData.n) casterMeshes.push(f._slots.list[slot].k + ':' + f._slots.list[slot].name + ':' + lod); }); });
  return { blocky: f.blocky, kinds: f.kindsShown(), far, multi, listMeshes, casterMeshes, slots: f._slots.list.length, trees: f.trees };
`;

// In the page: the frame with the block's light and without it, and how the two differ.
const LIGHT = `
  const canvas = document.getElementById('view');
  const read = async () => {
    g.render();
    const im = new Image(); im.src = canvas.toDataURL('image/png'); await im.decode();
    const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
    const cx = cv.getContext('2d'); cx.drawImage(im, 0, 0);
    return cx.getImageData(0, 0, im.width, im.height).data;
  };
  const on = await read();
  const was = g.style.cur.blockAO;
  g.style.cur.blockAO = 0;
  g.post.setStyle(g.style);
  const off = await read();
  g.style.cur.blockAO = was;
  g.post.setStyle(g.style);
  let darker = 0, lighter = 0, n = 0;
  const ratios = [];
  for (let i = 0; i < on.length; i += 4) {
    n++;
    const a = on[i] + on[i + 1] + on[i + 2], b = off[i] + off[i + 1] + off[i + 2];
    if (a < b - 6) { darker++; ratios.push(a / Math.max(b, 1)); }
    else if (a > b + 6) lighter++;
  }
  ratios.sort((x, y) => x - y);
  return { n, darker: darker / n, lighter: lighter / n, median: ratios.length ? ratios[ratios.length >> 1] : null, ao: was };
`;
const NO_AO = (on) => `
  g.style.cur.blockAO = ${on ? 0.15 : 0};
  g.post.setStyle(g.style);
  return 0;
`;

// In the page: how much of the water's pixels, 8 to 100 m from the lens, are another colour a quarter of a second on
// (the world stepped fifteen times, the car stood still). The lens is put by hand over the nearest water
// the car has round it, five metres up and looking down at it.
const WATER = (frames) => `
  const urls = [];
  const o = g.road.origin;
  let best = null;
  for (let dx = -240; dx <= 240; dx += 6) {
    for (let dz = -240; dz <= 240; dz += 6) {
      const x = g.car.x + dx, z = g.car.z + dz;
      const wl = g.land.waterLevel(x + o.x, z + o.z);
      if (wl > -1000 && g.groundAt(x, z) < wl - 0.5) {
        const d = Math.hypot(dx, dz);
        if (d > 12 && (!best || d < best.d)) best = { x, z, wl, d };
      }
    }
  }
  if (!best) return { error: 'no water within 240 m of the car' };
  const aim = () => {
    g.camera.position.set(best.x + 6, best.wl + 5, best.z + 6);
    g.camera.up.set(0, 1, 0);
    g.camera.lookAt(best.x - 6, best.wl, best.z - 6);
    g.camera.updateMatrixWorld();
  };
  const THREE = await import('three');
  const { FullScreenQuad } = await import('./tools/vendor/postprocessing/Pass.js');
  const r = g.renderer, scene = g.scene, cam = g.camera;
  const canvas = document.getElementById('view');
  const w = g.post.size.x, h = g.post.size.y;
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(w, h) });
  const enc = new THREE.WebGLRenderTarget(w, h);
  const quad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tDepth: { value: rt.depthTexture }, uNF: { value: new THREE.Vector2(cam.near, cam.far) } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'precision highp float; uniform sampler2D tDepth; uniform vec2 uNF; varying vec2 vUv; void main() { float d = texture2D(tDepth, vUv).r; float z = uNF.x * uNF.y / (uNF.y - d * (uNF.y - uNF.x)); float v = d >= 0.999995 ? 1.0 : clamp(log2(1.0 + z) / log2(1.0 + uNF.y), 0.0, 0.99998); float a = floor(v * 65535.0 + 0.5); gl_FragColor = vec4(mod(a, 256.0) / 255.0, floor(a / 256.0) / 255.0, 0.0, 1.0); }',
    depthTest: false, depthWrite: false }));
  const depthOf = (only) => {
    const kids = scene.children.slice();
    const vis = kids.map((k) => k.visible);
    kids.forEach((k, i) => { k.visible = vis[i] && (!only || k.isLight || only.has(k)); });
    const auto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(rt); r.clear(); r.render(scene, cam);
    r.setRenderTarget(enc); quad.render(r);
    const b = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(enc, 0, 0, w, h, b);
    r.setRenderTarget(null);
    r.shadowMap.autoUpdate = auto;
    kids.forEach((k, i) => { k.visible = vis[i]; });
    const o = new Uint16Array(w * h);
    for (let i = 0; i < w * h; i++) o[i] = b[i * 4] | (b[i * 4 + 1] << 8);
    return o;
  };
  const read = async () => {
    aim();
    g.render();
    const url = canvas.toDataURL('image/png');
    if (${frames ? 'true' : 'false'}) urls.push(url);
    const im = new Image(); im.src = url; await im.decode();
    const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
    const cx = cv.getContext('2d'); cx.drawImage(im, 0, 0);
    return cx.getImageData(0, 0, im.width, im.height);
  };
  const A = await read();
  const all = depthOf(null);
  const wet = depthOf(new Set([g.water.mesh]));
  for (let i = 0; i < 15; i++) g.update(1 / 60);
  const B = await read();
  const lf = Math.log2(1 + cam.far);
  let n = 0, changed = 0;
  const near = [];
  for (let i = 0; i < w * h; i++) {
    if (wet[i] === 65535 || wet[i] !== all[i]) continue;
    const d = Math.pow(2, (wet[i] / 65535) * lf) - 1;
    if (d < 8 || d > 100) continue;
    // (The masks are read from the bottom row up; the frame's rows go from the top.)
    const x = Math.min(A.width - 1, Math.floor((i % w + 0.5) * A.width / w)), y = Math.min(A.height - 1, Math.floor((h - 1 - Math.floor(i / w) + 0.5) * A.height / h));
    const o = (y * A.width + x) * 4;
    n++;
    if (Math.abs(A.data[o] - B.data[o]) > 4 || Math.abs(A.data[o + 1] - B.data[o + 1]) > 4 || Math.abs(A.data[o + 2] - B.data[o + 2]) > 4) changed++;
  }
  rt.depthTexture.dispose(); rt.dispose(); enc.dispose(); quad.dispose();
  return { n, changed: n ? changed / n : null, liq: g.style.now.block, tier: g.tier, urls };
`;

// In the page: what the page builds ahead in the second frame's work (a run with run= leaves it out, so here it is
// done by hand), and which of the block style's shader programs are among those then built: the sheets' and the far
// trees', of the kind that is not of the paired paints.
const WARM = `
  for (const [, task] of g.atmosphere.warmTasks(g.camera)) task();
  g.post.stylePass.warm(g.renderer);
  await new Promise((r) => setTimeout(r, 3000));
  const keys = g.renderer.info.programs.map((p) => p.cacheKey);
  const unpaired = (name) => keys.some((k) => k.includes(name + '|atmo') && !k.includes(name + '|atmo|pair'));
  return { programs: keys.length, sheets: unpaired('continuum-grass-sheets'), far: unpaired('continuum-far-block') };
`;
const PROGRAMS = 'g.render(); return g.renderer.info.programs.length;';

// In the page: the road's lamps.
const LAMPS = `
  const m = g.roadMesh;
  const torches = m.torchPosts !== null;
  return { lamps: m.lamps, poleLamps: m.lampList.filter((l) => l.pole).length, torchLamps: m.lampList.filter((l) => l.torch).length,
    posts: torches ? m.torchPosts.count : 0, blocks: torches ? m.torchBlocks.count : 0, poles: m.poles.count,
    heads: m.heads.count, postsVisible: torches && m.torchPosts.visible, glare: m.glare.visible && m.glare.geometry.getAttribute('aSize').count, pools: m.pools.visible,
    style: m.torchStyle, shapes: m.torchShapes, tier: g.tier, emissive: torches ? m.torchFlame.emissiveIntensity : null };
`;

try {
  if (!(await waitForServer())) throw new Error('server did not start');

  // The hills: grass, trees, the block's light, the tiers, dispose.
  const hills = await openPage('seed=7&world=hills&s=5000&cam=chase&style=block&run=60');
  try {
    await hills.run(PLACE(5000, 'block'));
    await keep(hills, 'hills');
    const gr = await hills.run(GRASS);
    say(!gr.error && gr.visible && gr.active && gr.meshes.length === 1 && gr.meshes[0] === 'grass-sheets',
      `block: the grass is one mesh, ${gr.error || `${gr.meshes.join(', ')}; ${gr.stats.sheets} sheets in it (${gr.stats.blades} tufts, ${gr.stats.flowers} of them flowers)`}`);
    say(gr.sheet && !gr.sheet.transparent && gr.sheet.depthWrite && gr.sheet.magFilter === 1003 && gr.sheet.minFilter === 1003 && gr.sheet.mips === false,
      `block: a sheet is cut out, not blended, and its pictures are taken as they are (the nearest texel, no mips: ${JSON.stringify(gr.sheet && { transparent: gr.sheet.transparent, depthWrite: gr.sheet.depthWrite, mag: gr.sheet.magFilter, min: gr.sheet.minFilter })})`);
    const sh = await hills.run(SHEETS);
    say(!sh.error && sh.sheets >= 3000 && sh.sheets <= 12000,
      `block: ${sh.error || `${sh.sheets} sheets of grass in the frame in the hills (${sh.grassSheets} of grass, ${sh.flowerSheets} of flowers; by ring ${sh.counts.map((c) => c.seen).join(', ')}), 3000 to 12000`}`);

    // The block's light.
    if (framesDir) {
      await hills.run(NO_AO(false));
      await keep(hills, 'hills-noao');
      await hills.run(NO_AO(true));
    }
    const li = await hills.run(LIGHT);
    say(!li.error && li.lighter < 0.0005 && li.darker > 0.002 && li.darker < 0.2 && li.median > 0.7 && li.median < 0.97,
      `block: the block's light darkens where faces meet and lightens nothing (${li.error || `${(li.darker * 100).toFixed(2)} % of the pixels darker, ${(li.lighter * 100).toFixed(3)} % lighter, the middle one ${f3(li.median)} of what it was`})`);

    // The tiers.
    await hills.run('g.setTier("mid"); g.render(); g.render(); return 0;');
    const mid = await hills.run(GRASS);
    const midSheets = await hills.run(SHEETS);
    say(!mid.error && mid.visible && mid.map === 192 && mid.stats.sheets >= gr.stats.sheets * 0.4 && mid.stats.sheets <= gr.stats.sheets * 0.8,
      `block: the middle tier has ${mid.stats.sheets} of the ${gr.stats.sheets} sheets, and a map ${mid.map} texels across`);
    say(!midSheets.error && midSheets.sheets < sh.sheets, `block: and fewer of them in the frame (${midSheets.sheets} of ${sh.sheets})`);
    await hills.run('g.setTier("low"); g.render(); g.render(); return 0;');
    const low = await hills.run(GRASS);
    say(!low.error && !low.visible && low.meshes.length === 0, `block: the low tier draws no grass (${low.error || `${low.meshes.length} meshes`})`);
    await hills.run('g.setTier("high"); g.render(); g.render(); return 0;');

    // Another style: no sheets; the painted style's blades are drawn where they were.
    await hills.run(RESTYLE('paint'));
    const paint = await hills.run(GRASS);
    say(!paint.error && paint.sheet === null && paint.meshes.length === 4 && !paint.meshes.includes('grass-sheets'),
      `paint: blades in rings and flowers, no sheets (${paint.error || paint.meshes.join(', ')})`);

    // Back to the real style: the grass is gone.
    await hills.run(RESTYLE('real'));
    const realGrass = await hills.run(GRASS);
    say(!realGrass.error && !realGrass.visible && realGrass.meshes.length === 0, 'real: no grass');

    // And the block style again: the grass comes back.
    await hills.run(RESTYLE('block'));
    const again = await hills.run(GRASS);
    say(!again.error && again.visible && again.meshes.length === 1 && again.stats.sheets === gr.stats.sheets,
      `block again: the grass is back (${again.error || `${again.stats.sheets} sheets`})`);

    // Dispose: everything the grass holds on the GPU goes.
    const gone = await hills.run(`
      const before = g.renderer.info.memory.geometries;
      const textures = g.renderer.info.memory.textures;
      g.grass.dispose();
      return { before, after: g.renderer.info.memory.geometries, textures, texturesAfter: g.renderer.info.memory.textures, inScene: !!g.scene.getObjectByName('grass') };
    `);
    say(!gone.error && gone.after < gone.before && gone.texturesAfter < gone.textures && !gone.inScene,
      `block: dispose() lets go of what the grass holds (geometries ${gone.before} to ${gone.after}, textures ${gone.textures} to ${gone.texturesAfter}, in the scene: ${gone.inScene})`);
    const sea = await hills.run(`
      const before = g.renderer.info.memory.geometries;
      g.water.dispose();
      return { before, after: g.renderer.info.memory.geometries, inScene: g.scene.children.includes(g.water.mesh) };
    `);
    say(!sea.error && sea.after < sea.before && !sea.inScene, `block: and so does the sea's (geometries ${sea.before} to ${sea.after}, in the scene: ${sea.inScene})`);
    if (hills.logs.length) say(false, `the hills page logged errors: ${hills.logs.slice(0, 2).join(' | ')}`);
  } finally {
    hills.close();
  }

  // The wood (the hills at 3600 m: broadleaf trees close by): the trees.
  const wood = await openPage('seed=7&world=hills&s=3600&cam=chase&style=block&run=60');
  try {
    await wood.run(PLACE(3600, 'block'));
    await keep(wood, 'wood');
    const tr = await wood.run(TREES);
    say(!tr.error && tr.blocky && tr.multi === 0 && tr.far > 0, `block: the far trees of a kind in a tile are one mesh (${tr.error || `${tr.far} far meshes, ${tr.multi} tiles with two of a kind`})`);
    say(!tr.error && tr.listMeshes.length > 0 && tr.listMeshes.every((n) => /^\d+:[a-z]+:[01]$/.test(n)),
      `block: the trees near the lens are drawn from lists, a mesh to each block tree and level (${(tr.listMeshes || []).join(' ')})`);
    say(!tr.error && tr.casterMeshes.length > 0 && tr.casterMeshes.length <= tr.kinds && new Set(tr.casterMeshes.map((n) => n.split(':')[0])).size === tr.casterMeshes.length,
      `block: the trees that cast a shadow are one mesh to each kind (${(tr.casterMeshes || []).join(' ')})`);
    // Back to the real style: the block trees are gone.
    await wood.run(RESTYLE('real'));
    const real = await wood.run(TREES);
    say(!real.error && !real.blocky && real.slots === 7 && real.listMeshes.every((n) => /^\d+:null:[01]$/.test(n)) && real.kinds <= tr.kinds - 2,
      `real: the trees are the trees again, a list to each kind (${real.error || `${real.slots} slots, ${real.kinds} kinds against ${tr.kinds} in the block style`})`);
    // And the block style again: they come back.
    await wood.run(RESTYLE('block'));
    const again = await wood.run(TREES);
    say(!again.error && again.blocky && again.kinds === tr.kinds && again.far === tr.far,
      `block again: the block trees are back (${again.error || `${again.kinds} kinds of tree, ${again.far} far meshes`})`);
    if (wood.logs.length) say(false, `the wood page logged errors: ${wood.logs.slice(0, 2).join(' | ')}`);
  } finally {
    wood.close();
  }

  // The first change to the block style, from a page that has done its second frame's work: the programs the style
  // draws its grass and its far trees with are built already.
  const first = await openPage('seed=7&world=hills&s=5000&cam=chase&style=real&run=60');
  try {
    await first.run(PLACE(5000, 'real'));
    const w = await first.run(WARM);
    say(!w.error && w.sheets && w.far, `block: the programs of the sheets and of the far trees are built ahead (${w.error || `${w.programs} programs, the sheets' ${w.sheets ? 'among them' : 'missing'}, the far trees' ${w.far ? 'among them' : 'missing'}`})`);
    const p0 = await first.run(PROGRAMS);
    await first.run(RESTYLE('block'));
    await first.run('g.render(); g.render(); return 0;');
    const p1 = await first.run(PROGRAMS);
    console.log(`note  the first change to the block style builds ${p1 - p0} shader programs on top of ${p0}`);
    if (first.logs.length) say(false, `the first-change page logged errors: ${first.logs.slice(0, 2).join(' | ')}`);
  } finally {
    first.close();
  }

  // The water: the river and the coast, the car standing still.
  for (const [world, s] of [['river', 3600], ['coast', 900]]) {
    const page = await openPage(`seed=7&world=${world}&s=${s}&cam=chase&style=block&run=60`);
    try {
      await page.run(PLACE(s, 'block', true));
      const w = await page.run(WATER(!!framesDir));
      if (framesDir && w.urls) w.urls.forEach((u, i) => writeFileSync(`${framesDir}${world}-${i ? 'b' : 'a'}.png`, Buffer.from(u.replace(/^data:image\/png;base64,/, ''), 'base64')));
      say(!w.error && w.n > 1500 && w.changed >= 0.3 && w.changed <= 0.7,
        `block: ${world}: ${w.error || `${(w.changed * 100).toFixed(1)} % of ${w.n} water pixels are another colour a quarter of a second on`}, 30 to 70 %`);
      await page.run('g.setTier("low"); g.update(1 / 60); return 0;');
      const still = await page.run(WATER(false));
      say(!still.error && still.n > 1500 && still.changed <= 0.02,
        `block: ${world}: at the low tier the cells stand still (${still.error || `${(still.changed * 100).toFixed(1)} % changed`})`);
      await page.run('g.setTier("high"); g.update(1 / 60); return 0;');
      if (page.logs.length) say(false, `${world} page logged errors: ${page.logs.slice(0, 2).join(' | ')}`);
    } finally {
      page.close();
    }
  }

  // The torches: the cavern's lamps.
  const cave = await openPage('seed=7&world=cavern&s=2255&cam=chase&style=block&run=60');
  try {
    await cave.run(PLACE(2255, 'block', true));
    await keep(cave, 'cavern');
    const b = await cave.run(LAMPS);
    say(!b.error && b.torchLamps > 0 && b.posts === b.torchLamps && b.blocks === b.posts && b.poles === b.poleLamps - b.torchLamps && b.postsVisible,
      `block: the cavern's lamps are torches, a post and a block each, and no poles where they stand (${b.error || `${b.torchLamps} lamps, ${b.posts} posts, ${b.blocks} blocks, ${b.poles} poles of the ${b.poleLamps - b.torchLamps} that are not torches`})`);
    say(!b.error && b.glare > 0 && b.pools, `block: and their glare and pools of light are kept (${b.glare} points of glare)`);
    await cave.run('for (let i = 0; i < 30; i++) g.update(1 / 60); return 0;');
    const f = await cave.run(LAMPS);
    say(!f.error && Math.abs(f.emissive - 2.4) > 1e-6, `block: a torch's block flickers at the high tier (its light ${f2(b.emissive)} and ${f2(f.emissive)})`);
    await cave.run('g.setTier("low"); g.update(1 / 60); return 0;');
    const l = await cave.run(LAMPS);
    say(!l.error && l.posts === 0 && l.blocks === 0 && l.glare > 0 && l.pools, `block: at the low tier only the light of the torches is drawn (${l.error || `${l.posts} posts, ${l.glare} points of glare`})`);
    await cave.run('g.setTier("high"); g.update(1 / 60); return 0;');
    await cave.run(RESTYLE('real'));
    const r = await cave.run(LAMPS);
    say(!r.error && r.posts === 0 && r.blocks === 0 && r.poles === r.poleLamps && r.poles >= r.torchLamps && r.torchLamps > 0 && r.heads === r.poles, `real: the poles are back (${r.error || `${r.poles} poles, ${r.posts} torches`})`);
    // Block again, then the road is let go of: the torches' posts and blocks with it.
    await cave.run(RESTYLE('block'));
    const road = await cave.run(`
      const before = g.renderer.info.memory.geometries;
      const posts = g.roadMesh.torchPosts;
      g.roadMesh.dispose();
      return { before, after: g.renderer.info.memory.geometries, inScene: g.scene.children.includes(posts) || !!g.scene.getObjectByName('road') };
    `);
    say(!road.error && road.after < road.before && !road.inScene, `block: dispose() lets go of the road, the torches with it (geometries ${road.before} to ${road.after}, in the scene: ${road.inScene})`);
    if (cave.logs.length) say(false, `the cavern page logged errors: ${cave.logs.slice(0, 2).join(' | ')}`);
  } finally {
    cave.close();
  }
} catch (e) {
  say(false, String(e.stack || e));
} finally {
  server.kill();
}
console.log(problems.length ? `\n${problems.length} FAILED` : '\nall passed');
process.exit(problems.length ? 1 : 0);
