// The sun's shadow: two maps, and a contact shadow in the real style.
//
// Runs the page headless (seed 7, the hills and the alpine's hairpin, the real style, high tier unless
// said; farshadow=alt in its address, for the page's own cadence of the far map: a headless run draws it in
// every frame otherwise, and a page of its own, last, holds that to twelve frames of twelve) and holds the
// shadow to what it should be:
//  - the maps: the near one is 2048 texels over 70 m (3.4 cm to the texel) and the far one 2048 over 360 m
//    (17.6 cm); each stands on the lattice of its own texels in absolute metres, in every one of the
//    frames of a drive, and so a point of the land keeps its place in the map as the car goes (a drive of
//    4 seconds at 22 m/s: it moves by at most 0.001 of a texel); the matrix the far map is looked
//    up by is the one that takes a point in the near map's coordinates to the far map's; the far map
//    is drawn again as its centre goes 8 m on (1 to 4 frames of 24 at 22 m/s) in the high tier and the mid,
//    and not at all in the low, which has one map of 1024 over 180 m; a frame with the far map drawn has no
//    more than 60 draw calls more than one without it (what each map's pass draws is printed, by what it
//    is); each of the styles but the block has a far map (drawn in at most 2 frames of 8), and the block
//    style draws none; the
//    contact shadow is drawn in the high tier's real style and not in any other;
//  - what the maps hold: the shadow of the car on the road (the car stopped, the lens 6 m beside it, 3.2 m
//    up, on the side the shadow falls to), taken as what the car's casting makes of the frame (the frame
//    with the car not casting less the frame with it), has an edge of at most 5 pixels from a tenth of
//    its depth to nine tenths, along forty places of its outline; the posts of the guardrail within 20 m
//    of the lens leave a shadow (the alpine place): of the pixels there, those that are 15 % darker
//    with the posts casting than without are at least 40; the shadow of what lies on the ground (stones,
//    bushes, tufts) is in the frame, as the pixels within 30 m that are 10 % darker for it (at least 150);
//  - the drive: the car's shadow, in a lens that goes with it, does not move from one frame to the next
//    by more than 1 pixel (24 frames in a row at 22 m/s), the edge's place being where the shadow is half
//    its depth on 19 rows or so across it;
//  - the seam: the ground looked straight down on, in the hills, has the same light across the near map's
//    edge: the median of the frame's brightness in each 2 m of distance from the edge, 8 m either side of it
//    (the blend is 4 m wide), no two next to each other differ by more than 3 %;
//  - the contact shadow: what it does to a frame is within 30 m of the lens and on faces turned to
//    the sun, and nothing else (none in the sky, none beyond 30 m), and a frame of another style has none.
//
// The pixel checks are made on a frame as the page draws it (1280 x 577 here); 'px' is of that.
//
// Usage: node tools/shadow_check.mjs [--only maps,styles,edge,posts,small,drive,seam,contact,headless] [--site DIR] [--against DIR] [--write FILE] [--frames DIR]
//   --site   the page is served from another tree (an older build's export): only the checks that read
//            the frame are made, for what they read there
//   --against  another tree's export: after the checks, the ones that read the frame are made on it too, and
//            what they find is printed beside (and written to FILE-against.json), held to nothing
//   --frames the frames the checks read are written to DIR (PNG)
// PORT=8186 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8186;
const ROOT = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const SITE = opt('--site', ROOT).replace(/\/?$/, '/');
const OLD = SITE !== ROOT;
const AGAINST = opt('--against', null) ? opt('--against').replace(/\/?$/, '/') : null;
const ONLY = opt('--only', null) ? opt('--only').split(',') : null;
const FRAMES = opt('--frames', null) ? opt('--frames').replace(/\/?$/, '/') : null;
const want = (name) => !ONLY || ONLY.includes(name);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- what is held to -----------------------------------------------------------

const LIMIT = {
  edge: 5,            // px, from a tenth to nine tenths of the car's shadow
  posts: 40,          // pixels 15 % darker within 20 m of the lens for the posts' shadows
  small: 150,         // pixels 10 % darker within 30 m for the shadows of what lies on the ground
  jitter: 1,          // px, the car's shadow from one frame to the next
  lattice: 0.001,     // of a texel
  seam: 0.03,         // of the brightness, between two 2 m bins at the near map's edge
  calls: 60,          // draw calls a frame with the far map drawn has over one without it
};

// --- the page -------------------------------------------------------------------

export function serve(site = SITE) {
  return spawn('node', [ROOT + 'tools/serve.mjs', String(PORT), site], { stdio: ['ignore', 'ignore', 'inherit'] });
}

// Stops the server and waits until the port is free again.
async function stop(server) {
  if (server.exitCode !== null || server.signalCode !== null) return;
  const gone = new Promise((r) => server.once('exit', r));
  server.kill();
  await gone;
}

export async function waitForServer(tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return true;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  return false;
}

export async function openPage(query) {
  const profile = `${tmpdir()}/continuum-shadow-${process.pid}-${Date.now()}`;
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
    run: async (body) => {
      const out = await ev(`(async () => { const g = game; ${body} })().then((v) => JSON.stringify(v), (e) => JSON.stringify({ error: e.message + ' ' + (e.stack || '').slice(0, 400) }))`);
      const v = JSON.parse(out);
      if (v && v.error) throw new Error(v.error);
      return v;
    },
    close,
  };
}

