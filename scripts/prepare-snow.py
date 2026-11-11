"""Run with Blender --background --disable-autoexec --python-exit-code 1 --python this_file."""

import argparse
from array import array
import json
import math
from pathlib import Path
import re
import shutil
import struct
import sys
import tempfile

import bpy
from bpy_extras.anim_utils import action_get_channelbag_for_slot
from mathutils import Euler, Quaternion, Vector


ROOT = Path(__file__).resolve().parents[1]
CREDIT = (
    "Snow Rig (CC) Blender Foundation | studio.blender.org; "
    "https://studio.blender.org/characters/snow/v4/; "
    "CC BY 4.0 https://creativecommons.org/licenses/by/4.0/; "
    "Modified for Idlewild: evaluated facial morphs, reduced deformation rig, "
    "subdivision level 1, relaxed arm pose, authored idle and subtle expression clips, simplified materials, omitted outer corneas and reduced textures."
)
MESH_NAMES = (
    "GEO-snow-body", "GEO-snow-eyebrows", "GEO-snow-eyes",
    "GEO-snow-gums_lower", "GEO-snow-gums_upper", "GEO-snow-hair_base",
    "GEO-snow-head", "GEO-snow-pants", "GEO-snow-shirt",
    "GEO-snow-shoes_base", "GEO-snow-shoes_bottom", "GEO-snow-shoes_parts",
    "GEO-snow-teeth_lower", "GEO-snow-teeth_upper", "GEO-snow-tongue",
    "GEO-snow-eye_dots",
)
POSES = (
    ("BlinkLeft", "Eyemask Closed", "left"),
    ("BlinkRight", "Eyemask Closed", "right"),
    ("JawOpen", "Mouth Opensmile", "jaw"),
    ("SmileOpen", "Mouth Opensmile", "all"),
    ("BrowDown", "Eyemask Angry", "brow"),
    ("MouthFunnel", "Mouth Oo", "all"),
    ("MouthFf", "Mouth Ff", "all"),
)
POSE_FIELDS = (
    "location", "rotation_euler", "rotation_quaternion", "rotation_axis_angle", "scale",
    "bbone_curveinx", "bbone_curveinz", "bbone_curveoutx", "bbone_curveoutz",
    "bbone_easein", "bbone_easeout", "bbone_rollin", "bbone_rollout", "bbone_scalein", "bbone_scaleout",
)
CHANNEL = re.compile(r'^pose\.bones\[("(?:[^"\\]|\\.)*")\](?:\.(' + "|".join(POSE_FIELDS) + r')|\[("(?:[^"\\]|\\.)*")\])$')
MAX_VERTICES = 500_000
MAX_MORPH_VERTICES = 1_000_000
MAX_TEXTURE_PIXELS = 8_000_000
TEXTURE_MATERIALS = {"snow.hair": "hair", "snow.eyes": "eyes", "snow.pants": "pants", "snow.shirt": "shirt", "snow.shoe": "shoes"}
STALE_POSE_BONES = {"STR-TIP-Nostril.L", "STR-TIP-Nostril.R"}
STALE_POSE_PROPERTIES = {("Jaw", "preserve_volume"), ("Jaw", "teeth_follow_mouth")}
EXPRESSION_CLIPS = (("Soft smile", "SmileOpen", 0.18), ("Brow motion", "BrowDown", 0.15))


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def body_parents():
    parents = {
        "Hips": None, "Spine": "Hips", "RibCage": "Spine", "Chest": "RibCage",
        "Neck": "Chest", "Head": "Neck", "Ponytail1": "Head", "Hip_Center": "Hips",
    }
    for side in ("L", "R"):
        for name, parent in (
            ("Eye", "Head"), ("Hips", "Hips"), ("Shoulder", "Chest"),
            ("UpperArm_1", "Shoulder"), ("UpperArm_2", "UpperArm_1"),
            ("Forearm_1", "UpperArm_2"), ("Forearm_2", "Forearm_1"),
            ("Wrist", "Forearm_2"), ("Thigh_1", "Hips"), ("Thigh_2", "Thigh_1"),
            ("Knee_1", "Thigh_2"), ("Knee_2", "Knee_1"), ("Foot", "Knee_2"),
            ("Toes", "Foot"),
        ):
            parents[f"{name}.{side}"] = parent if name in ("Eye", "Hips", "Shoulder") else f"{parent}.{side}"
        for finger in ("Thumb", "Index", "Middle", "Ring", "Pinky"):
            if finger != "Thumb":
                parents[f"Finger_{finger}_Carpal.{side}"] = f"Wrist.{side}"
            for segment in range(1, 4):
                parent = f"Finger_{finger}{segment - 1}.{side}"
                if segment == 1:
                    parent = f"Wrist.{side}" if finger == "Thumb" else f"Finger_{finger}_Carpal.{side}"
                parents[f"Finger_{finger}{segment}.{side}"] = parent
    require(len(parents) == 74, "Unexpected reduced skeleton size")
    return {f"DEF-{name}": f"DEF-{parent}" if parent else None for name, parent in parents.items()}


