// The words of the interface in both languages: the buttons, the menus, the
// instrument, the settings panel and its hints. Each key has one line in each
// table, and the two tables have the same keys (tools/ui_check.mjs holds them
// to it). The names of the worlds and of the styles are read from their own
// data: the Chinese ones are the names written there, the English ones are
// the ids with a capital. The three skies a day world has (`sky.*`) are named
// here, in both languages. Under the name that comes up as the road enters a
// world stands a line about it, one per world (the `world.line.*` keys: ten
// characters or fewer in Chinese, eight words or fewer in English). The lines
// of verse are not translated: in English a line of paraphrase in small type
// goes under each (the `verse.*` keys, empty in Chinese).
//
// Elements in the page name their line by an attribute: data-i (the text),
// data-i-title (the tooltip) or data-i-aria (the accessible name), and
// apply() writes them out. What the code writes itself (the instrument, the
// lists of worlds and styles) asks t() each time.

export const LANGS = ['zh', 'en'];
const HTML_LANG = { zh: 'zh-CN', en: 'en' };

const zh = {
  'page.title': 'Continuum 无限遛弯',
  'brand.tag': '无限遛弯',
  'brand.aria': 'Continuum 无限遛弯',

  'bar.worlds': '世界',
  'bar.styles': '画风',
  'bar.auto': '自动驾驶',
  'bar.wall': '壁纸',
  'bar.sound': '声音',
  'bar.worlds.title': '世界（N 下一个）',
  'bar.styles.title': '画风（V 下一种）',
  'bar.cam.title': '切换机位（C）',
  'bar.auto.title': '自动驾驶（P）',
  'bar.wall.title': '壁纸模式（H）',
  'bar.sound.title': '声音（M）',
  'bar.source.title': '源代码',
  'bar.settings.title': '设置',

  'cam.chase': '追车',
  'cam.director': '导演',
  'cam.drone': '航拍',
  'cam.side': '侧拍',
  'cam.low': '低机位',
  'cam.front': '正面',
  'cam.hood': '引擎盖',
  'cam.other': '机位',

  'hud.alt': '海拔',
  'hud.flat': '平坡',
  'hud.up': '上坡',
  'hud.down': '下坡',
  'hud.tunnel': '隧道',
  'hud.viaduct': '高架桥',
  'hud.bridge': '桥',
  'hud.left': '{kind} · 还有 {dist}',
  'hud.next': '距{name} {dist}',
  'hud.profile': '前方公路纵断面',

  'worlds.next': '下一个世界',
  'worlds.loop': '轮流出现',
  'worlds.go': '前往{name}',
  'worlds.here': '此处',
  'worlds.ahead': '前方',
  'worlds.hint': '勾选的世界轮流出现',
  'worlds.sky': '圆点钉住天色，再点松开',
  'styles.next': '下一种画风',

  'sky.of': '{name}的天色',
  'sky.noon': '正午',
  'sky.golden': '金色',
  'sky.grey': '阴天',

  'world.line.alpine': '路从山里修出来',
  'world.line.hills': '缓坡上有农舍和风车',
  'world.line.river': '河和路并排走',
  'world.line.coast': '海风里带着浪沫',
  'world.line.desert': '风把沙吹过路面',
  'world.line.city': '天刚黑，楼一扇扇亮',
  'world.line.cavern': '一个国家那么大的洞',
  'world.line.inferno': '火星从岩浆里飘起来',
  'world.line.abyss': '海面在头顶亮着',
  'world.line.heaven': '云在脚下，光是白的',
  'world.line.space': '白天也看得见星星',
  'world.line.upside': '一切都倒挂着',

  'hint.first': '它自己会开。按 P 接手。',

  'set.quality': '画质',
  'set.auto': '自动',
  'set.high': '高',
  'set.mid': '中',
  'set.low': '低',
  'set.cap': '帧率上限',
  'set.nocap': '不限',
  'set.res': '清晰度',
  'set.res.title': '场景画到画布的几成，随帧率自动调',
  'set.shake': '镜头晃动',
  'set.on': '开',
  'set.off': '关',
  'set.master': '总音量',
  'set.car': '车声',
  'set.ambient': '环境声',
  'set.units': '单位',
  'set.lang': '语言',
  'set.langZh': '中文',
  'set.langEn': 'English',
  'set.byUrl': '由地址栏指定',

  'verse.wall': '',
  'verse.pass': '',
  'verse.turn': '',
  'verse.ink': '',
};

