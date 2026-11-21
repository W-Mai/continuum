// The sky of the space world has what it is meant to: a band of the galaxy with
// dust in it, two nebulae, a ring round the planet that the planet and the ring
// shade each other with, the light the planet gives back, meteors, satellites;
// and none of it where it is not the space world's.
//
// In node, without a browser, the numbers (world/skyspace.js):
//  - the band is a great circle through the sky ahead of the road, the stars on
//    it four times as many as elsewhere and thinning to the ordinary number
//    16 degrees off it, on average at least three times as many within 12;
//  - a meteor falls every 20 to 40 seconds, so that in any 120 seconds three to
//    six begin; each is a streak of 0.6 s, 8 to 20 degrees long, falling, from
//    a place in the sky ahead; the same meteor every time;
//  - two or three satellites, each a point that crosses the sky slowly, at most
//    1.6 degrees a second, and is bright for a moment every 4 seconds;
//  - the ring is 1.4 to 2.3 of the planet's radii with a gap in the middle, in
//    a plane the eye is 18 degrees over, so that it is seen as an ellipse 0.31
//    as high as wide.
//
// In the real page, headless (seed 7, the space world, software rendering), the
// sky alone drawn from the road (everything else of the scene put out of sight,
// the frame as the post chain makes it), the way the style draws it, in each of
// the seven styles:
//  - the band: in the real style there are at least 3 times as many stars within 12
//    degrees of it as there were (and as many as there were off it: the sky without
//    it has them as thick everywhere, so this is how many times as thick as elsewhere
//    they are), and in the painted style 2.4 times (a flat dot is the same size
//    wherever it is, so the finer grid the band has more of them on can only add so
//    many); the band's glow is, where it is brightest over a black sky, 0.10 to 0.145 of
//    lightness (OKLab), and the dust in it is a lane that has gaps: the middle of
//    the band darker than its sides in places;
//  - the nebulae: two, in the colours they are written in (over a black sky, violet and
//    teal), faint (0.04 to 0.20 of lightness at the thickest), about 30 degrees across;
//  - the sky is not washed grey: the most coloured twentieth of it keeps its
//    chroma (OKLab), the frame is as dark as it was, and the brightest hundred
//    stars are as bright as they were;
//  - the ring, seen from where the lens is turned on the planet: its outer edge
//    is 2.3 of the planet's radii and its inner 1.4, the gap between them is
//    sky, and an arc of the ring in the planet's shadow is at least half as dark
//    as the ring where it is lit; the ring's shadow is on the planet, and the
//    planet's cut out of the ring in the painted style;
//  - the meteor: in a frame with one halfway down its streak, the pixels that
//    are changed by it are a streak 8 to 20 degrees long, and in a frame the
//    next 0.7 s on, none;
//  - the satellites: a bright one is brighter than a dim one by at least 2 to 1,
//    and one is somewhere else a few seconds on;
//  - the planet's light: the car's back, which faces the planet and not the sun,
//    is lit cold by it (bluer, and no darker), in the frame, and not at all when it is off;
//  - 120 seconds of driving the space world begin three to six meteors;
//  - the tiers: low draws none of it and its sky is the program it had, mid has the
//    band and the nebulae in one octave of noise, the ring without shadows,
//    two satellites; high all; and the sky in another world is the program
//    it had;
//  - what was made for it is let go of by dispose().
//
// Usage: node tools/world_space_check.mjs
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  D2R, GALAXY, NEBULAE, RING, SATELLITES, METEOR, SHINE, PLANET,
  skyDir, starDensity, galaxyFrame, galaxyLatitude, ringNormal, ringPoint,
  meteor, meteorAt, meteorCount, meteorStart, satellite,
} from '../src/world/skyspace.js';

let failed = 0;
const say = (ok, text) => {
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};
const f = (x, k = 2) => x.toFixed(k);
const deg = (r) => r / D2R;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

// --- the numbers, in node ---------------------------------------------------

// The band.
{
  const axes = [0, 1.3, -2.2, 3.0];
  let worst = 0;
  let meanMin = Infinity;
  let outside = 0;
  for (const ax of axes) {
    const fr = galaxyFrame(ax);
    worst = Math.max(worst, Math.abs(len(fr.c) - 1), Math.abs(len(fr.e) - 1), Math.abs(len(fr.n) - 1), Math.abs(dot(fr.c, fr.e)), Math.abs(dot(fr.c, fr.n)), Math.abs(dot(fr.e, fr.n)));
    // The band is through the point it is centred on, from the axis.
    const at = skyDir(ax, GALAXY.at[0], GALAXY.at[1]);
    worst = Math.max(worst, Math.abs(galaxyLatitude(fr, at)));
    // On average over the band within 12 degrees of it, how many times the sky's own number of stars.
    let sum = 0;
    let n = 0;
    for (let b = -12; b <= 12; b += 0.05) {
      sum += starDensity(b * D2R);
      n++;
    }
    meanMin = Math.min(meanMin, sum / n);
    outside = Math.max(outside, starDensity(20 * D2R) - 1);
  }
  say(worst < 1e-9, `the band's three vectors are a frame, and it is through the sky ahead of the axis (the most off ${worst.toExponential(1)})`);
  say(Math.abs(starDensity(0) - GALAXY.stars) < 1e-9 && GALAXY.stars === 4, `the stars are ${starDensity(0)} times as thick on its middle`);
  say(meanMin >= 3.3, `within 12 degrees of it there are on average ${f(meanMin)} times the sky's own number of stars (at least 3.3)`);
  say(outside === 0, 'the sky 20 degrees off it has the number it had');
  // The band is a great circle: a point 90 degrees along it is on it too.
  const fr = galaxyFrame(0);
  const a = [fr.c[0] * Math.cos(1.2) + fr.e[0] * Math.sin(1.2), fr.c[1] * Math.cos(1.2) + fr.e[1] * Math.sin(1.2), fr.c[2] * Math.cos(1.2) + fr.e[2] * Math.sin(1.2)];
  say(Math.abs(galaxyLatitude(fr, a)) < 1e-9, 'it is a great circle (a point a long way along it is on it too)');
}

// The meteors.
{
  let least = 99;
  let most = 0;
  for (let t0 = 0; t0 < 600; t0 += 7.3) {
    const n = meteorCount(t0, t0 + 120);
    least = Math.min(least, n);
    most = Math.max(most, n);
  }
  say(least >= 3 && most <= 6, `120 seconds begin ${least} to ${most} meteors (3 to 6), from any moment`);
  let gapMin = Infinity;
  let gapMax = 0;
  let lenMin = Infinity;
  let lenMax = 0;
  let azMax = 0;
  let elLo = Infinity;
  let elHi = -Infinity;
  let falling = true;
  for (let k = 0; k < 2000; k++) {
    const m = meteor(k);
    if (k > 0) {
      const g = m.start - meteorStart(k - 1);
      gapMin = Math.min(gapMin, g);
      gapMax = Math.max(gapMax, g);
    }
    lenMin = Math.min(lenMin, m.len);
    lenMax = Math.max(lenMax, m.len);
    azMax = Math.max(azMax, Math.abs(m.az));
    elLo = Math.min(elLo, m.el);
    elHi = Math.max(elHi, m.el);
    if (!(Math.sin(m.dir) < -0.3)) falling = false;
  }
  say(gapMin >= 20 && gapMax <= 40, `a meteor falls every ${f(gapMin, 1)} to ${f(gapMax, 1)} seconds (20 to 40)`);
  say(lenMin >= 8 * D2R - 1e-9 && lenMax <= 20 * D2R + 1e-9, `each is ${f(deg(lenMin), 1)} to ${f(deg(lenMax), 1)} degrees long (8 to 20)`);
  say(falling && azMax <= 35 * D2R + 1e-9 && elLo >= 11 * D2R - 1e-9 && elHi <= 22 * D2R + 1e-9,
    `each falls, from a place up to ${f(deg(azMax), 0)} degrees to either side of the axis and ${f(deg(elLo), 0)} to ${f(deg(elHi), 0)} degrees up`);
  const m = meteor(5);
  say(meteorAt(m.start - 0.01) === null && meteorAt(m.start + 0.3).k === 5 && Math.abs(meteorAt(m.start + 0.3).progress - 0.5) < 1e-9
    && meteorAt(m.start + METEOR.life + 0.01) === null, 'a meteor is a streak of 0.6 s, begun at its moment and gone after it');
  say(JSON.stringify(meteor(9)) === JSON.stringify(meteor(9)) && meteorStart(9) === meteor(9).start, 'the same meteor every time');
}

