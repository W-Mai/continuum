import * as THREE from 'three';
import { getBiome } from '../biomes/index.js';

// Every visual parameter is a number that can be lerped. A transition is a blend
// between two of these snapshots, so nothing on screen ever jumps.

const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

export function flatten(biome) {
  return {
    skyTop: biome.sky.top,
    skyHorizon: biome.sky.horizon ?? biome.sky.bottom,
    skyBottom: biome.sky.bottom,
    coastDrop: (biome.water && biome.water.present > 0.5) ? 26 : 0,
    sunColor: biome.sky.sunColor,
    sunSize: biome.sky.sunSize,
    starDensity: biome.sky.starDensity,
    sunX: Math.cos(biome.sky.sunAngle),
    sunZ: Math.sin(biome.sky.sunAngle),
    sunElev: biome.sky.sunElev ?? 0.35,

    fogColor: biome.fog.color,
    fogNear: biome.fog.near,
    fogFar: biome.fog.far,

    hemiSky: biome.lights.hemiSky,
    hemiGround: biome.lights.hemiGround,
    hemiIntensity: biome.lights.hemiIntensity,
    keyColor: biome.lights.keyColor,
    keyIntensity: biome.lights.keyIntensity,
    ambient: biome.lights.ambient,
    ambientIntensity: biome.lights.ambientIntensity,

    roadAsphalt: biome.road.asphalt,
    roadLine: biome.road.line,
    roadShoulder: biome.road.shoulder,
    roadWidth: biome.road.width,

    terrainA: biome.terrain.colorA,
    terrainB: biome.terrain.colorB,
    terrainRock: biome.terrain.rock ?? biome.terrain.colorA,
    terrainAmp: biome.terrain.amp,
    terrainDetail: biome.terrain.detail ?? 6,
    terrainRidged: biome.terrain.ridged ? 1 : 0,

    propScale: biome.props.scale,
    propDensity: biome.props.density,
    propTint: biome.props.tint,
    envIntensity: biome.car.envIntensity,
    saturation: biome.look.saturation,
    vignette: biome.look.vignette,
    waterPresent: biome.water ? biome.water.present : 0,
    waterLevel: biome.water ? biome.water.level : -6,
    waterAmp: biome.water ? biome.water.amp : 1,
    waterShallow: biome.water ? biome.water.shallow : 0x3f8fa8,
    waterDeep: biome.water ? biome.water.deep : 0x123a52,
    skyBottom: biome.sky.bottom,
    haze: biome.car.haze ?? 0.5,
  };
}

// Colours blend in linear space; doing it on 8-bit sRGB values makes midpoints
// of saturated pairs visibly muddy.
const _ca = new THREE.Color();
const _cb = new THREE.Color();
const _out = new THREE.Color();

function lerpHex(a, b, t) {
  _ca.setHex(a).convertSRGBToLinear();
  _cb.setHex(b).convertSRGBToLinear();
  _out.copy(_ca).lerp(_cb, t);
  _out.convertLinearToSRGB();
  return _out.getHex();
}

