// Sky, aerial perspective and image-based light, from one set of numbers.
//
// The sky dome and the fog on every surface evaluate the same horizon colour
// and the same sun glow, so a ridge 6 km away dissolves into exactly the sky
// behind it. Fog thins with height (a valley fills with haze, a summit stands
// clear of it) and warms toward the sun. The environment map that lights the
// car paint and the wet-looking asphalt is rendered from this same sky.

import * as THREE from 'three';
import { beamU, patchBeam } from './headbeam.js';
import { patchLighting, patchFigureVertex, styleU, skyStyle, skyLight, skyDay, skyCloudShade, paintedSky, paintedNight, pairProgram, pairUniforms, pairStepNow, printInks, PRINT_INKS, setPalettes, FLASH_WASH, WIND } from './style.js';

import { twistU, skyTurnU, TWIST_PARS } from './twist.js';
import { RING_N, ringU } from './ring.js';
import { Clouds } from './clouds.js';
import { Cirrus } from './cirrus.js';
import { CIRRUS } from '../world/cirrus.js';
import { SpaceSky, SPACE_UNIFORMS, SPACE_FUNCS } from './spacesky.js';


// How much of the space world's noise a page works out a frame (about this many hashes of it: well
// under a millisecond), and how many seconds without the space world in view the textures it is in are kept.
const MAPS_SLICE = 150000;
const MAPS_KEEP = 20;

// The sky's mean light is taken on a cube this many texels a face.
const DIFFUSE_N = 16;

// The sun's shadow, from two maps of 2048 texels (the high and the mid tier): the near one is 70 m across
// (a texel is 3.4 cm) and its centre stands `aim[0]` m ahead of the lens, the far one is 360 m across
// (17.6 cm) about a centre `aim[1]` m ahead. Each is moved by whole texels, so that what the land casts
// stands still on it as the lens goes by. The near one is drawn every frame, the far one (it holds what
// is far, and moves a texel a frame) again every `every` frames. The low tier has one map of 1024 texels,
// 180 m across, about the near map's centre. A map's centre is kept within its half-width less `keep` m of
// the car, which is always in the near map; the far map takes over from the near one over its outer `blend`
// m. How far a map is biased is in texels: a share of a texel as the constant, and of a texel per unit of the
// tangent of the angle between a face's normal and the sun (the tangent is held to `slope`), and the near
// map pushes a face out along its normal by `normal` of a texel.
const SHADOW = {
  near: 35,
  far: 180,
  alone: 90,
  size: 2048,
  aloneSize: 1024,
  aim: [17, 35],
  keep: [8, 24],
  reset: [3, 16],
  pad: [6, 30],
  blend: 4,
  every: { high: 2, mid: 3 },
  planes: [10, 900],
  dist: 400,
  slope: 6,
  normal: 0.9,
  bias: { near: [0.25, 1.25], far: [0.6, 1.3] },
};
const _lens = new THREE.Vector3();
const _inv = new THREE.Matrix4();

// A mesh drawn as many instances (its count) that casts into the near shadow map and not the far one:
// what moves (the other cars, the animals) would be a frame behind in a map drawn every other frame, and
// what is a few centimetres across (a blade of grass) is lost in texels 17.6 cm wide.
export function nearShadowOnly(mesh) {
  mesh.onBeforeShadow = function (renderer, object, camera, shadowCamera) {
    this.userData.drawn = this.count;
    if (shadowCamera.userData.cascade === 1) this.count = 0;
  };
  mesh.onAfterShadow = function () { this.count = this.userData.drawn; };
  return mesh;
}

// How much of the sun a pixel the sun reaches is given, for the painted style's
// paints to take (uPairInvSun), where a look says there is less of a shadow than
// the sun makes (look.shadow, 1 for as it is). The style goes from its shade
// paint to its lit one as that share goes between the two ends of the style's
// pair step (pairStepNow), in a smooth step; the share that gives a lit pixel `shadow` of the way is where that
// step is `shadow` of the way, so that the lit paint stands `shadow` of the way
// off the shade paint, and a pixel the sun does not reach (a share of 0) still
// has none of it.
function sunShare(shadow) {
  if (!(shadow < 1)) return 1;
  const x = 0.5 - Math.sin(Math.asin(1 - 2 * Math.max(shadow, 0)) / 3);
  return pairStepNow[0] + (pairStepNow[1] - pairStepNow[0]) * x;
}

// A night's stars in the painted style (the sky shader): the cells the dome is
// laid with, a tenth of a radian across and as many to a row as fit round at
// its height, and how many there are of them. (How wide a star is, in pixels,
// is the style's: starPx.)
const STAR_STEP = 0.1;
let STAR_CELLS = 0;
for (let row = 0; row * STAR_STEP < Math.PI / 2; row++) STAR_CELLS += Math.max(Math.floor(2 * Math.PI * Math.cos((row + 0.5) * STAR_STEP) / STAR_STEP), 1);

// The painted sky's three colours (the zenith's, the middle's and the horizon's,
// linear RGB) and how they are laid (uPaintShape, render/worldlook.js): the sky
// has them, and so has what stands in its place where it cannot be seen, the
// surface of the sea seen from under it (render/water.js).
export const skyBandsU = {
  uPaintZ: { value: new THREE.Vector3() },
  uPaintM: { value: new THREE.Vector3() },
  uPaintH: { value: new THREE.Vector3() },
  uPaintShape: { value: new THREE.Vector4(0, 0.15, 0.3, 0.02) },
};

// Shared uniform objects: every material that opts in references these, so a
// change of light or weather is one assignment, not a traversal.
export const atmo = {
  fogParams: { value: new THREE.Vector3(0.00016, 0, 650) },   // density, base height, falloff
  fogSunDir: { value: new THREE.Vector3(0.5, 0.4, 0.5).normalize() },
  fogSunColor: { value: new THREE.Color(0xffd7a8) },
  // Scales the sky's image-based light (diffuse and reflections) on every
  // material: the sky goes out in a tunnel. three.js r160 has no
  // scene.environmentIntensity, so it is applied in the shader.
  uEnvScale: { value: 1 },
  // The diffuse share of that light, scaled apart from the reflections (see Atmosphere.bakeEnvironment).
  uEnvDiffuse: { value: new THREE.Vector3(1, 1, 1) },
  // The view turned over (render/twist.js).
  ...twistU,
  // The weather in each direction a few kilometres off (render/weather.js).
  ...ringU,
  // How uneven the haze is (0 even; render/style.js, fogVar) over drifts laid on the world, and the
  // floating origin they are read by (the style's own vector, absolute metres).
  uFogVar: { value: 0 },
  uFogOrg: { value: styleU.uOriginAbs.value },
};

