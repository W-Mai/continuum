// What the land's shader does for the hills' farmland (render/terrain.js lays these into its program):
// the fields, each the colour of its crop, with a bank between one and the next and the furrows of the
// ploughed ones, and the farm tracks that leave the road across them; and, for the road's verge
// (render/roadmesh.js), the ruts at the mouth of a track.
//
// Which field a pixel is in is told from its absolute position alone, by the same lattice, the same integer
// hash and the same arithmetic as world/fields.js, which the trees, the stacks of straw and the checks ask.
// The land's own colour (its grass, its patches of dry and lush) is under each crop's: a field is laid on the
// meadow, not instead of it, and a style of flat paints (cel, print, pixel) has the crop's one flat colour.
// Nothing of it is worked out where the world has no fields (the palette's fifth texel, its second number).

import * as THREE from 'three';
import { FIELD, CROPS } from '../world/fields.js';
import { TRACK } from '../world/hillsplan.js';

// How many farm tracks the land's shader is told of at a time.
export const MAX_TRACKS = 4;

const srgb = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
const f = (x) => x.toFixed(5);
const v3 = (c) => `vec3( ${f(c.r)}, ${f(c.g)}, ${f(c.b)} )`;
const table = (name, list) => `const vec3 ${name}[ ${list.length} ] = vec3[ ${list.length} ](\n  ${list.map((hex) => v3(srgb(hex))).join(',\n  ')}\n);`;
const cuts = CROPS.slice(0, -1).map((c, i) => CROPS.slice(0, i + 1).reduce((s, e) => s + e.share, 0));

// The uniforms: uFieldK (x: how far fields are laid, 0 to 1, by the tier; y: how much of their detail, the banks, the
// furrows and the tracks), the tracks (each four points of the scene's coordinates, [x, z] a pair, and the middle
// of it and how far it reaches, 0 for none) and the ruts at the mouths of those tracks on the road's verge (x, z, the
// way out, as the scene has them).
export const fieldU = {
  uFieldK: { value: new THREE.Vector4(1, 1, 0, 0) },
  uTrackA: { value: Array.from({ length: MAX_TRACKS }, () => new THREE.Vector4()) },
  uTrackB: { value: Array.from({ length: MAX_TRACKS }, () => new THREE.Vector4()) },
  uTrackC: { value: Array.from({ length: MAX_TRACKS }, () => new THREE.Vector3()) },
  uJunction: { value: Array.from({ length: MAX_TRACKS }, () => new THREE.Vector4()) },
  uJunctions: { value: 0 },
};

