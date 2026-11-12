// Render the sound of a drive offline and save it, to listen to without a
// browser: the page runs headless with sounddemo=1, drives for the given
// seconds and renders its sound (src/ui/sound.js) into an OfflineAudioContext
// beside the drive; this script waits for it over the DevTools protocol (the
// render runs on the audio thread, which a virtual-time budget does not wait
// for) and writes the WAV.
//
// Usage: node tools/sound_demo.mjs [seconds] [extra query] [out.wav]
// e.g.   node tools/sound_demo.mjs 90 "seed=7&worldlen=1500&cam=director"

import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = 8179;
const ROOT = new URL('..', import.meta.url).pathname;
const [seconds = '60', extra = 'seed=7&cam=director', out = ROOT + 'out/sound-demo.wav'] = process.argv.slice(2);
const frames = Math.round(Number(seconds) * 60);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('node', [ROOT + 'tools/serve.mjs', String(PORT), ROOT], { stdio: ['ignore', 'pipe', 'inherit'] });
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
  } catch { /* not up yet */ }
  await sleep(100);
}
const profile = `${tmpdir()}/continuum-sound-${process.pid}`;
const url = `http://localhost:${PORT}/index.html?run=${frames}&sounddemo=1&${extra}`;
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--window-size=640,360', '--remote-debugging-port=0', `--user-data-dir=${profile}`, url],
{ stdio: ['ignore', 'ignore', 'pipe'], env: CHROME_ENV });
const done = async (code) => {
  chrome.kill();
  server.kill();
  await new Promise((r) => (chrome.exitCode !== null ? r() : chrome.on('exit', r)));
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  process.exit(code);
};

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
  page = list.find((t) => t.type === 'page' && t.url.includes('sounddemo'));
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
const evaluate = (expression) => new Promise((resolve) => {
  pending.set(++id, (r) => resolve(r && r.result ? r.result.value : undefined));
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
});

const t0 = Date.now();
for (;;) {
  const title = await evaluate('document.title');
  if (title === 'GAME_DONE') break;
  const err = await evaluate("(document.getElementById('err') || {}).textContent || ''");
  if (err) {
    console.error('FAIL: page error\n' + err);
    await done(1);
  }
  if (Date.now() - t0 > 30 * 60 * 1000) {
    console.error('FAIL: timed out');
    await done(1);
  }
  await sleep(1000);
}
const b64 = await evaluate("(document.getElementById('sound') || {}).textContent || ''");
if (!b64) {
  console.error('FAIL: no sound in the page');
  await done(1);
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
const db = (x) => (20 * Math.log10(Math.max(x, 1e-9) / 32768)).toFixed(1);
console.error(`OK: ${out}, ${seconds} s in ${((Date.now() - t0) / 1000).toFixed(0)} s, peak ${db(peak)} dBFS, rms ${db(Math.sqrt(sum / pcm.length))} dBFS`);
await done(0);
