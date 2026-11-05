"""Procedural mesh building blocks.

Coordinate system (right-handed, millimetres):
    +X = forward (nose of the car)
    +Y = left
    +Z = up, ground plane at z = 0

A Mesh is a plain indexed polygon soup: shared vertices, faces as index
tuples, one material name per face. Everything downstream (OBJ, glTF,
software rasteriser) consumes that representation directly.
"""

import math

# ---------------------------------------------------------------- vectors


def vadd(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def vsub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def vmul(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def vdot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def vcross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def vlen(a):
    return math.sqrt(vdot(a, a))


def vnorm(a):
    n = vlen(a)
    return (a[0] / n, a[1] / n, a[2] / n) if n > 1e-12 else (0.0, 0.0, 0.0)


def vlerp(a, b, t):
    return (
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    )


def clamp(x, lo, hi):
    return lo if x < lo else (hi if x > hi else x)


def smoothstep(t):
    t = clamp(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


# ---------------------------------------------------------------- mesh


class Mesh:
    """Indexed polygon soup with per-face material names."""

    def __init__(self, name="mesh"):
        self.name = name
        self.verts = []
        self.faces = []
        self.fmat = []

    # -- building ---------------------------------------------------
    def vert(self, p):
        self.verts.append((float(p[0]), float(p[1]), float(p[2])))
        return len(self.verts) - 1

    def verts_of(self, points):
        return [self.vert(p) for p in points]

    def face(self, idx, mat):
        if len(set(idx)) < 3:
            return
        self.faces.append(tuple(idx))
        self.fmat.append(mat)

    def tri(self, a, b, c, mat):
        self.face((a, b, c), mat)

    def quad(self, a, b, c, d, mat):
        self.face((a, b, c, d), mat)

    def add(self, other, transform=None):
        """Merge another mesh, optionally through a point transform."""
        off = len(self.verts)
        if transform is None:
            self.verts.extend(other.verts)
        else:
            self.verts.extend(transform(p) for p in other.verts)
        for f, m in zip(other.faces, other.fmat):
            self.faces.append(tuple(i + off for i in f))
            self.fmat.append(m)
        return self

    def transform(self, fn):
        self.verts = [fn(p) for p in self.verts]
        return self

    def mirrored_y(self, name=None):
        """Copy of this mesh reflected across the XZ plane."""
        m = Mesh(name or (self.name + "_mirror"))
        m.verts = [(p[0], -p[1], p[2]) for p in self.verts]
        m.faces = [tuple(reversed(f)) for f in self.faces]
        m.fmat = list(self.fmat)
        return m

    # -- queries ----------------------------------------------------
    def bounds(self):
        if not self.verts:
            return (0, 0, 0), (0, 0, 0)
        xs = [p[0] for p in self.verts]
        ys = [p[1] for p in self.verts]
        zs = [p[2] for p in self.verts]
        return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))

    def face_normal(self, fi):
        f = self.faces[fi]
        a, b, c = self.verts[f[0]], self.verts[f[1]], self.verts[f[2]]
        return vnorm(vcross(vsub(b, a), vsub(c, a)))

    def face_area(self, fi):
        f = self.faces[fi]
        if len(f) < 3:
            return 0.0
        a = self.verts[f[0]]
        area = 0.0
        for k in range(1, len(f) - 1):
            b, c = self.verts[f[k]], self.verts[f[k + 1]]
            area += vlen(vcross(vsub(b, a), vsub(c, a))) * 0.5
        return area

    def face_centroid(self, fi):
        f = self.faces[fi]
        cx = cy = cz = 0.0
        for i in f:
            p = self.verts[i]
            cx += p[0]
            cy += p[1]
            cz += p[2]
        n = float(len(f))
        return (cx / n, cy / n, cz / n)

    def stats(self):
        return len(self.verts), len(self.faces)

    def prune(self, eps=1e-6):
        """Drop degenerate faces and unused vertices."""
        keep_f, keep_m = [], []
        for fi, f in enumerate(self.faces):
            if len(set(f)) >= 3 and self.face_area(fi) > eps:
                keep_f.append(f)
                keep_m.append(self.fmat[fi])
        used = sorted({i for f in keep_f for i in f})
        remap = {old: new for new, old in enumerate(used)}
        self.verts = [self.verts[i] for i in used]
        self.faces = [tuple(remap[i] for i in f) for f in keep_f]
        self.fmat = keep_m
        return self


    def volume(self):
        """Signed volume; negative means faces point inward."""
        total = 0.0
        for f in self.faces:
            a = self.verts[f[0]]
            for k in range(1, len(f) - 1):
                b = self.verts[f[k]]
                c = self.verts[f[k + 1]]
                total += vdot(a, vcross(b, c))
        return total / 6.0

    def flip(self):
        self.faces = [tuple(reversed(f)) for f in self.faces]
        return self

    def orient_outward(self):
        if self.volume() < 0.0:
            self.flip()
        return self


def keyframe(keys, t):
    """Smoothstep interpolation between (t, value) keys; no overshoot."""
    if t <= keys[0][0]:
        return keys[0][1]
    if t >= keys[-1][0]:
        return keys[-1][1]
    for i in range(len(keys) - 1):
        t0, v0 = keys[i]
        t1, v1 = keys[i + 1]
        if t0 <= t <= t1:
            span = t1 - t0
            u = 0.0 if span <= 0 else (t - t0) / span
            return v0 + (v1 - v0) * smoothstep(u)
    return keys[-1][1]


# ---------------------------------------------------------------- rings


def ring_to_loft(mesh, rings, mat, closed=True, cap_start=None, cap_end=None,
                 mat_fn=None):
    """Bridge a sequence of equal-length rings with quads.

    mat_fn(i, j) -> material name or None (skip) lets a single loft carry
    several materials, e.g. body paint next to glass.
    """
    n = len(rings[0])
    rows = []
    for r in rings:
        if len(r) != n:
            raise ValueError("ring length mismatch: %d vs %d" % (len(r), n))
        rows.append([mesh.vert(p) for p in r])

    seg = n if closed else n - 1
    for i in range(len(rows) - 1):
        a_row, b_row = rows[i], rows[i + 1]
        for j in range(seg):
            k = (j + 1) % n
            m = mat_fn(i, j) if mat_fn else mat
            if m is None:
                continue
            mesh.quad(a_row[j], a_row[k], b_row[k], b_row[j], m)

    if cap_start is not None:
        m = cap_start if isinstance(cap_start, str) else mat
        mesh.face(tuple(reversed(rows[0])), m)
    if cap_end is not None:
        m = cap_end if isinstance(cap_end, str) else mat
        mesh.face(tuple(rows[-1]), m)
    return mesh


def box(mesh, center, size, mat):
    cx, cy, cz = center
    hx, hy, hz = size[0] * 0.5, size[1] * 0.5, size[2] * 0.5
    p = [
        (cx - hx, cy - hy, cz - hz),
        (cx + hx, cy - hy, cz - hz),
        (cx + hx, cy + hy, cz - hz),
        (cx - hx, cy + hy, cz - hz),
        (cx - hx, cy - hy, cz + hz),
        (cx + hx, cy - hy, cz + hz),
        (cx + hx, cy + hy, cz + hz),
        (cx - hx, cy + hy, cz + hz),
    ]
    i = mesh.verts_of(p)
    mesh.quad(i[0], i[3], i[2], i[1], mat)  # bottom
    mesh.quad(i[4], i[5], i[6], i[7], mat)  # top
    mesh.quad(i[0], i[1], i[5], i[4], mat)  # -y
    mesh.quad(i[2], i[3], i[7], i[6], mat)  # +y
    mesh.quad(i[1], i[2], i[6], i[5], mat)  # +x
    mesh.quad(i[3], i[0], i[4], i[7], mat)  # -x
    return mesh


def revolve(mesh, profile, mat, segments=24, center=(0, 0, 0), axis="x",
            closed_profile=False, phase=0.0, mat_fn=None, arc=None):
    """Surface of revolution around the axis through `center`.

    profile: list of (along_axis, radius) pairs.
    arc: (start_angle, end_angle) in radians to sweep a partial ring.
    """
    if arc is None:
        angles = [phase + 2.0 * math.pi * k / segments for k in range(segments)]
        wrap = True
    else:
        a0, a1 = arc
        angles = [a0 + (a1 - a0) * k / segments for k in range(segments + 1)]
        wrap = False

    def place(along, radius, ang):
        c, s = math.cos(ang) * radius, math.sin(ang) * radius
        if axis == "x":
            p = (along, c, s)
        elif axis == "y":
            p = (s, along, c)
        else:
            p = (c, s, along)
        return (p[0] + center[0], p[1] + center[1], p[2] + center[2])

    rows = []
    for along, radius in profile:
        rows.append(mesh.verts_of([place(along, radius, a) for a in angles]))

    count = len(angles) if wrap else len(angles) - 1
    nij = len(rows) - 1 + (1 if closed_profile else 0)
    quads = []
    for i in range(nij):
        a_row = rows[i % len(rows)]
        b_row = rows[(i + 1) % len(rows)]
        for j in range(count):
            k = (j + 1) % len(angles)
            m = mat_fn(i, j) if mat_fn else mat
            if m is None:
                continue
            quads.append((a_row[j], a_row[k], b_row[k], b_row[j], m))

    # A closed profile makes a solid shell, whose facing depends on the loop
    # direction. Flip it once if the enclosed volume came out negative so
    # callers do not have to reason about winding.
    if closed_profile and wrap:
        vol = 0.0
        for q in quads:
            a0, b0, c0 = mesh.verts[q[0]], mesh.verts[q[1]], mesh.verts[q[2]]
            vol += vdot(a0, vcross(b0, c0))
        if vol < 0.0:
            quads = [(q[0], q[3], q[2], q[1], q[4]) for q in quads]

    for q in quads:
        mesh.quad(*q)
    return mesh


def quad_strip(mesh, left, right, mat):
    """Bridge two equal-length open polylines into a quad strip."""
    li = mesh.verts_of(left)
    ri = mesh.verts_of(right)
    for i in range(len(li) - 1):
        mesh.quad(li[i], li[i + 1], ri[i + 1], ri[i], mat)
    return mesh


def polyline_tube(mesh, points, radius, mat, segments=8, cap=True):
    """Circular tube swept along a polyline (parallel-transport frames)."""
    n = len(points)
    if n < 2:
        return mesh
    rings = []
    prev_normal = None
    for i, p in enumerate(points):
        if i == 0:
            tangent = vnorm(vsub(points[1], points[0]))
        elif i == n - 1:
            tangent = vnorm(vsub(points[-1], points[-2]))
        else:
            tangent = vnorm(vsub(points[i + 1], points[i - 1]))
        if prev_normal is None:
            ref = (0, 0, 1) if abs(tangent[2]) < 0.9 else (1, 0, 0)
            normal = vnorm(vcross(tangent, ref))
        else:
            normal = vnorm(vsub(prev_normal, vmul(tangent, vdot(prev_normal, tangent))))
        prev_normal = normal
        bitangent = vcross(tangent, normal)
        ring = []
        for k in range(segments):
            a = 2.0 * math.pi * k / segments
            ring.append(vadd(p, vadd(vmul(normal, math.cos(a) * radius),
                                    vmul(bitangent, math.sin(a) * radius))))
        rings.append(ring)
    return ring_to_loft(mesh, rings, mat, closed=True,
                        cap_start=mat if cap else None,
                        cap_end=mat if cap else None)


# ---------------------------------------------------------------- curves


def catmull_rom(points, t):
    """Interpolate a point through a list of control tuples at t in [0,1]."""
    n = len(points) - 1
    if n <= 0:
        return points[0]
    t = clamp(t, 0.0, 1.0) * n
    seg = min(int(t), n - 1)
    u = t - seg
    p0 = points[max(seg - 1, 0)]
    p1 = points[seg]
    p2 = points[seg + 1]
    p3 = points[min(seg + 2, n)]
    out = []
    for a, b, c, d in zip(p0, p1, p2, p3):
        out.append(0.5 * ((2 * b) + (-a + c) * u
                          + (2 * a - 5 * b + 4 * c - d) * u * u
                          + (-a + 3 * b - 3 * c + d) * u * u * u))
    return tuple(out)


def sample_profile(keys, t, smooth=True):
    """Sample rows of (t, value...) as a smooth (or linear) function of t."""
    ts = [k[0] for k in keys]
    cols = list(zip(*keys))
    vals = []
    for col in cols[1:]:
        if smooth:
            vals.append(catmull_rom(tuple((t_i, v_i) for t_i, v_i in zip(ts, col)), t)[1])
        else:
            vals.append(_lerp_lookup(ts, col, t))
    return vals


def _lerp_lookup(ts, vs, t):
    if t <= ts[0]:
        return vs[0]
    if t >= ts[-1]:
        return vs[-1]
    for i in range(len(ts) - 1):
        if ts[i] <= t <= ts[i + 1]:
            span = ts[i + 1] - ts[i]
            u = 0.0 if span == 0 else (t - ts[i]) / span
            return vs[i] + (vs[i + 1] - vs[i]) * u
    return vs[-1]


def arch_elevation(dx, radius, apex, base):
    """Elliptical wheel-arch opening height at offset dx from the axle."""
    if abs(dx) >= radius:
        return base
    k = math.sqrt(max(0.0, 1.0 - (dx / radius) ** 2))
    return base + (apex - base) * k


# ---------------------------------------------------------------- prisms


def polygon_area(poly):
    a = 0.0
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        a += x0 * y1 - x1 * y0
    return 0.5 * a


def ensure_ccw(poly):
    return poly if polygon_area(poly) >= 0.0 else list(reversed(poly))


def extrude_polygon(mesh, poly, origin, axis, depth, mat, cap=True, taper=0.0):
    """Extrude a 2D polygon along `axis` from `origin`.

    poly is in the plane perpendicular to axis, given as (u, v) pairs. With
    axis 'x' the mapping is (y, z); 'y' -> (x, z); 'z' -> (x, y).
    """
    poly = ensure_ccw(poly)
    n = len(poly)

    def place(u, v, s):
        s = s + taper * depth * (s / depth if depth else 0.0)
        if axis == "x":
            return (origin[0] + s, origin[1] + u, origin[2] + v)
        if axis == "y":
            return (origin[0] + u, origin[1] + s, origin[2] + v)
        return (origin[0] + u, origin[1] + v, origin[2] + s)

    front = mesh.verts_of([place(u, v, 0.0) for (u, v) in poly])
    back = mesh.verts_of([place(u, v, depth) for (u, v) in poly])

    if axis == "y":
        # (x, z) is left-handed about +y, so the winding flips relative to x/z
        for i in range(n):
            k = (i + 1) % n
            mesh.quad(front[i], back[i], back[k], front[k], mat)
        if cap:
            mesh.face(tuple(front), mat)
            mesh.face(tuple(reversed(back)), mat)
    else:
        for i in range(n):
            k = (i + 1) % n
            mesh.quad(front[i], front[k], back[k], back[i], mat)
        if cap:
            mesh.face(tuple(reversed(front)), mat)
            mesh.face(tuple(back), mat)
    return mesh


def plate(mesh, poly, plane, offset, thickness, mat, center=(0.0, 0.0)):
    """Extrude a 2D polygon into a slab centred on `offset`.

    `plane` picks the plane the polygon lives in and the sweep axis together:
    "xz" sweeps along Y, "xy" along Z, "yz" along X. `center` shifts the
    polygon within that plane, so callers can pass origin-centred shapes.
    """
    half = thickness * 0.5
    cu, cv = center
    if plane == "xz":
        pts = [(u + cu, v + cv) for (u, v) in poly]
        return extrude_polygon(mesh, pts, (0.0, offset - half, 0.0), "y",
                               thickness, mat)
    if plane == "xy":
        pts = [(u + cu, v + cv) for (u, v) in poly]
        return extrude_polygon(mesh, pts, (0.0, 0.0, offset - half), "z",
                               thickness, mat)
    pts = [(u + cu, v + cv) for (u, v) in poly]
    return extrude_polygon(mesh, pts, (offset - half, 0.0, 0.0), "x",
                           thickness, mat)


def rounded_rect(w, h, r, segments=4):
    """CCW rounded rectangle centred on the origin, (x, y) pairs."""
    r = min(r, min(w, h) * 0.5)
    pts = []
    corners = ((w * 0.5 - r, h * 0.5 - r, 0.0),
               (-w * 0.5 + r, h * 0.5 - r, math.pi * 0.5),
               (-w * 0.5 + r, -h * 0.5 + r, math.pi),
               (w * 0.5 - r, -h * 0.5 + r, math.pi * 1.5))
    for cx, cy, a0 in corners:
        for k in range(segments + 1):
            a = a0 + (math.pi * 0.5) * k / segments
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def ellipsoid(mesh, center, radii, mat, seg_u=16, seg_v=8):
    """UV sphere scaled by radii; poles on Z."""
    rx, ry, rz = radii
    rows = []
    for j in range(1, seg_v):
        phi = math.pi * j / float(seg_v)
        sp, cp = math.sin(phi), math.cos(phi)
        row = []
        for i in range(seg_u):
            th = 2.0 * math.pi * i / seg_u
            row.append(mesh.vert((center[0] + rx * sp * math.cos(th),
                                  center[1] + ry * sp * math.sin(th),
                                  center[2] + rz * cp)))
        rows.append(row)
    for i in range(len(rows) - 1):
        for j in range(seg_u):
            k = (j + 1) % seg_u
            mesh.quad(rows[i][j], rows[i + 1][j], rows[i + 1][k], rows[i][k], mat)

    # fan the top and bottom rows to pole vertices, otherwise the sphere is an
    # open tube and reads as inside-out when shaded
    top = mesh.vert((center[0], center[1], center[2] + rz))
    bot = mesh.vert((center[0], center[1], center[2] - rz))
    for j in range(seg_u):
        k = (j + 1) % seg_u
        mesh.tri(top, rows[0][k], rows[0][j], mat)
        mesh.tri(bot, rows[-1][j], rows[-1][k], mat)
    return mesh


def transform_mesh(mesh, fn):
    return mesh.transform(fn)
