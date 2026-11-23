// The settings panel, the interface in English, and what tells the visitor
// where the road has come to: the name of a world, the quiet instrument, the
// strips in the world menu and the hint of a first visit.
//
// In node, without a browser:
//  - the strings: both languages have the same keys, every key the page and the
//    modules ask for is in the table and none is left unasked, the English has
//    no Chinese character in it, each verse has a line of paraphrase under it
//    in English and none in Chinese, the names of the worlds and the styles
//    are the data's own in Chinese and the id with a capital in English, each
//    world has a line of its own (ten characters at most in Chinese, eight
//    words in English) and the hint of a first visit is in both;
//  - the instrument writes the Chinese it always wrote (a sweep of grades,
//    lengths and distances against the formulas as they were), writes the
//    English, and writes mph and feet;
//  - what is set: the address bar over what was chosen over what the system
//    says; a headless run takes the address only; a value the address gave
//    cannot be changed; every change is kept and told once;
//  - the tier is pinned and let go, the frame cap changes the pacer's pace,
//    and the sound's three levels sit in its graph where they should;
//  - the name of a world: a border is named once, when the camera first passes
//    its middle, not when it swings across it or comes back over it, not where
//    the page is opened inside one, and the name waits behind a verse;
//  - the quiet instrument: it goes quiet after 30 s of no input and not before,
//    only while the autopilot drives and no menu is open, and each kind of
//    input (key, pointer, wheel, touch, gamepad) brings it back;
//  - the hint of a first visit comes up once for a browser that can keep the
//    mark, and not for a headless run or a browser that cannot;
//  - the twelve strips of the world menu are made of the world's own colours
//    (sky top, sky at the horizon, one colour of the ground), and no two are
//    alike: the distance of two strips is the mean of the OKLab distances of
//    their three bands, over 0.05 (the distance between their mean colours is
//    told as well, and the widest band's: the daylight worlds have almost the
//    same sky, so the mean colours of some are closer than 0.05);
//  - the three skies of a day world (noon, golden, grey) are named in both
//    languages, held by a pin that is kept as continuum.sky for a day world and
//    a sky there is, the address (sky=) over any pin and a headless run keeping
//    and reading none, and their dots are painted in the sky's own colours, no
//    two of a world's alike.
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
//  - in the photo mode (K, with a menu open to be put away) the page's own
//    interface steps aside, the name, the hint and a verse stay down, forty
//    seconds with nothing touched do not quiet the page, and the bar is on the
//    screen with each of its buttons at least 40 x 40, no word out of its box
//    and, in English, no Chinese: wide and on a phone, both languages; the
//    button that goes in is left out of the bar where there is no fine
//    pointer;
//  - the bar of the photo mode has the depth of field's switch and two sliders as
//    well (the aperture, f/1.4 to f/16, and the exposure compensation, 2 EV either
//    way): each 40 x 40 or more, all of it on the screen, in one row on a wide
//    screen and in two on a phone, and in English no Chinese; the switch turns the
//    depth of field on (its programs are built first, and it is on when they are),
//    the aperture slider is dim and still while it is off, the arrow keys move the
//    sliders and the chain has what they say, the line over the bar says to tap
//    the frame and is clear of the bar, and going out puts all of it back;
//  - in mph the speed is 0.6214 of the km/h, and the unit's word changes;
//  - as the road comes into each of three worlds (worldlen=2500, the car driven
//    by the autopilot and stepped by hand in the page, 0.1 s a step: the
//    frames of a page drawn in software come too slowly to wait for the
//    borders, 2.5 km apart) the right world's name comes up, in Chinese and in
//    English, with its line under it, and stays 3.5 to 4.5 s (the animation's
//    own length and keyframes are read as well); in wallpaper mode too; behind
//    a verse it comes four seconds late;
//  - after 30 s with no input the instrument and the buttons are at 0.35, and
//    after one input they are back at 1 in a transition of 0.3 s; they stay
//    when the car is driven by hand and when a menu is open;
//  - the twelve strips in the world menu, in front of the names, are painted
//    in the world's own colours and no two of them are alike (the mean of the
//    OKLab distances of their three bands, over 0.05);
//  - the name, the instrument, the buttons, the verses, the menus and the hint
//    do not stand over one another, on a wide screen and on a phone, and the
//    name and the hint do not leave the screen;
//  - the hint of a first visit comes up in a browser with nothing kept, goes
//    after eight seconds, and is not there when the page is opened again;
//  - a headless page (run=) shows no name, no hint and no quiet;
//  - the world menu has a row of three dots at the end of each of the six day
//    worlds' rows (and none on the others), each 40 x 40 or more (on a phone,
//    390 x 844, too), named in the language, in the colours of the sky it is,
//    and a click holds the world to that sky (kept, and the road is under it),
//    the same dot again lets go; opened again the pins are still there; sky=
//    in the address holds every day world, the dots are still and say so, and
//    what was kept is as it was; a headless page reads none of it.
// Pictures of the page, in both languages, on a wide screen and a phone, with
// the panel open and shut, the name, the world menu and the hint, are written
// to out/ui (OUT=dir moves them).
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
import { TABLES, setLang, worldName, styleName, skyName, detectLang } from '../src/ui/strings.js';
import { Pacer } from '../src/render/pacing.js';
import { Quality } from '../src/render/quality.js';
import { TUNNEL, BRIDGE, STEP } from '../src/world/road.js';
import { WORLDS, WORLD_INDEX, SKIES, SKY_INDEX, hasSkies, skyLook } from '../src/world/worlds.js';
import { WorldName, SHOW_MS as NAME_MS, AFTER_VERSE, LOOK_MS } from '../src/ui/worldname.js';
import { Idle, IDLE_MS, WAKE_MS } from '../src/ui/idle.js';
import { FirstHint, HINT_KEY, SHOW_MS as HINT_MS, AFTER_MS as AFTER_HINT } from '../src/ui/hint.js';
import { swatchOf, skySwatchOf, GROUND } from '../src/ui/swatch.js';

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

// sRGB (0 to 255 a channel) in OKLab, and how far apart two colours are in it.
function oklab([r, g, b]) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const rgbOf = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];

// How far apart two strips (three colours each: sky top, sky at the horizon,
// ground) are: the mean of the three bands' OKLab distances, which is what the
// checks hold to 0.05. For the record, the distance between their mean colours
// and the largest band's.
function stripsApart(a, b) {
  const d = [0, 1, 2].map((i) => apart(a[i], b[i]));
  const mean = (s) => [0, 1, 2].map((k) => (s[0][k] + s[1][k] + s[2][k]) / 3);
  return { bands: (d[0] + d[1] + d[2]) / 3, whole: apart(mean(a), mean(b)), widest: Math.max(...d) };
}

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

  // The line under the name of each world, and the hint of a first visit.
  const lineKeys = WORLDS.map((w) => 'world.line.' + w.id);
  const lines = lineKeys.map((k) => [TABLES.zh[k], TABLES.en[k]]);
  const strays = zh.filter((k) => k.startsWith('world.line.') && !lineKeys.includes(k));
  const longest = Math.max(...lines.map(([a]) => [...(a || '')].length));
  const wordiest = Math.max(...lines.map(([, b]) => (b || '').trim().split(/\s+/).length));
  say(lines.every(([a, b]) => a && b) && !strays.length && longest <= 10 && wordiest <= 8
    && new Set(lines.map(([a]) => a)).size === lines.length && new Set(lines.map(([, b]) => b)).size === lines.length,
  `each of the ${WORLDS.length} worlds has a line of its own in both languages (Chinese up to ${longest} characters, English up to ${wordiest} words), and none is for a world that is not there${strays.length ? ' (' + strays + ')' : ''}`);
  say(TABLES.zh['hint.first'] === '它自己会开。按 P 接手。' && TABLES.en['hint.first'] === 'It drives itself. Press P to take over.'
    && HINT_KEY === 'continuum.hint', `the hint of a first visit is "${TABLES.zh['hint.first']}" and "${TABLES.en['hint.first']}", kept as ${HINT_KEY}`);
  results.lines = Object.fromEntries(WORLDS.map((w, i) => [w.id, { zh: lines[i][0], en: lines[i][1] }]));

  // The three skies of a day world, and the dots that hold a world to one.
  const skyKeys = SKIES.map((id) => 'sky.' + id);
  say(SKIES.join() === 'noon,golden,grey' && skyKeys.every((k) => TABLES.zh[k] && TABLES.en[k]) && skyKeys.map((k) => TABLES.zh[k]).join() === '正午,金色,阴天'
    && SKIES.every((id) => TABLES.en['sky.' + id] === id[0].toUpperCase() + id.slice(1)) && TABLES.zh['sky.of'].includes('{name}') && TABLES.en['sky.of'].includes('{name}'),
  `the three skies have names in both languages (${skyKeys.map((k) => TABLES.zh[k]).join(' ')}; ${skyKeys.map((k) => TABLES.en[k]).join(' ')}: the ids with a capital, as the worlds and the styles have), and the group of dots a name with the world's in it`);

  const styles =[...read('src/render/style.js').matchAll(/\{ id: '(\w+)', name: '([^']+)' \}/g)].map((m) => ({ id: m[1], name: m[2] }));
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

  const names = { chase: '追车', director: '导演', drone: '航拍', side: '侧拍', low: '低机位', front: '正面', hood: '引擎盖', other: '机位' };
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
  `each is kept as ${Object.values(KEYS).filter((x) => x !== KEYS.sky).join(', ')}`);

  // The skies a visitor holds the day worlds to: kept as JSON, only a day world and a
  // sky there is; let go with null; the address holds them all and is over what was
  // kept; a headless run reads and keeps none.
  const sk = make('', { storage: mem() });
  const skyTold = [];
  sk.onChange((key, v) => skyTold.push([key, v]));
  const held = [sk.pinSky('hills', 'golden'), sk.pinSky('hills', 'golden'), sk.pinSky('city', 'grey'), sk.pinSky('coast', 'night'), sk.pinSky('coast', 'grey')];
  say(eq(held, [true, false, false, false, true]) && sk.skyPin('hills') === 'golden' && sk.skyPin('coast') === 'grey' && sk.skyPin('river') === null && sk.skyPin('city') === null
    && eq(sk.get('sky'), { hills: 'golden', coast: 'grey' }) && sk.storage.getItem(KEYS.sky) === '{"hills":"golden","coast":"grey"}' && skyTold.length === 2 && KEYS.sky === 'continuum.sky',
  `a world is held to a sky (kept as ${KEYS.sky}: ${sk.storage.getItem(KEYS.sky)}), a repeat, a night world and a sky that is not one are not, each change is told once`);
  const letGo = [sk.pinSky('hills', null), sk.pinSky('hills', null)];
  say(eq(letGo, [true, false]) && sk.skyPin('hills') === null && sk.storage.getItem(KEYS.sky) === '{"coast":"grey"}',
    `held to none, a world goes by its laps again (${sk.storage.getItem(KEYS.sky)} is kept)`);
  const again = make('', { storage: mem({ [KEYS.sky]: '{"coast":"grey","hills":"golden","city":"noon","river":"night"}' }) });
  const worn = ['{', '["golden"]', '"golden"', '{"hills":7}'].map((text) => make('', { storage: mem({ [KEYS.sky]: text }) }).get('sky'));
  say(eq(again.get('sky'), { hills: 'golden', coast: 'grey' }) && worn.every((v) => eq(v, {})),
    'what was kept is read back for the day worlds and the skies there are, and a store that is no map is none');
  const addr = make('sky=golden', { storage: mem({ [KEYS.sky]: '{"coast":"grey"}' }) });
  const kept = addr.storage.getItem(KEYS.sky);
  say(addr.locked('sky') && addr.skyAll() === 'golden' && addr.skyPin('hills') === 'golden' && addr.skyPin('coast') === 'golden' && addr.pinSky('hills', 'grey') === false
    && addr.storage.getItem(KEYS.sky) === kept && eq(addr.get('sky'), { coast: 'grey' }) && make('sky=GREY').skyPin('desert') === 'grey'
    && !make('sky=night').locked('sky') && make('sky=night').skyAll() === undefined && !make('').locked('sky') && make('').skyAll() === undefined,
  'sky=golden in the address holds every day world to golden over a world held to grey, cannot be changed, leaves what was kept as it was, and is no sky when it names none');
  const headlessSky = make('sky=grey', { run: true, storage: mem({ [KEYS.sky]: '{"coast":"golden"}' }) });
  const quiet = make('', { run: true, storage: mem({ [KEYS.sky]: '{"coast":"golden"}' }) });
  const store = quiet.storage;
  say(headlessSky.skyPin('coast') === 'grey' && quiet.skyPin('coast') === null && eq(quiet.get('sky'), {}) && quiet.pinSky('hills', 'golden') === true && quiet.skyPin('hills') === 'golden',
    'a headless run takes the address and not what was kept (a pin of its own is held in it, and kept nowhere)');
  void store;
}