const en = {
  'page.title': 'Continuum · Endless Drive',
  'brand.tag': 'Endless Drive',
  'brand.aria': 'Continuum, endless drive',

  'bar.worlds': 'Worlds',
  'bar.styles': 'Styles',
  'bar.auto': 'Autopilot',
  'bar.wall': 'Wallpaper',
  'bar.sound': 'Sound',
  'bar.worlds.title': 'Worlds (N for the next one)',
  'bar.styles.title': 'Styles (V for the next one)',
  'bar.cam.title': 'Change camera (C)',
  'bar.auto.title': 'Autopilot (P)',
  'bar.wall.title': 'Wallpaper mode (H)',
  'bar.sound.title': 'Sound (M)',
  'bar.source.title': 'Source code',
  'bar.settings.title': 'Settings',

  'cam.chase': 'Chase',
  'cam.director': 'Director',
  'cam.drone': 'Drone',
  'cam.side': 'Side',
  'cam.low': 'Low',
  'cam.front': 'Front',
  'cam.hood': 'Hood',
  'cam.other': 'Camera',

  'hud.alt': 'Alt',
  'hud.flat': 'Flat',
  'hud.up': 'Up',
  'hud.down': 'Down',
  'hud.tunnel': 'Tunnel',
  'hud.viaduct': 'Viaduct',
  'hud.bridge': 'Bridge',
  'hud.left': '{kind} · {dist} left',
  'hud.next': '{name} in {dist}',
  'hud.profile': 'Road profile ahead',

  'worlds.next': 'Next world',
  'worlds.loop': 'Takes turns',
  'worlds.go': 'Go to {name}',
  'worlds.here': 'Here',
  'worlds.ahead': 'Ahead',
  'worlds.hint': 'Ticked worlds take turns',
  'worlds.sky': 'A dot keeps a world to its sky; click it again to let go',
  'styles.next': 'Next style',

  'sky.of': 'Sky of {name}',
  'sky.noon': 'Noon',
  'sky.golden': 'Golden',
  'sky.grey': 'Grey',

  'world.line.alpine': 'A road cut out of the mountain',
  'world.line.hills': 'Farms and windmills on gentle slopes',
  'world.line.river': 'River and road, side by side',
  'world.line.coast': 'Salt spray on the wind',
  'world.line.desert': 'Sand blows across the road',
  'world.line.city': 'Dusk, and the windows light one by one',
  'world.line.cavern': 'A cave as big as a country',
  'world.line.inferno': 'Embers drift up from the lava',
  'world.line.abyss': 'The surface glows far overhead',
  'world.line.heaven': 'Clouds below, the light nearly white',
  'world.line.space': 'Stars, even in daylight',
  'world.line.upside': 'Everything hangs the wrong way up',

  'hint.first': 'It drives itself. Press P to take over.',

  'set.quality': 'Quality',
  'set.auto': 'Auto',
  'set.high': 'High',
  'set.mid': 'Mid',
  'set.low': 'Low',
  'set.cap': 'Frame cap',
  'set.nocap': 'Unlimited',
  'set.res': 'Resolution',
  'set.res.title': 'How much of the canvas the scene is drawn at; it moves with the frame rate',
  'set.shake': 'Camera shake',
  'set.on': 'On',
  'set.off': 'Off',
  'set.master': 'Volume',
  'set.car': 'Car',
  'set.ambient': 'Ambience',
  'set.units': 'Units',
  'set.lang': 'Language',
  'set.langZh': 'Chinese',
  'set.langEn': 'English',
  'set.byUrl': 'Set by the address bar',

  'verse.wall': 'Walk to where the water ends, then sit and watch the clouds rise.',
  'verse.pass': 'Riding the whirlwind, it climbs ninety thousand li.',
  'verse.turn': 'The sky wheels and the earth turns; the emperor’s carriage comes home.',
  'verse.ink': 'A painting within the poem, a poem within the painting.',
};

export const TABLES = { zh, en };

const WORLDS_EN = {
  alpine: 'Alpine', hills: 'Hills', river: 'River', coast: 'Coast', desert: 'Desert', city: 'City',
  cavern: 'Cavern', inferno: 'Inferno', abyss: 'Abyss', heaven: 'Heaven', space: 'Space', upside: 'Upside',
};
const STYLES_EN = {
  real: 'Real', paint: 'Paint', ink: 'Ink', cel: 'Cel', print: 'Print', pixel: 'Pixel', block: 'Block',
};

let lang = 'zh';
const watchers = new Set();

export const getLang = () => lang;

// The language of the page from the browser's list of them, in its order: the
// first one that is Chinese or English. A list with neither is English.
export function detectLang(languages) {
  for (const l of languages || []) {
    const code = String(l).toLowerCase();
    if (code.startsWith('zh')) return 'zh';
    if (code.startsWith('en')) return 'en';
  }
  return 'en';
}

// Switch to this language: <html lang> goes with it and the watchers are
// told. Returns whether the language changed.
export function setLang(next) {
  if (!LANGS.includes(next)) return false;
  const changed = next !== lang;
  lang = next;
  if (typeof document !== 'undefined') document.documentElement.lang = HTML_LANG[next];
  if (changed) for (const fn of watchers) fn(next);
  return changed;
}

export function onLang(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

// The line for a key in the language now; {name} and the like are filled from vars.
export function t(key, vars) {
  let s = TABLES[lang][key];
  if (s === undefined) s = TABLES.zh[key];
  if (s === undefined) return key;
  return vars ? s.replace(/\{(\w+)\}/g, (all, k) => (k in vars ? String(vars[k]) : all)) : s;
}

// A world or a style ({ id, name } as in their data) by name in the language now.
export const worldName = (w) => (lang === 'en' ? WORLDS_EN[w.id] || w.id : w.name);
export const styleName = (s) => (lang === 'en' ? STYLES_EN[s.id] || s.id : s.name);
// A sky (an id of SKIES) by name in the language now.
export const skyName = (id) => t('sky.' + id);

// Write the lines out into every element under root that names one.
export function apply(root = document) {
  for (const el of root.querySelectorAll('[data-i]')) el.textContent = t(el.dataset.i);
  for (const el of root.querySelectorAll('[data-i-title]')) el.title = t(el.dataset.iTitle);
  for (const el of root.querySelectorAll('[data-i-aria]')) el.setAttribute('aria-label', t(el.dataset.iAria));
  if (root === document) document.title = t('page.title');
}
