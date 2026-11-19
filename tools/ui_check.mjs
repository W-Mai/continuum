// The settings panel, and the interface in English.
//
// In node, without a browser:
//  - the strings: both languages have the same keys, every key the page and the
//    modules ask for is in the table and none is left unasked, the English has
//    no Chinese character in it, each verse has a line of paraphrase under it
//    in English and none in Chinese, the names of the worlds and the styles
//    are the data's own in Chinese and the id with a capital in English;
//  - the instrument writes the Chinese it always wrote (a sweep of grades,
//    lengths and distances against the formulas as they were), writes the
//    English, and writes mph and feet;
//  - what is set: the address bar over what was chosen over what the system
//    says; a headless run takes the address only; a value the address gave
//    cannot be changed; every change is kept and told once;
//  - the tier is pinned and let go, the frame cap changes the pacer's pace,
//    and the sound's three levels sit in its graph where they should.
//
// In the real page, headless, in Chrome (seed 7, driven over the DevTools
// protocol with real mouse and key events):
//  - a first visit changes nothing and opens nothing, whatever the machine says
//    about motion and language it follows;
//  - the gear opens the panel; the worlds, the styles and the settings are open
//    one at a time; a click outside closes the one that is open, so does Esc;
//    with the focus in the panel an arrow moves a slider and does not steer
//    the car, a letter is no shortcut, and Esc gives the focus back to the gear;
//  - each setting, changed in the panel, is kept (localStorage) and, after the
//    page is opened again, is still the value, in the panel and in what the
//    game does: the tier pinned, the pacer's cap, the lens held still or not,
//    the sound's levels, the instrument's units, the language;
//  - tier=low in the address shows low in the panel and cannot be changed there
//    (nor cap=, nor lang=), and is not kept;
//  - in English (lang=en, the browser's language, or chosen in the panel) there
//    is no Chinese character in the page but the verses, a line of paraphrase
//    is under each verse, and no button's text runs out of its box;
//  - the Chinese interface says what it always said;
//  - the tier changes from high to low without the canvas being made again, in
//    a few milliseconds;
//  - on a phone (390 x 844) the panel stays on the screen and everything to
//    touch is at least 40 x 40 pixels;
//  - in mph the speed is 0.6214 of the km/h, and the unit's word changes.
// Pictures of the page, in both languages, on a wide screen and a phone, with
// the panel open and shut, are written to out/ui (OUT=dir moves them).
//
// Usage: node tools/ui_check.mjs
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Hud } from '../src/ui/hud.js';
import { Sound } from '../src/ui/sound.js';
import { Settings, DEFAULT_VOLUME, MASTER_UNITY, KEYS } from '../src/ui/settings.js';
import { TABLES, setLang, worldName, styleName, detectLang } from '../src/ui/strings.js';
import { Pacer } from '../src/render/pacing.js';
import { Quality } from '../src/render/quality.js';
import { TUNNEL, BRIDGE, STEP } from '../src/world/road.js';
import { WORLDS } from '../src/world/worlds.js';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8199;
const ROOT = new URL('..', import.meta.url).pathname;
const OUT = (process.env.OUT || ROOT + 'out/ui').replace(/\/?$/, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

let failed = 0;
const say = (ok, text) => {
  if (!ok) failed++;
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
};
const results = {};

// --- in node ------------------------------------------------------------------

const read = (file) => readFileSync(ROOT + file, 'utf8');

function strings() {
  const zh = Object.keys(TABLES.zh).sort();
  const en = Object.keys(TABLES.en).sort();
  say(JSON.stringify(zh) === JSON.stringify(en), `both languages have the same ${zh.length} lines`
    + (JSON.stringify(zh) === JSON.stringify(en) ? '' : ` (only in zh: ${zh.filter((k) => !(k in TABLES.en))}; only in en: ${en.filter((k) => !(k in TABLES.zh))})`));

  // What the page and the modules ask for: data-i attributes in the markup,
  // t(...) in the code (a name that ends in a dot is a prefix: t('cam.' + name)).
  // The tables themselves are left out of what is read.
  const sources = [read('index.html'), ...readdirSync(ROOT + 'src/ui').filter((f) => f.endsWith('.js')).map((f) => read('src/ui/' + f))]
    .map((src) => src.replace(/const zh = \{[\s\S]*?\n\};\n\nconst en = \{[\s\S]*?\n\};/, ''));
  const asked = new Set();
  const prefixes = new Set();
  for (const src of sources) {
    for (const m of src.matchAll(/data-i(?:-title|-aria)?="([\w.]+)"/g)) asked.add(m[1]);
    for (const m of src.matchAll(/\bt\(([^,)]*)/g)) {
      for (const k of m[1].matchAll(/'([\w.]+)'/g)) (k[1].endsWith('.') ? prefixes : asked).add(k[1]);
    }
  }
  const missing = [...asked].filter((k) => !(k in TABLES.zh));
  const noPrefix = [...prefixes].filter((p) => !zh.some((k) => k.startsWith(p)));
  say(!missing.length && !noPrefix.length, `every one of the ${asked.size} keys the page and the modules ask for is in the table${missing.length ? ' (missing: ' + missing + ')' : ''}${noPrefix.length ? ' (no key for ' + noPrefix + ')' : ''}`);
  const unasked = zh.filter((k) => !asked.has(k) && ![...prefixes].some((p) => k.startsWith(p)));
  say(!unasked.length, `no line is left unasked${unasked.length ? ' (' + unasked + ')' : ''}`);

  const chinese = Object.entries(TABLES.en).filter(([, v]) => CJK.test(v)).map(([k]) => k);
  say(!chinese.length, `the English has no Chinese character in it${chinese.length ? ' (' + chinese + ')' : ''}`);
  const verses = zh.filter((k) => k.startsWith('verse.'));
  say(verses.length === 4 && verses.every((k) => TABLES.zh[k] === '' && TABLES.en[k].length > 10 && TABLES.en[k].length < 90),
    `each of the ${verses.length} verses has a line of paraphrase in English (${verses.map((k) => TABLES.en[k].length).join(', ')} letters) and none in Chinese`);
  const page = read('index.html');
  const noted = [...page.matchAll(/class="note"[^>]*>[\s\S]*?<\/div>/g)].map((m) => m[0]);
  say(noted.length === verses.length && noted.every((n) => /<span class="tr" data-i="verse\.\w+">/.test(n)),
    `the page has a paraphrase line under each of its ${noted.length} verses`);

  const styles = [...read('src/render/style.js').matchAll(/\{ id: '(\w+)', name: '([^']+)' \}/g)].map((m) => ({ id: m[1], name: m[2] }));
  setLang('en');
  const cap = (id) => id[0].toUpperCase() + id.slice(1);
  say(WORLDS.length === 12 && WORLDS.every((w) => worldName(w) === cap(w.id)), `in English the ${WORLDS.length} worlds are their ids with a capital (${WORLDS.map(worldName).join(', ')})`);
  say(styles.length === 7 && styles.every((s) => styleName(s) === cap(s.id)), `...and the ${styles.length} styles (${styles.map(styleName).join(', ')})`);
  setLang('zh');
  say(WORLDS.every((w) => worldName(w) === w.name) && styles.every((s) => styleName(s) === s.name), 'in Chinese they are the names in their own data');
  say(detectLang(['zh-CN', 'en']) === 'zh' && detectLang(['en-US', 'zh-CN']) === 'en' && detectLang(['ja', 'zh-TW']) === 'zh'
    && detectLang(['fr-FR']) === 'en' && detectLang([]) === 'en', 'the browser\'s languages are read in their order, the first Chinese or English one wins, none is English');
  results.strings = { lines: zh.length, asked: asked.size };
}

// The instrument's Chinese as it was written, as formulas, to hold the new
// writing to it letter for letter.
const WAS = {
  grade: (grade) => (Math.abs(grade) < 0.5 ? '平坡' : `${grade > 0 ? '上坡' : '下坡'} ${Math.abs(grade).toFixed(1)}%`),
  left: (kind, rest) => `${kind === TUNNEL ? '隧道' : '高架桥'} · 还有 ${Math.max(0, Math.round(rest / 10) * 10)} m`,
  next: (name, ahead) => `距${name} ${ahead < 1000 ? `${Math.round(ahead / 10) * 10} m` : `${(ahead / 1000).toFixed(1)} km`}`,
};

// A game with just what the instrument reads, and the elements it writes to.
function stage(over = {}) {
  const state = { grade: 0.032, kind: 0, sCar: 1234, y: 812.4, t: 0, ahead: 1920, framing: 'chase', ...over };
  const els = Object.fromEntries(['speed', 'unit', 'chain', 'world', 'alt', 'altUnit', 'grade', 'where', 'cam'].map((k) => [k, { textContent: '', hidden: false }]));
  els.auto = { setAttribute() {} };
  els.profile = { getContext: () => ({}) };
  const game = {
    get sCar() { return state.sCar; },
    road: { at: () => ({ grade: state.grade, kind: state.kind }) },
    car: { get y() { return state.y; } },
    chase: { get framing() { return state.framing; } },
    autoMode: true,
    worldHere: () => ({ id: 'alpine', name: '山间', from: '山间', to: '丘陵', fromId: 'alpine', toId: 'hills', t: state.t }),
    worldPlan: () => ({ next: state.ahead === null ? null : { id: 'coast', name: '沿海', ahead: state.ahead } }),
  };
  const hud = new Hud(game, els);
  return { hud, els, state };
}

function instrument() {
  // Chinese: every state against the formulas as they were.
  let same = 0;
  const different = [];
  const sweep = (state, expect) => {
    const { hud, els } = stage(state);
    hud.speed = 87.4;
    hud._text();
    const got = expect(els);
    if (got) different.push(got); else same++;
  };
  for (let g = -9.5; g <= 9.5; g += 0.173) {
    const grade = g / 100;
    sweep({ grade }, (e) => (e.grade.textContent === WAS.grade(grade * 100) ? '' : `grade ${g}: ${e.grade.textContent}`));
  }
  for (let r = -STEP; r <= 1500; r += 7.7) {
    for (const kind of [TUNNEL, BRIDGE]) {
      const { hud, els } = stage({ kind, sCar: 1000 });
      const end = 1000 + r;
      hud.runs = [{ kind, b: 900, e: end }];
      hud._text();
      if (els.where.textContent === WAS.left(kind, end - 1000)) same++; else different.push(`rest ${r}: ${els.where.textContent}`);
    }
  }
  for (let ahead = 0; ahead < 3000; ahead += 13.1) sweep({ ahead }, (e) => (e.where.textContent === WAS.next('沿海', ahead) ? '' : `ahead ${ahead}: ${e.where.textContent}`));
  say(!different.length, `the instrument's Chinese is the formulas' as they were, on ${same + different.length} states${different.length ? ' (' + different.slice(0, 3) + ')' : ''}`);

  const names = { chase: '追车', director: '导演', drone: '航拍', side: '侧拍', low: '低机位', front: '正面', other: '机位' };
  const camsOk = Object.entries(names).every(([f, name]) => {
    const { hud, els } = stage({ framing: f });
    hud._text();
    return els.cam.textContent === name;
  });
  const { hud: hz, els: ez } = stage({ t: 0.5 });
  hz._text();
  say(camsOk && ez.world.textContent === '山间 → 丘陵' && ez.unit.textContent === 'km/h' && ez.altUnit.textContent === 'm',
    `...and the cameras' names, the border (${ez.world.textContent}) and the units (${ez.unit.textContent}, ${ez.altUnit.textContent})`);

  // English.
  setLang('en');
  const { hud: he, els: ee } = stage({ kind: TUNNEL, sCar: 1000 });
  he.runs = [{ kind: TUNNEL, b: 900, e: 1450 }];
  he.speed = 100;
  he._text();
  const tunnel = ee.where.textContent;
  const { hud: hn, els: en } = stage();
  hn._text();
  say(tunnel === 'Tunnel · 450 m left' && en.where.textContent === 'Coast in 1.9 km' && en.grade.textContent === 'Up 3.2%'
    && en.world.textContent === 'Alpine' && en.cam.textContent === 'Chase',
  `in English: "${tunnel}", "${en.where.textContent}", "${en.grade.textContent}", "${en.world.textContent}", "${en.cam.textContent}"`);

  // mph and feet.
  const { hud: hm, els: em } = stage({ kind: TUNNEL, sCar: 1000 });
  hm.imperial = true;
  hm.runs = [{ kind: TUNNEL, b: 900, e: 1450 }];
  hm.speed = 100;
  hm._text();
  const tunnelMi = em.where.textContent;
  const { hud: hf, els: ef } = stage({ ahead: 800 });
  hf.imperial = true;
  hf._text();
  const { hud: hk, els: ek } = stage();
  hk.imperial = true;
  hk.speed = 100;
  hk._text();
  say(ek.speed.textContent === '62' && ek.unit.textContent === 'mph' && ek.altUnit.textContent === 'ft' && ek.alt.textContent === '2665'
    && ek.where.textContent === 'Coast in 1.2 mi' && tunnelMi === 'Tunnel · 1500 ft left' && ef.where.textContent === 'Coast in 2600 ft',
  `in mph: ${ek.speed.textContent} ${ek.unit.textContent} at 100 km/h, ${ek.alt.textContent} ${ek.altUnit.textContent}, "${ek.where.textContent}", "${tunnelMi}", "${ef.where.textContent}"`);
  setLang('zh');
}

function settings() {
  const mem = (init = {}) => {
    const m = new Map(Object.entries(init));
    return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
  };
  const make = (query = '', o = {}) => new Settings({ params: new URLSearchParams(query), languages: ['en-US'], ...o });
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const s = make('', { storage: mem() });
  say(s.get('tier') === 'auto' && s.get('cap') === 60 && s.get('motion') === true && eq(s.get('vol'), DEFAULT_VOLUME)
    && s.get('units') === 'kmh' && s.get('lang') === 'en' && Object.keys(KEYS).every((k) => !s.locked(k)) && s.pinnedTier() === undefined,
  'with nothing chosen and nothing in the address, the defaults: auto, 60, shake on, 0.8/1/1, km/h, the browser\'s language');
  say(make('', { reduceMotion: true }).get('motion') === false && make('', { reduceMotion: true, storage: mem({ [KEYS.motion]: '1' }) }).get('motion') === true,
    'the system\'s "reduce motion" turns the shake off, and what was chosen overrides it');
  const stored = mem({ [KEYS.tier]: 'low', [KEYS.cap]: '30', [KEYS.motion]: '0', [KEYS.vol]: '{"master":0.5,"car":0.4,"ambient":0.3}', [KEYS.units]: 'mph', [KEYS.lang]: 'zh' });
  const c = make('', { storage: stored });
  say(c.get('tier') === 'low' && c.get('cap') === 30 && c.get('motion') === false && eq(c.get('vol'), { master: 0.5, car: 0.4, ambient: 0.3 })
    && c.get('units') === 'mph' && c.get('lang') === 'zh' && c.pinnedTier() === 'low', 'what was chosen is read back, over what the system says');
  const u = make('tier=mid&cap=0&lang=en-US', { storage: stored });
  say(u.get('tier') === 'mid' && u.locked('tier') && u.get('cap') === 0 && u.locked('cap') && u.get('lang') === 'en' && u.locked('lang')
    && !u.locked('units') && !u.locked('motion') && !u.locked('vol') && u.get('units') === 'mph',
  'the address bar is over what was chosen, and locks its settings');
  const before = [...stored.m.entries()].join();
  say(u.set('tier', 'high') === false && u.set('lang', 'zh') === false && u.get('tier') === 'mid' && [...stored.m.entries()].join() === before,
    'a locked setting cannot be changed, and the address does not overwrite what was chosen');
  const bad = make('tier=bogus&cap=abc&lang=fr', { storage: mem({ [KEYS.tier]: 'bogus', [KEYS.cap]: '-', [KEYS.vol]: '{', [KEYS.units]: 'furlongs' }) });
  say(bad.get('tier') === 'auto' && !bad.locked('tier') && bad.get('cap') === 0 && bad.locked('cap') && bad.get('lang') === 'en' && !bad.locked('lang')
    && eq(bad.get('vol'), DEFAULT_VOLUME) && bad.get('units') === 'kmh',
  'a tier that is not one, a language that is neither, and what is no value in the store are no value; cap=abc is cap=0 as it always was');
  const run = make('tier=low', { run: true, storage: mem({ [KEYS.lang]: 'en', [KEYS.cap]: '30', [KEYS.units]: 'mph', [KEYS.motion]: '0' }), reduceMotion: true, languages: ['en'] });
  say(run.get('tier') === 'low' && run.get('motion') === true && run.get('lang') === 'zh' && run.get('cap') === 60 && run.get('units') === 'kmh'
    && make('lang=en', { run: true }).get('lang') === 'en', 'a headless run takes the address and the defaults only');

  const k = make('', { storage: mem() });
  const told = [];
  k.onChange((key, v) => told.push([key, v]));
  const changed = [k.set('tier', 'low'), k.set('tier', 'low'), k.set('cap', 0), k.set('motion', false), k.set('units', 'mph'), k.set('lang', 'zh'),
    k.set('vol', { master: 2, car: -1 }), k.set('tier', 'extreme'), k.set('cap', -5), k.set('motion', 'yes')];
  say(eq(changed, [true, false, true, true, true, true, true, false, false, false]) && told.length === 6 && eq(k.get('vol'), { master: 1, car: 0, ambient: 1 }),
    `every change is told once, a repeat and a value that is not one are not (${told.length} told); a volume is held to 0..1`);
  const m = k.storage;
  say(m.getItem(KEYS.tier) === 'low' && m.getItem(KEYS.cap) === '0' && m.getItem(KEYS.motion) === '0' && m.getItem(KEYS.units) === 'mph'
    && m.getItem(KEYS.lang) === 'zh' && m.getItem(KEYS.vol) === '{"master":1,"car":0,"ambient":1}',
  `each is kept as ${Object.values(KEYS).join(', ')}`);
}

function game() {
  // The tier: pinned, let go, and the pin holds as the level goes down.
  const tiers = [];
  const stub = {
    setTier: (v) => tiers.push(v), setRenderScale() {}, setDetail() {},
    atmosphere: { sun: { shadow: { mapSize: { x: 2048, set() {} }, map: null } } },
  };
  const q = new Quality(stub, 1, 60, null);
  q.pin('low');
  const pinned = q.tier === 'low' && tiers.at(-1) === 'low';
  q.pin(null);
  const free = q.tier === 'high' && tiers.at(-1) === 'high';
  q.pin('mid');
  q.set(4);
  q.pin('bogus');
  say(pinned && free && tiers.slice(-3).join() === 'mid,mid,low' && q.tier === 'low' && q.pinned === null,
    `the tier is pinned (low), let go (high), held through the levels (mid at level 4), and let go to the level's (${tiers.slice(-3)})`);

  // The pacer: the cap changes how many refreshes of a 120 Hz screen are drawn on.
  const p = new Pacer(60);
  for (let i = 0; i < 200; i++) p.refresh(i * (1000 / 120));
  const every = [p.every];
  for (const cap of [0, 30, 60]) {
    p.setCap(cap);
    every.push(p.every);
  }
  say(every.join() === '2,1,4,2' && p.target === 60, `the cap goes to the pacer: on a 120 Hz screen every ${every.join(', then ')} refresh for 60, 0, 30, 60`);

  // The sound: where its three levels sit in the graph.
  const param = () => ({ value: 0, last: null, setTargetAtTime(v, time, tau) { this.last = [v, time, tau]; }, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = (kind) => {
    const n = { kind, edges: [], gain: param(), frequency: param(), Q: param(), connect(to) { n.edges.push(to); return to; }, start() {}, stop() {} };
    return n;
  };
  const ctx = {
    sampleRate: 4000, currentTime: 0, destination: node('destination'),
    createGain: () => node('gain'), createBiquadFilter: () => node('filter'), createOscillator: () => node('osc'),
    createBufferSource: () => node('source'), createConvolver: () => node('convolver'), createDynamicsCompressor: () => ({ ...node('comp'), threshold: param(), ratio: param() }),
    createBuffer: (ch, n) => ({ getChannelData: () => new Float32Array(n) }),
  };
  const sound = new Sound(ctx);
  const into = (a, b) => a.edges.includes(b);
  say(into(sound.car, sound.carBus) && !into(sound.car, sound.medium) && into(sound.carBus, sound.medium) && sound.carBus.edges.some((n) => n.kind === 'convolver')
    && into(sound.windGain, sound.ambientBus) && into(sound.turnGain, sound.ambientBus) && into(sound.subGain, sound.ambientBus)
    && into(sound.air, sound.ambientBus) && into(sound.ambientBus, sound.medium) && !into(sound.windGain, sound.medium),
  'in the sound\'s graph the car goes through the car\'s level and the wind, the turning and the air through the ambience\'s, both into the medium');
  sound.setVolume({ master: 0.625, car: 0.4, ambient: 0.3 });
  sound.update({ speed: 20, throttle: 0.5, lift: 1, a: 0, b: 0, blend: 0, inside: 0, distance: 8, on: 1 }, 1);
  say(sound.carBus.gain.last[0] === 0.4 && sound.ambientBus.gain.last[0] === 0.3 && Math.abs(sound.master.gain.last[0] - 1.6 * 0.625) < 1e-12,
    `the levels are set (car ${sound.carBus.gain.last[0]}, ambience ${sound.ambientBus.gain.last[0]}, the whole ${sound.master.gain.last[0]})`);
  const fresh = new Sound(ctx);
  fresh.update({ speed: 20, throttle: 0.5, lift: 1, a: 0, b: 0, blend: 0, inside: 0, distance: 8, on: 1 }, 1);
  say(fresh.master.gain.last[0] === 1.6 && fresh.carBus.gain.value === 1 && fresh.ambientBus.gain.value === 1 && MASTER_UNITY / MASTER_UNITY === 1,
    `the levels untouched leave the sound as it was (the whole at ${fresh.master.gain.last[0]}, the car's and the ambience's at 1; ${MASTER_UNITY} on the slider is 1 times)`);
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

const PRESS = {
  Escape: { key: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 },
  ArrowRight: { key: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 },
  KeyM: { key: 'm', windowsVirtualKeyCode: 77, nativeVirtualKeyCode: 77 },
};
const open = new Set();
const profiles = [];
let opened = 0;

// A page in Chrome, driven over the DevTools protocol. languages: what the
// browser says its languages are; reduceMotion: the system's preference;
// before: script run in each new document before the page's own.
async function openPage({ size = [1280, 720], languages = ['zh-CN'], reduceMotion = false, before = '' } = {}) {
  const profile = `${tmpdir()}/continuum-ui-${process.pid}-${++opened}`;
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
  // Chrome may open a tab of its own (about Chrome) in front of the page, and
  // a page in a tab that is not in front is hidden: it draws no frames. So the
  // others are closed and the page is brought to the front.
  const tidy = async () => {
    const list = await (await fetch(`http://${devtools.host}/json/list`)).json();
    let closed = 0;
    for (const x of list) {
      if (x.type !== 'page' || x.id === target.id) continue;
      await fetch(`http://${devtools.host}/json/close/${x.id}`);
      closed++;
    }
    await fetch(`http://${devtools.host}/json/activate/${target.id}`);
    return closed;
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
    const timer = setTimeout(() => { pending.delete(n); reject(new Error(`${method}: no answer in 120 s`)); }, 120000);
    pending.set(n, [(v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); }]);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify(languages)} });
      Object.defineProperty(navigator, 'language', { get: () => ${JSON.stringify(languages[0])} });
      ${before}`,
  });
  if (reduceMotion) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  // In the page: a value (JSON), or an error thrown.
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const page = {
    ev,
    errors,
    // A function of the page's own, with an argument: its answer.
    run: (fn, arg) => ev(`(${fn})(${JSON.stringify(arg === undefined ? null : arg)})`),
    async goto(query) {
      const before = await ev('performance.timeOrigin').catch(() => 0);
      const closed = await tidy();
      if (closed) console.error(`note: ${closed} other tab(s) of the browser closed`);
      await send('Page.navigate', { url: `http://localhost:${PORT}/index.html?${query}` });
      const t0 = Date.now();
      for (let n = 0; ; n++) {
        await sleep(500);
        // The page up and drawing; a page that is hidden draws nothing, and is
        // brought to the front.
        const up = await ev('(performance.timeOrigin !== ' + before + ' && window.game && game.carLoaded && game.frame > 2 && window.ui) ? "up" : (document.title.startsWith("GAME_FAIL") ? document.title : (document.hidden ? "hidden" : "no"))').catch(() => 'no');
        if (up === 'up') break;
        if (String(up).startsWith('GAME_FAIL')) throw new Error(up);
        if (up === 'hidden' || n % 20 === 19) await tidy().catch(() => 0);
        if (Date.now() - t0 > 240000) throw new Error('the page never came up');
      }
    },
    // A real click at the middle of the first element the selector finds.
    async click(selector) {
      const at = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? [r.left + r.width / 2, r.top + r.height / 2] : null; })()`);
      if (!at) throw new Error(`nothing to click at ${selector}`);
      await page.clickAt(...at);
    },
    async clickAt(x, y) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    },
    // Keys by their code (Escape, ArrowRight, KeyM): down, up, or both.
    async keyDown(code) {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...PRESS[code], code });
    },
    async keyUp(code) {
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...PRESS[code], code });
    },
    async key(code) {
      await page.keyDown(code);
      await page.keyUp(code);
    },
    // The window put to this size, and a few frames waited for: a canvas that
    // has changed size is empty until the page draws it again.
    async size(w, h) {
      await tidy();
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      const from = await ev('game.frame');
      for (const t0 = Date.now(); (await ev('game.frame')) < from + 3 && Date.now() - t0 < 90000;) await sleep(300);
    },
    async shot(name) {
      await tidy();
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

// --- functions that run in the page ---------------------------------------------

// Which of the three menus are open.
function menus() {
  return ['worlds', 'styles', 'settings'].filter((id) => !document.getElementById(id).hidden);
}

// The Chinese characters in what the page says, but for the verses and what
// stands under them in the startup screen; where each is.
function chinese() {
  const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;
  const found = [];
  const skip = (el) => el.closest('script, style, #boot') || (el.matches('.q, .src') && el.closest('.note'));
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n.parentElement;
    if (!skip(el) && CJK.test(n.nodeValue)) found.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}: ${n.nodeValue.trim()}`);
  }
  for (const el of document.querySelectorAll('[title], [aria-label], [alt], [placeholder]')) {
    if (el.closest('#boot')) continue;
    for (const a of ['title', 'aria-label', 'alt', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v && CJK.test(v)) found.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}[${a}]: ${v}`);
    }
  }
  if (CJK.test(document.title)) found.push('title: ' + document.title);
  if (CJK.test(document.documentElement.lang)) found.push('lang');
  return found;
}

// The buttons, links and options whose text runs out of the box they are in.
function overflowing() {
  const bad = [];
  for (const e of document.querySelectorAll('button, a[href], [role="radio"]')) {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (e.scrollWidth > e.clientWidth) bad.push(`${e.id || e.className || e.tagName}: "${e.textContent.trim()}" ${e.scrollWidth} > ${e.clientWidth}`);
  }
  return bad;
}

// What is to touch, shown now, with its size; and what is off the screen.
function touching() {
  const shown = (e) => {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const things = [...document.querySelectorAll('#bar button, #bar a, #worlds button, #styles button, #worlds li label, #settings button, #settings input')]
    .filter((e) => shown(e) && !(e.matches('#worlds input')));
  const small = things.map((e) => [e, e.getBoundingClientRect()]).filter(([, r]) => r.width < 39.5 || r.height < 39.5)
    .map(([e, r]) => `${e.id || e.className || e.tagName} ${e.textContent.trim().slice(0, 12)} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`);
  const out = ['bar', 'worlds', 'styles', 'settings'].map((id) => document.getElementById(id)).filter(shown)
    .filter((e) => { const r = e.getBoundingClientRect(); return r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5; })
    .map((e) => `${e.id} ${JSON.stringify(e.getBoundingClientRect())}`);
  return { count: things.length, small, out };
}

// The settings panel as it shows: each row's chosen option and whether it can
// be changed, the notes, the sliders, the line that is only shown.
function panelState() {
  const rows = {};
  for (const row of document.querySelectorAll('#settings .row[data-key]')) {
    const buttons = [...row.querySelectorAll('button[data-v]')];
    const note = row.querySelector('.byurl');
    rows[row.dataset.key] = {
      chosen: buttons.filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.dataset.v),
      chosenText: buttons.filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.textContent.trim()),
      disabled: buttons.filter((b) => b.disabled).length,
      options: buttons.length,
      note: note && !note.hidden ? note.textContent : '',
    };
  }
  const vol = Object.fromEntries([...document.querySelectorAll('#settings input[type="range"]')].map((r) => [r.dataset.bus, Number(r.value)]));
  return { rows, vol, res: document.querySelector('#settings [data-res]').textContent, open: !document.getElementById('settings').hidden };
}

// --- the scenarios --------------------------------------------------------------

const SETTING_KEYS = ['tier', 'cap', 'motion', 'vol', 'units', 'lang'].map((k) => 'continuum.' + k);
const stored = (page) => page.ev(`JSON.stringify(Object.fromEntries(${JSON.stringify(SETTING_KEYS)}.map((k) => [k, localStorage.getItem(k)])))`).then(JSON.parse);

// What the Chinese interface says, as it was written, letter for letter.
const ZH = [
  ['#brand .zh', 'text', '无限遛弯'], ['#brand', 'aria-label', 'Continuum 无限遛弯'],
  ['#btnWorlds .txt', 'text', '世界'], ['#btnWorlds', 'title', '世界（N 下一个）'],
  ['#btnStyles .txt', 'text', '画风'], ['#btnStyles', 'title', '画风（V 下一种）'],
  ['#btnCam', 'title', '切换机位（C）'],
  ['#btnAuto .txt', 'text', '自动驾驶'], ['#btnAuto', 'title', '自动驾驶（P）'],
  ['#btnWall .txt', 'text', '壁纸'], ['#btnWall', 'title', '壁纸模式（H）'],
  ['#btnSound .txt', 'text', '声音'], ['#btnSound', 'title', '声音（M）'],
  ['#bar a', 'title', '源代码'],
  ['#btnNext span', 'text', '下一个世界'], ['#worlds .hint', 'text', '勾选的世界轮流出现'], ['#worldList', 'aria-label', '世界'],
  ['#btnNextStyle span', 'text', '下一种画风'], ['#styleList', 'aria-label', '画风'],
  ['#profile', 'aria-label', '前方公路纵断面'], ['#hud .unit', 'text', 'km/h'],
  ['#wallnote .q', 'text', '行到水穷处，坐看云起时。'], ['#wallnote .src', 'text', '王维《终南别业》'],
  ['#passnote .q', 'text', '抟扶摇而上者九万里。'], ['#passnote .src', 'text', '《庄子·逍遥游》'],
  ['#turnnote .q', 'text', '天旋地转回龙驭。'], ['#turnnote .src', 'text', '白居易《长恨歌》'],
  ['#inknote .q', 'text', '诗中有画，画中有诗。'], ['#inknote .src', 'text', '苏轼《书摩诘蓝田烟雨图》'],
];
const ZH_WORLDS = ['山间', '丘陵', '河谷', '沿海', '沙漠', '城市', '地底', '地狱', '深海', '天堂', '太空', '颠倒'];
const ZH_STYLES = ['写实', '手绘', '水墨', '赛璐璐', '版画', '像素', '方块'];

// In the page: the lines the markup carries, against what is in it.
function wording(zh) {
  const bad = [];
  for (const [sel, what, want] of zh.lines) {
    const e = document.querySelector(sel);
    const got = !e ? null : what === 'text' ? e.textContent : e.getAttribute(what);
    if (got !== want) bad.push(`${sel} ${what}: "${got}" is not "${want}"`);
  }
  const worlds = [...document.querySelectorAll('#worldList .nm')].map((e) => e.textContent);
  const goes = [...document.querySelectorAll('#worldList .go')].map((e) => e.title);
  const loops = [...document.querySelectorAll('#worldList label')].map((e) => e.title);
  const styles = [...document.querySelectorAll('#styleList .nm')].map((e) => e.textContent);
  if (worlds.join() !== zh.worlds.join()) bad.push('worlds: ' + worlds);
  if (goes.join() !== zh.worlds.map((w) => '前往' + w).join()) bad.push('go titles: ' + goes);
  if (!loops.every((x) => x === '轮流出现')) bad.push('loop titles: ' + loops);
  if (styles.join() !== zh.styles.join()) bad.push('styles: ' + styles);
  if (document.title !== 'Continuum 无限遛弯') bad.push('title: ' + document.title);
  if (document.documentElement.lang !== 'zh-CN') bad.push('lang: ' + document.documentElement.lang);
  const sub = document.querySelector('#hud .sub').textContent;
  if (!/^.+ · 海拔 -?\d+ m · (平坡|上坡 \d+\.\d%|下坡 \d+\.\d%)$/.test(sub)) bad.push('hud: ' + sub);
  if ([...document.querySelectorAll('.note .tr')].some((e) => e.textContent !== '' || getComputedStyle(e).display !== 'none')) bad.push('a paraphrase shows in Chinese');
  return bad;
}

// In the page: what the English interface says, line by line against the table.
function english(en) {
  const bad = [];
  for (const e of document.querySelectorAll('[data-i]')) if (e.textContent !== en[e.dataset.i]) bad.push(`${e.dataset.i}: "${e.textContent}"`);
  for (const e of document.querySelectorAll('[data-i-title]')) if (e.title !== en[e.dataset.iTitle]) bad.push(`${e.dataset.iTitle}: "${e.title}"`);
  for (const e of document.querySelectorAll('[data-i-aria]')) if (e.getAttribute('aria-label') !== en[e.dataset.iAria]) bad.push(`${e.dataset.iAria}: "${e.getAttribute('aria-label')}"`);
  if (document.title !== en['page.title']) bad.push('title: ' + document.title);
  if (document.documentElement.lang !== 'en') bad.push('lang: ' + document.documentElement.lang);
  const verses = [...document.querySelectorAll('.note .tr')];
  if (verses.length !== 4 || verses.some((e) => !e.textContent || getComputedStyle(e).display === 'none')) bad.push('a verse has no paraphrase showing');
  return bad;
}

// In the page: the verses one at a time, shown where they come up; where the
// paraphrase stands against the screen.
function versesShown() {
  const out = [];
  for (const el of document.querySelectorAll('.note')) {
    el.style.animation = 'none';
    el.style.opacity = '1';
    const q = el.querySelector('.q').getBoundingClientRect();
    const tr = el.querySelector('.tr').getBoundingClientRect();
    out.push({ id: el.id, belowVerse: tr.top >= q.bottom - 1, inside: tr.left >= 0 && tr.right <= innerWidth && tr.bottom <= innerHeight, width: Math.round(tr.width) });
    el.style.opacity = '';
    el.style.animation = '';
  }
  return out;
}

// In the page: the instrument put to a speed and a border 1920 m ahead, in the
// units asked, and what it says.
function instrumentStaged(spec) {
  const { hud } = window.ui;
  const was = { plan: game.worldPlan, imperial: hud.imperial, speed: hud.speed };
  game.worldPlan = () => ({ ...was.plan.call(game), next: { id: 'coast', name: 'x', ahead: spec.ahead } });
  hud.imperial = spec.imperial;
  hud.speed = spec.speed;
  hud.refresh();
  const g = (id) => document.getElementById(id).textContent;
  const p = game.road.at(game.sCar);
  const out = { speed: g('speed'), unit: g('unit'), alt: g('alt'), altUnit: g('altUnit'), where: g('where'), onGround: !!p && p.kind === 0 };
  game.worldPlan = was.plan;
  hud.imperial = was.imperial;
  hud.speed = was.speed;
  hud.refresh();
  return out;
}

// In the page: three instants of a jolt, and how far the lens is between the
// furthest of them (0 when it is held still).
function jolt() {
  const c = game.chase;
  const was = performance.now.bind(performance);
  c.shake.value = 0.2;
  const at = (ms) => {
    performance.now = () => ms;
    c.update(0, game.car, { roadY: game.car.y });
    return game.camera.position.toArray();
  };
  const p = [at(1000), at(1043), at(1087)];
  performance.now = was;
  c.shake.value = 0;
  let moved = 0;
  for (const a of p) for (const b of p) moved = Math.max(moved, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  return { shaking: c.shaking, moved };
}

// The page with nothing open, then with the panel open: two pictures.
async function pictures(page, lang, tag) {
  await page.ev(`document.getElementById('settings').hidden || document.getElementById('btnSettings').click()`);
  await sleep(300);
  await page.shot(`ui-${lang}-${tag}.png`);
  await page.click('#btnSettings');
  await sleep(500);
  await page.shot(`ui-${lang}-${tag}-panel.png`);
  await page.click('#btnSettings');
}

// What is open, checked against what should be.
async function expectOpen(page, want, what) {
  const open = await page.run(menus);
  say(open.join() === want.join(), `${what}: ${open.join(', ') || 'nothing'} open${open.join() === want.join() ? '' : ' (wanted ' + (want.join(', ') || 'nothing') + ')'}`);
}

// With each of the menus open in turn: what is to touch and is too small, what
// is off the screen, what runs out of its box.
async function sweepMenus(page, lang) {
  const small = [];
  const off = [];
  const clipped = [];
  for (const [button, what] of [['', 'bar'], ['#btnWorlds', 'worlds'], ['#btnStyles', 'styles'], ['#btnSettings', 'settings']]) {
    if (button) await page.click(button);
    if (what === 'worlds' || what === 'styles') await page.shot(`ui-${lang}-narrow-${what}.png`);
    const m = await page.run(touching);
    small.push(...m.small.map((x) => `${what}: ${x}`));
    off.push(...m.out.map((x) => `${what}: ${x}`));
    clipped.push(...(await page.run(overflowing)).map((x) => `${what}: ${x}`));
    if (button) await page.click(button);
  }
  return { small, off, clipped };
}

async function inChinese() {
  const page = await openPage({ languages: ['zh-CN'] });
  try {
    await page.goto('seed=7');
    const first = await page.ev(`(() => ({
      keys: ${JSON.stringify(SETTING_KEYS)}.filter((k) => localStorage.getItem(k) !== null),
      tier: game.tier, pinned: game.quality.pinned, cap: ui.pacer.cap, shaking: game.chase.shaking, imperial: ui.hud.imperial,
      lang: document.documentElement.lang, panelHidden: document.getElementById('settings').hidden,
      dialogs: document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]').length,
      locked: ['tier', 'cap', 'motion', 'vol', 'units', 'lang'].filter((k) => ui.settings.locked(k)),
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    }))()`);
    say(!first.keys.length && first.tier === 'high' && first.pinned === null && first.cap === 60 && first.shaking === !first.reduced && first.imperial === false
      && first.lang === 'zh-CN' && first.panelHidden && !first.dialogs && !first.locked.length,
    `a first visit changes nothing and opens nothing: tier ${first.tier} (not pinned), cap ${first.cap}, the lens ${first.shaking ? 'shakes' : 'is still (the system asks for less motion)'}, km/h, ${first.lang}, nothing kept, nothing locked`);

    // The Chinese interface, as it was.
    const bad = await page.run(wording, { lines: ZH, worlds: ZH_WORLDS, styles: ZH_STYLES });
    say(!bad.length, `the Chinese interface says what it said: ${ZH.length + ZH_WORLDS.length * 3 + ZH_STYLES.length + 4} lines, letter for letter${bad.length ? ' (' + bad.slice(0, 4).join('; ') + ')' : ''}`);

    // The three menus, one at a time.
    await page.click('#btnSettings');
    await expectOpen(page, ['settings'], 'the gear opens the panel');
    await page.click('#btnWorlds');
    await expectOpen(page, ['worlds'], 'the worlds menu opens and the panel shuts');
    await page.click('#btnStyles');
    await expectOpen(page, ['styles'], 'the styles menu opens and the worlds menu shuts');
    await page.click('#btnSettings');
    await expectOpen(page, ['settings'], 'the gear again, and the styles menu shuts');
    await page.click('#settings .lab');
    await expectOpen(page, ['settings'], 'a click inside the panel leaves it open');
    await page.clickAt(640, 330);
    await expectOpen(page, [], 'a click outside shuts it');
    await page.click('#btnWorlds');
    await page.clickAt(640, 330);
    await expectOpen(page, [], '...and the worlds menu');
    await page.click('#btnStyles');
    await page.clickAt(640, 330);
    await expectOpen(page, [], '...and the styles menu');
    await page.click('#btnSettings');
    await page.key('Escape');
    await expectOpen(page, [], 'Esc shuts the panel');

    // The keys belong to the panel while it has the focus: an arrow moves a
    // slider and does not steer the car, a letter is no shortcut, and Esc gives
    // the focus back to the gear.
    await page.click('#btnSettings');
    await page.ev(`document.getElementById('volMaster').focus()`);
    await page.keyDown('ArrowRight');
    const inPanel = await page.ev(`({ master: ui.settings.get('vol').master, steering: game.driver.keys.has('ArrowRight') })`);
    await page.keyUp('ArrowRight');
    await page.keyDown('KeyM');
    await page.keyUp('KeyM');
    const letter = await page.ev(`document.getElementById('btnSound').getAttribute('aria-pressed')`);
    await page.ev(`document.getElementById('btnSettings').focus()`);
    await page.keyDown('ArrowRight');
    const outside = await page.ev(`game.driver.keys.has('ArrowRight')`);
    await page.keyUp('ArrowRight');
    await page.ev(`document.getElementById('volMaster').focus()`);
    await page.key('Escape');
    const back = await page.ev(`({ open: !document.getElementById('settings').hidden, focus: document.activeElement.id })`);
    say(Math.abs(inPanel.master - 0.85) < 1e-9 && !inPanel.steering && outside === true && letter === 'false' && !back.open && back.focus === 'btnSettings',
      `with the focus in the panel an arrow moves the slider (to ${inPanel.master}) and does not steer (the same key outside the panel does), M is no shortcut (sound ${letter === 'false' ? 'still off' : 'on'}), and Esc shuts the panel with the focus back on the gear (${back.focus})`);

    // The lens: a jolt moves it while the shake is on.
    const on = await page.run(jolt);
    say(on.shaking === first.shaking && (first.shaking ? on.moved > 1e-4 : on.moved === 0),
      `with the shake ${first.shaking ? 'on' : 'off'}, a jolt ${first.shaking ? 'moves' : 'does not move'} the lens (${on.moved.toFixed(4)} m over three instants)`);

    // The instrument, in kilometres and in miles.
    await page.click('#btnSettings');
    await page.click('#settings [data-key="units"] [data-v="mph"]');
    const kmh = await page.run(instrumentStaged, { speed: 100, ahead: 1920, imperial: false });
    const mph = await page.run(instrumentStaged, { speed: 100, ahead: 1920, imperial: true });
    const speeds = [];
    for (const v of [0, 37, 88, 100, 120, 143, 200]) speeds.push([v, (await page.run(instrumentStaged, { speed: v, ahead: 1920, imperial: true })).speed]);
    say(speeds.every(([v, got]) => got === String(Math.round(v * 0.6214))) && kmh.unit === 'km/h' && mph.unit === 'mph' && kmh.speed === '100' && mph.speed === '62',
      `in mph the speed is 0.6214 of the km/h, rounded (${speeds.map(([v, g]) => `${v}→${g}`).join(' ')}), and the unit is ${mph.unit}, not ${kmh.unit}`);
    say(mph.altUnit === 'ft' && kmh.altUnit === 'm' && Math.abs(Number(mph.alt) - Number(kmh.alt) * 3.28084) <= 2.5
      && (!kmh.onGround || (kmh.where === '距沿海 1.9 km' && mph.where === '距沿海 1.2 mi')),
    `...the altitude in feet (${kmh.alt} ${kmh.altUnit}, ${mph.alt} ${mph.altUnit}) and the distance to the border ("${kmh.where}", "${mph.where}"${kmh.onGround ? '' : ', the car is on a structure: not read'})`);
    results.units = { speeds, kmh, mph };
    await page.click('#settings [data-key="units"] [data-v="kmh"]');

    // The tier changes without the canvas being made again.
    const timing = await page.ev(`(() => {
      const canvas = document.getElementById('view');
      const button = (v) => document.querySelector('#settings [data-key="tier"] [data-v="' + v + '"]');
      // A frame, to the end of its drawing: a pixel read back waits for it.
      const gl = game.renderer.getContext();
      const px = new Uint8Array(4);
      const frame = () => {
        const t0 = performance.now();
        game.render();
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return performance.now() - t0;
      };
      frame();
      const before = frame();
      const times = [];
      const after = [];
      for (let i = 0; i < 3; i++) {
        button('high').click();
        const t0 = performance.now();
        button('low').click();
        times.push(performance.now() - t0);
        after.push(frame());
      }
      const low = game.tier;
      button('auto').click();
      return { times, before, after, low, same: document.getElementById('view') === canvas && game.canvas === canvas && game.renderer.domElement === canvas, pinned: game.quality.pinned };
    })()`);
    const median = [...timing.times].sort((a, b) => a - b)[1];
    say(timing.same && timing.low === 'low' && timing.pinned === null && median <= 50,
      `high to low: the canvas is the same element, the switch takes ${timing.times.map((x) => x.toFixed(1)).join(', ')} ms (median ${median.toFixed(1)}, at most 50); the whole frame drawn after each takes ${timing.after.map((x) => x.toFixed(0)).join(', ')} ms against ${timing.before.toFixed(0)} before it (drawn in software; the machine may be busy, so this is told, not held)`);
    results.tier = timing;
    await page.click('#settings [data-key="tier"] [data-v="auto"]');
    await page.click('#btnSettings');

    // Pictures, and the phone.
    await pictures(page, 'zh', 'desktop');
    await page.size(390, 844);
    await pictures(page, 'zh', 'narrow');
    const phone = await sweepMenus(page, 'zh');
    say(!phone.small.length && !phone.off.length,
      `on a phone (390 x 844) nothing to touch is under 40 x 40 and no panel leaves the screen${phone.small.length ? ' (small: ' + phone.small.slice(0, 4) + ')' : ''}${phone.off.length ? ' (off: ' + phone.off.slice(0, 3) + ')' : ''}`);
    results.phoneZh = phone;
    await page.size(1280, 720);

    // What is set stays: each setting changed in the panel, then the page opened again.
    await page.click('#btnSettings');
    await page.click('#settings [data-key="tier"] [data-v="low"]');
    await page.click('#settings [data-key="cap"] [data-v="30"]');
    await page.click('#settings [data-key="motion"] [data-v="0"]');
    await page.ev(`(() => {
      for (const [bus, v] of [['master', 0.5], ['car', 0.4], ['ambient', 0.3]]) {
        const r = document.querySelector('#settings input[data-bus="' + bus + '"]');
        r.value = String(v);
        r.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
    await page.click('#settings [data-key="units"] [data-v="mph"]');
    await page.click('#settings [data-key="lang"] [data-v="en"]');
    const kept = await stored(page);
    const live = await page.ev(`({ tier: game.tier, pinned: game.quality.pinned, cap: ui.pacer.cap, shaking: game.chase.shaking, imperial: ui.hud.imperial, lang: document.documentElement.lang })`);
    const lens = await page.run(jolt);
    say(kept['continuum.tier'] === 'low' && kept['continuum.cap'] === '30' && kept['continuum.motion'] === '0' && kept['continuum.units'] === 'mph'
      && kept['continuum.lang'] === 'en' && kept['continuum.vol'] === '{"master":0.5,"car":0.4,"ambient":0.3}',
    `each change is kept: ${Object.entries(kept).map(([k, v]) => k.slice(10) + '=' + v).join(' ')}`);
    say(live.tier === 'low' && live.pinned === 'low' && live.cap === 30 && live.shaking === false && live.imperial === true && live.lang === 'en' && lens.moved === 0,
      `...and takes hold at once, with no reload: tier ${live.tier}, cap ${live.cap}, the lens still (${lens.moved} m), miles, ${live.lang}`);
    await page.click('#btnSound');
    await sleep(600);
    const sound = await page.ev(`ui.sound ? { master: ui.sound.volume.master, car: ui.sound.volume.car, ambient: ui.sound.volume.ambient, state: ui.sound.ctx.state } : null`);
    say(!!sound && Math.abs(sound.master - 0.5 / MASTER_UNITY) < 1e-9 && sound.car === 0.4 && sound.ambient === 0.3,
      `the sound made after is at the levels (the whole ${sound && sound.master}, car ${sound && sound.car}, ambience ${sound && sound.ambient})`);
    await page.click('#btnSound');
    const before = JSON.stringify(await page.ev('ui.settings.values'));

    await page.goto('seed=7');
    const again = await page.ev(`({
      tier: game.tier, pinned: game.quality.pinned, cap: ui.pacer.cap, shaking: game.chase.shaking, imperial: ui.hud.imperial,
      lang: document.documentElement.lang, values: JSON.stringify(ui.settings.values), unit: document.getElementById('unit').textContent,
    })`);
    await page.click('#btnSettings');
    const shown = await page.run(panelState);
    const lens2 = await page.run(jolt);
    say(again.values === before && again.tier === 'low' && again.pinned === 'low' && again.cap === 30 && again.shaking === false && again.imperial === true
      && again.lang === 'en' && again.unit === 'mph' && lens2.moved === 0,
    `opened again: still tier ${again.tier}, cap ${again.cap}, the lens still, ${again.unit}, ${again.lang} (the browser says zh-CN)`);
    const r = shown.rows;
    say(r.tier.chosen.join() === 'low' && r.cap.chosen.join() === '30' && r.motion.chosen.join() === '0' && r.units.chosen.join() === 'mph' && r.lang.chosen.join() === 'en'
      && shown.vol.master === 0.5 && shown.vol.car === 0.4 && shown.vol.ambient === 0.3 && Object.values(r).every((x) => x.disabled === 0 && !x.note),
    `...and the panel shows them (${Object.entries(r).map(([k, x]) => k + '=' + x.chosen).join(' ')}, volume ${shown.vol.master}/${shown.vol.car}/${shown.vol.ambient}), none locked, the scene drawn at ${shown.res}`);
    await page.click('#btnSound');
    await sleep(800);
    const sound2 = await page.ev(`ui.sound ? { master: ui.sound.volume.master, car: ui.sound.carBus.gain.value, ambient: ui.sound.ambientBus.gain.value, state: ui.sound.ctx.state } : null`);
    if (sound2 && sound2.state === 'running') {
      say(Math.abs(sound2.car - 0.4) < 0.02 && Math.abs(sound2.ambient - 0.3) < 0.02 && Math.abs(sound2.master - 0.625) < 1e-9,
        `the sound's own gains came to the car's ${sound2.car.toFixed(3)} and the ambience's ${sound2.ambient.toFixed(3)}`);
    } else {
      say(!!sound2 && Math.abs(sound2.master - 0.625) < 1e-9, `the sound is at the levels the page was opened with (its audio clock is ${sound2 && sound2.state}, so its gains were not read)`);
    }
    results.kept = { kept, again };

    // English chosen in the panel is English all through.
    const chosenText = await page.run(chinese);
    const chosenOver = await page.run(overflowing);
    say(!chosenText.length && !chosenOver.length,
      `English chosen in the panel is English all through: ${chosenText.length} places with Chinese in them, ${chosenOver.length} boxes overrun${chosenText.length ? ' (' + chosenText.slice(0, 3) + ')' : ''}${chosenOver.length ? ' (' + chosenOver.slice(0, 3) + ')' : ''}`);
    await page.click('#btnSettings');

    // The address over what was chosen, in Chinese: tier=low shows 低, greyed.
    await page.goto('seed=7&tier=low&lang=zh');
    await page.click('#btnSettings');
    const zhLocked = await page.run(panelState);
    const z = zhLocked.rows;
    await page.click('#settings [data-key="tier"] [data-v="high"]');
    const stays = await page.ev(`({ tier: game.tier, pinned: game.quality.pinned, kept: localStorage.getItem('continuum.tier'), lang: document.documentElement.lang })`);
    say(z.tier.chosenText.join() === '低' && z.tier.disabled === z.tier.options && z.tier.note === '由地址栏指定'
      && z.lang.chosenText.join() === '中文' && z.lang.disabled === z.lang.options && z.cap.disabled === 0 && z.cap.chosen.join() === '30'
      && stays.tier === 'low' && stays.pinned === 'low' && stays.kept === 'low' && stays.lang === 'zh-CN',
    `with tier=low in the address the panel shows ${z.tier.chosenText}, greyed, with "${z.tier.note}" beside it, and clicking 高 changes nothing (tier ${stays.tier}); lang=zh is over the English that was chosen`);
    say(!page.errors.length, `the Chinese page's console is clean${page.errors.length ? ' (' + page.errors.slice(0, 2) + ')' : ''}`);
  } finally {
    page.close();
  }
}

async function inEnglish() {
  // lang=en, tier=low and cap=30 in the address, over a store that says
  // otherwise.
  const page = await openPage({
    languages: ['zh-CN'],
    before: `localStorage.setItem('continuum.tier', 'high'); localStorage.setItem('continuum.lang', 'zh'); localStorage.setItem('continuum.cap', '0');`,
  });
  try {
    await page.goto('seed=7&lang=en&tier=low&cap=30');
    const live = await page.ev(`({ tier: game.tier, pinned: game.quality.pinned, cap: ui.pacer.cap, lang: document.documentElement.lang })`);
    say(live.tier === 'low' && live.pinned === 'low' && live.cap === 30 && live.lang === 'en', `the address wins: tier ${live.tier}, cap ${live.cap}, ${live.lang}, over a store of high, 0 and zh`);
    await page.click('#btnSettings');
    const r = (await page.run(panelState)).rows;
    say(r.tier.chosen.join() === 'low' && r.tier.disabled === r.tier.options && r.tier.note === 'Set by the address bar'
      && r.cap.chosen.join() === '30' && r.cap.disabled === r.cap.options && r.cap.note !== ''
      && r.lang.chosen.join() === 'en' && r.lang.disabled === r.lang.options && r.lang.note !== ''
      && r.motion.disabled === 0 && !r.motion.note && r.units.disabled === 0 && !r.units.note,
    `with tier=low in the address the panel shows low, greyed, with "${r.tier.note}" beside it (cap and lang the same; motion and units free)`);
    await page.click('#settings [data-key="tier"] [data-v="high"]');
    await page.click('#settings [data-key="cap"] [data-v="0"]');
    await page.click('#settings [data-key="lang"] [data-v="zh"]');
    const still = await page.ev(`({ tier: game.tier, cap: ui.pacer.cap, lang: document.documentElement.lang, set: ui.settings.set('tier', 'high') })`);
    const kept = await stored(page);
    say(still.tier === 'low' && still.cap === 30 && still.lang === 'en' && still.set === false
      && kept['continuum.tier'] === 'high' && kept['continuum.cap'] === '0' && kept['continuum.lang'] === 'zh',
    'clicking them does nothing, and the store is as it was');
    await page.click('#btnSettings');

    // The English interface.
    const words = await page.run(english, TABLES.en);
    say(!words.length, `every line of the English page is the table's${words.length ? ' (' + words.slice(0, 4).join('; ') + ')' : ''}`);
    await page.click('#btnWorlds');
    const worlds = await page.ev(`[...document.querySelectorAll('#worldList .nm')].map((e) => e.textContent).join()`);
    await page.click('#btnStyles');
    const styles = await page.ev(`[...document.querySelectorAll('#styleList .nm')].map((e) => e.textContent).join()`);
    await page.click('#btnStyles');
    say(worlds === WORLDS.map((w) => w.id[0].toUpperCase() + w.id.slice(1)).join() && styles === 'Real,Paint,Ink,Cel,Print,Pixel,Block', `the menus list ${worlds}; ${styles}`);

    const text = [];
    const over = [];
    for (const [button, what] of [['', 'bar'], ['#btnWorlds', 'worlds'], ['#btnStyles', 'styles'], ['#btnSettings', 'settings']]) {
      if (button) await page.click(button);
      text.push(...(await page.run(chinese)).map((x) => `${what}: ${x}`));
      over.push(...(await page.run(overflowing)).map((x) => `${what}: ${x}`));
      if (button) await page.click(button);
    }
    const startup = await page.ev(`document.getElementById('bootMsg') ? document.getElementById('bootMsg').textContent : ''`);
    say(!text.length, `no Chinese character in the English page, its attributes and its title, but for the verses (and the startup screen's "${startup}")${text.length ? ' (' + text.slice(0, 4).join('; ') + ')' : ''}`);
    say(!over.length, `no button's text runs out of its box, in the bar and in the three menus${over.length ? ' (' + over.slice(0, 4).join('; ') + ')' : ''}`);
    const verses = await page.run(versesShown);
    say(verses.length === 4 && verses.every((v) => v.belowVerse && v.inside), `a line of paraphrase hangs under each verse, on the screen (${verses.map((v) => v.id.replace('note', '') + ' ' + v.width + ' px').join(', ')})`);
    results.verses = verses;

    // Pictures: each verse as it comes up, then the page on a wide screen and on a phone.
    // (The wall's verse comes up in wallpaper mode, with the rest of the interface gone.)
    for (const name of ['wall', 'pass', 'turn', 'ink']) {
      await page.ev(`(() => { const e = document.getElementById('${name}note'); e.style.animation = 'none'; e.style.opacity = '1'; document.body.classList.toggle('wallpaper', '${name}' === 'wall'); })()`);
      await page.shot(`ui-en-verse-${name}.png`);
      await page.ev(`(() => { const e = document.getElementById('${name}note'); e.style.animation = ''; e.style.opacity = ''; document.body.classList.remove('wallpaper'); })()`);
    }
    await pictures(page, 'en', 'desktop');
    await page.size(390, 844);
    await pictures(page, 'en', 'narrow');
    const phone = await sweepMenus(page, 'en');
    say(!phone.small.length && !phone.off.length,
      `on a phone, in English: nothing to touch is under 40 x 40 and no panel leaves the screen${phone.small.length ? ' (small: ' + phone.small.slice(0, 4) + ')' : ''}${phone.off.length ? ' (off: ' + phone.off.slice(0, 3) + ')' : ''}`);
    say(!phone.clipped.length, `...and no button's text runs out of its box${phone.clipped.length ? ' (' + phone.clipped.slice(0, 4) + ')' : ''}`);
    const versesPhone = await page.run(versesShown);
    say(versesPhone.every((v) => v.belowVerse && v.inside), `...and the paraphrases are on the screen (${versesPhone.map((v) => v.width + ' px').join(', ')})`);
    results.phoneEn = phone;
    say(!page.errors.length, `the English page's console is clean${page.errors.length ? ' (' + page.errors.slice(0, 2) + ')' : ''}`);
  } finally {
    page.close();
  }

  // English because the browser says so; the shake off because the system asks.
  const page2 = await openPage({ languages: ['en-US', 'en'], reduceMotion: true });
  try {
    await page2.goto('seed=7');
    const d = await page2.ev(`({ lang: document.documentElement.lang, shaking: game.chase.shaking, keys: ${JSON.stringify(SETTING_KEYS)}.filter((k) => localStorage.getItem(k) !== null),
      locked: ['lang', 'motion'].filter((k) => ui.settings.locked(k)) })`);
    await page2.click('#btnSettings');
    const shown = await page2.run(panelState);
    const text = await page2.run(chinese);
    const over = await page2.run(overflowing);
    say(d.lang === 'en' && !d.keys.length && !d.locked.length && shown.rows.lang.chosen.join() === 'en' && !text.length && !over.length,
      `with the browser's language English and nothing chosen: the interface is English, in the panel too, nothing is kept (${text.length} places with Chinese, ${over.length} boxes overrun)`);
    say(d.shaking === false && shown.rows.motion.chosen.join() === '0', 'with the system asking for less motion the lens is still and the panel says off');
    await page2.click('#settings [data-key="motion"] [data-v="1"]');
    const on = await page2.ev(`({ shaking: game.chase.shaking, kept: localStorage.getItem('continuum.motion') })`);
    say(on.shaking === true && on.kept === '1', 'and the shake can be turned on against what the system asks');
    say(!page2.errors.length, `the console is clean${page2.errors.length ? ' (' + page2.errors.slice(0, 2) + ')' : ''}`);
  } finally {
    page2.close();
  }
}

// --- run -----------------------------------------------------------------------

strings();
instrument();
settings();
game();
const kill = () => { for (const p of open) p.close(); };
process.on('SIGINT', () => { kill(); process.exit(130); });

const server = serve();
try {
  if (!(await waitForServer())) throw new Error('server did not start');
  await inChinese();
  await inEnglish();
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
  writeFileSync(OUT + 'ui_check.json', JSON.stringify(results, null, 2));
} catch { /* the pictures are what is wanted */ }
if (failed) {
  console.error(`\n${failed} problem${failed > 1 ? 's' : ''}`);
  process.exit(1);
}
console.error('\nOK: the settings are kept and take hold, the address bar wins, and the interface is in English and in Chinese');
process.exit(0);