function game() {
  // The tier: pinned, let go, and the pin holds as the level goes down.
  const tiers = [];
  const stub = {
    setTier: (v) => tiers.push(v), setRenderScale() {}, setDetail() {},
    atmosphere: { setShadowSize() {} },
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
    createBufferSource: () => ({ ...node('source'), playbackRate: param() }), createConvolver: () => node('convolver'),
    createDynamicsCompressor: () => ({ ...node('comp'), threshold: param(), ratio: param(), knee: param(), attack: param(), release: param() }),
    createStereoPanner: () => ({ ...node('panner'), pan: param() }),
    createBuffer: (ch, n) => ({ getChannelData: () => new Float32Array(n) }),
  };
  const sound = new Sound(ctx);
  const into = (a, b) => a.edges.includes(b);
  say(into(sound.car, sound.carBus) && !into(sound.car, sound.medium) && into(sound.carBus, sound.medium) && sound.carBus.edges.some((n) => n.kind === 'convolver')
    && into(sound.windGain, sound.ambientBus) && into(sound.turnGain, sound.ambientBus) && into(sound.subGain, sound.ambientBus)
    && into(sound.air, sound.ambientBus) && into(sound.ambientBus, sound.medium) && !into(sound.windGain, sound.medium),
  'in the sound\'s graph the car goes through the car\'s level and the wind, the turning and the air through the ambience\'s, both into the medium');
  // What is new in it sits where it should: a limiter is the last of the graph (the trim takes off the gain it adds), the
  // ground and the squeal are the car's, the other cars' hum is the ambience's.
  const comp = sound.master.edges[0];
  say(into(comp, sound.limiter) && into(sound.limiter, sound.trim) && into(sound.trim, ctx.destination) && !into(comp, ctx.destination)
    && sound.limiter.threshold.value === -6 && sound.limiter.ratio.value === 12 && Math.abs(sound.trim.gain.value - 0.684) < 1e-3,
  `the limiter (${sound.limiter.threshold.value} dB, ${sound.limiter.ratio.value} to 1) is the last of the graph, with the trim that takes off its makeup (${sound.trim.gain.value.toFixed(3)}) after it`);
  say(into(sound.squealGain, sound.car) && into(sound.surface, sound.car) && sound.voices.length === 3 && sound.voices.every((v) => into(v.place, sound.ambientBus)),
    'the squeal and the ground go through the car\'s level, the hum of three other cars through the ambience\'s, each from a place of its own');
  // What happens while the audio clock stands is not heard when it goes on again; what happens after is.
  let made = 0;
  const sleeper = new Sound({ ...ctx, createOscillator: () => { made++; return node('osc'); } });
  const drive = { speed: 20, throttle: 0.5, lift: 1, a: 0, b: 0, blend: 0, inside: 0, distance: 8, on: 1, strikes: 2, lands: 3, bumps: 4, bump: { kind: 'tree', speed: 20, pan: 0 }, time: 1 };
  const before = made;
  sleeper.skip({ ...drive, on: 0 });
  sleeper.update(drive, 1);
  const was = made;
  sleeper.update({ ...drive, lands: 4, time: 1.1 }, 1.1);
  say(was === before && made > was, `what happened while the audio clock stood is not heard when it goes on again (${was - before} tones made), and a landing after it is (${made - was})`);
  sound.setCalm(true);
  say(sound.trembleLevel.gain.last[0] === 0 && sound.trembleBand.gain.last[0] === 0, 'a sound that is to keep still has no tremble in the squeal');
  sound.setCalm(false);
  say(sound.trembleLevel.gain.last[0] > 0 && sound.trembleBand.gain.last[0] > 0, '...and a sound that is not has it');
  sound.setVolume({ master: 0.625, car: 0.4, ambient: 0.3 });
  sound.update({ speed: 20, throttle: 0.5, lift: 1, a: 0, b: 0, blend: 0, inside: 0, distance: 8, on: 1 }, 1);
  say(sound.carBus.gain.last[0] === 0.4 && sound.ambientBus.gain.last[0] === 0.3 && Math.abs(sound.master.gain.last[0] - 1.6 * 0.625) < 1e-12,
    `the levels are set (car ${sound.carBus.gain.last[0]}, ambience ${sound.ambientBus.gain.last[0]}, the whole ${sound.master.gain.last[0]})`);
  const fresh = new Sound(ctx);
  fresh.update({ speed: 20, throttle: 0.5, lift: 1, a: 0, b: 0, blend: 0, inside: 0, distance: 8, on: 1 }, 1);
  say(fresh.master.gain.last[0] === 1.6 && fresh.carBus.gain.value === 1 && fresh.ambientBus.gain.value === 1 && MASTER_UNITY / MASTER_UNITY === 1,
    `the levels untouched leave the sound as it was (the whole at ${fresh.master.gain.last[0]}, the car's and the ambience's at 1; ${MASTER_UNITY} on the slider is 1 times)`);
}

// An element as far as the name and the quiet instrument use one.
function stub() {
  const cls = new Set();
  const parts = { '.nm': { textContent: '' }, '.ln': { textContent: '' } };
  const listeners = {};
  return {
    cls,
    parts,
    listeners,
    addEventListener: (type, fn) => { listeners[type] = fn; },
    offsetWidth: 0,
    classList: {
      add: (c) => cls.add(c),
      remove: (c) => cls.delete(c),
      contains: (c) => cls.has(c),
      toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)),
    },
    querySelector: (s) => parts[s],
    getAnimations: () => [],
  };
}

// The name of a world: when the camera is walked by hand across borders, which
// worlds are named.
function nameOfAWorld() {
  // steps: [from, to, t] as Game.worldHere says it, one every look; verse: one is up.
  const walk = (steps, verse = false) => {
    let now = null;
    const game = { sCar: 0, worldHere: () => ({ fromId: now[0], toId: now[1], t: now[2] }) };
    const up = stub();
    if (verse) up.cls.add('show');
    const el = stub();
    const name = new WorldName(game, el, { verses: [up] });
    for (const s of steps) {
      now = s;
      name.update(LOOK_MS / 1000);
    }
    const shown = el.cls.has('show');
    // The animation ends: the class comes off.
    el.listeners.animationend({ target: el });
    const ended = !el.cls.has('show');
    clearTimeout(name.timer);
    const waiting = name.wait;
    clearTimeout(name.wait);
    return { named: name.shown.map((x) => x.id).join(), waiting: !!waiting, shown, ended };
  };
  const ramp = (a, b, ts) => ts.map((t) => [a, b, t]);
  const forward = walk([...ramp('alpine', 'hills', [0, 0.2, 0.49, 0.5, 0.7, 1]), ...ramp('hills', 'river', [0, 0.3, 0.49, 0.5, 0.9])]).named;
  const wobble = walk(ramp('alpine', 'hills', [0.3, 0.49, 0.51, 0.49, 0.52, 0.45, 0.55])).named;
  const back = walk(ramp('alpine', 'hills', [0.3, 0.6, 0.45, 0.25, 0.1, 0.6])).named;
  const opened = walk(ramp('alpine', 'hills', [0.7, 0.55, 0.3, 0.6])).named;
  const jumped = walk([['alpine', 'hills', 0.8], ['hills', 'river', 0.1], ['river', 'coast', 0.7]]).named;
  const alone = walk(ramp('alpine', 'alpine', [0, 0.5, 1])).named;
  const clear = walk(ramp('alpine', 'hills', [0.3, 0.6]));
  const behind = walk(ramp('alpine', 'hills', [0.3, 0.6]), true);
  say(forward === 'hills,river' && wobble === 'hills' && back === 'hills,hills' && opened === '' && jumped === '' && alone === '',
    `a border is named once, as the camera first passes its middle (alpine to hills to river: ${forward}), not when it swings across it (${wobble}), `
    + `comes back over it without having gone well back (${opened || 'none'}), or has been put in the second half of one (${jumped || 'none'}), and a world that follows itself has no border (${alone || 'none'}); `
    + `after going back before 0.2 of it and coming on again it is named again (${back})`);
  say(clear.named === 'hills' && !clear.waiting && behind.named === '' && behind.waiting && AFTER_VERSE === 4000 && NAME_MS === 4000,
    `with a verse up the name waits ${AFTER_VERSE / 1000} s (it was not named at once, a timer is set), without one it comes at once; the name stays ${NAME_MS / 1000} s`);
  say(clear.shown && clear.ended && !behind.shown, 'the class that shows the name comes off when its animation ends, not at a time counted from when it went on (a late frame would cut the fade short)');
}

// The quiet instrument: the clock, what holds it back and what wakes it.
async function quietInstrument() {
  let clock = 0;
  const target = new EventTarget();
  const game = { autoMode: true };
  const state = { menus: false, pad: false };
  const body = stub();
  const idle = new Idle(game, { menusOpen: () => state.menus, body, target, now: () => clock, pads: () => state.pad });
  const run = (ms) => {
    for (let t = 0; t < ms; t += 250) {
      clock += 250;
      idle.update(0.25);
    }
  };
  const has = (c) => body.cls.has(c);
  idle.update(0.25);   // the loop comes to it: the half minute counts from here
  run(IDLE_MS - 250);
  const before = has('idle');
  run(500);
  const after = has('idle');
  say(IDLE_MS === 30000 && !before && after, `${IDLE_MS / 1000} s with no input and the instrument goes quiet (not at ${(IDLE_MS - 250) / 1000} s, at ${(IDLE_MS + 250) / 1000} s)`);

  const wakes = [];
  for (const type of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart', 'gamepadconnected']) {
    if (!has('idle')) run(IDLE_MS + 500);
    target.dispatchEvent(new Event(type));
    wakes.push(`${type} ${!has('idle') && has('wake') ? 'woke it' : 'did not'}`);
  }
  say(wakes.every((x) => x.endsWith('woke it')), `each kind of input wakes it: ${wakes.join(', ')}`);
  await sleep(WAKE_MS + 150);
  say(!has('wake') && !has('idle'), `the class that brings the panels back in 0.3 s stays ${WAKE_MS} ms and goes`);

  // Only while the autopilot drives: with the car in the visitor's hands it
  // does not go quiet, and it starts counting when the autopilot takes over.
  game.autoMode = false;
  run(IDLE_MS * 2);
  const byHand = has('idle');
  game.autoMode = true;
  run(IDLE_MS - 250);
  const counting = has('idle');
  run(500);
  say(!byHand && !counting && has('idle'), 'driven by hand it does not go quiet in twice that, and with the autopilot on again it takes the full 30 s');

  // A menu open: not at all, and the 30 s start when it is shut.
  target.dispatchEvent(new Event('keydown'));
  state.menus = true;
  run(IDLE_MS * 2);
  const open = has('idle');
  state.menus = false;
  run(IDLE_MS - 250);
  const shut = has('idle');
  run(500);
  say(!open && !shut && has('idle'), 'with a menu open it does not go quiet in twice that, and the 30 s start when it is shut');

  // A gamepad in use counts as input; so does a stick that moved or a button down.
  target.dispatchEvent(new Event('keydown'));
  state.pad = true;
  run(IDLE_MS * 2);
  const pad = has('idle');
  state.pad = false;
  run(IDLE_MS + 500);
  say(!pad && has('idle'), 'a gamepad in use keeps it awake');
}

