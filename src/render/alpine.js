// What the alpine world has of its own along the road, beside its land (render/terrain.js: the snow that
// stays under the snow line), its trees and its rubble at the foot of the cliffs (render/clutter.js):
// snow poles by the road (render/snowpoles.js), waterfalls on the cliffs (render/waterfalls.js), plumes of
// snow blown off the ridges above the snow line (render/plumes.js, which is not the alpine's alone) and,
// to be heard, the rush of a waterfall near the lens and the ring of a cow bell on the slopes.
//
// This is the one that holds them: it says whether the lens is where they are, which of them the tier
// draws, what ridges the plumes trail from, and when a bell rings. Where each is, the plan says
// (world/alpineplan.js: nothing in it touches three.js), by the road, the land and the seed alone, so that
// the same place has the same things each time the car comes by; a thing belongs to the alpine world by its
// own draw across a border, so each thins out as the next world comes in.
//
// None of it is kept off the alpine: out of reach of its world nothing is drawn, nothing is worked out, and
// no mesh is in the scene (a game that is never in the alpine builds no program for any of it). The meshes
// join the scene when the alpine first comes into reach, and their programs are built ahead then. Each
// draws by the tier (render/quality.js): all of them at 'high', half at 'mid', none at 'low' (the waterfall
// is still heard, and the bells still ring).

import * as THREE from 'three';
import { ALPINE, PLUME, BELL, FALL, bellGap, bellRing } from '../world/alpineplan.js';
import { Plumes } from './plumes.js';
import { Waterfalls } from './waterfalls.js';
import { SnowPoles } from './snowpoles.js';

// reach: how far off (m, in the worlds' own progress) the alpine may be, for what it has to be drawn.
export const ALPINE_VIEW = { reach: 700 };
// How high a ridge can be (m): the top of the boxes a plume is looked for in.
const PLUME_TOP = 1600;
// The plumes' paint: the colour of the thick of one, of the thin of it, in the painted styles; how bright it is.
const SNOW_PLUME = { color: 0xf6f9ff, shade: 0xaec2e0, flat: 0xf2f7ff, gain: 1.7, opacity: 0.5, lull: 0.35, wisp: 90, speed: 16, flutter: 16, range: PLUME.reach, near: 200 };

export class Alpine {
  // env: plan (AlpinePlan), road, worlds, seed, solidAt(ax, y, az) (optional), compile(meshes) (builds their programs ahead).
  constructor(scene, env, tier = 'high') {
    this.env = { ...env, origin: () => env.road.origin };
    this.scene = scene;
    this.tier = tier;
    this.poles = new SnowPoles(scene, this.env);
    this.falls = new Waterfalls(scene, this.env);
    this.plumes = new Plumes(scene, { ...SNOW_PLUME, max: PLUME.max });
    this.plumes.setTier(tier);
    this.on = false;             // the alpine is in reach
    this.inside = false;         // the world under the lens is the alpine's
    this.clock = 0;              // s, while the world goes
    this.bells = 0;              // times a bell has rung, since the start
    this.ring = null;            // how the last one rang
    // What is heard of the waterfalls: how loud (0 to 1) the nearest is to the lens and where it is (local).
    this.hearing = { level: 0, x: 0, y: 0, z: 0, d: Infinity };
    this._next = null;           // when the next bell rings (the clock's), or null when none is due
    this._warmed = false;
    this._frames = 0;
    this._grass = { x: 1e9, z: 1e9, at: -1, yes: false };
    this._plume = { x: 1e9, z: 1e9, key: '', dirty: true, more: false, dir: new THREE.Vector3(0, 0, -1) };
    this._fwd = new THREE.Vector3();
    this._pm = new THREE.Matrix4();
    this._inv = new THREE.Matrix4();
    this._frustum = new THREE.Frustum();
    this._sphere = new THREE.Sphere();
    this._box = new THREE.Box3();
  }

  setTier(t) {
    this.tier = t;
    this.plumes.setTier(t);
    this._plume.dirty = true;
  }

