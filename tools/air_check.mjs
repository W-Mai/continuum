// The real style's air and clouds: the tile of cirrus, the light shafts, the drifts of the haze, drawn
// and left out of the same frames.
//
// In node, before any page:
//  - the tile of cirrus (world/cirrus.js) is the same bytes drawn twice, 1024 by 256, takes the processor
//    under 150 ms (a worker draws it), repeats without a seam either way, and is thin cloud: a third of it
//    has some in it, a tenth is thick;
//  - the shafts take 24 taps along a ray at the high tier, 12 at the middle one and none at the low, from a
//    target a quarter of the frame's size each way, and lay a quarter of their light;
//  - the haze's drifts are read at points of the world (the floating origin and the lens's place), not of the screen.
//
// In the real page, headless (seed 7, the hills, the high tier):
//  - with the lens turned away from the sun the shafts draw nothing and the frame is the one with them held
//    off, pixel for pixel; turned to it they take three draws and lay light on the frame, on the whole not
//    in the near land and the car, never taking light off it, on a target of a quarter of the frame's size;
//  - they come and go smoothly as the lens turns from the sun: no step of more than a fifth of the most they are in
//    3 degrees, and no more of them the further the sun is from the middle of the frame;
//  - the tiers: 12 taps at the middle one, none at the low; the other six styles do not have them and are
//    the same with them held off and not, pixel for pixel;
//  - the cirrus: the tile is in hand (one texture, with its mips), the style says how much of it there is, the low
//    tier asks for none;
//  - the haze's drifts: with them off and on the same frame is the same in the sky and within 100 m and
//    different in the far land, by as much lighter as darker, smoothly (the drifts are hundreds of metres across);
//  - a second shaft pass and a second cirrus, made, drawn and disposed, leave no texture behind and no error.
// Times are written, not asserted (the machine is shared).
//
// Usage: node tools/air_check.mjs [--node-only] [--gpu] [--keep out/air]
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const GPU = args.includes('--gpu');
const NODE_ONLY = args.includes('--node-only');
const KEEP = opt('--keep', null);

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8209;
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
  const profile = `${tmpdir()}/continuum-air-${process.pid}-${Date.now()}`;
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
      logs.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
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

