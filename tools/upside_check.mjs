// The Upside Down (render/upside.js, render/turn.js, render/twist.js).
//
// Runs the page headless in the shortened loop that goes from space into it
// (worlds 1500 m long), drives it from the page, and asserts:
//  - the world is there, last in the list, and its look is its own;
//  - the way in is a corkscrew in the world: a straight stretch of the road,
//    200 to 500 m of it, is wound a half turn, by where each point stands
//    along it and not by where the lens is, so from before it the road ahead
//    is seen going over; the road under the car is drawn under the car all
//    the way through, and what is far ahead holds still on the screen while
//    the car goes over;
//  - the view rolls with the car, by where it is on the road and not by the
//    clock: the same at 22 m/s and at 40, quickest in the middle, a half turn
//    at the end (a hair past it first), and a car that stops half way stays
//    on its side; on its side the car is still near the middle of the screen
//    and the field of view is wider; in it the sky is at the bottom and the
//    wheel is turned the other way;
//  - the way out winds on the same way round, to a whole turn, and gives the
//    wheel back; a car put down inside is inside at once;
//  - in it there is lightning (a flash lights the sky) and things that
//    stand by the road and lean toward the car;
//  - the land is folded over with the road, more slowly the further from it:
//    across the middle of the fold, what is 0, 100, 300, 1000, 3000 m from
//    the road goes from a tenth of the way over to nine tenths in half the
//    length it is wound over, which grows with that distance;
// and, the worlds their full length, on the way in from space and the way
// out:
//  - the fold holds still: a place in it, 600 m from the road, is drawn
//    where it was drawn a step before, to a metre, all the way up from
//    2800 m, and the furthest twentieth of the frame never changes colour
//    at once;
//  - the sky does not turn: through the stretch the dome stands on the
//    screen as it stood before or a half turn from that, and it is a half
//    turn from it only while the sky of the other side is whole under its
//    horizon, when the two are the same picture (drawn both ways, the
//    frames are the same); the other sky is under the horizon all round only
//    by the winding, and far from it only toward the fold;
//  - a mesh drawn turned is tested against the frustum where it is drawn:
//    none drawn in view is left out, and not every one is let through;
//  - over a sea (the way in from space) the car is seen all the way through
//    the stretch: the sea is wound with the land, on a disc fine enough;
//  - while anything is wound the land is drawn thinner where the fold lifts
//    it far off, and its underside into the depth; with no winding in reach
//    (the hills) the land, the sea and the sky are as they are anywhere;
//  - where the road winds across the border (seed 11) the stretch is put on
//    a straight length of it nearby, and the car goes over once and stays
//    over;
//  - the clouds baked into the sky (render/clouds.js) are read by
//    direction, so the dome that lays the other sky draws them the same
//    picture a half turn on;
//  - every style draws the turned world without an error.
//
// Usage: node tools/upside_check.mjs
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

// The page, headless, and a way to run code in it; errors the page logs
// come back with it.
async function openPage(query, size = '960,540') {
  const profile = `${tmpdir()}/continuum-upside-${process.pid}-${Date.now()}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', `--window-size=${size}`, '--remote-debugging-port=0', `--user-data-dir=${profile}`,
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
  for (let i = 0; i < 600; i++) {
    title = await ev('document.title');
    if (title === 'GAME_DONE' || String(title).startsWith('GAME_FAIL')) break;
    await sleep(500);
  }
  if (title !== 'GAME_DONE') throw new Error(`page: ${title}`);
  return {
    logs,
    run: async (body) => {
      const out = await ev(`(async () => { const g = game; ${body} })().then((v) => JSON.stringify(v), (e) => JSON.stringify({ error: e.message }))`);
      return JSON.parse(out);
    },
    close: () => {
      chrome.kill();
      setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
    },
  };
}

// In the page: where the share of the Upside Down along the road goes from
// nothing to all, and where it is half (the middle of the corkscrew).
const FIND = `
  const o = g.road.origin;
  const top = g.road.classified * 2 - 4;
  let s0 = null, s1 = null, sMid = null;
  for (let s = 120; s < top; s += 2) {
    const p = g.road.at(s);
    if (!p) continue;
    const sh = g.upside.shareAt(p.x + o.x, p.z + o.z);
    if (s0 === null && sh > 0.03) s0 = s;
    if (sMid === null && sh >= 0.5) sMid = s;
    if (s1 === null && sh > 0.97) s1 = s;
  }
  const list = g.worlds.list;
  const last = list[list.length - 1];
  return { s0, s1, sMid, last: last.id, lookUp: last.look.upside, count: list.length };
`;

// In the page: the car put on the road at s, running; what the view is like
// there. Mean brightness of the top and bottom thirds of the frame, as
// drawn, and again with the camera rolled back upright (the same scene the
// way up it was).
const AT = (s, extra = '') => `
  const p = g.road.at(${s});
  g.autoMode = true;
  g.sCar = ${s};
  g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(${s}, 1.9) + 0.3);
  g.car.vx = 22;
  for (let i = 0; i < 90; i++) g.update(1 / 60);
  ${extra}
  const measure = async () => {
    g.render();
    const c = document.getElementById('view');
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await img.decode();
    const w = img.width, h = img.height;
    const cv = new OffscreenCanvas(w, h);
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0);
    const px = cx.getImageData(0, 0, w, h).data;
    const band = (y0, y1) => {
      let sum = 0, n = 0, hot = 0;
      for (let y = Math.floor(h * y0); y < Math.floor(h * y1); y += 2) for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4;
        const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
        sum += l; n++;
        if (l > 0.93) hot++;
      }
      return { mean: sum / n, hot };
    };
    return { top: band(0, 0.33), bottom: band(0.67, 1) };
  };
  const up = g.upside;
  const drawn = await measure();
  const state = { roll: up.roll, turning: up.turning, tentacles: up.mesh.count, flash: up.flash, share: up.share,
    bats: g.critters.bats.shown, roots: up.creep.roots.length, segments: up.creep.shown, infect: up.infect };
  g.camera.rotateZ(-up.roll);
  const straight = await measure();
  g.camera.rotateZ(up.roll);
  return { ...state, top: drawn.top.mean, bottom: drawn.bottom.mean, hotBottom: drawn.bottom.hot, topStraight: straight.top.mean, bottomStraight: straight.bottom.mean };
`;

// In the page: the car put on the road \`back\` m before s and settled, running steady.
const PUT = (s, back, v = 22) => `
  const at0 = ${s} - ${back};
  const p0 = g.road.at(at0);
  g.autoMode = true;
  g.sCar = at0;
  g.car.reset(p0.x - Math.sin(p0.theta) * 1.9, p0.z + Math.cos(p0.theta) * 1.9, p0.theta, g.road.surfaceAt(at0, 1.9) + 0.3);
  g.car.vx = ${v};
  for (let i = 0; i < 90; i++) { g.pilot.vMax = ${v}; g.update(1 / 60); }
`;

// In the page: the car put down at s, and three frames on.
const QUICK = (s) => `
  const p1 = g.road.at(${s});
  g.autoMode = true;
  g.sCar = ${s};
  g.car.reset(p1.x - Math.sin(p1.theta) * 1.9, p1.z + Math.cos(p1.theta) * 1.9, p1.theta, g.road.surfaceAt(${s}, 1.9) + 0.3);
  g.car.vx = 22;
  for (let i = 0; i < 3; i++) g.update(1 / 60);
  return { roll: g.upside.roll, turning: g.upside.turning };
