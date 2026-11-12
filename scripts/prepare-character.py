"""Idlewild character converter.

Conversion:
  Blender -b --factory-startup --disable-autoexec --python-exit-code 1 -P scripts/prepare-character.py -- --profile snow|rain [--input F.blend] [--output F.glb] [--receipt F.json] [--retrieved YYYY-MM-DD]
Inspection (read-only, prints and writes JSON):
  Blender -b --factory-startup --disable-autoexec --python-exit-code 1 -P scripts/prepare-character.py -- --inspect --input F.blend [--report F.json]
"""

import argparse
from array import array
import datetime
import hashlib
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
POSE_FIELDS = (
    "location", "rotation_euler", "rotation_quaternion", "rotation_axis_angle", "scale",
    "bbone_curveinx", "bbone_curveinz", "bbone_curveoutx", "bbone_curveoutz",
    "bbone_easein", "bbone_easeout", "bbone_rollin", "bbone_rollout", "bbone_scalein", "bbone_scaleout",
)
CHANNEL = re.compile(r'^pose\.bones\[("(?:[^"\\]|\\.)*")\](?:\.(' + "|".join(POSE_FIELDS) + r')|\[("(?:[^"\\]|\\.)*")\])$')
MAX_VERTICES = 500_000
MAX_MORPH_VERTICES = 1_000_000
MAX_TEXTURE_PIXELS = 8_000_000
MAX_TEXTURE_COUNT = 6
FPS = 30
LOOP_TOLERANCE = 2e-4

# Mirrors FACE_SHAPES in src/contracts.ts and the aliases in faceSources() of src/scenes/tracking.ts.
FACE_SHAPES = (
    "eyeBlinkLeft", "eyeBlinkRight", "jawOpen", "mouthSmileLeft", "mouthSmileRight", "browDownLeft", "browDownRight",
    "browInnerUp", "mouthFunnel", "mouthPucker", "mouthClose", "mouthPressLeft", "mouthPressRight", "_neutral",
    "browOuterUpLeft", "browOuterUpRight", "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
    "eyeLookDownLeft", "eyeLookDownRight", "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight",
    "eyeLookUpLeft", "eyeLookUpRight", "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight",
    "jawForward", "jawLeft", "jawRight", "mouthDimpleLeft", "mouthDimpleRight", "mouthFrownLeft", "mouthFrownRight",
    "mouthLeft", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthRight", "mouthRollLower", "mouthRollUpper",
    "mouthShrugLower", "mouthShrugUpper", "mouthStretchLeft", "mouthStretchRight", "mouthUpperUpLeft", "mouthUpperUpRight",
    "noseSneerLeft", "noseSneerRight",
)
FACE_ALIASES = ("blinkleft", "blinkright", "blink", "mouthopen", "smile", "smileopen", "browdown", "mouthfunnel", "mouthff")
CORE_FACE_SHAPES = FACE_SHAPES[:13]


def normalize(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())


def tracking_bone_groups():
    spine = ("defspine", "mixamorigspine", "spine", "abdomen")
    chest = ("chest", "defchest", "mixamorigspine2", "spine2", "torso", "defneck", "mixamorigneck", "neck")
    groups = {"spine": spine, "chest": chest, "head": ("defhead", "mixamorighead", "head")}
    for side, s in (("left", "l"), ("right", "r")):
        groups[f"upperarm.{s}"] = (f"defupperarm1{s}", f"mixamorig{side}arm", f"{side}arm", f"upperarm{s}")
        groups[f"forearm.{s}"] = (f"defforearm1{s}", f"mixamorig{side}forearm", f"{side}forearm", f"lowerarm{s}", f"forearm{s}")
        groups[f"hand.{s}"] = (f"defwrist{s}", f"mixamorig{side}hand", f"{side}hand", f"wrist{s}", f"palm2{s}", f"hand{s}")
        groups[f"thigh.{s}"] = (f"defthigh1{s}", f"mixamorig{side}upleg", f"{side}upleg", f"upperleg{s}", f"thigh{s}")
        groups[f"shin.{s}"] = (f"defknee1{s}", f"mixamorig{side}leg", f"{side}leg", f"lowerleg{s}", f"calf{s}")
        groups[f"foot.{s}"] = (f"deffoot{s}", f"mixamorig{side}foot", f"{side}foot", f"foot{s}")
    return groups


SNOW_CREDIT = (
    "Snow Rig (CC) Blender Foundation | studio.blender.org; "
    "https://studio.blender.org/characters/snow/v4/; "
    "CC BY 4.0 https://creativecommons.org/licenses/by/4.0/; "
    "Modified for Idlewild: evaluated facial morphs, reduced deformation rig, "
    "subdivision level 1, relaxed arm pose, authored idle and subtle expression clips, simplified materials, omitted outer corneas and reduced textures."
)
RAIN_CREDIT = (
    "Rain Rig (CC) Blender Foundation | studio.blender.org; "
    "https://studio.blender.org/characters/rain/v3/; "
    "CC BY 4.0 https://creativecommons.org/licenses/by/4.0/; "
    "Modified for Idlewild: evaluated facial morphs, reduced deformation rig, relaxed arm pose, "
    "authored idle, run and subtle expression clips, simplified materials and reduced textures."
)

