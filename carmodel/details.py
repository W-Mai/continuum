"""Detail parts: lights, grille, intakes, mirrors, skirts, wing, exhaust, cabin.

Parts that live on the body are built as *patches on the skin*: the inboard
surface samples the body so the part never floats or clips, and the outer
surface is that patch pushed out along the local normal. Flat prisms are used
only where the body is genuinely flat (the wing, the diffuser).
"""

import math

from . import params, profile, surface
from .geom import (Mesh, box, ellipsoid, extrude_polygon, plate,
                   polyline_tube, rounded_rect, revolve, vcross, vnorm, vsub)

# ============================================================ skin patches


def skin_patch(name, xs, zs, side, offset, thickness, mat, mat_edge=None):
    """A closed slab lying on the flank, `thickness` proud of the skin.

    The slab is always built on the +Y side, where the winding is unambiguous,
    and then reflected for the other side. Building on both sides separately
    meant every rim strip needed its own orientation rule, which is where
    inside-out shells came from.
    """
    m = Mesh(name)
    mat_edge = mat_edge or mat
    nx_count, nz_count = len(xs), len(zs)

    inner, outer = [], []
    for x in xs:
        ri, ro = [], []
        for z in zs:
            y = surface.flank_y(x, z)
            nx, ny, nz = surface.flank_normal(x, z)
            d = offset + thickness
            ri.append(m.vert((x, y, z)))
            ro.append(m.vert((x + nx * d, y + ny * d, z + nz * d)))
        inner.append(ri)
        outer.append(ro)

    for i in range(nx_count - 1):
        for j in range(nz_count - 1):
            m.quad(outer[i][j], outer[i][j + 1],
                   outer[i + 1][j + 1], outer[i + 1][j], mat)
            m.quad(inner[i][j], inner[i + 1][j],
                   inner[i + 1][j + 1], inner[i][j + 1], mat_edge)

    # Rim strips. Walking each rim in the direction opposite to how the outer
    # and inner faces already traverse it is what makes the edges pair up.
    for i in range(nx_count - 1):
        # j = 0 rim: outer face runs outer[i][0] -> outer[i+1][0]
        m.quad(outer[i][0], outer[i + 1][0], inner[i + 1][0], inner[i][0], mat_edge)
        # j = last rim
        m.quad(outer[i + 1][-1], outer[i][-1], inner[i][-1], inner[i + 1][-1],
               mat_edge)
    for j in range(nz_count - 1):
        # i = 0 rim: outer face runs outer[0][j] -> outer[0][j+1]
        m.quad(outer[0][j + 1], outer[0][j], inner[0][j], inner[0][j + 1],
               mat_edge)
        # i = last rim
        m.quad(outer[-1][j], outer[-1][j + 1], inner[-1][j + 1], inner[-1][j],
               mat_edge)

    m.prune()
    # Orient by signed volume about the shell's own centre, so the test does not
    # depend on where the patch sits relative to the world origin.
    for faces in _shells(m):
        if _shell_volume(m, faces) < 0.0:
            for fi in faces:
                m.faces[fi] = tuple(reversed(m.faces[fi]))

    if side > 0:
        return m
    # reflecting across XZ inverts every face, so flip each shell back out
    mirrored = m.mirrored_y(name)
    for faces in _shells(mirrored):
        if _shell_volume(mirrored, faces) < 0.0:
            for fi in faces:
                mirrored.faces[fi] = tuple(reversed(mirrored.faces[fi]))
    return mirrored


def _shells(mesh):
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


def _shell_volume(mesh, faces):
    used = {i for fi in faces for i in mesh.faces[fi]}
    n = float(len(used))
    c = (sum(mesh.verts[i][0] for i in used) / n,
         sum(mesh.verts[i][1] for i in used) / n,
         sum(mesh.verts[i][2] for i in used) / n)
    total = 0.0
    for fi in faces:
        f = mesh.faces[fi]
        a = [mesh.verts[f[0]][k] - c[k] for k in range(3)]
        for j in range(1, len(f) - 1):
            b = [mesh.verts[f[j]][k] - c[k] for k in range(3)]
            d = [mesh.verts[f[j + 1]][k] - c[k] for k in range(3)]
            total += (a[0] * (b[1] * d[2] - b[2] * d[1])
                      - a[1] * (b[0] * d[2] - b[2] * d[0])
                      + a[2] * (b[0] * d[1] - b[1] * d[0]))
    return total / 6.0


