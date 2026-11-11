// The heads-up display: speed, where on the road you are, and the road's
// longitudinal profile ahead, drawn like the profile sheet of a road design:
// ground line, grade line, viaducts on piers, tunnels dashed through the
// hill, each structure dimensioned with its length. Everything comes from the
// committed road samples the car is driving on, nothing is made up for show.

import { STEP, BRIDGE, TUNNEL } from '../world/road.js';

const BEHIND = 420;          // metres of road behind the car on the profile
const AHEAD = 2580;          // ...and ahead of it
const EVERY = 8;             // profile sample spacing, metres
const ACCENT = '#ff6a3d';    // the car's own colour: the one mark that is you
const FRAMINGS = { chase: '追车', director: '导演', drone: '航拍', side: '侧拍', low: '低机位', front: '正面' };

const chainage = (s) => {
  const k = Math.floor(s / 1000);
  const m = Math.floor(s - k * 1000);
  return `K${k}+${String(m).padStart(3, '0')}`;
};

export class Hud {
  constructor(game, els) {
    this.game = game;
    this.el = els;
    this.ctx = els.profile.getContext('2d');
    this.lo = null;              // smoothed vertical range of the profile
    this.hi = null;
    this.speed = 0;
    this.textClock = 1;
    this.last = {};
    this.runs = [];              // viaducts and tunnels: { kind, b, e } in arc length
    this.scanFrom = 0;
  }

  // dt in seconds; draws the profile every call, text four times a second.
  update(dt) {
    const g = this.game;
    this._scan();
    this.speed += (g.car.speedKmh - this.speed) * Math.min(1, dt * 6);
    this.textClock += dt;
    if (this.textClock >= 0.25) {
      this.textClock = 0;
      this._text();
    }
    this._profile(dt);
  }

  // Viaducts and tunnels as runs of arc length, kept up to date as the road
  // is classified ahead and forgotten once they are behind the kept road.
  _scan() {
    const road = this.game.road;
    if (this.scanFrom < road.first) this.scanFrom = road.first;
    for (let i = this.scanFrom; i <= road.classified; i++) {
      const q = road.samples.get(i);
      if (!q || (q.kind !== BRIDGE && q.kind !== TUNNEL)) continue;
      const s = i * STEP;
      const cur = this.runs[this.runs.length - 1];
      if (cur && cur.kind === q.kind && cur.e >= s - STEP * 1.5) cur.e = s;
      else this.runs.push({ kind: q.kind, b: s, e: s });
    }
    this.scanFrom = Math.max(this.scanFrom, road.classified + 1);
    while (this.runs.length && this.runs[0].e < road.first * STEP) this.runs.shift();
  }

