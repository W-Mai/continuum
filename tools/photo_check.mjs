// The photo mode (render/photo.js, ui/photo.js): the world stands still, the
// lens is let go of, and a picture is taken of the frame at twice the size.
//
// In node, without a browser, the lens and the picture's size and name:
//  - the keys take it where they should, as fast as they should (12 m/s, four
//    times that with Shift, not faster along a diagonal), it comes to its speed
//    and stops in a fraction of a second after the key is let go, and the
//    same keys held the same time take it as far at 30, 60 and 144 frames a
//    second; a frame that took five seconds moves it as far as one of a tenth;
//  - Z and X roll it 30 degrees either way of the roll it began with and no
//    further, the wheel changes the field of view between 20 and 100 degrees,
//    it looks up and down by at most 88, and a drag turns it so that the
//    picture goes where the pointer goes;
//  - held to a made-up ground and a car, it is never under the ground by 0.3 m
//    and never further than 400 m from the car, whatever it is pushed with;
//  - a picture is twice the canvas's pixels in a frame of at most 3840 x 2160
//    (and of what the card can make), of the canvas's shape; its name is
//    continuum-<world>-<style>-<chainage>.png.
//
// In the real page, headless, in Chrome (seed 7), driven by the page's own
// entry (Game.photo) where a frame is to be read, and over the DevTools
// protocol with real keys and a real mouse where the keys and the mouse are:
//  - after going in, two frames a second of the wall's clock apart are the same
//    pixels, in the real style and the painted one, in the hills and in the
//    river's valley (clouds, grass and water); the game's own clock, frame and
//    car do not move meanwhile; and a second of the world going on does change
//    the frame (the equality is not for want of anything to move);
//  - the lens is pushed into the land, the road and the water (each in its
//    own place) and does not go under their surface by 0.3 m, and is pushed
//    out from the car and stays within 400 m of it;
//  - in a bore the lens is held by the road under it and the vault over it (not by
//    the hill over the vault) and the frame's light is the bore's where the lens
//    is, at once and not kept; under the cavern's roof it stops under the roof; in
//    the deep sea the surface of the water is not the floor;
//  - the picture: its size is twice the canvas's, it is a PNG of that size,
//    not black, and brought down to the canvas's size it is within 30 dB (PSNR)
//    of the frame on the screen; nothing is drawn to the canvas to make it and
//    no size is written to it; its name is the one the words give;
//  - going in, moving, taking a picture and going out leaves the world as a
//    run that never went in: after 60 steps every field of Game.snapshot but
//    the lens is the same, but the counts of what has been drawn and built on
//    the way (geometries, draw calls, triangles; after a long way off the
//    trees and the small things on the ground too), which go by where the
//    lens has been, and are told, not held; the lens is back where it began
//    0.6 s after going out, to 5 cm and half a degree; the car is where the
//    world stopped and goes on from there;
//  - with real keys: K goes in and out, P C R N H do nothing in it (and
//    each does what it did outside it), W A S D do not drive, Q E Z X and the
//    mouse and the wheel move the lens and nothing else, Enter takes a
//    picture and saves it under its name, Esc goes out, the wallpaper and the
//    photo mode are one or the other; the canvas keeps its size, and no frame
//    of another size is shown, while the picture is taken; a K before the page
//    is ready does nothing;
//  - with a real mouse on the buttons: the camera button of the page's bar
//    goes in, the switch of the photo bar puts the car away (the frame loses
//    the car and what it casts and nothing else) and brings it back (the frame
//    is the one it was), the exit button goes out and the car is drawn again,
//    the style button changes the style with the world standing and the frame
//    still when it is done, the shutter button takes the picture.
//
// Usage: node tools/photo_check.mjs
// PORT=8204 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser. Pictures go to out/photo (OUT=dir).
// PICTURE=640x360 makes the canvas of the two frames whose pictures are kept smaller.
// ONLY=keys,river runs the scenarios whose names have these in them (hills, river, left, under, keys).

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8204;
const ROOT = new URL('..', import.meta.url).pathname;
const OUT = (process.env.OUT || ROOT + 'out/photo').replace(/\/?$/, '/');
// The canvas of the two frames whose pictures are kept to be looked at (the hills,
// real and painted); the others are taken on a canvas of 640 x 360.
const PICTURE = (process.env.PICTURE || '960x540').split('x').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEG = Math.PI / 180;

let failed = 0;
const say = (ok, text) => {
  if (!ok) failed++;
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
};
const results = {};
const f = (x, n = 2) => (Number.isFinite(x) ? x.toFixed(n) : String(x));

// --- in node ------------------------------------------------------------------

