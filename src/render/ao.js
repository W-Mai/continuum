// Ambient occlusion for the real style: where surfaces crowd one another (a
// seam, a corner, the inside of a canopy, the ground under the car) the light
// that reaches them is less, and the frame is a little darker there.
//
// It reads the depth the scene was drawn with, in five draws, three of them at
// half the frame's size:
//
//  - depth: the distance along the lens's axis of each texel's pixel (the
//    nearest of the four it stands for), the sky a very large number;
//  - trace: the horizon search. From a texel's point, along one or two
//    directions on the screen, four taps each way look for what stands up
//    over the surface (its normal comes from the depth about it): the
//    highest of them, as the angle its point makes with the surface, is the
//    horizon that way. The open arc between the two horizons, weighed by the
//    cosine of the angle to the normal, is worked out as it is written and
//    taken over what it would be with nothing in the way. What is further from
//    the point than the radius does not count, and a tap's weight thins out
//    towards it. The directions are turned, and the taps moved along them, by
//    a number taken from where the point is in the world (a cell about as
//    wide as a texel, in whole powers of two of a metre), so that the noise
//    stays on the surfaces and does not stand still on the screen;
//  - blur: the four by four texels about each, weighed by how near they are to
//    the surface the texel is on (a plane seen at any slant is one surface, so
//    what is in the way of one is not spread onto another), and the result
//    raised to a power;
//  - factor: at the frame's size, each pixel's factor is taken from the four
//    texels nearest it, by how near they are to its own surface (the nearest in
//    depth when none is near), thinned with the distance and held back where the
//    frame is bright (a lamp, the sun, a glint: what makes its own light is not
//    darkened by the crowd about it) or is what the bloom takes up, or is beside
//    it (the bloom reads the frame at half its size, each of its pixels the mean
//    of two by two of the frame's), so that the glow is the same pixel for pixel
//    with and without the occlusion, or is beside the sky (the last pass mixes
//    the pixels of an edge, and hands the sky nothing of this); where it would
//    darken by less than a fifth of a per cent, the factor is 1;
//  - apply: the factor multiplied into the frame where it stands.
//
// It stands before the bloom, on the linear frame, so that the glow is made of
// what is left. Nothing of it is drawn where the depth is the far plane's, and
// what is drawn is exactly the frame's where the factor is 1. It does not swap
// the composer's targets: the scene's, with its depth, stays the one the passes
// after it read the depth of (a pass that does swap may follow it).

import * as THREE from 'three';
import { Pass, FullScreenQuad } from '../../tools/vendor/postprocessing/Pass.js';
import { originMod } from './style.js';

export const AO = {
  radius: 1.2,            // m: how far from a point what shades it is looked for
  maxPx: 64,              // the largest radius on the screen, for a frame 1080 pixels tall
  steps: 4,               // taps each way along a direction
  strength: 0.6,          // how much of the darkening the frame takes: col *= mix(1, visibility, strength)
  power: 2,               // visibility is raised to this
  fade: [80, 190],        // m: it thins from the first and is gone at the second
  falloff: 0.615,         // the share of the radius over which a tap's weight goes from whole to none
  emissive: [1, 1.5],     // the frame's light, exposed: it is not darkened as it goes from the first to the second
  depthTol: 0.03,         // how far apart (as a share of the nearer) two depths are for their texels to count as one surface
  slices: { high: 2, mid: 1, low: 0 },   // directions looked along, by tier
};

const SKY = 6.0e4;

const VERTEX = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';

// The distance along the lens's axis of a depth buffer value.
const LINEAR = /* glsl */`
  float linearDepth(float zb) {
    float n = uNearFar.x;
    float f = uNearFar.y;
    return 2.0 * n * f / (f + n - (zb * 2.0 - 1.0) * (f - n));
  }
`;

// How far apart two distances are, as a share of the nearer, and what that
// counts for in the weight of a texel.
const TOLERANCE = /* glsl */`
  float sameSurface(float a, float b) {
    float rel = abs(a - b) / max(min(a, b), 1e-9);
    return exp(-rel * rel * ${(1 / (AO.depthTol * AO.depthTol)).toFixed(3)});
  }
`;

