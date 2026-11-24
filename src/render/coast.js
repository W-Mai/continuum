// What the coast has of its own, beside its sea (render/water.js) and the sand the sea wets (render/terrain.js): the waves
// that come up the beach (render/swash.js), sailing boats out on the water (render/boats.js), black rocks with foam round them in the
// shallows (render/reefs.js) and the low stone wall with a white fence where the road runs by the sea (render/seawall.js).
//
// This is the one that holds them: it says whether the lens is where they are, which of them the tier draws, and when the sound
// of the sea has something to answer to. A wave breaks, to be heard, each time the swash at the lens's own place on the shore
// goes round (it is a round of 8 s, and it is a fifth of a round further on for each 30 m along the shore, so that a car that
// goes along the shore goes by a wave every few seconds, and a car that stands still hears one every 8 s); a gull calls once in 5
// to 15 s, the gaps the plan has (world/coastplan.js). `surfs` and `gulls` go up by one at each, and the sound
// answers them (ui/sound.js).
//
// None of it is kept off the coast: out of reach of its world nothing is drawn, nothing is worked out, and the programs are the ones
// drawn when it first comes into view. Each draws by the tier (render/quality.js): all of them at 'high', half at 'mid', none at 'low'.

import { COAST, GULL, SWASH, alongOf, gullGap } from '../world/coastplan.js';
import { Boats } from './boats.js';
import { Reefs } from './reefs.js';
import { SeaWall } from './seawall.js';
import { compileObjects, warmHooks } from './atmosphere.js';

// reach: how far off (m, in the worlds' own progress) the coast may be, for what it has to be drawn.
export const COAST_VIEW = { reach: 4600 };

export class Coast {
  // env: plan (CoastPlan), road, worlds, land, seed.
  constructor(scene, env, tier = 'high') {
    this.env = {
      ...env,
      origin: () => env.road.origin,
      level: (x, z) => {
        const l = env.land.waterLevel(x, z);
        return l === -Infinity ? 0 : l;
      },
    };
    this.scene = scene;
    this.boats = new Boats(scene, this.env);
    this.reefs = new Reefs(scene, this.env);
    this.wall = new SeaWall(scene, this.env);
    this.tier = tier;
    this.on = false;           // the coast is in reach
    this.inside = false;       // the world under the lens is the coast's
    this.clock = 0;            // s: runs while the lens is in the coast
    this.surfs = 0;            // waves that have broken to be heard, since the start
    this.gulls = 0;            // calls of gulls, since the start
    this._round = null;        // the round of the swash the lens's own place is in (null: not worked out yet)
    this._gull = { n: 0, next: null };
    this._seed = env.seed | 0;
    this._alive = true;
    this._frames = 0;
    this._warm = (renderer, sc, camera) => (this._alive ? this.warm(renderer, sc, camera) : null);
    warmHooks.push(this._warm);
  }

  setTier(t) {
    this.tier = t;
  }

  // The floating origin has moved.
  shift() {
    this.boats.shift();
    this.reefs.shift();
    this.wall.shift();
  }

  // The road is cut and laid again (a turn to another world), from the road's s on.
  forget(s) {
    this.env.plan.forget(s);
    this.reefs.forget();
    this.wall.forget(s);
  }

  // How much of the world under a look ({ a, b, t }: the two worlds and the blend) is the coast's.
  static share(at) {
    if (!at || at.a < 0) return 0;
    const t = at.a === at.b ? 0 : at.t;
    return (at.a === COAST ? 1 - t : 0) + (at.b === COAST ? t : 0);
  }

  // Every frame. dt: s (0 in the photo mode: the world stands still); camera; ctx: { at (the look the small things in the air go
  // by), sCar, blocks (0 to 1: how far the style is the block's), clock (the sea's own, s), settle (the world stands still: what the
  // things have still to find is found at once) }.
  update(camera, dt, ctx) {
    const o = this.env.road.origin;
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    this.on = this.env.worlds.reaches(ax, az, COAST_VIEW.reach, (w) => w.id === 'coast');
    // (The plans of the road far behind are let go now and then.)
    if (this.on && (this._frames = this._frames + 1) % 600 === 0) this.env.plan.prune(ctx.sCar);
    this.clock += dt;
    const tier = this.tier;
    const settle = !!ctx.settle;
    const blocky = (ctx.blocks || 0) > 0.5;
    this.boats.setBlocky(blocky);
    this.reefs.setBlocky(blocky);
    this.boats.update(camera, this.on, tier, ctx.clock, dt, settle);
    this.reefs.update(camera, this.on, tier, ctx.clock, settle);
    this.wall.update(camera, this.on, tier, ctx.sCar, settle);
    this.inside = Coast.share(ctx.at) >= 0.5;
    if (dt > 0) this._sounds(ax, az, ctx.clock);
  }

  // The waves that break and the gulls that call, to be heard.
  _sounds(ax, az, clock) {
    if (!this.inside) {
      this._round = null;
      this._gull.next = null;
      return;
    }
    // The round of the swash the lens's own place on the shore is in: a wave breaks as it goes into the next.
    const f = clock / SWASH.period + alongOf(this.env.worlds, ax, az) / SWASH.along;
    const round = Math.floor(f);
    if (this._round !== null && round !== this._round) this.surfs++;
    this._round = round;
    const g = this._gull;
    if (g.next === null) g.next = this.clock + GULL.first;
    if (this.clock >= g.next) {
      this.gulls++;
      g.n++;
      g.next += gullGap(g.n, this._seed);
      if (this.clock >= g.next) g.next = this.clock + gullGap(g.n, this._seed);
    }
  }

  // The things a car off the road runs into, as [x, z, radius, ...] added to out.
  near(ax, az, range, out) {
    return this.wall.near(ax, az, range, out);
  }

  // The meshes whose programs are built ahead.
  _meshes() {
    return [...this.boats.meshes(), ...this.reefs.meshes(), this.wall.pieces];
  }

  // The programs, built ahead as they are drawn.
  warm(renderer, scene, camera) {
    return compileObjects(renderer, scene, camera, this._meshes());
  }

  // The same, one mesh at a time, for a queue ([[name, task]]).
  warmTasks(renderer, scene, camera) {
    return this._meshes().map((m, i) => [`coast.${i}`, () => (this._alive ? compileObjects(renderer, scene, camera, [m]) : null)]);
  }

  stats() {
    return {
      on: this.on, inside: this.inside, tier: this.tier, boats: this.boats.count, reefs: this.reefs.count,
      walls: this.wall.count, runs: this.wall.runs, surfs: this.surfs, gulls: this.gulls,
    };
  }

  dispose() {
    this._alive = false;
    const i = warmHooks.indexOf(this._warm);
    if (i >= 0) warmHooks.splice(i, 1);
    for (const m of [this.boats, this.reefs, this.wall]) m.dispose();
  }
}
