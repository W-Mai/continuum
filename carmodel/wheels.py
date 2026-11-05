"""Wheel geometry: tyre, rim, spokes, brake disc, caliper.

A wheel is built about its own origin with the axle on Y: +Y is the outboard
face, -Y the inboard face, so one builder serves both sides and the right-hand
wheel is a mirrored copy. Everything is a revolution or a loft of a profile,
which keeps each surface a closed shell with outward normals.
"""

import math

from . import params
from .geom import Mesh, box, revolve

TIRE_SEGS = 64
RIM_SEGS = 56


def revolve_profile(m, prof, mat, segments, mat_fn=None, center=(0.0, 0.0, 0.0)):
    """Revolve a closed (y, r) profile about the Y axis through `center`.

    The facing of the resulting shell depends on which way the (y, r) loop runs,
    which is easy to get wrong per profile. Rather than encode that per caller,
    the shell is always emitted and then flipped if its signed volume came out
    negative, so every call site gets outward normals regardless of loop order.
    """
    if len(prof) < 2:
        return m

    rows = []
    for y, r in prof:
        ring = []
        for k in range(segments):
            a = 2.0 * math.pi * k / segments
            ring.append((r * math.cos(a) + center[0], y + center[1],
                         r * math.sin(a) + center[2]))
        rows.append([m.vert(p) for p in ring])

    created = []
    for i in range(len(prof)):
        a_row = rows[i]
        b_row = rows[(i + 1) % len(rows)]
        for j in range(segments):
            k = (j + 1) % segments
            name = mat_fn(i, j) if mat_fn else mat
            created.append((b_row[j], b_row[k], a_row[k], a_row[j], name))

    # Signed volume is only meaningful relative to the shell's own centre: a
    # small shell far from the origin can read negative from the origin alone.
    used = {i for q in created for i in q[:4]}
    cx = sum(m.verts[i][0] for i in used) / len(used)
    cy = sum(m.verts[i][1] for i in used) / len(used)
    cz = sum(m.verts[i][2] for i in used) / len(used)

    def rel(p):
        return (p[0] - cx, p[1] - cy, p[2] - cz)

    vol = 0.0
    for quad in created:
        a = rel(m.verts[quad[0]])
        b = rel(m.verts[quad[1]])
        c = rel(m.verts[quad[2]])
        vol += geom_vdot(a, geom_vcross(b, c))
    if vol < 0.0:
        created = [(q[0], q[3], q[2], q[1], q[4]) for q in created]

    for q in created:
        m.quad(*q)
    return m


def geom_vdot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def geom_vcross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


# ---------------------------------------------------------------- tyre


def tyre_profile(radius, width):
    """Closed (y, r) cross-section: bead, sidewall bulge, shoulder, crown.

    The crown sits exactly at `radius` so the tyre stands on z = 0 without the
    car sinking into the ground.
    """
    hw = width * 0.5
    r = radius
    return [
        (-hw * 0.62, r * 0.735),
        (-hw * 0.94, r * 0.800),
        (-hw, r * 0.900),
        (-hw * 0.95, r * 0.975),
        (-hw * 0.78, r * 0.996),
        (-hw * 0.40, r * 1.000),
        (0.0, r * 1.000),
        (hw * 0.40, r * 1.000),
        (hw * 0.78, r * 0.996),
        (hw * 0.95, r * 0.975),
        (hw, r * 0.900),
        (hw * 0.94, r * 0.800),
        (hw * 0.62, r * 0.735),
    ]


def build_tyre(radius, width, name="tyre"):
    m = Mesh(name)

    def pick(i, j):
        # shoulder bands read as a slightly glossier sidewall
        if i in (1, 2, 9, 10):
            return "rubber_side"
        return "rubber"

    revolve_profile(m, tyre_profile(radius, width), "rubber", TIRE_SEGS, pick)

    # circumferential tread grooves, sunk just below the crown
    crown = radius
    for frac in (-0.34, 0.0, 0.34):
        y = width * 0.5 * frac
        revolve_profile(m, [
            (y - 9.0, crown - 4.0),
            (y - 4.0, crown - 11.0),
            (y + 4.0, crown - 11.0),
            (y + 9.0, crown - 4.0),
        ], "black_trim", TIRE_SEGS)
    return m


# ---------------------------------------------------------------- rim