`;

// In the page: the wound stretch the car is by: where the road crosses the
// border, the stretch's middle on the road, how much of the road it is and
// how long its line.
const ZONE = `
  const z = g.upside.zone;
  return z && { cross: z.cross, s: z.s, run: z.run, len: z.len, lo: z.lo };
`;

// In the page: how far over the land is wound under the road at places along
// it (m from the middle of the stretch), as the world has it.
const WOUND = (mid, offsets) => `
  const u = g.upside;
  return { twisted: u.twisted, off: u._culled.size,
    angles: ${JSON.stringify(offsets)}.map((d) => { const p = g.road.at(${mid} + d); return p ? u.angleAt(p.x, p.z) : null; }) };
`;

// In the page: drive on for \`metres\`, a frame at a time: [where the car is on
// the road, the roll the game says, the roll the camera really has (from its
// own axes), rad/s, field of view, the field of view the rig asked for, where
// the car is on the screen (x, y, -1..1), still turning, how far from itself
// the road under the car is drawn (m), which way up on the screen the world
// \`far\` m along the road is drawn (rad; -π/2 is upside down), meshes with
// the frustum test off].
const WATCH = (metres, far, v = 22) => `
  const V = g.camera.position.constructor;
  const u = g.upside;
  const rows = [];
  const sFrom = g.sCar;
  const pf = g.road.at(${far});
  const o0 = { x: g.road.origin.x, z: g.road.origin.z };
  for (let i = 0; i < 3000 && g.sCar < sFrom + ${metres}; i++) {
    g.pilot.vMax = ${v};
    g.update(1 / 60);
    g.camera.updateMatrixWorld();
    const q = g.camera.quaternion;
    const upv = new V(0, 1, 0).applyQuaternion(q);
    const rightv = new V(1, 0, 0).applyQuaternion(q);
    const c = new V(g.car.x, g.car.y + 0.7, g.car.z).project(g.camera);
    const pc = g.road.at(g.sCar);
    const under = new V(pc.x, pc.y, pc.z);
    const slip = u.drawn(under.clone(), g.camera).distanceTo(under);
    const ox = o0.x - g.road.origin.x, oz = o0.z - g.road.origin.z;
    const a = u.drawn(new V(pf.x + ox, pf.y, pf.z + oz), g.camera).project(g.camera);
    const b = u.drawn(new V(pf.x + ox, pf.y + 40, pf.z + oz), g.camera).project(g.camera);
    const way = Math.atan2(b.y - a.y, (b.x - a.x) * g.camera.aspect);
    rows.push([g.sCar, u.roll, Math.atan2(rightv.y, upv.y), u.rate, g.camera.fov, g.chase.fov.value, c.x, c.y, u.turning ? 1 : 0, slip, way, u._culled.size]);
  }
  return { rows };
`;

// In the page: the car stood still on the road at s for a second, then
// another: the roll after each.
const STAND = (s) => `
  const p = g.road.at(${s});
  g.autoMode = true;
  g.sCar = ${s};
  g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(${s}, 1.9) + 0.3);
  g.car.vx = 0;
  const rolls = [];
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < 60; i++) { g.pilot.vMax = 0; g.update(1 / 60); }
    rolls.push(g.upside.roll);
  }
  return { rolls, at: g.sCar };
`;

// In the page: the car driven from s on until the way out of the Upside Down
// is laid (where the world is half of it again), and where that is.
const FIND_OUT = (from) => `
  const o = g.road.origin;
  const p0 = g.road.at(${from});
  g.autoMode = true;
  g.sCar = ${from};
  g.car.reset(p0.x - Math.sin(p0.theta) * 1.9, p0.z + Math.cos(p0.theta) * 1.9, p0.theta, g.road.surfaceAt(${from}, 1.9) + 0.3);
  g.car.vx = 40;
  const look = () => {
    const top = g.road.classified * 2 - 4;
    for (let s = ${from}; s < top; s += 2) {
      const p = g.road.at(s);
      if (!p) continue;
      const z = g.upside.zoneAt(p.x + o.x, p.z + o.z);
      if (z.out && z.share <= 0.5) return s;
    }
    return null;
  };
  let sOut = null;
  for (let i = 0; i < 4000 && sOut === null; i++) {
    g.pilot.vMax = 40;
    g.update(1 / 60);
    if (i % 30 === 29) sOut = look();
  }
  return { sOut, at: Math.round(g.sCar) };
`;

// In the page: a wheel held over for a second: which way the car turns.
const STEER = (s) => `
  const p = g.road.at(${s});
  g.autoMode = false;
  g.sCar = ${s};
  g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(${s}, 1.9) + 0.3);
  g.car.vx = 14;
  g.driver.read = () => ({ steer: 0.6, throttle: 0.3, brake: 0 });
  const y0 = g.car.yaw;
  for (let i = 0; i < 40; i++) g.update(1 / 60);
  const dy = g.car.yaw - y0;
  g.autoMode = true;
  return { dy };
`;

// In the page: put down at s and run, held still (no lightning, the shake
// and the clouds' clocks held), for what follows.
const STILL = `
  g.chase.shake = { get value() { return 0; }, set value(v) {}, step() {}, reset() {} };
  g.chase.shakeSeed = 1;
  const still = () => {
    g.upside._next = 1e9; g.upside._age = 99;
    g.atmosphere.uniforms.uTime.value = 100; g.style.wind[0] = 1000; g.style.wind[1] = 400;
  };
  const put = (s) => {
    const p = g.road.at(s);
    g.autoMode = true;
    g.sCar = s;
    g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(s, 1.9) + 0.3);
    g.car.vx = 22;
    g.chase.snapTo(g.car, g.car.y || 0);
  };
  const drive = (n) => { for (let i = 0; i < n; i++) { still(); g.pilot.vMax = 22; g.update(1 / 60); } };
`;

// In the page: where on the road the world is half the Upside Down, going
// in (or out), the car put on as far as the road is laid until it is.
const CROSSING = (into) => `
  const o = g.road.origin;
  const look = () => {
    const top = g.road.classified * 2 - 4;
    let pv = -1;
    for (let s = Math.max(g.road.start + 2, g.sCar); s < top; s += 2) {
      const p = g.road.at(s);
      if (!p) continue;
      const v = g.upside.shareAt(p.x + o.x, p.z + o.z);
      if (pv >= 0 && (${into} ? pv < 0.5 && v >= 0.5 : pv >= 0.5 && v < 0.5)) return s;
      pv = v;
    }
    return null;
  };
  let mid = look();
  for (let k = 0; k < 20 && mid === null; k++) {
    const s = g.road.classified * 2 - 900;
    const p = g.road.at(s);
    g.sCar = s;
    g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(s, 1.9) + 0.3);
    g.car.vx = 22;
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    mid = look();
  }
  return { mid };
`;

// In the page: the wound stretch by `mid` on the road, the one in reach of
// the car where it is (the road is kept 2600 m behind the car, so the car is
// not put anywhere for this), and where on the road it starts.
const STRETCH = (mid) => `
  drive(2);
  const zn = g.upside.zone;
  if (!zn || Math.abs(zn.cross - ${mid}) > 20) throw new Error('the stretch by ${mid} is not the one in reach');
  const s0 = zn.s - zn.run / 2;
