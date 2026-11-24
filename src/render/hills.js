// What the hills have of their own by the road: dry-stone walls along the verge (render/stonewalls.js), a line
// of poles with its wires (render/powerlines.js), and the farm tracks that leave the road across the fields; and, in
// the land's own shader, the fields (render/fieldshade.js). The stacks of straw in the stubble are of what lies
// about the ground (render/clutter.js), and the hedges along the banks are of the trees (world/vegetation.js).
//
// This is the one that holds the first three: it says whether the lens is where they are, which of them the tier
// draws, and which farm tracks the land's shader is told of (the nearest four, and the ruts at their mouths on the
// road's verge). Where the hills are out of reach nothing is drawn or worked out and the land's shader is told of no
// track, so that the frame is as it was without them; the meshes join the scene when the first piece is laid.
//
// Each draws by the tier (render/quality.js): all of them at 'high', the walls and the line half as far at 'mid' and
// two tracks, none of the three at 'low'.

import { TRACK } from '../world/hillsplan.js';
import { StoneWalls } from './stonewalls.js';
import { PowerLines } from './powerlines.js';
import { farmMaterial } from './farmparts.js';
import { fieldU, MAX_TRACKS } from './fieldshade.js';

// reach: how far off (m, in the worlds' own progress) the hills may be, for what they have to be drawn; tracks: how far
// from the lens a track is told to the land's shader (m, from its middle: a track is 200 m long at the most).
export const HILLS_VIEW = { reach: 700, tracks: 560 };
const TRACKS_AT = { high: MAX_TRACKS, mid: 2, low: 0 };

export class Hills {
  // env: plan (HillsPlan), road, worlds; tier: the one to begin with.
  constructor(scene, env, tier = 'high') {
    this.env = env;
    this.scene = scene;
    this.tier = tier;
    this.material = farmMaterial();
    this.walls = new StoneWalls(scene, env, this.material);
    this.lines = new PowerLines(scene, env, this.material);
    this.on = false;            // the hills are in reach
    this.warm = null;           // what builds a mesh's programs ahead (Game sets it)
    this._warmed = false;
    this._tracks = [];          // the tracks the land's shader is told of: { k, t }
    this._tkey = '';
    this._tat = { x: 1e9, z: 1e9 };
    this._frames = 0;
  }

  setTier(t) {
    this.tier = t;
    this._tkey = '';
  }

  // The floating origin has moved.
  shift() {
    this.walls.shift();
    this.lines.shift();
    this._tkey = '';
  }

  // The road after s is laid again (a turn): what was worked out for it is let go of.
  forget(s) {
    this.env.plan.forget(s);
    this.walls.shift();
    this.lines.shift();
    this._tkey = '';
  }

  // Every frame. camera; ctx: { sCar, blocks (0 to 1: how far the style is the block's), px (the pixels a radian makes at
  // the lens), settle (the world stands still: what the things have still to find is found at once) }.
  update(camera, dt, ctx) {
    const o = this.env.road.origin;
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    this.on = this.env.worlds.reaches(ax, az, HILLS_VIEW.reach, (w) => w.id === 'hills');
    if (this.on && (this._frames = this._frames + 1) % 600 === 0) this.env.plan.prune(ctx.sCar);
    if (this.on && !this._warmed && this.warm) {
      // The programs of what is to be drawn are built in the compiler's threads before the first piece is laid.
      this._warmed = true;
      this.warm(this.meshes());
    }
    const settle = !!ctx.settle;
    this.lines.setBlocky((ctx.blocks || 0) > 0.5);
    this.walls.update(camera, this.on, this.tier, ctx.sCar, settle);
    this.lines.update(camera, this.on, this.tier, ctx.sCar, settle, ctx.px);
    this._updateTracks(camera, ax, az, o, ctx.sCar, settle);
  }