// The functions of the land's fragment shader.
export const FIELD_COMMON = /* glsl */`
#ifdef FOLD_ALPHA
#define FGATE( c ) NEED( c )
#else
#define FGATE( c ) ( c )
#endif
uniform vec4 uFieldK;
uniform vec4 uTrackA[ ${MAX_TRACKS} ];
uniform vec4 uTrackB[ ${MAX_TRACKS} ];
uniform vec3 uTrackC[ ${MAX_TRACKS} ];
${table('F_COL', CROPS.map((c) => c.color))}
${table('F_FLAT', CROPS.map((c) => c.flat))}
const float F_GRASS[ ${CROPS.length} ] = float[ ${CROPS.length} ]( ${CROPS.map((c) => f(c.grass)).join(', ')} );
// (World/fields.js's hash: a lattice cell and a salt to a number in [0, 1).)
float fHash( ivec2 c, uint salt ) {
  uint h = ( uint( c.x ) * 0x8da6b343u ) ^ ( uint( c.y ) * 0xd8163841u ) ^ ( salt * 0x2545f491u );
  h ^= h >> 13u;
  h *= 0x5bd1e995u;
  h ^= h >> 15u;
  return float( h & 0xffffffu ) / 16777216.0;
}
vec2 fPoint( ivec2 c ) {
  return ( vec2( 0.5 ) + ( vec2( fHash( c, 1u ), fHash( c, 2u ) ) - 0.5 ) * ${f(FIELD.stray)} ) * ${f(FIELD.cell)};
}
// The field of a point (metres, absolute): the lattice cells of its own point and of the field across the nearest border
// of it, and how far into its own the point is from that border.
void fieldCell( vec2 p, out ivec2 ca, out ivec2 cb, out float edge ) {
  ivec2 c0 = ivec2( floor( p / ${f(FIELD.cell)} ) );
  vec2 q0 = p - vec2( c0 ) * ${f(FIELD.cell)};
  vec2 pts[ 9 ];
  float best = 1e9;
  int bi = 0;
  for ( int k = 0; k < 9; k++ ) {
    ivec2 d = ivec2( k % 3 - 1, k / 3 - 1 );
    vec2 q = fPoint( c0 + d ) + vec2( d ) * ${f(FIELD.cell)};
    pts[ k ] = q;
    vec2 e = q - q0;
    float dd = dot( e, e );
    if ( dd < best ) { best = dd; bi = k; }
  }
  vec2 m = pts[ bi ];
  edge = 1e9;
  int bj = bi;
  for ( int k = 0; k < 9; k++ ) {
    if ( k == bi ) continue;
    vec2 n = pts[ k ] - m;
    float d = dot( ( m + pts[ k ] ) * 0.5 - q0, n ) / length( n );
    if ( d < edge ) { edge = d; bj = k; }
  }
  ca = c0 + ivec2( bi % 3 - 1, bi / 3 - 1 );
  cb = c0 + ivec2( bj % 3 - 1, bj / 3 - 1 );
}
int fCrop( ivec2 c ) {
  float u = fHash( c, 3u );
  int k = 0;
${cuts.map((c, i) => `  if ( u >= ${f(c)} ) k = ${i + 1};`).join('\n')}
  return k;
}
// A field's colour: its crop's, in the tone its own number gives it (some wheat is further on toward ripe).
vec3 fBase( int k, float tone ) {
  vec3 c = F_COL[ k ];
  if ( k == 0 ) c = mix( c, ${v3(srgb(0xb89c40))}, tone * 0.6 );
  return c * ( 0.9 + 0.2 * fract( tone * 7.31 ) );
}
// How much of a pixel lies in a band along a border, half a metre or so wide either side of it (the box filter): the
// pixel is at d metres from the border's middle and reaches w either way.
float fCover( float d, float w, float hw ) {
  return clamp( ( min( d + w, hw ) - max( d - w, -hw ) ) / ( 2.0 * w ), 0.0, 1.0 );
}
// How light a colour is (the L of OKLab, from linear RGB), and the colour with its lightness taken to lg by the
// share k: the same hue and as full as it was, as light as the meadow it lies on.
float fLight( vec3 c ) {
  vec3 lms = vec3( 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
    0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
    0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b );
  lms = pow( max( lms, vec3( 1e-6 ) ), vec3( 0.3333333 ) );
  return 0.2104542553 * lms.x + 0.793617785 * lms.y - 0.0040720468 * lms.z;
}
vec3 fEven( vec3 c, float lg, float k ) {
  float s = lg / max( fLight( c ), 1e-3 );
  return mix( c, c * clamp( s * s * s, 0.2, 6.0 ), k );
}
float fSeg( vec2 p, vec2 a, vec2 b ) {
  vec2 ab = b - a;
  float l = dot( ab, ab );
  float t = l > 1e-4 ? clamp( dot( p - a, ab ) / l, 0.0, 1.0 ) : 0.0;
  return length( p - a - ab * t );
}
`;

