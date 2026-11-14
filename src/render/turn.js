// The view turned over, for the Upside Down (world 'upside').
//
// Where the road runs into it the world turns over the way a camera rolls:
// all of it at once, stiff, about the line of sight, as the room turns in a
// corridor fight, and the car is the one thing that stays put on the screen,
// the world going round it. Nothing is bent or torn. The camera rolls and
// everything else is drawn as it always was, so the horizon stays a straight
// line, the sky and the land stay together, and the lights, the haze and the
// shadows need no say in it. Only which way is up on the screen changes.
//
//  - What turns: the whole picture, as one piece.
//  - About what: the line of sight. The aim is swung toward the car while the
//    view is on its side, so the car stays near the middle of the screen
//    and the world goes round it, not round a point somewhere down the road.
//  - How: a half turn in TURN_TIME seconds, slow to start, quickest in the
//    middle, a hair past the end and back; the field of view opens by an
//    eighth at the side of the turn, the world a little wider than the
//    screen was.
//  - When: it begins when the car is a quarter of the way through the border
//    (Upside.turnView), the same going out. A turn is always a half turn
//    forward, so going in and coming out turn the same way round, and the
//    second finishes the whole turn. Backing over a border turns it back.
//
// The view's roll is `roll` and the half turns made are `half` (roll at rest
// is π × half); both are plain numbers for the rest of the game to read: a
// car steers the other way once the screen is the other way up.

import * as THREE from 'three';

export const TURN_TIME = 3;    // s, a half turn
const OVER = 0.02;             // the half turn's share it goes past the end by, before it comes back
const ANCHOR = 0.85;           // how far the aim is swung to the car at the side of the turn (1: dead on it)
const BREATH = 0.12;           // how much wider the field of view opens at the side of the turn
const SEEN = [0.6, 0.9];       // the car must be this near the line of sight (a cosine) for the aim to go to it
const MIDDLE = 0.7;            // m above the car's wheels: where the aim is
const PEAK = 666;              // 1 / the top of u^18 (1 - u)^2, so the overshoot is OVER of the turn

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// The roll at time t of a move from a, going v0 rad/s, to b, at rest, taking
// `time` seconds: a quintic that starts and ends with no acceleration (so a
// move that begins under way, a border crossed back over, starts smoothly)
// and a small hump on the last of it that takes it past b and brings it back.
// Writes [angle, rad/s] to out.
function move(a, v0, b, t, time, out) {
  const u = Math.min(1, Math.max(0, t / time));
  const u2 = u * u;
  const u3 = u2 * u;
  const u4 = u3 * u;
  const u5 = u4 * u;
  const h00 = 1 - 10 * u3 + 15 * u4 - 6 * u5;
  const h10 = u - 6 * u3 + 8 * u4 - 3 * u5;
  const h01 = 10 * u3 - 15 * u4 + 6 * u5;
  const d00 = -30 * u2 + 60 * u3 - 30 * u4;
  const d10 = 1 - 18 * u2 + 32 * u3 - 15 * u4;
  const w = Math.pow(u, 17);
  const hump = PEAK * w * u * (1 - u) * (1 - u);
  const dHump = PEAK * w * (1 - u) * (18 - 20 * u);
  out[0] = a * h00 + v0 * time * h10 + b * h01 + (b - a) * OVER * hump;
  out[1] = (a * d00 + v0 * time * d10 - b * d00 + (b - a) * OVER * dHump) / time;
  return out;
}

export class Turn {
  constructor() {
    this.half = 0;            // half turns made: the roll at rest is π × this
    this.roll = 0;            // rad, the view's roll about the line of sight
    this.rate = 0;            // rad/s
    this.turning = false;
    this.side = 0;            // 0 upright or upside down, 1 on its side
    this.starts = 0;          // half turns begun, to count them by
    this._inverted = null;    // whether the world the car is in is the other way up; null before the first look
    this._from = 0;
    this._v0 = 0;
    this._to = 0;
    this._t = 0;
    this._move = [0, 0];
    this._f = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  // At rest where the world is, with no turn: a start, or a car put
  // somewhere else.
  rest(inverted) {
    this._inverted = inverted;
    this.half = inverted ? 1 : 0;
    this.roll = Math.PI * this.half;
    this.rate = 0;
    this.turning = false;
  }

  // One frame. inverted: whether the world the car is in is the other way up
  // (decided by where it is, by Upside); way: 1 going forward along the road,
  // -1 backing; jump: the car has been put somewhere else.
  step(dt, inverted, way = 1, jump = false) {
    if (this._inverted === null || jump) this.rest(inverted);
    else if (inverted !== this._inverted) {
      this._inverted = inverted;
      this.half += way < 0 ? -1 : 1;
      this._from = this.roll;
      this._v0 = this.rate;
      this._to = Math.PI * this.half;
      this._t = 0;
      this.turning = true;
      this.starts++;
    }
    if (!this.turning) return;
    this._t += dt;
    if (this._t >= TURN_TIME) {
      this.turning = false;
      this.roll = this._to;
      this.rate = 0;
      return;
    }
    const m = move(this._from, this._v0, this._to, this._t, TURN_TIME, this._move);
    this.roll = m[0];
    this.rate = m[1];
  }

  // Roll the camera, where the chase or the director has put it. The aim goes
  // part of the way to the car by how far on its side the view is (how far
  // from either end of the turn), then the camera rolls about it; the field
  // of view opens the same way. The rigs set the field of view again every
  // frame, so there is nothing to put back.
  apply(camera, car) {
    const s = Math.sin(this.roll);
    const side = s * s;
    this.side = side;
    if (side > 1e-4) {
      const f = camera.getWorldDirection(this._f);
      const d = this._d.set(car.x, car.y + MIDDLE, car.z).sub(camera.position).normalize();
      const k = ANCHOR * side * smooth(SEEN[0], SEEN[1], f.dot(d));
      if (k > 1e-4) {
        d.sub(f).multiplyScalar(k).add(f).normalize();
        camera.quaternion.premultiply(this._q.setFromUnitVectors(f, d));
      }
    }
    camera.rotateZ(this.roll);
    if (side > 0.004) {
      camera.fov *= 1 + BREATH * side;
      camera.updateProjectionMatrix();
    }
  }
}