`;

// In the page: driven from \`from\` m before the stretch's start to \`past\`
// m past it, each step how far off the start is, the angle the dome is
// turned by and how much of the other side's sky is under its horizon all
// round (render/upside.js lays both), the view's roll, whether anything is
// drawn turned, whether the dome has the shader that draws the other sky,
// and how far the fold's way (as the dome has it) is from the way to the
// stretch's middle on the level (a cosine).
const SKYRUN = (mid, from, past) => `
  ${STILL}
  ${STRETCH(mid)}
  put(s0 - ${from} - 33);
  drive(90);
  const t = g.atmosphere.sky.material.uniforms.uSkyTurn.value;
  const rows = [];
  for (let i = 0; i < 40000 && g.sCar - s0 < ${past}; i++) {
    drive(1);
    const mx = zn.p.x + zn.d.x * zn.len / 2 - g.car.x, mz = zn.p.z + zn.d.z * zn.len / 2 - g.car.z;
    // Past the middle the dome is the other world's: its way is this one's
    // across the stretch's line.
    let fx = t[2], fz = t[3];
    if ((g.upside.roll - zn.lo) / zn.span >= 0.5) {
      const k = 2 * (fx * zn.d.x + fz * zn.d.z);
      fx = k * zn.d.x - fx;
      fz = k * zn.d.z - fz;
    }
    rows.push([s0 - g.sCar, t[0], t[1], g.upside.roll, g.upside.twisted ? 1 : 0, [g.atmosphere.skyFold, g.atmosphere.skySpaceFold].includes(g.atmosphere.sky.material) ? 1 : 0,
      (fx * mx + fz * mz) / (Math.hypot(mx, mz) || 1)]);
  }
  return { rows, run: zn.run };
`;

// In the page, the car in the stretch: the sky alone, drawn as the game's
// lens sees it, the dome turned by an angle and by a half turn more with
// the other side's sky whole (the same picture), and by a little more (not
// the same); and through a level lens looking across the stretch's line,
// with the other side's sky and with the fold behind the lens (none of it):
// the same above the horizon, and under it the other sky where the ground
// was. Each a mean difference of the frames, of 1.
const SKYPIX = (mid) => `
  ${STILL}
  ${STRETCH(mid)}
  put(s0 + zn.run * 0.3 - 33);
  drive(90);
  const THREE = await import('three');
  const r = g.renderer, cam = g.camera;
  const W = 192, H = 108;
  const rt = new THREE.WebGLRenderTarget(W, H);
  const scene = new THREE.Scene();
  const dome = new THREE.Mesh(g.atmosphere.sky.geometry, g.atmosphere.skyFold);
  dome.frustumCulled = false;
  dome.scale.setScalar(4000);
  dome.position.copy(cam.position);
  scene.add(dome);
  const U = g.atmosphere.sky.material.uniforms;
  const keep = Array.from(U.uSkyTurn.value);
  const shot = (lens, angle, all, fx = keep[2], fz = keep[3]) => {
    U.uSkyTurn.value.set([angle, all, fx, fz]);
    const buf = new Uint8Array(W * H * 4);
    r.setRenderTarget(rt);
    r.clear();
    r.render(scene, lens);
    r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    r.setRenderTarget(null);
    return buf;
  };
  // Rows y0 to y1 of the frame, from the bottom.
  const diff = (a, b, y0 = 0, y1 = H) => {
    let sum = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    }
    return sum / ((y1 - y0) * W * 3 * 255);
  };
  const one = shot(cam, 0.4, 1);
  const half = diff(one, shot(cam, 0.4 + Math.PI, 1));
  const some = diff(one, shot(cam, 0.7, 1));
  const level = cam.clone();
  level.up.set(0, 1, 0);
  level.lookAt(cam.position.x - zn.d.z, cam.position.y, cam.position.z + zn.d.x);
  level.updateMatrixWorld();
  const whole = shot(level, 0, 1);
  const none = shot(level, 0, 0, zn.d.z, -zn.d.x);
  U.uSkyTurn.value.set(keep);
  rt.dispose();
  return { twisted: g.upside.twisted, roll: g.upside.roll, half, some, above: diff(whole, none, 66, H), under: diff(whole, none, 0, 42) };
