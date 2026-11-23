// The real style's ambient occlusion (render/ao.js), drawn and left out of the same frames.
//
// Runs the real page headless at four places (the hills, the wood, the city, the valley in
// haze), a page for each, in the real style at the high tier, and draws a frame with the occlusion
// held off (ao=0 in the address; in the page, post.ao.off) and with it on, the lens and the world as
// they were. It asserts:
//  - node, before any page: the tiers' taps (two directions of four taps each way at the high
//    tier, one at the middle, none at the low), the radius and the strength;
//  - the frame is darker where things crowd (the car's underside, the trees, the cutting), by a
//    few per cent on average and some tens at the darkest, and lighter in under a hundredth of the
//    pixels (where the last pass reads a darker neighbour; with that pass copying the frame, in none);
//    five draws and five programs more, and the targets the sizes they are said to be;
//  - not a pixel of the sky is different, and not one beyond 300 m (the occlusion is gone from 190 m,
//    a pixel beside the sky or beside what the bloom takes up is left alone, and the bloom takes up the
//    same pixels with it and without it), with the last pass (edges cleaned, detail sharpened) made to
//    copy the frame; with it on, the pixels that differ are those it mixes a neighbour's colour into,
//    within the 24 pixels its search along an edge reaches of the near land;
//  - what lights itself is not darkened: a lamp put on the road (a sphere of light, ten times
//    what the exposure takes to white) is the same pixel for pixel, while a grey ball in its place
//    is darker in its lower half, where it stands on the road;
//  - the noise is not fixed to the screen: the same frame with the lens turned 2.5 degrees,
//    and the darkening of the two correlated pixel for pixel over what is not a smooth stretch
//    of it, gives under 0.09 (a pattern laid on the screen over the same two, as a control, over 0.5), and
//    that fine detail, creases and noise together, is under 4% of the light;
//  - the tiers: the middle one, with its one direction, darkens as much as the high one to within half again; the low one draws nothing and
//    the frame is the one with the occlusion off, pixel for pixel;
//  - every other style is the same with it held off and not (pixel for pixel);
//  - a picture made by the photo mode has it too, at the frame's size and at twice that, as dark
//    on average as the frame on the screen;
//  - a second pass made, drawn and disposed leaves no texture or geometry behind and no error.
// Times are written, not asserted (the machine is shared).
//
// Usage: node tools/ao_check.mjs [--places hills,wood,city,valley] [--gpu] [--keep out/ao]
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const GPU = args.includes('--gpu');
const KEEP = opt('--keep', null);
const PLACES = {
  hills: { world: 'hills', s: 5000 },
  wood: { world: 'hills', s: 3600 },
  city: { world: 'city', s: 2200 },
  valley: { world: 'alpine', s: 5000 },
};
const places = opt('--places', 'hills,wood,city,valley').split(',');

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8208;
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
  const profile = `${tmpdir()}/continuum-ao-${process.pid}-${Date.now()}`;
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
  const { AoPass } = await import('./src/render/ao.js');
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
  const grab = () => {
    frame();
    const px = new Uint8Array(N * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const ao = g.post.ao;
  const cam = g.camera;
  const calls = () => r.info.render.calls;
  const out = { size: [W, H] };
  const luma = (a, i) => 0.2126 * a[i * 4] + 0.7152 * a[i * 4 + 1] + 0.0722 * a[i * 4 + 2];

  // The frame with the occlusion held off and on. (The programs are counted in between: they are built
  // the first time it is on.)
  ao.off = true;
  const off = grab();
  out.callsOff = calls();
  const programsOff = r.info.programs.length;
  const texturesOff = r.info.memory.textures;
  ao.off = false;
  const on = grab();
  out.callsOn = calls();
  out.programs = r.info.programs.length - programsOff;
  out.enabled = ao.enabled;
  out.tier = g.tier;
  out.targets = { z: [ao.z.width, ao.z.height], raw: [ao.raw.width, ao.raw.height], blurred: [ao.blurred.width, ao.blurred.height], factor: [ao.factor.width, ao.factor.height] };
  out.textures = r.info.memory.textures - texturesOff;
  const again = grab();
  out.steady = (() => { let d = 0; for (let i = 0; i < on.length; i++) if (on[i] !== again[i]) d++; return d; })();

  // The time: frames alternately without it and with it (here, before the rest, with the page as it was made).
  {
    const times = { off: [], on: [] };
    const px1 = new Uint8Array(4);
    for (let i = 0; i < ${GPU ? 40 : 5}; i++) {
      for (const k of ['off', 'on']) {
        ao.off = k === 'off';
        const t0 = performance.now();
        frame();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
        times[k].push(performance.now() - t0);
      }
    }
    ao.off = false;
    const med = (v) => v.slice().sort((a, b) => a - b)[v.length >> 1];
    out.ms = { off: med(times.off), on: med(times.on) };
  }

  // The distance of each pixel, from the scene's depth: sixteen bits of its logarithm, as a map.
  const far = cam.far;
  const near = cam.near;
  const distance = () => {
    const t = g.post.tap.target;
    const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false });
    const material = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: t.depthTexture }, uNF: { value: new THREE.Vector2(near, far) } },
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
    r.setRenderTarget(rt);
    new FullScreenQuad(material).render(r);
    const buf = new Uint8Array(N * 4);
    r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    r.setRenderTarget(null);
    rt.dispose();
    material.dispose();
    const z = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = buf[i * 4] | (buf[i * 4 + 1] << 8);
      z[i] = a === 65535 ? Infinity : Math.pow(2, (a / 65535) * Math.log2(1 + far)) - 1;
    }
    return z;
  };
  ao.off = true;
  frame();
  const z = distance();
  ao.off = false;

  // The mean over a square of (2k + 1) pixels a side.
  const box = (a, k) => {
    const out = new Float32Array(N);
    const tmp = new Float32Array(N);
    for (let y = 0; y < H; y++) {
      let s = 0;
      for (let x = -k; x <= k; x++) s += a[y * W + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        tmp[y * W + x] = s / (2 * k + 1);
        s += a[y * W + Math.min(W - 1, x + k + 1)] - a[y * W + Math.max(0, x - k)];
      }
    }
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let y = -k; y <= k; y++) s += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        out[y * W + x] = s / (2 * k + 1);
        s += tmp[Math.min(H - 1, y + k + 1) * W + x] - tmp[Math.max(0, y - k) * W + x];
      }
    }
    return out;
  };
  // The last pass (edges cleaned, detail sharpened) reads a pixel's neighbours, along an edge up to twenty-odd pixels
  // away, so a pixel near the land that the occlusion darkens is not wholly its own when that pass runs. Two frames
  // are drawn with it made to copy the frame, and the sky and the far land are held to the letter in those; with it
  // on, what differs must lie within the 24 pixels its search reaches of the land that is nearer than 200 m.
  const present = g.post.present;
  const plain = () => {
    present.render = function (...a) {
      this.aa = 0;
      this.sharp = 0;
      return Object.getPrototypeOf(this).render.apply(this, a);
    };
    ao.off = true;
    const a = grab();
    ao.off = false;
    const b = grab();
    delete present.render;
    return [a, b];
  };
  const [offP, onP] = plain();
  const reached = (() => {
    const m = new Float32Array(N);
    for (let i = 0; i < N; i++) m[i] = z[i] < 200 ? 1 : 0;
    const b = box(m, 24);
    const o = new Uint8Array(N);
    for (let i = 0; i < N; i++) o[i] = b[i] > 0 ? 1 : 0;
    return o;
  })();

  // How much darker it made each pixel (1 - on / off, in the display's own light), and what changed.
  const term = new Float32Array(N);
  let sky = 0, skyPlain = 0, skyFull = 0, skyBeyond = 0, skyMax = 0, nearN = 0, nearSum = 0, nearDark = 0, deep = 0, lighter = 0;
  let farN = 0, farPlain = 0, farFull = 0, farBeyond = 0, farMax = 0, rangeN = 0, rangeSum = 0, rangeL = 0, lighterPlain = 0;
  const differ = (p, q, i) => p[i * 4] !== q[i * 4] || p[i * 4 + 1] !== q[i * 4 + 1] || p[i * 4 + 2] !== q[i * 4 + 2];
  const levels = (p, q, i) => Math.max(Math.abs(p[i * 4] - q[i * 4]), Math.abs(p[i * 4 + 1] - q[i * 4 + 1]), Math.abs(p[i * 4 + 2] - q[i * 4 + 2]));
  for (let i = 0; i < N; i++) {
    const a = luma(off, i);
    const b = luma(on, i);
    term[i] = a > 3 ? 1 - b / a : 0;
    if (onP[i * 4] > offP[i * 4] || onP[i * 4 + 1] > offP[i * 4 + 1] || onP[i * 4 + 2] > offP[i * 4 + 2]) lighterPlain++;
    const d = z[i];
    if (d === Infinity) {
      sky++;
      if (differ(offP, onP, i)) skyPlain++;
      if (differ(off, on, i)) { skyFull++; skyMax = Math.max(skyMax, levels(off, on, i)); if (!reached[i]) skyBeyond++; }
      continue;
    }
    if (d < 100 && a > 3) {
      nearN++;
      nearSum += term[i];
      if (term[i] > 0.02) nearDark++;
      if (term[i] > 0.2) deep++;
      if (term[i] < -0.02) lighter++;
    }
    if (d >= 300) {
      farN++;
      if (differ(offP, onP, i)) farPlain++;
      if (differ(off, on, i)) { farFull++; farMax = Math.max(farMax, levels(off, on, i)); if (!reached[i]) farBeyond++; }
    }
    if (d >= 1500) {
      rangeN++;
      rangeSum += Math.abs(luma(onP, i) - luma(offP, i));
      rangeL += luma(offP, i);
    }
  }
  out.sky = { pixels: sky, plain: skyPlain, full: skyFull, max: skyMax, beyond: skyBeyond };
  out.near = { pixels: nearN, mean: nearSum / Math.max(1, nearN), over2: nearDark / Math.max(1, nearN), over20: deep / Math.max(1, nearN), lighter: lighter / Math.max(1, nearN) };
  out.far = { pixels: farN, plain: farPlain, full: farFull, max: farMax, beyond: farBeyond };
  out.range = { pixels: rangeN, change: rangeL > 0 ? rangeSum / rangeL : 0 };
  out.lighterPlain = lighterPlain;
  out.mean = (() => { let s = 0, n = 0; for (let i = 0; i < N; i++) if (z[i] !== Infinity && luma(off, i) > 3) { s += term[i]; n++; } return s / Math.max(1, n); })();
  out.meanAll = (() => { let s = 0, n = 0; for (let i = 0; i < N; i++) if (luma(off, i) > 3) { s += term[i]; n++; } return s / Math.max(1, n); })();

  // The occlusion's darkening, taken apart from the picture: of two frames, the shot's and the same moment
  // with the lens turned, what is left of it when the broad of it is taken off, and how much of that stays
  // where it was on the screen.
  const turn = () => {
    const was = cam.quaternion.clone();
    cam.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 2.5 * Math.PI / 180));
    cam.rotateX(1.2 * Math.PI / 180);
    cam.updateMatrixWorld();
    return () => { cam.quaternion.copy(was); cam.updateMatrixWorld(); };
  };
  const undo = turn();
  ao.off = true;
  const offB = grab();
  ao.off = false;
  const onB = grab();
  undo();
  const termB = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = luma(offB, i);
    termB[i] = a > 3 ? 1 - luma(onB, i) / a : 0;
  }
  const hi = (t) => { const b = box(t, 4); const o = new Float32Array(N); for (let i = 0; i < N; i++) o[i] = t[i] - b[i]; return o; };
  const hA = hi(term);
  const hB = hi(termB);
  // Over what is within 120 m, where there is any darkening in either frame.
  const use = (i) => z[i] < 120 && (Math.abs(term[i]) > 0.003 || Math.abs(termB[i]) > 0.003);
  const corr = (u, v) => {
    let n = 0, mu = 0, mv = 0;
    for (let i = 0; i < N; i++) if (use(i)) { n++; mu += u[i]; mv += v[i]; }
    if (n < 400) return null;
    mu /= n; mv /= n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < N; i++) if (use(i)) {
      const a = u[i] - mu, b = v[i] - mv;
      sxy += a * b; sxx += a * a; syy += b * b;
    }
    return sxx > 0 && syy > 0 ? { r: sxy / Math.sqrt(sxx * syy), n } : null;
  };
  // A control: a pattern laid on the screen in the same two frames (a tile of 4 by 4 that does not move
  // with the world), a good deal stronger than the occlusion's own spread over those pixels.
  let sd = 0, sn = 0;
  for (let i = 0; i < N; i++) if (use(i)) { sd += hA[i] * hA[i]; sn++; }
  sd = Math.sqrt(sd / Math.max(1, sn));
  const tile = (i) => (((((i % W) & 3) * 5 + (((i / W) | 0) & 3) * 3) % 7) - 3) / 3 * sd * 3.5;
  const withPin = (u) => { const o = new Float32Array(N); for (let i = 0; i < N; i++) o[i] = u[i] + tile(i); return o; };
  out.pinned = corr(hA, hB);
  out.control = corr(withPin(hA), withPin(hB));
  out.fine = sd;

  // What lights itself is not darkened: a lamp put on the road (a sphere of light), and in its place a grey ball, which is.
  {
    const p = g.road.at(g.sCar + 12);
    const x = p.x + Math.sin(p.theta) * 2, z0 = p.z - Math.cos(p.theta) * 2;
    const y = g.road.surfaceAt(g.sCar + 12, -2);
    const rad = 0.3;
    const geometry = new THREE.SphereGeometry(rad, 24, 12);
    const put = (material) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y + rad, z0);
      g.scene.add(mesh);
      return mesh;
    };
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const centre = new THREE.Vector3(x, y + rad, z0);
    const c = centre.clone().project(cam);
    const sx = (c.x + 1) / 2 * W, sy = (c.y + 1) / 2 * H;
    const e = centre.clone().add(new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(rad)).project(cam);
    const rpx = Math.abs((e.x + 1) / 2 * W - sx);
    const pair = (mesh) => {
      ao.off = true;
      const lo = grab();
      ao.off = false;
      const ln = grab();
      g.scene.remove(mesh);
      return [lo, ln];
    };
    const inside = (fn) => {
      for (let y2 = Math.max(0, Math.floor(sy - rpx)); y2 < Math.min(H, Math.ceil(sy + rpx)); y2++) {
        for (let x2 = Math.max(0, Math.floor(sx - rpx)); x2 < Math.min(W, Math.ceil(sx + rpx)); x2++) {
          if (Math.hypot(x2 + 0.5 - sx, y2 + 0.5 - sy) < 0.8 * rpx) fn(y2 * W + x2, y2 + 0.5 < sy);
        }
      }
    };
    const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(12, 12, 12) });
    const [lo, ln] = pair(put(lamp));
    let lampN = 0, lampChanged = 0;
    inside((i) => {
      if (lo[i * 4] > 250 && lo[i * 4 + 1] > 250 && lo[i * 4 + 2] > 250) {
        lampN++;
        if (lo[i * 4] !== ln[i * 4] || lo[i * 4 + 1] !== ln[i * 4 + 1] || lo[i * 4 + 2] !== ln[i * 4 + 2]) lampChanged++;
      }
    });
    const grey = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.5, 0.5, 0.5), roughness: 1, metalness: 0 });
    const [bo, bn] = pair(put(grey));
    let lowN = 0, lowSum = 0, upN = 0, upSum = 0;
    inside((i, below) => {
      const a = luma(bo, i);
      if (a < 3 || a > 250) return;
      if (below) { lowN++; lowSum += 1 - luma(bn, i) / a; } else { upN++; upSum += 1 - luma(bn, i) / a; }
    });
    out.lamp = { px: rpx, pixels: lampN, changed: lampChanged, ball: { lower: lowN ? lowSum / lowN : 0, upper: upN ? upSum / upN : 0, pixels: lowN + upN } };
    lamp.dispose();
    grey.dispose();
    geometry.dispose();
  }

  // The tiers: the middle one with its one direction, the low one with none.
  const high = out.mean;
  g.setTier('mid');
  const mid = grab();
  out.midSlices = ao.uniforms.uSlices.value;
  out.midEnabled = ao.enabled;
  g.setTier('low');
  const low = grab();
  out.lowEnabled = ao.enabled;
  out.callsLow = calls();
  g.setTier('high');
  let midSum = 0, midN = 0, lowDiff = 0;
  for (let i = 0; i < N; i++) {
    if (z[i] !== Infinity && luma(off, i) > 3) { midSum += 1 - luma(mid, i) / luma(off, i); midN++; }
    if (off[i * 4] !== low[i * 4] || off[i * 4 + 1] !== low[i * 4 + 1] || off[i * 4 + 2] !== low[i * 4 + 2]) lowDiff++;
  }
  out.tiers = { high, mid: midSum / Math.max(1, midN), lowDiff };

  // A picture the photo mode makes: the frame as drawn again at the frame's size and at twice that.
  const shot = (k) => g.post.capture(W * k, H * k).pixels;
  const dark = (a, b) => { let s = 0, n = 0; for (let i = 0; i < a.length; i += 4) { const x = 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2]; if (x > 3) { s += 1 - (0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2]) / x; n++; } } return s / Math.max(1, n); };
  ao.off = true;
  const c1off = shot(1);
  ao.off = false;
  const c1on = shot(1);
  out.capture = { one: dark(c1off, c1on) };
  ao.off = true;
  const c2off = shot(2);
  ao.off = false;
  const c2on = shot(2);
  out.capture.two = dark(c2off, c2on);

  // The other styles: held off or not, the same frame.
  out.styles = {};
  const was = g.style.id;
  for (const id of ['paint', 'ink', 'cel', 'print', 'pixel', 'block']) {
    g.style.set(id, true);
    g.style.applyScene();
    g.atmosphere.bakeEnvironment();
    grab();
    grab();
    ao.off = true;
    const a = grab();
    const enabledA = ao.enabled;
    ao.off = false;
    const b = grab();
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    out.styles[id] = { differ: d, enabled: ao.enabled || enabledA };
  }
  g.style.set(was, true);
  g.style.applyScene();
  g.post.setStyle(g.style);

  // A second pass: made, drawn once, disposed.
  {
    while (gl.getError() !== gl.NO_ERROR) { /* the page's own, before this */ }
    frame();
    const tex = r.info.memory.textures;
    const geo = r.info.memory.geometries;
    const two = new AoPass(r, g.post.tap, cam);
    two.setSize(W, H);
    two.set(1, 'high', true);
    two.render(r, null, g.post.tap.target);
    const made = r.info.memory.textures - tex;
    two.dispose();
    out.second = { made, texturesAfter: r.info.memory.textures - tex, geometriesAfter: r.info.memory.geometries - geo, errors: [] };
    let e;
    while ((e = gl.getError()) !== gl.NO_ERROR) out.second.errors.push(e);
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
      term: pic((i) => { const v = Math.round(255 * (1 - Math.max(0, Math.min(1, term[i] * 4)))); return [v, v, v]; }),
    };
  }
  while (gl.getError() !== gl.NO_ERROR) { /* none left for the next */ }
  return out;
