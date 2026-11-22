// What is measured of a rendered sound (tools/sound_demo.mjs): a 16-bit WAV in, numbers out.
// Bands are cut with fourth-order filters and measured as mean squares in dB (a sine of
// amplitude 1 is -3 dBFS); the shape of the spectrum, the clicks, the swell of a level and
// the way a sound lies between the two ears are measured from the same samples.

export function readWav(b64) {
  const buf = Buffer.from(b64, 'base64');
  const rate = buf.readUInt32LE(24);
  const ch = buf.readUInt16LE(22);
  const n = Math.floor((buf.length - 44) / (2 * ch));
  const data = Array.from({ length: ch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) data[c][i] = buf.readInt16LE(44 + (i * ch + c) * 2) / 32768;
  const mono = new Float32Array(n);
  for (let c = 0; c < ch; c++) for (let i = 0; i < n; i++) mono[i] += data[c][i] / ch;
  return { buf, rate, ch, n, data, mono };
}

// A second-order filter of the RBJ cookbook, over a whole signal; two of them in a row make a fourth-order one.
export function biquad(type, f, rate, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * f) / rate;
  const al = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const [b0, b1, b2] = type === 'hp' ? [(1 + c) / 2, -(1 + c), (1 + c) / 2] : [(1 - c) / 2, 1 - c, (1 - c) / 2];
  const a0 = 1 + al;
  const [a1, a2] = [(-2 * c) / a0, (1 - al) / a0];
  return (x) => {
    const y = new Float32Array(x.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = (b0 / a0) * x[i] + (b1 / a0) * x1 + (b2 / a0) * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x[i];
      y2 = y1;
      y1 = v;
      y[i] = v;
    }
    return y;
  };
}
const bands = new WeakMap();
// What of x lies between f0 and f1 Hz (fourth-order skirts), kept for the next time it is asked.
export function band(x, rate, f0, f1) {
  let kept = bands.get(x);
  if (!kept) bands.set(x, (kept = new Map()));
  const key = `${f0}-${f1}`;
  if (!kept.has(key)) {
    let y = x;
    if (f0 > 0) y = biquad('hp', f0, rate)(biquad('hp', f0, rate)(y));
    if (f1 < rate / 2) y = biquad('lp', f1, rate)(biquad('lp', f1, rate)(y));
    kept.set(key, y);
  }
  return kept.get(key);
}
// Mean square of x in seconds t0..t1, in dB (an amplitude of 1 is 0 dBFS, a full-scale sine is -3).
export function level(x, rate, t0, t1, f0 = 0, f1 = rate / 2) {
  const y = band(x, rate, f0, f1);
  const i0 = Math.max(0, Math.floor(t0 * rate));
  const i1 = Math.min(y.length, Math.floor(t1 * rate));
  let s = 0;
  for (let i = i0; i < i1; i++) s += y[i] * y[i];
  return 10 * Math.log10(Math.max(s / Math.max(1, i1 - i0), 1e-18));
}
// What x has that y has not: the same render with and without something in it (the renders are made the same
// way, so the rest cancels).
export function subtract(x, y) {
  return { ...x, data: x.data.map((d, c) => d.map((v, i) => v - y.data[c][i])), mono: x.mono.map((v, i) => v - y.mono[i]) };
}

export const peakOf = (w) => w.data.reduce((p, d) => d.reduce((q, v) => Math.max(q, Math.abs(v)), p), 0);

// Short-time mean square of x between f0 and f1, every hop s, over frames of win s: [{ t, p }], p linear.
export function track(x, rate, f0, f1, win = 0.025, hop = 0.01, from = 0, to = x.length / rate) {
  const y = band(x, rate, f0, f1);
  const n = Math.round(win * rate);
  const out = [];
  for (let t = from; t + win <= to; t += hop) {
    const i0 = Math.floor(t * rate);
    let s = 0;
    for (let i = i0; i < i0 + n; i++) s += y[i] * y[i];
    out.push({ t: t + win / 2, p: s / n });
  }
  return out;
}

