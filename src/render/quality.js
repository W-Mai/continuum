// Adaptive quality: hold a smooth frame rate on whatever GPU this runs on.
//
// Frame rate is measured in half-second windows, against the rate the page is
// asked to draw at (60, or what the display gives if that is less): a window
// is slow when it is under 92% of it. Two seconds of slow windows lower the
// size the scene is drawn at one step (the cheapest thing to give up on a
// fill-bound integrated GPU; the canvas keeps the screen's own pixels and the
// last pass brings the frame up to them, render/present.js), the last steps
// also halve the shadow map and draw less geometry. Eight seconds of headroom
// raise it again, but a level that was just left for being too slow is not
// retried for a minute, then two, then four, so the image does not pump.
// Windows with a frame longer than a quarter second (a tab switch, a hitch)
// do not count either way.
//
// Apart from the size, a tier says how much there is to draw: high, mid or
// low. Each level has one (high high mid mid low), and Game.setTier passes it
// on to whatever draws more or less by it. tier=low in the address pins it:
// the size still comes down and goes back up by the frame rate, the tier
// stays where it was pinned.
//
// The low tier is one configuration, written down in LOW and in the tables of
// what draws by the tier (tools/tier_check.mjs reads them all): the scene at
// 0.6 of the canvas counted at a pixel ratio of 1, at most 30 frames a second
// when it is pinned, the land and the city at detail 0.65, the trees drawn
// fuller only when they are 1.6 times as tall on the screen, and none of the
// bloom, the last pass's edges and sharpening, the contact shadow, the
// occlusion, the reflection on the water or the light shafts.

const STEPS = [1, 0.85, 0.72, 0.6, 0.5];    // fraction of the starting size
const SHADOW = [2048, 2048, 2048, 1024, 1024];
// The most the sun's shadow map is in the pixel style, from the second of its steps
// (render/style.js, PIXEL_STEPS): a shadow's edge is a cell of its frame wide or more.
const PIXEL_SHADOW = 1024;
// The side of the sun's shadow map at a level, with the pixel style at a step (0: not drawn).
export const shadowSize = (level, pixelLevel = 0) => (pixelLevel >= 2 ? Math.min(SHADOW[level], PIXEL_SHADOW) : SHADOW[level]);
// How much geometry is drawn: the land splits finer tiles less near, the
// full trees come in closer, the skyline stops sooner (Game.setDetail).
const DETAIL = [1, 1, 1, 0.8, 0.65];
// How much there is to draw at each level (Game.setTier).
const TIER = ['high', 'high', 'mid', 'mid', 'low'];
export const TIERS = ['high', 'mid', 'low'];
// The low tier's own numbers. scale: the most the scene is drawn at, of the
// canvas in CSS pixels (a pixel ratio of 1), and where the ladder starts when
// the tier is pinned; fps: the frame cap when it is pinned (the Pacer's, in
// the page); detail: the most Game.setDetail gives the land and the city;
// trees: how many times the heights on the screen at which a tree is drawn
// full, in three tiers or as its far shape are (render/forest.js, the detail
// it is given is at most the inverse).
export const LOW = { scale: 0.6, fps: 30, detail: 0.65, trees: 1.6 };
// The scene's size, of the canvas's pixels, at the low tier at the most:
// canvasRatio is the renderer's pixel ratio.
export const lowScale = (base, canvasRatio) => Math.min(base, LOW.scale / Math.max(1, canvasRatio));
// The frame cap with the tier pinned (0 is every refresh): the low tier's is
// 30 at the most.
export const capAt = (cap, tier) => (tier === 'low' ? (cap > 0 ? Math.min(cap, LOW.fps) : LOW.fps) : cap);
// The detail the land and the city, and the trees, are given at a tier for the
// detail of the level (Game.setDetail).
export const landDetail = (f, tier) => (tier === 'low' ? Math.min(f, LOW.detail) : f);
export const treeDetail = (f, tier) => (tier === 'low' ? Math.min(f, 1 / LOW.trees) : f);
const WINDOW = 0.5;
const SLOW = 0.92;              // of the target rate
const FAST = 0.965;
const DOWN_WINDOWS = 4;
const UP_WINDOWS = 16;
const RETRY_AFTER = 60;         // doubles each time the same level proves too slow

export class Quality {
  // base: the fraction of the canvas the scene is drawn at when all is well;
  // target: the frame rate the page draws at; tier: one of TIERS to pin the
  // tier to, whatever the level (none: it follows the level).
  constructor(game, base = 1, target = 60, tier = null) {
    this.game = game;
    this.pinned = TIERS.includes(tier) ? tier : null;
    this.base = base;
    // Where the ladder starts with the tier pinned low (LOW.scale).
    this.lowBase = lowScale(base, game.renderer ? game.renderer.getPixelRatio() : 1);
    this.target = target;
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

  // The fraction of the canvas's size the scene is drawn at now: with the
  // tier pinned low the steps are of LOW.scale, and at the low tier it is
  // never more than that.
  get scale() {
    const s = (this.pinned === 'low' ? this.lowBase : this.base) * STEPS[this.level];
    return this.tier === 'low' ? Math.min(s, this.lowBase) : s;
  }

  // How much there is to draw now: the pinned tier, or the level's.
  get tier() {
    return this.pinned || TIER[this.level];
  }

  // Pin the tier to one of TIERS from outside, or with anything else let it go
  // by the level again; the game's tier changes at once, the size the scene is
  // drawn at only to or from the low tier (it has a size of its own).
  pin(tier) {
    const was = this.scale;
    this.pinned = TIERS.includes(tier) ? tier : null;
    this.game.setTier(this.tier);
    if (this.scale !== was) this.game.setRenderScale(this.scale);
  }

  // The page draws at this many frames a second now (the display's rate, or
  // the cap if that is lower): what counts as slow moves with it, and what was
  // measured against the old rate is forgotten.
  setTarget(fps) {
    if (!(fps > 0) || Math.abs(fps - this.target) < 1) return;
    this.target = fps;
    this.history.length = 0;
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
    if (slow && slow.every((f) => f < this.target * SLOW) && this.level < STEPS.length - 1) {
      this.banUntil[this.level] = this.clock + RETRY_AFTER * 2 ** this.failures[this.level]++;
      this.set(this.level + 1);
    } else if (fast && fast.every((f) => f > this.target * FAST) && this.level > 0
      && this.clock > this.banUntil[this.level - 1]) {
      this.set(this.level - 1);
    }
  }

  set(level) {
    this.level = level;
    this.history.length = 0;
    this.cooldown = 3;
    const g = this.game;
    g.setRenderScale(this.scale);
    g.setDetail(DETAIL[level]);
    g.setTier(this.tier);
    g.atmosphere.setShadowSize(shadowSize(level, g.post ? g.post.pixelLevel : 0));
  }
}
