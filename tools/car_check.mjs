// The car of the real style (render/carlook.js), seen close and held to numbers.
//
// Runs the real page headless in the hills (the real style, at the tier asked for), puts the car on the
// road as tools/look.mjs does and takes frames of it from the places a lens may be: the chase lens, one low
// behind the car, one in front of it, one at its side, one over its cabin, one at a wheel, one at a lamp, one
// close over the hood, and the hood lens. It says what each frame holds of the car (its brightest hundredth,
// its tones, the glass's tones) and writes the frames, and the same frame with one thing taken off (the
// heat, the cabin, the flakes, the brake), to --keep (a directory). Besides, it holds the car to:
//  - the shaders: the programs of the paint, the glass, the tyres and the discs have the flakes, the
//    reflection, the lettering and the brushing in them;
//  - the materials: in the real style the paint is a base coat of 0.5 metal and 0.35 roughness under a
//    clear coat of 0.04, the glass holds back 0.4 and the lamps are lit as the day has them; in every other
//    style the materials have the numbers the style gives them, every number the shaders read is 0 and the
//    heat is not drawn; the middle tier has all of it, the low tier the clear coat, the glass and the lamps;
//  - the flakes: at a metre they move the light of a good part of the paint, at 6 m not a pixel; the same
//    frame drawn twice is the same pixel for pixel; the program reads the strength and the turn it is given
//    (turned up forty times the frame moves far more);
//  - the cabin: seen through the glass, the glass has tones, and over the greater part of it is different
//    without the cabin;
//  - the lamps: the tail lamps' light is three times as much braking as cruising and the bloom of the frame
//    takes it beyond the lamp; the head lamps by day are less lit than in the dark;
//  - the heat: drawn within 30 m of the lens with the car afloat, fading from 20 m, for two draws more; it
//    changes the frame only in and about its patch and takes a pixel from no further than 2 pixels (in a
//    frame 1080 tall), measured on a picture of ramps; it is drawn in no other style and not at the low tier;
//  - dispose: a CarLook let go of leaves no texture or geometry behind, and the frame is drawn after it;
//  - the page logs no error.
// Times are written, not asserted (the machine is shared).
//
// Usage: node tools/car_check.mjs [--check] [--look] [--keep out/car] [--against DIR] [--poses chase,rear,...]
//          [--tier high|mid|low] [--gpu]
//   --check    exit 1 when one of the above is not so
//   --look     the frames only, none of the above (for a tree that has no CarLook)
//   --against  the same frames of the tree in DIR (an export of a commit, git archive), in <keep>-before
// PORT=8199 moves the server it starts (and PORT+1 the one --against starts), to run beside another check.
// CHROME=/path/to/chrome overrides the browser. CAR_ROOT=dir serves another tree in place of this one.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { deflateSync, inflateSync } from 'node:zlib';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const has = (name) => args.includes(name);
const GPU = has('--gpu');
const CHECK = has('--check');
// --look: only the frames and their numbers, none of the assertions (for a tree that has no CarLook to ask).
const LOOK = has('--look');
// --against DIR: the same frames of the tree in DIR (an export of an earlier commit) as well.
const AGAINST = opt('--against', null) ? opt('--against').replace(/\/?$/, '/') : null;
const KEEP = opt('--keep', null);
const TIER = opt('--tier', 'high');

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8209;
const HERE = new URL('..', import.meta.url).pathname;
// CAR_ROOT=dir serves another tree (an export of an earlier commit), to take its frames to set beside.
const ROOT = (process.env.CAR_ROOT || HERE).replace(/\/?$/, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The lenses, in metres in the car's own frame (x along the nose, y up, z to its right): where it is, what it
// looks at; still: the car stands (its wheels down), else it is afloat at 22 m/s.
// variants: the same frame again with one thing changed, written beside it (and the difference, six times over).
const POSES = {
  chase: { still: false, variants: ['nocabin'] },
  rear: { still: false, at: [-6.0, 1.7, 0.7], look: [-1.0, 0.7, 0.0], variants: ['nohaze', 'brake'] },
  rearLow: { still: false, at: [-6.4, 0.9, 0.6], look: [-2.9, 0.5, 0.0], variants: ['nohaze', 'brake'] },
  front: { still: true, at: [4.6, 1.3, 3.2], look: [0.6, 0.6, 0.0], variants: ['metal02'] },
  side: { still: true, at: [0.2, 1.0, 4.6], look: [0.0, 0.7, 0.0], variants: ['nocabin'] },
  cabin: { still: true, at: [-2.6, 2.4, 1.8], look: [0.1, 0.9, 0.0], variants: ['nocabin'] },
  wheel: { still: true, at: [1.4, 0.55, -2.1], look: [1.35, 0.34, -0.8] },
  lamp: { still: true, at: [3.4, 0.75, -1.3], look: [2.1, 0.62, -0.5], variants: ['night'] },
  paintNear: { still: true, at: [1.55, 1.2, 0.75], look: [1.0, 0.78, 0.0], variants: ['noflake'] },
  hood: { still: false, hood: true },
};
const poses = opt('--poses', Object.keys(POSES).join(',')).split(',').filter((p) => POSES[p]);

function serve(port = PORT, root = ROOT) {
  return spawn('node', [HERE + 'tools/serve.mjs', String(port), root], { stdio: ['ignore', 'ignore', 'inherit'] });
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

// The page, headless, and a way to run code in it; what the page logs as an error comes back with it.
async function openPage(query, port = PORT) {
  const profile = `${tmpdir()}/continuum-car-${process.pid}-${Date.now()}`;
  const how = GPU
    ? ['--ignore-gpu-blocklist', '--enable-gpu', process.platform === 'darwin' ? '--use-angle=metal' : '--use-angle=vulkan']
    : ['--disable-gpu', '--enable-unsafe-swiftshader'];
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', ...how, '--mute-audio', '--hide-scrollbars',
    `--window-size=${GPU ? '1920,1223' : '1280,720'}`, '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    `http://localhost:${port}/index.html?${query}`], { stdio: ['ignore', 'ignore', 'pipe'], env: CHROME_ENV });
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
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
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

// ---- in the page ----------------------------------------------------------------------------------

// The car put on the road at s and run for two and a half seconds, as tools/look.mjs puts it down; the lens
// behind it, still. Afloat (22 m/s), or standing with its wheels down.
const PLACE = (s, still) => `
  const p = g.road.at(${s});
  if (!p) return { error: 'no road at ${s}' };
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
  return { style: g.style.id, afloat: +g.presentation.liftAmount.toFixed(2) };
`;

// What every in-page measure starts with: the frame, the pixels of it, and the lens put where the pose says.
const KIT = (pose) => `
  const THREE = await import('three');
  const r = g.renderer;
  const gl = r.getContext();
  const canvas = document.getElementById('view');
  const W = gl.drawingBufferWidth;
  const H = gl.drawingBufferHeight;
  const N = W * H;
  const pose = ${JSON.stringify(pose)};
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
  const model = g.carModel;
  const P = (a) => { model.updateMatrixWorld(true); return new THREE.Vector3(a[0] * 1000, a[1] * 1000, a[2] * 1000).applyMatrix4(model.matrixWorld); };
  const eye = () => {
    if (!pose.at) return;
    g.camera.position.copy(P(pose.at));
    g.camera.up.set(0, 1, 0);
    g.camera.lookAt(P(pose.look));
    g.camera.fov = pose.fov || 45;
    g.camera.updateProjectionMatrix();
    g.camera.updateMatrixWorld();
  };
  if (pose.hood) { g.chase.snapFraming('hood'); g.update(1 / 60); }
  const frame = () => { eye(); for (const o of hidden) o.visible = false; g.render(); };
  const grab = () => {
    frame();
    const px = new Uint8Array(N * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const png = () => { frame(); return canvas.toDataURL('image/png'); };
  // How much two grabs differ over a mask (none: everywhere), by the luma of the picture: the pixels that differ at
  // all, the ones that differ by more than \`by\` of the range, the mean and the most.
  const stats = (a, b, mask, by = 0.01) => {
    let count = 0, any = 0, over = 0, sum = 0, max = 0;
    for (let i = 0; i < N; i++) {
      if (mask && !mask[i]) continue;
      count++;
      const dr = a[i * 4] - b[i * 4], dg = a[i * 4 + 1] - b[i * 4 + 1], db = a[i * 4 + 2] - b[i * 4 + 2];
      if (dr || dg || db) any++;
      const d = Math.abs(dr * 0.2126 + dg * 0.7152 + db * 0.0722) / 255;
      sum += d;
      if (d > by) over++;
      if (d > max) max = d;
    }
    return { count, any, over, mean: count ? sum / count : 0, max };
  };
  const part = (name) => { let o = null; model.traverse((m) => { if (m.name === name) o = m; }); return o; };
  const carMeshes = []; model.traverse((m) => { if (m.isMesh) carMeshes.push(m); });
`;

// The pixels that are the car's, the glass's (drawn alone, as if it were not blended, to see where it is in front of
// what the frame has), and a part's: the depth of the scene drawn with only that part visible, against the depth of the
// scene (the glass writes none): the pixels that have the same one. As tools/look.mjs does for the car.
const MASKS = `
  const { FullScreenQuad } = await import('./tools/vendor/postprocessing/Pass.js');
  const w = g.post.size.x, h = g.post.size.y;
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(w, h) });
  const enc = new THREE.WebGLRenderTarget(w, h);
  const quad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tDepth: { value: rt.depthTexture }, uNF: { value: new THREE.Vector2(g.camera.near, g.camera.far) } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: [
      'precision highp float;',
      'uniform sampler2D tDepth; uniform vec2 uNF; varying vec2 vUv;',
      'void main() {',
      '  float d = texture2D(tDepth, vUv).r;',
      '  float z = uNF.x * uNF.y / (uNF.y - d * (uNF.y - uNF.x));',
      '  float v = d >= 0.999995 ? 1.0 : clamp(log2(1.0 + z) / log2(1.0 + uNF.y), 0.0, 0.99998);',
      '  float a = floor(v * 65535.0 + 0.5);',
      '  gl_FragColor = vec4(mod(a, 256.0) / 255.0, floor(a / 256.0) / 255.0, 0.0, 1.0);',
      '}'].join('\\n'),
    depthTest: false, depthWrite: false }));
  const kids = g.scene.children.slice();
  const vis = kids.map((k) => k.visible);
  const meshVis = carMeshes.map((m) => m.visible);
  const auto = r.shadowMap.autoUpdate;
  const depthOf = (only) => {
    // only: the names of the car's parts that are drawn (none given: all), and nothing else in the scene.
    kids.forEach((k, i) => { k.visible = vis[i] && (!only || k.isLight || k === g.presentation.root); });
    carMeshes.forEach((m, i) => { m.visible = meshVis[i] && (!only || only.includes(m.name)); });
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(rt);
    r.clear();
    eye();
    r.render(g.scene, g.camera);
    r.setRenderTarget(enc);
    quad.render(r);
    const buf = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(enc, 0, 0, w, h, buf);
    const out = new Uint16Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = buf[i * 4] | (buf[i * 4 + 1] << 8);
    kids.forEach((k, i) => { k.visible = vis[i]; });
    carMeshes.forEach((m, i) => { m.visible = meshVis[i]; });
    r.shadowMap.autoUpdate = auto;
    r.setRenderTarget(null);
    return out;
  };
  const hazeWas = g.carLook && g.carLook.haze ? g.carLook.haze.mesh.visible : false;
  if (g.carLook && g.carLook.haze) g.carLook.haze.mesh.visible = false;
  const glassMat = carMeshes.filter((m) => m.name === 'car_glass').map((m) => m.material);
  const all = depthOf(null);
  const body = depthOf(carMeshes.map((m) => m.name).filter((n) => n !== 'car_glass'));
  glassMat.forEach((m) => { m.userData.was = [m.transparent, m.depthWrite, m.opacity]; m.transparent = false; m.depthWrite = true; m.opacity = 1; m.needsUpdate = true; });
  const glassD = depthOf(['car_glass']);
  glassMat.forEach((m) => { [m.transparent, m.depthWrite, m.opacity] = m.userData.was; m.needsUpdate = true; });
  if (g.carLook && g.carLook.haze) g.carLook.haze.mesh.visible = hazeWas;
  const maskCar = new Uint8Array(N);
  const maskGlass = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (body[i] !== 65535 && body[i] === all[i]) maskCar[i] = 1;
    if (glassD[i] !== 65535 && glassD[i] + 8 < all[i]) maskGlass[i] = 1;
  }
  rt.depthTexture.dispose(); rt.dispose(); enc.dispose(); quad.dispose();
`;

// ---- in node: the numbers of a picture --------------------------------------------------------

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

// RGBA bytes to a PNG.
function encodePNG(w, h, rgba) {
  const crcTable = encodePNG.t || (encodePNG.t = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  const crc = (b) => {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const fromURL = (url) => decodePNG(Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64'));
const fromB64 = (s) => Uint8Array.from(Buffer.from(s, 'base64'));

const LIN = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

// A picture in OKLab (L 0 to 1, a green to red, b blue to yellow).
function toLab(img) {
  const n = img.w * img.h;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  const d = img.data;
  for (let i = 0; i < n; i++) {
    const r = LIN[d[i * 4]];
    const g = LIN[d[i * 4 + 1]];
    const b = LIN[d[i * 4 + 2]];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    L[i] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    A[i] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    B[i] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  }
  return { w: img.w, h: img.h, n, L, A, B };
}

const round = (v, k = 4) => (v === null || v === undefined || Number.isNaN(v) ? null : +v.toFixed(k));

// What a region of a picture holds: its share of the frame, its brightest hundredth (L99), how many colours it takes to
// fill nine tenths of it (tones: a cell is 0.04 of L and 0.03 of a and b, as tools/look.mjs counts them), and its mean.
// The rows are top down in the picture and bottom up in what the page reads from the buffer: `up` says so.
function regionOf(lab, mask, up = false) {
  const { w, h, n, L, A, B } = lab;
  const pick = (i) => (up ? ((h - 1 - Math.floor(i / w)) * w + (i % w)) : i);
  let count = 0;
  let sum = 0;
  const ls = [];
  const cells = new Map();
  for (let i = 0; i < n; i++) {
    const j = pick(i);
    if (!mask[j]) continue;
    count++;
    sum += L[i];
    ls.push(L[i]);
    const key = ((L[i] / 0.04) | 0) * 4096 + (((A[i] + 0.5) / 0.03) | 0) * 64 + (((B[i] + 0.5) / 0.03) | 0);
    cells.set(key, (cells.get(key) || 0) + 1);
  }
  if (!count) return { count: 0, share: 0, L: null, L99: null, tones: 0 };
  ls.sort((a, b) => a - b);
  const counts = [...cells.values()].sort((a, b) => b - a);
  let tones = 0;
  for (let acc = 0; acc < count * 0.9; tones++) acc += counts[tones];
  return { count, share: round(count / n, 5), L: round(sum / count), L99: round(ls[Math.min(ls.length - 1, Math.floor(0.99 * (ls.length - 1)))]), tones };
}

// How many pixels of a mask differ between two pictures by more than `by` of L, and the mean of how much (all in the
// mask), of the same-sized RGBA bytes read from the page (bottom up).
function differ(a, b, mask, by = 0.02) {
  const la = toLab({ w: a.w, h: a.h, data: a.data });
  const lb = toLab({ w: b.w, h: b.h, data: b.data });
  let count = 0;
  let over = 0;
  let sum = 0;
  let max = 0;
  for (let i = 0; i < la.n; i++) {
    if (mask && !mask[i]) continue;
    count++;
    const d = Math.abs(la.L[i] - lb.L[i]);
    sum += d;
    if (d > by) over++;
    if (d > max) max = d;
  }
  return { count, over, share: count ? round(over / count) : 0, mean: count ? round(sum / count, 5) : 0, max: round(max) };
}

// The bytes the page reads (rows bottom up) as a picture the way it is looked at (rows top down).
function flipped(px, w, h) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  return { w, h, data: out };
}
const flipMask = (m, w, h) => {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) out.set(m.subarray((h - 1 - y) * w, (h - y) * w), y * w);
  return out;
};

// ---- what is held to ------------------------------------------------------------------------

// The numbers the check holds the frames to; each is said where it is used.
const LIMITS = {
  flake: { near: 0.02, far: 0 },        // the share of the paint's pixels a flake moves by 1% of the light at a metre, and at 6 m
  glass: { tones: 12, seen: 0.4 },      // how many tones the glass of a close frame has, and the share of it that is different without the cabin
  lamp: { glow: 30, day: 0.9 },         // the pixels beyond the lamp the brake's bloom lights, and the most the head lamps' light is by day, against the dark's
  haze: { calls: 2, bend: 2 },          // the draws it costs (the copy and the patch), and the most it bends the frame (pixels in a frame 1080 tall)
};

// ---- in the page: one thing after another, as the check says ---------------------------------------

const STATE = `
  const cl = g.carLook;
  if (!cl) return { error: 'the page has no carLook' };
  const one = (n) => (cl.by[n] || [])[0];
  const state = () => ({
    paint: ['metalness', 'roughness', 'clearcoat', 'clearcoatRoughness'].map((k) => +one('paint')[k].toFixed(3)),
    glass: [+one('glass').opacity.toFixed(3), +one('glass').envMapIntensity.toFixed(3)],
    lamp: +one('head_light').emissiveIntensity.toFixed(3),
    cabin: +one('leather').emissiveIntensity.toFixed(3),
    u: [cl.u.uFlake.value, cl.u.uTyre.value, cl.u.uBrush.value, cl.u.uGlass.value],
    haze: [cl.haze.mesh.visible, +cl.haze.power.toFixed(3)],
  });
`;

// What the materials come to in each style, and (afloat, in the real style) in each tier.
const STYLES_AND_TIERS = `${STATE}
  const out = { real: state() };
  for (const id of ['paint', 'ink', 'cel', 'print', 'pixel', 'block']) {
    g.style.set(id, true);
    g.style.applyScene();
    g.update(1 / 60);
    out[id] = state();
  }
  g.style.set('real', true);
  g.style.applyScene();
  for (let i = 0; i < 90; i++) { g.pilot.vMax = 22; g.update(1 / 60); }
  out.back = state();
  for (const tier of ['mid', 'low', 'high']) {
    g.setTier(tier);
    for (let i = 0; i < 90; i++) { g.pilot.vMax = 22; g.update(1 / 60); }
    out[tier] = { ...state(), tier: g.tier };
  }
  return out;
`;

// The flakes at a metre and at six: the frame with them and without them over the paint.
const FLAKES = (pose) => `${KIT(pose)}
  frame();
  ${MASKS}
  const A = grab();
  g.carLook.u.uFlake.value = 0;
  const B = grab();
  g.carLook.u.uFlake.value = 1;
  const again = grab();
  const rot = g.carLook.u.uFlakeRot.value.elements.map((x) => +x.toFixed(3));
  // The strength turned right up, to see whether the shader reads it at all.
  g.carLook.u.uFlake.value = 40;
  const loud = grab();
  g.carLook.u.uFlake.value = 1;
  const mat = g.carLook.by.paint[0];
  const props = g.renderer.properties.get(mat);
  const wired = { uniform: !!props.uniforms && props.uniforms.uFlake === g.carLook.u.uFlake, rot: !!props.uniforms && props.uniforms.uFlakeRot === g.carLook.u.uFlakeRot,
    inProgram: !!props.currentProgram && props.currentProgram.getUniforms().map.uFlake !== undefined, materials: g.carLook.by.paint.length };
  return { paint: stats(A, B, maskCar), loud: stats(A, loud, maskCar), steady: stats(A, again, maskCar).any, uFlake: g.carLook.u.uFlake.value, rot, wired, hook: !!part('car_paint').onBeforeRender, distance: +g.camera.position.distanceTo(part('car_paint').getWorldPosition(new THREE.Vector3())).toFixed(2) };
`;

// The cabin through the glass: the frame, and the frame with the cabin's parts not drawn, over the glass.
const CABIN = (pose) => `${KIT(pose)}
  frame();
  ${MASKS}
  const A = grab();
  const parts = ['car_leather', 'car_alcantara', 'car_carpet'].map(part).filter(Boolean);
  parts.forEach((o) => { o.visible = false; });
  const B = grab();
  parts.forEach((o) => { o.visible = true; });
  const G = stats(A, B, maskGlass, 0.02);
  return { glass: G, parts: parts.length, glassPixels: maskGlass.reduce((a, b) => a + b, 0) };
`;

// The lamps: the tail lamps' light at rest and with the brake, and what the bloom lights beyond the lamp; the
// head lamps' light by day and in the dark.
const LAMPS = (pose, front) => `${KIT(pose)}
  frame();
  const lampName = ${JSON.stringify(front ? 'car_head_light' : 'car_tail_light')};
  const tail = g.tailLight;
  const out = { tail: tail ? tail.emissiveIntensity : null };
  const set = (v) => { if (tail) tail.emissiveIntensity = v; };
  const day = (lamps) => g.carLook.update(1 / 60, { real: 1, lamps, lift: 1, throttle: 0, time: 0, blinking: false, camera: g.camera });
  if (!${front ? 'true' : 'false'}) {
    set(2);
    const idle = grab();
    const lamp = part(lampName);
    lamp.visible = false;
    const gone = grab();
    lamp.visible = true;
    set(6);
    const braked = grab();
    set(2);
    const own = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (Math.abs(idle[i * 4] - gone[i * 4]) + Math.abs(idle[i * 4 + 1] - gone[i * 4 + 1]) > 6) own[i] = 1;
    // beyond the lamp: the pixels the brake's light reaches that are not the lamp's.
    const beyond = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (!own[i]) beyond[i] = 1;
    const d = stats(idle, braked, beyond, 0.004);
    out.lampPixels = own.reduce((a, b) => a + b, 0);
    out.beyond = d;
    out.ratio = tail ? 6 / 2 : null;
  } else {
    day(0);
    const lit = { day: grab() };
    day(1);
    lit.night = grab();
    day(0);
    const lamp = part(lampName);
    lamp.visible = false;
    const gone = grab();
    lamp.visible = true;
    const own = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (Math.abs(lit.day[i * 4] - gone[i * 4]) + Math.abs(lit.day[i * 4 + 1] - gone[i * 4 + 1]) + Math.abs(lit.day[i * 4 + 2] - gone[i * 4 + 2]) > 6) own[i] = 1;
    out.lampPixels = own.reduce((a, b) => a + b, 0);
    out.dayVsNight = stats(lit.day, lit.night, own, 0.02);
    out.emissive = { day: g.carLook.by.head_light[0].emissiveIntensity };
    const luma = (a, m) => { let s = 0, n = 0, mx = 0; for (let i = 0; i < N; i++) if (m[i]) { const y = (a[i * 4] * 0.2126 + a[i * 4 + 1] * 0.7152 + a[i * 4 + 2] * 0.0722) / 255; s += y; n++; if (y > mx) mx = y; } return { mean: n ? s / n : 0, max: mx }; };
    out.lumaDay = luma(lit.day, own);
    out.lumaNight = luma(lit.night, own);
  }
  return out;
`;

// The heat behind the thrusters: the patch and the frame without it, where they differ, and how far a pixel is
// taken from; the draws it costs; and whether it is drawn at 5 m, 25 m and 35 m from the lens.
const HAZE = (pose) => `${KIT(pose)}
  const hz = g.carLook.haze;
  for (let i = 0; i < 90; i++) { g.pilot.vMax = 22; g.update(1 / 60); }
  frame();
  ${MASKS}
  const out = { visible: hz.mesh.visible, heat: +hz.power.toFixed(3) };
  const on = grab();
  out.power = +hz.uniforms.uPower.value.toFixed(3);
  out.callsOn = r.info.render.calls;
  out.rect = hz.uniforms.uRect.value.toArray();
  out.uOn = hz.uniforms.uOn.value;
  out.taken = hz.taken;
  hz.mesh.visible = false;
  const off = grab();
  out.callsOff = r.info.render.calls;
  hz.mesh.visible = true;
  // Where the two frames differ: inside the patch, and outside it by more than the later passes (the bloom, the edges
  // cleaned, the detail sharpened) take of a neighbour: a few levels of the 255, further than 40 pixels off.
  const [rx, ry, rw, rh] = out.rect;
  let changed = 0, outside = 0, far = 0;
  const reach = 40;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const d = Math.max(Math.abs(on[i * 4] - off[i * 4]), Math.abs(on[i * 4 + 1] - off[i * 4 + 1]), Math.abs(on[i * 4 + 2] - off[i * 4 + 2]));
      if (!d) continue;
      changed++;
      const inside = x >= rx && x < rx + rw && y >= ry && y < ry + rh;
      if (!inside) outside++;
      if (d > 3 && (x < rx - reach || x >= rx + rw + reach || y < ry - reach || y >= ry + rh + reach)) far++;
    }
  }
  out.changed = changed; out.outside = outside; out.far = far;
  // Where it is drawn: by distance from the lens, with the lens put that far behind the car and the patch asked to draw
  // into the frame the chain draws the scene into.
  const { CAR_LOOK } = await import('./src/render/carlook.js');
  g.carModel.updateMatrixWorld(true);
  const at = new THREE.Vector3(...CAR_LOOK.haze.at).applyMatrix4(g.carModel.matrixWorld);
  const keep = g.camera.position.clone();
  out.reach = {};
  for (const d of [5, 20, 25, 29, 31, 35]) {
    g.camera.position.set(at.x - d, at.y + 0.5, at.z);
    g.camera.lookAt(at);
    g.camera.updateMatrixWorld();
    g.camera.matrixWorldInverse.copy(g.camera.matrixWorld).invert();
    r.setRenderTarget(g.post.composer.renderTarget1);
    hz._before(r, g.camera);
    r.setRenderTarget(null);
    out.reach[d] = [hz.uniforms.uOn.value, +hz.uniforms.uPower.value.toFixed(3)];
  }
  g.camera.position.copy(keep);
  g.camera.updateMatrixWorld();
  hz.update(1 / 60, 1, 0, true);
  out.offVisible = hz.mesh.visible;
  return out;
`;

// How far the patch takes a pixel from, measured on its own: it draws a picture of two ramps (red grows by a pixel to a
// pixel across, green up) in a target of the same size, at full power, and what each pixel of it holds is where it was taken from.
const BEND = `
  const THREE = await import('three');
  const hz = g.carLook.haze;
  const r = g.renderer;
  const n = 128;
  const half = new Uint16Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4;
    half[i] = THREE.DataUtils.toHalfFloat(x / n);
    half[i + 1] = THREE.DataUtils.toHalfFloat(y / n);
    half[i + 2] = 0;
    half[i + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const ramp = new THREE.DataTexture(half, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
  ramp.minFilter = ramp.magFilter = THREE.LinearFilter;
  ramp.needsUpdate = true;
  const rt = new THREE.WebGLRenderTarget(n, n, { type: THREE.HalfFloatType, depthBuffer: false });
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(hz.geometry, hz.material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  cam.position.set(0, 0, 5);
  cam.updateMatrixWorld();
  const u = hz.uniforms;
  const was = { on: u.uOn.value, power: u.uPower.value, rect: u.uRect.value.clone(), crop: u.uCrop.value.clone(), center: u.uCenter.value.clone(), right: u.uRight.value.clone(), up: u.uUp.value.clone(), px: u.uPx.value, tex: u.tCrop.value, time: u.uTime.value };
  const vis = hz.mesh.visible;
  const clear = r.getClearColor(new THREE.Color());
  const clearA = r.getClearAlpha();
  const out = {};
  for (const px of [1, 2]) {
    u.uOn.value = 1; u.uPower.value = 1; u.uRect.value.set(0, 0, n, n); u.uCrop.value.set(n, n);
    u.uCenter.value.set(0, 0, 0); u.uRight.value.set(1, 0, 0); u.uUp.value.set(0, 1, 0); u.uPx.value = px; u.tCrop.value = ramp; u.uTime.value = 7.3;
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(scene, cam);
    const buf = new Uint16Array(n * n * 4);
    r.readRenderTargetPixels(rt, 0, 0, n, n, buf);
    r.setRenderTarget(null);
    let max = 0, sum = 0, count = 0, strong = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      // (Where the patch is wholly there: the middle of its ellipse.)
      if (Math.hypot(((x + 0.5) / n * 2 - 1) * 0.85, ((y + 0.5) / n * 2 - 1) * 1.2) > 0.7) continue;
      const dx = THREE.DataUtils.fromHalfFloat(buf[i]) * n - x;
      const dy = THREE.DataUtils.fromHalfFloat(buf[i + 1]) * n - y;
      const m = Math.hypot(dx, dy);
      if (Math.abs(dx) > max) max = Math.abs(dx);
      if (Math.abs(dy) > max) max = Math.abs(dy);
      sum += m; count++;
      if (m > 0.5 * px) strong++;
    }
    out['px' + px] = { max, mean: count ? sum / count : 0, count, strong };
  }
  r.setClearColor(clear, clearA);
  u.uOn.value = was.on;
  u.uPower.value = was.power; u.uRect.value.copy(was.rect); u.uCrop.value.copy(was.crop); u.uCenter.value.copy(was.center);
  u.uRight.value.copy(was.right); u.uUp.value.copy(was.up); u.uPx.value = was.px; u.tCrop.value = was.tex; u.uTime.value = was.time;
  hz.mesh.visible = vis;
  rt.dispose(); ramp.dispose();
  return out;
`;

// What the car's materials are drawn with: the source of the program each of them has, for what the real style
// adds to a shader.
const PROGRAMS = `
  const r = g.renderer;
  g.render();
  const gl = r.getContext();
  const want = { flake: 'vFlakeP', glass: 'uGlass', tyre: 'tTyre', brush: 'uBrush' };
  const source = (p) => gl.getAttachedShaders(p.program).map((s) => gl.getShaderSource(s)).join(' ');
  const out = { programs: r.info.programs.length, used: {} };
  for (const name of ['paint', 'glass', 'rubber', 'rubber_side', 'gunmetal', 'alu']) {
    const m = (g.carLook.by[name] || [])[0];
    const props = m && r.properties.get(m);
    const prog = props && props.currentProgram;
    if (!prog) { out.used[name] = null; continue; }
    const src = source(prog);
    out.used[name] = { has: Object.fromEntries(Object.entries(want).map(([k, n]) => [k, src.includes(n)])) };
  }
  return out;
`;

// What it holds, let go: the textures and geometries of the page before and after.
const DISPOSE = `
  const cl = g.carLook;
  g.render();
  const before = { textures: g.renderer.info.memory.textures, geometries: g.renderer.info.memory.geometries };
  const a = (() => { const gl = g.renderer.getContext(); const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return px.join(); })();
  cl.dispose();
  g.render();
  g.render();
  const after = { textures: g.renderer.info.memory.textures, geometries: g.renderer.info.memory.geometries };
  return { before, after, haze: cl.haze, by: Object.keys(cl.by).length, hazeInScene: !!g.scene.getObjectByName('car_haze') };
`;

// ---- the run ----------------------------------------------------------------------------------

const failures = [];
const note = (ok, what, value = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${value === '' ? '' : `  ${typeof value === 'string' ? value : JSON.stringify(value)}`}`);
  if (!ok) failures.push(what);
};

// ---- the check -------------------------------------------------------------------------------

async function suite(page, results) {
  // The module, in node: three is the copy the page has.
  register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, n) { return s === 'three' ? { url: ${JSON.stringify(new URL('./vendor/three.module.js', import.meta.url).href)}, shortCircuit: true } : n(s, c); }`,
  ));
  const { CAR_LOOK, tyreLettering } = await import('../src/render/carlook.js');
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const P = CAR_LOOK.paint;

  // The lettering of the tyre: a picture that goes round (its left edge is the next of its right), not empty, nowhere
  // over the top.
  const t = tyreLettering(CAR_LOOK.tyre.text);
  const seam = (() => { let d = 0; for (let y = 0; y < t.height; y++) d = Math.max(d, Math.abs(t.bytes[y * t.width] - t.bytes[y * t.width + t.width - 1])); return d; })();
  const steepest = (() => { let d = 0; for (let y = 0; y < t.height; y++) for (let x = 1; x < t.width; x++) d = Math.max(d, Math.abs(t.bytes[y * t.width + x] - t.bytes[y * t.width + x - 1])); return d; })();
  const filled = t.bytes.reduce((a, b) => a + (b > 128 ? 1 : 0), 0) / t.bytes.length;
  note(t.width === CAR_LOOK.tyre.text.length * 24 && seam <= steepest && filled > 0.1 && filled < 0.4, 'the lettering of the tyre is one picture that goes round (no step across its edge beyond the steepest in it), with its letters in it', { size: [t.width, t.height], seam, steepest, filled: +filled.toFixed(3) });

  // The shaders have what it adds: the paint the flakes, the glass its reflection, the tyres their lettering, the discs their brushing.
  await page.run(PLACE(5000, false));
  const prog = await page.run(PROGRAMS);
  if (prog.error) throw new Error(prog.error);
  const has = (n, k) => prog.used[n] && prog.used[n].has[k];
  note(has('paint', 'flake') && has('glass', 'glass') && has('rubber', 'tyre') && has('rubber_side', 'tyre') && has('gunmetal', 'brush') && has('alu', 'brush'),
    'the programs the paint, the glass, the tyres and the discs are drawn with have the flakes, the reflection, the lettering and the brushing in them', prog);

  // The materials, in each style and each tier.
  const st = await page.run(STYLES_AND_TIERS);
  if (st.error) throw new Error(st.error);
  const realNow = st.real;
  note(same(realNow.paint, [P.metalness, P.roughness, 1, P.coatRoughness]), 'real: the paint is a base coat of the real style\'s metal and roughness under a clear coat of its own', realNow.paint);
  note(same(realNow.glass, [CAR_LOOK.glass.opacity, CAR_LOOK.glass.env]), 'real: the glass holds back less of what is behind it and reflects less of the sky', realNow.glass);
  note(realNow.lamp === CAR_LOOK.lamp.day && Math.abs(realNow.cabin - CAR_LOOK.cabin) < 0.25 * CAR_LOOK.cabin && realNow.cabin > 0, 'real: the head lamps are lit as the day has them and the cabin has its light', [realNow.lamp, realNow.cabin]);
  note(same(realNow.u, [1, 1, 1, 1]) && realNow.haze[0] && realNow.haze[1] > 0.3, 'real: the flakes, the tyres, the brushing and the glass are on, and the heat is drawn (the car is afloat)', [realNow.u, realNow.haze]);
  for (const id of ['paint', 'ink', 'cel', 'print', 'pixel', 'block']) {
    const o = st[id];
    note(same(o.paint, [0.2, 0.38, 1, 0.06]) && same(o.glass, [0.72, 1.6]) && o.lamp === 1.5 && o.cabin === 0 && same(o.u, [0, 0, 0, 0]) && same(o.haze, [false, 0]),
      `${id}: the car's materials are what they were, every number its shaders read is 0 and the heat is not drawn`, o);
  }
  note(same(st.back, realNow) || (same(st.back.paint, realNow.paint) && same(st.back.u, realNow.u)), 'back in the real style the car is as it was', st.back);
  note(same(st.mid.u, [1, 1, 1, 1]) && st.mid.haze[0] && st.mid.tier === 'mid', 'the middle tier has all of it', st.mid);
  note(same(st.low.u, [0, 0, 0, 1]) && same(st.low.haze, [false, 0]) && same(st.low.paint, realNow.paint) && st.low.tier === 'low', 'the low tier has the paint (clear coat) and the glass and no flakes, lettering, brushing or heat', st.low);
  note(same(st.high.u, [1, 1, 1, 1]) && st.high.haze[0] && st.high.tier === 'high', 'the high tier has all of it', st.high);

  // The flakes: at a metre they move the light of the paint a little, at six metres (past three) nothing moves.
  await page.run(PLACE(5000, true));
  const near = await page.run(FLAKES(POSES.paintNear));
  if (near.error) throw new Error(near.error);
  const nearShare = near.paint.over / Math.max(1, near.paint.count);
  note(nearShare > LIMITS.flake.near && near.paint.max < 0.25, `the flakes move the light of ${(nearShare * 100).toFixed(1)}% of the paint in a close frame (over ${LIMITS.flake.near * 100}%), by at most ${near.paint.max.toFixed(3)} of the range`, { paint: near.paint, loud: near.loud, uFlake: near.uFlake, rot: near.rot, wired: near.wired, hook: near.hook, distance: near.distance });
  note(near.steady === 0, 'the same frame drawn twice is the same pixel for pixel (the flakes are not drawn at random)', near.steady);
  note(near.wired.uniform && near.wired.rot && near.wired.inProgram && near.loud.mean > 2 * near.paint.mean,
    'the paint\'s program reads the strength and the turn the car gives it, in whichever of its programs was made last (turned up forty times, the frame moves twice as much or more)', { wired: near.wired, loud: near.loud.mean, flakes: near.paint.mean });
  await page.run(PLACE(5000, false));
  const far = await page.run(FLAKES(POSES.rear));
  note(far.paint.any === LIMITS.flake.far && far.paint.count > 100, `at six metres the flakes change not one pixel of the ${far.paint.count} of the paint`, far.paint);

  // The cabin seen through the glass.
  await page.run(PLACE(5000, true));
  for (const name of ['cabin', 'side']) {
    const cab = await page.run(CABIN(POSES[name]));
    if (cab.error) throw new Error(cab.error);
    const share = cab.glass.over / Math.max(1, cab.glass.count);
    const tones = results[name] ? results[name].glass.tones : 0;
    note(cab.parts === 3 && cab.glassPixels > 400 && share >= LIMITS.glass.seen, `${name}: the glass is different over ${(share * 100).toFixed(0)}% of its ${cab.glassPixels} pixels without the cabin (at least ${LIMITS.glass.seen * 100}%)`, cab.glass);
    note(tones >= LIMITS.glass.tones, `${name}: the glass has ${tones} tones (at least ${LIMITS.glass.tones})`, results[name] && results[name].glass);
  }

  // The lamps.
  await page.run(PLACE(5000, false));
  const brake = await page.run(`${STATE}
    const seen = { cruise: g.tailLight.emissiveIntensity };
    g.pilot.vMax = 4;
    let braked = 0;
    for (let i = 0; i < 240 && !braked; i++) { g.update(1 / 60); if ((g.car.brake || 0) > 0.05) braked = g.tailLight.emissiveIntensity; }
    seen.braking = braked;
    return seen;
  `);
  note(brake.cruise > 0 && brake.braking / brake.cruise === 3, 'the tail lamps are three times as bright braking as cruising', brake);
  await page.run(PLACE(5000, false));
  const tail = await page.run(LAMPS(POSES.rearLow, false));
  if (tail.error) throw new Error(tail.error);
  note(tail.lampPixels > 20 && tail.beyond.over >= LIMITS.lamp.glow, `the brake's bloom lights ${tail.beyond.over} pixels beyond the lamp's own ${tail.lampPixels}`, tail.beyond);
  await page.run(PLACE(5000, true));
  const head = await page.run(LAMPS(POSES.lamp, true));
  if (head.error) throw new Error(head.error);
  note(head.lampPixels > 100 && head.lumaDay.mean < head.lumaNight.mean * LIMITS.lamp.day,
    `the head lamps are less lit by day than in the dark (${head.lumaDay.mean.toFixed(2)} against ${head.lumaNight.mean.toFixed(2)} of the light; the brightest pixel of a lens by day is ${head.lumaDay.max.toFixed(2)})`, { day: head.lumaDay, night: head.lumaNight, pixels: head.lampPixels });

  // The heat.
  await page.run(PLACE(5000, false));
  const hz = await page.run(HAZE(POSES.rearLow));
  if (hz.error) throw new Error(hz.error);
  note(hz.visible && hz.heat > 0.3 && hz.uOn === 1 && hz.taken > 0, 'the heat is drawn behind the car afloat, and the frame is copied for it', { visible: hz.visible, heat: hz.heat, drawn: hz.power, taken: hz.taken });
  note(hz.callsOn - hz.callsOff === LIMITS.haze.calls, `it costs ${hz.callsOn - hz.callsOff} draws (the copy and the patch; ${hz.callsOff} without it)`, [hz.callsOn, hz.callsOff]);
  note(hz.changed > 50 && hz.far === 0, `it changes ${hz.changed} pixels of the frame, none by more than 3 levels of the 255 further than 40 pixels from its patch (${hz.far}; ${hz.outside} are outside the patch itself)`, { rect: hz.rect });
  const bend = await page.run(BEND);
  if (bend.error) throw new Error(bend.error);
  note(bend.px1.max <= LIMITS.haze.bend * 1 + 0.05 && bend.px2.max <= LIMITS.haze.bend * 2 + 0.05 && bend.px1.max > 0.5 * LIMITS.haze.bend && bend.px1.strong > 0.1 * bend.px1.count,
    `it takes a pixel from no further than ${LIMITS.haze.bend} pixels (a frame of 1080: ${LIMITS.haze.bend} px; of 2160: twice that), and from some way off over the patch (${bend.px1.max.toFixed(2)} at most, ${bend.px1.mean.toFixed(2)} on average over ${bend.px1.count} pixels)`, bend);
  const r = hz.reach;
  note(r[5][0] && r[20][0] && r[25][0] && r[29][0] && !r[31][0] && !r[35][0] && r[25][1] < r[20][1] * 0.8 && r[20][1] > r[5][1] * 0.95 && !hz.offVisible,
    'it is drawn within 30 m of the lens, fades from 20 m on, and is not drawn beyond or in another style', r);

  // What it holds, let go.
  const gone = await page.run(DISPOSE);
  if (gone.error) throw new Error(gone.error);
  note(gone.before.textures - gone.after.textures >= 2 && gone.before.geometries - gone.after.geometries >= 1 && !gone.haze && !gone.hazeInScene,
    'disposed, it lets go of its textures (the lettering, the copy) and its geometry, and the patch is out of the scene', gone);
}

async function looks(page, dir, results, plain = false) {
  for (const name of poses) {
    const pose = plain ? { ...POSES[name], variants: [] } : POSES[name];
    const put = await page.run(PLACE(5000, pose.still));
    if (put.error) throw new Error(`${name}: ${put.error}`);
    const cap = await page.run(`${KIT(pose)}
      frame();
      ${MASKS}
      const out = { afloat: g.presentation.liftAmount, calls: 0, tier: g.tier, carLook: !!g.carLook };
      const frameA = png();
      out.calls = r.info.render.calls;
      out.variants = {};
      const cl = g.carLook;
      for (const v of pose.variants || []) {
        if (v === 'nohaze' && cl && cl.haze) { const w = cl.haze.mesh.visible; cl.haze.mesh.visible = false; out.variants[v] = png(); cl.haze.mesh.visible = w; }
        if (v === 'metal02' && cl) {
          const m = cl.by.paint[0];
          const was = [m.metalness, m.roughness, m.clearcoatRoughness];
          [m.metalness, m.roughness, m.clearcoatRoughness] = [0.2, 0.38, 0.06];
          out.variants[v] = png();
          [m.metalness, m.roughness, m.clearcoatRoughness] = was;
        }
        if (v === 'noflake' && cl) { const w = cl.u.uFlake.value; cl.u.uFlake.value = 0; out.variants[v] = png(); cl.u.uFlake.value = w; }
        if (v === 'nocabin') {
          const parts = ['car_leather', 'car_alcantara', 'car_carpet'].map(part).filter(Boolean);
          parts.forEach((o) => { o.visible = false; });
          out.variants[v] = png();
          parts.forEach((o) => { o.visible = true; });
        }
        if (v === 'brake' && g.tailLight) { const e = g.tailLight.emissiveIntensity; g.tailLight.emissiveIntensity = 6; out.variants[v] = png(); g.tailLight.emissiveIntensity = e; }
        if (v === 'night' && cl) {
          const f = { real: 1, lift: g.presentation.liftAmount, throttle: 0, time: g.simTime, blinking: false, camera: g.camera };
          cl.update(1 / 60, { ...f, lamps: 1 });
          out.variants[v] = png();
          cl.update(1 / 60, { ...f, lamps: 0 });
        }
      }
      const b64 = (a) => { let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
      out.car = b64(maskCar);
      out.glass = b64(maskGlass);
      out.frame = frameA;
      out.size = [W, H];
      return out;
    `);
    if (cap.error) throw new Error(`${name}: ${cap.error}`);
    const img = fromURL(cap.frame);
    const lab = toLab(img);
    const car = regionOf(lab, fromB64(cap.car), true);
    const glass = regionOf(lab, fromB64(cap.glass), true);
    results[name] = { car, glass, calls: cap.calls, afloat: put.afloat };
    console.log(`${name.padEnd(8)} car ${JSON.stringify(car)}  glass ${JSON.stringify(glass)}  calls ${cap.calls}`);
    if (dir) {
      writeFileSync(`${dir}/${name}.png`, Buffer.from(cap.frame.replace(/^data:image\/png;base64,/, ''), 'base64'));
      for (const [v, url] of Object.entries(cap.variants || {})) {
        writeFileSync(`${dir}/${name}-${v}.png`, Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64'));
        const other = fromURL(url);
        const diff = new Uint8Array(img.w * img.h * 4);
        let over = 0;
        for (let i = 0; i < img.w * img.h; i++) {
          let d = 0;
          for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(img.data[i * 4 + c] - other.data[i * 4 + c]));
          if (d > 2) over++;
          const v6 = Math.min(255, d * 6);
          diff[i * 4] = v6; diff[i * 4 + 1] = v6; diff[i * 4 + 2] = v6; diff[i * 4 + 3] = 255;
        }
        writeFileSync(`${dir}/${name}-${v}-diff.png`, encodePNG(img.w, img.h, diff));
        const labV = toLab(other);
        console.log(`${name.padEnd(8)} variant ${v}: ${over} pixels differ by more than 2 levels; car ${JSON.stringify(regionOf(labV, fromB64(cap.car), true))} glass ${JSON.stringify(regionOf(labV, fromB64(cap.glass), true))}`);
      }
    }
  }
}

const server = serve();
let other = null;
let page = null;
const results = {};
try {
  if (!(await waitForServer())) throw new Error('the dev server did not come up');
  if (KEEP) mkdirSync(KEEP, { recursive: true });
  const query = `seed=7&world=hills&s=5000&cam=chase&style=real&run=60${TIER === 'high' ? '' : `&tier=${TIER}`}`;
  page = await openPage(query);
  await looks(page, KEEP, results);
  if (!LOOK) {
    try {
      await suite(page, results);
    } catch (e) {
      note(false, `the assertions stopped: ${e.message}`);
    }
    const logged = page.logs.filter((l) => !/KHR_parallel_shader_compile/.test(l));
    note(logged.length === 0, 'the page logged no error or warning', logged.slice(0, 4));
  }
  if (page.logs.length) console.log('page logged:', page.logs.slice(0, 8));
  if (KEEP) writeFileSync(`${KEEP}/car.json`, JSON.stringify(results, null, 1) + '\n');
  // --against DIR: the same frames of another tree (an export of an earlier commit), to set beside, in KEEP-before
  // (the first browser is closed first: one at a time).
  if (AGAINST) {
    page.close();
    page = null;
    other = serve(PORT + 1, AGAINST);
    if (!(await waitForServer(PORT + 1))) throw new Error('the second server did not come up');
    const before = await openPage(query, PORT + 1);
    try {
      const old = {};
      const dir = KEEP ? `${KEEP}-before` : null;
      if (dir) mkdirSync(dir, { recursive: true });
      console.log(`\nthe same frames of ${AGAINST}:`);
      await looks(before, dir, old, true);
      if (dir) writeFileSync(`${dir}/car.json`, JSON.stringify(old, null, 1) + '\n');
    } finally {
      before.close();
    }
  }
} finally {
  if (page) page.close();
  server.kill();
  if (other) other.kill();
}
if (CHECK && failures.length) {
  console.error(`\nFAILED: ${failures.length} check(s)`);
  process.exit(1);
}
