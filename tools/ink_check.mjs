// What the ink style gives its last pass, in node (no browser): which numbers the worlds under the lens
// make of the liquid and the snow, what each tier draws of the water, the clouds and the snow, that no other
// style is handed any of it, and that the code of it is in the program with flat colour only (the others'
// programs are what they were).
//
// Usage: node tools/ink_check.mjs

import { register } from 'node:module';

// style.js imports 'three' by name, which the page's import map resolves; here a hook does.
const vendor = new URL('./vendor/three.module.js', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    if (specifier === 'three') return { url: ${JSON.stringify(vendor)}, shortCircuit: true };
    return next(specifier, context);
  }`)}`);

const { STYLE_PASS, Style, inkWorld, SEA_LEVEL } = await import('../src/render/style.js');
const { WORLDS } = await import('../src/world/worlds.js');

let failed = 0;
const say = (ok, text) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const world = (id) => WORLDS.find((w) => w.id === id);
const u = STYLE_PASS.uniforms;

// --- the code is in the program with flat colour only ------------------------------------------------------

const frag = STYLE_PASS.fragmentShader;
const NAMES = ['inkWaveAt', 'inkWaveCell', 'inkWaveLattice', 'inkMirrorAt', 'inkIsWater', 'inkCloudAt', 'inkSnowAt', 'inkPlane', 'inkRay'];
const UNIFORMS = ['uInkWater', 'uInkSea', 'uInkWave', 'uInkWaveB', 'uInkWaveFar', 'uInkSeaLook', 'uInkMode', 'uInkMirror', 'uInkCloud', 'uInkSnow', 'uInkWind'];
// The text with what is between #ifdef FLAT and its #endif taken out (nesting counted).
function withoutFlat(text) {
  const out = [];
  let depth = 0;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (depth > 0) {
      if (/^#if/.test(t)) depth++;
      else if (/^#endif/.test(t)) depth--;
      continue;
    }
    if (/^#ifdef FLAT\b/.test(t)) {
      depth = 1;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}
const plain = withoutFlat(frag);
for (const name of [...NAMES, ...UNIFORMS]) {
  say(frag.includes(name) && !new RegExp(`\\b${name}\\b`).test(plain), `${name} is in the program with flat colour and not in the plain one`);
}

// --- the worlds under the lens ------------------------------------------------------------------------------------

const st = new Style('ink');
const sea = () => inkWorld.sea.value.toArray();
const snow = () => inkWorld.snow.value.toArray();
for (const id of ['river', 'coast', 'inferno', 'abyss', 'heaven', 'space']) {
  const w = world(id);
  st.setWorld(w, w, 0, 0.5);
  const [level, shown, cloud, lava] = sea();
  say(near(level, SEA_LEVEL) && near(shown, 1), `${id}: the liquid is shown at the sea level (${level}, ${shown})`);
  say(near(cloud, w.liquid && w.liquid.cloud ? 1 : 0) && near(lava, w.liquid && w.liquid.lava ? 1 : 0), `${id}: a sea of cloud ${cloud}, lava ${lava}`);
}
for (const id of ['alpine', 'hills', 'desert', 'city', 'cavern', 'upside']) {
  const w = world(id);
  st.setWorld(w, w, 0, 0.5);
  say(near(sea()[1], 0), `${id}: no liquid is shown`);
}
st.setWorld(world('alpine'), world('alpine'), 0, 0.5);
say(near(snow()[0], world('alpine').params.snowLine) && near(snow()[1], 1), `alpine: snow over ${snow()[0]} m, all of the world has it`);
st.setWorld(world('hills'), world('hills'), 0, 0.5);
say(near(snow()[1], 0), 'hills: no snow');
// Across a border the liquid comes in where the liquid's own shader shows it: a third to two thirds of the blend.
const shownAt = (t) => {
  st.setWorld(world('hills'), world('river'), t, 0.5);
  return sea()[1];
};
say(near(shownAt(0.2), 0) && near(shownAt(0.8), 1) && near(shownAt(0.5), 0.5, 0.02), `across a border the liquid comes in between 0.35 and 0.65 (${[0.2, 0.35, 0.5, 0.65, 0.8].map((t) => shownAt(t).toFixed(2)).join(', ')})`);
let rising = true;
let last = -1;
for (let t = 0; t <= 1; t += 0.05) {
  const v = shownAt(t);
  if (v < last - 1e-9) rising = false;
  last = v;
}
say(rising, 'it comes in steadily, no step');
st.setWorld(world('alpine'), world('hills'), 0.5, 0.5);
say(near(snow()[1], 0.5) && near(snow()[0], world('alpine').params.snowLine), `the snow goes out across a border, half of it at half (${snow()[1]}), the line where it was (${snow()[0]})`);
st.setWorld(world('hills'), world('hills'), 0, 0.37);
say(near(inkWorld.cloud.value, 0.37), 'the cloud of the sky is the look\'s');

// --- the tiers ------------------------------------------------------------------------------------------------------------

st.setWorld(world('river'), world('river'), 0, 0.7);
st.sync();
const at = (tier) => {
  st.tier = tier;
  st.applyPass(u, 577);
  return { mode: u.uInkMode.value.toArray(), cloud: u.uInkCloud.value.x, water: u.uInkWater.value, mirror: u.uInkMirror.value, snow: u.uInkSnow.value.y };
};
const high = at('high');
const mid = at('mid');
const low = at('low');
say(high.mode[0] === 1 && high.mode[1] === 1 && high.mode[2] === 1 && high.cloud > 0, 'high: strokes, the shore in the water, clouds with their shade');
say(mid.mode[0] === 1 && mid.mode[1] === 0 && mid.mode[2] === 0 && mid.cloud > 0, 'mid: strokes, and the clouds in a line only');
say(low.mode[0] === 0 && low.mode[2] === 0 && low.cloud === 0 && low.water === 1, 'low: the water is paper with nothing on it, no clouds');
const withSnow = (tier) => {
  st.setWorld(world('alpine'), world('alpine'), 0, 0.5);
  st.sync();
  st.tier = tier;
  st.applyPass(u, 577);
  return u.uInkSnow.value.y;
};
say(withSnow('low') === 1 && withSnow('mid') === 1 && withSnow('high') === 1, 'the snow is left to the paper at every tier');

// --- the other styles have none of it -------------------------------------------------------------------------------------

for (const id of ['real', 'paint', 'cel', 'print', 'pixel', 'block']) {
  const other = new Style(id);
  other.setWorld(world('river'), world('river'), 0, 0.7);
  other.sync();
  other.applyPass(u, 577);
  say(u.uInkWater.value === 0 && u.uInkCloud.value.x === 0 && u.uInkSnow.value.y === 0 && u.uInkMirror.value === 0 && u.uInk.value === 0, `${id}: no water, clouds, snow or shore of the ink`);
}

console.log(failed ? `\nFAILED: ${failed}` : '\nOK');
process.exit(failed ? 1 : 0);
