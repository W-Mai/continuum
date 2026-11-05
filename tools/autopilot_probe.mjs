// Probe the autopilot's own output against known geometry, with no vehicle
// dynamics in the loop, so controller bugs show up on their own.

import { Track } from '../src/core/track.js';
import { Autopilot } from '../src/core/autopilot.js';

// Replace every cached sample with a perfect straight line along +X.
function flattenToStraight(track) {
  for (const s of track.samples.keys()) {
    const v = track.samples.get(s);
    v.x = s;
    v.z = 0;
    v.theta = 0;
    v.kappa = 0;
  }
}

function probeOffset(zOffset, steerSign) {
  const track = new Track();
  flattenToStraight(track);
  const pilot = new Autopilot(track);
  const out = [];
  for (let i = 0; i < 6; i++) {
    const c = pilot.drive(1 / 60, {
      s: 20, x: 20, z: zOffset, yaw: 0, speed: 20,
    });
    out.push(+c.steer.toFixed(4));
  }
  return { zOffset, expectedSign: steerSign, series: out };
}

function probeCurve() {
  const track = new Track();
  const pilot = new Autopilot(track);
  const out = [];
  for (let s = 0; s < 360; s += 45) {
    const p = track.at(s);
    const c = pilot.drive(1 / 60, { s, x: p.x, z: p.z, yaw: p.theta, speed: 25 });
    out.push({
      s,
      kappa: +p.kappa.toFixed(4),
      idealCmd: +(Math.atan(p.kappa * 2.7) / 0.52).toFixed(3),
      cmdSteer: +c.steer.toFixed(3),
      targetKmh: +(c.targetSpeed * 3.6).toFixed(0),
    });
  }
  return out;
}

console.log('straight road: car displaced in +Z (left), must steer negative');
console.table(probeOffset(3, '-'));
console.log('straight road: car displaced in -Z (right), must steer positive');
console.table(probeOffset(-3, '+'));
console.log('\ncurve, car exactly on the line (cmdSteer should approach idealCmd):');
console.table(probeCurve());
