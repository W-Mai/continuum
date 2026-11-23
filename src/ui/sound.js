// Sound: a quiet bed under the drive, made in the browser with Web Audio and
// no recordings. The car's hover hum and its turbine's whine rise with the
// speed, the tyres rumble while the wheels are down, wind grows past the lens;
// under it each world has its own air (world/worlds.js `sound`): gusts in the
// mountains, surf on the coast, a low hum over the city, rumble from the
// lava, the deep sea's muffled drone, the thin air over the cloud, next to
// nothing in space, in the Upside Down a low hum and, after each flash of
// lightning, the thunder, and, as the world turns over, a sweep of noise with
// a low swell under it. Two worlds cross-fade over a border like their
// light. In a tunnel the world outside goes dull and the car rings in the bore.
//
// What happens on the ground and between cars sounds too. Off the road the
// ground has a voice of its own, by the world it is in: grass hisses, sand is
// duller, gravel has single stones cracking in it. Tyres that slide past 6
// degrees squeal, with a tremble of 6 Hz in it. A hit sounds by what was hit
// (a trunk, a wall, a car, an animal) and how hard. A car that goes by within
// 8 m of the lens sweeps down in pitch as it passes, and up to 3 cars within
// 60 m hum, each louder the nearer it is. What is not the car itself (a hit,
// a car going by, another car's hum) is put to the left or right of the
// centre by where it lies from the lens.
//
// The graph is built on any audio context, so the same sound can be rendered
// offline for a listen (sounddemo=1 in the address, tools/sound_demo.mjs). Off
// by default in the page; the speaker in the bar turns it on, and the choice
// is remembered. Three levels from the settings panel (setVolume) sit in the
// graph: the whole sound, the car's (hum, whine, tyres, the ground under it,
// hits, landings) and the ambience (the worlds' air, the wind past the lens,
// thunder, the sweep of the world turning over, the other cars); each is 1 as
// the sound has always been. A limiter ends the graph, so that nothing leaves
// it above -1 dBFS however the levels are set.

import { WORLDS } from '../world/worlds.js';

const NONE = { air: [600, 0.5, 0], swell: [10, 0], drone: [0, 0], muffle: 18000, echo: 0, drip: 0 };
const RECIPES = WORLDS.map((w) => ({ ...NONE, ...(w.sound || {}) }));
const TAU = 0.12;          // s, how fast a parameter follows the drive
const AIR = 3;             // the worlds' air against the car, overall
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// What the land off the road is made of in each world, which says what the car
// makes of it: grass hisses between 1 and 4 kHz, sand is duller (300 Hz to
// 1.5 kHz), gravel is a dull hiss with single stones cracking in it.
const GROUND_KINDS = ['grass', 'sand', 'gravel'];
const GROUNDS = {
  alpine: 'gravel', hills: 'grass', river: 'grass', coast: 'sand', desert: 'sand', city: 'grass',
  cavern: 'gravel', inferno: 'gravel', abyss: 'sand', heaven: 'grass', space: 'gravel', upside: 'gravel',
};
const GROUND_OF = WORLDS.map((w) => Math.max(0, GROUND_KINDS.indexOf(GROUNDS[w.id])));
// Tyres that slide: they begin to squeal at 6 degrees of slip and have the whole of
// their voice 4 degrees on; `slide` m/s of sideways speed is all of the level.
const SQUEAL = { from: 0.1047, span: 0.07, slide: 5, level: 1.7 };
const NEAR = 60;           // m, how far off the hum of another car is heard
const VOICES = 3;          // cars that hum at once
const MEET = 8;            // m, how near to the lens a car goes by to be heard going by
const ABEAM = 0.3;         // s, how long before the nearest point a car going by is taken up
const TREMBLE = { level: 0.22, hz: 28 };   // the squeal's tremble: how far its level swings (of 1) and its band (Hz)
const HUM = 0.05;          // the level of the hum of a car at the lens
const PASS = { centre: 600, q: 1.6, top: 1200, level: 0.65, speed: 6 };   // a car going by: its band's centre (Hz) and Q, the low-pass over it (Hz), its level, the speed (m/s) two have to close at to be heard
const GROUND = { grass: 0.32, sand: 0.4, gravel: 0.12, stones: 0.5 };   // the level of each ground, off the road at 30 m/s
const LIMITER = { threshold: -6, ratio: 12, attack: 0.002, release: 0.15 };   // dB, to 1, s, s
const WIDTH = 0.85;        // how far to a side a sound is put (1 would be all in one ear)

