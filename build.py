"""Assemble the car and write every deliverable.

    python3 build.py              # OBJ + MTL + GLB + a JSON report
    python3 build.py --verify     # plus geometry checks, non-zero exit on fail

The scene is built as a dict of named parts so each one can be exported as its
own named object in the OBJ, which is what makes the result editable in Blender
instead of being one welded blob.
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from carmodel import body, details, export, export_parts, params, profile, wheels  # noqa: E402
from carmodel.geom import Mesh, vcross, vdot, vsub  # noqa: E402
from carmodel.materials import MATERIALS  # noqa: E402

OUT_DIR = os.path.join(HERE, "out")


def build_parts():
    """Every named part of the car, in a stable order."""
    parts = []
    for name, mesh in body.build_body().items():
        parts.append(("body_" + name, mesh))
    for name, mesh in details.build_details().items():
        parts.append(("detail_" + name, mesh))
    for name, mesh in wheels.build_wheel_set().items():
        parts.append(("wheel_" + name, mesh))

    for name, mesh in parts:
        mesh.name = name
        mesh.prune(1e-4)
    return parts


def part_pivot(name, mesh):
    """Where a part rotates about, in car space (mm, Z-up).

    Wheels turn about their axle and steer about the vertical through it, so the
    pivot must be the wheel centre, not the body origin. Same idea for the
    steering wheel, which turns about its own column.
    """
    if name.startswith("wheel_"):
        entry = None
        for a in params.arch_list():
            if (a["axle"] > 0) == name.endswith("_fl") or (a["axle"] > 0) == name.endswith("_fr"):
                entry = a
                break
        if entry is None:
            return (0.0, 0.0, 0.0)
        # The suffix is "fl"/"fr"/"rl"/"rr": check the second letter, not "_l",
        # which never matches because the underscore is followed by f or r.
        side = 1.0 if name.endswith("l") else -1.0
        return (entry["axle"], side * entry["track_half"], params.WHEEL_R)

    if name == "detail_interior":
        return (250.0, -330.0, params.FLOOR_Z + 334.0)

    return (0.0, 0.0, 0.0)


def build_scene(parts):
    scene = Mesh("car")
    for _, mesh in parts:
        scene.add(mesh)
    return scene


# ---------------------------------------------------------------- checks


def check_bounds(parts):
    """The car must be the size we asked for and sit on the ground."""
    allv = []
    for _, m in parts:
        allv.extend(m.verts)
    xs = [p[0] for p in allv]
    ys = [p[1] for p in allv]
    zs = [p[2] for p in allv]
    lo = (min(xs), min(ys), min(zs))
    hi = (max(xs), max(ys), max(zs))
    size = (hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])

    problems = []
    if abs(size[0] - params.LENGTH) > 60.0:
        problems.append("length %.0f, expected %.0f" % (size[0], params.LENGTH))
    if abs(size[1] - 2.0 * params.HALF_WIDTH) > 90.0:
        problems.append("width %.0f, expected %.0f"
                        % (size[1], 2.0 * params.HALF_WIDTH))
    if abs(lo[2]) > 3.0:
        problems.append("lowest point z=%.1f, expected 0" % lo[2])
    if not 1050.0 <= hi[2] <= 1420.0:
        problems.append("roof height %.0f out of range" % hi[2])
    return problems


def split_components(mesh):
    """Group face indices by shared vertices (union-find over the vertex graph)."""
    parent = list(range(len(mesh.verts)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for f in mesh.faces:
        for i in f[1:]:
            union(f[0], i)

    groups = {}
    for fi, f in enumerate(mesh.faces):
        groups.setdefault(find(f[0]), []).append(fi)
    return list(groups.values())


def component_volume(mesh, face_ids):
    total = 0.0
    for fi in face_ids:
        f = mesh.faces[fi]
        a = mesh.verts[f[0]]
        for k in range(1, len(f) - 1):
            b = mesh.verts[f[k]]
            c = mesh.verts[f[k + 1]]
            total += vdot(a, vcross(b, c))
    return total / 6.0


def component_is_closed(mesh, face_ids):
    """Closed means every edge is used by exactly two faces, in both directions."""
    seen = {}
    for fi in face_ids:
        f = mesh.faces[fi]
        for i in range(len(f)):
            a, b = f[i], f[(i + 1) % len(f)]
            seen[(a, b)] = seen.get((a, b), 0) + 1
    for (a, b) in seen:
        if seen[(a, b)] != 1 or (b, a) not in seen:
            return False
    return True


def _component_extent(mesh, face_ids):
    xs = [mesh.verts[i][0] for fi in face_ids for i in mesh.faces[fi]]
    ys = [mesh.verts[i][1] for fi in face_ids for i in mesh.faces[fi]]
    zs = [mesh.verts[i][2] for fi in face_ids for i in mesh.faces[fi]]
    d = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    return d[0] * d[1] * d[2]


def check_winding(parts):
    """Closed shells must enclose positive volume; open sheets must face up.

    A bounding-box centroid test is meaningless for non-convex shells, so this
    splits each part into connected components and applies the invariant that
    actually holds: a closed, outward-facing shell has positive signed volume.
    """
    problems = []
    open_sheets = []
    for name, mesh in parts:
        for face_ids in split_components(mesh):
            closed = component_is_closed(mesh, face_ids)
            vol = component_volume(mesh, face_ids)
            if closed:
                if vol < 0.0:
                    problems.append(
                        "%s: closed component of %d faces is inside-out "
                        "(volume %.1f cm3)" % (name, len(face_ids), vol / 1000.0))
            # Open sheets (cabin tub, wing skins, patch backs) have no enclosed
            # volume, so a sign test would be meaningless. They are reported in
            # the closure table instead and checked by their own part tests.
            else:
                open_sheets.append((name, len(face_ids)))
    return problems, open_sheets


def check_closure(parts):
    """A closed shell has every edge shared by exactly two faces."""
    report = {}
    for name, mesh in parts:
        edges = {}
        for f in mesh.faces:
            for i in range(len(f)):
                a, b = f[i], f[(i + 1) % len(f)]
                key = (a, b) if a < b else (b, a)
                edges[key] = edges.get(key, 0) + 1
        open_edges = sum(1 for c in edges.values() if c == 1)
        report[name] = {"faces": len(mesh.faces), "open_edges": open_edges}
    return report


def check_wheel_clearance(parts):
    """Each tyre must sit inside its arch and not poke through the body."""
    by_name = dict(parts)
    problems = []
    for entry in params.arch_list():
        front = entry["axle"] > 0
        key = "wheel_fl" if front else "wheel_rl"
        if key not in by_name:
            problems.append("missing %s" % key)
            continue
        lo, hi = by_name[key].bounds()
        apex = params.ARCH_APEX_F if front else params.ARCH_APEX_R
        if hi[2] > apex - 6.0:
            problems.append("%s crown %.0f vs arch %.0f" % (key, hi[2], apex))
        outer = max(abs(lo[1]), abs(hi[1]))
        body_hw = profile.half_width(entry["axle"])
        if outer > body_hw - 2.0:
            problems.append("%s outer %.0f vs body half width %.0f"
                            % (key, outer, body_hw))
    return problems


def check_materials(parts):
    problems = []
    for name, mesh in parts:
        for m in sorted(set(mesh.fmat)):
            if m not in MATERIALS:
                problems.append("%s uses unknown material %r" % (name, m))
    return problems


def count_triangles(parts):
    return sum(max(0, len(f) - 2) for _, m in parts for f in m.faces)


# ---------------------------------------------------------------- main


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build the procedural car model")
    ap.add_argument("--verify", action="store_true",
                    help="run geometry checks and fail on problems")
    ap.add_argument("--out", default=OUT_DIR, help="output directory")
    args = ap.parse_args(argv)

    os.makedirs(args.out, exist_ok=True)
    parts = build_parts()
    scene = build_scene(parts)

    obj_path = os.path.join(args.out, "car.obj")
    glb_path = os.path.join(args.out, "car.glb")

    export.write_obj(scene, obj_path, comments=(
        "procedural coupe, %d parts, %d triangles"
        % (len(parts), count_triangles(parts)),
    ))

    # Separate nodes per part: a single welded mesh cannot spin its wheels or
    # turn its steering wheel, which is what makes the car read as a prop being
    # dragged along rather than a vehicle driving.
    export_parts.write_glb_parts(
        [{"name": n, "mesh": m, "pivot": part_pivot(n, m)} for n, m in parts],
        glb_path,
    )

    report = {
        "parts": {name: {"vertices": len(m.verts), "faces": len(m.faces)}
                  for name, m in parts},
        "totals": {
            "vertices": len(scene.verts),
            "faces": len(scene.faces),
            "triangles": count_triangles(parts),
            "materials": len(set(scene.fmat)),
        },
        "files": {},
    }
    for label, path, fn in (("obj", obj_path, export.verify_obj),
                            ("glb", glb_path, export.verify_glb)):
        info = fn(path)
        info["bytes"] = os.path.getsize(path)
        report["files"][label] = info

    problems = []
    if args.verify:
        for label, fn in (("bounds", check_bounds), ("winding", check_winding),
                          ("clearance", check_wheel_clearance),
                          ("materials", check_materials)):
            found = fn(parts)
            if label == "winding":
                found, open_sheets = found
                report["open_sheets"] = open_sheets
            problems.extend("%s: %s" % (label, p) for p in found)
        report["closure"] = check_closure(parts)

    report["problems"] = problems
    with open(os.path.join(args.out, "report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)

    print("wrote %s" % obj_path)
    print("wrote %s" % glb_path)
    print("parts %d, vertices %d, faces %d, triangles %d"
          % (len(parts), report["totals"]["vertices"],
             report["totals"]["faces"], report["totals"]["triangles"]))
    print("glb %d bytes, %d primitives, %d triangles"
          % (report["files"]["glb"]["bytes"],
             report["files"]["glb"]["primitives"],
             report["files"]["glb"]["triangles"]))

    if problems:
        print("\n%d problem(s):" % len(problems))
        for p in problems:
            print("  - " + p)
        return 1
    if args.verify:
        print("\nchecks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
