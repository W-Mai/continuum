// What the visitor can set, and where each value comes from. Settings:
//
//   tier    auto | high | mid | low   how much there is to draw (render/quality.js)
//   cap     30 | 60 | 0               frames a second at most; 0 is every refresh
//   motion  true | false              the lens shakes over bumps and landings
//   vol     { master, car, ambient }  the sound, each 0..1
//   units   kmh | mph                 the instrument's speed and lengths
//   lang    zh | en                   the language of the interface
//   sky     { world id: sky id }      the day worlds held to one of their skies
//                                     (world/worlds.js, SKIES), by the dots of the
//                                     world menu; a world that is not in it takes
//                                     its skies in turn, a lap each
//   haptics true | false              a gamepad rumbles and a phone buzzes (core/haptics.js)
//   deadzone 0..0.3                   how far a stick or a finger goes before it steers
//   curve   linear | soft             how a push turns into steering (core/autopilot.js)
//   sens    0.6..1.4                  how much of the wheel a push turns
//   keys    instant | soft | softer   how fast the keys take the wheel to full lock and back
//
// A value comes from the address bar when it has a parameter there (tier=,
// cap=, lang=, haptics=, deadzone=, curve=, sens=, keys=): the panel shows it
// and cannot change it. Otherwise it is what the visitor chose, kept in
// localStorage under continuum.<name>, and failing that what the system says:
// the browser's languages, the "reduce motion" preference (the lens does not
// shake and nothing rumbles), 60 frames a second. A headless run (run=) takes
// the address bar and the defaults only, so a check sees the same page on every
// machine.
// sky= in the address (noon, golden or grey) holds every day world to that sky:
// the dots of the world menu show it and cannot be moved.
//
// Settings holds the values and tells whoever listens; SettingsPanel is the
// panel's own markup (index.html) wired to it.

import { TIERS } from '../render/quality.js';
import { WORLDS, SKIES, hasSkies } from '../world/worlds.js';
import { LANGS, detectLang } from './strings.js';
import { FEEL, CURVES, EASES, EASE_DEFAULT } from '../core/autopilot.js';

export const TIER_CHOICES = ['auto', ...TIERS];
export const UNIT_CHOICES = ['kmh', 'mph'];
export const CURVE_CHOICES = Object.keys(CURVES);
export const EASE_CHOICES = Object.keys(EASES);
export const DEADZONE = [0, 0.3];
export const SENS = [0.6, 1.4];
export const KEYS = {
  tier: 'continuum.tier',
  cap: 'continuum.cap',
  motion: 'continuum.motion',
  vol: 'continuum.vol',
  units: 'continuum.units',
  lang: 'continuum.lang',
  sky: 'continuum.sky',
  haptics: 'continuum.haptics',
  deadzone: 'continuum.deadzone',
  curve: 'continuum.curve',
  sens: 'continuum.sens',
  keys: 'continuum.keys',
};
export const BUSES = ['master', 'car', 'ambient'];
// The master volume at which the sound is as loud as it has always been; the
// top of the slider is a quarter louder.
export const MASTER_UNITY = 0.8;
export const DEFAULT_VOLUME = { master: MASTER_UNITY, car: 1, ambient: 1 };

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const within = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const BOOLEANS = ['motion', 'haptics'];

function volumeOf(o) {
  if (!o || typeof o !== 'object') return undefined;
  const v = { ...DEFAULT_VOLUME };
  for (const b of BUSES) if (typeof o[b] === 'number' && Number.isFinite(o[b])) v[b] = clamp01(o[b]);
  return v;
}

// The day worlds held to a sky, as the program holds them: only the worlds that
// have skies and only the skies there are, in the order of the worlds.
function skiesOf(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined;
  const v = {};
  for (const w of WORLDS) if (hasSkies(w) && SKIES.includes(o[w.id])) v[w.id] = o[w.id];
  return v;
}

// A value as the program holds it, or undefined when it is not one.
function check(key, v) {
  switch (key) {
    case 'tier': return TIER_CHOICES.includes(v) ? v : undefined;
    case 'cap': return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
    case 'motion': return typeof v === 'boolean' ? v : undefined;
    case 'vol': return volumeOf(v);
    case 'units': return UNIT_CHOICES.includes(v) ? v : undefined;
    case 'lang': return LANGS.includes(v) ? v : undefined;
    case 'sky': return skiesOf(v);
    case 'haptics': return typeof v === 'boolean' ? v : undefined;
    case 'deadzone': return typeof v === 'number' && Number.isFinite(v) ? within(v, DEADZONE) : undefined;
    case 'sens': return typeof v === 'number' && Number.isFinite(v) ? within(v, SENS) : undefined;
    case 'curve': return CURVE_CHOICES.includes(v) ? v : undefined;
    case 'keys': return EASE_CHOICES.includes(v) ? v : undefined;
    default: return undefined;
  }
}