def face_patch(name, poly_yz, x, out_dir, offset, thickness, mat):
    """A panel on a cross-section plane at station x, facing +-X."""
    m = Mesh(name)
    front = x + out_dir * offset
    back = front + out_dir * thickness
    fi = [m.vert((front, y, z)) for (y, z) in poly_yz]
    bi = [m.vert((back, y, z)) for (y, z) in poly_yz]
    n = len(poly_yz)
    for i in range(n):
        k = (i + 1) % n
        if (out_dir > 0) == (poly_area(poly_yz) >= 0.0):
            m.quad(fi[i], fi[k], bi[k], bi[i], mat)
        else:
            m.quad(fi[k], fi[i], bi[i], bi[k], mat)
    if out_dir > 0:
        m.face(tuple(fi), mat)
        m.face(tuple(reversed(bi)), mat)
    else:
        m.face(tuple(reversed(fi)), mat)
        m.face(tuple(bi), mat)
    return m


def poly_area(poly):
    a = 0.0
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        a += x0 * y1 - x1 * y0
    return 0.5 * a


def wrap_polygon(poly):
    return poly if poly_area(poly) >= 0.0 else list(reversed(poly))


# ============================================================ front end


def build_front_end():
    m = Mesh("front_end")
    x_n = params.X_HULL_NOSE

    # splitter blade under the nose
    z_s = profile.rocker_z(x_n) + 26.0
    hw = profile.half_width(x_n - 40.0) * 0.97
    rows = []
    for x, dz in ((x_n - 210.0, 0.0), (x_n + 34.0, -8.0)):
        rows.append([m.vert((x, hw * u, z_s + dz)) for u in
                     (-1.0, -0.6, 0.0, 0.6, 1.0)])
    for j in range(4):
        m.quad(rows[0][j], rows[1][j], rows[1][j + 1], rows[0][j + 1], "carbon")

    # grille aperture: bulged trapezoid on the nose face
    z0 = profile.rocker_z(x_n) + 66.0
    z1 = profile.belt_z(x_n) - 138.0
    steps = 8
    right = []
    for k in range(steps + 1):
        z = z0 + (z1 - z0) * k / float(steps)
        w = surface.flank_y(x_n - 8.0, z) * 0.66
        right.append((w, z))
    poly = right + [(-y, z) for (y, z) in reversed(right)]
    m.add(face_patch("grille", wrap_polygon(poly), x_n - 10.0, 1.0, 0.0, 26.0,
                     "black_trim"))

    # slats inside the aperture
    for k in range(1, 6):
        z = z0 + (z1 - z0) * k / 6.0
        w = surface.flank_y(x_n - 8.0, z) * 0.60
        box(m, (x_n - 2.0, 0.0, z), (14.0, 2.0 * w, 10.0), "carbon")

    # lower intakes flanking the grille
    for side in (1.0, -1.0):
        poly = [(150.0, 0.0), (330.0, 0.0), (300.0, 120.0), (170.0, 108.0)]
        poly = [(side * y, z0 + 20.0 + z) for (y, z) in poly]
        m.add(face_patch("intake", wrap_polygon(poly), x_n - 12.0, 1.0, 0.0,
                         20.0, "black_trim"))
    return m


def build_headlights():
    out = Mesh("headlights")
    xs = [1975.0, 2035.0, 2095.0, 2148.0, 2192.0]
    for side in (1.0, -1.0):
        out.add(skin_patch("lamp", xs, [706.0, 730.0, 754.0, 776.0], side,
                           0.0, 15.0, "head_light", "black_trim"))
        out.add(skin_patch("drl", xs[:-1], [688.0, 697.0], side, 0.0, 8.0,
                           "head_light", "black_trim"))
    return out


# ============================================================ rear end