def pose_channels(action_name):
    action = bpy.data.actions.get(action_name)
    require(action is not None, f"Missing author pose: {action_name}")
    require(abs(action.frame_range[1] - action.frame_range[0]) < 0.001, f"Expected a single-frame pose: {action_name}")
    slots = [slot for slot in action.slots if slot.target_id_type == "OBJECT"]
    require(len(slots) == 1, f"Ambiguous pose slots: {action_name}")
    bag = action_get_channelbag_for_slot(action, slots[0])
    require(bag is not None and 0 < len(bag.fcurves) <= 4096, f"Invalid pose channel count: {action_name}")
    result = []
    for curve in bag.fcurves:
        match = CHANNEL.fullmatch(curve.data_path)
        require(match is not None, f"Unsupported pose channel in {action_name}: {curve.data_path}")
        bone = json.loads(match[1])
        prop = match[2] or json.loads(match[3])
        value = curve.evaluate(action.frame_range[0])
        require(math.isfinite(value) and abs(value) <= 10_000, f"Invalid pose value in {action_name}")
        result.append((bone, prop, curve.array_index, value, match[2] is None))
    return result


def preflight_pose_channels(rig, channels):
    require(all(name not in rig.pose.bones for name in STALE_POSE_BONES), "Snow rig changed: stale nostril targets now exist")
    for name, prop in STALE_POSE_PROPERTIES:
        bone = rig.pose.bones.get(name)
        require(bone is not None and prop not in bone and prop not in bone.bl_rna.properties, f"Snow rig changed: {name}.{prop} is now defined")
    stale_names = STALE_POSE_BONES | {prop for _, prop in STALE_POSE_PROPERTIES}
    owners = [*bpy.data.objects, *bpy.data.shape_keys, *bpy.data.armatures, *bpy.data.meshes, *bpy.data.lattices, *bpy.data.materials, *bpy.data.node_groups, *bpy.data.scenes, *bpy.data.worlds]
    owners += [owner.node_tree for owner in owners if getattr(owner, "node_tree", None)]
    for owner in {owner.as_pointer(): owner for owner in owners}.values():
        animation = getattr(owner, "animation_data", None)
        if not animation:
            continue
        for curve in animation.drivers:
            require(curve.driver.is_valid, f"Invalid driver during pose preflight: {owner.name}: {curve.data_path}")
            if owner == rig:
                require(not any(name in curve.data_path for name in stale_names), f"Stale pose target has a driver: {curve.data_path}")
            for variable in curve.driver.variables:
                for target in variable.targets:
                    if target.id == rig:
                        path = target.data_path
                        require(not any(name in path for name in stale_names) and target.bone_target not in STALE_POSE_BONES, f"Driver depends on a stale pose target: {owner.name}: {curve.data_path}")
    constraints = [constraint for obj in bpy.data.objects for constraint in obj.constraints]
    constraints += [constraint for obj in bpy.data.objects if obj.type == "ARMATURE" for bone in obj.pose.bones for constraint in bone.constraints]
    for constraint in constraints:
        references = [constraint, *getattr(constraint, "targets", ())]
        for reference in references:
            for field in ("subtarget", "bone_target", "data_path"):
                value = getattr(reference, field, "")
                require(not any(name in value for name in stale_names), f"Constraint depends on a stale pose target: {constraint.name}")
    skipped_bones, skipped_properties, errors = set(), set(), []
    filtered = {}
    for action, values in channels.items():
        filtered[action] = []
        for name, prop, index, value, custom in values:
            # Snow v4.2 pose assets retain two removed bones and two unused Jaw properties.
            if name in STALE_POSE_BONES:
                skipped_bones.add(name)
                continue
            bone = rig.pose.bones.get(name)
            label = f"{action}: {name}.{prop}[{index}]"
            if bone is None:
                errors.append(f"missing bone {label}")
                continue
            if custom and (name, prop) in STALE_POSE_PROPERTIES:
                require(index == 0 and value == 1, f"Stale pose property changed: {label}")
                skipped_properties.add(f"{name}.{prop}")
                continue
            if custom:
                valid = prop in bone and isinstance(bone[prop], (int, float)) and index == 0
            else:
                definition = bone.bl_rna.properties.get(prop)
                current = getattr(bone, prop, None)
                valid = definition is not None and not definition.is_readonly
                valid = valid and (index == 0 if isinstance(current, (int, float)) else current is not None and 0 <= index < len(current))
            if not valid:
                errors.append(f"unsupported channel {label}")
                continue
            filtered[action].append((name, prop, index, value, custom))
    require(not errors, "Pose compatibility preflight failed: " + "; ".join(errors[:12]))
    return filtered, sorted(skipped_bones), sorted(skipped_properties)


def apply_pose(rig, channels, subset="all"):
    count = 0
    for name, prop, index, value, custom in channels:
        selected = subset == "all" or (subset == "left" and name.endswith(".L")) or (subset == "right" and name.endswith(".R"))
        selected |= subset == "jaw" and name == "Jaw"
        selected |= subset == "brow" and ("brow" in name.lower() or "forehead" in name.lower())
        if not selected:
            continue
        bone = rig.pose.bones.get(name)
        require(bone is not None, f"Pose references missing bone: {name}")
        if custom:
            require(prop in bone and isinstance(bone[prop], (int, float)), f"Unsupported pose property: {name}.{prop}")
            bone[prop] = value
        else:
            values = getattr(bone, prop)
            if isinstance(values, (int, float)):
                require(index == 0, f"Invalid pose component: {name}.{prop}")
                setattr(bone, prop, value)
            else:
                require(0 <= index < len(values), f"Invalid pose component: {name}.{prop}")
                values[index] = value
        count += 1
    require(count > 0, f"Pose has no {subset} controls")