PROFILES = {
    "snow": {
        "ready": True,
        "id": "snow", "prefix": "Snow", "rig": "RIG-Snow", "credit": SNOW_CREDIT,
        "input": ".local/assets/snow/Snow/snow_v4.2.blend", "output": ".local/assets/snow/snow.glb",
        "archive": ".local/assets/snow/snow_v42.zip",
        "receipt": {
            "title": "Snow for Idlewild", "author": "Blender Foundation / Blender Studio",
            "source": "https://studio.blender.org/characters/snow/v4/",
            "sourceDownload": "https://studio.blender.org/download-source/files/ba/0f/ba0fe6d810333b1d73c1c359e4dc03cb-6.zip",
            "sourceSha256": "98d58ef3a07083ede14140bc462cccb55d317062846aa0eb652d2e4a7ac422a6", "sourceBytes": 111580346,
            "license": "CC BY 4.0", "licenseUrl": "https://creativecommons.org/licenses/by/4.0/", "retrieved": "2026-11-11",
        },
        "meshes": (
            "GEO-snow-body", "GEO-snow-eyebrows", "GEO-snow-eyes",
            "GEO-snow-gums_lower", "GEO-snow-gums_upper", "GEO-snow-hair_base",
            "GEO-snow-head", "GEO-snow-pants", "GEO-snow-shirt",
            "GEO-snow-shoes_base", "GEO-snow-shoes_bottom", "GEO-snow-shoes_parts",
            "GEO-snow-teeth_lower", "GEO-snow-teeth_upper", "GEO-snow-tongue",
            "GEO-snow-eye_dots",
        ),
        "mesh_rename": ("GEO-snow", "Snow"),
        "skeleton": {"mode": "snow", "fallback": "DEF-Head"},
        "renames": {"DEF-Chest": "Chest"},
        "rigid_meshes": {"GEO-snow-gums_lower": "DEF-Head", "GEO-snow-gums_upper": "DEF-Head", "GEO-snow-teeth_lower": "DEF-Head", "GEO-snow-teeth_upper": "DEF-Head"},
        "max_discarded": 0.05,
        "subdiv": 1,
        "neutral_actions": ("Eyemask Default", "Mouth Default"),
        "stale_bones": {"STR-TIP-Nostril.L", "STR-TIP-Nostril.R"},
        "stale_properties": {("Jaw", "preserve_volume"), ("Jaw", "teeth_follow_mouth")},
        "morphs": (
            {"name": "BlinkLeft", "action": "Eyemask Closed", "subset": "left"},
            {"name": "BlinkRight", "action": "Eyemask Closed", "subset": "right"},
            {"name": "JawOpen", "action": "Mouth Opensmile", "subset": "jaw"},
            {"name": "SmileOpen", "action": "Mouth Opensmile", "subset": "all"},
            {"name": "BrowDown", "action": "Eyemask Angry", "subset": "brow"},
            {"name": "MouthFunnel", "action": "Mouth Oo", "subset": "all"},
            {"name": "MouthFf", "action": "Mouth Ff", "subset": "all"},
        ),
        "min_morphs": 7,
        "textures": {"mode": "snow", "skin_prefix": "snow.skin", "material_prefix": "snow.", "materials": {"snow.hair": "hair", "snow.eyes": "eyes", "snow.pants": "pants", "snow.shirt": "shirt", "snow.shoe": "shoes"}, "roughness": {"snow.eyes": 0.22}},
        "roles": {"chest": "Chest", "head": "DEF-Head", "upperarm.L": "DEF-UpperArm_1.L", "upperarm.R": "DEF-UpperArm_1.R", "wrist.L": "DEF-Wrist.L", "wrist.R": "DEF-Wrist.R"},
        "forward": (0, -1, 0),
        "arm_angle": 75,
        "clips": ("Idle",),
        "expressions": (("Soft smile", ("SmileOpen",), 0.18), ("Brow motion", ("BrowDown",), 0.15)),
        "derivation": "scripts/prepare-character.py --profile snow, Blender 4.5.9 LTS, scripts disabled",
        "arm_note": "constant 75-degree relaxed upper-arm rotations",
    },
    "rain": {
        "ready": False,
        "id": "rain", "prefix": "Rain", "rig": None, "credit": RAIN_CREDIT,
        "input": ".local/assets/rain/rain.blend", "output": ".local/assets/rain/rain.glb",
        "archive": ".local/assets/rain/rain_v3.zip",
        "receipt": {
            "title": "Rain for Idlewild", "author": "Blender Foundation / Blender Studio",
            "source": "https://studio.blender.org/characters/rain/v3/",
            "sourceDownload": "https://studio.blender.org/download-source/files/ee/a7/eea73e55dba1cea31c09848df6a794b2-4.zip",
            "sourceSha256": None, "sourceBytes": None,
            "license": "CC BY 4.0", "licenseUrl": "https://creativecommons.org/licenses/by/4.0/", "retrieved": None,
        },
        "meshes": (),
        "mesh_rename": None,
        "skeleton": {"mode": "auto", "exclude": [], "rename": {}, "max_joints": 128},
        "renames": {},
        "rigid_meshes": {},
        "max_discarded": 0.05,
        "subdiv": 1,
        "neutral_actions": (),
        "stale_bones": set(),
        "stale_properties": set(),
        "morphs": (),
        "min_morphs": 13,
        "max_triangles": 75_000,
        "textures": {"mode": "auto", "roughness": {}, "material_prefix": ""},
        "roles": {},
        "forward": (0, -1, 0),
        "arm_angle": None,
        "clips": ("Idle", "Run"),
        "expressions": (("Soft smile", ("mouthSmileLeft", "mouthSmileRight"), 0.18), ("Brow motion", ("browInnerUp",), 0.15)),
        "derivation": "scripts/prepare-character.py --profile rain, Blender 4.5.9 LTS, scripts disabled",
        "arm_note": "relaxed upper-arm rotations measured from the source pose",
    },
}
# Rain finalization (after `--inspect` on the real .blend): fill "rig", "meshes", "mesh_rename", "roles"
# (chest, head, hips, upperarm.L/R, forearm.L/R, wrist.L/R, thigh.L/R, knee.L/R), skeleton exclude/rename,
# "morphs" (one of {"action"+"subset"}, {"bones": {bone: {prop: [values]}}}, {"shape_keys": {key: value}} per ARKit name)
# and set "ready" True. Nothing else changes.

PROFILE = PROFILES["snow"]
CREDIT = PROFILE["credit"]
STALE_POSE_BONES = PROFILE["stale_bones"]
STALE_POSE_PROPERTIES = PROFILE["stale_properties"]


def activate(profile):
    global PROFILE, CREDIT, STALE_POSE_BONES, STALE_POSE_PROPERTIES
    PROFILE = profile
    CREDIT = profile["credit"]
    STALE_POSE_BONES = profile["stale_bones"]
    STALE_POSE_PROPERTIES = profile["stale_properties"]


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


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
    require(all(name not in rig.pose.bones for name in STALE_POSE_BONES), "Source rig changed: stale nostril targets now exist")
    for name, prop in STALE_POSE_PROPERTIES:
        bone = rig.pose.bones.get(name)
        require(bone is not None and prop not in bone and prop not in bone.bl_rna.properties, f"Source rig changed: {name}.{prop} is now defined")
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


def build_skeleton(source_rig, profile):
    spec = profile["skeleton"]
    if spec["mode"] == "snow":
        parents = body_parents()
        identity = {name: name for name in parents}
        return {"parents": parents, "sources": identity, "runtime": dict(identity), "fallback": lambda name: spec["fallback"]}
    exclude = [re.compile(pattern) for pattern in spec["exclude"]]
    bones = list(source_rig.data.bones)
    included = [bone for bone in bones if bone.use_deform and not any(pattern.search(bone.name) for pattern in exclude)]
    require(0 < len(included) <= spec["max_joints"], f"Deform skeleton has {len(included)} bones; expected 1 to {spec['max_joints']}. Tighten skeleton.exclude")
    names = {bone.name for bone in included}

    def nearest(bone):
        parent = bone.parent
        while parent is not None and parent.name not in names:
            parent = parent.parent
        return parent.name if parent else None

    runtime = {bone.name: spec["rename"].get(bone.name, bone.name) for bone in included}
    require(len(set(runtime.values())) == len(runtime), "Runtime bone names collide")
    parents = {runtime[bone.name]: (runtime[nearest(bone)] if nearest(bone) else None) for bone in included}
    roots = [name for name, parent in parents.items() if parent is None]
    require(len(roots) == 1, f"Expected one root deform bone, found: {roots[:8]}")
    for bone in bones:
        if bone.use_deform and bone.name not in names:
            ancestor = nearest(bone)
            require(ancestor is not None, f"Excluded deform bone has no included ancestor: {bone.name}")
            runtime[bone.name] = runtime[ancestor]
    return {"parents": parents, "sources": {value: key for key, value in runtime.items() if key in names}, "runtime": runtime, "fallback": None}