// Height fog with sun in-scatter. vFogWorld is rebuilt from the view-space
// position with the camera's own matrices, which every three.js vertex shader
// has, so this works for sprites and points as well as meshes.
//
// Where the world is wound over (render/twist.js) the haze is read from a
// thing as it stands, not as it is drawn; and that is right for what is
// drawn where it stands, and for what is past the winding and hangs level
// the other way up: both are far off where the sky is the haze's colour. It
// is wrong for what the fold has lifted in between: there the far haze's
// colour would be a wall of horizon standing in front of the zenith. So what
// is lifted (by the angle between where it is drawn and the nearer of those
// two places, FOLD_LIFT) and far (HAZE_FAR: the near air is the camera's
// own, whatever is behind) goes into the sky itself as it goes into the
// haze, and goes altogether before the land's far edge (FOLD_ENDS), which
// the horizon no longer hides:
//  - the land and the liquids (FOLD_ALPHA) are drawn that much thinner, over
//    the sky as it is (what the fold shows from underneath is seen to in
//    render/terrain.js and render/water.js);
//  - anything else, which cannot be drawn thinner (its alpha says what it
//    is, render/style.js), is hazed as it would be and, once FOLD_CUT of it
//    has gone, not drawn;
//  - and as a thing goes it is drawn deeper, out to the far plane (past it
//    is the not being drawn): a drawn style that inks the edge where the
//    land meets the sky finds none round what has gone.
const FOLD_LIFT = [0.03, 0.25];      // rad between the two: none of it lifted, all of it
const FOLD_ENDS = [4500, 6300];      // m from the lens; the land is drawn to 6500 (render/terrain.js)
const FOLD_CUT = 0.83;
// The painted style's air (the fog chunk): density per metre at sea level, how
// thin it is on a summit, the layers it is cut into, and how much bluer than
// the painted horizon the haze is (its tone is taken that far toward the
// painted middle of the sky: a ridge is a little bluer than the pale sky
// behind it). How far it is cut into the layers, and how sharp their edges
// are, a style says (airCut, airEdge).
const AIR = { k: '0.00033', thin: '0.5', steps: 6, blue: 0.52 };
// The air between the lens and a thing is the camera's own up to HAZE_FAR[0]
// m, and from HAZE_FAR[1] the weather of the world out there.
const HAZE_FAR = [250, 1800];
// The real style's cirrus (world/cirrus.js): the plane it lies in is laid over the sky in the
// wind's own axes (along it, across it: the streaks run along it) and taken along at this
// many metres a second, a tenth of that across.
const CIRRUS_WIND = 14;
const WIND_LEN = Math.hypot(WIND[0], WIND[1]);
const CIRRUS_AXIS = [WIND[0] / WIND_LEN, WIND[1] / WIND_LEN];
// The haze's drifts, metres across (the fog chunks below; render/style.js, fogVar).
const FOG_DRIFT = 800;
// How many taps beyond the five that find it the soft edge of a real heap takes, by tier
// (the low tier has the baked texel's own edge).
const CLOUD_SOFT = { high: 12, mid: 6, low: 0 };
THREE.ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG
  uniform vec3 fogParams;
  uniform float uFogVar;
  uniform vec3 uFogOrg;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  varying float vFogK;
  #ifdef FOLD_ALPHA
    varying vec2 vFold;
  #endif
  // The drifts of the haze: a smooth noise laid on the world, a cell of it FOG_DRIFT metres across.
  float fogCell( vec2 p ) {
    vec3 q = fract( vec3( p.xyx ) * 0.1031 );
    q += dot( q, q.yzx + 33.33 );
    return fract( ( q.x + q.y ) * q.z );
  }
  float fogDrift( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( fogCell( i ), fogCell( i + vec2( 1.0, 0.0 ) ), f.x ), mix( fogCell( i + vec2( 0.0, 1.0 ) ), fogCell( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
  }
#endif
`;
THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = cameraPosition + transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
  // How thick the haze is along the way to this vertex, against the even haze: its drifts read at two
  // points of the way (as far as the first 6 km of it), more of it the further off it is (none
  // within 120 m, where there is no haze to speak of).
  vFogK = 1.0;
  if ( uFogVar > 0.0 ) {
    vec2 fogWay = vFogWorld.xz - cameraPosition.xz;
    float fogLen = length( fogWay );
    if ( fogLen > 120.0 ) {
      vec2 fogFrom = cameraPosition.xz + uFogOrg.xz;
      vec2 fogStep = fogWay * ( min( fogLen, 6000.0 ) / fogLen );
      float fogMean = 0.5 * ( fogDrift( ( fogFrom + fogStep * 0.3 ) / ${FOG_DRIFT.toFixed(1)} ) + fogDrift( ( fogFrom + fogStep * 0.8 ) / ${FOG_DRIFT.toFixed(1)} ) );
      vFogK = 1.0 + uFogVar * ( 2.0 * fogMean - 1.0 ) * smoothstep( 120.0, 400.0, fogLen );
    }
  }
  #ifdef FOLD_ALPHA
    vFold = vec2( 0.0 );
  #endif
  if ( uTwist.x > 0.5 ) {
    vec3 foldSeen = normalize( twistDrawn );
    vec3 foldFrom = mvPosition.xyz - uTwistAt.xyz;
    vec3 foldOver = 2.0 * dot( uTwistAxis.xyz, foldFrom ) * uTwistAxis.xyz - foldFrom + uTwistAt.xyz;
    vec3 foldRay = vFogWorld - cameraPosition;
    float foldDist = length( foldRay );
    float foldLift = smoothstep( ${FOLD_LIFT[0].toFixed(2)}, ${FOLD_LIFT[1].toFixed(2)},
      min( distance( foldSeen, normalize( mvPosition.xyz ) ), distance( foldSeen, normalize( foldOver ) ) ) )
      * smoothstep( ${HAZE_FAR[0].toFixed(1)}, ${HAZE_FAR[1].toFixed(1)}, foldDist );
    float foldEnds = smoothstep( ${FOLD_ENDS[0].toFixed(1)}, ${FOLD_ENDS[1].toFixed(1)}, length( foldRay.xz ) );
    // The haze as the fragment shader will have it, near enough.
    float foldFog = 0.0;
    if ( fogParams.z > 0.5 ) {
      float fk = 1.0 / fogParams.z;
      float fy = foldRay.y * fk;
      float fs = abs( fy ) > 1e-4 ? ( 1.0 - exp( - fy ) ) / fy : 1.0;
      foldFog = 1.0 - exp( - fogParams.x * foldDist * exp( - ( cameraPosition.y - fogParams.y ) * fk ) * fs );
    }
    float foldGone = foldLift * ( foldFog + ( 1.0 - foldFog ) * foldEnds );
    #ifdef FOLD_ALPHA
      vFold = vec2( foldLift, foldLift * foldEnds );
    #else
      foldGone += 2.0 * step( ${FOLD_CUT.toFixed(2)}, foldGone );
    #endif
    gl_Position.z = mix( gl_Position.z, gl_Position.w, foldGone * 1.02 );
  }
#endif
`;
THREE.ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec3 fogParams;
  uniform vec3 fogSunDir;
  uniform vec3 fogSunColor;
  uniform vec4 uRingH[ ${RING_N} ];
  uniform float uRingOn;
  #ifdef STYLE_PAIR
    uniform float uAir;
    uniform vec3 uAirH;
    uniform vec3 uAirTint;
    uniform float uAirCut;
    uniform vec2 uAirEdge;
    uniform vec4 uAirFlash;
    uniform float uPaintInv;
  #endif
  varying float vFogDepth;
  varying vec3 vFogWorld;
  varying float vFogK;
  #ifdef FOLD_ALPHA
    varying vec2 vFold;
  #endif
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`;
THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  float fogFactor;
  vec3 fogCol = fogColor;
  if ( fogParams.z > 0.5 ) {
    vec3 fogRay = vFogWorld - cameraPosition;
    float fogDist = length( fogRay );
    vec3 fogDir = fogRay / max( fogDist, 1e-3 );
    float sunAmt = pow( max( dot( fogDir, fogSunDir ), 0.0 ), 8.0 );
    vec3 haze = fogColor;
    #ifdef STYLE_PAIR
    fogFactor = 0.0;
    // The painted style's air (farPaint): thinner with height, toward the
    // painted horizon, and cut into layers, so that one ridge behind
    // another is plainly a layer further off. Where it is all of the air, the
    // weather out there (the ring of horizons) is not read.
    if ( uAir < 1.0 ) {
    #endif
    float k = 1.0 / fogParams.z;
    float hc = ( cameraPosition.y - fogParams.y ) * k;
    float dy = fogRay.y * k;
    float spread = abs( dy ) > 1e-4 ? ( 1.0 - exp( - dy ) ) / dy : 1.0;
    float optical = fogParams.x * fogDist * exp( - hc ) * spread * vFogK;
    fogFactor = 1.0 - exp( - optical );
    // Far from the lens the air is the weather of the world out there, in
    // the way this is seen (render/weather.js); near it, the camera's own.
    float fr = ( atan( fogDir.z, fogDir.x ) * 0.159155 + 0.5 ) * ${RING_N}.0 - 0.5;
    float fb = floor( fr );
    int f0 = int( mod( fb + ${RING_N}.0, ${RING_N}.0 ) );
    int f1 = int( mod( fb + ${RING_N + 1}.0, ${RING_N}.0 ) );
    vec3 farCol = mix( uRingH[ f0 ].rgb, uRingH[ f1 ].rgb, fr - fb );
    haze = mix( fogColor, farCol, uRingOn * smoothstep( ${HAZE_FAR[0].toFixed(1)}, ${HAZE_FAR[1].toFixed(1)}, fogDist ) );
    #ifdef STYLE_PAIR
    }
    if ( uAir > 0.0 ) {
      float airThin = mix( 1.0, ${AIR.thin}, smoothstep( 250.0, 2400.0, vFogWorld.y ) );
      float air = 1.0 - exp( - fogDist * ${AIR.k} * airThin );
      float airS = air * ${AIR.steps}.0;
      air = mix( air, ( floor( airS ) + smoothstep( uAirEdge.x, uAirEdge.y, fract( airS ) ) ) / ${AIR.steps}.0, uAirCut );
      fogFactor = mix( fogFactor, air, uAir );
      haze = mix( haze, uAirH * uAirTint * uPaintInv, uAir );
      // In the flash of a painted night's lightning the haze is the sky's one colour.
      haze = mix( haze, uAirFlash.rgb * uPaintInv, uAirFlash.a * uAir );
    }
    #endif
    fogCol = mix( haze, fogSunColor, sunAmt );
  } else {
    #ifdef FOG_EXP2
      fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
  }
  #ifdef FOLD_ALPHA
    if ( uTwist.x > 0.5 ) {
      // How much of it has gone into the sky; what is left of it is in the
      // haze by what is left of the haze's share.
      float foldGone = vFold.x * fogFactor + ( 1.0 - fogFactor ) * vFold.y;
      gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor * ( 1.0 - vFold.x ) / max( 1.0 - foldGone, 1e-3 ) );
      gl_FragColor.a *= 1.0 - foldGone;
    } else {
      gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
    }
  #else
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
  #endif
#endif
`;

// Opt a material into the shared atmosphere uniforms, chaining any existing
// onBeforeCompile hook. It also takes the style's light (render/style.js);
// a material with userData.mark (one of style.js's MARK) marks what it is
// for the style's last pass.
const hooked = new Set();
pairProgram.listeners.push(() => { for (const m of hooked) m.needsUpdate = true; });

// The lit materials' programs of the other kind (with the paired paints in
// them where the style drawn has none, or the other way about), built ahead
// of the first change to such a style: three starts each and does not wait,
// so when the change comes they are there. Built at the change itself, the
// frame that first drew with them took 110 ms on the GPU (30 before there
// were two kinds). Once, a moment after the first frame, when the page is
// still putting itself together.
// What else has programs to build ahead in that other kind: each is called
// with (renderer, scene, camera) while it is the one drawn with (the grass's
// ground map draws the land with a material that no mesh holds between its
// passes, which compiling the scene does not find).
export const warmHooks = [];
function warmPrograms(renderer, scene, camera) {
  const was = pairProgram.on;
  pairProgram.on = !was;
  for (const m of hooked) m.needsUpdate = true;
  compileAsDrawn(renderer, scene, camera);
  for (const h of warmHooks) h(renderer, scene, camera);
  pairProgram.on = was;
  for (const m of hooked) m.needsUpdate = true;
}

// Build a scene's programs ahead, as they will be when it is drawn. three
// makes a program for where it is drawing to: for the canvas it has the tone
// mapping and the canvas's colour space in it, and the game draws its scene
// into a target (render/post.js), where it has neither. Built with no target
// set, the programs are the canvas's, and the first frame builds them again.
let warmTarget = null;
export function compileAsDrawn(renderer, scene, camera) {
  if (!warmTarget) warmTarget = new THREE.WebGLRenderTarget(1, 1);
  const was = renderer.getRenderTarget();
  renderer.setRenderTarget(warmTarget);
  renderer.compile(scene, camera);
  renderer.setRenderTarget(was);
}

// What of an object, besides its material, its program depends on.
function drawKind(o) {
  const g = o.geometry;
  const a = g && g.attributes;
  return (o.isInstancedMesh ? (o.instanceColor ? 'ic' : 'i') : '') + (o.isSkinnedMesh ? 's' : '')
    + (o.isPoints ? 'p' : o.isLine ? 'l' : '')
    + (a ? (a.color ? 'v' + a.color.itemSize : '') + (a.uv1 ? 'u' : '') + (a.tangent ? 't' : '') : '')
    + (g && g.morphAttributes && g.morphAttributes.position ? 'm' : '');
}

// One object of each kind for each material of those `visit` walks (and
// `keep` passes), so that building a scene's programs goes by their number, not
// the objects' (a forest is hundreds of meshes of a few materials).
function distinct(visit, keep = null) {
  const seen = new Map();
  visit((o) => {
    const m = o.material;
    if (!m) return;
    const kind = drawKind(o);
    for (const mat of Array.isArray(m) ? m : [m]) {
      if (keep && !keep(mat)) continue;
      const key = mat.uuid + kind;
      if (!seen.has(key)) seen.set(key, { mat, o });
    }
  });
  return [...seen.values()];
}

// Start building the programs of some objects as they are drawn in the scene
// (with its lights and fog), several at a time in the compiler's threads. The
// promise is kept when they are built.
export function compileObjects(renderer, scene, camera, objects) {
  if (!warmTarget) warmTarget = new THREE.WebGLRenderTarget(1, 1);
  const was = renderer.getRenderTarget();
  renderer.setRenderTarget(warmTarget);
  try {
    // (Three walks what it is given with traverse, for lights with traverseVisible.)
    const list = { traverse: (f) => objects.forEach(f), traverseVisible: () => {} };
    return renderer.compileAsync(list, camera, scene);
  } finally {
    renderer.setRenderTarget(was);
  }
}

// The programs of what the scene draws now, started while the page goes on.
export function compileAhead(renderer, scene, camera) {
  const objects = [...new Set(distinct((f) => scene.traverseVisible(f)).map((e) => e.o))];
  return compileObjects(renderer, scene, camera, objects);
}

export function withAtmosphere(material) {
  const prev = material.onBeforeCompile;
  hooked.add(material);
  material.addEventListener('dispose', () => hooked.delete(material));
  // Of the program with the paired paints in it, or without: what is marked as
  // life or as the car (marks under 0.62) and what is drawn blended (the car's
  // glass, which shows what is behind it) keep the light they had, so they are
  // not of it unless they are figures (userData.figure: the car and its glass,
  // the other cars, the animals), which the painted style draws in flat paints
  // of their own, not the pair of the land: a shade turned toward blue is wrong
  // on a car's paint (a red car went pink). All of them are bound to the light
  // they had (below), which a figure keeps where its paints weigh nothing, in a
  // world lit by night (render/style.js, ST_PAIR).
  const lifeLike = () => { const mk = material.userData.mark || 0; return material.transparent || (mk > 0 && mk < 0.62); };
  const figure = () => !!material.userData.figure && lifeLike();
  const paired = () => pairProgram.on && (!lifeLike() || figure());
  material.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, atmo, styleU);
    shader.uniforms.uMarkSelf = { value: material.userData.mark || 0 };
    shader.uniforms.uLiftSelf = { value: material.userData.styleLift ? 1 : 0 };
    shader.uniforms.uClumpSelf = { value: material.userData.styleClump ? 1 : 0 };
    // A material that gives its own paints (the style's pair):
    // userData.paints = { lit, shade }, each a THREE.Color or [r, g, b]
    // (linear), instead of having them worked out from its albedo. A figure
    // adds deep, what the shape of its paint is (1 a highlight, 2 stripes) and,
    // for stripes, the point of the model they are centred on.
    if (lifeLike()) {
      // The uniforms of the old light, for the shader that has no choice to make.
      shader.uniforms.uRampAt = styleU.uRampAtL;
      shader.uniforms.uRampLv = styleU.uRampLvL;
      shader.uniforms.uShadeTint = styleU.uShadeTintL;
      shader.uniforms.uShadeEnv = styleU.uShadeEnvL;
      shader.uniforms.uShadowK = styleU.uShadowKL;
    }
    const mk2 = material.userData.mark || 0;
    const pp = pairUniforms(mk2 >= 0.89 && mk2 < 0.95, !!material.userData.styleClump);
    shader.uniforms.uPairP = pp.p;
    shader.uniforms.uPairT = pp.t;
    const own = material.userData.paints;
    shader.uniforms.uPairLit = { value: own ? new THREE.Color().fromArray(own.lit.toArray ? own.lit.toArray() : own.lit) : new THREE.Color() };
    shader.uniforms.uPairShade = { value: own ? new THREE.Color().fromArray(own.shade.toArray ? own.shade.toArray() : own.shade) : new THREE.Color() };
    if (figure()) {
      const deep = own && own.deep ? own.deep : own && own.shade;
      shader.uniforms.uPairDeep = { value: deep ? new THREE.Color().fromArray(deep.toArray ? deep.toArray() : deep) : new THREE.Color() };
      shader.uniforms.uFigShape = { value: own && own.shape ? own.shape : 0 };
      shader.uniforms.uFigC = { value: new THREE.Vector3().fromArray(own && own.center ? own.center : [0, 0, 0]) };
    }
    if (prev) prev.call(material, shader, renderer);
    // How far a face is turned from the sun, for the shadow's bias (render/style.js, getShadowCascades).
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n#ifdef USE_SHADOWMAP\nvarying float vShSlope;\nuniform vec3 uSunDirW;\n#endif')
      .replace('#include <shadowmap_vertex>', `#include <shadowmap_vertex>
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
{
  float stFacing = clamp( dot( shadowWorldNormal, uSunDirW ), 0.0, 1.0 );
  vShSlope = min( sqrt( 1.0 - stFacing * stFacing ) / max( stFacing, 0.2 ), ${SHADOW.slope.toFixed(1)} );
}
#endif`);
    const ownFigure = paired() && figure() && !!own;
    if (ownFigure) shader.vertexShader = patchFigureVertex(shader.vertexShader);
    // At this point iblIrradiance, radiance and clearcoatRadiance hold only
    // the environment's contribution.
    let fragment = (paired() ? '#define STYLE_PAIR\n' + (figure() ? '#define STYLE_FIG\n' : '') + (material.userData.paints ? '#define STYLE_PAIR_OWN\n' : '') : '') + patchLighting(shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uEnvScale;\nuniform vec3 uEnvDiffuse;')
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
  iblIrradiance *= uEnvScale;
  iblIrradiance *= uEnvDiffuse;
  radiance *= uEnvScale;
  #ifdef USE_CLEARCOAT
    clearcoatRadiance *= uEnvScale;
  #endif
#endif`));
    // A figure's own paints are what the material says (a road's are worked
    // out where the road knows more of the pixel: render/roadmesh.js).
    if (ownFigure) fragment = fragment.replace('#include <map_fragment>', '#include <map_fragment>\nstOwnLit = uPairLit;\nstOwnShade = uPairShade;');
    // The dipped beam's pattern is on the spot light in the programs that are not the painted style's. (Both kinds
    // take its uniforms: three keeps those of the program built last for the material, whichever kind is drawn.)
    Object.assign(shader.uniforms, beamU);
    if (!paired()) fragment = patchBeam(fragment);
    shader.fragmentShader = fragment;
  };
  const below = material.customProgramCacheKey;
  material.customProgramCacheKey = () => (below ? below.call(material) : '') + '|atmo' + (paired() ? (material.userData.paints ? '|pairown' : '|pair') + (figure() ? '-fig' : '') : '');
  return material;
}

// The sun as seen from the car: how much of it gets past the ridges. Set each
// frame by the game; the car and the traffic read it.
export const sunMask = { value: 1 };

// How much of the sky's light reaches the inside of a tunnel bore, and the car,
// as seen from where the camera is. Both are 1 unless the lens is outside and
// the subject inside: then the bore reads as the dark mouth it is.
export const boreSky = { value: 1 };
export const carSky = { value: 1 };

// Scale the sky's share of the light on a material (hemisphere fill and the
// environment) by a uniform, where a fragment expression is 1: the tunnel
// bore everywhere, the asphalt only inside one.
export function withSkyScale(material, uniform, where = '1.0') {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(material, shader, renderer);
    shader.uniforms.uSkyScale = uniform;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSkyScale;')
      .replace('#include <lights_fragment_end>', `{
  float skyK = mix(1.0, uSkyScale, ${where});
  irradiance *= skyK;
  #if defined( RE_IndirectSpecular )
    iblIrradiance *= skyK;
    radiance *= skyK;
  #endif
}
#include <lights_fragment_end>`);
  };
  // Read each time, not once: what is below may change (withAtmosphere's pair).
  const below = material.customProgramCacheKey;
  material.customProgramCacheKey = () => (below ? below.call(material) : '') + '|sky';
  return material;
}

// Scale direct sunlight by a mask, either per vertex (aSun, baked by the road
// mesh from the same ray march the terrain uses) or by the shared uniform.
// Without it the road and the car stay sunlit in the shadow a ridge casts on
// the whole valley, which is the first thing the eye notices.
export function withSunMask(material, perVertex) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(material, shader, renderer);
    if (perVertex) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSun;\nvarying float vSunMask;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSunMask = aSun;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vSunMask;');
    } else {
      shader.uniforms.uSunMask = sunMask;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uSunMask;\n#define vSunMask uSunMask');
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>',
      THREE.ShaderChunk.lights_fragment_begin.replace(
        'getDirectionalLightInfo( directionalLight, directLight );',
        'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= vSunMask;',
      ));
  };
  const below = material.customProgramCacheKey;
  material.customProgramCacheKey = () => (below ? below.call(material) : '') + (perVertex ? '|sunv' : '|sunu');
  return material;
}