// In the page: the car put on the road at s and run for two and a half seconds, in the real style, as
// tools/look.mjs puts it down; the lens behind it, still.
const PLACE = (s) => `
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

// In the page, with the place set: the frames and the numbers. The animals and the other cars are
// put away before each frame (the page's own update shows them again).
const MEASURE = (keep) => `
  const THREE = await import('three');
  const { FullScreenQuad } = await import('./tools/vendor/postprocessing/Pass.js');
  const { ShaftPass } = await import('./src/render/shafts.js');
  const { Cirrus } = await import('./src/render/cirrus.js');
  const { atmo } = await import('./src/render/atmosphere.js');
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
  const frame = () => {
    for (const o of hidden) o.visible = false;
    g.render();
  };
  // A frame is two drawn and the second read, and the draws are counted over the two: what the page does every other
  // frame (the shadow map of the far land is made on the alternate ones) is in each of them the same.
  const grab = () => {
    frame();
    frame();
    const px = new Uint8Array(N * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  let lastCalls = 0;
  const grabCalls = () => {
    frame();
    const first = r.info.render.calls;
    frame();
    lastCalls = first + r.info.render.calls;
  };
  const sh = g.post.shafts;
  const cam = g.camera;
  const sun = g.atmosphere.sunDir;
  const luma = (a, i) => 0.2126 * a[i * 4] + 0.7152 * a[i * 4 + 1] + 0.0722 * a[i * 4 + 2];
  const out = { size: [W, H] };
  // Which program draws the sky: the real style by day draws the plain sky's program that has the baked clouds in it.
  {
    const a = g.atmosphere;
    out.dome = { pure: a.sky.material === a.skyPlainPure, heaps: a.sky.material === a.skyPlainHeaps, plain: a.sky.material === a.skyPlain };
  }

  // The lens put behind the car, on the line away from the sun, turned deg degrees round from the sun's
  // azimuth and rise degrees up (tools/look.mjs's sun shot is aim(0, 4.5)).
  const aim = (deg, rise) => {
    const h = Math.hypot(sun.x, sun.z);
    const hx = sun.x / h;
    const hz = sun.z / h;
    const x = g.car.x - hx * 14;
    const z = g.car.z - hz * 14;
    const y = g.groundAt(x, z) + 2.4;
    const yaw = Math.atan2(hz, hx) + deg * Math.PI / 180;
    const up = rise * Math.PI / 180;
    cam.position.set(x, y, z);
    cam.up.set(0, 1, 0);
    cam.lookAt(x + Math.cos(yaw) * Math.cos(up), y + Math.sin(up), z + Math.sin(yaw) * Math.cos(up));
    cam.updateMatrixWorld();
  };
  const differ = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };

  // The state the page has them in: on, at the high tier, in the real style.
  out.enabled = sh.enabled;
  out.tier = g.tier;
  out.style = g.style.id;
  out.shafts = g.style.now.shafts;
  out.built = sh.built;

  // Turned away from the sun: nothing is drawn.
  aim(180, 4.5);
  sh.off = true;
  const awayOff = grab();
  grabCalls();
  const callsAwayOff = lastCalls;
  sh.off = false;
  const awayOn = grab();
  grabCalls();
  out.away = { draws: sh.draws, shown: sh.shown, differ: differ(awayOff, awayOn), calls: lastCalls - callsAwayOff };

  // Turned to it: three draws, and light laid on the frame.
  aim(0, 4.5);
  sh.off = true;
  const off = grab();
  grabCalls();
  const callsOff = lastCalls;
  const programsOff = r.info.programs.length;
  const texturesOff = r.info.memory.textures;
  sh.off = false;
  const on = grab();
  grabCalls();
  out.toward = { draws: sh.draws, shown: sh.shown, calls: lastCalls - callsOff, programs: r.info.programs.length - programsOff, textures: r.info.memory.textures - texturesOff };
  out.targets = { source: [sh.source.width, sh.source.height], rays: [sh.rays.width, sh.rays.height], taps: sh.uniforms.uTaps.value, bytes: sh.targetBytes };
  {
    const again = grab();
    out.steady = differ(on, again);
  }
  // Where the sun is in the frame, and what the shafts add: over the pixels that are sky (the depth is the far plane's),
  // the mean of their light on the frame and the most; over those that are the car and the near land, none of the
  // frame's light is taken, and the share lightened is small.
  {
    const t = g.post.tap.target;
    const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false });
    const material = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: t.depthTexture }, uNF: { value: new THREE.Vector2(cam.near, cam.far) } },
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: [
        'uniform sampler2D tDepth; uniform vec2 uNF;',
        'void main() {',
        '  float d = texelFetch(tDepth, ivec2(gl_FragCoord.xy), 0).r;',
        '  float z = uNF.x * uNF.y / (uNF.y - d * (uNF.y - uNF.x));',
        '  float v = d >= 0.999995 ? 1.0 : clamp(log2(1.0 + z) / log2(1.0 + uNF.y), 0.0, 0.99998);',
        '  float a = floor(v * 65535.0 + 0.5);',
        '  gl_FragColor = vec4(mod(a, 256.0) / 255.0, floor(a / 256.0) / 255.0, 0.0, 1.0);',
        '}'].join('\\n'),
      depthTest: false, depthWrite: false,
    });
    const distance = () => {
      r.setRenderTarget(rt);
      new FullScreenQuad(material).render(r);
      const buf = new Uint8Array(N * 4);
      r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      r.setRenderTarget(null);
      const z = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const a = buf[i * 4] | (buf[i * 4 + 1] << 8);
        z[i] = a === 65535 ? Infinity : Math.pow(2, (a / 65535) * Math.log2(1 + cam.far)) - 1;
      }
      return z;
    };
    sh.off = true;
    frame();
    const z = distance();
    sh.off = false;
    let skyN = 0, skySum = 0, skyMax = 0, darker = 0, lighter = 0, nearN = 0, nearLighter = 0, nearDarker = 0, nearSum = 0;
    for (let i = 0; i < N; i++) {
      const d = luma(on, i) - luma(off, i);
      if (d < -3) darker++;
      if (d > 0.5) lighter++;
      if (z[i] === Infinity) {
        skyN++;
        skySum += d;
        if (d > skyMax) skyMax = d;
      } else if (z[i] < 100) {
        nearN++;
        nearSum += d;
        if (d > 0.5) nearLighter++;
        if (d < -3) nearDarker++;
      }
    }
    out.added = { skyN, skyMean: skySum / Math.max(1, skyN), skyMax, darker: darker / N, lighter: lighter / N, nearN, nearMean: nearSum / Math.max(1, nearN), nearLighter: nearLighter / Math.max(1, nearN), nearDarker: nearDarker / Math.max(1, nearN) };
    rt.dispose();
    material.dispose();
  }

  // The fade: the lens turned from the sun a few degrees at a time, how much of the shafts the sun's place gives.
  {
    const at = new THREE.Vector2();
    const run = (rise) => {
      const k = [];
      for (let deg = 0; deg <= 180; deg += 3) {
        aim(deg, rise);
        k.push(sh.where(at));
      }
      return k;
    };
    out.fade = { level: run(4.5), up: run(20) };
  }

  // The tiers: the middle one looks along twelve taps, the low one draws nothing.
  {
    aim(0, 4.5);
    g.setTier('mid');
    g.post.setStyle(g.style);
    frame();
    out.mid = { enabled: sh.enabled, taps: sh.uniforms.uTaps.value, draws: sh.draws, soft: g.atmosphere.uniforms.uCloudSoft.value };
    g.setTier('low');
    g.post.setStyle(g.style);
    frame();
    out.low = { enabled: sh.enabled, draws: sh.draws, soft: g.atmosphere.uniforms.uCloudSoft.value, cirrusWanted: g.atmosphere.cirrusWanted() };
    g.setTier('high');
    g.post.setStyle(g.style);
    frame();
    out.high = { enabled: sh.enabled, taps: sh.uniforms.uTaps.value, draws: sh.draws, soft: g.atmosphere.uniforms.uCloudSoft.value, cirrusWanted: g.atmosphere.cirrusWanted() };
  }

  // The other styles do not have them: the same with the shafts held off and not.
  out.styles = {};
  const was = g.style.id;
  for (const id of ['paint', 'ink', 'cel', 'print', 'pixel', 'block']) {
    g.style.set(id, true);
    g.style.applyScene();
    g.atmosphere.bakeEnvironment();
    aim(0, 4.5);
    grab();
    sh.off = true;
    const a = grab();
    sh.off = false;
    const b = grab();
    out.styles[id] = { differ: differ(a, b), enabled: sh.enabled, draws: sh.draws, cirrus: g.atmosphere.uniforms.uCirrus.value, real: g.atmosphere.uniforms.uCloudReal.value };
  }
  g.style.set(was, true);
  g.style.applyScene();
  g.atmosphere.bakeEnvironment();
  g.post.setStyle(g.style);

  // The cirrus.
  {
    const c = g.atmosphere.cirrus;
    out.cirrus = { held: c.held, size: c.texture ? [c.texture.image.width, c.texture.image.height] : null, bytes: c.bytes,
      style: g.atmosphere.uniforms.uCirrus.value, onPage: c.page, ms: c.ms, real: g.atmosphere.uniforms.uCloudReal.value };
  }

  // The drifts of the haze: the same frame, the lens as the car's own, with them off and on.
  {
    g.setCamera('chase');
    g.chase.snapTo(g.car, g.car.y || 0);
    g.update(0);
    const t = g.post.tap;
    const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false });
    const material = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: null }, uNF: { value: new THREE.Vector2(cam.near, cam.far) } },
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: [
        'uniform sampler2D tDepth; uniform vec2 uNF;',
        'void main() {',
        '  float d = texelFetch(tDepth, ivec2(gl_FragCoord.xy), 0).r;',
        '  float z = uNF.x * uNF.y / (uNF.y - d * (uNF.y - uNF.x));',
        '  float v = d >= 0.999995 ? 1.0 : clamp(log2(1.0 + z) / log2(1.0 + uNF.y), 0.0, 0.99998);',
        '  float a = floor(v * 65535.0 + 0.5);',
        '  gl_FragColor = vec4(mod(a, 256.0) / 255.0, floor(a / 256.0) / 255.0, 0.0, 1.0);',
        '}'].join('\\n'),
      depthTest: false, depthWrite: false,
    });
    const var0 = atmo.uFogVar.value;
    out.fog = { var: var0 };
    atmo.uFogVar.value = 0;
    const plain = grab();
    material.uniforms.tDepth.value = t.target.depthTexture;
    r.setRenderTarget(rt);
    new FullScreenQuad(material).render(r);
    const buf = new Uint8Array(N * 4);
    r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    r.setRenderTarget(null);
    atmo.uFogVar.value = var0;
    const drifted = grab();
    const z = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = buf[i * 4] | (buf[i * 4 + 1] << 8);
      z[i] = a === 65535 ? Infinity : Math.pow(2, (a / 65535) * Math.log2(1 + cam.far)) - 1;
    }
    let sky = 0, near = 0, skyN = 0, nearN = 0, farN = 0, farSum = 0, farAbs = 0, lighter = 0, darker = 0;
    const diff = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const d = luma(drifted, i) - luma(plain, i);
      diff[i] = d;
      if (z[i] === Infinity) { skyN++; if (Math.abs(d) > 0.5) sky++; }
      else if (z[i] < 100) { nearN++; if (Math.abs(d) > 0.5) near++; }
      else if (z[i] > 400) {
        farN++;
        farSum += d;
        farAbs += Math.abs(d);
        if (d > 0.5) lighter++;
        if (d < -0.5) darker++;
      }
    }
    // Smooth: the change at a pixel is near the change twelve pixels along, over what is far land at both.
    let both = 0, close = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x + 12 < W; x += 3) {
        const i = y * W + x;
        const j = i + 12;
        if (z[i] > 400 && z[i] < Infinity && z[j] > 400 && z[j] < Infinity) {
          both++;
          if (Math.abs(diff[i] - diff[j]) < 3) close++;
        }
      }
    }
    out.fog = { var: var0, sky, near, skyN, nearN, farN, farMean: farSum / Math.max(1, farN), farAbs: farAbs / Math.max(1, farN), lighter: lighter / Math.max(1, farN), darker: darker / Math.max(1, farN), smooth: close / Math.max(1, both) };
    rt.dispose();
    material.dispose();
  }

  // The time: frames alternately without the shafts and with them, the lens to the sun (here, with the page as it was made).
  {
    aim(0, 4.5);
    const times = { off: [], on: [] };
    const px1 = new Uint8Array(4);
    for (let i = 0; i < ${GPU ? 40 : 5}; i++) {
      for (const k of ['off', 'on']) {
        sh.off = k === 'off';
        const t0 = performance.now();
        frame();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
        times[k].push(performance.now() - t0);
      }
    }
    sh.off = false;
    const med = (v) => v.slice().sort((a, b) => a - b)[v.length >> 1];
    out.ms = { off: med(times.off), on: med(times.on) };
  }

  // A second shaft pass and a second cirrus: made, drawn once, disposed.
  {
    while (gl.getError() !== gl.NO_ERROR) { /* the page's own, before this */ }
    aim(0, 4.5);
    frame();
    const tex = r.info.memory.textures;
    const geo = r.info.memory.geometries;
    const two = new ShaftPass(r, g.post.tap, cam);
    two.setSize(W, H);
    two.sunDir.copy(sun);
    two.set(1, 'high', true);
    two.render(r, null, g.post.tap.target);
    const cirrus = new Cirrus();
    cirrus.make();
    r.initTexture(cirrus.texture);
    const made = r.info.memory.textures - tex;
    const drawn = two.draws;
    two.dispose();
    cirrus.dispose();
    out.second = { made, drawn, texturesAfter: r.info.memory.textures - tex, geometriesAfter: r.info.memory.geometries - geo, errors: [] };
    let e;
    while ((e = gl.getError()) !== gl.NO_ERROR) out.second.errors.push(e);
  }

  // The programs the page has built, the sky's told apart by what they are defined with.
  {
    const keys = r.info.programs.map((p) => p.cacheKey);
    const sky = {};
    for (const k of keys) {
      const d = k.match(/SKY_[A-Z]+/g);
      if (d) sky[d.join('+')] = (sky[d.join('+')] || 0) + 1;
    }
    out.programs = { all: keys.length, sky };
  }

  if (${keep ? 'true' : 'false'}) {
    const pic = (fill) => {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const x = c.getContext('2d');
      const im = x.createImageData(W, H);
      for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
        const s = (H - 1 - yy) * W + xx, o = (yy * W + xx) * 4;
        const v = fill(s);
        im.data[o] = v[0]; im.data[o + 1] = v[1]; im.data[o + 2] = v[2]; im.data[o + 3] = 255;
      }
      x.putImageData(im, 0, 0);
      return c.toDataURL('image/png');
    };
    out.pictures = {
      off: pic((i) => [off[i * 4], off[i * 4 + 1], off[i * 4 + 2]]),
      on: pic((i) => [on[i * 4], on[i * 4 + 1], on[i * 4 + 2]]),
      added: pic((i) => { const v = Math.max(0, Math.min(255, (luma(on, i) - luma(off, i)) * 8)); return [v, v, v]; }),
    };
  }
  while (gl.getError() !== gl.NO_ERROR) { /* none left for the next */ }
  return out;
