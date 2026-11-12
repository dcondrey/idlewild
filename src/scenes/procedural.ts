import * as THREE from 'three';
import { randomFor, sceneDynamics } from './dynamics.ts';
import { disposeObject } from './resources.ts';
import type { SceneSubject } from './types.ts';

function group(name: string, parent?: THREE.Object3D, position: [number, number, number] = [0, 0, 0]) {
  const result = new THREE.Group();
  result.name = name;
  result.position.set(...position);
  parent?.add(result);
  return result;
}

function material(color: number, roughness = 0.5) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.08 });
}

function part(parent: THREE.Object3D, name: string, geometry: THREE.BufferGeometry, surface: THREE.Material,
  position: [number, number, number], scale: [number, number, number] = [1, 1, 1]) {
  const mesh = new THREE.Mesh(geometry, surface);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function createBubbles(): SceneSubject {
  const root = group('Bubbles');
  const sphere = new THREE.SphereGeometry(1, 24, 16);
  const colors = [0x80e3ed, 0xb8a1ff, 0xffb8d2, 0xe2f6bc];
  const surfaces = colors.map(color => new THREE.MeshPhysicalMaterial({
    color, transparent: true, opacity: 0.52, roughness: 0.16, metalness: 0.22,
    iridescence: 1, iridescenceIOR: 1.32, iridescenceThicknessMinimum: 120, iridescenceThicknessMaximum: 440,
    clearcoat: 1, clearcoatRoughness: 0.12, emissive: color, emissiveIntensity: 0.045,
    depthWrite: false,
  }));
  const bubbles = Array.from({ length: 28 }, (_, i) => part(root, `Bubble_${i}`, sphere, surfaces[i % surfaces.length], [0, 0, 0]));
  return {
    root,
    update(input) {
      const { time, motion, breath, jaw, smile, brow, blink, movement, armSpread, armLift, lean, turn } = sceneDynamics(input);
      root.position.x = lean * 0.7;
      root.rotation.set(0, turn * 0.3, -lean * 0.12);
      for (const surface of surfaces) {
        surface.emissiveIntensity = 0.045 + smile * 0.22 + jaw * 0.12;
        surface.opacity = 0.52 + brow * 0.16;
      }
      for (let i = 0; i < bubbles.length; i++) {
        const phase = randomFor(input.seed, i + 200) * Math.PI * 2;
        bubbles[i].position.set(
          (randomFor(input.seed, i * 4) * 5.2 - 2.6) * (1 + armSpread * 0.35 + smile * 0.12) + Math.sin(time * 0.33 + phase) * (0.17 * motion + movement * 0.24),
          randomFor(input.seed, i * 4 + 1) * 2.9 + 0.65 + Math.sin(time * 0.48 + phase) * 0.18 * motion + breath * 0.22 + armLift * 0.7 + movement * 0.25,
          (randomFor(input.seed, i * 4 + 2) * 2.2 - 1.1) * (1 + armSpread * 0.35),
        );
        const size = (0.16 + randomFor(input.seed, i * 4 + 3) * 0.38) * (1 + breath * 0.18 + jaw * 0.4 + smile * 0.2);
        bubbles[i].scale.set(size * (1 + blink * 0.18), size * (1 - blink * 0.5 + brow * 0.15), size);
      }
    },
    dispose: () => disposeObject(root),
  };
}

export function createStar(): SceneSubject {
  const root = group('Star');
  const core = group('StarCore', root, [0, 1.9, 0]);
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const angle = Math.PI / 2 + i * Math.PI / 5;
    const radius = i % 2 ? 0.55 : 1.3;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const starMaterial = new THREE.MeshStandardMaterial({ color: 0xffce66, emissive: 0xff8a25, emissiveIntensity: 0.45, roughness: 0.26, metalness: 0.65 });
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.12, bevelThickness: 0.12 });
  part(core, 'StarBody', geometry, starMaterial, [0, 0, -0.15]);
  const ringMaterial = new THREE.MeshStandardMaterial({ color: 0xffedc0, emissive: 0xeaa332, emissiveIntensity: 0.3, roughness: 0.35, metalness: 0.65 });
  const ringGeometry = new THREE.TorusGeometry(1.65, 0.016, 6, 96);
  const rings = [0, 1].map(i => {
    const ring = part(core, `Orbit_${i}`, ringGeometry, ringMaterial, [0, 0, 0]);
    ring.rotation.set(0.55 + i * 0.55, 0.4 + i * 0.8, i * 1.2);
    return ring;
  });
  const dustGeometry = new THREE.OctahedronGeometry(0.035);
  const dust = Array.from({ length: 24 }, (_, i) => part(root, `Spark_${i}`, dustGeometry, ringMaterial, [0, 0, 0]));
  return {
    root,
    update(input) {
      const { time, motion, breath, jaw, smile, brow, blink, movement, armSpread, armLift, lean, turn } = sceneDynamics(input);
      const expansion = 1 + breath * 0.12 + smile * 0.2 + jaw * 0.22;
      core.scale.set(expansion * (1 + armSpread * 0.12 + blink * 0.12), expansion * (1 - blink * 0.35 + brow * 0.15), expansion);
      core.rotation.y = Math.sin(time * 0.3) * 0.22 * motion + turn * 0.65;
      core.rotation.z = Math.sin(time * 0.22) * 0.08 * motion - lean * 0.3;
      core.position.set(lean * 0.7, 1.9 + Math.sin(time * 0.6) * 0.08 * motion + armLift * 0.55 + movement * 0.2, 0);
      rings[0].rotation.z = time * 0.12 * motion;
      rings[1].rotation.z = 1.2 - time * 0.09 * motion;
      rings[0].scale.setScalar(1 + armSpread * 0.18 + brow * 0.12);
      rings[1].scale.setScalar(1 + movement * 0.2 + smile * 0.12);
      starMaterial.emissiveIntensity = 0.45 + Math.max(0, breath) * 0.5 + smile * 0.55 + jaw * 0.25;
      for (let i = 0; i < dust.length; i++) {
        const angle = randomFor(input.seed, i * 2) * Math.PI * 2 + time * 0.05 * motion;
        const radius = (1.9 + randomFor(input.seed, i * 2 + 1) * 0.6) * (1 + armSpread * 0.2 + movement * 0.15);
        dust[i].position.set(Math.cos(angle) * radius + lean * 0.7, 1.9 + Math.sin(angle) * radius * 0.7 + armLift * 0.55, Math.sin(angle * 3) * 0.6);
        dust[i].scale.setScalar(1 + jaw * 1.2 + brow * 0.5);
      }
    },
    dispose: () => disposeObject(root),
  };
}

