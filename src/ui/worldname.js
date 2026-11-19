// The name of the world the road has come into. As the camera passes the
// middle of a border (Game.worldHere: t reaches 0.5, and the world it is
// turning into becomes the one it is in) the name comes up in the lower middle
// of the picture: two large characters (in English the world's name, in the
// same spacing) over a line about the world. It comes in over 0.8 s, stays
// 2.2 s and goes over 1 s (the #worldname animation in index.html). It is a
// floating line of the same kind as the verses (src/ui/epigraph.js) and keeps
// out of their way: with a verse up it waits four seconds.
//
// A border counts once. It is crossed when t first reaches 0.5 in the pair of
// worlds the camera is between, and does not count again until the camera has
// been back before 0.2 of it, so a camera that swings across the middle of the
// border (the director's cuts, a lens circling the car) does not bring the name
// up twice. Where the camera finds itself in the second half of a border with
// nothing crossed (the page was opened there, the schedule was rewritten
// under it) nothing is named.

import { WORLDS } from '../world/worlds.js';
import { t, worldName } from './strings.js';

export const SHOW_MS = 4000;       // the animation's length, 0.8 + 2.2 + 1.0 s
export const LATE_MS = 4000;       // how much later than that the class is taken off if the animation's end never comes (frames that come late push the end back)
export const AFTER_VERSE = 4000;   // how long a name waits behind a verse
export const LOOK_MS = 100;        // how often the camera's place among the worlds is read
export const BACK = 0.2;           // how far back in a border the camera goes for it to count again

const BY_ID = new Map(WORLDS.map((w) => [w.id, w]));

export class WorldName {
  // game: has worldHere(). el: #worldname, with a .nm and a .ln inside.
  // verses: the elements that carry a verse; a name waits while one is up.
  constructor(game, el, { verses = [] } = {}) {
    this.game = game;
    this.el = el;
    this.nm = el.querySelector('.nm');
    this.ln = el.querySelector('.ln');
    this.verses = verses;
    this.pair = null;       // 'from>to': the border the camera is in
    this.past = false;      // whether the middle of it is behind the camera
    this.clock = 0;
    this.id = null;         // the world named now
    this.timer = 0;
    this.wait = 0;
    this.shown = [];        // { id, at } of every name that came up, for the checks
    // The class comes off when the animation is over, not at a time counted
    // from when it was put on: a frame that comes late would cut the last of
    // the fade short.
    el.addEventListener('animationend', (e) => {
      if (e.target === el) this._hide();
    });
  }

  // Every frame, with the time it took (s); the camera's place is read ten
  // times a second.
  update(dt) {
    this.clock += dt;
    if (this.clock < LOOK_MS / 1000) return;
    this.clock = 0;
    const w = this.game.worldHere();
    const pair = w.fromId + '>' + w.toId;
    const past = w.fromId !== w.toId && w.t >= 0.5;
    if (pair !== this.pair) {
      // The first look, or the next border on: nothing was crossed to get here.
      this.pair = pair;
      this.past = past;
      return;
    }
    if (!this.past && past) {
      this.past = true;
      this.announce(w.toId);
    } else if (this.past && w.t < BACK) {
      this.past = false;
    }
  }

  // Name this world now, or once the verse that is up has had its time.
  // Returns whether there is such a world.
  announce(id) {
    const world = BY_ID.get(id);
    if (!world) return false;
    clearTimeout(this.wait);
    if (this._verseUp()) this.wait = setTimeout(() => this._show(world), AFTER_VERSE);
    else this._show(world);
    return true;
  }

  // Whether a verse is on the screen, or about to be: one that comes up has
  // the class `show`, the wallpaper's is an animation of its own.
  _verseUp() {
    return this.verses.some((el) => el.classList.contains('show') || (el.getAnimations && el.getAnimations().length > 0));
  }

  _show(world) {
    this.id = world.id;
    this._write();
    const el = this.el;
    el.classList.remove('show');
    void el.offsetWidth;   // so the animation starts over
    el.classList.add('show');
    // For when there is no animation to end (the page is not drawn).
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._hide(), SHOW_MS + LATE_MS);
    this.shown.push({ id: world.id, at: Math.round(this.game.sCar) });
  }

  _hide() {
    clearTimeout(this.timer);
    this.el.classList.remove('show');
    this.id = null;
  }

  _write() {
    const world = BY_ID.get(this.id);
    this.nm.textContent = worldName(world);
    this.ln.textContent = t('world.line.' + world.id);
  }

  // The language changed: what is on the screen is written again.
  relabel() {
    if (this.id) this._write();
  }
}
