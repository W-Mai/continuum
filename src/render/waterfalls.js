// Waterfalls on the cliffs: a ribbon of white water that runs down the face, with a cloud
// of spray at the foot of it.
//
// Where they are, the plan says (world/alpineplan.js): one in each 800 m of road at most, on a
// face steeper than 0.9 over more than 25 m of height, 60 m or more from the road. The ribbon
// is laid along the line the water would take down the face (the line of steepest fall),
// three points across it at each of up to 36 rows, each on the land there; the land that is
// drawn is a coarser land the further off it is, so the ribbon stands off the face by what
// the drawn land can be wrong by (a metre close by, two and a half far off), which the vertex
// shader works out from how far the lens is. The water in it is a noise that runs down the
// ribbon with the clock the wind has (the clouds' shadows go by it), so that it stands still
// in the photo mode. The spray is 24 points a fall, each a soft disc that rises from the foot
// and spreads and goes, round after round.
//
// Every fall that is drawn is in one buffer, and all the spray in another: two draws. The
// tier says how many falls: four at the high tier, two at the mid one, none at the low one
// (which still hears them: hearing() says how loud the nearest is).

import * as THREE from 'three';
import { FALL } from '../world/alpineplan.js';
import { twistU, TWIST_PARS } from './twist.js';
import { styleU } from './style.js';
import { atmo } from './atmosphere.js';

const MAXF = 4;
const ROWS = FALL.rows;
const COLS = 3;
const MIST = FALL.mist;
const MAX_TIER = { high: MAXF, mid: 2, low: 0 };
// How far the ribbon stands off the face close by, and how much further it does far off (m).
const OFF = [0.9, 1.6];
// Where the planning of one fall is let to take a frame (ms).
const PLAN_MS = 1.2;
const lin = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