def build_rim(radius, width, name="rim"):
    """Deep-dish rim: barrel, outboard lip, dished face."""
    m = Mesh(name)
    hw = width * 0.5
    r = radius

    barrel = [
        (-hw * 0.98, r * 0.735),      # inboard bead
        (-hw * 0.92, r * 0.660),
        (-hw * 0.45, r * 0.648),
        (hw * 0.10, r * 0.658),
        (hw * 0.55, r * 0.700),
        (hw * 0.82, r * 0.800),
        (hw * 0.92, r * 0.900),
        (hw * 0.96, r * 0.962),       # outboard lip, proud of the tyre bead
        (hw * 0.84, r * 0.958),
        (hw * 0.78, r * 0.900),       # lip inner wall
        (hw * 0.34, r * 0.858),       # dished face
        (hw * 0.02, r * 0.845),
        (-hw * 0.36, r * 0.800),
        (-hw * 0.88, r * 0.760),
        (-hw * 0.98, r * 0.720),
    ]
    revolve_profile(m, barrel, "alu", RIM_SEGS)

    # dark inner barrel so the wheel does not read as hollow from behind
    revolve_profile(m, [
        (-hw * 0.96, r * 0.670),
        (-hw * 0.50, r * 0.628),
        (hw * 0.10, r * 0.620),
        (hw * 0.36, r * 0.655),
    ], "gunmetal", RIM_SEGS)
    return m


# ---------------------------------------------------------------- spokes


def build_spokes(rim_radius, width, count=10, name="spokes"):
    """Tapered spokes sweeping from a recessed hub out to the rim lip.

    Each spoke is a closed four-sided prism: the cross-section is a rectangle
    in the (tangential, axial) plane, and it is lofted along the radial path
    with a cap at each end, so the shell is watertight.
    """
    m = Mesh(name)
    hub_r = rim_radius * 0.20
    face_y = width * 0.36
    root_y = width * 0.04
    steps = 4

    for i in range(count):
        a = 2.0 * math.pi * i / count
        cx, sx = math.cos(a), math.sin(a)
        tx, tz = -sx, cx              # tangential unit vector

        # rings of 4 points: [+w outboard, -w outboard, -w inboard, +w inboard]
        rings = []
        for k in range(steps + 1):
            t = k / float(steps)
            rr = hub_r + (rim_radius * 0.955 - hub_r) * t
            half_w = rim_radius * (0.034 + 0.030 * t)
            th = rim_radius * (0.030 + 0.024 * t)
            y = root_y + (face_y - root_y) * (t ** 1.35)
            px, pz = rr * cx, rr * sx
            ring = [
                (px + tx * half_w, y - th * 0.5, pz + tz * half_w),
                (px - tx * half_w, y - th * 0.5, pz - tz * half_w),
                (px - tx * half_w, y + th * 0.5, pz - tz * half_w),
                (px + tx * half_w, y + th * 0.5, pz + tz * half_w),
            ]
            rings.append([m.vert(p) for p in ring])

        for k in range(steps):
            a0, a1 = rings[k], rings[k + 1]
            for j in range(4):
                jn = (j + 1) % 4
                m.quad(a0[j], a0[jn], a1[jn], a1[j], "gunmetal")
        # end caps, wound opposite to the side walls so both face outward
        m.quad(rings[0][3], rings[0][2], rings[0][1], rings[0][0], "gunmetal")
        m.quad(rings[-1][0], rings[-1][1], rings[-1][2], rings[-1][3], "gunmetal")
    return m


# ---------------------------------------------------------------- brakes


def build_brake(rim_radius, width, name="brake"):
    """Vented disc, hub and a caliper straddling the disc edge."""
    m = Mesh(name)
    disc_r = rim_radius * 0.80
    disc_y = -width * 0.06
    half = 8.0

    revolve_profile(m, [
        (disc_y - half * 2.4, disc_r * 0.50),
        (disc_y - half * 2.4, disc_r),
        (disc_y - half * 0.3, disc_r),
        (disc_y - half * 0.3, disc_r * 0.50),
    ], "brake_disc", 44)
    revolve_profile(m, [
        (disc_y + half * 0.3, disc_r * 0.50),
        (disc_y + half * 0.3, disc_r),
        (disc_y + half * 2.4, disc_r),
        (disc_y + half * 2.4, disc_r * 0.50),
    ], "brake_disc", 44)

    revolve_profile(m, [
        (disc_y - half * 3.0, rim_radius * 0.235),
        (disc_y + half * 3.0, rim_radius * 0.235),
    ], "alu", 24)

    ang = math.radians(132.0)
    cx, cz = math.cos(ang) * disc_r * 0.92, math.sin(ang) * disc_r * 0.92
    box(m, (cx, disc_y, cz),
        (rim_radius * 0.34, half * 6.2, rim_radius * 0.22), "caliper")
    return m


