"""Mesh exporters: Wavefront OBJ (+MTL) and binary glTF (.glb).

Both take a geom.Mesh and the shared material palette, so the OBJ and the
GLB always describe the same scene. Units stay in millimetres.
"""

import json
import math
import os
import struct

from .geom import Mesh, vcross, vnorm, vsub
from .materials import MATERIALS, alpha, to_linear

# ------------------------------------------------------------------ shared


def _group_faces(mesh):
    """Group face indices by material name, preserving first-seen order."""
    order = []
    buckets = {}
    for fi, m in enumerate(mesh.fmat):
        if m not in buckets:
            buckets[m] = []
            order.append(m)
        buckets[m].append(fi)
    return [(m, buckets[m]) for m in order]


def _triangulate(mesh, fi):
    """Fan-triangulate one face into vertex index triples."""
    f = mesh.faces[fi]
    return [(f[0], f[k], f[k + 1]) for k in range(1, len(f) - 1)]


# ------------------------------------------------------------------ OBJ


def write_mtl(materials, path, name):
    lines = ["# %s" % name, ""]
    for key in materials:
        m = MATERIALS[key]
        r, g, b = m["color"]
        lines.append("newmtl %s" % key)
        lines.append("Kd %.6f %.6f %.6f" % (r, g, b))
        lines.append("Ka 0.000000 0.000000 0.000000")
        spec = 0.9 if m.get("metallic", 0.0) > 0.5 else 0.35
        lines.append("Ks %.6f %.6f %.6f" % (spec, spec, spec))
        lines.append("Ns %.1f" % max(1.0, (1.0 - m.get("roughness", 0.5)) * 900.0))
        lines.append("Ni 1.450000")
        a = m.get("alpha", 1.0)
        lines.append("d %.6f" % a)
        lines.append("illum 2")
        if a < 0.999:
            lines.append("Tf 1.000000 1.000000 1.000000")
        lines.append("")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))


def write_obj(mesh, path, mtl_name=None, object_name=None, comments=()):
    """Write an OBJ plus the sibling MTL file."""
    mtl_name = mtl_name or (os.path.splitext(os.path.basename(path))[0] + ".mtl")
    object_name = object_name or mesh.name
    groups = _group_faces(mesh)
    used = [m for m, _ in groups]

    out = []
    for c in comments:
        out.append("# %s" % c)
    out.append("# units: millimetres  axes: +X forward, +Y left, +Z up")
    out.append("mtllib %s" % mtl_name)
    out.append("o %s" % object_name)
    for p in mesh.verts:
        out.append("v %.4f %.4f %.4f" % p)
    # normals per face are computed below; emit them right after the verts
    normals = []
    for fi in range(len(mesh.faces)):
        n = mesh.face_normal(fi)
        normals.append(n)
        out.append("vn %.5f %.5f %.5f" % n)
    for m, faces in groups:
        out.append("usemtl %s" % m)
        out.append("g %s_%s" % (object_name, m))
        for fi in faces:
            f = mesh.faces[fi]
            nref = fi + 1
            out.append("f " + " ".join("%d//%d" % (i + 1, nref) for i in f))

    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out) + "\n")
    write_mtl(used, os.path.join(os.path.dirname(path) or ".", mtl_name), object_name)
    return path


# ------------------------------------------------------------------ glTF


_COMP = 5126  # FLOAT
_ARRAY_BUFFER = 34962
_ELEMENT_ARRAY_BUFFER = 34963


class _Blob:
    """Append-only little-endian binary buffer with 4-byte alignment."""

    def __init__(self):
        self.data = bytearray()
        self.views = []

    def push(self, raw, target=None, stride=None):
        while len(self.data) % 4:
            self.data.append(0)
        offset = len(self.data)
        self.data.extend(raw)
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(raw)}
        if target is not None:
            view["target"] = target
        if stride is not None:
            view["byteStride"] = stride
        self.views.append(view)
        return len(self.views) - 1


def _pbr_material(key):
    m = MATERIALS[key]
    r, g, b = to_linear(m["color"])
    pbr = {
        "baseColorFactor": [round(r, 6), round(g, 6), round(b, 6), round(alpha(key), 6)],
        "metallicFactor": round(float(m.get("metallic", 0.0)), 6),
        "roughnessFactor": round(float(m.get("roughness", 0.5)), 6),
    }
    out = {
        "name": key,
        "pbrMetallicRoughness": pbr,
        "doubleSided": False,
    }
    if alpha(key) < 0.999:
        out["alphaMode"] = "BLEND"
    em, strength = m.get("emission", (None, 0.0))
    if em:
        er, eg, eb = to_linear(em)
        out["emissiveFactor"] = [
            round(min(1.0, er * strength), 6),
            round(min(1.0, eg * strength), 6),
            round(min(1.0, eb * strength), 6),
        ]
    return out


