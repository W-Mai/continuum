// Headless driving check: the real road generator, car model and autopilot,
// stepped exactly as game.js steps them, with no renderer. Fails if the
// autopilot leaves the asphalt, wrecks, stalls or drifts out of its lane.
//
// Usage: node tools/physics_check.mjs [seconds] [seed]

import { makeAlpine } from '../src/world/landform.js';
import { Road, HALF_PAVED, LANE } from '../src/world/road.js';
import { Car } from '../src/core/car.js';
import { Autopilot } from '../src/core/autopilot.js';

const DT = 1 / 120;
const CROWN = 0.045;
const seconds = Number(process.argv[2]) || 120;
const seed = Number(process.argv[3] ?? 7);

const land = makeAlpine(seed);
const road = new Road(land, seed);
const car = new Car();
const pilot = new Autopilot(road);

let sCar = 160;
const p0 = road.at(sCar);
car.reset(p0.x - Math.sin(p0.theta) * LANE, p0.z + Math.cos(p0.theta) * LANE, p0.theta,
  road.surfaceAt(sCar, LANE) + CROWN);

const st = {
  frames: 0, offRoad: 0, maxLatErr: 0, sumLatErr: 0, maxSpeed: 0, sumSpeed: 0,
  minSpeedAfter10s: Infinity, wrecks: 0, maxLatG: 0, hairpinMinSpeed: Infinity,
};
const steps = Math.round(seconds / DT);
const t0 = Date.now();
for (let i = 0; i < steps; i++) {
  const shift = road.update(sCar);
  if (shift) {
    car.x -= shift.dx;
    car.z -= shift.dz;
  }
  sCar = road.nearestS(car.x, car.z, sCar).s;
  const p = road.at(sCar);
  const lat = road.lateralOf(sCar, car.x, car.z);
  const crown = Math.abs(lat) < HALF_PAVED ? CROWN * (1 - (lat / HALF_PAVED) ** 2) : 0;
  car.groundY = road.surfaceAt(sCar, lat) + crown;
  car.groundVy = p.grade * Math.max(0, car.vx);
  car.pitchSlope = Math.atan(p.grade);
  const cmd = pilot.drive(DT, {
    s: sCar, x: car.x, z: car.z, yaw: car.yaw, speed: car.speed, leadGap: null, leadSpeed: null,
  });
  car.step(DT, cmd);

  st.frames++;
  const err = Math.abs(lat - pilot.lane);
  st.maxLatErr = Math.max(st.maxLatErr, err);
  st.sumLatErr += err;
  if (Math.abs(lat) > HALF_PAVED - 0.9) st.offRoad++;
  st.maxSpeed = Math.max(st.maxSpeed, car.speed);
  st.sumSpeed += car.speed;
  if (i * DT > 10) st.minSpeedAfter10s = Math.min(st.minSpeedAfter10s, car.speed);
  const latG = Math.abs(p.kappa) * car.speed * car.speed / 9.81;
  if (latG > st.maxLatG) {
    st.maxLatG = latG;
    st.maxLatGAt = { s: Math.round(sCar), kmh: +(car.speed * 3.6).toFixed(1), R: Math.round(1 / Math.abs(p.kappa)),
      limitKmh: +(pilot.targetSpeed * 3.6).toFixed(1) };
  }
  if (Math.abs(p.kappa) > 1 / 30) st.hairpinMinSpeed = Math.min(st.hairpinMinSpeed, car.speed);
  if (car.wrecked) {
    st.wrecks++;
    break;
  }
}

const km = sCar / 1000;
const report = {
  seed, seconds, km: +km.toFixed(2), wallMs: Date.now() - t0,
  avgKmh: +((st.sumSpeed / st.frames) * 3.6).toFixed(1),
  maxKmh: +(st.maxSpeed * 3.6).toFixed(1),
  minKmhAfter10s: +(st.minSpeedAfter10s * 3.6).toFixed(1),
  hairpinMinKmh: Number.isFinite(st.hairpinMinSpeed) ? +(st.hairpinMinSpeed * 3.6).toFixed(1) : null,
  laneErrAvg: +(st.sumLatErr / st.frames).toFixed(2),
  laneErrMax: +st.maxLatErr.toFixed(2),
  offRoadFrames: st.offRoad,
  maxLatG: +st.maxLatG.toFixed(2),
  maxLatGAt: st.maxLatGAt,
  wrecks: st.wrecks,
  road: road.stats,
};
console.log(JSON.stringify(report, null, 2));

const fails = [];
if (st.offRoad > 0) fails.push(`left the asphalt for ${st.offRoad} frames`);
if (st.wrecks) fails.push('wrecked');
if (st.maxLatErr > 1.4) fails.push(`lane error reached ${st.maxLatErr.toFixed(2)} m`);
if (seconds > 20 && st.minSpeedAfter10s < 3) fails.push('stalled');
if (fails.length) {
  console.error('FAIL: ' + fails.join('; '));
  process.exit(1);
}
console.log('OK');