  // The floating origin has moved.
  shift() {
    this.poles.shift();
    this.falls.shift();
    this._plume.dirty = true;
  }

  // How much of the world under a look ({ a, b, t }: the two worlds and the blend) is the alpine's.
  static share(at, id = ALPINE) {
    if (!at || at.a < 0) return 0;
    const t = at.a === at.b ? 0 : at.t;
    return (at.a === id ? 1 - t : 0) + (at.b === id ? t : 0);
  }

  // Every frame. dt: s (0 in the photo mode: the world stands still); camera; ctx: { at (the look the small
  // things in the air go by), sCar, sRef (where along the road the lens is, if it is not where the car is), blocks
  // (0 to 1: how far the style is the block's), px (the pixels a metre makes at a metre), light (0 to 1), fog ([r, g, b]),
  // settle (the world stands still: what the plan has still to find is found at once) }.
  update(camera, dt, ctx) {
    const o = this.env.road.origin;
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    this.on = this.env.worlds.reaches(ax, az, ALPINE_VIEW.reach, (w) => w.id === 'alpine');
    this.clock += dt;
    this.inside = Alpine.share(ctx.at) >= 0.5;
    const tier = this.tier;
    if (!this.on) {
      this._rest(dt);
      return;
    }
    const settle = !!ctx.settle;
    const sRef = ctx.sRef !== undefined ? ctx.sRef : ctx.sCar;
    // (The plans of the road far behind are let go now and then.)
    if ((this._frames = this._frames + 1) % 600 === 0) this.env.plan.prune(sRef, ax, az);
    // The programs, built ahead the first time anything is to be drawn.
    if (!this._warmed && tier !== 'low' && this.env.compile) {
      this._warmed = true;
      this.env.compile(this.meshes());
    }
    // The waterfalls: the ones round the lens that the plan knows (a little more of it each frame), drawn and heard.
    const known = this.falls.find(sRef, settle);
    this.falls.update(camera, true, tier, known, ctx);
    this._hear(camera, known);
    this.poles.setBlocky((ctx.blocks || 0) > 0.5);
    this.poles.update(camera, true, tier, sRef, settle);
    this._plumes(camera, dt, ax, az, tier, settle, ctx);
    this._rings(dt, ax, az);
  }

  // Out of reach of the alpine: nothing drawn, nothing heard, no bell due.
  _rest(dt) {
    this.poles.update(null, false, this.tier, 0);
    this.falls.update(null, false, this.tier, [], {});
    this.plumes.set([]);
    this.plumes.update(dt, {});
    this.hearing.level = 0;
    this._next = null;
    this._plume.key = '';
    this._plume.dirty = true;
  }

  // How loud the waterfall nearest the lens is: not at all more than FALL.hear metres from it, and the nearer the louder.
  _hear(camera, known) {
    const near = this.falls.nearest(camera, known);
    const h = this.hearing;
    if (!near) {
      h.level = 0;
      h.d = Infinity;
      return;
    }
    h.level = Math.pow(1 - near.d / FALL.hear, 1.3);
    h.d = near.d;
    h.x = near.x;
    h.y = near.y;
    h.z = near.z;
  }