def preflight_profile(profile, skeleton, source_rig, sources):
    require(profile["ready"], f"Profile '{profile['id']}' is not finalized: run --inspect on the source .blend and fill rig, meshes, roles and morphs")
    require(sources, "Profile lists no render meshes")
    runtime = set(skeleton["parents"])
    for role, name in profile["roles"].items():
        require(name in runtime or name in profile["renames"].values(), f"Role {role} names a bone absent from the runtime skeleton: {name}")
    final = {profile["renames"].get(name, name) for name in runtime}
    available = {normalize(name) for name in final}
    missing = [role for role, aliases in tracking_bone_groups().items() if not any(alias in available for alias in aliases)]
    require(not missing, "Runtime skeleton lacks bone names supported by src/scenes/tracking.ts for: " + ", ".join(missing))
    accepted = {normalize(name) for name in FACE_SHAPES} | set(FACE_ALIASES)
    names = [spec["name"] for spec in profile["morphs"]]
    require(len(set(names)) == len(names) and len(names) >= profile["min_morphs"], f"Expected at least {profile['min_morphs']} distinct facial morphs, found {len(set(names))}")
    unsupported = [name for name in names if normalize(name) not in accepted]
    require(not unsupported, "Morph names unsupported by the runtime face mapping: " + ", ".join(unsupported))
    if profile["id"] != "snow":
        core = {normalize(name) for name in CORE_FACE_SHAPES}
        require(len(core & {normalize(name) for name in names}) >= 13, "Rain-class profiles must provide all 13 CORE_FACE_SHAPES")
        forward = Vector(profile["forward"])
        require(abs(forward.length - 1) < 1e-6 and forward.z == 0, "Profile forward must be a horizontal unit vector")
    for spec in profile["morphs"]:
        kinds = [key for key in ("action", "bones", "shape_keys") if key in spec]
        require(len(kinds) == 1, f"Morph {spec['name']} must define exactly one of action, bones or shape_keys")
        if "shape_keys" in spec:
            found = False
            for obj in sources:
                keys = obj.data.shape_keys
                if keys is None:
                    continue
                for key_name in spec["shape_keys"]:
                    if key_name not in keys.key_blocks:
                        continue
                    found = True
                    driven = keys.animation_data and any(curve.data_path == f'key_blocks["{key_name}"].value' for curve in keys.animation_data.drivers)
                    require(not driven, f"Shape key {key_name} is driven by the rig; evaluate it through pose bones instead ({spec['name']})")
            require(found, f"No source mesh has the shape keys for morph {spec['name']}")
    need = ["chest", "head"] + [f"{part}.{side}" for part in ("upperarm", "wrist") for side in "LR"]
    if "Run" in profile["clips"]:
        need += ["hips"] + [f"{part}.{side}" for part in ("thigh", "knee", "forearm") for side in "LR"]
    require(all(role in profile["roles"] for role in need), "Profile roles missing: " + ", ".join(role for role in need if role not in profile["roles"]))


def make_rig(source, skeleton, collection):
    name = f"{PROFILE['prefix']}RuntimeRig"
    data = bpy.data.armatures.new(name)
    rig = bpy.data.objects.new(name, data)
    collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for name in skeleton["parents"]:
        original = source.pose.bones.get(skeleton["sources"][name])
        require(original is not None and original.bone.use_deform, f"Missing deformation bone: {name}")
        bone = data.edit_bones.new(name)
        bone.matrix = source.matrix_world @ original.matrix
        bone.length = max((source.matrix_world @ original.tail - source.matrix_world @ original.head).length, 0.001)
        bone.use_deform = True
    for name, parent in skeleton["parents"].items():
        if parent:
            data.edit_bones[name].parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def assign_weights(source, target, rig, skeleton):
    parents = skeleton["parents"]
    deform = {bone.name for bone in bpy.data.objects[PROFILE["rig"]].data.bones if bone.use_deform}
    names = {group.index: group.name for group in source.vertex_groups}
    for group in source.vertex_groups:
        target.vertex_groups.new(name=group.name)
    rigid_bone = PROFILE["rigid_meshes"].get(source.name)
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
            mapped = skeleton["runtime"].get(name) or (skeleton["fallback"](name) if skeleton["fallback"] else None)
            require(mapped in parents, f"Deform group has no runtime bone: {name}")
            weights[mapped] = weights.get(mapped, 0.0) + weight
        if not weights and rigid_bone:
            weights[rigid_bone] = 1.0
        total = sum(weights.values())
        require(total > 1e-8, f"Unweighted vertex {vertex.index}: {source.name}")
        ordered = sorted(weights.items(), key=lambda item: (-item[1], item[0]))
        discarded = sum(value for _, value in ordered[4:]) / total
        max_discarded = max(max_discarded, discarded)
        require(discarded <= PROFILE["max_discarded"], f"Skin influence reduction exceeds {PROFILE['max_discarded']:.0%}: {source.name} vertex {vertex.index}")
        kept = sum(value for _, value in ordered[:4])
        vertex_weights.append([(name, value / kept) for name, value in ordered[:4]])
    target.vertex_groups.clear()
    groups = {name: target.vertex_groups.new(name=name) for name in parents}
    for index, weights in enumerate(vertex_weights):
        for name, value in weights:
            groups[name].add([index], value, "REPLACE")
    modifier = target.modifiers.new(f"{PROFILE['prefix']}RuntimeSkin", "ARMATURE")
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
    image.name = f"{PROFILE['prefix']}_{path.stem}_{size}"
    image.filepath_raw = str(work / f"{image.name}.png")
    image.file_format = "PNG"
    image.save()
    image.pack()
    return image


def snow_texture_images(source_dir, work):
    root = source_dir / "textures"
    textures = {name: resize_image(root / f"{name}_diffuse.png", 1024, work) for name in ("eyes", "hair", "pants", "shirt", "shoes")}
    atlas = bpy.data.images.new(f"{PROFILE['prefix']}_skin_atlas", width=1024, height=1024, alpha=True)
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
    atlas.filepath_raw = str(work / f"{PROFILE['prefix']}_skin_atlas.png")
    atlas.file_format = "PNG"
    atlas.save()
    atlas.pack()
    textures["skin"] = atlas
    require(sum(image.size[0] * image.size[1] for image in textures.values()) <= MAX_TEXTURE_PIXELS, "Texture pixel budget exceeded")
    return textures


def base_color_image(material):
    for node in principled_nodes(material.node_tree):
        for link in node.inputs["Base Color"].links:
            if link.from_node.type == "TEX_IMAGE" and link.from_node.image is not None:
                return link.from_node.image
    return None


