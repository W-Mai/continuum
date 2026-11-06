import * as THREE from 'three';
import { GLTFLoader } from '/tools/vendor/GLTFLoader.js';
import { RoomEnvironment } from '/tools/vendor/environments/RoomEnvironment.js';

import { Track } from './core/track.js';
import { Car } from './core/car.js';
import { Autopilot, Driver } from './core/autopilot.js';
import { SceneDirector } from './render/director.js';
import { CarPresentation, ChaseCamera } from './render/presentation.js';
import { createSky, applySky, createTerrain, applyTerrain } from './render/sky.js';
import { RoadMesh, ROAD_TOP } from './render/road.js';
import { baseElevation } from './core/track.js';

function smoothstep01(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Same four octaves of value noise as the terrain vertex shader, evaluated on the
// CPU. Kept in step by hand; any change to one must be made to the other.
// Line-by-line port of the shader's hash2. It has to match exactly, not
// approximately: the terrain shader displaces the ground and these functions place
// props on it, so a mismatch of even a few centimetres shows as floating buildings.
function fract(v) {
  return v - Math.floor(v);
}
function vhash(px, py) {
  // vec3(p.xyx) * 0.1031
  let x = fract(px * 0.1031);
  let y = fract(py * 0.1031);
  let z = fract(px * 0.1031);
  // p3 += dot(p3, p3.yzx + 33.33)
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  x += d; y += d; z += d;
  return fract((x + y) * z);
}
function vnoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = vhash(ix, iy);
  const b = vhash(ix + 1, iy);
  const c = vhash(ix, iy + 1);
  const d = vhash(ix + 1, iy + 1);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}
function readonlyFbm(x, y, oct) {
  let v = 0;
  let amp = 0.5;
  let px = x;
  let py = y;
  for (let i = 0; i < oct; i++) {
    v += amp * vnoise(px, py);
    px *= 2.03;
    py *= 2.03;
    amp *= 0.5;
  }
  return v;
}
function terrainRelief(x, z, amp, detail, ridged) {
  let big = readonlyFbm(x * 0.00055, z * 0.00055, 4);
  if (ridged) {
    big = 1 - Math.abs(big * 2 - 1);
    big = Math.pow(big, 1.6);
  }
  return (big - 0.45) * amp;
}
import { PostChain } from './render/post.js';
import { PropField } from './render/props.js';
import { Traffic } from './render/traffic.js';
import { JunctionField, junctionsIn } from './render/junctions.js';
import { createWater, applyWater } from './render/water.js';
import { Collisions } from './core/collisions.js';
import { SkidMarks, TyreParticles } from './render/effects.js';
import { getBiome, nextBiomeId, BIOME_ORDER } from './biomes/index.js';

const FIXED_DT = 1 / 120;
const MAX_FRAME_DT = 0.1;

