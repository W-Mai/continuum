// The grass (render/grass.js): the ground map it is drawn from, and what it
// leaves alone.
//
// The blades take their height, their colour and whether they grow from a
// map of the land drawn from straight above each frame, so what this holds
// is that the map is the land as it is drawn, and nothing else. It runs the
// real page headless, at places in the worlds that have grass, and asserts:
//  - the map has the colour of the ground: with the blades drawn flat (the
//    ground's colour alone, ?grassflat=1) and with no grass (?grass=0), the
//    ground near the lens, as the frame shows it, has the same mean colour,
//    to 0.004 in OKLab, at six places (hills, meadow, wood, river, alpine,
//    coast); and at night, with only the car's lights on it, to 0.006;
//  - the map has the height of the ground: 500 points of it where grass
//    grows, against Game.groundAt, differ by 0.15 m or less at the 95th
//    percentile;
//  - nothing grows on the road's platform (nearer the centre line than
//    HALF_FLAT), nor under the water: the map's share of grass there is nothing;
//  - the worlds with no grass (the city, the caverns, the inferno, the deep,
//    space, the Upside Down) draw no map and no blades: the frame draws as
//    many times as with ?grass=0 and no pass is made from above;
//  - the same place drawn twice is the same frame, and the first frame after
//    the car is put down is the same as the one after it (the sun's shadows
//    are not a frame behind), and the last pass gives way to the grass's flowers from
//    the first frame;
//  - the low tier draws no blades and no map, and the last pass keeps the
//    flowers it lays on the ground; the middle tier has about 0.6 of the
//    blades, 130000 triangles of them and the flowers at most, and a smaller map;
//  - the grass thins out across a border from the hills to the desert: the
//    share of the ground grass grows on (what nine tenths of the map is at most), every 100 m, never grows by more
//    than 0.04 (the land's own rocks and trees move it a little), and does not drop by half in a step.
//
// Usage: node tools/grass_check.mjs
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8181;
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

// The page, headless, and a way to run code in it; errors the page logs come
// back with it.
async function openPage(query) {
  const profile = `${tmpdir()}/continuum-grass-${process.pid}-${Date.now()}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--mute-audio', '--hide-scrollbars', '--window-size=960,540', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
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

// The places, as tools/look.mjs has them: a world and where along the road in
// it (m); the lens by the car, or put down by hand beside the road.
const PLACES = {
  hills: { world: 'hills', s: 5000 },
  meadow: { world: 'hills', s: 5055, still: true, eye: { side: -9, up: 1.7, back: 18 } },
  wood: { world: 'hills', s: 3600 },
  river: { world: 'river', s: 3600 },
  alpine: { world: 'alpine', s: 900 },
  coast: { world: 'coast', s: 900 },
};

// In the page: the car put on the road at s and run; the lens by it or put by
// hand (as tools/look.mjs does), the wind and the clouds' clock held still.
const PUT = (s, still = false, eye = null) => `
  const p = g.road.at(${s});
  if (!p) return { missing: true };
  g.autoMode = true;
  g.sCar = ${s};
  g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(${s}, 1.9) + 0.3);
  g.car.vx = ${still ? 0 : 22};
  g.setCamera('chase');
  g.chase.shake = { get value() { return 0; }, set value(v) {}, step() {}, reset() {} };
  g.chase.snapTo(g.car, g.car.y || 0);
  g.style.wind[0] = 1000;
  g.style.wind[1] = 400;
  g.atmosphere.uniforms.uTime.value = 100;
  for (let i = 0; i < 150; i++) { g.pilot.vMax = ${still ? 0 : 22}; g.update(1 / 60); }
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
`;

// In the page: a frame, drawn and returned as the canvas has it.
const DRAW = `
  const canvas = document.getElementById('view');
  const draw = () => { if (window.__eye) window.__eye(); g.render(); return canvas.toDataURL('image/png'); };