`;

// The modules, in node: three is the copy the page has.
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s, c, n) { return s === 'three' ? { url: ${JSON.stringify(new URL('./vendor/three.module.js', import.meta.url).href)}, shortCircuit: true } : n(s, c); }`,
));
const THREE = await import('three');
const { SHAFTS, SHAFT_SHADERS } = await import('../src/render/shafts.js');
await import('../src/render/atmosphere.js');
const { bakeCirrus, CIRRUS, CIRRUS_BYTES } = await import('../src/world/cirrus.js');

let failed = 0;
const check = (ok, text) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};
const pc = (v, k = 2) => `${(v * 100).toFixed(k)}%`;
const f3 = (v) => (typeof v === 'number' ? +v.toFixed(3) : v);

// --- in node: the tile of cirrus ---------------------------------------------------------
{
  // The processor's time of this thread (not the machine's other threads, nor a loaded machine's clock).
  const cpu = () => {
    const u = (process.threadCpuUsage || process.cpuUsage)();
    return (u.user + u.system) / 1000;
  };
  const t0 = cpu();
  const a = bakeCirrus();
  const ms = cpu() - t0;
  const b = bakeCirrus();
  const same = a.length === b.length && a.every((v, i) => v === b[i]);
  const { width: w, height: h } = CIRRUS;
  let sum = 0;
  let some = 0;
  let thick = 0;
  for (const v of a) {
    sum += v;
    if (v > 25) some++;
    if (v > 128) thick++;
  }
  // The step across the edge it wraps at against the steps inside it, along the streaks and across them.
  let seamU = 0;
  let inU = 0;
  for (let j = 0; j < h; j++) {
    seamU += Math.abs(a[j * w + w - 1] - a[j * w]);
    for (let i = 0; i < w - 1; i++) inU += Math.abs(a[j * w + i] - a[j * w + i + 1]);
  }
  seamU /= h;
  inU /= h * (w - 1);
  let seamV = 0;
  let inV = 0;
  for (let i = 0; i < w; i++) {
    seamV += Math.abs(a[(h - 1) * w + i] - a[i]);
    for (let j = 0; j < h - 1; j++) inV += Math.abs(a[j * w + i] - a[(j + 1) * w + i]);
  }
  seamV /= w;
  inV /= (h - 1) * w;
  check(a.length === CIRRUS_BYTES && w === 1024 && h === 256 && same && ms < 150,
    `the tile of cirrus is ${w} x ${h} bytes (${(a.length / 1000).toFixed(0)} kB, ${(CIRRUS_BYTES * 4 / 3 / 1000).toFixed(0)} kB with its mips), the same drawn twice, ${ms.toFixed(0)} ms of the processor (under 150)`);
  check(seamU <= 1.25 * inU + 0.3 && seamV <= 1.5 * inV + 0.3,
    `it repeats without a seam: the step across the edge it wraps at is ${seamU.toFixed(2)} along the streaks against ${inU.toFixed(2)} inside, ${seamV.toFixed(2)} across them against ${inV.toFixed(2)}`);
  check(some / a.length > 0.25 && some / a.length < 0.5 && thick / a.length > 0.08 && thick / a.length < 0.3 && sum / a.length / 255 > 0.12 && sum / a.length / 255 < 0.3,
    `it is thin cloud: ${pc(some / a.length, 1)} of it has some in it (25-50%), ${pc(thick / a.length, 1)} is thick (8-30%), a mean of ${pc(sum / a.length / 255, 1)}`);
}