export function blend(from, to, k) {
  return {
    skyTop: lerpHex(from.skyTop, to.skyTop, k),
    skyHorizon: lerpHex(from.skyHorizon, to.skyHorizon, k),
    skyBottom: lerpHex(from.skyBottom, to.skyBottom, k),
    coastDrop: lerp(from.coastDrop, to.coastDrop, k),
    sunColor: lerpHex(from.sunColor, to.sunColor, k),
    sunSize: lerp(from.sunSize, to.sunSize, k),
    starDensity: lerp(from.starDensity, to.starDensity, k),
    sunX: lerp(from.sunX, to.sunX, k),
    sunZ: lerp(from.sunZ, to.sunZ, k),
    sunElev: lerp(from.sunElev, to.sunElev, k),

    fogColor: lerpHex(from.fogColor, to.fogColor, k),
    fogNear: lerp(from.fogNear, to.fogNear, k),
    fogFar: lerp(from.fogFar, to.fogFar, k),

    hemiSky: lerpHex(from.hemiSky, to.hemiSky, k),
    hemiGround: lerpHex(from.hemiGround, to.hemiGround, k),
    hemiIntensity: lerp(from.hemiIntensity, to.hemiIntensity, k),
    keyColor: lerpHex(from.keyColor, to.keyColor, k),
    keyIntensity: lerp(from.keyIntensity, to.keyIntensity, k),
    ambient: lerpHex(from.ambient, to.ambient, k),
    ambientIntensity: lerp(from.ambientIntensity, to.ambientIntensity, k),

    roadAsphalt: lerpHex(from.roadAsphalt, to.roadAsphalt, k),
    roadLine: lerpHex(from.roadLine, to.roadLine, k),
    roadShoulder: lerpHex(from.roadShoulder, to.roadShoulder, k),
    roadWidth: lerp(from.roadWidth, to.roadWidth, k),

    terrainA: lerpHex(from.terrainA, to.terrainA, k),
    terrainB: lerpHex(from.terrainB, to.terrainB, k),
    terrainRock: lerpHex(from.terrainRock, to.terrainRock, k),
    terrainAmp: lerp(from.terrainAmp, to.terrainAmp, k),
    terrainDetail: lerp(from.terrainDetail, to.terrainDetail, k),
    // Ridged-vs-rolling is discrete. Switching it at the midpoint hides the pop
    // behind the darkest part of the colour blend.
    terrainRidged: k < 0.5 ? from.terrainRidged : to.terrainRidged,

    propScale: lerp(from.propScale, to.propScale, k),
    propDensity: lerp(from.propDensity, to.propDensity, k),
    propTint: lerpHex(from.propTint, to.propTint, k),
    envIntensity: lerp(from.envIntensity, to.envIntensity, k),
    saturation: lerp(from.saturation, to.saturation, k),
    vignette: lerp(from.vignette, to.vignette, k),
    waterPresent: lerp(from.waterPresent, to.waterPresent, k),
    waterLevel: lerp(from.waterLevel, to.waterLevel, k),
    waterAmp: lerp(from.waterAmp, to.waterAmp, k),
    waterShallow: lerpHex(from.waterShallow, to.waterShallow, k),
    waterDeep: lerpHex(from.waterDeep, to.waterDeep, k),
    skyBottom: lerpHex(from.skyBottom, to.skyBottom, k),
    haze: lerp(from.haze, to.haze, k),
  };
}

export class SceneDirector {
  constructor(track, duration = 7) {
    this.track = track;
    this.duration = duration;
    this.fromId = 'alpine';
    this.toId = 'alpine';
    this.from = flatten(getBiome('alpine'));
    this.to = this.from;
    this.current = flatten(getBiome('alpine'));
    this.t = 1;
    this.transitioning = false;
    this.elapsed = 0;
  }

  // Reports the biome that owns most of the screen right now.
  get currentId() {
    return this.t > 0.5 ? this.toId : this.fromId;
  }

  start(targetId) {
    if (this.transitioning && this.toId === targetId) return false;
    this.fromId = this.currentId;
    this.toId = targetId;
    this.from = flatten(getBiome(this.fromId));
    this.to = flatten(getBiome(targetId));
    this.t = 0;
    this.elapsed = 0;
    this.transitioning = true;
    return true;
  }

  update(dt) {
    if (!this.transitioning) return this.current;

    this.elapsed += dt;
    const raw = Math.min(this.elapsed / this.duration, 1);
    this.t = raw;

    // Road curvature morphs on the same clock, so the track's character changes
    // with the sky instead of snapping when the blend ends.
    this.track.setShape(getBiome(this.toId).shape);
    this.current = blend(this.from, this.to, smootherstep(raw));

    if (raw >= 1) {
      this.transitioning = false;
      this.fromId = this.toId;
      this.from = this.to;
    }
    return this.current;
  }
}