const DEPTH = /* glsl */`
  uniform sampler2D tDepth;
  uniform vec2 uNearFar;
  uniform vec2 uFull;
  ${LINEAR}
  void main() {
    ivec2 q = ivec2(gl_FragCoord.xy) * 2;
    ivec2 last = ivec2(uFull) - 1;
    // The nearest of the four pixels a texel stands for: a thin thing is always there to be seen.
    float zb = 1.0;
    for (int k = 0; k < 4; k++) zb = min(zb, texelFetch(tDepth, min(q + ivec2(k & 1, k >> 1), last), 0).r);
    gl_FragColor = vec4(zb >= 0.999995 ? ${SKY.toFixed(1)} : linearDepth(zb), 0.0, 0.0, 1.0);
  }
`;

const TRACE = /* glsl */`
  uniform sampler2D tZ;
  uniform vec2 uFull;
  uniform vec2 uHalf;
  uniform vec2 uTan;
  uniform vec2 uFall;
  uniform float uRadius;
  uniform float uPerUnit;
  uniform float uFoot;
  uniform float uMaxTexels;
  uniform float uFadeEnd;
  uniform int uSlices;
  uniform mat4 uCamWorld;
  uniform vec3 uOriginMod;

  const float PI = 3.14159265;
  const float HALF_PI = 1.57079633;
  const float SKY = ${SKY.toFixed(1)};
  const int STEPS = ${AO.steps};

  uvec3 pcg3d(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    return v;
  }

  // The distance of a texel (the sky where it is off the frame).
  float zAt(ivec2 t) {
    ivec2 last = ivec2(uHalf) - 1;
    return texelFetch(tZ, clamp(t, ivec2(0), last), 0).r;
  }
  float zIn(ivec2 t) {
    bool inside = t.x >= 0 && t.y >= 0 && t.x < int(uHalf.x) && t.y < int(uHalf.y);
    return inside ? texelFetch(tZ, t, 0).r : SKY;
  }

  // Where a texel (the middle of its four pixels) is in the lens's space, at distance d (the lens looks down -z).
  vec3 viewAt(ivec2 t, float d) {
    vec2 ndc = (vec2(t) * 2.0 + 1.0) / uFull * 2.0 - 1.0;
    return vec3(ndc * uTan * d, -d);
  }

  void main() {
    ivec2 h = ivec2(gl_FragCoord.xy);
    float dC = zAt(h);
    if (dC >= 0.5 * SKY || dC > uFadeEnd) {
      gl_FragColor = vec4(1.0, dC, 0.0, 1.0);
      return;
    }
    vec3 P = viewAt(h, dC);

    // The way the surface faces: the depth's slope, taken on each axis from the
    // side that bends the less from a plane (a straight line in the inverse distance).
    float iC = 1.0 / dC;
    float dL = zAt(h + ivec2(-1, 0));
    float dR = zAt(h + ivec2(1, 0));
    float dB = zAt(h + ivec2(0, -1));
    float dT = zAt(h + ivec2(0, 1));
    vec3 ex = abs(1.0 / dR - iC) < abs(iC - 1.0 / dL) ? viewAt(h + ivec2(1, 0), dR) - P : P - viewAt(h + ivec2(-1, 0), dL);
    vec3 ey = abs(1.0 / dT - iC) < abs(iC - 1.0 / dB) ? viewAt(h + ivec2(0, 1), dT) - P : P - viewAt(h + ivec2(0, -1), dB);
    vec3 N = cross(ex, ey);
    float nl = length(N);
    if (nl < 1e-12) {
      gl_FragColor = vec4(1.0, dC, 0.0, 1.0);
      return;
    }
    N /= nl;
    vec3 V = normalize(-P);
    if (dot(N, V) < 0.0) N = -N;

    // How far on the screen to look, in texels.
    float reach = min(uRadius * uPerUnit / dC, uMaxTexels);

    // A number for the point from where it is in the world: the cell it is in
    // (as wide as a texel, a power of two of a metre; the origin's digits are
    // kept to the kilometre the cells repeat over).
    vec3 Pw = (uCamWorld * vec4(P, 1.0)).xyz + uOriginMod;
    float cell = exp2(floor(log2(max(dC * uFoot, 1e-4)) + 0.5));
    vec3 cc = mod(floor(Pw / cell), vec3(1024.0 / cell, 65536.0, 1024.0 / cell));
    vec3 rnd = vec3(pcg3d(uvec3(cc))) * (1.0 / 4294967295.0);

    float num = 0.0;
    float den = 0.0;
    for (int s = 0; s < 2; s++) {
      if (s >= uSlices) break;
      // The direction on the screen, and the plane through it and the line of sight.
      float phi = (float(s) + rnd.x) * (PI / float(uSlices));
      vec2 om = vec2(cos(phi), sin(phi));
      vec3 dirV = vec3(om, 0.0);
      vec3 ortho = dirV - dot(dirV, V) * V;
      vec3 axis = normalize(cross(ortho, V));
      // The normal in that plane, and the angle it makes with the line of sight
      // (positive towards the direction).
      vec3 pn = N - axis * dot(N, axis);
      float pl = length(pn);
      float cosN = clamp(dot(pn, V) / max(pl, 1e-5), 0.0, 1.0);
      float n = (dot(ortho, pn) < 0.0 ? -1.0 : 1.0) * acos(cosN);
      // How high over the surface the highest thing is, each way, as the sine of
      // the angle its point makes with the surface (a tap off the plane of the
      // direction by a texel's rounding is still the point it is; on a flat
      // surface every tap is at none).
      float m0 = 0.0;
      float m1 = 0.0;
      for (int k = 0; k < STEPS; k++) {
        float u = (float(k) + rnd.y) / float(STEPS);
        float off = 1.0 + u * u * reach;
        ivec2 o = ivec2(floor(om * off + 0.5));
        ivec2 t0 = h + o;
        ivec2 t1 = h - o;
        vec3 e0 = viewAt(t0, zIn(t0)) - P;
        vec3 e1 = viewAt(t1, zIn(t1)) - P;
        float l0 = max(length(e0), 1e-5);
        float l1 = max(length(e1), 1e-5);
        m0 = max(m0, max(dot(e0, N), 0.0) / l0 * clamp(1.0 - (l0 - uFall.x) / uFall.y, 0.0, 1.0));
        m1 = max(m1, max(dot(e1, N), 0.0) / l1 * clamp(1.0 - (l1 - uFall.x) / uFall.y, 0.0, 1.0));
      }
      // The two horizons in the plane, as angles from the line of sight, each
      // the surface's own less how far up the highest thing stands.
      float q = max(pl, 0.05);
      float h1 = n + HALF_PI - asin(min(m0 / q, 1.0));
      float h0 = n - HALF_PI + asin(min(m1 / q, 1.0));
      // What is open between them (cosine-weighted), and what is open with nothing in the way;
      // a plane that cuts the surface at a slant counts for less.
      float sn = sin(n);
      float arc = 0.25 * (2.0 * cosN + 2.0 * (h0 + h1) * sn - cos(2.0 * h0 - n) - cos(2.0 * h1 - n));
      num += pl * arc;
      den += pl * (cosN + n * sn);
    }
    gl_FragColor = vec4(clamp(num / max(den, 1e-5), 0.0, 1.0), dC, 0.0, 1.0);
  }
`;

