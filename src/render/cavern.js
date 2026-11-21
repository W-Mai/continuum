// What the cavern has of its own, beside its roof (render/ceiling.js), its crystals
// and its glow-worms in the roof's rock: pools of light on the floor under the
// crystals (render/crystalpools.js), puddles that a drop now and then falls into
// (render/puddles.js), shafts of light from holes in the roof (render/skylight.js),
// threads of glow-worm light hanging from it (render/glowworms.js) and a mine's track
// beside the road (render/minetrack.js).
//
// This is the one that holds them: it says whether the lens is where they are, which
// of them the tier draws, and when a drop falls. The drops come one every two to six
// seconds (the clock of the cavern, which runs while the world under the lens is the
// cavern's): half a second before each, a point comes falling into a puddle in front
// of the lens, and as it lands the puddle's rings start and `drips` goes up by one,
// which the sound answers with a drip and its echo (ui/sound.js).
//
// None of it is kept off the cavern: out of reach of its world nothing is drawn, nothing
// is worked out, and the programs are the ones drawn when it first comes into view.
// Each draws by the tier (render/quality.js): all of them at 'high', half at 'mid', none
// at 'low'.

import * as THREE from 'three';
import { CAVERN, DRIP, dripGap, hash3 } from '../world/cavernplan.js';
import { CrystalPools } from './crystalpools.js';
import { Puddles } from './puddles.js';
import { Skylights } from './skylight.js';
import { Glowworms } from './glowworms.js';
import { MineTrack } from './minetrack.js';
import { compileObjects, warmHooks } from './atmosphere.js';

// reach: how far off (m, in the worlds' own progress) the cavern may be, for what it has to be
// drawn; fall: how long a drop is seen falling (s); speed: how fast it is going as it lands
// (m/s); trail: how far behind the head its tail is (s of its fall). When the drops come is
// world/cavernplan.js's DRIP.
export const CAVERN_VIEW = { reach: 700, fall: 0.5, speed: 40, trail: 0.02 };
const GRAVITY = 9.81;

export class Cavern {
  // env: plan (CavernPlan), road, worlds, ceiling, clutter, forest, sky (the atmosphere's
  // uniforms), groundAt(x, z) (local), seed; tier: the one to begin with.
  constructor(scene, env, tier = 'high') {
    this.env = { ...env, origin: () => env.road.origin };
    this.scene = scene;
    this.shared = { uTime: { value: 0 }, uBlock: { value: 0 } };
    this.pools = new CrystalPools(scene, this.env, this.shared);
    this.puddles = new Puddles(scene, this.env, this.shared);
    this.skylights = new Skylights(scene, this.env, this.shared);
    this.worms = new Glowworms(scene, this.env, this.shared);
    this.track = new MineTrack(scene, this.env);
    this.tier = tier;
    this.on = false;           // the cavern is in reach
    this.inside = false;       // the world under the lens is the cavern's
    this.clock = 0;            // s
    this.drips = 0;            // drops that have fallen (and been heard), since the start
    this._drip = { n: 0, next: null, armed: null };
    this._drops = [];
    this._seed = env.seed | 0;
    this._alive = true;
    this._warm = (renderer, sc, camera) => (this._alive ? this.warm(renderer, sc, camera) : null);
    warmHooks.push(this._warm);
  }

  setTier(t) {
    this.tier = t;
  }

  // The floating origin has moved.
  shift() {
    this.pools.shift();
    this.puddles.shift();
    this.skylights.shift();
    this.worms.shift();
    this.track.shift();
  }

  // How much of the world under a look ({ a, b, t }: the two worlds and the blend) is the cavern's.
  static share(at) {
    if (!at || at.a < 0) return 0;
    const t = at.a === at.b ? 0 : at.t;
    return (at.a === CAVERN ? 1 - t : 0) + (at.b === CAVERN ? t : 0);
  }