// The sky's uniforms, for both of its shaders.
const SKY_UNIFORMS = /* glsl */`
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uGlow;
uniform float uSunSize;
uniform float uTime;
uniform float uCloud;
uniform float uStars;
uniform float uPlanet;
uniform float uCumulus;
uniform float uSkyPaint;
uniform float uSkyDeep;
uniform float uSkyBlue;
uniform float uSkySat;
uniform float uTowers;
uniform float uBlockSky;
uniform float uSkyCol;
uniform float uSkyStep;
uniform float uStarPx;
uniform vec2 uSkyAt;
uniform vec3 uBandZ;
uniform vec3 uBandM;
uniform vec3 uBandH;
uniform float uPaintInv;
uniform vec3 uPaintZ;
uniform vec3 uPaintM;
uniform vec3 uPaintH;
uniform float uPaintK;
uniform vec3 uRealZ;
uniform vec3 uRealM;
uniform vec3 uRealH;
uniform float uRealK;
uniform float uSkyReal;
uniform vec4 uPaintShape;
uniform float uPaintStars;
uniform float uNightClouds;
uniform float uUpside;
uniform float uFlash;
uniform vec4 uBolt;
uniform vec4 uSkyTurn;
uniform vec4 uSkyAxis;
uniform vec4 uRingH[ ${RING_N} ];
uniform vec4 uRingZ[ ${RING_N} ];
uniform vec4 uRingG[ ${RING_N} ];
uniform float uRingOn;
#ifdef SKY_HEAPS
uniform float uHeaps;
uniform float uHeapsTones;
uniform vec3 uCloudLit;
uniform vec3 uCloudMid;
uniform vec3 uCloudShade;
uniform vec3 uCloudUnder;
uniform samplerCube uCloudA;
uniform samplerCube uCloudB;
uniform float uCloudT;
// The real style's clouds: how far they are its own, how many taps their soft edge takes
// beyond the five that find it, how much of the light is the sun's and not a grey sky's, the
// paint of a heap (lit, middle, shaded side, underside), and its veil of cirrus: how much of it,
// and the tile it is made of.
uniform float uCloudReal;
uniform float uCloudSoft;
uniform float uSunny;
uniform vec3 uRCloudLit;
uniform vec3 uRCloudMid;
uniform vec3 uRCloudShade;
uniform vec3 uRCloudUnder;
uniform float uCirrus;
uniform sampler2D uCirrusTex;
#endif
${SPACE_UNIFORMS}
`;

// The sky's own colour in a direction d of the dome, y its height, before
// anything is drawn in it: the gradient from the horizon up, as the weather
// round the camera and the style have it, and the sun's glow. It leaves col,
// and hzn, zn, glw, cld, stars, mu, up and day for what is drawn after.
const SKY_BASE = /* glsl */`
  float mu = max(dot(d, uSunDir), 0.0);
  // The weather round the camera (render/weather.js): low down, toward the
  // horizon, a sky is far off and shows the look of the world out there in
  // this direction; overhead it is the camera's own.
  float rf = ( atan( d.z, d.x ) * 0.159155 + 0.5 ) * ${RING_N}.0 - 0.5;
  float rb = floor( rf );
  float rk = rf - rb;
  int r0 = int( mod( rb + ${RING_N}.0, ${RING_N}.0 ) );
  int r1 = int( mod( rb + ${RING_N + 1}.0, ${RING_N}.0 ) );
  float farW = uRingOn * ( 1.0 - smoothstep( 0.3, 0.9, y ) );
  vec4 rH = mix( uRingH[ r0 ], uRingH[ r1 ], rk );
  vec4 rZ = mix( uRingZ[ r0 ], uRingZ[ r1 ], rk );
  vec4 rG = mix( uRingG[ r0 ], uRingG[ r1 ], rk );
  vec3 hzn = mix( uHorizon, rH.rgb, farW );
  vec3 zn = mix( uZenith, rZ.rgb, farW * 0.7 );
  vec3 glw = mix( uGlow, rG.rgb, farW );
  float cld = mix( uCloud, rH.a, farW );
  float stars = mix( uStars, rZ.a, farW );

  // Rayleigh-ish gradient: deep at the zenith, pale and bright at the horizon.
  float up = clamp(y, 0.0, 1.0);
  vec3 col = mix(hzn, zn, pow(up, 0.42));
  col = mix(col, uGround, smoothstep(0.0, -0.18, y));
  // A day's sky, as against a night's, the inferno's or space's: the painted
  // style's blue and clouds are for a day; the others keep their own.
  float day = smoothstep(0.02, 0.06, dot(zn, vec3(0.2126, 0.7152, 0.0722)));
  // A deeper blue overhead, for the drawn styles (render/style.js).
  if (uSkyDeep > 0.0) col = mix(col, col * vec3(0.72, 0.88, 1.16), uSkyDeep * smoothstep(0.04, 0.75, y));
  // A fuller blue all the way down, and a deep one coming down close to the
  // horizon: the sky is drawn before the exposure, which would bleach a pale
  // blue white.
  if (uSkySat > 0.0) {
    float sl = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = max(mix(vec3(sl), col, 1.0 + uSkySat * day), 0.0);
  }
  if (uSkyBlue > 0.0) {
    vec3 kd = mix(vec3(0.97, 0.99, 1.02), vec3(0.3, 0.52, 1.04), smoothstep(0.0, 0.38, y));
    col = mix(col, col * kd, uSkyBlue * day);
  }

  // A day's sky in three colours of its own: the zenith, the middle and the
  // horizon, from the world (paintSky) and mixed across a border, divided by
  // the exposure so that they come out as written. It stands in for all the
  // above, and the ground still shows under the horizon.
  if (uSkyCol > 0.0 && uPaintK > 0.0) {
    float h = max(y, 0.0);
    vec3 pc = mix(uPaintH, uPaintM, smoothstep(0.0, 0.15, pow(h, 0.8)));
    pc = mix(pc, uPaintZ, smoothstep(0.3, 0.95, h)) * uPaintInv;
    // Two bands (uSkyStep, the cel style): the middle's colour from one height
    // and the zenith's from another, each edge a pixel or two wide, each of the
    // three the world's colour in the style's tint.
    float skyEdge = max(pxAng, 1e-4) * 1.2;
    if (uSkyStep > 0.0) {
      vec3 ps = mix(uPaintH * uBandH, uPaintM * uBandM, smoothstep(uSkyAt.x - skyEdge, uSkyAt.x + skyEdge, h));
      ps = mix(ps, uPaintZ * uBandZ, smoothstep(uSkyAt.y - skyEdge, uSkyAt.y + skyEdge, h)) * uPaintInv;
      pc = mix(pc, ps, uSkyStep);
    }
#ifdef SKY_NIGHT
    // A night's sky is three bands of flat colour: the horizon's up to a
    // height of the world's own (the sine of the elevation), the middle's up to
    // another, the zenith's above, each edge a little soft (a pixel or two for
    // the style that has hard bands).
    if (uPaintShape.x > 0.0) {
      float nightEdge = mix(uPaintShape.w, min(uPaintShape.w, skyEdge), uSkyStep);
      vec3 pn = mix(uPaintH, uPaintM, smoothstep(uPaintShape.y - nightEdge, uPaintShape.y + nightEdge, h));
      pn = mix(pn, uPaintZ, smoothstep(uPaintShape.z - nightEdge, uPaintShape.z + nightEdge, h)) * uPaintInv;
      pc = mix(pc, pn, uPaintShape.x);
    }
#endif
    col = mix(col, mix(pc, uGround, smoothstep(0.0, -0.18, y)), uSkyCol * uPaintK);
  }

  // The real style's day sky in three colours of its own (the look's realSky),
  // laid up the dome as the painted style's are and divided by the exposure, so
  // that they go into the tone curve as written (a gradient from the zenith's
  // light would come out of ACES nearly white). Where the look has none, or the
  // style is not the real one, the gradient above is the sky, and under the
  // horizon the ground shows through as it does there.
  if (uSkyReal * uRealK > 0.0) {
    float rh = max(y, 0.0);
    vec3 rc = mix(uRealH, uRealM, smoothstep(0.0, 0.15, pow(rh, 0.8)));
    rc = mix(rc, uRealZ, smoothstep(0.3, 0.95, rh)) * uPaintInv;
    col = mix(col, mix(rc, uGround, smoothstep(0.0, -0.18, y)), uSkyReal * uRealK);
  }

  // The same glow the fog uses, so the horizon and the haze agree exactly.
#ifdef SKY_NIGHT
  // (A night's painted sky is bands of colour; the glow of the sun stays a
  // little of it.)
  col = mix(col, glw, pow(mu, 8.0) * (1.0 - 0.6 * smoothstep(0.0, 0.6, y)) * (1.0 - 0.85 * uPaintShape.x * uSkyCol * uPaintK) * (1.0 - uSkyStep));
#else
  col = mix(col, glw, pow(mu, 8.0) * (1.0 - 0.6 * smoothstep(0.0, 0.6, y)) * (1.0 - uSkyStep));
#endif
`;

const skyVert = /* glsl */`
${TWIST_PARS}
varying vec3 vDir;
#ifdef SKY_FOLD
${SKY_UNIFORMS}
varying vec3 vRim;
// The sky's colour at the horizon, in a level direction.
vec3 skyRim(vec3 d) {
  float y = 0.0;
  float pxAng = 0.0;
${SKY_BASE}
  return col;
}
#else
uniform vec4 uSkyTurn;
#endif
void main() {
  vDir = position;
#ifdef SKY_FOLD
  // Where this sky and the other meet (the fragment shader): the colour of
  // both horizons, this one's here and the other's across the winding's
  // line from here, half and half.
  vec3 lvl = normalize(vec3(position.x, 0.0, position.z) + vec3(1e-5, 0.0, 0.0));
  vRim = 0.5 * (skyRim(lvl) + skyRim(2.0 * dot(lvl, uSkyAxis.xyz) * uSkyAxis.xyz - lvl));
#endif
  vec4 p = projectionMatrix * twistSky(modelViewMatrix * vec4(position, 1.0), uSkyTurn.x);
  gl_Position = p.xyww;   // on the far plane
}
`;