// The hint of a first visit: who gets it.
function firstHint() {
  const mem = (init = {}) => {
    const m = new Map(Object.entries(init));
    return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
  };
  let clock = 0;
  const make = (storage) => {
    const h = new FirstHint({ storage, now: () => clock });
    h.built = 0;
    h._build = () => { h.built++; h.el = {}; };
    return h;
  };
  // The loop comes to it at the moment it is made, and again every so often.
  const loop = (h, ms) => {
    h.update();
    clock += ms;
    h.update();
  };
  const store = mem();
  const first = make(store);
  loop(first, AFTER_HINT - 100);
  const early = first.built;
  loop(first, 200);
  const marked = store.m.get(HINT_KEY);
  const again = make(store);
  loop(again, 5000);
  const headless = make(null);
  loop(headless, 5000);
  const cannotKeep = make({ getItem: () => null, setItem: () => { throw new Error('full'); } });
  loop(cannotKeep, 5000);
  const cannotRead = make({ getItem: () => { throw new Error('denied'); }, setItem() {} });
  loop(cannotRead, 5000);
  const forced = make(mem({ [HINT_KEY]: '1' }));
  forced.show(true);
  say(early === 0 && first.built === 1 && marked === '1' && again.built === 0 && headless.built === 0 && cannotKeep.built === 0 && cannotRead.built === 0 && forced.built === 1,
    `the hint comes up once for a browser with nothing kept, ${AFTER_HINT / 1000} s after the loop first comes to it, and the mark is written as it does; `
    + 'not for one that has the mark, a headless run, a browser that cannot keep a mark or read one; the checks can put it up anyway');
  say(HINT_MS === 8000, `it stays ${HINT_MS / 1000} s`);
}

// The strips in the world menu, from the data.
function stripsOfWorlds() {
  const S = WORLDS.map((w) => ({ id: w.id, rgb: [...swatchOf(w).sky, swatchOf(w).ground].map(rgbOf) }));
  const ok = S.map((s) => s.rgb.map(oklab));
  const pairs = [];
  for (let i = 0; i < S.length; i++) {
    for (let j = i + 1; j < S.length; j++) pairs.push({ pair: `${S[i].id}/${S[j].id}`, ...stripsApart(ok[i], ok[j]) });
  }
  const least = (k) => pairs.reduce((a, b) => (b[k] < a[k] ? b : a));
  const own = WORLDS.every((w, i) => S[i].rgb[0].join() === rgbOf(w.look.zenith).join() && S[i].rgb[1].join() === rgbOf(w.look.horizon).join())
    && Object.keys(GROUND).length === WORLDS.length;
  say(S.length === 12 && own && least('bands').bands > 0.05,
    `the ${S.length} strips are made of each world's sky top, sky at the horizon and one ground colour, and no two are alike: the distance of two strips is the mean of the OKLab distances of their three bands, `
    + `and the least is ${least('bands').pair} at ${least('bands').bands.toFixed(3)} (over 0.05)`);
  results.strips = { bands: least('bands'), whole: least('whole'), widest: least('widest') };
  console.error(`     (by other readings of "apart": between the strips' mean colours the least is ${least('whole').pair} at ${least('whole').whole.toFixed(3)}, by the widest band ${least('widest').pair} at ${least('widest').widest.toFixed(3)})`);
}

// The dots that hold a day world to a sky, from the data: each is the zenith and the
// horizon of its sky (the same three in every row), the noon one is the first day
// world's strip, and no two are alike (the mean of the two bands' OKLab distances,
// over 0.05).
function skyDotsOfWorlds() {
  const dots = SKIES.map((id) => skySwatchOf(id).map(rgbOf));
  const between = (a, b) => (apart(oklab(a[0]), oklab(b[0])) + apart(oklab(a[1]), oklab(b[1]))) / 2;
  const pairs = [[0, 1], [0, 2], [1, 2]].map(([i, j]) => ({ of: `${SKIES[i]}/${SKIES[j]}`, d: between(dots[i], dots[j]) }));
  const least = pairs.reduce((a, b) => (b.d < a.d ? b : a));
  const noon = dots[0].join() === swatchOf(WORLDS.find(hasSkies)).sky.map(rgbOf).join();
  say(noon && least.d > 0.05,
    `the 3 dots are the zenith and the horizon of noon, golden and grey, and no two are alike (the least is ${least.of} at ${least.d.toFixed(3)}, over 0.05; ${pairs.map((p) => p.of + ' ' + p.d.toFixed(2)).join(', ')})`);
  results.skyDots = pairs;
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
  ArrowLeft: { key: 'ArrowLeft', windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37 },
  KeyM: { key: 'm', windowsVirtualKeyCode: 77, nativeVirtualKeyCode: 77 },
  KeyK: { key: 'k', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75 },
};
const open = new Set();
const profiles = [];
let opened = 0;

