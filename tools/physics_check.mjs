// Headless physics harness: runs the track + car + autopilot without a renderer
// so the driving model and the AI can be validated from the command line.
// Usage: node tools/physics_check.mjs [seconds] [--verbose]

import { Track } from '../src/core/track.js';
import { Car } from '../src/core/car.js';
import { Autopilot } from '../src/core/autopilot.js';

const DT = 1 / 120;
const ROAD_HALF = 7.0;

const seconds = Number(process.argv[2]) || 120;
const verbose = process.argv.includes('--verbose');

const track = new Track();
const car = new Car();
const pilot = new Autopilot(track);

const start = track.at(0);
car.reset(start.x, start.z, start.theta);

let sCar = 0;
let travelled = 0;
let maxLateral = 0;
let offRoadFrames = 0;
let frames = 0;
let minSpeed = Infinity;
let maxSpeed = 0;
let sumSpeed = 0;
let maxSlip = 0;
let maxLateralG = 0;
let stalls = 0;
let sPrev = 0;

const steps = Math.round(seconds / DT);
const reportEvery = Math.round(15 / DT);
const samples = [];

for (let i = 0; i < steps; i++) {
  track.update(sCar);

  const near = track.nearestS(car.x, car.z, sCar);
  sCar = near.s;
  // Signed lateral offset from the centreline, for the off-road check.
  const p = track.at(sCar);
  const nx = -Math.sin(p.theta);
  const nz = Math.cos(p.theta);
  const lateral = (car.x - p.x) * nx + (car.z - p.z) * nz;

  const cmd = pilot.drive(DT, {
    s: sCar, x: car.x, z: car.z, yaw: car.yaw, speed: car.speed,
  });

  car.step(DT, cmd);

  const ds = sCar - sPrev;
  if (ds > 0) travelled += ds;
  if (car.speed < 1.0) stalls++;
  sPrev = sCar;

  maxLateral = Math.max(maxLateral, Math.abs(lateral));
  if (Math.abs(lateral) > ROAD_HALF) offRoadFrames++;
  minSpeed = Math.min(minSpeed, car.speed);
  maxSpeed = Math.max(maxSpeed, car.speed);
  sumSpeed += car.speed;
  maxSlip = Math.max(maxSlip, car.slipAngle);
  maxLateralG = Math.max(maxLateralG, Math.abs(car.lateralG));
  frames++;

  if (verbose && i % reportEvery === 0) {
    samples.push({
      t: +(i * DT).toFixed(1),
      s: Math.round(sCar),
      kmh: Math.round(car.speedKmh),
      lat: +lateral.toFixed(2),
      steer: +car.steer.toFixed(3),
      kappa: +p.kappa.toFixed(4),
    });
  }
}

const avgSpeed = sumSpeed / frames;
const result = {
  seconds,
  travelled: Math.round(travelled),
  avgKmh: Math.round(avgSpeed * 3.6),
  maxKmh: Math.round(maxSpeed * 3.6),
  minKmh: Math.round(minSpeed * 3.6),
  maxLateralOffset: +maxLateral.toFixed(2),
  offRoadPercent: +((offRoadFrames / frames) * 100).toFixed(2),
  stallPercent: +((stalls / frames) * 100).toFixed(2),
  maxSlipDeg: +((maxSlip * 180) / Math.PI).toFixed(1),
  maxLateralG: +maxLateralG.toFixed(2),
  rebases: track.rebases,
  samples: track.samples.size,
};

if (verbose) result.trace = samples;
console.log(JSON.stringify(result, null, 2));

const problems = [];
if (travelled < seconds * 8) problems.push(`only travelled ${Math.round(travelled)} m`);
if (offRoadFrames / frames > 0.05) {
  problems.push(`off road ${((offRoadFrames / frames) * 100).toFixed(1)}% of the time`);
}
if (stalls / frames > 0.05) problems.push(`stalled ${((stalls / frames) * 100).toFixed(1)}% of the time`);
if (maxSlip > 0.55) problems.push(`tyre slip reached ${((maxSlip * 180) / Math.PI).toFixed(0)} deg, car is spinning`);
if (track.samples.size > 2400) problems.push(`track cache grew to ${track.samples.size} samples`);

if (problems.length) {
  console.error('\nFAIL:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.error('\nOK: autopilot holds the road for ' + seconds + ' s');
