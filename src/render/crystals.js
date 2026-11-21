// A crystal in the painted style: three flat colours made from the colour it is
// (the vertex colour and the instance's), as they come out on the screen, and
// nothing of the light the physical model would lay on it.
//
//  - the bright one, where the face of the crystal is lit by the sun's side;
//  - the dark one, where it is not: the same hue, a deep blue-violet;
//  - the core, a pale tint of the hue, on the faces that look straight at the
//    lens.
//
// The haze still lies over it as over anything that is drawn. The painted style
// is the only one that has this in its program (the crystals of the other
// styles are lit and glow as they were).

// The colour of the crystals that grow as trees (render/forest.js builds them
// of it, and of a deeper one at the foot); the glow the pools of light on the
// floor take is taken from it.
export const TREE_CYAN = 0x58d6e0;

export const CRYSTAL = {
  bright: 0.80,                // the bright colour's value
  fullness: 1.15,              // and how full its colour is
  dark: [0.30, 0.34, 0.60],    // the dark one, over the square of the hue
  floor: [0.02, 0.03, 0.08],   // and never darker than this
  core: { value: 0.92, white: 0.55, at: [0.80, 0.84] },
  litAt: 0.02,                 // how wide the edge between the bright and the dark is, in the cosine of the sun's angle
};

const glsl3 = (a) => `vec3(${a.map((x) => x.toFixed(3)).join(', ')})`;

// The fragment code, to be put after the program's colour is worked out
// (opaque_fragment). `normal` is the face's, in view space, and uSunDirV the
// sun's direction there (render/style.js).
export const CRYSTAL_PAINTED = `
{
  vec3 cb = max( vColor.rgb, vec3( 0.0 ) );
  vec3 hue = cb / max( max( cb.r, cb.g ), max( cb.b, 1e-3 ) );
  vec3 bright = mix( vec3( dot( hue, vec3( 0.3333 ) ) ), hue, ${CRYSTAL.fullness.toFixed(2)} ) * ${CRYSTAL.bright.toFixed(2)};
  vec3 dark = hue * hue * ${glsl3(CRYSTAL.dark)} + ${glsl3(CRYSTAL.floor)};
  vec3 core = mix( hue, vec3( 1.0 ), ${CRYSTAL.core.white.toFixed(2)} ) * ${CRYSTAL.core.value.toFixed(2)};
  float lit = smoothstep( -${CRYSTAL.litAt.toFixed(2)}, ${CRYSTAL.litAt.toFixed(2)}, dot( normal, uSunDirV ) );
  float face = smoothstep( ${CRYSTAL.core.at[0].toFixed(2)}, ${CRYSTAL.core.at[1].toFixed(2)}, dot( normal, normalize( vViewPosition ) ) );
  gl_FragColor.rgb = mix( mix( dark, bright, lit ), core, face ) * uPaintInv;
}`;
