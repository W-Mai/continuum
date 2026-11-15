// The view turned over, for the Upside Down (world 'upside').
//
// Where the road runs into it the road is wound into a corkscrew, a half turn
// over a stretch of it (render/twist.js), and the car drives along it and goes
// over with it. The view goes over with the car: it is rolled about the line
// of sight by the angle the road has under the car, so the roll is a matter of
// where the car is, not of time. A car that stops half way over stays on its
// side, and one that backs out comes back upright.
//
//  - What turns: the lens, by the car's angle. The world ahead and behind is
//    turned by the rest (render/twist.js), so on the screen what is far ahead
//    holds still and the near world comes round to it.
//  - About what: the line of sight. The aim is swung toward the car while the
//    view is on its side, so the car stays near the middle of the screen
//    and the world goes round it, not round a point somewhere down the road.
//  - The field of view opens by an eighth at the side of the turn, the world
//    a little wider than the screen was.
//  - Going in is a half turn, and going out is another the same way round, so
//    the two make a whole turn.
//
// The view's roll is `roll` (π at rest in the Upside Down), a plain number
// for the rest of the game to read: a car steers the other way once the
// screen is the other way up.

import * as THREE from 'three';

const ANCHOR = 0.85;           // how far the aim is swung to the car at the side of the turn (1: dead on it)
const BREATH = 0.12;           // how much wider the field of view opens at the side of the turn
const SEEN = [0.6, 0.9];       // the car must be this near the line of sight (a cosine) for the aim to go to it
const MIDDLE = 0.7;            // m above the car's wheels: where the aim is

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Turn {
  constructor() {
    this.roll = 0;            // rad, the view's roll about the line of sight
    this.rate = 0;            // rad/s
    this.turning = false;     // on the way over
    this.side = 0;            // 0 upright or upside down, 1 on its side
    this._f = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  // One frame: the angle the road has under the car. jump: the car has been
  // put somewhere else, and the view is at rest where it is.
  set(dt, roll, jump = false) {
    let d = roll - this.roll;
    d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    this.rate = jump || !(dt > 0) ? 0 : d / dt;
    this.roll = roll;
    const s = Math.sin(roll);
    this.turning = s * s > 1e-5 || Math.abs(this.rate) > 1e-3;
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