`;

// In the page: at five places through the stretch (up to where the look is
// still mostly the world's before it: past that the car is in the Upside
// Down's dark, and red only by its lamps), the frame drawn, and of the 81
// pixels about where the car's body is on the screen, how many are the
// car's red. Whether the sea is on its finer disc, and how far under
// the road it is.
const CARSEEN = (mid) => `
  ${STILL}
  ${STRETCH(mid)}
  const THREE = await import('three');
  const r = g.renderer, gl = r.getContext(), cam = g.camera;
  const out = [];
  const buf = new Uint8Array(9 * 9 * 4);
  for (const f of [0.1, 0.25, 0.4, 0.55, 0.7]) {
    const d = f * zn.run;
    put(s0 + d - 55);
    drive(140);
    for (let i = 0; i < 400 && g.sCar - s0 < d; i++) drive(1);
    g.render();
    r.setRenderTarget(null);
    const W = r.domElement.width, H = r.domElement.height;
    const p = g.upside.drawn(new THREE.Vector3(g.car.x, g.car.y + 0.7, g.car.z), cam).project(cam);
    gl.readPixels(Math.round((p.x * 0.5 + 0.5) * W) - 4, Math.round((p.y * 0.5 + 0.5) * H) - 4, 9, 9, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let red = 0;
    for (let i = 0; i < buf.length; i += 4) if (buf[i] > 60 && buf[i] > 1.6 * buf[i + 1] && buf[i] > 1.6 * buf[i + 2]) red++;
    out.push(red);
  }
  return { out, fine: g.water.mesh.geometry === g.water.fine, under: g.car.y - g.water.mesh.position.y };
`;

// In the page: \`d\` m before the stretch's start, the lens put over the car
// and turned a radian across the stretch's line (the winding is laid for
// the lens as it is), and there each mesh three would test against the
// frustum: where it is drawn (its bounding sphere's centre turned as the
// shaders turn it, half again its radius), and whether its frustum test is
// off. One that is all drawn where it stands (the angle at its middle and
// at its four ends is the car's) is not counted.
const CULL = (mid, d) => `
  ${STILL}
  ${STRETCH(mid)}
  const THREE = await import('three');
  const tw = await import('./src/render/twist.js');
  put(s0 - ${d} - 33);
  drive(30);
  const u = g.upside, cam = g.camera;
  const chaseUpdate = g.chase.update;
  g.chase.update = function (...args) {
    chaseUpdate.apply(this, args);
    const k = g.car, a = Math.atan2(zn.d.z, zn.d.x) + 1;
    cam.up.set(0, 1, 0);
    cam.position.set(k.x - Math.cos(a) * 12, k.y + 6, k.z - Math.sin(a) * 12);
    cam.lookAt(k.x + Math.cos(a) * 1000, k.y + 6, k.z + Math.sin(a) * 1000);
    cam.updateMatrixWorld();
  };
  drive(60);
  g.chase.update = chaseUpdate;
  const fwd = new THREE.Vector3();
  cam.getWorldDirection(fwd);
  const across = Math.acos(Math.min(1, Math.abs(fwd.x * zn.d.x + fwd.z * zn.d.z) / Math.hypot(fwd.x, fwd.z))) * 180 / Math.PI;
  g.scene.updateMatrixWorld();
  cam.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const ref = tw.twistRef();
  const at = (x, y, z) => tw.twistAt(x, z) + tw.twistNear(x, y, z);
  let meshes = 0, off = 0, turned = 0, seen = 0, missed = 0, kept = 0;
  const walk = (o) => {
    if (!o.visible) return;
    if (o.isMesh) {
      meshes++;
      if (!o.frustumCulled) off++;
      const sph = o.boundingSphere !== undefined ? (o.boundingSphere || (o.computeBoundingSphere(), o.boundingSphere))
        : (o.geometry.boundingSphere || (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere));
      const c = sph.center.clone().applyMatrix4(o.matrixWorld);
      const rad = sph.radius * o.matrixWorld.getMaxScaleOnAxis();
      const level = [[0, 0], [zn.d.x, zn.d.z], [-zn.d.x, -zn.d.z], [-zn.d.z, zn.d.x], [zn.d.z, -zn.d.x]]
        .every(([ex, ez]) => Math.abs(at(c.x + ex * rad, c.y, c.z + ez * rad) - ref) < 1e-9);
      if (!level) {
        turned++;
        if (o.frustumCulled) kept++;
        if (frustum.intersectsSphere(new THREE.Sphere(u.drawn(c, cam), rad * 1.5))) {
          seen++;
          if (o.frustumCulled) missed++;
        }
      }
    }
    for (const k of o.children) walk(k);
  };
  walk(g.scene);
  return { at: s0 - g.sCar, across, meshes, off, turned, seen, missed, kept, twisted: u.twisted };
`;

// In the page: a place in the fold, \`side\` m off the stretch's line, on the
// ground: of those level with the stretch's middle and 400 and 800 m either
// way along its line, on either side, the one nearest half way over. And
// the car driven from \`from\` m before the stretch to \`to\` m before it:
// each step where the place is drawn, in the worlds' own coordinates. The
// largest step, and how far apart the first and the last are.
const HELD = (mid, side, from, to) => `
  ${STILL}
  ${STRETCH(mid)}
  const THREE = await import('three');
  const o = g.road.origin;
  let ax = 0, az = 0, angle = -1, along = 0, off = 0;
  for (const a of [-800, -400, 0, 400, 800]) for (const sd of [-${side}, ${side}]) {
    const x = zn.ax + zn.d.x * (zn.len / 2 + a) - zn.d.z * sd;
    const z = zn.az + zn.d.z * (zn.len / 2 + a) + zn.d.x * sd;
    const v = g.upside.angleAt(x - o.x, z - o.z) - zn.lo;
    if (Math.abs(v - Math.PI / 2) < Math.abs(angle - Math.PI / 2)) { ax = x; az = z; angle = v; along = a; off = sd; }
  }
  const ay = g.corridor.heightAt(ax, az);
  put(s0 - ${from} - 33);
  drive(90);
  let first = null, last = null, step = 0, n = 0;
  for (let i = 0; i < 40000 && s0 - g.sCar > ${to}; i++) {
    drive(1);
    const p = g.upside.drawn(new THREE.Vector3(ax - o.x, ay, az - o.z), g.camera);
    p.x += o.x;
    p.z += o.z;
    if (last) step = Math.max(step, p.distanceTo(last));
    if (!first) first = p.clone();
    last = p;
    n++;
  }
  return { step, drift: first.distanceTo(last), n, angle, along, off, twisted: g.upside.twisted };
`;

// In the page: driven from \`from\` m before the stretch to \`to\` m before
// it, the lens held over the car looking along the stretch's line, level
// (what moves in the far of the frame is then what the fold does, not the
// lens swinging round the bends); every tenth step the mean colour (OKLab)
// of the furthest twentieth of the frame by depth, and how far that is from
// the one before.
const FAR = (mid, from, to) => `
  ${STILL}
  ${STRETCH(mid)}
  const THREE = await import('three');
  const { FullScreenQuad } = await import('./tools/vendor/postprocessing/Pass.js');
  const r = g.renderer, cam = g.camera, gl = r.getContext();
  const W = r.domElement.width, H = r.domElement.height;
  const w = W >> 1, h = H >> 1;
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(w, h) });
  const enc = new THREE.WebGLRenderTarget(w, h);
  const quad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tDepth: { value: rt.depthTexture }, uNF: { value: new THREE.Vector2() } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'precision highp float; uniform sampler2D tDepth; uniform vec2 uNF; varying vec2 vUv; void main() { float d = texture2D(tDepth, vUv).r; float z = uNF.x * uNF.y / (uNF.y - d * (uNF.y - uNF.x)); float v = d >= 0.999995 ? 1.0 : clamp(log2(1.0 + z) / log2(1.0 + uNF.y), 0.0, 0.99998); float a = floor(v * 65535.0 + 0.5); gl_FragColor = vec4(mod(a, 256.0) / 255.0, floor(a / 256.0) / 255.0, 0.0, 1.0); }',
    depthTest: false, depthWrite: false }));
  const colour = new Uint8Array(W * H * 4), dbuf = new Uint8Array(w * h * 4), depth = new Uint16Array(w * h);
  const LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const oklab = (R, G, B) => {
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const hist = new Uint32Array(65536);
  const far = () => {
    g.render();
    r.setRenderTarget(null);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, colour);
    const auto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    quad.material.uniforms.uNF.value.set(cam.near, cam.far);
    r.setRenderTarget(rt); r.clear(); r.render(g.scene, cam);
    r.setRenderTarget(enc); quad.render(r);
    r.readRenderTargetPixels(enc, 0, 0, w, h, dbuf);
    r.setRenderTarget(null);
    r.shadowMap.autoUpdate = auto;
    hist.fill(0);
    for (let i = 0; i < w * h; i++) { depth[i] = dbuf[i * 4] | (dbuf[i * 4 + 1] << 8); hist[depth[i]]++; }
    // Exactly the furthest twentieth: the pixels further than the cut, and
    // of those at the cut (the sky, all at the furthest depth there is) as
    // many as are wanted, from the top of the frame down.
    const want = Math.round(w * h * 0.05);
    let cut = 65535, above = 0;
    while (above + hist[cut] < want) above += hist[cut--];
    let left = want - above;
    let R = 0, G = 0, B = 0, n = 0;
    for (let y = h - 1; y >= 0; y--) for (let x = 0; x < w; x++) {
      const dv = depth[y * w + x];
      if (dv < cut || (dv === cut && left <= 0)) continue;
      if (dv === cut) left--;
      const k = (y * 2 * W + x * 2) * 4;
      R += LIN[colour[k]]; G += LIN[colour[k + 1]]; B += LIN[colour[k + 2]]; n++;
    }
    return oklab(R / n, G / n, B / n);
  };
  const chaseUpdate = g.chase.update;
  g.chase.update = function (...args) {
    chaseUpdate.apply(this, args);
    const k = g.car;
    cam.up.set(0, 1, 0);
    cam.position.set(k.x - zn.d.x * 10, k.y + 60, k.z - zn.d.z * 10);
    cam.lookAt(k.x + zn.d.x * 1000, k.y + 60, k.z + zn.d.z * 1000);
    cam.updateMatrixWorld();
  };
  put(s0 - ${from} - 33);
  drive(90);
  let prev = null, most = 0, at = 0, n = 0;
  for (let i = 1; i < 40000 && s0 - g.sCar > ${to}; i++) {
    drive(1);
    if (i % 10) continue;
    const lab = far();
    if (prev) {
      const d = Math.hypot(lab[0] - prev[0], lab[1] - prev[1], lab[2] - prev[2]);
      if (d > most) { most = d; at = s0 - g.sCar; }
    }
    prev = lab;
    n++;
  }
  g.chase.update = chaseUpdate;
  rt.dispose();
  enc.dispose();
  return { most, at, n };