export function createBabyDragon(): SceneSubject {
  const root = group('BabyDragon');
  root.rotation.y = -0.22;
  const sphere = new THREE.SphereGeometry(1, 24, 16);
  const horn = new THREE.ConeGeometry(0.13, 0.35, 12);
  const skin = material(0x58b9ac, 0.5);
  const belly = material(0xe9d29e, 0.6);
  const wingSurface = new THREE.MeshStandardMaterial({ color: 0xefb6a6, roughness: 0.75, side: THREE.DoubleSide });
  const cream = material(0xf7e8ba);
  const eyes = material(0xf7f6eb, 0.3);
  const iris = material(0x203945, 0.2);
  const dark = material(0x346c63);
  const chest = group('Chest', root, [0, 1.05, 0]);
  part(chest, 'RoundBody', sphere, skin, [0, 0, 0], [0.66, 0.8, 0.56]);
  part(chest, 'Belly', sphere, belly, [0, -0.06, 0.43], [0.46, 0.58, 0.18]);
  const head = group('Head', root, [0, 2.03, 0.15]);
  part(head, 'LargeHead', sphere, skin, [0, 0, 0], [0.76, 0.64, 0.64]);
  part(head, 'Snout', sphere, skin, [0, -0.18, 0.58], [0.52, 0.29, 0.36]);
  const jaw = group('Jaw', head, [0, -0.3, 0.36]);
  part(jaw, 'LowerJaw', sphere, belly, [0, -0.04, 0.2], [0.44, 0.12, 0.31]);
  const eyeNodes: THREE.Group[] = [];
  const legs: THREE.Group[] = [];
  const arms: THREE.Group[] = [];
  const wings: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const suffix = side < 0 ? 'L' : 'R';
    const eye = group(`Eye_${suffix}`, head, [side * 0.42, 0.12, 0.51]);
    part(eye, `EyeWhite_${suffix}`, sphere, eyes, [0, 0, 0], [0.25, 0.3, 0.14]);
    part(eye, `Pupil_${suffix}`, sphere, iris, [0, 0.02, 0.12], [0.1, 0.17, 0.035]);
    part(eye, `Glint_${suffix}`, sphere, eyes, [-0.035, 0.08, 0.15], [0.035, 0.04, 0.015]);
    eyeNodes.push(eye);
    part(head, `Nostril_${suffix}`, sphere, dark, [side * 0.21, -0.08, 0.87], [0.05, 0.035, 0.018]);
    const hornMesh = part(head, `Horn_${suffix}`, horn, cream, [side * 0.48, 0.58, -0.08]);
    hornMesh.rotation.z = -side * 0.25;
    const leg = group(`Hip_${suffix}`, root, [side * 0.47, 0.5, 0]);
    part(leg, `Haunch_${suffix}`, sphere, skin, [0, -0.04, 0], [0.32, 0.43, 0.35]);
    part(leg, `Foot_${suffix}`, sphere, skin, [0, -0.31, 0.22], [0.32, 0.18, 0.43]);
    for (let i = 0; i < 3; i++) part(leg, `Toe_${suffix}_${i}`, sphere, cream, [(i - 1) * 0.16, -0.32, 0.58], [0.06, 0.055, 0.11]);
    legs.push(leg);
    const arm = group(`Shoulder_${suffix}`, root, [side * 0.56, 1.45, 0.06]);
    part(arm, `Arm_${suffix}`, sphere, skin, [side * 0.05, -0.2, 0.1], [0.18, 0.35, 0.2]);
    part(arm, `Hand_${suffix}`, sphere, skin, [side * 0.06, -0.43, 0.18], [0.21, 0.16, 0.2]);
    arms.push(arm);
    const wing = group(`Wing_${suffix}`, root, [side * 0.44, 1.5, -0.3]);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(side * 0.76, 0.7);
    shape.quadraticCurveTo(side * 1.03, 0.28, side * 1.08, -0.26);
    shape.quadraticCurveTo(side * 0.72, 0.02, side * 0.61, -0.38);
    shape.quadraticCurveTo(side * 0.35, -0.06, 0, -0.3);
    shape.closePath();
    part(wing, `WingMembrane_${suffix}`, new THREE.ShapeGeometry(shape, 12), wingSurface, [0, 0, 0]);
    const strut = new THREE.CylinderGeometry(0.035, 0.055, 1.04, 8);
    const bone = part(wing, `WingSpar_${suffix}`, strut, skin, [side * 0.38, 0.35, 0]);
    bone.rotation.z = -side * 0.82;
    wings.push(wing);
  }
  const tail = group('Tail', root, [0, 0.62, -0.4]);
  let segmentParent: THREE.Object3D = tail;
  const tailJoints: THREE.Group[] = [];
  for (let i = 0; i < 5; i++) {
    const segment = group(`TailJoint_${i}`, segmentParent, i ? [0, 0.025, -0.29] : [0, 0, 0]);
    const size = 0.26 - i * 0.045;
    part(segment, `TailSegment_${i}`, sphere, skin, [0, 0, -0.13], [size, size, 0.28]);
    tailJoints.push(segment);
    segmentParent = segment;
  }
  return {
    root,
    update(input) {
      const { time, motion, breath, movement, blink, jaw: mouth } = sceneDynamics(input);
      const body = breath + movement;
      chest.scale.set(1 + body * 0.08, 1 + body * 0.045, 1 + body * 0.13);
      head.rotation.z = Math.sin(time * 0.55) * 0.055 * motion;
      head.rotation.x = body * 0.04;
      jaw.rotation.x = mouth * 0.16;
      for (const eye of eyeNodes) eye.scale.y = 1 - blink * 0.88;
      for (let i = 0; i < wings.length; i++) {
        const side = i ? 1 : -1;
        wings[i].rotation.y = side * (0.35 + body * 0.2 + Math.sin(time * 0.7) * 0.08 * motion);
        arms[i].rotation.x = body * 0.08;
        legs[i].rotation.x = body * 0.025;
      }
      for (let i = 0; i < tailJoints.length; i++) tailJoints[i].rotation.y = Math.sin(time * 0.65 + i * 0.55) * 0.1 * motion;
    },
    dispose: () => disposeObject(root),
  };
}