// The satellites.
{
  say(SATELLITES.list.length >= 2 && SATELLITES.list.length <= 3, `${SATELLITES.list.length} satellites (two or three)`);
  let rate = 0;
  let period = true;
  let dim = 1;
  for (let i = 0; i < SATELLITES.list.length; i++) {
    for (let t = 0; t < 400; t += 0.5) {
      const a = satellite(i, t);
      const b = satellite(i, t + 0.5);
      const da = Math.abs(b.az - a.az);
      // (Where one comes round, it is gone: not a step.)
      if (da < 20 * D2R) rate = Math.max(rate, Math.hypot(da, b.el - a.el) / 0.5);
      if (Math.abs(satellite(i, t).bright - satellite(i, t + SATELLITES.blink).bright) > 1e-9 && Math.abs(a.az) < 55 * D2R && Math.abs(satellite(i, t + 4).az) < 55 * D2R) period = false;
      if (Math.abs(a.az) < 55 * D2R) dim = Math.min(dim, a.bright);
    }
  }
  say(deg(rate) <= 1.6, `a satellite crosses the sky at the most ${f(deg(rate))} degrees a second (1.6)`);
  say(period && SATELLITES.blink === 4, 'each is bright for a moment every 4 seconds');
  const peak = satellite(0, SATELLITES.blink - SATELLITES.list[0].phase + SATELLITES.flash / 2);
  const between = satellite(0, SATELLITES.blink - SATELLITES.list[0].phase + 2);
  say(peak.bright > 2 * between.bright, `a bright one is ${f(peak.bright / between.bright, 1)} times a dim one`);
}

// The ring.
{
  const n = ringNormal();
  say(Math.abs(len(n) - 1) < 1e-12, "the ring's plane has a normal");
  say(RING.inner === 1.4 && RING.outer === 2.3 && RING.gap[0] > RING.inner && RING.gap[1] < RING.outer && RING.gap[0] < RING.gap[1],
    `the ring is ${RING.inner} to ${RING.outer} of the planet's radii with a gap (${RING.gap[0]} to ${RING.gap[1]}) in it`);
  // Seen from the eye (z), the plane is 18 degrees over it: the ring's short axis on the screen is sin 18 of its long axis
  // (turned on the screen by the roll, which does not change that).
  let rmax = 0;
  let rmin = Infinity;
  for (let a = 0; a < 6.2832; a += 0.005) {
    const p = ringPoint(2.3, a);
    const r = Math.hypot(p[0], p[1]);
    rmax = Math.max(rmax, r);
    rmin = Math.min(rmin, r);
  }
  say(Math.abs(rmin / rmax - Math.sin(18 * D2R)) < 0.01 && Math.abs(deg(RING.tilt) - 18) < 1e-9,
    `the ring is seen as an ellipse whose short axis is ${f(rmin / rmax)} of its long (sin 18 degrees, ${f(Math.sin(18 * D2R))}), turned ${f(deg(-RING.roll), 0)} degrees on the screen`);
  say(Math.abs(rmax - 2.3) < 0.01, `its outer edge is ${f(rmax)} radii from the planet's middle on the screen`);
  say(n[2] > 0, 'the face of it the eye sees is the face its normal is on');
}

// The planet's light.
say(SHINE.share === 0.06 && SHINE.color[2] > SHINE.color[0], `the planet gives back ${SHINE.share} of the sun's strength, in a colour that is cold (${SHINE.color.map((c) => f(c)).join(', ')})`);
say(NEBULAE.length === 2 && NEBULAE.every((n) => Math.abs(n.size - 15 * D2R) < 1e-9), 'two nebulae, 30 degrees across');
say(PLANET.r === 0.15, "the planet's radius in the sky is the one it had");


// --- in the page ------------------------------------------------------------

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8190;
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

