"""Multi-node glTF export.

The single-mesh exporter welds every part into one primitive, which makes a car
that can only slide around: nothing can be rotated independently because there
are no nodes to rotate. This writer keeps a node per part and re-bases each
part's vertices on its own pivot, so a wheel's local origin sits at its axle and
a steering wheel turns about its own column.
"""

import json
import math
import os
import struct

from .geom import Mesh, vcross, vdot, vnorm, vsub
from .materials import MATERIALS, alpha, to_linear

_COMP_FLOAT = 5126
_COMP_UINT = 5125
_ARRAY_BUFFER = 34962
_ELEMENT_ARRAY_BUFFER = 34963


class _Buffer:
    def __init__(self):
        self.data = bytearray()
        self.views = []

    def push(self, raw, target=None):
        while len(self.data) % 4:
            self.data.append(0)
        offset = len(self.data)
        self.data.extend(raw)
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(raw)}
        if target:
            view["target"] = target
        self.views.append(view)
        return len(self.views) - 1


def _pbr(key):
    m = MATERIALS[key]
    r, g, b = to_linear(m["color"])
    out = {
        "name": key,
        "pbrMetallicRoughness": {
            "baseColorFactor": [round(r, 6), round(g, 6), round(b, 6), round(alpha(key), 6)],
            "metallicFactor": round(float(m.get("metallic", 0.0)), 6),
            "roughnessFactor": round(float(m.get("roughness", 0.5)), 6),
        },
        "doubleSided": False,
    }
    if alpha(key) < 0.999:
        out["alphaMode"] = "BLEND"
    em, strength = m.get("emission", (None, 0.0))
    if em:
        er, eg, eb = to_linear(em)
        out["emissiveFactor"] = [round(min(1.0, er * strength), 6),
                                 round(min(1.0, eg * strength), 6),
                                 round(min(1.0, eb * strength), 6)]
    return out


def _group_by_material(mesh):
    order, buckets = [], {}
    for fi, name in enumerate(mesh.fmat):
        if name not in buckets:
            buckets[name] = []
            order.append(name)
        buckets[name].append(fi)
    return [(n, buckets[n]) for n in order]


def _xf(p):
    """Z-up authoring space to glTF's Y-up: (x, y, z) -> (x, z, -y)."""
    return (p[0], p[2], -p[1])


def write_glb_parts(parts, path, scene_name="car", generator="carmodel"):
    """Write one node per part, each pivoted on its own origin.

    `parts` is a list of dicts:
        name    node name
        mesh    geom.Mesh in car space (millimetres, Z-up)
        pivot   (x, y, z) car-space point that becomes the node's local origin
        extra   optional dict merged into the node, e.g. {"rotation": [...]}

    Node transforms are written in glTF space, so a pivot expressed in the
    authoring frame is converted the same way the vertices are.
    """
    buf = _Buffer()
    accessors = []
    materials = []
    mat_index = {}
    nodes = []
    scene_nodes = []

    for part in parts:
        mesh = part["mesh"]
        pivot = _xf(part.get("pivot", (0.0, 0.0, 0.0)))
        primitives = []

        for mat_key, face_ids in _group_by_material(mesh):
            if mat_key not in mat_index:
                mat_index[mat_key] = len(materials)
                materials.append(_pbr(mat_key))
            mi = mat_index[mat_key]

            remap = {}
            pos, nrm, tris = [], [], []
            for fi in face_ids:
                fn = _xf(mesh.face_normal(fi))
                local = []
                for vi in mesh.faces[fi]:
                    sig = (vi, fi)
                    if sig not in remap:
                        remap[sig] = len(pos)
                        p = _xf(mesh.verts[vi])
                        # Re-base on the pivot so the node's own transform is
                        # the only thing that moves it.
                        pos.append((p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]))
                        nrm.append(fn)
                    local.append(remap[sig])
                for k in range(1, len(local) - 1):
                    tris.append((local[0], local[k], local[k + 1]))

            if not tris:
                continue

            pos_raw = b"".join(struct.pack("<3f", *p) for p in pos)
            nrm_raw = b"".join(struct.pack("<3f", *n) for n in nrm)
            idx_raw = b"".join(struct.pack("<3I", *t) for t in tris)

            vpos = buf.push(pos_raw, _ARRAY_BUFFER)
            vnrm = buf.push(nrm_raw, _ARRAY_BUFFER)
            vidx = buf.push(idx_raw, _ELEMENT_ARRAY_BUFFER)

            a_pos = len(accessors)
            accessors.append({
                "bufferView": vpos, "componentType": _COMP_FLOAT, "count": len(pos),
                "type": "VEC3",
                "min": [round(min(p[i] for p in pos), 4) for i in range(3)],
                "max": [round(max(p[i] for p in pos), 4) for i in range(3)],
            })
            a_nrm = len(accessors)
            accessors.append({"bufferView": vnrm, "componentType": _COMP_FLOAT,
                              "count": len(nrm), "type": "VEC3"})
            a_idx = len(accessors)
            accessors.append({"bufferView": vidx, "componentType": _COMP_UINT,
                              "count": len(tris) * 3, "type": "SCALAR"})

            primitives.append({
                "attributes": {"POSITION": a_pos, "NORMAL": a_nrm},
                "indices": a_idx, "material": mi, "mode": 4,
            })

        if not primitives:
            continue

        node = {
            "name": part["name"],
            "translation": [round(pivot[0], 4), round(pivot[1], 4), round(pivot[2], 4)],
        }
        for k, v in (part.get("extra") or {}).items():
            node[k] = v
        nodes.append({"node": node, "primitives": primitives})
        scene_nodes.append(len(nodes) - 1)

    gl_meshes = []
    gl_nodes = []
    for i, entry in enumerate(nodes):
        node = dict(entry["node"])
        node["mesh"] = i
        gl_nodes.append(node)
        gl_meshes.append({"name": node["name"], "primitives": entry["primitives"]})

    while len(buf.data) % 4:
        buf.data.append(0)

    gltf = {
        "asset": {"version": "2.0", "generator": generator},
        "scene": 0,
        "scenes": [{"name": scene_name, "nodes": scene_nodes}],
        "nodes": gl_nodes,
        "meshes": gl_meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": buf.views,
        "buffers": [{"byteLength": len(buf.data)}],
    }

    json_raw = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    while len(json_raw) % 4:
        json_raw += b" "
    bin_raw = bytes(buf.data)
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


def verify_glb_nodes(path):
    """Read the GLB back and report its node tree."""
    with open(path, "rb") as fh:
        raw = fh.read()
    magic, version, total = struct.unpack("<4sII", raw[:12])
    assert magic == b"glTF" and version == 2, "bad GLB header"
    assert total == len(raw), "length mismatch"
    jlen = struct.unpack("<I", raw[12:16])[0]
    gltf = json.loads(raw[20:20 + jlen].decode("utf-8"))

    tris = 0
    for m in gltf["meshes"]:
        for p in m["primitives"]:
            tris += gltf["accessors"][p["indices"]]["count"] // 3
    return {
        "bytes": len(raw),
        "nodes": len(gltf["nodes"]),
        "node_names": [n["name"] for n in gltf["nodes"]],
        "materials": len(gltf["materials"]),
        "triangles": tris,
    }
