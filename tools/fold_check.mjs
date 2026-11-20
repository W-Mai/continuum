// What a wound world's shaders leave out (render/twist.js, FOLD_NEED).
//
// While the world is wound over, the land's and the sea's fragment shaders do not work out a
// term that is nothing for a 2 x 2 block of pixels: the fine waves past 900 m, the plates and
// specks of the dirt past 380 m, its veins where no zone of them is, the planes of the
// triplanar read that weigh under TRI_MIN. This draws the same wound frame twice in one page,
// as it is drawn and with NEED taken out of the two programs (every term worked out, as it is
// where nothing is wound), and compares them pixel by pixel. It asserts:
//  - the world is wound, and the land and the sea draw with their wound programs;
//  - the two programs are not the same text (the shortcut is in the one and not the other);
//  - in no frame do more than --limit (0.2%) of the pixels differ by 3 levels or more (the
//    triplanar read is the one shortcut that is not exact: a plane under TRI_MIN is not read);
//  - the frame does not change by itself: two draws of the same program differ by less than that.
// The times it takes the two are written, not asserted.
//
// Usage: node tools/fold_check.mjs [--shots space,upside] [--styles real,paint] [--gpu] [--limit 0.002]
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const GPU = args.includes('--gpu');
const SHOTS = { space: { world: 'space', s: 2200 }, upside: { world: 'upside', s: 2200 } };
const shots = opt('--shots', 'space,upside').split(',');
const styles = opt('--styles', 'real,paint').split(',');
const LIMIT = Number(opt('--limit', 0.002));
const LEVELS = 3;

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

// The page, headless, and a way to run code in it; errors the page logs come back with it.
async function openPage(query) {
  const profile = `${tmpdir()}/continuum-fold-${process.pid}-${Date.now()}`;
  const how = GPU
    ? ['--ignore-gpu-blocklist', '--enable-gpu', process.platform === 'darwin' ? '--use-angle=metal' : '--use-angle=vulkan']
    : ['--disable-gpu', '--enable-unsafe-swiftshader'];
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', ...how, '--mute-audio', '--hide-scrollbars',
    `--window-size=${GPU ? '1920,1080' : '960,540'}`, '--remote-debugging-port=0', `--user-data-dir=${profile}`,
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

// In the page: the car put on the road where the shot is, the style set, a frame drawn as
// tools/look.mjs draws it; then the frame drawn as it is, again, with NEED taken out of the
// land's and the sea's programs, and the pixels compared.
const COMPARE = (style, s) => `
  if (g.style.id !== ${JSON.stringify(style)}) { g.style.set(${JSON.stringify(style)}, true); g.style.applyScene(); }
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
  const gl = g.renderer.getContext();
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const one = new Uint8Array(4);
  const grab = () => { g.render(); const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const time = () => { const t0 = performance.now(); for (let i = 0; i < 6; i++) { g.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - t0) / 6; };
  const diff = (a, b) => {
    let over = 0;
    let most = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      if (d >= ${LEVELS}) over++;
      if (d > most) most = d;
    }
    return { share: over / (w * h), most };
  };
  const wound = { world: g.upside.twisted, land: g.terrain.wound, landDefine: g.terrain.material.defines.FOLD_ALPHA !== undefined, seaDefine: g.water.material.defines.FOLD_ALPHA !== undefined };
  g.render();
  const shipped = grab();
  const again = grab();
  const msShipped = time();
  // NEED is true in the two programs: every term is worked out.
  const texts = [];
  for (const m of [g.terrain.material, g.water.material]) {
    const before = m.onBeforeCompile;
    const key = m.customProgramCacheKey;
    m.onBeforeCompile = (shader, renderer) => {
      before.call(m, shader, renderer);
      if (shader.fragmentShader.includes('#define NEED( c ) anyQuad( c )')) texts.push(m === g.water.material ? 'sea' : 'land');
      shader.fragmentShader = shader.fragmentShader.split('#define NEED( c ) anyQuad( c )').join('#define NEED( c ) true');
    };
    m.customProgramCacheKey = () => key.call(m) + '-all';
    m.needsUpdate = true;
  }
  g.render();
  const full = grab();
  const msFull = time();
  return { wound, replaced: texts, steady: diff(shipped, again), against: diff(shipped, full), msShipped, msFull, size: [w, h] };
`;

const server = serve();
let failed = 0;
const check = (ok, text) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};
try {
  if (!(await waitForServer())) throw new Error('the server did not come up');
  for (const shot of shots) {
    if (!SHOTS[shot]) throw new Error(`no shot ${shot} (space, upside)`);
    for (const style of styles) {
      const { world, s } = SHOTS[shot];
      const page = await openPage(`seed=7&world=${world}&s=${s}&cam=chase&style=real&run=60`);
      try {
        const r = await page.run(COMPARE(style, s));
        if (r.error) throw new Error(`${shot}:${style}: ${r.error}`);
        const w = r.wound;
        check(w.world && w.land && w.landDefine && w.seaDefine, `${shot}:${style} the world is wound, and the land and the sea draw with their wound programs (${JSON.stringify(w)})`);
        check(r.replaced.includes('land') && r.replaced.includes('sea'), `${shot}:${style} the land's and the sea's programs have the shortcut in their text (${r.replaced.join(', ')}), and the others are made without it`);
        check(r.steady.share <= LIMIT, `${shot}:${style} two draws of the same program differ in ${(r.steady.share * 100).toFixed(4)}% of the pixels by ${LEVELS} levels or more (at most ${(LIMIT * 100).toFixed(1)}%)`);
        check(r.against.share <= LIMIT, `${shot}:${style} with and without the shortcuts the frame differs in ${(r.against.share * 100).toFixed(4)}% of the pixels by ${LEVELS} levels or more, the most ${r.against.most} (at most ${(LIMIT * 100).toFixed(1)}%)`);
        console.log(`     ${r.size[0]}x${r.size[1]}, ${r.msShipped.toFixed(1)} ms a frame with them, ${r.msFull.toFixed(1)} ms without`);
        if (page.logs.length) check(false, `${shot}:${style} the page logged errors: ${page.logs.slice(0, 2).join(' | ')}`);
      } finally {
        page.close();
      }
    }
  }
} finally {
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
// (Not process.exit: the timer that removes the last page's profile has to fire first.)
process.exitCode = failed ? 1 : 0;