// In the page, what the checks draw with: the frame as a PNG, the distance of each pixel as one, the car put
// on the road at s (still or at 22 m/s) with the lens at the chase or put by hand beside the road, the cars on
// the road and the animals put away, and the switches of what casts.
export const INIT = `
  const THREE = await import('three');
  const { FullScreenQuad } = await import('./tools/vendor/postprocessing/Pass.js');
  const sc = window.__sc = {};
  const canvas = document.getElementById('view');
  const roots = [];
  const seen = new Set();
  const walk = (v, d) => {
    if (!v || typeof v !== 'object' || seen.has(v) || ArrayBuffer.isView(v)) return;
    seen.add(v);
    if (v.isObject3D) { let o = v; while (o.parent && o.parent !== g.scene) o = o.parent; if (o.parent === g.scene) roots.push(o); return; }
    if (d <= 0) return;
    if (v instanceof Map || v instanceof Set) { for (const x of v.values()) walk(x, d - 1); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, d - 1); return; }
    for (const k of Object.keys(v)) walk(v[k], d - 1);
  };
  walk(g.traffic, 2);
  walk(g.critters, 2);
  sc.eye = null;
  sc.draw = () => {
    for (const o of roots) o.visible = false;
    if (sc.eye) sc.eye();
    g.render();
    return canvas.toDataURL('image/png');
  };
  sc.place = (s, still, eye) => {
    if (g.style.id !== 'real') { g.style.set('real', true); g.style.applyScene(); }
    const p = g.road.at(s);
    g.autoMode = true;
    g.sCar = s;
    g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(s, 1.9) + 0.3);
    g.car.vx = still ? 0 : 22;
    g.setCamera('chase');
    g.chase.shaking = false;
    g.chase.lead = false;
    g.chase.snapTo(g.car, g.car.y || 0);
    g.style.wind[0] = 1000;
    g.style.wind[1] = 400;
    g.atmosphere.uniforms.uTime.value = 100;
    for (let i = 0; i < 150; i++) { g.pilot.vMax = still ? 0 : 22; g.update(1 / 60); }
    g.post.setStyle(g.style);
    g.atmosphere.bakeEnvironment();
    sc.eye = eye ? () => {
      const q = g.road.at(g.sCar - eye.back);
      const x = q.x - Math.sin(q.theta) * eye.side, z = q.z + Math.cos(q.theta) * eye.side;
      g.camera.position.set(x, g.groundAt(x, z) + eye.up, z);
      g.camera.up.set(0, 1, 0);
      g.camera.lookAt(g.car.x, g.car.y + 0.7, g.car.z);
      g.camera.updateMatrixWorld();
    } : null;
    return { sun: g.atmosphere.sunDir.toArray(), theta: p.theta };
  };
  sc.carCasts = (on) => g.presentation.root.traverse((o) => { if (o.isMesh) o.castShadow = on; });
  sc.carShown = (on) => { g.presentation.root.visible = on; };
  sc.postsCast = (on) => g.roadMesh.group.traverse((o) => { if (o.name === 'road-post') o.castShadow = on; });
  sc.clutterCasts = (on) => { for (const m of g.clutter.meshes.values()) m.castShadow = on; };
  // The distance of each pixel from the lens in metres, up to far, in two bytes (r + 256 g of 65535 of far).
  sc.depth = (far) => {
    const tap = g.post.tap.target;
    const w = tap.width, h = tap.height;
    const rt = new THREE.WebGLRenderTarget(w, h);
    const quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: tap.depthTexture }, uNF: { value: new THREE.Vector2(g.camera.near, g.camera.far) } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'precision highp float; uniform sampler2D tDepth; uniform vec2 uNF; varying vec2 vUv; void main() {'
        + ' float d = texture2D(tDepth, vUv).r; float z = uNF.x * uNF.y / (uNF.y - d * (uNF.y - uNF.x));'
        + ' float a = floor(clamp(z / ' + far.toFixed(1) + ', 0.0, 1.0) * 65535.0 + 0.5);'
        + ' gl_FragColor = vec4(mod(a, 256.0) / 255.0, floor(a / 256.0) / 255.0, 0.0, 1.0); }',
      depthTest: false, depthWrite: false }));
    g.renderer.setRenderTarget(rt);
    quad.render(g.renderer);
    const buf = new Uint8Array(w * h * 4);
    g.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    g.renderer.setRenderTarget(null);
    rt.dispose(); quad.dispose();
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const cx = cv.getContext('2d');
    const im = cx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = (h - 1 - y) * w + x, o = (y * w + x) * 4;
      im.data[o] = buf[s * 4]; im.data[o + 1] = buf[s * 4 + 1]; im.data[o + 2] = 0; im.data[o + 3] = 255;
    }
    cx.putImageData(im, 0, 0);
    return cv.toDataURL('image/png');
  };
  return true;
`;

// --- reading a frame -----------------------------------------------------------------

// An 8-bit RGB or RGBA PNG, as canvas.toDataURL writes one, to RGBA bytes.
function decodePNG(buf) {
  let p = 8;
  let w = 0;
  let h = 0;
  let bpp = 4;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0 || (data[9] !== 6 && data[9] !== 2)) throw new Error('unexpected PNG format');
      bpp = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  let line = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1);
    const f = raw[o];
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = raw[o + 1 + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - b);
        const pc = Math.abs(q - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[i] = line[x * bpp];
      out[i + 1] = line[x * bpp + 1];
      out[i + 2] = line[x * bpp + 2];
      out[i + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    [prev, line] = [line, prev];
  }
  return { w, h, data: out };
}