async function openPage(query) {
  const profile = `${tmpdir()}/continuum-space-${process.pid}-${Date.now()}`;
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

// What every test of the page has: the car put on the road (place), a style
// (setStyle), the lens turned where it is asked to (lookAtDir), everything of the
// scene but the sky put out of sight (skyOnly), a frame as the post chain makes it
// (grab), the colour of a pixel in OKLab (oklab), the direction of every pixel of the
// lens (rays), where a direction is on the screen (pixelOf).
const LIB = String.raw`
  const SS = await import('./src/world/skyspace.js');
  const THREE = await import('three');
  const canvas = document.getElementById('view');
  const PI = Math.PI;
  const D2R = PI / 180;
  const shaderErrors = window.__shaderErrors || (window.__shaderErrors = []);
  g.renderer.debug.onShaderError = (gl, program) => { shaderErrors.push(String(gl.getProgramInfoLog(program)).slice(0, 400)); };
  const place = (s, time) => {
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
    g.atmosphere.uniforms.uTime.value = time === undefined ? 100 : time;
    for (let i = 0; i < 150; i++) { g.pilot.vMax = 22; g.update(1 / 60); }
  };
  const setStyle = (st) => {
    g.style.set(st, true);
    g.style.applyScene();
    g.post.setStyle(g.style);
    g.atmosphere.bakeEnvironment();
  };
  const lookAtDir = (dir, fov) => {
    const c = g.camera;
    const T = c.position.clone();
    T.x += dir[0] * 100; T.y += dir[1] * 100; T.z += dir[2] * 100;
    c.up.set(0, 1, 0);
    c.lookAt(T);
    if (fov) { c.fov = fov; c.updateProjectionMatrix(); }
    c.updateMatrixWorld();
  };
  const skyOnly = () => {
    const hidden = [];
    for (const c of g.scene.children) if (c !== g.atmosphere.sky && c.visible) { c.visible = false; hidden.push(c); }
    return () => { for (const c of hidden) c.visible = true; };
  };
  const grab = () => {
    g.render();
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(canvas, 0, 0);
    return { w: c.width, h: c.height, data: x.getImageData(0, 0, c.width, c.height).data };
  };
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const oklab = (r, gg, b) => {
    const R = lin(r), G = lin(gg), B = lin(b);
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const rays = () => {
    const c = g.camera;
    c.updateMatrixWorld();
    const e = c.matrixWorld.elements;
    const R = [e[0], e[1], e[2]], U = [e[4], e[5], e[6]], F = [-e[8], -e[9], -e[10]];
    const w = canvas.width, h = canvas.height;
    const th = Math.tan(c.fov * PI / 360), asp = w / h;
    const dirs = new Float32Array(w * h * 3), om = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = ((x + 0.5) / w * 2 - 1) * th * asp, b = (1 - (y + 0.5) / h * 2) * th;
        const dx = F[0] + R[0] * a + U[0] * b, dy = F[1] + R[1] * a + U[1] * b, dz = F[2] + R[2] * a + U[2] * b;
        const l = Math.hypot(dx, dy, dz), i = y * w + x;
        dirs[i * 3] = dx / l; dirs[i * 3 + 1] = dy / l; dirs[i * 3 + 2] = dz / l;
        om[i] = 1 / (l * l * l);
      }
    }
    return { dirs, om, w, h };
  };
  const pixelOf = (d) => {
    const v = new THREE.Vector3(d[0], d[1], d[2]).multiplyScalar(100).add(g.camera.position);
    v.project(g.camera);
    return [(v.x * 0.5 + 0.5) * canvas.width, (1 - (v.y * 0.5 + 0.5)) * canvas.height, v.z];
  };
  const sunVec = () => { const d = g.atmosphere.sunDir; return [d.x, d.y, d.z]; };
  const axisAngle = () => Math.atan2(g.worlds.dz, g.worlds.dx);
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // The program the sky has without the space world's code, for the style's kind of sky.
  const oldSky = () => {
    const d = g.atmosphere.sky.material.defines;
    const A = g.atmosphere;
    if (d.SKY_FOLD) return d.SKY_NIGHT ? A.skyFoldHeaps : A.skyFold;
    return d.SKY_NIGHT ? A.skyPlainHeaps : A.skyPlain;
  };
  const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  // The frame's median over 3 x 3 in each channel (the stars are a pixel or two), at a pixel.
  const med3 = (f, x, y) => {
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const v = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) v.push(f.data[((y + dy) * f.w + x + dx) * 4 + c]);
      v.sort((p, q) => p - q);
      out[c] = v[4];
    }
    return out;
  };
  // The stars of a frame: the pixels brighter than the ring five pixels round them by 30 levels,
  // joined; the share of them in each of the sets the pixels are in (set(i): an index or -1).
  const stars = (f, set, nsets) => {
    const w = f.w, h = f.h, d = f.data;
    const mask = new Uint8Array(w * h);
    const ring = [[-5, -5], [0, -5], [5, -5], [-5, 0], [5, 0], [-5, 5], [0, 5], [5, 5]];
    for (let y = 6; y < h - 6; y++) {
      for (let x = 6; x < w - 6; x++) {
        const i = y * w + x;
        if (set(i) < 0) continue;
        let bg = 0;
        for (const [dx, dy] of ring) bg += luma(d, ((y + dy) * w + x + dx) * 4);
        if (luma(d, i * 4) > bg / 8 + 30) mask[i] = 1;
      }
    }
    const count = new Array(nsets).fill(0);
    const seen = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || seen[i]) continue;
      const stack = [i];
      seen[i] = 1;
      let n = 0, sx = 0, sy = 0;
      while (stack.length) {
        const j = stack.pop();
        n++; sx += j % w; sy += (j / w) | 0;
        const x = j % w, y = (j / w) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const k = (y + dy) * w + x + dx;
          if (k >= 0 && k < w * h && mask[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
        }
      }
      const s = set(Math.round(sy / n) * w + Math.round(sx / n));
      if (s >= 0) count[s]++;
    }
    return count;
  };
`;

// The stars along the band against the sky off it, in a style, with and without the space
// world's code; and, in the real style, the band's glow, the lane of dust in it.
const BAND = (style) => String.raw`
  setStyle('${style}');
  place(400);
  const ax = axisAngle();
  const fr = SS.galaxyFrame(ax);
  lookAtDir(SS.skyDir(ax, SS.GALAXY.at[0], SS.GALAXY.at[1]), 50);
  const restore = skyOnly();
  const R = rays();
  const sv = sunVec();
  const bDeg = new Float32Array(R.w * R.h), lon = new Float32Array(R.w * R.h), valid = new Uint8Array(R.w * R.h);
  const omega = [0, 0];
  for (let i = 0; i < R.w * R.h; i++) {
    const d = [R.dirs[i * 3], R.dirs[i * 3 + 1], R.dirs[i * 3 + 2]];
    bDeg[i] = Math.abs(Math.asin(Math.max(-1, Math.min(1, dot3(d, fr.n))))) / D2R;
    lon[i] = Math.atan2(dot3(d, fr.e), dot3(d, fr.c)) / D2R;
    valid[i] = d[1] > 0.06 && dot3(d, sv) < 0.75 ? 1 : 0;
    if (valid[i]) { if (bDeg[i] < 12) omega[0] += R.om[i]; else if (bDeg[i] >= 25) omega[1] += R.om[i]; }
  }
  const set = (i) => (!valid[i] ? -1 : bDeg[i] < 12 ? 0 : bDeg[i] >= 25 ? 1 : -1);
  const fOn = grab();
  const cOn = stars(fOn, set, 2);
  const space = g.atmosphere.sky.material;
  g.atmosphere.sky.material = oldSky();
  const fOff = grab();
  const cOff = stars(fOff, set, 2);
  g.atmosphere.sky.material = space;
  const out = { style: '${style}', on: cOn, off: cOff, omega, gainIn: cOn[0] / Math.max(cOff[0], 1), gainOut: cOn[1] / Math.max(cOff[1], 1) };
  if ('${style}' === 'real') {
    // The glow: the lightness the band has over a black sky; the dust: slices across the band along it, its
    // middle against its two sides. In a wider lens, for more of the band.
    lookAtDir(SS.skyDir(ax, SS.GALAXY.at[0], SS.GALAXY.at[1]), 80);
    const W = rays();
    const bW = new Float32Array(W.w * W.h), lonW = new Float32Array(W.w * W.h), okW = new Uint8Array(W.w * W.h);
    // (Away from the nebulae, which are laid over the band in places.)
    const neb = SS.nebulaDirs(ax);
    for (let i = 0; i < W.w * W.h; i++) {
      const d = [W.dirs[i * 3], W.dirs[i * 3 + 1], W.dirs[i * 3 + 2]];
      bW[i] = Math.abs(Math.asin(Math.max(-1, Math.min(1, dot3(d, fr.n))))) / D2R;
      lonW[i] = Math.atan2(dot3(d, fr.e), dot3(d, fr.c)) / D2R;
      okW[i] = d[1] > 0.06 && dot3(d, sv) < 0.75 && neb.every((c) => dot3(d, c) < Math.cos(19 * D2R)) ? 1 : 0;
    }
    const u = g.atmosphere.uniforms;
    const keep = [u.uHorizon.value.clone(), u.uZenith.value.clone(), u.uGround.value.clone(), u.uGlow.value.clone(), u.uRingOn.value];
    u.uHorizon.value.setRGB(0, 0, 0); u.uZenith.value.setRGB(0, 0, 0); u.uGround.value.setRGB(0, 0, 0); u.uGlow.value.setRGB(0, 0, 0); u.uRingOn.value = 0;
    const bOn = grab();
    u.uHorizon.value.copy(keep[0]); u.uZenith.value.copy(keep[1]); u.uGround.value.copy(keep[2]); u.uGlow.value.copy(keep[3]); u.uRingOn.value = keep[4];
    const Ls = [];
    const slices = new Map();
    for (let y = 2; y < W.h - 2; y++) {
      for (let x = 2; x < W.w - 2; x++) {
        const i = y * W.w + x;
        if (!okW[i] || bW[i] > 6) continue;
        const a = med3(bOn, x, y);
        const la = oklab(a[0], a[1], a[2])[0];
        Ls.push(la);
        const key = Math.round(lonW[i] / 2);
        let s = slices.get(key);
        if (!s) slices.set(key, s = { mid: [0, 0], side: [0, 0] });
        if (bW[i] < 1) { s.mid[0] += la; s.mid[1]++; } else if (bW[i] >= 2 && bW[i] < 3.5) { s.side[0] += la; s.side[1]++; }
      }
    }
    Ls.sort((p, q) => p - q);
    let gaps = 0, usable = 0;
    for (const s of slices.values()) {
      if (s.mid[1] < 12 || s.side[1] < 20) continue;
      const mid = s.mid[0] / s.mid[1], side = s.side[0] / s.side[1];
      if (side < 0.03) continue;
      usable++;
      if (mid < 0.9 * side) gaps++;
    }
    out.glow = { n: Ls.length, p50: pct(Ls, 0.5), p99: pct(Ls, 0.99), max: Ls[Ls.length - 1] };
    out.lane = { usable, gaps };
  }
  restore();
  g.camera.fov = 52.4; g.camera.updateProjectionMatrix();
  return out;
`;

// The nebulae, in the real style: the colour each adds to the sky, how much, how wide.
const NEBULAE_TEST = String.raw`
  setStyle('real');
  place(400);
  const ax = axisAngle();
  const out = [];
  const restore = skyOnly();
  // Over a sky that is black, so that what is seen is the nebula's own colour.
  const u = g.atmosphere.uniforms;
  const keep = [u.uHorizon.value.clone(), u.uZenith.value.clone(), u.uGround.value.clone(), u.uGlow.value.clone(), u.uRingOn.value];
  u.uHorizon.value.setRGB(0, 0, 0); u.uZenith.value.setRGB(0, 0, 0); u.uGround.value.setRGB(0, 0, 0); u.uGlow.value.setRGB(0, 0, 0); u.uRingOn.value = 0;
  const hueOf = (c) => {
    const lab = oklab(c[0], c[1], c[2]);
    return (Math.atan2(lab[2], lab[1]) * 180 / PI + 360) % 360;
  };
  for (let k = 0; k < SS.NEBULAE.length; k++) {
    const nb = SS.NEBULAE[k];
    const c = SS.skyDir(ax, nb.at[0], nb.at[1]);
    lookAtDir(c, 60);
    const R = rays();
    const fOn = grab();
    const space = g.atmosphere.sky.material;
    g.atmosphere.sky.material = oldSky();
    const fOff = grab();
    g.atmosphere.sky.material = space;
    const px = [];
    let sum = [0, 0, 0], sumN = 0;
    for (let y = 2; y < R.h - 2; y += 2) {
      for (let x = 2; x < R.w - 2; x += 2) {
        const i = y * R.w + x;
        const d = [R.dirs[i * 3], R.dirs[i * 3 + 1], R.dirs[i * 3 + 2]];
        if (d[1] < 0.03) continue;
        const ang = Math.acos(Math.min(1, dot3(d, c))) / D2R;
        if (ang > 22) continue;
        const a = med3(fOn, x, y), b = med3(fOff, x, y);
        const dL = oklab(a[0], a[1], a[2])[0] - oklab(b[0], b[1], b[2])[0];
        px.push({ ang, dL, az: Math.atan2(d[2], d[0]) / D2R, el: Math.asin(d[1]) / D2R });
        if (ang < 7 && dL > 0.02) { sum[0] += lin(a[0]) - lin(b[0]); sum[1] += lin(a[1]) - lin(b[1]); sum[2] += lin(a[2]) - lin(b[2]); sumN++; }
      }
    }
    const peak = pct(px.map((p) => p.dL).sort((p, q) => p - q), 0.99);
    // The width across it, along the row at its middle's height.
    const elC = Math.asin(c[1]) / D2R;
    const row = px.filter((p) => Math.abs(p.el - elC) < 3 && p.dL > 0.2 * peak);
    const azs = row.map((p) => { let a = p.az - Math.atan2(c[2], c[0]) / D2R; while (a > 180) a -= 360; while (a < -180) a += 360; return a; });
    const width = azs.length ? Math.max(...azs) - Math.min(...azs) : 0;
    const mean = sum.map((v) => v / Math.max(sumN, 1));
    out.push({ k, mean, hue: hueOf(mean.map((v) => Math.max(v, 1e-9)).map((v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055))), peak, width, n: sumN });
  }
  u.uHorizon.value.copy(keep[0]); u.uZenith.value.copy(keep[1]); u.uGround.value.copy(keep[2]); u.uGlow.value.copy(keep[3]); u.uRingOn.value = keep[4];
  restore();
  g.camera.fov = 52.4; g.camera.updateProjectionMatrix();
  return out;
`;

// The sky is not washed grey and the frame is as dark as it was; in the real style and the painted.
const WASH = (style) => String.raw`
  setStyle('${style}');
  place(400);
  const out = { style: '${style}' };
  const restore = skyOnly();
  const c95 = (f) => {
    const R = rays();
    const cs = [];
    for (let y = 0; y < f.h; y += 2) for (let x = 0; x < f.w; x += 2) {
      const i = y * f.w + x;
      if (R.dirs[i * 3 + 1] < 0.02) continue;
      const lab = oklab(f.data[i * 4], f.data[i * 4 + 1], f.data[i * 4 + 2]);
      cs.push(Math.hypot(lab[1], lab[2]));
    }
    cs.sort((p, q) => p - q);
    return pct(cs, 0.95);
  };
  // The mean light of the brightest hundred pixels over the horizon (the stars: a frame of this lens has no planet).
  const top100 = (f) => {
    const R = rays();
    const ls = [];
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const i = y * f.w + x;
      if (R.dirs[i * 3 + 1] < 0.02) continue;
      ls.push(luma(f.data, i * 4));
    }
    ls.sort((p, q) => q - p);
    let s = 0;
    for (let i = 0; i < 100; i++) s += ls[i];
    return s / 100;
  };
  const fOn = grab();
  out.c95On = c95(fOn);
  out.starsOn = top100(fOn);
  const space = g.atmosphere.sky.material;
  g.atmosphere.sky.material = oldSky();
  const fOff = grab();
  out.c95Off = c95(fOff);
  out.starsOff = top100(fOff);
  g.atmosphere.sky.material = space;
  restore();
  const dark = (f) => { let k = 0; for (let i = 0; i < f.data.length; i += 4) if (oklab(f.data[i], f.data[i + 1], f.data[i + 2])[0] < 0.2) k++; return k / (f.w * f.h); };
  out.darkOn = dark(grab());
  g.atmosphere.sky.material = oldSky();
  g.atmosphere.setTier('low');
  g.atmosphere.bakeEnvironment();
  out.darkOff = dark(grab());
  g.atmosphere.setTier('high');
  g.atmosphere.sky.material = space;
  g.atmosphere.bakeEnvironment();
  return out;
`;

// The ring, from the planet's side of the sky: its edges, its gap, the shadows.
const RING_TEST = (style) => String.raw`
  setStyle('${style}');
  place(400);
  const out = { style: '${style}' };
  const sv = sunVec();
  const pf = SS.planetFrame(sv);
  const lensDir = pf.p;
  lookAtDir(lensDir, 40);
  const restore = skyOnly();
  const sdv = [dot3(sv, pf.x), dot3(sv, pf.y), dot3(sv, pf.z)];
  const RN = SS.ringNormal();
  const r = SS.PLANET.r;
  const dirOf = (P) => {
    const x = r * P[0], y = r * P[1], c = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    return [pf.x[0] * x + pf.y[0] * y + pf.p[0] * c, pf.x[1] * x + pf.y[1] * y + pf.p[1] * c, pf.x[2] * x + pf.y[2] * y + pf.p[2] * c];
  };
  const lumAt = (f, P) => {
    const px = pixelOf(dirOf(P));
    const x = Math.round(px[0]), y = Math.round(px[1]);
    if (x < 3 || y < 3 || x >= f.w - 3 || y >= f.h - 3) return null;
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += luma(f.data, ((y + dy) * f.w + x + dx) * 4);
    return s / 9;
  };
  // How far a point of the ring's plane is from the line through the planet's middle toward the sun's far side
  // (null where it is on the sun's side of the planet, and so not in its shadow).
  const planetShade = (Q) => {
    const along = dot3(Q, sdv);
    const perp = Math.hypot(Q[0] - sdv[0] * along, Q[1] - sdv[1] * along, Q[2] - sdv[2] * along);
    return { along, perp };
  };
  const inRing = (rho) => rho > SS.RING.inner && rho < SS.RING.outer && !(rho > SS.RING.gap[0] && rho < SS.RING.gap[1]);
  const frames = {};
  for (const tier of ['high', 'mid']) {
    g.atmosphere.setTier(tier);
    frames[tier] = grab();
  }
  g.atmosphere.setTier('high');
  const hi = frames.high, mid = frames.mid;
  // The edges and the gap along the ring's long axis, on the side of it the sun lights (the left: a = 0).
  const along = (rho) => lumAt(hi, SS.ringPoint(rho, 0));
  const profile = [];
  for (let rho = 1.1; rho <= 2.6; rho += 0.02) profile.push([+rho.toFixed(2), along(rho)]);
  const lumIn = [1.55, 1.62, 2.0, 2.15].map(along);
  const lumGap = along(1.83);
  const lumOut = along(2.55);
  out.ring = { in: lumIn, gap: lumGap, out: lumOut };
  // Where the half way between the ring and the sky beyond it is.
  const ringMean = (lumIn[2] + lumIn[3]) / 2;
  let outerEdge = null, innerEdge = null;
  for (let k = 1; k < profile.length; k++) {
    const [r0, l0] = profile[k - 1], [r1, l1] = profile[k];
    const half = (ringMean + Math.min(lumOut, profile[0][1])) / 2;
    if (r0 > 2.0 && l0 >= half && l1 < half && outerEdge === null) outerEdge = (r0 + r1) / 2;
    if (r0 < 1.7 && l0 < half && l1 >= half && innerEdge === null) innerEdge = (r0 + r1) / 2;
  }
  out.edges = { inner: innerEdge, outer: outerEdge };
  // The ring in the planet's shadow and out of it: each the same pixels with the shadows (high) and without (mid).
  const shaded = { hi: [], mid: [] }, lit = { hi: [], mid: [] };
  for (const rho of [1.55, 1.65, 2.0, 2.15]) {
    for (let a = 0; a < 360; a += 1) {
      const P = SS.ringPoint(rho, a * D2R);
      if (P[2] <= 0 && P[0] * P[0] + P[1] * P[1] < 1.3) continue;
      const ps = planetShade(P);
      const l1 = lumAt(hi, P), l0 = lumAt(mid, P);
      if (l1 === null || l0 === null) continue;
      if (ps.along < -0.1 && ps.perp < 0.85) { shaded.hi.push(l1); shaded.mid.push(l0); }
      else if (ps.along > 0.05 || ps.perp > 1.2) { lit.hi.push(l1); lit.mid.push(l0); }
    }
  }
  const mean = (a) => a.reduce((p, q) => p + q, 0) / Math.max(a.length, 1);
  out.ringShade = { shaded: shaded.hi.length, lit: lit.hi.length, shadedRatio: mean(shaded.hi) / Math.max(mean(shaded.mid), 1e-6), litRatio: mean(lit.hi) / Math.max(mean(lit.mid), 1e-6),
    shadedVsLit: mean(shaded.hi) / Math.max(mean(lit.hi), 1e-6), shadedVsLitNoShade: mean(shaded.mid) / Math.max(mean(lit.mid), 1e-6) };
  // The ring's shadow on the planet: the planet's pixels the ring stands between and the sun, with it and without.
  const k = dot3(RN, sdv);
  const pShaded = { hi: [], mid: [] }, pLit = { hi: [], mid: [] };
  for (let x = -0.97; x <= 0.97; x += 0.01) {
    for (let y = -0.97; y <= 0.97; y += 0.01) {
      if (x * x + y * y > 0.94) continue;
      const P = [x, y, Math.sqrt(1 - x * x - y * y)];
      if (dot3(P, sdv) < 0.3) continue;
      // (Where the ring is in front of the planet, what is seen is the ring.)
      const tz = -(RN[0] * x + RN[1] * y) / RN[2];
      const rhoView = Math.sqrt(x * x + y * y + tz * tz);
      if (tz > P[2] - 0.05 && rhoView > SS.RING.inner - 0.08 && rhoView < SS.RING.outer + 0.08) continue;
      const s = -dot3(RN, P) / k;
      let rho = null;
      if (s > 0) { const Q = [P[0] + sdv[0] * s, P[1] + sdv[1] * s, P[2] + sdv[2] * s]; rho = Math.hypot(Q[0], Q[1], Q[2]); }
      const l1 = lumAt(hi, P), l0 = lumAt(mid, P);
      if (l1 === null || l0 === null) continue;
      if (rho !== null && inRing(rho) && rho > SS.RING.inner + 0.04 && rho < SS.RING.outer - 0.04 && !(rho > SS.RING.gap[0] - 0.04 && rho < SS.RING.gap[1] + 0.04)) { pShaded.hi.push(l1); pShaded.mid.push(l0); }
      else if (rho === null || rho < SS.RING.inner - 0.05 || rho > SS.RING.outer + 0.05) { pLit.hi.push(l1); pLit.mid.push(l0); }
    }
  }
  out.planetShade = { shaded: pShaded.hi.length, lit: pLit.hi.length, shadedRatio: mean(pShaded.hi) / Math.max(mean(pShaded.mid), 1e-6), litRatio: mean(pLit.hi) / Math.max(mean(pLit.mid), 1e-6) };
  restore();
  g.camera.fov = 52.4; g.camera.updateProjectionMatrix();
  return out;
`;

// A meteor: the pixels it changes, over its life, and none after it.
const METEOR_TEST = (style) => String.raw`
  setStyle('${style}');
  place(400);
  const out = { style: '${style}' };
  const ax = axisAngle();
  const m = SS.meteor(3);
  const restore = skyOnly();
  const mid = SS.skyDir(ax, m.az + 0.5 * m.len * Math.cos(m.dir) / Math.cos(m.el), m.el + 0.5 * m.len * Math.sin(m.dir));
  lookAtDir(mid, 45);
  const R = rays();
  // (The satellites are put out, and the meteor set by hand: they would be the pixels changed in a frame that has moved on.)
  const U = g.atmosphere.space.uniforms;
  for (const s of U.uSat.value) s.w = 0;
  const setMeteor = (p) => { if (p === null) U.uMeteorA.value.set(0, 0, 0, -1); else { U.uMeteorA.value.set(m.az, m.el, m.dir, p); U.uMeteorL.value = m.len; } };
  setMeteor(null);
  const base = grab();
  const changed = [];
  for (const p of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    setMeteor(p);
    const f = grab();
    for (let i = 0; i < R.w * R.h; i++) {
      if (Math.abs(luma(f.data, i * 4) - luma(base.data, i * 4)) > 25) changed.push(i);
    }
  }
  // The span of the pixels it changed, on the sky: the two farthest from each other (found from one end).
  const dirOfPx = (i) => [R.dirs[i * 3], R.dirs[i * 3 + 1], R.dirs[i * 3 + 2]];
  let span = 0;
  if (changed.length) {
    let a = changed[0], far = a, best = 0;
    for (const i of changed) { const d = Math.acos(Math.min(1, dot3(dirOfPx(a), dirOfPx(i)))); if (d > best) { best = d; far = i; } }
    best = 0;
    for (const i of changed) { const d = Math.acos(Math.min(1, dot3(dirOfPx(far), dirOfPx(i)))); if (d > best) best = d; }
    span = best / D2R;
  }
  out.changed = changed.length;
  out.span = span;
  out.len = m.len / D2R;
  // After it: the schedule has none, and the frame is the one before.
  g.atmosphere.uniforms.uTime.value = m.start + 0.7;
  g.atmosphere.space.update(m.start + 0.7);
  out.scheduled = U.uMeteorA.value.w;
  for (const s of U.uSat.value) s.w = 0;
  const after = grab();
  let diff = 0;
  for (let i = 0; i < R.w * R.h; i++) if (Math.abs(luma(after.data, i * 4) - luma(base.data, i * 4)) > 3) diff++;
  out.after = diff;
  restore();
  g.camera.fov = 52.4; g.camera.updateProjectionMatrix();
  return out;
`;

// A satellite: bright for a moment, dim between, and somewhere else a while on.
const SATELLITE_TEST = (style) => String.raw`
  setStyle('${style}');
  place(400);
  const out = { style: '${style}' };
  const ax = axisAngle();
  const restore = skyOnly();
  const setTime = (t) => { g.atmosphere.uniforms.uTime.value = t; g.atmosphere.space.update(t); };
  const at = (i, t) => { const s = SS.satellite(i, t); return SS.skyDir(ax, s.az, s.el); };
  const peak = (i, t) => {
    setTime(t);
    lookAtDir(at(i, t), 12);
    const f = grab();
    const px = pixelOf(at(i, t));
    const x = Math.round(px[0]), y = Math.round(px[1]);
    let best = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) best = Math.max(best, luma(f.data, ((y + dy) * f.w + x + dx) * 4));
    let bg = 0;
    for (const [dx, dy] of [[-12, 0], [12, 0], [0, -12], [0, 12]]) bg += luma(f.data, ((y + dy) * f.w + x + dx) * 4);
    return best - bg / 4;
  };
  // Satellite 0 is at its brightest 0.175 s into its blink and dimmest in the middle of it; a moment is taken when it
  // is well inside the sky and does not come round in the ten seconds after.
  const ph = SS.SATELLITES.list[0].phase, b = SS.SATELLITES.blink;
  const first = 100 + (b - ((100 + ph) % b)) % b;
  let t0 = first;
  for (let k = 0; k < 100; k++) {
    const t = first + b * k;
    const a = SS.satellite(0, t), c = SS.satellite(0, t + 10);
    if (Math.abs(a.az) < 40 * D2R && Math.abs(c.az) < 60 * D2R && Math.abs(c.az - a.az) < 30 * D2R) { t0 = t; break; }
  }
  out.bright = peak(0, t0 + 0.175);
  out.dim = peak(0, t0 + 2);
  const a = SS.satellite(0, t0), c = SS.satellite(0, t0 + 10);
  out.moved = Math.hypot(c.az - a.az, c.el - a.el) / D2R;
  // Where it is on the screen a while on, with the lens where it was.
  restore();
  g.camera.fov = 52.4; g.camera.updateProjectionMatrix();
  return out;
`;

// The planet's light: by the environment on a white sphere against a directional light of 0.06 of the sun's, from the planet; and on the car.
const SHINE_TEST = String.raw`
  const AT = await import('./src/render/atmosphere.js');
  setStyle('real');
  place(400);
  const out = {};
  const sv = sunVec();
  const pf = SS.planetFrame(sv);
  const pd = pf.p;
  const pose = { p: g.camera.position.clone(), q: g.camera.quaternion.clone() };
  const restorePose = () => { g.camera.position.copy(pose.p); g.camera.quaternion.copy(pose.q); g.camera.fov = 52.4; g.camera.updateProjectionMatrix(); g.camera.updateMatrixWorld(); };
  // The car's back: on and off, in the frame.
  {
    g.atmosphere.sky.material = g.atmosphere.skySpacePlain;
    g.atmosphere.bakeEnvironment();
    const on = grab();
    g.atmosphere.setTier('low');
    g.atmosphere.sky.material = g.atmosphere.skyPlain;
    g.atmosphere.bakeEnvironment();
    const off = grab();
    g.atmosphere.setTier('high');
    g.atmosphere.sky.material = g.atmosphere.skySpacePlain;
    g.atmosphere.bakeEnvironment();
    // The car, and what the sun leaves dark below the horizon (the road's shaded side, the parapet's): the planet's light
    // is on them, cold where they are neutral.
    const car = { x0: 590, x1: 690, y0: 290, y1: 375 };
    let cn = 0, cL = 0;
    for (let y = car.y0; y < car.y1; y++) for (let x = car.x0; x < car.x1; x++) {
      const i = (y * on.w + x) * 4;
      if (off.data[i] < off.data[i + 2] * 1.2 + 6) continue;
      cn++;
      cL += oklab(on.data[i], on.data[i + 1], on.data[i + 2])[0] - oklab(off.data[i], off.data[i + 1], off.data[i + 2])[0];
    }
    out.car = { n: cn, dL: cL / Math.max(cn, 1) };
    let n = 0, dr = 0, dg = 0, db = 0, dL = 0;
    for (let y = 270; y < on.h; y++) for (let x = 0; x < on.w; x++) {
      const i = (y * on.w + x) * 4;
      if (luma(off.data, i) > 40) continue;
      n++;
      dr += lin(on.data[i]) - lin(off.data[i]); dg += lin(on.data[i + 1]) - lin(off.data[i + 1]); db += lin(on.data[i + 2]) - lin(off.data[i + 2]);
      dL += oklab(on.data[i], on.data[i + 1], on.data[i + 2])[0] - oklab(off.data[i], off.data[i + 1], off.data[i + 2])[0];
    }
    out.shade = { n, dr: dr / Math.max(n, 1), dg: dg / Math.max(n, 1), db: db / Math.max(n, 1), dL: dL / Math.max(n, 1) };
  }
  // A white sphere, lit by the environment alone.
  const mat = AT.withAtmosphere(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }));
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(2, 64, 32), mat);
  const restore = skyOnly();
  g.scene.add(mesh);
  const sunI = g.atmosphere.sun.intensity;
  const sunNow = g.atmosphere.look.sunIntensity;
  const dl = new THREE.DirectionalLight(new THREE.Color(SS.SHINE.color[0], SS.SHINE.color[1], SS.SHINE.color[2]), SS.SHINE.share * sunNow);
  g.scene.add(dl);
  g.scene.add(dl.target);
  const centre = (f) => {
    let r = 0, gg = 0, b = 0, k = 0;
    for (let y = (f.h >> 1) - 3; y <= (f.h >> 1) + 3; y++) for (let x = (f.w >> 1) - 3; x <= (f.w >> 1) + 3; x++) { const i = (y * f.w + x) * 4; r += lin(f.data[i]); gg += lin(f.data[i + 1]); b += lin(f.data[i + 2]); k++; }
    return [r / k, gg / k, b / k];
  };
  out.sphere = {};
  for (const [name, sign] of [['facing', -1], ['away', 1]]) {
    const c = g.camera;
    c.position.copy(pose.p);
    const look = [pd[0] * sign, pd[1] * sign, pd[2] * sign];
    lookAtDir(look, 30);
    mesh.position.set(c.position.x + look[0] * 12, c.position.y + look[1] * 12, c.position.z + look[2] * 12);
    mesh.updateMatrixWorld();
    dl.position.set(mesh.position.x + pd[0] * 100, mesh.position.y + pd[1] * 100, mesh.position.z + pd[2] * 100);
    dl.target.position.copy(mesh.position);
    dl.target.updateMatrixWorld(); dl.updateMatrixWorld();
    dl.intensity = 0;
    g.atmosphere.setTier('low'); g.atmosphere.bakeEnvironment();
    const base = centre(grab());
    g.atmosphere.setTier('high'); g.atmosphere.bakeEnvironment();
    const glow = centre(grab());
    g.atmosphere.setTier('low'); g.atmosphere.bakeEnvironment();
    // The directional light that gives the sphere what the glow gave it (the frame's own curve is not a straight line:
    // found by bisecting), against the 0.06 of the sun's strength it is meant to be.
    const lumOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const target = lumOf(glow.map((v, i) => v - base[i]));
    let lo = 0, hi = 4 * SS.SHINE.share * sunNow;
    if (target > 0) {
      for (let k = 0; k < 10; k++) {
        const mid = (lo + hi) / 2;
        dl.intensity = mid;
        const now = centre(grab());
        if (lumOf(now.map((v, i) => v - base[i])) < target) lo = mid; else hi = mid;
      }
    }
    dl.intensity = 0;
    out.sphere[name] = { glow: glow.map((v, i) => v - base[i]), equivalent: (lo + hi) / 2 / (SS.SHINE.share * sunNow) };
  }
  g.scene.remove(mesh, dl, dl.target);
  mesh.geometry.dispose(); mat.dispose(); dl.dispose();
  g.atmosphere.setTier('high'); g.atmosphere.sky.material = g.atmosphere.skySpacePlain; g.atmosphere.bakeEnvironment();
  restore();
  restorePose();
  return out;
`;

// 120 seconds of the space world: how many meteors begin.
const DRIVE_TEST = String.raw`
  const t0 = g.atmosphere.uniforms.uTime.value;
  const n0 = g.atmosphere.space.meteors;
  for (let i = 0; i < 7200; i++) { g.pilot.vMax = 22; g.update(1 / 60); }
  return { seconds: g.atmosphere.uniforms.uTime.value - t0, meteors: g.atmosphere.space.meteors - n0, world: g.snapshot().world };
`;

// The tiers: what each draws, and what the low tier leaves undrawn.
const TIER_TEST = String.raw`
  setStyle('real');
  place(400);
  const out = {};
  const state = () => {
    g.update(1 / 60);
    const u = g.atmosphere.uniforms;
    return { t: u.uSpaceT.value, on: g.atmosphere.space.on, sat: u.uSat.value.map((v) => +v.w.toFixed(3)), meteorOn: u.uMeteorA.value.w, defines: Object.keys(g.atmosphere.sky.material.defines).join(','), tier: g.tier };
  };
  for (const tier of ['high', 'mid', 'low', 'high']) {
    g.pinTier(tier);
    g.atmosphere.uniforms.uTime.value = 100.17;
    out[tier + (out[tier] ? '2' : '')] = state();
  }
  // The shine in the environment: the glow is laid in it at the high and the mid tier, not at the low.
  const shines = {};
  for (const tier of ['high', 'mid', 'low']) {
    g.pinTier(tier);
    shines[tier] = g.atmosphere.space.shine(g.atmosphere.look);
  }
  out.shines = shines;
  g.pinTier('high');
  g.update(1 / 60);
  return out;
`;

// Every style draws, with no errors in the shaders.
const STYLES_TEST = (style) => String.raw`
  setStyle('${style}');
  place(400);
  const out = { style: '${style}', defines: Object.keys(g.atmosphere.sky.material.defines).join(',') };
  const f = grab();
  let sum = 0;
  for (let i = 0; i < f.data.length; i += 4) sum += luma(f.data, i);
  out.mean = sum / (f.w * f.h);
  // The sky as the style draws it, with the space world's code and without it.
  const restore = skyOnly();
  const R = rays();
  const a = grab();
  const space = g.atmosphere.sky.material;
  g.atmosphere.sky.material = oldSky();
  const b = grab();
  g.atmosphere.sky.material = space;
  restore();
  let n = 0, k = 0;
  for (let i = 0; i < R.w * R.h; i++) {
    if (R.dirs[i * 3 + 1] < 0.03) continue;
    n++;
    if (Math.max(Math.abs(a.data[i * 4] - b.data[i * 4]), Math.abs(a.data[i * 4 + 1] - b.data[i * 4 + 1]), Math.abs(a.data[i * 4 + 2] - b.data[i * 4 + 2])) > 3) k++;
  }
  out.changed = k / n;
  out.errors = window.__shaderErrors.slice();
  return out;
`;

// Where the world is wound over (the way into the Upside Down): the sky is the fold's, with the space world's code.
const FOLD_TEST = (style) => String.raw`
  setStyle('${style}');
  place(2200);
  const out = { style: '${style}', defines: Object.keys(g.atmosphere.sky.material.defines).join(',') };
  const f = grab();
  let sum = 0;
  for (let i = 0; i < f.data.length; i += 4) sum += luma(f.data, i);
  out.mean = sum / (f.w * f.h);
  out.errors = window.__shaderErrors.slice();
  return out;
`;

// Where the space world is only a little in view (a border to it from a world that has no stars: the stars, the
// planet and the far horizon's stars at a ten-thousandth, which is where a border begins), the sky it is drawn with
// and the sky as it was are one: nothing of it comes in at once when the program is changed for the other.
const POP_TEST = String.raw`
  setStyle('real');
  place(400);
  const u = g.atmosphere.uniforms;
  const keep = [u.uStars.value, u.uPlanet.value, Array.from(u.uRingZ.value)];
  u.uStars.value = 0.0001;
  u.uPlanet.value = 0.0001;
  for (let i = 3; i < u.uRingZ.value.length; i += 4) u.uRingZ.value[i] = 0.0001;
  const ax = axisAngle();
  const out = { worst: 0 };
  const restore = skyOnly();
  const space = g.atmosphere.sky.material;
  const sv = sunVec();
  const pf = SS.planetFrame(sv);
  for (const [name, dir, fov] of [['band', SS.skyDir(ax, SS.GALAXY.at[0], SS.GALAXY.at[1]), 50], ['planet', pf.p, 40], ['ahead', SS.skyDir(ax, 0, 0.3), 60]]) {
    lookAtDir(dir, fov);
    g.atmosphere.sky.material = space;
    const a = grab();
    // (The same program drawn again: nothing between two draws of it moves.)
    const a2 = grab();
    let again = 0;
    for (let i = 0; i < a.data.length; i++) again = Math.max(again, Math.abs(a.data[i] - a2.data[i]));
    out[name + 'Again'] = again;
    g.atmosphere.sky.material = oldSky();
    const b = grab();
    let worst = 0, at = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      const m = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
      if (m > worst) { worst = m; at = i / 4; }
    }
    out[name] = worst;
    out[name + 'At'] = { x: at % a.w, y: (at / a.w) | 0, on: [a.data[at * 4], a.data[at * 4 + 1], a.data[at * 4 + 2]], was: [b.data[at * 4], b.data[at * 4 + 1], b.data[at * 4 + 2]] };
    out.worst = Math.max(out.worst, worst);
  }
  g.atmosphere.sky.material = space;
  restore();
  u.uStars.value = keep[0]; u.uPlanet.value = keep[1]; u.uRingZ.value.set(keep[2]);
  g.camera.fov = 52.4; g.camera.updateProjectionMatrix();
  return out;
`;

// A world that is not the space world: its sky is the program it had.
const OTHER_TEST = String.raw`
  const out = {};
  for (const style of ['real', 'paint']) {
    setStyle(style);
    place(900);
    grab();
    out[style] = { defines: Object.keys(g.atmosphere.sky.material.defines).join(','), world: g.snapshot().world, stars: g.atmosphere.uniforms.uStars.value, planet: g.atmosphere.uniforms.uPlanet.value };
  }
  out.errors = window.__shaderErrors.slice();
  return out;
`;

// What it made is let go of.
const DISPOSE_TEST = String.raw`
  const { SpaceSky } = await import('./src/render/spacesky.js');
  const live = g.atmosphere.space;
  const out = { owned: live._materials.length };
  const sky = new SpaceSky({ axis: 0.3, tier: 'high' });
  const mat = sky.own(new THREE.ShaderMaterial({ vertexShader: 'void main() { gl_Position = vec4(position, 1.0); }', fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }' }));
  const scn = new THREE.Scene();
  scn.add(new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), mat));
  g.renderer.compile(scn, g.camera);
  out.before = g.renderer.info.programs.length;
  sky.dispose();
  out.after = g.renderer.info.programs.length;
  out.left = sky._materials.length;
  // Nothing of it is on once it has been let go of.
  sky.update(5);
  return out;
`;

// --- run -----------------------------------------------------------------------

const server = serve();
if (!(await waitForServer())) {
  console.error('FAIL: no server');
  server.kill();
  process.exit(1);
}
let exitCode = 0;
try {
  const page = await openPage('seed=7&world=space&s=400&cam=chase&run=60&hideui=1');
  const R = async (body) => {
    const r = await page.run(LIB + body);
    if (r && r.error) throw new Error(r.error);
    return r;
  };

  // The band.
  for (const style of ['real', 'paint']) {
    const b = await R(BAND(style));
    const need = style === 'real' ? 3 : 2.4;
    say(b.gainIn >= need, `${style}: there are ${f(b.gainIn, 1)} times as many stars on the band (within 12 degrees of it: ${b.on[0]} against the ${b.off[0]} the sky had there, as thick as it is everywhere) (at least ${need})`);
    say(Math.abs(b.on[1] - b.off[1]) <= Math.max(3, 0.15 * b.off[1]), `${style}: and as many off it (25 degrees and more: ${b.on[1]} against ${b.off[1]})`);
    if (style === 'real') {
      say(b.glow.p99 >= 0.10 && b.glow.p99 <= 0.145, `real: the band's glow is ${f(b.glow.p99, 3)} of lightness where it is brightest over a black sky (0.10 to 0.145; the middle of it ${f(b.glow.p50, 3)})`);
      say(b.lane.usable >= 6 && b.lane.gaps >= 1, `real: the dust has gaps in the band: its middle is darker than its sides in ${b.lane.gaps} of ${b.lane.usable} slices along it`);
    }
  }

  // The nebulae: over a black sky, in their colours.
  {
    const n = await R(NEBULAE_TEST);
    const want = [[270, 345], [200, 270]];
    for (const k of [0, 1]) {
      say(n[k].n > 100 && n[k].hue >= want[k][0] && n[k].hue <= want[k][1], `nebula ${k + 1}: ${k === 0 ? 'violet' : 'teal'}, at ${f(n[k].hue, 0)} degrees of hue over a black sky (${want[k][0]} to ${want[k][1]}; ${NEBULAE[k].color.join(', ')} is written)`);
      say(n[k].peak >= 0.04 && n[k].peak <= 0.20, `nebula ${k + 1}: faint, ${f(n[k].peak, 3)} of lightness at its thickest (0.04 to 0.20: the sky is black under L 0.2)`);
    }
    say(n[0].width >= 18 && n[0].width <= 36, `nebula 1 is ${f(n[0].width, 0)} degrees across (30, to within the edge of a cloud)`);
  }

  // The sky is not washed grey.
  for (const style of ['real', 'paint']) {
    const w = await R(WASH(style));
    say(w.c95On >= 0.94 * w.c95Off, `${style}: the most coloured twentieth of the sky has a chroma of ${f(w.c95On, 4)}, and had ${f(w.c95Off, 4)} (no less than 94% of it)`);
    say(w.starsOn >= 0.95 * w.starsOff, `${style}: the brightest hundred stars of the sky have ${f(w.starsOn / w.starsOff * 100, 1)}% of the light they had (${f(w.starsOn, 1)} of luma, and ${f(w.starsOff, 1)}; at least 95%)`);
    if (style === 'real') say(w.darkOn >= 0.30 && w.darkOn >= w.darkOff - 0.06, `${style}: ${f(w.darkOn * 100, 1)}% of the frame is darker than L 0.2, and was ${f(w.darkOff * 100, 1)}% (at least 30, and no less than it was by 6: space is black)`);
  }

  // The ring.
  for (const style of ['real', 'paint']) {
    const r = await R(RING_TEST(style));
    const ringL = Math.min(...r.ring.in.filter((v) => v !== null));
    say(r.edges.outer !== null && Math.abs(r.edges.outer - RING.outer) <= 0.08 && r.edges.inner !== null && Math.abs(r.edges.inner - RING.inner) <= 0.08,
      `${style}: the ring's edges are at ${r.edges.inner} and ${r.edges.outer} of the planet's radii (${RING.inner} and ${RING.outer}, within 0.08)`);
    say(r.ring.gap < 0.5 * ringL, `${style}: the gap is sky (${f(r.ring.gap, 0)} of luma against ${f(ringL, 0)} in the ring either side of it)`);
    say(r.ringShade.shaded >= 20 && r.ringShade.shadedRatio <= 0.5, `${style}: an arc of the ring (${r.ringShade.shaded} points) is in the planet's shadow, ${f(r.ringShade.shadedRatio * 100, 0)}% of what it is without it (at most 50), ${f(r.ringShade.shadedVsLit * 100, 0)}% of the lit ring`);
    say(Math.abs(r.ringShade.litRatio - 1) < 0.03, `${style}: the lit ring is as it was (${f(r.ringShade.litRatio, 3)})`);
    say(r.planetShade.shaded >= 20 && r.planetShade.shadedRatio <= 0.7, `${style}: the ring's shadow is on the planet (${r.planetShade.shaded} points at ${f(r.planetShade.shadedRatio * 100, 0)}% of what they are without it, at most 70)`);
    say(Math.abs(r.planetShade.litRatio - 1) < 0.03, `${style}: the planet out of the ring's shadow is as it was (${f(r.planetShade.litRatio, 3)})`);
  }

  // The meteors and the satellites.
  for (const style of ['real', 'paint']) {
    const m = await R(METEOR_TEST(style));
    say(m.changed >= 30 && Math.abs(m.span - m.len) <= 2.5, `${style}: a meteor changes ${m.changed} pixels over its life, a streak ${f(m.span, 1)} degrees long (${f(m.len, 1)} written, within 2.5)`);
    say(m.after === 0 && m.scheduled < 0, `${style}: 0.1 s after it is over there is none, and the frame is the frame before it (${m.after} pixels changed)`);
    const s = await R(SATELLITE_TEST(style));
    say(s.bright >= 2 * Math.max(s.dim, 1) && s.bright >= 20, `${style}: a satellite is ${f(s.bright, 0)} of luma over the sky round it at its brightest and ${f(s.dim, 0)} between (at least twice)`);
    say(s.moved >= 5 && s.moved <= 16, `${style}: a satellite has moved ${f(s.moved, 1)} degrees in ten seconds (5 to 16)`);
  }

  // The planet's light.
  {
    const s = await R(SHINE_TEST);
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const facing = s.sphere.facing;
    const ratio = facing.equivalent;
    say(ratio >= 0.8 && ratio <= 1.25,
      `a white sphere facing the planet has from the environment the light of a directional light of ${f(ratio * SHINE.share, 3)} of the sun's strength: ${f(ratio, 2)} times the ${SHINE.share} it is meant to give (0.8 to 1.25)`);
    say(facing.glow[2] > facing.glow[0], `it is a cold light (blue ${facing.glow[2].toExponential(2)}, red ${facing.glow[0].toExponential(2)})`);
    const away = s.sphere.away;
    say(lum(away.glow) <= 0.3 * lum(facing.glow), `a sphere facing away from the planet has ${f(lum(away.glow) / Math.max(lum(facing.glow), 1e-9) * 100, 0)}% of that (at most 30)`);
    say(s.shade.n >= 2000 && s.shade.db > s.shade.dr && s.shade.dr > 0 && s.shade.dL > 0 && s.shade.dL <= 0.1,
      `what the sun leaves dark below the horizon (${s.shade.n} pixels) is lit cold by it in the frame: blue ${s.shade.db.toExponential(2)} against red ${s.shade.dr.toExponential(2)}, ${f(s.shade.dL, 4)} of lightness (over 0, at most 0.1)`);
    say(s.car.n >= 200 && s.car.dL >= 0 && s.car.dL <= 0.1, `the car (${s.car.n} pixels) is no darker for it (${f(s.car.dL, 4)} of lightness, 0 to 0.1)`);
  }

  // What each tier draws.
  {
    const t = await R(TIER_TEST);
    say(t.high.t === 2 && t.high.on && t.high.sat.every((v) => v > 0) && t.high.defines.includes('SKY_SPACE'), `high: all of it (the sky has ${t.high.defines}, the satellites ${t.high.sat.join(', ')})`);
    say(t.mid.t === 1 && t.mid.on && t.mid.sat[2] === 0 && t.mid.sat[0] > 0 && t.mid.defines.includes('SKY_SPACE'), `mid: the band and the nebulae in one octave of noise, the ring without shadows, two satellites (${t.mid.sat.join(', ')})`);
    say(!t.low.on && t.low.meteorOn < 0 && t.low.sat.every((v) => v === 0) && !t.low.defines.includes('SKY_SPACE'), `low: none of it, the sky is the program it had (${t.low.defines})`);
    say(t.high2.t === 2 && t.high2.defines.includes('SKY_SPACE'), 'and back to high it is all there again');
    say(t.shines.high && t.shines.mid && t.shines.low === null, "the planet's light is in the environment at the high tier and the mid, not at the low");
  }

  // Every style draws it.
  for (const style of ['real', 'paint', 'ink', 'cel', 'print', 'pixel', 'block']) {
    const s = await R(STYLES_TEST(style));
    const shows = !['ink', 'print'].includes(style);
    say(s.errors.length === 0 && s.mean > 2 && s.defines.includes('SKY_SPACE') && (!shows || s.changed > 0.005),
      `${style}: draws (${s.defines}), the sky is changed in ${f(s.changed * 100, 1)}% of its pixels, no shader errors${s.errors.length ? ': ' + s.errors[0] : ''}`);
  }

  // Where the world is wound over.
  for (const style of ['real', 'paint']) {
    const w = await R(FOLD_TEST(style));
    say(w.defines.includes('SKY_FOLD') && w.defines.includes('SKY_SPACE') && w.errors.length === 0 && w.mean > 2,
      `${style}: where the world is wound over the sky has ${w.defines}, draws (mean luma ${f(w.mean, 1)}), no shader errors${w.errors.length ? ': ' + w.errors[0] : ''}`);
  }

  // Not a pop when the program is changed.
  {
    const p = await R(POP_TEST);
    say(p.worst <= 2, `with the stars, the planet and the far stars at a ten-thousandth, the sky is the sky as it was to within ${p.worst} levels (the band ${p.band}, the planet ${p.planet}, ahead ${p.ahead}; at most 2; the same program drawn twice differs by ${Math.max(p.bandAgain, p.planetAgain, p.aheadAgain)})${p.worst > 2 ? ' ' + JSON.stringify([p.bandAt, p.planetAt, p.aheadAt]) : ''}`);
  }

  // 120 seconds of driving.
  {
    const d = await R(DRIVE_TEST);
    say(d.meteors >= 3 && d.meteors <= 6, `${f(d.seconds, 0)} seconds in the ${d.world.id} world begin ${d.meteors} meteors (3 to 6)`);
  }

  // What it made is let go of.
  {
    const d = await R(DISPOSE_TEST);
    say(d.owned === 4 && d.after < d.before && d.left === 0, `its four skies are its own (${d.owned}); disposed, a program of it goes (${d.before} programs, then ${d.after}), none left`);
  }
  say(page.logs.filter((l) => !/KHR_parallel_shader_compile/.test(l)).length === 0, 'no error in the console' + (page.logs.length ? ': ' + page.logs[0] : ''));
  page.close();

  // A world that is not the space world.
  const other = await openPage('seed=7&world=hills&s=900&cam=chase&run=60&hideui=1');
  {
    const o = await other.run(LIB + OTHER_TEST);
    if (o.error) throw new Error(o.error);
    say(['real', 'paint'].every((st) => !o[st].defines.includes('SKY_SPACE') && o[st].stars === 0 && o[st].planet === 0) && o.errors.length === 0,
      `the hills draw their sky with the program they had (${o.real.defines || 'no defines'} in the real style, ${o.paint.defines} in the painted)`);
  }
  other.close();
} catch (e) {
  console.error(`FAIL: ${e.message}`);
  failed++;
  exitCode = 1;
} finally {
  server.kill();
}
if (failed) {
  console.error(`\n${failed} problem${failed > 1 ? 's' : ''}`);
  process.exit(1);
}
console.error('\nOK: the sky of the space world');
process.exit(exitCode);
