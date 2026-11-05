"""Queries against the body surface.

Detail parts (lights, grille, mirrors, vents, skirts) must sit *on* the body,
so they ask these functions where the skin is at a given station and height.
Keeping the queries here means the parts never re-derive the section maths and
stay attached when the design curves move.
"""

import math

from . import body, params, profile
from .geom import clamp

_CACHE = {}


def section(x):
    key = round(x, 2)
    if key not in _CACHE:
        _CACHE[key] = body.full_section(body.section_meta(key))
    return _CACHE[key]


def _half_points(x):
    return [p for p in section(x) if p[0] >= -1e-9]


def _outer_points(x):
    """Right-hand skin points from the rim down to the arch/widest line only.

    The section continues into the wheel well and the floor; those segments are
    interior, so queries against the *outer* skin stop at the arch mouth.
    """
    pts = _half_points(x)
    m = body.section_meta(x)
    keep = []
    for y, z in pts:
        keep.append((y, z))
        if abs(y - m["y_arch"]) < 1e-6:
            break
    return keep


def flank_y(x, z):
    """Half width of the outer skin at station x and height z.

    Clamps to the nearest end of the outer skin, so a query slightly above the
    rim or below the arch mouth still yields the skin's half width instead of
    collapsing to 0. Returns 0.0 only where the station has no skin at all
    (outside the body's x range).
    """
    pts = _outer_points(x)
    if not pts:
        return 0.0
    if z >= pts[0][1]:
        return pts[0][0]
    for i in range(len(pts) - 1):
        y0, z0 = pts[i]
        y1, z1 = pts[i + 1]
        if z0 >= z >= z1:
            span = z0 - z1
            t = 0.0 if span <= 1e-9 else (z0 - z) / span
            return y0 + (y1 - y0) * clamp(t, 0.0, 1.0)
    return pts[-1][0]


def rim_y(x):
    return profile.rim_half_width(x)


def deck_z(x, y):
    """Height of the closed deck surface (hood / engine cover) at (x, y)."""
    y_edge = profile.rim_half_width(x)
    if y_edge <= 1e-6:
        return profile.belt_z(x)
    u = clamp(abs(y) / y_edge, 0.0, 1.0)
    return profile.belt_z(x) + body.DECK_CROWN * y_edge * (1.0 - u * u)


def deck_normal(x, y):
    d = 2.0
    dzdx = (deck_z(x + d, y) - deck_z(x - d, y)) / (2.0 * d)
    dzdy = (deck_z(x, y + d) - deck_z(x, y - d)) / (2.0 * d)
    return _normalize((-dzdx, -dzdy, 1.0))


def flank_normal(x, z):
    """Outward normal of the +Y flank in the XZ sense, extended to 3D."""
    d = 4.0
    dydx = (flank_y(x + d, z) - flank_y(x - d, z)) / (2.0 * d)
    dydz = (flank_y(x, z + d) - flank_y(x, z - d)) / (2.0 * d)
    return _normalize((-dydx, 1.0, -dydz))


def surface_point(x, z, side=1.0, offset=0.0):
    """Point on the flank at (x, z), pushed out along the normal."""
    y = flank_y(x, z)
    nx, ny, nz = flank_normal(x, z)
    return (x + nx * offset, side * (y + ny * offset), z + nz * offset)


def nose_z():
    x = params.X_HULL_NOSE
    return 0.5 * (profile.rocker_z(x) + profile.belt_z(x))


def tail_z():
    x = params.X_HULL_TAIL
    return 0.5 * (profile.rocker_z(x) + profile.belt_z(x))


def _normalize(v):
    ln = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
    if ln < 1e-12:
        return (0.0, 0.0, 1.0)
    return (v[0] / ln, v[1] / ln, v[2] / ln)