def write_glb(mesh, path, scene_name=None, generator=None, axis_convert=True):
    """Write a single-mesh binary glTF 2.0 file.

    Vertices are duplicated per material group so every primitive has its own
    tight vertex range, which keeps normals split across hard edges.

    glTF is Y-up. The model is authored Z-up (+X forward, +Y left, +Z up), so
    with `axis_convert` every vertex and normal is rotated -90 degrees about X:
    (x, y, z) -> (x, z, -y). Baking the rotation into the data keeps the asset
    correct in any viewer instead of relying on each one guessing the up axis.
    """
    scene_name = scene_name or mesh.name
    groups = _group_faces(mesh)

    def xf(p):
        return (p[0], p[2], -p[1]) if axis_convert else p

    blob = _Blob()
    accessors = []
    primitives = []
    materials = []
    mat_index = {}

    for key, faces in groups:
        if key not in mat_index:
            mat_index[key] = len(materials)
            materials.append(_pbr_material(key))
        mi = mat_index[key]

        remap = {}
        pos = []
        nrm = []
        tris = []

        for fi in faces:
            fn = xf(mesh.face_normal(fi))
            f = mesh.faces[fi]
            local = []
            for vi in f:
                # split by (vertex, face) so hard edges stay hard
                sig = (vi, fi)
                if sig not in remap:
                    remap[sig] = len(pos)
                    pos.append(xf(mesh.verts[vi]))
                    nrm.append(fn)
                local.append(remap[sig])
            for k in range(1, len(local) - 1):
                tris.append((local[0], local[k], local[k + 1]))

        if not tris:
            continue

        pos_raw = b"".join(struct.pack("<3f", *p) for p in pos)
        nrm_raw = b"".join(struct.pack("<3f", *n) for n in nrm)
        idx_raw = b"".join(struct.pack("<3I", *t) for t in tris)

        vpos = blob.push(pos_raw, _ARRAY_BUFFER, 12)
        vnrm = blob.push(nrm_raw, _ARRAY_BUFFER, 12)
        vidx = blob.push(idx_raw, _ELEMENT_ARRAY_BUFFER, None)

        mn = [min(p[i] for p in pos) for i in range(3)]
        mx = [max(p[i] for p in pos) for i in range(3)]

        a_pos = len(accessors)
        accessors.append({"bufferView": vpos, "componentType": _COMP,
                          "count": len(pos), "type": "VEC3",
                          "min": [round(v, 4) for v in mn],
                          "max": [round(v, 4) for v in mx]})
        a_nrm = len(accessors)
        accessors.append({"bufferView": vnrm, "componentType": _COMP,
                          "count": len(nrm), "type": "VEC3"})
        a_idx = len(accessors)
        accessors.append({"bufferView": vidx, "componentType": 5125,
                          "count": len(tris) * 3, "type": "SCALAR"})

        primitives.append({
            "attributes": {"POSITION": a_pos, "NORMAL": a_nrm},
            "indices": a_idx,
            "material": mi,
            "mode": 4,
        })

    while len(blob.data) % 4:
        blob.data.append(0)

    gltf = {
        "asset": {"version": "2.0", "generator": generator or "carmodel"},
        "scene": 0,
        "scenes": [{"name": scene_name, "nodes": [0]}],
        "nodes": [{"name": scene_name, "mesh": 0}],
        "meshes": [{"name": scene_name, "primitives": primitives}],
        "materials": materials,
        "accessors": accessors,
        "bufferViews": blob.views,
        "buffers": [{"byteLength": len(blob.data)}],
    }

    json_raw = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    while len(json_raw) % 4:
        json_raw += b" "
    bin_raw = bytes(blob.data)
    while len(bin_raw) % 4:
        bin_raw += b"\x00"

    total = 12 + 8 + len(json_raw) + 8 + len(bin_raw)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<4sII", b"glTF", 2, total))
        fh.write(struct.pack("<I4s", len(json_raw), b"JSON"))
        fh.write(json_raw)
        fh.write(struct.pack("<I4s", len(bin_raw), b"BIN\x00"))
        fh.write(bin_raw)
    return path


def verify_glb(path):
    """Parse the GLB back and sanity-check structure. Returns a dict."""
    with open(path, "rb") as fh:
        raw = fh.read()
    magic, version, total = struct.unpack("<4sII", raw[:12])
    assert magic == b"glTF", "bad magic"
    assert version == 2, "bad version"
    assert total == len(raw), "length mismatch %d vs %d" % (total, len(raw))
    jlen, jtype = struct.unpack("<I4s", raw[12:20])
    assert jtype == b"JSON"
    gltf = json.loads(raw[20:20 + jlen].decode("utf-8"))
    boff = 20 + jlen
    blen, btype = struct.unpack("<I4s", raw[boff:boff + 8])
    assert btype == b"BIN\x00"
    bin_len = gltf["buffers"][0]["byteLength"]
    assert blen >= bin_len

    tris = 0
    for prim in gltf["meshes"][0]["primitives"]:
        acc = gltf["accessors"][prim["indices"]]
        tris += acc["count"] // 3
    return {
        "bytes": len(raw),
        "materials": len(gltf["materials"]),
        "primitives": len(gltf["meshes"][0]["primitives"]),
        "triangles": tris,
        "json_bytes": jlen,
        "bin_bytes": blen,
    }


def verify_obj(path):
    verts = normals = faces = 0
    mats = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("v "):
                verts += 1
            elif line.startswith("vn "):
                normals += 1
            elif line.startswith("f "):
                faces += 1
            elif line.startswith("usemtl "):
                mats.append(line.split()[1])
    return {"vertices": verts, "normals": normals, "faces": faces,
            "materials": sorted(set(mats))}


def obj_tri_count(mesh):
    n = 0
    for f in mesh.faces:
        n += max(0, len(f) - 2)
    return n
