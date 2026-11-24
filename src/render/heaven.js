// What the heaven has of its own beside its sea of cloud's veils and ring (render/water.js, VEILS) and its land
// going into the cloud white (render/terrain.js): skeins of cranes over the sea (render/cranes.js), its piers
// going into the white as the land does (render/roadmesh.js, pierMist), and the bell of its temples.
//
// This is the one that holds them: it says how much of the lens's world is the heaven, which of them the tier
// draws, and when the bell is struck. Within BELL.reach of a temple (render/props.js) the bell's clock runs: the
// first stroke a few seconds after the lens comes in reach, then one every 20 to 40 seconds (world/heavenplan.js,
// bellGap); at each `bells` goes up by one and `bell` says how loud it is and where the temple is, which the
// sound answers with the stroke (ui/sound.js).
//
// Out of the heaven nothing is drawn and nothing is worked out. The cranes draw by the tier (render/quality.js):
// four skeins at 'high', two at 'mid', none at 'low'; the piers' white and the bell are in every tier.

import * as THREE from 'three';
import { WORLDS } from '../world/worlds.js';
import { HEAVEN, MIST, BELL, bellGap, bellLevel } from '../world/heavenplan.js';
import { Cranes } from './cranes.js';
import { pierMist } from './roadmesh.js';

const lin = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
// The colour the land and the piers go into (linear): the sea's, between its deep and its shallow.
const CLOUD = lin(WORLDS[HEAVEN].water.waterDeep).lerp(lin(WORLDS[HEAVEN].water.waterShallow), 0.6);

export class Heaven {
  // env: props (render/props.js), worlds, road, seed; tier: the one to begin with.
  constructor(scene, env, tier = 'high') {
    this.env = env;
    this.cranes = new Cranes(scene, tier);
    this.tier = tier;
    this.share = 0;
    this.bells = 0;            // strokes of the bell so far
    this.bell = null;          // the last: { level, x, z } (local)
    this.temple = Infinity;    // how far the nearest temple is from the lens (m)
    this.clock = 0;            // s, while a temple is in reach
    this._next = null;
    this._seed = env.seed | 0;
    this._near = { d: Infinity, x: 0, z: 0 };
  }

  setTier(t) {
    this.tier = t;
    this.cranes.setTier(t);
  }

  // How much of the world under a look ({ a, b, t }) is the heaven's.
  static share(at) {
    if (!at || at.a < 0) return 0;
    const t = at.a === at.b ? 0 : at.t;
    return (at.a === HEAVEN ? 1 - t : 0) + (at.b === HEAVEN ? t : 0);
  }

  // ctx: camera, at (the look's worlds), origin, fogColor, level (the sea's height).
  update(dt, ctx) {
    const share = Heaven.share(ctx.at);
    this.share = share;
    this.cranes.update(dt, ctx.camera, share, ctx.level || 0, ctx.fogColor, ctx.origin);
    const m = pierMist.uPierMist.value;
    m.set(CLOUD.r, CLOUD.g, CLOUD.b, share);
    pierMist.uPierMistAt.value.set(ctx.level || 0, MIST);
    // The bell: the nearest temple, and the clock while one is in reach.
    const o = ctx.origin;
    const c = ctx.camera.position;
    const near = share > 0.01 && this.env.props ? this.env.props.nearestOf('temple', c.x + o.x, c.z + o.z, this._near) : null;
    this.temple = near ? near.d : Infinity;
    if (!(this.temple < BELL.reach)) {
      this.clock = 0;
      this._next = null;
      return;
    }
    if (this._next === null) this._next = bellGap(this.bells + 1, this._seed);
    this.clock += dt;
    if (this.clock >= this._next) {
      this.bells++;
      this.bell = { level: bellLevel(this.temple) * Math.min(1, share * 1.5), x: near.x - o.x, z: near.z - o.z };
      this.clock = 0;
      this._next = bellGap(this.bells + 1, this._seed);
    }
  }

  stats() {
    return { share: this.share, cranes: this.cranes.shown, bells: this.bells, temple: Number.isFinite(this.temple) ? Math.round(this.temple) : null };
  }

  dispose() {
    this.cranes.dispose();
    pierMist.uPierMist.value.w = 0;
  }
}