const skyFrag = /* glsl */`
${SKY_UNIFORMS}
varying vec3 vDir;
// No world has less cloud than this but those that have none (the desert's 0.12).
#define CLOUD_IN 0.08
#ifdef SKY_NIGHT
// (A painted night that has clouds of its own has them as a day's sky does.)
#define DAY_HEAPS max(day, uNightClouds * uSkyCol)
// How much of the sky is a painted night's, and how much of the old sky's own
// stars, planet and lightning is left under what a painted night draws itself.
#define PAINTED_NIGHT (uPaintShape.x * uSkyCol * uPaintK)
#define OLD_SKY (1.0 - PAINTED_NIGHT)
#else
#define DAY_HEAPS day
#endif
#ifdef SKY_HEAPS
#define LAYER_K (1.0 - uHeaps)
// A print leaves the sky to its band of indigo where there is no cloud: a
// pixel with cloud in it is marked in the alpha, 0.7 (between the marks of
// the things the style's last pass tells apart), 1 for none.
#define HEAP_ALPHA (1.0 - 0.3 * step(0.02, gCloud) * step(2.5, uHeapsTones) * step(uHeapsTones, 3.5))
#else
#define LAYER_K 1.0
#define HEAP_ALPHA 1.0
#endif
#ifdef SKY_FOLD
varying vec3 vRim;
#endif

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash3(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    a *= 0.5;
  }
  return v;
}
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}
// Where a bolt is across its own line, a point t of the way down it: the
// line wanders, in three sizes.
float boltOff(float t, float seed) {
  return 0.07 * (vnoise(vec2(t * 6.0, seed)) - 0.5) + 0.025 * (vnoise(vec2(t * 19.0, seed + 5.0)) - 0.5)
    + 0.008 * (vnoise(vec2(t * 61.0, seed + 9.0)) - 0.5);
}
${SPACE_FUNCS}

#ifdef SKY_HEAPS
// How much of a cloud there is in the pixel the sky is drawn in, for the
// style's last pass to leave it where it prints the sky (a print).
float gCloud = 0.0;

// A baked texel (render/clouds.js: R the light, G the big form, B the air, A
// the cover) in the paint of the world's clouds, toward the horizon's
// colour by its air.
vec3 heapPaint(vec4 s, vec3 hzn) {
  vec3 lit = uCloudLit * uPaintInv;
  vec3 mid = uCloudMid * uPaintInv;
  vec3 shade = uCloudShade * uPaintInv;
  vec3 under = uCloudUnder * uPaintInv;
  float litK = smoothstep(0.52, 0.57, s.r);
  vec3 c;
  if (uHeapsTones > 3.5) {
    c = mix(mix(shade, mid, smoothstep(0.47, 0.53, s.g)), lit, litK);
    c = mix(c, under, 1.0 - smoothstep(0.06, 0.16, s.g));
  } else if (uHeapsTones > 2.5) {
    // Three flat tones, bright, middle and dark, and no air: a print's last pass tells them
    // apart by their brightness and lays one of its three inks of a cloud on each.
    return mix(mix(vec3(0.2), vec3(0.45), smoothstep(0.45, 0.5, s.g)), vec3(0.9), litK) * uPaintInv;
  } else {
    // Two flat tones and one hard step between them, no air: the lit side is
    // the paint's white a little dimmed, the shaded side its middle tone a
    // little bluer.
    return mix(mid * vec3(1.0, 1.0, 1.05), lit * vec3(0.70, 0.706, 0.711), smoothstep(0.54, 0.56, s.r));
  }
  // The air in layers, a nearer heap and a farther one two steps of its own.
  float ab = s.b * 5.0;
  float air = (floor(ab) + smoothstep(0.35, 0.65, fract(ab))) / 5.0;
  return mix(c, hzn, mix(s.b, air, 0.7));
}

// The real style's baked clouds at d, with the edge made soft: the texel at d, four taps about it
// at the angle rho, and, where those do not all say the same (an edge is near), uCloudSoft more
// laid over the disc of that angle. A texel with no cloud in it has none of the cube's numbers
// either (its light, form and air are 0 with its cover), so the numbers of the taps are summed
// with their cover, and divided by it for a colour's: what is covered at the edge is the heap as it
// was baked, the cover the soft part. Returns (light, form, air, cover).
vec4 heapSoft(samplerCube cube, vec3 d, float rho) {
  vec4 c0 = texture(cube, d);
  if (uCloudSoft < 1.0) return vec4(c0.rgb / max(c0.a, 1e-3), c0.a);
  vec3 t = normalize(cross(d, abs(d.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(d, t);
  vec4 sum = c0;
  float lo = c0.a;
  float hi = c0.a;
  const vec2 probe[4] = vec2[4](vec2(0.6, 0.6), vec2(-0.6, 0.6), vec2(-0.6, -0.6), vec2(0.6, -0.6));
  for (int k = 0; k < 4; k++) {
    vec4 p = texture(cube, normalize(d + (t * probe[k].x + b * probe[k].y) * rho));
    sum += p;
    lo = min(lo, p.a);
    hi = max(hi, p.a);
  }
  if (hi - lo < 0.01) return vec4(c0.rgb / max(c0.a, 1e-3), c0.a);
  float n = 5.0;
  for (int k = 0; k < 16; k++) {
    if (float(k) >= uCloudSoft) break;
    float a = 2.3999632 * float(k);
    float r = rho * sqrt((float(k) + 0.5) / uCloudSoft);
    sum += texture(cube, normalize(d + (t * cos(a) + b * sin(a)) * r));
    n += 1.0;
  }
  return vec4(sum.rgb / max(sum.a, 1e-3), sum.a / n);
}

// A baked texel (light, form, air, cover) in the real style's paint, mu the cosine of the angle to the
// sun and y the height of the sight: the light of the sun and the form of the heap are one run of
// tones from its shaded side to its lit one, with no step in it; its underside is grey; a thin
// edge is bright, on the side the sun is on, and silver all round it when the sun is behind it; and
// far off it is the colour of the sky behind it by its air, more of it low down.
vec3 heapReal(vec4 s, vec3 sky, float mu, float y) {
  vec3 lit = uRCloudLit * uPaintInv;
  vec3 mid = uRCloudMid * uPaintInv;
  vec3 shade = uRCloudShade * uPaintInv;
  vec3 under = uRCloudUnder * uPaintInv;
  float form = clamp((s.g - 0.25) / 0.6, 0.0, 1.0);
  float t = pow(clamp(mix(form, s.r, 0.65), 0.0, 1.0), 1.25);
  vec3 c = mix(shade, mid, smoothstep(0.1, 0.62, t));
  c = mix(c, lit, smoothstep(0.55, 1.0, t));
  c = mix(c, under, 0.8 * (1.0 - smoothstep(0.04, 0.26, s.g)));
  float edge = 4.0 * s.a * (1.0 - s.a);
  c += lit * edge * smoothstep(0.2, 0.8, uSunny) * (0.35 * smoothstep(0.3, 0.8, s.r) + 1.1 * pow(mu, 8.0));
  float air = clamp(s.b + 0.25 * (1.0 - smoothstep(0.0, 0.2, y)), 0.0, 0.7);
  return mix(c, sky, air);
}
#endif

// The sky in a direction of the dome's own. pxAng: how wide a pixel is, in
// radians, for edges drawn in the sky.
vec3 skyAt(vec3 d, float pxAng) {
  float y = d.y;
${SKY_BASE}
  // Mie halo and the disc.
#ifdef SKY_PURE
  // (Away from the sun nothing is added to a day's sky: the halo is 0.0001
  // of the light at a mu of 0.6.)
  if (mu > 0.6) {
#endif
  col += uSunColor * (pow(mu, 220.0) * 0.6 + pow(mu, 30.0) * 0.12) * (1.0 - uSkyStep);
  float disc = smoothstep(cos(uSunSize), cos(uSunSize * 0.82), dot(d, uSunDir)) * (1.0 - uBlockSky * day);
  col += uSunColor * disc * 22.0;
#ifdef SKY_PURE
  }
#endif
#ifndef SKY_PURE

  // A layer of cumulus seen from below: projected onto a plane, thinned toward
  // the horizon, lit warm on the sun side and grey on the shadow side.
#ifdef SKY_HEAPS
  if (y > 0.0 && cld > 0.0 && uCumulus < 1.0 && uHeaps < 1.0) {
#else
  if (y > 0.0 && cld > 0.0) {
#endif
    vec2 uv = d.xz / (y + 0.12) * 1.8 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(uv);
    float cover = smoothstep(0.58 - cld * 0.25, 0.86, n);
    float lit = 0.55 + 0.45 * pow(mu, 3.0);
    vec3 cloud = mix(hzn * 0.78, uSunColor * 1.05, lit) * (0.82 + 0.25 * fbm(uv * 2.7));
    float fade = smoothstep(0.02, 0.22, y);
    // (A far world's clouds come in with how much cloud it has: the weather
    // is read a direction at a time, and where the next one along has none,
    // a layer that was all there at a hair of it ended on a straight line.)
    col = mix(col, cloud, cover * fade * 0.9 * (1.0 - uCumulus) * LAYER_K * (1.0 - uBlockSky * day) * smoothstep(0.0, CLOUD_IN, cld));
  }

  // Heaped cumulus, laid on the way a painter of animated films lays them:
  // cut sharp against the sky, white where the sun is on them, grey-violet
  // underneath; heaps overhead, and banks standing on the horizon.
  if (uCumulus > 0.0 && cld > 0.0 && y > -0.03) {
    float k = uCumulus * smoothstep(0.08, 0.4, cld);
    // Painted (uSkyPaint): only in a day's sky; fewer heaps, whiter, and a
    // shaded side dark enough that the exposure and the tone curve leave one.
    vec3 shade = mix(hzn, vec3(0.6, 0.62, 0.8), 0.6);
    float edge = 0.62 - cld * 0.16;
    if (uSkyPaint > 0.0) {
      k *= mix(1.0, day, uSkyPaint);
      shade *= mix(1.0, 0.62, uSkyPaint);
      edge = mix(edge, 0.66 - cld * 0.14, uSkyPaint);
    }
    vec3 white = mix(vec3(1.0, 0.985, 0.95), uSunColor, 0.15);
    vec2 cuv = d.xz / (y + 0.1) * 1.05 + vec2(uTime * 0.003, uTime * 0.0012);
    float n = fbm(cuv);
    float nl = fbm(cuv + normalize(uSunDir.xz + 1e-4) * 0.07);
    float heap = smoothstep(edge, edge + 0.02, n) * smoothstep(0.03, 0.2, y);
    float sunlit = smoothstep(-0.02, 0.05, nl - n + 0.012);
    float lit = 0.25 + 0.75 * sunlit;
    if (uSkyPaint > 0.0) lit = mix(lit, 0.4 + 0.6 * sunlit, uSkyPaint);
    col = mix(col, mix(shade, white, lit), heap * k);
    vec2 h2 = normalize(d.xz + 1e-5);
    float top = 0.03 + 0.2 * pow(fbm(h2 * 2.3 + 11.0), 1.8);
    float puff = (fbm(h2 * 14.0 + vec2(y * 12.0, 3.0)) - 0.5) * 0.07;
    float bank = smoothstep(top + puff + 0.004, top + puff - 0.004, y) * smoothstep(-0.03, 0.005, y);
    float rise = clamp(y / max(top, 1e-3), 0.0, 1.0);
    float sunSide = 0.5 + 0.5 * dot(h2, normalize(uSunDir.xz + 1e-4));
    vec3 bc = mix(shade * 0.96, white, smoothstep(0.25, 0.85, rise * 0.65 + sunSide * 0.35 + puff * 3.0));
    col = mix(col, bc, bank * k);
  }

  // Towers of cumulus standing on the horizon, as the painters of
  // hand-drawn animated films lay them in: a heap of lumpy puffs on a flat
  // base, cut sharp against the sky, white where the sun is on them,
  // blue-grey on the shaded side, in the folds between puffs and
  // underneath, a bright rim when the sun is behind them. Each puff is a
  // ball seen from the front with a ragged rim; the front-most one at a
  // point gives the normal the sun lights, and where the next one is
  // nearly as near, there is a fold.
  if (uTowers > 0.0 && cld > 0.0 && day > 0.0 && y > 0.0 && y < 0.85) {
    float k = uTowers * smoothstep(0.08, 0.4, cld) * day;
    float az = atan(d.z, d.x);
    float el = asin(clamp(y, -1.0, 1.0));
    float sunAz = atan(uSunDir.z, uSunDir.x);
    float sunEl = asin(clamp(uSunDir.y, -1.0, 1.0));
    vec3 white = mix(vec3(1.02, 1.0, 0.96), uSunColor, 0.18);
    vec3 shade = mix(hzn, vec3(0.44, 0.52, 0.82), 0.66) * 0.58;
    for (int c = 0; c < 9; c++) {
      float fc = float(c);
      float ca = (fc + 0.2 + 0.6 * hash(vec2(fc, 7.1))) / 9.0 * 6.2832 - 3.1416;
      float s = 0.06 + 0.08 * hash(vec2(fc, 3.3));
      // They stand behind the ridges, their feet in the haze.
      float base = 0.03 + 0.12 * hash(vec2(fc, 9.7));
      float tall = 0.8 + 0.9 * hash(vec2(fc, 5.3));
      float da = mod(az - ca + 3.1416, 6.2832) - 3.1416;
      if (abs(da) > s * 3.4) continue;
      vec2 p = vec2(da * cos(el), el - base);
      if (p.y < -0.01 || p.y > s * 4.0 * tall) continue;
      // Fourteen puffs: five along the base, four over them, three, two,
      // smaller as they go up, each a little off its row.
      float best = -1.0;
      float second = -1.0;
      vec2 q0 = vec2(0.0);
      float r0 = 1.0;
      for (int i = 0; i < 14; i++) {
        float fi = float(i);
        float row = i < 5 ? 0.0 : i < 9 ? 1.0 : i < 12 ? 2.0 : 3.0;
        float first = row == 0.0 ? 0.0 : row == 1.0 ? 5.0 : row == 2.0 ? 9.0 : 12.0;
        float count = 5.0 - row;
        float slot = fi - first - (count - 1.0) * 0.5;
        float hx = hash(vec2(fc * 23.0 + fi, 1.3));
        float hy = hash(vec2(fc * 23.0 + fi, 8.9));
        float spread = 0.86 - row * 0.1;
        vec2 cp = vec2((slot * spread + (hx - 0.5) * 0.45) * s, (0.45 + row * 0.62 * tall + (hy - 0.5) * 0.3) * s);
        float r = s * (0.62 - row * 0.07 + 0.2 * hash(vec2(fc * 23.0 + fi, 4.4)));
        vec2 q = p - cp;
        // A ragged rim: the radius swells and dips round the puff.
        float th = atan(q.y, q.x);
        float ph = hash(vec2(fc * 23.0 + fi, 6.6)) * 6.2832;
        r *= 1.0 + 0.07 * sin(th * 5.0 + ph) + 0.04 * sin(th * 11.0 - ph * 1.7);
        float z = r * r - dot(q, q);
        if (z > best) {
          second = best;
          best = z;
          q0 = q;
          r0 = r;
        } else if (z > second) {
          second = z;
        }
      }
      float aa = 3.0 * r0 * pxAng + 1e-7;
      float cover = smoothstep(0.0, aa, best) * smoothstep(0.0, 1.5 * pxAng, p.y);
      if (cover <= 0.0) continue;
      vec3 n3 = normalize(vec3(q0, sqrt(max(best, 0.0))));
      float dsa = mod(sunAz - ca + 3.1416, 6.2832) - 3.1416;
      vec3 l3 = normalize(vec3(sin(dsa) * cos(sunEl) * 1.3, sin(sunEl) + 0.55, -cos(dsa) * cos(sunEl)));
      float lit = dot(n3, l3);
      // Light and shade in two values with a short step between, the way a
      // painter lays them; a touch warmer at the top of the lit side.
      vec3 cc = mix(shade, white, smoothstep(0.05, 0.3, lit));
      cc += white * 0.12 * smoothstep(0.55, 0.95, lit);
      float fold = (1.0 - smoothstep(0.0, r0 * r0 * 0.22, best - max(second, 0.0))) * step(0.0, second);
      cc = mix(cc, shade * 1.05, fold * 0.55);
      // Flat and darker underneath; a bright rim against a low sun behind.
      cc = mix(cc, shade * 0.9, (1.0 - smoothstep(0.0, s * 0.8, p.y)) * 0.6);
      float back = smoothstep(0.3, 1.0, cos(dsa));
      cc += white * pow(1.0 - n3.z, 3.0) * back * 0.6;
      // Feet in the haze: the lower part of a tower fades into the horizon.
      cc = mix(cc, hzn, (1.0 - smoothstep(0.0, s * 0.7, p.y)) * 0.3);
      col = mix(col, cc, cover * k);
    }
  }

#endif
#ifdef SKY_HEAPS
  // Clouds baked into a cube map, laid on a day's sky: where the world they
  // are of has cloud, and in the style's own paint.
  gCloud = 0.0;
  float dayH = DAY_HEAPS;
  // The real style's veil of cirrus, 9 km over the lens, under the heaps: the tile laid on that
  // plane (the sky's direction taken to it, the height a little lifted so that it does not run
  // off to nothing at the horizon), along the wind. It is read first, whatever the pixel (the
  // mip it takes is the one the block of four pixels is in), and shows where the world has
  // cloud but not a sky of one grey, brighter near the sun where the ice throws the light on.
  if (uCirrus > 0.0) {
    vec2 plane = d.xz / (max(y, 0.0) + 0.03) * ${CIRRUS.altitude.toFixed(1)};
    vec2 cuv = vec2(dot(plane, vec2(${CIRRUS_AXIS[0].toFixed(4)}, ${CIRRUS_AXIS[1].toFixed(4)})) / ${CIRRUS.tile[0].toFixed(1)},
      dot(plane, vec2(${(-CIRRUS_AXIS[1]).toFixed(4)}, ${CIRRUS_AXIS[0].toFixed(4)})) / ${CIRRUS.tile[1].toFixed(1)});
    cuv += vec2(uTime * ${(CIRRUS_WIND / CIRRUS.tile[0]).toFixed(7)}, uTime * ${(CIRRUS_WIND * 0.1 / CIRRUS.tile[1]).toFixed(7)});
    float dens = texture(uCirrusTex, cuv, 1.5).r;
    float amount = uCirrus * dayH * smoothstep(0.04, 0.4, cld) * (1.0 - smoothstep(0.75, 0.95, cld)) * smoothstep(0.015, 0.2, y);
    if (amount > 0.0) {
      vec3 ice = (mix(uRCloudMid, uRCloudLit, 0.5) + uSunColor * (0.08 + 0.7 * pow(mu, 9.0)) * smoothstep(0.2, 0.8, uSunny)) * uPaintInv;
      col = mix(col, ice, smoothstep(0.1, 1.0, dens) * amount * 0.2);
    }
  }
  if (uHeaps > 0.0 && dayH > 0.0 && cld > 0.0 && y > -0.03) {
    float k = uHeaps * dayH * smoothstep(0.0, CLOUD_IN, cld);
    vec3 skyHere = col;
    if (uCloudReal < 1.0) {
      vec4 sa = texture(uCloudA, d);
      // (Two flat tones, the cel style's: an edge a pixel wide, not the baked cover's texel or two.)
      float ka = ( uHeapsTones < 2.5 ? smoothstep( 0.35, 0.65, sa.a ) : sa.a ) * k * (1.0 - uCloudT);
      if (ka > 0.0) col = mix(col, heapPaint(sa, hzn), ka);
      float cover = ka;
      if (uCloudT > 0.0) {
        vec4 sb = texture(uCloudB, d);
        float kb = ( uHeapsTones < 2.5 ? smoothstep( 0.35, 0.65, sb.a ) : sb.a ) * k * uCloudT;
        if (kb > 0.0) col = mix(col, heapPaint(sb, hzn), kb);
        cover += kb;
      }
      gCloud = min(cover, 1.0);
    }
    // The real style's clouds, the same cube in the light of the sun: the style's own, or between
    // the two where one turns into the other.
    if (uCloudReal > 0.0) {
      vec3 painted = col;
      col = skyHere;
      float rho = max(0.0085, pxAng * 1.5);
      vec4 ra = heapSoft(uCloudA, d, rho);
      float kra = ra.a * k * (1.0 - uCloudT);
      if (kra > 0.0) col = mix(col, heapReal(ra, col, mu, y), kra);
      float cover = kra;
      if (uCloudT > 0.0) {
        vec4 rb = heapSoft(uCloudB, d, rho);
        float krb = rb.a * k * uCloudT;
        if (krb > 0.0) col = mix(col, heapReal(rb, col, mu, y), krb);
        cover += krb;
      }
      col = mix(painted, col, uCloudReal);
      if (uCloudReal >= 1.0) gCloud = min(cover, 1.0);
    }
  }
#ifdef SKY_NIGHT
#ifdef SKY_SPACE
  // (A painted night's band of the galaxy and nebulae: flat tones under the stars.)
  if (uSpaceBake < 0.5 && PAINTED_NIGHT > 0.0 && stars > 0.0 && y > -0.02) spPaintedBackdrop(col, d, y, pxAng, PAINTED_NIGHT * min(stars, 1.0));
#endif
  // A night's few stars (uPaintStars of them over the dome), each a dot of
  // flat colour: the dome is laid with cells a tenth of a radian across, as
  // many in a row as fit round at that height, a cell has a star where its
  // draw is under the share that makes the number asked for, and the star
  // stands somewhere in the cell. Not down in the glow of the horizon.
  if (uPaintStars * uSkyCol * uPaintK > 0.0 && y > 0.03) {
    float el = asin(clamp(y, -1.0, 1.0));
    float row = floor(el / ${STAR_STEP});
    float rowEl = (row + 0.5) * ${STAR_STEP};
    float cols = max(floor(6.2832 * cos(rowEl) / ${STAR_STEP}), 1.0);
    float az = atan(d.z, d.x) + 3.14159;
    float colN = min(floor(az / 6.2832 * cols), cols - 1.0);
    vec2 cid = vec2(colN, row);
    if (hash(cid + 7.1) < uPaintStars / ${STAR_CELLS}.0) {
      vec2 at = vec2((colN + 0.15 + 0.7 * hash(cid + 13.7)) / cols * 6.2832 - 3.14159, (row + 0.15 + 0.7 * hash(cid + 29.3)) * ${STAR_STEP});
      float da = mod(az - 3.14159 - at.x + 3.14159, 6.2832) - 3.14159;
      float dist = length(vec2(da * cos(el), el - at.y));
      float r = pxAng * uStarPx;
      float dot_ = 1.0 - smoothstep(r - pxAng * 0.6, r + pxAng * 0.6, dist);
      vec3 sc = mix(vec3(0.75, 0.85, 1.1), vec3(1.1, 0.95, 0.8), step(0.8, hash(cid + 41.9)));
      col = mix(col, sc * (0.55 + 0.45 * hash(cid + 3.3)) * uPaintInv, dot_ * smoothstep(0.03, 0.2, y) * uSkyCol * uPaintK * uPaintShape.x);
    }
  }
#ifdef SKY_SPACE
  if (uSpaceBake < 0.5 && PAINTED_NIGHT > 0.0 && stars > 0.0 && y > 0.03) spPaintedStars(col, d, y, pxAng, PAINTED_NIGHT * min(stars, 1.0));
#endif
#endif
#endif

#ifndef SKY_PURE
  // A world of blocks' sky (render/style.js, blockSky), by day: a square
  // sun, and clouds that are flat squares of white, a cell of them 12 m
  // across on a plane high above, taken along by the wind.
  if (uBlockSky > 0.0 && day > 0.0) {
    vec3 sr = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
    vec3 su = cross(sr, uSunDir);
    float sq = step(0.0, dot(d, uSunDir)) * (1.0 - smoothstep(0.052, 0.056, max(abs(dot(d, sr)), abs(dot(d, su)))));
    col += uSunColor * sq * 22.0 * uBlockSky * day;
    if (cld > 0.0 && y > 0.02) {
      vec2 cp = d.xz / (y + 0.04) * 130.0 + vec2(uTime * 1.3, uTime * 0.2);
      vec2 cell = floor(cp / 12.0);
      float cn = vnoise(cell * 0.31) * 0.62 + vnoise(cell * 0.83 + 9.0) * 0.38;
      float on = step(0.7 - cld * 0.1, cn);
      col = mix(col, vec3(0.84 + 0.1 * hash(cell)), on * smoothstep(0.02, 0.12, y) * 0.95 * uBlockSky * day * smoothstep(0.0, CLOUD_IN, cld));
    }
  }

  // The Upside Down (world look 'upside'): the cloud lit from inside, red,
  // by lightning, a bolt of it forking down, and, when it flashes bright,
  // the shape of something enormous standing on the horizon behind.
  if (uUpside > 0.0 && uFlash > 0.003) {
    float az = atan(d.z, d.x);
    float el = asin(clamp(y, -1.0, 1.0));
    float da = mod(az - uBolt.x + 3.1416, 6.2832) - 3.1416;
    float lc = fbm(d.xz / (abs(y) + 0.2) * 1.4 + 3.0);
#ifdef SKY_NIGHT
    col += vec3(1.0, 0.2, 0.12) * uFlash * uUpside * (0.2 + 0.9 * lc) * smoothstep(-0.1, 0.25, y) * 0.5 * OLD_SKY;
    // A painted night's flash: the sky is one pale colour for as long as the
    // flash is bright, and what the bolt is drawn in is a white shape (below).
    if (PAINTED_NIGHT > 0.0) {
      float lit = smoothstep(0.3, 0.45, uFlash) * uUpside * PAINTED_NIGHT * smoothstep(-0.004, 0.012, y);
      col = mix(col, vec3(${FLASH_WASH.map((x) => x.toFixed(2)).join(', ')}) * uPaintInv, lit);
    }
#else
    col += vec3(1.0, 0.2, 0.12) * uFlash * uUpside * (0.2 + 0.9 * lc) * smoothstep(-0.1, 0.25, y) * 0.5;
#endif
    float top = uBolt.y;
    float t = (top - el) / (top + 0.04);
    // (A bolt that comes down on the ground is drawn in the world, with no sky line: render/strike.js.)
    if (top > 0.0 && t > 0.0 && t < 1.0) {
      float off = boltOff(t, uBolt.z);
      float dx = (da - off) * cos(el);
      float w = max(mix(0.0045, 0.0018, t), pxAng * 1.3);
      float core = exp(-dx * dx / (w * w));
      float halo = exp(-abs(dx) / 0.035) * 0.22;
      float t2 = t - 0.34;
      float fork = 0.0;
      if (t2 > 0.0) {
        float dx2 = (da - off - boltOff(t, uBolt.z + 17.0) * 0.8 - t2 * (fract(uBolt.z * 7.0) > 0.5 ? 0.22 : -0.22)) * cos(el);
        float w2 = max(0.0014, pxAng * 1.3);
        fork = exp(-dx2 * dx2 / (w2 * w2)) * smoothstep(0.7, 0.2, t2);
      }
      vec3 bolt = mix(vec3(1.0, 0.55, 0.45), vec3(1.0, 0.92, 0.9), core) * (core + 0.7 * fork + halo);
#ifdef SKY_NIGHT
      col += bolt * 6.0 * uFlash * uUpside * smoothstep(0.0, 0.03, t) * smoothstep(1.0, 0.92, t) * OLD_SKY;
      if (PAINTED_NIGHT > 0.0) {
        // The same line and the same fork, a white shape with a hard edge.
        float wp = max(mix(0.0115, 0.0060, t), pxAng * 2.4);
        float shape = 1.0 - smoothstep(wp - pxAng * 0.7, wp + pxAng * 0.7, abs(dx));
        if (t2 > 0.0) {
          float dx3 = (da - off - boltOff(t, uBolt.z + 17.0) * 0.8 - t2 * (fract(uBolt.z * 7.0) > 0.5 ? 0.22 : -0.22)) * cos(el);
          float wf = max(0.0055, pxAng * 2.0);
          shape = max(shape, (1.0 - smoothstep(wf - pxAng * 0.7, wf + pxAng * 0.7, abs(dx3))) * smoothstep(0.7, 0.2, t2));
        }
        float on = smoothstep(0.0, 0.03, t) * smoothstep(1.0, 0.92, t) * step(0.12, uFlash) * uUpside * PAINTED_NIGHT;
        col = mix(col, vec3(1.0, 0.97, 0.94) * uPaintInv, shape * on);
      }
#else
      col += bolt * 6.0 * uFlash * uUpside * smoothstep(0.0, 0.03, t) * smoothstep(1.0, 0.92, t);
#endif
    }
    if (uBolt.w > 0.0 && uFlash > 0.02) {
      float sa = mod(az - (uBolt.x + 0.9) + 3.1416, 6.2832) - 3.1416;
      vec2 p = vec2(sa * cos(el), el - 0.34) / 0.6;
      if (abs(p.x) < 1.3 && abs(p.y) < 1.1) {
        float m = 0.0;
#ifdef SKY_NIGHT
        // (A painted night's shape has a hard edge, a pixel wide: pe is a pixel in the units of p.)
        float pe = pxAng / 0.6;
        float edgeA = -pe * PAINTED_NIGHT;
        float edgeB = mix(0.03, pe, PAINTED_NIGHT);
        float legA = mix(0.008, 0.012 - pe, PAINTED_NIGHT);
        float legB = mix(0.03, 0.012 + pe, PAINTED_NIGHT);
#else
        const float edgeA = 0.0;
        const float edgeB = 0.03;
        const float legA = 0.008;
        const float legB = 0.03;
#endif
        m = max(m, 1.0 - smoothstep(edgeA, edgeB, length((p - vec2(0.0, 0.05)) * vec2(1.0, 0.8)) - 0.14));
        m = max(m, 1.0 - smoothstep(edgeA, edgeB, length(p - vec2(0.0, -0.12)) - 0.07));
        for (int i = 0; i < 4; i++) {
          float fi = float(i);
          for (int k = 0; k < 2; k++) {
            float sg = k == 0 ? -1.0 : 1.0;
            vec2 a = vec2(sg * 0.06, -0.12 + 0.07 * fi);
            vec2 knee = vec2(sg * (0.4 + 0.12 * fi), 0.42 - 0.05 * fi);
            vec2 foot = vec2(sg * (0.75 + 0.1 * fi), -0.55 - 0.1 * fi);
            float dl = min(segDist(p, a, knee), segDist(p, knee, foot));
            m = max(m, 1.0 - smoothstep(legA, legB, dl));
          }
        }
        col *= 1.0 - m * 0.88 * uBolt.w * smoothstep(0.02, 0.4, uFlash) * uUpside;
      }
    }
  }

#ifdef SKY_SPACE
  // The band of the galaxy and the nebulae, under the stars. (spStars: how much of the
  // sky has stars, kept for what is drawn after, where a painted night has taken them off.)
  float spStars = stars;
  if (uSpaceBake < 0.5 && stars * SP_OLD > 0.0 && y > -0.02) spBackdrop(col, d, y, min(stars, 1.0) * SP_OLD);
#endif
#ifdef SKY_NIGHT
  // (A painted night has stars of its own, flat dots: the field below is not laid under them.)
  stars *= OLD_SKY;
#endif
  // Stars, out where the sky is black: a sparse field of steady points.
  if (stars > 0.0 && y > -0.08) {
    // A star is a soft round point of a cell of a lattice 1/420 of a radian across; in a world of
    // blocks (blockSky) a square one, in a coarser lattice (1/240, so that it is some pixels
    // across) with as many to the sky.
    float starLattice = uBlockSky > 0.0 ? mix(420.0, 240.0, uBlockSky) : 420.0;
    float starShare = uBlockSky > 0.0 ? 0.0028 * mix(1.0, 3.0625, uBlockSky) : 0.0028;
    vec3 sd = d * starLattice;
    vec3 cell = floor(sd);
    float hs = hash3(cell);
    vec3 sf = fract(sd) - 0.5;
    float starShape = smoothstep(0.34, 0.0, length(sf));
    if (uBlockSky > 0.0) starShape = mix(starShape, 1.0 - step(0.42, max(abs(sf.x), max(abs(sf.y), abs(sf.z)))), uBlockSky);
    float star = step(
#ifdef SKY_SPACE
      // (Thicker on the band of the galaxy.)
      1.0 - starShare * (uSpaceBake < 0.5 ? spStarsAt(d) : 1.0)
#else
      (uBlockSky > 0.0 ? 1.0 - starShare : 0.9972)
#endif
      , hs) * starShape * (0.35 + 0.65 * fract(hs * 97.0));
    col += vec3(star) * stars * 2.6 * (1.0 - smoothstep(0.9, 1.0, mu));
  }
  // A planet over the horizon, a quarter turn round from the sun, so it hangs
  // half lit: banded by latitude, dimming toward its limb, its night side
  // nearly black, a thin rim of atmosphere on the lit edge.
  if (uPlanet > 0.0) {
    vec3 pd = normalize(vec3(-uSunDir.z, 0.2, uSunDir.x));
    float r = 0.15;
    vec3 right = normalize(cross(pd, vec3(0.0, 1.0, 0.0)));
    vec3 upv = cross(right, pd);
    vec2 pq = vec2(dot(d, right), dot(d, upv)) / r;
    float inside = dot(d, pd) > 0.0 ? 1.0 - dot(pq, pq) : -1.0;
    if (inside > -0.08) {
      float zz = sqrt(max(inside, 0.0));
      // The near face of the sphere looks back along -pd.
      vec3 n = normalize(pq.x * right + pq.y * upv - zz * pd);
      float lit = smoothstep(-0.12, 0.55, dot(n, uSunDir));
#ifdef SKY_SPACE
      // A ringed planet turns on the axis its ring is round, and the ring shades it.
      vec3 sdp = vec3(dot(uSunDir, right), dot(uSunDir, upv), -dot(uSunDir, pd));
      vec3 pAxis = right * RING_N.x + upv * RING_N.y - pd * RING_N.z;
      float ringShade = (uSpaceT > 1.5 && uSpaceBake < 0.5) ? spRingShade(vec3(pq, zz), sdp) : 0.0;
      lit *= 1.0 - 0.8 * ringShade;
      float bands = fbm(vec2(dot(n, pAxis) * 4.6, dot(n, right) * 0.7) + 3.7);
#else
      float bands = fbm(vec2(n.y * 4.6, dot(n, right) * 0.7) + 3.7);
#endif
      vec3 surf = mix(vec3(0.2, 0.3, 0.44), vec3(0.78, 0.76, 0.72), smoothstep(0.3, 0.75, bands));
      float disc = smoothstep(0.0, 0.02, inside);
      float limb = 0.55 + 0.45 * zz;
#ifdef SKY_NIGHT
      col = mix(col, surf * (0.015 + 0.8 * lit) * limb, disc * uPlanet * OLD_SKY);
      float rim = smoothstep(-0.08, 0.0, inside) * (1.0 - smoothstep(0.0, 0.06, inside));
      col += vec3(0.35, 0.55, 1.0) * rim * lit * 0.6 * uPlanet * OLD_SKY;
      if (PAINTED_NIGHT > 0.0) {
        // A painted night's planet: flat bands by the height on it (cream, rose and blue,
        // each with a deep blue-violet for its dark side), a hard edge between the lit
        // side and the dark, and a thin flat ring of its air on the lit edge. e: a pixel,
        // in radii of the disc, and in the sphere's normal where it turns edge-on.
        float e = max(pxAng / r, 1e-4);
        float ne = e / max(zz, 0.12);
#ifdef SKY_SPACE
        float lat = dot(n, pAxis) + 0.06 * sin(dot(n, right) * 4.0 + 1.3);
#else
        float lat = n.y + 0.06 * sin(dot(n, right) * 4.0 + 1.3);
#endif
        vec3 band = mix(mix(vec3(0.30, 0.46, 0.78), vec3(0.90, 0.62, 0.52), smoothstep(-0.22 - ne, -0.22 + ne, lat)), vec3(0.72, 0.68, 0.86), smoothstep(0.30 - ne, 0.30 + ne, lat));
        float sunk = smoothstep(-ne, ne, dot(n, uSunDir));
        vec3 pcol = mix(band * vec3(0.10, 0.12, 0.30), band, sunk);
#ifdef SKY_SPACE
        pcol = mix(pcol, pcol * vec3(0.30, 0.34, 0.58), step(0.5, ringShade) * sunk);
#endif
        float rr = sqrt(dot(pq, pq));
        float on = 1.0 - smoothstep(1.0 - e, 1.0 + e, rr);
        col = mix(col, pcol * uPaintInv, on * uPlanet * PAINTED_NIGHT);
        float ring = smoothstep(1.0, 1.0 + e, rr) * (1.0 - smoothstep(1.0 + 2.5 * e, 1.0 + 3.5 * e, rr));
        col = mix(col, vec3(0.45, 0.70, 1.0) * uPaintInv, ring * smoothstep(-0.2, 0.2, dot((pq.x * right + pq.y * upv) / max(rr, 1e-4), uSunDir)) * uPlanet * PAINTED_NIGHT);
      }
#else
      col = mix(col, surf * (0.015 + 0.8 * lit) * limb, disc * uPlanet);
      float rim = smoothstep(-0.08, 0.0, inside) * (1.0 - smoothstep(0.0, 0.06, inside));
      col += vec3(0.35, 0.55, 1.0) * rim * lit * 0.6 * uPlanet;
#endif
    }
#ifdef SKY_SPACE
    // The ring, over the planet where it is in front of it.
    if (uSpaceBake < 0.5 && dot(d, pd) > 0.0 && dot(pq, pq) < 6.0) {
      vec3 sdr = vec3(dot(uSunDir, right), dot(uSunDir, upv), -dot(uSunDir, pd));
      float er = max(pxAng / r, 1e-4);
      float onr = 1.0 - smoothstep(1.0 - er, 1.0 + er, length(pq));
#ifdef SKY_NIGHT
      float pk = step(0.5, PAINTED_NIGHT);
      vec4 pr = spRing(pq, er, sdr, onr, pk);
      col = mix(col, pr.rgb, pr.a * uPlanet * mix(OLD_SKY, PAINTED_NIGHT, pk));
#else
      vec4 pr = spRing(pq, er, sdr, onr, 0.0);
      col = mix(col, pr.rgb, pr.a * uPlanet);
#endif
    }
#endif
  }
#ifdef SKY_SPACE
  spAfter(col, d, y, pxAng, spStars);
#endif

#endif
  return col;
}

void main() {
  vec3 d = normalize(vDir);
  float pxAng = max(length(fwidth(d)), 1e-5);
#ifdef SKY_FOLD
  // Where the world is wound over (render/twist.js) the world on the other
  // side of the winding is the other way up, and its sky with it: under
  // this sky's horizon is that one, this same sky turned a half turn about
  // the winding's line. So a car that goes over comes out under a whole sky,
  // and no sky is seen to turn. It is one sky to a pixel, this one or that.
  // The two meet in the colour of both horizons (vRim), and that is all the
  // sky is for a little either side of the horizon, so there is no seam
  // where a sun's glow or a bank of cloud is on one side of the line only.
  // Away from the fold (uSkyTurn.zw: the way it lies, .y: all round, by the
  // winding itself) under the horizon is the far ground, as anywhere.
  vec3 over = 2.0 * dot(d, uSkyAxis.xyz) * uSkyAxis.xyz - d;
  vec3 col = skyAt(d.y < 0.0 ? over : d, pxAng);
  float there = max(uSkyTurn.y, smoothstep(-0.25, 0.25, dot(normalize(d.xz + vec2(1e-5, 0.0)), uSkyTurn.zw)));
  col = mix(col, mix(vRim, uGround, smoothstep(0.0, 0.18, -d.y)), step(d.y, 0.0) * (1.0 - there));
  col = mix(col, vRim, 1.0 - smoothstep(0.0, 0.04, abs(d.y)));
  gl_FragColor = vec4(col, HEAP_ALPHA);
#else
  vec3 col = skyAt(d, pxAng);
  gl_FragColor = vec4(col, HEAP_ALPHA);
#endif
}
`;