`;

// In the page: across the middle of the fold, what is rho m from the road:
// how far it is from a tenth of the way over to nine tenths (the land's own
// rule, twistShare, the place the same distance along the stretch's line as
// past the border).
const SLOW = (mid, rhos) => `
  ${STILL}
  ${STRETCH(mid)}
  const tw = await import('./src/render/twist.js');
  const at = (rho, a) => tw.twistShare(zn, a + zn.len / 2, rho, a);
  const cross = (rho, v) => { let lo = -4000, hi = 4000; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (at(rho, m) < v) lo = m; else hi = m; } return (lo + hi) / 2; };
  return { len: zn.len, wide: ${JSON.stringify(rhos)}.map((rho) => cross(rho, 0.9) - cross(rho, 0.1)), over: [tw.LEN_K, tw.LEN_MAX] };
`;

// In the page: the car driven from \`from\` m before the crossing to \`to\` m
// past it: the stretch found, and each step the roll.
const ONCE = (mid, from, to) => `
  ${STILL}
  put(${mid} - ${from});
  drive(60);
  const zn = g.upside.zone;
  const rolls = [];
  for (let i = 0; i < 40000 && g.sCar < ${mid} + ${to}; i++) {
    drive(1);
    rolls.push([g.sCar, g.upside.roll]);
  }
  return { zone: zn && { cross: zn.cross, s: zn.s, run: zn.run, len: zn.len }, same: g.upside.zone === zn, rolls };