export class Game {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: opts.antialias !== false,
      powerPreference: 'high-performance',
      // Headless screenshots read the canvas outside the frame that drew it, so
      // the drawing buffer has to survive until the capture.
      preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, opts.maxPixelRatio || 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // ACES lifts shadows hard, so a 1.3 exposure turned near-black asphalt into
    // mid grey. 0.95 keeps dark surfaces dark while metal still catches light.
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.4, 9000);

    // Post chain owns the final image: bloom for lights, then one shared grade.
    this.post = new PostChain(this.renderer, this.scene, this.camera);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.9;

    this.track = new Track();
    this.car = new Car();
    this.pilot = new Autopilot(this.track);
    this.driver = new Driver(opts.inputTarget || window);
    this.director = new SceneDirector(this.track, opts.transitionDuration || 7);

    this._buildWorld();

    const start = this.track.at(0);
    this.car.reset(start.x, start.z, start.theta);
    this.sCar = 0;

    this.autoMode = opts.auto !== false;
    this.accumulator = 0;
    this.frame = 0;
    this.simTime = 0;
    this.fps = 60;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this.lastTransitionAt = 0;
    this.autoSwitchSeconds = opts.autoSwitchSeconds || 72;

    this.qualityLevel = 2;
    this._slowStreak = 0;
    this._fastStreak = 0;
    this.stats = {
      transitions: 0, biomes: new Set(['alpine']), maxSpeed: 0, frames: 0,
    };

    this._bindKeys();
    this._applyDirector();
  }

  // Height of the land at a world point, for anything that has to stand on it.
  //
  // The terrain shader's relief term is gated on distance from the camera
  // (smoothstep 700 -> 2600 m), so anywhere inside the play area the ground is
  // exactly the shared elevation field minus the same 1.1 m offset the shader
  // applies. Evaluating the loud part of the noise here as well would disagree
  // with the shader, not agree with it.
  // Props must land on the ground the shader actually draws, so this mirrors both
  // the shared elevation field and the coastal fall-off. Sampling only the field
  // left buildings floating over the sea in the coast biome.
  // Mirrors heightAt() in sky.js. Both sides must agree or props stand in the air
  // or sink: the shader displaces by baseElevation plus relief, and this has to do
  // the same arithmetic on the same world inputs.
  terrainHeightAt(x, z) {
    let h = baseElevation(x, z) - 1.2;

    // Same expression the terrain shader evaluates, with no camera-dependent term.
    const b0 = this.director ? this.director.current : null;
    if (b0) {
      h += terrainRelief(x, z, b0.terrainAmp, b0.terrainDetail, b0.terrainRidged) * 0.55;
    }

    // Mirror the shader's corridor sink, or props and the car sit 2.5 m above the
    // ground they are drawn on.
    if (this.car) {
      const d = Math.hypot(x - this.car.x, z - this.car.z);
      const t = Math.min(1, Math.max(0, (d - 7) / 23));
      const mask = 1 - t * t * (3 - 2 * t);
      h -= mask * 2.5;
    }

    const b = this.director ? this.director.current : null;
    if (b && b.coastDrop > 0.5) {
      // The shader measures from the terrain grid's own origin, which tracks the
      // camera. Props are placed before the camera moves this frame, so anchoring
      // on the car keeps the two consistent instead of a frame apart.
      const lateral = Math.hypot(x - this.car.x, z - this.car.z);
      const t = Math.min(1, Math.max(0, (lateral - 150) / 750));
      const sea = t * t * (3 - 2 * t);
      h -= b.coastDrop * sea;
    }
    return h;
  }

  _buildWorld() {
    this.sky = createSky();
    this.scene.add(this.sky);

    this.terrain = createTerrain();
    this.scene.add(this.terrain);

    this.road = new RoadMesh(this.track, this.scene, this.renderer);
    this.props = new PropField(this.scene);
    // Props need the land height, not the road height: they sit far off the
    // carriageway where the two have nothing to do with each other.
    this.props.setGroundSampler((x, z) => this.terrainHeightAt(x, z));
    this.traffic = new Traffic(this.scene, this.track);
    this.collisions = new Collisions(this.car, this.track);
    this.junctions = new JunctionField(this.scene, this.track);
    this.water = createWater();
    this.scene.add(this.water);
    // _applyDirector() already ran before this field existed. Hand the branches
    // the road's own material so they are the same surface, texture included.
    this.junctions.setMaterial(this.road.matRoad, this.road.matLine);

    this.hemi = new THREE.HemisphereLight(0xbcd9ff, 0x5d6552, 1.05);
    this.scene.add(this.hemi);

    this.key = new THREE.DirectionalLight(0xfff0d8, 2.3);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.camera.near = 20;
    this.key.shadow.camera.far = 1600;
    const s = 220;
    this.key.shadow.camera.left = -s;
    this.key.shadow.camera.right = s;
    this.key.shadow.camera.top = s;
    this.key.shadow.camera.bottom = -s;
    this.key.shadow.bias = -0.0008;
    this.key.shadow.normalBias = 0.02;
    this.scene.add(this.key);
    this.scene.add(this.key.target);

    this.rim = new THREE.DirectionalLight(0x9fd0ff, 0.9);
    this.scene.add(this.rim);

    this.scene.fog = new THREE.FogExp2(0xbcd8ec, 0.00028);
    this.scene.background = new THREE.Color(0xbcd8ec);

    this.headlight = new THREE.SpotLight(0xfff2d0, 0, 170, 0.6, 0.55, 1.2);
    this.scene.add(this.headlight);
    this.scene.add(this.headlight.target);

    this.skids = new SkidMarks(this.scene);
    this.dust = new TyreParticles(this.scene);
    this.presentation = new CarPresentation(this.scene);
    this.chase = new ChaseCamera(this.camera);
    this.carLoaded = false;
    this.roadBump = 0;
    this.dustColor = 0xb8b0a0;
    this._slip = 0;
  }

  async loadCar(url = '/out/car.glb') {
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene;
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material && o.material.transparent) {
        o.material.depthWrite = false;
        o.material.side = THREE.DoubleSide;
      }
    });
    // The GLB is authored in millimetres; the rig scales it to metres.
    this.presentation.attach(model, 0.001);
    this.carModel = model;
    this.carLoaded = true;
    this.chase.snapTo(this.car);
    return model;
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP') this.autoMode = !this.autoMode;
      if (e.code === 'KeyC') this.cycleCamera();
      if (e.code === 'KeyN') this.requestBiome(nextBiomeId(this.director.currentId, 1));
      if (e.code === 'KeyB') this.requestBiome(nextBiomeId(this.director.currentId, -1));
      // Digits follow BIOME_ORDER so the keyboard cannot drift from the list.
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit) {
        const id = BIOME_ORDER[Number(digit[1]) - 1];
        if (id) this.requestBiome(id);
      }
    });
  }

  requestBiome(id) {
    if (!id || id === this.director.currentId) return false;
    if (!this.director.start(id)) return false;
    this.stats.transitions++;
    this.stats.biomes.add(id);
    this.lastTransitionAt = this.simTime;
    return true;
  }

  cycleCamera() {
    const name = this.chase.cycle();
    if (this.onCameraChange) this.onCameraChange(name);
    return name;
  }

  junctionsIn(a, b) { return junctionsIn(a, b, this.track); }

  // Put the car back on the centreline, level, and fading: a hard cut reads as a
  // teleport, so the body blinks for a moment while speed ramps back up.
  resetToRoad() {
    const p = this.track.at(this.sCar);
    if (!p) return false;

    this.car.reset(p.x, p.z, p.theta, p.y + ROAD_TOP);
    this.car.rollAngle = 0;
    this.car.rollRate = 0;
    this.car.wrecked = false;
    this.car.wreckTimer = 0;
    this.car.vx = 8;
    this.car.vy = 0;
    this.car.r = 0;
    this.collisions.reset();
    this.traffic.clearNear(this.sCar, 45);

    this.resetting = true;
    this.resetFade = 1;
    this.wrecks = (this.wrecks || 0) + 1;
    return true;
  }

  cycleBiome() {
    return this.requestBiome(nextBiomeId(this.director.currentId, 1));
  }

  _applyDirector() {
    const b = this.director.current;

    // The road mesh and the terrain must use the same relief or one buries the
    // other. Both read this function.
    // Only rebuild when the relief shape actually changed. This method runs every
    // frame, and recomputing 1000 cached samples per frame made the road's height
    // drift continuously, which the car followed as a permanent tremor.
    const sig = b.terrainAmp + ':' + b.terrainDetail + ':' + (b.terrainRidged ? 1 : 0);
    if (this._reliefSig !== sig) {
      this._reliefSig = sig;
      this.track.reliefFn = (wx, wz) => terrainRelief(
        wx, wz, b.terrainAmp, b.terrainDetail, b.terrainRidged,
      ) * 0.55;
      this.track.refreshElevation();
    }

    applySky(this.sky, b);
    // The corridor mask needs to know where the road is. Pass the car's own
    // position: the road runs through the car by definition, so this cannot drift
    // from it the way a camera-anchored measure did.
    applyTerrain(this.terrain, b, this.camera.position, this.car);

    this.hemi.color.setHex(b.hemiSky);
    this.hemi.groundColor.setHex(b.hemiGround);
    this.hemi.intensity = b.hemiIntensity;

    this.key.color.setHex(b.keyColor);
    this.key.intensity = b.keyIntensity;

    this.rim.color.setHex(b.ambient);
    this.rim.intensity = b.ambientIntensity * 2.2;

    this.scene.fog.color.setHex(b.fogColor);
    this.scene.background.setHex(b.fogColor);
    // FogExp2 carries a single density, so the (near, far) pair is mapped onto
    // it. Keeping one fog object means the density itself is what transitions.
    const span = Math.max(1, b.fogFar - b.fogNear);
    this.scene.fog.density = Math.min(0.004, 2.2 / span);
    this.scene.environmentIntensity = b.envIntensity;

    this.post.applyLook(b);
    // Water sits a fixed drop below the road at the car's own station, so it is
    // sea level on a coast and a river bed in a valley without a hard-coded Y.
    const railY = this.track.at(this.sCar);
    const seaY = (railY ? railY.y : 0) - Math.abs(b.waterLevel || 3.2);
    applyWater(this.water, {
      ...b, roadElevAtPlayer: railY ? railY.y : 0,
    }, this.camera.position, this.simTime);
    // Props need the sea level before they are placed this frame, or the ones
    // standing in deep water are already committed.
    this.props.setWaterLevel(b.waterPresent > 0.2 ? seaY : null);
    this.road.setTerrainAmp(b.terrainAmp);
    this.road.setBiome(b.roadAsphalt, b.roadLine, b.roadShoulder, b.roadWidth);
    this.junctions && this.junctions.setMaterial(this.road.matRoad, this.road.matLine);

    const biome = getBiome(this.director.currentId);
    this.props.setKinds(biome.props.kind, b.propTint);
    this.props.setDensity(b.propDensity, b.propScale);

    // Rough surfaces shake the body and camera; smooth ones do not.
    this.roadBump = biome.road.bump ?? 0.5;
    this.dustColor = biome.terrain.colorB;
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    const size = this.renderer.getSize(new THREE.Vector2());
    this.post.setSize(size.x, size.y);
  }

  stepPhysics(dt) {
    this.track.update(this.sCar);

    const near = this.track.nearestS(this.car.x, this.car.z, this.sCar);
    if (near.dist < 40) this.sCar = near.s;

    // Feed the road surface to the vertical solver before the car integrates:
    // groundY is where the tyres sit, groundVy how fast that surface is rising.
    const surf = this.track.at(this.sCar);
    if (surf) {
      const ahead = this.track.at(this.sCar + 4);
      const behind = this.track.at(this.sCar - 4);
      // The wheels sit on the asphalt under the CAR, not under the centreline, and
      // the ramp counts: this is the same expression the road mesh uses.
      this.car.groundY = this.track.roadSurfaceAt(this.sCar, this.car.x, this.car.z)
        + ROAD_TOP;
      this.car.groundVy = ahead && behind
        ? ((ahead.y - behind.y) / 8) * Math.max(0, this.car.vx)
        : 0;
      this.car.pitchSlope = ahead && behind
        ? Math.atan2(ahead.y - behind.y, 8)
        : 0;
    }

    let cmd;
    if (this.autoMode) {
      // Same-direction traffic in the player's lane is what the autopilot has to
      // react to; oncoming cars pass by on the other side.
      const lead = this.traffic.nearestAhead(this.sCar, 1, 70);
      // Passing needs to know when the car we went around is behind us, which is a
      // different query from "nearest ahead".
      const behind = this.traffic.nearestBehind(this.sCar, 1, 24);
      const onc = this.traffic.nearestOncoming(this.sCar, 80);
      cmd = this.pilot.drive(dt, {
        s: this.sCar, x: this.car.x, z: this.car.z,
        yaw: this.car.yaw, speed: this.car.speed,
        leadGap: lead ? lead.distance : null,
        leadSpeed: lead ? lead.car.speed : null,
        leadBehind: !!behind,
        signal: this.junctions.signalAt(this.sCar, this.simTime),
        route: this.junctions.routeAt(this.sCar),
        // Only commit to the oncoming lane when it is clear far enough ahead.
        passClear: this.traffic.oncomingLaneClear(this.sCar, 95),
        oncomingGap: onc ? onc.distance : null,
      });
    } else {
      const d = this.driver.read();
      cmd = { steer: d.steer, throttle: d.throttle, brake: d.brake };
    }

    this.car.step(dt, cmd);

    const hit = this.collisions.update(dt, this.sCar, this.traffic, this.simTime);
    if (hit && hit.kind === 'impact') {
      this.car.applyImpact(hit.speed, hit.oncoming);
      this.shake = Math.max(this.shake || 0, Math.min(1, hit.speed / 26));
    }

    // A flipped car cannot be driven out of it: blink it back onto the road.
    if (this.car.wrecked && this.car.wreckTimer > 1.6 && !this.resetting) {
      this.resetToRoad();
    }

    this.simTime += dt;

    if (this.autoMode && this.simTime - this.lastTransitionAt > this.autoSwitchSeconds) {
      this.cycleBiome();
    }
  }

  update(dt) {
    const clamped = Math.min(dt, MAX_FRAME_DT);
    this.accumulator += clamped;

    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < 12) {
      this.stepPhysics(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps++;
    }

    const b = this.director.update(clamped);
    this._applyDirector();

    this.road.update(this.sCar);
    this.props.update(this.track, this.sCar);
    this.traffic.update(clamped, this.sCar);
    this.junctions.update(this.sCar, this.road.roadWidth * 0.5, 900, this.simTime);

    // Everything that rides the corridor needs the surface height under the car,
    // not a constant: the world is graded now.
    const roadY = this.car.y !== undefined ? this.car.y : ROAD_TOP;

    // Each axle sits on its own patch of road. Taking one height for the whole car
    // and tilting the body about it left the rear wheels 6 cm under the surface on
    // a grade, because 2.7 m of wheelbase is a lot of height difference.
    const axleF = this.track.at(this.sCar + 1.35);
    const axleR = this.track.at(this.sCar - 1.35);
    const hubF = axleF ? axleF.y + ROAD_TOP + 0.34 : roadY + 0.34;
    const hubR = axleR ? axleR.y + ROAD_TOP + 0.34 : roadY + 0.34;

    this.presentation.update(clamped, this.car, {
      bump: this.roadBump, roadY, airborne: this.car.airborne,
      hubF, hubR,
    });

    // Tyre slip drives both the marks and the dust: braking hard, or sliding
    // sideways, is what leaves rubber on the road.
    // Rubber only goes down once the tyre is genuinely past its grip: a hard brake
    // or a real slide. Gentle cornering must not paint the road, which is what
    // happened when lateral g counted at any magnitude.
    const slipAngle = (Math.abs(this.car.slipAngle) - 0.06) * 3.2;
    const braking = ((this.car.brake || 0) - 0.55) * 2.4;
    const lateral = (Math.abs(this.car.lateralG || 0) - 0.72) * 2.6;
    const slip = Math.max(0, Math.min(1, Math.max(slipAngle, braking, lateral)))
      * (this.car.speed > 5 ? 1 : 0);
    this._slip = slip;
    this.skids.update(this.car, slip);
    this.dust.update(clamped, this.car, slip, this.dustColor);

    this.chase.update(clamped, this.car, {
      bump: this.roadBump, roadY, airborne: this.car.airborne,
    });

    this.sky.position.copy(this.camera.position);

    // The world is graded, so every light anchor has to ride the car's height.
    // Pinning them to y=0 dropped the shadow pass and the headlights below the
    // road once the car climbed, which is what made it look like it floated.
    const carY = this.car.y || 0;
    this.key.target.position.set(this.car.x, carY, this.car.z);
    this.key.position.set(
      this.car.x + b.sunX * 260, carY + 380, this.car.z + b.sunZ * 260,
    );

    this.headlight.position.set(this.car.x, carY + 1.0, this.car.z);
    this.headlight.target.position.set(
      this.car.x + Math.cos(this.car.yaw) * 40, carY - 1.2,
      this.car.z + Math.sin(this.car.yaw) * 40,
    );

    // A directional light caches its shadow frustum in light space. Moving the
    // target every frame without refreshing it leaves the map looking at wherever
    // it was first built, so the shadows silently stop following the car.
    this.key.shadow.camera.updateProjectionMatrix();
    // Headlights fade in for the dark biomes rather than switching on.
    const wantLights = b.hemiIntensity < 0.85 ? 2.6 : 0;
    this.headlight.intensity += (wantLights - this.headlight.intensity) * 0.04;

    // Blink out of a reset. The fade drives the body material's opacity so the
    // car visibly re-materialises instead of jumping.
    if (this.resetting) {
      this.resetFade = Math.max(0, this.resetFade - clamped * 1.5);
      const pulse = this.resetFade > 0
        ? 0.35 + 0.65 * Math.abs(Math.sin(this.resetFade * Math.PI * 7))
        : 1;
      this.presentation.setBlink(this.resetFade > 0 ? pulse : null);
      if (this.resetFade <= 0) this.resetting = false;
    }

    this.stats.frames++;
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed, this.car.speed);

    this._fpsAccum += clamped;
    this._fpsFrames++;
    if (this._fpsAccum > 0.5) {
      this.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
      this._adaptQuality();
    }
    this.frame++;
  }

  // Shed detail in small steps when frames get long, and take it back when
  // there is headroom. A wallpaper runs for hours, so this must settle rather
  // than oscillate: each step needs two consecutive readings to act.
  _adaptQuality() {
    if (this.opts.adaptiveQuality === false) return;
    const level = this.qualityLevel;
    if (this.fps < 45 && level > 0) {
      this._slowStreak = (this._slowStreak || 0) + 1;
      this._fastStreak = 0;
      if (this._slowStreak >= 2) {
        this._slowStreak = 0;
        this._setQuality(level - 1);
      }
    } else if (this.fps > 58 && level < 2) {
      this._fastStreak = (this._fastStreak || 0) + 1;
      this._slowStreak = 0;
      if (this._fastStreak >= 4) {
        this._fastStreak = 0;
        this._setQuality(level + 1);
      }
    } else {
      this._slowStreak = 0;
      this._fastStreak = 0;
    }
  }

  _setQuality(level) {
    this.qualityLevel = level;
    const ratios = [1.0, 0.75, 0.55];
    const shadows = [1024, 768, 512];
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, ratios[level]));
    this.post && this.post.setQuality(level);
    this.key.shadow.mapSize.set(shadows[level], shadows[level]);
    if (this.key.shadow.map) {
      this.key.shadow.map.dispose();
      this.key.shadow.map = null;
    }
    this.onResize && this.onResize();
  }

  render(dt = 1 / 60) {
    this.post.render(dt);
  }

  // Everything the headless checks assert on.
  snapshot() {
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    return {
      frame: this.frame,
      simTime: +this.simTime.toFixed(2),
      distance: +this.sCar.toFixed(1),
      speedKmh: +this.car.speedKmh.toFixed(1),
      biome: this.director.currentId,
      toBiome: this.director.toId,
      transitioning: this.director.transitioning,
      blend: +this.director.t.toFixed(3),
      autoMode: this.autoMode,
      fps: +this.fps.toFixed(1),
      liveRoadChunks: this.road.liveChunks(),
      props: this.props.activeCount,
      trackSamples: this.track.samples.size,
      rebases: this.track.rebases,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      skyTop: hex(this.director.current.skyTop),
      fog: hex(this.director.current.fogColor),
      carLoaded: this.carLoaded,
      slip: +(this._slip || 0).toFixed(3),
      skidSegments: this.skids ? this.skids.live : 0,
      transitions: this.stats.transitions,
    };
  }
}