export function createRunner(): SceneSubject {
  const root = group('Runner');
  root.rotation.y = -0.4;
  const body = group('Pelvis', root, [0, 1.12, 0]);
  const sphere = new THREE.SphereGeometry(1, 20, 12);
  const capsule = new THREE.CapsuleGeometry(0.11, 0.38, 4, 10);
  const shirt = material(0xf49864);
  const shorts = material(0x273f54);
  const skin = material(0xb77d58);
  const sole = material(0xefeee5);
  const hair = material(0x263539);
  const torso = group('Chest', body, [0, 0.47, 0]);
  part(torso, 'Shirt', sphere, shirt, [0, 0, 0], [0.34, 0.47, 0.22]);
  part(body, 'Shorts', sphere, shorts, [0, 0, 0], [0.3, 0.23, 0.21]);
  const head = group('Head', torso, [0, 0.64, 0]);
  part(head, 'Face', sphere, skin, [0, 0, 0], [0.22, 0.28, 0.21]);
  part(head, 'Hair', sphere, hair, [0, 0.14, -0.04], [0.23, 0.18, 0.21]);
  part(head, 'Nose', sphere, skin, [0, 0, 0.2], [0.055, 0.065, 0.06]);
  const hips: THREE.Group[] = [];
  const knees: THREE.Group[] = [];
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const suffix = side < 0 ? 'L' : 'R';
    const hip = group(`Hip_${suffix}`, body, [side * 0.17, -0.08, 0]);
    part(hip, `Thigh_${suffix}`, capsule, shorts, [0, -0.24, 0], [1.25, 1, 1.25]);
    const knee = group(`Knee_${suffix}`, hip, [0, -0.51, 0]);
    part(knee, `Calf_${suffix}`, capsule, skin, [0, -0.2, 0], [0.8, 0.85, 0.8]);
    part(knee, `Shoe_${suffix}`, sphere, shirt, [0, -0.45, 0.09], [0.13, 0.1, 0.24]);
    part(knee, `Sole_${suffix}`, sphere, sole, [0, -0.51, 0.09], [0.14, 0.04, 0.25]);
    hips.push(hip);
    knees.push(knee);
    const shoulder = group(`Shoulder_${suffix}`, torso, [side * 0.36, 0.26, 0]);
    part(shoulder, `UpperArm_${suffix}`, capsule, shirt, [0, -0.21, 0], [0.8, 0.75, 0.8]);
    const elbow = group(`Elbow_${suffix}`, shoulder, [0, -0.4, 0]);
    elbow.rotation.x = -1.1;
    part(elbow, `Forearm_${suffix}`, capsule, skin, [0, -0.18, 0], [0.7, 0.65, 0.7]);
    part(elbow, `Hand_${suffix}`, sphere, skin, [0, -0.38, 0], [0.08, 0.11, 0.08]);
    arms.push(shoulder);
  }
  return {
    root,
    setVariant(variant) {
      const palettes = [
        { shirt: 0xf49864, skin: 0xb77d58, hair: 0x263539, width: 1, height: 1 },
        { shirt: 0x7bc9ba, skin: 0x684632, hair: 0x171e24, width: 0.92, height: 1.08 },
        { shirt: 0xb6a4e2, skin: 0xe7ba97, hair: 0x654438, width: 1.12, height: 0.95 },
      ];
      const palette = palettes[variant];
      shirt.color.setHex(palette.shirt);
      skin.color.setHex(palette.skin);
      hair.color.setHex(palette.hair);
      root.scale.set(palette.width, palette.height, palette.width);
    },
    update(input) {
      const { time, motion, breath, movement } = sceneDynamics(input);
      const response = breath + movement;
      const phase = time * 7.5;
      const stride = motion * (0.5 + Math.max(0, response) * 0.12);
      body.position.y = 1.18 + Math.abs(Math.cos(phase)) * 0.055 * motion;
      body.rotation.x = 0.08 * motion;
      torso.scale.set(1 + response * 0.035, 1, 1 + response * 0.08);
      for (let i = 0; i < hips.length; i++) {
        const cycle = Math.sin(phase + i * Math.PI);
        hips[i].rotation.x = cycle * stride;
        knees[i].rotation.x = Math.max(0, -cycle) * stride * 1.8;
        arms[i].rotation.x = -cycle * stride * 0.7;
      }
    },
    dispose: () => disposeObject(root),
  };
}