// The block laid into the meadow's colour (the land's shader, where the grass's is made): fieldW, how much of the pixel is
// field, and the colour, flat colour and grass share it has; and trackW, how much of it is the track, with its colour.
// Needs forest (the baked trees' density), dist, vegN (the land's own mottle), dN, dG, uGrassLow, grass and the pixel's
// slope before it is turned into a face (fSlope). Where nothing is laid they are 0, and the land is as it was.
export const FIELD_ALBEDO = /* glsl */`
// The hills' farmland: each field of the lattice the colour of its crop, laid on the meadow, with its bank
// round it; the farm tracks over it.
float fieldW = 0.0;
vec3 fieldCol = vec3( 0.0 );
vec3 fieldFlat = vec3( 0.0 );
float fieldGrass = 1.0;
float trackW = 0.0;
vec3 trackCol = vec3( 0.0 );
float fPx = length( fwidth( vTPos.xz ) );
float wFields = worldPar( 5 ).w * uFieldK.x;
float flatK = 0.0;
#ifdef STYLE_PAIR
flatK = uFlatLand;
#endif
if ( FGATE( wFields > 0.0 ) ) {
  float fmask = wFields * ( 1.0 - smoothstep( ${f(FIELD.slope[0])}, ${f(FIELD.slope[1])}, fSlope ) )
    * smoothstep( ${f(FIELD.road[0])}, ${f(FIELD.road[1])}, vSurf.z )
    * ( 1.0 - smoothstep( ${f(FIELD.wood[0])}, ${f(FIELD.wood[1])}, forest ) )
    * ( 1.0 - smoothstep( 0.3, 1.2, vSurf.x + vSurf.y ) );
  vec2 fp = vTPos.xz + uWorldOrigin;
  if ( fmask > 0.002 ) {
    ivec2 fa;
    ivec2 fb;
    float fe;
    fieldCell( fp, fa, fb, fe );
    int ka = fCrop( fa );
    int kb = fCrop( fb );
    float ta = fHash( fa, 4u );
    float tb = fHash( fb, 4u );
    // The share of the pixel that is across the border, in the other field; and of it that is the bank.
    float aa = max( fPx * 0.5, 0.02 );
    float over = clamp( ( aa - fe ) / ( 2.0 * aa ), 0.0, 0.5 );
    float bank = fCover( fe, aa, ${f(FIELD.ridge / 2)} ) * uFieldK.y * ( 1.0 - flatK );
    // The rows: across the way this field's run, in metres; ploughed ground is in furrows ${FIELD.furrow} m apart, drilled crop in lines.
    float ang = fHash( fa, 6u ) * 3.14159265;
    float across = dot( fp, vec2( -sin( ang ), cos( ang ) ) );
    float rowK = uFieldK.y * ( 1.0 - flatK );
    float pat = 1.0;
    if ( ka == 2 ) {
      float fur = 0.5 + 0.5 * cos( across * ${f(2 * Math.PI / FIELD.furrow)} );
      pat = mix( 1.0, mix( 0.64, 1.16, smoothstep( 0.1, 0.9, fur ) ), rowK * ( 1.0 - smoothstep( ${f(FIELD.furrow * 0.1)}, ${f(FIELD.furrow * 0.36)}, fPx ) ) );
    } else if ( ka == 0 || ka == 6 ) {
      float row = 0.5 + 0.5 * cos( across * ${f(2 * Math.PI / FIELD.row)} );
      pat = mix( 1.0, 0.93 + 0.1 * row, rowK * ( 1.0 - smoothstep( ${f(FIELD.row * 0.1)}, ${f(FIELD.row * 0.36)}, fPx ) ) );
    }
    vec3 ca = fBase( ka, ta ) * pat;
    vec3 cb = fBase( kb, tb );
    // Clover is flecked with its flowers near, and tinted with them far off.
    if ( ka == 5 ) {
      float fleck = mix( 0.5, smoothstep( 0.56, 0.7, dN.g * 0.5 + dG.g * 0.5 ), 1.0 - smoothstep( 40.0, 200.0, dist ) );
      ca = mix( ca, ${v3(srgb(CROPS[5].fleck))}, 0.34 * fleck );
    }
    // The meadow's own mottle under it, and the bank in the grass of the meadow.
    float mott = 0.84 + 0.32 * vegN;
    vec3 colA = ca * mott;
    vec3 colB = cb * mott;
    vec3 bankCol = uGrassLow * ( 0.86 + 0.3 * dN.g );
    vec3 flatA = F_FLAT[ ka ];
    vec3 flatB = F_FLAT[ kb ];
    // Far off the fields differ in colour and not in how light they are: each is taken to the lightness of the meadow under it (of the
    // world's grass, in flat paints), so that a field is a patch of colour and not an edge that the eye finds from here to the horizon.
    float farK = smoothstep( ${f(FIELD.even[0])}, ${f(FIELD.even[1])}, dist );
    if ( farK > 0.0 ) {
      float lg = mix( fLight( grass ), fLight( uGrassLow ), flatK );
      colA = fEven( colA, lg, farK );
      colB = fEven( colB, lg, farK );
      bankCol = fEven( bankCol, lg, farK );
      flatA = fEven( flatA, lg, farK );
      flatB = fEven( flatB, lg, farK );
    }
    fieldCol = mix( mix( colA, colB, over ), bankCol, bank );
    fieldFlat = mix( flatA, flatB, over );
    fieldW = fmask;
    fieldGrass = mix( 1.0, mix( F_GRASS[ ka ], F_GRASS[ kb ], over ), fmask );
  }
  // The farm tracks: dirt in two ruts with grass between, a metre and a fifth to either side of the middle, that
  // grows over toward the end of it.
  float tk = 0.0;
  float tkD = 1e9;
  for ( int k = 0; k < ${MAX_TRACKS}; k++ ) {
    vec3 tc = uTrackC[ k ];
    if ( tc.z > 0.0 && distance( vTPos.xz, tc.xy ) < tc.z ) {
      vec4 a = uTrackA[ k ];
      vec4 b = uTrackB[ k ];
      float d = min( min( fSeg( vTPos.xz, a.xy, a.zw ), fSeg( vTPos.xz, a.zw, b.xy ) ), fSeg( vTPos.xz, b.xy, b.zw ) );
      float tw = fPx * 0.5 + 0.02;
      float cover = clamp( ( ${f(TRACK.width / 2)} + tw - d ) / ( 2.0 * tw ), 0.0, 1.0 );
      cover *= smoothstep( 6.0, 22.0, distance( vTPos.xz, b.zw ) ) * uFieldK.y * wFields;
      if ( cover > tk ) { tk = cover; tkD = d; }
    }
  }
  if ( tk > 0.0 ) {
    trackW = tk;
    // The ruts are darker where the wheels run, the middle between them is grass, both fading into one dirt as they get small.
    float tkFine = 1.0 - smoothstep( 0.3, 1.2, fPx );
    float rut = exp( - pow( ( tkD - 0.62 ) / 0.22, 2.0 ) ) * tkFine * ( 1.0 - flatK );
    float mid = ( 1.0 - smoothstep( 0.15, 0.5, tkD ) ) * tkFine * ( 1.0 - flatK );
    trackCol = ${v3(srgb(0x6e5438))} * ( 0.82 + 0.3 * dN.g ) * ( 1.0 - 0.3 * rut );
    trackCol = mix( trackCol, grass * 0.9, 0.55 * mid );
  }
}
if ( fieldW > 0.0 ) grass = mix( grass, fieldCol, fieldW );
if ( trackW > 0.0 ) grass = mix( grass, trackCol, trackW );
`;