def build_rear_end():
    m = Mesh("rear_end")
    x_t = params.X_HULL_TAIL

    # Full-width light bar, sitting just under the tail's upper edge.
    z_c = profile.belt_z(x_t) - 78.0
    steps = 14
    top, bot = [], []
    for k in range(steps + 1):
        u = -1.0 + 2.0 * k / float(steps)
        w = surface.flank_y(x_t + 8.0, z_c) * 0.93
        lift = 14.0 * (1.0 - u * u)
        top.append((w * u, z_c + 30.0 + lift))
        bot.append((w * u, z_c - 30.0 + lift))
    poly = top + list(reversed(bot))
    m.add(face_patch("tailbar", wrap_polygon(poly), x_t - 14.0, -1.0, 0.0, 26.0,
                     "tail_light"))

    # darker reflector band below the light bar
    w_l = surface.flank_y(x_t + 8.0, z_c) * 0.90
    box(m, (x_t + 6.0, 0.0, z_c - 92.0), (16.0, 2.0 * w_l, 22.0),
        "tail_light_off")

    # recessed panel between the lights and the diffuser
    w_p = surface.flank_y(x_t + 8.0, z_c) * 0.80
    box(m, (x_t + 10.0, 0.0, z_c - 190.0), (14.0, 2.0 * w_p, 190.0),
        "black_trim")

    # Diffuser: a flat undertray panel rising toward the tail, sized off the
    # body's actual half width so it cannot poke through the flanks.
    z_d = profile.rocker_z(x_t) + 30.0
    hw_d = surface.flank_y(x_t + 40.0, z_d + 70.0) * 0.80
    rows = []
    for i, x in enumerate((x_t + 6.0, x_t + 210.0)):
        z = z_d + (0.0 if i == 0 else 26.0)
        rows.append([m.vert((x, hw_d * u, z)) for u in
                     (-1.0, -0.62, 0.0, 0.62, 1.0)])
    for j in range(4):
        m.quad(rows[0][j], rows[1][j], rows[1][j + 1], rows[0][j + 1], "carbon")

    # Fins standing on that panel, tucked inside its outline.
    for u in (-0.60, -0.30, 0.0, 0.30, 0.60):
        box(m, (x_t + 108.0, hw_d * u, z_d + 52.0), (176.0, 12.0, 52.0),
            "carbon")

    # quad exhaust tips through the diffuser
    # Tips sit flush with the tail panel: the sweep starts inside the body and
    # ends just proud of it, so they read as outlets rather than pipes glued on.
    for u in (-0.32, -0.12, 0.12, 0.32):
        cy = hw_d * u
        cz = profile.rocker_z(x_t) + 108.0
        outer = [(cy + 44.0 * math.cos(2 * math.pi * k / 18),
                  cz + 44.0 * math.sin(2 * math.pi * k / 18)) for k in range(18)]
        extrude_polygon(m, wrap_polygon(outer), (x_t - 14.0, 0.0, 0.0), "x",
                        18.0, "chrome")
        inner = [(cy + 35.0 * math.cos(2 * math.pi * k / 18),
                  cz + 35.0 * math.sin(2 * math.pi * k / 18)) for k in range(18)]
        extrude_polygon(m, wrap_polygon(inner), (x_t - 10.0, 0.0, 0.0), "x",
                        14.0, "black_trim")
    return m


def build_wing():
    """Fixed rear wing on two pylons."""
    m = Mesh("wing")
    x_w = params.X_HULL_TAIL + 150.0
    # Sit the wing above the engine cover, not above the tail's beltline: the
    # deck at the tail is far lower than the cover the pylons stand on.
    z_w = surface.deck_z(x_w, 0.0) + 118.0
    hw = 690.0

    chord = [(-1.0, 0.0), (-0.55, 15.0), (0.0, 21.0), (0.5, 11.0), (1.0, -5.0)]
    left_t, left_b, right_t, right_b = [], [], [], []
    for u, dz in chord:
        x = x_w + u * 148.0
        left_t.append(m.vert((x, -hw, z_w + dz + 5.0)))
        left_b.append(m.vert((x, -hw, z_w + dz - 5.0)))
        right_t.append(m.vert((x, hw, z_w + dz + 5.0)))
        right_b.append(m.vert((x, hw, z_w + dz - 5.0)))

    for i in range(len(chord) - 1):
        m.quad(right_t[i], right_t[i + 1], left_t[i + 1], left_t[i], "carbon")
        m.quad(left_b[i], left_b[i + 1], right_b[i + 1], right_b[i], "carbon")
        # leading/trailing edges
    for i in range(len(chord) - 1):
        m.quad(left_t[i], left_t[i + 1], left_b[i + 1], left_b[i], "carbon")
        m.quad(right_b[i], right_b[i + 1], right_t[i + 1], right_t[i], "carbon")

    for side in (1.0, -1.0):
        poly = [(-158.0, -32.0), (158.0, -20.0), (158.0, 28.0), (-158.0, 20.0)]
        plate(m, poly, "xz", side * hw, 13.0, "carbon", center=(x_w, z_w))

    for side in (1.0, -1.0):
        y = side * 360.0
        z_top = z_w - 14.0
        z_bot = surface.deck_z(x_w - 40.0, y) - 20.0
        box(m, (x_w - 6.0, y, 0.5 * (z_top + z_bot)),
            (88.0, 28.0, abs(z_top - z_bot)), "carbon")
    return m


# ============================================================ sides


