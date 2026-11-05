"""Longitudinal design curves.

Everything the body needs as a function of x: plan-view half width, rocker
height, beltline height and the wheel-arch opening. All values in mm.

Proportions target a mid-engine coupe: cab-forward, long rear deck over the
engine, fastback roof.
"""

import math

from . import params
from .geom import keyframe

# ---------------------------------------------------------------- plan view

_HALF_WIDTH = [
    (params.X_HULL_TAIL, 700.0),
    (-2214.0, 748.0),
    (-2180.0, 790.0),
    (-2120.0, 828.0),
    (-2030.0, 862.0),
    (-1900.0, 880.0),
    (-1550.0, 898.0),
    (params.AXLE_R, 900.0),      # haunch over the rear wheel
    (-1000.0, 888.0),
    (-300.0, 878.0),
    (500.0, 882.0),
    (params.AXLE_F, 896.0),      # haunch over the front wheel
    (1720.0, 878.0),
    (1900.0, 848.0),
    (2020.0, 792.0),
    (2110.0, 700.0),
    (2175.0, 566.0),
    (2210.0, 392.0),
    (params.X_HULL_NOSE, 196.0),
]

_ROCKER = [
    (params.X_HULL_TAIL, 322.0),
    (-2184.0, 262.0),
    (-2060.0, 196.0),
    (-1900.0, 172.0),
    (1750.0, 168.0),
    (1980.0, 186.0),
    (2110.0, 244.0),
    (params.X_HULL_NOSE, 348.0),
]

_BELT = [
    (params.X_HULL_TAIL, 892.0),
    (-2210.0, 930.0),
    (-2160.0, 968.0),
    (-2080.0, 1004.0),
    (-1950.0, 1032.0),
    (params.AXLE_R, 1050.0),
    (-900.0, 1032.0),
    (0.0, 1020.0),
    (params.AXLE_F, 1024.0),
    (1450.0, 1002.0),
    (1850.0, 962.0),
    (2000.0, 906.0),
    (2100.0, 812.0),
    (2170.0, 688.0),
    (params.X_HULL_NOSE, 560.0),
]

CABIN_X0 = params.X_RW_BASE
CABIN_X1 = params.X_WS_BASE
RIM_FRACTION = 0.858      # cabin rim / deck edge as a fraction of half width


def half_width(x):
    return keyframe(_HALF_WIDTH, x)


def rocker_z(x):
    return keyframe(_ROCKER, x)


def belt_z(x):
    """Rim height: the single curve that closes the top of the hull."""
    return keyframe(_BELT, x)


def rim_half_width(x):
    return RIM_FRACTION * half_width(x)


def in_cabin(x):
    return CABIN_X0 <= x <= CABIN_X1


# ---------------------------------------------------------------- arches


def arch_entry(x):
    """Arch record for the opening this station falls in, else None."""
    for a in params.arch_list():
        if abs(x - a["axle"]) < a["rx"]:
            return a
    return None


def arch_z(x):
    """Height of the arch opening at station x, or the rocker if outside."""
    a = arch_entry(x)
    zb = rocker_z(x)
    if a is None:
        return zb
    base = max(rocker_z(a["axle"]) + 8.0, zb)
    k = math.sqrt(max(0.0, 1.0 - ((x - a["axle"]) / a["rx"]) ** 2))
    return base + (a["apex"] - base) * k


def well_inner_y(x):
    a = arch_entry(x)
    if a is None:
        return 0.58 * half_width(x)
    return a["well_inner"]


# ---------------------------------------------------------------- greenhouse


_ROOF_HEIGHT = [
    (CABIN_X0, 0.0),
    (CABIN_X0 + 210.0, 214.0),
    (-830.0, 272.0),
    (params.X_ROOF_R, 286.0),
    (-80.0, 290.0),
    (params.X_ROOF_F, 282.0),
    (420.0, 236.0),
    (CABIN_X1 - 90.0, 110.0),
    (CABIN_X1, 0.0),
]


def roof_height(x):
    """Canopy rise above the rim at station x."""
    if x <= CABIN_X0 or x >= CABIN_X1:
        return 0.0
    return max(0.0, keyframe(_ROOF_HEIGHT, x))


# ---------------------------------------------------------------- stations


def _arch_keys():
    keys = []
    for a in params.arch_list():
        ax, rx = a["axle"], a["rx"]
        keys.extend([ax - rx, ax + 0.62 * rx, ax + 0.30 * rx,
                     ax - 0.30 * rx, ax - 0.62 * rx, ax + rx])
    return keys


def stations(count=params.HULL_STATIONS):
    """Dense uniform stations plus the x values where geometry must land."""
    lo, hi = params.X_HULL_TAIL, params.X_HULL_NOSE
    step = (hi - lo) / float(count)
    xs = [lo + step * k for k in range(count + 1)]
    xs.extend([CABIN_X0, CABIN_X1, 0.0])
    xs.extend(_arch_keys())
    xs = sorted(set(round(v, 3) for v in xs))
    return [v for v in xs if lo <= v <= hi]


def cabin_stations():
    return [x for x in stations() if CABIN_X0 < x < CABIN_X1]


def outside_cabin_stations():
    return [x for x in stations() if not (CABIN_X0 + 1e-6 < x < CABIN_X1 - 1e-6)]


def landmarks(x):
    """Debug helper: the headline numbers at one station."""
    return dict(x=x, hw=half_width(x), rim=rim_half_width(x),
                rocker=rocker_z(x), belt=belt_z(x), arch=arch_z(x),
                roof=roof_height(x), cabin=in_cabin(x))