export function createBrain(): SceneSubject {
  const root = group('BrainIllustration');
  const brain = group('IllustrativeHemispheres', root, [0, 1.95, 0]);
  const surface = new THREE.MeshStandardMaterial({ color: 0xb5a4d0, roughness: 0.6, metalness: 0.05, transparent: true, opacity: 0.65, depthWrite: false });
  const foldGeometry = new THREE.SphereGeometry(1, 48, 32);
  const positions = foldGeometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const fold = 1 + 0.045 * Math.sin(x * 26 + Math.sin(y * 14)) * Math.sin(z * 20 + y * 8);
    positions.setXYZ(i, x * fold, y * fold, z * fold);
  }
  foldGeometry.computeVertexNormals();
  part(brain, 'LeftIllustrativeHemisphere', foldGeometry, surface, [-0.43, 0, 0], [0.68, 0.85, 1.02]);
  part(brain, 'RightIllustrativeHemisphere', foldGeometry, surface, [0.43, 0, 0], [0.68, 0.85, 1.02]);
  const stem = part(brain, 'IllustrativeStem', new THREE.CapsuleGeometry(0.16, 0.6, 4, 12), material(0xb5a4d0), [0, -0.84, -0.25]);
  stem.rotation.x = -0.3;
  const pointGeometry = new THREE.SphereGeometry(0.055, 10, 8);
  const pointMaterial = new THREE.MeshStandardMaterial({ color: 0xaff4e4, emissive: 0x5ad4c4, emissiveIntensity: 0.65, roughness: 0.4 });
  const points: THREE.Mesh[] = [];
  const locations: THREE.Vector3[] = [];
  for (let i = 0; i < 24; i++) {
    const angle = i * 2.399963229728653;
    const y = 1 - i / 23 * 2;
    const radius = Math.sqrt(1 - y * y);
    const position = new THREE.Vector3(Math.cos(angle) * radius * 0.88, y * 0.67, Math.sin(angle) * radius * 0.8);
    locations.push(position);
    points.push(part(brain, `IllustrativeNode_${i}`, pointGeometry, pointMaterial, position.toArray() as [number, number, number]));
  }
  const lines: number[] = [];
  for (let i = 0; i < locations.length; i++) {
    for (let j = i + 1; j < locations.length; j++) if (locations[i].distanceTo(locations[j]) < 0.8) lines.push(...locations[i].toArray(), ...locations[j].toArray());
  }
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  const network = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ color: 0x76b3c5, transparent: true, opacity: 0.45 }));
  network.name = 'IllustrativeConnections';
  brain.add(network);
  const ring = part(root, 'BodySignalRing', new THREE.TorusGeometry(1.42, 0.018, 6, 80), pointMaterial, [0, 0.45, 0]);
  ring.rotation.x = Math.PI / 2;
  return {
    root,
    update(input) {
      const { time, motion, breath } = sceneDynamics(input);
      brain.rotation.y = Math.sin(time * 0.15) * 0.2 * motion;
      ring.scale.setScalar(1 + breath * 0.15);
      for (let i = 0; i < points.length; i++) points[i].scale.setScalar(1 + Math.max(0, breath) * 0.6);
    },
    dispose: () => disposeObject(root),
  };
}