const BLUR = /* glsl */`
  uniform sampler2D tAo;
  uniform vec2 uHalf;
  uniform float uPower;
  ${TOLERANCE}

  void main() {
    ivec2 h = ivec2(gl_FragCoord.xy);
    ivec2 last = ivec2(uHalf) - 1;
    vec2 c = texelFetch(tAo, h, 0).rg;
    float iC = 1.0 / c.g;
    // How the inverse distance runs over the surface the texel is on, on each axis, from the
    // side that bends the less (on a plane it is a straight line in the screen): a texel is of the
    // same surface when it is on that line, not when it is as far, so a slope seen edge-on is one surface.
    float iL = 1.0 / texelFetch(tAo, clamp(h + ivec2(-1, 0), ivec2(0), last), 0).g;
    float iR = 1.0 / texelFetch(tAo, clamp(h + ivec2(1, 0), ivec2(0), last), 0).g;
    float iB = 1.0 / texelFetch(tAo, clamp(h + ivec2(0, -1), ivec2(0), last), 0).g;
    float iT = 1.0 / texelFetch(tAo, clamp(h + ivec2(0, 1), ivec2(0), last), 0).g;
    float gx = abs(iR - iC) < abs(iC - iL) ? iR - iC : iC - iL;
    float gy = abs(iT - iC) < abs(iC - iB) ? iT - iC : iC - iB;
    float sum = 0.0;
    float wsum = 0.0;
    for (int j = -2; j <= 1; j++) {
      for (int i = -2; i <= 1; i++) {
        vec2 t = texelFetch(tAo, clamp(h + ivec2(i, j), ivec2(0), last), 0).rg;
        float w = sameSurface(1.0 / t.g, iC + gx * float(i) + gy * float(j));
        sum += t.r * w;
        wsum += w;
      }
    }
    gl_FragColor = vec4(pow(sum / wsum, uPower), c.g, 0.0, 1.0);
  }
`;