`;

// In the page: the mean colour (OKLab) of the ground within 40 m of the lens
// in the frame drawn as asked: the ground is what is the land's or the
// grass's depth in the picture of the whole scene (as tools/look.mjs sorts
// the pixels), the same pixels in each frame.
const COLOUR = (modes) => `
  ${DRAW}
  const THREE = await import('three');
  const { FullScreenQuad } = await import('./tools/vendor/postprocessing/Pass.js');
  const r = g.renderer, scene = g.scene, cam = g.camera;
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
  const read = async (url) => {
    const img = new Image(); img.src = url; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
    return cx.getImageData(0, 0, img.width, img.height);
  };
  // Without flowers, the last pass's and the grass's: they are not the same flowers.
  const flowersWere = g.style.now.flowers;
  g.style.now.flowers = 0;
  g.grass.flowers.mesh.visible = false;
  const frames = {};
  for (const m of ${JSON.stringify(modes)}) {
    g.grass.off = m === 'off';
    g.grass.uniforms.uLook.value.y = m === 'flat' ? 1 : 0;
    draw();
    frames[m] = await read(draw());
  }
  g.grass.off = false;
  g.grass.uniforms.uLook.value.y = 0;
  draw();
  g.style.now.flowers = flowersWere;
  g.grass.flowers.mesh.visible = true;
  const all = depthOf(null);
  const land = depthOf(new Set([g.terrain.group, g.grass.group]));
  const lf = Math.log2(1 + cam.far);
  const fw = frames[${JSON.stringify(modes[0])}].width, fh = frames[${JSON.stringify(modes[0])}].height;
  const ok = new Uint8Array(w * h);
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    if (land[i] !== 65535 && land[i] === all[i] && Math.pow(2, (land[i] / 65535) * lf) - 1 < 40) { ok[i] = 1; n++; }
  }
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lab = (R, G, B) => {
    const r1 = lin(R), g1 = lin(G), b1 = lin(B);
    const l = Math.cbrt(0.4122214708 * r1 + 0.5363325363 * g1 + 0.0514459929 * b1);
    const m = Math.cbrt(0.2119034982 * r1 + 0.6806995451 * g1 + 0.1073969566 * b1);
    const s = Math.cbrt(0.0883024619 * r1 + 0.2817188376 * g1 + 0.6299787005 * b1);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const mean = {};
  for (const m of ${JSON.stringify(modes)}) {
    const d = frames[m].data;
    let L = 0, A = 0, B = 0, c = 0;
    for (let i = 0; i < w * h; i++) {
      if (!ok[i]) continue;
      const x = Math.min(fw - 1, Math.floor((i % w + 0.5) * fw / w)), y = Math.min(fh - 1, Math.floor((Math.floor(i / w) + 0.5) * fh / h));
      const o = (y * fw + x) * 4;
      const v = lab(d[o], d[o + 1], d[o + 2]);
      L += v[0]; A += v[1]; B += v[2]; c++;
    }
    mean[m] = [L / c, A / c, B / c, c];
  }
  rt.depthTexture.dispose(); rt.dispose(); enc.dispose(); quad.dispose();
  return { mean, n };
`;

// In the page: the ground map read back: for points of it, where it grows
// grass, its height against the game's, and the share of grass on the road's
// platform and under water.
const MAP = `
  ${DRAW}
  const THREE = await import('three');
  const { FullScreenQuad } = await import('./tools/vendor/postprocessing/Pass.js');
  draw(); draw();
  const r = g.renderer;
  const rtG = g.grass.rt;
  if (!rtG) return { error: 'no map' };
  const N = rtG.width;
  const mk = (frag, tex) => new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { t: { value: tex } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'precision highp float; uniform sampler2D t; varying vec2 vUv; void main() { ' + frag + ' }',
    depthTest: false, depthWrite: false }));
  const enc = new THREE.WebGLRenderTarget(N, N);
  const read = (quad) => {
    r.setRenderTarget(enc); quad.render(r);
    const b = new Uint8Array(N * N * 4); r.readRenderTargetPixels(enc, 0, 0, N, N, b); r.setRenderTarget(null); return b;
  };
  const bd = read(mk('float d = texture2D(t, vUv).r; float a = floor(d * 65535.0 + 0.5); gl_FragColor = vec4(mod(a, 256.0) / 255.0, floor(a / 256.0) / 255.0, 0.0, 1.0);', rtG.depthTexture));
  const ba = read(mk('float a = texture2D(t, vUv).a; gl_FragColor = vec4(a, a, a, 1.0);', rtG.texture));
  const R = g.grass.uniforms.uMapRect.value, NF = g.grass.uniforms.uMapNF.value;
  const o = g.road.origin;
  const halfFlat = (await import('./src/world/road.js')).HALF_FLAT;
  const errs = [], plat = [], wet = [];
  let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let tries = 0, platN = 0, wetN = 0;
  while ((errs.length < 500 || platN < 300) && tries < 40000) {
    tries++;
    const i = 8 + Math.floor(rnd() * (N - 16)), j = 8 + Math.floor(rnd() * (N - 16));
    const x = R.x + (i + 0.5) / N * R.z, z = R.y - (j + 0.5) / N * R.z;
    const k = (j * N + i) * 4;
    const d = (bd[k] | (bd[k + 1] << 8)) / 65535;
    const y = R.w - (NF.x + d * (NF.y - NF.x));
    const share = ba[k];
    if (share > 25 && errs.length < 500) errs.push(y - g.groundAt(x, z));
    const near = g.road.nearestS(x, z, g.sCar, 260);
    if (near.dist < halfFlat) { plat.push(share); platN++; }
    const wl = g.land.waterLevel(x + o.x, z + o.z);
    if (wl > -1000 && y < wl + 0.1) { wet.push(share); wetN++; }
  }
  enc.dispose();
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  return { n: errs.length, p95: abs[Math.floor(abs.length * 0.95)], max: abs[abs.length - 1],
    platform: { n: plat.length, max: plat.length ? Math.max(...plat) : 0 }, water: { n: wet.length, max: wet.length ? Math.max(...wet) : 0 } };