  _set(key, value) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    this.el[key].textContent = value;
  }

  _text() {
    const g = this.game;
    const s = g.sCar;
    const p = g.road.at(s);
    this._set('speed', String(Math.round(this.speed)));
    this._set('chain', chainage(s));
    this._set('alt', String(Math.round(g.car.y || 0)));
    const grade = p ? p.grade * 100 : 0;
    this._set('grade', Math.abs(grade) < 0.5 ? '平坡' : `${grade > 0 ? '上坡' : '下坡'} ${Math.abs(grade).toFixed(1)}%`);
    // On a structure: what it is and how much of it is left.
    let where = '';
    const run = p && p.kind !== 0 ? this.runs.find((r) => r.b <= s + STEP && r.e >= s - STEP) : null;
    if (run) {
      where = `${run.kind === TUNNEL ? '隧道' : '高架桥'} · 还有 ${Math.max(0, Math.round((run.e - s) / 10) * 10)} m`;
    }
    this._set('where', where);
    this.el.where.hidden = !where;
    this._set('cam', FRAMINGS[g.chase.framing] || '机位');
    this.el.auto.setAttribute('aria-pressed', String(g.autoMode));
  }

  _profile(dt) {
    const g = this.game;
    const road = g.road;
    const cv = this.el.profile;
    const ctx = this.ctx;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    if (!W || !H) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const sCar = g.sCar;
    const s0 = sCar - BEHIND;
    const s1 = sCar + AHEAD;
    const pts = [];
    for (let s = Math.ceil(s0 / EVERY) * EVERY; s <= s1; s += EVERY) {
      const i = Math.round(s / STEP);
      if (i < road.first || i > road.classified) continue;
      const q = road.samples.get(i);
      if (q) pts.push({ s, y: q.y, g: q.g, kind: q.kind, hp: q.mode === 'hairpin' });
    }
    if (pts.length < 2) return;

    // Vertical range: the grade line always fits; the ground is allowed a
    // margin around it, so a gorge under a viaduct or the mountain over a
    // tunnel shows its shape without flattening the road into a line.
    let lo = Infinity;
    let hi = -Infinity;
    for (const q of pts) {
      lo = Math.min(lo, q.y, Math.max(q.g, q.y - 70));
      hi = Math.max(hi, q.y, Math.min(q.g, q.y + 90));
    }
    const pad = Math.max(12, (hi - lo) * 0.12);
    lo -= pad;
    hi += pad;
    if (hi - lo < 60) {
      const mid = (hi + lo) / 2;
      lo = mid - 30;
      hi = mid + 30;
    }
    const k = this.lo === null ? 1 : Math.min(1, dt * 2.5);
    this.lo = this.lo === null ? lo : this.lo + (lo - this.lo) * k;
    this.hi = this.hi === null ? hi : this.hi + (hi - this.hi) * k;

    const top = 16;              // room for the dimension lines
    const bottom = H - 13;       // room for the chainage labels
    const X = (s) => ((s - s0) / (s1 - s0)) * W;
    const Y = (v) => top + ((this.hi - v) / (this.hi - this.lo)) * (bottom - top);
    const xCar = X(sCar);

    const draw = (alpha) => {
      // Ground: a soft fill under the natural ground line.
      ctx.beginPath();
      ctx.moveTo(X(pts[0].s), bottom);
      for (const q of pts) ctx.lineTo(X(q.s), Math.min(bottom, Math.max(top - 4, Y(q.g))));
      ctx.lineTo(X(pts[pts.length - 1].s), bottom);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, top - 4, 0, bottom);
      fill.addColorStop(0, `rgba(233, 230, 223, ${0.03 * alpha})`);
      fill.addColorStop(0.18, `rgba(233, 230, 223, ${0.15 * alpha})`);
      fill.addColorStop(1, `rgba(233, 230, 223, ${0.02 * alpha})`);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = `rgba(233, 230, 223, ${0.32 * alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      // The ground line stops where the land runs off the top of the sheet,
      // so a clipped mountain fades out instead of ending in a flat lid.
      let pen = false;
      for (const q of pts) {
        const y = Y(q.g);
        if (y < top - 4 || y > bottom) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(X(q.s), y);
        else ctx.moveTo(X(q.s), y);
        pen = true;
      }
      ctx.stroke();

      // Piers under viaducts, every 48 m.
      ctx.strokeStyle = `rgba(233, 230, 223, ${0.22 * alpha})`;
      ctx.beginPath();
      for (const q of pts) {
        if (q.kind !== BRIDGE || q.s % 48 !== 0) continue;
        const x = X(q.s);
        ctx.moveTo(x, Y(q.y) + 1.5);
        ctx.lineTo(x, Math.min(bottom, Y(q.g)));
      }
      ctx.stroke();

      // The grade line: solid on the ground and on bridges, dashed in tunnels.
      for (const dashed of [false, true]) {
        ctx.setLineDash(dashed ? [3, 3] : []);
        ctx.strokeStyle = `rgba(245, 243, 238, ${(dashed ? 0.62 : 0.92) * alpha})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        let open = false;
        for (let n = 0; n < pts.length - 1; n++) {
          const a = pts[n];
          const b = pts[n + 1];
          const isTunnel = a.kind === TUNNEL && b.kind === TUNNEL;
          if (isTunnel !== dashed) {
            open = false;
            continue;
          }
          if (!open) ctx.moveTo(X(a.s), Y(a.y));
          ctx.lineTo(X(b.s), Y(b.y));
          open = true;
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Hairpins: a short tick above the grade line.
      ctx.strokeStyle = `rgba(245, 243, 238, ${0.5 * alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      let inHp = false;
      for (const q of pts) {
        if (q.hp && !inHp) {
          const x = X(q.s);
          const y = Y(q.y);
          ctx.moveTo(x, y - 3);
          ctx.lineTo(x, y - 7);
        }
        inHp = q.hp;
      }
      ctx.stroke();
    };

    // Road already driven, faded; the road ahead, full.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, xCar, H);
    ctx.clip();
    draw(0.42);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(xCar, 0, W - xCar, H);
    ctx.clip();
    draw(1);
    ctx.restore();

    // Structures ahead, dimensioned like a drawing: a line with end ticks and
    // the length, above the span.
    ctx.font = '500 9.5px ui-sans-serif, -apple-system, "PingFang SC", "Noto Sans CJK SC", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (const r of this.runs) {
      if (r.e < sCar - 40 || r.b > s1) continue;
      const len = Math.round((r.e - r.b) / 10) * 10;
      if (len < 120) continue;
      const xa = Math.max(1, X(r.b));
      const xb = Math.min(W - 1, X(r.e));
      if (xb - xa < 6) continue;
      const y = 6;
      ctx.strokeStyle = 'rgba(233, 230, 223, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xa, y - 3);
      ctx.lineTo(xa, y + 3);
      ctx.moveTo(xb, y - 3);
      ctx.lineTo(xb, y + 3);
      ctx.stroke();
      const label = `${r.kind === TUNNEL ? '隧道' : '桥'} ${len} m`;
      const tw = ctx.measureText(label).width + 8;
      const xm = (xa + xb) / 2;
      ctx.beginPath();
      if (xb - xa > tw + 6) {
        ctx.moveTo(xa, y);
        ctx.lineTo(xm - tw / 2, y);
        ctx.moveTo(xm + tw / 2, y);
        ctx.lineTo(xb, y);
        ctx.stroke();
        ctx.fillStyle = 'rgba(233, 230, 223, 0.78)';
        ctx.fillText(label, xm, y + 0.5);
      } else {
        ctx.moveTo(xa, y);
        ctx.lineTo(xb, y);
        ctx.stroke();
      }
    }

    // Chainage: a tick and a label at every whole kilometre.
    ctx.fillStyle = 'rgba(233, 230, 223, 0.42)';
    ctx.strokeStyle = 'rgba(233, 230, 223, 0.3)';
    ctx.beginPath();
    for (let km = Math.ceil(s0 / 1000); km * 1000 <= s1; km++) {
      const x = X(km * 1000);
      ctx.moveTo(x, bottom + 1);
      ctx.lineTo(x, bottom + 4);
      if (x > 10 && x < W - 10) ctx.fillText(`K${km}`, x, H - 4.5);
    }
    ctx.stroke();

    // You: a hairline through the profile and a dot on the grade line.
    const here = road.at(sCar);
    if (here) {
      ctx.strokeStyle = 'rgba(255, 106, 61, 0.28)';
      ctx.beginPath();
      ctx.moveTo(xCar, top - 2);
      ctx.lineTo(xCar, bottom);
      ctx.stroke();
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(xCar, Y(here.y), 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(12, 14, 18, 0.55)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
}