// Run in each new document before the page's own: what the name and the hint
// do to the page, written down with the page's own clock (window.__log), so
// that how long they stay does not depend on how fast this side asks.
const LOG_SCRIPT = `window.__log = [];
new MutationObserver((records) => {
  const at = performance.now();
  const last = new Map();
  for (const r of records) {
    if (r.type === 'childList') {
      for (const n of r.addedNodes) if (n.id === 'firsthint') window.__log.push({ what: 'hint added', at });
      for (const n of r.removedNodes) if (n.id === 'firsthint') window.__log.push({ what: 'hint removed', at });
    } else if (r.target.id === 'firsthint' || r.target.id === 'worldname') {
      last.set(r.target, r);
    }
  }
  for (const r of last.values()) {
    const on = r.target.classList.contains('show');
    if (r.target.id === 'firsthint') window.__log.push({ what: on ? 'hint shown' : 'hint hidden', at });
    else window.__log.push({ what: on ? 'name shown' : 'name hidden', at, text: r.target.querySelector('.nm').textContent });
  }
}).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });`;

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
    send,
    // The page in front, and no other tab of the browser (a page that is not in front draws no frames).
    front: tidy,
    errors,
    // A function of the page's own, with an argument: its answer.
    run: (fn, arg) => ev(`(${fn})(${JSON.stringify(arg === undefined ? null : arg)})`),
    // ready: what the page has when it is up (a headless run is up when it says it is done).
    async goto(query, ready = 'window.game && game.carLoaded && game.frame > 2 && window.ui') {
      const before = await ev('performance.timeOrigin').catch(() => 0);
      const closed = await tidy();
      if (closed) console.error(`note: ${closed} other tab(s) of the browser closed`);
      await send('Page.navigate', { url: `http://localhost:${PORT}/index.html?${query}` });
      const t0 = Date.now();
      for (let n = 0; ; n++) {
        await sleep(500);
        // The page up and drawing; a page that is hidden draws nothing, and is
        // brought to the front.
        const up = await ev('(performance.timeOrigin !== ' + before + ' && ' + ready + ') ? "up" : (document.title.startsWith("GAME_FAIL") ? document.title : (document.hidden ? "hidden" : "no"))').catch(() => 'no');
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
    // The pointer moved, nothing pressed.
    async moveTo(x, y) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
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
    // clip: { x, y, width, height, scale } to take part of the page, larger.
    async shot(name, clip) {
      await tidy();
      mkdirSync(OUT, { recursive: true });
      const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
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
  const things = [...document.querySelectorAll('#bar button, #bar a, #photobar button, #photobar input, #worlds button, #styles button, #worlds li label, #settings button, #settings input')]
    .filter((e) => shown(e) && !(e.matches('#worlds input')));
  const small = things.map((e) => [e, e.getBoundingClientRect()]).filter(([, r]) => r.width < 39.5 || r.height < 39.5)
    .map(([e, r]) => `${e.id || e.className || e.tagName} ${e.textContent.trim().slice(0, 12)} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`);
  const out = ['bar', 'photobar', 'worlds', 'styles', 'settings'].map((id) => document.getElementById(id)).filter(shown)
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

// In the page, in the photo mode: the bar and what stands aside for it. The
// name of a world, the hint and a verse are brought up first, to see that they
// stay down.
function photoBar() {
  const $ = (id) => document.getElementById(id);
  const shown = (e) => {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  ui.worldname.announce('river');
  ui.hint.show(true);
  $('passnote').classList.add('show');
  const standing = ['hud', 'bar', 'brand', 'worldname', 'firsthint', 'passnote'].filter((id) => $(id) && shown($(id)));
  $('passnote').classList.remove('show');
  const bar = $('photobar');
  const r = bar.getBoundingClientRect();
  const buttons = [...bar.querySelectorAll('button')].map((b) => {
    const q = b.getBoundingClientRect();
    return { id: b.id, w: Math.round(q.width), h: Math.round(q.height), text: b.textContent.trim() };
  });
  const tunes = [...bar.querySelectorAll('.tune')].map((e) => {
    const q = e.getBoundingClientRect();
    const i = e.querySelector('input').getBoundingClientRect();
    return { id: e.id, w: Math.round(q.width), h: Math.round(q.height), input: [Math.round(i.width), Math.round(i.height)],
      inside: q.left >= r.left - 0.5 && q.right <= r.right + 0.5 && q.top >= r.top - 0.5 && q.bottom <= r.bottom + 0.5 };
  });
  const centres = [...bar.children].map((c) => { const q = c.getBoundingClientRect(); return (q.top + q.bottom) / 2; }).sort((a, b) => a - b);
  const rows = centres.filter((c, i) => i === 0 || c - centres[i - 1] > 12).length;
  return {
    tunes, rows,
    state: game.photo.state, body: document.body.classList.contains('photo'), shown: shown(bar),
    inside: r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5,
    rect: [r.left, r.top, r.right, r.bottom].map(Math.round), screen: [innerWidth, innerHeight], buttons, standing,
    style: $('btnPhotoStyle').textContent.trim(), car: $('btnPhotoCar').getAttribute('aria-pressed'),
    open: ['worlds', 'styles', 'settings'].filter((id) => !$(id).hidden),
  };
}

// In the page, in the photo mode: the depth of field's switch, the two sliders and what
// they say, what the chain has of them, and the line over the bar.
function glassState() {
  const $ = (id) => document.getElementById(id);
  const box = (e) => {
    const r = e.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), inside: r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5 };
  };
  const bar = $('photobar').getBoundingClientRect();
  const note = $('photonote');
  const at = note.getBoundingClientRect();
  const p = game.photo;
  return {
    depth: { pressed: $('btnPhotoDepth').getAttribute('aria-pressed'), text: $('btnPhotoDepth').textContent.trim(), ...box($('btnPhotoDepth')) },
    aperture: { disabled: $('rngAperture').disabled, value: $('rngAperture').value, text: $('outAperture').textContent, dim: $('tuneAperture').getAttribute('aria-disabled'), ...box($('rngAperture')) },
    ev: { value: $('rngEv').value, text: $('outEv').textContent, ...box($('rngEv')) },
    photo: { depthOn: p.depthOn, aperture: p.aperture, ev: p.ev },
    post: { enabled: game.post.dof.enabled, aperture: game.post.dof.aperture, ev: game.post.ev, exposure: game.post.final.uniforms.uExposure.value, base: game.post._base },
    note: { text: note.textContent, shown: note.classList.contains('show'), over: at.width > 0 && at.bottom > bar.top + 0.5 && at.top < bar.bottom - 0.5 },
  };
}

// In the page, in the photo mode: forty seconds with nothing touched do not
// quiet the page, and the bar is at its full strength.
function photoNotQuiet() {
  ui.idle.last = ui.idle.now() - 40000;
  ui.idle.clock = 1;
  ui.idle.update(0.3);
  return { idle: document.body.classList.contains('idle'), opacity: getComputedStyle(document.getElementById('photobar')).opacity };
}

// In the page: whether the photo mode's button is shown, and the rule that
// takes it away where there is no fine pointer.
function photoButton() {
  let rule = null;
  for (const sheet of document.styleSheets) {
    for (const r of sheet.cssRules) {
      if (r.type !== CSSRule.MEDIA_RULE || !/^not all/.test(r.media.mediaText) || !/any-pointer: fine/.test(r.media.mediaText)) continue;
      for (const x of r.cssRules) if (x.selectorText === '#bar #btnPhoto' && x.style.display === 'none') rule = r.media.mediaText;
    }
  }
  return {
    rule, fine: matchMedia('(any-pointer: fine)').matches, coarse: matchMedia('(pointer: coarse)').matches,
    shown: getComputedStyle(document.getElementById('btnPhoto')).display !== 'none',
  };
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
  ['#btnPhoto .txt', 'text', '拍照'], ['#btnPhoto', 'title', '拍照模式（K）：W A S D 平移，Q E 降升，拖动转向，滚轮变焦，Z X 滚转，Enter 拍照'],
  ['#photobar', 'aria-label', '拍照工具条'], ['#btnShutter', 'aria-label', '快门'], ['#btnShutter', 'title', '拍下这一帧（Enter）'],
  ['#btnPhotoStyle', 'title', '下一种画风（V）'], ['#btnPhotoCar .txt', 'text', '藏车'], ['#btnPhotoCar', 'title', '把车藏起来，再按一次放回来'],
  ['#btnPhotoDepth .txt', 'text', '景深'], ['#btnPhotoDepth', 'title', '景深：开着时点一下画面对焦，镜头怎么挪，对焦的距离都不变'],
  ['#tuneAperture', 'title', '光圈，f/1.4 到 f/16：数字越小，没对上焦的地方越糊（景深开着才用得上）'], ['#rngAperture', 'aria-label', '光圈'],
  ['#tuneEv', 'title', '曝光补偿，加减 2 EV，每格 0.1'], ['#rngEv', 'aria-label', '曝光补偿'],
  ['#btnPhotoExit .txt', 'text', '退出'], ['#btnPhotoExit', 'title', '退出拍照模式（K）'],
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

// In the page: the strips of the world menu as the browser paints them, and
// whether each stands in front of its name.
function stripsPainted() {
  return [...document.querySelectorAll('#worldList li')].map((li) => {
    const sw = li.querySelector('.sw');
    const r = sw.getBoundingClientRect();
    return {
      name: li.querySelector('.nm').textContent,
      css: getComputedStyle(sw).backgroundImage,
      w: r.width,
      h: r.height,
      before: r.right <= li.querySelector('.nm').getBoundingClientRect().left,
    };
  });
}

// In the page: the dots of the world menu, row by row: the world, the name and
// role of its group of dots, and for each dot its sky, its names, whether it is
// held, still (disabled) and the sky the road is under, its place and size, and
// the colours it is painted in; and the line about the dots, the note that the
// address holds them, and where the menu is.
function dotsShown() {
  const rgb = (css) => [...css.matchAll(/rgb\((\d+), (\d+), (\d+)\)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
  const q = document.getElementById('worlds').getBoundingClientRect();
  const note = document.getElementById('skyNote');
  return {
    rows: [...document.querySelectorAll('#worldList li')].map((li) => {
      const group = li.querySelector('.sky');
      return {
        world: li.dataset.world,
        group: group ? { label: group.getAttribute('aria-label'), role: group.getAttribute('role') } : null,
        dots: [...li.querySelectorAll('.sky .dot')].map((b) => {
          const r = b.getBoundingClientRect();
          return {
            sky: b.dataset.sky, title: b.title, label: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'),
            disabled: b.disabled, now: b.classList.contains('now'), x: r.left, y: r.top, w: r.width, h: r.height,
            colours: rgb(getComputedStyle(b, '::before').backgroundImage),
          };
        }),
      };
    }),
    hint: document.querySelector('#worlds [data-i="worlds.sky"]').textContent,
    note: { hidden: note.hidden, text: note.textContent },
    menu: { l: q.left, t: q.top, r: q.right, b: q.bottom, vw: innerWidth, vh: innerHeight },
  };
}

// In the page: the dots of one world, as they are held.
function dotsOf(id) {
  return [...document.querySelectorAll('#worldList li[data-world="' + id + '"] .dot')].map((b) => b.getAttribute('aria-pressed')).join();
}

// In the page: the namings of the sky the road is under: the world, the sky it says, the sun's strength and
// colour as the atmosphere has them, and which dot has the mark of being the sky now.
function skyNow() {
  const l = game.atmosphere.look;
  const w = game.worldHere();
  const mark = [...document.querySelectorAll('#worldList .dot.now')].map((b) => b.closest('li').dataset.world + ' ' + b.dataset.sky);
  return { world: w.id, sky: w.sky, sun: l.sunIntensity, red: l.sunColor.r, blue: l.sunColor.b, mark: mark.join() };
}

// In the page: the name and the line the page writes for each world, one
// after the other.
function namesWritten(spec) {
  const el = document.getElementById('worldname');
  const out = [];
  for (const id of spec.worlds) {
    ui.worldname.announce(id);
    out.push({ id, nm: el.querySelector('.nm').textContent, ln: el.querySelector('.ln').textContent });
  }
  clearTimeout(ui.worldname.timer);
  clearTimeout(ui.worldname.wait);
  ui.worldname.id = null;
  el.classList.remove('show');
  return out;
}

// In the page: what the name of a world does, written down as it happens (the
// times are the page's own, in ms), and the animation as it is declared.
function watchNames() {
  const el = document.getElementById('worldname');
  window.__names = [];
  el.addEventListener('animationstart', (e) => {
    const a = el.getAnimations()[0];
    window.__names.push({
      start: e.timeStamp,
      nm: el.querySelector('.nm').textContent,
      ln: el.querySelector('.ln').textContent,
      lang: document.documentElement.lang,
      animation: e.animationName,
      duration: a ? a.effect.getTiming().duration : null,
      keyframes: a ? a.effect.getKeyframes().map((k) => [Math.round(k.offset * 1000) / 1000, Number(k.opacity)]) : null,
    });
  });
  el.addEventListener('animationend', (e) => {
    const last = window.__names[window.__names.length - 1];
    if (last) last.end = e.timeStamp;
  });
  return true;
}

// In the page: the car stepped by hand, 0.1 s a step as the game takes them
// (the frames of a page drawn in software come too slowly to wait for the road
// to be driven), until the next name has come up or max steps are done.
function stepUntilNamed(spec) {
  const w = ui.worldname;
  let steps = 0;
  while (w.shown.length === spec.have && steps < spec.max) {
    game.update(0.1);
    w.update(0.1);
    steps++;
  }
  const here = game.worldHere();
  return { steps, count: w.shown.length, last: w.shown[w.shown.length - 1] || null, here: here.id, t: here.t, at: Math.round(game.sCar) };
}

// In the page: how the instrument and the buttons stand.
function quietNow() {
  const opacity = (id) => Number(getComputedStyle(document.getElementById(id)).opacity);
  return {
    hud: opacity('hud'),
    bar: opacity('bar'),
    idle: document.body.classList.contains('idle'),
    wake: document.body.classList.contains('wake'),
    since: ui.idle.last === null ? 0 : performance.now() - ui.idle.last,
  };
}

// In the page: from now, for ms, the instrument's opacity at every frame, and
// when the next pointer event came, as the page saw it.
function sampleWake(ms) {
  const hud = document.getElementById('hud');
  const out = { input: null, anim: null, readyAt: null, finishedAt: null, finalOpacity: null, frames: [] };
  window.__wake = out;
  addEventListener('pointermove', (e) => { if (out.input === null) out.input = e.timeStamp; }, { capture: true, once: true });
  const end = performance.now() + ms;
  const frame = (now) => {
    // The first frame after the input: the transition is made, and what it is.
    // It starts to run in the frame after (when it is ready) and is finished
    // in the first frame 0.3 s on; the opacity is read then.
    if (out.input !== null && out.anim === null) {
      const a = hud.getAnimations().find((x) => x.transitionProperty === 'opacity');
      out.anim = a ? [a.effect.getTiming().duration] : [];
      if (a) {
        a.ready.then(() => { out.readyAt = performance.now(); }).catch(() => {});
        a.finished.then(() => {
          out.finishedAt = performance.now();
          out.finalOpacity = Number(getComputedStyle(hud).opacity);
        }).catch(() => {});
      }
    }
    out.frames.push([now, Number(getComputedStyle(hud).opacity)]);
    if (now < end) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return true;
}

// In the page: everything that can be on the screen at once, put there in
// turn and held still: the name of each world, the instrument, the buttons, the
// brand, the hint, then each of the menus, each of the verses, and the
// wallpaper's verse. Which of them stand over one another, and which of the name
// and the hint are off the screen.
function crowded(spec) {
  const $ = (id) => document.getElementById(id);
  const nameEl = $('worldname');
  const hits = [];
  const outside = [];
  let scenes = 0;
  // The box of an element and of what is in it, as much of it as shows: what a part
  // that scrolls holds past its edge (a menu taller than the window) is not on the screen.
  const box = (el) => {
    let l = Infinity;
    let t = Infinity;
    let r = -Infinity;
    let b = -Infinity;
    for (const e of [el, ...el.querySelectorAll('*')]) {
      const q = e.getBoundingClientRect();
      let ql = q.left;
      let qt = q.top;
      let qr = q.right;
      let qb = q.bottom;
      for (let p = e; p !== el; ) {
        p = p.parentElement;
        const o = getComputedStyle(p);
        if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
        const c = p.getBoundingClientRect();
        ql = Math.max(ql, c.left);
        qt = Math.max(qt, c.top);
        qr = Math.min(qr, c.right);
        qb = Math.min(qb, c.bottom);
      }
      if (!q.width || !q.height || qr <= ql || qb <= qt) continue;
      l = Math.min(l, ql);
      t = Math.min(t, qt);
      r = Math.max(r, qr);
      b = Math.max(b, qb);
    }
    return l === Infinity ? null : { l, t, r, b };
  };
  const still = (el) => {
    el.style.animation = 'none';
    el.style.transition = 'none';
    el.style.opacity = '1';
  };
  const release = (el, keys) => { for (const k of keys) el.style[k] = ''; };
  const look = (label, selectors) => {
    scenes++;
    const boxes = [];
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const b = box(el);
      if (b) boxes.push({ s, ...b });
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const c = boxes[j];
        const w = Math.min(a.r, c.r) - Math.max(a.l, c.l);
        const h = Math.min(a.b, c.b) - Math.max(a.t, c.t);
        if (w > 0.5 && h > 0.5) hits.push(`${label}: ${a.s} over ${c.s} (${w.toFixed(0)} x ${h.toFixed(0)})`);
      }
    }
    for (const b of boxes) {
      if ((b.s === '#worldname' || b.s === '#firsthint') && (b.l < -0.5 || b.t < -0.5 || b.r > innerWidth + 0.5 || b.b > innerHeight + 0.5)) {
        outside.push(`${label}: ${b.s} at ${[b.l, b.t, b.r, b.b].map(Math.round)} on ${innerWidth} x ${innerHeight}`);
      }
    }
  };
  const putName = (id) => {
    ui.worldname.announce(id);
    still(nameEl);
    nameEl.style.transform = 'translate(-50%, 0)';
  };
  // The hint, up whatever the mark says, held still.
  ui.hint.show(true);
  $('firsthint').style.transition = 'none';
  $('firsthint').classList.add('show');
  const here = ['#hud', '#bar', '#brand', '#firsthint'];
  let widest = { id: null, w: 0 };
  for (const id of spec.worlds) {
    putName(id);
    look(id, ['#worldname', ...here]);
    const b = box(nameEl);
    if (b && b.r - b.l > widest.w) widest = { id, w: b.r - b.l };
  }
  putName(widest.id);
  // On a phone a menu opens over the instrument, as it always did, and the
  // instrument is left out of those arrangements.
  const beside = spec.popover ? here.filter((s) => s !== '#hud') : here;
  for (const menu of ['Worlds', 'Styles', 'Settings']) {
    $('btn' + menu).click();
    look('the ' + menu.toLowerCase() + ' menu', ['#worldname', ...beside, '#' + menu.toLowerCase()]);
    $('btn' + menu).click();
  }
  for (const verse of ['passnote', 'turnnote', 'inknote']) {
    still($(verse));
    look('the verse ' + verse, ['#worldname', ...here, '#' + verse]);
    release($(verse), ['animation', 'transition', 'opacity']);
  }
  document.body.classList.add('wallpaper');
  still($('wallnote'));
  look('wallpaper', ['#worldname', '#wallnote']);
  document.body.classList.remove('wallpaper');
  release($('wallnote'), ['animation', 'transition', 'opacity']);
  // Put back as it was.
  ui.hint.hide();
  clearTimeout(ui.worldname.timer);
  clearTimeout(ui.worldname.wait);
  ui.worldname.id = null;
  nameEl.classList.remove('show');
  release(nameEl, ['animation', 'transition', 'opacity', 'transform']);
  return { scenes, hits, outside, widest: widest.id };
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
  c.shake.value = 0.2;
  // The lens shakes by the game's clock, which is given to it: three instants of it.
  const at = (s) => {
    c.update(0, game.car, { roadY: game.car.y, time: s });
    return game.camera.position.toArray();
  };
  const p = [at(1), at(1.043), at(1.087)];
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

// The world menu is open: the strips in front of the names, as the browser
// paints them, against the world's own colours, and how far apart they are.
async function stripsCheck(page, lang) {
  const painted = await page.run(stripsPainted);
  const parse = (css) => [...css.matchAll(/rgb\((\d+), (\d+), (\d+)\)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
  const colours = painted.map((p) => parse(p.css));
  const want = WORLDS.map((w) => [...swatchOf(w).sky, swatchOf(w).ground].map(rgbOf));
  const same = colours.length === want.length && colours.every((c, i) => c.length === 3 && c.every((x, k) => x.join() === want[i][k].join()));
  const sized = painted.every((p) => p.w === 28 && p.h === 16 && p.before);
  const ok = colours.map((c) => c.map(oklab));
  let least = { bands: Infinity };
  for (let i = 0; i < ok.length; i++) {
    for (let j = i + 1; j < ok.length; j++) {
      const d = stripsApart(ok[i], ok[j]);
      if (d.bands < least.bands) least = { pair: `${painted[i].name}/${painted[j].name}`, ...d };
    }
  }
  say(painted.length === 12 && same && sized && least.bands > 0.05,
    `${lang}: the world menu has ${painted.length} strips of 28 x 16 in front of the names, painted in each world's sky top, sky at the horizon and ground; no two are alike `
    + `(the distance of two strips is the mean of the OKLab distances of their three bands; the least is ${least.pair} at ${least.bands.toFixed(3)}, over 0.05; `
    + `between mean colours ${least.whole.toFixed(3)} at that pair, the widest band ${least.widest.toFixed(3)})`);
  results['strips-' + lang] = { count: painted.length, least };
  await page.shot(`ui-${lang}-worlds.png`);
  // The menu alone, three times the size, for a look at the strips.
  const r = await page.ev(`(() => { const q = document.getElementById('worlds').getBoundingClientRect(); return { x: q.left - 8, y: q.top - 8, width: q.width + 16, height: q.height + 16, scale: 3 }; })()`);
  await page.shot(`ui-${lang}-worlds-zoom.png`, r);
}

// The name, the instrument, the buttons, the brand, the hint, the menus and the
// verses, in every arrangement they can have: nothing stands over anything
// else, and the name and the hint stay on the screen.
async function crowdCheck(page, lang, where) {
  const r = await page.run(crowded, { worlds: WORLDS.map((w) => w.id), popover: where === 'phone' });
  say(!r.hits.length && !r.outside.length,
    `${lang}, ${where}: in ${r.scenes} arrangements nothing stands over anything else and the name and the hint stay on the screen (the widest name: ${r.widest}`
    + `${where === 'phone' ? '; a menu opens over the instrument on a phone, as it always did, so the two are not held apart' : ''})`
    + `${r.hits.length ? ' (over: ' + r.hits.slice(0, 6).join('; ') + ')' : ''}${r.outside.length ? ' (off the screen: ' + r.outside.slice(0, 6).join('; ') + ')' : ''}`);
  results[`crowd-${lang}-${where}`] = r;
}

// In the page: the name of a world, or the hint, held at full strength where it
// shows, for a picture.
function holdFor(spec) {
  if (spec.name) {
    ui.worldname.announce(spec.name);
    const n = document.getElementById('worldname');
    n.style.animation = 'none';
    n.style.opacity = '1';
    n.style.transform = 'translate(-50%, 0)';
  }
  if (spec.hint) {
    ui.hint.show(true);
    const h = document.getElementById('firsthint');
    h.style.transition = 'none';
    h.classList.add('show');
  }
  return true;
}

// In the page: both put back as they were.
function letGo() {
  ui.hint.hide();
  clearTimeout(ui.worldname.timer);
  clearTimeout(ui.worldname.wait);
  ui.worldname.id = null;
  const n = document.getElementById('worldname');
  n.classList.remove('show');
  for (const k of ['animation', 'opacity', 'transform']) n.style[k] = '';
  return true;
}

// Pictures of the name, and of the hint, on a wide screen: each held still at
// full strength (a picture taken as it comes and goes would catch it at any
// strength), and a part of the screen at twice the size beside it.
async function heldPictures(page, lang) {
  // The part of the screen around an element, with room about it, kept on the screen.
  const around = (selector, padX, padY) => page.ev(`(() => {
    const q = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    const x = Math.max(0, q.left - ${padX});
    const y = Math.max(0, q.top - ${padY});
    return { x, y, width: Math.min(innerWidth, q.right + ${padX}) - x, height: Math.min(innerHeight, q.bottom + ${padY}) - y, scale: 2 };
  })()`);
  await page.run(holdFor, { name: 'river' });
  await sleep(400);
  await page.shot(`ui-${lang}-name.png`);
  await page.shot(`ui-${lang}-name-zoom.png`, await around('#worldname', 90, 50));
  await page.run(letGo);
  await page.run(holdFor, { hint: true });
  await sleep(400);
  await page.shot(`ui-${lang}-hint.png`);
  await page.shot(`ui-${lang}-hint-zoom.png`, await around('#hud', 20, 50));
  await page.run(letGo);
}

// The photo mode (K, with a menu open to be put away): the page's own interface
// stands aside and the bar is up, on the screen, with every button at least
// 40 x 40, no word out of its box and, in English, no Chinese in the page; the
// name, the hint and a verse stay down, and forty seconds with nothing touched
// do not quiet it. Then K again, and the page is the page.
async function photoCheck(page, lang, where) {
  await page.click('#btnSettings');
  await page.key('KeyK');
  const s = await page.run(photoBar);
  const quiet = await page.run(photoNotQuiet);
  await page.run(letGo);
  const touch = await page.run(touching);
  const clipped = await page.run(overflowing);
  const cjk = lang === 'en' ? await page.run(chinese) : [];
  await page.shot(`ui-${lang}-photo-${where}.png`);
  const small = s.buttons.filter((b) => b.w < 39.5 || b.h < 39.5);
  const style = lang === 'zh' ? ZH_STYLES[0] : 'Real';
  const sliding = s.tunes.length === 2 && s.tunes.every((x) => x.input[0] >= 39.5 && x.input[1] >= 39.5 && x.inside);
  say(s.state === 'on' && s.body && s.shown && s.inside && s.buttons.length === 5 && sliding && s.rows === (where === 'phone' ? 2 : 1) && !small.length && !touch.small.length && !touch.out.length && !clipped.length && !cjk.length,
    `${lang}, ${where}: in the photo mode the bar is up on the screen (${s.rect.join(' ')} of ${s.screen.join(' x ')}) in ${s.rows} row${s.rows > 1 ? 's' : ''}, its ${s.buttons.length} buttons are ${s.buttons.map((b) => `${b.w}x${b.h}`).join(' ')} and its ${s.tunes.length} sliders ${s.tunes.map((x) => `${x.input[0]}x${x.input[1]}`).join(' ')}, no word runs out of its box, and the style button says ${s.style}`
    + `${cjk.length ? ' (Chinese in the English page: ' + cjk.slice(0, 3) + ')' : ''}${small.length ? ' (small: ' + small.map((b) => b.id) + ')' : ''}${clipped.length ? ' (clipped: ' + clipped.slice(0, 3) + ')' : ''}`);
  say(s.style === style && s.car === 'false' && !s.open.length && !s.standing.length && !quiet.idle && quiet.opacity === '1',
    `${lang}, ${where}: the menu that was open is put away, the instrument, the buttons, the brand, the name, the hint and the verse stand aside (${s.standing.length ? 'STILL SHOWN: ' + s.standing : 'none shown'}), and forty seconds with nothing touched do not quiet the page (the bar's strength ${quiet.opacity})`);
  results[`photo-${lang}-${where}`] = { bar: s, quiet, clipped, small: touch.small };
  await glassCheck(page, lang, where);
  await page.key('KeyK');
  for (const t0 = Date.now(); (await page.ev('game.photo.active')) && Date.now() - t0 < 180000;) {
    await page.front();
    await sleep(300);
  }
  const after = await page.ev(`({ state: game.photo.state, body: document.body.classList.contains('photo'), bar: getComputedStyle(document.getElementById('photobar')).display, hud: getComputedStyle(document.getElementById('hud')).visibility,
    ev: game.photo.ev, postEv: game.post.ev, f: game.photo.aperture, depthOn: game.photo.depthOn, enabled: game.post.dof.enabled, exposure: game.post.final.uniforms.uExposure.value === game.post._base })`);
  say(after.state === 'off' && !after.body && after.bar === 'none' && after.hud === 'visible'
    && after.ev === 0 && after.postEv === 0 && after.f === 2.8 && !after.depthOn && !after.enabled && after.exposure,
  `${lang}, ${where}: K again, and the page is the page: the bar is gone and the instrument is back, and what the lens was given (the compensation, the aperture, the depth of field) is put back`);
}

// The depth of field's switch and the sliders of the bar, by hand, in the photo mode: the switch
// is pressed and the aperture slider is free (it is dim and still while the depth of field is off),
// the chain has it on when its programs are built, the line over the bar says to tap the frame, the
// sliders move by the arrow keys and the chain has what they say, every one of them is 40 x 40 or more,
// the bar stays on the screen, nothing is in the way of the line over it, and in English there is
// no Chinese; then the switch again, and it is off.
async function glassCheck(page, lang, where) {
  const T = TABLES[lang];
  const s0 = await page.run(glassState);
  await page.click('#btnPhotoDepth');
  const early = await page.run(glassState);
  for (const t0 = Date.now(); !(await page.ev('game.post.dof.enabled')) && Date.now() - t0 < 180000;) {
    await page.front();
    await sleep(300);
  }
  const s1 = await page.run(glassState);
  await page.ev(`document.getElementById('rngAperture').focus()`);
  await page.key('ArrowRight');
  await page.ev(`document.getElementById('rngEv').focus()`);
  await page.key('ArrowRight');
  await page.key('ArrowRight');
  await page.key('ArrowRight');
  await page.key('ArrowLeft');
  const s2 = await page.run(glassState);
  const touch = await page.run(touching);
  const clipped = await page.run(overflowing);
  const cjk = lang === 'en' ? await page.run(chinese) : [];
  await page.shot(`ui-${lang}-photo-${where}-depth.png`);
  const off = s0.depth.pressed === 'false' && s0.aperture.disabled && s0.aperture.dim === 'true' && s0.aperture.text === 'f/2.8' && s0.ev.text === '0.0 EV'
    && s0.depth.text === T['photo.depth'] && !s0.post.enabled && !s0.photo.depthOn;
  say(off, `${lang}, ${where}: before the depth of field is turned on its switch says "${s0.depth.text}" and is not pressed, the aperture slider is dim and still at ${s0.aperture.text}, the compensation is ${s0.ev.text}`);
  say(early.depth.pressed === 'true' && !early.aperture.disabled && early.aperture.dim === 'false' && early.photo.depthOn && s1.post.enabled && s1.note.text === T['photo.focus'] && !s1.note.over,
    `${lang}, ${where}: a click on the switch presses it at once and frees the slider, and the chain has the depth of field on when its programs are built (${early.post.enabled ? 'at once' : 'a little after'}); the line over the bar says "${s1.note.text}"${s1.note.over ? ' and is over the bar' : ' and is clear of it'}`);
  say(s2.aperture.text === 'f/3.2' && s2.post.aperture === 3.2 && s2.photo.aperture === 3.2 && s2.ev.text === '+0.2 EV' && s2.post.ev === 0.2
    && Math.abs(s2.post.exposure / s2.post.base - 2 ** 0.2) < 1e-9,
  `${lang}, ${where}: by the arrow keys the aperture goes from f/2.8 to ${s2.aperture.text} and the compensation to ${s2.ev.text}, and the chain has them (f/${s2.post.aperture}, ${s2.post.ev} EV: the light of the final pass ${(s2.post.exposure / s2.post.base).toFixed(5)} times)`);
  const small = [s1.depth, s1.aperture, s1.ev, s2.aperture, s2.ev].filter((b) => b.w < 39.5 || b.h < 39.5);
  const out = [s1.depth, s1.aperture, s1.ev, s2.depth, s2.aperture, s2.ev].filter((b) => !b.inside);
  say(!small.length && !out.length && !touch.small.length && !touch.out.length && !clipped.length && !cjk.length,
    `${lang}, ${where}: with the depth of field on the switch is ${s1.depth.w}x${s1.depth.h} and the two sliders ${s1.aperture.w}x${s1.aperture.h} and ${s1.ev.w}x${s1.ev.h} (40 x 40 at least), all of it on the screen, nothing to touch is under 40 x 40 (${touch.count} things), no word runs out of its box${cjk.length ? ' (Chinese in the English page: ' + cjk.slice(0, 3) + ')' : ''}${clipped.length ? ' (clipped: ' + clipped.slice(0, 3) + ')' : ''}`);
  await page.click('#btnPhotoDepth');
  const s3 = await page.run(glassState);
  say(s3.depth.pressed === 'false' && s3.aperture.disabled && s3.aperture.dim === 'true' && !s3.post.enabled && !s3.photo.depthOn && s3.ev.text === '+0.2 EV',
    `${lang}, ${where}: the switch again, and the depth of field is off (the chain's ${s3.post.enabled}), the aperture slider dim and still, the compensation as it was set (${s3.ev.text})`);
  results[`glass-${lang}-${where}`] = { off: s0, on: s1, set: s2, again: s3, small: touch.small };
}

// Where there is no mouse (a touch screen and nothing finer) the photo mode's
// button is not in the bar: the rule that says so, and the page with the
// browser made to be a phone, if it takes that to mean no fine pointer.
async function touchCheck(page) {
  const mouse = await page.run(photoButton);
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(800);
  const touch = await page.run(photoButton);
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await page.size(1280, 720);
  say(!!mouse.rule && mouse.fine && mouse.shown && (touch.fine ? true : !touch.shown),
    `with a mouse about (a fine pointer) the photo mode's button is in the bar; a rule takes it away where there is no fine pointer ("${mouse.rule}")`
    + `${touch.fine ? '; the browser made a phone of keeps a fine pointer to its media queries, so the rule is what is read' : `; made a phone (pointer coarse ${touch.coarse}, no fine pointer) the button is ${touch.shown ? 'STILL THERE' : 'gone'}`}`);
  results.touch = { mouse, touch };
}

// What the page writes as the name of each world and the line under it.
async function namesCheck(page, lang) {
  const cap = (id) => id[0].toUpperCase() + id.slice(1);
  const written = await page.run(namesWritten, { worlds: WORLDS.map((w) => w.id) });
  const bad = written.filter((n, i) => n.nm !== (lang === 'zh' ? WORLDS[i].name : cap(WORLDS[i].id)) || n.ln !== TABLES[lang]['world.line.' + n.id]
    || (lang === 'en' && (CJK.test(n.nm) || CJK.test(n.ln))));
  say(!bad.length, `${lang}: the page writes each of the ${written.length} worlds' name and its line (${written.map((n) => n.nm).join(' ')})${bad.length ? ' (not right: ' + bad.map((n) => n.id) + ')' : ''}`);
}

// The road comes into three worlds, and then some: what comes up, for how long
// and in what words, and the rest of what the visitor sees on the way: the
// hint of a first visit, the instrument going quiet, the name in wallpaper
// mode and behind a verse. How the crossings are driven: the borders are the
// loop's own, 2.5 km of progress apart (worldlen=2500, about 3 km of road); the
// car, driven by the autopilot, is stepped by hand in the page, 0.1 s of the
// game a step (Game.update, then WorldName.update, as the loop does), as far as
// the next name, because the frames of a page drawn in software come too slowly
// to wait for the road to be driven. Game.nextWorld is not used: asked a second
// time while the world it asked for is still ahead, it goes one world past it.
async function onTheRoad(lang) {
  const zh = lang === 'zh';
  // A small window and the lowest tier: the frames of a page drawn in software
  // are long (half a second and more at 1280 x 720), and what is read here is
  // 0.3 s long at the shortest; at this size the frames are short beside it.
  const page = await openPage({ languages: zh ? ['zh-CN'] : ['en-US', 'en'], size: [480, 360], before: LOG_SCRIPT });
  const cap = (id) => id[0].toUpperCase() + id.slice(1);
  const logged = async () => page.ev('window.__log');
  try {
    await page.goto('seed=7&worldlen=2500&tier=low');

    // The hint of a first visit, in a browser with nothing kept: what it says
    // and what is kept, and how long it stays by the page's own clock.
    let seen = null;
    for (const t0 = Date.now(); !seen && Date.now() - t0 < 25000;) {
      seen = await page.ev(`(() => { const e = document.getElementById('firsthint'); return e && e.classList.contains('show') ? { text: e.textContent, mark: localStorage.getItem('${HINT_KEY}') } : null; })()`);
      if (!seen) await sleep(200);
    }
    let log = await logged();
    for (const t0 = Date.now(); !log.some((e) => e.what === 'hint removed') && Date.now() - t0 < 25000;) {
      await sleep(300);
      log = await logged();
    }
    const at = (what) => (log.find((e) => e.what === what) || {}).at;
    const visible = at('hint hidden') - at('hint shown');
    const total = at('hint removed') - at('hint added');
    say(!!seen && seen.text === TABLES[lang]['hint.first'] && seen.mark === '1' && visible >= HINT_MS - 800 && visible <= HINT_MS + 1500 && total <= HINT_MS + 3000,
      `${lang}: the hint of a first visit comes up in a browser with nothing kept ("${seen && seen.text}"), is marked as seen as it does, stays ${Number.isFinite(visible) ? (visible / 1000).toFixed(2) : '?'} s `
      + `by the page's clock (${HINT_MS / 1000} s) and is out of the page ${Number.isFinite(total) ? (total / 1000).toFixed(2) : '?'} s after it was put in`);
    results[`hint-${lang}`] = { seen, visible, total };

    if (zh) {
      // Half a minute with no input: the instrument and the buttons at 0.35.
      const sinceInput = () => page.ev('ui.idle.last === null ? 0 : performance.now() - ui.idle.last');
      for (let since = await sinceInput(); since < IDLE_MS + 1500; since = await sinceInput()) {
        await sleep(Math.min(1000, IDLE_MS + 1550 - since));
      }
      let q = null;
      for (let i = 0; i < 40; i++) {
        q = await page.run(quietNow);
        if (q.idle && Math.abs(q.hud - 0.35) <= 0.02 && Math.abs(q.bar - 0.35) <= 0.02) break;
        await sleep(250);
      }
      say(q.idle && Math.abs(q.hud - 0.35) <= 0.02 && Math.abs(q.bar - 0.35) <= 0.02,
        `after ${(q.since / 1000).toFixed(1)} s with no input the instrument is at ${q.hud.toFixed(3)} and the buttons at ${q.bar.toFixed(3)} (0.35 within 0.02)`);

      // One input: the pointer moves. The transition (declared 0.3 s) is made in
      // the first frame after the input, starts to run in the next, and is
      // finished in the first frame 0.3 s after that: the page says when, by its
      // own clock, and what the opacity then is. How soon after the input the
      // first frame comes is the page's frame rate.
      await page.run(sampleWake, 3500);
      await sleep(500);
      await page.moveTo(240, 180);
      const right = await page.run(quietNow);
      await sleep(2500);
      const w = await page.ev('window.__wake');
      const gaps = w.frames.slice(1).map((f, i) => f[0] - w.frames[i][0]).sort((a, b) => a - b);
      const frameMs = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
      const ran = w.finishedAt === null || w.readyAt === null ? null : w.finishedAt - w.readyAt;
      // (The two times are of frames, so they are 0.3 s apart to within two frames.)
      say(!right.idle && !!w.anim && w.anim[0] === 300 && w.input !== null && ran !== null && Math.abs(ran - 300) <= 2 * frameMs && w.finalOpacity >= 0.99,
        `one input and the class is off in the event (${right.idle ? 'still there' : 'gone'}); the opacity is declared as a transition of ${w.anim && w.anim[0]} ms, which ran `
        + `${ran === null ? '?' : Math.round(ran) + ' ms'} by the page's clock and was at ${w.finalOpacity === null ? '?' : w.finalOpacity} when it finished, `
        + `${w.readyAt === null || w.input === null ? '?' : Math.round(w.readyAt - w.input)} ms after the input it began (the frames are ${frameMs === null ? '?' : Math.round(frameMs)} ms apart in this page)`);
      results.quiet = { quiet: q, wake: { anim: w.anim, lag: w.readyAt - w.input, ran, finalOpacity: w.finalOpacity, frameMs } };

      // With the car in the visitor's hands, or a menu open, it stays as it is however long.
      await page.ev('ui.idle.last = performance.now() - 40000; game.autoMode = false; 0');
      await sleep(1000);
      const byHand = await page.run(quietNow);
      await page.ev('game.autoMode = true; document.getElementById("btnSettings").click(); ui.idle.last = performance.now() - 40000; 0');
      await sleep(1000);
      const open = await page.run(quietNow);
      await page.ev('document.getElementById("btnSettings").click(); ui.idle.last = performance.now() - 40000; 0');
      await sleep(1000);
      const shut = await page.run(quietNow);
      await page.moveTo(250, 190);
      say(!byHand.idle && byHand.hud > 0.99 && !open.idle && open.hud > 0.99 && shut.idle,
        `driven by hand (${byHand.hud.toFixed(2)}) or with the settings open (${open.hud.toFixed(2)}) it does not go quiet after 40 s; shut and left alone it does (${shut.hud.toFixed(2)})`);
    }

    // The name of a world as the road comes into it, each to the end of its
    // animation.
    await page.run(watchNames);
    const order = ['hills', 'river', 'coast'];
    const stepped = [];
    for (const id of order) {
      const have = await page.ev('ui.worldname.shown.length');
      stepped.push(await page.run(stepUntilNamed, { have, max: 8000 }));
      // This name's own animation, to its end (the next name, put on while it
      // is still going, would cut it short).
      const i = stepped.length - 1;
      for (const t0 = Date.now(); Date.now() - t0 < 15000 && !(await page.ev(`!!(window.__names[${i}] && window.__names[${i}].end)`));) await sleep(200);
    }
    const names = await page.ev('window.__names');
    const frames = JSON.stringify([[0, 0], [0.2, 1], [0.75, 1], [1, 0]]);
    const wrote = order.map((id, i) => {
      const n = names[i];
      return !!n && n.nm === (zh ? WORLDS.find((w) => w.id === id).name : cap(id)) && n.ln === TABLES[lang]['world.line.' + id] && n.lang === (zh ? 'zh-CN' : 'en');
    });
    const stays = names.map((n) => (n && n.end ? (n.end - n.start) / 1000 : null));
    // When the class that shows the name went on and off, by the page's clock.
    const nameLog = (await logged()).filter((e) => e.what.startsWith('name'));
    const classOn = nameLog.filter((e) => e.what === 'name shown').map((e, i) => {
      const off = nameLog.filter((x) => x.what === 'name hidden')[i];
      return off ? ((off.at - e.at) / 1000).toFixed(2) : '?';
    });
    say(names.length === 3 && wrote.every(Boolean) && stepped.every((s, i) => s.last && s.last.id === order[i]),
      `${lang}: the name came up ${names.length} times as the road came into ${order.join(', ')}: ${names.map((n) => `"${n.nm}" over "${n.ln}"`).join('; ')} `
      + `(${stepped.map((s) => s.steps + ' steps, ' + s.at + ' m').join('; ')})`);
    say(stays.length === 3 && stays.every((s) => s !== null && s >= 3.5 && s <= 4.5) && names.every((n) => n.duration === 4000 && JSON.stringify(n.keyframes) === frames),
      `${lang}: each name stayed ${stays.map((s) => (s === null ? '?' : s.toFixed(2))).join(', ')} s (3.5 to 4.5), the animation declared as ${names[0] && names[0].duration} ms with opacity at 0, 1, 1, 0 at 0, 0.2, 0.75, 1 `
      + `(0.8 s in, 2.2 s held, 1 s out; the class that starts it was on ${classOn.join(', ')} s, a second or two more than the animation, as the first frame after the car is stepped by hand comes late)`);
    results[`names-${lang}`] = { stepped, names, nameLog };

    if (zh) {
      // Behind a verse: four seconds late.
      await page.ev('document.getElementById("passnote").classList.add("show"); 0');
      const t1 = await page.ev('performance.now()');
      await page.ev('ui.worldname.announce("city"); 0');
      for (const t0 = Date.now(); Date.now() - t0 < 20000 && !(await page.ev('window.__names.length === 4 && !!window.__names[3].end'));) await sleep(200);
      const came = (await logged()).find((e) => e.what === 'name shown' && e.at > t1);
      await page.ev('document.getElementById("passnote").classList.remove("show"); 0');
      const late = came ? came.at - t1 : null;
      say(late !== null && late >= AFTER_VERSE - 300 && late <= AFTER_VERSE + 600,
        `with a verse up the name came ${late === null ? 'never' : (late / 1000).toFixed(2) + ' s'} after it was due, by the page's clock (${AFTER_VERSE / 1000} s)`);

      // In wallpaper mode the instrument is gone and the name still comes. The
      // wallpaper's own verse is on for its first seven seconds, and a name due
      // while a verse is up waits: the car is stepped when it is over.
      await page.ev('document.getElementById("btnWall").click(); 0');
      for (const t0 = Date.now(); Date.now() - t0 < 20000 && (await page.ev('document.getElementById("wallnote").getAnimations().length > 0'));) await sleep(300);
      const have = await page.ev('ui.worldname.shown.length');
      const wall = await page.run(stepUntilNamed, { have, max: 8000 });
      let inWall = null;
      for (const t0 = Date.now(); Date.now() - t0 < 10000;) {
        inWall = await page.ev(`({ name: +getComputedStyle(document.getElementById('worldname')).opacity, hud: +getComputedStyle(document.getElementById('hud')).opacity,
          wallpaper: document.body.classList.contains('wallpaper'), text: document.querySelector('#worldname .nm').textContent })`);
        if (inWall.name > 0.9 && inWall.hud < 0.01) break;
        await sleep(150);
      }
      await page.ev('document.getElementById("btnWall").click(); 0');
      say(wall.count > have && inWall.wallpaper && inWall.hud < 0.01 && inWall.name > 0.9,
        `in wallpaper mode the instrument is gone (${inWall.hud.toFixed(2)}) and the name "${inWall.text}" comes up (${inWall.name.toFixed(2)}; ${wall.steps} steps, ${wall.at} m)`);
    }
    say(!page.errors.length, `the ${lang} page's console is clean after the drive${page.errors.length ? ' (' + page.errors.slice(0, 2) + ')' : ''}`);

    if (zh) {
      // Opened again, with the mark kept: no hint.
      await page.goto('seed=7&worldlen=2500&tier=low');
      await sleep(HINT_MS / 2);
      const second = await page.ev(`({ shown: !!document.getElementById('firsthint'), mark: localStorage.getItem('${HINT_KEY}') })`);
      say(!second.shown && second.mark === '1', `opened again the hint is not there (the mark is ${second.mark})`);
    }
  } finally {
    page.close();
  }
}

// A headless page (run=) has a car that crosses a border and shows no name, no
// hint and no quiet. The run starts at 3300 m, 280 m short of the first border's
// middle (the car's place when the camera first passes it, seed 7, worldlen=2500,
// is about 3580 m), and goes on for 30 s of the game, at 20 frames a second.
async function headless() {
  const page = await openPage({ languages: ['zh-CN'] });
  try {
    await page.goto('seed=7&worldlen=2500&s=3300&run=600&fps=20&uishot=1', 'document.title === "GAME_DONE"');
    const d = await page.ev(`({ here: game.worldHere().id, t: game.worldHere().t, at: Math.round(game.sCar), named: ui.worldname.shown.length, shown: document.getElementById('worldname').classList.contains('show'),
      hint: !!document.getElementById('firsthint'), mark: localStorage.getItem('${HINT_KEY}'), state: ui.hint.state, quiet: document.body.classList.contains('idle') })`);
    say(d.here !== 'alpine' && !d.named && !d.shown && !d.hint && d.mark === null && d.state === 'done' && !d.quiet,
      `a headless page (run=) drove to ${d.at} m, into ${d.here} (past the middle of a border, t ${d.t.toFixed(2)}), and showed no name (${d.named}), no hint (the mark is ${d.mark}) and no quiet`);
    say(!page.errors.length, `the headless page's console is clean${page.errors.length ? ' (' + page.errors.slice(0, 2) + ')' : ''}`);
  } finally {
    page.close();
  }
}

// The dots of the world menu (open), as they stand: a row of three at the end of
// each day world's row and none on the others, named in the language, 40 x 40 or
// more and side by side, painted in the colours of their skies. wide: where the
// menu is (inside the screen); held: { world id: sky id } the dots held to, and
// still: whether they are still (the address holds them).
async function skyDotsCheck(page, lang, { held = {}, still = false, tag = '' } = {}) {
  const d = await page.run(dotsShown);
  const T = TABLES[lang];
  const day = WORLDS.filter(hasSkies).map((w) => w.id);
  const rows = d.rows.filter((r) => r.dots.length);
  const nameOf = (id) => worldName(WORLDS.find((w) => w.id === id));
  setLang(lang);
  const names = rows.every((r) => r.group && r.group.role === 'group' && r.group.label === T['sky.of'].replace('{name}', nameOf(r.world))
    && r.dots.every((x) => x.title === T['sky.' + x.sky] && x.label === T['sky.' + x.sky] && x.title === skyName(x.sky)));
  setLang('zh');
  const shaped = d.rows.length === 12 && rows.map((r) => r.world).join() === day.join() && d.rows.every((r) => (r.dots.length === 3) === day.includes(r.world))
    && rows.every((r) => r.dots.map((x) => x.sky).join() === SKIES.join());
  const sized = rows.every((r) => r.dots.every((x) => x.w >= 39.5 && x.h >= 39.5 && Math.abs(x.y - r.dots[0].y) < 0.5)
    && r.dots.every((x, i) => i === 0 || Math.abs(x.x - (r.dots[i - 1].x + r.dots[i - 1].w)) < 1));
  const want = SKIES.map((id) => skySwatchOf(id).map(rgbOf));
  const painted = rows.every((r) => r.dots.every((x, i) => x.colours.length === 2 && x.colours[0].join() === want[i][0].join() && x.colours[1].join() === want[i][1].join()));
  const pressed = rows.every((r) => r.dots.every((x) => x.pressed === String(held[r.world] === x.sky)));
  const frozen = rows.every((r) => r.dots.every((x) => x.disabled === still));
  const inside = d.menu.l >= 0 && d.menu.t >= 0 && d.menu.r <= d.menu.vw && d.menu.b <= d.menu.vh;
  const smallest = Math.min(...rows.flatMap((r) => r.dots.map((x) => Math.min(x.w, x.h))));
  say(shaped && names && sized && painted && inside,
    `${lang}${tag}: ${rows.length} rows of 3 dots at the end of the day worlds' rows (${rows.map((r) => r.world).join(' ')}) and none on the other ${d.rows.length - rows.length}, named "${T['sky.noon']}", "${T['sky.golden']}", "${T['sky.grey']}" `
    + `and as a group "${rows[0] && rows[0].group && rows[0].group.label}", side by side, the smallest ${smallest.toFixed(0)} x ${smallest.toFixed(0)} px (40 at least), painted in their skies' colours, the menu ${inside ? 'inside' : 'not inside'} the screen`
    + `${shaped && names && sized && painted && inside ? '' : ` (shaped ${shaped}, named ${names}, sized ${sized}, painted ${painted})`}`);
  say(pressed && frozen && d.hint === T['worlds.sky'] && d.note.hidden === !still && (!still || d.note.text === T['set.byUrl']),
    `${lang}${tag}: ${Object.keys(held).length ? 'held: ' + Object.entries(held).map(([w, k]) => `${w} ${k}`).join(', ') : 'none held'}${still ? ', every dot still and "' + d.note.text + '" beside them' : ''}, the line about the dots is "${d.hint}"`
    + `${pressed && frozen ? '' : ` (pressed ${pressed}, still ${frozen})`}`);
  return d;
}

// Hold a world to a sky by a click on its dot, in the page; the sky is in force
// when the page says so (its frames come slowly: it is waited for).
async function inForce(page, sun) {
  let now = null;
  for (const t0 = Date.now(); Date.now() - t0 < 60000;) {
    now = await page.run(skyNow);
    if (Math.abs(now.sun - sun) < 1e-6) break;
    await sleep(400);
  }
  return now;
}

// The dots of the world menu: what they are, what a click does, what is kept, and
// what the address and a headless run do with them.
async function onSkies() {
  const noon = skyLook(WORLDS.find((w) => w.id === 'alpine').look, 'noon').sunIntensity;
  const golden = skyLook(WORLDS.find((w) => w.id === 'alpine').look, 'golden').sunIntensity;
  const grey = skyLook(WORLDS.find((w) => w.id === 'alpine').look, 'grey').sunIntensity;
  const dot = (w, k) => `#worldList li[data-world="${w}"] .dot[data-sky="${k}"]`;
  const kept = (page) => page.ev(`localStorage.getItem('continuum.sky')`);
  const pinsOf = (page) => page.ev(`Array.from(game.skies.pins).join()`);

  const page = await openPage({ languages: ['zh-CN'] });
  try {
    await page.goto('seed=7');
    await page.click('#btnWorlds');
    await skyDotsCheck(page, 'zh');
    const first = await page.run(skyNow);
    say(first.world === 'alpine' && first.sky === 'noon' && Math.abs(first.sun - noon) < 1e-9 && first.mark === 'alpine noon' && (await kept(page)) === null,
      `a first visit is under noon, the sky the road is under is marked on its dot (${first.mark}), and nothing is kept (${await kept(page)})`);

    // A click holds a world to a sky; the same dot lets it go; the menu stays open.
    await page.click(dot('hills', 'golden'));
    const a = await page.ev(`({ pin: ui.settings.skyPin('hills'), kept: localStorage.getItem('continuum.sky'), game: game.skies.pins[${WORLD_INDEX.hills}], later: game.skies.of(${WORLD_INDEX.hills}, 5), open: !document.getElementById('worlds').hidden })`);
    say(a.pin === 'golden' && a.kept === '{"hills":"golden"}' && a.game === 1 && a.later === 1 && a.open && (await page.run(dotsOf, 'hills')) === 'false,true,false',
      `a click on the hills' golden dot holds the hills to golden (kept as ${a.kept}; the game has it for every lap: lap 5 is ${SKIES[a.later]}), the dot is the held one, the menu stays open`);
    await page.click(dot('hills', 'grey'));
    const b = await page.ev(`({ kept: localStorage.getItem('continuum.sky'), game: game.skies.pins[${WORLD_INDEX.hills}] })`);
    await page.click(dot('hills', 'grey'));
    const c = await page.ev(`({ kept: localStorage.getItem('continuum.sky'), game: game.skies.pins[${WORLD_INDEX.hills}], pin: ui.settings.skyPin('hills') })`);
    say(b.kept === '{"hills":"grey"}' && b.game === 2 && c.kept === '{}' && c.game === -1 && c.pin === null && (await page.run(dotsOf, 'hills')) === 'false,false,false',
      `another dot moves the hold (${b.kept}); the same dot again lets go (${c.kept}), and the hills go by their laps again`);

    // The road is under the sky its world is held to, at once; the mark moves with it.
    await page.click(dot('alpine', 'golden'));
    const under = await inForce(page, golden);
    await sleep(900);
    const marked = await page.run(skyNow);
    say(Math.abs(under.sun - golden) < 1e-6 && under.sky === 'golden' && under.red > under.blue * 2 && marked.mark === 'alpine golden',
      `the alpine held to golden, the road is under it (the sun ${under.sun.toFixed(3)} of ${noon}, red ${under.red.toFixed(2)} against blue ${under.blue.toFixed(2)}, the mark on ${marked.mark})`);
    results.skyUnder = { golden: under, marked };
    await page.click(dot('alpine', 'grey'));
    const grey1 = await inForce(page, grey);
    say(Math.abs(grey1.sun - grey) < 1e-6 && grey1.sky === 'grey' && Math.abs(grey1.red - grey1.blue) < 1e-6,
      `moved to grey it is a white light of ${grey1.sun.toFixed(3)}`);
    await page.click(dot('alpine', 'golden'));
    await page.click(dot('coast', 'grey'));
    const stored = await kept(page);
    await page.shot('ui-zh-worlds-skies.png');
    const heldNow = await skyDotsCheck(page, 'zh', { held: { alpine: 'golden', coast: 'grey' }, tag: ' held' });
    void heldNow;

    // Opened again, the worlds are still held and the road starts under it.
    await page.goto('seed=7');
    await page.click('#btnWorlds');
    await skyDotsCheck(page, 'zh', { held: { alpine: 'golden', coast: 'grey' }, tag: ' opened again' });
    const again = await page.run(skyNow);
    say(Math.abs(again.sun - golden) < 1e-9 && again.sky === 'golden' && (await kept(page)) === stored && (await pinsOf(page)).split(',')[WORLD_INDEX.coast] === '2',
      `opened again the alpine are held to golden still (the sun is ${again.sun.toFixed(3)} from the first frame) and the coast to grey (${stored})`);

    // The address: every day world, over what was kept; the dots are still.
    await page.goto('seed=7&sky=grey');
    await page.click('#btnWorlds');
    const all = Object.fromEntries(WORLDS.filter(hasSkies).map((w) => [w.id, 'grey']));
    await skyDotsCheck(page, 'zh', { held: all, still: true, tag: ' by the address' });
    await page.click(dot('hills', 'golden'));
    const addr = await page.ev(`({ pin: ui.settings.skyPin('hills'), kept: localStorage.getItem('continuum.sky'), sun: game.atmosphere.look.sunIntensity })`);
    say(addr.pin === 'grey' && addr.kept === stored && Math.abs(addr.sun - grey) < 1e-9,
      `sky=grey in the address is over the alpine held to golden (the sun is ${addr.sun.toFixed(3)}), clicking a dot changes nothing, and what was kept is as it was (${addr.kept})`);
    await page.shot('ui-zh-worlds-skies-address.png');

    // A phone: the same dots, 40 x 40, the menu on the screen.
    await page.goto('seed=7');
    await page.size(390, 844);
    await page.click('#btnWorlds');
    await skyDotsCheck(page, 'zh', { held: { alpine: 'golden', coast: 'grey' }, tag: ' on a phone' });
    const phone = await page.run(touching);
    say(!phone.small.length && !phone.out.length, `on a phone (390 x 844) with the dots there is nothing to touch under 40 x 40 (${phone.count} things) and the menu is on the screen`);
    await page.shot('ui-zh-narrow-worlds-skies.png');
    say(!page.errors.length, `the Chinese page's console is clean with the dots${page.errors.length ? ' (' + page.errors.slice(0, 2) + ')' : ''}`);
  } finally {
    page.close();
  }

  // In English: the names and the line.
  const en = await openPage({ languages: ['en-US', 'en'] });
  try {
    await en.goto('seed=7');
    await en.click('#btnWorlds');
    await skyDotsCheck(en, 'en');
    await en.shot('ui-en-worlds-skies.png');
    const text = await en.run(chinese);
    const over = await en.run(overflowing);
    say(!text.length && !over.length, `in English the dots and their line have no Chinese in them and no button's text runs out of its box${text.length ? ' (' + text.slice(0, 3) + ')' : ''}${over.length ? ' (' + over.slice(0, 3) + ')' : ''}`);
    say(!en.errors.length, `the English page's console is clean with the dots${en.errors.length ? ' (' + en.errors.slice(0, 2) + ')' : ''}`);
  } finally {
    en.close();
  }

  // A headless run keeps nothing and reads nothing of the skies; the address it reads.
  const head = await openPage({ languages: ['zh-CN'], before: `try { localStorage.setItem('continuum.sky', '{"alpine":"golden"}'); } catch { /* a document with no origin yet */ }` });
  try {
    await head.goto('seed=7&run=5', 'document.title === "GAME_DONE"');
    const h = await head.ev(`({ pins: Array.from(game.skies.pins).join(), all: game.skies.all, sun: game.atmosphere.look.sunIntensity, values: JSON.stringify(ui.settings.get('sky')), kept: localStorage.getItem('continuum.sky'), sky: game.worldHere().sky })`);
    await head.goto('seed=7&run=5&sky=grey', 'document.title === "GAME_DONE"');
    const g2 = await head.ev(`({ all: game.skies.all, sun: game.atmosphere.look.sunIntensity, sky: game.worldHere().sky, kept: localStorage.getItem('continuum.sky') })`);
    say(h.pins.split(',').every((v) => v === '-1') && h.all === -1 && Math.abs(h.sun - noon) < 1e-9 && h.values === '{}' && h.kept === '{"alpine":"golden"}' && h.sky === 'noon'
      && g2.all === SKY_INDEX.grey && Math.abs(g2.sun - grey) < 1e-9 && g2.sky === 'grey' && g2.kept === '{"alpine":"golden"}',
    `a headless page (run=) has nothing the world menu kept (a store of {"alpine":"golden"} is under noon, ${h.sun.toFixed(3)}, and left as it was) and does what the address says (sky=grey: ${g2.sun.toFixed(3)})`);
    say(!head.errors.length, `the headless page's console is clean${head.errors.length ? ' (' + head.errors.slice(0, 2) + ')' : ''}`);
  } finally {
    head.close();
  }
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

    // The name written for each world, and the strips in the world menu.
    await namesCheck(page, 'zh');
    await page.click('#btnWorlds');
    await stripsCheck(page, 'zh');
    await page.click('#btnWorlds');

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
    await crowdCheck(page, 'zh', 'wide');
    await heldPictures(page, 'zh');
    await photoCheck(page, 'zh', 'wide');
    await page.size(390, 844);
    await pictures(page, 'zh', 'narrow');
    const phone = await sweepMenus(page, 'zh');
    say(!phone.small.length && !phone.off.length,
      `on a phone (390 x 844) nothing to touch is under 40 x 40 and no panel leaves the screen${phone.small.length ? ' (small: ' + phone.small.slice(0, 4) + ')' : ''}${phone.off.length ? ' (off: ' + phone.off.slice(0, 3) + ')' : ''}`);
    results.phoneZh = phone;
    await crowdCheck(page, 'zh', 'phone');
    await photoCheck(page, 'zh', 'phone');
    await page.size(1280, 720);
    await touchCheck(page);

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
    await namesCheck(page, 'en');
    await page.click('#btnWorlds');
    await stripsCheck(page, 'en');
    await page.click('#btnWorlds');

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
    await crowdCheck(page, 'en', 'wide');
    await heldPictures(page, 'en');
    await photoCheck(page, 'en', 'wide');
    await page.size(390, 844);
    await pictures(page, 'en', 'narrow');
    const phone = await sweepMenus(page, 'en');
    say(!phone.small.length && !phone.off.length,
      `on a phone, in English: nothing to touch is under 40 x 40 and no panel leaves the screen${phone.small.length ? ' (small: ' + phone.small.slice(0, 4) + ')' : ''}${phone.off.length ? ' (off: ' + phone.off.slice(0, 3) + ')' : ''}`);
    say(!phone.clipped.length, `...and no button's text runs out of its box${phone.clipped.length ? ' (' + phone.clipped.slice(0, 4) + ')' : ''}`);
    await crowdCheck(page, 'en', 'phone');
    await photoCheck(page, 'en', 'phone');
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
    // The sound goes by the same choice: the squeal of tyres holds steady where the lens is still. And off, the audio clock stops.
    await page2.click('#btnSound');
    await sleep(600);
    const calm = await page2.ev(`ui.sound ? { calm: ui.sound.calm, tremble: ui.sound.trembleLevel.gain.value, clock: ui.sound.ctx.state } : null`);
    say(!!calm && calm.calm === true, `the sound made while the lens is still keeps the squeal steady (${calm && calm.calm})`);
    await page2.click('#btnSound');
    await sleep(3800);
    const muted = await page2.ev(`ui.sound ? { clock: ui.sound.ctx.state, master: ui.sound.master.gain.value } : null`);
    if (calm && calm.clock === 'running') say(!!muted && muted.clock === 'suspended', `the sound turned off for 3.8 s has its audio clock stopped (${muted && muted.clock}, the whole at ${muted && muted.master.toFixed(5)})`);
    else say(!!muted, `the sound turned off for 3.8 s (its audio clock was ${calm && calm.clock}, so it was not read)`);
    await page2.click('#btnSound');
    await sleep(600);
    const again = await page2.ev(`ui.sound ? ui.sound.ctx.state : null`);
    if (calm && calm.clock === 'running') say(again === 'running', `...and turned on again it runs (${again})`);
    // (A click outside shut the panel.)
    if (await page2.ev(`document.getElementById('settings').hidden`)) await page2.click('#btnSettings');
    await page2.click('#settings [data-key="motion"] [data-v="1"]');
    const on = await page2.ev(`({ shaking: game.chase.shaking, kept: localStorage.getItem('continuum.motion'), calm: ui.sound.calm })`);
    say(on.shaking === true && on.kept === '1', 'and the shake can be turned on against what the system asks');
    say(on.calm === false, 'and the squeal of the sound has its tremble again');
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
nameOfAWorld();
await quietInstrument();
firstHint();
stripsOfWorlds();
skyDotsOfWorlds();
const kill = () => { for (const p of open) p.close(); };
process.on('SIGINT', () => { kill(); process.exit(130); });

const server = serve();
try {
  if (!(await waitForServer())) throw new Error('server did not start');
  await inChinese();
  await inEnglish();
  await onTheRoad('zh');
  await onTheRoad('en');
  await headless();
  await onSkies();
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
console.error('\nOK: the settings are kept and take hold, the address bar wins, the interface is in English and in Chinese, and the name, the quiet instrument, the strips and the hint tell where the road is');
process.exit(0);