const NOISE = /* glsl */`
float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const RIBBON_VERTEX = /* glsl */`
${TWIST_PARS}
attribute vec3 aOut;      // the way the face looks (a unit vector, level), for how far the ribbon stands off it
attribute vec4 aFall;     // across it (-1 to 1), how far down it (0 to 1), how tall the fall is (m), its seed
uniform vec2 uOff;
varying vec4 vFall;
varying float vDepth;
void main() {
  vec3 p = position;
  float d0 = length( p - cameraPosition );
  p += aOut * ( uOff.x + uOff.y * smoothstep( 250.0, 700.0, d0 ) );
  vec4 mv = viewMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * twistView( mv );
  vFall = aFall;
  vDepth = max( -mv.z, 0.1 );
}
`;

const RIBBON_FRAGMENT = /* glsl */`
${NOISE}
uniform vec2 uCloudDrift;
uniform vec3 fogParams;
uniform float uRange;
uniform float uLight;
uniform float uGain;
uniform vec3 uWater;
uniform vec3 uFoam;
uniform vec3 uFlat;
uniform float uPair;
uniform float uPaintInv;
uniform float uBlock;
varying vec4 vFall;
varying float vDepth;
void main() {
  float across = vFall.x;
  float along = vFall.y;
  float tall = vFall.z;
  // The block style: squares a metre across, a metre of the fall each.
  if ( uBlock > 0.5 ) {
    along = ( floor( along * tall ) + 0.5 ) / tall;
    across = ( floor( across * 2.0 + 0.5 ) ) * 0.5;
  }
  float t = dot( uCloudDrift, vec2( 0.918, 0.396 ) ) * 0.1414;
  float v = along * tall;
  // Streaks that run down it, and a thicker, slower swell in it.
  float n1 = vn( vec2( across * 4.0 + vFall.w * 23.0, v * 0.2 - t * 5.0 ) );
  float n2 = vn( vec2( across * 9.0 + 3.1, v * 0.45 - t * 8.5 ) );
  float n3 = vn( vec2( across * 2.0 - 7.0, v * 0.08 - t * 2.2 ) );
  float streak = 0.45 * n1 + 0.35 * n2 + 0.2 * n3;
  float edge = 1.0 - smoothstep( 0.55, 1.0, abs( across ) + ( n2 - 0.5 ) * 0.25 );
  // Thin at the lip, thicker toward the foot.
  float feed = smoothstep( 0.0, 0.08, along ) * ( 0.7 + 0.3 * along );
  float a = edge * feed * ( 0.55 + 0.45 * streak );
  vec3 col = mix( uWater, uFoam, smoothstep( 0.35, 0.8, streak ) ) * uLight * uGain;
  if ( uPair > 0.0 ) {
    float f = smoothstep( 0.2, 0.26, edge * feed * ( streak + 0.3 ) );
    a = mix( a, f * 0.85, uPair );
    col = mix( col, uFlat * uPaintInv, uPair );
  }
  a *= 1.0 - smoothstep( uRange * 0.75, uRange, vDepth );
  a *= exp( - vDepth * fogParams.x );
  if ( a < 0.003 ) discard;
  gl_FragColor = vec4( col, min( a, 0.95 ) );
}
`;

const MIST_VERTEX = /* glsl */`
${TWIST_PARS}
attribute vec3 aOut;
attribute vec4 aMist;     // where it is in its round (0 to 1), its size (m), its seed, how thick
uniform vec2 uCloudDrift;
uniform vec3 fogParams;
uniform float uPx;
uniform float uRange;
varying float vAlpha;
void main() {
  float t = dot( uCloudDrift, vec2( 0.918, 0.396 ) ) * 0.1414;
  float cyc = fract( aMist.x + t / ( 3.2 + aMist.z * 1.6 ) );
  vec3 p = position;
  // Up, out from the face and down the wind as it goes.
  p += aOut * cyc * ( 0.5 + 1.5 * aMist.z ) + vec3( 0.918, 0.0, 0.396 ) * cyc * 1.5;
  p.y += cyc * ( 1.5 + 2.5 * aMist.z );
  vec4 mv = viewMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * twistView( mv );
  float d = max( -mv.z, 0.5 );
  float size = aMist.y * ( 0.55 + 1.1 * cyc );
  gl_PointSize = clamp( size * uPx / d, 1.0, 56.0 );
  float fade = sin( 3.14159 * cyc );
  vAlpha = aMist.w * fade * fade * ( 1.0 - smoothstep( uRange * 0.75, uRange, d ) ) * exp( - d * fogParams.x ) * smoothstep( 8.0, 40.0, d );
}
`;

const MIST_FRAGMENT = /* glsl */`
uniform float uLight;
uniform float uGain;
uniform vec3 uFoam;
uniform vec3 uFlat;
uniform float uPair;
uniform float uPaintInv;
uniform float uBlock;
varying float vAlpha;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r = length( q ) * 2.0;
  float soft = exp( - r * r * 3.4 ) * ( 1.0 - smoothstep( 0.8, 1.0, r ) );
  float a = vAlpha * soft * 0.13;
  vec3 col = uFoam * uLight * uGain;
  if ( uBlock > 0.5 ) a = vAlpha * 0.2 * step( max( abs( q.x ), abs( q.y ) ), 0.5 );
  else if ( uPair > 0.0 ) {
    // The painted styles: a flat disc.
    float f = step( r, 0.85 ) * vAlpha * 0.2;
    a = mix( a, f, uPair );
    col = mix( col, uFlat * uPaintInv, uPair );
  }
  if ( a < 0.003 ) discard;
  gl_FragColor = vec4( col, a );
}
`;

// What a draw of a thing that has no depth and keeps what the scene says of itself in the alpha (render/plumes.js).
const OVER = {
  transparent: true,
  depthWrite: false,
  forceSinglePass: true,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
};

export class Waterfalls {
  // env: plan (AlpinePlan, or any plan with a land), origin() (the floating origin). opts.spray: the colour of the spray
  // (sRGB), where it is not the white water's (the heaven's falls go down into its cloud); opts.range: how far off one is
  // drawn (m; FALL.range where it is not said: over the open cloud the islands are seen further). The falls drawn are the ones
  // update() is handed: the alpine's from find(), another world's from its own plan.
  constructor(scene, env, opts = {}) {
    this.env = env;
    this.range = opts.range || FALL.range;
    this.scene = scene;
    const colour = { uWater: { value: lin(0xc2dcee) }, uFoam: { value: lin(0xf6fbff) }, uFlat: { value: lin(0xeaf4ff) } };
    this.uniforms = {
      ...twistU,
      ...colour,
      uCloudDrift: styleU.uCloudDrift,
      fogParams: atmo.fogParams,
      uPair: styleU.uPair,
      uPaintInv: styleU.uPaintInv,
      uBlock: { value: 0 },
      uLight: { value: 1 },
      uGain: { value: 2.6 },
      uRange: { value: this.range },
      uPx: { value: 700 },
      uOff: { value: new THREE.Vector2(OFF[0], OFF[1]) },
    };
    // The ribbons.
    const nv = MAXF * ROWS * COLS;
    this.pos = new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.out = new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.info = new THREE.BufferAttribute(new Float32Array(nv * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.index = new THREE.BufferAttribute(new Uint16Array(MAXF * (ROWS - 1) * (COLS - 1) * 6), 1).setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', this.pos);
    geo.setAttribute('aOut', this.out);
    geo.setAttribute('aFall', this.info);
    geo.setIndex(this.index);
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.ribbonMaterial = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms }, vertexShader: RIBBON_VERTEX, fragmentShader: RIBBON_FRAGMENT, side: THREE.DoubleSide, ...OVER,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.ribbon = new THREE.Mesh(geo, this.ribbonMaterial);
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = 2;
    this.ribbon.visible = false;
    // The spray.
    const nm = MAXF * MIST;
    this.mpos = new THREE.BufferAttribute(new Float32Array(nm * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.mout = new THREE.BufferAttribute(new Float32Array(nm * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.minfo = new THREE.BufferAttribute(new Float32Array(nm * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', this.mpos);
    mg.setAttribute('aOut', this.mout);
    mg.setAttribute('aMist', this.minfo);
    mg.setDrawRange(0, 0);
    mg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    const spray = opts.spray === undefined ? {} : { uFoam: { value: lin(opts.spray) }, uFlat: { value: lin(opts.spray) } };
    this.mistMaterial = new THREE.ShaderMaterial({ uniforms: { ...this.uniforms, ...spray }, vertexShader: MIST_VERTEX, fragmentShader: MIST_FRAGMENT, ...OVER });
    this.mist = new THREE.Points(mg, this.mistMaterial);
    this.mist.frustumCulled = false;
    this.mist.renderOrder = 3;
    this.mist.visible = false;
    this.list = [];               // the falls that are drawn (the plan's)
    this.known = new Map();       // cell -> the plan's fall for it, or null
    this.count = 0;               // falls drawn
    this.points = 0;              // points of spray drawn
    this.rows = 0;
    this._key = '';
    this._dirty = true;
    this._tier = '';
  }

  shift() {
    this._dirty = true;
  }

  // The falls of the cells of road round s that are worked out so far (more are, a little each call, while there are any to find).
  // Returns the known ones, [{ fall, k }].
  find(s, settle = false) {
    const F = FALL;
    const out = [];
    let planned = 0;
    for (let k = Math.floor((s - F.range - F.reach) / F.every); k <= Math.floor((s + F.range + F.reach) / F.every); k++) {
      let f = this.env.plan.falls.get(k);
      if (f === undefined) {
        // (Worked out in pieces, a frame's share; where the world stands still, at once.)
        if (!settle && planned++ > 0) continue;
        f = this.env.plan.fall(k, settle ? Infinity : PLAN_MS);
      }
      if (f) out.push({ fall: f, k });
    }
    return out;
  }

  // How loud the nearest fall is to a lens at `camera`: { d (m, to the nearest point of it), x, y, z (that point, local) } or null
  // when none is within FALL.hear.
  nearest(camera, known) {
    const o = this.env.origin();
    const ax = camera.position.x + o.x;
    const ay = camera.position.y;
    const az = camera.position.z + o.z;
    let best = null;
    for (const { fall } of known) {
      const p = fall.pts;
      for (let i = 0; i < fall.n; i++) {
        const d = Math.hypot(p[i * 3] - ax, p[i * 3 + 1] - ay, p[i * 3 + 2] - az);
        if (d < FALL.hear && (!best || d < best.d)) best = { d, x: p[i * 3] - o.x, y: p[i * 3 + 1], z: p[i * 3 + 2] - o.z };
      }
    }
    return best;
  }

  // Every frame in the alpine. tier; known: from find(); ctx: { light, blocks, px }.
  update(camera, on, tier, known, ctx) {
    const max = MAX_TIER[tier] || 0;
    if (!on || max === 0) {
      if (this.ribbon.visible) this._hide();
      return;
    }
    const u = this.uniforms;
    u.uLight.value = 0.55 + 0.45 * (ctx.light === undefined ? 1 : ctx.light);
    u.uBlock.value = ctx.blocks || 0;
    if (ctx.px) u.uPx.value = ctx.px;
    const o = this.env.origin();
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    // The nearest first, within range of the lens (by the middle of the fall).
    const near = [];
    for (const { fall, k } of known) {
      const m = (fall.n >> 1) * 3;
      const d = Math.hypot(fall.pts[m] - ax, fall.pts[m + 2] - az);
      if (d < this.range + 60) near.push({ fall, k, d });
    }
    near.sort((a, b) => a.d - b.d);
    const chosen = near.slice(0, max);
    const key = chosen.map((c) => c.k).join(',');
    if (key !== this._key || this._dirty || this._tier !== tier) {
      this._key = key;
      this._dirty = false;
      this._tier = tier;
      this._build(chosen.map((c) => c.fall), o);
    }
    if (!this.ribbon.parent) this.scene.add(this.ribbon, this.mist);
    this.ribbon.visible = this.count > 0;
    this.mist.visible = this.count > 0 && this.points > 0;
  }

  _hide() {
    this.ribbon.visible = false;
    this.mist.visible = false;
    this.count = 0;
    this.points = 0;
    this._key = '';
  }

  // The buffers of the falls that are drawn: a ribbon each, and the spray at its foot.
  _build(falls, o) {
    const land = this.env.plan.land;
    let v = 0;
    let ix = 0;
    let m = 0;
    let rows = 0;
    falls.forEach((f, fi) => {
      const n = f.n;
      const stride = Math.max(1, Math.ceil((n - 1) / (ROWS - 1)));
      const idx = [];
      for (let i = 0; i < n - 1; i += stride) idx.push(i);
      idx.push(n - 1);
      const R = idx.length;
      const base = v;
      const total = Math.max(1, f.drop);
      for (let r = 0; r < R; r++) {
        const i = idx[r];
        const a = idx[Math.max(0, r - 1)];
        const c = idx[Math.min(R - 1, r + 1)];
        let tx = f.pts[c * 3] - f.pts[a * 3];
        let tz = f.pts[c * 3 + 2] - f.pts[a * 3 + 2];
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        const along = r / (R - 1);
        const hw = 0.5 * f.width * (0.6 + 0.4 * along);
        for (let col = 0; col < COLS; col++) {
          const side = col - 1;
          const x = f.pts[i * 3] + -tz * hw * side;
          const z = f.pts[i * 3 + 2] + tx * hw * side;
          const y = land.heightAt(x, z) + 0.2;
          this.pos.setXYZ(v, x - o.x, y, z - o.z);
          this.out.setXYZ(v, tx, 0, tz);
          this.info.setXYZW(v, side, along, total, f.key % 97 / 97);
          v++;
        }
      }
      for (let r = 0; r < R - 1; r++) {
        for (let col = 0; col < COLS - 1; col++) {
          const a = base + r * COLS + col;
          const b = a + 1;
          const c = a + COLS;
          const d = c + 1;
          this.index.setX(ix++, a);
          this.index.setX(ix++, c);
          this.index.setX(ix++, b);
          this.index.setX(ix++, b);
          this.index.setX(ix++, c);
          this.index.setX(ix++, d);
        }
      }
      rows += R;
      // The spray: round the foot, in a disc as wide as the fall is and a little more, each point in its own round.
      const foot = idx[R - 1];
      const fx = f.pts[foot * 3];
      const fy = f.pts[foot * 3 + 1];
      const fz = f.pts[foot * 3 + 2];
      let ox = f.out[0];
      let oz = f.out[1];
      for (let q = 0; q < MIST; q++) {
        const r1 = hash(f.key, q, 1, fi);
        const r2 = hash(f.key, q, 2, fi);
        const r3 = hash(f.key, q, 3, fi);
        const a = r1 * Math.PI * 2;
        const rad = (2 + f.width * 3) * Math.sqrt(r2);
        const px = fx + ox * 1 + Math.cos(a) * rad;
        const pz = fz + oz * 1 + Math.sin(a) * rad;
        this.mpos.setXYZ(m, px - o.x, Math.max(land.heightAt(px, pz), fy - 1) + 0.6, pz - o.z);
        this.mout.setXYZ(m, ox, 0, oz);
        this.minfo.setXYZW(m, q / MIST, (4 + 5 * r3) * (0.7 + 0.1 * f.width), r3, 0.45 + 0.4 * r1);
        m++;
      }
    });
    this.count = falls.length;
    this.rows = rows;
    this.points = m;
    this.ribbon.geometry.setDrawRange(0, ix);
    this.mist.geometry.setDrawRange(0, m);
    for (const a of [this.pos, this.out, this.info, this.index, this.mpos, this.mout, this.minfo]) a.needsUpdate = true;
  }

  meshes() {
    return [this.ribbon, this.mist];
  }

  dispose() {
    this.scene.remove(this.ribbon, this.mist);
    this.ribbon.geometry.dispose();
    this.mist.geometry.dispose();
    this.ribbonMaterial.dispose();
    this.mistMaterial.dispose();
  }
}

// A draw from three integers and a salt, 0 to 1.
function hash(a, b, c, d) {
  let h = (Math.imul(a | 0, 0x8da6b343) ^ Math.imul(b | 0, 0xd8163841) ^ Math.imul(c | 0, 0x2545f491) ^ Math.imul(d | 0, 0x9e3779b9)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