export const fromURL = (url) => decodePNG(Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64'));

// With --frames DIR, the frames the checks read are written there to be looked at.
function keep(name, url) {
  if (!FRAMES) return;
  mkdirSync(FRAMES, { recursive: true });
  // (The other tree's frames, --against, have was- in front.)
  writeFileSync(`${FRAMES}${beside ? 'was-' : ''}${name}.png`, Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64'));
}

// The brightness of each pixel (of the frame as it is shown, 0 to 1).
export function luma(img) {
  const out = new Float32Array(img.w * img.h);
  for (let i = 0; i < out.length; i++) out[i] = (0.2126 * img.data[i * 4] + 0.7152 * img.data[i * 4 + 1] + 0.0722 * img.data[i * 4 + 2]) / 255;
  return out;
}

// The distance of each pixel, in metres.
export function metres(img, far) {
  const out = new Float32Array(img.w * img.h);
  for (let i = 0; i < out.length; i++) out[i] = ((img.data[i * 4] + 256 * img.data[i * 4 + 1]) / 65535) * far;
  return out;
}

const median = (a) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : null);

// A box blur of a picture (radius r), by its running sums.
function blur(src, w, h, r) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / (2 * r + 1);
      s += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / (2 * r + 1);
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

const sample = (a, w, h, x, y) => {
  const x0 = Math.min(w - 2, Math.max(0, Math.floor(x)));
  const y0 = Math.min(h - 2, Math.max(0, Math.floor(y)));
  const fx = Math.min(1, Math.max(0, x - x0));
  const fy = Math.min(1, Math.max(0, y - y0));
  return (a[y0 * w + x0] * (1 - fx) + a[y0 * w + x0 + 1] * fx) * (1 - fy) + (a[(y0 + 1) * w + x0] * (1 - fx) + a[(y0 + 1) * w + x0 + 1] * fx) * fy;
};

// How wide the edge of a shadow is, in pixels, from a tenth of its depth to nine tenths, at `places` places along
// its outline. d: how much darker the shadow makes each pixel (the frame without it less the frame with it); not
// within `keep` pixels of a pixel in `away`. The profile is read across the edge, 8 pixels each way, and a place
// where the shadow is not as deep as its own depth 8 pixels in, or is not out of it 8 pixels out, is passed over.
// Returns { width: the median, n: the places read }.
export function edgeWidth(d, w, h, away, places = 40, keep = 10) {
  const inside = new Uint8Array(w * h);
  const vals = [];
  for (let i = 0; i < inside.length; i++) {
    if (d[i] > 0.04) {
      inside[i] = 1;
      vals.push(d[i]);
    }
  }
  if (vals.length < 200) return { width: null, n: 0, plateau: null };
  vals.sort((x, y) => x - y);
  const plateau = vals[Math.floor(vals.length * 0.75)];
  const far = blur(Float32Array.from(away), w, h, keep);
  const edge = [];
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (!inside[i] || far[i] > 0.002) continue;
      if (inside[i - 1] && inside[i + 1] && inside[i - w] && inside[i + w]) continue;
      edge.push(i);
    }
  }
  const smooth = blur(Float32Array.from(inside), w, h, 4);
  const widths = [];
  const reach = 8;
  const step = Math.max(1, Math.floor(edge.length / (places * 4)));
  for (let k = 0; k < edge.length && widths.length < places; k += step) {
    const i = edge[k];
    const x = i % w;
    const y = (i / w) | 0;
    let gx = smooth[i + 3] - smooth[i - 3];
    let gy = smooth[i + 3 * w] - smooth[i - 3 * w];
    const gl = Math.hypot(gx, gy);
    if (gl < 1e-4) continue;
    gx /= -gl;
    gy /= -gl;
    // The profile, from inside (t < 0) to outside, as a share of the shadow's depth.
    const at = (t) => sample(d, w, h, x + gx * t, y + gy * t) / plateau;
    if (at(-reach) < 0.75 || at(reach) > 0.25) continue;
    let t90 = null;
    let t10 = null;
    for (let t = -reach; t <= reach; t += 0.25) {
      const v = at(t);
      if (t90 === null && v < 0.9) t90 = t;
      if (t90 !== null && t10 === null && v < 0.1) {
        t10 = t;
        break;
      }
    }
    if (t90 !== null && t10 !== null) widths.push(t10 - t90);
  }
  return { width: median(widths), n: widths.length, plateau };
}

// --- the checks ---------------------------------------------------------------------

