// The line for a first visit: in the lower left, above the instrument, that the
// car drives itself and which key takes it over. It is for a browser that has
// not seen it (the mark is continuum.hint in localStorage), comes up a little
// after the loop starts (the first frame is long drawn by then and nothing of
// the start waits for it), stays eight seconds, and is not seen again. It is
// built when it is shown and taken out of the page when it is gone, and moves
// by opacity and transform only (#firsthint in index.html). A headless run has
// no storage to give and so never shows it.

import { t } from './strings.js';

export const HINT_KEY = 'continuum.hint';
export const SHOW_MS = 8000;    // how long the line stays
export const AFTER_MS = 1200;   // how long after the loop starts it comes up
export const FADE_MS = 700;     // #firsthint's opacity transition in index.html

export class FirstHint {
  // storage: localStorage, or null. anchor: the element the line stands above
  // (the instrument), kept clear of whatever size it has. now(): milliseconds.
  constructor({ storage = null, anchor = null, now = () => performance.now() } = {}) {
    this.storage = storage;
    this.anchor = anchor;
    this.now = now;
    this.state = storage ? 'waiting' : 'done';   // waiting, up, done
    this.began = null;      // when the loop first came here
    this.el = null;
    this.timer = 0;
    this.observer = null;
  }

  // Every frame.
  update() {
    if (this.state !== 'waiting') return;
    const now = this.now();
    if (this.began === null) this.began = now;
    if (now - this.began >= AFTER_MS) this.show();
  }

  // Whether this browser has not seen it; the mark is written at once, so a
  // visit cut short does not bring the line back, and a browser that cannot
  // keep the mark does not get the line at all.
  _fresh() {
    try {
      if (this.storage.getItem(HINT_KEY) !== null) return false;
      this.storage.setItem(HINT_KEY, '1');
      return true;
    } catch {
      return false;
    }
  }

  // The line up now, when it is due. force puts it up whatever the mark says
  // and leaves the mark alone (the checks). Returns whether it is up.
  show(force = false) {
    if (this.el) return true;
    if (!force && (this.state !== 'waiting' || !this._fresh())) {
      this.state = 'done';
      return false;
    }
    this.state = 'up';
    this._build();
    return true;
  }

  _build() {
    // The instrument is read before the line is put in, while nothing is waiting to be laid out.
    const above = this.anchor ? innerHeight - this.anchor.getBoundingClientRect().top : null;
    const el = document.createElement('div');
    el.id = 'firsthint';
    el.setAttribute('role', 'status');
    el.textContent = t('hint.first');
    if (above !== null) el.style.setProperty('--above', Math.max(0, above) + 'px');
    document.body.appendChild(el);
    this.el = el;
    // The instrument grows a line when a border is near: the hint keeps above it.
    if (this.anchor && typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => {
        el.style.setProperty('--above', Math.max(0, innerHeight - this.anchor.getBoundingClientRect().top) + 'px');
      });
      this.observer.observe(this.anchor);
    }
    // The next frame, so that the opacity has somewhere to come from.
    requestAnimationFrame(() => el.classList.add('show'));
    this.timer = setTimeout(() => this.hide(), SHOW_MS);
  }

  // Fade it out and take it away.
  hide() {
    clearTimeout(this.timer);
    this.state = 'done';
    const el = this.el;
    if (!el) return;
    if (this.observer) this.observer.disconnect();
    el.classList.remove('show');
    setTimeout(() => el.remove(), FADE_MS + 100);
    this.el = null;
  }

  // The language changed: what is on the screen is written again.
  relabel() {
    if (this.el) this.el.textContent = t('hint.first');
  }
}