`;


// In the page, in a world with clouds under a style that bakes them: the
// dome that lays the other side's sky, with the clouds in it, drawn as the
// lens sees it, turned a half turn about the fold's line with the other
// sky whole (the same picture), and by 0.3 rad more
// (not the same). Each a mean difference of the frames, of 1,
// and how much of the picture is cloud.
const SKYCLOUD = `
  const THREE = await import('three');
  const r = g.renderer, cam = g.camera;
  const W = 192, H = 108;
  const rt = new THREE.WebGLRenderTarget(W, H);
  const scene = new THREE.Scene();
  const dome = new THREE.Mesh(g.atmosphere.sky.geometry, g.atmosphere.skyFoldHeaps);
  dome.frustumCulled = false;
  dome.scale.setScalar(4000);
  dome.position.copy(cam.position);
  scene.add(dome);
  const U = g.atmosphere.uniforms;
  const keepTurn = Array.from(U.uSkyTurn.value);
  const keepAxis = Array.from(U.uSkyAxis.value);
  const way = 0.6;
  U.uSkyAxis.value.set([Math.cos(way), 0, Math.sin(way), 0]);
  const look = cam.clone();
  look.up.set(0, 1, 0);
  // Toward a tower of the fair sky (25 degrees off the road's way), a little above the horizon.
  const toward = Math.atan2(g.worlds.dz, g.worlds.dx) + 0.45;
  look.lookAt(cam.position.x + Math.cos(toward), cam.position.y + 0.3, cam.position.z + Math.sin(toward));
  look.updateMatrixWorld();
  // The turn is the winding's: on, about the fold's line as the lens sees it.
  const keepTwist = Array.from(U.uTwist.value);
  const keepTwistAxis = Array.from(U.uTwistAxis.value);
  const av = new THREE.Vector3(Math.cos(way), 0, Math.sin(way)).transformDirection(look.matrixWorldInverse);
  U.uTwist.value[0] = 1;
  U.uTwistAxis.value.set([av.x, av.y, av.z, 0]);
  const shot = (angle) => {
    U.uSkyTurn.value.set([angle, 1, Math.cos(way), Math.sin(way)]);
    const buf = new Uint8Array(W * H * 4);
    r.setRenderTarget(rt);
    r.clear();
    r.render(scene, look);
    r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    r.setRenderTarget(null);
    return buf;
  };
  const diff = (a, b) => {
    let sum = 0;
    for (let i = 0; i < W * H * 4; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    return sum / (W * H * 3 * 255);
  };
  const one = shot(0.4);
  const half = diff(one, shot(0.4 + Math.PI));
  const some = diff(one, shot(0.7));
  // Cloud: a pixel that is not the blue it would be without the clouds.
  U.uHeaps.value = 0;
  const bare = shot(0.4);
  U.uHeaps.value = 1;
  let cloud = 0;
  for (let i = 0; i < W * H * 4; i += 4) if (Math.abs(one[i] - bare[i]) + Math.abs(one[i + 1] - bare[i + 1]) + Math.abs(one[i + 2] - bare[i + 2]) > 30) cloud++;
  U.uSkyTurn.value.set(keepTurn);
  U.uSkyAxis.value.set(keepAxis);
  U.uTwist.value.set(keepTwist);
  U.uTwistAxis.value.set(keepTwistAxis);
  rt.dispose();
  return { half, some, cloud: cloud / (W * H), baked: g.atmosphere.clouds.baked, set: g.atmosphere.clouds.set };
`;

const failures = [];
function check(ok, text) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failures.push(text);
}
const f2 = (v) => (typeof v === 'number' ? v.toFixed(2) : String(v));

const server = serve();
try {
  if (!(await waitForServer())) throw new Error('the dev server did not come up');
  const page = await openPage('seed=7&world=space&worldlen=1500&run=60&cam=chase&style=real');
  try {
    const found = await page.run(FIND);
    check(found.last === 'upside' && found.count === 12 && found.lookUp === 1, `the Upside Down is the twelfth world, and its look is its own (${found.last}, ${found.count} worlds)`);
    const span = found.s1 - found.s0;
    check(found.s0 !== null && span >= 40 && span <= 300, `the road turns over across ${span} m (from ${found.s0} to ${found.s1})`);

    const mid = found.sMid;
    check(mid !== null && mid > found.s0 && mid < found.s1, `the world is half of it at ${mid} m`);

    // The stretch that is wound: a straight length of the road by there.
    const zone = (await page.run(PUT(mid, Math.min(600, mid - 130)) + ZONE)) || {};
    const run = zone.run;
    const z0 = zone.s - run / 2;
    const z1 = zone.s + run / 2;
    check(Math.abs(zone.cross - mid) < 12 && Math.abs(zone.s - zone.cross) <= 500 && run >= 200 && run <= 500 && zone.len <= run + 0.5 && zone.len >= run / 1.08,
      `${f2(run)} m of the road is wound by there, nearly straight (${f2(zone.len)} m from end to end), its middle ${f2(zone.s - zone.cross)} m on from where the road crosses the border (at ${f2(zone.cross)} m)`);

    const before = await page.run(AT(z0 - 150));
    check(Math.abs(before.roll) < 1e-6 && !before.turning, `before the corkscrew the view is as it was (rolled ${f2(before.roll)} rad)`);

    // The corkscrew is in the world. From before it: the road ahead is wound
    // from nothing to a half turn over its length, and the same places are
    // wound the same seen from nearer, and from the air.
    const places = [-0.65, -0.5, -0.25, 0, 0.25, 0.5, 0.65].map((f) => Math.round(f * run));
    const w1 = await page.run(PUT(z0, 150) + WOUND(zone.s, places));
    const w2 = await page.run(PUT(z0, 20) + WOUND(zone.s, places));
    const w3 = await page.run(PUT(z0, 20) + 'g.setCamera && g.setCamera("drone"); for (let i = 0; i < 30; i++) g.update(1 / 60);' + WOUND(zone.s, places));
    await page.run('g.setCamera && g.setCamera("chase"); return 0;');
    const an = w1.angles;
    check(w1.twisted && an[0] === 0 && an[1] < 0.02 && Math.abs(an[3] - Math.PI / 2) < 0.25 && Math.abs(an[5] - Math.PI) < 0.02 && an[6] === Math.PI
      && an.every((v, i) => i === 0 || v >= an[i - 1] - 0.07),
      `from 150 m off the road ahead is seen wound: ${an.map(f2).join(', ')} rad at ${places.join(', ')} m from the stretch's middle`);
    const drift = Math.max(...an.map((v, i) => Math.max(Math.abs(v - w2.angles[i]), Math.abs(v - w3.angles[i]))));
    check(drift < 0.01, `each place is wound the same from nearer and from the air: it is the world's, not the lens's (${drift.toExponential(1)} rad apart)`);

    // The way through, a frame at a time: the car put 40 m before the
    // stretch, driven through it and 60 m on.
    const far = z1 + 400;
    const into = await page.run(PUT(z0, 40) + WATCH(run + 100, far));
    const wrap = (v) => Math.atan2(Math.sin(v), Math.cos(v));
    const rows = into.rows;
    const turning = rows.filter((r) => r[8]);
    const first = turning[0];
    const lastT = turning[turning.length - 1];
    const peak = rows.reduce((m, r) => (r[3] > m[3] ? r : m), rows[0]);
    const side = rows.find((r) => r[1] >= Math.PI / 2);
    const worstReal = Math.max(...rows.map((r) => Math.abs(wrap(r[2] - r[1]))));
    const end = rows[rows.length - 1];
    const past = Math.max(...rows.map((r) => r[1])) - Math.PI;
    check(first && Math.abs(first[0] - z0) < 0.06 * run && Math.abs(lastT[0] - z1) < 0.06 * run,
      `the car goes over along the corkscrew, from ${f2(first && first[0])} m to ${f2(lastT && lastT[0])} m (the stretch: ${f2(z0)} to ${f2(z1)})`);
    check(Math.abs(peak[0] - zone.s) < 0.13 * run && peak[3] > 0.1 && peak[3] < 2.5, `quickest in the middle (${f2(peak[3])} rad/s at ${f2(peak[0])} m)`);
    check(Math.abs(end[1] - Math.PI) < 0.01 && Math.abs(end[3]) < 1e-6 && past > 0 && past < 0.08,
      `it ends on a half turn, a hair past it first (${f2(end[1])} rad, ${f2(past)} past)`);
    check(rows.every((r, i) => i === 0 || Math.abs(r[1] - rows[i - 1][1]) < 0.06), `with no jump on the way`);
    check(worstReal < 0.12, `the camera itself is rolled by it (never ${f2(worstReal)} rad off the number)`);
    const slip = Math.max(...rows.map((r) => r[9]));
    check(slip < 0.25, `the road under the car is drawn under the car all the way through (at most ${f2(slip)} m off)`);
    const ways = rows.map((r) => Math.abs(wrap(r[10] + Math.PI / 2)));
    check(Math.max(...ways) < 0.3, `and what is 400 m on is the other way up on the screen from first to last, holding still (at most ${f2(Math.max(...ways))} rad from it)`);
    check(Math.abs(side[6]) < 0.2 && Math.abs(side[7]) < 0.2, `on its side the car is still near the middle of the screen (${f2(side[6])}, ${f2(side[7])})`);
    check(side[4] > side[5] * 1.08, `and the field of view is wider (${f2(side[4])} degrees against ${f2(side[5])})`);

    // By where the car is, not by the clock.
    const fast = await page.run(PUT(z0, 90, 40) + WATCH(run + 150, far, 40));
    const rollAt = (rs, at) => { const r = rs.find((x) => x[0] >= at); return r ? r[1] : NaN; };
    const apart = Math.max(...[-0.35, -0.17, 0, 0.17, 0.35].map((f) => Math.abs(rollAt(rows, zone.s + f * run) - rollAt(fast.rows, zone.s + f * run))));
    const secs = (rs) => rs.filter((r) => r[8]).length / 60;
    check(apart < 0.12 && secs(fast.rows) < secs(rows) * 0.75, `at 40 m/s it is as far over at each place as at 22 (${f2(apart)} rad apart), and sooner done (${f2(secs(fast.rows))} s against ${f2(secs(rows))})`);
    const stood = await page.run(STAND(zone.s));
    check(stood.rolls[0] > 0.9 && stood.rolls[0] < 2.3 && Math.abs(stood.rolls[1] - stood.rolls[0]) < 0.02,
      `a car that stops half way stays on its side (${f2(stood.rolls[0])} rad, and ${f2(stood.rolls[1])} a second later)`);

    const after = await page.run(AT(z1 + 120));
    check(Math.abs(after.roll - Math.PI) < 1e-6, `in it the view is turned half round (${f2(after.roll)} rad)`);
    check(after.bottom > after.top && after.topStraight > after.bottomStraight,
      `the sky is the brighter, and now at the bottom, where turned back it is at the top (${f2(after.bottom)} under ${f2(after.top)}; ${f2(after.topStraight)} over ${f2(after.bottomStraight)})`);
    const quick = await page.run(QUICK(z1 + 120));
    check(Math.abs(quick.roll - Math.PI) < 0.01 && !quick.turning, `a car put down inside is inside at once (${f2(quick.roll)} rad, ${quick.turning ? 'turning' : 'at rest'})`);

    const up = await page.run(STEER(z0 - 150));
    const down = await page.run(STEER(z1 + 120));
    check(up.dy * down.dy < 0 && Math.abs(down.dy) > 0.05, `the wheel is turned the other way once it is over (${f2(up.dy)} rad, then ${f2(down.dy)})`);

    // The land is folded over with the road, more slowly the further from it.
    const slow = await page.run(SLOW(mid, [0, 100, 300, 1000, 3000]));
    const want = (slow.wide || []).map((_, i) => 0.506 * Math.hypot(slow.len, Math.min(slow.over[0] * [0, 100, 300, 1000, 3000][i], slow.over[1])));
    check(!slow.error && slow.wide.every((v, i) => Math.abs(v / want[i] - 1) < 0.05) && slow.wide[4] > 3 * slow.wide[0],
      `the land goes over more slowly the further from the road: from a tenth of the way to nine tenths in ${(slow.wide || []).map((v) => v.toFixed(0)).join(', ')} m at 0, 100, 300, 1000, 3000 m off it (${want.map((v) => v.toFixed(0)).join(', ')} by the rule)${slow.error ? ' ' + slow.error : ''}`);

    // The way out: on round the same way, to a whole turn, and the wheel back.
    const laid = await page.run(FIND_OUT(z1 + 100));
    check(laid.sOut !== null, `the way out is laid (the road crosses at ${laid.sOut} m)`);
    const zout = (await page.run(PUT(laid.sOut, 400) + ZONE)) || {};
    const o0 = zout.s - zout.run / 2;
    const o1 = zout.s + zout.run / 2;
    check(Math.abs(zout.cross - laid.sOut) < 12 && zout.run >= 200, `and ${f2(zout.run)} m of the road is wound by there (from ${f2(o0)} m)`);
    const outOf = await page.run(PUT(o0, 40) + WATCH(zout.run + 100, o1 + 400));
    const o = outOf.rows;
    const oEnd = o[o.length - 1];
    check(Math.abs(o[0][1] - Math.PI) < 0.05 && Math.abs(oEnd[1] - 2 * Math.PI) < 0.01 && o.every((r, i) => i === 0 || r[1] >= o[i - 1][1] - 0.01),
      `going out it winds on the same way round, to a whole turn (${f2(o[0][1])} to ${f2(oEnd[1])} rad)`);
    check(Math.abs(wrap(oEnd[2])) < 0.08, `and the camera is upright again (${f2(wrap(oEnd[2]))} rad)`);
    const oSlip = Math.max(...o.map((r) => r[9]));
    check(oSlip < 0.25, `with the road under the car all the way (at most ${f2(oSlip)} m off)`);
    const again = await page.run(STEER(o1 + 200));
    check(up.dy * again.dy > 0 && Math.abs(again.dy) > 0.05, `with the wheel back as it was (${f2(again.dy)} rad)`);

    // A flash in it lights the sky, and there are things by the road.
    const inside = Math.min(z1 + 300, o0 - 200);
    const flash = await page.run(AT(z1 + 120, `g.upside._next = 99; g.upside._age = 0.1;
      const d = new g.camera.position.constructor(); g.camera.getWorldDirection(d);
      g.upside.bolt.set(Math.atan2(d.z, d.x), 0.95, 31, 0); g.update(1 / 60);`));
    check(flash.flash > 0.3 && flash.hotBottom > 20, `a flash of lightning lights the sky (flash ${f2(flash.flash)}, ${flash.hotBottom} bright pixels)`);
    const tent = await page.run(AT(inside, 'for (let i = 0; i < 240; i++) g.update(1 / 60);'));
    check(tent.tentacles > 5, `things stand by the road (${tent.tentacles})`);
    // It spreads: roots creep in over the ground toward the road and a
    // tentacle stands up where one has got to; the longer the car is in it,
    // the more of both; and bats fly in it, and nowhere else.
    const early = await page.run(AT(inside, 'g.upside.infect = 0; for (let i = 0; i < 300; i++) { g.upside.infect = Math.min(g.upside.infect, 0.05); g.update(1 / 60); }'));
    const late = await page.run(AT(inside, 'for (let i = 0; i < 600; i++) { g.upside.infect = Math.max(g.upside.infect, 0.9); g.update(1 / 60); }'));
    check(late.roots >= 6 && late.segments > 100, `roots creep over the ground toward the road (${late.roots} roots, ${late.segments} segments of them)`);
    check(late.roots > early.roots && late.tentacles > early.tentacles,
      `and the more it has spread, the more of them (${early.roots} roots, ${early.tentacles} tentacles; then ${late.roots}, ${late.tentacles})`);
    check(late.bats >= 30, `bats fly in it (${late.bats})`);
    const hills = await openPage('seed=7&world=hills&run=120&cam=chase&style=real');
    const none = await hills.run(`const T = await import('three'); return { bats: g.critters.bats.shown, roots: g.upside.creep.roots.length, twisted: g.upside.twisted,
      plain: g.atmosphere.sky.material === g.atmosphere.skyPlain, solid: g.terrain.material.blending === T.NormalBlending, under: g.terrain.wound,
      flat: g.water.mesh.geometry === g.water.flat };`);
    hills.close();
    check(none.bats === 0 && none.roots === 0, `and in no other world (${none.bats} bats, ${none.roots} roots in the hills)`);
    check(!none.twisted && none.plain && none.solid && !none.under && none.flat,
      `with no winding in reach (the hills) the sky, the land and the sea are as they are anywhere (the dome's own shader ${none.plain}, the land solid ${none.solid} and its underside not drawn ${!none.under}, the sea's own disc ${none.flat})`);
  } finally {
    page.close();
  }
  // The fold, the sky through the stretch, and the frustum: the worlds their
  // full length, on the way in from space and on the way out of the Upside
  // Down.
  for (const [world, into] of [['space', true], ['upside', false]]) {
    const p3 = await openPage(`seed=7&world=${world}&run=60&cam=chase&style=real`, '640,360');
    try {
      const { mid: m3 } = await p3.run(CROSSING(into));
      const way = into ? 'in' : 'out';
      check(m3 !== null, `the way ${way} is laid (the road crosses at ${f2(m3)} m)`);
      // The fold holds still. (The road is kept 2600 m behind the car: what
      // needs the car far back comes first, and the long way through last.)
      const held = await p3.run(HELD(m3, 600, 2800, 300));
      check(!held.error && held.twisted && held.n > 5000 && held.angle > 0.6 && held.angle < Math.PI - 0.6 && held.step < 1 && held.drift < 130,
        `going ${way}, a place in the fold (600 m off the stretch's line, ${held.along} m past its middle, ${f2(held.angle)} rad of the half turn over) is drawn where it was a step before all the way from 2800 m to 300 m before the stretch: ${f2(held.step)} m at most in a step, ${f2(held.drift)} m from first to last (${held.n} steps)${held.error ? ' ' + held.error : ''}`);
      const farCol = await p3.run(FAR(m3, 2800, 300));
      // (A land turned over at once, as it was before the fold, is 30/100.
      // Where the fold fills the frame the furthest of it is the fold's own
      // flank going by a hundred metres off, its rock and snow with it:
      // that is 3/100.)
      check(!farCol.error && farCol.n > 500 && farCol.most < 0.05,
        `and the furthest twentieth of the frame never changes colour at once: ${f2(farCol.most * 100)}/100 at most between two looks 3.7 m apart (${f2(farCol.at)} m before the stretch; ${farCol.n} looks)${farCol.error ? ' ' + farCol.error : ''}`);
      if (into) {
        const pix = await p3.run(SKYPIX(m3));
        check(!pix.error && pix.twisted && pix.half < 0.004 && pix.some > 5 * pix.half + 0.004,
          `the two skies are one picture: the dome a half turn on, the frame is the same (${(pix.half * 1000).toFixed(2)}/1000 apart; turned 0.3 rad instead, ${(pix.some * 1000).toFixed(2)}/1000)${pix.error ? ' ' + pix.error : ''}`);
        check(pix.above < 0.0005 && pix.under > 0.01,
          `and the other sky is under the horizon, where the ground was (the frames ${(pix.under * 1000).toFixed(2)}/1000 apart there, ${(pix.above * 1000).toFixed(2)}/1000 above it)`);
        const seen = await p3.run(CARSEEN(m3));
        check(!seen.error && seen.fine && seen.out.every((n) => n >= 12),
          `over the sea (${f2(seen.under)} m under the road, wound with the land on its finer disc) the car is seen through the stretch: ${(seen.out || []).join(', ')} of 81 pixels about it its red, at 0.1, 0.25, 0.4, 0.55 and 0.7 of the way through (further in it is in the Upside Down's dark)${seen.error ? ' ' + seen.error : ''}`);
        const cull = await p3.run(CULL(m3, 700));
        check(!cull.error && cull.twisted && cull.across >= 15 && cull.seen > 0 && cull.missed === 0,
          `${f2(cull.at)} m before it, the lens ${f2(cull.across)} degrees across its line: of ${cull.seen} meshes drawn turned in view, ${cull.missed} left out${cull.error ? ' ' + cull.error : ''}`);
        check(cull.kept > 0 && cull.off < cull.meshes,
          `and of the ${cull.turned} drawn turned, ${cull.kept} out of view are still tested: the test is off for ${cull.off} of ${cull.meshes} meshes, not for all`);
        const state = await p3.run(`const T = await import('three'); return { blended: g.terrain.material.blending === T.CustomBlending, under: [...g.terrain.tiles.values()].some((t) => t.visible && t.children.length && t.children[0].visible) };`);
        check(state.blended && state.under, `while it is wound the land is drawn thinner where the fold lifts it far off, and its underside into the depth (${state.blended}, ${state.under})`);
      }
      const sky = await p3.run(SKYRUN(m3, 2000, 2700));
      const rows = sky.rows || [];
      const lo = into ? 0 : Math.PI;
      // How the dome stands on the screen: its own turn and the lens's roll.
      const stand = rows.map((q) => q[1] + q[3] - lo);
      const still = Math.max(...stand.map((a) => Math.abs(Math.sin(a))));
      check(!sky.error && rows.length > 3000 && still < 1e-3,
        `going ${way}, from 2000 m before the stretch to ${f2(-(rows[rows.length - 1] || [0])[0])} m past its start, the sky does not turn: on the screen the dome stands as it stood or a half turn from that (never ${(still * 1000).toFixed(2)}/1000 rad off; ${rows.length} steps)${sky.error ? ' ' + sky.error : ''}`);
      // It goes from the one to the other once, with the car on its side
      // and the other sky whole under the horizon: the same picture.
      const jumps = [];
      for (let i = 1; i < rows.length; i++) if (Math.cos(stand[i]) * Math.cos(stand[i - 1]) < 0) jumps.push(i);
      const j = jumps[0];
      check(jumps.length === 1 && rows[j][2] > 0.999 && rows[j - 1][2] > 0.999 && Math.abs(Math.sin(rows[j][3] - lo)) > 0.95,
        `it is put the other way once, ${f2(-(rows[j] || [0])[0])} m into the stretch (${f2(sky.run)} m of the road), the car on its side (${f2(rows[j] ? rows[j][3] - lo : 0)} rad) and the other sky whole under the horizon (${f2(rows[j] ? rows[j][2] : 0)})`);
      const over = rows.filter((q) => Math.abs(Math.sin(q[3] - lo)) > 0.02);
      check(over.length > 100 && over.every((q) => q[2] > 0.999),
        `and whole all the while the car is over at all (${over.length} steps, least ${f2(Math.min(...over.map((q) => q[2])))})`);
      // The winding is in reach all the way, and the dome has the shader
      // that lays the other sky; far from the stretch that is only toward
      // the fold, not all round.
      const first = rows[0] || [];
      const last = rows[rows.length - 1] || [];
      check(rows.every((q) => q[4] === 1 && q[5] === 1) && first[2] < 0.25 && last[2] < 0.25 && first[6] > 0.2 && last[6] > 0.2,
        `the winding is in reach all the way and the dome draws the other sky: far from the stretch only toward the fold (all round ${f2(first[2])} of it 2000 m before and ${f2(last[2])} past, the fold's way ${f2(first[6])} and ${f2(last[6])} toward the stretch)`);
      const part = rows.filter((q) => q[2] > 0 && q[2] < 1);
      check(part.length > 200, `the other sky comes in all round and goes out over ${part.length} steps, not at once`);
      check(p3.logs.length === 0, `with no error (${p3.logs[0] || 'none'})`);
    } finally {
      p3.close();
    }
  }

  // A road that winds across the border: the stretch is on a straight
  // length of it nearby, and the car goes over once.
  {
    const p4 = await openPage('seed=11&world=space&run=60&cam=chase&style=real', '320,180');
    try {
      const { mid: m4 } = await p4.run(CROSSING(true));
      const once = await p4.run(ONCE(m4, 1500, 1500));
      const zn = once.zone || {};
      const rolls = once.rolls || [];
      // Never back, but for the hair it goes past the half turn and comes
      // back from.
      let top = 0;
      let back = 0;
      for (const r of rolls) {
        top = Math.max(top, r[1]);
        back = Math.max(back, top - r[1]);
      }
      const z0 = zn.s - zn.run / 2;
      const z1 = zn.s + zn.run / 2;
      check(!once.error && once.same && zn.run >= 200 && zn.len >= zn.run / 1.08 && Math.abs(zn.s - zn.cross) <= 500,
        `where the road winds across the border (seed 11, at ${f2(m4)} m) the wound stretch is a straight length of it nearby: ${f2(zn.run)} m of the road, ${f2(zn.len)} m from end to end, its middle ${f2(zn.s - zn.cross)} m on from the crossing${once.error ? ' ' + once.error : ''}`);
      check(rolls.length > 5000 && back < 0.08 && rolls.every((r) => (r[0] <= z0 ? r[1] === 0 : r[0] >= z1 + 1 ? Math.abs(r[1] - Math.PI) < 1e-9 : true)),
        `and the car goes over once, from 1500 m before the crossing to 1500 m past it: upright up to the stretch, over past it, never back (${f2(back)} rad at most, the hair past the half turn; ${rolls.length} steps)`);
      check(p4.logs.length === 0, `with no error (${p4.logs[0] || 'none'})`);
    } finally {
      p4.close();
    }
  }

  // The baked clouds go with the dome that lays the other sky: they are read
  // by direction, so a half turn of the dome gives the same picture.
  {
    const p5 = await openPage('seed=7&world=hills&s=900&run=90&cam=chase&style=paint', '640,360');
    try {
      for (const [name, mat] of [['with the old clouds kept', 'skyFoldHeaps'], ['the baked clouds alone', 'skyFoldPure']]) {
      const c = await p5.run(SKYCLOUD.replace('skyFoldHeaps', mat));
      check(!c.error && c.baked && c.cloud > 0.02 && c.half < 0.004 && c.some > 5 * c.half + 0.004,
        `the baked clouds are in the fold's sky (${name}) and the two skies are one picture with them: the dome a half turn on, the frame is the same (${((c.half || 0) * 1000).toFixed(2)}/1000 apart; turned 0.3 rad instead, ${((c.some || 0) * 1000).toFixed(2)}/1000; ${((c.cloud || 0) * 100).toFixed(0)} % of the frame cloud)${c.error ? ' ' + c.error : ''}`);
      }
      check(p5.logs.length === 0, `with no error (${p5.logs[0] || 'none'})`);
    } finally {
      p5.close();
    }
  }

  // Every style draws it.
  for (const style of ['paint', 'ink', 'cel', 'print', 'pixel', 'block']) {
    const p2 = await openPage(`seed=7&world=upside&run=90&cam=chase&style=${style}`);
    try {
      const r = await p2.run('g.render(); return { roll: g.upside.roll, style: g.style.id };');
      check(!r.error && Math.abs(r.roll - Math.PI) < 0.08 && p2.logs.length === 0, `${style} draws it, turned over, without an error${p2.logs.length ? ' (' + p2.logs[0] + ')' : ''}`);
    } finally {
      p2.close();
    }
  }
} finally {
  server.kill();
}

if (failures.length) {
  console.error(`\nFAILED: ${failures.length} check(s)`);
  process.exit(1);
}
console.log('\nOK: the road into the Upside Down is a corkscrew and the land is folded over with it; the car goes over along it; in it, the world is the other way up');