`;

// The module, in node: three is the copy the page has.
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s, c, n) { return s === 'three' ? { url: ${JSON.stringify(new URL('./vendor/three.module.js', import.meta.url).href)}, shortCircuit: true } : n(s, c); }`,
));
const { AO, AO_SHADERS } = await import('../src/render/ao.js');

const server = serve();
let failed = 0;
const check = (ok, text) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};
const pc = (v, k = 2) => `${(v * 100).toFixed(k)}%`;
try {
  // What the tiers are, before any page.
  check(AO.slices.high === 2 && AO.slices.mid === 1 && AO.slices.low === 0 && AO.steps === 4,
    `the tiers' taps: high ${AO.slices.high} directions of ${AO.steps} taps each way, middle ${AO.slices.mid}, low ${AO.slices.low}`);
  check(AO.radius === 1.2 && AO.maxPx === 64 && AO.strength === 0.6 && AO_SHADERS.steps === AO.steps && /const int STEPS = 4;/.test(AO_SHADERS.trace),
    `the radius is ${AO.radius} m (${AO.maxPx} pixels at most on a frame 1080 tall), the strength ${AO.strength}, the program has the taps in its text`);
  check(AO.fade[0] < AO.fade[1] && AO.fade[1] <= 200 && AO.emissive[0] < AO.emissive[1],
    `it is gone from ${AO.fade[1]} m (thinning from ${AO.fade[0]}), and what the exposure takes past ${AO.emissive[0]} to ${AO.emissive[1]} of light is left as it is`);

  if (!(await waitForServer())) throw new Error('the server did not come up');
  // The one that answers is the one started here (a port another run has is not).
  const served = await (await fetch(`http://localhost:${PORT}/src/render/ao.js`)).text();
  if (served !== readFileSync(ROOT + 'src/render/ao.js', 'utf8')) throw new Error(`port ${PORT} is served by something else`);
  for (const place of places) {
    if (!PLACES[place]) throw new Error(`no place ${place}`);
    // A page for each place, with ao=0: it is held off from the start, and built the first time it is on.
    const page = await openPage(`seed=7&world=${PLACES[place].world}&s=${PLACES[place].s}&cam=chase&style=real&run=60&ao=0`);
    try {
      const put = await page.run(PLACE(PLACES[place].s));
      if (put.error) throw new Error(`${place}: ${put.error}`);
      const r = await page.run(MEASURE(!!KEEP));
      if (r.error) throw new Error(`${place}: ${r.error}`);
      const tag = `${place}:`;
      check(r.enabled && r.tier === 'high' && r.callsOn - r.callsOff === 5 && r.programs === 5,
        `${tag} on at the high tier, ${r.callsOn - r.callsOff} draws and ${r.programs} programs more (${r.callsOff} draws without it, ${r.callsOn} with it)`);
      const [w, h] = r.size;
      const half = [Math.ceil(w / 2), Math.ceil(h / 2)];
      const t = r.targets;
      check(JSON.stringify(t.z) === JSON.stringify(half) && JSON.stringify(t.raw) === JSON.stringify(half) && JSON.stringify(t.blurred) === JSON.stringify(half)
        && JSON.stringify(t.factor) === JSON.stringify([w, h]) && r.textures === 4,
        `${tag} four targets, three at half the frame's size (${half[0]} x ${half[1]}) and one at its own (${w} x ${h}): ${((3 * half[0] * half[1] + w * h) / 1e6).toFixed(2)} M pixels, ${r.textures} textures more`);
      check(r.steady === 0, `${tag} the same frame drawn twice is the same pixel for pixel (${r.steady} bytes differ)`);
      check(r.near.mean > 0.002 && r.near.mean < 0.1 && r.near.over2 > 0.003 && r.near.lighter < 0.01,
        `${tag} within 100 m it takes ${pc(r.near.mean)} of the light on average, more than 2% off ${pc(r.near.over2, 1)} of the pixels, more than 20% off ${pc(r.near.over20, 3)}, and lightens ${pc(r.near.lighter, 3)}; with the last pass copying the frame ${r.lighterPlain} pixels of the frame are lighter by any amount`);
      check(r.sky.pixels === 0 || (r.sky.plain === 0 && r.sky.beyond === 0),
        `${tag} of ${r.sky.pixels} pixels of sky ${r.sky.plain} are different (the last pass copying the frame); with it on ${r.sky.full} are (up to ${r.sky.max} of 255), ${r.sky.beyond} of them farther than 24 pixels from the near land`);
      check(r.far.pixels === 0 || (r.far.plain === 0 && r.far.beyond === 0),
        `${tag} beyond 300 m (${r.far.pixels} pixels) ${r.far.plain} are different (the last pass copying the frame); with it on ${r.far.full} are (up to ${r.far.max} of 255), ${r.far.beyond} of them farther than 24 pixels from the near land`);
      if (place === 'valley') {
        check(r.range.pixels > 1000 && r.range.change === 0,
          `${tag} beyond 1500 m (${r.range.pixels} pixels) the light moves by ${pc(r.range.change, 3)} (not at all)`);
      }
      check(r.lamp.pixels > 20 && r.lamp.changed === 0 && r.lamp.ball.pixels > 40 && r.lamp.ball.lower > 0.015 && r.lamp.ball.lower > r.lamp.ball.upper,
        `${tag} a lamp on the road (${r.lamp.pixels} pixels, ${r.lamp.px.toFixed(1)} across) is the same pixel for pixel (${r.lamp.changed} changed); a grey ball in its place is ${pc(r.lamp.ball.lower)} darker in its lower half and ${pc(r.lamp.ball.upper)} in its upper (${r.lamp.ball.pixels} pixels)`);
      check(r.pinned && Math.abs(r.pinned.r) < 0.09 && r.control && r.control.r > 0.5 && r.fine < 0.04,
        `${tag} the darkening's fine detail correlates ${r.pinned ? r.pinned.r.toFixed(3) : 'n/a'} with the same frame turned (${r.pinned ? r.pinned.n : 0} pixels; under 0.09), a pattern on the screen would read ${r.control ? r.control.r.toFixed(3) : 'n/a'} (over 0.5); all of it, noise and creases, is ${pc(r.fine)} of the light (rms, under 4%)`);
      check(r.midEnabled && r.midSlices === 1 && r.tiers.mid > 0.5 * r.tiers.high && r.tiers.mid < 1.5 * r.tiers.high,
        `${tag} the middle tier looks along ${r.midSlices} direction and takes ${pc(r.tiers.mid)} of the light (the high tier ${pc(r.tiers.high)})`);
      check(!r.lowEnabled && r.tiers.lowDiff === 0 && r.callsLow === r.callsOff,
        `${tag} the low tier draws nothing: ${r.tiers.lowDiff} bytes differ from the frame without it, ${r.callsLow} draws (${r.callsOff} without)`);
      const others = Object.entries(r.styles);
      check(others.every(([, v]) => v.differ === 0 && !v.enabled),
        `${tag} the other styles are the same held off or not (${others.map(([k, v]) => `${k} ${v.differ}`).join(', ')} bytes differ)`);
      check(r.capture.one > 0.7 * r.meanAll && r.capture.one < 1.4 * r.meanAll && r.capture.two > 0.7 * r.meanAll && r.capture.two < 1.4 * r.meanAll,
        `${tag} the photo mode's pictures have it: ${pc(r.capture.one)} of the light taken at the frame's size, ${pc(r.capture.two)} at twice that (the screen ${pc(r.meanAll)}, the sky counted)`);
      check(r.second.made === 4 && r.second.texturesAfter === 0 && r.second.geometriesAfter === 0 && r.second.errors.length === 0,
        `${tag} a second pass drawn and disposed: ${r.second.made} textures made, ${r.second.texturesAfter} left, ${r.second.geometriesAfter} geometries left, ${r.second.errors.length} errors`);
      console.log(`     ${w}x${h}, ${r.ms.off.toFixed(1)} ms a frame without it, ${r.ms.on.toFixed(1)} ms with it (${(r.ms.on / r.ms.off).toFixed(3)} times)`);
      if (KEEP && r.pictures) {
        mkdirSync(KEEP, { recursive: true });
        for (const [k, url] of Object.entries(r.pictures)) writeFileSync(`${KEEP}/${place}-${k}.png`, Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64'));
      }
      if (page.logs.length) check(false, `${place}: the page logged errors: ${page.logs.slice(0, 2).join(' | ')}`);
    } finally {
      page.close();
    }
  }
} finally {
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
// (Not process.exit: the timer that removes the last page's profile has to fire first.)
process.exitCode = failed ? 1 : 0;