// A small generator, so that the same drive makes the same sound.
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Where a point lies as the lens hears it, -1 (left) to 1 (right): how much of
// the way to it is along the lens's right.
function panOf(dx, dy, dz, right) {
  const d = Math.hypot(dx, dy, dz);
  return d < 1e-3 ? 0 : (WIDTH * (dx * right[0] + dy * right[1] + dz * right[2])) / d;
}

// The lens's right, off its turn (a lens that has been rolled over has its
// right on the other hand).
const lensRight = (q) => [1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.y + q.w * q.z), 2 * (q.x * q.z - q.w * q.y)];

// The shapes of a car going by, over half a second: how loud (up and down
// again) and how high (from 1 to 0, the drop quickest at the nearest point).
const POINTS = 24;
const SWELL = Float32Array.from({ length: POINTS }, (_, i) => Math.sin((Math.PI * i) / (POINTS - 1)) ** 2);
const SWEEP = Float32Array.from({ length: POINTS }, (_, i) => 0.5 - 0.5 * Math.tanh((i / (POINTS - 1) - 0.5) * 7));

// Four seconds of soft noise, looped: white noise through a gentle low-pass,
// close to pink, so wind and surf are not a hiss.
function noiseBuffer(ctx) {
  const n = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 0x2545f491;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const w = seed / 2147483648 - 1;
    // Paul Kellet's economy pink filter.
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
  }
  return buf;
}

// A short, dark hall: decaying noise, for the ring of a bore.
function hallBuffer(ctx, seconds = 1.6) {
  const n = Math.round(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let seed = 0x9e3779b9 + c * 7919;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const w = seed / 2147483648 - 1;
      lp += (w - lp) * 0.35;
      d[i] = lp * Math.exp((-4.5 * i) / n);
    }
  }
  return buf;
}

// Stones: a loop of small clicks, 40 to the second, each a few milliseconds of
// bright noise that dies at once. Played faster or slower it has more or fewer.
function crackleBuffer(ctx, perSecond = 40, seconds = 2) {
  const rate = ctx.sampleRate;
  const n = Math.round(rate * seconds);
  const buf = ctx.createBuffer(1, n, rate);
  const d = buf.getChannelData(0);
  const rand = lcg(0x3c6ef372);
  const count = Math.round(perSecond * seconds);
  for (let k = 0; k < count; k++) {
    // One in each 1/40 s, somewhere in it: the same number every second.
    const at = Math.floor(((k + rand()) / count) * n);
    const amp = (0.5 + 0.5 * rand()) * (rand() < 0.5 ? -1 : 1);
    const len = Math.max(4, Math.round(rate * (0.002 + 0.004 * rand())));
    let lp = 0;
    for (let i = 0; i < len && at + i < n; i++) {
      lp += (rand() * 2 - 1 - lp) * 0.7;
      d[at + i] += amp * lp * Math.exp((-4 * i) / len);
    }
  }
  return buf;
}

