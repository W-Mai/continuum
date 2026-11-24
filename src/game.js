// Game: assembles the world and runs the loop.
//
// The world is generated in this order, and nothing downstream ever disagrees
// with anything upstream: the land (a pure function of position), the road
// surveyed across it, the land re-shaped by the road (cuts, fills, bridges,
// tunnels), then the meshes baked from those. Physics, autopilot, traffic and
// camera read the same road and the same ground the meshes were built from.

import * as THREE from 'three';
import { GLTFLoader } from '../tools/vendor/GLTFLoader.js';
import { toCreasedNormals } from '../tools/utils/BufferGeometryUtils.js';

import { makeWorldLand, WORLDS, WORLD_INDEX, SkyChoice, SKIES, SKY_INDEX } from './world/worlds.js';
import { Road, HALF_PAVED, HALF_FLAT, TUNNEL, STEP } from './world/road.js';
import { Corridor, TUNNEL_H, REACH } from './world/corridor.js';
import { turnWorlds, turnNext, turnTo, turnLoop } from './world/turn.js';
import { Car } from './core/car.js';
import { Autopilot, Driver } from './core/autopilot.js';
import { Haptics } from './core/haptics.js';
import { Collisions } from './core/collisions.js';
import { CarPresentation, ChaseCamera, bendAhead } from './render/presentation.js';
import { CarLook } from './render/carlook.js';
import { Director } from './render/director.js';
import { Atmosphere, ALPINE_LOOK, atmo, withAtmosphere, withSunMask, withSkyScale, sunMask, boreSky, carSky, compileAhead, compileObjects } from './render/atmosphere.js';
import { bindWorlds, syncWorlds, worldLook, mixLooks, setWorldOrigin } from './render/worldlook.js';
import { WeatherRing } from './render/weather.js';
import { Water } from './render/water.js';
import { City } from './render/city.js';
import { CityLife } from './render/citylife.js';
import { CityRail } from './world/cityrail.js';
import { Ceiling } from './render/ceiling.js';
import { Cavern } from './render/cavern.js';
import { Heaven } from './render/heaven.js';
import { CavernPlan } from './world/cavernplan.js';
import { Valley } from './render/valley.js';
import { ValleyPlan } from './world/valleyplan.js';
import { Desert } from './render/desert.js';
import { DesertPlan } from './world/desertplan.js';
import { Coast } from './render/coast.js';
import { CoastPlan } from './world/coastplan.js';
import { Alpine } from './render/alpine.js';
import { AlpinePlan } from './world/alpineplan.js';
import { Inferno } from './render/inferno.js';
import { InfernoPlan } from './world/infernoplan.js';
import { sunVisibility } from './world/sunlight.js';
import { TerrainField } from './render/terrain.js';
import { Forest } from './render/forest.js';
import { Foliage } from './render/foliage.js';
import { Horizon, viewSpan } from './render/horizon.js';
import { makeBakers } from './render/bakers.js';
import { makeVegetation } from './world/vegetation.js';
import { RoadRenderer } from './render/roadmesh.js';
import { PostChain } from './render/post.js';
import { BLUR } from './render/lens.js';
import { Quality, TIERS, shadowSize } from './render/quality.js';
import { Traffic, makeTrafficMaterial } from './render/traffic.js';
import { NightLight, nightU } from './render/nightlight.js';
import { setBeam, viewBeam } from './render/headbeam.js';
import { SkidMarks, TyreParticles, KICK } from './render/effects.js';
import { Motes } from './render/motes.js';
import { Fish } from './render/fish.js';
import { Critters } from './render/critters.js';
import { Drift } from './render/drift.js';
import { Upside } from './render/upside.js';
import { Props } from './render/props.js';
import { Clutter } from './render/clutter.js';
import { Grass } from './render/grass.js';
import { Style, styleU, WIND } from './render/style.js';
import { Photo } from './render/photo.js';
import { mark, progress, sleep, Later } from './boot.js';

// How long the first frame waits for its land and trees, and for its programs (ms).
const FIRST = { tiles: 12000, programs: 6000, sky: 2000 };

const FIXED_DT = 1 / 120;
// What a frame gives to laying the road past what the car needs now, in
// milliseconds: a round of road costs a few, and now and then twenty, so it is
// laid in pieces of this much (Road.update). A frame longer than a sixtieth of
// a second gives ROAD_SHARE of its length instead, so that a page that is
// slow lays the road as fast in time as a quick one.
const ROAD_MS = 2;
const ROAD_SHARE = 0.12;
// How far ahead of the camera, along the way the worlds run, the light and
// the sky overhead are read (_updateLook).
const LOOK_LEAD = 450;
const MAX_FRAME_DT = 0.1;
// A pass: another car that goes by with less than PASS_GAP m between the two
// bodies while the two close on each other at PASS_SPEED m/s or more. The lens
// turns toward it (ChaseCamera.brush), at most once in PASS_EVERY s; the
// player's half width is the one the collisions use (core/collisions.js).
const PASS_GAP = 2.2;
const PASS_SPEED = 15;
const PASS_EVERY = 1.5;
const HALF_WIDTH = 0.92;
const CROWN = 0.045;
const TUNNEL_LAMP = new THREE.Color(0xffcf9a);
const TUNNEL_FLOOR = new THREE.Color(0x3a3128);
// The photo mode (render/photo.js): the road is kept built from this much
// further behind the car than driving needs, for a lens that has gone back
// along it; the road is looked for under the lens this far either way of the
// car along the way; and half the width of a bore, across, in which the
// road is the floor and the vault the roof.
const PHOTO_BEHIND = 100;
const PHOTO_SPAN = 800;
const BORE = 5.5;

export class Game {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;

