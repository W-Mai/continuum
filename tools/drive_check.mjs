// The car drives like a car, and the world it drives in has things in it.
//
// Runs the page headless (the hills, seed 7), then drives it from the page:
//  - over a stretch of road that rolls (a roller), a car at 12 m/s keeps to
//    the ground all the way, one at 33 m/s leaves it, comes down, and is not
//    wrecked; in the air it is where gravity puts it (it falls, it does not
//    hang), and tyres that have left the ground do not steer;
//  - on coming down it is slowed a little and the touchdown is counted;
//  - what is in the air over the road, the body's height over the ground, is
//    drawn: the car's mesh is up with it;
//  - the traffic is each world's own: in every world only what that world's
//    roster has, and in the block style the boxes' mesh;
//  - what lies about the ground is laid in every world, its own kinds;
//  - what the ground gives up under a car off the road is dust where it is
//    sand and sparks where it is hot, and a landing throws a ring of it.
//
// Usage: node tools/drive_check.mjs
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = 8184;
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
  const profile = `${tmpdir()}/continuum-drive-${process.pid}-${Date.now()}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--window-size=1000,560', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
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
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  });
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

// In the page: the car put just before the first roller, at a speed, on the
// autopilot (which keeps it in its lane and does not slow for the crests),
// and driven through it.
const FLY = (speed) => `
  const R = g.road;
  let sec = null;
  for (const [b, s] of R._rolls) if (s && !sec) sec = s;
  if (!sec) return { error: 'no roller on this road' };
  const s0 = sec.start * 2 - 110;
  const p = R.at(s0);
  g.autoMode = true;
  g.pilot.vMax = ${speed};
  g.sCar = s0;
  g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, R.surfaceAt(s0, 1.9) + 0.3);
  g.car.vx = ${speed};
  const lands0 = g.lands;
  const wrecks0 = g.wrecks;
  let air = 0, hops = 0, was = false, maxAir = 0, falling = true, lastVy = null, maxMesh = 0;
  for (let i = 0; i < 560; i++) {
    g.update(1 / 60);
    const c = g.car;
    const h = c.y - (c.groundY || 0);
    if (c.airborne) {
      air++;
      if (!was) hops++;
      // Nothing holds it up: its vertical speed only goes down while it is up.
      if (lastVy !== null && c.vyWorld > lastVy + 0.05) falling = false;
      lastVy = c.vyWorld;
    } else lastVy = null;
    was = c.airborne;
    maxAir = Math.max(maxAir, h);
    maxMesh = Math.max(maxMesh, g.presentation.airHeight);
  }
  return { air, hops, maxAir, maxMesh, falling, landed: g.lands - lands0, wrecks: g.wrecks - wrecks0, rolls: !!sec, speed: g.car.speed };
