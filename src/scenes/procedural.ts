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
      const { time, motion, breath, breathingPace, pulsePace, jaw, smile, brow, blink, movement, armSpread, armLift, lean, turn } = sceneDynamics(input);
      root.position.x = lean * 0.7;
      root.rotation.set(0, turn * 0.3, -lean * 0.12);
      for (const surface of surfaces) {
        surface.emissiveIntensity = 0.045 + smile * 0.22 + jaw * 0.12 + pulsePace * 0.08;
        surface.opacity = 0.52 + brow * 0.16;
      }
      const sway = 0.17 * motion + movement * 0.24 + pulsePace * 0.12;
      const drift = 0.18 * motion + breathingPace * 0.14;
      for (let i = 0; i < bubbles.length; i++) {
        const phase = randomFor(input.seed, i + 200) * Math.PI * 2;
        bubbles[i].position.set(
          (randomFor(input.seed, i * 4) * 5.2 - 2.6) * (1 + armSpread * 0.35 + smile * 0.12) + Math.sin(time * 0.33 + phase) * sway,
          randomFor(input.seed, i * 4 + 1) * 2.9 + 0.65 + Math.sin(time * 0.48 + phase) * drift + breath * 0.22 + armLift * 0.7 + movement * 0.25 + brow * 0.12,
          (randomFor(input.seed, i * 4 + 2) * 2.2 - 1.1) * (1 + armSpread * 0.35),
        );
        bubbles[i].scale.setScalar((0.16 + randomFor(input.seed, i * 4 + 3) * 0.38) * (1 + breath * 0.18 + jaw * 0.4 + smile * 0.2 - blink * 0.07));
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
      const { time, motion, breath, breathingPace, pulsePace, jaw, smile, brow, blink, movement, armSpread, armLift, lean, turn } = sceneDynamics(input);
      const expansion = (1 + breath * 0.12 + smile * 0.2 + jaw * 0.22) * (1 - blink * 0.06);
      core.scale.set(expansion * (1 + armSpread * 0.12), expansion * (1 + brow * 0.15), expansion);
      core.rotation.y = Math.sin(time * 0.3) * (0.22 * motion + pulsePace * 0.12) + turn * 0.65;
      core.rotation.z = Math.sin(time * 0.22) * 0.08 * motion - lean * 0.3;
      core.position.set(lean * 0.7, 1.9 + Math.sin(time * 0.6) * (0.08 * motion + breathingPace * 0.08) + armLift * 0.55 + movement * 0.2, 0);
      rings[0].rotation.z = time * 0.12 * motion;
      rings[1].rotation.z = 1.2 - time * 0.09 * motion;
      rings[0].scale.setScalar(1 + armSpread * 0.18 + brow * 0.12);
      rings[1].scale.setScalar(1 + movement * 0.2 + smile * 0.12);
      starMaterial.emissiveIntensity = 0.45 + Math.max(0, breath) * 0.5 + smile * 0.55 + jaw * 0.25 + pulsePace * 0.2;
      for (let i = 0; i < dust.length; i++) {
        const angle = randomFor(input.seed, i * 2) * Math.PI * 2 + time * 0.05 * motion;
        const radius = (1.9 + randomFor(input.seed, i * 2 + 1) * 0.6) * (1 + armSpread * 0.2 + movement * 0.15 + pulsePace * 0.08);
        dust[i].position.set(Math.cos(angle) * radius + lean * 0.7, 1.9 + Math.sin(angle) * radius * 0.7 + armLift * 0.55, Math.sin(angle * 3) * 0.6);
        dust[i].scale.setScalar(1 + jaw * 1.2 + brow * 0.5 + blink * 0.6);
      }
    },
    dispose: () => disposeObject(root),
  };
}

export const RUNNER_PACE = [0.8, 1, 1.2] as const;

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
  let pace: number = RUNNER_PACE[0];
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
      pace = RUNNER_PACE[variant];
    },
    update(input) {
      const { time, motion, breath, breathingPace, pulsePace, blink, talking, movement } = sceneDynamics(input);
      const response = breath + movement;
      const phase = time * 7.5 * pace;
      const stride = motion * 0.5;
      body.position.y = 1.18 + Math.abs(Math.cos(phase)) * 0.055 * motion;
      body.rotation.x = 0.08 * motion;
      torso.scale.set(1 + response * 0.035, 1, 1 + response * 0.08);
      torso.rotation.x = -breathingPace * 0.06;
      head.rotation.set(blink * 0.06 - pulsePace * 0.06, 0, talking * 0.05);
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