def snapshot_pose(rig):
    result = []
    for bone in rig.pose.bones:
        transforms = {name: value if isinstance(value, (int, float)) else tuple(value) for name in POSE_FIELDS for value in [getattr(bone, name)]}
        properties = {key: value for key, value in bone.items() if isinstance(value, (int, float))}
        result.append((bone.name, transforms, properties))
    return result


def restore_pose(rig, snapshot):
    for name, transforms, properties in snapshot:
        bone = rig.pose.bones[name]
        for key, value in transforms.items():
            setattr(bone, key, value)
        for key, value in properties.items():
            bone[key] = value
    rig.update_tag()
    bpy.context.view_layer.update()


def geometry(source, depsgraph):
    evaluated = source.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)
    require(0 < len(mesh.vertices) <= MAX_VERTICES and len(mesh.loops) <= 2_000_000, f"Geometry allocation exceeded: {source.name}")
    mesh.transform(evaluated.matrix_world)
    coordinates = array("f", [0.0]) * (len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", coordinates)
    require(all(math.isfinite(value) and abs(value) < 1000 for value in coordinates), f"Invalid coordinates: {source.name}")
    indices = array("I", [0]) * len(mesh.loops)
    mesh.loops.foreach_get("vertex_index", indices)
    topology = (tuple(poly.loop_total for poly in mesh.polygons), indices.tobytes())
    return mesh, coordinates, topology


def make_rig(source, parents, collection):
    data = bpy.data.armatures.new("SnowRuntimeRig")
    rig = bpy.data.objects.new("SnowRuntimeRig", data)
    collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for name in parents:
        original = source.pose.bones.get(name)
        require(original is not None and original.bone.use_deform, f"Missing deformation bone: {name}")
        bone = data.edit_bones.new(name)
        bone.matrix = source.matrix_world @ original.matrix
        bone.length = max((source.matrix_world @ original.tail - source.matrix_world @ original.head).length, 0.001)
        bone.use_deform = True
    for name, parent in parents.items():
        if parent:
            data.edit_bones[name].parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def assign_weights(source, target, rig, parents):
    deform = {bone.name for bone in bpy.data.objects["RIG-Snow"].data.bones if bone.use_deform}
    names = {group.index: group.name for group in source.vertex_groups}
    for group in source.vertex_groups:
        target.vertex_groups.new(name=group.name)
    rigid_head = source.name in {"GEO-snow-gums_lower", "GEO-snow-gums_upper", "GEO-snow-teeth_lower", "GEO-snow-teeth_upper"}
    max_discarded = 0.0
    vertex_weights = []
    for vertex in target.data.vertices:
        weights = {}
        for membership in vertex.groups:
            name = names.get(membership.group)
            if name not in deform:
                continue
            weight = membership.weight
            require(math.isfinite(weight) and 0 <= weight <= 1, f"Invalid skin weight: {source.name}")
            mapped = name if name in parents else "DEF-Head"
            weights[mapped] = weights.get(mapped, 0.0) + weight
        if not weights and rigid_head:
            weights["DEF-Head"] = 1.0
        total = sum(weights.values())
        require(total > 1e-8, f"Unweighted vertex {vertex.index}: {source.name}")
        ordered = sorted(weights.items(), key=lambda item: (-item[1], item[0]))
        discarded = sum(value for _, value in ordered[4:]) / total
        max_discarded = max(max_discarded, discarded)
        require(discarded <= 0.05, f"Skin influence reduction exceeds 5%: {source.name} vertex {vertex.index}")
        kept = sum(value for _, value in ordered[:4])
        vertex_weights.append([(name, value / kept) for name, value in ordered[:4]])
    target.vertex_groups.clear()
    groups = {name: target.vertex_groups.new(name=name) for name in parents}
    for index, weights in enumerate(vertex_weights):
        for name, value in weights:
            groups[name].add([index], value, "REPLACE")
    modifier = target.modifiers.new("SnowRuntimeSkin", "ARMATURE")
    modifier.object = rig
    target.parent = rig
    return max_discarded


def resize_image(path, size, work):
    require(path.is_file(), f"Missing texture: {path.name}")
    with path.open("rb") as stream:
        header = stream.read(24)
    require(len(header) == 24 and header[:8] == b"\x89PNG\r\n\x1a\n", f"Expected PNG: {path.name}")
    width, height = struct.unpack(">II", header[16:24])
    require(0 < width <= 4096 and 0 < height <= 4096, f"Source texture dimensions exceeded: {path.name}")
    image = bpy.data.images.load(str(path), check_existing=False)
    factor = min(1, size / max(width, height))
    image.scale(max(1, round(width * factor)), max(1, round(height * factor)))
    image.name = f"Snow_{path.stem}_{size}"
    image.filepath_raw = str(work / f"{image.name}.png")
    image.file_format = "PNG"
    image.save()
    image.pack()
    return image


def texture_images(source_dir, work):
    root = source_dir / "textures"
    textures = {name: resize_image(root / f"{name}_diffuse.png", 1024, work) for name in ("eyes", "hair", "pants", "shirt", "shoes")}
    atlas = bpy.data.images.new("Snow_skin_atlas", width=1024, height=1024, alpha=True)
    pixels = array("f", [0.0]) * (1024 * 1024 * 4)
    for tile, (x, y) in zip((1001, 1002, 1003), ((0, 0), (512, 0), (0, 512))):
        image = resize_image(root / f"skin_diffuse.{tile}.png", 512, work)
        require(tuple(image.size) == (512, 512), "Skin tiles must be square")
        tile_pixels = array("f", [0.0]) * (512 * 512 * 4)
        image.pixels.foreach_get(tile_pixels)
        for row in range(512):
            offset = ((y + row) * 1024 + x) * 4
            pixels[offset:offset + 512 * 4] = tile_pixels[row * 512 * 4:(row + 1) * 512 * 4]
        bpy.data.images.remove(image)
    atlas.pixels.foreach_set(pixels)
    atlas.update()
    atlas.filepath_raw = str(work / "Snow_skin_atlas.png")
    atlas.file_format = "PNG"
    atlas.save()
    atlas.pack()
    textures["skin"] = atlas
    require(sum(image.size[0] * image.size[1] for image in textures.values()) <= MAX_TEXTURE_PIXELS, "Texture pixel budget exceeded")
    return textures


def principled_nodes(tree, seen=None):
    seen = set() if seen is None else seen
    if tree is None or tree.as_pointer() in seen:
        return []
    seen.add(tree.as_pointer())
    result = []
    for node in tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            result.append(node)
        elif node.type == "GROUP":
            result.extend(principled_nodes(node.node_tree, seen))
    return result


def runtime_material(source, textures, cache):
    if source.name in cache:
        return cache[source.name]
    name = source.name
    texture_key = "skin" if name.startswith("snow.skin") else TEXTURE_MATERIALS.get(name)
    material = bpy.data.materials.new(f"Snow_{name.removeprefix('snow.')}")
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    originals = principled_nodes(source.node_tree)
    color = tuple(originals[0].inputs["Base Color"].default_value) if originals else (1, 1, 1, 1)
    roughness = float(originals[0].inputs["Roughness"].default_value) if originals else 0.25
    require(all(math.isfinite(v) and 0 <= v <= 1 for v in color) and math.isfinite(roughness), f"Invalid material: {name}")
    shader.inputs["Base Color"].default_value = (1, 1, 1, 1) if texture_key else color
    shader.inputs["Roughness"].default_value = max(0.05, min(1, roughness))
    shader.inputs["Metallic"].default_value = 0
    if texture_key:
        image = material.node_tree.nodes.new("ShaderNodeTexImage")
        image.image = textures[texture_key]
        material.node_tree.links.new(image.outputs["Color"], shader.inputs["Base Color"])
    if name == "snow.eyes":
        shader.inputs["Roughness"].default_value = 0.22
    material.diffuse_color = tuple(shader.inputs["Base Color"].default_value)
    cache[name] = material
    return material


def prepare_uv(mesh, source):
    materials = [slot.material for slot in source.material_slots]
    require(materials and all(material is not None for material in materials), f"Missing material: {source.name}")
    require(all(poly.material_index < len(materials) for poly in mesh.polygons), f"Invalid material slot: {source.name}")
    textured = any(material.name.startswith("snow.skin") or material.name in TEXTURE_MATERIALS for material in materials)
    render_uvs = [layer for layer in mesh.uv_layers if layer.active_render]
    if not render_uvs and not textured:
        return
    require(len(render_uvs) == 1, f"Expected one render UV map: {source.name}")
    selected_name = render_uvs[0].name
    for layer in list(mesh.uv_layers):
        if layer.name != selected_name:
            mesh.uv_layers.remove(layer)
    selected = mesh.uv_layers[selected_name]
    mesh.uv_layers.active = selected
    selected.active_render = True
    for poly in mesh.polygons:
        material = materials[poly.material_index]
        if not material.name.startswith("snow.skin"):
            continue
        coordinates = [selected.data[index].uv for index in poly.loop_indices]
        tile = math.floor(sum(uv.x for uv in coordinates) / len(coordinates))
        require(tile in (0, 1, 2), f"Unsupported skin tile: {source.name}")
        x, y = ((0, 0), (1, 0), (0, 1))[tile]
        for uv in coordinates:
            require(tile - 0.001 <= uv.x <= tile + 1.001 and -0.001 <= uv.y <= 1.001, f"Skin polygon crosses tile boundary: {source.name}")
            uv.x = (max(0, min(1, uv.x - tile)) + x) / 2
            uv.y = (max(0, min(1, uv.y)) + y) / 2


def add_expression_clips(path):
    require(0 < path.stat().st_size < 32 * 1024 * 1024, "Base GLB must be smaller than 32 MiB")
    data = path.read_bytes()
    magic, version, length, json_length, chunk_type = struct.unpack_from("<5I", data)
    require(magic == 0x46546C67 and version == 2 and length == len(data) and chunk_type == 0x4E4F534A, "Invalid base GLB container")
    document = json.loads(data[20:20 + json_length])
    animations = document.get("animations", [])
    require(len(animations) == 1 and animations[0].get("name") == "Idle", "Expected one base Idle before expression clip construction")
    idle = animations[0]
    require(0 < len(idle["channels"]) <= 256 and len(idle["samplers"]) <= 256, "Idle track budget exceeded")
    require(all(channel["target"]["path"] in ("translation", "rotation", "scale") for channel in idle["channels"]), "Idle contains unexpected non-transform tracks")
    require(len(document.get("buffers", [])) == 1 and "uri" not in document["buffers"][0], "Base GLB must have one embedded buffer")
    nodes = document.get("nodes", [])
    require(len(nodes) <= 256, "Base GLB node budget exceeded")
    for name in ("DEF-UpperArm_1.L", "DEF-UpperArm_1.R"):
        matches = [index for index, node in enumerate(nodes) if node.get("name") == name]
        require(len(matches) == 1 and any(channel["target"].get("node") == matches[0] and channel["target"]["path"] == "rotation" for channel in idle["channels"]), f"Idle is missing the relaxed arm rotation: {name}")
    binary_at = 20 + json_length
    binary_length, binary_type = struct.unpack_from("<II", data, binary_at)
    declared_length = document["buffers"][0]["byteLength"]
    require(binary_type == 0x004E4942 and binary_at + 8 + binary_length == len(data) and 0 <= binary_length - declared_length <= 3, "Invalid base GLB binary chunk")
    binary = bytearray(data[binary_at + 8:binary_at + 8 + declared_length])
    accessors, views = document["accessors"], document["bufferViews"]

    def append_scalars(values):
        require(0 < len(values) <= 61 * 32 and all(math.isfinite(value) for value in values), "Expression accessor allocation or value is invalid")
        encoded = struct.pack(f"<{len(values)}f", *values)
        samples = [value for (value,) in struct.iter_unpack("<f", encoded)]
        binary.extend(b"\0" * (-len(binary) % 4))
        offset = len(binary)
        binary.extend(encoded)
        require(len(binary) < 32 * 1024 * 1024, "Expression buffer budget exceeded")
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(encoded)})
        accessors.append({"bufferView": len(views) - 1, "componentType": 5126, "count": len(samples), "type": "SCALAR", "min": [min(samples)], "max": [max(samples)]})
        return len(accessors) - 1

    time_accessor = append_scalars([frame / 30 for frame in range(61)])
    for name, morph_name, ceiling in EXPRESSION_CLIPS:
        clip = {"name": name, "channels": [{"sampler": channel["sampler"], "target": dict(channel["target"])} for channel in idle["channels"]], "samplers": [dict(sampler) for sampler in idle["samplers"]]}
        affected = 0
        for node_index, node in enumerate(nodes):
            if "mesh" not in node:
                continue
            mesh = document["meshes"][node["mesh"]]
            names = mesh.get("extras", {}).get("targetNames", [])
            if morph_name not in names:
                continue
            require(0 < len(names) <= 32 and len(set(names)) == len(names), "Invalid expression morph names")
            require(all(len(primitive.get("targets", [])) == len(names) for primitive in mesh["primitives"]), "Expression morph dimensions do not match geometry")
            neutral = node.get("weights", mesh.get("weights", [0.0] * len(names)))
            require(len(neutral) == len(names) and all(value == 0 for value in neutral), "Expression clip requires neutral default morph weights")
            morph_index = names.index(morph_name)
            weights = []
            for frame in range(61):
                amount = 0.0 if frame in (0, 60) else ceiling * (1 - 1e-6) * math.sin(math.pi * frame / 60) ** 2
                weights.extend(amount if index == morph_index else 0.0 for index in range(len(names)))
            output = append_scalars(weights)
            require(0 <= accessors[output]["min"][0] <= accessors[output]["max"][0] <= ceiling, "Expression amplitude exceeded its bound")
            clip["channels"].append({"sampler": len(clip["samplers"]), "target": {"node": node_index, "path": "weights"}})
            clip["samplers"].append({"input": time_accessor, "output": output, "interpolation": "LINEAR"})
            affected += 1
        require(affected > 0, f"Expression clip has no matching morph: {morph_name}")
        require(len(clip["channels"]) <= 256 and len(clip["samplers"]) <= 256, f"Expression track budget exceeded: {name}")
        animations.append(clip)
    document["buffers"][0]["byteLength"] = len(binary)
    encoded_json = json.dumps(document, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    encoded_json += b" " * (-len(encoded_json) % 4)
    binary.extend(b"\0" * (-len(binary) % 4))
    total = 12 + 8 + len(encoded_json) + 8 + len(binary)
    require(total < 32 * 1024 * 1024, "Expression GLB size budget exceeded")
    updated = path.with_name("snow-with-expressions.glb")
    with updated.open("wb") as stream:
        stream.write(struct.pack("<5I", 0x46546C67, 2, total, len(encoded_json), 0x4E4F534A))
        stream.write(encoded_json)
        stream.write(struct.pack("<II", len(binary), 0x004E4942))
        stream.write(binary)
    updated.replace(path)


def validate_glb(path):
    require(0 < path.stat().st_size < 32 * 1024 * 1024, "GLB must be smaller than 32 MiB")
    data = path.read_bytes()
    magic, version, length, json_length, chunk_type = struct.unpack_from("<5I", data)
    require(magic == 0x46546C67 and version == 2 and length == len(data) and chunk_type == 0x4E4F534A, "Invalid GLB container")
    document = json.loads(data[20:20 + json_length])
    require(document["asset"].get("copyright") == CREDIT, "GLB attribution missing")
    require(len(document.get("nodes", [])) <= 256, "GLB node budget exceeded")
    require(all(len(skin["joints"]) <= 128 for skin in document.get("skins", [])), "GLB joint budget exceeded")
    require(len(document.get("buffers", [])) == 1 and "uri" not in document["buffers"][0], "GLB has external buffers")
    accessors = document.get("accessors", [])
    require(all("sparse" not in item for item in accessors), "GLB contains unsupported sparse accessors")
    require(not {"KHR_materials_transmission", "KHR_materials_ior"}.intersection(document.get("extensionsUsed", [])), "GLB contains unsupported material extensions")
    widths = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
    sizes = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
    allocation = sum(item["count"] * widths[item["type"]] * sizes[item["componentType"]] for item in accessors)
    require(allocation <= 64 * 1024 * 1024, "GLB accessor allocation exceeded")
    vertices = indices = morph_vertices = 0
    morph_names = set()
    for mesh in document.get("meshes", []):
        morph_names.update(mesh.get("extras", {}).get("targetNames", []))
        for primitive in mesh["primitives"]:
            count = accessors[primitive["attributes"]["POSITION"]]["count"]
            vertices += count
            indices += accessors[primitive["indices"]]["count"]
            morphs = len(primitive.get("targets", []))
            require(morphs <= 32, "GLB morph target count exceeded")
            morph_vertices += count * morphs
    require(vertices <= MAX_VERTICES and indices <= 1_000_000 and morph_vertices <= MAX_MORPH_VERTICES, "GLB geometry allocation exceeded")
    require({name for name, _, _ in POSES}.issubset(morph_names), "GLB is missing required facial morphs")
    binary_at = 20 + json_length
    binary_length, binary_type = struct.unpack_from("<II", data, binary_at)
    require(binary_type == 0x004E4942 and binary_at + 8 + binary_length == len(data), "Invalid GLB binary chunk")
    pixels = 0
    image_pixels = []
    for image in document.get("images", []):
        require("uri" not in image and image.get("mimeType") == "image/png", "GLB must embed PNG textures")
        view = document["bufferViews"][image["bufferView"]]
        at = binary_at + 8 + view.get("byteOffset", 0)
        require(data[at:at + 8] == b"\x89PNG\r\n\x1a\n", "Invalid embedded PNG")
        width, height = struct.unpack_from(">II", data, at + 16)
        require(0 < width <= 1024 and 0 < height <= 1024, "GLB texture dimensions exceeded")
        pixels += width * height
        image_pixels.append(width * height)
    require(pixels <= MAX_TEXTURE_PIXELS, "GLB texture pixel budget exceeded")
    use_pixels = 0
    for material in document.get("materials", []):
        texture = material.get("pbrMetallicRoughness", {}).get("baseColorTexture")
        if texture:
            use_pixels += image_pixels[document["textures"][texture["index"]]["source"]]
    require(use_pixels <= 16 * 1024 * 1024, "GLB material texture allocations exceeded")
    animations = document.get("animations", [])
    animation_summary = [{"name": animation.get("name"), "channels": len(animation.get("channels", [])), "samplers": len(animation.get("samplers", []))} for animation in animations]
    expected_names = ["Idle", *(name for name, _, _ in EXPRESSION_CLIPS)]
    require([animation.get("name") for animation in animations] == expected_names and all(0 < len(animation["channels"]) <= 256 and len(animation["samplers"]) <= 256 for animation in animations), "Expected only the curated animations; actual: " + json.dumps(animation_summary, sort_keys=True))
    return {"bytes": len(data), "nodes": len(document["nodes"]), "joints": max((len(s["joints"]) for s in document.get("skins", [])), default=0), "vertices": vertices, "indices": indices, "morphVertices": morph_vertices, "morphs": sorted(morph_names), "texturePixels": pixels, "accessorBytes": allocation, "animations": animation_summary}


def preserve_rejected_export(path, failure):
    directory = ROOT / "artifacts/snow"
    directory.mkdir(parents=True, exist_ok=True)
    rejected = directory / "snow-rejected.glb"
    metadata = directory / "snow-rejected.gltf.json"
    with tempfile.TemporaryDirectory(prefix="rejected-", dir=directory) as temporary:
        work = Path(temporary)
        shutil.copyfile(path, work / rejected.name)
        (work / rejected.name).replace(rejected)
        with path.open("rb") as stream:
            header = stream.read(20)
            require(len(header) == 20, "Rejected GLB header is truncated")
            json_length = struct.unpack_from("<I", header, 12)[0]
            require(json_length <= 8 * 1024 * 1024, "Rejected GLB JSON allocation exceeded")
            document = json.loads(stream.read(json_length))
        (work / metadata.name).write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
        (work / metadata.name).replace(metadata)
        diagnostics = {"error": str(failure), "glb": str(rejected), "metadata": str(metadata), "animations": [{"name": animation.get("name"), "channels": len(animation.get("channels", [])), "samplers": len(animation.get("samplers", []))} for animation in document.get("animations", [])]}
        report = directory / "snow-rejection.json"
        (work / report.name).write_text(json.dumps(diagnostics, indent=2) + "\n", encoding="utf-8")
        (work / report.name).replace(report)
    print(json.dumps(diagnostics, sort_keys=True), flush=True)


def author_idle(rig):
    arm_rotations = {}
    arm_directions = {}
    for side in ("L", "R"):
        name = f"DEF-UpperArm_1.{side}"
        rest = (rig.matrix_world @ rig.data.bones[name].matrix_local).to_quaternion()
        shoulder = rig.matrix_world @ rig.data.bones[name].head_local
        wrist = rig.matrix_world @ rig.data.bones[f"DEF-Wrist.{side}"].head_local
        # Snow's upper-arm bone axes point upward, not along the physical limbs.
        direction = (wrist - shoulder).normalized()
        toward_down = direction.rotation_difference(Vector((0, 0, -1)))
        angle = math.radians(75)
        require(toward_down.angle > angle + math.radians(5), f"Upper arm rest orientation changed: {name}")
        lowering = Quaternion(toward_down.axis, angle)
        arm_directions[side] = lowering @ direction
        require(arm_directions[side].z < -0.9 and arm_directions[side].x * direction.x > 0, f"Relaxed arm direction is invalid: {name}")
        arm_rotations[name] = rest.inverted() @ lowering @ rest
        rig.pose.bones[name].rotation_mode = "QUATERNION"
    for name in ("Chest", "DEF-Head"):
        rig.pose.bones[name].rotation_mode = "QUATERNION"
    for frame in range(61):
        phase = 2 * math.pi * frame / 60
        sway = math.sin(phase) if frame not in (0, 60) else 0.0
        nod = 1 - math.cos(phase) if frame not in (0, 60) else 0.0
        for name, rotation in (("Chest", (0.012 * sway, 0, 0)), ("DEF-Head", (0.008 * nod, 0, 0.022 * sway))):
            bone = rig.pose.bones[name]
            bone.rotation_quaternion = Euler(rotation, "XYZ").to_quaternion()
            bone.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=name)
        for name, rotation in arm_rotations.items():
            bone = rig.pose.bones[name]
            bone.rotation_quaternion = rotation
            bone.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=name)
    action = rig.animation_data.action
    action.name = "Idle"
    bag = action_get_channelbag_for_slot(action, rig.animation_data.action_slot)
    require(bag is not None, "Authored Idle has no action channels")
    for curve in bag.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = "LINEAR"
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    for side, expected in arm_directions.items():
        shoulder = rig.matrix_world @ rig.pose.bones[f"DEF-UpperArm_1.{side}"].head
        wrist = rig.matrix_world @ rig.pose.bones[f"DEF-Wrist.{side}"].head
        actual = (wrist - shoulder).normalized()
        require(actual.dot(expected) > 0.999 and actual.z < -0.9, f"Evaluated arm pose does not match its relaxed direction: {side}")