const FACTOR = /* glsl */`
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D tBlur;
  uniform vec2 uNearFar;
  uniform vec2 uFull;
  uniform vec2 uHalf;
  uniform vec2 uFade;
  uniform vec2 uEmit;
  uniform float uStrength;
  uniform float uExposure;
  uniform float uBloom;
  ${LINEAR}
  ${TOLERANCE}

  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    float zb = texelFetch(tDepth, p, 0).r;
    if (zb >= 0.999995) {
      gl_FragColor = vec4(1.0);
      return;
    }
    float d = linearDepth(zb);
    float k = uStrength * (1.0 - smoothstep(uFade.x, uFade.y, d));
    vec3 c = texelFetch(tColor, p, 0).rgb;
    float light = dot(c, vec3(0.2126, 0.7152, 0.0722)) * uExposure;
    // (A light that is not a number is not darkened either.)
    k *= light < uEmit.y ? 1.0 - smoothstep(uEmit.x, uEmit.y, light) : 0.0;
    if (k <= 0.0) {
      gl_FragColor = vec4(1.0);
      return;
    }
    // The blurred texel at h is a window's average, centred two pixels on from the one before it, at
    // 2h in the frame's pixels: a pixel is between two of them, a quarter of the way on one side and
    // three quarters on the other.
    ivec2 last = ivec2(uHalf) - 1;
    ivec2 h0 = p / 2;
    vec2 f = vec2(p - h0 * 2) * 0.5 + 0.25;
    vec4 b4 = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
    vec2 s0 = texelFetch(tBlur, min(h0, last), 0).rg;
    vec2 s1 = texelFetch(tBlur, min(h0 + ivec2(1, 0), last), 0).rg;
    vec2 s2 = texelFetch(tBlur, min(h0 + ivec2(0, 1), last), 0).rg;
    vec2 s3 = texelFetch(tBlur, min(h0 + ivec2(1, 1), last), 0).rg;
    // When the four are on one plane with the pixel (the inverse distance run through them reaches the
    // pixel's own) the blend is the plain one, and the surface can lie at any slant; where it is not, a
    // texel counts as far as its distance is the pixel's.
    float ip = 1.0 / d;
    float plane = 1.0 - smoothstep(0.012, 0.035, abs(dot(b4, vec4(1.0 / s0.g, 1.0 / s1.g, 1.0 / s2.g, 1.0 / s3.g)) - ip) / ip);
    vec4 w = b4 * vec4(mix(sameSurface(d, s0.g), 1.0, plane), mix(sameSurface(d, s1.g), 1.0, plane),
      mix(sameSurface(d, s2.g), 1.0, plane), mix(sameSurface(d, s3.g), 1.0, plane));
    float wsum = w.x + w.y + w.z + w.w;
    // None of the four near in depth: the one that is nearest.
    vec4 gap = abs(vec4(s0.g, s1.g, s2.g, s3.g) - d);
    float nearest = min(min(gap.x, gap.y), min(gap.z, gap.w));
    float pick = nearest == gap.x ? s0.r : (nearest == gap.y ? s1.r : (nearest == gap.z ? s2.r : s3.r));
    float ao = wsum > 0.02 ? dot(w, vec4(s0.r, s1.r, s2.r, s3.r)) / wsum : pick;
    // Where it darkens by less than a fifth of a per cent (the flat of a plane, mostly) there is nothing to leave alone.
    if (k * (1.0 - ao) < 0.002) {
      gl_FragColor = vec4(1.0);
      return;
    }
    // What the bloom takes up (a pixel as bright as its threshold, by the light the bloom sees it in) is
    // left as it is, so that the glow is the same with and without this, in every pixel. The bloom reads
    // the frame at half its size, each of its pixels the mean of two by two of ours, and the mean is
    // above its threshold when one of the four is far above it: so a pixel with such a one in the 3 by 3
    // about it is left as it is too. So is a pixel with the sky in the 3 by 3 about it: the last pass
    // mixes the pixels of an edge, and hands the sky nothing of this.
    // (A pixel that is not a number is not taken for a bright one.)
    vec3 grey = vec3(0.299, 0.587, 0.114);
    float top = dot(c, grey);
    ivec2 lim = ivec2(uFull) - 1;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        ivec2 q = clamp(p + ivec2(i, j), ivec2(0), lim);
        float v = dot(texelFetch(tColor, q, 0).rgb, grey);
        top = v > top ? v : top;
        if (texelFetch(tDepth, q, 0).r >= 0.999995) top = 1.0e4;
      }
    }
    k *= 1.0 - smoothstep(0.85 * uBloom, uBloom, top);
    gl_FragColor = vec4(mix(1.0, ao, k));
  }
`;