def build_side_details():
    m = Mesh("side_details")

    for side in (1.0, -1.0):
        # rocker skirt between the arches
        xs = [-880.0 + 40.0 * k for k in range(19)]
        m.add(skin_patch("skirt", xs, [184.0, 212.0, 240.0], side, 0.0, 15.0,
                         "carbon", "carbon"))

        # mid-engine side intake ahead of the rear arch
        m.add(skin_patch("intake", [-720.0, -790.0, -858.0, -924.0],
                         [622.0, 690.0, 758.0, 824.0, 884.0], side, 0.0, 7.0,
                         "black_trim", "carbon"))
        m.add(skin_patch("intake_lip", [-698.0, -726.0], [600.0, 900.0], side,
                         0.0, 24.0, "carbon", "carbon"))

        # vent behind the front wheel
        m.add(skin_patch("arch_vent", [886.0, 838.0, 790.0],
                         [420.0, 468.0, 516.0], side, 0.0, 9.0, "black_trim",
                         "carbon"))

    # door mirrors
    for side in (1.0, -1.0):
        x = 560.0
        z = profile.belt_z(x) + 26.0
        y = surface.flank_y(x, z) - 6.0
        box(m, (x, side * (y + 48.0), z), (32.0, 92.0, 24.0), "carbon")
        ellipsoid(m, (x - 12.0, side * (y + 112.0), z + 10.0),
                  (84.0, 32.0, 44.0), "paint", seg_u=12, seg_v=6)

    # fuel filler on the left rear quarter
    x_f, z_f = -1620.0, 812.0
    y_f = surface.flank_y(x_f, z_f)
    disc = [(80.0 * math.cos(2 * math.pi * k / 16),
             80.0 * math.sin(2 * math.pi * k / 16)) for k in range(16)]
    plate(m, disc, "xz", y_f + 3.0, 7.0, "chrome", center=(x_f, z_f))
    return m


# ============================================================ interior


def build_interior():
    m = Mesh("interior")
    zf = params.FLOOR_Z

    for y in (-330.0, 330.0):
        box(m, (-250.0, y, zf + 66.0), (520.0, 430.0, 108.0), "leather")
        m.add(_tilted_box((-40.0, y, zf + 108.0), (90.0, 424.0), 200.0, 16.0,
                          "alcantara"))
        box(m, (-96.0, y, zf + 316.0), (146.0, 250.0, 118.0), "alcantara")
        for sy in (-1.0, 1.0):
            box(m, (-250.0, y + sy * 202.0, zf + 108.0),
                (486.0, 58.0, 94.0), "leather")

    box(m, (-360.0, 0.0, zf + 58.0), (780.0, 216.0, 116.0), "carbon")
    box(m, (470.0, 0.0, zf + 296.0), (208.0, 1330.0, 148.0), "leather")
    box(m, (432.0, 0.0, zf + 404.0), (118.0, 690.0, 88.0), "alcantara")

    # steering wheel: a torus about X, raked back, on the left
    wheel = Mesh("wheel")
    seg = 20
    profile_pts = [(9.0 * math.cos(2 * math.pi * k / seg),
                    176.0 + 9.0 * math.sin(2 * math.pi * k / seg))
                   for k in range(seg)]
    revolve(wheel, profile_pts, "leather", segments=28, axis="x",
            closed_profile=True)
    ang = math.radians(24.0)
    ca, sa = math.cos(ang), math.sin(ang)
    wheel.transform(lambda p: (250.0 + p[0] * ca - p[2] * sa,
                               -330.0 + p[1],
                               zf + 334.0 + p[0] * sa + p[2] * ca))
    m.add(wheel)
    box(m, (250.0, -330.0, zf + 352.0), (56.0, 56.0, 56.0), "carbon")
    return m


def _tilted_box(center, footprint, height, rake, mat):
    """A box tilted about Y so a seat back leans back."""
    m = Mesh("slab")
    box(m, (0.0, 0.0, height * 0.5), (footprint[0], footprint[1], height), mat)
    ang = math.radians(rake)
    ca, sa = math.cos(ang), math.sin(ang)
    m.transform(lambda p: (p[0] * ca - p[2] * sa,
                           p[1],
                           p[0] * sa + p[2] * ca))
    m.transform(lambda p: (p[0] + center[0], p[1] + center[1], p[2] + center[2]))
    return m


# ============================================================ assembly


def build_details():
    return {
        "front_end": build_front_end(),
        "headlights": build_headlights(),
        "rear_end": build_rear_end(),
        "wing": build_wing(),
        "sides": build_side_details(),
        "interior": build_interior(),
    }