// --- in node: the shafts and the haze's drifts -----------------------------------------------
check(SHAFTS.taps.high === 24 && SHAFTS.taps.mid === 12 && SHAFTS.taps.low === 0 && SHAFTS.strength === 0.25
  && /uniform int uTaps;/.test(SHAFT_SHADERS.rays) && /i >= uTaps/.test(SHAFT_SHADERS.rays),
  `the shafts' taps along a ray: ${SHAFTS.taps.high} at the high tier, ${SHAFTS.taps.mid} at the middle one, ${SHAFTS.taps.low} at the low; a quarter (${SHAFTS.strength}) of their light is laid on the frame`);
check(SHAFTS.reach[0] < SHAFTS.reach[1] && SHAFTS.reach[1] <= 100 && SHAFTS.out[0] < SHAFTS.out[1] && SHAFTS.decay < 1 && SHAFTS.density < 1 && SHAFTS.airK[0] < 1 && SHAFTS.airK[1] > 1,
  `all of them while the sun is within ${SHAFTS.reach[0]} degrees of the lens's axis, none by ${SHAFTS.reach[1]} (or ${SHAFTS.out[1]} half frames out of the frame); each tap ${pc(1 - SHAFTS.decay, 1)} less than the one before; the haze moves them from ${SHAFTS.airK[0]} to ${SHAFTS.airK[1]} times; a ray goes ${SHAFTS.length} frame heights at most`);
