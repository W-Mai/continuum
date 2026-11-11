"""Body shell geometry.

Split the way a real body-in-white is split:

    hull      lofted lower body. Every cross-section runs from one deck rim,
              out over the shoulder, down the flank, into the wheel-arch
              mouth, along the well wall and across the floor to the other
              rim. Because the section is open at the top, the cabin is open
              there without any boolean cut, and the bottom of the arch
              stations forms a genuine wheel well.
    deck      hood and engine cover, closing the top wherever the cabin is not
              open. Its rim edge coincides with the hull rim, so the seam is
              watertight.
    canopy    greenhouse swept along x, with real thickness: outer skin,
              inner headliner and a rim edge that reads as the window frame.
              The windscreen and backlight fall out of the same sweep, because
              the section height drops to zero at their bases.
    cockpit   floor pan, inner walls and bulkheads.
"""

import math

from . import params, profile
from .geom import Mesh, smoothstep, vcross, vdot, vnorm, vsub

# cross-section sampling (per half section) -------------------------
SHOULDER_SPANS = 2
FLANK_UPPER_SPANS = 2
FLANK_LOWER_SPANS = 3
ARCH_SPANS = 2
WELL_SPANS = 1
FLOOR_SPANS = 3

CANOPY_ARC = 15
CANOPY_THICK = 26.0
CANOPY_TUCK = 40.0        # headliner hangs this far below the rim
CANOPY_EXP = 0.62         # arch exponent: < 1 flattens the roof
CANOPY_SHOULDER = 0.55    # lateral exponent: < 1 gives a tall window band

DECK_COLS = 10
DECK_CROWN = 0.030


# ==================================================== lower hull


def section_meta(x):
    """Scalars the cross-section at station x is built from."""
    hw = profile.half_width(x)
    z_rim = profile.belt_z(x)
    z_rocker = profile.rocker_z(x)
    z_arch = profile.arch_z(x)

    arch = profile.arch_entry(x)
    if arch is None:
        y_well = 0.60 * hw
    else:
        # blend the well wall out to the floor width at the arch ends so the
        # station-to-station loft stays continuous
        inside = 1.0 - abs(x - arch["axle"]) / arch["rx"]
        w = smoothstep(min(1.0, inside * 2.6))
        y_well = (0.60 * hw) * (1.0 - w) + arch["well_inner"] * w

    # Keep the arch mouth inboard of the widest point so the flank above it
    # forms a visible fender lip instead of vanishing to a knife edge.
    y_arch = max(y_well + 24.0, hw - 0.075 * hw)

    z_widest = z_rocker + 0.44 * (z_rim - z_rocker)
    if z_arch > z_widest:
        z_widest = z_arch + 0.34 * (z_rim - z_arch)

    return dict(x=x, hw=hw, rim=profile.rim_half_width(x), z_rim=z_rim,
                z_rocker=z_rocker, z_arch=z_arch, y_well=y_well,
                y_arch=y_arch, z_widest=z_widest)


def half_section(m):
    """Right-hand points: deck rim -> shoulder -> flank -> arch -> floor."""
    pts = [(m["rim"], m["z_rim"])]

    # shoulder: rim out to the widest line at belt height
    y_top = m["hw"] - 0.012 * m["hw"]
    for i in range(1, SHOULDER_SPANS + 1):
        t = i / float(SHOULDER_SPANS)
        y = m["rim"] + (y_top - m["rim"]) * (t ** 0.85)
        z = m["z_rim"] - 3.0 * math.sin(math.pi * t)      # slight tumblehome lip
        pts.append((y, z))

    # upper flank: belt -> widest point
    for i in range(1, FLANK_UPPER_SPANS + 1):
        t = i / float(FLANK_UPPER_SPANS)
        y = y_top + (m["hw"] - y_top) * math.sin(t * math.pi * 0.5)
        z = m["z_rim"] + (m["z_widest"] - m["z_rim"]) * smoothstep(t)
        pts.append((y, z))

    # lower flank: widest point -> arch mouth
    for i in range(1, FLANK_LOWER_SPANS + 1):
        t = i / float(FLANK_LOWER_SPANS)
        y = m["hw"] + (m["y_arch"] - m["hw"]) * t
        z = m["z_widest"] + (m["z_arch"] - m["z_widest"]) * smoothstep(t)
        pts.append((y, z))

    # arch ceiling: outboard to inboard
    for i in range(1, ARCH_SPANS + 1):
        t = i / float(ARCH_SPANS)
        y = m["y_arch"] + (m["y_well"] - m["y_arch"]) * t
        z = m["z_arch"] + 9.0 * math.sin(math.pi * t)
        pts.append((y, z))

    # well wall down to the underbody
    for i in range(1, WELL_SPANS + 1):
        t = i / float(WELL_SPANS)
        pts.append((m["y_well"], m["z_arch"] + (m["z_rocker"] - m["z_arch"]) * t))

    # floor, inboard to centre
    for i in range(1, FLOOR_SPANS + 1):
        t = i / float(FLOOR_SPANS)
        pts.append((m["y_well"] * (1.0 - t), m["z_rocker"]))

    return pts


