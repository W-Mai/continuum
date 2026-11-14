// Sound: a quiet bed under the drive, made in the browser with Web Audio and
// no recordings. The car's hover hum and its turbine's whine rise with the
// speed, the tyres rumble while the wheels are down, wind grows past the lens;
// under it each world has its own air (world/worlds.js `sound`): gusts in the
// mountains, surf on the coast, a low hum over the city, rumble from the
// lava, the deep sea's muffled drone, the thin air over the cloud, next to
// nothing in space, in the Upside Down a low hum and, after each flash of
// lightning, the thunder. Two worlds cross-fade over a border like their
// light. In a tunnel the world outside goes dull and the car rings in the bore.
//
// The graph is built on any audio context, so the same sound can be rendered
// offline for a listen (Sound.render). Off by default in the page; the
// speaker in the bar turns it on, and the choice is remembered.

import { WORLDS } from '../world/worlds.js';

const NONE = { air: [600, 0.5, 0], swell: [10, 0], drone: [0, 0], muffle: 18000, echo: 0 };
const RECIPES = WORLDS.map((w) => ({ ...NONE, ...(w.sound || {}) }));
const TAU = 0.12;          // s, how fast a parameter follows the drive
const AIR = 3;             // the worlds' air against the car, overall
const clamp01 = (v) => Math.min(1, Math.max(0, v));

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

export class Sound {
  constructor(ctx) {
    this.ctx = ctx;
    const noise = noiseBuffer(ctx);
    this.noise = noise;
    this.strikes = 0;
    const loop = () => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      s.loopStart = Math.random() * 3;
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
    this.master.connect(comp).connect(ctx.destination);
    // Everything that is out in the world, the car included, goes through the
    // medium: water muffles it, so does the rock round a bore.
    this.medium = filter('lowpass', 18000, 0.5);
    this.medium.connect(this.master);

    // The car.
    this.car = gain(1);
    this.car.connect(this.medium);
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
    // The bore's ring.
    const hall = ctx.createConvolver();
    hall.buffer = hallBuffer(ctx);
    this.echo = gain(0);
    this.car.connect(hall).connect(this.echo).connect(this.master);

    // Wind past the lens.
    this.wind = filter('bandpass', 500, 0.6);
    this.windGain = gain(0);
    loop().connect(this.wind).connect(this.windGain).connect(this.medium);

    // The air of the world: two beds, one per world of the blend.
    this.air = filter('lowpass', 18000, 0.5);
    this.air.connect(this.medium);
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
  }

  // Thunder, at audio time t: a roll of low noise that comes up fast and dies
  // away over a couple of seconds, duller the longer it takes to arrive.
  _rumble(t, far = 0.5) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random() * 3;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420 - 260 * far;
    lp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1.5 * (1 - 0.4 * far), t + 0.1);
    g.gain.setTargetAtTime(0, t + 0.15, 0.7 + far);
    src.connect(lp).connect(g).connect(this.medium);
    src.start(t, src.loopStart);
    src.stop(t + 6);
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

  /**
   * One step of the drive, at audio time t (the context's own clock if left
   * out). s: { speed m/s, throttle 0..1, lift 0..1 (wheels folded), a, b,
   * blend (the two worlds and how far), inside 0..1 (the lens in a bore),
   * distance (lens to car, m), on 0..1 }.
   */
  update(s, t = this.ctx.currentTime) {
    const v = clamp01(s.speed / 45);
    this._to(this.master.gain, 1.6 * s.on, t, 0.4);
    // A flash of lightning: its thunder a moment after.
    if (s.strikes !== undefined && s.strikes > this.strikes) {
      if (this.strikes > 0 || s.strikes === 1) this._rumble(t + 0.3 + Math.random() * 1.1, Math.random());
      this.strikes = s.strikes;
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
    this._to(this.tyreGain.gain, 0.14 * v * (1 - s.lift), t);
    // Quieter to a lens far off, but never gone: the sound stays with the car.
    this._to(this.car.gain, Math.min(1, Math.max(0.25, 14 / (s.distance + 4))), t, 0.3);
    // Wind past the lens.
    this._to(this.wind.frequency, 320 + 1300 * v, t);
    this._to(this.windGain.gain, 0.01 + 0.2 * v * v, t);
    // The worlds' air, cross-faded; a bed takes a new world while it is silent.
    const want = new Map([[s.a, 1 - s.blend]]);
    want.set(s.b, (want.get(s.b) || 0) + s.blend);
    for (const [w, k] of want) {
      if (k > 0.001 && !this.beds.some((b) => b.world === w)) {
        const free = this.beds.find((b) => !want.has(b.world) || (want.get(b.world) || 0) < 0.001);
        if (free) this._assign(free, w, t);
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
    // In a bore the world outside goes dull and the car rings.
    this._to(this.air.frequency, 18000 * (1 - s.inside) + 500 * s.inside, t, 0.25);
    this._to(this.medium.frequency, muffle, t, 0.5);
    this._to(this.echo.gain, 0.5 * Math.max(s.inside, echo), t, 0.3);
  }

  // The drive's state as the sound wants it, read off the game.
  static state(game, on = 1) {
    const L = game._lookAt;
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
      on,
    };
  }
}