check(/jitter/.test(SHAFT_SHADERS.rays) && /uCamWorld/.test(SHAFT_SHADERS.rays) && !/gl_FragCoord[^;]*(pcg3d|jitter)/.test(SHAFT_SHADERS.rays),
  'the taps of a ray start a little way along by a number from where the texel looks in the world (not from where it is on the screen)');
{
  const vs = THREE.ShaderChunk.fog_vertex;
  const fs = THREE.ShaderChunk.fog_fragment;
  const drift = vs.slice(vs.indexOf('vFogK = 1.0'), vs.indexOf('#ifdef FOLD_ALPHA'));
  check(/uFogOrg/.test(drift) && /cameraPosition/.test(drift) && /vFogWorld/.test(drift) && !/gl_FragCoord|vUv|gl_Position/.test(drift) && /vFogK/.test(fs),
    'the haze\'s drifts are read at points of the world (the lens\'s place, the origin, the vertex), not of the screen, and thicken the haze by the fragment\'s own varying');
}

// --- in node: the haze's noise, worked out as the fog chunk works it out ---------------------------
{
  const fract = (v) => v - Math.floor(v);
  const cell = (px, py) => {
    let qx = fract(px * 0.1031);
    let qy = fract(py * 0.1031);
    let qz = fract(px * 0.1031);
    const d = qx * (qy + 33.33) + qy * (qz + 33.33) + qz * (qx + 33.33);
    qx += d;
    qy += d;
    qz += d;
    return fract((qx + qy) * qz);
  };
  const drift = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let fx = fract(x);
    let fy = fract(y);
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = cell(ix, iy) + (cell(ix + 1, iy) - cell(ix, iy)) * fx;
    const b = cell(ix, iy + 1) + (cell(ix + 1, iy + 1) - cell(ix, iy + 1)) * fx;
    return a + (b - a) * fy;
  };
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let j = 0; j < 400; j++) {
    for (let i = 0; i < 400; i++) {
      const v = 2 * drift(i * 0.37 + 1000, j * 0.37 + 1000) - 1;
      sum += v;
      sum2 += v * v;
      n++;
    }
  }
  const mean = sum / n;
  const sd = Math.sqrt(sum2 / n - mean * mean);
  check(Math.abs(mean) < 0.03 && sd > 0.2 && sd < 0.6,
    `the haze's noise (2n - 1, over 400 x 400 cells of 800 m): a mean of ${mean.toFixed(3)} and a spread of ${sd.toFixed(3)}, so a haze of fogVar 0.5 is thicker by half where the noise is high, thinner by half where it is low, and as thick as it was on the whole`);
}