// The strength of a swing at f Hz in a track (by how far above its mean it goes): the peak of the swings between f0 and f1 Hz and the median of them.
export function swing(tr, hop, f0 = 3, f1 = 12) {
  const v = tr.map((q) => q.p);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const spec = [];
  for (let f = f0; f <= f1; f += 0.25) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < v.length; i++) {
      const a = 2 * Math.PI * f * i * hop;
      re += (v[i] - mean) * Math.cos(a);
      im += (v[i] - mean) * Math.sin(a);
    }
    spec.push({ f, m: Math.hypot(re, im) / v.length / (mean || 1) });
  }
  const best = spec.reduce((a, b) => (b.m > a.m ? b : a));
  const sorted = spec.map((s) => s.m).sort((a, b) => a - b);
  return { hz: best.f, peak: best.m, median: sorted[Math.floor(sorted.length / 2)] };
}

// Where the spectrum of x between f0 and f1 has its weight, over t0..t1 (Hz).
export function centroid(x, rate, t0, t1, f0 = 200, f1 = 8000) {
  const N = 1024;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const k0 = Math.round((f0 * N) / rate);
  const k1 = Math.round((f1 * N) / rate);
  let p = 0;
  let c = 0;
  for (let s = Math.floor(t0 * rate); s + N <= Math.floor(t1 * rate); s += N / 2) {
    for (let i = 0; i < N; i++) {
      re[i] = x[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = k0; k <= k1; k++) {
      const q = re[k] * re[k] + im[k] * im[k];
      p += q;
      c += q * ((k * rate) / N);
    }
  }
  return p > 0 ? c / p : 0;
}
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = i + k + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

// Clicks a second in t0..t1: the peaks of what is above 2 kHz (rectified, smoothed over 0.7 ms) that stand 4 times over its median, 8 ms apart at least.
export function clicks(x, rate, t0, t1) {
  const y = band(x, rate, 2000, rate / 2);
  const k = 1 - Math.exp(-1 / (0.0007 * rate));
  const env = new Float32Array(y.length);
  let e = 0;
  for (let i = 0; i < y.length; i++) {
    e += (Math.abs(y[i]) - e) * k;
    env[i] = e;
  }
  const i0 = Math.floor(t0 * rate);
  const i1 = Math.floor(t1 * rate);
  const median = Float32Array.from(env.subarray(i0, i1)).sort()[Math.floor((i1 - i0) / 2)];
  const limit = Math.max(4 * median, 1e-5);
  const gap = Math.round(0.008 * rate);
  let n = 0;
  let last = -1e9;
  for (let i = i0 + 1; i < i1 - 1; i++) {
    if (env[i] > limit && env[i] >= env[i - 1] && env[i] > env[i + 1] && i - last >= gap) {
      n++;
      last = i;
    }
  }
  return n / (t1 - t0);
}

// How long after t0 the level of x between f0 and f1 takes to fall 30 dB under the most it reaches in the 0.3 s after t0 (s).
export function ringing(x, rate, t0, f0, f1) {
  const tr = track(x, rate, f0, f1, 0.02, 0.005, t0, t0 + 3);
  const top = Math.max(...tr.filter((q) => q.t < t0 + 0.3).map((q) => q.p));
  const top_t = tr.find((q) => q.p === top).t;
  const gone = tr.find((q) => q.t > top_t && q.p < top / 1000);
  return gone ? gone.t - t0 : 3;
}

// The loud part of a car going by in two channels: its balance (-1 all in the right, 1 all in the left) at the start, the middle and the end, and how many times the sign went over (past 0.1 either way).
export function balance(w, t0, t1) {
  const L = track(w.data[0], w.rate, 300, 3000, 0.025, 0.0125, t0, t1);
  const R = track(w.data[1], w.rate, 300, 3000, 0.025, 0.0125, t0, t1);
  const top = Math.max(...L.map((q, i) => q.p + R[i].p));
  const loud = L.map((q, i) => ({ t: q.t, total: q.p + R[i].p, bal: (q.p - R[i].p) / (q.p + R[i].p + 1e-30) })).filter((q) => q.total > top / 16);
  if (!loud.length) return null;
  let flips = 0;
  let side = 0;
  for (const q of loud) {
    const s = Math.abs(q.bal) > 0.1 ? Math.sign(q.bal) : 0;
    if (s && side && s !== side) flips++;
    if (s) side = s;
  }
  return { from: loud[0].t, to: loud[loud.length - 1].t, first: loud[0].bal, mid: loud[Math.floor(loud.length / 2)].bal, last: loud[loud.length - 1].bal, flips, top: 10 * Math.log10(top) };
}

