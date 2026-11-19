// What the visitor can set, and where each value comes from. Settings:
//
//   tier    auto | high | mid | low   how much there is to draw (render/quality.js)
//   cap     30 | 60 | 0               frames a second at most; 0 is every refresh
//   motion  true | false              the lens shakes over bumps and landings
//   vol     { master, car, ambient }  the sound, each 0..1
//   units   kmh | mph                 the instrument's speed and lengths
//   lang    zh | en                   the language of the interface
//
// A value comes from the address bar when it has a parameter there (tier=,
// cap=, lang=): the panel shows it and cannot change it. Otherwise it is what
// the visitor chose, kept in localStorage under continuum.<name>, and failing
// that what the system says: the browser's languages, the "reduce motion"
// preference, 60 frames a second. A headless run (run=) takes the address bar
// and the defaults only, so a check sees the same page on every machine.
//
// Settings holds the values and tells whoever listens; SettingsPanel is the
// panel's own markup (index.html) wired to it.

import { TIERS } from '../render/quality.js';
import { LANGS, detectLang } from './strings.js';

export const TIER_CHOICES = ['auto', ...TIERS];
export const UNIT_CHOICES = ['kmh', 'mph'];
export const KEYS = {
  tier: 'continuum.tier',
  cap: 'continuum.cap',
  motion: 'continuum.motion',
  vol: 'continuum.vol',
  units: 'continuum.units',
  lang: 'continuum.lang',
};
export const BUSES = ['master', 'car', 'ambient'];
// The master volume at which the sound is as loud as it has always been; the
// top of the slider is a quarter louder.
export const MASTER_UNITY = 0.8;
export const DEFAULT_VOLUME = { master: MASTER_UNITY, car: 1, ambient: 1 };

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function volumeOf(o) {
  if (!o || typeof o !== 'object') return undefined;
  const v = { ...DEFAULT_VOLUME };
  for (const b of BUSES) if (typeof o[b] === 'number' && Number.isFinite(o[b])) v[b] = clamp01(o[b]);
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
    default: return undefined;
  }
}

// ...from the text localStorage keeps.
function fromText(key, text) {
  if (typeof text !== 'string') return undefined;
  switch (key) {
    case 'cap': return text === '' ? undefined : check(key, Number(text));
    case 'motion': return text === '1' ? true : text === '0' ? false : undefined;
    case 'vol':
      try { return volumeOf(JSON.parse(text)); } catch { return undefined; }
    default: return check(key, text);
  }
}

const toText = (key, v) => (key === 'motion' ? (v ? '1' : '0') : key === 'vol' ? JSON.stringify(v) : String(v));
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

    const system = {
      tier: 'auto',
      cap: 60,
      motion: run ? true : !reduceMotion,
      vol: { ...DEFAULT_VOLUME },
      units: 'kmh',
      lang: run ? 'zh' : detectLang(languages),
    };
    this.values = {};
    for (const key of Object.keys(KEYS)) {
      let v = this.url.get(key);
      if (v === undefined) v = fromText(key, this._read(key));
      this.values[key] = v === undefined ? system[key] : v;
    }
  }

  _read(key) {
    try { return this.storage ? this.storage.getItem(KEYS[key]) : null; } catch { return null; }
  }

  get(key) {
    const v = this.values[key];
    return key === 'vol' ? { ...v } : v;
  }

  // The address bar gave this one: it cannot be changed here.
  locked(key) {
    return this.url.has(key);
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
const attrOf = (key, v) => (key === 'motion' ? (v ? '1' : '0') : String(v));
const valueOf = (key, attr) => (key === 'cap' ? Number(attr) : key === 'motion' ? attr === '1' : attr);

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
    this.res = root.querySelector('[data-res]');

    root.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b || b.disabled) return;
      const key = b.closest('.row[data-key]').dataset.key;
      settings.set(key, valueOf(key, b.dataset.v));
    });
    root.addEventListener('input', (e) => {
      const r = e.target;
      if (!r.matches('input[type="range"][data-bus]')) return;
      settings.set('vol', { ...settings.get('vol'), [r.dataset.bus]: Number(r.value) });
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