def full_section(m):
    """Open loop: right rim -> underbody centre -> left rim."""
    right = half_section(m)
    left = [(-y, z) for (y, z) in reversed(right[:-1])]
    return right + left


def hull_material(j, n):
    """Paint outside the arch mouth; dark liner and undertray from it inward.

    With the car afloat the wells stand empty and the floor is in view, and a
    painted underside reads as an unfinished model. Quad j joins section points
    j and j + 1; the left half mirrors the right.
    """
    right = j if j <= (n - 2) // 2 else (n - 2) - j
    mouth = SHOULDER_SPANS + FLANK_UPPER_SPANS + FLANK_LOWER_SPANS
    return "black_trim" if right >= mouth else "paint"


def build_hull(name="hull"):
    xs = profile.stations()
    sections = [full_section(section_meta(x)) for x in xs]
    widths = {len(s) for s in sections}
    if len(widths) != 1:
        raise ValueError("inconsistent section length: %s" % sorted(widths))

    m = Mesh(name)
    rows = [[m.vert((x, y, z)) for (y, z) in sec]
            for x, sec in zip(xs, sections)]
    n = len(rows[0])

    for i in range(len(rows) - 1):
        a, b = rows[i], rows[i + 1]
        for j in range(n - 1):
            m.quad(b[j], b[j + 1], a[j + 1], a[j], hull_material(j, n))

    # close both ends with a fan around the section centroid
    for row, x, flip in ((rows[0], xs[0], False), (rows[-1], xs[-1], True)):
        pts = [m.verts[i] for i in row]
        cy = sum(p[1] for p in pts) / len(pts)
        cz = sum(p[2] for p in pts) / len(pts)
        c = m.vert((x, cy, cz))
        for j in range(len(row) - 1):
            if flip:
                m.tri(c, row[j + 1], row[j], "paint")
            else:
                m.tri(c, row[j], row[j + 1], "paint")
    return m


# ==================================================== deck panels


def _deck_block(name, xs):
    m = Mesh(name)
    if len(xs) < 2:
        return m
    rows = []
    for x in xs:
        y_edge = profile.rim_half_width(x)
        z0 = profile.belt_z(x)
        crown = DECK_CROWN * y_edge
        row = []
        for k in range(DECK_COLS + 1):
            u = 2.0 * k / float(DECK_COLS) - 1.0
            row.append(m.vert((x, y_edge * u, z0 + crown * (1.0 - u * u))))
        rows.append(row)
    for i in range(len(rows) - 1):
        for j in range(DECK_COLS):
            m.quad(rows[i][j], rows[i + 1][j], rows[i + 1][j + 1],
                   rows[i][j + 1], "paint")
    return m


def build_deck(name="deck"):
    """Hood plus engine cover, as two quads grids meeting the cabin rim."""
    xs = profile.stations()
    rear = [x for x in xs if x <= profile.CABIN_X0]
    front = [x for x in xs if x >= profile.CABIN_X1]
    m = _deck_block(name + "_rear", rear)
    m.add(_deck_block(name + "_front", front))
    return m


# ==================================================== greenhouse


def canopy_ring(x):
    """Closed cross-section: outer skin, rim edge, headliner, rim edge."""
    y_half = profile.rim_half_width(x)
    z0 = profile.belt_z(x)
    h = profile.roof_height(x)

    y_in = max(y_half - CANOPY_THICK, 0.55 * y_half)
    h_in = max(h - CANOPY_THICK, 0.35 * h) if h > 1e-6 else 0.0
    z_in = z0 - CANOPY_TUCK

    def arc(yh, hh, zb):
        pts = []
        for k in range(CANOPY_ARC):
            phi = -math.pi * 0.5 + math.pi * k / (CANOPY_ARC - 1.0)
            # Superelliptic arc: raising |sin| to a power below 1 pushes the
            # lateral growth into the lower part of the section, which yields a
            # tall side-window band under a rounded roof.
            sy = math.sin(phi)
            lateral = (abs(sy) ** CANOPY_SHOULDER) * (1.0 if sy >= 0 else -1.0)
            pts.append((yh * lateral, zb + hh * (abs(math.cos(phi)) ** CANOPY_EXP)))
        return pts

    outer = arc(y_half, h, z0)
    inner = arc(y_in, h_in, z_in)
    ring = outer + list(reversed(inner))
    return ring, dict(y_half=y_half, z0=z0, h=h)