if (NODE_ONLY) {
  console.log(failed ? `\n${failed} failed` : '\nall passed (in node only)');
  process.exit(failed ? 1 : 0);
}
const server = serve();
try {
  if (!(await waitForServer())) throw new Error('the server did not come up');
  // The one that answers is the one started here (a port another run has is not).
  const served = await (await fetch(`http://localhost:${PORT}/src/render/shafts.js`)).text();
  if (served !== readFileSync(ROOT + 'src/render/shafts.js', 'utf8')) throw new Error(`port ${PORT} is served by something else`);
  const page = await openPage('seed=7&world=hills&s=5000&cam=chase&style=real&run=60');
  try {
    const put = await page.run(PLACE(5000));
    if (put.error) throw new Error(`hills: ${put.error}`);
    const r = await page.run(MEASURE(!!KEEP));
    if (r.error) throw new Error(`hills: ${r.error}`);
    const [w, h] = r.size;
    const quarter = [Math.ceil(w / 4), Math.ceil(h / 4)];
    check(r.dome.pure !== r.dome.heaps && !r.dome.plain,
      `the real style's day sky is drawn with the program that has the baked clouds in it (${r.dome.pure ? 'the one with no other clouds' : 'the one that keeps the others\' code'}), not the one that works its clouds out for each pixel`);
    check(r.enabled && r.built && r.tier === 'high' && r.style === 'real' && r.shafts === 1,
      `the shafts are on in the real style at the high tier, their three programs built (style ${r.style}, tier ${r.tier})`);
    check(r.away.draws === 0 && r.away.shown === 0 && r.away.differ === 0 && r.away.calls === 0,
      `the lens turned away from the sun: ${r.away.draws} draws, ${r.away.calls} more than with them held off over two frames, ${r.away.differ} bytes of the frame differ`);
    check(r.toward.draws === 3 && r.toward.calls === 6 && r.toward.shown > 0.1 && r.toward.shown <= 0.25 * 1.45 && r.toward.programs === 0,
      `the lens to the sun: ${r.toward.draws} draws a frame (${r.toward.calls} more than with them held off over two frames), ${(r.toward.shown).toFixed(3)} of their light laid on the frame (a quarter of it in the thickest air, 0.55 of that in the clearest), ${r.toward.programs} programs built then`);
    const t = r.targets;
    check(JSON.stringify(t.source) === JSON.stringify(quarter) && JSON.stringify(t.rays) === JSON.stringify(quarter) && t.taps === 24 && r.toward.textures === 2,
      `two targets a quarter of the frame's size each way (${quarter[0]} x ${quarter[1]}, ${(2 * quarter[0] * quarter[1] / 1e6).toFixed(3)} M pixels, ${(t.bytes / 1000).toFixed(0)} kB), ${t.taps} taps, ${r.toward.textures} textures made when they are first drawn into`);
    check(r.steady === 0, `the same frame drawn twice is the same pixel for pixel (${r.steady} bytes differ)`);
    check(r.added.skyN > 1000 && r.added.skyMean > 0.3 && r.added.skyMax > 5 && r.added.darker < 0.002 && r.added.nearDarker < 0.002,
      `the shafts lay light on ${pc(r.added.lighter, 1)} of the frame: ${r.added.skyMean.toFixed(2)} of 255 on the sky on average (${r.added.skyN} pixels), up to ${r.added.skyMax.toFixed(0)}; within 100 m ${pc(r.added.nearLighter, 1)} of the pixels are lighter (${r.added.nearMean.toFixed(2)} on average); ${pc(r.added.darker, 3)} of the frame is darker by more than 3 (the last pass's edge and detail work moves a pixel on an edge by a level or two, either way)`);
    const steps = (k) => k.slice(1).map((v, i) => v - k[i]);
    const worst = (k) => Math.max(...steps(k).map(Math.abs));
    const falling = (k) => steps(k).every((s) => s <= 1e-9);
    const top = Math.max(...r.fade.level);
    check(top > 0.9 && worst(r.fade.level) < 0.2 * top && falling(r.fade.level) && r.fade.level[r.fade.level.length - 1] === 0
      && worst(r.fade.up) < 0.2 * Math.max(...r.fade.up, 1e-9) + 1e-9,
      `the lens turned from the sun, 3 degrees at a time: ${f3(top)} of their strength at most, the most it moves in a step ${f3(worst(r.fade.level))}, never up as the sun goes off, none behind the lens; looking up the most in a step is ${f3(worst(r.fade.up))}`);
    check(r.mid.enabled && r.mid.taps === 12 && r.mid.draws === 3 && r.mid.soft === 6 && !r.low.enabled && r.low.draws === 0 && r.low.soft === 0 && !r.low.cirrusWanted
      && r.high.enabled && r.high.taps === 24 && r.high.draws === 3 && r.high.soft === 12 && r.high.cirrusWanted,
      `the tiers: high ${r.high.taps} taps, ${r.high.soft} taps more for a heap's soft edge, cirrus; middle ${r.mid.taps} taps, ${r.mid.soft} more; low draws nothing (${r.low.draws}), has no soft edge (${r.low.soft}) and no cirrus (${r.low.cirrusWanted ? 'wanted' : 'not wanted'}) ${JSON.stringify([r.high, r.mid, r.low])}`);
    const others = Object.entries(r.styles);
    check(others.every(([, v]) => v.differ === 0 && !v.enabled && v.draws === 0 && v.cirrus === 0 && v.real === 0),
      `the other styles have none of it: held off or not ${others.map(([k, v]) => `${k} ${v.differ}`).join(', ')} bytes differ, no cirrus, no real clouds, no draws ${JSON.stringify(r.styles)}`);
    const c = r.cirrus;
    check(c.held && JSON.stringify(c.size) === '[1024,256]' && c.bytes < 400000 && c.style === 1 && c.real === 1,
      `the cirrus: the tile is in hand, ${c.size ? c.size.join(' x ') : 'none'} (${(c.bytes / 1000).toFixed(0)} kB with its mips), made ${c.onPage} time on the page in ${c.ms.toFixed(0)} ms, the real style has all of it (${c.style}) and its clouds (${c.real})`);
    const f = r.fog;
    check(f.var > 0 && f.skyN > 1000 && f.sky < 0.003 * f.skyN && f.nearN > 1000 && f.near < 0.003 * f.nearN && f.farN > 5000 && f.farAbs > 1 && f.farAbs < 12 && f.smooth > 0.8,
      `the haze's drifts (${f.var} thicker or thinner): none of them in the sky (${f.sky} of ${f.skyN} pixels differ, by what the last pass mixes in from the land at its edge) or within 100 m (${f.near} of ${f.nearN}); beyond 400 m (${f.farN} pixels) ${pc(f.lighter, 0)} are lighter and ${pc(f.darker, 0)} darker, ${f.farMean.toFixed(2)} of 255 on the whole where the lens is, ${f.farAbs.toFixed(2)} apart on average, ${pc(f.smooth, 0)} of the neighbours within 3 of each other`);
    check(r.second.made === 3 && r.second.drawn === 3 && r.second.texturesAfter === 0 && r.second.geometriesAfter === 0 && r.second.errors.length === 0,
      `a second pass and a second cirrus, made, drawn and disposed: ${r.second.made} textures made (two targets and the tile), ${r.second.texturesAfter} left, ${r.second.geometriesAfter} geometries left, ${r.second.errors.length} errors`);
    console.log(`     ${w}x${h}, ${r.ms.off.toFixed(1)} ms a frame without the shafts, ${r.ms.on.toFixed(1)} ms with them (${(r.ms.on / r.ms.off).toFixed(3)} times)`);
    console.log(`     ${r.programs.all} programs built, the sky's by what they are defined with: ${JSON.stringify(r.programs.sky)}`);
    if (KEEP && r.pictures) {
      mkdirSync(KEEP, { recursive: true });
      for (const [k, url] of Object.entries(r.pictures)) writeFileSync(`${KEEP}/sun-${k}.png`, Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64'));
    }
    if (page.logs.length) check(false, `the page logged errors: ${page.logs.slice(0, 2).join(' | ')}`);
  } finally {
    page.close();
  }
} finally {
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
// (Not process.exit: the timer that removes the last page's profile has to fire first.)
process.exitCode = failed ? 1 : 0;