  // The plumes: the ridges within reach of the lens that the lens sees, the nearest of them, as the bands of the plume module. Which
  // are seen is asked again when the lens has gone 8 m or turned 3 degrees; a plume that is up is kept until it is well out of view,
  // so that one at the edge of the picture does not come and go.
  _plumes(camera, dt, ax, az, tier, settle, ctx) {
    const P = this._plume;
    const o = this.env.road.origin;
    if (tier === 'low') {
      if (P.key !== '') {
        this.plumes.set([]);
        P.key = '';
      }
      this.plumes.update(dt, ctx);
      return;
    }
    camera.getWorldDirection(this._fwd);
    const moved = Math.hypot(ax - P.x, az - P.z) >= 8 || this._fwd.dot(P.dir) < 0.9986;
    if (moved || P.dirty || P.more || settle) {
      camera.updateMatrixWorld();
      this._pm.multiplyMatrices(camera.projectionMatrix, this._inv.copy(camera.matrixWorld).invert());
      this._frustum.setFromProjectionMatrix(this._pm);
      const held = this.plumes.held();
      // What is wanted: a cell of the land that the lens could see a plume from (a box from the snow line up, as wide again as the
      // longest plume is), and a ridge whose plume is in the view.
      const low = this.env.plan.snowLine - 160;
      const wide = PLUME.length[1];
      const view = {
        cell: (x0, z0, x1, z1) => {
          this._box.min.set(x0 - wide - o.x, low, z0 - wide - o.z);
          this._box.max.set(x1 + wide - o.x, PLUME_TOP, z1 + wide - o.z);
          return this._frustum.intersectsBox(this._box);
        },
        ridge: (q) => {
          // (A plume that is not up comes when the middle of it is in the view; one that is up stays till it is well out.)
          const m = (q.n >> 1) * 3;
          this._sphere.center.set(q.pts[m] - o.x, q.pts[m + 1], q.pts[m + 2] - o.z);
          if (!held.has(q.key)) return this._frustum.containsPoint(this._sphere.center);
          this._sphere.radius = q.len * 0.6 + q.width + 600;
          return this._frustum.intersectsSphere(this._sphere);
        },
      };
      const list = this.env.plan.plumesNear(ax, az, PLUME.reach, this.plumes.room, settle ? Infinity : 250, view);
      // (Some of the cells that were wanted are left for the next frame.)
      P.more = list.skipped > 0;
      const key = list.map((q) => q.key).join(',');
      if (key !== P.key || P.dirty) {
        P.key = key;
        P.dirty = false;
        this.plumes.set(list.map((q) => {
          const pts = new Float32Array(q.n * 3);
          for (let i = 0; i < q.n; i++) {
            pts[i * 3] = q.pts[i * 3] - o.x;
            pts[i * 3 + 1] = q.pts[i * 3 + 1];
            pts[i * 3 + 2] = q.pts[i * 3 + 2] - o.z;
          }
          return { key: q.key, pts, width: q.width, strength: 1, seed: q.seed };
        }));
      }
      P.x = ax;
      P.z = az;
      P.dir.copy(this._fwd);
    }
    this.plumes.update(dt, { light: ctx.light, fog: ctx.fog, blocks: ctx.blocks });
  }

  // The cow bells: while the lens is in the alpine, under the tree line and by open grass slope, one rings every 8 to 20 s,
  // each gap by a draw of its own (world/alpineplan.js). The clock is the world's own, which stands still in the photo mode.
  _rings(dt, ax, az) {
    const G = this._grass;
    // (Looked at a few times a second, or where the lens has moved: it takes some looking.)
    if (this.clock - G.at > 0.25 || Math.hypot(ax - G.x, az - G.z) > 10) {
      G.at = this.clock;
      G.x = ax;
      G.z = az;
      G.yes = this.env.plan.grassSlopeAt(ax, az);
    }
    if (!(this.inside && G.yes)) {
      this._next = null;
      return;
    }
    if (this._next === null) this._next = this.clock + BELL.first;
    for (let guard = 0; guard < 3 && this.clock >= this._next; guard++) {
      this.bells++;
      this.ring = bellRing(this.bells, this.env.seed);
      this._next += bellGap(this.bells, this.env.seed);
    }
    if (this.clock >= this._next) this._next = this.clock + bellGap(this.bells, this.env.seed);
  }

  // The meshes whose programs are built ahead.
  meshes() {
    return [this.poles.mesh, ...this.falls.meshes(), ...this.plumes.meshes()];
  }

  stats() {
    return {
      on: this.on, inside: this.inside, tier: this.tier, poles: this.poles.count, falls: this.falls.count, rows: this.falls.rows,
      mist: this.falls.points, plumes: this.plumes.count, bells: this.bells, hearing: +this.hearing.level.toFixed(3),
    };
  }

  dispose() {
    this.poles.dispose();
    this.falls.dispose();
    this.plumes.dispose();
  }
}

