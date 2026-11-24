// Render the sound of a drive offline and save it, to listen to without a
// browser, and hold the sound to its numbers.
//
// node tools/sound_demo.mjs [seconds] [extra query] [out.wav]
//   The page runs headless with sounddemo=1, drives for the given seconds and
//   renders its sound (src/ui/sound.js) into an OfflineAudioContext beside the
//   drive; this script waits for it over the DevTools protocol (the render runs
//   on the audio thread, which a virtual-time budget does not wait for) and
//   writes the WAV.
//   e.g. node tools/sound_demo.mjs 90 "seed=7&worldlen=1500&cam=director"
//
// node tools/sound_demo.mjs --check
//   The sound is rendered over fixed drives of the real page (the hills, seed 7)
//   and over states made up for it, each a WAV in out/sound-demo-<name>.wav, and
//   measured (tools/sound_measure.mjs): how loud, in which bands, when. The
//   drives: 60 s of the autopilot; 10 s on the road and 10 s off it at the
//   same speed; a car driven into a trunk at 15 m/s; a car coming the other way,
//   heard from behind the car and from beside the road; tyres slid in a slalom
//   on the road; the sound off. The made-up states: everything at once at the top
//   of the slider, the hits, the grounds, the squeal and its tremble, a car going
//   by, the hum of other cars, a river near and far, the sound off. A drive in the valley (the
//   lens on the river's bridge, and 700 m from the water) is rendered as the state the game gives it
//   there, and the river is heard where it is near. Numbers where the rules say a
//   number; "no clipping" is a peak of -1 dBFS or less; the drive's loudness is
//   held to tools/sound_baseline.json. A part that goes wrong does not stop the
//   rest from being measured.
//
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readWav, subtract, level, track, swing, centroid, clicks, ringing, balance } from './sound_measure.mjs';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8179;
const ROOT = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const [seconds = '60', extra = 'seed=7&cam=director', out = ROOT + 'out/sound-demo.wav'] = args.filter((a) => !a.startsWith('--'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('node', [ROOT + 'tools/serve.mjs', String(PORT), ROOT], { stdio: ['ignore', 'pipe', 'inherit'] });
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
  } catch { /* not up yet */ }
  await sleep(100);
}