const results = [];
let failed = 0;
// True while the checks are of the other tree (--against): what they find is printed and kept, held to nothing.
let beside = false;
const others = [];
function check(name, ok, detail) {
  if (beside) {
    others.push({ name, ok, detail });
    console.log(`was   ${name}: ${detail}`);
    return;
  }
  results.push({ name, ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}: ${detail}`);
}
const num = (v, k = 3) => (v === null || v === undefined ? 'none' : (+v).toFixed(k));

// The maps, the lattice of each, the matrix between them, and how often the far one is drawn.
async function maps(page) {
  return page.run(`
    const sc = window.__sc;
    const THREE = await import('three');
    const { styleU } = await import('./src/render/style.js');
    sc.place(5000, false, null);
    const a = g.atmosphere;
    const out = {};
    // A frame at a time: how many have the far map drawn in them, and what that costs in draw calls.
    let farDrawn = 0, drawnNow = false;
    const was = a._farDrawn.bind(a);
    a._farDrawn = () => { farDrawn++; drawnNow = true; was(); };
    const withFar = [], without = [];
    // What each map's pass draws, by what it is.
    const tally = [{}, {}];
    const tris = [0, 0];
    const kindOf = (o) => {
      let r = o;
      while (r.parent && r.parent !== g.scene) r = r.parent;
      if (r === g.terrain.group) return 'terrain';
      if (r === g.roadMesh.group) return 'road';
      if (r === g.forest.group) return o.userData && o.userData.caster ? 'tree lists' : 'forest';
      if (r === g.city.group) return 'city';
      if (r === g.presentation.root) return 'car';
      return (o.userData && o.userData.kind) || o.name || r.name || o.constructor.name;
    };
    const direct = g.renderer.renderBufferDirect;
    g.renderer.renderBufferDirect = function (camera) {
      const material = arguments[3];
      if (material && material.isMeshDepthMaterial && camera.userData && camera.userData.cascade !== undefined) {
        const c = camera.userData.cascade, t = tally[c], k = kindOf(arguments[4]);
        t[k] = (t[k] || 0) + 1;
        const before = g.renderer.info.render.triangles;
        const done = direct.apply(this, arguments);
        tris[c] += g.renderer.info.render.triangles - before;
        return done;
      }
      return direct.apply(this, arguments);
    };
    for (let i = 0; i < 24; i++) {
      g.pilot.vMax = 22;
      g.update(1 / 60);
      drawnNow = false;
      g.renderer.info.reset();
      sc.draw();
      (drawnNow ? withFar : without).push(g.renderer.info.render.calls);
    }
    g.renderer.renderBufferDirect = direct;
    out.draws = tally.map((t, c) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, +(v / (c === 0 ? 24 : Math.max(1, farDrawn))).toFixed(1)])));
    out.drawn = [farDrawn, 24];
    out.tris = tris.map((v, c) => Math.round(v / (c === 0 ? 24 : Math.max(1, farDrawn))));
    const mid = (v) => (v.length ? v.slice().sort((x, y) => x - y)[v.length >> 1] : null);
    out.calls = [mid(withFar), mid(without)];
    // 4 seconds of the drive, a frame in every ten: a point of the land and where it is in each map (the part of a
    // texel), and the matrix from the near map's coordinates to the far map's.
    const abs = new THREE.Vector3(g.car.x + g.road.origin.x + 14, g.car.y - 1, g.car.z + g.road.origin.z + 3);
    const first = [null, null];
    let holds = 0, worst = 0;
    const part = (m, p, n) => { const e = p.clone().applyMatrix4(m); return [e.x * n, e.y * n].map((v) => v - Math.floor(v)); };
    const apart = (f, h) => Math.max(...f.map((v, i) => Math.abs(((v - h[i] + 1.5) % 1) - 0.5)));
    for (let i = 0; i < 24; i++) {
      for (let k = 0; k < 10; k++) { g.pilot.vMax = 22; g.update(1 / 60); }
      sc.draw();
      const o = g.road.origin;
      const p = new THREE.Vector3(abs.x - o.x, abs.y, abs.z - o.z);
      const n = part(a.sun.shadow.matrix, p, a.sun.shadow.mapSize.x);
      if (!first[0]) first[0] = n;
      holds = Math.max(holds, apart(n, first[0]));
      if (a._farOn && a.sunFar.shadow.map) {
        const f = part(a.sunFar.shadow.matrix, p, a.sunFar.shadow.mapSize.x);
        if (!first[1]) first[1] = f;
        holds = Math.max(holds, apart(f, first[1]));
        const via = p.clone().applyMatrix4(a.sun.shadow.matrix).applyMatrix4(styleU.uShFarM.value);
        worst = Math.max(worst, via.distanceTo(p.clone().applyMatrix4(a.sunFar.shadow.matrix)));
      }
    }
    a._farDrawn = was;
    out.holds = holds;
    out.matrix = worst;
    out.near = { half: a.cascades[0].half, size: a.sun.shadow.mapSize.x, mapped: !!a.sun.shadow.map };
    out.far = { on: a._farOn, half: a.cascades[1].half, size: a.sunFar.shadow.mapSize.x, mapped: !!a.sunFar.shadow.map };
    out.contact = g.post.contact.enabled;
    return out;
  `);
}

async function tiers(page) {
  const out = {};
  for (const tier of ['mid', 'low', 'high']) {
    out[tier] = await page.run(`
      const sc = window.__sc;
      g.pinTier('${tier}');
      for (let i = 0; i < 12; i++) { g.update(1 / 60); sc.draw(); }
      const { styleU } = await import('./src/render/style.js');
      const a = g.atmosphere;
      let drawn = 0;
      const was = a._farDrawn.bind(a);
      a._farDrawn = () => { drawn++; was(); };
      for (let i = 0; i < 12; i++) { g.update(1 / 60); sc.draw(); }
      a._farDrawn = was;
      return { tier: g.tier, drawn, nearSize: a.sun.shadow.mapSize.x, nearHalf: a.cascades[0].half, farOn: a._farOn,
        farMapped: !!a.sunFar.shadow.map, contact: g.post.contact.enabled, farUsed: styleU.uShFarOn.value };
    `);
  }
  return out;
}

// The car's shadow beside the road, as the car's own casting makes it.
async function edge(page) {
  const r = await page.run(`
    const sc = window.__sc;
    const THREE = await import('three');
    // The car stopped on the road, the lens 6 m beside it, 3.2 m up and 9 m behind, on the side its shadow falls to
    // (from lower and further off the shadow is a strip a few pixels tall, from where the chase lens is it is a patch).
    const put = sc.place(5055, true, null);
    const sun = g.atmosphere.sunDir;
    const side = -Math.sin(put.theta) * sun.x + Math.cos(put.theta) * sun.z > 0 ? -6 : 6;
    sc.eye = () => {
      const q = g.road.at(g.sCar - 9);
      const x = q.x - Math.sin(q.theta) * side, z = q.z + Math.cos(q.theta) * side;
      g.camera.position.set(x, g.groundAt(x, z) + 3.2, z);
      g.camera.up.set(0, 1, 0);
      g.camera.lookAt(g.car.x, g.car.y + 0.7, g.car.z);
      g.camera.updateMatrixWorld();
    };
    const a = sc.draw();
    sc.carCasts(false);
    const b = sc.draw();
    sc.carCasts(true);
    sc.carShown(false);
    const c = sc.draw();
    sc.carShown(true);
    // How many centimetres a pixel is across at the car, in this frame.
    const here = g.camera.position.distanceTo(new THREE.Vector3(g.car.x, g.car.y, g.car.z));
    const cm = 200 * here * Math.tan(g.camera.fov * Math.PI / 360) / document.getElementById('view').height;
    sc.eye = null;
    return { a, b, c, cm };
  `);
  keep('edge-with', r.a);
  keep('edge-without', r.b);
  const [A, B, C] = [r.a, r.b, r.c].map((u) => luma(fromURL(u)));
  const { w, h } = fromURL(r.a);
  const d = new Float32Array(w * h);
  const away = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) {
    d[i] = B[i] - A[i];
    // The car's own pixels: changed by taking the car out, and not by the shadow it casts.
    if (Math.abs(A[i] - C[i]) > 0.04 && Math.abs(A[i] - B[i]) < 0.01) away[i] = 1;
  }
  return { ...edgeWidth(d, w, h, away), w, h, cm: r.cm };
}

// What the posts of the guardrail cast within 20 m of the lens, as the frame with them casting is darker.
async function posts(page) {
  const r = await page.run(`
    const sc = window.__sc;
    sc.place(900, false, null);
    const a = sc.draw();
    const dist = sc.depth(160);
    sc.postsCast(false);
    const b = sc.draw();
    sc.postsCast(true);
    return { a, b, dist };
  `);
  keep('posts-with', r.a);
  keep('posts-without', r.b);
  const A = luma(fromURL(r.a));
  const B = luma(fromURL(r.b));
  const Z = metres(fromURL(r.dist), 160);
  let n = 0;
  let any = 0;
  for (let i = 0; i < A.length; i++) {
    if (Math.abs(A[i] - B[i]) > 0.01) any++;
    if (Z[i] < 20 && B[i] > 0.05 && A[i] < 0.85 * B[i]) n++;
  }
  return { n, any };
}

// The car's shadow, in a lens that goes with the car, frame after frame at 22 m/s: where its edge is on a few rows
// across it (the frame without the car casting less the frame with it, so that the ground's own grain is not in
// it), and how far that moves from one frame to the next.
async function drive(page) {
  const r = await page.run(`
    const sc = window.__sc;
    sc.place(5000, false, null);
    // The lens goes with the car, beside it on the side the sun is not, a little behind.
    const sun = g.atmosphere.sunDir;
    sc.eye = () => {
      const c = g.car;
      const fx = Math.cos(c.yaw), fz = Math.sin(c.yaw);
      let sx = -fz, sz = fx;
      if (sx * sun.x + sz * sun.z > 0) { sx = -sx; sz = -sz; }
      const x = c.x + sx * 8 - fx * 3, z = c.z + sz * 8 - fz * 3;
      g.camera.position.set(x, g.groundAt(x, z) + 1.8, z);
      g.camera.up.set(0, 1, 0);
      g.camera.lookAt(c.x, c.y + 0.6, c.z);
      g.camera.updateMatrixWorld();
    };
    for (let i = 0; i < 6; i++) { g.pilot.vMax = 22; g.update(1 / 60); sc.draw(); }
    const pairs = [];
    for (let i = 0; i < 24; i++) {
      g.pilot.vMax = 22;
      g.update(1 / 60);
      const a = sc.draw();
      sc.carCasts(false);
      const b = sc.draw();
      sc.carCasts(true);
      pairs.push([a, b]);
    }
    sc.carShown(false);
    const c = sc.draw();
    sc.carShown(true);
    sc.eye = null;
    return { pairs, c, speed: g.car.speed };
  `);
  keep('drive-first', r.pairs[0][0]);
  keep('drive-first-without', r.pairs[0][1]);
  keep('drive-last', r.pairs[r.pairs.length - 1][0]);
  const shadows = r.pairs.map(([a, b]) => {
    const A = luma(fromURL(a));
    const B = luma(fromURL(b));
    return A.map((v, i) => B[i] - v);
  });
  const { w, h } = fromURL(r.pairs[0][0]);
  const A0 = luma(fromURL(r.pairs[0][0]));
  const C = luma(fromURL(r.c));
  const car = new Float32Array(w * h);
  for (let i = 0; i < car.length; i++) if (Math.abs(A0[i] - C[i]) > 0.04 && Math.abs(shadows[0][i]) < 0.01) car[i] = 1;
  const near = blur(car, w, h, 12);
  const d = shadows[0];
  // The rows the shadow is in: those with a run of at least 30 pixels of it, away from the car.
  const lines = [];
  for (let y = 0; y < h; y += 3) {
    let best = null;
    let x = 0;
    while (x < w) {
      if (d[y * w + x] > 0.04 && near[y * w + x] < 0.002) {
        let x1 = x;
        while (x1 < w && d[y * w + x1] > 0.04) x1++;
        if (x1 - x >= 30 && x > 3 && x1 < w - 3 && (!best || x1 - x > best[1] - best[0])) best = [x, x1];
        x = x1;
      } else x++;
    }
    if (best) lines.push([y, best[0], best[1]]);
  }
  if (lines.length < 6) return { moved: null, lines: lines.length };
  const plateau = median(lines.map(([y, a, b]) => d[y * w + ((a + b) >> 1)]));
  // Where the shadow ends on each of those rows: the crossing of half its depth, either side of the middle of the run.
  const ends = (D) => lines.map(([y, a, b]) => {
    const row = (x) => D[y * w + x];
    const cross = (x0, step) => {
      for (let x = x0; x > 1 && x < w - 2; x += step) {
        if (row(x) < plateau / 2) return x - step + (step * (plateau / 2 - row(x - step))) / (row(x) - row(x - step) || 1);
      }
      return null;
    };
    return [cross((a + b) >> 1, 1), cross((a + b) >> 1, -1)];
  });
  const track = shadows.map(ends);
  const per = [];
  const all = [];
  for (let k = 1; k < track.length; k++) {
    const diffs = [];
    for (let i = 0; i < lines.length; i++) {
      for (const side of [0, 1]) {
        const p = track[k - 1][i][side];
        const q = track[k][i][side];
        if (p !== null && q !== null) diffs.push(Math.abs(p - q));
      }
    }
    if (diffs.length) {
      per.push(median(diffs));
      all.push(...diffs);
    }
  }
  all.sort((x, y) => x - y);
  return { moved: Math.max(...per), lines: lines.length, frames: per.length, mean: per.reduce((x, y) => x + y, 0) / per.length, p95: all[Math.floor(all.length * 0.95)] };
}

// The ground looked straight down on, over the near map's edge.
async function seam(page) {
  const r = await page.run(`
    const sc = window.__sc;
    const THREE = await import('three');
    sc.place(5000, false, null);
    const a = g.atmosphere;
    const cam = g.camera;
    const was = { fov: cam.fov, pos: cam.position.clone(), up: cam.up.clone(), q: cam.quaternion.clone(), vignette: g.post.final.uniforms.uVignette.value };
    const cx = g.car.x, cz = g.car.z;
    const top = g.groundAt(cx, cz) + 600;
    const T = 100 / 600;
    cam.fov = 2 * Math.atan(T) * 180 / Math.PI;
    cam.updateProjectionMatrix();
    sc.eye = () => { cam.position.set(cx, top, cz); cam.up.set(0, 0, -1); cam.lookAt(cx, 0, cz); cam.updateMatrixWorld(); g.post.final.uniforms.uVignette.value = 0; };
    const png = sc.draw();
    const canvas = document.getElementById('view');
    const W = canvas.width, H = canvas.height;
    const e = new Int16Array(W * H).fill(-32768);
    const aspect = cam.aspect;
    const m = a.sun.shadow.matrix;
    const half = a.cascades ? a.cascades[0].half : a.sun.shadow.camera.right;
    const v = new THREE.Vector3();
    for (let j = 1; j < H; j += 4) {
      for (let i = 1; i < W; i += 4) {
        const nx = ((i + 0.5) / W) * 2 - 1, ny = 1 - ((j + 0.5) / H) * 2;
        let x = cx, z = cz, y = g.groundAt(cx, cz);
        for (let k = 0; k < 2; k++) {
          const t = top - y;
          x = cx + nx * aspect * T * t;
          z = cz - ny * T * t;
          y = g.groundAt(x, z);
        }
        v.set(x, y, z).applyMatrix4(m);
        const edge = Math.min(v.x, 1 - v.x, v.y, 1 - v.y) * 2 * half;
        e[j * W + i] = Math.max(-32000, Math.min(32000, Math.round(edge * 100)));
      }
    }
    sc.eye = null;
    g.post.final.uniforms.uVignette.value = was.vignette;
    cam.fov = was.fov; cam.updateProjectionMatrix();
    cam.position.copy(was.pos); cam.up.copy(was.up); cam.quaternion.copy(was.q); cam.updateMatrixWorld();
    let bin = '';
    const u8 = new Uint8Array(e.buffer);
    for (let k = 0; k < u8.length; k += 8192) bin += String.fromCharCode.apply(null, u8.subarray(k, k + 8192));
    return { png, e: btoa(bin), W, H };
  `);
  keep('seam-top', r.png);
  const img = fromURL(r.png);
  const buf = Buffer.from(r.e, 'base64');
  const e = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  const Y = luma(img);
  const bins = new Map();
  for (let i = 0; i < Y.length; i++) {
    if (e[i] === -32768) continue;
    const m = e[i] / 100;
    if (m < -8 || m >= 8) continue;
    const k = Math.floor((m + 8) / 2);
    if (!bins.has(k)) bins.set(k, []);
    bins.get(k).push(Y[i]);
  }
  const keys = [...bins.keys()].sort((x, y) => x - y);
  const med = keys.map((k) => median(bins.get(k)));
  let worst = 0;
  for (let i = 1; i < med.length; i++) worst = Math.max(worst, Math.abs(med[i] - med[i - 1]) / Math.max(med[i - 1], 1e-3));
  return { worst, bins: keys.map((k, i) => [k * 2 - 8, +med[i].toFixed(4), bins.get(k).length]) };
}

// What a stone, a bush and a clump of grass leave: the frame with the small things casting, against without.
async function small(page) {
  const r = await page.run(`
    const sc = window.__sc;
    sc.place(5000, false, null);
    const a = sc.draw();
    const dist = sc.depth(160);
    const kinds = {};
    const meshes = [...g.clutter.meshes.values()];
    const was = meshes.map((m) => m.castShadow);
    for (const m of meshes) kinds[m.userData.kind] = m.castShadow;
    sc.clutterCasts(false);
    const b = sc.draw();
    meshes.forEach((m, i) => { m.castShadow = was[i]; });
    return { a, b, dist, kinds };
  `);
  keep('small-with', r.a);
  keep('small-without', r.b);
  const A = luma(fromURL(r.a));
  const B = luma(fromURL(r.b));
  const Z = metres(fromURL(r.dist), 160);
  let n = 0;
  for (let i = 0; i < A.length; i++) if (Z[i] < 30 && B[i] > 0.05 && A[i] < 0.9 * B[i]) n++;
  return { n, kinds: r.kinds };
}

// The far map in every style: in a run of frames in each, how many draw it, and the calls of a frame with it and of one
// without (the same place, the car going on at 22 m/s).
async function styles(page) {
  return page.run(`
    const sc = window.__sc;
    sc.place(5000, false, null);
    const out = {};
    for (const style of ['real', 'paint', 'ink', 'cel', 'print', 'pixel', 'block']) {
      if (g.style.id !== style) { g.style.set(style, true); g.style.applyScene(); }
      for (let i = 0; i < 40; i++) { g.pilot.vMax = 22; g.update(1 / 60); }
      for (let i = 0; i < 3; i++) { g.update(1 / 60); sc.draw(); }
      const a = g.atmosphere;
      let drawn = 0, now = false;
      const was = a._farDrawn.bind(a);
      a._farDrawn = () => { drawn++; now = true; was(); };
      const withFar = [], without = [];
      for (let i = 0; i < 8; i++) {
        g.pilot.vMax = 22;
        g.update(1 / 60);
        now = false;
        sc.draw();
        (now ? withFar : without).push(g.renderer.info.render.calls);
      }
      a._farDrawn = was;
      const mid = (v) => (v.length ? v.slice().sort((x, y) => x - y)[v.length >> 1] : null);
      out[style] = { drawn, with: mid(withFar), without: mid(without), used: g.atmosphere._farOn, mapped: !!g.atmosphere.sunFar.shadow.map };
    }
    return out;
  `);
}

// The contact shadow: what it makes of a frame, against the frame with it off.
async function contact(page) {
  const r = await page.run(`
    const sc = window.__sc;
    sc.place(5000, false, null);
    const a = sc.draw();
    const dist = sc.depth(200);
    g.post.setContact(false);
    const b = sc.draw();
    g.post.setContact(true);
    g.style.set('paint', true); g.style.applyScene();
    const c = sc.draw();
    g.post.setContact(false);
    const d = sc.draw();
    g.post.setContact(true);
    g.style.set('real', true); g.style.applyScene();
    return { a, b, c, d, dist, on: g.post.contact.enabled };
  `);
  keep('contact-on', r.a);
  keep('contact-off', r.b);
  const [A, B, Cc, D] = [r.a, r.b, r.c, r.d].map((u) => luma(fromURL(u)));
  const Z = metres(fromURL(r.dist), 200);
  let changed = 0;
  let far = 0;
  let sky = 0;
  let near = 0;
  let paint = 0;
  for (let i = 0; i < A.length; i++) {
    if (Math.abs(A[i] - B[i]) > 0.006) {
      changed++;
      if (Z[i] > 31) far++;
      if (Z[i] >= 199) sky++;
      if (Z[i] <= 30) near++;
    }
    if (Math.abs(Cc[i] - D[i]) > 0.006) paint++;
  }
  return { changed, far, sky, near, paint, on: r.on };
}

// ---------------------------------------------------------------------------------

// The checks on the page the server serves. `old`: a tree that has no second map and no contact shadow, of which
// the frame says what it says.
async function suite(old) {
  const page = await openPage('seed=7&world=hills&s=5000&cam=chase&style=real&run=60&farshadow=alt');
  try {
    await page.run(INIT);
    if (!old && want('maps')) {
      const m = await maps(page);
      check('near map', m.near.half === 35 && m.near.size === 2048 && m.near.mapped, `${m.near.size} texels over ${m.near.half * 2} m (${num(m.near.half * 2 / m.near.size * 100, 2)} cm)`);
      check('far map', m.far.on && m.far.half === 180 && m.far.size === 2048 && m.far.mapped, `${m.far.size} texels over ${m.far.half * 2} m (${num(m.far.half * 2 / m.far.size * 100, 2)} cm)`);
      check('maps stand on a lattice of texels', m.holds <= LIMIT.lattice, `a point of the land moves ${num(m.holds, 5)} of a texel in the maps in 24 frames of the drive (the most it may: ${LIMIT.lattice})`);
      check('the matrix between the maps', m.matrix < 1e-4, `a point in the near map's coordinates takes the far map's to ${num(m.matrix, 7)}`);
      check('far map as its centre moves on', m.drawn[0] >= 1 && m.drawn[0] <= 4, `drawn in ${m.drawn[0]} of ${m.drawn[1]} frames (the high tier, 22 m/s: again every 8 m, 1 to 4)`);
      console.log(`      the near map's pass draws ${JSON.stringify(m.draws[0])} a frame (${m.tris[0]} triangles), the far map's ${JSON.stringify(m.draws[1])} (${m.tris[1]} triangles)`);
      check('draw calls of the far map', m.calls[0] !== null && m.calls[1] !== null && m.calls[0] - m.calls[1] <= LIMIT.calls, `${m.calls[0]} calls in the middle one of the frames with it, ${m.calls[1]} without (at most ${LIMIT.calls} more)`);
      check('contact shadow in the high tier', m.contact === true, `the pass is ${m.contact ? 'on' : 'off'}`);
      const t = await tiers(page);
      check('mid tier', t.mid.tier === 'mid' && t.mid.drawn <= 4 && t.mid.farMapped && !t.mid.contact && t.mid.nearSize === 2048, `far map drawn in ${t.mid.drawn} of 12 frames (at most every third), contact ${t.mid.contact ? 'on' : 'off'}`);
      check('low tier', t.low.tier === 'low' && t.low.drawn === 0 && !t.low.farOn && t.low.farUsed === 0 && !t.low.contact && t.low.nearSize === 1024 && t.low.nearHalf === 90,
        `one map of ${t.low.nearSize} texels over ${t.low.nearHalf * 2} m, the far map ${t.low.farOn ? 'on' : 'off'}, contact ${t.low.contact ? 'on' : 'off'}`);
      check('back to high', t.high.tier === 'high' && t.high.contact && t.high.nearSize === 2048 && t.high.farUsed === 1, `contact ${t.high.contact ? 'on' : 'off'}, far map ${t.high.farUsed ? 'used' : 'not used'}`);
    }
    if (!old && want('styles')) {
      try {
        const t = await styles(page);
        const line = Object.entries(t).map(([k, v]) => `${k} ${v.drawn} of 8 (${v.with} calls, ${v.without} without)`).join(', ');
        const others = Object.entries(t).filter(([k]) => k !== 'block').map(([, v]) => v);
        check('the far map in every style but the block', others.length === 6 && others.every((v) => v.used && v.mapped && v.drawn <= 2), `frames that draw it, of 8: ${line}`);
        check('the block style draws no far map', !!t.block && !t.block.used && t.block.drawn === 0, `${t.block ? t.block.drawn : '?'} of 8 frames draw it, and it is ${t.block && t.block.used ? 'on' : 'off'}`);
      } catch (e) {
        check('the far map in every style but the block', false, `not measured: ${String(e.message).slice(0, 200)}`);
      }
    }
    if (want('edge')) {
      const e = await edge(page);
      check('edge of the car shadow', e.width !== null && e.n >= 20 && e.width <= LIMIT.edge, `${num(e.width, 2)} px (${num(e.width * e.cm, 1)} cm at the car, a pixel being ${num(e.cm, 2)} cm) from a tenth to nine tenths, at ${e.n} places (at most ${LIMIT.edge} px)`);
    }
    if (want('small')) {
      const m = await small(page);
      const k = m.kinds;
      check('shadows of the small things', m.n >= LIMIT.small && (old || (k.tuft && k.bush && k.log && k.rock && !k.flower && !k.mushroom)), `${m.n} pixels within 30 m are 10 % darker for what lies on the ground casting (at least ${LIMIT.small}); casting: ${Object.entries(m.kinds).map(([k, v]) => `${k} ${v ? 'yes' : 'no'}`).join(', ')}`);
    }
    if (want('drive')) {
      const d = await drive(page);
      check('the car shadow in a drive', d.moved !== null && d.moved <= LIMIT.jitter, `its edge moves at most ${num(d.moved, 2)} px from one frame to the next (mean ${num(d.mean, 2)}, 95th ${num(d.p95, 2)}, ${d.frames} pairs, ${d.lines} rows; at most ${LIMIT.jitter})`);
    }
    if (want('seam')) {
      const s = await seam(page);
      check('the seam', s.worst <= LIMIT.seam, `the ground's brightness differs by ${num(s.worst * 100, 2)} % between two 2 m bins at most across the near map's edge (at most ${LIMIT.seam * 100} %); ${s.bins.map(([m, v]) => `${m}:${v}`).join(' ')}`);
    }
    if (!old && want('contact')) {
      const c = await contact(page);
      check('contact shadow', c.changed > 200 && c.far === 0 && c.sky === 0 && c.paint === 0, `${c.changed} pixels change, ${c.near} within 30 m, ${c.far} beyond it, ${c.sky} in the sky; ${c.paint} change in the paint style`);
    }
    check('the page makes no errors', page.logs.length === 0, page.logs.length ? page.logs.slice(0, 3).join(' | ') : 'none, in the console or as an exception');
  } finally {
    page.close();
  }
  if (want('posts')) {
    // The guardrail is on the mountain road: a page of its own.
    const alpine = await openPage('seed=7&world=alpine&s=900&cam=chase&style=real&run=60&farshadow=alt');
    try {
      await alpine.run(INIT);
      const p = await posts(alpine);
      check('shadows of the posts', p.n >= LIMIT.posts, `${p.n} pixels within 20 m are 15 % darker for the posts' shadows (at least ${LIMIT.posts}), ${p.any} pixels change`);
      check('the alpine page makes no errors', alpine.logs.length === 0, alpine.logs.length ? alpine.logs.slice(0, 3).join(' | ') : 'none');
    } finally {
      alpine.close();
    }
  }
}

