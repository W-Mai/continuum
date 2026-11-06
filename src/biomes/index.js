// Biome definitions. Everything the look depends on lives here as data, so the
// transition code can interpolate any pair of them without special cases.
//
// Colours are sRGB hex. Numbers are metres unless noted.

export const BIOMES = {
  alpine: {
    id: 'alpine',
    name: '山间',
    sky: { top: 0x2f6fb5, bottom: 0xbfe0f5, horizon: 0xd6e6f2, starDensity: 0, sunAngle: 1.15, sunColor: 0xfff2dc, sunSize: 42 },
    fog: { color: 0xbcd8ec, near: 220, far: 2100, density: 0.00028 },
    lights: {
      hemiSky: 0xbcd9ff, hemiGround: 0x5d6552, hemiIntensity: 1.05,
      keyColor: 0xfff0d8, keyIntensity: 2.3,
      ambient: 0x40607f, ambientIntensity: 0.35,
    },
    road: { asphalt: 0x1f2327, line: 0xe8e6dd, shoulder: 0x4a5158, width: 9.6, bump: 0.85 },
    terrain: { colorA: 0x3f6b3a, colorB: 0x8fa87c, rock: 0x6b6459, detail: 7, roughness: 0.95, amp: 260, ridged: true },
    props: { kind: ['conifer', 'house', 'deer', 'sheep'], density: 1.0, scale: 1.0, tint: 0x2f5230 },
    car: { envIntensity: 0.7, haze: 0.55 },
    look: { saturation: 1.14, vignette: 0.30 },
    shape: [[520, 0.0062, 0], [271, 0.0041, 1.7], [139, 0.0028, 3.4], [71, 0.0016, 5.1], [37, 0.0009, 2.2]],
  },

  desert: {
    id: 'desert',
    name: '沙漠',
    sky: { top: 0x1f4c8f, bottom: 0xffd9a0, horizon: 0xffe3b8, starDensity: 0, sunAngle: 0.42, sunColor: 0xffe2b0, sunSize: 58 },
    fog: { color: 0xe8c99a, near: 300, far: 2600, density: 0.00022 },
    lights: {
      hemiSky: 0xffe6bb, hemiGround: 0xa97a45, hemiIntensity: 1.15,
      keyColor: 0xffdca8, keyIntensity: 2.7,
      ambient: 0x8a6b4a, ambientIntensity: 0.4,
    },
    road: { asphalt: 0x272320, line: 0xf0e2c0, shoulder: 0x8a7350, width: 10.0, bump: 0.45 },
    terrain: { colorA: 0xc9a166, colorB: 0xf0d7a8, rock: 0x9c7c52, detail: 5, roughness: 0.9, amp: 90, ridged: false },
    props: { kind: ['dune', 'billboard', 'silo'], density: 0.55, scale: 1.4, tint: 0xd8b374 },
    car: { envIntensity: 0.8, haze: 0.75 },
    look: { saturation: 1.08, vignette: 0.30 },
    shape: [[700, 0.0034, 0.6], [330, 0.0022, 2.4], [151, 0.0014, 4.1], [77, 0.0008, 1.1], [41, 0.0004, 3.7]],
  },

  city: {
    id: 'city',
    name: '城市',
    // Sodium street light over a cool night: that warm-on-cool split is what
    // reads as a city, and it keeps this clearly apart from the all-blue biomes.
    sky: { top: 0x0e0c16, bottom: 0x3a2218, horizon: 0x6a4028, starDensity: 0.20, sunAngle: 2.6, sunColor: 0xffc890, sunSize: 22 },
    fog: { color: 0x33211a, near: 130, far: 1300, density: 0.00055 },
    lights: {
      hemiSky: 0x3a2a3a, hemiGround: 0x2a1a12, hemiIntensity: 0.65,
      keyColor: 0xffb878, keyIntensity: 1.6,
      ambient: 0x3a2418, ambientIntensity: 0.7,
    },
    road: { asphalt: 0x1c1712, line: 0xe8d8b8, shoulder: 0x3a2e24, width: 10.4, bump: 0.20 },
    terrain: { colorA: 0x2a2018, colorB: 0x4a3626, rock: 0x3a2e26, detail: 1.5, roughness: 0.85, amp: 6, ridged: false },
    props: { kind: ['tower', 'billboard', 'house'], density: 1.5, scale: 1.0, tint: 0x2b3340 },
    car: { envIntensity: 1.1, haze: 0.35 },
    look: { saturation: 1.16, vignette: 0.30 },
    shape: [[260, 0.0082, 0], [130, 0.0052, 1.4], [61, 0.0031, 3.1], [29, 0.0018, 5.4], [17, 0.0008, 0.9]],
  },

  space: {
    id: 'space',
    name: '太空',
    sky: { top: 0x000000, bottom: 0x0a0a18, horizon: 0x12141f, starDensity: 1.0, sunAngle: 0.9, sunColor: 0xffffff, sunSize: 26 },
    fog: { color: 0x05060f, near: 900, far: 6000, density: 0.00004 },
    lights: {
      hemiSky: 0x223355, hemiGround: 0x05060a, hemiIntensity: 0.35,
      keyColor: 0xf2f6ff, keyIntensity: 3.4,
      ambient: 0x0d1526, ambientIntensity: 0.5,
    },
    road: { asphalt: 0x0d0e13, line: 0x9fe8ff, shoulder: 0x1d2230, width: 9.6, bump: 0.05 },
    terrain: { colorA: 0x0b0d14, colorB: 0x1a2030, rock: 0x2a3242, detail: 2, roughness: 0.7, amp: 40, ridged: false },
    props: { kind: ['asteroid'], density: 0.8, scale: 1.6, tint: 0x39404f },
    car: { envIntensity: 1.6, haze: 0.1 },
    look: { saturation: 1.02, vignette: 0.30 },
    shape: [[1400, 0.0016, 0], [620, 0.0009, 2.1], [240, 0.0005, 4.4], [110, 0.0003, 1.2], [60, 0.0002, 5.8]],
  },

  cavern: {
    id: 'cavern',
    name: '地底',
    sky: { top: 0x0a0604, bottom: 0x241a12, horizon: 0x2e2016, starDensity: 0, sunAngle: 1.8, sunColor: 0xff8844, sunSize: 18 },
    fog: { color: 0x1a1108, near: 60, far: 620, density: 0.0016 },
    lights: {
      hemiSky: 0x6b4a28, hemiGround: 0x22160c, hemiIntensity: 1.15,
      keyColor: 0xffb066, keyIntensity: 2.9,
      ambient: 0x4a2e18, ambientIntensity: 1.3,
    },
    road: { asphalt: 0x191410, line: 0xffb166, shoulder: 0x3a2c20, width: 9.0, bump: 1.00 },
    terrain: { colorA: 0x2b2018, colorB: 0x4a382a, rock: 0x4a382a, detail: 9, roughness: 0.95, amp: 320, ridged: true },
    props: { kind: ['stalagmite', 'pillar'], density: 1.8, scale: 1.2, tint: 0x54402e },
    car: { envIntensity: 0.5, haze: 0.4 },
    look: { saturation: 1.18, vignette: 0.30 },
    shape: [[300, 0.0090, 0.3], [141, 0.0058, 2.8], [67, 0.0034, 5.2], [31, 0.0020, 0.7], [19, 0.0009, 4.2]],
  },

  inferno: {
    id: 'inferno',
    name: '地狱',
    sky: { top: 0x1a0200, bottom: 0x8f1c02, horizon: 0xb4360a, starDensity: 0, sunAngle: 2.1, sunColor: 0xff5500, sunSize: 70 },
    fog: { color: 0x50100a, near: 90, far: 900, density: 0.0011 },
    lights: {
      hemiSky: 0xff6a2a, hemiGround: 0x2a0500, hemiIntensity: 0.9,
      keyColor: 0xff7a30, keyIntensity: 2.6,
      ambient: 0x551004, ambientIntensity: 0.8,
    },
    road: { asphalt: 0x140d0b, line: 0xffc24a, shoulder: 0x3a1a10, width: 9.6, bump: 0.90 },
    terrain: { colorA: 0x2a0b04, colorB: 0x8a2b06, rock: 0x5c2a12, detail: 10, roughness: 0.9, amp: 380, ridged: true },
    props: { kind: ['lavaspire', 'stalagmite'], density: 1.5, scale: 1.5, tint: 0xff4a00 },
    car: { envIntensity: 0.9, haze: 0.6 },
    look: { saturation: 1.26, vignette: 0.30 },
    shape: [[380, 0.0084, 1.1], [180, 0.0055, 3.6], [85, 0.0033, 0.4], [41, 0.0019, 5.6], [23, 0.0010, 2.5]],
  },

  heaven: {
    id: 'heaven',
    name: '天堂',
    sky: { top: 0x6fb4ff, bottom: 0xfff4e6, horizon: 0xfff6ea, starDensity: 0.15, sunAngle: 0.35, sunColor: 0xfffdf2, sunSize: 90 },
    fog: { color: 0xfff0e0, near: 700, far: 5200, density: 0.00012 },
    lights: {
      hemiSky: 0xffffff, hemiGround: 0xd8c8b0, hemiIntensity: 1.9,
      keyColor: 0xfff6e2, keyIntensity: 2.1,
      ambient: 0xa8c0e0, ambientIntensity: 0.9,
    },
    road: { asphalt: 0x2a2a30, line: 0xfff8e8, shoulder: 0x6a6a78, width: 10.8, bump: 0.05 },
    terrain: { colorA: 0xe8e0f0, colorB: 0xffffff, rock: 0xd8cbc0, detail: 4, roughness: 0.6, amp: 150, ridged: false },
    props: { kind: ['pillar', 'house'], density: 0.7, scale: 1.3, tint: 0xfff6ea },
    car: { envIntensity: 1.4, haze: 0.85 },
    look: { saturation: 0.98, vignette: 0.30 },
    shape: [[900, 0.0028, 2.2], [410, 0.0018, 0.5], [190, 0.0011, 3.9], [90, 0.0007, 1.7], [47, 0.0004, 5.1]],
  },

  abyss: {
    id: 'abyss',
    name: '深海',
    sky: { top: 0x000a14, bottom: 0x00283e, horizon: 0x0b3a4e, starDensity: 0, sunAngle: 0.7, sunColor: 0x40d0ff, sunSize: 34 },
    fog: { color: 0x021e2c, near: 40, far: 520, density: 0.0019 },
    lights: {
      hemiSky: 0x1a6a88, hemiGround: 0x021018, hemiIntensity: 0.7,
      keyColor: 0x7fe8ff, keyIntensity: 1.6,
      ambient: 0x0a3040, ambientIntensity: 0.8,
    },
    road: { asphalt: 0x0a161c, line: 0x5ef0d0, shoulder: 0x123040, width: 9.2, bump: 0.35 },
    terrain: { colorA: 0x08202c, colorB: 0x14495c, rock: 0x14495c, detail: 6, roughness: 0.8, amp: 200, ridged: true },
    props: { kind: ['kelp', 'pillar'], density: 1.6, scale: 1.1, tint: 0x1e8a7a },
    car: { envIntensity: 0.8, haze: 0.45 },
    look: { saturation: 1.10, vignette: 0.30 },
    shape: [[420, 0.0072, 4.0], [201, 0.0047, 1.3], [93, 0.0029, 3.0], [45, 0.0017, 5.5], [25, 0.0009, 0.2]],
  },

  hills: {
    id: 'hills',
    name: '丘陵',
    sky: { top: 0x3a7ec4, bottom: 0xcfe6f4, horizon: 0xe0eef7, starDensity: 0, sunAngle: 1.9, sunColor: 0xfff0d0, sunSize: 34 },
    fog: { color: 0xc6dced, near: 260, far: 2400, density: 0.00025 },
    lights: {
      hemiSky: 0xc2dcf6, hemiGround: 0x5f7050, hemiIntensity: 1.0,
      keyColor: 0xfff2d8, keyIntensity: 2.2,
      ambient: 0x46607a, ambientIntensity: 0.36,
    },
    road: { asphalt: 0x24262a, line: 0xeae6da, shoulder: 0x565a58, width: 9.0, bump: 0.9 },
    terrain: { colorA: 0x4a7a3c, colorB: 0x9bb86a, rock: 0x70675a, detail: 6, roughness: 0.95, amp: 300, ridged: true },
    props: { kind: ['conifer', 'sheep', 'house', 'deer'], density: 1.1, scale: 1.0, tint: 0x315a2c },
    car: { envIntensity: 0.75, haze: 0.5 },
    look: { saturation: 1.12, vignette: 0.30 },
    // Tight and rolling: short wavelengths with real amplitude, so the road
    // switchbacks over the hills rather than sweeping past them.
    shape: [[300, 0.0105, 0], [151, 0.0072, 2.0], [71, 0.0044, 4.2], [37, 0.0026, 1.3], [19, 0.0013, 5.6]],
  },

  coast: {
    id: 'coast',
    name: '沿海',
    sky: { top: 0x2e79b8, bottom: 0xe4f1f7, horizon: 0xf2f7f4, starDensity: 0, sunAngle: 0.6, sunColor: 0xfff6e2, sunSize: 46 },
    fog: { color: 0xd8e8f0, near: 320, far: 2800, density: 0.00020 },
    lights: {
      hemiSky: 0xbcd4e8, hemiGround: 0x8a8060, hemiIntensity: 0.72,
      keyColor: 0xfff4e0, keyIntensity: 1.45,
      ambient: 0x40607a, ambientIntensity: 0.30,
    },
    road: { asphalt: 0x2a2b2e, line: 0xf0ece0, shoulder: 0xbfae8e, width: 9.6, bump: 0.35 },
    terrain: { colorA: 0xc9ab74, colorB: 0xefdfb8, rock: 0x94866c, detail: 2.5, roughness: 0.92, amp: 40, ridged: false },
    props: { kind: ['dune', 'house', 'billboard', 'bird'], density: 0.7, scale: 1.2, tint: 0xd8c49a },
    water: { present: 1.0, level: -6.0, amp: 1.35, shallow: 0x4fa6bc, deep: 0x0e3348 },
    car: { envIntensity: 1.0, haze: 0.6 },
    look: { saturation: 1.10, vignette: 0.26 },
    shape: [[900, 0.0026, 0.4], [430, 0.0017, 2.6], [180, 0.0010, 4.8], [83, 0.0006, 1.5], [39, 0.0003, 3.9]],
  },

  river: {
    id: 'river',
    name: '河谷',
    sky: { top: 0x4a86be, bottom: 0xd6e8f2, horizon: 0xe8f0f2, starDensity: 0, sunAngle: 1.4, sunColor: 0xfff2da, sunSize: 30 },
    fog: { color: 0xc2dae4, near: 200, far: 1900, density: 0.00034 },
    lights: {
      hemiSky: 0xbcd8f0, hemiGround: 0x50603f, hemiIntensity: 0.95,
      keyColor: 0xfff0d4, keyIntensity: 2.0,
      ambient: 0x3f5a6e, ambientIntensity: 0.34,
    },
    road: { asphalt: 0x20242a, line: 0xe6e6dc, shoulder: 0x50564e, width: 8.6, bump: 0.7 },
    terrain: { colorA: 0x3d6b3a, colorB: 0x7fa863, rock: 0x605a4e, detail: 5, roughness: 0.94, amp: 220, ridged: true },
    props: { kind: ['conifer', 'house', 'deer', 'silo'], density: 0.95, scale: 1.05, tint: 0x2b4f30 },
    water: { present: 0.85, level: -3.0, amp: 0.55, shallow: 0x4a8a72, deep: 0x123f36 },
    car: { envIntensity: 0.7, haze: 0.45 },
    look: { saturation: 1.13, vignette: 0.32 },
    // Medium amplitude with a bias to sweeping bends, which is what a valley
    // floor road does.
    shape: [[600, 0.0050, 0.2], [290, 0.0034, 2.2], [130, 0.0022, 4.4], [63, 0.0013, 1.6], [31, 0.0007, 5.0]],
  },
};

export const BIOME_ORDER = [
  'alpine', 'hills', 'river', 'coast', 'desert', 'city',
  'space', 'cavern', 'inferno', 'heaven', 'abyss',
];

export function getBiome(id) {
  return BIOMES[id] || BIOMES.alpine;
}

export function nextBiomeId(currentId, direction = 1) {
  const i = BIOME_ORDER.indexOf(currentId);
  const n = BIOME_ORDER.length;
  return BIOME_ORDER[(i + direction + n) % n];
}