  // Every frame. dt: s (0 in the photo mode: the world stands still); camera; ctx: { at (the look
  // the small things in the air go by), sCar, blocks (0 to 1: how far the style is the block's),
  // px (the pixels a metre makes at a metre), motes (the motes, for the light the dust is lit by),
  // settle (the world stands still: what the things have still to find is found at once) }.
  update(camera, dt, ctx) {
    const o = this.env.road.origin;
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    this.on = this.env.worlds.reaches(ax, az, CAVERN_VIEW.reach, (w) => w.id === 'cavern');
    // (The plans of the road far behind are let go now and then.)
    if (this.on && (this._frames = (this._frames || 0) + 1) % 600 === 0) this.env.plan.prune(ctx.sCar);
    this.clock += dt;
    this.shared.uTime.value = this.clock;
    this.shared.uBlock.value = ctx.blocks || 0;
    const tier = this.tier;
    // (Where the world stands still, as in the photo mode, what is still to be found is found at once.)
    const settle = !!ctx.settle;
    this.pools.update(camera, this.on, tier, true, settle);
    this.puddles.update(camera, this.on, tier, true, settle);
    this.skylights.update(camera, this.on, tier, ctx.sCar, dt);
    this.worms.update(camera, this.on, tier, ctx.px);
    this.track.update(camera, this.on, tier, ctx.sCar, true, settle);
    if (ctx.motes) this.skylights.beams(ctx.motes.beams, this.on ? 1 : 0);
    this.inside = Cavern.share(ctx.at) >= 0.5;
    this._drips(camera);
  }

  // The drops (world/cavernplan.js's DRIP says when).
  _drips(camera) {
    const C = CAVERN_VIEW;
    const d = this._drip;
    const o = this.env.road.origin;
    if (!this.inside) {
      d.next = null;
      d.armed = null;
      if (this._drops.length) {
        this._drops = [];
        this.worms.setDrops(this._drops);
      }
      return;
    }
    const gap = (n) => dripGap(n, this._seed);
    if (d.next === null) d.next = this.clock + DRIP.first;
    // A moment before it, the drop starts to fall into a puddle in front of the lens.
    if (!d.armed && this.clock >= d.next - C.fall) d.armed = { puddle: this.puddles.pick(camera, hash3(d.n, 32, this._seed)) };
    for (let guard = 0; guard < 3 && this.clock >= d.next; guard++) {
      this.drips++;
      if (d.armed && d.armed.puddle) this.puddles.drop(d.armed.puddle, d.next);
      d.n++;
      d.next += gap(d.n);
      d.armed = null;
    }
    if (this.clock >= d.next) d.next = this.clock + gap(d.n);
    this._drops.length = 0;
    const a = d.armed;
    if (a && a.puddle) {
      const p = a.puddle;
      const tau = Math.max(0, d.next - this.clock);
      const v = C.speed + GRAVITY * tau;
      this._drops.push({
        x: p.ax + p.hit[0] - o.x,
        y: p.y + C.speed * tau + 0.5 * GRAVITY * tau * tau,
        z: p.az + p.hit[1] - o.z,
        up: v * C.trail,
        alpha: 1 - THREE.MathUtils.smoothstep(tau, C.fall * 0.7, C.fall),
      });
    }
    this.worms.setDrops(this._drops);
  }

  // The things a car off the road runs into, as [x, z, radius, ...] added to out.
  near(ax, az, range, out) {
    return this.track.near(ax, az, range, out);
  }

  // The meshes whose programs are built ahead.
  _meshes() {
    return [this.pools.mesh, this.puddles.mesh, this.skylights.mesh, this.worms.points, this.track.pieces];
  }

  // The programs, built ahead as they are drawn.
  warm(renderer, scene, camera) {
    return compileObjects(renderer, scene, camera, this._meshes());
  }

  // The same, one mesh at a time, for a queue ([[name, task]]).
  warmTasks(renderer, scene, camera) {
    return this._meshes().map((m, i) => [`cavern.${i}`, () => (this._alive ? compileObjects(renderer, scene, camera, [m]) : null)]);
  }

  stats() {
    return {
      on: this.on, inside: this.inside, tier: this.tier, pools: this.pools.count, puddles: this.puddles.count,
      skylights: this.skylights.count, threads: this.worms.threads, track: this.track.count, drips: this.drips,
    };
  }

  dispose() {
    this._alive = false;
    const i = warmHooks.indexOf(this._warm);
    if (i >= 0) warmHooks.splice(i, 1);
    for (const m of [this.pools, this.puddles, this.skylights, this.worms, this.track]) m.dispose();
  }
}