// A headless run draws the far map in every frame (farshadow=alt in the address asks for the page's own cadence, which
// the other pages here have): of twelve frames of the drive, how many have it, and its calls in each.
async function headless() {
  const page = await openPage('seed=7&world=hills&s=5000&cam=chase&style=real&run=60');
  try {
    await page.run(INIT);
    const r = await page.run(`
      const sc = window.__sc;
      sc.place(5000, false, null);
      const a = g.atmosphere;
      let drawn = 0;
      const was = a._farDrawn.bind(a);
      a._farDrawn = () => { drawn++; was(); };
      const calls = [];
      for (let i = 0; i < 12; i++) {
        g.pilot.vMax = 22;
        g.update(1 / 60);
        sc.draw();
        calls.push(g.renderer.info.render.calls);
      }
      a._farDrawn = was;
      return { drawn, calls, always: a._farAlways };
    `);
    check('a headless run draws the far map in every frame', r.always === true && r.drawn === 12 && Math.max(...r.calls) - Math.min(...r.calls) <= 12, `${r.drawn} of 12 frames, ${Math.min(...r.calls)} to ${Math.max(...r.calls)} calls a frame`);
    check('the headless page makes no errors', page.logs.length === 0, page.logs.length ? page.logs.slice(0, 3).join(' | ') : 'none');
  } finally {
    page.close();
  }
}