const APPLY = /* glsl */`
  uniform sampler2D tFactor;
  void main() {
    float f = texelFetch(tFactor, ivec2(gl_FragCoord.xy), 0).r;
    gl_FragColor = vec4(f, f, f, 0.0);
  }
`;

// The programs' sources, for the check that the taps are as many as the tiers say.
export const AO_SHADERS = { depth: DEPTH, trace: TRACE, blur: BLUR, factor: FACTOR, apply: APPLY, steps: AO.steps };

export class AoPass extends Pass {
  constructor(renderer, tap, camera) {
    super();
    this.needsSwap = false;
    this.enabled = false;
    this.renderer = renderer;
    this.tap = tap;
    this.camera = camera;
    // Kept off from outside (the address's ao=0, the checks), whatever the style.
    this.off = false;
    // The bloom pass that follows (its threshold is the light it picks up).
    this.bloom = null;
    this.real = 0;
    this.tier = 'high';
    // How far it has come on since it was first drawn (it comes in over half a second).
    this.level = 0;
    this.built = false;
    this._warm = null;
    this.size = [1, 1];
    this.half = [1, 1];
    // The distance is kept whole where the card can make a 32-bit target. The targets are of float formats,
    // which a card without this cannot draw to: it draws without the occlusion.
    const full = !!(renderer.extensions && renderer.extensions.has('EXT_color_buffer_float'));
    this.capable = full;
    const target = (type, format) => new THREE.WebGLRenderTarget(1, 1, {
      type, format, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
    this.z = target(full ? THREE.FloatType : THREE.HalfFloatType, THREE.RedFormat);
    this.raw = target(THREE.HalfFloatType, THREE.RGFormat);
    this.blurred = target(THREE.HalfFloatType, THREE.RGFormat);
    this.factor = target(THREE.UnsignedByteType, THREE.RedFormat);
    this.z.texture.name = 'Ao.distance';
    this.raw.texture.name = 'Ao.raw';
    this.blurred.texture.name = 'Ao.blurred';
    this.factor.texture.name = 'Ao.factor';
    const slot = (value) => ({ value });
    const u = {
      tColor: slot(null),
      tDepth: slot(null),
      tZ: slot(this.z.texture),
      uNearFar: slot(new THREE.Vector2(0.3, 14000)),
      uFull: slot(new THREE.Vector2(1, 1)),
      uHalf: slot(new THREE.Vector2(1, 1)),
      uTan: slot(new THREE.Vector2(1, 1)),
      uFall: slot(new THREE.Vector2(1, 1)),
      uRadius: slot(AO.radius),
      uPerUnit: slot(1),
      uFoot: slot(0.002),
      uMaxTexels: slot(32),
      uFadeEnd: slot(AO.fade[1]),
      uFade: slot(new THREE.Vector2(AO.fade[0], AO.fade[1])),
      uEmit: slot(new THREE.Vector2(AO.emissive[0], AO.emissive[1])),
      uPower: slot(AO.power),
      uSlices: slot(AO.slices.high),
      uStrength: slot(0),
      uExposure: slot(1),
      uBloom: slot(1.1),
      uCamWorld: slot(new THREE.Matrix4()),
      uOriginMod: originMod,
    };
    this.uniforms = u;
    const make = (fragmentShader, uniforms, more = {}) => new THREE.ShaderMaterial({
      uniforms, vertexShader: VERTEX, fragmentShader, depthTest: false, depthWrite: false, ...more,
    });
    this.materials = {
      depth: make(DEPTH, { tDepth: u.tDepth, uNearFar: u.uNearFar, uFull: u.uFull }),
      trace: make(TRACE, {
        tZ: u.tZ, uFull: u.uFull, uHalf: u.uHalf, uTan: u.uTan, uFall: u.uFall, uRadius: u.uRadius, uPerUnit: u.uPerUnit,
        uFoot: u.uFoot, uMaxTexels: u.uMaxTexels, uFadeEnd: u.uFadeEnd, uSlices: u.uSlices,
        uCamWorld: u.uCamWorld, uOriginMod: u.uOriginMod,
      }),
      blur: make(BLUR, { tAo: slot(this.raw.texture), uHalf: u.uHalf, uPower: u.uPower }),
      factor: make(FACTOR, {
        tColor: u.tColor, tDepth: u.tDepth, tBlur: slot(this.blurred.texture), uNearFar: u.uNearFar, uFull: u.uFull, uHalf: u.uHalf,
        uFade: u.uFade, uEmit: u.uEmit, uStrength: u.uStrength, uExposure: u.uExposure, uBloom: u.uBloom,
      }),
      // Multiplied into the frame where it stands: the colour is what it was times the factor, the alpha as it was.
      apply: make(APPLY, { tFactor: slot(this.factor.texture) }, {
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.ZeroFactor,
        blendDst: THREE.SrcColorFactor,
        blendEquationAlpha: THREE.AddEquation,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
      }),
    };
    this.quad = new FullScreenQuad(this.materials.depth);
  }

  // The exposure the frame is graded with (the final pass's own uniform): what
  // is bright once it is exposed is left alone, so it is read as it is.
  bind(exposure) {
    this.materials.factor.uniforms.uExposure = exposure;
  }

  // How the style and the tier have it now: the real style's share (0 to 1),
  // and the tier's number of directions. Where the programs are built is the
  // first time it is wanted: ahead, in the compiler's threads, and it comes on
  // when they are (sync: here, at once, for a run that has no page to keep going).
  set(real, tier, sync) {
    this.real = real;
    this.tier = tier;
    const want = this.wants(real, tier);
    if (want && !this.built) {
      if (sync) this.build();
      else this.warm();
    }
    if (sync) this.level = 1;
    const on = want && this.built;
    if (on !== this.enabled) {
      this.enabled = on;
      this.fit();
    }
  }

  // Whether a style (its real share) and a tier have it drawn.
  wants(real, tier) {
    return this.capable && real > 0 && AO.slices[tier] > 0 && !this.off;
  }

  // Every frame: it comes in over half a second, the first time.
  advance(dt) {
    if (this.enabled && this.level < 1) this.level = Math.min(1, this.level + dt * 2);
  }

  setSize(w, h) {
    this.size = [w, h];
    this.fit();
  }

  // The targets are the frame's size (and half of it) while the pass is on and a
  // pixel while it is not.
  fit() {
    const [w, h] = this.enabled ? this.size : [1, 1];
    const hw = Math.max(1, Math.ceil(w / 2));
    const hh = Math.max(1, Math.ceil(h / 2));
    for (const t of [this.z, this.raw, this.blurred]) t.setSize(hw, hh);
    this.factor.setSize(w, h);
    this.half = [hw, hh];
    this.uniforms.uFull.value.set(w, h);
    this.uniforms.uHalf.value.set(hw, hh);
  }

  _warmScene() {
    const scene = new THREE.Scene();
    const geometry = new THREE.PlaneGeometry(2, 2);
    for (const m of Object.values(this.materials)) scene.add(new THREE.Mesh(geometry, m));
    return { scene, geometry, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  }

  // Build the programs now, as they are drawn (to a target).
  build() {
    if (this.built) return;
    const { scene, geometry, camera } = this._warmScene();
    const pixel = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    const was = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(pixel);
    try {
      this.renderer.compile(scene, camera);
    } finally {
      this.renderer.setRenderTarget(was);
    }
    pixel.dispose();
    geometry.dispose();
    this.built = true;
  }

  // Build them ahead, in the compiler's threads; resolves when they are built. Built once.
  warm() {
    if (this._warm) return this._warm;
    const renderer = this.renderer;
    if (!renderer.compileAsync) {
      this.build();
      return (this._warm = Promise.resolve());
    }
    const { scene, geometry, camera } = this._warmScene();
    const pixel = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    const was = renderer.getRenderTarget();
    renderer.setRenderTarget(pixel);
    let built;
    try {
      built = renderer.compileAsync(scene, camera);
    } finally {
      renderer.setRenderTarget(was);
    }
    this._warm = built.then(() => {
      pixel.dispose();
      geometry.dispose();
      this.built = true;
    });
    return this._warm;
  }

  _draw(renderer, material, target) {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  render(renderer, writeBuffer, readBuffer) {
    const depth = this.tap.target ? this.tap.target.depthTexture : null;
    if (!depth || !(this.real * this.level > 0)) return;
    const u = this.uniforms;
    const m = this.materials;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const e = cam.projectionMatrix.elements;
    const tan = [1 / e[0], 1 / e[5]];
    const frame = this.size[1];
    const half = this.half[1];
    u.tColor.value = readBuffer.texture;
    u.tDepth.value = depth;
    u.uNearFar.value.set(cam.near, cam.far);
    u.uTan.value.set(tan[0], tan[1]);
    u.uCamWorld.value.copy(cam.matrixWorld);
    u.uPerUnit.value = half / (2 * tan[1]);
    u.uFoot.value = 2 * tan[1] / half;
    u.uMaxTexels.value = AO.maxPx * frame / 1080 / 2;
    u.uFall.value.set(AO.radius * (1 - AO.falloff), AO.radius * AO.falloff);
    u.uSlices.value = AO.slices[this.tier] || 1;
    u.uStrength.value = AO.strength * this.real * this.level;
    u.uBloom.value = this.bloom ? this.bloom.threshold : 1.1;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    this._draw(renderer, m.depth, this.z);
    this._draw(renderer, m.trace, this.raw);
    this._draw(renderer, m.blur, this.blurred);
    this._draw(renderer, m.factor, this.factor);
    // Into the frame it is read from, where it stands: nothing of the frame's depth is sampled by this
    // draw, though the target has it attached.
    this._draw(renderer, m.apply, readBuffer);
    renderer.autoClear = auto;
  }

  dispose() {
    for (const m of Object.values(this.materials)) m.dispose();
    for (const t of [this.z, this.raw, this.blurred, this.factor]) t.dispose();
    super.dispose();
  }
}
