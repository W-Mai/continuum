// A line of verse at a turn of the journey, the way an epigraph heads a
// chapter. There are two: where the road climbs out of the deep sea and the
// car breaks the surface into heaven, the great bird of 《逍遥游》 rising
// ninety thousand li on the whirlwind; and where the world turns over, on
// the way into the Upside Down, 《长恨歌》's sky turning and earth turning.
// Each comes up once each time the car gets there, and goes.
//
// The third kind belongs to the ink style and is the Inscription below: the
// picture is signed in a corner with a line of verse and a seal.

import { STEP } from '../world/road.js';

const SHOW_MS = 7000;      // .note's animation in index.html, delay included
const AGAIN = 30000;       // metres of road before it may come up again
const CLEAR = 500;         // the road must stay out of the water this far on

export const INK_HOLD_MS = 8000;    // how long the inscription stands before it begins to go (#inknote's animation in index.html)
export const INK_FADE_MS = 1500;    // and how long it takes to go
export const INK_LATE_MS = 1500;    // how much later than that the class is taken off if the animation's end never comes

export class Epigraph {
  constructor(game, el, turnEl) {
    this.game = game;
    this.el = el;
    this.turnEl = turnEl;
    this.over = false;     // whether the world was turned over at the last look
    this.turnedAt = -Infinity;
    this.turned = [];      // chainages where the turn's line came up
    this.under = null;     // whether the car was under water at the last look
    this.shownAt = -Infinity;
    this.shown = [];       // chainages where it came up, for the diagnostics
    this.timer = 0;
  }

  // Every frame: one water level lookup at the car, and on the way out of the
  // sea a look along the road ahead.
  update() {
    const g = this.game;
    // Into the Upside Down: the world has turned over.
    const over = g.upside.share > 0.5;
    if (over && !this.over && g.sCar - this.turnedAt > AGAIN) this.turn();
    this.over = over;
    const level = g.land.waterLevel(g.car.x + g.road.origin.x, g.car.z + g.road.origin.z);
    const under = level !== -Infinity && g.car.y < level - 2;
    const above = level === -Infinity || g.car.y > level + 0.5;
    if (this.under === null) this.under = under;
    else if (under) this.under = true;
    // Out of the water for good: a road that crests the surface and dives
    // again has not left the sea yet.
    else if (above && this.under && this._clearAhead(g.sCar)) {
      this.under = false;
      if (g.sCar - this.shownAt > AGAIN) this.show();
    }
  }

  _clearAhead(s) {
    const g = this.game;
    const road = g.road;
    const i1 = Math.min(road.classified, Math.floor((s + CLEAR) / STEP));
    for (let i = Math.ceil(s / STEP); i <= i1; i++) {
      const p = road.samples.get(i);
      if (p && p.y < g.land.waterLevel(p.ax, p.az) - 2) return false;
    }
    return true;
  }

  show() {
    this.shownAt = this.game.sCar;
    this.shown.push(Math.round(this.game.sCar));
    this._up(this.el);
  }

  turn() {
    this.turnedAt = this.game.sCar;
    this.turned.push(Math.round(this.game.sCar));
    if (this.turnEl) this._up(this.turnEl);
  }

  _up(el) {
    el.classList.remove('show');
    void el.offsetWidth;   // so the animation starts over
    el.classList.add('show');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => el.classList.remove('show'), SHOW_MS);
  }
}

// The signature of a painting in ink: a line of verse written down the right
// of the picture, and under it a seal (#inknote in index.html; the seal is
// drawn there as paths). It comes up each time the picture turns to ink (the
// style is ink as the page opens, or becomes it) and each time the wallpaper
// mode begins in ink, stands eight seconds and goes. In the wallpaper mode in
// ink, each time the road comes into a world, the verse gives way to the two
// characters of that world's name, the data's own in either language, the way
// the verses are written in Chinese in English too. In any other style there is
// nothing, and it goes as the picture turns to another one. A page that is a
// still of one frame (a headless run) has it up and holding, with no clock.
export class Inscription {
  // game: has style.id and sCar. el: #inknote, with a .q in it. wallpaper():
  // whether the wallpaper mode is on. still: a page that is a still.
  constructor(game, el, { wallpaper = () => false, still = false } = {}) {
    this.game = game;
    this.el = el;
    this.q = el.querySelector('.q');
    this.verse = this.q.textContent;
    this.wallpaper = wallpaper;
    this.still = still;
    this.ink = false;      // whether the style was ink at the last look
    this.wall = false;     // whether the wallpaper mode was on at the last look
    this.timer = 0;
    this.shown = [];       // { text, at } of each time it came up, for the checks
    // The class comes off when the animation is over, not at a time counted
    // from when it was put on: a frame that comes late would cut the fade short.
    el.addEventListener('animationend', (e) => {
      if (e.target === el) this.hide();
    });
  }

  // Every frame.
  update() {
    const ink = this.game.style.id === 'ink';
    const wall = this.wallpaper();
    if (ink && (!this.ink || (wall && !this.wall))) this.show();
    else if (!ink && this.ink) this.hide();
    this.ink = ink;
    this.wall = wall;
  }

  // The road has come into a world (WorldName says so).
  world(world) {
    if (this.game.style.id === 'ink' && this.wallpaper()) this.show(world.name);
  }

  // Up now, with the verse or with the characters given; again from the start
  // if it is up already.
  show(text = this.verse) {
    const el = this.el;
    this.q.textContent = text;
    el.classList.toggle('world', text !== this.verse);
    el.classList.remove('show');
    void el.offsetWidth;   // so the animation starts over
    el.classList.add('show');
    clearTimeout(this.timer);
    this.shown.push({ text, at: Math.round(this.game.sCar) });
    if (this.still) el.classList.add('held');
    // For when there is no animation to end (the page is not drawn).
    else this.timer = setTimeout(() => this.hide(), INK_HOLD_MS + INK_FADE_MS + INK_LATE_MS);
  }

  hide() {
    clearTimeout(this.timer);
    for (const c of ['show', 'held', 'world']) this.el.classList.remove(c);
    this.q.textContent = this.verse;
  }
}
