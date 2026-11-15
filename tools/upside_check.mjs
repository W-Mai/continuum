// The Upside Down (render/upside.js, render/turn.js).
//
// Runs the page headless in the shortened loop that goes from space into it
// (worlds 1500 m long), drives it from the page, and asserts:
//  - the world is there, last in the list, and its look is its own;
//  - the way in is a corkscrew in the world: the road is wound a half turn
//    over 200 m of it, by where each point stands along it and not by where
//    the lens is, so from before it the road ahead is seen going over; the
//    road under the car is drawn under the car all the way through, and
//    what is far ahead holds still on the screen while the car goes over;
//  - the view rolls with the car, by where it is and not by the clock: the
//    same at 22 m/s and at 40, quickest in the middle, a half turn at the end
//    (a hair past it first), and a car that stops half way stays on its side;
//    on its side the car is still near the middle of the screen and the field
//    of view is wider; in it the sky is at the bottom and the wheel is turned
//    the other way;
//  - the frustum test is off only while the winding is near;
//  - the way out winds on the same way round, to a whole turn, and gives the
//    wheel back; a car put down inside is inside at once;
//  - in it there is lightning (a flash lights the sky) and things that
//    stand by the road and lean toward the car;
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
async function openPage(query) {
  const profile = `${tmpdir()}/continuum-upside-${process.pid}-${Date.now()}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--window-size=960,540', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
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

// In the page: how far over the road is wound at places along it (m from
// the middle of the corkscrew), as the world has it.
const WOUND = (mid, offsets) => `
  const u = g.upside;
  return { zone: u.zone && { s: u.zone.s, len: u.zone.len }, twisted: u.twisted, off: u._culled.size,
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

    const before = await page.run(AT(found.s0 - 150));
    check(Math.abs(before.roll) < 0.05 && !before.turning, `before the corkscrew the view is as it was (rolled ${f2(before.roll)} rad)`);

    // The corkscrew is in the world. From 300 m before its middle: the road
    // ahead is wound from nothing to a half turn over its length, and the
    // same places are wound the same seen from nearer, and from the air.
    const places = [-130, -100, -50, 0, 50, 100, 130, 300];
    const w1 = await page.run(PUT(mid, 300) + WOUND(mid, places));
    const w2 = await page.run(PUT(mid, 160) + WOUND(mid, places));
    const w3 = await page.run(PUT(mid, 160) + 'g.setCamera && g.setCamera("drone"); for (let i = 0; i < 30; i++) g.update(1 / 60);' + WOUND(mid, places));
    await page.run('g.setCamera && g.setCamera("chase"); return 0;');
    const len = w1.zone ? w1.zone.len : 0;
    check(w1.zone && Math.abs(w1.zone.s - mid) < 12 && len > 150 && len < 210, `the road is wound over ${f2(len)} m about there (its middle at ${f2(w1.zone && w1.zone.s)} m)`);
    const an = w1.angles;
    check(w1.twisted && an[0] === 0 && an[1] < 0.02 && Math.abs(an[3] - Math.PI / 2) < 0.25 && Math.abs(an[5] - Math.PI) < 0.02 && an[7] === Math.PI
      && an.every((v, i) => i === 0 || v >= an[i - 1] - 0.07),
      `from 300 m off the road ahead is seen wound: ${an.map(f2).join(', ')} rad at ${places.join(', ')} m`);
    const drift = Math.max(...an.map((v, i) => Math.max(Math.abs(v - w2.angles[i]), Math.abs(v - w3.angles[i]))));
    check(drift < 0.01, `each place is wound the same from nearer and from the air: it is the world's, not the lens's (${drift.toExponential(1)} rad apart)`);

    // The way through, a frame at a time: the car put 140 m before the
    // middle, driven 300 m.
    const far = mid + 400;
    const into = await page.run(PUT(mid, 140) + WATCH(300, far));
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
    check(first && Math.abs(first[0] - (mid - len / 2)) < 12 && Math.abs(lastT[0] - (mid + len / 2)) < 12,
      `the car goes over along the corkscrew, from ${f2(first && first[0])} m to ${f2(lastT && lastT[0])} m`);
    check(Math.abs(peak[0] - mid) < 25 && peak[3] > 0.3 && peak[3] < 2.5, `quickest in the middle (${f2(peak[3])} rad/s at ${f2(peak[0])} m)`);
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
    check(rows.every((r) => r[11] > 100), `the frustum test is off while the winding is near (${rows[0][11]} meshes)`);

    // By where the car is, not by the clock.
    const fast = await page.run(PUT(mid, 190, 40) + WATCH(350, far, 40));
    const rollAt = (rs, s) => { const r = rs.find((x) => x[0] >= s); return r ? r[1] : NaN; };
    const apart = Math.max(...[-70, -35, 0, 35, 70].map((d) => Math.abs(rollAt(rows, mid + d) - rollAt(fast.rows, mid + d))));
    const secs = (rs) => rs.filter((r) => r[8]).length / 60;
    check(apart < 0.12 && secs(fast.rows) < secs(rows) * 0.75, `at 40 m/s it is as far over at each place as at 22 (${f2(apart)} rad apart), and sooner done (${f2(secs(fast.rows))} s against ${f2(secs(rows))})`);
    const stood = await page.run(STAND(mid));
    check(stood.rolls[0] > 0.9 && stood.rolls[0] < 2.3 && Math.abs(stood.rolls[1] - stood.rolls[0]) < 0.02,
      `a car that stops half way stays on its side (${f2(stood.rolls[0])} rad, and ${f2(stood.rolls[1])} a second later)`);
    const clear = await page.run(PUT(mid, -860) + WOUND(mid, [0]));
    check(clear.off === 0, `760 m past it the frustum test is on again (${clear.off} meshes off)`);

    const after = await page.run(AT(found.s1 + 120));
    check(Math.abs(after.roll - Math.PI) < 0.08, `in it the view is turned half round (${f2(after.roll)} rad)`);
    check(after.bottom > after.top && after.topStraight > after.bottomStraight,
      `the sky is the brighter, and now at the bottom, where turned back it is at the top (${f2(after.bottom)} under ${f2(after.top)}; ${f2(after.topStraight)} over ${f2(after.bottomStraight)})`);
    const quick = await page.run(QUICK(found.s1 + 120));
    check(Math.abs(quick.roll - Math.PI) < 0.01 && !quick.turning, `a car put down inside is inside at once (${f2(quick.roll)} rad, ${quick.turning ? 'turning' : 'at rest'})`);

    const up = await page.run(STEER(found.s0 - 150));
    const down = await page.run(STEER(found.s1 + 120));
    check(up.dy * down.dy < 0 && Math.abs(down.dy) > 0.05, `the wheel is turned the other way once it is over (${f2(up.dy)} rad, then ${f2(down.dy)})`);

    // The way out: on round the same way, to a whole turn, and the wheel back.
    const laid = await page.run(FIND_OUT(found.s1 + 300));
    check(laid.sOut !== null, `the way out is laid (its middle at ${laid.sOut} m)`);
    const outOf = await page.run(PUT(laid.sOut, 140) + WATCH(300, laid.sOut + 400));
    const o = outOf.rows;
    const oEnd = o[o.length - 1];
    check(Math.abs(o[0][1] - Math.PI) < 0.05 && Math.abs(oEnd[1] - 2 * Math.PI) < 0.01 && o.every((r, i) => i === 0 || r[1] >= o[i - 1][1] - 0.01),
      `going out it winds on the same way round, to a whole turn (${f2(o[0][1])} to ${f2(oEnd[1])} rad)`);
    check(Math.abs(wrap(oEnd[2])) < 0.08, `and the camera is upright again (${f2(wrap(oEnd[2]))} rad)`);
    const oSlip = Math.max(...o.map((r) => r[9]));
    check(oSlip < 0.25, `with the road under the car all the way (at most ${f2(oSlip)} m off)`);
    const again = await page.run(STEER(laid.sOut + 200));
    check(up.dy * again.dy > 0 && Math.abs(again.dy) > 0.05, `with the wheel back as it was (${f2(again.dy)} rad)`);

    // A flash in it lights the sky, and there are things by the road.
    const flash = await page.run(AT(found.s1 + 120, `g.upside._next = 99; g.upside._age = 0.1;
      const d = new g.camera.position.constructor(); g.camera.getWorldDirection(d);
      g.upside.bolt.set(Math.atan2(d.z, d.x), 0.95, 31, 0); g.update(1 / 60);`));
    check(flash.flash > 0.3 && flash.hotBottom > 20, `a flash of lightning lights the sky (flash ${f2(flash.flash)}, ${flash.hotBottom} bright pixels)`);
    const tent = await page.run(AT(found.s1 + 300, 'for (let i = 0; i < 240; i++) g.update(1 / 60);'));
    check(tent.tentacles > 5, `things stand by the road (${tent.tentacles})`);
    // It spreads: roots creep in over the ground toward the road and a
    // tentacle stands up where one has got to; the longer the car is in it,
    // the more of both; and bats fly in it, and nowhere else.
    const early = await page.run(AT(found.s1 + 300, 'g.upside.infect = 0; for (let i = 0; i < 300; i++) { g.upside.infect = Math.min(g.upside.infect, 0.05); g.update(1 / 60); }'));
    const late = await page.run(AT(found.s1 + 300, 'for (let i = 0; i < 600; i++) { g.upside.infect = Math.max(g.upside.infect, 0.9); g.update(1 / 60); }'));
    check(late.roots >= 6 && late.segments > 100, `roots creep over the ground toward the road (${late.roots} roots, ${late.segments} segments of them)`);
    check(late.roots > early.roots && late.tentacles > early.tentacles,
      `and the more it has spread, the more of them (${early.roots} roots, ${early.tentacles} tentacles; then ${late.roots}, ${late.tentacles})`);
    check(late.bats >= 30, `bats fly in it (${late.bats})`);
    const hills = await openPage('seed=7&world=hills&run=120&cam=chase&style=real');
    const none = await hills.run('return { bats: g.critters.bats.shown, roots: g.upside.creep.roots.length };');
    hills.close();
    check(none.bats === 0 && none.roots === 0, `and in no other world (${none.bats} bats, ${none.roots} roots in the hills)`);
  } finally {
    page.close();
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
console.log('\nOK: the road into the Upside Down is a corkscrew, the car goes over along it; in it, the world is the other way up');
