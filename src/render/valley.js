// What the valley has of its own, beside its river (render/water.js), its trees and the
// things that lie about its ground (render/forest.js, render/clutter.js): a mist that lies on
// the water (render/valleymist.js), gravel bars in the river, the shallows round them
// (render/valleybars.js) and a pier with a boat tied at its head (render/valleypier.js);
// the bars, the decks and the boats are one mesh (render/valleystruct.js).
//
// This is the one that holds them: it says whether the lens is where they are, which of them
// the tier draws, and how near the lens is to the water, which the sound answers with the
// sound of a stream (ui/sound.js). The poplars along the banks are the forest's, laid by
// world/valleyplan.js in the workers that plant them; the stones at the water's edge are
// the clutter's; the stony ground and the finer ripples of the shallows are the land's and
// the water's shaders' (render/terrain.js, render/waterlook.js).
//
// Out of reach of its world nothing of it is drawn or worked out; only its two programs are built
// ahead, as the page settles, so that it comes into view without a stall. Each draws by the tier
// (render/quality.js): all of them at 'high', half at 'mid', none at 'low'.

import * as THREE from 'three';
import { VALLEY, WaterGrid } from '../world/valleyplan.js';
import { WORLDS } from '../world/worlds.js';
import { structureMaterial, Piers } from './valleypier.js';
import { Bars } from './valleybars.js';
import { Merged } from './valleystruct.js';
import { Mist, MIST } from './valleymist.js';
import { compileObjects, warmHooks } from './atmosphere.js';

// reach: how far off (m, in the worlds' own progress) the valley may be, for what it has to be
// drawn; hear: how far off water is heard (m); shoal: how far from a bar its shallows are heard (m);
// every: how often the lens's place by the water is looked at again (s).
export const VALLEY_VIEW = { reach: 700, hear: 150, shoal: 140, every: 0.2 };

const LEVEL = WORLDS[VALLEY].params.water;

export class Valley {
  // env: plan (ValleyPlan), grid (WaterGrid), road, worlds, land, water (render/water.js: its clock and the way it
  // runs), seed; tier: the one to begin with.
  constructor(scene, env, tier = 'high') {
    this.env = { ...env, origin: () => env.road.origin };
    this.scene = scene;
    this.grid = env.grid || new WaterGrid(env.land);
    this.env.grid = this.grid;
    this.material = structureMaterial();
    this.bars = new Bars(this.env);
    this.piers = new Piers(this.env);
    // The bars, the decks and the boats are drawn as one mesh.
    this.struct = new Merged(scene, this.material);
    this._built = { bars: -1, piers: -1 };
    this.mist = new Mist(scene, this.env);
    this.tier = tier;
    this.on = false;           // the valley is in reach
    this.clock = 0;            // s
    // How the lens stands to the water, for the sound: near (0 to 1: 1 on the water, 0 where it is out of hearing), shoal
    // (0 to 1: how much of it is the shallows' noise) and dist (m to the nearest water; Infinity where none is in reach).
    this.water = { near: 0, shoal: 0, dist: Infinity };
    this._look = 0;
    this._found = { dist: 0, depth: 0, ax: 0, az: 0 };
    this._alive = true;
    this._warm = (renderer, sc, camera) => (this._alive ? this.warm(renderer, sc, camera) : null);
    warmHooks.push(this._warm);
  }

  setTier(t) {
    this.tier = t;
  }

  // The floating origin has moved.
  shift() {
    this.bars.shift();
    this.piers.shift();
    this.mist._at.x = 1e9;
  }

