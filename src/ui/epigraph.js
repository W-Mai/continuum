// A line of verse at a turn of the journey, the way an epigraph heads a
// chapter. There is one: where the road climbs out of the deep sea and the
// car breaks the surface into heaven, the great bird of 《逍遥游》 rising
// ninety thousand li on the whirlwind. It comes up once each time the car
// gets there, and goes.

import { STEP } from '../world/road.js';

const SHOW_MS = 7000;      // .note's animation in index.html, delay included
const AGAIN = 30000;       // metres of road before it may come up again
const CLEAR = 500;         // the road must stay out of the water this far on

export class Epigraph {
  constructor(game, el) {
    this.game = game;
    this.el = el;
    this.under = null;     // whether the car was under water at the last look
    this.shownAt = -Infinity;
    this.shown = [];       // chainages where it came up, for the diagnostics
    this.timer = 0;
  }

  // Every frame: one water level lookup at the car, and on the way out of the
  // sea a look along the road ahead.
  update() {
    const g = this.game;
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
    const el = this.el;
    el.classList.remove('show');
    void el.offsetWidth;   // so the animation starts over
    el.classList.add('show');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => el.classList.remove('show'), SHOW_MS);
  }
}