async function inNode() {
  const three = new URL('./vendor/three.module.js', import.meta.url).href;
  register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, n) { return s === 'three' ? { url: ${JSON.stringify(three)}, shortCircuit: true } : n(s, c); }`,
  ));
  const THREE = await import('./vendor/three.module.js');
  const P = await import('../src/render/photo.js');
  const { Lens, exportSize, fileName, SPEED, FAST, ROLL, FOV, REACH, CLEAR } = P;

  // The size of a picture.
  const sizes = [[640, 360, [1280, 720]], [1920, 1080, [3840, 2160]], [2560, 1440, [3840, 2160]], [3000, 1000, [3840, 1280]],
    [1000, 3000, [720, 2160]], [1281, 721, [2562, 1442]], [3840, 2160, [3840, 2160]], [1, 1, [2, 2]]];
  const wrong = sizes.filter(([w, h, want]) => exportSize(w, h).join() !== want.join());
  say(!wrong.length, `a picture is twice the canvas's pixels, in at most 3840 x 2160, of its shape (${sizes.map(([w, h, s]) => `${w}x${h}→${s.join('x')}`).join(' ')})${wrong.length ? ' (wrong: ' + wrong.map(([w, h]) => `${w}x${h}→${exportSize(w, h)}`) + ')' : ''}`);
  const small = exportSize(1920, 1080, 2048);
  say(small.join() === '2048,1152', `...and no larger than the card can make (a limit of 2048: ${small.join(' x ')})`);
  const shape = [[2557, 1439], [1366, 768], [390, 844]].map(([w, h]) => { const [a, b] = exportSize(w, h); return Math.abs(a / b - w / h) < 2e-3; });
  say(shape.every(Boolean), 'the picture has the canvas\'s shape to a part in five hundred, where the cap cuts it');

  // Its name.
  const names = [fileName('山间', '写实', 6827.4), fileName('Alpine', 'Real', 12.5), fileName('A/B', 'x y', 3.2), fileName('Hills', 'Paint', 0.4)];
  say(names.join() === 'continuum-山间-写实-6827.png,continuum-Alpine-Real-13.png,continuum-AB-xy-3.png,continuum-Hills-Paint-0.png',
    `a picture is called continuum-<world>-<style>-<chainage to the metre>.png, with what a file name cannot hold left out (${names.join(', ')})`);

  // The lens.
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.3, 14000);
  camera.position.set(0, 5, 0);
  camera.rotateZ(0.04);
  camera.updateMatrixWorld();
  const begin = (lens = new Lens()) => {
    lens.from(camera.position, camera.quaternion, camera.fov);
    return lens;
  };
  const run = (lens, seconds, fps = 60) => {
    for (let i = 0; i < Math.round(seconds * fps); i++) lens.step(1 / fps);
  };

  const w = begin();
  w.press('KeyW');
  run(w, 3);
  const d = begin();
  d.press('KeyD');
  run(d, 3);
  const up = begin();
  up.press('KeyE');
  run(up, 3);
  say(w.p.z < -30 && Math.abs(w.p.x) < 1e-9 && Math.abs(w.v.length() - SPEED) < 0.01 * SPEED && d.p.x > 30 && Math.abs(d.p.z) < 1e-9 && up.p.y > 5 + 30 && Math.abs(up.p.x) + Math.abs(up.p.z) < 1e-9,
    `W takes the lens ahead (-z with no turn) at ${f(w.v.length(), 2)} m/s, D to the right, E up; none of them sideways of itself`);
  const turned = begin();
  turned.drag(0, 0, 0);
  turned.yaw = Math.PI / 2;
  turned.press('KeyW');
  run(turned, 3);
  say(turned.p.x < -30 && Math.abs(turned.p.z) < 1e-6, 'ahead goes where the lens looks (turned a quarter to the left, W goes to -x)');
  const diag = begin();
  diag.press('KeyW');
  diag.press('KeyD');
  run(diag, 3);
  const fast = begin();
  fast.press('KeyW');
  fast.press('ShiftLeft');
  run(fast, 3);
  say(Math.abs(Math.hypot(diag.v.x, diag.v.z) - SPEED) < 0.01 * SPEED && Math.abs(fast.v.length() - SPEED * FAST) < 0.01 * SPEED * FAST,
    `a diagonal is no faster (${f(Math.hypot(diag.v.x, diag.v.z), 2)} m/s), and Shift is ${FAST} times as fast (${f(fast.v.length(), 1)} m/s)`);

  // Let go of: it stops.
  const stop = begin();
  stop.press('KeyW');
  run(stop, 2);
  stop.release('KeyW');
  const at = stop.p.z;
  run(stop, 1);
  const glide = at - stop.p.z;
  const rest = stop.v.length();
  const at2 = stop.p.z;
  run(stop, 1);
  say(rest < 0.01 && Math.abs(stop.p.z - at2) < 1e-3 && glide < SPEED * 0.2,
    `let go of, it glides ${f(glide, 2)} m (at most ${f(SPEED * 0.2, 1)}), is at ${f(rest * 1000, 1)} mm/s a second on and does not move in the second after (${f(Math.abs(stop.p.z - at2) * 1000, 3)} mm)`);

  // By the wall's clock, whatever the frames.
  const far = [30, 60, 144].map((fps) => {
    const l = begin();
    l.press('KeyD');
    l.press('KeyW');
    run(l, 2, fps);
    l.release('KeyD');
    run(l, 1, fps);
    return l.p.clone();
  });
  const spread = Math.max(far[0].distanceTo(far[1]), far[1].distanceTo(far[2]));
  const slow = begin();
  slow.press('KeyD');
  slow.step(5);
  const tenth = begin();
  tenth.press('KeyD');
  tenth.step(0.1);
  say(spread < 1e-6 && Math.abs(slow.p.x - tenth.p.x) < 1e-12,
    `the same keys held the same time take the lens to the same place at 30, 60 and 144 frames a second (${f(spread * 1e6, 3)} µm apart); a frame of five seconds moves it as far as one of a tenth`);

  // Roll, field of view, pitch, drag.
  const r = begin();
  const roll0 = r.roll;
  r.press('KeyZ');
  run(r, 10);
  const plus = r.roll - roll0;
  r.release('KeyZ');
  r.press('KeyX');
  run(r, 20);
  const minus = r.roll - roll0;
  r.release('KeyX');
  say(Math.abs(plus - ROLL) < 1e-3 && Math.abs(minus + ROLL) < 1e-3 && Math.abs(ROLL - 30 * DEG) < 1e-12,
    `Z and X roll it ${f(plus / DEG, 2)} and ${f(minus / DEG, 2)} degrees of the roll it began with (${f(roll0 / DEG, 2)}) and no further`);
  const z = begin();
  z.zoom(-50);
  run(z, 6);
  const out = z.fov;
  z.zoom(50);
  run(z, 8);
  say(Math.abs(out - FOV[0]) < 1e-9 && Math.abs(z.fov - FOV[1]) < 1e-9 && FOV.join() === '20,100', `the wheel keeps the field of view between ${FOV[0]} and ${FOV[1]} degrees (${f(out, 3)} and ${f(z.fov, 3)} after as much as it can be turned)`);
  const dr = begin();
  dr.drag(0, 1e6, 0.01);
  const high = dr.pitch;
  dr.drag(0, -2e6, 0.01);
  const low = dr.pitch;
  const turnedBy = begin();
  turnedBy.drag(100, 50, 0.001);
  const cam2 = new THREE.PerspectiveCamera();
  turnedBy.write(cam2);
  const look = cam2.getWorldDirection(new THREE.Vector3());
  say(Math.abs(high - 88 * DEG) < 1e-9 && Math.abs(low + 88 * DEG) < 1e-9 && look.x < 0 && look.y > 0 && turnedBy.yaw > 0 && turnedBy.pitch > 0,
    `it looks up and down by 88 degrees at most; a drag right and down turns it left and up, so that the picture goes where the pointer goes`);

  // Held to a ground and a car.
  const car = { x: 0, y: 2, z: 0 };
  const ground = (x, z) => 3 + 0.02 * x + 2 * Math.sin(z / 40);
  const held = (lens) => {
    lens.limit = (p, v) => {
      for (let i = 0; i < 6; i++) {
        let moved = false;
        const dx = p.x - car.x;
        const dy = p.y - car.y;
        const dz = p.z - car.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > REACH - 0.05) {
          const k = (REACH - 0.05) / dist;
          p.set(car.x + dx * k, car.y + dy * k, car.z + dz * k);
          moved = true;
        }
        const floor = ground(p.x, p.z) + CLEAR;
        if (p.y < floor) {
          p.y = floor;
          if (v && v.y < 0) v.y = 0;
          moved = true;
        }
        if (!moved) break;
      }
    };
    return lens;
  };
  let low2 = Infinity;
  let far2 = 0;
  let seed = 12345;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const walk = held(begin());
  const pool = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft'];
  for (let i = 0; i < 60 * 240; i++) {
    if (i % 90 === 0) {
      walk.clear();
      for (const k of pool) if (rand() < 0.4) walk.press(k);
      walk.yaw += (rand() - 0.5) * 3;
    }
    walk.step(1 / 60);
    low2 = Math.min(low2, walk.p.y - ground(walk.p.x, walk.p.z));
    far2 = Math.max(far2, Math.hypot(walk.p.x - car.x, walk.p.y - car.y, walk.p.z - car.z));
  }
  const placed = held(begin());
  placed.place(1e5, -1e4, 3e4);
  say(low2 >= CLEAR - 1e-9 && far2 <= REACH && Math.hypot(placed.p.x - car.x, placed.p.y - car.y, placed.p.z - car.z) <= REACH
    && placed.p.y - ground(placed.p.x, placed.p.z) >= CLEAR - 1e-9,
  `walked at random for 4 minutes over a made-up ground the lens was never lower than ${f(low2, 3)} m above it (at least ${CLEAR}) nor further than ${f(far2, 3)} m from the car (at most ${REACH}); put a hundred kilometres off and under it, it is put back within both`);
  results.node = { names, sizes, glide, spread, low: low2, far: far2 };
}

// --- the page -----------------------------------------------------------------

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

// Run in each new document before the page's own: what the checks read the
// page with, and the saving of a file turned into a note of its name.
const PRELUDE = `
window.__saved = [];
{
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) { window.__saved.push({ name: this.download, href: this.href }); return; }
    return click.call(this);
  };
}
window.__t = {
  // The canvas as it is: its bytes.
  screen() {
    const c = document.createElement('canvas');
    c.width = game.canvas.width;
    c.height = game.canvas.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(game.canvas, 0, 0);
    return x.getImageData(0, 0, c.width, c.height).data;
  },
  // How many pixels differ, and by how much at most.
  diff(a, b) {
    let n = 0;
    let max = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      if (d) {
        n++;
        if (d > max) max = d;
      }
    }
    return { differing: n, of: a.length / 4, max };
  },
  // The snapshot of the game, the lens left out.
  snap() {
    const s = game.snapshot();
    delete s.lens;
    return s;
  },
  car() {
    const c = game.car;
    return [c.x, c.y || 0, c.z, c.vx, game.sCar, game.simTime, game.frame];
  },
  // Counts what is drawn to the canvas itself (the default framebuffer) and the
  // sizes written to it, until stop().
  watch() {
    const gl = game.renderer.getContext();
    const names = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements', 'clear'];
    const seen = { onCanvas: 0, draws: 0, writes: [], setSize: 0, setPixelRatio: 0 };
    for (const n of names) {
      const was = gl[n];
      gl[n] = function (...args) {
        seen.draws++;
        if (gl.getParameter(gl.FRAMEBUFFER_BINDING) === null) seen.onCanvas++;
        return was.apply(this, args);
      };
    }
    const cv = game.canvas;
    for (const k of ['width', 'height']) {
      const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, k);
      Object.defineProperty(cv, k, { configurable: true, get() { return d.get.call(this); }, set(v) { seen.writes.push([k, v]); d.set.call(this, v); } });
    }
    const r = game.renderer;
    const wrap = (k) => {
      const was = r[k];
      r[k] = function (...args) { seen[k]++; return was.apply(this, args); };
    };
    wrap('setSize');
    wrap('setPixelRatio');
    return {
      stop() {
        for (const n of names) delete gl[n];
        for (const k of ['width', 'height']) delete cv[k];
        delete r.setSize;
        delete r.setPixelRatio;
        return seen;
      },
    };
  },
};`;

const KEYS = {
  KeyK: { key: 'k', windowsVirtualKeyCode: 75 }, KeyP: { key: 'p', windowsVirtualKeyCode: 80 }, KeyC: { key: 'c', windowsVirtualKeyCode: 67 },
  KeyR: { key: 'r', windowsVirtualKeyCode: 82 }, KeyN: { key: 'n', windowsVirtualKeyCode: 78 }, KeyH: { key: 'h', windowsVirtualKeyCode: 72 },
  KeyW: { key: 'w', windowsVirtualKeyCode: 87 }, KeyA: { key: 'a', windowsVirtualKeyCode: 65 }, KeyS: { key: 's', windowsVirtualKeyCode: 83 },
  KeyD: { key: 'd', windowsVirtualKeyCode: 68 }, KeyQ: { key: 'q', windowsVirtualKeyCode: 81 }, KeyE: { key: 'e', windowsVirtualKeyCode: 69 },
  KeyZ: { key: 'z', windowsVirtualKeyCode: 90 }, KeyX: { key: 'x', windowsVirtualKeyCode: 88 }, Enter: { key: 'Enter', windowsVirtualKeyCode: 13 },
  Escape: { key: 'Escape', windowsVirtualKeyCode: 27 },
};
const open = new Set();
const profiles = [];
let opened = 0;

