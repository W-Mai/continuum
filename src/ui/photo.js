// The photo mode's interface (the mode itself is render/photo.js). While the
// world stands still the rest of the page steps aside (body.photo, in
// index.html) and a thin bar at the foot has what a picture wants: the
// shutter, the style, a switch that puts the car away, and the way out. K goes
// in and out, and a button of the page's own bar does the same where there is
// a mouse; Enter takes the picture and Esc leaves (render/photo.js hears
// those). What a picture is called, and how it went, is told in a line over the
// bar for a moment.

import { t } from './strings.js';

export const NOTE_MS = 2600;    // how long the line about a picture stays

export class PhotoBar {
  // game: has photo. els: enter (the button in the page's bar), shutter, style,
  // car, exit (the buttons of the bar), note (the line over it). closeMenus():
  // the menus put away as the mode begins. nextStyle(): the style after this
  // one is asked for. styleLabel(): what the style button says. words(): the
  // words of the file's name, { world, style }, in the language now. blocked():
  // whether the page is where the photo mode is not to begin (in the
  // wallpaper mode, or not yet started).
  constructor(game, els, { body = document.body, closeMenus = () => {}, nextStyle = () => {}, styleLabel = () => '', words = null, blocked = () => false } = {}) {
    this.game = game;
    this.els = els;
    this.body = body;
    this.closeMenus = closeMenus;
    this.nextStyle = nextStyle;
    this.styleLabel = styleLabel;
    this.blocked = blocked;
    this.timer = 0;
    this.shown = [];        // what the line has said, for the checks
    const photo = game.photo;
    photo.onChange = (state) => this._changed(state);
    photo.onShot = (info, error) => this._told(info, error);
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
    this.refresh();
  }

  _told(info, error) {
    const note = this.els.note;
    note.textContent = !info ? t('photo.failed')
      : info.smaller ? t('photo.smaller', { name: info.name, size: `${info.width}×${info.height}` })
        : t('photo.saved', { name: info.name });
    this.shown.push(note.textContent);
    note.classList.add('show');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => note.classList.remove('show'), NOTE_MS);
    if (error && typeof console !== 'undefined') console.error(error);
  }

  // The buttons say what is so: the style now, and whether the car is put away.
  refresh() {
    this.els.style.querySelector('.txt').textContent = this.styleLabel();
    this.els.car.setAttribute('aria-pressed', String(this.game.photo.hidden));
  }

  // The language changed: what is written by hand is written again.
  relabel() {
    this.refresh();
  }
}