// A page in a browser of its own, and a way to run code in it. Returns { ev(expression) -> value, close() }.
async function openPage(query) {
  const profile = `${tmpdir()}/continuum-sound-${process.pid}-${Date.now()}`;
  const url = `http://localhost:${PORT}/index.html?${query}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--window-size=640,360', '--remote-debugging-port=0', `--user-data-dir=${profile}`, url],
  { stdio: ['ignore', 'ignore', 'pipe'], env: CHROME_ENV });
  // The browser says where its DevTools endpoint is on stderr.
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
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  });
  const ev = (expression) => new Promise((resolve, reject) => {
    pending.set(++id, (r) => {
      if (r && r.exceptionDetails) reject(new Error(`in the page: ${(r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text}`));
      else resolve(r && r.result ? r.result.value : undefined);
    });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  return {
    ev,
    close: async () => {
      chrome.kill();
      await new Promise((r) => (chrome.exitCode !== null ? r() : chrome.on('exit', r)));
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

// Wait for the page to say it is done (or has failed).
async function until(page, limit = 30 * 60 * 1000) {
  const t0 = Date.now();
  for (;;) {
    const title = await page.ev('document.title');
    if (title === 'GAME_DONE') return;
    const err = await page.ev("(document.getElementById('err') || {}).textContent || ''");
    if (err) throw new Error('page error\n' + err);
    if (Date.now() - t0 > limit) throw new Error('timed out');
    await sleep(1000);
  }
}

const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
const finish = async (code) => {
  server.kill();
  process.exit(code);
};

// ---------------------------------------------------------------------------
// One drive, rendered by the page itself.
// ---------------------------------------------------------------------------
async function legacy() {
  const frames = Math.round(Number(seconds) * 60);
  const page = await openPage(`run=${frames}&sounddemo=1&${extra}`);
  const t0 = Date.now();
  try {
    await until(page);
  } catch (e) {
    console.error('FAIL: ' + e.message);
    await page.close();
    await finish(1);
  }
  const b64 = await page.ev("(document.getElementById('sound') || {}).textContent || ''");
  await page.close();
  if (!b64) {
    console.error('FAIL: no sound in the page');
    await finish(1);
  }
  const wav = Buffer.from(b64.trim(), 'base64');
  writeFileSync(out, wav);
  // A quick look at the levels, so a silent or clipping render shows here.
  const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, Math.floor((wav.length - 44) / 2));
  let peak = 0;
  let sum = 0;
  for (const s of pcm) {
    peak = Math.max(peak, Math.abs(s));
    sum += s * s;
  }
  const lv = (x) => db(x / 32768).toFixed(1);
  console.error(`OK: ${out}, ${seconds} s in ${((Date.now() - t0) / 1000).toFixed(0)} s, peak ${lv(peak)} dBFS, rms ${lv(Math.sqrt(sum / pcm.length))} dBFS`);
  await finish(0);
}

// ---------------------------------------------------------------------------
// In the page: what renders. Each of these is sent to the page as its source.
// ---------------------------------------------------------------------------
function toolkit() {
  const RATE = 32000;
  // 16-bit PCM WAV of an AudioBuffer, as base64, and the highest sample before it was cut to 16 bits.
  const pack = (buf) => {
    const ch = buf.numberOfChannels;
    const n = buf.length;
    const bytes = new Uint8Array(44 + n * ch * 2);
    const v = new DataView(bytes.buffer);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVEfmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * ch * 2, true);
    v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * ch * 2, true);
    const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
    let peak = 0;
    for (let i = 0, o = 44; i < n; i++) {
      for (let c = 0; c < ch; c++, o += 2) {
        peak = Math.max(peak, Math.abs(data[c][i]));
        v.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 32767, true);
      }
    }
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { wav: btoa(s), peak };
  };
  const T = {
    async load() {
      T.Sound = (await import('./src/ui/sound.js')).Sound;
    },
    // A sound over `seconds` of states made up for it: step(i, t) is the state at frame i (60 to the second).
    async render(seconds, step, { volume, calm, keep } = {}) {
      const ctx = new OfflineAudioContext(2, Math.ceil(RATE * seconds), RATE);
      const snd = new T.Sound(ctx);
      if (volume) snd.setVolume(volume);
      if (calm) snd.setCalm(true);
      for (let i = 0, n = Math.round(seconds * 60); i < n; i++) snd.update(step(i, i / 60), i / 60);
      const out = pack(await ctx.startRendering());
      if (keep) out.kept = keep(snd);
      return out;
    },
    // The same over the game: it is stepped a sixtieth of a second at a time and each listener (a Sound of its own,
    // heard from the lens, or from where lens(g) puts it) is given the state it makes. before(i, t, g) runs before each
    // step, tweak(state, i, t) may change what a listener is given.
    async drive(seconds, { listeners = [{ name: 'lens' }], on = 1, volume, calm, before, tweak } = {}) {
      const g = window.game;
      const made = listeners.map((l) => {
        const ctx = new OfflineAudioContext(2, Math.ceil(RATE * seconds), RATE);
        const snd = new T.Sound(ctx);
        if (volume) snd.setVolume(volume);
        if (calm) snd.setCalm(true);
        return { ...l, ctx, snd };
      });
      for (let i = 0, n = Math.round(seconds * 60); i < n; i++) {
        const t = i / 60;
        if (before) before(i, t, g);
        g.update(1 / 60);
        for (const L of made) {
          const at = L.lens ? [g.camera.position.clone(), g.camera.quaternion.clone()] : null;
          if (L.lens) L.lens(g, i, t);
          const s = T.Sound.state(g, on);
          if (tweak) tweak(s, i, t, L.name);
          L.snd.update(s, t);
          if (at) {
            g.camera.position.copy(at[0]);
            g.camera.quaternion.copy(at[1]);
            g.camera.updateMatrixWorld(true);
          }
        }
      }
      const out = {};
      for (const L of made) out[L.name] = pack(await L.ctx.startRendering());
      return out;
    },
  };
  return T;
}

// A straight line over the land, from (x, z) along (dx, dz) for len m, that nothing stands on: no trunk or
// building near it, no water, no steep step (2.4 m in 4). Returns whether it is clear.
function clearLine(g, x, z, dx, dz, len, spare = null) {
  const o = g.road.origin;
  const buf = [];
  let was = g.groundAt(x, z);
  for (let d = 0; d <= len; d += 4) {
    const px = x + dx * d;
    const pz = z + dz * d;
    const h = g.groundAt(px, pz);
    if (Math.abs(h - was) > 2.4) return false;
    was = h;
    if (g.land.waterLevel(px + o.x, pz + o.z) - h > 0.3) return false;
    if (g.city.solidAt(px + o.x, h + 1, pz + o.z)) return false;
    g.forest.trunksNear(px + o.x, pz + o.z, 2.5, buf);
    g.props.near(px + o.x, pz + o.z, 2.5, buf);
    for (let k = 0; k < buf.length; k += 3) {
      if (spare && Math.hypot(buf[k] - o.x - spare.x, buf[k + 1] - o.z - spare.z) < 0.5) continue;
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// The routes: each is a function of the page, which returns what was rendered and what happened.
// ---------------------------------------------------------------------------

// The autopilot for 60 s.
async function routeDrive() {
  const T = window.__sound;
  let maxSlip = 0;
  let squeal = 0;
  let cars = 0;
  const slid = [];
  const r = await T.drive(60, {
    listeners: [{ name: 'drive' }],
    tweak: (s, i, t) => {
      if (s.speed > 5) maxSlip = Math.max(maxSlip, s.slip);
      squeal = Math.max(squeal, T.Sound.squeal(s));
      if (s.slip > 0.1047 && slid.length < 12) slid.push([+t.toFixed(2), +s.speed.toFixed(1), +((s.slip * 180) / Math.PI).toFixed(1), +T.Sound.squeal(s).toFixed(2)]);
      cars = Math.max(cars, s.cars.length);
    },
  });
  return { ...r.drive, maxSlip, squeal, slid, cars, bumps: window.game.bumps, lands: window.game.lands };
}

// 10 s on the road at cruise, then 10 s off it at the same speed, straight over the land.
async function routeRoadAndOff() {
  const T = window.__sound;
  const g = window.game;
  for (let i = 0; i < 480; i++) g.update(1 / 60);
  let sum = 0;
  let n = 0;
  const road = await T.drive(10, {
    listeners: [{ name: 'road' }],
    tweak: (s) => {
      sum += s.speed;
      n++;
    },
  });
  // The same speed off the road as it was on it, on average.
  const speed = sum / n;
  // A line off the road that is clear for 260 m, leading a little away from it.
  g.setAuto(false);
  let line = null;
  for (const along of [0, 30]) {
    const p = g.road.at(g.sCar + along);
    if (!p) continue;
    for (const side of [1, -1]) {
      for (const lateral of [12, 16, 22, 30, 40, 55, 70]) {
        for (const turn of [0.05, 0.12, 0.2]) {
          if (line) break;
          const x = p.x + Math.sin(p.theta) * lateral * side;
          const z = p.z - Math.cos(p.theta) * lateral * side;
          const a = p.theta - turn * side;
          if (window.clearLine(g, x, z, Math.cos(a), Math.sin(a), 230)) line = { x, z, a };
        }
      }
    }
  }
  if (!line) return { error: 'no clear line off the road' };
  g.car.reset(line.x, line.z, line.a, g.groundAt(line.x, line.z));
  g.car.vx = speed;
  g.driver.read = () => ({ steer: 0, throttle: Math.max(0, Math.min(1, 0.5 + 0.08 * (speed - g.car.speed))), brake: 0 });
  for (let i = 0; i < 60; i++) g.update(1 / 60);
  let offFrames = 0;
  let airFrames = 0;
  const off = await T.drive(10, {
    listeners: [{ name: 'off' }],
    tweak: (s) => {
      offFrames += s.off;
      airFrames += s.air;
    },
  });
  delete g.driver.read;
  g.setAuto(true);
  return { road: road.road, off: off.off, speed, offSpeed: g.car.speed, offFrames, airFrames, bumps: g.bumps };
}

// A car driven at a trunk at 15 m/s.
async function routeTree() {
  const T = window.__sound;
  const g = window.game;
  g.setAuto(false);
  const o = g.road.origin;
  const buf = [];
  let start = null;
  for (let ds = 40; ds <= 400 && !start; ds += 8) {
    const q = g.road.at(g.sCar + ds);
    if (!q) continue;
    for (const side of [1, -1]) {
      for (let d = 14; d < 60 && !start; d += 4) {
        g.forest.trunksNear(q.x - Math.sin(q.theta) * d * side + o.x, q.z + Math.cos(q.theta) * d * side + o.z, 6, buf);
        for (let k = 0; k < buf.length && !start; k += 3) {
          if (buf[k + 2] < 0.25) continue;
          const tx = buf[k] - o.x;
          const tz = buf[k + 1] - o.z;
          // Coming at it from 45 m off, across the land.
          for (const a of [0.4, 1.2, 2.0, 2.8, 3.6, 4.4, 5.2, 6.0]) {
            const sx = tx - Math.cos(a) * 45;
            const sz = tz - Math.sin(a) * 45;
            if (window.clearLine(g, sx, sz, Math.cos(a), Math.sin(a), 43, { x: tx, z: tz })) {
              start = { x: sx, z: sz, a, r: buf[k + 2] };
              break;
            }
          }
        }
      }
    }
  }
  if (!start) return { error: 'no trunk with a clear way to it' };
  g.car.reset(start.x, start.z, start.a, g.groundAt(start.x, start.z));
  g.car.vx = 15;
  g.driver.read = () => ({ steer: 0, throttle: Math.max(0, Math.min(1, 0.5 + 0.1 * (15 - g.car.speed))), brake: 0 });
  const was = g.bumps;
  let hit = null;
  let kind = null;
  let hard = 0;
  const r = await T.drive(6.5, {
    listeners: [{ name: 'tree' }],
    before: () => { if (hit === null) hard = g.car.speed; },
    tweak: (s, i, t) => {
      if (hit === null && s.bumps > was) {
        hit = t;
        kind = s.bump && s.bump.kind;
      }
    },
  });
  delete g.driver.read;
  g.setAuto(true);
  return { ...r.tree, hit, kind, hard, trunk: start.r };
}

// A car coming the other way, heard from the lens behind the car, and from a lens by the road where it goes by.
async function routeMeet() {
  const T = window.__sound;
  const g = window.game;
  for (let i = 0; i < 480; i++) g.update(1 / 60);
  // The other car: one that comes toward us, put 150 m ahead, at the pace it keeps.
  const other = g.traffic.cars.find((c) => c.dir < 0);
  if (!other) return { error: 'no car coming the other way' };
  other.s = g.sCar + 150;
  other.speed = Math.max(4, g.traffic._limit(other));
  const lane = other.lane;
  // The lens by the road: 5.5 m outside the other car's lane, where it will be in 3 s, looking at the lane.
  const where = g.road.at(other.s - other.speed * 3);
  const out = Math.sign(lane) || -1;
  const lx = where.x - Math.sin(where.theta) * (lane + out * 5.5);
  const lz = where.z + Math.cos(where.theta) * (lane + out * 5.5);
  const place = (q) => ({ x: q.x - Math.sin(q.theta) * lane, z: q.z + Math.cos(q.theta) * lane });
  let near = Infinity;
  let nearAt = 0;
  let crossed = null;
  let was = null;
  const beside = (gg) => {
    gg.camera.position.set(lx, where.y + 1.6, lz);
    gg.camera.lookAt(place(where).x, where.y + 1, place(where).z);
  };
  // Each lens twice, the second time with no other car in what the sound is told, so that what the cars add can be taken from the whole.
  const r = await T.drive(5.5, {
    listeners: [{ name: 'behind' }, { name: 'behindBare' }, { name: 'beside', lens: beside }, { name: 'besideBare', lens: beside }],
    tweak: (s, i, t, name) => {
      if (name.endsWith('Bare')) s.cars = [];
    },
    before: (i, t, gg) => {
      const q = gg.road.at(other.s);
      const at = place(q);
      const d = Math.hypot(lx - at.x, lz - at.z);
      if (d < near) {
        near = d;
        nearAt = t;
      }
      const ahead = other.s - gg.sCar;
      if (was !== null && was > 0 !== ahead > 0 && crossed === null) crossed = t;
      was = ahead;
    },
  });
  return { behind: r.behind, behindBare: r.behindBare, beside: r.beside, besideBare: r.besideBare, near, nearAt, crossed, other: other.speed };
}

// Tyres slid: at 8 m/s on the road, straight for 1.5 s, then the wheel hard over one way and the other, 0.7 s each, which
// keeps the car on the road's platform.
async function routeSqueal() {
  const T = window.__sound;
  const g = window.game;
  g.setAuto(false);
  g.resetToRoad(true);
  g.car.vx = 8;
  let steer = 0;
  g.driver.read = () => ({ steer, throttle: Math.max(0, Math.min(1, 0.4 + 0.1 * (8 - g.car.speed))), brake: 0 });
  let maxSlip = 0;
  let offRoad = 0;
  const r = await T.drive(5, {
    listeners: [{ name: 'slid' }],
    before: (i, t) => { steer = t < 1.5 ? 0 : Math.floor((t - 1.5) / 0.7) % 2 === 0 ? 1 : -1; },
    tweak: (s) => {
      maxSlip = Math.max(maxSlip, s.slip);
      offRoad += s.off;
    },
  });
  delete g.driver.read;
  g.setAuto(true);
  return { ...r.slid, maxSlip, offRoad };
}

// The valley, seed 7: the state the game gives the sound with the lens by the river (on its bridge) and with it 700 m from the
// water, each held for 8 s of a drive at 22 m/s, and rendered.
async function routeRiver() {
  const T = window.__sound;
  const g = window.game;
  const out = {};
  for (const [name, s] of [['far', 3000], ['near', 4500]]) {
    const p = g.road.at(s);
    g.autoMode = true;
    g.sCar = s;
    g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(s, 1.9) + 0.3);
    g.car.vx = 22;
    for (let i = 0; i < 90; i++) {
      g.pilot.vMax = 22;
      g.update(1 / 60);
    }
    const st = T.Sound.state(g);
    out[name] = {
      state: { a: st.a, b: st.b, blend: st.blend, water: { near: st.water.near, shoal: st.water.shoal }, dist: g.valley.water.dist },
      ...(await T.render(8, (i, t) => ({
        speed: 22, throttle: 0.3, lift: 1, a: st.a, b: st.b, blend: st.blend, inside: 0, distance: 8, on: 1, air: 0, time: t, water: st.water,
      }))),
    };
  }
  return out;
}

// The drive with the sound off.
async function routeMute() {
  const r = await window.__sound.drive(10, { listeners: [{ name: 'mute' }], on: 0 });
  return r.mute;
}

// Everything made up for the sound alone, in one go (each a render of states).
async function routeMadeUp() {
  const T = window.__sound;
  const out = {};
  const cruise = (extra = {}) => (i, t) => ({
    speed: 22, throttle: 0.3, lift: 1, a: 1, b: 1, blend: 0, inside: 0, distance: 8, on: 1, air: 0, time: t, ...extra,
  });
  const still = (extra = {}) => (i, t) => ({
    speed: 0, throttle: 0, lift: 0, a: 10, b: 10, blend: 0, inside: 0, distance: 8, on: 1, air: 0, time: t, ...extra,
  });
  // Everything at once, at the top of the slider.
  const stress = (i, t) => ({
    speed: 28, throttle: 1, lift: 1, a: 7, b: 7, blend: 0, inside: 0, distance: 6, on: 1, air: 0, off: 1, slip: 0.3, slide: 6, time: t,
    strikes: t > 3 ? 1 + Math.floor((t - 3) / 1.5) : 0,
    lands: t > 3 ? 1 + Math.floor((t - 3) / 1.1) : 0,
    landForce: 14,
    bumps: t > 3 ? 1 + Math.floor((t - 3) / 0.9) : 0,
    bump: { kind: ['tree', 'wall', 'car', 'soft'][Math.floor(t / 0.9) % 4], speed: 40, pan: 0 },
    lens: [1, 0, 0],
    cars: [-1, 0, 1].map((k, j) => ({ id: j + 1, dx: k * 3, dy: 0, dz: 6 + j * 4, speed: 20 })),
  });
  out.stress = await T.render(14, stress, { volume: { master: 1.25, car: 1, ambient: 1 } });
  // The hits, each at 25 m/s, 3 s apart, in a cruise.
  const kinds = ['tree', 'wall', 'car', 'soft'];
  out.hits = await T.render(14, (i, t) => {
    const n = Math.min(4, Math.max(0, Math.floor((t - 1.5) / 3) + 1));
    return cruise({ bumps: n, bump: { kind: kinds[Math.max(0, n - 1)], speed: 25, pan: 0 } })(i, t);
  });
  out.hitsNone = await T.render(14, cruise());
  // A hit to the right, and one to the left.
  out.sides = await T.render(6, (i, t) => cruise({ bumps: t >= 1.5 ? 1 + (t >= 4 ? 1 : 0) : 0, bump: { kind: 'tree', speed: 20, pan: t >= 4 ? -0.7 : 0.7 } })(i, t));
  // The ground, 22 m/s, in the hills, the desert and the cavern, off the road and on it.
  for (const [name, world] of [['grass', 1], ['sand', 4], ['gravel', 6]]) {
    out[`${name}Off`] = await T.render(8, cruise({ a: world, b: world, off: 1 }));
    out[`${name}On`] = await T.render(8, cruise({ a: world, b: world, off: 0 }));
  }
  // Gravel at three speeds, and in the air.
  for (const speed of [15, 22, 30]) out[`gravel${speed}`] = await T.render(6, cruise({ a: 6, b: 6, off: 1, speed }));
  out.gravelAir = await T.render(6, cruise({ a: 6, b: 6, off: 1, air: 1 }));
  // The squeal: slip of 3, 5, 7, 9 and 12 degrees, 2 s each, at 8 m/s with the wheels down; with the tremble, without it, and in the air.
  const slide = (extra = {}) => (i, t) => {
    const d = ([3, 5, 7, 9, 12][Math.min(4, Math.floor(t / 2))] * Math.PI) / 180;
    return cruise({ speed: 8, lift: 0, slip: d, slide: 8 * Math.sin(d), ...extra })(i, t);
  };
  out.squeal = await T.render(10, slide());
  out.squealCalm = await T.render(10, slide(), { calm: true });
  out.squealAir = await T.render(10, slide({ air: 1 }));
  // A car going by: in the next lane of a lens behind the car (it keeps to one side), and across the road from a lens (it crosses).
  const pass = (dx, dz) => (i, t) => still({ lens: [1, 0, 0], cars: [{ id: 7, dx: dx(t), dy: 0, dz: dz(t), speed: 13 }] })(i, t);
  out.passNext = await T.render(4, pass(() => -3.8, (t) => 60 - 35 * t));
  out.passAcross = await T.render(4, pass((t) => 40 - 25 * t, () => 6));
  // The hum of a car going by 3.8 m to the left at 16 m/s, alone and without it; and more cars than voices.
  const hum = (cars) => (i, t) => still({ lens: [1, 0, 0], cars: cars(t) })(i, t);
  out.humNone = await T.render(10, hum(() => []));
  out.humCar = await T.render(10, hum((t) => [{ id: 7, dx: -3.8, dy: 0, dz: 80 - 16 * t, speed: 13 }]));
  out.humMany = await T.render(4, hum(() => [1, 2, 3, 4, 5].map((id) => ({ id, dx: -4 + id, dy: 0, dz: 10 + id * 3, speed: 13 }))),
    { keep: (snd) => snd.voices.filter((v) => v.id !== -1).length });
  // The river's world (2), the lens on the water, at a shoal, and out of hearing of it.
  out.riverNear = await T.render(8, cruise({ a: 2, b: 2, water: { near: 1, shoal: 0 } }));
  out.riverShoal = await T.render(8, cruise({ a: 2, b: 2, water: { near: 1, shoal: 1 } }));
  out.riverFar = await T.render(8, cruise({ a: 2, b: 2, water: { near: 0, shoal: 0 } }));
  out.riverHalf = await T.render(8, cruise({ a: 2, b: 2, water: { near: 0.25, shoal: 0 } }));
  // Off: no sound at all, whatever happens.
  out.mute = await T.render(4, cruise({ on: 0, off: 1, slip: 0.3, slide: 6, bumps: 1, bump: { kind: 'wall', speed: 30, pan: 0 }, lands: 1, landForce: 14 }));
  return out;
}

// ---------------------------------------------------------------------------
// The check.
// ---------------------------------------------------------------------------
async function check() {
  const failures = [];
  const say = (ok, text) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
    if (!ok) failures.push(text);
  };
  // Each part on its own: one that goes wrong is a failure, and the rest are still measured.
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      say(false, `${name}: ${e.message}`);
    }
  };
  const f1 = (x) => x.toFixed(1);
  const keep = (name, r) => writeFileSync(`${ROOT}out/sound-demo-${name}.wav`, Buffer.from(r.wav, 'base64'));
  const baseline = JSON.parse(readFileSync(new URL('./sound_baseline.json', import.meta.url), 'utf8'));
  // A peak is held to -1 dBFS, before it is cut to 16 bits.
  const quiet = (name, r) => say(db(r.peak) <= -1, `${name}: the loudest sample is ${f1(db(r.peak))} dBFS (${r.peak.toFixed(3)} of full scale; at most -1 dBFS)`);
  const prime = `window.clearLine = ${clearLine}; window.__sound = (${toolkit})(); window.__sound.load().then(() => true)`;
  const run = (page, fn) => page.ev(`(${fn})()`);
  const open = async () => {
    const page = await openPage('seed=7&world=hills&cam=chase&run=1');
    await until(page);
    await page.ev(prime);
    return page;
  };
  const rmsOf = (w) => 10 * Math.log10(w.data.reduce((s, d) => s + d.reduce((a, b) => a + b * b, 0), 0) / (w.n * w.ch));

  // The autopilot's 60 s of the hills.
  await step('the autopilot drive', async () => {
    const page = await open();
    try {
      const r = await run(page, routeDrive);
      keep('drive', r);
      const w = readWav(r.wav);
      const rms = rmsOf(w);
      quiet('the autopilot for 60 s in the hills', r);
      say(rms >= -24 && rms <= -16, `its rms is ${f1(rms)} dBFS (between -24 and -16)`);
      const b = baseline.drive;
      say(Math.abs(rms - b.rms) <= 2, `and ${f1(rms - b.rms)} dB from ${f1(b.rms)} dBFS, the drive's own sound without the ground, the squeal, the hits and the other cars (within 2 dB)`);
      say(r.bumps === 0, `no hit in the drive (${r.bumps} hits, ${r.cars} cars within 60 m of the lens at most, ${r.lands} landings)`);
      // (A bend the autopilot goes round at the edge of its tyres is heard: the tyres slip past 6 degrees and squeal.)
      console.log(`     (the tyres slip ${f1((r.maxSlip * 180) / Math.PI)} degrees at the most above 5 m/s, and squeal ${r.squeal.toFixed(2)} of 1.7 at the most${r.slid.length ? `; from ${r.slid[0][0]} s at ${r.slid[0][1]} m/s` : ''})`);
    } finally {
      await page.close();
    }
  });

  // The short drives, in a page of their own.
  await step('the short drives', async () => {
    const page = await open();
    try {
      await step('road and off', async () => {
        const ro = await run(page, routeRoadAndOff);
        if (ro.error) return say(false, ro.error);
        keep('road', ro.road);
        keep('off', ro.off);
        const a = readWav(ro.road.wav);
        const b = readWav(ro.off.wav);
        quiet('10 s on the road', ro.road);
        quiet('10 s off it', ro.off);
        const lo = level(a.mono, a.rate, 1, 10, 1000, 4000);
        const hi = level(b.mono, b.rate, 1, 10, 1000, 4000);
        say(ro.offFrames >= 540 && ro.airFrames <= 200, `the car is off the road's platform for ${ro.offFrames} of 600 frames and in the air for ${ro.airFrames}, at ${f1(ro.speed)} m/s on the road, on average, and ${f1(ro.offSpeed)} m/s at the end of it off the road`);
        say(hi - lo >= 6, `off the road 10 s are ${f1(hi - lo)} dB louder between 1 and 4 kHz than on it (${f1(hi)} against ${f1(lo)} dBFS; at least 6 dB)`);
        // (The car comes down from the air more often off the road, and the landings are loud: the whole is louder than the ground makes it.)
        console.log(`     (${f1(level(b.mono, b.rate, 1, 10) - level(a.mono, a.rate, 1, 10))} dB louder in all, with ${ro.airFrames} frames in the air)`);
      });

      await step('a trunk', async () => {
        const tree = await run(page, routeTree);
        if (tree.error) return say(false, tree.error);
        keep('tree', tree);
        const w = readWav(tree.wav);
        quiet('a trunk hit at 15 m/s', tree);
        say(tree.hit !== null && tree.kind === 'tree', `the game counts the hit and says what it is: a ${tree.kind} at ${tree.hit === null ? 'never' : f1(tree.hit) + ' s'} (the car at ${f1(tree.hard)} m/s)`);
        if (tree.hit === null) return;
        // The hit is heard from the frame it is counted in.
        const t0 = tree.hit;
        const after = level(w.mono, w.rate, t0, t0 + 0.2, 60, 200);
        const before = level(w.mono, w.rate, t0 - 0.2, t0, 60, 200);
        say(after - before >= 10, `in the 0.2 s of the hit 60 to 200 Hz is ${f1(after - before)} dB louder than in the 0.2 s before (${f1(after)} against ${f1(before)} dBFS; at least 10 dB)`);
      });

      await step('a car coming the other way', async () => {
        const meet = await run(page, routeMeet);
        if (meet.error) return say(false, meet.error);
        keep('meet-behind', meet.behind);
        keep('meet-beside', meet.beside);
        quiet('a car coming the other way, heard from behind the car', meet.behind);
        quiet('...and from beside the road', meet.beside);
        // What the other car adds: the sound with it less the sound with no car in it.
        const wb = subtract(readWav(meet.behind.wav), readWav(meet.behindBare.wav));
        const ws = subtract(readWav(meet.beside.wav), readWav(meet.besideBare.wav));
        // The loud of it: where the 300 to 3000 Hz band is within 12 dB of its top, round the time the lens is nearest.
        const bb = meet.crossed === null ? null : balance(wb, Math.max(0, meet.crossed - 0.8), meet.crossed + 1);
        const bs = balance(ws, Math.max(0, meet.nearAt - 0.8), meet.nearAt + 1);
        console.log(`     (the two cars cross at ${meet.crossed === null ? 'never' : f1(meet.crossed) + ' s'}; the other is nearest the lens by the road at ${f1(meet.nearAt)} s, ${f1(meet.near)} m off)`);
        say(!!bs && bs.flips === 1 && bs.to - bs.from <= 0.6, bs ? `going by across the road, the left and right of its sound change over once, in ${(bs.to - bs.from).toFixed(2)} s: from ${bs.first.toFixed(2)} to ${bs.last.toFixed(2)} (1 is all in the left ear)` : 'a car going by across the road is heard going by');
        say(!!bb && bb.flips === 0, bb ? `going by in the next lane of a lens behind the car, it keeps to its side: ${bb.first.toFixed(2)} to ${bb.last.toFixed(2)}, ${bb.mid.toFixed(2)} at the nearest, and does not change over` : 'a car going by in the next lane is heard going by');
      });

      await step('tyres slid', async () => {
        const sq = await run(page, routeSqueal);
        if (sq.error) return say(false, sq.error);
        keep('squeal', sq);
        const w = readWav(sq.wav);
        quiet('the tyres slid at 8 m/s', sq);
        const slid = level(w.mono, w.rate, 3.0, 5.0, 550, 1250);
        const straight = level(w.mono, w.rate, 0.5, 1.5, 550, 1250);
        say(sq.maxSlip > 0.1047, `the car's tyres slip ${f1((sq.maxSlip * 180) / Math.PI)} degrees at most (past 6), ${sq.offRoad} of 300 frames off the road`);
        say(slid - straight >= 6, `and 550 to 1250 Hz is ${f1(slid - straight)} dB louder sliding than going straight (at least 6 dB)`);
      });

      await step('the sound off', async () => {
        const mu = await run(page, routeMute);
        keep('mute', mu);
        say(mu.peak === 0, `the sound off for 10 s of the drive: every sample is 0 (the loudest is ${mu.peak})`);
      });
    } finally {
      await page.close();
    }
  });

  // The valley: the river heard from the lens by it, and not heard 700 m from it.
  await step('the river', async () => {
    const page = await openPage('seed=7&world=river&s=3000&cam=chase&run=1');
    let r;
    try {
      await until(page);
      await page.ev(prime);
      r = await run(page, routeRiver);
    } finally {
      await page.close();
    }
    keep('river-far', r.far);
    keep('river-near', r.near);
    quiet('the drive 700 m from the river', r.far);
    quiet('the drive on the river\'s bridge', r.near);
    const far = readWav(r.far.wav);
    const near = readWav(r.near.wav);
    say(r.far.state.water.near === 0 && r.near.state.water.near >= 0.55, `the game's state has the river at ${r.near.state.water.near.toFixed(2)} on the bridge (${f1(r.near.state.dist)} m from the water) and at ${r.far.state.water.near.toFixed(2)} 700 m off (${f1(r.far.state.dist)} m)`);
    const gain = level(near.mono, near.rate, 1, 8, 600, 1500) - level(far.mono, far.rate, 1, 8, 600, 1500);
    say(gain >= 6, `the drive by the river is ${f1(gain)} dB louder between 600 and 1500 Hz than the drive 700 m from it (at least 6 dB)`);
  });

  // What is made up for the sound alone.
  await step('the made-up states', async () => {
    const page = await open();
    let r;
    try {
      r = await run(page, routeMadeUp);
    } finally {
      await page.close();
    }
    for (const [name, v] of Object.entries(r)) keep(`made-${name}`, v);
    const W = (name) => readWav(r[name].wav);

    await step('the limiter', async () => {
      quiet('everything at once, at the top of the slider', r.stress);
    });

    await step('the hits', async () => {
      const h = W('hits');
      // What each hit adds to the cruise, by itself: how long it rings, where its weight is, how loud it is at first.
      const only = subtract(h, W('hitsNone'));
      const hit = ['tree', 'wall', 'car', 'soft'].map((kind, k) => {
        const t0 = 1.5 + 3 * k;
        return {
          kind,
          gain: level(h.mono, h.rate, t0, t0 + 0.2, 60, 200) - level(h.mono, h.rate, t0 - 0.2, t0, 60, 200),
          ring: ringing(only.mono, h.rate, t0, 60, 400),
          weight: centroid(only.mono, h.rate, t0, t0 + 0.4),
          loud: level(only.mono, h.rate, t0, t0 + 0.1),
        };
      });
      const [tree, wall, car, soft] = hit;
      say(tree.gain >= 10, `a trunk at 25 m/s: its 0.2 s are ${f1(tree.gain)} dB louder at 60 to 200 Hz than the 0.2 s before`);
      say(wall.ring > tree.ring && car.ring > tree.ring, `a wall (${wall.ring.toFixed(2)} s) and a car (${car.ring.toFixed(2)} s) ring longer than a trunk (${tree.ring.toFixed(2)} s)`);
      say(wall.weight > tree.weight && car.weight > wall.weight, `...and are brighter: the weight of their sound is at ${Math.round(wall.weight)} Hz (wall) and ${Math.round(car.weight)} Hz (car) against ${Math.round(tree.weight)} Hz (trunk)`);
      say(soft.loud < tree.loud - 1.5, `an animal is softer than a trunk: ${f1(soft.loud)} against ${f1(tree.loud)} dBFS in the first 0.1 s`);
      const s = W('sides');
      const lr = (t0, t1) => level(s.data[0], s.rate, t0, t1, 60, 4000) - level(s.data[1], s.rate, t0, t1, 60, 4000);
      say(lr(1.5, 1.9) < -3 && lr(4, 4.4) > 3, `a hit put to the right is ${f1(-lr(1.5, 1.9))} dB louder in the right ear, one put to the left ${f1(lr(4, 4.4))} dB louder in the left`);
    });

    await step('the grounds', async () => {
      const diff = (name) => level(W(`${name}Off`).mono, 32000, 1, 8, 1000, 4000) - level(W(`${name}On`).mono, 32000, 1, 8, 1000, 4000);
      say(diff('grass') >= 6 && diff('sand') >= 6 && diff('gravel') >= 6, `off the road at 22 m/s each ground is over 6 dB louder between 1 and 4 kHz: grass ${f1(diff('grass'))}, sand ${f1(diff('sand'))}, gravel ${f1(diff('gravel'))} dB`);
      // How much duller than bright a ground is: what it adds at 200 to 1000 Hz less what it adds at 1 to 4 kHz.
      const dull = (name) => {
        const on = W(`${name}On`);
        const off = W(`${name}Off`);
        return level(off.mono, 32000, 1, 8, 200, 1000) - level(on.mono, 32000, 1, 8, 200, 1000) - (level(off.mono, 32000, 1, 8, 1000, 4000) - level(on.mono, 32000, 1, 8, 1000, 4000));
      };
      say(dull('sand') > dull('grass') + 3, `sand is duller than grass: it adds ${f1(dull('sand'))} dB more at 200 to 1000 Hz than at 1 to 4 kHz, grass ${f1(dull('grass'))} dB`);
      const c = [15, 22, 30].map((v) => clicks(W(`gravel${v}`).mono, 32000, 1, 6));
      say(c.every((x) => x >= 20 && x <= 60) && c[0] < c[1] && c[1] < c[2], `gravel has ${c.map((x) => f1(x)).join(', ')} clicks a second at 15, 22 and 30 m/s (20 to 60, more as it goes faster)`);
      const air = level(W('gravelAir').mono, 32000, 1, 6, 1000, 4000) - level(W('gravelOn').mono, 32000, 1, 6, 1000, 4000);
      say(air < 2, `and in the air there is none of it: ${f1(air)} dB over the road between 1 and 4 kHz`);
    });

    await step('the squeal', async () => {
      const q = W('squeal');
      const steps = [0, 1, 2, 3, 4].map((k) => level(q.mono, q.rate, k * 2 + 0.5, k * 2 + 2, 550, 1250));
      // (The first 2 s are the air of the world coming up, so the 5 degrees are what 3 are held to, and what 9 and 12 are measured against.)
      say(steps[3] > steps[1] + 4 && steps[4] > steps[3] && Math.abs(steps[1] - steps[0]) < 3, `tyres squeal past 6 degrees and louder with the slide: 550 to 1250 Hz at 3, 5, 7, 9 and 12 degrees is ${steps.map((x) => f1(x)).join(', ')} dBFS`);
      const trem = (name) => swing(track(W(name).mono, 32000, 500, 1300, 0.02, 0.005, 8.2, 9.9), 0.005);
      const free = trem('squeal');
      const calm = trem('squealCalm');
      say(Math.abs(free.hz - 6) <= 0.5 && free.peak > 3 * free.median, `the squeal has a tremble of 6 Hz: its swell peaks at ${free.hz} Hz, ${f1(free.peak / free.median)} times the median of the others`);
      say(!(Math.abs(calm.hz - 6) <= 0.5 && calm.peak > 3 * calm.median), `...and has none when the lens is not to shake: its swell peaks at ${calm.hz} Hz, ${f1(calm.peak / calm.median)} times the median`);
      const flown = level(W('squealAir').mono, 32000, 8.5, 10, 550, 1250) - level(W('squealAir').mono, 32000, 2.5, 4, 550, 1250);
      say(flown < 1.5, `in the air tyres are quiet: at 12 degrees only ${f1(flown)} dB over the 5 (on the ground it is ${f1(steps[4] - steps[1])} dB)`);
    });

    await step('a car going by', async () => {
      for (const [name, text] of [['passNext', 'in the next lane'], ['passAcross', 'across the road']]) {
        const w = W(name);
        const b = balance(w, 1, 2.5);
        if (!b) {
          say(false, `a car going by ${text} is heard going by`);
          continue;
        }
        const open = centroid(w.mono, w.rate, b.from - 0.01, b.from + 0.15, 200, 3000);
        const close = centroid(w.mono, w.rate, b.to - 0.15, b.to + 0.01, 200, 3000);
        console.log(`     (${text}: ${f1(b.top)} dB at its loudest, ${b.from.toFixed(2)} to ${b.to.toFixed(2)} s, balance ${b.first.toFixed(2)}, ${b.mid.toFixed(2)}, ${b.last.toFixed(2)})`);
        if (name === 'passAcross') say(b.flips === 1 && b.to - b.from <= 0.6, `a car going by across the lens puts its sound from one side to the other once, in ${(b.to - b.from).toFixed(2)} s`);
        else say(b.flips === 0, `a car going by in the next lane keeps to its side (${b.first.toFixed(2)} to ${b.last.toFixed(2)})`);
        // (A band that goes from 1.6 to 0.7 of its centre at 40 m/s of closing, and by less when the two close more slowly: 35 m/s in the next lane, 25 across the road.)
        const slid = open / close;
        say(slid >= (name === 'passNext' ? 1.4 : 1.1), `...and its band slides down as it passes: ${Math.round(open)} to ${Math.round(close)} Hz, ${f1(slid)} times`);
      }
    });

    await step('the hum of other cars', async () => {
      const none = W('humNone');
      const withCar = W('humCar');
      const hum = (t) => {
        const p = (x) => level(x, 32000, t, t + 1, 50, 300);
        return 10 * Math.log10(Math.max(10 ** (p(withCar.mono) / 10) - 10 ** (p(none.mono) / 10), 1e-12));
      };
      // 80 - 16 t m ahead: 80 m off at 0 s, 32 m at 3 s, 16 m at 4 s.
      const far = hum(0);
      const mid = hum(3);
      const near = hum(4);
      say(far < mid - 10 && mid < near, `another car hums louder the nearer it comes: ${f1(far)} dBFS at 80 m, ${f1(mid)} at 32 m, ${f1(near)} at 16 m`);
      // The car's own hum in each ear, the drive's without it taken off.
      const ear = (c, t) => 10 ** (level(withCar.data[c], 32000, t, t + 1, 50, 300) / 10) - 10 ** (level(none.data[c], 32000, t, t + 1, 50, 300) / 10);
      const side = (t) => 10 * Math.log10(Math.max(ear(0, t), 1e-12) / Math.max(ear(1, t), 1e-12));
      say(side(4) > 3 && side(6) > 1, `and from the side it is on: ${f1(side(4))} dB louder in the left ear from 16 m to 0, ${f1(side(6))} dB after it has gone by`);
      say(r.humMany.kept === 3, `five cars near, three hum (${r.humMany.kept} voices)`);
    });

    await step('the river', async () => {
      const lv = (name) => level(W(name).mono, 32000, 1, 8, 600, 1500);
      quiet('the lens on the water', r.riverShoal);
      say(lv('riverNear') - lv('riverFar') >= 6, `the lens on the water is ${f1(lv('riverNear') - lv('riverFar'))} dB louder between 600 and 1500 Hz than out of hearing of it (at least 6 dB)`);
      say(lv('riverNear') > lv('riverHalf') && lv('riverHalf') > lv('riverFar'), `...and louder the nearer it is: ${f1(lv('riverFar'))}, ${f1(lv('riverHalf'))}, ${f1(lv('riverNear'))} dBFS out of hearing, at a quarter of the way and on the water`);
      const hi = (name) => level(W(name).mono, 32000, 1, 8, 1800, 3500);
      say(hi('riverShoal') - hi('riverNear') >= 3 && lv('riverShoal') >= lv('riverNear'), `at a shoal it is louder, and brighter: ${f1(hi('riverShoal') - hi('riverNear'))} dB more between 1.8 and 3.5 kHz, ${f1(lv('riverShoal') - lv('riverNear'))} dB more between 600 and 1500 Hz`);
    });

    await step('the sound off', async () => {
      say(r.mute.peak === 0, 'the sound off, with a hit, a landing and a slide in it: every sample is 0');
    });
  });

  if (failures.length) {
    console.error(`\nFAILED: ${failures.length} check(s)`);
    await finish(1);
  }
  console.log('\nOK: the sound is held to its numbers');
  await finish(0);
}

if (CHECK) await check();
else await legacy();
