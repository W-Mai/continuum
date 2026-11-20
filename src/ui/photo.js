// The photo mode's interface (the mode itself is render/photo.js). While the
// world stands still the rest of the page steps aside (body.photo, in
// index.html) and a thin bar at the foot has what a picture wants: the
// shutter, the style, a switch that puts the car away, the depth of field (a
// switch, and a slider for the aperture), a slider for the exposure
// compensation, and the way out. K goes in and out, and a button of the
// page's own bar does the same where there is a mouse; Enter takes the picture
// and Esc leaves (render/photo.js hears those). What a picture is called, and
// how it went, is told in a line over the bar for a moment. With the depth of
// field on, a tap on the frame focuses it there, and a mark stands where the
// tap was for a moment.

import { t } from './strings.js';

export const NOTE_MS = 2600;    // how long the line about a picture stays
export const MARK_MS = 800;     // how long the mark where a tap focused stays, before it fades

// What the compensation says: its sign, a decimal, and the unit.
export const evText = (v) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(v).toFixed(1)} EV`;

const over = (el, x, y) => {
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
};

export class PhotoBar {
  // game: has photo. els: enter (the button in the page's bar), shutter, style,
  // car, exit (the buttons of the bar), note (the line over it), bar (the bar),
  // depth (the switch of the depth of field), aperture and ev (the sliders) with
  // apertureOut and evOut (what each says), mark (what stands where a tap
  // focused). closeMenus(): the menus put away as the mode begins. nextStyle():
  // the style after this one is asked for. styleLabel(): what the style button
  // says. words(): the words of the file's name, { world, style }, in the
  // language now. blocked(): whether the page is where the photo mode is not to
  // begin (in the wallpaper mode, or not yet started).
  constructor(game, els, { body = document.body, closeMenus = () => {}, nextStyle = () => {}, styleLabel = () => '', words = null, blocked = () => false } = {}) {
    this.game = game;
    this.els = els;
    this.body = body;
    this.closeMenus = closeMenus;
    this.nextStyle = nextStyle;
    this.styleLabel = styleLabel;
    this.blocked = blocked;
    this.timer = 0;
    this.markTimer = 0;
    this.shown = [];        // what the line has said, for the checks
    this.marked = [];       // where a tap focused, for the checks: [x, y]
    const photo = game.photo;
    photo.onChange = (state) => this._changed(state);
    photo.onShot = (info, error) => this._told(info, error);
    photo.onFocus = (x, y) => this._marked(x, y);
    // A tap does not focus where the bar is.
    photo.blocked = (x, y) => over(els.bar, x, y);
    if (words) photo.label = words;
    els.enter.addEventListener('click', () => this.toggle());
    els.shutter.addEventListener('click', () => { photo.shoot().catch(() => {}); });
    els.style.addEventListener('click', () => {
      this.nextStyle();
      this.refresh();
    });
    els.car.addEventListener('click', () => {
      photo.hideCar(!photo.hidden);
      this.refresh();
    });
    els.depth.addEventListener('click', () => {
      const on = !photo.depthOn;
      photo.setDepth(on).then(() => this.refresh(), () => this.refresh());
      if (on) this._note(t('photo.focus'));
      this.refresh();
    });
    els.aperture.addEventListener('input', () => {
      photo.setAperture(photo.apertures[Number(els.aperture.value)]);
      this.refresh();
    });
    els.ev.addEventListener('input', () => {
      photo.setEv(Number(els.ev.value) / 10);
      this.refresh();
    });
    // The arrows belong to a slider while it has the focus: the page's driver (core/autopilot.js)
    // takes them for the car's and cancels what the key would have done to the slider.
    for (const slider of [els.aperture, els.ev]) {
      slider.addEventListener('keydown', (e) => {
        if (e.code.startsWith('Arrow')) e.stopPropagation();
      });
    }
    els.exit.addEventListener('click', () => this.exit());
    this.refresh();
  }

  // The key that goes in and out. Returns whether it was one.
  key(e) {
    if (e.code !== 'KeyK' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
    this.toggle();
    return true;
  }

  toggle() {
    if (this.game.photo.state === 'on') this.exit();
    else this.enter();
  }

  enter() {
    if (this.blocked()) return false;
    this.closeMenus();
    // A button that was clicked has the focus; Enter would click it again.
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    return this.game.photo.enter();
  }

  exit() {
    return this.game.photo.exit();
  }

  _changed(state) {
    this.body.classList.toggle('photo', state === 'on');
    if (state === 'on') this.els.note.textContent = '';
    else this.els.mark.classList.remove('show');
    this.refresh();
  }

  // A line over the bar for a moment.
  _note(text) {
    const note = this.els.note;
    note.textContent = text;
    this.shown.push(text);
    note.classList.add('show');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => note.classList.remove('show'), NOTE_MS);
  }

  _told(info, error) {
    this._note(!info ? t('photo.failed')
      : info.smaller ? t('photo.smaller', { name: info.name, size: `${info.width}×${info.height}` })
        : t('photo.saved', { name: info.name }));
    if (error && typeof console !== 'undefined') console.error(error);
  }

  // The mark where a tap focused: it comes at once, stays MARK_MS and fades.
  _marked(x, y) {
    const mark = this.els.mark;
    this.marked.push([x, y]);
    mark.style.left = `${x}px`;
    mark.style.top = `${y}px`;
    mark.classList.add('show');
    clearTimeout(this.markTimer);
    this.markTimer = setTimeout(() => mark.classList.remove('show'), MARK_MS);
  }

  // The buttons say what is so: the style now, whether the car is put away and
  // whether the depth of field is on; the sliders say where they are set (the
  // aperture's is dim and still while the depth of field is off).
  refresh() {
    const photo = this.game.photo;
    const e = this.els;
    e.style.querySelector('.txt').textContent = this.styleLabel();
    e.car.setAttribute('aria-pressed', String(photo.hidden));
    e.depth.setAttribute('aria-pressed', String(photo.depthOn));
    const stop = photo.apertures.indexOf(photo.aperture);
    const f = `f/${photo.aperture}`;
    e.aperture.value = String(stop);
    e.aperture.disabled = !photo.depthOn;
    e.aperture.setAttribute('aria-valuetext', f);
    e.aperture.closest('.tune').setAttribute('aria-disabled', String(!photo.depthOn));
    e.apertureOut.textContent = f;
    e.ev.value = String(Math.round(photo.ev * 10));
    e.ev.setAttribute('aria-valuetext', evText(photo.ev));
    e.evOut.textContent = evText(photo.ev);
  }

  // The language changed: what is written by hand is written again.
  relabel() {
    this.refresh();
  }
}