def canopy_material(slot, meta, cen, nrm, x):
    """Classify greenhouse quads by where they sit on the section.

    The section is a closed loop of 2*CANOPY_ARC points: slots 0..CANOPY_ARC-1
    run from the left rim over the roof to the right rim, the rest come back as
    the headliner. Position on that loop, not the surface normal, decides what a
    quad is: the headliner faces up just like the roof does, so a normal test
    paints glass onto the ceiling.
    """
    top = CANOPY_ARC // 2               # index of the roof centre point
    mid = CANOPY_ARC - 1

    if slot == mid or slot == 2 * mid:
        return "black_trim"             # the two rim edges of the section
    if slot > mid:
        return "alcantara"              # headliner

    # distance from the roof centre, in slots, along the outer skin
    off = abs(slot - top)

    if x > params.X_ROOF_F:             # windscreen: pillars at the extremes
        return "paint" if off >= top - 1 else "glass"
    if x < params.X_ROOF_R:             # backlight: wider C-pillar
        return "paint" if off >= top - 2 else "glass"

    # roof section: the two upright bands either side of the roof are the side
    # windows; the roof panel between them and the rail below stay painted
    # Slots 4..6 from the roof centre are the upright part of the section: the
    # lateral face between the beltline and the roof rail.
    if 4 <= off <= 6:
        return "glass"                  # side window band
    return "paint"


def len_range_last(meta):
    return 2 * CANOPY_ARC - 1


def build_canopy(name="canopy"):
    xs = [x for x in profile.stations() if profile.in_cabin(x)]
    if len(xs) < 3:
        return Mesh(name)

    m = Mesh(name)
    rings = []
    metas = []
    for x in xs:
        ring, meta = canopy_ring(x)
        rings.append([m.vert((x, y, z)) for (y, z) in ring])
        metas.append(meta)

    n = len(rings[0])
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        xm = 0.5 * (xs[i] + xs[i + 1])
        meta = metas[i]
        for j in range(n):
            k = (j + 1) % n
            before = len(m.faces)
            m.quad(b[j], b[k], a[k], a[j], "paint")
            if len(m.faces) == before:
                continue
            # Classify from the normal of the face as it was actually wound,
            # so material rules and shading can never disagree.
            fi = len(m.faces) - 1
            m.fmat[fi] = canopy_material(j, meta, m.face_centroid(fi),
                                         m.face_normal(fi), xm)

    for row, x, flip in ((rings[0], xs[0], False), (rings[-1], xs[-1], True)):
        pts = [m.verts[i] for i in row]
        cy = sum(p[1] for p in pts) / len(pts)
        cz = sum(p[2] for p in pts) / len(pts)
        c = m.vert((x, cy, cz))
        for j in range(len(row)):
            k = (j + 1) % len(row)
            if flip:
                m.tri(c, row[k], row[j], "black_trim")
            else:
                m.tri(c, row[j], row[k], "black_trim")
    return m


# ==================================================== cockpit


def build_cockpit(name="cockpit"):
    xs = [x for x in profile.stations() if profile.in_cabin(x)]
    if len(xs) < 2:
        return Mesh(name)

    m = Mesh(name)
    zf = params.FLOOR_Z

    floor = []
    for x in xs:
        y_in = profile.rim_half_width(x) - 8.0
        floor.append([m.vert((x, y_in * (2.0 * k / 8.0 - 1.0),
                              zf + 10.0 * (1.0 - (2.0 * k / 8.0 - 1.0) ** 2)))
                      for k in range(9)])
    for i in range(len(floor) - 1):
        for j in range(8):
            m.quad(floor[i][j], floor[i + 1][j], floor[i + 1][j + 1],
                   floor[i][j + 1], "carpet")

    for side, flip in ((1.0, False), (-1.0, True)):
        walls = []
        for x in xs:
            y_in = profile.rim_half_width(x) - 8.0
            z_rim = profile.belt_z(x)
            walls.append([
                m.vert((x, side * y_in, zf)),
                m.vert((x, side * (y_in - 30.0), zf + 6.0)),
                m.vert((x, side * (y_in - 40.0), zf + 0.60 * (z_rim - zf))),
                m.vert((x, side * (y_in - 18.0), z_rim - 30.0)),
                m.vert((x, side * y_in, z_rim)),
            ])
        for i in range(len(walls) - 1):
            a, b = walls[i], walls[i + 1]
            for j in range(4):
                if flip:
                    m.quad(a[j], a[j + 1], b[j + 1], b[j], "leather")
                else:
                    m.quad(a[j], b[j], b[j + 1], a[j + 1], "leather")

    for x, flip in ((xs[0], False), (xs[-1], True)):
        y_in = profile.rim_half_width(x) - 8.0
        z_rim = profile.belt_z(x)
        q = [m.vert((x, -y_in, zf)), m.vert((x, y_in, zf)),
             m.vert((x, y_in, z_rim)), m.vert((x, -y_in, z_rim))]
        if flip:
            m.quad(q[0], q[3], q[2], q[1], "alcantara")
        else:
            m.quad(q[0], q[1], q[2], q[3], "alcantara")
    return m


# ==================================================== assembly


def build_body():
    return {
        "hull": build_hull(),
        "deck": build_deck(),
        "canopy": build_canopy(),
        "cockpit": build_cockpit(),
    }