def auto_textures(materials, work):
    result, cache = {}, {}
    for material in materials:
        if material.name in result:
            continue
        image = base_color_image(material)
        if image is None:
            continue
        require(image.source in ("FILE", "GENERATED") and len(image.tiles) <= 1, f"Tiled or sequence texture needs a profile conversion: {image.name}")
        if image.name not in cache:
            width, height = image.size
            require(0 < width <= 8192 and 0 < height <= 8192, f"Source texture dimensions exceeded: {image.name}")
            copy = image.copy()
            factor = min(1, 1024 / max(width, height))
            copy.scale(max(1, round(width * factor)), max(1, round(height * factor)))
            copy.name = f"{PROFILE['prefix']}_{len(cache)}_{re.sub(r'[^A-Za-z0-9]+', '_', image.name)[:40]}"
            copy.filepath_raw = str(work / f"{copy.name}.png")
            copy.file_format = "PNG"
            copy.save()
            copy.pack()
            cache[image.name] = copy
        result[material.name] = cache[image.name]
    require(len(cache) <= MAX_TEXTURE_COUNT, f"{len(cache)} textures exceed the {MAX_TEXTURE_COUNT}-image budget; merge or drop materials in the profile")
    require(sum(image.size[0] * image.size[1] for image in cache.values()) <= MAX_TEXTURE_PIXELS, "Texture pixel budget exceeded")
    return result


def texture_for(name, textures):
    spec = PROFILE["textures"]
    if spec["mode"] == "snow":
        key = "skin" if name.startswith(spec["skin_prefix"]) else spec["materials"].get(name)
        return textures[key] if key else None
    return textures.get(name)


def runtime_material(source, textures, cache):
    if source.name in cache:
        return cache[source.name]
    name = source.name
    texture = texture_for(name, textures)
    spec = PROFILE["textures"]
    material = bpy.data.materials.new(f"{PROFILE['prefix']}_{name.removeprefix(spec['material_prefix'])}")
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    originals = principled_nodes(source.node_tree)
    color = tuple(originals[0].inputs["Base Color"].default_value) if originals else (1, 1, 1, 1)
    roughness = float(originals[0].inputs["Roughness"].default_value) if originals else 0.25
    require(all(math.isfinite(v) and 0 <= v <= 1 for v in color) and math.isfinite(roughness), f"Invalid material: {name}")
    shader.inputs["Base Color"].default_value = (1, 1, 1, 1) if texture else color
    shader.inputs["Roughness"].default_value = max(0.05, min(1, roughness))
    shader.inputs["Metallic"].default_value = 0
    if texture:
        image = material.node_tree.nodes.new("ShaderNodeTexImage")
        image.image = texture
        material.node_tree.links.new(image.outputs["Color"], shader.inputs["Base Color"])
    if name in spec["roughness"]:
        shader.inputs["Roughness"].default_value = spec["roughness"][name]
    material.diffuse_color = tuple(shader.inputs["Base Color"].default_value)
    cache[name] = material
    return material


def prepare_uv(mesh, source, textures):
    materials = [slot.material for slot in source.material_slots]
    require(materials and all(material is not None for material in materials), f"Missing material: {source.name}")
    require(all(poly.material_index < len(materials) for poly in mesh.polygons), f"Invalid material slot: {source.name}")
    textured = any(texture_for(material.name, textures) is not None for material in materials)
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
    skin_prefix = PROFILE["textures"].get("skin_prefix")
    for poly in mesh.polygons:
        material = materials[poly.material_index]
        if not skin_prefix or not material.name.startswith(skin_prefix):
            continue
        coordinates = [selected.data[index].uv for index in poly.loop_indices]
        tile = math.floor(sum(uv.x for uv in coordinates) / len(coordinates))
        require(tile in (0, 1, 2), f"Unsupported skin tile: {source.name}")
        x, y = ((0, 0), (1, 0), (0, 1))[tile]
        for uv in coordinates:
            require(tile - 0.001 <= uv.x <= tile + 1.001 and -0.001 <= uv.y <= 1.001, f"Skin polygon crosses tile boundary: {source.name}")
            uv.x = (max(0, min(1, uv.x - tile)) + x) / 2
            uv.y = (max(0, min(1, uv.y)) + y) / 2


def read_glb(path, limit=32 * 1024 * 1024):
    require(0 < path.stat().st_size < limit, "GLB must be smaller than 32 MiB")
    data = path.read_bytes()
    magic, version, length, json_length, chunk_type = struct.unpack_from("<5I", data)
    require(magic == 0x46546C67 and version == 2 and length == len(data) and chunk_type == 0x4E4F534A, "Invalid GLB container")
    return data, json_length, json.loads(data[20:20 + json_length])