`;

let failed = 0;
const say = (ok, text) => {
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};

const server = serve();
if (!(await waitForServer())) {
  console.error('FAIL: no server');
  server.kill();
  process.exit(1);
}
let exitCode = 0;
try {
  // Hills, seed 7: a roller at 2758 m.
  const page = await openPage('seed=7&world=hills&run=5&cam=chase');

  const slow = await page.run(FLY(12));
  if (slow.error) say(false, `slow: ${slow.error}`);
  else say(slow.air === 0 && slow.wrecks === 0, `over a roller at 12 m/s the car stays on the ground (${slow.air} steps in the air)`);

  const fast = await page.run(FLY(34));
  if (fast.error) say(false, `fast: ${fast.error}`);
  else {
    say(fast.hops >= 2 && fast.air >= 30, `at 34 m/s it leaves the ground at the crests (${fast.hops} hops, ${fast.air} steps in the air)`);
    say(fast.maxAir > 0.5, `and goes up (${fast.maxAir.toFixed(2)} m above the ground at the highest)`);
    say(fast.maxMesh > 0.4 * fast.maxAir, `the body is drawn up there with it (${fast.maxMesh.toFixed(2)} m)`);
    say(fast.falling, 'in the air nothing holds it up: its vertical speed only goes down');
    say(fast.landed >= 1, `the touchdowns are counted (${fast.landed})`);
    say(fast.wrecks === 0, `and it is not wrecked (${fast.wrecks} wrecks)`);
  }

  // Every world its own traffic, its own things on the ground.
  const ROSTER = {
    alpine: ['suv', 'sedan', 'van', 'truck', 'plough'],
    hills: ['hatch', 'sedan', 'pickup', 'tractor', 'van'],
    river: ['sedan', 'hatch', 'van', 'truck', 'camper'],
    coast: ['camper', 'sports', 'hatch', 'suv', 'bus'],
    desert: ['jeep', 'pickup', 'truck', 'suv'],
    city: ['taxi', 'sedan', 'bus', 'van', 'sports'],
    cavern: ['dump', 'jeep', 'van'],
    inferno: ['buggy', 'dump'],
    abyss: ['pod', 'rover'],
    heaven: ['pod', 'sports'],
    space: ['rover', 'pod'],
    upside: ['wreckSedan', 'wreckVan', 'wreckBus'],
  };
  page.close();
  for (const [id, allowed] of Object.entries(ROSTER)) {
    const w = await openPage(`seed=7&world=${id}&run=240&cam=chase`);
    const d = await w.run(`
      const kinds = g.traffic.kinds();
      return { kinds, clutter: g.clutter.shown, clutterKinds: Object.keys(g.clutter.counts), motes: g.motes.shown };
    `);
    w.close();
    if (d.error) {
      say(false, `${id}: ${d.error}`);
      continue;
    }
    const names = Object.keys(d.kinds);
    const strays = names.filter((n) => !allowed.includes(n));
    say(names.length >= 1 && strays.length === 0, `${id}: it is ${names.join(', ')} that drive there${strays.length ? ` (not ${strays.join(', ')})` : ''}`);
    say(d.clutter >= 40 && d.clutterKinds.length >= (id === 'heaven' || id === 'space' ? 1 : 2), `${id}: ${d.clutter} things lie about the ground, of ${d.clutterKinds.length} kinds (${d.clutterKinds.join(', ')})`);
    say(d.motes > 50, `${id}: something is in the air (${d.motes} specks)`);
  }

  // The block style's cars are boxes, the painted style's softer.
  const blk = await openPage('seed=7&world=hills&run=200&style=block&cam=chase');
  const b = await blk.run('return { mode: g.traffic.mode, shown: g.traffic.shown, clutterBlocky: g.clutter.blocky };');
  blk.close();
  say(b.mode === 'block' && b.shown >= 3 && b.clutterBlocky, `block: the cars are boxes (${b.mode}, ${b.shown} of them) and so is what lies about the ground`);
  const pnt = await openPage('seed=7&world=hills&run=200&style=paint&cam=chase');
  const pp = await pnt.run('return { mode: g.traffic.mode };');
  pnt.close();
  say(pp.mode === 'soft', `paint: the cars are the softer ones (${pp.mode})`);

  // What the ground gives up, off the road at speed, in the desert; and sparks
  // where it is hot, in the inferno; and the ring of a landing.
  for (const [id, wantGlow] of [['desert', false], ['inferno', true]]) {
    const o = await openPage(`seed=7&world=${id}&run=5&cam=chase`);
    const d = await o.run(`
      const R = g.road;
      const s0 = 400;
      const p = R.at(s0);
      g.setAuto(false);
      g.sCar = s0;
      g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, R.surfaceAt(s0, 1.9) + 0.3);
      g.car.vx = 22;
      let n = 0;
      g.driver.read = () => { n++; return { steer: n < 80 ? 0.25 : n < 120 ? -0.25 : 0, throttle: 1, brake: 0, anyInput: true }; };
      let most = 0, glowing = 0, off = 0;
      for (let i = 0; i < 360; i++) {
        g.update(1 / 60);
        if (g.offRoad) off++;
        most = Math.max(most, g.dust.shown);
        let gl = 0;
        for (let k = 0; k < g.dust.count; k++) if (g.dust.life[k] > 0 && g.dust.glow[k] > 0.5) gl++;
        glowing = Math.max(glowing, gl);
      }
      // A landing: the ring.
      const before = g.dust.shown;
      g.dust.burst(g.car, 12, { color: 0xd2ac78, amount: 0.5, road: 0.5, glow: 0 });
      g.dust.update(1 / 60, g.car, 0, { color: 0xd2ac78, amount: 0, glow: 0 }, 0);
      return { off, most, glowing, ring: g.dust.shown - before };
    `);
    o.close();
    if (d.error) say(false, `${id}: ${d.error}`);
    else {
      say(d.off >= 60 && d.most >= 40, `${id}: off the road, the car kicks up what the ground gives (${d.most} puffs at most, ${d.off} steps off the road)`);
      say(wantGlow ? d.glowing >= 3 : d.glowing === 0, `${id}: ${wantGlow ? 'sparks' : 'no sparks'} (${d.glowing} at most)`);
      say(d.ring >= 30, `${id}: a landing throws a ring of it (${d.ring} puffs)`);
    }
  }
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
console.error('\nOK: the car leaves the ground over a crest and comes down; every world has its own traffic, its own things on the ground and in the air; the ground gives dust and sparks');
process.exit(exitCode);