def build_hub(rim_radius, width, name="hub"):
    """Centre cap plus five lug nuts on the outboard face."""
    m = Mesh(name)
    y = width * 0.40
    cap_r = rim_radius * 0.135

    revolve_profile(m, [
        (y - 16.0, cap_r),
        (y + 4.0, cap_r * 0.95),
        (y + 13.0, cap_r * 0.58),
        (y + 13.0, 0.0),
    ], "chrome", 24)

    for i in range(5):
        a = 2.0 * math.pi * i / 5.0 + math.pi * 0.10
        cx, cz = math.cos(a) * cap_r * 1.62, math.sin(a) * cap_r * 1.62
        revolve_profile(m, [(y, 12.0), (y + 8.0, 10.0), (y + 8.0, 0.0)],
                        "chrome", 8, center=(cx, 0.0, cz))
    return m


# ---------------------------------------------------------------- assembly


def build_wheel(tire_r, rim_r, width, spokes=10, name="wheel"):
    """One wheel: axle on Y, +Y outboard, origin at the hub centre."""
    m = Mesh(name)
    m.add(build_tyre(tire_r, width))
    m.add(build_rim(rim_r, width))
    m.add(build_spokes(rim_r, width, spokes))
    m.add(build_brake(rim_r, width))
    m.add(build_hub(rim_r, width))
    return m


def component_faces(mesh):
    """Connected components of a mesh, as lists of face indices."""
    parent = list(range(len(mesh.verts)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for f in mesh.faces:
        for i in f[1:]:
            ra, rb = find(f[0]), find(i)
            if ra != rb:
                parent[rb] = ra

    groups = {}
    for fi, f in enumerate(mesh.faces):
        groups.setdefault(find(f[0]), []).append(fi)
    return list(groups.values())


def shell_volume(mesh, faces):
    """Signed volume about the shell's own centre."""
    used = {i for fi in faces for i in mesh.faces[fi]}
    n = float(len(used))
    cx = sum(mesh.verts[i][0] for i in used) / n
    cy = sum(mesh.verts[i][1] for i in used) / n
    cz = sum(mesh.verts[i][2] for i in used) / n
    total = 0.0
    for fi in faces:
        f = mesh.faces[fi]
        a = [mesh.verts[f[0]][k] - (cx, cy, cz)[k] for k in range(3)]
        for j in range(1, len(f) - 1):
            b = [mesh.verts[f[j]][k] - (cx, cy, cz)[k] for k in range(3)]
            c = [mesh.verts[f[j + 1]][k] - (cx, cy, cz)[k] for k in range(3)]
            total += (a[0] * (b[1] * c[2] - b[2] * c[1])
                      - a[1] * (b[0] * c[2] - b[2] * c[0])
                      + a[2] * (b[0] * c[1] - b[1] * c[0]))
    return total / 6.0


def build_wheel_set():
    """Four wheels on their axles, outboard faces pointing outboard."""
    out = {}
    for entry in params.arch_list():
        front = entry["axle"] > 0
        base = build_wheel(params.WHEEL_R, params.RIM_R, entry["tire_w"],
                           name="wheel_f" if front else "wheel_r")
        x = entry["axle"]
        y_track = entry["track_half"]
        z = params.WHEEL_R

        left = Mesh(base.name + "_l")
        left.add(base, lambda p, x=x, y=y_track, z=z: (p[0] + x, p[1] + y, p[2] + z))
        out["fl" if front else "rl"] = left

        right = Mesh(base.name + "_r")
        right.add(base, lambda p, x=x, y=y_track, z=z: (p[0] + x, -(p[1] + y), p[2] + z))
        # A reflection inverts every shell, but the wheel is many separate
        # shells; flipping each one keeps them independently correct instead of
        # relying on a single global flip.
        for faces in component_faces(right):
            if shell_volume(right, faces) < 0.0:
                for fi in faces:
                    right.faces[fi] = tuple(reversed(right.faces[fi]))
        out["fr" if front else "rr"] = right
    return out