// ...from the text localStorage keeps.
function fromText(key, text) {
  if (typeof text !== 'string') return undefined;
  switch (key) {
    case 'cap': case 'deadzone': case 'sens': return text === '' ? undefined : check(key, Number(text));
    case 'motion': case 'haptics': return text === '1' ? true : text === '0' ? false : undefined;
    case 'vol':
      try { return volumeOf(JSON.parse(text)); } catch { return undefined; }
    case 'sky':
      try { return skiesOf(JSON.parse(text)); } catch { return undefined; }
    default: return check(key, text);
  }
}

const toText = (key, v) => (BOOLEANS.includes(key) ? (v ? '1' : '0') : key === 'vol' || key === 'sky' ? JSON.stringify(v) : String(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export class Settings {
  // params: the address's URLSearchParams; storage: localStorage (or null);
  // run: a headless run; reduceMotion: the system asks for less motion;
  // languages: the browser's, as navigator.languages.
  constructor({ params = new URLSearchParams(), storage = null, run = false, reduceMotion = false, languages = [] } = {}) {
    this.storage = run ? null : storage;
    this.listeners = new Set();
    this.url = new Map();
    // The address bar: tier= and cap= read as the page always has; a tier
    // that is not one is no tier at all.
    if (TIER_CHOICES.includes(params.get('tier'))) this.url.set('tier', params.get('tier'));
    if (params.has('cap')) this.url.set('cap', Number(params.get('cap')) || 0);
    const lang = (params.get('lang') || '').toLowerCase().slice(0, 2);
    if (LANGS.includes(lang)) this.url.set('lang', lang);
    // sky=: one of the skies, for every day world.
    const sky = (params.get('sky') || '').toLowerCase();
    if (SKIES.includes(sky)) this.url.set('sky', sky);
    // haptics=0 or 1; deadzone= and sens= a number (held to its range); curve= and keys= a name.
    const flag = params.get('haptics');
    if (flag === '0' || flag === '1') this.url.set('haptics', flag === '1');
    for (const key of ['deadzone', 'sens']) {
      const raw = params.get(key);
      const n = raw === null || raw.trim() === '' ? undefined : check(key, Number(raw));
      if (n !== undefined) this.url.set(key, n);
    }
    for (const key of ['curve', 'keys']) {
      const v = check(key, (params.get(key) || '').toLowerCase());
      if (v !== undefined) this.url.set(key, v);
    }

    const system = {
      tier: 'auto',
      cap: 60,
      motion: run ? true : !reduceMotion,
      vol: { ...DEFAULT_VOLUME },
      units: 'kmh',
      lang: run ? 'zh' : detectLang(languages),
      haptics: run ? true : !reduceMotion,
      deadzone: FEEL.deadzone,
      curve: FEEL.curve,
      sens: FEEL.sens,
      keys: EASE_DEFAULT,
    };
    this.values = {};
    for (const key of Object.keys(KEYS)) {
      // (What the address says of the sky is no value of this: it holds all.)
      if (key === 'sky') continue;
      let v = this.url.get(key);
      if (v === undefined) v = fromText(key, this._read(key));
      this.values[key] = v === undefined ? system[key] : v;
    }
    this.values.sky = fromText('sky', this._read('sky')) || {};
  }

  _read(key) {
    try { return this.storage ? this.storage.getItem(KEYS[key]) : null; } catch { return null; }
  }

  get(key) {
    const v = this.values[key];
    return key === 'vol' || key === 'sky' ? { ...v } : v;
  }

  // The address bar gave this one: it cannot be changed here.
  locked(key) {
    return this.url.has(key);
  }

  // The sky the address holds every day world to, or undefined.
  skyAll() {
    return this.url.get('sky');
  }

  // The sky a world is held to, one of SKIES, or null where it takes its skies
  // in turn: the address holds every world to one, else it is what was chosen.
  skyPin(worldId) {
    return this.url.get('sky') || this.values.sky[worldId] || null;
  }

  // Hold a world to a sky, or with null let it go. Returns whether anything changed.
  pinSky(worldId, sky) {
    if (sky && !SKIES.includes(sky)) return false;
    const held = { ...this.values.sky };
    if (sky) held[worldId] = sky;
    else delete held[worldId];
    return this.set('sky', held);
  }

  // The tier to start the game at: high, mid or low when one is pinned.
  pinnedTier() {
    return this.values.tier === 'auto' ? undefined : this.values.tier;
  }

  // Change a value and keep it. Returns whether anything changed.
  set(key, value) {
    if (this.locked(key)) return false;
    const v = check(key, value);
    if (v === undefined || same(v, this.values[key])) return false;
    this.values[key] = v;
    try { if (this.storage) this.storage.setItem(KEYS[key], toText(key, v)); } catch { /* private mode */ }
    for (const fn of this.listeners) fn(key, this.get(key));
    return true;
  }

  // fn(key, value) after every change.
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

// The attribute a button carries for a value, and the value for an attribute.
const attrOf = (key, v) => (BOOLEANS.includes(key) ? (v ? '1' : '0') : String(v));
const valueOf = (key, attr) => (key === 'cap' ? Number(attr) : BOOLEANS.includes(key) ? attr === '1' : attr);
// What a slider of the feel says beside it.
const SAYS = {
  deadzone: (v) => Math.round(v * 100) + '%',
  sens: (v) => v.toFixed(2) + '\u00d7',
};

export class SettingsPanel {
  // root: the panel's element. scale(): the fraction of the canvas the scene
  // is drawn at now. close(): called when the panel asks to be closed (Esc).
  constructor(settings, root, { scale = () => 1, close = () => {} } = {}) {
    this.settings = settings;
    this.root = root;
    this.scale = scale;
    this.rows = [...root.querySelectorAll('.row[data-key]')].map((el) => ({
      key: el.dataset.key,
      el,
      group: el.querySelector('.seg'),
      note: el.querySelector('.byurl'),
    }));
    this.ranges = [...root.querySelectorAll('input[type="range"][data-bus]')];
    // The sliders of the feel of the wheel: a row of its own for each, by the setting it is.
    this.feels = [...root.querySelectorAll('.row[data-range]')].map((el) => ({
      key: el.dataset.range,
      el,
      input: el.querySelector('input[type="range"]'),
      out: el.querySelector('.val'),
      note: el.querySelector('.byurl'),
    }));
    this.res = root.querySelector('[data-res]');

    root.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b || b.disabled) return;
      const key = b.closest('.row[data-key]').dataset.key;
      settings.set(key, valueOf(key, b.dataset.v));
    });
    root.addEventListener('input', (e) => {
      const r = e.target;
      if (r.matches('input[type="range"][data-bus]')) {
        settings.set('vol', { ...settings.get('vol'), [r.dataset.bus]: Number(r.value) });
      } else if (r.matches('.row[data-range] input[type="range"]')) {
        settings.set(r.closest('.row[data-range]').dataset.range, Number(r.value));
      }
    });
    // The keys belong to the panel while it has the focus: arrows move a
    // slider and do not steer the car, letters are not shortcuts.
    root.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') close();
      else e.stopPropagation();
    });
    settings.onChange(() => this.refresh());
    this.refresh();
  }

  refresh() {
    const s = this.settings;
    for (const row of this.rows) {
      const cur = attrOf(row.key, s.get(row.key));
      const locked = s.locked(row.key);
      const buttons = [...row.group.querySelectorAll('button[data-v]')];
      // A value the options do not list (cap=45 in the address) gets an
      // option of its own, so the panel says what is in force.
      let extra = buttons.find((b) => 'extra' in b.dataset);
      if (buttons.some((b) => !('extra' in b.dataset) && b.dataset.v === cur)) {
        if (extra) extra.remove();
      } else {
        if (!extra) {
          extra = document.createElement('button');
          extra.type = 'button';
          extra.setAttribute('role', 'radio');
          extra.dataset.extra = '';
          row.group.appendChild(extra);
        }
        extra.dataset.v = cur;
        extra.textContent = cur;
      }
      for (const b of row.group.querySelectorAll('button[data-v]')) {
        b.setAttribute('aria-checked', String(b.dataset.v === cur));
        b.disabled = locked;
      }
      row.el.classList.toggle('locked', locked);
      if (row.note) row.note.hidden = !locked;
    }
    for (const row of this.feels) {
      const v = s.get(row.key);
      const locked = s.locked(row.key);
      if (Number(row.input.value) !== v) row.input.value = String(v);
      row.input.disabled = locked;
      row.input.setAttribute('aria-valuetext', SAYS[row.key](v));
      row.out.textContent = SAYS[row.key](v);
      row.el.classList.toggle('locked', locked);
      if (row.note) row.note.hidden = !locked;
    }
    const vol = s.get('vol');
    for (const r of this.ranges) {
      const v = vol[r.dataset.bus];
      if (Number(r.value) !== v) r.value = String(v);
      r.setAttribute('aria-valuetext', Math.round(v * 100) + '%');
      const out = r.parentElement.querySelector('.val');
      if (out) out.textContent = Math.round(v * 100) + '%';
    }
    this.tick();
  }

  // The read-only line: how much of the canvas the scene is drawn at.
  tick() {
    if (this.res) this.res.textContent = Math.round(this.scale() * 100) + '%';
  }
}