// A page in Chrome, driven over the DevTools protocol.
async function openPage({ size = [640, 360], languages = ['zh-CN'] } = {}) {
  const profile = `${tmpdir()}/continuum-photo-${process.pid}-${++opened}`;
  profiles.push(profile);
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--window-size=${size[0]},${size[1]}`, '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], env: CHROME_ENV });
  const devtools = await new Promise((resolve, reject) => {
    let text = '';
    chrome.stderr.on('data', (d) => {
      text += d;
      const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(text);
      if (m) resolve(new URL(m[1]));
    });
    chrome.on('exit', () => reject(new Error('chrome exited: ' + text.slice(-400))));
  });
  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    const list = await (await fetch(`http://${devtools.host}/json/list`)).json();
    target = list.find((x) => x.type === 'page');
    if (!target) await sleep(100);
  }
  // A page in a tab that is not in front is hidden and draws no frames.
  const tidy = async () => {
    const list = await (await fetch(`http://${devtools.host}/json/list`)).json();
    for (const x of list) {
      if (x.type === 'page' && x.id !== target.id) await fetch(`http://${devtools.host}/json/close/${x.id}`);
    }
    await fetch(`http://${devtools.host}/json/activate/${target.id}`);
  };
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const [resolve, reject] = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}`)); else resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const text = msg.params.args.map((a) => a.value ?? a.description).join(' ');
      if (!/Failed to load resource/.test(text)) errors.push(text);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => { pending.delete(n); reject(new Error(`${method}: no answer in 600 s`)); }, 600000);
    pending.set(n, [(v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); }]);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  // The page is this size, exactly (a window of this size has less room in it than that).
  await send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify(languages)} });
      Object.defineProperty(navigator, 'language', { get: () => ${JSON.stringify(languages[0])} });
      ${PRELUDE}`,
  });

  // In the page: a value (JSON), or an error thrown.
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const page = {
    ev,
    errors,
    // The page in front, and no other tab of the browser: a page that is not
    // is hidden and draws no frames.
    front: tidy,
    // A function of the page's own, with an argument: its answer.
    run: (fn, arg) => ev(`(${fn})(${JSON.stringify(arg === undefined ? null : arg)})`),
    async goto(query, ready = 'window.game && game.carLoaded && game.frame > 2 && window.ui') {
      const before = await ev('performance.timeOrigin').catch(() => 0);
      await tidy();
      await send('Page.navigate', { url: `http://localhost:${PORT}/index.html?${query}` });
      const t0 = Date.now();
      for (let n = 0; ; n++) {
        await sleep(500);
        const up = await ev('(performance.timeOrigin !== ' + before + ' && ' + ready + ') ? "up" : (document.title.startsWith("GAME_FAIL") ? document.title : (document.hidden ? "hidden" : "no"))').catch(() => 'no');
        if (up === 'up') break;
        if (String(up).startsWith('GAME_FAIL')) throw new Error(up);
        if (up === 'hidden' || n % 20 === 19) await tidy().catch(() => 0);
        if (Date.now() - t0 > 300000) throw new Error('the page never came up');
      }
    },
    // The page of a headless run: it is up when it says it is done.
    goRun(query) {
      return page.goto(query, 'window.game && document.title === "GAME_DONE"');
    },
    async keyDown(code, modifiers = 0) {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...KEYS[code], nativeVirtualKeyCode: KEYS[code].windowsVirtualKeyCode, code, modifiers });
    },
    async keyUp(code, modifiers = 0) {
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEYS[code], nativeVirtualKeyCode: KEYS[code].windowsVirtualKeyCode, code, modifiers });
    },
    async key(code, modifiers = 0) {
      await page.keyDown(code, modifiers);
      await page.keyUp(code, modifiers);
    },
    async mouse(type, x, y, extra = {}) {
      await send('Input.dispatchMouseEvent', { type, x, y, ...extra });
    },
    // Where the canvas's middle is, in the page's own pixels.
    async middle() {
      return ev(`(() => { const r = game.canvas.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    },
    async shot(name) {
      mkdirSync(OUT, { recursive: true });
      const r = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(OUT + name, Buffer.from(r.data, 'base64'));
    },
    close() {
      open.delete(page);
      try { ws.close(); } catch { /* gone */ }
      chrome.kill();
    },
  };
  open.add(page);
  return page;
}

// --- functions that run in the page -------------------------------------------

// Going in: where the world stands, the frame on the screen, and what the
// page does about it.
function goIn() {
  const g = game;
  const t = window.__t;
  const before = { car: t.car(), cam: g.camera.position.toArray(), fov: g.camera.fov };
  const entered = g.photo.enter();
  g.photo.frame(1 / 60);
  window.__a = t.screen();
  const hidden = ['#hud', '#bar', '#brand', '#worldname', '#firsthint'].map((s) => document.querySelector(s)).filter(Boolean)
    .filter((e) => getComputedStyle(e).visibility !== 'hidden').map((e) => e.id);
  const bar = document.getElementById('photobar').getBoundingClientRect();
  return {
    entered, state: g.photo.state, before, size: [g.canvas.width, g.canvas.height], shownStill: hidden,
    barShown: getComputedStyle(document.getElementById('photobar')).display !== 'none' && bar.width > 0,
    bodyClass: document.body.classList.contains('photo'),
  };
}

// A second of the wall's clock on: the same frame, and the game's own clock where it was.
function aSecondOn() {
  const g = game;
  const t = window.__t;
  const p = g.photo;
  const was = t.car();
  p.frame(1.0);
  const b = t.screen();
  const same = t.diff(window.__a, b);
  p.frame(0.05);
  const c = t.screen();
  return { same, again: t.diff(b, c), stood: t.car().join() === was.join(), car: t.car(), was, frames: p.frames };
}

// The world's own second: out, and the world going for 60 steps. The frame
// is not the one it stood at.
function theWorldGoesOn() {
  const g = game;
  const t = window.__t;
  const p = g.photo;
  p.exit();
  for (let i = 0; i < 20 && p.active; i++) p.frame(0.1);
  for (let i = 0; i < 60; i++) g.update(1 / 60);
  g.render();
  const moved = t.diff(window.__a, t.screen());
  return { moved, active: p.active };
}

// The lens pushed down into the land, the road and the water. (The lens is
// stepped and not drawn: what is read is where it is let be.)
function pushedDown(arg) {
  const g = game;
  const p = g.photo;
  const o = g.road.origin;
  const out = {};
  const hold = (x, y, z, key, frames) => {
    p.lens.place(x, y, z);
    p.lens.press(key);
    for (let i = 0; i < frames; i++) p.lens.step(1 / 60);
    p.lens.release(key);
    return p.lens.p.y;
  };
  if (arg.where === 'land') {
    const pt = g.road.at(g.sCar + 30);
    const x = pt.x - Math.sin(pt.theta) * 40;
    const z = pt.z + Math.cos(pt.theta) * 40;
    const ground = g.corridor.heightAt(x + o.x, z + o.z);
    const sea = g.land.waterLevel(x + o.x, z + o.z);
    out.ground = ground;
    out.wet = Number.isFinite(sea) && sea > ground;
    out.held = hold(x, ground + 6, z, 'KeyQ', 120);
    out.asked = ground - 90;
    p.lens.place(x, out.asked, z);
    p.lens.step(1 / 60);
    out.put = p.lens.p.y;
    out.floor = Math.max(ground, Number.isFinite(sea) ? sea : -Infinity);
  } else if (arg.where === 'road') {
    const s = g.sCar + 20;
    const pt = g.road.at(s);
    const surface = g.road.surfaceAt(s, 0);
    const ground = g.corridor.heightAt(pt.x + o.x, pt.z + o.z);
    out.kind = pt.kind;
    // The road's surface and the land's, the higher; in a bore (kind 2) the road alone.
    out.floor = pt.kind === 2 ? surface : Math.max(surface, ground);
    out.ground = ground;
    out.held = hold(pt.x, surface + 4, pt.z, 'KeyQ', 120);
    out.asked = surface - 60;
    p.lens.place(pt.x, out.asked, pt.z);
    p.lens.step(1 / 60);
    out.put = p.lens.p.y;
  } else {
    // Water: somewhere round the car where the surface stands over the bed.
    let spot = null;
    for (let r = 10; r <= 300 && !spot; r += 10) {
      for (let a = 0; a < 360 && !spot; a += 10) {
        const x = g.car.x + r * Math.cos(a * Math.PI / 180);
        const z = g.car.z + r * Math.sin(a * Math.PI / 180);
        const sea = g.land.waterLevel(x + o.x, z + o.z);
        const ground = g.corridor.heightAt(x + o.x, z + o.z);
        const near = g.road.nearestS(x, z, g.sCar, 800);
        if (Number.isFinite(sea) && sea > ground + 1 && near.dist > 12) spot = { x, z, sea, ground };
      }
    }
    if (!spot) return { found: false };
    out.found = true;
    out.sea = spot.sea;
    out.ground = spot.ground;
    out.floor = spot.sea;
    out.held = hold(spot.x, spot.sea + 6, spot.z, 'KeyQ', 120);
    out.asked = spot.ground - 20;
    p.lens.place(spot.x, out.asked, spot.z);
    p.lens.step(1 / 60);
    out.put = p.lens.p.y;
  }
  return out;
}

// Pushed out from the car, along the road and across it, and let go of at a
// great distance.
function pushedOut() {
  const g = game;
  const p = g.photo;
  const c = g.car;
  const dist = () => Math.hypot(p.lens.p.x - c.x, p.lens.p.y - (c.y || 0), p.lens.p.z - c.z);
  let most = 0;
  const walk = (keys, frames) => {
    for (const k of keys) p.lens.press(k);
    for (let i = 0; i < frames; i++) {
      p.lens.step(1 / 30);
      most = Math.max(most, dist());
    }
    for (const k of keys) p.lens.release(k);
  };
  p.lens.place(c.x, (c.y || 0) + 3, c.z);
  walk(['KeyW', 'ShiftLeft'], 360);
  const ahead = dist();
  walk(['KeyS', 'ShiftLeft'], 720);
  const behind = dist();
  walk(['KeyE', 'ShiftLeft'], 360);
  const above = dist();
  p.lens.place(c.x + 5000, (c.y || 0) + 900, c.z - 7000);
  p.lens.step(1 / 60);
  return { ahead, behind, above, put: dist(), most };
}

// A picture of the frame: against the frame on the screen, and what was drawn
// to make it.
async function aPicture(arg) {
  const g = game;
  const t = window.__t;
  const p = g.photo;
  p.frame(0);
  const screen = t.screen();
  const w = g.canvas.width;
  const h = g.canvas.height;
  // The watch is tried on a frame first: it must see the canvas drawn.
  const tried = t.watch();
  g.render(0);
  const control = tried.stop();
  const watch = t.watch();
  const shot = await p.capture({ download: false });
  const seen = watch.stop();
  const bytes = new Uint8Array(await shot.blob.arrayBuffer());
  const sig = [...bytes.slice(0, 8)].join();
  const dv = new DataView(bytes.buffer);
  const header = [dv.getUint32(16), dv.getUint32(20)];
  const bmp = await createImageBitmap(shot.blob, { colorSpaceConversion: 'none' });
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0);
  const big = x.getImageData(0, 0, c.width, c.height).data;
  // Brought down to the canvas's size: each pixel the mean of the 4 over it.
  let sq = 0;
  let lit = 0;
  let sum = 0;
  const W = bmp.width;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 4;
      let e = 0;
      for (let ch = 0; ch < 3; ch++) {
        const m = (big[((2 * j) * W + 2 * i) * 4 + ch] + big[((2 * j) * W + 2 * i + 1) * 4 + ch]
          + big[((2 * j + 1) * W + 2 * i) * 4 + ch] + big[((2 * j + 1) * W + 2 * i + 1) * 4 + ch]) / 4;
        e += (m - screen[k + ch]) ** 2;
        sum += m;
      }
      sq += e / 3;
      if (big[((2 * j) * W + 2 * i) * 4] + big[((2 * j) * W + 2 * i) * 4 + 1] + big[((2 * j) * W + 2 * i) * 4 + 2] > 24) lit++;
    }
  }
  const mse = sq / (w * h);
  const after = [g.canvas.width, g.canvas.height];
  // For a look at them: the two pictures.
  const toUrl = (data, dw, dh) => {
    const q = document.createElement('canvas');
    q.width = dw;
    q.height = dh;
    q.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), dw, dh), 0, 0);
    return q.toDataURL('image/png');
  };
  return {
    canvas: [w, h], after, picture: [shot.width, shot.height], bitmap: [bmp.width, bmp.height], header, sig, size: shot.size, name: shot.name,
    psnr: mse > 0 ? 10 * Math.log10(255 * 255 / mse) : Infinity, lit: lit / (w * h), mean: sum / (3 * w * h),
    seen, control, sCar: Math.round(g.sCar),
    urls: arg && arg.keep ? { screen: toUrl(screen, w, h), picture: await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(shot.blob); }) } : null,
  };
}

// The world run on 60 steps with the lens never let go of: what to be held to.
function control() {
  const g = game;
  const t = window.__t;
  for (let i = 0; i < 60; i++) g.update(1 / 60);
  g.render();
  return { snap: t.snap(), car: t.car() };
}

// The same, with the lens let go of in the middle: moved, a picture taken,
// and let back.
async function viaThePhotoMode(arg) {
  const g = game;
  const t = window.__t;
  const p = g.photo;
  const cam = g.camera;
  const home = { p: cam.position.toArray(), q: cam.quaternion.toArray(), fov: cam.fov };
  const stopped = t.car();
  p.enter();
  const seenIn = t.car();
  p.lens.press('KeyW');
  for (let i = 0; i < 12; i++) p.frame(1 / 60);
  p.lens.release('KeyW');
  p.lens.drag(80, -30, 0.002);
  p.lens.press('KeyZ');
  for (let i = 0; i < 12; i++) p.frame(1 / 60);
  p.lens.release('KeyZ');
  let far = null;
  if (arg.far) {
    // Three hundred metres along the road, and up.
    const pt = g.road.at(g.sCar + 300);
    p.lens.place(pt.x, g.photoFloor(pt.x, pt.z) + 25, pt.z);
    for (let i = 0; i < 10; i++) p.frame(0.1);
    far = p.lens.p.toArray();
  } else {
    // A picture is no change to the world either.
    await p.capture({ download: false });
  }
  const seenOut = t.car();
  p.exit();
  const half = [];
  let elapsed = 0;
  while (p.active && elapsed < 1.5) {
    p.frame(0.1);
    elapsed += 0.1;
    if (half.length < 4) half.push(cam.position.distanceTo({ x: home.p[0], y: home.p[1], z: home.p[2], isVector3: true }));
  }
  const q0 = cam.quaternion.clone();
  q0.set(home.q[0], home.q[1], home.q[2], home.q[3]);
  const back = {
    elapsed,
    metres: Math.hypot(cam.position.x - home.p[0], cam.position.y - home.p[1], cam.position.z - home.p[2]),
    degrees: 2 * Math.acos(Math.min(1, Math.abs(cam.quaternion.dot(q0)))) * 180 / Math.PI,
    fov: Math.abs(cam.fov - home.fov),
    active: p.active,
  };
  const afterExit = t.car();
  const bodyClass = document.body.classList.contains('photo');
  for (let i = 0; i < 60; i++) g.update(1 / 60);
  g.render();
  return { snap: t.snap(), car: t.car(), stopped, seenIn, seenOut, afterExit, back, half, far, bodyClass };
}

// A bore in the road the page has surveyed: where it begins, and how long it is
// (at least 120 m).
function findBore() {
  const road = game.road;
  let start = null;
  for (let s = 160; s < road.end; s += 10) {
    const p = road.at(s);
    if (!p) break;
    if (p.kind === 2) {
      if (start === null) start = s;
      if (s - start >= 120) return { start, length: s - start };
    } else {
      start = null;
    }
  }
  return null;
}

// In the bore, with the car in it: the lens is held by the road under it and the
// vault over it (not by the hill over the vault), the frame's light is the
// bore's where the lens is in it and the open air's where it is not, and none of
// it is kept (the eye and the car's own light are as they were).
function inTheBore() {
  const g = game;
  const p = g.photo;
  const o = g.road.origin;
  const kept = { camIn: g.camInTunnel, eye: g.eye, carIn: g.inTunnel };
  p.enter();
  const look = g.atmosphere.look;
  const s = g.sCar;
  const pt = g.road.at(s);
  const surface = g.road.surfaceAt(s, 0);
  const vault = g.ceilingAt(pt.x, pt.z);
  const hill = g.corridor.heightAt(pt.x + o.x, pt.z + o.z);
  const light = () => ({ sun: g.atmosphere.sun.intensity / look.sunIntensity, exposure: g.post.exposure / (look.exposure || 1) });
  const out = { surface, vault, hill, kind: pt.kind, shut: g.ceilingAt(g.camera.position.x, g.camera.position.z) !== null, within: light() };
  const hold = (y, key, frames) => {
    p.lens.place(pt.x, y, pt.z);
    p.lens.press(key);
    for (let i = 0; i < frames; i++) p.lens.step(1 / 30);
    p.lens.release(key);
    return p.lens.p.y;
  };
  out.down = hold(surface + 2, 'KeyQ', 120);
  out.up = hold(surface + 2, 'KeyE', 120);
  // Over the hill, in the open air: the frame is the open air's.
  p.lens.place(pt.x, hill + 12, pt.z);
  p.frame(0);
  out.over = { y: p.lens.p.y, ...light() };
  // Back in the bore, drawn once more: the bore's light again.
  p.lens.place(pt.x, surface + 2, pt.z);
  p.frame(0);
  out.again = light();
  out.kept = { camIn: g.camInTunnel === kept.camIn, eye: g.eye === kept.eye, carIn: g.inTunnel === kept.carIn };
  return out;
}

// Under the cavern's roof: pushed up as far as it will go, the lens stops
// under the roof.
function underTheRoof() {
  const g = game;
  const p = g.photo;
  const o = g.road.origin;
  p.enter();
  p.lens.place(g.car.x, (g.car.y || 0) + 3, g.car.z);
  p.lens.press('KeyE');
  p.lens.press('ShiftLeft');
  for (let i = 0; i < 300; i++) p.lens.step(1 / 30);
  const roof = g.ceiling.roofAt(p.lens.p.x + o.x, p.lens.p.z + o.z);
  return { y: p.lens.p.y, roof, reach: p.lens.p.y - (g.car.y || 0) };
}

// In the deep sea, where the car is under the surface: the surface is not the
// ground for the lens, and it stops over the sea bed when it is pushed down.
function underTheSea() {
  const g = game;
  const p = g.photo;
  const o = g.road.origin;
  p.enter();
  const level = g.land.waterLevel(g.car.x + o.x, g.car.z + o.z);
  p.lens.place(g.car.x, (g.car.y || 0) + 3, g.car.z);
  p.lens.press('KeyQ');
  for (let i = 0; i < 120; i++) p.lens.step(1 / 60);
  p.lens.release('KeyQ');
  const x = p.lens.p.x;
  const z = p.lens.p.z;
  return { wet: p.wet, level, y: p.lens.p.y, bed: g.photoFloor(x, z, false), ground: g.groundAt(x, z), carY: g.car.y };
}

// --- the scenarios ------------------------------------------------------------

const WORLD_ZH = { hills: '丘陵', river: '河谷' };
const WORLD_EN = { hills: 'Hills', river: 'River' };
const STYLE_ZH = { real: '写实', paint: '手绘' };
const STYLE_EN = { real: 'Real', paint: 'Paint' };

// A world, a style, run as a headless page does, and let go of: the frames, the
// lens's limits, the picture.
async function standing(world, style, { lang = 'zh', limits = [], keep = false } = {}) {
  const tag = `${world}-${style}`;
  const page = await openPage({ size: keep ? PICTURE : [640, 360] });
  try {
    await page.goRun(`seed=7&world=${world}&style=${style}&cam=chase&lang=${lang}&run=120`);
    const inn = await page.run(goIn);
    say(inn.entered && inn.state === 'on' && inn.bodyClass && inn.barShown && !inn.shownStill.length,
      `${tag}: the photo mode goes in (the lens on the canvas ${inn.size.join(' x ')}), the bar is up and the instrument, the buttons, the brand, the name and the hint stand aside${inn.shownStill.length ? ' (still shown: ' + inn.shownStill + ')' : ''}`);
    await sleep(1000);
    const on = await page.run(aSecondOn);
    say(on.same.differing === 0 && on.again.differing === 0 && on.stood,
      `${tag}: a second apart (the wall's clock, a second by the page's own and by the frame's) two frames are the same pixels (${on.same.differing} of ${on.same.of} differ, by ${on.same.max} at most; the frame after, ${on.again.differing}); the game's own clock, frame and car stand (simTime ${f(on.car[5], 3)}, frame ${on.car[6]}, ${on.stood ? 'the car where it was' : 'THE CAR MOVED'})`);
    results[`frozen-${tag}`] = { same: on.same, again: on.again };

    // The picture, of the frame the lens stands at.
    const sh = await page.run(aPicture, { keep });
    const expect = `continuum-${lang === 'zh' ? WORLD_ZH[world] : WORLD_EN[world]}-${lang === 'zh' ? STYLE_ZH[style] : STYLE_EN[style]}-${sh.sCar}.png`;
    say(sh.picture[0] === sh.canvas[0] * 2 && sh.picture[1] === sh.canvas[1] * 2 && sh.bitmap.join() === sh.picture.join() && sh.header.join() === sh.picture.join()
      && sh.sig === '137,80,78,71,13,10,26,10',
    `${tag}: the picture is a PNG of ${sh.picture.join(' x ')}, twice the canvas (${sh.canvas.join(' x ')}) (${(sh.size / 1024).toFixed(0)} KiB)`);
    say(sh.lit > 0.5 && sh.mean > 20, `${tag}: and it is not black (${f(sh.lit * 100, 1)}% of it lit, mean ${f(sh.mean, 1)} of 255)`);
    say(sh.psnr >= 30, `${tag}: brought down to the canvas's size it is ${f(sh.psnr, 2)} dB (PSNR) from the frame on the screen (30 at least)`);
    say(sh.after.join() === sh.canvas.join() && !sh.seen.writes.length && !sh.seen.setSize && !sh.seen.setPixelRatio && sh.seen.onCanvas === 0 && sh.seen.draws > 20 && sh.control.onCanvas > 0,
      `${tag}: making it, nothing is drawn to the canvas (${sh.seen.onCanvas} of ${sh.seen.draws} draws; a frame drawn the usual way shows ${sh.control.onCanvas} on it, so the watch sees) and no size is written to it (${sh.seen.writes.length} writes, ${sh.seen.setSize} setSize, ${sh.seen.setPixelRatio} setPixelRatio; the canvas is ${sh.after.join(' x ')} after)`);
    say(sh.name === expect, `${tag}: it is called ${sh.name}${sh.name === expect ? '' : ' (wanted ' + expect + ')'}`);
    results[`picture-${tag}`] = { canvas: sh.canvas, picture: sh.picture, psnr: sh.psnr, lit: sh.lit, size: sh.size, name: sh.name, watch: sh.seen };
    if (keep && sh.urls) {
      mkdirSync(OUT, { recursive: true });
      for (const [k, url] of Object.entries(sh.urls)) writeFileSync(`${OUT}${tag}-${k}.png`, Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64'));
    }

    // The lens in the land, the road and the water.
    for (const where of limits) {
      const r = await page.run(pushedDown, { where });
      if (r.found === false) {
        say(false, `${tag}: no place with water over its bed within 300 m of the car to push the lens into`);
        continue;
      }
      const lowest = r.floor + 0.3;
      const high = r.held - lowest;
      say(r.held >= lowest - 1e-3 && high < 0.02 && r.put >= lowest - 1e-3 && r.put - lowest < 0.02,
        `${tag}: pushed down into the ${where === 'land' ? 'land' : where === 'road' ? 'road (a ' + ['ground', 'bridge', 'tunnel'][r.kind] + ')' : 'water'} the lens stops ${f(r.held - r.floor, 3)} m over its surface (at least 0.3; ${f(r.floor, 2)} m there) and, put ${f(r.floor - r.asked, 1)} m under it, is brought to ${f(r.put - r.floor, 3)} m over it`);
      results[`push-${tag}-${where}`] = r;
    }
    if (limits.length && limits[0] !== 'water') {
      const r = await page.run(pushedOut);
      say(r.most <= 400 && r.ahead <= 400 && r.behind <= 400 && r.above <= 400 && r.put <= 400 && r.ahead > 399 && r.behind > 399,
        `${tag}: taken out from the car ahead (${f(r.ahead, 2)} m), behind it (${f(r.behind, 2)}) and up (${f(r.above, 2)}) at the Shift's pace for as long as it takes, and put 9 km off (${f(r.put, 2)}), it is never over 400 m from it (${f(r.most, 3)} at most)`);
      results[`reach-${tag}`] = r;
    }

    // And the world going on does move the frame.
    const go = await page.run(theWorldGoesOn);
    say(go.moved.differing > go.moved.of * 0.005 && !go.active,
      `${tag}: out again, a second of the world going on has changed ${f(go.moved.differing / go.moved.of * 100, 1)}% of the pixels of the frame (so the two equal frames were not for want of anything to move)`);
    say(!page.errors.length, `${tag}: the console is clean${page.errors.length ? ' (' + page.errors.slice(0, 2) + ')' : ''}`);
  } finally {
    page.close();
  }
}

// The same stretch run twice, once with the lens let go of in the middle.
async function unchanged() {
  const query = 'seed=7&world=hills&style=real&cam=chase&run=90';
  const pages = [];
  const run = async (fn, arg) => {
    const page = await openPage({ size: [480, 270] });
    pages.push(page);
    await page.goRun(query);
    return page.run(fn, arg);
  };
  try {
    const plain = await run(control);
    const near = await run(viaThePhotoMode, { far: false });
    const faraway = await run(viaThePhotoMode, { far: true });
    // What is the world's, and what is what has been drawn or built on the way.
    const DRAWN = ['drawCalls', 'triangles', 'geometries'];
    const CACHES = ['trees', 'clutter'];
    const differ = (a, b, skip) => Object.keys(a).filter((k) => !skip.includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    const keys = Object.keys(plain.snap).length;
    for (const [name, run2, skip] of [['the lens moved a little, a picture taken', near, DRAWN], ['the lens sent 300 m along the road and up', faraway, [...DRAWN, ...CACHES]]]) {
      const bad = differ(plain.snap, run2.snap, skip);
      say(!bad.length && run2.car.join() === plain.car.join(),
        `${name}, then out and 60 steps: the snapshot is the one of the run that never went in, in all but the lens${skip.length ? ' and what has been drawn and built on the way (' + skip.join(', ') + ')' : ''} (${keys - skip.length - 1} of ${keys} fields)${bad.length ? ' (differ: ' + bad.map((k) => `${k} ${JSON.stringify(plain.snap[k])} / ${JSON.stringify(run2.snap[k])}`).join('; ') + ')' : ''}; the car is at ${run2.car.slice(0, 3).map((x) => f(x, 3)).join(' ')} as it is in the run that never went in`);
      const drawn = differ(plain.snap, run2.snap, Object.keys(plain.snap).filter((k) => ![...DRAWN, ...CACHES].includes(k)));
      results[`snapshot-${name.slice(0, 12)}`] = { differ: bad, drawnDiffer: drawn };
      console.error(`      told, not held: ${drawn.length ? drawn.map((k) => `${k} ${JSON.stringify(plain.snap[k])} / ${JSON.stringify(run2.snap[k])}`).join('; ') : 'what has been drawn and built is the same too'}`);
    }
    say(near.stopped.join() === near.seenIn.join() && near.seenIn.join() === near.seenOut.join() && near.afterExit.join() === near.stopped.join()
      && near.afterExit[5] === near.stopped[5] && near.afterExit[6] === near.stopped[6],
    `the car, the game's clock and its frame stand where the world stopped (${near.stopped.slice(0, 3).map((x) => f(x, 3)).join(' ')}, ${f(near.stopped[5], 3)} s) while the lens is let go of, a picture is taken, and on the way back`);
    for (const [name, r] of [['near', near], ['far', faraway]]) {
      say(r.back.metres <= 0.05 && r.back.degrees <= 0.5 && r.back.fov <= 0.01 && !r.back.active && r.back.elapsed >= 0.6 - 1e-9 && r.back.elapsed <= 0.71 && !r.bodyClass,
        `${name}: the lens is back where it began in ${f(r.back.elapsed, 2)} s of the wall's clock (to ${f(r.back.metres * 100, 2)} cm, ${f(r.back.degrees, 3)} degrees, ${f(r.back.fov, 4)} of field of view) and the world is going on`);
    }
    const mid = near.half;
    say(mid.length >= 3 && mid[0] > 0.01 && mid[1] < mid[0] && mid[2] < mid[1], `on the way back it goes smoothly, not at once (${mid.map((x) => f(x, 2)).join(', ')} m from home at 0.1 s steps)`);
    say(plain.car[5] === near.car[5] && plain.car[6] === near.car[6], `the game's clock after the 60 steps is the same with the mode and without (${f(near.car[5], 3)} s, frame ${near.car[6]})`);
  } finally {
    for (const p of pages) p.close();
  }
}

// Where the ground is not simply the land's: in a bore (the road is the floor and
// the vault the roof, the hill over it is neither, and the frame's light is the
// bore's where the lens is), under the cavern's roof, and in the deep sea (the
// surface of the water is not the floor for a lens that began under it).
async function underneath() {
  // A bore: found in the road a page surveys at the start, and a page opened with the car in it.
  const finder = await openPage({ size: [480, 270] });
  let bore = null;
  try {
    await finder.goRun('seed=7&cam=chase&run=2');
    bore = await finder.run(findBore);
  } finally {
    finder.close();
  }
  if (!bore) {
    say(false, 'no bore of 120 m or more in the road a page surveys at the start of seed 7');
  } else {
    const page = await openPage({ size: [480, 270] });
    try {
      await page.goRun(`seed=7&s=${Math.round(bore.start + 60)}&cam=chase&run=30`);
      const r = await page.run(inTheBore);
      say(r.kind === 2 && r.shut && r.down >= r.surface + 0.3 - 1e-3 && r.down - (r.surface + 0.3) < 0.02 && r.hill > r.vault + 1
        && r.up <= r.vault - 0.3 + 1e-3 && r.vault - 0.3 - r.up < 0.02,
      `in a bore of ${f(bore.length, 0)} m (the vault ${f(r.vault - r.surface, 2)} m over the road, the hill ${f(r.hill - r.surface, 1)} m): pushed down the lens stops ${f(r.down - r.surface, 3)} m over the road (not lifted to the hill) and pushed up ${f(r.vault - r.up, 3)} m under the vault`);
      say(Math.abs(r.within.sun - 0.03) < 1e-3 && Math.abs(r.within.exposure - 1.5) < 1e-3 && Math.abs(r.over.sun - 1) < 1e-3 && Math.abs(r.over.exposure - 1) < 1e-3
        && Math.abs(r.again.sun - 0.03) < 1e-3 && r.kept.camIn && r.kept.eye && r.kept.carIn,
      `the frame's light is the bore's where the lens is in it (the sun at ${f(r.within.sun * 100, 1)}% and the exposure ${f(r.within.exposure, 2)} times), the open air's over the hill (${f(r.over.sun * 100, 1)}%, ${f(r.over.exposure, 2)} times) and the bore's again in it (${f(r.again.sun * 100, 1)}%), at once, and the eye and the car's own light are as they were (${Object.values(r.kept).every(Boolean) ? 'kept' : 'NOT KEPT'})`);
      results.bore = r;
      say(!page.errors.length, `the bore's page console is clean${page.errors.length ? ' (' + page.errors.slice(0, 2) + ')' : ''}`);
    } finally {
      page.close();
    }
  }

  const cave = await openPage({ size: [480, 270] });
  try {
    await cave.goRun('seed=7&world=cavern&cam=chase&run=30');
    const c = await cave.run(underTheRoof);
    say(Number.isFinite(c.roof) && c.reach > 30 && c.y <= c.roof - 0.3 + 1e-3 && c.roof - c.y - 0.3 < 0.02,
      `in the cavern, pushed up at the Shift's pace for ten seconds the lens rises ${f(c.reach, 1)} m and stops ${f(c.roof - c.y, 3)} m under the roof (at least 0.3)`);
    results.cavern = c;
  } finally {
    cave.close();
  }

  const deep = await openPage({ size: [480, 270] });
  try {
    await deep.goRun('seed=7&world=abyss&cam=chase&run=30');
    const d = await deep.run(underTheSea);
    say(d.wet === false && d.y < d.level && Math.abs(d.y - (d.bed + 0.3)) < 0.02,
      `in the deep sea (the surface ${f(d.level, 1)} m, the car at ${f(d.carY, 1)} m) the surface does not hold the lens up, and pushed down it stops ${f(d.y - d.bed, 3)} m over the bed (at least 0.3)`);
    results.deep = d;
  } finally {
    deep.close();
  }
}

// Real keys and a real mouse on a live page.
async function withKeys() {
  const page = await openPage({ size: [480, 360] });
  try {
    await page.goto('seed=7&auto=0&tier=low');
    await page.front();
    const state = () => page.ev(`({
      photo: game.photo.state, body: document.body.classList.contains('photo'), wall: document.body.classList.contains('wallpaper'),
      auto: game.autoMode, framing: game.chase.framing, turns: game.turns || 0, sim: game.simTime, frame: game.frame,
      car: [game.car.x, game.car.z, game.car.vx, game.car.speed], lens: game.camera.position.toArray(), look: [game.photo.lens.yaw, game.photo.lens.pitch, game.photo.lens.roll],
      fovTo: game.photo.lens.fovTo, view: [game.chase.view.yaw, game.chase.view.pitch, game.chase.view.held], frames: game.photo.frames,
      saved: window.__saved.length, hudSeen: getComputedStyle(document.getElementById('hud')).visibility,
    })`);
    const frames = async (n) => {
      const from = await page.ev('game.photo.frames');
      for (const t0 = Date.now(); (await page.ev('game.photo.frames')) < from + n && Date.now() - t0 < 120000;) {
        await page.front();
        await sleep(150);
      }
    };
    // A click of the mouse on a button of the page, in the middle of it.
    const click = async (selector) => {
      const [x, y] = await page.ev(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
      await page.mouse('mouseMoved', x, y);
      await page.mouse('mousePressed', x, y, { button: 'left', clickCount: 1, buttons: 1 });
      await page.mouse('mouseReleased', x, y, { button: 'left', clickCount: 1 });
    };
    const inactive = async () => {
      for (const t0 = Date.now(); (await page.ev('game.photo.active')) && Date.now() - t0 < 120000;) {
        await page.front();
        await sleep(200);
      }
    };
    const s0 = await state();

    // A page that has not its first frame yet does not go in at a K.
    const early = await page.ev(`(() => {
      const was = window.__ready;
      window.__ready = false;
      ui.photoBar.key({ code: 'KeyK' });
      const state = game.photo.state;
      window.__ready = was;
      return { was, state };
    })()`);
    say(early.was === true && early.state === 'off', `a K before the page is ready does nothing (the mode is ${early.state}; the page is ready now: ${early.was})`);

    // Outside the mode, the keys do what they did.
    await page.key('KeyP');
    const p1 = await state();
    await page.key('KeyP');
    await page.key('KeyC');
    const c1 = await state();
    await page.ev(`game.setCamera('chase')`);
    say(p1.auto === !s0.auto && c1.framing !== s0.framing && c1.photo === 'off', `outside the photo mode P toggles the autopilot (${s0.auto}→${p1.auto}) and C changes the camera (${s0.framing}→${c1.framing}), as they did`);

    // K goes in.
    await page.key('KeyK');
    const inn = await state();
    say(inn.photo === 'on' && inn.body, 'K goes into the photo mode (the page says so)');
    await frames(3);

    // The car put away, with the switch of the bar (a click of the mouse): the
    // frame loses the car, what it casts and what its lamps light, and the sky
    // is as it was; put back, it is the frame it was. (A page that has just
    // come up is still being built: the pieces of the land arrive over a few
    // frames and then stand, so what is read waits for two frames the same.)
    const still = async () => {
      let quiet = 0;
      for (const t0 = Date.now(); quiet < 3 && Date.now() - t0 < 120000;) {
        const d = await page.ev(`(() => { game.photo.frame(0); const a = __t.screen(); game.photo.frame(0.05); return __t.diff(a, __t.screen()).differing; })()`);
        quiet = d === 0 ? quiet + 1 : 0;
        await page.front();
        await sleep(300);
      }
      return quiet >= 3;
    };
    const stood = await still();
    say(stood, 'in the live page, once the world has been built round the lens, two frames in the photo mode are the same pixels (three times in a row)');
    await page.ev(`(() => { game.photo.frame(0); window.__with = __t.screen(); window.__lamp = game.headlight.intensity; })()`);
    await click('#btnPhotoCar');
    await still();
    const away = await page.ev(`(() => {
      game.photo.frame(0);
      const a = window.__with;
      const b = __t.screen();
      const w = game.canvas.width;
      const h = game.canvas.height;
      const count = { all: 0, car: 0, sky: 0 };
      for (let i = 0; i < a.length; i += 4) {
        if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue;
        const x = (i / 4) % w;
        const y = Math.floor(i / 4 / w);
        count.all++;
        if (x > w * 0.3 && x < w * 0.7 && y > h * 0.45 && y < h * 0.85) count.car++;
        if (y < h * 0.15) count.sky++;
      }
      return { count, size: [w, h], hidden: game.photo.hidden, shown: game.presentation.root.visible, lamp: game.headlight.intensity,
        pressed: document.getElementById('btnPhotoCar').getAttribute('aria-pressed') };
    })()`);
    await click('#btnPhotoCar');
    await still();
    const returned = await page.ev(`(() => {
      game.photo.frame(0);
      const d = __t.diff(window.__with, __t.screen());
      return { ...d, hidden: game.photo.hidden, shown: game.presentation.root.visible, lamp: game.headlight.intensity, was: window.__lamp,
        pressed: document.getElementById('btnPhotoCar').getAttribute('aria-pressed') };
    })()`);
    const area = away.size[0] * away.size[1];
    say(away.hidden && !away.shown && away.lamp === 0 && away.pressed === 'true' && away.count.car > 500 && away.count.sky === 0 && away.count.all < area * 0.3,
      `the switch puts the car away: it is not drawn and its lamps are out; ${away.count.all} pixels of the frame change (${(away.count.all / area * 100).toFixed(1)}%), ${away.count.car} of them where the car stood, none in the sky`);
    say(!returned.hidden && returned.shown && returned.differing === 0 && returned.lamp === returned.was && returned.pressed === 'false',
      `and it brings the car back: the frame is the one it was (${returned.differing} of ${returned.of} pixels differ) and the lamps are as they were (${f(returned.lamp, 2)})`);

    // None of the world's keys is any use in it.
    const before = await state();
    for (const k of ['KeyP', 'KeyC', 'KeyN', 'KeyH', 'KeyR']) await page.key(k);
    await frames(2);
    const after = await state();
    say(after.auto === before.auto && after.framing === before.framing && after.turns === before.turns && !after.wall && after.car.join() === before.car.join() && after.sim === before.sim && after.frame === before.frame,
      `in the mode P, C, N, H and R do nothing (autopilot ${before.auto}→${after.auto}, camera ${before.framing}→${after.framing}, worlds turned ${before.turns}→${after.turns}, wallpaper ${after.wall}, the car ${after.car.join() === before.car.join() ? 'where it was' : 'MOVED'})`);

    // W A S D do not drive: held, they move the lens and nothing of the car.
    await page.keyDown('KeyW');
    await sleep(1500);
    await frames(2);
    await page.keyUp('KeyW');
    const w = await state();
    const moved = Math.hypot(w.lens[0] - after.lens[0], w.lens[1] - after.lens[1], w.lens[2] - after.lens[2]);
    say(moved > 0.5 && w.car.join() === after.car.join() && w.sim === after.sim && w.frame === after.frame && w.car[3] === before.car[3],
      `W held a second and a half moves the lens ${f(moved, 2)} m and drives nothing (the car's speed ${f(w.car[3], 3)} m/s as it was, the game's clock ${w.sim === after.sim ? 'still' : 'MOVED'}; the autopilot is off, so on the road these would steer it)`);
    await page.keyDown('KeyQ');
    await sleep(600);
    await page.keyUp('KeyQ');
    await page.keyDown('KeyZ');
    await sleep(1500);
    await frames(2);
    await page.keyUp('KeyZ');
    await frames(3);
    const rolled = await state();
    say(rolled.look[2] !== w.look[2] && Math.abs(rolled.look[2] - w.look[2]) <= 30 * DEG + 1e-6 && rolled.lens[1] < w.lens[1] + 1e-9,
      `Q takes it down and Z rolls it (by ${f((rolled.look[2] - w.look[2]) / DEG, 1)} degrees)`);

    // The mouse: a drag with the left button turns the lens, a drag with the right the same,
    // and the right button's look round the car (chase) does not hear it.
    const [mx, my] = await page.middle();
    const turn0 = (await state()).look;
    await page.mouse('mouseMoved', mx, my);
    await page.mouse('mousePressed', mx, my, { button: 'left', clickCount: 1, buttons: 1 });
    await page.mouse('mouseMoved', mx + 60, my + 20, { button: 'left', buttons: 1 });
    await page.mouse('mouseMoved', mx + 120, my + 30, { button: 'left', buttons: 1 });
    await page.mouse('mouseReleased', mx + 120, my + 30, { button: 'left', clickCount: 1 });
    await frames(2);
    const dragged = await state();
    await page.mouse('mouseMoved', mx, my);
    await page.mouse('mousePressed', mx, my, { button: 'right', clickCount: 1, buttons: 2 });
    await page.mouse('mouseMoved', mx - 80, my, { button: 'right', buttons: 2 });
    await page.mouse('mouseReleased', mx - 80, my, { button: 'right', clickCount: 1 });
    await frames(2);
    const right = await state();
    say(dragged.look[0] > turn0[0] + 0.05 && dragged.look[1] > turn0[1] && right.look[0] < dragged.look[0] - 0.02 && right.view.join() === s0.view.join(),
      `a drag of the mouse turns the lens (the picture goes where the pointer goes: right and down turns it left, ${f((dragged.look[0] - turn0[0]) / DEG, 1)} degrees, and up, ${f((dragged.look[1] - turn0[1]) / DEG, 1)}), the right button too, and the right button's look round the car is not told of it (${right.view})`);
    await page.mouse('mouseWheel', mx, my, { deltaX: 0, deltaY: -400 });
    await frames(3);
    const zoomed = await state();
    await page.mouse('mouseWheel', mx, my, { deltaX: 0, deltaY: -100000 });
    await frames(3);
    const zoomedMore = await state();
    await page.mouse('mouseWheel', mx, my, { deltaX: 0, deltaY: 200000 });
    await frames(3);
    const wide = await state();
    say(zoomed.fovTo < 55 && Math.abs(zoomedMore.fovTo - 20) < 1e-9 && Math.abs(wide.fovTo - 100) < 1e-9,
      `the wheel changes the field of view (${f(zoomed.fovTo, 1)} degrees after a turn, ${f(zoomedMore.fovTo, 1)} at the most, ${f(wide.fovTo, 1)} the other way)`);

    // Enter takes a picture and the page saves it.
    await page.key('Enter');
    for (const t0 = Date.now(); (await page.ev('window.__saved.length')) < 1 && Date.now() - t0 < 120000;) {
      await page.front();
      await sleep(200);
    }
    const saved = await page.ev(`(async () => {
      const s = window.__saved[0];
      if (!s) return null;
      const bytes = new Uint8Array(await (await fetch(s.href)).arrayBuffer());
      const dv = new DataView(bytes.buffer);
      return { name: s.name, size: bytes.length, wh: [dv.getUint32(16), dv.getUint32(20)], canvas: [game.canvas.width, game.canvas.height], sCar: Math.round(game.sCar), world: game.worldHere().name,
        away: game.photo.hidden, focus: document.activeElement && document.activeElement.id };
    })()`);
    say(!!saved && saved.wh[0] === saved.canvas[0] * 2 && saved.wh[1] === saved.canvas[1] * 2 && saved.name === `continuum-${saved.world}-${STYLE_ZH.real}-${saved.sCar}.png` && !saved.away,
      `Enter takes a picture and hands it to the browser as ${saved && saved.name} (${saved && saved.wh.join(' x ')}, ${saved && (saved.size / 1024).toFixed(0)} KiB), and the button that has the focus (${saved && saved.focus || 'none'}) is not clicked by it`);
    const note = await page.ev(`document.getElementById('photonote').textContent`);
    say(!!saved && note.includes('continuum-') && note.includes('已保存'), `and the bar says so ("${note}")`);

    // The canvas is not touched while a picture is taken, and no frame of another size is shown.
    await page.ev(`(() => {
      window.__probe = { widths: [], stop: false, writes: [] };
      const cv = game.canvas;
      for (const k of ['width', 'height']) {
        const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, k);
        Object.defineProperty(cv, k, { configurable: true, get() { return d.get.call(this); }, set(v) { window.__probe.writes.push([k, v]); d.set.call(this, v); } });
      }
      const loop = () => { window.__probe.widths.push([cv.width, cv.height]); if (!window.__probe.stop) requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    })()`);
    await frames(2);
    await page.key('Enter');
    for (const t0 = Date.now(); (await page.ev('window.__saved.length')) < 2 && Date.now() - t0 < 120000;) {
      await page.front();
      await sleep(200);
    }
    await frames(2);
    const probe = await page.ev(`(() => { window.__probe.stop = true; const p = window.__probe; delete game.canvas.width; delete game.canvas.height; return { n: p.widths.length, distinct: [...new Set(p.widths.map((w) => w.join('x')))], writes: p.writes.length }; })()`);
    say(probe.n > 3 && probe.distinct.length === 1 && probe.writes === 0,
      `taking a picture, the canvas keeps its size at every frame the page draws (${probe.n} frames, all ${probe.distinct.join(', ')}) and none is written to it (${probe.writes} writes)`);
    await page.front();
    await page.shot('keys-photo.png');

    // Esc goes out (the game's clock is read at the moment it is told that the
    // world goes on, before the first step of it); K goes in again and out;
    // the wallpaper mode and the photo mode are one or the other.
    await page.ev(`(() => {
      const was = game.photo.onChange;
      game.photo.onChange = (s) => {
        if (s === 'off') window.__off = { sim: game.simTime, frame: game.frame, car: [game.car.x, game.car.z] };
        was(s);
      };
    })()`);
    const stoodAt = await state();
    await page.key('Escape');
    for (const t0 = Date.now(); (await page.ev('game.photo.active')) && Date.now() - t0 < 120000;) {
      await page.front();
      await sleep(200);
    }
    const off = await page.ev('window.__off');
    for (const t0 = Date.now(); off && (await page.ev('game.simTime')) <= off.sim && Date.now() - t0 < 60000;) {
      await page.front();
      await sleep(200);
    }
    const gone = await state();
    say(gone.photo === 'off' && !gone.body && gone.hudSeen === 'visible' && !!off && off.sim === stoodAt.sim && off.frame === stoodAt.frame
      && off.car.join() === stoodAt.car.slice(0, 2).join() && gone.sim > off.sim,
    `Esc goes out: the lens comes back, the page is the page again, and the world goes on from where it stopped (the game's clock was ${f(stoodAt.sim, 3)} s when it stood and when it was let go, and ${f(gone.sim, 3)} s a moment on)`);
    await page.key('KeyH');
    await page.key('KeyK');
    const wall = await state();
    await page.key('KeyH');
    await page.key('KeyK');
    const photoAgain = await state();
    await page.key('KeyH');
    const photoWall = await state();
    await page.key('KeyK');
    for (const t0 = Date.now(); (await page.ev('game.photo.active')) && Date.now() - t0 < 120000;) {
      await page.front();
      await sleep(200);
    }
    say(wall.wall && wall.photo === 'off' && !photoAgain.wall && photoAgain.photo === 'on' && !photoWall.wall && photoWall.photo === 'on',
      `the wallpaper mode and the photo mode are one or the other: K does nothing in the wallpaper mode (${wall.photo}), H does nothing in the photo mode (wallpaper ${photoWall.wall})`);

    // The buttons, clicked with the mouse. The one in the page's bar goes in; the
    // car put away with the switch is back when the exit button has gone out.
    await click('#btnPhoto');
    const byButton = await state();
    await frames(3);
    await click('#btnPhotoCar');
    await click('#btnPhotoExit');
    await inactive();
    const out = await page.ev(`({ state: game.photo.state, body: document.body.classList.contains('photo'), away: game.photo.hidden, shown: game.presentation.root.visible })`);
    say(byButton.photo === 'on' && byButton.body && out.state === 'off' && !out.body && !out.away && out.shown,
      `the camera button of the page's bar goes in (${byButton.photo}); the exit button goes out (${out.state}) and takes the car that was put away with it, back (${out.shown ? 'drawn' : 'NOT DRAWN'})`);

    // The style button changes the style as the world stands (the game's clock and frame do not
    // move); the change over, two frames a second apart are the same pixels. The shutter takes a
    // picture of that style.
    await click('#btnPhoto');
    await frames(3);
    const st0 = await page.ev(`({ id: game.style.id, label: document.querySelector('#btnPhotoStyle .txt').textContent, sim: game.simTime, frame: game.frame })`);
    await click('#btnPhotoStyle');
    for (const t0 = Date.now(); (await page.ev('game.style.moving')) && Date.now() - t0 < 180000;) {
      await page.front();
      await sleep(200);
    }
    await frames(4);
    const st1 = await page.ev(`(() => {
      const p = game.photo;
      p.frame(0.05);
      const a = __t.screen();
      p.frame(1.0);
      const b = __t.screen();
      return { id: game.style.id, label: document.querySelector('#btnPhotoStyle .txt').textContent, sim: game.simTime, frame: game.frame, same: __t.diff(a, b) };
    })()`);
    say(st1.id !== st0.id && st1.label !== st0.label && st1.sim === st0.sim && st1.frame === st0.frame && st1.same.differing === 0,
      `the style button changes the style (${st0.id} ${st0.label} to ${st1.id} ${st1.label}) and the world stands through it (the game's clock and frame as they were); the change over, two frames a second apart are the same pixels (${st1.same.differing} of ${st1.same.of})`);
    const was = await page.ev('window.__saved.length');
    await click('#btnShutter');
    for (const t0 = Date.now(); (await page.ev('window.__saved.length')) <= was && Date.now() - t0 < 180000;) {
      await page.front();
      await sleep(200);
    }
    const shot = await page.ev(`({ name: window.__saved[window.__saved.length - 1].name, sCar: Math.round(game.sCar), world: game.worldHere().name, note: document.getElementById('photonote').textContent })`);
    say(shot.name === `continuum-${shot.world}-${STYLE_ZH[st1.id]}-${shot.sCar}.png` && shot.note.includes(shot.name),
      `the shutter button takes the picture, in the style that is now (${shot.name}), and the bar says so`);
    await click('#btnPhotoExit');
    await inactive();
    say(!page.errors.length, `the live page's console is clean${page.errors.length ? ' (' + page.errors.slice(0, 2) + ')' : ''}`);
  } finally {
    page.close();
  }
}

// --- run ----------------------------------------------------------------------

await inNode();
const kill = () => { for (const p of open) p.close(); };
process.on('SIGINT', () => { kill(); process.exit(130); });

const server = serve();
try {
  if (!(await waitForServer())) throw new Error('server did not start');
  // One scenario that breaks does not stop the others from being read.
  const scenarios = [
    ['the hills, real', () => standing('hills', 'real', { limits: ['land', 'road'], keep: true })],
    ['the hills, painted', () => standing('hills', 'paint', { keep: true })],
    ['the river, real', () => standing('river', 'real', { limits: ['water'] })],
    ['the river, painted, in English', () => standing('river', 'paint', { lang: 'en' })],
    ['the world left as it was', unchanged],
    ['under the ground: a bore, the cavern, the deep sea', underneath],
    ['real keys and a real mouse', withKeys],
  ];
  const only = (process.env.ONLY || '').split(',').filter(Boolean);
  for (const [name, scenario] of scenarios) {
    if (only.length && !only.some((o) => name.includes(o))) continue;
    try {
      await scenario();
    } catch (e) {
      say(false, `${name}: ${e.message}`);
      console.error(e.stack);
    }
  }
} catch (e) {
  console.error(`FAIL: ${e.stack || e.message}`);
  failed++;
} finally {
  kill();
  server.kill();
  // The browsers have gone; their profiles go with them.
  await sleep(800);
  for (const dir of profiles) rmSync(dir, { recursive: true, force: true });
}
try {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(OUT + 'photo_check.json', JSON.stringify(results, null, 2));
} catch { /* the pictures are what is wanted */ }
if (failed) {
  console.error(`\n${failed} problem${failed > 1 ? 's' : ''}`);
  process.exit(1);
}
console.error('\nOK: the world stands still in the photo mode, the lens goes where it is let and no further, a picture is the frame at twice the size and takes nothing from the screen, and going out leaves the world as it was');
process.exit(0);