export class Atmosphere {
  constructor(renderer, scene, look, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    // The sun's direction as the lens sees it (view space), for the light
    // loop to tell the sun's light from the others'. Worked out for the lens
    // of each drawing, as three works out its lights' directions: worked out
    // once a frame, a lens put somewhere else after that (a tool's own
    // viewpoint) saw no sun, and the land took the sun's light the old way
    // and the shade paint on top of it.
    scene.onBeforeRender = (r, sc, camera) => {
      if (this.sunDir) styleU.uSunDirV.value.copy(this.sunDir).transformDirection(camera.matrixWorldInverse);
    };
    this.look = look;

    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3() },
      uGlow: { value: new THREE.Color() },
      uSunSize: { value: 0.012 },
      uTime: { value: 0 },
      uCloud: { value: 0.5 },
      uStars: { value: 0 },
      ...skyBandsU,
      uPaintK: { value: 0 },
      uRealZ: { value: new THREE.Vector3() },
      uRealM: { value: new THREE.Vector3() },
      uRealH: { value: new THREE.Vector3() },
      uRealK: { value: 0 },
      uPaintStars: { value: 0 },
      uNightClouds: { value: 0 },
      uPlanet: { value: 0 },
      // The Upside Down's lightning: how much the look is its own, the
      // flash, and the bolt (azimuth, height, draw, the share of the
      // silhouette that shows).
      uUpside: { value: 0 },
      uFlash: { value: 0 },
      uBolt: { value: new THREE.Vector4() },
      uCloudLit: { value: new THREE.Color() },
      uCloudMid: { value: new THREE.Color() },
      uCloudShade: { value: new THREE.Color() },
      uCloudUnder: { value: new THREE.Color() },
      // The real style's clouds: how many taps beyond five their soft edge takes (the tier's), and their paint.
      uCloudSoft: { value: CLOUD_SOFT[opts.tier] === undefined ? CLOUD_SOFT.high : CLOUD_SOFT[opts.tier] },
      uSunny: { value: 1 },
      uRCloudLit: { value: new THREE.Color() },
      uRCloudMid: { value: new THREE.Color() },
      uRCloudShade: { value: new THREE.Color() },
      uRCloudUnder: { value: new THREE.Color() },
      ...ringU,
      ...skyStyle,
      ...twistU,
      ...skyTurnU,
    };
    // The clouds baked into a cube map for the styles that lay them over a
    // day's sky (render/clouds.js).
    this.clouds = new Clouds(renderer, { seed: opts.seed, axis: opts.axis, sync: opts.sync, tier: opts.tier });
    Object.assign(this.uniforms, this.clouds.uniforms);
    // The real style's high veil of cirrus: its tile, made by a worker (render/bakers.js, which the
    // game gives to bakers) where there is one, and not at all in the low tier.
    this.cirrus = new Cirrus();
    Object.assign(this.uniforms, this.cirrus.uniforms);
    this.bakers = null;
    this.tier = CLOUD_SOFT[opts.tier] === undefined ? 'high' : opts.tier;
    // What the space world's sky has besides its stars and its planet (render/spacesky.js).
    this.space = new SpaceSky({ axis: opts.axis, tier: opts.tier });
    Object.assign(this.uniforms, this.space.uniforms);
    // Two of the dome's shader: the sky as it is, and (SKY_FOLD) the one that
    // lays the other side's sky under the horizon, where the world is wound
    // over (update picks). They are two because, as one, every frame was
    // dearer in the software renderer of the checks (7 to 17 %), wound over
    // or not: the second costs a little more, and it cost that everywhere.
    // mode: 0 the sky as it is; 1 with the baked clouds, and the old clouds'
    // code kept for what is not a day's sky (a night's, the borders); 2 the
    // baked clouds alone, for a day's sky in a world with nothing else in the
    // sky (it is the dearer for every line of the rest: even where nothing
    // runs it, the software renderer of the checks pays 6 ms a frame for it).
    // And the same of the first two for a sky with stars or a planet in it, with the
    // space world's own code (SKY_SPACE); only those skies are drawn with them.
    const dome = (fold, mode = 0, space = false) => new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: this.uniforms,
      defines: { ...(fold ? { SKY_FOLD: 1 } : {}), ...(mode ? { SKY_HEAPS: 1 } : {}), ...(mode === 1 ? { SKY_NIGHT: 1 } : {}), ...(mode === 2 ? { SKY_PURE: 1 } : {}), ...(space ? { SKY_SPACE: 1 } : {}) },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.skyPlain = dome(false);
    this.skyFold = dome(true);
    // The same two for a style with baked clouds (the old clouds' code stays
    // in them for a world that has no day's sky, but is not run by day).
    this.skyPlainHeaps = dome(false, 1);
    this.skyFoldHeaps = dome(true, 1);
    this.skyPlainPure = dome(false, 2);
    this.skyFoldPure = dome(true, 2);
    this.skySpacePlain = this.space.own(dome(false, 0, true));
    this.skySpaceFold = this.space.own(dome(true, 0, true));
    this.skySpacePlainHeaps = this.space.own(dome(false, 1, true));
    this.skySpaceFoldHeaps = this.space.own(dome(true, 1, true));
    this._spaceOf = new Map([
      [this.skyPlain, this.skySpacePlain], [this.skyFold, this.skySpaceFold],
      [this.skyPlainHeaps, this.skySpacePlainHeaps], [this.skyFoldHeaps, this.skySpaceFoldHeaps],
    ]);
    this._foldWarm = false;
    // The space world's four skies are built in the compiler's threads, once a page has one in view
    // (see _buildSpace); a headless run builds them as it draws.
    this._spaceAsked = false;
    this._spaceReady = false;
    this._spaceOut = 0;
    // A page leaves the second frame's work to a queue (warmTasks), and the
    // clouds to after its first frame.
    this.deferWarm = false;
    this.holdClouds = false;
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.skyPlain);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.sky.scale.setScalar(4000);
    scene.add(this.sky);

    scene.fog = new THREE.FogExp2(0xbfd2e2, 0.0001);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.camera.userData.cascade = 0;
    scene.add(this.sun);
    scene.add(this.sun.target);
    // The far map is a light of its own, which is not in the scene (a material is lit by the sun
    // once): the renderer draws its map when asked to (shadowMap.render, below).
    this.sunFar = new THREE.DirectionalLight(0xffffff, 0);
    this.sunFar.castShadow = true;
    this.sunFar.shadow.autoUpdate = false;
    this.sunFar.shadow.camera.userData.cascade = 1;
    this._shadowTier = opts.tier || 'high';
    this._blocky = false;
    this._shadowSize = SHADOW.size;
    this._farOn = false;
    this._farDue = true;
    // A headless run (opts.sync) draws the far map in every frame the scene is drawn, where a page of a real clock
    // draws it every `every` frames: what a check counts and compares is a frame (the same one with a pass on and
    // off, one style against another, before and after) and has the far map in it. farshadow=alt in the address
    // asks a headless run for the page's own.
    this._farAlways = !!opts.sync && !opts.farAlt;
    this._farAt = { x: 1e9, z: 1e9 };
    this._farDir = new THREE.Vector3();
    this._shadowTick = 0;
    // Where the two maps are, for what is drawn into them (render/forest.js): the light, how far its
    // map reaches from its centre, and the centre (absolute metres).
    this.cascades = [
      { light: this.sun, half: SHADOW.near, x: 0, z: 0, pad: SHADOW.pad[0], reset: SHADOW.reset[0], on: true },
      { light: this.sunFar, half: SHADOW.far, x: 0, z: 0, pad: SHADOW.pad[1], reset: SHADOW.reset[1], on: false },
    ];
    this._shadowSetup();
    // What is left out of the far map: the player's car (it is always in the near one).
    this.nearOnly = [];
    this._shown = [];
    this._farLights = [this.sunFar];
    // The renderer draws the sun's map when it draws the scene; the far map is drawn right after it, in
    // the same call and so in the same state, when it is due.
    const shadowMap = renderer.shadowMap;
    const drawShadows = shadowMap.render;
    this._drawShadows = drawShadows;
    shadowMap.render = (lights, sc, camera) => {
      // (Only for the scene: the passes after it draw a quad each, and the sky is drawn into its own cube.)
      if (sc !== this.scene) {
        drawShadows.call(shadowMap, lights, sc, camera);
        return;
      }
      const far = (this._farAlways || this._farDue) && this._farOn && shadowMap.enabled && (shadowMap.autoUpdate || shadowMap.needsUpdate) ? this.sunFar : null;
      drawShadows.call(shadowMap, lights, sc, camera);
      if (far) {
        this._farDue = false;
        far.shadow.needsUpdate = true;
        shadowMap.needsUpdate = true;
        const left = this.nearOnly;
        const shown = this._shown;
        for (let i = 0; i < left.length; i++) {
          shown[i] = left[i].visible;
          left[i].visible = false;
        }
        drawShadows.call(shadowMap, this._farLights, sc, camera);
        for (let i = 0; i < left.length; i++) left[i].visible = shown[i];
        this._farDrawn();
      }
      if (this._farOn) styleU.uShFarM.value.copy(this.sunFar.shadow.matrix).multiply(_inv.copy(this.sun.shadow.matrix).invert());
    };

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
    scene.add(this.hemi);

    this.apply(look);
  }

  apply(look, rebake = true) {
    this.look = look;
    const u = this.uniforms;
    const sunDir = this.sunDir || (this.sunDir = new THREE.Vector3());
    sunDir.set(
      Math.cos(look.sunElev) * Math.cos(look.sunAz),
      Math.sin(look.sunElev),
      Math.cos(look.sunElev) * Math.sin(look.sunAz),
    ).normalize();
    u.uZenith.value.set(look.zenith);
    u.uHorizon.value.set(look.horizon);
    u.uGround.value.set(look.ground);
    u.uSunColor.value.set(look.sunColor);
    u.uSunDir.value.copy(sunDir);
    styleU.uSunDirW.value.copy(sunDir);
    u.uGlow.value.set(look.glow);
    if (look.paint) {
      u.uPaintZ.value.fromArray(look.paint, 0);
      u.uPaintM.value.fromArray(look.paint, 3);
      u.uPaintH.value.fromArray(look.paint, 6);
      const ah = styleU.uAirH.value.fromArray(look.paint, 6);
      ah.x += (look.paint[3] - ah.x) * AIR.blue;
      ah.y += (look.paint[4] - ah.y) * AIR.blue;
      ah.z += (look.paint[5] - ah.z) * AIR.blue;
      u.uPaintK.value = look.paintK;
    } else {
      u.uPaintK.value = 0;
    }
    // The real style's sky (ALPINE_LOOK has none).
    if (look.real) {
      u.uRealZ.value.fromArray(look.real, 0);
      u.uRealM.value.fromArray(look.real, 3);
      u.uRealH.value.fromArray(look.real, 6);
      u.uRealK.value = look.realK;
    } else {
      u.uRealK.value = 0;
    }
    // (ALPINE_LOOK, the look the dome starts with, has no bands and no dusk.)
    if (look.paintShape) u.uPaintShape.value.fromArray(look.paintShape);
    else u.uPaintShape.value.set(0, 0.15, 0.3, 0.02);
    u.uPaintStars.value = look.paintStars || 0;
    u.uNightClouds.value = look.nightClouds || 0;
    // A night's painted sky is a day's to the style that takes it so, and no
    // painted sky to the others, which keep the numbers of their night there
    // (paintedNight, render/style.js).
    paintedNight.value = u.uPaintShape.value.x;
    paintedSky.value = Math.max(0, u.uPaintK.value - paintedNight.value);
    // What the painted style does to the paints of a world lit by night.
    if (look.dusk) {
      styleU.uDuskDark.value.fromArray(look.dusk, 0);
      styleU.uDuskLit.value.fromArray(look.dusk, 4);
      styleU.uDuskOwn.value.fromArray(look.dusk, 8);
      styleU.uDuskLine.value.fromArray(look.dusk, 11);
      styleU.uDuskFig.value = look.dusk[14];
    } else {
      styleU.uDuskDark.value.set(0, 0, 0, 0);
      styleU.uDuskLit.value.set(1, 1, 1, 1);
      styleU.uDuskOwn.value.set(1, 1, 1);
      styleU.uDuskLine.value.set(1, 1, 1);
      styleU.uDuskFig.value = 0;
    }
    u.uCloud.value = look.clouds;
    // The palettes of the pixel style (render/pixelpal.js): the world behind's and the world ahead's.
    if (look.pixelA) setPalettes(look.pixelA, look.pixelB, look.pixelT);
    skyCloudShade.value = look.cloudShadow === undefined ? 1 : look.cloudShadow;
    // The colour of the light on the painted style's paints (render/style.js, uSkyLit).
    if (look.tint) {
      styleU.uSkyLit.value.fromArray(look.tint, 0);
      styleU.uSkyShade.value.fromArray(look.tint, 3);
    } else {
      styleU.uSkyLit.value.set(1, 1, 1);
      styleU.uSkyShade.value.set(1, 1, 1);
    }
    // The inks a woodblock print is printed in (render/style.js, printInks).
    printInks.set(look.print || PRINT_INKS);
    if (look.cloudPaint) {
      const cp = look.cloudPaint;
      u.uCloudLit.value.fromArray(cp, 0);
      u.uCloudMid.value.fromArray(cp, 3);
      u.uCloudShade.value.fromArray(cp, 6);
      u.uCloudUnder.value.fromArray(cp, 9);
    }
    // How much of the light is the sun's: its strength against what its world gives it by day (a grey sky has a third).
    u.uSunny.value = Math.min(1, look.sunIntensity / Math.max(look.dayLight || look.sunIntensity, 0.01));
    if (look.cloudReal) {
      const cr = look.cloudReal;
      u.uRCloudLit.value.fromArray(cr, 0);
      u.uRCloudMid.value.fromArray(cr, 3);
      u.uRCloudShade.value.fromArray(cr, 6);
      u.uRCloudUnder.value.fromArray(cr, 9);
    }
    this.clouds.want(look.cloudSet);
    u.uStars.value = look.stars || 0;
    u.uUpside.value = look.upside || 0;
    u.uPlanet.value = look.planet || 0;

    this.scene.fog.color.set(look.horizon);
    // How much of a day's sky this is (the sky shader's own measure): a
    // painted style's distance turns blue only under one.
    const z = u.uZenith.value;
    const zl = z.r * 0.2126 + z.g * 0.7152 + z.b * 0.0722;
    skyDay.value = THREE.MathUtils.smoothstep(zl, 0.02, 0.06);
    atmo.fogParams.value.set(look.fogDensity, look.fogBase, look.fogFalloff);
    atmo.fogSunDir.value.copy(sunDir);
    atmo.fogSunColor.value.set(look.glow);

    this.sun.color.set(look.sunColor);
    this.sun.intensity = look.sunIntensity;
    this.hemi.color.set(look.skyLight);
    this.hemi.groundColor.set(look.groundLight);
    this.hemi.intensity = look.hemiIntensity;
    this.scene.environmentIntensity = look.envIntensity;
    if (rebake) this._envDirty = true;
  }

  // Render the sky alone into a cube map and prefilter it, so reflections and
  // ambient light come from the sky the player is actually looking at. The
  // sky's scene, the cube, the prefilter and its output are kept and drawn
  // into again: making them anew for each bake, and throwing the last ones
  // away, cost 8-30 ms a time (new targets, the prefilter's shaders built
  // again, every material set up again for a new texture) against 0.3 ms.
  bakeEnvironment() {
    const r = this.renderer;
    if (!this._env) {
      const scene = new THREE.Scene();
      // The dome itself follows the camera; the cube camera sits at the
      // origin, and outside the sphere it sees nothing.
      const sky = new THREE.Mesh(this.sky.geometry, this.skyPlain);
      sky.scale.setScalar(10);
      sky.frustumCulled = false;
      scene.add(sky);
      this._envSky = sky;
      const cube = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
      this._env = { scene, cube, camera: new THREE.CubeCamera(0.1, 100, cube), pmrem: new THREE.PMREMGenerator(r), out: null };
    }
    const e = this._env;
    // With the clouds of the style in it, where it has them; and, where the sky has
    // a planet, the glow that is its light (render/spacesky.js), in the programs that
    // draw it.
    const shine = this.deferWarm && !this._spaceReady ? null : this.space.shine(this.look);
    const base = skyStyle.uHeaps.value > 0 ? this.skyPlainHeaps : this.skyPlain;
    e.scene.children[0].material = shine ? this._spaceOf.get(base) : base;
    // The painted style's deep sky is how it looks, not how much blue it
    // sheds: lit by it, a grey road went navy. The light comes from the sky
    // as it is; the clouds stay in it. (The real style's three colours are
    // left out the same way.)
    const sat = skyStyle.uSkySat.value;
    const blue = skyStyle.uSkyBlue.value;
    const col = skyStyle.uSkyCol.value;
    const step = skyStyle.uSkyStep.value;
    const real = skyStyle.uSkyReal.value;
    skyStyle.uSkySat.value = 0;
    skyStyle.uSkyBlue.value = 0;
    skyStyle.uSkyCol.value = 0;
    skyStyle.uSkyStep.value = 0;
    skyStyle.uSkyReal.value = 0;
    // The sky is baked as it is, not as the corkscrew shows it (twist.js).
    const wound = twistU.uTwist.value[0];
    twistU.uTwist.value[0] = 0;
    if (shine) this.space.bake(true, shine);
    e.camera.update(r, e.scene);
    // (The sky's mean light is taken without it, both ways.)
    if (shine) this.space.bake(true);
    this._diffuseShare(e, r);
    if (shine) this.space.bake(false);
    twistU.uTwist.value[0] = wound;
    skyStyle.uSkySat.value = sat;
    skyStyle.uSkyBlue.value = blue;
    skyStyle.uSkyCol.value = col;
    skyStyle.uSkyStep.value = step;
    skyStyle.uSkyReal.value = real;
    e.out = e.pmrem.fromCubemap(e.cube.texture, e.out);
    this.scene.environment = e.out.texture;
    this.bakes = (this.bakes || 0) + 1;
    this._envDirty = false;
  }

  // The sky's light on the land's diffuse side holds where it was when the
  // sky was a day of cloud worked out for every pixel: a style with baked
  // clouds draws a blue sky with heaps in it, which gives less light than an
  // overcast one, and the land would go 3 to 5 % darker with it. The mean
  // radiance of the sky as the style draws it (the upper half counting for more) is taken, and of the sky with
  // the clouds the style lights by (skyLight), on a cube 16 texels a face; the
  // diffuse light is scaled by the one over the other. The reflections (the
  // car's paint) show the sky as it is, unscaled. The real style's is held in each of the three colours
  // on its own, so that the light in the shade keeps the colour it had as well as its strength.
  _diffuseShare(e, r) {
    const hv = skyStyle.uHeaps.value;
    if (hv <= 0) {
      atmo.uEnvDiffuse.value.setScalar(1);
      return;
    }
    if (!e.small) {
      e.small = new THREE.WebGLCubeRenderTarget(DIFFUSE_N, { type: THREE.HalfFloatType });
      e.smallCam = new THREE.CubeCamera(0.1, 100, e.small);
      e.smallBuf = new Uint16Array(DIFFUSE_N * DIFFUSE_N * 4);
    }
    const half = (h) => {
      const e5 = (h >> 10) & 31;
      const f = h & 1023;
      const v = e5 === 0 ? 6.103515625e-5 * f / 1024 : e5 === 31 ? 65504 : Math.pow(2, e5 - 15) * (1 + f / 1024);
      return h & 0x8000 ? -v : v;
    };
    // (The real style's clouds are mostly low, and the land it lights faces up: its mean is of what a surface
    // facing up takes, not of what one half turned does.)
    const upK = skyStyle.uCloudReal.value;
    const mean = () => {
      e.smallCam.update(r, e.scene);
      let sum = 0;
      let wsum = 0;
      const rgb = [0, 0, 0];
      for (let f = 0; f < 6; f++) {
        r.readRenderTargetPixels(e.small, 0, 0, DIFFUSE_N, DIFFUSE_N, e.smallBuf, f);
        for (let y = 0; y < DIFFUSE_N; y++) {
          for (let x = 0; x < DIFFUSE_N; x++) {
            const a = (x + 0.5) * 2 / DIFFUSE_N - 1;
            const b = (y + 0.5) * 2 / DIFFUSE_N - 1;
            const k = 1 + a * a + b * b;
            // The solid angle of the texel, and a surface facing up, and one
            // standing, take the light of the upper sky more than of the lower.
            const dy = [-b, -b, 1, -1, -b, -b][f] / Math.sqrt(k);
            const w = (0.5 + 0.5 * dy + (Math.max(dy, 0) - 0.5 - 0.5 * dy) * upK) / Math.pow(k, 1.5);
            const i = (y * DIFFUSE_N + x) * 4;
            sum += w * (0.2126 * half(e.smallBuf[i]) + 0.7152 * half(e.smallBuf[i + 1]) + 0.0722 * half(e.smallBuf[i + 2]));
            rgb[0] += w * half(e.smallBuf[i]);
            rgb[1] += w * half(e.smallBuf[i + 1]);
            rgb[2] += w * half(e.smallBuf[i + 2]);
            wsum += w;
          }
        }
      }
      return { lum: sum / wsum, rgb: rgb.map((v) => v / wsum) };
    };
    const now = mean();
    const dome = e.scene.children[0];
    const material = dome.material;
    const keep = [skyStyle.uHeaps.value, skyStyle.uCumulus.value, skyStyle.uSkyPaint.value, skyStyle.uTowers.value];
    skyStyle.uHeaps.value = 0;
    skyStyle.uCumulus.value = skyLight.cumulus;
    skyStyle.uSkyPaint.value = skyLight.skyPaint;
    skyStyle.uTowers.value = skyLight.towers;
    dome.material = this.skyPlain;
    // Those clouds drift with the time, and their mean with them by a part in
    // a thousand: they are taken where they stand at time 0, so that the
    // light is the world's and the style's and not the moment's.
    const time = this.uniforms.uTime.value;
    this.uniforms.uTime.value = 0;
    const was = mean();
    this.uniforms.uTime.value = time;
    [skyStyle.uHeaps.value, skyStyle.uCumulus.value, skyStyle.uSkyPaint.value, skyStyle.uTowers.value] = keep;
    dome.material = material;
    const share = (ratio) => 1 + (THREE.MathUtils.clamp(ratio, 0.5, 3) - 1) * hv;
    if (upK > 0) {
      atmo.uEnvDiffuse.value.set(...was.rgb.map((v, k) => share(v / Math.max(now.rgb[k], 1e-4))));
    } else {
      atmo.uEnvDiffuse.value.setScalar(share(was.lum / Math.max(now.lum, 1e-4)));
    }
  }

  // Whether the sky has nothing in it but the baked clouds: all of the style's
  // sky is theirs (no old clouds, no blocks) and the world's has no stars,
  // planet or lightning anywhere in view (the ring counts: a far horizon can
  // be a night's).
  _pureSky() {
    const u = this.uniforms;
    if (u.uHeaps.value < 1 || u.uCumulus.value !== 0 || u.uTowers.value !== 0 || u.uBlockSky.value !== 0
      || u.uStars.value !== 0 || u.uPlanet.value !== 0 || u.uUpside.value !== 0 || u.uFlash.value > 0.003
      || u.uPaintShape.value.x > 0 || u.uPaintStars.value > 0) return false;
    const z = u.uRingZ.value;
    for (let i = 3; i < z.length; i += 4) if (z[i] !== 0) return false;
    return true;
  }

  // The four programs of the space world's sky, started in the compiler's threads where the
  // browser has them, so that no frame is held for them: the first of the space world's that
  // is in view asks, and the sky is the one it had until they are built (everything the space
  // world adds to the sky weighs what the world's stars do, which is nothing at the edge of it).
  // The light the planet gives is laid in the environment map once they are.
  _buildSpace(camera) {
    this._spaceAsked = true;
    const scene = new THREE.Scene();
    const domes = [];
    for (const m of this._spaceOf.values()) {
      const dome = new THREE.Mesh(this.sky.geometry, m);
      dome.frustumCulled = false;
      scene.add(dome);
      domes.push(dome);
    }
    const done = () => {
      this._spaceReady = true;
      this._envDirty = true;
    };
    compileObjects(this.renderer, scene, camera, domes).then(done, done);
  }

  // Whether the sky has stars or a planet anywhere in view (the ring counts: a
  // far horizon can be the space world's).
  _spaceInView() {
    const u = this.uniforms;
    if (u.uStars.value !== 0 || u.uPlanet.value !== 0) return true;
    const z = u.uRingZ.value;
    for (let i = 3; i < z.length; i += 4) if (z[i] !== 0) return true;
    return false;
  }

  // The sky of the first frame, started in the compiler's threads before it: a style that has baked
  // clouds from the start (the real one, by day) draws with the program that has them alone, not the
  // one the dome is made with. Resolves when it is built; none for a style that has no baked clouds.
  warmFirst(camera) {
    if (!(skyStyle.uHeaps.value > 0)) return null;
    const scene = new THREE.Scene();
    const dome = new THREE.Mesh(this.sky.geometry, this._pureSky() ? this.skyPlainPure : this.skyPlainHeaps);
    dome.frustumCulled = false;
    scene.add(dome);
    const sky = compileObjects(this.renderer, scene, camera, [dome]);
    // (And the program the clouds are baked with, where the first frame has them baked: bakeFirst.)
    return this._firstSky() ? Promise.all([sky, this.clouds.warm()]) : sky;
  }

  // Whether the page is to have the real style's clouds baked and its cirrus in hand for its first frame:
  // the style draws baked clouds by day and the page holds them until the first frame is up (a headless run
  // bakes them at once, whenever it is asked).
  _firstSky() {
    return this.holdClouds && skyStyle.uHeaps.value > 0 && skyStyle.uCloudReal.value > 0;
  }

  // One turn of the first bake of the clouds (a strip of it), before the first frame, so that the sky has
  // them from the start and not a second on, and the sky's light is not baked again for them. True once
  // there is nothing left of it.
  bakeFirst() {
    if (!this._firstSky() || this.clouds.baked) return true;
    this.clouds.update(0, true);
    return this.clouds.baked;
  }

  // The same for the cirrus' tile: asked for, and true once it is in hand (or the tier draws none).
  cirrusFirst() {
    if (!this._firstSky() || !this.cirrusWanted()) return true;
    this._askCirrus();
    return this.cirrus.held;
  }

  // The programs of the clouds, built ahead (the first strip and the sky that
  // shows them are built when the style asks otherwise, in a frame that is
  // already changing a style).
  _warmClouds(camera) {
    this.clouds.warm();
    for (const mat of [this.skyPlainHeaps, this.skyPlainPure]) this._warmSky(mat, camera);
  }

  _warmSky(mat, camera) {
    const scene = new THREE.Scene();
    const dome = new THREE.Mesh(this.sky.geometry, mat);
    dome.frustumCulled = false;
    scene.add(dome);
    compileAsDrawn(this.renderer, scene, camera);
  }

  // f, with the lit materials of group (all of them if none) in the programs of
  // the other kind; in one call, so that no frame is drawn with the wrong one.
  _otherKind(group, f) {
    const mats = group || hooked;
    const was = pairProgram.on;
    pairProgram.on = !was;
    try {
      for (const m of mats) m.needsUpdate = true;
      f();
    } finally {
      pairProgram.on = was;
      for (const m of mats) m.needsUpdate = true;
    }
  }

  // The second frame's work in pieces, for a queue (src/boot.js): the lit
  // materials' programs of the other kind one at a time, the hooks (grass,
  // animals), the clouds and the two skies that show them. [[name, task]]
  warmTasks(camera) {
    const renderer = this.renderer;
    const scene = this.scene;
    const tasks = [];
    for (const { mat, o } of distinct((f) => scene.traverse(f), (m) => hooked.has(m))) {
      tasks.push([`program.${tasks.length}`, () => this._otherKind([mat], () => compileObjects(renderer, scene, camera, [o]))]);
    }
    warmHooks.forEach((hook, n) => {
      tasks.push([`hook.${n}`, () => this._otherKind(null, () => hook(renderer, scene, camera))]);
    });
    tasks.push(['clouds', () => this.clouds.warm()]);
    tasks.push(['sky.heaps', () => this._warmSky(this.skyPlainHeaps, camera)]);
    tasks.push(['sky.pure', () => this._warmSky(this.skyPlainPure, camera)]);
    return tasks;
  }

  // How much of the space world's sky is drawn (high, mid or low). Where it goes
  // from none to some, the light the planet gives is laid in the environment map or
  // taken out of it. The sun's shadow is by the tier too (SHADOW).
  setTier(t) {
    const was = this.space.on;
    this.space.setTier(t);
    if (this.space.on !== was) this._envDirty = true;
    // The real style's clouds: the taps of their soft edge, and whether there is cirrus at all.
    if (CLOUD_SOFT[t] !== undefined) {
      this.tier = t;
      if (this.uniforms.uCloudSoft.value !== CLOUD_SOFT[t]) {
        this.uniforms.uCloudSoft.value = CLOUD_SOFT[t];
        this._envDirty = true;
      }
    }
    this._shadowTier = t;
    this._shadowSetup();
  }

  // The block style draws no far map: it is the cheapest of the styles to draw, and what is far has its baked shade.
  // The near map stays as it is, and the far map's texels are let go of.
  setBlocky(on) {
    if (on === this._blocky) return;
    this._blocky = on;
    this._shadowSetup();
  }

  // How many texels a map of the sun's shadow is across (render/quality.js halves them when the
  // frame rate is low); the low tier's one map is its own size.
  setShadowSize(n) {
    if (n === this._shadowSize) return;
    this._shadowSize = n;
    this._shadowSetup();
  }

  // The sun's maps as the tier and the size have them: the near one's reach and texels (the low tier's
  // one map is wider and coarser, and there is no far map), their biases, and what the shaders are told.
  _shadowSetup() {
    const alone = this._shadowTier === 'low';
    const [near, far] = this.cascades;
    const R = SHADOW.planes[1] - SHADOW.planes[0];
    const size = alone ? SHADOW.aloneSize : this._shadowSize;
    near.half = alone ? SHADOW.alone : SHADOW.near;
    far.half = SHADOW.far;
    this._farOn = !alone && !this._blocky;
    far.on = this._farOn;
    const fit = (light, half, texels) => {
      const sh = light.shadow;
      const c = sh.camera;
      c.left = -half;
      c.right = half;
      c.top = half;
      c.bottom = -half;
      c.near = SHADOW.planes[0];
      c.far = SHADOW.planes[1];
      c.updateProjectionMatrix();
      if (sh.mapSize.x !== texels) {
        sh.mapSize.set(texels, texels);
        if (sh.map) {
          sh.map.dispose();
          sh.map = null;
        }
        return true;
      }
      return false;
    };
    const texel = (2 * near.half) / size;
    const farTexel = (2 * far.half) / size;
    fit(this.sun, near.half, size);
    this.sun.shadow.bias = -SHADOW.bias.near[0] * texel / R;
    this.sun.shadow.normalBias = SHADOW.normal * texel;
    if (this._farOn) {
      fit(this.sunFar, far.half, size);
      styleU.uShFarSize.value.set(size, size);
    } else if (this.sunFar.shadow.map) {
      // (The low tier and the block style have no far map: its texels are let go of.)
      this.sunFar.shadow.map.dispose();
      this.sunFar.shadow.map = null;
      styleU.uShFar.value = null;
    }
    styleU.uShBias.value.set(SHADOW.bias.near[1] * texel / R, SHADOW.bias.far[1] * farTexel / R, SHADOW.bias.far[0] * farTexel / R, SHADOW.blend / (2 * near.half));
    // A far map is drawn at the next frame, and used when it has been.
    this._farDue = true;
    styleU.uShFarOn.value = 0;
  }

  // The sun's shadow maps are let go of, and the renderer draws its own again.
  dispose() {
    this.renderer.shadowMap.render = this._drawShadows;
    this.sun.shadow.dispose();
    this.sunFar.shadow.dispose();
    this.sunFar.shadow.map = null;
    styleU.uShFar.value = null;
    styleU.uShFarOn.value = 0;
    this._farOn = false;
  }

  // The far map was just drawn: the shaders have it, and it is where the light was.
  _farDrawn() {
    const far = this.cascades[1];
    styleU.uShFar.value = this.sunFar.shadow.map ? this.sunFar.shadow.map.texture : null;
    styleU.uShFarOn.value = this.sunFar.shadow.map ? 1 : 0;
    this._farAt.x = far.x;
    this._farAt.z = far.z;
    this._farDir.copy(this.sunDir);
  }

  // The sun's maps laid where the lens looks: each centred a way ahead of it along the
  // way it is turned, kept within reach of the car, and moved by whole texels in a
  // frame the world holds still in (absolute metres, so that it holds when the floating
  // origin moves). The light's axes are those the shadow camera has looking
  // from the sun at the centre. Returns where the centre is, in the scene's.
  _lay(c, aim, keep, camera, focus) {
    const d = this.sunDir;
    const o = styleU.uOriginAbs.value;
    let rx = d.z;
    let rz = -d.x;
    const rl = Math.hypot(rx, rz);
    if (rl < 1e-4) {
      rx = 1;
      rz = 0;
    } else {
      rx /= rl;
      rz /= rl;
    }
    // (The camera's up: the sun's direction crossed with its right.)
    const ux = d.y * rz;
    const uy = d.z * rx - d.x * rz;
    const uz = -d.y * rx;
    const lens = camera.position;
    camera.getWorldDirection(_lens);
    const h = Math.hypot(_lens.x, _lens.z);
    const ax = h > 0.05 ? _lens.x / h : 0;
    const az = h > 0.05 ? _lens.z / h : 0;
    const cx = lens.x + ax * aim;
    const cz = lens.z + az * aim;
    const cy = focus.y;
    const a0 = (cx + o.x) * rx + (cz + o.z) * rz;
    const u0 = (cx + o.x) * ux + cy * uy + (cz + o.z) * uz;
    const fa = (focus.x + o.x) * rx + (focus.z + o.z) * rz;
    const fu = (focus.x + o.x) * ux + focus.y * uy + (focus.z + o.z) * uz;
    const lim = c.half - keep;
    const texel = (2 * c.half) / c.light.shadow.mapSize.x;
    const a1 = Math.round(Math.min(Math.max(a0, fa - lim), fa + lim) / texel) * texel;
    const u1 = Math.round(Math.min(Math.max(u0, fu - lim), fu + lim) / texel) * texel;
    const x = cx + (a1 - a0) * rx + (u1 - u0) * ux;
    const y = cy + (u1 - u0) * uy;
    const z = cz + (a1 - a0) * rz + (u1 - u0) * uz;
    const light = c.light;
    light.position.set(x + d.x * SHADOW.dist, y + d.y * SHADOW.dist, z + d.z * SHADOW.dist);
    light.target.position.set(x, y, z);
    light.target.updateMatrixWorld();
    if (c !== this.cascades[0]) light.updateMatrixWorld();
    c.x = x + o.x;
    c.z = z + o.z;
  }

  // The real style's cirrus is wanted: the style draws it (the numbers say so), and the tier has it.
  cirrusWanted() {
    return this.uniforms.uCirrus.value > 0 && this.tier !== 'low';
  }

  // Ask for the cirrus' tile once it is wanted: of a worker (bakers) where there is a pool, or make it
  // here, on the page, where there is none or it has failed.
  _askCirrus() {
    const c = this.cirrus;
    if (c.held || !this.cirrusWanted()) return;
    const b = this.bakers;
    if (b && !b.failed) c.request(b);
    else c.make();
  }

  // Follow the car: the shadow frustum stays tight around it and the dome is
  // centred on the camera.
  update(dt, camera, focus) {
    this.uniforms.uTime.value += dt;
    // (The second frame: the first has built the programs the style drawn
    // needs. A page with a queue does it there: warmTasks.)
    this._frames = (this._frames || 0) + 1;
    if (this._frames === 2 && !this.deferWarm) {
      warmPrograms(this.renderer, this.scene, camera);
      this._warmClouds(camera);
    }
    const heaps = skyStyle.uHeaps.value > 0;
    this.clouds.update(dt, heaps && !this.holdClouds);
    if (heaps && this.clouds.takeChanged()) this._envDirty = true;
    if (!this.holdClouds) {
      this._askCirrus();
      // (The sky's light is baked again once the cirrus is in it.)
      if (this.cirrus.held && !this._cirrusIn) {
        this._cirrusIn = true;
        if (skyStyle.uCirrus.value > 0) this._envDirty = true;
      }
    }
    this.sky.position.copy(camera.position);
    // The other side's sky is drawn while the world is wound over anywhere
    // in reach (render/upside.js). Its shader is built the frame a winding
    // first comes into reach, kilometres before it can be seen.
    const wound = twistU.uTwist.value[0] > 0.5;
    if (wound && !this._foldWarm) {
      this._foldWarm = true;
      for (const mat of [this.skyFold, this.skyFoldHeaps, this.skyFoldPure]) {
        const scene = new THREE.Scene();
        const dome = new THREE.Mesh(this.sky.geometry, mat);
        dome.frustumCulled = false;
        scene.add(dome);
        compileAsDrawn(this.renderer, scene, camera);
      }
    }
    let dome = wound
      ? (heaps ? (this._pureSky() ? this.skyFoldPure : this.skyFoldHeaps) : this.skyFold)
      : (heaps ? (this._pureSky() ? this.skyPlainPure : this.skyPlainHeaps) : this.skyPlain);
    // A sky with stars or a planet in it is the space world's, with its own code: in a page, once
    // the programs it takes are built (until then it is the sky it had).
    this.space.update(this.uniforms.uTime.value);
    if (this.space.on && this._spaceInView()) {
      this._spaceOut = 0;
      // The noise it reads is worked out into its textures first: a page does a slice of it a frame.
      const mapped = this.space.bakeMaps(this.deferWarm ? MAPS_SLICE : Infinity);
      if (this.deferWarm && !this._spaceAsked) this._buildSpace(camera);
      if (mapped && (!this.deferWarm || this._spaceReady)) dome = this._spaceOf.get(dome) || dome;
    } else if (this.space.mapsReady && (this._spaceOut += dt) > MAPS_KEEP) {
      // (Long enough away from the space world, they are let go of.)
      this.space.releaseMaps();
    }
    this.sky.material = dome;
    // The sun's shadow maps (_lay).
    const [near, far] = this.cascades;
    this._lay(near, SHADOW.aim[0], SHADOW.keep[0], camera, focus);
    if (this._farOn) {
      this._lay(far, SHADOW.aim[1], SHADOW.keep[1], camera, focus);
      const every = SHADOW.every[this._shadowTier] || 2;
      if (this._shadowTick++ % every === 0 || !this.sunFar.shadow.map || this._farDir.dot(this.sunDir) < 0.9999
        || Math.hypot(far.x - this._farAt.x, far.z - this._farAt.z) > far.reset) this._farDue = true;
    }
    // The sun's light, in the units the style's paired paints take the sky's
    // in (they are laid at the level of the two together).
    const sc = this.sun.color;
    styleU.uPairSun.value = (sc.r * 0.2126 + sc.g * 0.7152 + sc.b * 0.0722) * this.sun.intensity;
    styleU.uPairInvSun.value = sunShare(this.look.shadow) / Math.max(styleU.uPairSun.value, 1e-4);
    if (this._envDirty) this.bakeEnvironment();
  }
}