def convert(source_path, output_path):
    require(source_path.is_file() and source_path.suffix == ".blend", "Expected the local Snow .blend source")
    require(output_path.suffix == ".glb" and output_path != source_path, "Expected a separate .glb output")
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    bpy.ops.wm.open_mainfile(filepath=str(source_path), use_scripts=False)
    source_rig = bpy.data.objects.get("RIG-Snow")
    require(source_rig is not None and source_rig.type == "ARMATURE", "Snow rig not found")
    sources = [bpy.data.objects.get(name) for name in MESH_NAMES]
    require(all(obj is not None and obj.type == "MESH" for obj in sources), "Expected Snow render meshes are missing")
    for collection in bpy.data.collections:
        collection.hide_viewport = False
    def enable_layer(layer):
        layer.exclude = False
        layer.hide_viewport = False
        for child in layer.children:
            enable_layer(child)
    enable_layer(bpy.context.view_layer.layer_collection)
    for obj in bpy.data.objects:
        if obj.animation_data:
            obj.animation_data.action = None
            for track in obj.animation_data.nla_tracks:
                track.mute = True
        if obj.type == "MESH" and obj.data.shape_keys and obj.data.shape_keys.animation_data:
            obj.data.shape_keys.animation_data.action = None
            for track in obj.data.shape_keys.animation_data.nla_tracks:
                track.mute = True
        for modifier in obj.modifiers:
            if modifier.type == "SUBSURF":
                modifier.levels = 1
                modifier.render_levels = 1
    for obj in sources + [source_rig]:
        obj.hide_viewport = False
        obj.hide_set(False)
    for source in sources:
        for modifier in source.modifiers:
            modifier.show_viewport = modifier.show_render
    bpy.context.scene.frame_set(1)
    channels = {name: pose_channels(name) for name in sorted({"Eyemask Default", "Mouth Default", *(action for _, action, _ in POSES)})}
    channels, skipped_bones, skipped_properties = preflight_pose_channels(source_rig, channels)
    apply_pose(source_rig, channels["Eyemask Default"])
    apply_pose(source_rig, channels["Mouth Default"])
    source_rig.update_tag()
    bpy.context.view_layer.update()
    require(all(curve.driver.is_valid for curve in source_rig.animation_data.drivers), "Rig has invalid drivers with script execution disabled")
    neutral = snapshot_pose(source_rig)
    parents = body_parents()
    collection = bpy.data.collections.new("SnowRuntime")
    bpy.context.scene.collection.children.link(collection)
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    rig = make_rig(source_rig, parents, collection)
    records = []
    vertex_total = 0
    for source in sources:
        mesh, coordinates, topology = geometry(source, bpy.context.evaluated_depsgraph_get())
        vertex_total += len(mesh.vertices)
        require(vertex_total <= MAX_VERTICES, "Evaluated geometry allocation exceeded")
        target = bpy.data.objects.new(source.name.replace("GEO-snow", "Snow"), mesh)
        collection.objects.link(target)
        discarded = assign_weights(source, target, rig, parents)
        records.append({"source": source, "target": target, "neutral": coordinates, "topology": topology, "discarded": discarded})
    morph_vertices = 0
    movements = {}
    for name, action, subset in POSES:
        restore_pose(source_rig, neutral)
        apply_pose(source_rig, channels[action], subset)
        source_rig.update_tag()
        bpy.context.view_layer.update()
        maximum = 0.0
        for record in records:
            mesh, coordinates, topology = geometry(record["source"], bpy.context.evaluated_depsgraph_get())
            try:
                require(topology == record["topology"] and len(coordinates) == len(record["neutral"]), f"Pose changes topology: {name}, {record['source'].name}")
                delta = max(abs(a - b) for a, b in zip(coordinates, record["neutral"]))
                maximum = max(maximum, delta)
                require(delta < 0.3, f"Facial pose displacement exceeds 30 cm: {name}, {record['source'].name}")
                if delta > 1e-6:
                    target = record["target"]
                    if target.data.shape_keys is None:
                        target.shape_key_add(name="Basis", from_mix=False)
                    morph_vertices += len(target.data.vertices)
                    require(morph_vertices <= MAX_MORPH_VERTICES, "Morph vertex allocation exceeded")
                    key = target.shape_key_add(name=name, from_mix=False)
                    key.data.foreach_set("co", coordinates)
                    target.data.update()
            finally:
                bpy.data.meshes.remove(mesh)
        require(maximum > 0.00001, f"Author pose produced no meaningful deformation: {name}")
        movements[name] = maximum
    restore_pose(source_rig, neutral)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="snow-conversion-", dir=output_path.parent) as temporary:
        work = Path(temporary)
        textures = texture_images(source_path.parent, work)
        materials = {}
        for record in records:
            target, source = record["target"], record["source"]
            prepare_uv(target.data, source)
            indices = [polygon.material_index for polygon in target.data.polygons]
            target.data.materials.clear()
            for slot in source.material_slots:
                target.data.materials.append(runtime_material(slot.material, textures, materials))
            for polygon, material_index in zip(target.data.polygons, indices):
                polygon.material_index = material_index
        scene = bpy.data.scenes.new("SnowRuntimeExport")
        scene.collection.children.link(collection)
        bpy.context.window.scene = scene
        bpy.ops.object.select_all(action="DESELECT")
        for obj in collection.objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = rig
        scene.render.fps = 30
        scene.frame_start = 0
        scene.frame_end = 60
        rig.data.bones["DEF-Chest"].name = "Chest"
        for record in records:
            group = record["target"].vertex_groups.get("DEF-Chest")
            if group:
                group.name = "Chest"
        for action in list(bpy.data.actions):
            bpy.data.actions.remove(action, do_unlink=True)
        author_idle(rig)
        scene.frame_set(0)
        pending = work / "snow.glb"
        result = bpy.ops.export_scene.gltf(
            filepath=str(pending), export_format="GLB", use_selection=True, use_active_scene=True,
            export_copyright=CREDIT, export_extras=False, export_image_format="AUTO",
            export_vertex_color="NONE",
            export_apply=False, export_yup=True, export_animations=True,
            export_animation_mode="ACTIONS", export_anim_single_armature=False,
            export_anim_slide_to_zero=True,
            export_force_sampling=False, export_def_bones=True,
            export_try_sparse_sk=False, export_try_omit_sparse_sk=False,
            export_all_influences=False, export_morph=True, export_morph_normal=True,
            export_morph_tangent=False, export_skins=True, export_rest_position_armature=True,
        )
        require(result == {"FINISHED"}, "glTF exporter did not finish")
        try:
            add_expression_clips(pending)
            summary = validate_glb(pending)
        except Exception as failure:
            try:
                preserve_rejected_export(pending, failure)
            except Exception as diagnostic_failure:
                print(json.dumps({"diagnosticError": str(diagnostic_failure), "validationError": str(failure)}), flush=True)
            raise
        pending.replace(output_path)
    summary.update({"output": str(output_path), "poseMaxDisplacement": movements, "maxDiscardedSkinWeight": max(record["discarded"] for record in records), "skippedPoseBones": skipped_bones, "skippedPoseProperties": skipped_properties, "bodyAnimation": "Authored 2-second loop: head/chest neutral at endpoints, constant 75-degree relaxed upper-arm rotations; no original pose/corrective actions exported", "expressionClips": [{"name": name, "morph": morph, "maximum": ceiling, "duration": 2} for name, morph, ceiling in EXPRESSION_CLIPS]})
    print(json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / ".local/assets/snow/Snow/snow_v4.2.blend")
    parser.add_argument("--output", type=Path, default=ROOT / ".local/assets/snow/snow.glb")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    convert(args.input.resolve(), args.output.resolve())