    // The canvas has the screen's own pixels (a ratio of up to 2), and the
    // scene is drawn at a fraction of them (setRenderScale): the 1.5 it was
    // drawn at before the canvas had more than that, when the screen has it,
    // fewer as the machine asks (render/quality.js). The last pass brings the
    // one up to the other (render/present.js).
    const dpr = devicePixelRatio || 1;
    const canvasRatio = Math.min(dpr, opts.maxPixelRatio || 2);
    this.baseScale = Math.min(1, Math.min(dpr, opts.maxPixelRatio || 1.5) / canvasRatio);
    this.renderScale = this.baseScale;
    // How much there is to draw (high, mid, low; render/quality.js), set
    // before anything that draws is made, so that it can read it as it is.
    // opts.tier pins it; headless runs draw high.
    this._tier = TIERS.includes(opts.tier) ? opts.tier : 'high';
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // Nothing is drawn into the canvas but one picture, so there are no
      // edges for its own multisampling to find, only a buffer several times
      // the size to keep and resolve every frame: the last pass cleans the edges.
      antialias: false,
      // The browser's own choice of GPU: on a laptop with two, the one that
      // is not burning the battery (?gpu=high asks for the other).
      powerPreference: opts.power || 'default',
      preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
    });
    this.renderer.setPixelRatio(canvasRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Count every pass of a frame (shadow map, scene, bloom, grade), not only
    // the last full-screen quad.
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.3, 14000);
    this.post = new PostChain(this.renderer, this.scene, this.camera);
    this.post.scale = this.renderScale;
    // ao=0 in the address draws the real style without its ambient occlusion.
    this.post.ao.off = !!opts.noAo;
    // night=0 in the address draws the real style's night as it was without the dipped beam, the rooms in the
    // windows and the lights of the night (render/nightlight.js).
    this.nightOff = !!opts.noNight;
    this._shadowStep = 0;
    this.post.setContact(this._tier === 'high');
    // A page leaves the second frame's work to a queue run after its first
    // frame (settle); headless runs do it in the second, as they always did.
    const sync = !!opts.syncWorld;
    this.later = new Later(4);
    this.post.deferWarm = !sync;
    // How the world is drawn (render/style.js): as it is, unless asked.
    this.style = new Style(opts.style);
    this.style.tier = this._tier;
    this.style.applyScene();
    this._styleBake = 0;

    this.seed = opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 1e6);
    this.land = makeWorldLand(this.seed, { start: opts.world, len: opts.worldLen, loop: opts.loop });
    this.land.debug = !!opts.terrainDebug;
    this.worlds = this.land.worlds;
    this.road = new Road(this.land, this.seed);
    mark('new.road');
    bindWorlds(this.worlds);
    syncWorlds(this.worlds, this.road.origin.x, this.road.origin.z);
    // Start further down the road (showcase captures): survey up to there first,
    // so everything below is built around the right place.
    this.sCar = opts.start > 160 ? opts.start : 160;
    if (this.sCar > 160) this.road.update(this.sCar, Infinity);
    this.corridor = new Corridor(this.road, this.land);
    this.vegetation = makeVegetation(this.land, this.seed);
    // Where the cavern's puddles, skylights and mine track are (world/cavernplan.js).
    this.plan = new CavernPlan({ land: this.land, road: this.road, corridor: this.corridor, worlds: this.worlds, seed: this.seed });
    // And the valley's: its piers and the gravel bars of its river (world/valleyplan.js).
    this.valleyPlan = new ValleyPlan({ land: this.land, road: this.road, corridor: this.corridor, worlds: this.worlds, seed: this.seed });
    // Where the desert's billboards, poles, dust devils and tumbleweeds are (world/desertplan.js).
    this.desertPlan = new DesertPlan({ land: this.land, road: this.road, corridor: this.corridor, worlds: this.worlds, seed: this.seed });
    // Where the coast's boats, reefs and sea wall are (world/coastplan.js).
    this.coastPlan = new CoastPlan({ land: this.land, road: this.road, corridor: this.corridor, worlds: this.worlds, seed: this.seed });
    // And the alpine's snow poles, waterfalls and plumes of snow (world/alpineplan.js).
    this.alpinePlan = new AlpinePlan({
      land: this.land, road: this.road, corridor: this.corridor, worlds: this.worlds, seed: this.seed, wind: { x: WIND[0], z: WIND[1] },
    });
    // Where the inferno's splashes and vents of fire are (world/infernoplan.js).
    this.infernoPlan = new InfernoPlan({ land: this.land, road: this.road, corridor: this.corridor, worlds: this.worlds, seed: this.seed });

    // The sky and light of the world the camera is in, mixed across borders.
    this._look = mixLooks({}, worldLook(0), worldLook(0), 0);
    this._lookAt = { a: -1, b: -1, t: -1, ba: -1, bb: -1, bt: 0, pair: '', clock: 0, sa: 0, sb: 0 };
    // Which of its skies each day world has: the one the address holds them all
    // to (opts.sky), the one a world is held to (opts.skyPins), else by the lap.
    this.skies = new SkyChoice(SKY_INDEX[opts.sky] !== undefined ? SKY_INDEX[opts.sky] : -1, opts.skyPins);
    // And the weather in each direction round it, a few kilometres off: the
    // sky low down and the haze far off read it (render/weather.js).
    this.weather = new WeatherRing(this.worlds, this.skies);
    this.atmosphere = new Atmosphere(this.renderer, this.scene, ALPINE_LOOK, {
      seed: this.seed, axis: Math.atan2(this.worlds.dz, this.worlds.dx), sync: !!opts.syncWorld, tier: this._tier, farAlt: opts.farShadow === 'alt',
    });
    this.atmosphere.deferWarm = !sync;
    this.atmosphere.holdClouds = !sync;
    const s0 = this.road.at(this.sCar);
    if (s0) this._updateLook(s0.x, s0.z, 0, true);
    if (opts.noShadow) {
      this.renderer.shadowMap.enabled = false;
      this.atmosphere.sun.castShadow = false;
    }
    this.terrain = new TerrainField(this.scene, this.land, this.corridor,
      ALPINE_LOOK, { vegetation: this.vegetation, tier: this._tier });
    this.terrain.setSun(this.atmosphere.sunDir);
    mark('new.terrain');
    this.forest = new Forest(this.scene, this.land, this.corridor, this.vegetation, this.seed);
    this.forest.setSun(this.atmosphere.sunDir);
    this.forest.setCascades(this.atmosphere.cascades);
    this.forest.setTier(this._tier);
    // Land and trees are baked in workers once they are up (render/bakers.js);
    // headless runs bake every tile on the page, in the frame that needs it.
    this.bakers = opts.syncWorld || opts.bakers === false ? null
      : makeBakers(this.land, this.seed, { start: opts.world, len: opts.worldLen, loop: opts.loop });
    this.terrain.bakers = this.bakers;
    this.forest.bakers = this.bakers;
    this.atmosphere.bakers = this.bakers;
    // The real style's trees: the pictures of their leaves and bark, and what they are drawn with (render/foliage.js).
    this.foliage = new Foliage(this.renderer, { tier: this._tier, bakers: this.bakers });
    // What the near land hides from the lens is not drawn (render/horizon.js).
    this.horizon = new Horizon();
    this._span = [0, 0];
    this._culled = { rev: -1, x: 0, z: 0, n: 0 };    // what the land's culling was last made for, and how many times it was made
    this.cullOn = true;         // off: everything update() chose is drawn (to put frames side by side)
    this.water = new Water(this.scene, 0, this.worlds, { post: this.post, renderer: this.renderer, terrain: this.terrain, land: this.land, tier: this._tier });
    mark('new.water');
    // The city's elevated railway beside the road (world/cityrail.js): the towers keep off it.
    this.cityRail = new CityRail(this.road, this.land, this.seed);
    this.city = new City(this.scene, this.land, this.corridor, this.seed, { rail: this.cityRail });
    // What the city has beside its towers: the roofs' things, the viaduct and its trains, steam, the parks' lamps.
    this.cityLife = new CityLife(this.scene, { city: this.city, rail: this.cityRail, road: this.road }, this._tier);
    this.ceiling = new Ceiling(this.scene, this.worlds);
    this.roadMesh = new RoadRenderer(this.scene, this.road, this.corridor, this.renderer, { tier: this._tier, bakers: this.bakers });
    this.roadMesh.setSun(this.atmosphere.sunDir);
    mark('new.roadmesh');
    if (opts.detail) this.setDetail(opts.detail);
    this._applyOrigin();

    this.car = new Car();
    // The car meets the ground as a car does (core/car.js): it follows it
    // while the ground can hold it, and leaves it over a crest or off a lip.
    this.car.groundFn = (x, z) => this._groundFor(x, z);
    this._landFx = 0;       // the hardest touchdown since the last frame, m/s
    this.lands = 0;         // touchdowns so far, for the sound
    this.bumps = 0;         // things run into so far, for the sound
    this._lastBump = null;  // the last: { kind, speed (m/s), ox, oz (where, from the car) }
    this.passes = 0;        // cars gone by close so far
    this._lastPass = null;  // the last: { side (1 right, -1 left), gap (m), closing (m/s) }
    this._nudged = -Infinity;   // when the lens was last turned to one, s of the game's time
    const start = this.road.at(this.sCar);
    this.car.reset(start.x, start.z, start.theta, this.road.surfaceAt(this.sCar, 1.9) + CROWN);
    this.car.x += -Math.sin(start.theta) * 1.9;
    this.car.z += Math.cos(start.theta) * 1.9;

    this.pilot = new Autopilot(this.road);
    this.driver = new Driver(opts.inputTarget || window);
    // What the hands feel of the drive: a gamepad's rumble, a phone's buzz (core/haptics.js).
    this.haptics = new Haptics({ actuator: () => this.driver.actuator, device: () => this.driver.device });
    this._knocked = 0;      // animals struck, as the critters have counted them
    this.traffic = new Traffic(this.scene, this.road, this.seed,
      withSunMask(withAtmosphere(makeTrafficMaterial()), false), this.land.worlds);
    this.collisions = new Collisions(this.car, this.road);
    // The lights of a night in the real style: the haze under the road's lamps and the red lights on the towers
    // (render/nightlight.js; the cars' own are the traffic's).
    this.night = new NightLight(this.scene, { road: this.roadMesh, city: this.city, tier: this._tier });
    this.traffic.setTier(this._tier);

    this.presentation = new CarPresentation(this.scene);
    // The car is always in the near shadow map, and is left out of the far one.
    this.atmosphere.nearOnly.push(this.presentation.root);
    this.chase = new ChaseCamera(this.camera, { seed: this.seed });
    // The right button dragged on the canvas looks round the car (render/presentation.js).
    this.chase.listen(canvas);
    this.director = new Director(this.camera, {
      road: this.road,
      seed: this.seed,
      post: this.post,
      sunDir: this.atmosphere.sunDir,
      groundAt: (x, z) => this.groundAt(x, z),
      terrainAt: (x, z) => this.corridor.heightAt(x + this.road.origin.x, z + this.road.origin.z),
      ceilingAt: (x, z, s) => this.ceilingAt(x, z, s),
      treesAt: (x, z, near) => this.treesAt(x, z, near),
      solidAt: (x, y, z) => this.solidAt(x, y, z),
      surfaceAt: (x, z) => this.land.waterLevel(x + this.road.origin.x, z + this.road.origin.z),
    });
    this.skids = new SkidMarks(this.scene);
    this.dust = new TyreParticles(this.scene);
    this.motes = new Motes(this.scene, this._tier);
    this.fish = new Fish(this.scene);
    // Small animals, in the styles that have them (render/critters.js).
    this.critters = new Critters(this.scene, {
      road: this.road,
      seed: this.seed,
      groundAt: (x, z) => this.groundAt(x, z),
      waterAt: (x, z) => this.land.waterLevel(x + this.road.origin.x, z + this.road.origin.z),
      treesAt: (x, z, near) => this.treesAt(x, z, near),
      // Trunks round a point, in local coordinates: [x, z, radius, ...].
      trunks: (x, z, range, out) => {
        const o = this.road.origin;
        this.forest.trunksNear(x + o.x, z + o.z, range, out);
        this.props.near(x + o.x, z + o.z, range, out);
        this.cavern.near(x + o.x, z + o.z, range, out);
        this.valley.near(x + o.x, z + o.z, range, out);
        if (this.desert) this.desert.near(x + o.x, z + o.z, range, out);
        this.coast.near(x + o.x, z + o.z, range, out);
        for (let k = 0; k < out.length; k += 3) {
          out[k] -= o.x;
          out[k + 1] -= o.z;
        }
        return out;
      },
    });
    mark('new.critters');
    // Wind and petals in the painted style (render/drift.js).
    this.drift = new Drift(this.scene);
    // What the Upside Down has in it, and the turning over of the view on the
    // way in (render/upside.js).
    // Each world's own buildings by the road (render/props.js).
    this.props = new Props(this.scene, {
      road: this.road,
      seed: this.seed,
      worlds: this.land.worlds,
      groundAt: (x, z) => this.groundAt(x, z),
      waterAt: (x, z) => this.land.waterLevel(x + this.road.origin.x, z + this.road.origin.z),
    });
    // What lies about the ground: tufts, flowers, reeds, shells, bones,
    // crystals, coral... a world's own (render/clutter.js).
    this.clutter = new Clutter(this.scene, {
      road: this.road,
      seed: this.seed,
      worlds: this.land.worlds,
      sCar: () => this.sCar,
      heightAt: (ax, az) => this.corridor.heightAt(ax, az),
      // The land as it was before the road, to find the faces rubble lies under.
      naturalAt: (ax, az) => this.land.heightAt(ax, az),
      waterAt: (ax, az) => this.land.waterLevel(ax, az),
      solidAt: (ax, y, az) => this.city.solidAt(ax, y, az) || this.props.solidAt(ax, y, az),
      // Where a skylight's light falls on the floor the grass grows.
      litAt: (ax, az) => this.plan.litAt(ax, az),
      tier: this._tier,
    });
    // What the cavern has of its own: pools of light under the crystals, puddles, skylights,
    // threads of glow-worm light and a mine's track (render/cavern.js).
    this.cavern = new Cavern(this.scene, {
      plan: this.plan,
      road: this.road,
      worlds: this.land.worlds,
      ceiling: this.ceiling,
      clutter: this.clutter,
      forest: this.forest,
      sky: this.atmosphere.uniforms,
      groundAt: (x, z) => this.groundAt(x, z),
      seed: this.seed,
    }, this._tier);
    // What the valley has of its own: the mist on its water, gravel bars in its river, a pier and its boat
    // (render/valley.js).
    this.valley = new Valley(this.scene, {
      plan: this.valleyPlan,
      road: this.road,
      worlds: this.land.worlds,
      land: this.land,
      water: this.water,
      seed: this.seed,
    }, this._tier);
    // What the desert has of its own: old billboards, telegraph poles and their wires, dust
    // devils and tumbleweeds (render/desert.js); its heat haze is a pass of the frame's.
    this.desert = new Desert(this.scene, {
      plan: this.desertPlan,
      road: this.road,
      worlds: this.land.worlds,
      dust: this.dust,
      sun: this.atmosphere.sun,
      hemi: this.atmosphere.hemi,
    }, this._tier);
    // What the coast has of its own: the boats out at sea, the rocks in the shallows and the wall by the road, beside
    // the waves that come up the beach (render/coast.js).
    this.coast = new Coast(this.scene, {
      plan: this.coastPlan,
      road: this.road,
      worlds: this.land.worlds,
      land: this.land,
      seed: this.seed,
    }, this._tier);
    // What the heaven has of its own: skeins of cranes, its piers going into the cloud white, the bell of its
    // temples (render/heaven.js).
    this.heaven = new Heaven(this.scene, { props: this.props, worlds: this.land.worlds, road: this.road, seed: this.seed }, this._tier);
    // What the alpine has of its own: snow poles, waterfalls, plumes of snow, the bells (render/alpine.js).
    this.alpine = new Alpine(this.scene, {
      plan: this.alpinePlan,
      road: this.road,
      worlds: this.land.worlds,
      seed: this.seed,
      solidAt: (ax, y, az) => this.props.solidAt(ax, y, az),
      compile: (meshes) => compileObjects(this.renderer, this.scene, this.camera, meshes),
    }, this._tier);
    // What the inferno has of its own: splashes of lava, vents of fire and the light off the lava
    // (render/inferno.js); its heat haze is the desert's pass, the drift of its crust the lava's.
    this.inferno = new Inferno(this.scene, {
      plan: this.infernoPlan,
      road: this.road,
      worlds: this.land.worlds,
      groundAt: (x, z) => this.corridor.heightAt(x + this.road.origin.x, z + this.road.origin.z),
    }, this._tier);
    this._lavaGround = new THREE.Color();
    this.upside = new Upside(this.scene, {
      road: this.road,
      seed: this.seed,
      worlds: this.land.worlds,
      groundAt: (x, z) => this.groundAt(x, z),
      terrainAt: (x, z) => this.corridor.heightAt(x + this.road.origin.x, z + this.road.origin.z),
      tier: this._tier,
    });

    // Headlights, and the low beam pool they throw: only seen in tunnels and
    // in deep shade.
    this.headlight = new THREE.SpotLight(0xfff1d8, 0, 140, 0.55, 0.5, 1.4);
    this.scene.add(this.headlight);
    this.scene.add(this.headlight.target);
    // Blades of grass and their flowers in the painted style (render/grass.js).
    this.grass = new Grass(this.scene, {
      terrain: this.terrain,
      road: this.road,
      worlds: this.land.worlds,
      seed: this.seed,
      lights: [this.atmosphere.sun, this.atmosphere.hemi, this.headlight, this.headlight.target],
      tier: () => this._tier,
    });

    this.autoMode = opts.auto !== false;
    // Headless runs step a fixed 1/60 s, so there is nothing to adapt to.
    this.quality = opts.syncWorld || opts.adaptive === false
      ? null : new Quality(this, this.baseScale, opts.targetFps, TIERS.includes(opts.tier) ? opts.tier : null);
    this.accumulator = 0;
    this.frame = 0;
    this.simTime = 0;
    this.fps = 60;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this.inTunnel = 0;      // the car: its own sun and headlights
    this.camInTunnel = 0;   // the lens: the light of the whole frame
    this.eye = 0;           // how far the eye has opened up for the dark
    this.carLoaded = false;
    this.wrecks = 0;
    this.stats = { maxSpeed: 0, frames: 0 };
    // The photo mode: the world stands still, the lens is let go of and a
    // picture is taken of the frame (render/photo.js, photoUpdate below).
    this.photo = new Photo(this);
    // The motion blur at speed (render/lens.js): the visitor's setting (ui/settings.js, blur).
    this.blurOn = true;

    this._bindKeys();
    mark('new');
  }

  _applyOrigin() {
    const o = this.road.origin;
    this.terrain.setOrigin(o.x, o.z);
    this.forest.setOrigin(o.x, o.z);
    this.roadMesh.setOrigin(o.x, o.z);
    this.water.setOrigin(o.x, o.z);
    this.city.setOrigin(o.x, o.z);
    this.cityLife.shift();
    this.style.setOrigin(o.x, o.z);
    setWorldOrigin(o.x, o.z);
  }

  // The world the camera is in: mix the two looks across a border and hand
  // them to the atmosphere. Each is the look of its world under the sky its lap
  // has (or the one it is held to), so a sky changes where a world does, as a
  // front comes in. The sky's environment map is drawn again when the light
  // has changed by a few percent since it was last drawn, at most four times a
  // second, and once more when it settles. Crossing from one pair of worlds to
  // the next (the end of a border is the start of the next world) changes
  // nothing, so it draws nothing.
  _updateLook(x, z, dt, force = false) {
    const ax = x + this.road.origin.x;
    const az = z + this.road.origin.z;
    const w = this.worlds.at(ax, az);
    const L = this._lookAt;
    L.clock += dt;
    // The light, and the look of the sky overhead, come a little ahead of the
    // camera, as weather does: the land ahead is already drawn in the next
    // world's colours, and it should not stand in the last one's sun. The
    // small things in the air and the sound read the same lead (this._wl);
    // the interface goes by where the camera is (L.a/b/t).
    const lead = this._wl || (this._wl = { a: 0, b: 0, t: 0, u: 0, la: 0, lb: 0 });
    this.worlds.at(ax + this.worlds.dx * LOOK_LEAD, az + this.worlds.dz * LOOK_LEAD, lead);
    const sa = this.skies.of(lead.a, lead.la);
    const sb = this.skies.of(lead.b, lead.lb);
    const pair = lead.a + ':' + lead.b + ':' + sa + sb;
    const moved = force || pair !== L.lpair || Math.abs(lead.t - L.lt) >= 1e-3;
    if (moved) mixLooks(this._look, worldLook(lead.a, sa), worldLook(lead.b, sb), lead.t);
    this.style.setWorld(WORLDS[lead.a], WORLDS[lead.b], lead.t, this._look.clouds);
    // The weather in each direction out there, read from where the camera is.
    this.weather.update(ax, az);
    // How much of the light now is not the light the map was drawn in: each
    // world's share (of the world under its sky) then against its share now, and
    // the horizon all round against the one it was drawn under.
    const share = (i, a, b, t) => (i === a ? 1 - t : 0) + (i === b ? t : 0);
    const ia = lead.a * SKIES.length + sa;
    const ib = lead.b * SKIES.length + sb;
    let drift = 0;
    for (const i of [ia, ib, L.ba, L.bb]) {
      if (i < 0) continue;
      drift = Math.max(drift, Math.abs(share(i, ia, ib, lead.t) - share(i, L.ba, L.bb, L.bt)));
    }
    const ringDrift = this.weather.drift();
    const rebake = force || ((drift > 0.02 || ringDrift > 0.03) && L.clock > 0.25) || ((drift > 1e-3 || ringDrift > 2e-3) && L.clock > 1);
    if (moved || rebake) this.atmosphere.apply(this._look, rebake);
    if (rebake) {
      L.ba = ia;
      L.bb = ib;
      L.bt = lead.t;
      L.clock = 0;
      this.weather.bake();
    }
    L.lpair = pair;
    L.lt = lead.t;
    L.pair = w.a + ':' + w.b;
    L.a = w.a;
    L.b = w.b;
    L.t = w.t;
    L.sa = this.skies.of(w.a, w.la);
    L.sb = this.skies.of(w.b, w.lb);
  }

  // The skies the worlds are held to, { world id: sky id } (a world that is not
  // in it goes by its lap again). The look is mixed afresh in the next frame.
  // Returns whether anything changed.
  setSkyPins(pins) {
    if (!this.skies.setPins(pins)) return false;
    this._lookAt.lpair = '';
    return true;
  }

  // How much geometry to draw, 1 at full quality (render/quality.js lowers
  // it on a slow GPU): the land's fine tiles, the full trees, the skyline.
  setDetail(f) {
    this.detail = f;
    this.terrain.setDetail(f);
    this.forest.setDetail(f);
    this.city.setDetail(f);
  }

  // How much there is to draw: 'high', 'mid' or 'low' (render/quality.js),
  // apart from the size the scene is drawn at. What draws more or less by it
  // reads it here when it is made.
  get tier() {
    return this._tier;
  }

  // The tier changes (render/quality.js steps it with the level, unless the
  // address pinned it). Nothing is rebuilt and the canvas is kept: what draws
  // by the tier changes its own numbers here, in place, from the next frame
  // on (how dense the grass, how many samples a stroke takes, ...). The brush
  // strokes do: 25 taps, 13, and none.
  setTier(t) {
    if (!TIERS.includes(t) || t === this._tier) return;
    this._tier = t;
    this.style.tier = t;
    this.atmosphere.clouds.tier = t;
    this.atmosphere.setTier(t);
    this.water.setTier(t);
    this.terrain.setTier(t);
    this.clutter.setTier(t);
    this.forest.setTier(t);
    this.post.setContact(t === 'high');
    // (A page that began in a lower tier builds the contact shadow's program when it comes to the high one, not at the first frame it is drawn in.)
    if (t === 'high' && !this.opts.syncWorld) this.later.add('contact', () => this.post.contact.warm(this.renderer));
    this.roadMesh.setTier(t);
    this.night.setTier(t);
    this.cityLife.setTier(t);
    this.traffic.setTier(t);
    if (this.cavern) this.cavern.setTier(t);
    if (this.valley) this.valley.setTier(t);
    this.forest.setTier(t);
    if (this.desert) this.desert.setTier(t);
    if (this.coast) this.coast.setTier(t);
    if (this.heaven) this.heaven.setTier(t);
    if (this.alpine) this.alpine.setTier(t);
    if (this.inferno) this.inferno.setTier(t);
    this.upside.setTier(t);
    this.motes.setTier(t);
    if (this.carLook) this.carLook.setTier(t);
  }

  // Pin the tier to 'high', 'mid' or 'low' from outside (the settings panel),
  // or with null let it go by the frame rate again (render/quality.js). A
  // headless run has no ladder to go back to, so only a pin does anything.
  pinTier(t) {
    if (this.quality) this.quality.pin(t);
    else this.setTier(t);
  }

  // Where the camera is among the worlds, for the interface.
  worldHere() {
    const L = this._lookAt;
    const main = L.t < 0.5 ? L.a : L.b;
    return {
      id: WORLDS[main].id, name: WORLDS[main].name, sky: SKIES[L.t < 0.5 ? L.sa : L.sb],
      from: WORLDS[L.a].name, to: WORLDS[L.b].name,
      fromId: WORLDS[L.a].id, toId: WORLDS[L.b].id,
      t: L.t,
    };
  }

  // --- turning toward another world ------------------------------------------

  // The next world in the loop, a world by id, or a new loop of worlds by id
  // (WorldMap.next, ask, setLoop). Each starts about a kilometre ahead and
  // comes in as any border does. Returns whether anything changed.
  nextWorld() {
    return this._turn(turnNext(this.worlds));
  }

  goToWorld(id) {
    const w = WORLD_INDEX[id];
    return w !== undefined && this._turn(turnTo(this.worlds, w));
  }

  setLoop(ids) {
    return this._turn(turnLoop(this.worlds, ids));
  }

  // The worlds in the loop, by id, and the world the road turns into next
  // with how far ahead that border is along the road (null past the road
  // laid so far).
  worldPlan() {
    const map = this.worlds;
    const road = this.road;
    const at = map.at(this.car.x + road.origin.x, this.car.z + road.origin.z, this._planAt || (this._planAt = { a: 0, b: 0, t: 0, u: 0, la: 0, lb: 0 }));
    const here = at.t < 0.5 ? at.a : at.b;
    const sky = SKIES[this.skies.of(here, at.t < 0.5 ? at.la : at.lb)];
    let next = null;
    for (let i = Math.ceil(this.sCar / STEP); i <= road.classified; i += 10) {
      const p = road.samples.get(i);
      if (!p) continue;
      const w = map.main(p.ax, p.az);
      if (w !== here) {
        next = { id: WORLDS[w].id, name: WORLDS[w].name, ahead: i * STEP - this.sCar };
        break;
      }
    }
    return { loop: map.loop.map((w) => WORLDS[w].id), here: WORLDS[here].id, sky, next };
  }

  _turn(change) {
    const r = turnWorlds(this.road, this.worlds, this.sCar, change);
    if (!r) return false;
    if (r.cut >= 0) {
      this.roadMesh.cutFrom(r.cut);
      // (What the cavern has laid by the road that is gone goes with it.)
      this.plan.forget(r.cut);
      this.valleyPlan.forget(r.cut);
      this.desertPlan.forget(r.cut);
      this.coast.forget(r.cut);
      this.alpinePlan.forget(r.cut);
      this.infernoPlan.forget(r.cut);
    }
    // Rebuild what stood on the old road or on the old land: tiles a dropped
    // stretch of road ran through, and tiles reaching into progress whose
    // land has changed. They go on being drawn until the new ones are ready,
    // which waits until the road is laid again, to be carved by it.
    const pts = r.dropped;
    const map = this.worlds;
    const test = (pad) => (x0, z0, size) => {
      for (let k = 0; k < pts.length; k += 20) {
        const x = pts[k];
        const z = pts[k + 1];
        if (x > x0 - pad && x < x0 + size + pad && z > z0 - pad && z < z0 + size + pad) return true;
      }
      let hi = -Infinity;
      for (const [fx, fz] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) hi = Math.max(hi, map.u(x0 + fx * size, z0 + fz * size));
      // The warp bends progress across a tile: a margin for what the corners miss.
      return hi + 0.15 * size + 100 >= r.from;
    };
    this.terrain.markStale(test(REACH + 30));
    this.forest.markStale(test(60));
    // (The railway runs up to 120 m off the road: the towers by the stretch of it that is gone are built again.)
    this.city.markStale(test(140));
    this.turns = (this.turns || 0) + 1;
    return true;
  }

  // The real style's trees are in hand once their pictures are made: asked for (the workers draw the leaves) while the style
  // is the real one, and the forest draws them from the moment they are there. Returns how many pieces are still to come.
  _realTrees() {
    const want = this.style.cur.real > 0.5;
    const left = want ? this.foliage.grain() : 0;
    this.forest.setReal(want && this.foliage.ready ? this.foliage : null);
    return left;
  }

  // Build everything the first frame needs, synchronously.
  warmUp() {
    const cam = this.camera.position;
    this._realTrees();
    this.roadMesh.update(this.sCar, -1);
    this.terrain.update(cam.x + this.road.origin.x, cam.z + this.road.origin.z, true);
    this.forest.update(cam.x + this.road.origin.x, cam.z + this.road.origin.z, true);
    this.post.present.warm(this.renderer);
  }

  // What the first frame needs, got ready while the page goes on (warmUp is
  // the headless runs': all of it at once): the road; the land and the trees,
  // which the workers bake (the page, a slice at a time, where there are none);
  // and the programs of all that, started in the compiler's threads as soon as
  // there is something to build them for.
  async warmFirst() {
    const { bakers, terrain, forest, renderer, scene, camera } = this;
    const x = camera.position.x + this.road.origin.x;
    const z = camera.position.z + this.road.origin.z;
    const programs = [];
    // (The style's numbers as this world has them, before anything below reads them: the first frame is
    // what applies them otherwise.)
    this.style.sync();
    const compile = () => programs.push(compileAhead(renderer, scene, camera));
    compile();
    const sky = this.atmosphere.warmFirst(camera);
    if (sky) programs.push(sky);
    if (this.post.ao.wants(this.style.cur.real, this._tier)) programs.push(this.post.ao.warm());
    if (this.post.shafts.wants(this.style.now.shafts, this._tier)) programs.push(this.post.shafts.warm());
    this.roadMesh.update(this.sCar, -1);
    this.post.present.warm(renderer);
    mark('first.road');
    progress(0.55);
    // The workers come up while the road is built; they are given all the
    // land and trees there are to be had at once.
    let depth = 0;
    if (bakers) {
      for (const t0 = performance.now(); !bakers.ready && !bakers.failed && performance.now() - t0 < 4000;) await sleep(20);
      depth = bakers.depth;
      bakers.depth = 1000;
    }
    const budgets = [terrain.budgetMs, forest.budgetMs];
    terrain.budgetMs = 12;
    forest.budgetMs = 8;
    let total = 0;
    let left = 0;
    let started = false;
    for (const t0 = performance.now(); ;) {
      // (The road's grain is asked for first: a worker is given it before the tiles it will be busy with.)
      left = this.roadMesh.grain() + this._realTrees() + terrain.update(x, z, false, true) + forest.update(x, z, false, true);
      // (The real style's sky of the first frame is made as the land is: a strip of its clouds a turn.)
      this.atmosphere.bakeFirst();
      this.atmosphere.cirrusFirst();
      total = total || left;
      progress(0.55 + 0.35 * (total ? 1 - left / total : 1));
      if (!left || performance.now() - t0 > FIRST.tiles) break;
      if (!started && terrain.tiles.size && forest.tiles.size) {
        started = true;
        this._cull();
        compile();
      }
      await sleep(bakers && bakers.ready ? 30 : 0);
    }
    terrain.budgetMs = budgets[0];
    forest.budgetMs = budgets[1];
    if (bakers) bakers.depth = depth;
    if (left) terrain.update(x, z);
    mark('first.tiles');
    // The sky of the first frame is whole: the rest of the clouds' strips, and the cirrus' tile (a worker
    // draws it, or the page does), so that nothing comes into the sky a moment after the page shows it.
    for (let i = 0; i < 200 && !this.atmosphere.bakeFirst(); i++);
    for (const t0 = performance.now(); !this.atmosphere.cirrusFirst() && performance.now() - t0 < FIRST.sky;) await sleep(10);
    mark('first.sky');
    this._cull();
    compile();
    // The programs of the real style's trees (the lists and the impostors) are built ahead too.
    if (this.foliage.ready) programs.push(this.foliage.warm(scene, camera));
    await Promise.race([Promise.all(programs), sleep(FIRST.programs)]);
    progress(0.97);
  }

  // The first frame is up: the clouds are baked from now, and the second
  // frame's work is queued, a few milliseconds of it a frame.
  settle() {
    this.atmosphere.holdClouds = false;
    if (this.opts.syncWorld) return;
    for (const [name, task] of this.atmosphere.warmTasks(this.camera)) this.later.add(name, task);
    this.later.add('style', () => this.post.stylePass.warm(this.renderer));
    if (this.carLook) this.later.add('car', () => this.carLook.warm(this.renderer));
    this.later.add('pixel', () => this.post.pixelPass.warm(this.renderer));
    if (this._tier === 'high') this.later.add('contact', () => this.post.contact.warm(this.renderer));
    for (const [name, task] of this.cavern.warmTasks(this.renderer, this.scene, this.camera)) this.later.add(name, task);
    for (const [name, task] of this.valley.warmTasks(this.renderer, this.scene, this.camera)) this.later.add(name, task);
    for (const [name, task] of this.coast.warmTasks(this.renderer, this.scene, this.camera)) this.later.add(name, task);
  }

  // src: the model's address, or its bytes, or a promise of them (the page
  // asks for them while the world is built).
  async loadCar(src = './out/car.glb') {
    const loader = new GLTFLoader();
    const gltf = typeof src === 'string' ? await loader.loadAsync(src) : await loader.parseAsync(await src, '');
    mark('car.loaded');
    const model = gltf.scene;
    // GLTFLoader hands every mesh that uses a material the same object. The
    // shader hooks below chain onto a material, so a shared one must be hooked
    // once: hooked once per wheel, the wheel materials declared their uniforms
    // four times, failed to compile, and the wheels never drew at all.
    const hooked = new Set();
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      // The exporter writes one normal per face, which bands curved paint into
      // stripes. Smooth across gentle angles, keep real creases sharp.
      o.geometry = toCreasedNormals(o.geometry, THREE.MathUtils.degToRad(34));
      const m = o.material;
      if (!m || hooked.has(m)) return;
      if (m.name === 'paint') {
        o.material = new THREE.MeshPhysicalMaterial({
          color: m.color, metalness: 0.2, roughness: 0.38,
          clearcoat: 1.0, clearcoatRoughness: 0.06, envMapIntensity: 0.85,
        });
      } else if (m.name === 'glass') {
        o.material = new THREE.MeshPhysicalMaterial({
          color: 0x0b0e12, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.72,
          envMapIntensity: 1.6, depthWrite: false,
        });
      } else if (m.name === 'head_light') {
        m.emissive = new THREE.Color(0xfff3e0);
        m.emissiveIntensity = 1.5;
      } else if (m.name === 'tail_light') {
        m.emissive = new THREE.Color(0xff1a10);
        m.emissiveIntensity = 2.0;
        this.tailLight = m;
      } else if (m.name === 'emitter' || m.name === 'thruster') {
        // The hover rings: dim on the road, lit when the car is afloat.
        m.emissive = new THREE.Color(0xff6a3d);
        m.emissiveIntensity = 0.15;
        if (m.name === 'emitter') this.emitterMat = m;
        else this.thrusterMat = m;
      }
      // Keeps its name: the car is marked part by part by it, for a style
      // that draws it apart (render/presentation.js's attach).
      o.material.name = m.name;
      withSunMask(withAtmosphere(o.material), false);
      withSkyScale(o.material, carSky);
      hooked.add(o.material);
    });
    this.presentation.attach(model, 0.001);
    // What the real style adds to the car's materials (render/carlook.js).
    this.carLook = new CarLook({ renderer: this.renderer, chain: this.post, scene: this.scene, presentation: this.presentation, tier: this._tier });
    this.carLook.dress(model);
    this.carModel = model;
    this.carLoaded = true;
    this.chase.snapTo(this.car, this.car.y);
    return model;
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      // The world stands still in the photo mode: none of these is to move it.
      if (this.photo.active) return;
      if (e.code === 'KeyP') this.setAuto(!this.autoMode);
      if (e.code === 'KeyC') this.cycleCamera();
      if (e.code === 'KeyR' && !this.autoMode) this.resetToRoad(true);
    });
  }

  // The autopilot on or off. It keeps to the road, so a car taken off it is
  // put back first.
  setAuto(on) {
    if (on && this.offRoad) this.resetToRoad(true);
    this.autoMode = on;
    // Hands off whichever way: nothing held, nothing rumbling.
    this.driver.reset();
    if (on) this.haptics.stop();
  }

  cycleCamera() {
    const name = this.chase.cycle();
    if (this.onCameraChange) this.onCameraChange(name);
    return name;
  }

  setCamera(name) {
    this.chase.setFraming(name);
    if (this.onCameraChange) this.onCameraChange(this.chase.framing);
    return this.chase.framing;
  }

  // Draw the world in another style (render/style.js), turning into it over
  // a second and a half. Returns whether anything changed.
  setStyle(id) {
    // What is left of the second frame's work is done before the change.
    if (this.later.pending) this.later.flush();
    const changed = this.style.set(id);
    if (changed && this.onStyleChange) this.onStyleChange(id);
    return changed;
  }

  nextStyle() {
    return this.setStyle(this.style.next());
  }

  // Ground under a local point: the road surface on the road's platform (and
  // always inside a tunnel or on a bridge), the shaped land everywhere else.
  groundAt(x, z) {
    const near = this.road.nearestS(x, z, this.sCar, 80);
    const p = this.road.at(near.s);
    if (p && near.dist < HALF_FLAT + 1.5) {
      const lat = this.road.lateralOf(near.s, x, z);
      const r = this.road.surfaceAt(near.s, lat);
      if (p.kind !== 0) return r;
      return Math.max(r, this.corridor.heightAt(x + this.road.origin.x, z + this.road.origin.z));
    }
    return this.corridor.heightAt(x + this.road.origin.x, z + this.road.origin.z);
  }

  // What the ground under the car gives up as it drives (render/effects.js,
  // KICK), the two worlds of a border blended.
  _kickSurface() {
    const L = this._lookAt;
    const a = KICK[WORLDS[L.a < 0 ? 0 : L.a].id] || KICK.hills;
    const b = KICK[WORLDS[L.b < 0 ? 0 : L.b].id] || a;
    const t = L.a === L.b ? 0 : L.t;
    const s = this._kickS || (this._kickS = { color: 0, amount: 0, road: 0, glow: 0 });
    s.color = (t < 0.5 ? a : b)[0];
    s.road = a[1] + (b[1] - a[1]) * t;
    const land = a[2] + (b[2] - a[2]) * t;
    s.amount = this.offRoad ? land : s.road;
    s.glow = a[3] + (b[3] - a[3]) * t;
    return s;
  }

  // The ground a car meets at a local point: the road's own numbers on the
  // road's platform (and all the while the autopilot drives, which keeps to
  // it), the land's everywhere else.
  _groundFor(x, z) {
    const near = this.road.nearestS(x, z, this.sCar, 30);
    const p = this.road.at(near.s);
    if (p && (this.autoMode || near.dist < HALF_FLAT + 1.5)) {
      const lat = this.road.lateralOf(near.s, x, z);
      const crown = Math.abs(lat) < HALF_PAVED ? CROWN * (1 - (lat / HALF_PAVED) ** 2) : 0;
      return this.road.surfaceAt(near.s, lat) + crown;
    }
    return this.groundAt(x, z);
  }

  // The vault above a local point, if it is inside a tunnel. sHint is a road
  // position near the point, for points far from the car.
  ceilingAt(x, z, sHint = this.sCar) {
    const near = this.road.nearestS(x, z, sHint, 60);
    const p = this.road.at(near.s);
    if (!p || p.kind !== TUNNEL || near.dist > 5.5) return null;
    return this.road.surfaceAt(near.s, this.road.lateralOf(near.s, x, z)) + TUNNEL_H;
  }

  // Forest cover at a local point that stands `near` metres from the road, for a
  // camera deciding where it can stand without a tree in front of the lens.
  treesAt(x, z, near) {
    const ax = x + this.road.origin.x;
    const az = z + this.road.origin.z;
    const h = this.corridor.heightAt(ax, az);
    const dx = this.corridor.heightAt(ax + 3, az) - h;
    const dz = this.corridor.heightAt(ax, az + 3) - h;
    const slope = 1 - 3 / Math.hypot(dx, 3, dz);
    return this.vegetation.density(ax, az, h, slope, near, 0, 0);
  }

  // Whether a local point is inside something a camera cannot see through
  // that the land's height does not know about: a building, a structure by
  // the road, the rock over the cavern's roof, or a liquid away from the deep
  // sea.
  solidAt(x, y, z) {
    const ax = x + this.road.origin.x;
    const az = z + this.road.origin.z;
    return y > this.ceiling.roofAt(ax, az) || this.city.solidAt(ax, y, az) || this.props.solidAt(ax, y, az) || this.land.submerged(ax, y, az);
  }

  resetToRoad(quiet = false) {
    const p = this.road.at(this.sCar);
    if (!p) return;
    const lat = this.pilot.lane;
    this.car.reset(p.x - Math.sin(p.theta) * lat, p.z + Math.cos(p.theta) * lat, p.theta,
      this.road.surfaceAt(this.sCar, lat) + CROWN);
    this.car.vx = 8;
    this.collisions.reset();
    this.traffic.clearNear(this.sCar, 60);
    this.resetting = true;
    this.resetFade = 1;
    if (!quiet) this.wrecks++;
  }

  stepPhysics(dt) {
    const shift = this.road.update(this.sCar);
    if (shift) this._shiftWorld(shift);

    this.sCar = this.road.nearestS(this.car.x, this.car.z, this.sCar).s;
    const p = this.road.at(this.sCar);
    this.offRoad = false;
    if (p) {
      const lat = this.road.lateralOf(this.sCar, this.car.x, this.car.z);
      if (this.autoMode || Math.abs(lat) < HALF_FLAT + 1.5) {
        const crown = Math.abs(lat) < HALF_PAVED ? CROWN * (1 - (lat / HALF_PAVED) ** 2) : 0;
        this.car.groundY = this.road.surfaceAt(this.sCar, lat) + crown;
        this.car.groundVy = p.grade * Math.max(0, this.car.vx);
        this.car.pitchSlope = Math.atan(p.grade);
        this.bank = p.bank;
        this.car.surfaceGrip = 1;
        this.car.rollMul = 1;
      } else {
        this._landUnder(this.car);
      }
    }

    let cmd;
    if (this.autoMode) {
      const lead = this.traffic.nearestAhead(this.sCar, 1, 140);
      cmd = this.pilot.drive(dt, {
        s: this.sCar, x: this.car.x, z: this.car.z, yaw: this.car.yaw, speed: this.car.speed,
        leadGap: lead ? lead.distance : null, leadSpeed: lead ? lead.car.speed : null,
      });
    } else {
      const d = this.driver.read(dt);
      // With the world turned over, left and right have changed places on the
      // screen: the wheel is turned the other way.
      cmd = { steer: d.steer * (Math.cos(this.upside.roll) < 0 ? -1 : 1), throttle: d.throttle, brake: d.brake };
    }
    const prev = this._prev || (this._prev = { x: 0, z: 0, yaw: 0 });
    prev.x = this.car.x;
    prev.z = this.car.z;
    prev.yaw = this.car.yaw;
    this.car.step(dt, cmd);
    // A dust devil the car has driven into pushes it sideways.
    const push = this.desert.pushStep(dt);
    if (push) this.car.vy += push;
    if (this.car.landed > 0) {
      this._landFx = Math.max(this._landFx, this.car.landed);
      this._lastLand = this.car.landed;
      this.lands++;
      this.car.landed = 0;
    }
    if (this.offRoad) {
      // Up a slope the car slows, down it speeds up; the ground, not the
      // road's own numbers, is what it rides.
      if (!this.car.airborne) this.car.vx -= 9.81 * Math.sin(Math.atan(this._slope || 0)) * dt * 0.85;
      this._obstacles(this.car, prev);
    }

    const hit = this.collisions.update(dt, this.sCar, this.traffic, this.simTime);
    if (hit && hit.kind === 'impact') {
      this.car.applyImpact(hit.speed, hit.oncoming);
      this.hits = (this.hits || 0) + 1;
      this.haptics.hit(hit.speed);
      const there = this.road.at(hit.s);
      if (there) this._bump('car', hit.speed, there.x - Math.sin(there.theta) * hit.lat, there.z + Math.cos(there.theta) * hit.lat);
      else this._bump('car', hit.speed, this.car.x, this.car.z);
    }
    if (this.car.wrecked && this.car.wreckTimer > 1.6 && !this.resetting) this.resetToRoad();
    this.simTime += dt;
  }

  // Under a car that has left the road's platform: the land (the road's own
  // numbers hold on the platform and all the while the autopilot drives, which
  // keeps to it). The car rides the ground, up its hills and down its
  // ditches, tilting to it; it grips less on grass and sand, and rolls harder.
  _landUnder(car) {
    this.offRoad = true;
    const fx = Math.cos(car.yaw);
    const fz = Math.sin(car.yaw);
    const L = 1.4;
    const W = 0.9;
    const gF = this.groundAt(car.x + fx * L, car.z + fz * L);
    const gB = this.groundAt(car.x - fx * L, car.z - fz * L);
    const gLeft = this.groundAt(car.x - fz * W, car.z + fx * W);
    const gRight = this.groundAt(car.x + fz * W, car.z - fx * W);
    const slope = Math.max(-1.2, Math.min(1.2, (gF - gB) / (2 * L)));
    this._slope = slope;
    car.groundY = this.groundAt(car.x, car.z);
    car.groundVy = slope * car.vx;
    car.pitchSlope = Math.atan(slope);
    this.bank = (gRight - gLeft) / (2 * W);
    const sand = WORLDS[this._lookAt.t < 0.5 ? this._lookAt.a : this._lookAt.b].id === 'desert';
    car.surfaceGrip = sand ? 0.55 : 0.7;
    car.rollMul = sand ? 6 : 4;
  }

  // What a car off the road runs into: a trunk (it stops against it, and the
  // harder it was going the harder it is hurt), a building, deep water, or a
  // slope too steep to climb (the car is put back where it was and bounces
  // off).
  _obstacles(car, prev) {
    const o = this.road.origin;
    const fx = Math.cos(car.yaw);
    const fz = Math.sin(car.yaw);
    const buf = this._trunkBuf || (this._trunkBuf = []);
    let severity = 0;
    let side = 1;
    // What was struck, for the sound: a trunk, or (the props') a wall; and where.
    let kind = 'tree';
    let hitX = car.x;
    let hitZ = car.z;
    for (const off of [-1.4, 0, 1.4]) {
      const cx = car.x + fx * off;
      const cz = car.z + fz * off;
      this.forest.trunksNear(cx + o.x, cz + o.z, 1.3, buf);
      const trunks = buf.length;
      this.props.near(cx + o.x, cz + o.z, 1.3, buf);
      this.cavern.near(cx + o.x, cz + o.z, 1.3, buf);
      this.valley.near(cx + o.x, cz + o.z, 1.3, buf);
      this.desert.near(cx + o.x, cz + o.z, 1.3, buf);
      this.coast.near(cx + o.x, cz + o.z, 1.3, buf);
      for (let k = 0; k < buf.length; k += 3) {
        const dx = cx - (buf[k] - o.x);
        const dz = cz - (buf[k + 1] - o.z);
        const d = Math.hypot(dx, dz) || 1e-3;
        const pen = 0.95 + buf[k + 2] - d;
        if (pen <= 0) continue;
        const nx = dx / d;
        const nz = dz / d;
        car.x += nx * pen;
        car.z += nz * pen;
        let wx = car.vx * fx - car.vy * fz;
        let wz = car.vx * fz + car.vy * fx;
        const vn = wx * nx + wz * nz;
        if (vn >= 0) continue;
        wx -= vn * nx;
        wz -= vn * nz;
        car.vx = wx * fx + wz * fz;
        car.vy = -wx * fz + wz * fx;
        const nl = -nx * fz + nz * fx;
        car.r += off * nl * -vn * 0.06;
        if (-vn > severity) {
          severity = -vn;
          side = nl > 0 ? 1 : -1;
          kind = k < trunks ? 'tree' : 'wall';
          hitX = buf[k] - o.x;
          hitZ = buf[k + 1] - o.z;
        }
      }
    }
    // A building, deep water, a wall of a slope: back to where it was.
    let blocked = false;
    let built = false;
    const y = car.y + 1;
    for (const [a, b] of [[2.2, 0], [-2.2, 0], [0, 0.9], [0, -0.9], [1.6, 0.8], [1.6, -0.8]]) {
      const px = car.x + fx * a - fz * b;
      const pz = car.z + fz * a + fx * b;
      if (this.city.solidAt(px + o.x, y, pz + o.z)) blocked = built = true;
    }
    const lvl = this.land.waterLevel(car.x + o.x, car.z + o.z);
    const wet = lvl - car.groundY > 0.55;
    if (wet || Math.abs(this._slope || 0) > 1.0) blocked = true;
    if (blocked) {
      // (A building or a slope is a wall; water gives, and is soft.)
      if (Math.abs(car.vx) > severity) {
        kind = built || !wet ? 'wall' : 'soft';
        hitX = car.x + fx * 2.2;
        hitZ = car.z + fz * 2.2;
      }
      severity = Math.max(severity, Math.abs(car.vx));
      car.x = prev.x;
      car.z = prev.z;
      car.yaw = prev.yaw;
      car.vx *= -0.25;
      car.vy *= 0.3;
    }
    if (severity > 2.5 && (this._hitCool || 0) <= 0) {
      this._hitCool = 0.5;
      car.applyImpact(severity * 0.9, side > 0);
      this.haptics.hit(severity);
      this._bump(kind, severity, hitX, hitZ);
    }
    this._hitCool = (this._hitCool || 0) - FIXED_DT;
  }

  // The car has run into something (a tree, a wall, another car, or something
  // soft: an animal, deep water) at speed m/s, at a local point; the sound
  // reads the count and the last of them.
  _bump(kind, speed, x, z) {
    this.bumps++;
    this._lastBump = { kind, speed, ox: x - this.car.x, oz: z - this.car.z };
  }

  _shiftWorld(d) {
    this.car.x -= d.dx;
    this.car.z -= d.dz;
    this.chase.posX.value -= d.dx;
    this.chase.posZ.value -= d.dz;
    this.chase.lookX.value -= d.dx;
    this.chase.lookZ.value -= d.dz;
    if (this.chase._dronePos) {
      this.chase._dronePos.x -= d.dx;
      this.chase._dronePos.z -= d.dz;
    }
    this.director.shift(d.dx, d.dz);
    this.critters.shift(d.dx, d.dz);
    this.upside.shift(d.dx, d.dz);
    this.props.shift();
    this.clutter.shift();
    this.cavern.shift();
    this.valley.shift();
    this.desert.shift();
    this.coast.shift();
    this.alpine.shift();
    this.inferno.shift();
    this._applyOrigin();
  }

  // The other cars that cross the player's place along the road this frame, and
  // how close they come: each that goes by with less than PASS_GAP between the
  // sides of the two bodies (and has not touched) while the two close on each
  // other at PASS_SPEED or more is a pass, counted once as it crosses. The lens
  // turns toward it, but not to two within PASS_EVERY s. A car has crossed when
  // its place along the road, from the player's, has changed sign since the
  // last frame.
  _passing(lat) {
    const seen = this._passed || (this._passed = new WeakMap());
    const here = this.road.at(this.sCar);
    const way = here && Math.cos(this.car.yaw - here.theta) < 0 ? -1 : 1;
    for (const c of this.traffic.cars) {
      const ahead = c.s - this.sCar;
      const was = seen.get(c);
      seen.set(c, ahead);
      if (was === undefined || (was > 0) === (ahead > 0) || Math.abs(was - ahead) > 20) continue;
      const gap = Math.abs(c.lane - lat) - (HALF_WIDTH + c.wid / 2);
      const closing = Math.abs(way * this.car.vx - c.dir * c.speed);
      if (gap <= 0 || gap >= PASS_GAP || closing < PASS_SPEED) continue;
      const side = (c.lane - lat) * way < 0 ? -1 : 1;
      this.passes++;
      this._lastPass = { side, gap, closing };
      if (this.simTime - this._nudged >= PASS_EVERY) {
        this._nudged = this.simTime;
        this.chase.brush(side);
      }
    }
  }

  update(dt) {
    // The road past what the car needs now is laid a little a frame (Road.update):
    // ROAD_MS milliseconds of it in a page (more in a slow frame), one round in a
    // headless run, so that a road cut to be surveyed again comes back without a
    // stall.
    const clamped = Math.min(dt, MAX_FRAME_DT);
    // The lens as this step finds it: the motion blur's way is from here (render/lens.js).
    this.post.blur.remember(this.camera);
    this._blurDt = clamped;
    const sync = !!this.opts.syncWorld;
    this.road.budget = sync ? 1 : Infinity;
    this.road.budgetMs = sync ? Infinity : Math.max(ROAD_MS, clamped * 1000 * ROAD_SHARE);
    if (this.quality) this.quality.update(dt);
    this.accumulator += clamped;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < 12) {
      this.stepPhysics(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps++;
    }

    this.roadMesh.update(this.sCar, this.opts.syncWorld ? -1 : 3);
    this.traffic.update(clamped, this.sCar, this.car.speed);

    const car = this.car;
    const fx = Math.cos(car.yaw);
    const fz = Math.sin(car.yaw);
    const lat = this.road.lateralOf(this.sCar, car.x, car.z);
    this._passing(lat);
    // The wheels' hubs: on the road its surface at each axle, off it the land's.
    const hubF = this.offRoad ? this.groundAt(car.x + fx * 1.35, car.z + fz * 1.35) + 0.34
      : this.road.surfaceAt(this.sCar + 1.35, lat) + CROWN + 0.34;
    const hubR = this.offRoad ? this.groundAt(car.x - fx * 1.35, car.z - fz * 1.35) + 0.34
      : this.road.surfaceAt(this.sCar - 1.35, lat) + CROWN + 0.34;
    const air = Math.max(0, car.y - (car.groundY || 0));
    // The rumble is for a car in someone's hands: not the autopilot's.
    this.haptics.driving = !this.autoMode;
    if (this._landFx > 0) {
      this.presentation.land(this._landFx);
      this.chase.kick(this._landFx * 0.012);
      this.chase.land(this._landFx);
      this.haptics.land(this._landFx);
    }
    this.presentation.update(clamped, car, {
      bump: 0.25, roadY: car.y, airborne: car.airborne, hubF, hubR, bank: this.bank || 0, air,
    });

    const slip = Math.max(0, Math.min(1, Math.max(
      (Math.abs(car.slipAngle) - 0.07) * 3.2, ((car.brake || 0) - 0.6) * 2.4,
    ))) * (car.speed > 5 ? 1 : 0);
    // Afloat, there is no tyre on the road to mark it or throw dust.
    const onRoad = 1 - this.presentation.liftAmount;
    this.skids.update(car, slip * (onRoad > 0.5 ? 1 : 0));
    this.haptics.update(clamped, { off: this.offRoad, air: car.airborne, speed: car.speed, slip: slip * onRoad });
    // What the ground gives up under it: dust, sand, snow, ash; sparks where
    // it is hot; a ring of it thrown when it comes down.
    const surf = this._kickSurface();
    this.dust.update(clamped, car, slip * onRoad, surf, this.presentation.liftAmount);
    if (this._landFx > 2.2) this.dust.burst(car, this._landFx, { ...surf, amount: Math.max(surf.amount, 0.35) });
    this._landFx = 0;

    // What the lens feels of the drive: the game's clock, what the road does
    // 0.9 s on (none where the car has left it), and where the hood is.
    this._bend = this.offRoad ? 0 : bendAhead(this.road, this.sCar, car);
    this.chase.update(clamped, car, {
      bump: 0.25, roadY: car.y, airborne: car.airborne, air,
      time: this.simTime, curvature: this._bend, offRoad: this.offRoad,
      hood: (out, axis) => this.presentation.hood(out, axis),
      groundAt: (gx, gz) => this.groundAt(gx, gz),
      ceilingAt: (gx, gz) => this.ceilingAt(gx, gz),
      solidAt: (gx, gy, gz) => this.solidAt(gx, gy, gz),
      terrainAt: (gx, gz) => this.corridor.heightAt(gx + this.road.origin.x, gz + this.road.origin.z),
      sees: (a, b) => this.director.sees(a, b),
      post: this.post,
    });
    this.director.update(clamped, car, this.sCar, this.chase);
    // The way into the Upside Down is a corkscrew the car goes over along:
    // the camera is rolled by the car's angle and the world is wound by the
    // rest here, where the rigs are done with the camera and what follows
    // reads it (render/upside.js).
    this.upside.turnView(clamped, this.camera, car, this.sCar);
    this.terrain.setWound(this.upside.twisted);

    // Terrain and forest follow the camera; tiles are built a few per frame.
    // Tiles to build again after a turn wait until the road is laid again.
    const cam = this.camera.position;
    syncWorlds(this.worlds, cam.x + this.road.origin.x, cam.z + this.road.origin.z);
    const relaying = this.road.relaying(this.sCar);
    this.terrain.holdStale = relaying;
    this.forest.holdStale = relaying;
    this.city.holdStale = relaying;
    this.terrain.update(cam.x + this.road.origin.x, cam.z + this.road.origin.z, !!this.opts.syncWorld);
    this.terrain.setPortals(this.roadMesh.portalsNear(cam.x + this.road.origin.x, cam.z + this.road.origin.z, 8));
    this.forest.setShadowFocus(car.x + this.road.origin.x, car.z + this.road.origin.z);
    this.forest.update(cam.x + this.road.origin.x, cam.z + this.road.origin.z, !!this.opts.syncWorld);
    this.forest.animate(clamped);
    this.cityRail.update(this.sCar);
    this.city.update(cam.x + this.road.origin.x, cam.z + this.road.origin.z, !!this.opts.syncWorld);
    this.cityLife.setBlocky(this.style.cur.blocks > 0.5);
    this.cityLife.update(this.camera, clamped, this.simTime, this.sCar, this.road.origin);
    this.water.update(clamped, this.camera);
    this.ceiling.update(this.camera, cam.x + this.road.origin.x, cam.z + this.road.origin.z);
    this._updateLook(cam.x, cam.z, clamped);
    const bufferH = this.sceneHeight;
    // The small things in the air come in with the front, with the light.
    this.motes.update(clamped, this.camera, this._wl || this._lookAt, this.road.origin, bufferH, this.upside.rain);
    this.fish.update(clamped, this.camera, this._lookAt, this.road.origin);
    this.critters.update(clamped, {
      camera: this.camera, car, sCar: this.sCar, style: this.style.cur, at: this._lookAt,
      origin: this.road.origin, ground: car.groundY || 0, fogColor: this.scene.fog.color, flash: this.upside.flash,
    });
    if (this.critters.knocked > this._knocked) {
      this.haptics.animal();
      this._bump('soft', car.speed, car.x + fx * 2, car.z + fz * 2);
    }
    this._knocked = this.critters.knocked;
    this.drift.update(clamped, {
      camera: this.camera, style: this.style.cur, at: this._lookAt, origin: this.road.origin,
      ground: car.groundY || 0, fogColor: this.scene.fog.color,
      light: Math.min(1, Math.max(0, (this.atmosphere.look.sunIntensity - 0.5) / 2)),
      speed: car.speed, heading: this._carWay(car), height: bufferH,
    });
    this.upside.update(clamped, {
      camera: this.camera, car, sCar: this.sCar, origin: this.road.origin,
      upside: this.atmosphere.look.upside || 0, fogColor: this.scene.fog.color,
      clutter: this.clutter, heightPx: bufferH,
    });
    // The programs of what the way into the Upside Down adds are built, in the compiler's
    // threads where the browser has them, the first time a winding is within reach: it
    // is kilometres off, and a game that never comes to one builds none.
    if (!this._upsideWarm && this.upside.zone) {
      this._upsideWarm = true;
      compileObjects(this.renderer, this.scene, this.camera, [...this.upside.meshes(), this.motes.rain]);
    }
    this.props.update(clamped, this.sCar);
    this.heaven.update(clamped, { camera: this.camera, at: this._lookAt, origin: this.road.origin, fogColor: this.scene.fog.color, level: this.water.level });
    // The cavern's own things come before what lies about the ground (the grass in a skylight's
    // light is laid by where the skylights are).
    this.cavern.update(this.camera, clamped, {
      at: this._wl || this._lookAt, sCar: this.sCar, blocks: this.style.cur.blocks, motes: this.motes,
      px: bufferH / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)),
    });
    this.valley.piers.setBlocky(this.style.cur.blocks > 0.5);
    this.valley.update(this.camera, clamped, { sCar: this.sCar, blocks: this.style.cur.blocks, fog: this.scene.fog.color });
    this.desert.update(this.camera, clamped, {
      at: this._wl || this._lookAt, sCar: this.sCar, car: this.car, blocks: this.style.cur.blocks,
      px: bufferH / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)),
    });
    // The coast's own things: the boats, the rocks in the shallows, the wall by the road.
    this.coast.update(this.camera, clamped, {
      at: this._wl || this._lookAt, sCar: this.sCar, blocks: this.style.cur.blocks, clock: this.water.time,
    });
    this.alpine.update(this.camera, clamped, this._alpineCtx(bufferH, false));
    this.inferno.update(this.camera, clamped, {
      at: this._wl || this._lookAt, sCar: this.sCar, blocks: this.style.cur.blocks, ground: this._lavaLight(),
      px: bufferH / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)),
    });
    if ((this.frame & 1023) === 0) this.infernoPlan.prune(this.sCar);
    this.clutter.setBlocky(this.style.cur.blocks > 0.5);
    this.clutter.setCasts(this.style.cur.real > 0.5);
    this.clutter.update(this.camera, clamped);
    this.atmosphere.uniforms.uFlash.value = this.upside.flash;
    this.atmosphere.uniforms.uBolt.value.copy(this.upside.bolt);
    // The block style's trees are built of blocks, the real style's of tubes and cards.
    this.forest.setBlocky(this.style.cur.blocks > 0.5);
    this.atmosphere.setBlocky(this.style.cur.blocks > 0.5);
    this.forest.setReach(this.style.treeReach);
    this._realTrees();
    // What drives is drawn the style's way: boxes, rounded, or rounder.
    this.traffic.setMode(this.style.cur.blocks > 0.5 ? 'block' : this.style.cur.paint > 0.5 ? 'soft' : 'round');
    this.roadMesh.setViewHeight(bufferH);
    this.night.setView(bufferH);
    this.cityLife.setView(bufferH);
    // A world's lamps that are torches in the block style, and their flicker.
    this.roadMesh.setTorches(this.style.cur.blocks > 0.5, this._tier);
    this.roadMesh.animate(clamped);

    // Tunnels. The frame's light follows the lens: inside a bore the sun and
    // sky go out, the lamps take over and the haze thins, and the eye opens
    // up (below). The car's own light follows the car. With the lens outside
    // and the car inside (a camera at the tunnel mouth), the bore and the car
    // keep only a little of the sky.
    const p = this.road.at(this.sCar);
    const want = p && p.kind === TUNNEL ? 1 : 0;
    this.inTunnel += (want - this.inTunnel) * Math.min(1, clamped * 2.5);
    const ceil = this.ceilingAt(cam.x, cam.z, this.director.active ? this.director.camS : this.sCar);
    const camWant = ceil !== null && cam.y < ceil + 0.5 ? 1 : 0;
    this.camInTunnel += (camWant - this.camInTunnel) * Math.min(1, clamped * 2.5);
    const look = this.atmosphere.look;
    const tin = this.camInTunnel;
    // The eye opens up in the dark of a bore and closes again outside, more
    // slowly than the light changes: the mouth ahead burns white, and for a
    // moment out in the open everything is too bright.
    this.eye += (tin - this.eye) * Math.min(1, clamped * (tin > this.eye ? 0.9 : 1.2));
    this._light(tin, this.eye);
    // The car is lit by whatever sun gets past the ridges to where it is.
    const ax = car.x + this.road.origin.x;
    const az = car.z + this.road.origin.z;
    const vis = sunVisibility(this.land, ax, az, car.y || 0, this.atmosphere.sunDir);
    sunMask.value += (vis * (1 - this.inTunnel) - sunMask.value) * Math.min(1, clamped * 4);
    // The contact shadow (render/post.js) is what the sun leaves of it where the car is, and none where the
    // world is wound over (the depth it works from is the wound land's, the sun's way is not).
    this.post.contactLight = this.upside.twisted ? 0 : Math.min(1, this.atmosphere.sun.intensity / 2) * sunMask.value;
    // Headlights: on in tunnels, and in a world where the sun is low (a
    // golden or grey sky is of a day world, and does not turn them on).
    const dark = 1 - Math.min(1, Math.max(0, (look.dayLight - 1.5) / 2));
    const lamps = Math.max(this.inTunnel, dark);
    this.traffic.setLamps(lamps);
    // In the real style the lamps throw the dipped beam, the lights of the night are drawn, and the
    // windows of the towers are rooms: by how much that style is on and how much the lamps are lit.
    const real = this.nightOff ? 0 : this.style.now.real;
    const night = real * lamps;
    nightU.uNightK.value = night;
    this._night = night;
    // (A tunnel by day is lit by the lamps of its vault: the beam's pattern is on there, not its brightness, nor the bloom.)
    this.post.night = real * dark;
    setBeam(this.headlight, night, real * dark, fx, fz, 30 * (0.15 + Math.max(this.inTunnel, dark * 0.7)), look.exposure || 2);
    this.headlight.position.set(car.x + fx * 1.8, car.y + 0.75, car.z + fz * 1.8);
    this.headlight.target.position.set(car.x + fx * 30, car.y - 0.6, car.z + fz * 30);
    this.night.update(this.camera, { share: night, time: this.simTime, origin: this.road.origin });
    this.traffic.light(this.camera, night);
    this.roadMesh.setLens(this.camera, this.traffic.glow ? this.traffic.glow.reflections : null);
    if (this.tailLight) this.tailLight.emissiveIntensity = (car.brake || 0) > 0.05 ? 6 : 2;
    const pres = this.presentation;
    if (this.emitterMat) this.emitterMat.emissiveIntensity = 0.15 + 2.6 * pres.foldAmount;
    if (this.thrusterMat) {
      this.thrusterMat.emissiveIntensity = 0.15 + pres.liftAmount * (0.8 + 2.4 * (car.throttle || 0));
    }
    if (this.carLook) {
      this.carLook.update(clamped, {
        real: this.style.now.real, sky: atmo.uEnvScale.value, lamps: Math.max(this.inTunnel, dark), lift: pres.liftAmount, throttle: car.throttle || 0,
        time: this.simTime, blinking: this.resetting,
      });
    }

    // (While a style comes in, what casts into the far shadow map changes with it: render/atmosphere.js, SHADOW.)
    this.atmosphere.restless = this.style.moving;
    this.atmosphere.update(clamped, this.camera, { x: car.x, y: car.y, z: car.z });

    // A change of style moves the sky too: its environment map is drawn again
    // as it goes, and once it has arrived.
    if (this.style.update(clamped)) {
      this.style.applyScene();
      this._styleBake -= clamped;
      if (this._styleBake <= 0 || !this.style.moving) {
        this.atmosphere._envDirty = true;
        this._styleBake = 0.12;
      }
    }
    this.style.tick(clamped);

    if (this.resetting) {
      this.resetFade = Math.max(0, this.resetFade - clamped * 1.5);
      const pulse = this.resetFade > 0 ? 0.35 + 0.65 * Math.abs(Math.sin(this.resetFade * Math.PI * 7)) : 1;
      this.presentation.setBlink(this.resetFade > 0 ? pulse : null);
      if (this.resetFade <= 0) this.resetting = false;
    }

    // Last, with everything where it is drawn: what is drawn turned is tested
    // against the frustum where it is drawn (render/upside.js).
    this.upside.cull(this.camera);

    this.stats.frames++;
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed, car.speed);
    this._fpsAccum += clamped;
    this._fpsFrames++;
    if (this._fpsAccum > 0.5) {
      this.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }
    this.frame++;
  }

  // What the alpine's things are told each frame (render/alpine.js): the look the small things in the air go by, where the lens
  // is along the road, how far the style is the block's, what a metre is in pixels, the light and the haze, and whether
  // the world stands still.
  _alpineCtx(height, settle) {
    const fog = this.scene.fog ? this.scene.fog.color : null;
    return {
      at: this._wl || this._lookAt, sCar: this.sCar, blocks: this.style.cur.blocks,
      px: height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)),
      light: Math.min(1, Math.max(0, (this.atmosphere.look.sunIntensity - 0.5) / 2)),
      fog: fog ? [fog.r, fog.g, fog.b] : null, settle,
    };
  }

  // The colour of the light off the lava (linear): the world's light from below, as strong as the hemisphere has it.
  _lavaLight() {
    const look = this.atmosphere.look;
    return this._lavaGround.set(look.groundLight).multiplyScalar(look.hemiIntensity);
  }

  // The way the car is going along the ground, [x, z] (the speed lines are laid along it).
  _carWay(car) {
    const cy = Math.cos(car.yaw);
    const sy = Math.sin(car.yaw);
    return [car.vx * cy - car.vy * sy, car.vx * sy + car.vy * cy];
  }

  // The light of the frame, for a lens that is tin inside a bore (0 or 1) and
  // an eye that has opened by eye: the sun and the sky go out in a bore and the
  // lamps take over, the haze thins, a flash of lightning lights the world
  // red, and the exposure goes by the eye.
  _light(tin, eye) {
    const look = this.atmosphere.look;
    this.atmosphere.sun.intensity = look.sunIntensity * (1 - tin * 0.97);
    // The real style takes the look's share of the sky's light (realLight), less of
    // it the more the lens is in a bore, where the lamps are the light.
    const skyK = 1 + ((look.realLight === undefined ? 1 : look.realLight) - 1) * this.style.now.real * (1 - tin);
    this.atmosphere.hemi.intensity = (look.hemiIntensity + (0.3 - look.hemiIntensity) * tin) * skyK;
    this.atmosphere.hemi.color.set(look.skyLight).lerp(TUNNEL_LAMP, tin);
    this.atmosphere.hemi.groundColor.set(look.groundLight).lerp(TUNNEL_FLOOR, tin);
    // The inferno's light from below flickers (render/inferno.js).
    if (this.inferno) this.inferno.lightFromBelow(this.atmosphere.hemi.groundColor);
    // A flash of lightning lights the whole world red for the moment it lasts; in a
    // painted night it is the sky that flashes, and the land stands against it as it is.
    const flashLit = 1 - styleU.uPair.value * styleU.uDuskDark.value.w;
    atmo.uEnvScale.value = look.envIntensity * skyK * (1 - tin * 0.85) * (1 + this.upside.flash * 2 * flashLit);
    this.atmosphere.hemi.intensity += this.upside.flash * 2.4 * flashLit;
    // (...and the haze, as far as the sky's, takes the sky's colour, render/atmosphere.js.)
    styleU.uAirFlash.value.w = (1 - flashLit) * THREE.MathUtils.smoothstep(this.upside.flash, 0.3, 0.45);
    // A drawn style may thin the haze (render/style.js; 1 as it is), and the real
    // style takes the look's share of it (realFog).
    const fogK = 1 + ((look.realFog === undefined ? 1 : look.realFog) - 1) * this.style.now.real;
    atmo.fogParams.value.x = look.fogDensity * (1 - tin * 0.9) * this.style.cur.fog * fogK;
    // The real style's haze has drifts (fogVar), and its light shafts go by the sun's place, the haze
    // there is and how far the lens is in a bore (render/shafts.js).
    atmo.uFogVar.value = this.style.now.fogVar * (1 - tin);
    const shafts = this.post.shafts;
    shafts.sunDir.copy(this.atmosphere.sunDir);
    shafts.fog = atmo.fogParams.value.x;
    shafts.inside = tin;
    shafts.sunny = this.atmosphere.uniforms.uSunny.value;
    shafts.color.copy(this.atmosphere.sun.color);
    // The real style takes only the look's share of the exposure (realExpose), and
    // the eye makes it up in the dark of a bore: inside, the lamps are lit for the
    // exposure the world has.
    const real = look.realExpose === undefined ? 1 : look.realExpose;
    this.post.realExpose = real + (1 - real) * eye;
    this.post.exposure = (look.exposure || 1) * (1 + eye * 0.5);
    // Daylight outside: the sun's strength in this world, before the bore
    // takes it away (the world's, not what a sky of it makes of it).
    this.roadMesh.setInside(tin, Math.min(1, Math.max(0, (look.dayLight - 1) / 2.5)));
    boreSky.value = 1 - 0.88 * (1 - tin);
    carSky.value = 1 - 0.8 * this.inTunnel * (1 - tin);
  }

  // One frame of the photo mode (render/photo.js), in place of update(). The
  // clock moves nothing here: the car, the cars on the road, the animals,
  // the dust, the wind, the clouds, the waves and the lightning stand as
  // they did, the sky is not read again (so its light, its clouds and its
  // haze are the moment's), and what lives by the clock in the interface is
  // not called. What goes by where the lens is is brought to it, each as
  // update() does it with no time given: the land, the trees, the city, the
  // sea, the roof of the cavern, the small things in the air, the grass's
  // surroundings, the sky's dome and the sun's shadow map; and the frame's
  // light is read at the lens, at once and without keeping it (a picture has
  // no time for the eye to open; the next update() goes on from the eye it
  // had). dt is the wall's clock, for the one thing that is asked for by
  // hand and takes its time: a change of style.
  photoUpdate(dt) {
    const step = Math.min(dt, MAX_FRAME_DT);
    const cam = this.camera.position;
    const o = this.road.origin;
    const ax = cam.x + o.x;
    const az = cam.z + o.z;
    const sync = !!this.opts.syncWorld;
    this.roadMesh.update(this.sCar - PHOTO_BEHIND, sync ? -1 : 3);
    this.roadMesh.setLens(this.camera, this.traffic.glow ? this.traffic.glow.reflections : null);
    // The lights of the night are laid round the lens where it is.
    this.night.update(this.camera, { share: this._night || 0, time: this.simTime, origin: o });
    syncWorlds(this.worlds, ax, az);
    const relaying = this.road.relaying(this.sCar);
    this.terrain.holdStale = relaying;
    this.forest.holdStale = relaying;
    this.city.holdStale = relaying;
    this.terrain.update(ax, az, sync);
    this.terrain.setPortals(this.roadMesh.portalsNear(ax, az, 8));
    // The sun's shadow map is laid where the lens looks: a point ahead of it.
    const focus = this._focus || (this._focus = new THREE.Vector3());
    this.camera.getWorldDirection(focus);
    const along = Math.hypot(focus.x, focus.z);
    const reach = along > 0.05 ? 40 / along : 0;
    focus.set(cam.x + focus.x * reach, 0, cam.z + focus.z * reach);
    focus.y = this.corridor.heightAt(focus.x + o.x, focus.z + o.z);
    this.forest.setShadowFocus(focus.x + o.x, focus.z + o.z);
    this.forest.update(ax, az, sync);
    this.cityRail.update(this.sCar);
    this.city.update(ax, az, sync);
    this.cityLife.setBlocky(this.style.cur.blocks > 0.5);
    this.cityLife.update(this.camera, 0, this.simTime, this.sCar, o);
    // Whether the sea reaches the disc is asked at every frame, not twice a second.
    this.water._dry = 0;
    this.water.update(0, this.camera);
    this.ceiling.update(this.camera, ax, az);
    this.motes.update(0, this.camera, this._wl || this._lookAt, o, this.sceneHeight, this.upside.rain);
    this.fish.update(0, this.camera, this._lookAt, o);
    // The ones that fly: the share each had, where the lens is. (The ones that
    // walk are the clock's.)
    for (const f of [this.critters.birds, this.critters.butterflies, this.critters.bats]) {
      const u = f.uniforms;
      f.update(0, this.camera, f.mesh.visible ? u.uShare.value : 0, u.uGround.value, this.scene.fog.color, o, u.uFlash.value);
    }
    // The cranes where the lens is now, the clock held.
    this.heaven.cranes.update(0, this.camera, this.heaven.share, this.water.level, this.scene.fog.color, o);
    this.drift.update(0, {
      camera: this.camera, style: this.style.cur, at: this._lookAt, origin: o,
      ground: this.car.groundY || 0, fogColor: this.scene.fog.color,
      light: Math.min(1, Math.max(0, (this.atmosphere.look.sunIntensity - 0.5) / 2)),
      speed: this.car.speed, heading: this._carWay(this.car), height: this.sceneHeight,
    });
    this.cavern.update(this.camera, 0, {
      at: this._wl || this._lookAt, sCar: this.sCar, blocks: this.style.cur.blocks, motes: this.motes, settle: true,
      px: this.sceneHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)),
    });
    this.alpine.update(this.camera, 0, this._alpineCtx(this.sceneHeight, true));
    this.clutter.setCasts(this.style.cur.real > 0.5);
    this.atmosphere.setBlocky(this.style.cur.blocks > 0.5);
    this.valley.piers.setBlocky(this.style.cur.blocks > 0.5);
    this.valley.update(this.camera, 0, { sCar: this.sCar, blocks: this.style.cur.blocks, fog: this.scene.fog.color, settle: true });
    this.desert.update(this.camera, 0, {
      at: this._wl || this._lookAt, sCar: this.sCar, car: this.car, blocks: this.style.cur.blocks, settle: true,
      px: this.sceneHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)),
    });
    this.coast.update(this.camera, 0, {
      at: this._wl || this._lookAt, sCar: this.sCar, blocks: this.style.cur.blocks, clock: this.water.time, settle: true,
    });
    this.inferno.update(this.camera, 0, {
      at: this._wl || this._lookAt, sCar: this.sCar, blocks: this.style.cur.blocks, ground: this._lavaLight(), settle: true,
      px: this.sceneHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)),
    });
    this.clutter.update(this.camera, 0);
    const near = this.road.nearestS(cam.x, cam.z, this.sCar, PHOTO_SPAN);
    const ceil = this.ceilingAt(cam.x, cam.z, near.s);
    const tin = ceil !== null && cam.y < ceil + 0.5 ? 1 : 0;
    this._light(tin, tin);
    this.atmosphere.update(0, this.camera, focus);
    // The light shafts of a world that stands are whole, not coming in (a frame here is none of the clock's).
    this.post.shafts.advance(1);
    // A style asked for takes its second and a half; the sky is drawn again as it goes.
    if (this.style.update(step)) {
      this.style.applyScene();
      this._styleBake -= step;
      if (this._styleBake <= 0 || !this.style.moving) {
        this.atmosphere._envDirty = true;
        this._styleBake = 0.12;
      }
    }
    this.upside.cull(this.camera);
  }

  // The bore under a local point, if the point is over one: the road in it,
  // the vault over the road and the land over the vault. Null where none is.
  _bore(x, z) {
    const near = this.road.nearestS(x, z, this.sCar, PHOTO_SPAN);
    if (near.dist > BORE) return null;
    const p = this.road.at(near.s);
    if (!p || p.kind !== TUNNEL) return null;
    const road = this.road.surfaceAt(near.s, this.road.lateralOf(near.s, x, z));
    const o = this.road.origin;
    return { road, vault: road + TUNNEL_H, hill: this.corridor.heightAt(x + o.x, z + o.z) };
  }

  // How high the ground is at a local point, for a lens at height y there: the
  // land's, and the road's where the road is under it (a deck too: a lens
  // does not go in under a bridge); the surface of the water, when it is to
  // hold the lens up. Where the point is over a bore, a lens down in the bore
  // (nearer the vault than the hill) is on the road, and one over the hill is
  // on the hill: the rock between is neither.
  photoFloor(x, z, wet = true, y = Infinity) {
    const o = this.road.origin;
    const ax = x + o.x;
    const az = z + o.z;
    const bore = this._bore(x, z);
    if (bore && y < (bore.vault + bore.hill) / 2) return bore.road;
    let h = bore ? bore.hill : this.corridor.heightAt(ax, az);
    const near = this.road.nearestS(x, z, this.sCar, PHOTO_SPAN);
    if (near.dist < HALF_FLAT + 1.5) {
      const p = this.road.at(near.s);
      if (p) h = Math.max(h, this.road.surfaceAt(near.s, this.road.lateralOf(near.s, x, z)));
    }
    if (wet) h = Math.max(h, this.land.waterLevel(ax, az));
    return h;
  }

  // How high a lens at height y may go at a local point: the vault of the
  // bore it is in, the roof of the cavern; Infinity in the open.
  photoCeiling(x, z, y = Infinity) {
    const o = this.road.origin;
    const roof = this.ceiling.roofAt(x + o.x, z + o.z);
    const bore = this._bore(x, z);
    return bore && y < (bore.vault + bore.hill) / 2 ? Math.min(bore.vault, roof) : roof;
  }

  resize(w, h) {
    this.size = [w, h];
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
  }

  // Draw the scene at this fraction of the canvas's size (render/quality.js);
  // the last pass brings the frame up to the canvas.
  setRenderScale(s) {
    this.renderScale = s;
    this.post.setScale(s);
  }

  // The sun's shadow maps: the quality level's size, and in the pixel style from the
  // second of its steps no more than that style takes (render/quality.js).
  applyShadow() {
    this.atmosphere.setShadowSize(shadowSize(this.quality ? this.quality.level : 0, this.post.pixelLevel));
  }

  // The height the scene is drawn at under the style's numbers as they are (render/post.js,
  // heightFor): the pixels that what is sized by them goes by.
  get sceneHeight() {
    return this.post.heightFor(this.style);
  }

  // How many pixels the scene is drawn at, across, for each of the page's
  // (CSS) pixels: the canvas's own ratio, and the fraction of it in use.
  get drawRatio() {
    return this.renderer.getPixelRatio() * this.renderScale;
  }

  // The land and the forest, less what the near land hides from the lens
  // (render/horizon.js). What is found for a lens holds while it has not gone
  // far or turned much (Horizon.holds), the car has not, and the land that is
  // drawn is the same (TerrainField.rev); only then is it found again. Not
  // where the lens can be under the ground (in a bore), where the land is
  // wound over, or where the view takes in the sky straight up or down.
  _cull() {
    const cam = this.camera;
    const hz = this.horizon;
    const p = cam.position;
    const car = this.car;
    const was = this._culled;
    cam.updateMatrixWorld();
    const [lo, span] = viewSpan(cam, this._span);
    const cx = car.x - was.x;
    const cz = car.z - was.z;
    const fresh = !(this.cullOn && !this.upside.twisted && this.camInTunnel <= 0.01
      && was.rev === this.terrain.rev && cx * cx + cz * cz <= hz.h * hz.h && hz.holds(p.x, p.y, p.z, lo, span));
    if (fresh) {
      const o = this.road.origin;
      const off = !this.cullOn || this.upside.twisted || this.camInTunnel > 0.01 || !(span > 0)
        || p.y < this.corridor.heightAt(p.x + o.x, p.z + o.z) - 0.5;
      hz.begin(p.x, p.y, p.z, lo, off ? 0 : span);
      was.rev = this.terrain.rev;
      was.x = car.x;
      was.z = car.z;
      was.n++;
    }
    this.terrain.cull(hz, cam, car, fresh);
    this.forest.arrange(cam, this.sceneHeight, hz, this.upside.twisted, fresh);
  }

  render(dt = 1 / 60) {
    this.renderer.info.reset();
    this._cull();
    this.grass.render(this.renderer, this.camera, { style: this.style.id, height: this.sceneHeight });
    viewBeam(this.camera);
    this._askBlur();
    this.roadMesh.showCars(!this.traffic.glow || this.traffic.glow.halos.mesh.visible);
    this.post.setStyle(this.style);
    // The desert's heat haze, in the styles that have it, and the dust of a dust devil the car is in.
    // Their programs are built the first time the desert is in reach.
    if (this.desert.on && !this._desertWarm) {
      this._desertWarm = true;
      this.post.haze.warm(this.renderer);
      this.desert.warm(this.renderer, this.scene, this.camera);
    }
    // The inferno's over its lava, from the same pass with a test of its own (render/post.js); the one there is more of.
    if (this.inferno.on && !this._infernoWarm) {
      this._infernoWarm = true;
      this.post.haze.warm(this.renderer);
      this.inferno.warm(this.renderer, this.scene, this.camera);
    }
    const tier = this.desert.tier;
    const hot = this.desert.haze * this.style.now.haze * (tier === 'low' ? 0 : 1);
    const lava = this.inferno.haze * this.style.now.haze * (this.inferno.tier === 'low' ? 0 : 1);
    if (lava > hot) this.post.setHaze(lava, this.inferno.clock, this.inferno.tier === 'high', this.water.level);
    else this.post.setHaze(hot, this.desert.clock, tier === 'high');
    this.post.setWash(this.desert.wash);
    if (this.post.pixelLevel !== this._shadowStep) {
      this._shadowStep = this.post.pixelLevel;
      this.applyShadow();
    }
    this.post.render(dt);
    // Drawn: what the start left for after it gets its few milliseconds.
    if (this.later.pending) {
      const info = this.renderer.info.render;
      const kept = [info.calls, info.triangles, info.points, info.lines];
      this.later.run();
      [info.calls, info.triangles, info.points, info.lines] = kept;
    }
  }

  // What the motion blur is asked for this frame (render/lens.js, PostChain.setStyle lays the
  // real style's share and the tier's on it): in the chase lens, as the visitor has it, not in
  // the photo mode, coming in with the car's speed.
  _askBlur() {
    const car = this.car;
    const speed = Math.hypot(car.vx || 0, car.vy || 0);
    const t = Math.min(1, Math.max(0, (speed - BLUR.from) / (BLUR.full - BLUR.from)));
    const chase = this.chase.framing === 'chase' && !this.director.active;
    const ask = this.post.blurAsk;
    ask.amount = this.blurOn && chase && !this.photo.active ? t * t * (3 - 2 * t) : 0;
    ask.dt = this._blurDt || 1 / 60;
    ask.speed = speed;
  }

  snapshot() {
    const p = this.road.at(this.sCar);
    return {
      frame: this.frame,
      simTime: +this.simTime.toFixed(2),
      distance: +this.sCar.toFixed(1),
      speedKmh: +this.car.speedKmh.toFixed(1),
      altitude: +(this.car.y || 0).toFixed(1),
      structure: p ? ['ground', 'bridge', 'tunnel'][p.kind] : '',
      autoMode: this.autoMode,
      fps: +this.fps.toFixed(1),
      exposure: +this.post.exposure.toFixed(2),
      pixelRatio: +this.drawRatio.toFixed(2),
      canvasRatio: +this.renderer.getPixelRatio().toFixed(2),
      renderScale: +this.renderScale.toFixed(3),
      quality: this.quality ? this.quality.level : 0,
      tier: this.tier,
      tiles: this.terrain.rendered.size,
      buried: this.terrain.buried,
      ceilingShown: this.ceiling.mesh.visible,
      motes: this.motes.points.visible ? this.motes.shown : 0,
      fish: this.fish.mesh.visible ? this.fish.shown : 0,
      critters: this.critters.shown,
      flyers: this.critters.birds.shown + this.critters.butterflies.shown,
      bats: this.critters.bats.shown,
      drifting: this.drift.shown.lines + this.drift.shown.petals,
      speedLines: this.drift.shown.speed,
      props: this.props.shown,
      clutter: this.clutter.shown,
      clutterKinds: Object.keys(this.clutter.counts).length,
      cavern: this.cavern.stats(),
      valley: this.valley.stats(),
      desert: this.desert.stats(),
      inferno: this.inferno.stats(),
      city: this.cityLife.stats(),
      coast: this.coast.stats(),
      heaven: this.heaven.stats(),
      alpine: this.alpine.stats(),
      traffic: this.traffic.kinds(),
      dustShown: this.dust.shown,
      lands: this.lands,
      treeKinds: this.forest.kindsShown(),
      upside: {
        roll: this.upside.roll, turning: this.upside.turning, flash: this.upside.flash, tentacles: this.upside.mesh.count,
        roots: this.upside.creep.roots.length, segments: this.upside.creep.shown, infect: +this.upside.infect.toFixed(3),
        rain: +this.upside.rain.toFixed(3), streaks: this.motes.streaks, marks: this.upside.waymarks.counts.lamps,
        grounded: this.upside.groundStrikes, pods: this.upside.pods, spores: this.upside.spores.points.visible,
      },
      trees: this.forest.trees,
      buildings: this.city.buildings,
      roadChunks: this.roadMesh.chunks.size,
      roadSpans: this.roadMesh.spans.size,
      roadAudit: this.roadMesh.audit(),
      roadSurfaces: this.roadMesh.surfaces.summary(),
      foliage: { ready: this.foliage.ready, ...this.foliage.bytes },
      lamps: this.roadMesh.lamps,
      envBakes: this.atmosphere.bakes || 0,
      clouds: this.atmosphere.clouds.state(),
      style: this.style.id,
      styleT: +this.style.t.toFixed(3),
      styled: this.post.stylePass.enabled || this.post.pixelPass.enabled,
      world: this.worldHere(),
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      carLoaded: this.carLoaded,
      hits: this.hits || 0,
      wrecks: this.wrecks,
      passes: this.passes,
      // The lens as drawn, whole: p, q and fov are the numbers themselves (two runs of the
      // same drive have the same ones, to the last digit); the turn into the bend, and the
      // curvature it came from.
      lens: {
        p: this.camera.position.toArray(), q: this.camera.quaternion.toArray(), fov: this.camera.fov,
        lookIn: this.chase.lookIn.value, bend: this._bend || 0,
      },
      road: this.road.stats,
    };
  }
}