// The paint of a baked cloud in the real style: its lit top, middle, shaded side and underside,
// linear RGB, as they go into the tone curve (divided by the exposure when drawn): the sun's light
// and the sky's on a white body. A world's own look says its own (worlds.js, cloudReal), or this.
export const CLOUD_REAL_DEFAULT = [[1.08, 1.02, 0.92], [0.46, 0.51, 0.60], [0.18, 0.215, 0.28], [0.165, 0.157, 0.150]];

// The alpine afternoon: a warm sun high enough to light the valley floors,
// low enough to rake across the ridges; cool blue shade; a thin haze that keeps
// the far ranges in layers.
export const ALPINE_LOOK = {
  sunElev: 0.6,
  sunAz: 2.35,
  sunColor: 0xfff0dc,
  sunIntensity: 3.6,
  zenith: 0x2f63a8,
  horizon: 0xc4d6e6,
  ground: 0x6f6b5c,
  glow: 0xffd9ae,
  clouds: 0.55,
  fogDensity: 0.00017,
  fogBase: 0,
  fogFalloff: 720,
  dayLight: 3.6,
  // The sky dome already lights everything through the environment map; the
  // hemisphere light only adds a little directional bias (sky above, warm
  // ground bounce below), or the shade turns blue and flat.
  skyLight: 0xb9c9dc,
  groundLight: 0x6e6550,
  hemiIntensity: 0.22,
  envIntensity: 1.0,
  exposure: 2.0,
  cloudReal: CLOUD_REAL_DEFAULT.flat(),
};
