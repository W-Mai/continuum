// Adaptive quality: hold a smooth frame rate on whatever GPU this runs on.
//
// Frame rate is measured in half-second windows. Two seconds of slow windows
// lower the render resolution one step (the cheapest thing to give up on a
// fill-bound integrated GPU), the last steps also halve the shadow map and
// draw less geometry. Eight
// seconds of headroom raise it again, but a level that was just left for
// being too slow is not retried for a minute, then two, then four, so the
// image does not pump. Windows with a frame longer than a quarter second (a
// tab switch, a hitch) do not count either way.

const STEPS = [1, 0.85, 0.72, 0.6, 0.5];    // fraction of the full pixel ratio
const SHADOW = [2048, 2048, 2048, 1024, 1024];
// How much geometry is drawn: the land splits finer tiles less near, the
// full trees come in closer, the skyline stops sooner (Game.setDetail).
const DETAIL = [1, 1, 1, 0.8, 0.65];
const WINDOW = 0.5;
const SLOW_FPS = 55;
const FAST_FPS = 58;
const DOWN_WINDOWS = 4;
const UP_WINDOWS = 16;
const RETRY_AFTER = 60;         // doubles each time the same level proves too slow

export class Quality {
  constructor(game, maxRatio) {
    this.game = game;
    this.maxRatio = maxRatio;
    this.level = 0;
    this.clock = 0;
    this.history = [];
    this.banUntil = STEPS.map(() => 0);
    this.failures = STEPS.map(() => 0);
    this.cooldown = 3;           // let the first frames settle
    this._time = 0;
    this._frames = 0;
    this._spoiled = false;
  }

  get ratio() {
    return this.maxRatio * STEPS[this.level];
  }

  // dt: the real frame time in seconds, not clamped.
  update(dt) {
    this.clock += dt;
    this._time += dt;
    this._frames++;
    if (dt > 0.25) this._spoiled = true;
    if (this._time < WINDOW) return;
    const fps = this._frames / this._time;
    if (!this._spoiled) this.history.push(fps);
    if (this.history.length > UP_WINDOWS) this.history.shift();
    this._time = 0;
    this._frames = 0;
    this._spoiled = false;

    this.cooldown -= WINDOW;
    if (this.cooldown > 0) return;
    const recent = (n) => this.history.length >= n && this.history.slice(-n);
    const slow = recent(DOWN_WINDOWS);
    const fast = recent(UP_WINDOWS);
    if (slow && slow.every((f) => f < SLOW_FPS) && this.level < STEPS.length - 1) {
      this.banUntil[this.level] = this.clock + RETRY_AFTER * 2 ** this.failures[this.level]++;
      this.set(this.level + 1);
    } else if (fast && fast.every((f) => f > FAST_FPS) && this.level > 0
      && this.clock > this.banUntil[this.level - 1]) {
      this.set(this.level - 1);
    }
  }

  set(level) {
    this.level = level;
    this.history.length = 0;
    this.cooldown = 3;
    const g = this.game;
    g.renderer.setPixelRatio(this.ratio);
    if (g.size) g.resize(g.size[0], g.size[1]);
    g.setDetail(DETAIL[level]);
    const shadow = g.atmosphere.sun.shadow;
    if (shadow.mapSize.x !== SHADOW[level]) {
      shadow.mapSize.set(SHADOW[level], SHADOW[level]);
      if (shadow.map) {
        shadow.map.dispose();
        shadow.map = null;
      }
    }
  }
}