  // The farm tracks near the lens, told to the land's shader and to the road's verge.
  _updateTracks(camera, ax, az, o, sCar, settle) {
    const want = this.on ? TRACKS_AT[this.tier] : 0;
    const plan = this.env.plan;
    const have = [];
    if (want > 0) {
      let worked = 0;
      for (let k = Math.floor((sCar - HILLS_VIEW.tracks - 300) / TRACK.every); k <= Math.floor((sCar + HILLS_VIEW.tracks + 300) / TRACK.every); k++) {
        if (!settle && !plan.tracksOf.has(k) && worked++ > 0) continue;
        const t = plan.track(k);
        if (!t) continue;
        const mx = (t.pts[0] + t.pts[(t.n - 1) * 2]) / 2;
        const mz = (t.pts[1] + t.pts[(t.n - 1) * 2 + 1]) / 2;
        const d = Math.hypot(mx - ax, mz - az);
        if (d < HILLS_VIEW.tracks) have.push({ k, t, d, mx, mz });
      }
      have.sort((a, b) => a.d - b.d);
      have.length = Math.min(have.length, want);
    }
    const key = have.map((e) => e.k).join(',') + '|' + o.x + ',' + o.z;
    if (key === this._tkey && Math.hypot(ax - this._tat.x, az - this._tat.z) < 20) return;
    this._tkey = key;
    this._tat.x = ax;
    this._tat.z = az;
    this._tracks = have;
    const A = fieldU.uTrackA.value;
    const B = fieldU.uTrackB.value;
    const C = fieldU.uTrackC.value;
    const J = fieldU.uJunction.value;
    for (let i = 0; i < MAX_TRACKS; i++) {
      const e = have[i];
      if (!e) {
        C[i].z = 0;
        J[i].set(0, 0, 0, 0);
        continue;
      }
      const p = e.t.pts;
      A[i].set(p[0] - o.x, p[1] - o.z, p[2] - o.x, p[3] - o.z);
      B[i].set(p[4] - o.x, p[5] - o.z, p[6] - o.x, p[7] - o.z);
      let r = 0;
      for (let q = 0; q < e.t.n; q++) r = Math.max(r, Math.hypot(p[q * 2] - e.mx, p[q * 2 + 1] - e.mz));
      C[i].set(e.mx - o.x, e.mz - o.z, r + TRACK.width + 4);
      // The way out of the road, at the mouth: from it to the next point of the track.
      const dx = p[2] - p[0];
      const dz = p[3] - p[1];
      const dl = Math.hypot(dx, dz) || 1;
      J[i].set(p[0] - o.x, p[1] - o.z, dx / dl, dz / dl);
    }
    fieldU.uJunctions.value = have.length;
  }

  // The things a car off the road runs into, as [x, z, radius, ...] added to out.
  near(ax, az, range, out) {
    this.walls.near(ax, az, range, out);
    this.lines.near(ax, az, range, out);
    return out;
  }

  // Whether something solid stands within range of an absolute point (so that a car on the verge is asked about it too).
  solidNear(ax, az, range) {
    if (this.walls.count + this.lines.count === 0) return false;
    const buf = this._buf || (this._buf = []);
    buf.length = 0;
    this.near(ax, az, range, buf);
    return buf.length > 0;
  }

  // The meshes whose programs are built ahead.
  meshes() {
    return [this.walls.mesh, ...this.lines.meshes()];
  }

  stats() {
    return {
      on: this.on, tier: this.tier, walls: this.walls.count, poles: this.lines.count, spans: this.lines.spans,
      tracks: this._tracks.length, drawn: this.walls.mesh.visible + this.lines.poles.visible + this.lines.wires.visible,
    };
  }

  dispose() {
    this.walls.dispose();
    this.lines.dispose();
    this.material.dispose();
    for (let i = 0; i < MAX_TRACKS; i++) fieldU.uTrackC.value[i].z = 0;
    fieldU.uJunctions.value = 0;
  }
}