async function main() {
  const server = serve();
  let code = 0;
  try {
    if (!(await waitForServer())) throw new Error('the dev server did not come up');
    await suite(OLD);
    if (!OLD && want('headless')) await headless();
    code = failed ? 1 : 0;
    console.log(failed ? `\nFAILED: ${failed} of ${results.length}` : `\nOK: ${results.length} checks held`);
  } catch (e) {
    console.error(e);
    code = 2;
  } finally {
    await stop(server);
  }
  if (opt('--write', null)) writeFileSync(opt('--write'), JSON.stringify(results, null, 1) + '\n');
  if (AGAINST && code < 2) {
    // The frame checks again on the other tree (an older build's export), for the numbers to stand beside: what
    // they find is printed, and held to nothing.
    console.log(`\nthe frame checks on ${AGAINST} (the numbers there; held to nothing):`);
    beside = true;
    const other = serve(AGAINST);
    try {
      if (!(await waitForServer())) throw new Error('the dev server did not come up');
      await suite(true);
    } catch (e) {
      console.log(`  (the other tree: ${e.message})`);
    } finally {
      await stop(other);
    }
    if (opt('--write', null)) writeFileSync(opt('--write').replace(/(\.json)?$/, '-against.json'), JSON.stringify(others, null, 1) + '\n');
  }
  await sleep(300);
  process.exit(code);
}

if (process.argv[1] === new URL(import.meta.url).pathname) await main();