`;

// Names of parts (places, night, nograss, tiers, border) to run, none for all.
const only = process.argv.slice(2);
const want = (name) => !only.length || only.includes(name);
const failures = [];
function check(ok, text) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failures.push(text);
}
const f4 = (v) => (typeof v === 'number' ? v.toFixed(4) : String(v));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const server = serve();
try {
  if (!(await waitForServer())) throw new Error('the dev server did not come up');

  // The map is the ground, at six places, and the blades stand on it.
  let lastWorld = null;
  let page = null;
  for (const [name, pl] of want('places') ? Object.entries(PLACES) : []) {
    if (pl.world !== lastWorld) {
      if (page) page.close();
      page = await openPage(`seed=7&world=${pl.world}&s=${pl.s}&cam=chase&style=paint&run=60`);
      lastWorld = pl.world;
    }
    await page.run(`${PUT(pl.s, !!pl.still, pl.eye || null)} return 1;`);
    const c = await page.run(COLOUR(['off', 'flat']));
    check(!c.error && dist(c.mean.off, c.mean.flat) <= 0.004,
      `${name}: the ground near the lens is the same colour with the blades flat and with no grass (${c.error || f4(dist(c.mean.off, c.mean.flat))}, ${c.n} pixels)`);
    const m = await page.run(MAP);
    check(!m.error && m.n >= 400 && m.p95 <= 0.15, `${name}: the map's height is the ground's (95th percentile ${m.error || f4(m.p95)} m over ${m.n} points, largest ${f4(m.max)})`);
    check(!m.error && m.platform.max === 0, `${name}: no grass on the road's platform (${m.platform && m.platform.n} points, share at most ${m.platform && m.platform.max}/255)`);
    check(!m.error && m.water.max === 0, `${name}: no grass under water (${m.water && m.water.n} points, share at most ${m.water && m.water.max}/255)`);
  }

  // The same frame twice; the first frame after the car is put down.
  if (want('places')) {
  const same = await page.run(`${PUT(900)}${DRAW}
    const a = draw();
    const here = g.post.stylePass.uniforms.uGrassHere.value;
    const b = draw();
    const c = draw();
    return { ab: a === b, bc: b === c, groundMap: !!g.grass.rt, here };`);
  check(same.ab && same.bc && same.groundMap, `the first frame after the car is put down is the frame after it, and the one after that`);
  check(same.here > 0, `the flowers the last pass lays on the ground are given way from the first frame (grass here ${same.here})`);
  page.close();
  }

  // At night, with the car's lights on the ground.
  if (want('night')) {
  const night = await openPage('seed=7&world=hills&s=5000&cam=chase&style=paint&run=60');
  try {
    await night.run(`${PUT(5000)} return 1;`);
    const r = await night.run(`
      (await import('./src/render/atmosphere.js')).atmo.uEnvScale.value = 0.02;
      g.atmosphere.sun.intensity = 0;
      g.atmosphere.hemi.intensity = 0.02;
      g.headlight.intensity = 2000;
      ${COLOUR(['off', 'flat'])}`);
    check(!r.error && dist(r.mean.off, r.mean.flat) <= 0.006, `at night, the ground in the car's lights is the same colour with the blades flat and with no grass (${r.error || f4(dist(r.mean.off, r.mean.flat))}, ${r.n} pixels)`);
  } finally {
    night.close();
  }
  }

  // The worlds with no grass draw nothing for it.
  for (const world of !want('nograss') ? [] : ['city', 'cavern', 'inferno', 'abyss', 'space', 'upside']) {
    const p = await openPage(`seed=7&world=${world}&cam=chase&style=paint&run=60`);
    try {
      const r = await p.run(`
        const rr = g.renderer;
        const render = rr.render.bind(rr);
        let eye = 0;
        rr.render = (sc, cam) => { if (cam === g.grass.eye) eye++; render(sc, cam); };
        g.render();
        g.grass.off = false;
        g.render();
        const on = rr.info.render.calls;
        g.grass.off = true;
        g.render();
        const off = rr.info.render.calls;
        g.grass.off = false;
        rr.render = render;
        return { on, off, eye, active: g.grass.active, visible: g.grass.group.visible };`);
      check(!r.error && r.on === r.off && !r.active && !r.visible && r.eye === 0, `${world}: no map drawn and no blades (${r.on} draws, ${r.off} with no grass, ${r.eye} passes from above)`);
    } finally {
      p.close();
    }
  }

  // The tiers.
  if (want('tiers')) {
  const high = await openPage('seed=7&world=hills&s=5000&cam=chase&style=paint&run=30&tier=high');
  let blades = 0;
  try {
    blades = (await high.run('g.render(); return g.grass.stats.blades;'));
  } finally {
    high.close();
  }
  const mid = await openPage('seed=7&world=hills&s=5000&cam=chase&style=paint&run=30&tier=mid');
  try {
    const r = await mid.run('g.render(); return { blades: g.grass.stats.blades, triangles: g.grass.stats.triangles, texels: g.grass.rt && g.grass.rt.width };');
    check(r.texels === 192 && r.blades >= blades * 0.5 && r.blades <= blades * 0.7 && r.triangles <= 130000,
      `the middle tier has ${r.blades} of the ${blades} blades and ${r.triangles} triangles of grass and flowers (at most 130000), and a map ${r.texels} texels across`);
  } finally {
    mid.close();
  }
  const low = await openPage('seed=7&world=hills&s=5000&cam=chase&style=paint&run=30&tier=low');
  try {
    const r = await low.run(`
      g.render();
      const u = g.post.stylePass.uniforms;
      return { active: g.grass.active, map: !!g.grass.rt, visible: g.grass.group.visible, flowers: u.uFlowers.value, here: u.uGrassHere.value };`);
    check(!r.error && !r.active && !r.map && !r.visible && r.flowers > 0 && r.here === 0, `the low tier draws no blades and no map, and the last pass keeps its flowers (${r.flowers} of them)`);
  } finally {
    low.close();
  }
  }

  // Across a border to the desert.
  if (want('border')) {
  const bord = await openPage('seed=7&world=hills&loop=hills,desert&worldlen=3000&cam=chase&style=paint&run=60');
  try {
    const shares = await bord.run(`
      ${DRAW}
      const THREE = await import('three');
      const out = [];
      for (let s = 400; s < 3600; s += 100) {
        const p = g.road.at(s);
        if (!p) break;
        g.sCar = s;
        g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(s, 1.9) + 0.3);
        g.car.vx = 22;
        g.setCamera('chase');
        g.chase.snapTo(g.car, g.car.y || 0);
        for (let i = 0; i < 40; i++) g.update(1 / 60);
        draw(); draw();
        if (!g.grass.rt) { out.push([s, 0]); continue; }
        const rtG = g.grass.rt, N = rtG.width, r = g.renderer;
        const buf = new Uint16Array(N * N * 4);
        const enc = new THREE.WebGLRenderTarget(N, N, { type: THREE.HalfFloatType });
        const { FullScreenQuad } = await import('./tools/vendor/postprocessing/Pass.js');
        const q = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { t: { value: rtG.texture } }, vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: 'precision highp float; uniform sampler2D t; varying vec2 vUv; void main() { float a = texture2D(t, vUv).a; gl_FragColor = vec4(a, a, a, 1.0); }', depthTest: false, depthWrite: false }));
        const rg = new THREE.WebGLRenderTarget(N, N);
        r.setRenderTarget(rg); q.render(r);
        const b = new Uint8Array(N * N * 4); r.readRenderTargetPixels(rg, 0, 0, N, N, b); r.setRenderTarget(null);
        const al = []; for (let k = 0; k < N * N; k++) al.push(b[k * 4]);
        al.sort((x, y) => x - y);
        out.push([s, al[Math.floor(al.length * 0.9)] / 255]);
        enc.dispose(); rg.dispose(); q.dispose();
      }
      return out;`);
    const v = Array.isArray(shares) ? shares : [];
    console.log('     ' + v.map((x) => `${x[0]}:${x[1].toFixed(2)}`).join(' '));
    let up = 0;
    let drop = 0;
    for (let i = 1; i < v.length; i++) {
      up = Math.max(up, v[i][1] - v[i - 1][1]);
      if (v[i - 1][1] > 0.05) drop = Math.max(drop, 1 - v[i][1] / v[i - 1][1]);
    }
    check(v.length >= 20 && up <= 0.04 && drop < 0.5 && v[v.length - 1][1] < v[0][1] * 0.5,
      `the grass thins out across the border: share of the ground ${v.slice(0, 1).map((x) => f4(x[1]))} to ${v.slice(-1).map((x) => f4(x[1]))} in ${v.length} steps, never more by ${f4(up)}, at most ${f4(drop)} less in a step`);
  } finally {
    bord.close();
  }
  }
} finally {
  server.kill();
}

if (failures.length) {
  console.error(`\nFAILED: ${failures.length} check(s)`);
  process.exit(1);
}
console.log('\nOK');