  // Every frame. dt: s (0 in the photo mode: the world stands still); camera; ctx: { sCar, blocks (0 to 1: how far the style is
  // the block's), fog (the haze's colour), settle (the world stands still: what the things have still to find is found at once) }.
  update(camera, dt, ctx) {
    const o = this.env.road.origin;
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    this.on = this.env.worlds.reaches(ax, az, VALLEY_VIEW.reach, (w) => w.id === 'river');
    this.clock += dt;
    const settle = !!ctx.settle;
    if (!this.on) {
      this.water.near = 0;
      this.water.shoal = 0;
      this.water.dist = Infinity;
    } else {
      // (The plans of the road far behind are let go now and then.)
      if ((this._frames = (this._frames || 0) + 1) % 600 === 0) this.env.plan.prune(ctx.sCar);
      this.grid.fill(ax, az, settle ? Infinity : 160);
      this._look -= dt;
      if (this._look <= 0 || settle) {
        this._look = VALLEY_VIEW.every;
        this._hear(ax, az);
      }
    }
    const tier = this.tier;
    const flow = this.env.water && this.env.water.flowDir ? [this.env.water.flowDir.x, this.env.water.flowDir.z] : [1, 0];
    this.bars.update(camera, this.on, tier, ctx.sCar, LEVEL, settle);
    this.piers.update(camera, this.on, tier, ctx.sCar, settle);
    // The solid things are put into their mesh again when the set has changed; the boats ride the water every frame.
    const built = this._built;
    if (built.bars !== this.bars.version || built.piers !== this.piers.version) {
      built.bars = this.bars.version;
      built.piers = this.piers.version;
      this.struct.begin();
      this.bars.bake(this.struct, o);
      this.piers.bake(this.struct, o);
      this.struct.end();
    }
    this.piers.pose(this.struct, this.env.water ? this.env.water.time : this.clock);
    this.struct.mesh.visible = this.struct.ni > 0;
    this.mist.update(camera, this.on, tier, {
      fog: ctx.fog || new THREE.Color(0.7, 0.78, 0.8),
      blocks: ctx.blocks || 0,
      dt,
      flow,
      nearest: this.water.dist,
      level: LEVEL,
    });
  }

  // How near the lens is to the water, and to the shallows.
  _hear(ax, az) {
    const V = VALLEY_VIEW;
    const near = this.grid.nearest(ax, az, MIST.reach, this._found);
    const w = this.water;
    w.dist = near ? near.dist : Infinity;
    // Heard within V.hear metres of the water, the louder the nearer.
    const k = near ? Math.max(0, 1 - near.dist / V.hear) : 0;
    w.near = k * k;
    // The shallows: a bar within V.shoal metres of the lens, or the water at the edge no deeper than a metre.
    let s = 0;
    for (const b of this.bars.list) {
      const d = Math.max(0, Math.hypot(b.ax - ax, b.az - az) - b.len / 2);
      s = Math.max(s, 1 - d / V.shoal);
    }
    if (near && near.dist < 30 && near.depth < 1) s = Math.max(s, 0.4 * (1 - near.dist / 30));
    w.shoal = Math.min(1, Math.max(0, s));
  }

  // The things a car off the road runs into, as [x, z, radius, ...] added to out.
  near(ax, az, range, out) {
    return this.piers.near(ax, az, range, out);
  }

  // The meshes whose programs are built ahead.
  _meshes() {
    return [this.struct.mesh, this.mist.mesh];
  }

  // The programs, built ahead as they are drawn.
  warm(renderer, scene, camera) {
    return compileObjects(renderer, scene, camera, this._meshes());
  }

  // The same, one mesh at a time, for a queue ([[name, task]]).
  warmTasks(renderer, scene, camera) {
    return this._meshes().map((m, i) => [`valley.${i}`, () => (this._alive ? compileObjects(renderer, scene, camera, [m]) : null)]);
  }

  stats() {
    return {
      on: this.on, tier: this.tier, bars: this.bars.count, piers: this.piers.count, sheets: this.mist.count,
      cells: this.mist.cells, mist: this.mist.near, near: +this.water.near.toFixed(3), shoal: +this.water.shoal.toFixed(3),
      dist: Number.isFinite(this.water.dist) ? +this.water.dist.toFixed(1) : null,
    };
  }

  dispose() {
    this._alive = false;
    const i = warmHooks.indexOf(this._warm);
    if (i >= 0) warmHooks.splice(i, 1);
    for (const m of [this.bars, this.piers, this.struct, this.mist]) m.dispose();
    this.material.dispose();
  }
}