// The same for the flat paints: laid after the land's grass, before what is laid on that.
export const FIELD_FLAT = /* glsl */`
  fl = mix( fl, fieldFlat, tEdge( fieldW, 0.5 ) );
  fl = mix( fl, trackCol, tEdge( trackW, 0.5 ) );
`;

// The same for the far land in faces: the field's flat colour, as light as the far land's grass it lies among.
export const FIELD_FAR = /* glsl */`
  fGrass = mix( fGrass, fEven( fieldFlat, fLight( fGrass ), 1.0 ), fieldW );
`;

// The ruts at the mouth of a farm track, on the road's verge (the road's verge shader, render/roadmesh.js): the soil carried
// out of the field on tyres, two ruts and a spread. Where no track leaves the road it is nothing.
export const JUNCTION_PARS = /* glsl */`
uniform vec4 uJunction[ ${MAX_TRACKS} ];
uniform float uJunctions;
`;

export const JUNCTION_MAP = /* glsl */`
if ( uJunctions > 0.5 ) {
  float soil = 0.0;
  float rut = 0.0;
  for ( int k = 0; k < ${MAX_TRACKS}; k++ ) {
    if ( float( k ) >= uJunctions ) break;
    vec4 j = uJunction[ k ];
    vec2 d = vVergeXZ - j.xy;
    float along = dot( d, j.zw );
    float side = dot( d, vec2( -j.w, j.z ) );
    float inside = smoothstep( -2.6, -1.0, along ) * ( 1.0 - smoothstep( 0.1, 0.6, along ) );
    float spread = inside * ( 1.0 - smoothstep( 1.5, 2.7, abs( side ) ) );
    soil = max( soil, spread );
    rut = max( rut, spread * ( 1.0 - smoothstep( 0.1, 0.3, abs( abs( side ) - 0.85 ) ) ) );
  }
  diffuseColor.rgb = mix( diffuseColor.rgb, ${v3(srgb(0x5c4630))}, soil * 0.45 + rut * 0.4 );
}
`;
