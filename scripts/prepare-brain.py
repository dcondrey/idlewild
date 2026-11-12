"""Build public/models/brain.glb from the Brain for Blender DK pial and subcortical OBJ archives.

Run: Blender -b --factory-startup --disable-autoexec --python-exit-code 1 -P scripts/prepare-brain.py -- [--retrieved YYYY-MM-DD]
     [--source-dir .local/assets/brain] [--output public/models/brain.glb] [--receipt public/models/brain.receipt.json]

Coordinates: FreeSurfer surface RAS (R, A, S in mm) -> glTF metres with X = -R, Y = S, Z = A.
The anterior pole faces +Z (toward the viewer, like the characters), superior is +Y and patient-left is +X. The map has
determinant +1, so no mirroring occurs. Hemisphere identity lives in mesh names, not in the sign of X.
"""

import argparse
import datetime
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import sys
import tarfile
import tempfile

import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree


ROOT = Path(__file__).resolve().parents[1]
MAX_TRIANGLES = 150_000
TARGET_TRIANGLES = 140_000
MIN_SUBCORTICAL_TRIANGLES = 300
SCALE = 0.001
MAX_ENTRY_BYTES = 64 * 1024 * 1024
MAX_VERTICES = 400_000
MAX_FACES = 800_000
ARCHIVES = (("pial_DK_obj.tar.bz2", "pial_DK_obj"), ("subcortical_obj.tar.bz2", "subcortical_obj"))
CREDIT = (
    "Brain for Blender (CC) Anderson Winkler | brainder.org; https://brainder.org/research/brain-for-blender/; "
    "CC BY-SA 3.0 https://creativecommons.org/licenses/by-sa/3.0/; "
    "Modified for Idlewild: welded and decimated surfaces, FreeSurfer surface RAS mapped to glTF metres (X=-R, Y=S, Z=A), "
    "shared hemisphere materials. Share-alike: distribute adaptations of this file under CC BY-SA 3.0 or a compatible license."
)
MATERIALS = {"lh": ("brain-lh", (0.82, 0.74, 0.72, 1)), "rh": ("brain-rh", (0.82, 0.74, 0.72, 1)), "sub": ("brain-subcortical", (0.70, 0.66, 0.68, 1))}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha256_of(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def read_archive(path, expected_sha, directory):
    require(path.is_file(), f"Missing archive: {path}")
    require(sha256_of(path) == expected_sha, f"Archive hash differs from source.receipt.json: {path.name}")
    entries = {}
    with tarfile.open(path, "r:bz2") as tar:
        for member in tar:
            if member.isdir():
                continue
            require(member.isreg() and re.fullmatch(rf"{directory}/[A-Za-z0-9._-]+\.obj", member.name) and 0 < member.size <= MAX_ENTRY_BYTES, f"Unexpected archive member: {member.name}")
            entries[Path(member.name).stem] = tar.extractfile(member).read().decode("ascii")
    require(entries, f"Empty archive: {path.name}")
    return entries


def parse_obj(text, name):
    vertices, faces = [], []
    for line in text.splitlines():
        if line.startswith("v "):
            x, y, z = (float(value) for value in line.split()[1:4])
            require(all(math.isfinite(value) and abs(value) <= 300 for value in (x, y, z)), f"Invalid coordinate: {name}")
            vertices.append((x, y, z))
        elif line.startswith("f "):
            ids = [int(token.split("/")[0]) for token in line.split()[1:]]
            require(len(ids) >= 3 and all(1 <= i <= len(vertices) for i in ids), f"Invalid face index: {name}")
            for k in range(1, len(ids) - 1):
                faces.append((ids[0] - 1, ids[k] - 1, ids[k + 1] - 1))
        require(len(vertices) <= MAX_VERTICES and len(faces) <= MAX_FACES, f"OBJ allocation exceeded: {name}")
    require(vertices and faces, f"Empty OBJ: {name}")
    return vertices, faces


def to_blender(point):
    return (-point[0] * SCALE, -point[1] * SCALE, point[2] * SCALE)


def weld(parcels):
    index, coordinates, triangles, labels = {}, [], [], []
    raw = 0
    for label in sorted(parcels):
        vertices, faces = parcels[label]
        raw += len(vertices)
        remap = []
        for vertex in vertices:
            key = tuple(round(value * 1e4) for value in vertex)
            if key not in index:
                index[key] = len(coordinates)
                coordinates.append(to_blender(vertex))
            remap.append(index[key])
        for a, b, c in faces:
            triangle = (remap[a], remap[b], remap[c])
            if len(set(triangle)) == 3:
                triangles.append(triangle)
                labels.append(label)
    return coordinates, triangles, labels, raw - len(coordinates)


def new_object(name, coordinates, triangles):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(coordinates, [], triangles)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def decimated(name, coordinates, triangles, ratio):
    if ratio >= 1:
        return coordinates, triangles
    obj = new_object(name + "-source", coordinates, triangles)
    modifier = obj.modifiers.new("decimate", "DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    modifier.ratio = ratio
    modifier.use_collapse_triangulate = True
    bpy.context.view_layer.update()
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=bpy.context.evaluated_depsgraph_get())
    mesh.calc_loop_triangles()
    result_coordinates = [tuple(vertex.co) for vertex in mesh.vertices]
    result_triangles = [tuple(triangle.vertices) for triangle in mesh.loop_triangles]
    bpy.data.objects.remove(obj)
    bpy.data.meshes.remove(mesh)
    require(result_triangles, f"Decimation removed all faces: {name}")
    return result_coordinates, result_triangles


def orient_outward(coordinates, triangles):
    center = Vector((sum(c[0] for c in coordinates), sum(c[1] for c in coordinates), sum(c[2] for c in coordinates))) / len(coordinates)
    volume = 0.0
    for a, b, c in triangles:
        va, vb, vc = (Vector(coordinates[i]) - center for i in (a, b, c))
        volume += va.dot(vb.cross(vc))
    return ([(a, c, b) for a, b, c in triangles], True) if volume < 0 else (triangles, False)


def vertex_normals(coordinates, triangles):
    mesh = bpy.data.meshes.new("normals")
    mesh.from_pydata(coordinates, [], triangles)
    mesh.update()
    normals = [tuple(item.vector) for item in mesh.vertex_normals]
    bpy.data.meshes.remove(mesh)
    return normals


def finish_mesh(name, coordinates, triangles, normals, material):
    used = sorted({i for triangle in triangles for i in triangle})
    local = {old: new for new, old in enumerate(used)}
    obj = new_object(name, [coordinates[i] for i in used], [tuple(local[i] for i in triangle) for triangle in triangles])
    mesh = obj.data
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.normals_split_custom_set_from_vertices([normals[i] for i in used])
    mesh.materials.append(material)
    return obj, len(triangles)


def cortex(label_side, parcels, ratio, materials):
    coordinates, triangles, labels, welded = weld(parcels)
    original = triangles
    tree = KDTree(len(original))
    for index, (a, b, c) in enumerate(original):
        tree.insert((Vector(coordinates[a]) + Vector(coordinates[b]) + Vector(coordinates[c])) / 3, index)
    tree.balance()
    new_coordinates, new_triangles = decimated(f"ctx-{label_side}", coordinates, triangles, ratio)
    new_triangles, flipped = orient_outward(new_coordinates, new_triangles)
    normals = vertex_normals(new_coordinates, new_triangles)
    groups = {}
    for triangle in new_triangles:
        a, b, c = triangle
        centroid = (Vector(new_coordinates[a]) + Vector(new_coordinates[b]) + Vector(new_coordinates[c])) / 3
        groups.setdefault(labels[tree.find(centroid)[1]], []).append(triangle)
    missing = sorted(set(parcels) - set(groups))
    require(not missing, f"Decimation erased parcels in {label_side}: {missing}; raise the budget or lower the ratio floor")
    objects, total = [], 0
    for label in sorted(groups):
        obj, count = finish_mesh(f"ctx-{label_side}-{label}", new_coordinates, groups[label], normals, materials[label_side])
        objects.append(obj)
        total += count
    return objects, total, welded, flipped


def build(archive_data, ratio, materials):
    objects, report = [], {"welded": {}, "flipped": []}
    total = 0
    for side in ("lh", "rh"):
        parcels = {}
        for stem, text in archive_data["pial_DK_obj"].items():
            match = re.fullmatch(rf"{side}\.pial\.DK\.([a-z]+)", stem)
            if match:
                parcels[match[1]] = parse_obj(text, stem)
        require(len(parcels) >= 34, f"Expected the DK parcels for {side}, found {len(parcels)}")
        side_objects, count, welded, flipped = cortex(side, parcels, ratio, materials)
        objects += side_objects
        total += count
        report["welded"][side] = welded
        if flipped:
            report["flipped"].append(side)
    for name, text in sorted(archive_data["subcortical_obj"].items()):
        vertices, faces = parse_obj(text, name)
        coordinates = [to_blender(vertex) for vertex in vertices]
        floor = min(1.0, MIN_SUBCORTICAL_TRIANGLES / len(faces))
        new_coordinates, new_triangles = decimated(name, coordinates, faces, max(ratio, floor))
        new_triangles, flipped = orient_outward(new_coordinates, new_triangles)
        if flipped:
            report["flipped"].append(name)
        obj, count = finish_mesh(name, new_coordinates, new_triangles, vertex_normals(new_coordinates, new_triangles), materials["sub"])
        objects.append(obj)
        total += count
    return objects, total, report


def validate_glb(path, expected_names):
    require(0 < path.stat().st_size < 32 * 1024 * 1024, "GLB size out of bounds")
    data = path.read_bytes()
    magic, version, length, json_length, chunk_type = struct.unpack_from("<5I", data)
    require(magic == 0x46546C67 and version == 2 and length == len(data) and chunk_type == 0x4E4F534A, "Invalid GLB container")
    document = json.loads(data[20:20 + json_length])
    require(document["asset"].get("copyright") == CREDIT, "GLB attribution missing")
    require(len(document.get("buffers", [])) == 1 and "uri" not in document["buffers"][0] and not document.get("images"), "GLB must embed one buffer and no images")
    require({material["name"] for material in document["materials"]} == {name for name, _ in MATERIALS.values()}, "Unexpected material set")
    accessors = document["accessors"]
    nodes = {node["name"]: node for node in document["nodes"] if "mesh" in node}
    require(set(nodes) == set(expected_names), f"Mesh names differ: missing {sorted(set(expected_names) - set(nodes))[:5]}, extra {sorted(set(nodes) - set(expected_names))[:5]}")
    triangles, vertices, centers = 0, 0, {}
    low, high = [math.inf] * 3, [-math.inf] * 3
    for name, node in nodes.items():
        primitives = document["meshes"][node["mesh"]]["primitives"]
        require(len(primitives) == 1 and "NORMAL" in primitives[0]["attributes"], f"Mesh needs one primitive with normals: {name}")
        position = accessors[primitives[0]["attributes"]["POSITION"]]
        triangles += accessors[primitives[0]["indices"]]["count"] // 3
        vertices += position["count"]
        centers[name] = [(a + b) / 2 for a, b in zip(position["min"], position["max"])]
        low = [min(a, b) for a, b in zip(low, position["min"])]
        high = [max(a, b) for a, b in zip(high, position["max"])]
    require(triangles <= MAX_TRIANGLES, f"Triangle budget exceeded: {triangles}")
    require(centers["ctx-lh-frontalpole"][2] > centers["ctx-lh-lateraloccipital"][2], "Anterior is not +Z")
    require(centers["ctx-lh-superiorfrontal"][1] > centers["ctx-lh-inferiortemporal"][1], "Superior is not +Y")
    require(centers["ctx-lh-precentral"][0] > 0 > centers["ctx-rh-precentral"][0], "Patient-left is not +X")
    return {"bytes": len(data), "meshes": len(nodes), "vertices": vertices, "triangles": triangles, "bounds": {"min": low, "max": high}}


def convert(source_dir, output_path, receipt_path, retrieved):
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    sources = json.loads((source_dir / "source.receipt.json").read_text(encoding="utf-8"))
    archive_data, archive_receipts = {}, []
    for name, directory in ARCHIVES:
        entry = next((item for item in sources if item["url"].endswith("/" + name)), None)
        require(entry is not None, f"source.receipt.json lacks {name}")
        archive_data[directory] = read_archive(source_dir / name, entry["sha256"], directory)
        archive_receipts.append(entry)
    cortex_stems = [stem for stem in archive_data["pial_DK_obj"] if re.fullmatch(r"[lr]h\.pial\.DK\.[a-z]+", stem)]
    require(len(cortex_stems) == len(archive_data["pial_DK_obj"]), "Unexpected pial archive member names")
    expected_names = [f"ctx-{stem[:2]}-{stem.rsplit('.', 1)[1]}" for stem in cortex_stems] + sorted(archive_data["subcortical_obj"])
    source_triangles = sum(len(parse_obj(text, stem)[1]) for group in archive_data.values() for stem, text in group.items())
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj)
    materials = {}
    for key, (name, color) in MATERIALS.items():
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        shader = material.node_tree.nodes["Principled BSDF"]
        shader.inputs["Base Color"].default_value = color
        shader.inputs["Roughness"].default_value = 0.6
        shader.inputs["Metallic"].default_value = 0
        material.diffuse_color = color
        materials[key] = material
    ratio = min(1.0, TARGET_TRIANGLES / source_triangles)
    for attempt in range(5):
        for obj in list(bpy.data.objects):
            bpy.data.objects.remove(obj)
        objects, total, report = build(archive_data, ratio, materials)
        if total <= MAX_TRIANGLES:
            break
        ratio *= 0.95 * MAX_TRIANGLES / total
    require(total <= MAX_TRIANGLES, f"Could not fit {MAX_TRIANGLES} triangles; last total {total}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="brain-conversion-", dir=output_path.parent) as temporary:
        pending = Path(temporary) / "brain.glb"
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        result = bpy.ops.export_scene.gltf(
            filepath=str(pending), export_format="GLB", use_selection=True, export_copyright=CREDIT, export_extras=False,
            export_apply=False, export_yup=True, export_materials="EXPORT", export_normals=True, export_texcoords=False,
            export_vertex_color="NONE", export_animations=False, export_cameras=False, export_lights=False,
            export_skins=False, export_morph=False,
        )
        require(result == {"FINISHED"}, "glTF exporter did not finish")
        summary = validate_glb(pending, expected_names)
        pending.replace(output_path)
    summary.update({"sourceTriangles": source_triangles, "decimationRatio": ratio, "weldedVertices": report["welded"], "windingFlipped": report["flipped"]})
    receipt = {
        "title": "Brain for Idlewild", "author": "Anderson Winkler (brainder.org)",
        "source": "https://brainder.org/research/brain-for-blender/",
        "sourceDownloads": archive_receipts,
        "license": "CC BY-SA 3.0", "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0/",
        "shareAlike": "Adaptations and redistributions of brain.glb must be licensed under CC BY-SA 3.0 or a compatible license with attribution and an indication of changes.",
        "copyright": CREDIT, "retrieved": retrieved,
        "derivation": "scripts/prepare-brain.py, Blender 4.5.9 LTS, scripts disabled",
        "sha256": sha256_of(output_path), "bytes": output_path.stat().st_size,
        "meshes": summary["meshes"], "vertices": summary["vertices"], "triangles": summary["triangles"], "sourceTriangles": source_triangles,
        "triangleBudget": MAX_TRIANGLES, "decimationRatio": round(ratio, 5),
        "coordinates": "FreeSurfer surface RAS (mm) -> glTF metres: X=-R, Y=S, Z=A; anterior +Z (faces viewer), patient-left +X, determinant +1 (no mirroring)",
        "materials": "one shared material per hemisphere (brain-lh, brain-rh) plus brain-subcortical; no vertex colors; clone a mesh's material to highlight it",
        "normals": "hemisphere-smooth custom normals so parcel borders shade continuously",
        "bounds": summary["bounds"], "windingFlipped": report["flipped"],
        "meshNames": sorted(expected_names),
    }
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items()}, sort_keys=True))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=ROOT / ".local/assets/brain")
    parser.add_argument("--output", type=Path, default=ROOT / "public/models/brain.glb")
    parser.add_argument("--receipt", type=Path, default=ROOT / "public/models/brain.receipt.json")
    parser.add_argument("--retrieved", default=datetime.date.today().isoformat())
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    convert(args.source_dir.resolve(), args.output.resolve(), args.receipt.resolve(), args.retrieved)
