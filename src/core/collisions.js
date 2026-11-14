// Collision between the player and everything else on the road.
//
// Everything on the road already lives in track space: arc length s plus a
// lateral offset. Testing overlaps there is both cheaper and more accurate than
// building world-space boxes, because the road curves and a box does not.

const CAR_HALF_LEN = 2.25;
const CAR_HALF_WID = 0.92;

// A hit needs the other body's arc-length window and lateral window to overlap.
// Both are axis-aligned in track space, so this is two interval tests.
export function overlaps(a, b) {
  const ds = Math.abs(a.s - b.s);
  const dl = Math.abs(a.lat - b.lat);
  return ds < (a.halfLen + b.halfLen) && dl < (a.halfWid + b.halfWid);
}

export class Collisions {
  constructor(car, track) {
    this.car = car;
    this.track = track;

    // Consecutive frames of contact are treated as one event, so a glancing
    // touch does not retrigger every step.
    this.lastHitAt = -99;
    this.hitCooldown = 0;

    this.lastImpact = 0;
    this.hits = 0;
  }

  // Player's footprint in track space. The lateral offset is signed, taken from
  // the centreline at the player's own arc length.
  _playerBox(sCar) {
    const p = this.track.at(sCar);
    if (!p) return null;
    const nx = -Math.sin(p.theta);
    const nz = Math.cos(p.theta);
    const lat = (this.car.x - p.x) * nx + (this.car.z - p.z) * nz;
    return {
      s: sCar, lat,
      halfLen: CAR_HALF_LEN, halfWid: CAR_HALF_WID,
    };
  }

  // Check against the traffic stream. `traffic` exposes cars with s, lane and
  // dir; closing speed decides how hard the hit is.
  update(dt, sCar, traffic1, simTime) {
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    if (!traffic1) return null;

    const me = this._playerBox(sCar);
    if (!me) return null;

    for (const c of traffic1.cars) {
      const box = {
        s: c.s,
        lat: c.lane,
        halfLen: c.len ? c.len / 2 : 2.2,
        halfWid: c.wid ? c.wid / 2 : 0.93,
      };
      if (!overlaps(me, box)) continue;

      // Closing speed: the player and the other car moving toward each other on
      // the s axis. Only the component along the road matters for severity.
      const rel = Math.abs(this.car.vx - c.dir * c.speed);
      if (this.hitCooldown > 0) {
        // Still touching: keep pushing them apart instead of re-reporting.
        return { kind: 'contact', speed: rel, car: c, s: box.s, lat: box.lat };
      }

      this.hitCooldown = 0.45;
      this.hits++;
      this.lastImpact = rel;
      this.lastHitAt = simTime;
      return {
        kind: 'impact',
        speed: rel,
        car: c,
        s: box.s,
        lat: box.lat,
        oncoming: c.dir !== 1,
      };
    }
    return null;
  }

  reset() {
    this.hitCooldown = 0;
    this.lastImpact = 0;
  }
}