def add_expression_clips(path):
    data, json_length, document = read_glb(path)
    animations = document.get("animations", [])
    require(sorted(animation.get("name") for animation in animations) == sorted(PROFILE["clips"]), "Expected only the base clips before expression clip construction: " + json.dumps([animation.get("name") for animation in animations]))
    idle = next(animation for animation in animations if animation["name"] == "Idle")
    require(0 < len(idle["channels"]) <= 256 and len(idle["samplers"]) <= 256, "Idle track budget exceeded")
    require(all(channel["target"]["path"] in ("translation", "rotation", "scale") for channel in idle["channels"]), "Idle contains unexpected non-transform tracks")
    require(len(document.get("buffers", [])) == 1 and "uri" not in document["buffers"][0], "Base GLB must have one embedded buffer")
    nodes = document.get("nodes", [])
    require(len(nodes) <= 256, "Base GLB node budget exceeded")
    for name in (PROFILE["roles"].get("upperarm.L"), PROFILE["roles"].get("upperarm.R")):
        matches = [index for index, node in enumerate(nodes) if node.get("name") == name]
        require(len(matches) == 1 and any(channel["target"].get("node") == matches[0] and channel["target"]["path"] == "rotation" for channel in idle["channels"]), f"Idle is missing the relaxed arm rotation: {name}")
    binary_at = 20 + json_length
    binary_length, binary_type = struct.unpack_from("<II", data, binary_at)
    declared_length = document["buffers"][0]["byteLength"]
    require(binary_type == 0x004E4942 and binary_at + 8 + binary_length == len(data) and 0 <= binary_length - declared_length <= 3, "Invalid base GLB binary chunk")
    binary = bytearray(data[binary_at + 8:binary_at + 8 + declared_length])
    accessors, views = document["accessors"], document["bufferViews"]

    def append_scalars(values):
        require(0 < len(values) <= 61 * 64 and all(math.isfinite(value) for value in values), "Expression accessor allocation or value is invalid")
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
    for name, morph_names, ceiling in PROFILE["expressions"]:
        clip = {"name": name, "channels": [{"sampler": channel["sampler"], "target": dict(channel["target"])} for channel in idle["channels"]], "samplers": [dict(sampler) for sampler in idle["samplers"]]}
        affected = 0
        for node_index, node in enumerate(nodes):
            if "mesh" not in node:
                continue
            mesh = document["meshes"][node["mesh"]]
            names = mesh.get("extras", {}).get("targetNames", [])
            indices = [names.index(morph) for morph in morph_names if morph in names]
            if not indices:
                continue
            require(0 < len(names) <= 64 and len(set(names)) == len(names), "Invalid expression morph names")
            require(all(len(primitive.get("targets", [])) == len(names) for primitive in mesh["primitives"]), "Expression morph dimensions do not match geometry")
            neutral = node.get("weights", mesh.get("weights", [0.0] * len(names)))
            require(len(neutral) == len(names) and all(value == 0 for value in neutral), "Expression clip requires neutral default morph weights")
            weights = []
            for frame in range(61):
                amount = 0.0 if frame in (0, 60) else ceiling * (1 - 1e-6) * math.sin(math.pi * frame / 60) ** 2
                weights.extend(amount if index in indices else 0.0 for index in range(len(names)))
            output = append_scalars(weights)
            require(0 <= accessors[output]["min"][0] <= accessors[output]["max"][0] <= ceiling, "Expression amplitude exceeded its bound")
            clip["channels"].append({"sampler": len(clip["samplers"]), "target": {"node": node_index, "path": "weights"}})
            clip["samplers"].append({"input": time_accessor, "output": output, "interpolation": "LINEAR"})
            affected += 1
        require(affected > 0, f"Expression clip has no matching morph: {morph_names}")
        require(len(clip["channels"]) <= 256 and len(clip["samplers"]) <= 256, f"Expression track budget exceeded: {name}")
        animations.append(clip)
    document["buffers"][0]["byteLength"] = len(binary)
    encoded_json = json.dumps(document, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    encoded_json += b" " * (-len(encoded_json) % 4)
    binary.extend(b"\0" * (-len(binary) % 4))
    total = 12 + 8 + len(encoded_json) + 8 + len(binary)
    require(total < 32 * 1024 * 1024, "Expression GLB size budget exceeded")
    updated = path.with_name(f"{PROFILE['id']}-with-expressions.glb")
    with updated.open("wb") as stream:
        stream.write(struct.pack("<5I", 0x46546C67, 2, total, len(encoded_json), 0x4E4F534A))
        stream.write(encoded_json)
        stream.write(struct.pack("<II", len(binary), 0x004E4942))
        stream.write(binary)
    updated.replace(path)


def accessor_floats(document, binary_at, data, index):
    accessor = document["accessors"][index]
    require(accessor["componentType"] == 5126 and "sparse" not in accessor, "Animation accessor must be dense float")
    width = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[accessor["type"]]
    view = document["bufferViews"][accessor["bufferView"]]
    require(not view.get("byteStride") or view["byteStride"] == width * 4, "Animation accessor must be tightly packed")
    at = binary_at + 8 + view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    values = struct.unpack_from(f"<{accessor['count'] * width}f", data, at)
    return values, width


def validate_loops(document, binary_at, data):
    for animation in document.get("animations", []):
        for sampler in animation["samplers"]:
            values, width = accessor_floats(document, binary_at, data, sampler["output"])
            first, last = values[:width], values[-width:]
            sign = -1 if width == 4 and sum(a * b for a, b in zip(first, last)) < 0 else 1
            require(all(abs(a - sign * b) <= LOOP_TOLERANCE for a, b in zip(first, last)), f"Clip does not close its loop: {animation.get('name')}")


def validate_glb(path):
    data, json_length, document = read_glb(path)
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
    low, high = [math.inf] * 3, [-math.inf] * 3
    for mesh in document.get("meshes", []):
        morph_names.update(mesh.get("extras", {}).get("targetNames", []))
        for primitive in mesh["primitives"]:
            position = accessors[primitive["attributes"]["POSITION"]]
            count = position["count"]
            vertices += count
            indices += accessors[primitive["indices"]]["count"]
            low = [min(a, b) for a, b in zip(low, position["min"])]
            high = [max(a, b) for a, b in zip(high, position["max"])]
            morphs = len(primitive.get("targets", []))
            require(morphs <= 64, "GLB morph target count exceeded")
            morph_vertices += count * morphs
    require(vertices <= MAX_VERTICES and indices <= 1_000_000 and morph_vertices <= MAX_MORPH_VERTICES, "GLB geometry allocation exceeded")
    required = {spec["name"] for spec in PROFILE["morphs"]}
    require(required.issubset(morph_names), "GLB is missing required facial morphs: " + ", ".join(sorted(required - morph_names)))
    limit = PROFILE.get("max_triangles")
    require(limit is None or indices // 3 <= limit, f"Triangle budget exceeded: {indices // 3} > {limit}")
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
    require(len(image_pixels) <= MAX_TEXTURE_COUNT, f"GLB has {len(image_pixels)} images; budget is {MAX_TEXTURE_COUNT}")
    require(pixels <= MAX_TEXTURE_PIXELS, "GLB texture pixel budget exceeded")
    use_pixels = 0
    for material in document.get("materials", []):
        texture = material.get("pbrMetallicRoughness", {}).get("baseColorTexture")
        if texture:
            use_pixels += image_pixels[document["textures"][texture["index"]]["source"]]
    require(use_pixels <= 16 * 1024 * 1024, "GLB material texture allocations exceeded")
    animations = document.get("animations", [])
    animation_summary = [{"name": animation.get("name"), "channels": len(animation.get("channels", [])), "samplers": len(animation.get("samplers", []))} for animation in animations]
    expected_names = sorted([*PROFILE["clips"], *(name for name, _, _ in PROFILE["expressions"])])
    require(sorted(animation.get("name") for animation in animations) == expected_names and all(0 < len(animation["channels"]) <= 256 and len(animation["samplers"]) <= 256 for animation in animations), "Expected only the curated animations; actual: " + json.dumps(animation_summary, sort_keys=True))
    validate_loops(document, binary_at, data)
    return {"bytes": len(data), "nodes": len(document["nodes"]), "joints": max((len(s["joints"]) for s in document.get("skins", [])), default=0), "vertices": vertices, "indices": indices, "triangles": indices // 3, "bounds": {"min": low, "max": high}, "morphVertices": morph_vertices, "morphs": sorted(morph_names), "texturePixels": pixels, "textureImages": len(image_pixels), "accessorBytes": allocation, "animations": animation_summary}


def preserve_rejected_export(path, failure):
    directory = ROOT / "artifacts" / PROFILE["id"]
    directory.mkdir(parents=True, exist_ok=True)
    rejected = directory / f"{PROFILE['id']}-rejected.glb"
    metadata = directory / f"{PROFILE['id']}-rejected.gltf.json"
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
        report = directory / f"{PROFILE['id']}-rejection.json"
        (work / report.name).write_text(json.dumps(diagnostics, indent=2) + "\n", encoding="utf-8")
        (work / report.name).replace(report)
    print(json.dumps(diagnostics, sort_keys=True), flush=True)


def arm_lowering(rig):
    roles = PROFILE["roles"]
    result = {}
    for side in ("L", "R"):
        name = roles[f"upperarm.{side}"]
        rest = (rig.matrix_world @ rig.data.bones[name].matrix_local).to_quaternion()
        shoulder = rig.matrix_world @ rig.data.bones[name].head_local
        wrist = rig.matrix_world @ rig.data.bones[roles[f"wrist.{side}"]].head_local
        direction = (wrist - shoulder).normalized()
        toward_down = direction.rotation_difference(Vector((0, 0, -1)))
        if PROFILE["arm_angle"] is not None:
            angle = math.radians(PROFILE["arm_angle"])
            # Snow's upper-arm bone axes point upward, not along the physical limbs.
            require(toward_down.angle > angle + math.radians(5), f"Upper arm rest orientation changed: {name}")
        else:
            angle = max(0.0, toward_down.angle - math.radians(12))
        lowering = Quaternion(toward_down.axis, angle) if angle > 0 else Quaternion()
        lowered = lowering @ direction
        require(lowered.z < -0.9 and (angle == 0 or lowered.x * direction.x > 0), f"Relaxed arm direction is invalid: {name}")
        result[name] = (lowering, rest, lowered, side)
    return result


def check_arms(rig, lowered_directions):
    roles = PROFILE["roles"]
    for side, expected in lowered_directions.items():
        shoulder = rig.matrix_world @ rig.pose.bones[roles[f"upperarm.{side}"]].head
        wrist = rig.matrix_world @ rig.pose.bones[roles[f"wrist.{side}"]].head
        actual = (wrist - shoulder).normalized()
        require(actual.dot(expected) > 0.999 and actual.z < -0.9, f"Evaluated arm pose does not match its relaxed direction: {side}")


def author_idle(rig):
    roles = PROFILE["roles"]
    lowering = arm_lowering(rig)
    arm_rotations = {name: rest.inverted() @ lower @ rest for name, (lower, rest, _, _) in lowering.items()}
    for name in arm_rotations:
        rig.pose.bones[name].rotation_mode = "QUATERNION"
    for name in (roles["chest"], roles["head"]):
        rig.pose.bones[name].rotation_mode = "QUATERNION"
    for frame in range(61):
        phase = 2 * math.pi * frame / 60
        sway = math.sin(phase) if frame not in (0, 60) else 0.0
        nod = 1 - math.cos(phase) if frame not in (0, 60) else 0.0
        for name, rotation in ((roles["chest"], (0.012 * sway, 0, 0)), (roles["head"], (0.008 * nod, 0, 0.022 * sway))):
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
    check_arms(rig, {side: lowered for _, _, lowered, side in lowering.values()})
    return action


RUN_FRAMES = 36


def author_run(rig, idle):
    roles = PROFILE["roles"]
    up = Vector((0, 0, 1))
    forward = Vector(PROFILE["forward"])
    lateral = forward.cross(up).normalized()
    lowering = arm_lowering(rig)
    order = ["chest", "head", "thigh.L", "thigh.R", "knee.L", "knee.R", "upperarm.L", "upperarm.R", "forearm.L", "forearm.R"]
    names = {role: roles[role] for role in order}
    rest = {role: (rig.matrix_world @ rig.data.bones[name].matrix_local).to_quaternion() for role, name in names.items()}
    hips = rig.pose.bones[roles["hips"]]
    hips_rest = (rig.matrix_world @ rig.data.bones[roles["hips"]].matrix_local).to_quaternion()
    height = (rig.matrix_world @ rig.data.bones[roles["hips"]].head_local).z
    require(height > 0.2, "Hips rest height is implausible")
    for name in [*names.values(), roles["hips"]]:
        rig.pose.bones[name].rotation_mode = "QUATERNION"
    rig.animation_data.action = None
    rig.animation_data.action_slot = None

    def parent_delta(bone, deltas):
        while bone.parent is not None:
            bone = bone.parent
            if bone.name in deltas:
                return deltas[bone.name]
        return Quaternion()

    def rotation(angle_degrees):
        return Quaternion(lateral, math.radians(angle_degrees))

    for frame in range(RUN_FRAMES + 1):
        phi = 0.0 if frame in (0, RUN_FRAMES) else 2 * math.pi * frame / RUN_FRAMES
        turn = {"L": 0.0, "R": math.pi}
        desired = {}
        twist = Quaternion(up, math.radians(5) * math.sin(phi))
        desired["chest"] = twist @ rotation(-8)
        desired["head"] = Quaternion().slerp(desired["chest"].inverted(), 0.7)
        for side in ("L", "R"):
            shift = turn[side]
            swing = 38 * math.sin(phi + shift)
            desired[f"thigh.{side}"] = rotation(swing)
            desired[f"knee.{side}"] = rotation(-(10 + 55 * (0.5 + 0.5 * math.cos(phi + shift - 0.5))))
            arm_swing = -32 * math.sin(phi + shift)
            desired[f"upperarm.{side}"] = rotation(arm_swing) @ lowering[roles[f"upperarm.{side}"]][0]
            desired[f"forearm.{side}"] = rotation(80 + 12 * math.sin(phi + shift + 1.0))
        deltas = {}
        for role in order:
            bone = rig.data.bones[names[role]]
            parent = parent_delta(bone, deltas)
            deltas[bone.name] = desired[role] @ parent
            pose_bone = rig.pose.bones[bone.name]
            pose_bone.rotation_quaternion = rest[role].inverted() @ parent.inverted() @ desired[role] @ parent @ rest[role]
            pose_bone.rotation_quaternion.normalize()
            pose_bone.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=bone.name)
        bob = 0.02 * height * (0.5 - 0.5 * math.cos(2 * phi))
        hips.location = hips_rest.inverted() @ Vector((0, 0, bob))
        hips.keyframe_insert(data_path="location", frame=frame, group=hips.name)
    action = rig.animation_data.action
    action.name = "Run"
    bag = action_get_channelbag_for_slot(action, rig.animation_data.action_slot)
    require(bag is not None, "Authored Run has no action channels")
    for curve in bag.fcurves:
        for key in curve.keyframe_points:
            key.interpolation = "LINEAR"
    bpy.context.scene.frame_set(RUN_FRAMES // 4)
    bpy.context.view_layer.update()

    def world(name):
        return rig.matrix_world @ rig.pose.bones[name].head

    def along(a, b):
        vector = world(roles[b]) - world(roles[a])
        return vector.normalized().dot(forward)

    require(along("thigh.L", "knee.L") > 0.4 and along("thigh.R", "knee.R") < -0.4, "Run leg swing does not follow the profile forward axis")
    require(along("upperarm.R", "forearm.R") > 0.3 and along("upperarm.L", "forearm.L") < -0.3, "Run arm swing does not oppose the legs")
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()
    track = rig.animation_data.nla_tracks.new()
    track.name = "Run"
    strip = track.strips.new("Run", 0, action)
    strip.action_slot = action.slots[0]
    rig.animation_data.action = idle
    rig.animation_data.action_slot = idle.slots[0]
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()


def sha256_of(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def snapshot_keys(sources):
    return [(obj, block.name, block.value) for obj in sources if obj.data.shape_keys for block in obj.data.shape_keys.key_blocks]


def restore_keys(snapshot):
    for obj, name, value in snapshot:
        obj.data.shape_keys.key_blocks[name].value = value


def apply_keys(sources, values, label):
    used = 0
    for obj in sources:
        keys = obj.data.shape_keys
        if keys is None:
            continue
        for name, value in values.items():
            block = keys.key_blocks.get(name)
            if block is None:
                continue
            require(math.isfinite(value) and block.slider_min <= value <= block.slider_max, f"Shape key value out of range: {label}: {name}")
            block.value = value
            used += 1
    require(used > 0, f"Morph applies no shape keys: {label}")


def enable_layer(layer):
    layer.exclude = False
    layer.hide_viewport = False
    for child in layer.children:
        enable_layer(child)


def convert(profile, source_path, output_path, receipt_path, retrieved):
    activate(profile)
    require(profile["ready"], f"Profile '{profile['id']}' is not finalized: run --inspect on the source .blend and fill rig, meshes, roles and morphs")
    require(source_path.is_file() and source_path.suffix == ".blend", f"Expected the local {profile['prefix']} .blend source")
    require(output_path.suffix == ".glb" and output_path != source_path, "Expected a separate .glb output")
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    bpy.ops.wm.open_mainfile(filepath=str(source_path), use_scripts=False)
    if profile["rig"] is None:
        candidates = [obj.name for obj in bpy.data.objects if obj.type == "ARMATURE" and sum(bone.use_deform for bone in obj.data.bones) > 50]
        require(len(candidates) == 1, f"Profile rig is unset; deform armatures found: {candidates}")
        profile["rig"] = candidates[0]
    source_rig = bpy.data.objects.get(profile["rig"])
    require(source_rig is not None and source_rig.type == "ARMATURE", f"{profile['prefix']} rig not found")
    sources = [bpy.data.objects.get(name) for name in profile["meshes"]]
    require(all(obj is not None and obj.type == "MESH" for obj in sources), f"Expected {profile['prefix']} render meshes are missing")
    skeleton = build_skeleton(source_rig, profile)
    preflight_profile(profile, skeleton, source_rig, sources)
    for collection in bpy.data.collections:
        collection.hide_viewport = False
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
        if profile["subdiv"] is not None:
            for modifier in obj.modifiers:
                if modifier.type == "SUBSURF":
                    modifier.levels = profile["subdiv"]
                    modifier.render_levels = profile["subdiv"]
    for obj in sources + [source_rig]:
        obj.hide_viewport = False
        obj.hide_set(False)
    for source in sources:
        for modifier in source.modifiers:
            modifier.show_viewport = modifier.show_render
    bpy.context.scene.frame_set(1)
    channels = {}
    for spec in profile["morphs"]:
        if "action" in spec:
            channels[spec["action"]] = pose_channels(spec["action"])
        elif "bones" in spec:
            channels["@" + spec["name"]] = [(bone, prop, index, value, False) for bone, props in spec["bones"].items() for prop, values in props.items() for index, value in enumerate(values)]
    for name in profile["neutral_actions"]:
        channels[name] = pose_channels(name)
    channels, skipped_bones, skipped_properties = preflight_pose_channels(source_rig, channels)
    for name in profile["neutral_actions"]:
        apply_pose(source_rig, channels[name])
    source_rig.update_tag()
    bpy.context.view_layer.update()
    require(all(curve.driver.is_valid for curve in source_rig.animation_data.drivers), "Rig has invalid drivers with script execution disabled")
    neutral = snapshot_pose(source_rig)
    neutral_keys = snapshot_keys(sources)
    collection = bpy.data.collections.new(f"{profile['prefix']}Runtime")
    bpy.context.scene.collection.children.link(collection)
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    rig = make_rig(source_rig, skeleton, collection)
    records = []
    vertex_total = 0
    rename = profile["mesh_rename"]
    for source in sources:
        mesh, coordinates, topology = geometry(source, bpy.context.evaluated_depsgraph_get())
        vertex_total += len(mesh.vertices)
        require(vertex_total <= MAX_VERTICES, "Evaluated geometry allocation exceeded")
        target = bpy.data.objects.new(source.name.replace(*rename) if rename else source.name, mesh)
        collection.objects.link(target)
        discarded = assign_weights(source, target, rig, skeleton)
        records.append({"source": source, "target": target, "neutral": coordinates, "topology": topology, "discarded": discarded})
    morph_vertices = 0
    movements = {}
    for spec in profile["morphs"]:
        name = spec["name"]
        restore_pose(source_rig, neutral)
        restore_keys(neutral_keys)
        if "shape_keys" in spec:
            apply_keys(sources, spec["shape_keys"], name)
        elif "action" in spec:
            apply_pose(source_rig, channels[spec["action"]], spec.get("subset", "all"))
        else:
            apply_pose(source_rig, channels["@" + name])
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
    restore_keys(neutral_keys)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f"{profile['id']}-conversion-", dir=output_path.parent) as temporary:
        work = Path(temporary)
        spec = profile["textures"]
        if spec["mode"] == "snow":
            textures = snow_texture_images(source_path.parent, work)
        else:
            textures = auto_textures([slot.material for source in sources for slot in source.material_slots if slot.material], work)
        materials = {}
        untextured = []
        for record in records:
            target, source = record["target"], record["source"]
            prepare_uv(target.data, source, textures)
            indices = [polygon.material_index for polygon in target.data.polygons]
            target.data.materials.clear()
            for slot in source.material_slots:
                if texture_for(slot.material.name, textures) is None and slot.material.name not in untextured:
                    untextured.append(slot.material.name)
                target.data.materials.append(runtime_material(slot.material, textures, materials))
            for polygon, material_index in zip(target.data.polygons, indices):
                polygon.material_index = material_index
        scene = bpy.data.scenes.new(f"{profile['prefix']}RuntimeExport")
        scene.collection.children.link(collection)
        bpy.context.window.scene = scene
        bpy.ops.object.select_all(action="DESELECT")
        for obj in collection.objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = rig
        scene.render.fps = FPS
        scene.frame_start = 0
        scene.frame_end = 60
        for old, new in profile["renames"].items():
            rig.data.bones[old].name = new
            for record in records:
                group = record["target"].vertex_groups.get(old)
                if group:
                    group.name = new
        for action in list(bpy.data.actions):
            bpy.data.actions.remove(action, do_unlink=True)
        idle = author_idle(rig)
        if "Run" in profile["clips"]:
            author_run(rig, idle)
        scene.frame_set(0)
        pending = work / f"{profile['id']}.glb"
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
    summary.update({"output": str(output_path), "poseMaxDisplacement": movements, "maxDiscardedSkinWeight": max(record["discarded"] for record in records), "skippedPoseBones": skipped_bones, "skippedPoseProperties": skipped_properties, "untexturedMaterials": untextured, "bodyAnimation": f"Authored loops ({', '.join(profile['clips'])}) with neutral endpoints; {profile['arm_note']}; no original pose/corrective actions exported", "expressionClips": [{"name": name, "morphs": list(morphs), "maximum": ceiling, "duration": 2} for name, morphs, ceiling in profile["expressions"]]})
    if receipt_path:
        write_receipt(profile, output_path, summary, receipt_path, retrieved)
    print(json.dumps(summary, sort_keys=True))


def write_receipt(profile, output_path, summary, receipt_path, retrieved):
    base = dict(profile["receipt"])
    archive = ROOT / profile["archive"]
    if archive.is_file():
        actual = sha256_of(archive)
        require(base["sourceSha256"] in (None, actual), f"Source archive hash differs from the profile: {actual}")
        base["sourceSha256"] = actual
        base["sourceBytes"] = archive.stat().st_size
    require(base["sourceSha256"], f"Source archive missing and no pinned hash: {archive}")
    base["retrieved"] = base["retrieved"] or retrieved or datetime.date.today().isoformat()
    receipt = {
        "title": base["title"], "author": base["author"], "source": base["source"], "sourceDownload": base["sourceDownload"],
        "sourceSha256": base["sourceSha256"], "sourceBytes": base["sourceBytes"], "license": base["license"], "licenseUrl": base["licenseUrl"],
        "copyright": CREDIT, "retrieved": base["retrieved"], "derivation": profile["derivation"],
        "sha256": sha256_of(output_path), "bytes": output_path.stat().st_size, "vertices": summary["vertices"], "triangles": summary["triangles"],
        "joints": summary["joints"], "morphs": summary["morphs"], "clips": [*profile["clips"], *(name for name, _, _ in profile["expressions"])],
        "texturePixels": summary["texturePixels"], "textureImages": summary["textureImages"], "skippedPoseBones": summary["skippedPoseBones"],
        "skippedPoseProperties": summary["skippedPoseProperties"], "maxDiscardedSkinWeight": summary["maxDiscardedSkinWeight"],
    }
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")


def inspect_blend(source_path, report_path):
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    bpy.ops.wm.open_mainfile(filepath=str(source_path), use_scripts=False)
    shape_names = set()
    report = {"blender": bpy.app.version_string, "file": str(source_path), "objects": [], "armatures": [], "actions": [], "materials": [], "images": [], "texts": []}
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            keys = obj.data.shape_keys
            names = [block.name for block in keys.key_blocks] if keys else []
            shape_names.update(names)
            driven = sorted({curve.data_path for curve in keys.animation_data.drivers})[:200] if keys and keys.animation_data else []
            report["objects"].append({
                "subsurf": [{"levels": m.levels, "renderLevels": m.render_levels} for m in obj.modifiers if m.type == "SUBSURF"],
                "name": obj.name, "vertices": len(obj.data.vertices), "polygons": len(obj.data.polygons), "hideRender": obj.hide_render,
                "modifiers": [modifier.type for modifier in obj.modifiers], "vertexGroups": len(obj.vertex_groups),
                "materials": [slot.material.name if slot.material else None for slot in obj.material_slots],
                "uvLayers": [{"name": layer.name, "activeRender": layer.active_render} for layer in obj.data.uv_layers],
                "shapeKeyCount": len(names), "shapeKeys": names[:400], "drivenShapeKeys": len(driven), "drivenSample": driven[:20],
                "dimensions": [round(value, 4) for value in obj.dimensions],
            })
        elif obj.type == "ARMATURE":
            bones = obj.data.bones
            deform = [bone for bone in bones if bone.use_deform]
            report["armatures"].append({
                "name": obj.name, "bones": len(bones), "deformBones": len(deform),
                "deform": [{"name": bone.name, "parent": bone.parent.name if bone.parent else None} for bone in deform][:600],
                "controlSample": [bone.name for bone in bones if not bone.use_deform][:80],
                "faceControls": [bone.name for bone in bones if re.search(r"face|brow|lip|jaw|eye|cheek|mouth|nose|tongue|teeth|lid", bone.name, re.I)][:800],
                "invalidDriverSample": [{"path": curve.data_path, "expression": curve.driver.expression[:120], "type": curve.driver.type} for curve in (obj.animation_data.drivers if obj.animation_data else []) if not curve.driver.is_valid][:20],
                "drivers": len(obj.animation_data.drivers) if obj.animation_data else 0,
                "invalidDrivers": sum(1 for curve in obj.animation_data.drivers if not curve.driver.is_valid) if obj.animation_data else 0,
            })
    for action in bpy.data.actions:
        slots = [slot.target_id_type for slot in action.slots]
        curves = [curve for slot in action.slots for bag in [action_get_channelbag_for_slot(action, slot)] if bag for curve in bag.fcurves]
        rejected = sorted({curve.data_path for curve in curves if not CHANNEL.fullmatch(curve.data_path)})
        report["actions"].append({"name": action.name, "range": list(action.frame_range), "asset": action.asset_data is not None, "slots": slots, "users": action.users, "fcurves": len(curves), "unsupportedPaths": len(rejected), "unsupportedSample": rejected[:5]})
    for material in bpy.data.materials:
        principled = principled_nodes(material.node_tree) if material.use_nodes else []
        image = base_color_image(material) if principled else None
        report["materials"].append({"name": material.name, "principled": len(principled), "baseColorImage": image.name if image else None, "baseColor": [round(v, 3) for v in principled[0].inputs["Base Color"].default_value] if principled else None})
    for image in bpy.data.images:
        report["images"].append({"name": image.name, "size": list(image.size), "source": image.source, "tiles": len(image.tiles), "packed": bool(image.packed_file)})
    for text in bpy.data.texts:
        body = text.as_string()
        report["texts"].append({"name": text.name, "characters": len(body), "autoRun": text.use_module, "content": body[:6000] if not text.name.endswith(".py") else None})
    available = {normalize(name): name for name in shape_names}
    report["faceCoverage"] = {
        "arkitMatches": {name: available[normalize(name)] for name in FACE_SHAPES if normalize(name) in available},
        "arkitMissing": [name for name in FACE_SHAPES if normalize(name) not in available],
        "aliasMatches": [available[name] for name in FACE_ALIASES if name in available],
        "note": "Shape keys may be rig-driven; the profile can instead evaluate pose bones or pose-library actions per morph.",
    }
    bones_by_name = {normalize(bone.name): bone.name for obj in bpy.data.objects if obj.type == "ARMATURE" for bone in obj.data.bones}
    report["trackingBones"] = {role: [bones_by_name[alias] for alias in aliases if alias in bones_by_name] for role, aliases in tracking_bone_groups().items()}
    report["poseAssets"] = [action["name"] for action in report["actions"] if action["asset"]]
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(report_path), "meshes": len(report["objects"]), "armatures": [(a["name"], a["bones"], a["deformBones"]) for a in report["armatures"]], "actions": len(report["actions"]), "poseAssets": len(report["poseAssets"]), "arkitMatches": len(report["faceCoverage"]["arkitMatches"]), "trackingGaps": [role for role, found in report["trackingBones"].items() if not found]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--profile", choices=sorted(PROFILES))
    parser.add_argument("--inspect", action="store_true")
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--retrieved")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    if args.inspect:
        require(args.input is not None, "--inspect requires --input")
        inspect_blend(args.input.resolve(), (args.report or args.input.with_name("inspection.json")).resolve())
    else:
        require(args.profile is not None, "--profile is required")
        selected = PROFILES[args.profile]
        convert(selected, (args.input or ROOT / selected["input"]).resolve(), (args.output or ROOT / selected["output"]).resolve(), args.receipt.resolve() if args.receipt else None, args.retrieved)