export class Sound {
  constructor(ctx) {
    this.ctx = ctx;
    // Where the noise loops start and where a hit's noise comes in: a fixed
    // sequence, so that a drive is the same sound each time it is rendered.
    this.rand = lcg(0x2545f491);
    const noise = noiseBuffer(ctx);
    this.noise = noise;
    this.strikes = 0;
    this.lands = 0;
    this.bumps = 0;
    this.offSince = null;     // when the sound was turned off, and how long ago that is
    this.offFor = 0;
    this.seen = new Map();     // the cars near the lens, as they were at the last step
    const loop = () => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      s.loopStart = this.rand() * 3;
      s.start(0, s.loopStart);
      return s;
    };
    const gain = (v = 0) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const filter = (type, f, q = 0.7) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    const osc = (type, f) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.start();
      return o;
    };

    this.master = gain(0);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    // The last of the graph: a limiter, 12 to 1 above -6 dB, so that however
    // the layers add up and however the levels are set nothing leaves it loud
    // enough to clip. A compressor node lifts all it passes by a gain of its
    // own (its gain at full scale, taken the other way round, to the 0.6), which
    // the trim after it takes off again: under -6 dB the limiter changes nothing.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = LIMITER.threshold;
    this.limiter.ratio.value = LIMITER.ratio;
    this.limiter.knee.value = 0;
    this.limiter.attack.value = LIMITER.attack;
    this.limiter.release.value = LIMITER.release;
    this.trim = gain(10 ** ((0.6 * (LIMITER.threshold - LIMITER.threshold / LIMITER.ratio)) / 20));
    this.master.connect(comp).connect(this.limiter).connect(this.trim).connect(ctx.destination);
    // Everything that is out in the world, the car included, goes through the
    // medium: water muffles it, so does the rock round a bore.
    this.medium = filter('lowpass', 18000, 0.5);
    this.medium.connect(this.master);
    // What is the world's own goes through the ambience level on its way in.
    this.ambientBus = gain(1);
    this.ambientBus.connect(this.medium);
    this.volume = { master: 1, car: 1, ambient: 1 };

    // The car.
    this.car = gain(1);
    this.carBus = gain(1);
    this.car.connect(this.carBus);
    this.carBus.connect(this.medium);
    this.hum = [osc('sine', 52), osc('triangle', 104.5)];
    this.humGain = gain(0);
    const humTone = filter('lowpass', 700, 0.6);
    this.hum[0].connect(this.humGain);
    const second = gain(0.35);
    this.hum[1].connect(second).connect(this.humGain);
    this.humGain.connect(humTone).connect(this.car);
    this.whine = osc('sawtooth', 220);
    this.whineBand = filter('bandpass', 220, 9);
    this.whineGain = gain(0);
    this.whine.connect(this.whineBand).connect(this.whineGain).connect(this.car);
    this.tyres = filter('lowpass', 260, 0.8);
    this.tyreGain = gain(0);
    loop().connect(this.tyres).connect(this.tyreGain).connect(this.car);
    // Tyres that slide: a narrow band of noise between 600 and 1100 Hz with a
    // tremble of 6 Hz in it, both its level and where the band stands.
    this.squealBand = filter('bandpass', 800, 14);
    this.squealSwing = gain(0.78);
    this.squealGain = gain(0);
    loop().connect(this.squealBand).connect(this.squealSwing).connect(this.squealGain).connect(this.car);
    this.tremble = osc('sine', 6);
    this.trembleLevel = gain(0);
    this.trembleBand = gain(0);
    this.tremble.connect(this.trembleLevel).connect(this.squealSwing.gain);
    this.tremble.connect(this.trembleBand).connect(this.squealBand.frequency);
    this.calm = false;
    // The ground under the car when it is off the road: each of the three
    // kinds on its own gain, whichever the world under the car wants.
    this.surface = gain(1);
    this.surface.connect(this.car);
    const bed = (lo, hi) => {
      const level = gain(0);
      loop().connect(filter('highpass', lo, 0.7)).connect(filter('lowpass', hi, 0.7)).connect(level).connect(this.surface);
      return level;
    };
    this.grass = bed(1000, 4000);
    this.sand = bed(300, 1500);
    this.gravel = bed(250, 2800);
    this.stones = ctx.createBufferSource();
    this.stones.buffer = crackleBuffer(ctx);
    this.stones.loop = true;
    this.stones.start();
    this.stonesGain = gain(0);
    this.stones.connect(filter('highpass', 900, 0.7)).connect(this.stonesGain).connect(this.surface);
    // The bore's ring.
    const hall = ctx.createConvolver();
    hall.buffer = hallBuffer(ctx);
    this.echo = gain(0);
    this.carBus.connect(hall).connect(this.echo).connect(this.master);

    // Wind past the lens.
    this.wind = filter('bandpass', 500, 0.6);
    this.windGain = gain(0);
    loop().connect(this.wind).connect(this.windGain).connect(this.ambientBus);

    // The world turning over (render/turn.js): noise through a band that
    // sweeps with the angle, and a low swell under it.
    this.turnBand = filter('bandpass', 260, 1.4);
    this.turnGain = gain(0);
    loop().connect(this.turnBand).connect(this.turnGain).connect(this.ambientBus);
    this.sub = osc('sine', 34);
    this.subGain = gain(0);
    this.sub.connect(this.subGain).connect(this.ambientBus);

    // The air of the world: two beds, one per world of the blend.
    this.air = filter('lowpass', 18000, 0.5);
    this.air.connect(this.ambientBus);
    this.beds = [0, 1].map(() => {
      const band = filter('bandpass', 600, 0.5);
      const level = gain(0);
      const swell = gain(1);
      const lfo = osc('sine', 0.1);
      const depth = gain(0);
      lfo.connect(depth).connect(swell.gain);
      loop().connect(band).connect(level).connect(swell).connect(this.air);
      const drone = [osc('sine', 60), osc('sine', 90.4)];
      const droneGain = gain(0);
      drone[0].connect(droneGain);
      drone[1].connect(droneGain);
      droneGain.connect(this.air);
      return { world: -1, band, level, swell, lfo, depth, drone, droneGain };
    });

    // The other cars near the lens: a low hum for each of up to VOICES of them,
    // each on a voice of its own with its own place from left to right.
    this.voices = Array.from({ length: VOICES }, () => {
      const tone = [osc('sine', 60), osc('triangle', 120)];
      const second = gain(0.35);
      const body = filter('lowpass', 380, 0.6);
      const level = gain(0);
      const place = this._panner();
      tone[0].connect(body);
      tone[1].connect(second).connect(body);
      body.connect(level).connect(place).connect(this.ambientBus);
      return { id: -1, tone, level, place, gone: 0 };
    });
    this.setCalm(false);
  }

  // A node that puts what goes through it to the left or right (pan, -1 to 1),
  // or leaves it where it is on a platform that has none.
  _panner() {
    if (this.ctx.createStereoPanner) return this.ctx.createStereoPanner();
    const none = { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} };
    const g = this.ctx.createGain();
    g.pan = none;
    return g;
  }

  // Whether the sound is to keep the tremble out of what it makes: the squeal
  // of tyres then holds steady, as it does for a visitor who has asked for less
  // motion (the same choice as the lens's shake).
  setCalm(calm) {
    this.calm = !!calm;
    const t = this.ctx.currentTime;
    this._to(this.trembleLevel.gain, calm ? 0 : TREMBLE.level, t, 0.05);
    this._to(this.trembleBand.gain, calm ? 0 : TREMBLE.hz, t, 0.05);
  }

  // The levels of the settings, each 1 as the sound has always been: the whole
  // sound (taken up by update), the car, and the world's air and wind. Eased
  // over a moment so a slider can be dragged without a click.
  setVolume({ master = 1, car = 1, ambient = 1 } = {}) {
    this.volume.master = master;
    this.volume.car = car;
    this.volume.ambient = ambient;
    const t = this.ctx.currentTime;
    this._to(this.carBus.gain, car, t, 0.05);
    this._to(this.ambientBus.gain, ambient, t, 0.05);
  }

  // A landing, at audio time t: the body coming down on its springs, a low
  // thump that drops in pitch, and the grit of the tyres under it. force 0..1.
  _thud(t, force) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95 + 40 * force, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35 + 0.9 * force, t + 0.015);
    g.gain.setTargetAtTime(0, t + 0.03, 0.09);
    o.connect(g).connect(this.car);
    o.start(t);
    o.stop(t + 0.7);
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500 + 900 * force;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.25 + 0.7 * force, t + 0.01);
    ng.gain.setTargetAtTime(0, t + 0.02, 0.07);
    n.connect(lp).connect(ng).connect(this.car);
    n.start(t, this.rand() * 3);
    n.stop(t + 0.6);
  }

  // A drop falling into water, at audio time t, level 0 to 1 (how much of the world the lens is in
  // is the cavern's): a short bright tone that bends up as it dies, a tick at its start, and a hall
  // of its own, long and dark, to answer it. n is the drop's number, which sets its pitch. A drop is about as
  // loud as the loudest of the drive's own sound (the master stage multiplies everything by 1.6), so that the
  // minute does not clip.
  _drip(t, level, n) {
    const ctx = this.ctx;
    if (!this.dripBus) {
      const bus = ctx.createGain();
      bus.connect(this.ambientBus);
      const hall = ctx.createConvolver();
      hall.buffer = hallBuffer(ctx, 2.8);
      const wet = ctx.createGain();
      wet.gain.value = 1.8;
      bus.connect(hall).connect(wet).connect(this.ambientBus);
      this.dripBus = bus;
    }
    const f = 1500 + 1000 * ((n * 0.61803) % 1);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 1.7, t + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12 * level, t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.006, 0.035);
    o.connect(g).connect(this.dripBus);
    o.start(t);
    o.stop(t + 0.5);
    const tick = ctx.createOscillator();
    tick.type = 'triangle';
    tick.frequency.setValueAtTime(f * 2.4, t);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.05 * level, t);
    tg.gain.setTargetAtTime(0, t + 0.001, 0.004);
    tick.connect(tg).connect(this.dripBus);
    tick.start(t);
    tick.stop(t + 0.05);
  }

  // Thunder, at audio time t: a roll of low noise that comes up fast and dies
  // away over a couple of seconds, duller the longer it takes to arrive.
  _rumble(t, far = 0.5) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = this.rand() * 3;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420 - 260 * far;
    lp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1.5 * (1 - 0.4 * far), t + 0.1);
    g.gain.setTargetAtTime(0, t + 0.15, 0.7 + far);
    src.connect(lp).connect(g).connect(this.ambientBus);
    src.start(t, src.loopStart);
    src.stop(t + 6);
  }

  // A hit, at audio time t: what the car met (tree, wall, car, or soft for an
  // animal or the water), how hard (level 0..1) and from where (pan -1..1). A
  // trunk is one dull blow, 80 Hz held for 0.15 s and dying over as long again,
  // with a low-passed knock in it; a wall or a car goes on longer and is brighter,
  // with a ring in it (the car's of metal); a soft one is a rounded thump.
  _knock(t, kind, level, pan) {
    const ctx = this.ctx;
    const out = this._panner();
    out.pan.value = pan;
    out.connect(this.car);
    // A tone that is held for a moment and dies away, and noise through a filter that does the same.
    const tone = (f0, f1, peak, decay, hold = 0, type = 'sine') => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + 0.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.004);
      g.gain.setTargetAtTime(0, t + 0.004 + hold, decay);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.004 + hold + decay * 9);
    };
    const burst = (type, f, peak, decay, hold = 0, q = 0.7) => {
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      n.loop = true;
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.003);
      g.gain.setTargetAtTime(0, t + 0.003 + hold, decay);
      n.connect(b).connect(g).connect(out);
      n.start(t, this.rand() * 3);
      n.stop(t + 0.003 + hold + decay * 9);
    };
    if (kind === 'tree') {
      tone(80, 80, 0.25 + 1.2 * level, 0.05, 0.15);
      burst('lowpass', 450, 0.25 + 0.55 * level, 0.05, 0.05);
    } else if (kind === 'wall' || kind === 'car') {
      tone(68, 52, 0.3 + 1.0 * level, 0.16, 0.05);
      tone(190, 190, 0.1 * level, 0.25);
      tone(330, 330, 0.07 * level, 0.2);
      burst('bandpass', 1100, 0.2 + 0.5 * level, 0.18);
      burst('highpass', 2500, 0.12 * level, 0.03);
      // Metal: the ring of a body that is hit.
      if (kind === 'car') for (const [f, k] of [[530, 1], [840, 0.8], [1370, 0.6], [2210, 0.45]]) tone(f, f, 0.1 * level * k, 0.12 / k, 0, 'triangle');
    } else {
      tone(140, 80, 0.2 + 0.5 * level, 0.06, 0.02);
      burst('lowpass', 700, 0.1 + 0.2 * level, 0.04);
    }
  }

  // A car going by, half a second of noise, from t: it is loudest at the middle
  // (the nearest point), and its band goes down from 1.6 to 0.7 of its centre
  // the more quickly the two close, quickest at the middle. level 0..1;
  // closing m/s; pans: where it lies (-1..1) at the start, the middle and the end.
  _pass(t, level, closing, pans) {
    const ctx = this.ctx;
    const k = clamp01(closing / 40);
    const hi = PASS.centre * (1 + 0.6 * k);
    const lo = PASS.centre * (1 - 0.3 * k);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = PASS.q;
    band.frequency.value = hi;
    band.frequency.setValueCurveAtTime(SWEEP.map((x) => lo + (hi - lo) * x), t, 0.5);
    // Under 1.2 kHz: a car going by is a low rush, not a hiss.
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = PASS.top;
    low.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueCurveAtTime(SWELL.map((x) => PASS.level * level * x), t, 0.5);
    const place = this._panner();
    place.pan.setValueAtTime(pans[0], t);
    place.pan.linearRampToValueAtTime(pans[1], t + 0.25);
    place.pan.linearRampToValueAtTime(pans[2], t + 0.5);
    src.connect(band).connect(low).connect(g).connect(place).connect(this.ambientBus);
    src.start(t, this.rand() * 3);
    src.stop(t + 0.52);
  }

  // One step of the drive while the audio clock stands: nothing is scheduled (the
  // clock would hold it all for when it goes on), but what has happened is
  // noted, so that it is not heard when the sound comes back.
  skip(s) {
    for (const key of ['strikes', 'lands', 'bumps', 'drips']) if (s[key] !== undefined) this[key] = s[key];
    this.seen.clear();
  }

  // Ease a parameter toward v from time t.
  _to(param, v, t, tau = TAU) {
    param.setTargetAtTime(v, t, tau);
  }

  // Put world w in the bed that is silent now.
  _assign(bed, w, t) {
    const r = RECIPES[w];
    bed.world = w;
    bed.band.frequency.setValueAtTime(r.air[0], t);
    bed.band.Q.setValueAtTime(r.air[1], t);
    bed.lfo.frequency.setValueAtTime(1 / r.swell[0], t);
    bed.depth.gain.setValueAtTime(r.swell[1] * 0.5, t);
    bed.swell.gain.setValueAtTime(1 - r.swell[1] * 0.5, t);
    bed.drone[0].frequency.setValueAtTime(r.drone[0] || 60, t);
    bed.drone[1].frequency.setValueAtTime((r.drone[0] || 60) * 1.505, t);
  }

  // The ground under the car when it is off the road and on the ground (not in
  // the air): the voice of what the world is made of there, louder the faster
  // the car goes. want: each world of the blend and its share.
  _ground(s, t, want) {
    const share = [0, 0, 0];
    let all = 0;
    for (const [w, k] of want) {
      share[GROUND_OF[w]] += k;
      all += k;
    }
    const u = clamp01(s.speed / 30);
    const rolling = (s.off || 0) * (1 - (s.air || 0)) * clamp01(s.speed / 3) * (0.3 + 0.7 * u) / Math.max(all, 1e-3);
    this._to(this.grass.gain, GROUND.grass * rolling * share[0], t, 0.12);
    this._to(this.sand.gain, GROUND.sand * rolling * share[1], t, 0.12);
    this._to(this.gravel.gain, GROUND.gravel * rolling * share[2], t, 0.12);
    this._to(this.stonesGain.gain, GROUND.stones * rolling * share[2], t, 0.12);
    // 20 to 60 stones a second, by the speed.
    this._to(this.stones.playbackRate, 0.5 + u, t, 0.2);
  }

  // The other cars near the lens, cars: [{ id, dx, dy, dz, speed }] (the way
  // from the lens to each, m, and how fast it goes), as the game's clock
  // s.time has them. Each hums on a voice of its own, as loud as it is near and
  // from the side it lies; one that is about to come within MEET of the lens is
  // heard going by, its sweep centred on the nearest point.
  _cars(s, t) {
    const cars = s.cars || [];
    const right = s.lens || [1, 0, 0];
    const now = s.time || 0;
    const live = new Set();
    for (const c of cars) {
      live.add(c.id);
      let was = this.seen.get(c.id);
      if (!was) {
        was = { dx: c.dx, dz: c.dz, time: now, met: false };
        this.seen.set(c.id, was);
      } else if (now > was.time && now - was.time < 0.25) {
        // How the car goes, from the lens: the way it was a step ago against the way it is.
        const dt = now - was.time;
        const vx = (c.dx - was.dx) / dt;
        const vz = (c.dz - was.dz) / dt;
        const closing = Math.hypot(vx, vz);
        // (Nothing goes by faster than the car can, so a lens cut to another place is no car going by.)
        if (!was.met && closing >= PASS.speed && closing < 120 && s.on > 0) {
          const ahead = -(c.dx * vx + c.dz * vz) / (closing * closing);
          if (ahead > 0 && ahead <= ABEAM) {
            const near = Math.hypot(c.dx + vx * ahead, c.dy, c.dz + vz * ahead);
            if (near < MEET) {
              was.met = true;
              // Half a second of it, the middle of it at the nearest point.
              const start = Math.max(0, ahead - 0.25);
              const at = (d) => panOf(c.dx + vx * (start + d), c.dy, c.dz + vz * (start + d), right);
              this._pass(t + start, (1 - 0.6 * (near / MEET)) * clamp01(closing / 35) ** 1.5, closing, [at(0), at(0.25), at(0.5)]);
            }
          }
        }
      }
      if (now > was.time) {
        was.dx = c.dx;
        was.dz = c.dz;
        was.time = now;
      }
    }
    for (const id of this.seen.keys()) if (!live.has(id)) this.seen.delete(id);
    // A car keeps its voice while it is near; a voice that has lost its car is
    // let go of once it has faded.
    for (const v of this.voices) {
      if (v.id === -1 || live.has(v.id)) continue;
      if (v.gone < 0) v.gone = t;
      if (t - v.gone > 0.6) {
        v.id = -1;
        v.gone = -1;
      }
      this._to(v.level.gain, 0, t, 0.15);
    }
    for (const c of cars) {
      let v = this.voices.find((x) => x.id === c.id);
      if (!v) {
        v = this.voices.find((x) => x.id === -1);
        if (!v) continue;
        v.id = c.id;
        v.gone = -1;
      }
      const k = clamp01(1 - Math.hypot(c.dx, c.dy, c.dz) / NEAR);
      // Each car has a pitch of its own, and goes higher with its speed.
      const f = 52 + 0.9 * c.speed + ((c.id * 7) % 11);
      this._to(v.tone[0].frequency, f, t);
      this._to(v.tone[1].frequency, f * 2.01, t);
      this._to(v.level.gain, HUM * k * k, t, 0.15);
      this._to(v.place.pan, panOf(c.dx, c.dy, c.dz, right), t, 0.1);
    }
  }

  /**
   * One step of the drive, at audio time t (the context's own clock if left
   * out). s: { speed m/s, throttle 0..1, lift 0..1 (wheels folded), a, b,
   * blend (the two worlds and how far), inside 0..1 (the lens in a bore),
   * drips (how many drops have fallen into water so far),
   * distance (lens to car, m), turn (rad/s the view is turning over at), roll
   * (rad, how far round it is), on 0..1 }.
   */
  update(s, t = this.ctx.currentTime) {
    const v = clamp01(s.speed / 45);
    this._to(this.master.gain, 1.6 * s.on * this.volume.master, t, 0.4);
    // How long it has been off: once the fade is over the page may stop the
    // audio clock (and start it again with the button).
    if (s.on > 0) this.offSince = null;
    else if (this.offSince === null) this.offSince = t;
    this.offFor = this.offSince === null ? 0 : t - this.offSince;
    // A flash of lightning: its thunder a moment after.
    if (s.strikes !== undefined && s.strikes > this.strikes) {
      if (this.strikes > 0 || s.strikes === 1) this._rumble(t + 0.3 + this.rand() * 1.1, this.rand());
      this.strikes = s.strikes;
    }
    // The car coming down from the air.
    if (s.lands !== undefined && s.lands > this.lands) {
      if (this.lands > 0 || s.lands === 1) this._thud(t, clamp01((s.landForce || 0) / 14));
      this.lands = s.lands;
    }
    // Something hit: by what it was, how hard, and from where it lies.
    if (s.bumps !== undefined && s.bumps > this.bumps) {
      if ((this.bumps > 0 || s.bumps === 1) && s.on > 0 && s.bump) {
        this._knock(t, s.bump.kind, clamp01(s.bump.speed / 25), s.bump.pan || 0);
      }
      this.bumps = s.bumps;
    }
    // The car: hum and whine with the speed, louder when it floats; tyres
    // only on the road. It is quieter to a lens far off.
    const f0 = 64 + 56 * v;
    this._to(this.hum[0].frequency, f0, t);
    this._to(this.hum[1].frequency, f0 * 2.01, t);
    this._to(this.humGain.gain, (0.045 + 0.05 * v) * (0.45 + 0.55 * s.lift), t);
    const fw = 170 + 560 * v;
    this._to(this.whine.frequency, fw, t);
    this._to(this.whineBand.frequency, fw, t);
    this._to(this.whineGain.gain, (0.012 + 0.045 * v * (0.5 + 0.5 * s.throttle)) * s.lift, t);
    this._to(this.tyres.frequency, 180 + 520 * v, t);
    this._to(this.tyreGain.gain, 0.14 * v * (1 - s.lift) * (1 - (s.air || 0)), t);
    this._to(this.squealGain.gain, Sound.squeal(s), t, 0.08);
    this._to(this.squealBand.frequency, 600 + 500 * clamp01(s.speed / 25), t, 0.15);
    // Quieter to a lens far off, but never gone: the sound stays with the car.
    this._to(this.car.gain, Math.min(1, Math.max(0.25, 14 / (s.distance + 4))), t, 0.3);
    // Wind past the lens.
    this._to(this.wind.frequency, 320 + 1300 * v, t);
    this._to(this.windGain.gain, 0.01 + 0.2 * v * v, t);
    // The world turning over: a sweep of noise that climbs as the view goes
    // on its side and falls as it comes over, as loud as the turn is quick,
    // with a low swell under it. Still, it is silent.
    const quick = clamp01(Math.abs(s.turn || 0) / 0.8);
    const side = Math.sin(s.roll || 0) ** 2;
    this._to(this.turnBand.frequency, 260 + 1500 * side, t, 0.1);
    this._to(this.turnGain.gain, 0.34 * quick * quick, t, 0.12);
    this._to(this.sub.frequency, 34 + 20 * quick, t, 0.15);
    this._to(this.subGain.gain, 0.12 * quick, t, 0.2);
    // The worlds' air, cross-faded; a bed takes a new world while it is silent.
    const want = new Map([[s.a, 1 - s.blend]]);
    want.set(s.b, (want.get(s.b) || 0) + s.blend);
    for (const [w, k] of want) {
      if (k > 0.001 && !this.beds.some((b) => b.world === w)) {
        const free = this.beds.find((b) => !want.has(b.world) || (want.get(b.world) || 0) < 0.001);
        if (free) this._assign(free, w, t);
      }
    }
    // A drop falling into water: the drip of a world that has them, as loud as that world is the lens's.
    if (s.drips !== undefined) {
      let drip = 0;
      for (const [w, k] of want) drip += k * RECIPES[w].drip;
      if (this.drips === undefined) this.drips = s.drips;
      else if (s.drips > this.drips) {
        if (drip > 0.01) this._drip(t, Math.min(1, drip), s.drips);
        this.drips = s.drips;
      }
    }
    let muffle = 0;
    let echo = 0;
    for (const bed of this.beds) {
      const k = want.get(bed.world) || 0;
      const r = RECIPES[Math.max(0, bed.world)];
      this._to(bed.level.gain, AIR * r.air[2] * k, t, 0.5);
      this._to(bed.droneGain.gain, AIR * r.drone[1] * k, t, 0.8);
      muffle += Math.log(r.muffle) * k;
      echo += r.echo * k;
    }
    const total = (want.get(s.a) || 0) + (s.a === s.b ? 0 : want.get(s.b) || 0);
    muffle = Math.exp(muffle / Math.max(total, 1e-3));
    // The ground off the road, and the other cars near the lens.
    this._ground(s, t, want);
    this._cars(s, t);
    // In a bore the world outside goes dull and the car rings.
    this._to(this.air.frequency, 18000 * (1 - s.inside) + 500 * s.inside, t, 0.25);
    this._to(this.medium.frequency, muffle, t, 0.5);
    this._to(this.echo.gain, 0.5 * Math.max(s.inside, echo), t, 0.3);
  }

  // How loud tyres squeal in a state: from 0 up to SQUEAL.level. They squeal
  // past 6 degrees of slip, as loud as they slide sideways; a car at a crawl
  // does not, and none does in the air.
  static squeal(s) {
    const slid = clamp01(((s.slip || 0) - SQUEAL.from) / SQUEAL.span);
    const moving = clamp01((s.speed - 3) / 4);
    return SQUEAL.level * slid * (0.3 + 0.7 * clamp01((s.slide || 0) / SQUEAL.slide)) * moving * (1 - (s.air || 0));
  }

  // The drive's state as the sound wants it, read off the game.
  static state(game, on = 1) {
    const L = game._wl || game._lookAt;
    const cam = game.camera.position;
    const car = game.car;
    return {
      speed: car.speed || 0,
      throttle: car.throttle || 0,
      lift: game.presentation.liftAmount || 0,
      a: Math.max(0, L.a),
      b: Math.max(0, L.b),
      blend: L.a === L.b ? 0 : L.t,
      inside: game.camInTunnel || 0,
      distance: Math.hypot(cam.x - car.x, cam.y - (car.y || 0), cam.z - car.z),
      strikes: game.upside.strikes,
      drips: game.cavern ? game.cavern.drips : 0,
      turn: game.upside.rate,
      roll: game.upside.roll,
      lands: game.lands,
      landForce: game._lastLand || 0,
      air: car.airborne ? 1 : 0,
      ...Sound.onGround(game),
      on,
    };
  }

  // What the tyres, the ground, what the car hits and the other cars give the
  // state, each of them left out where there is none: slip (rad, the tyres' slip
  // angle) and slide (m/s sideways), off (1 off the road's platform), bumps (how
  // many hits so far) and bump (the last of them: { kind: tree, wall, car or
  // soft, speed m/s, pan }), cars (the others near the lens, [{ id, dx, dy, dz,
  // speed }]), lens (its right, as a vector) and time (the game's clock, s).
  static onGround(game) {
    const car = game.car;
    const bump = game._lastBump;
    return {
      slip: car.slipAngle || 0,
      slide: (car.speed || 0) * Math.sin(Math.min(car.slipAngle || 0, 1.2)),
      off: game.offRoad ? 1 : 0,
      bumps: game.bumps || 0,
      bump: bump && {
        kind: bump.kind,
        speed: bump.speed,
        pan: Sound.pan(game, car.x + bump.ox, (car.y || 0) + 0.5, car.z + bump.oz),
      },
      cars: Sound.carsNear(game, game.camera.position),
      lens: lensRight(game.camera.quaternion),
      time: game.simTime,
    };
  }

  // Where a local point lies as the lens hears it, -1 (left) to 1 (right): for
  // whatever sounds from a place.
  static pan(game, x, y, z) {
    const c = game.camera.position;
    return panOf(x - c.x, y - c.y, z - c.z, lensRight(game.camera.quaternion));
  }

  // The (at most VOICES) cars of the road nearest the lens, within NEAR of it:
  // [{ id, dx, dy, dz, speed }], the way from the lens to each.
  static carsNear(game, lens) {
    const found = [];
    const road = game.road;
    for (const c of game.traffic.cars) {
      const p = road.at(c.s);
      if (!p) continue;
      const x = p.x - Math.sin(p.theta) * c.lane - lens.x;
      const z = p.z + Math.cos(p.theta) * c.lane - lens.z;
      const d = Math.hypot(x, z);
      if (d >= NEAR) continue;
      found.push({ id: c.id, dx: x, dy: p.y + 0.5 - lens.y, dz: z, speed: c.speed, d });
    }
    found.sort((a, b) => a.d - b.d);
    return found.slice(0, VOICES);
  }
}
