"""Material palette.

Each entry: colour (sRGB 0..1), metallic, roughness, alpha, optional emission
(colour, strength). Values are tuned so the software rasteriser and the glTF
PBR view agree.
"""

MATERIALS = {
    # body ---------------------------------------------------------
    "paint": dict(color=(0.82, 0.24, 0.13), metallic=0.55, roughness=0.28),
    "paint_dark": dict(color=(0.30, 0.09, 0.06), metallic=0.55, roughness=0.30),
    "paint_lo": dict(color=(0.55, 0.14, 0.08), metallic=0.50, roughness=0.32),
    # cabin --------------------------------------------------------
    "glass": dict(color=(0.10, 0.13, 0.16), metallic=0.10, roughness=0.06, alpha=0.42),
    "glass_dark": dict(color=(0.05, 0.06, 0.08), metallic=0.10, roughness=0.08, alpha=0.75),
    # trim ---------------------------------------------------------
    "carbon": dict(color=(0.055, 0.058, 0.065), metallic=0.30, roughness=0.35),
    "black_trim": dict(color=(0.045, 0.047, 0.052), metallic=0.05, roughness=0.62),
    "rubber": dict(color=(0.038, 0.038, 0.042), metallic=0.0, roughness=0.92),
    "rubber_side": dict(color=(0.055, 0.055, 0.060), metallic=0.0, roughness=0.85),
    "chrome": dict(color=(0.86, 0.88, 0.90), metallic=1.0, roughness=0.12),
    "alu": dict(color=(0.62, 0.64, 0.68), metallic=0.95, roughness=0.30),
    "gunmetal": dict(color=(0.24, 0.25, 0.28), metallic=0.90, roughness=0.38),
    "brake_disc": dict(color=(0.34, 0.34, 0.36), metallic=0.85, roughness=0.45),
    "caliper": dict(color=(0.85, 0.55, 0.08), metallic=0.40, roughness=0.40),
    # lights -------------------------------------------------------
    "head_light": dict(color=(0.90, 0.93, 1.00), metallic=0.20, roughness=0.05,
                       emission=((0.85, 0.92, 1.00), 1.4)),
    "tail_light": dict(color=(0.70, 0.04, 0.05), metallic=0.20, roughness=0.10,
                       emission=((1.00, 0.08, 0.06), 1.1)),
    "tail_light_off": dict(color=(0.22, 0.02, 0.03), metallic=0.20, roughness=0.15),
    # hover: the wheel rings and the thrust rings, in the car's one accent
    "emitter": dict(color=(1.00, 0.42, 0.24), metallic=0.0, roughness=0.30,
                    emission=((1.00, 0.42, 0.24), 1.0)),
    "thruster": dict(color=(1.00, 0.42, 0.24), metallic=0.0, roughness=0.30,
                     emission=((1.00, 0.42, 0.24), 1.0)),
    # interior -----------------------------------------------------
    "leather": dict(color=(0.13, 0.11, 0.11), metallic=0.0, roughness=0.72),
    "alcantara": dict(color=(0.09, 0.09, 0.10), metallic=0.0, roughness=0.90),
    "carpet": dict(color=(0.06, 0.06, 0.07), metallic=0.0, roughness=0.95),
    # scene --------------------------------------------------------
    "ground": dict(color=(0.16, 0.17, 0.19), metallic=0.0, roughness=0.85),
    "grid": dict(color=(0.30, 0.33, 0.38), metallic=0.0, roughness=0.80),
}


def mat(name):
    return MATERIALS[name]


def rgb(name):
    return MATERIALS[name]["color"]


def alpha(name):
    return MATERIALS[name].get("alpha", 1.0)


def is_transparent(name):
    return alpha(name) < 0.999


def emission(name):
    return MATERIALS[name].get("emission", (None, 0.0))


def to_linear(c):
    """sRGB -> linear for physically-ish shading."""
    out = []
    for x in c:
        out.append(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4)
    return tuple(out)
