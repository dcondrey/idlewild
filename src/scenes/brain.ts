import * as THREE from 'three';
import type { BodyJoint, BrainExampleId, Channel, SceneFrame, TrackingFrame, TrackingPoint } from '../contracts.ts';
import { trackingAt } from '../tracking-frame.ts';
import { clamp, confidenceWeight, sceneDynamics, signalValue, trackedPoint, trackingStrength } from './dynamics.ts';
import { disposeObject, fitModel } from './resources.ts';
import type { SceneSubject } from './types.ts';

export const BRAIN_CAPTION = 'Educational simulation based on published studies; not your measured brain activity.';
export const BRAIN_RULE_IDS = ['M1', 'M2', 'M3', 'M4', 'M5', 'F1', 'F2', 'F3', 'S1', 'S2', 'S3', 'S5', 'S6', 'E1', 'E2', 'E3'] as const;
export type BrainRuleId = typeof BRAIN_RULE_IDS[number];
export interface BrainRegion { region: string; label: string; intensity: number; rule: BrainRuleId }
export interface BrainSubject extends SceneSubject { topRegions(count?: number): BrainRegion[] }

type Side = 'left' | 'right';
type Weights = readonly (readonly [string, number])[];
type Visit = (rule: BrainRuleId, region: string, value: number) => void;

const SIDES: readonly Side[] = ['left', 'right'];
const JOINTS = {
  left: { shoulder: 'leftShoulder', elbow: 'leftElbow', wrist: 'leftWrist', hip: 'leftHip', knee: 'leftKnee', ankle: 'leftAnkle' },
  right: { shoulder: 'rightShoulder', elbow: 'rightElbow', wrist: 'rightWrist', hip: 'rightHip', knee: 'rightKnee', ankle: 'rightAnkle' },
} as const satisfies Record<Side, Record<string, BodyJoint>>;

const ctx = (side: Side, parcel: string) => `ctx-${side === 'left' ? 'lh' : 'rh'}-${parcel}`;
const opposite = (side: Side): Side => side === 'left' ? 'right' : 'left';
const cerebellum = (side: Side) => side === 'left' ? 'Left-Cerebellum-Cortex' : 'Right-Cerebellum-Cortex';
const bilateral = (parcel: string, weight: number): Weights => [[ctx('left', parcel), weight], [ctx('right', parcel), weight]];
const bothCerebellum = (weight: number): Weights => [[cerebellum('left'), weight], [cerebellum('right'), weight]];

const arm = (side: Side): Weights => [
  [ctx(opposite(side), 'precentral'), 1], [ctx(opposite(side), 'postcentral'), 0.8],
  [ctx(side, 'precentral'), 0.25], [cerebellum(side), 0.45],
];
const leg = (side: Side): Weights => [
  [ctx(opposite(side), 'paracentral'), 1], [ctx(side, 'paracentral'), 0.6],
  [ctx(opposite(side), 'superiorfrontal'), 0.5], [ctx(side, 'superiorfrontal'), 0.4],
  [ctx(opposite(side), 'precentral'), 0.3], [cerebellum(side), 0.35],
];
const WEIGHTS = {
  arm: { left: arm('left'), right: arm('right') },
  leg: { left: leg('left'), right: leg('right') },
  movement: [...bilateral('precentral', 0.25), ...bilateral('superiorfrontal', 0.2), ...bothCerebellum(0.5)],
  head: [...bilateral('precentral', 0.45), ...bilateral('superiorfrontal', 0.35), ...bilateral('insula', 0.35),
    ['Left-Putamen', 0.35], ['Right-Putamen', 0.35], ...bothCerebellum(0.35)],
  trunk: [...bilateral('precentral', 0.25), ...bilateral('superiorfrontal', 0.2), ...bothCerebellum(0.25)],
  mouth: [...bilateral('precentral', 0.55), ...bilateral('postcentral', 0.35), ...bilateral('superiorfrontal', 0.25)],
  eyelid: [...bilateral('caudalmiddlefrontal', 0.3), ...bilateral('superiorfrontal', 0.25)],
  brow: [...bilateral('precentral', 0.4), ...bilateral('superiorfrontal', 0.3)],
} as const;

const left = (parcel: string) => ctx('left', parcel);
export interface BrainExample { id: BrainExampleId; rule: 'E1' | 'E2' | 'E3'; label: string; citation: string; regions: Weights }
export const BRAIN_EXAMPLES: Readonly<Record<BrainExampleId, BrainExample>> = Object.freeze({
  'lyrical-improvisation': {
    id: 'lyrical-improvisation', rule: 'E1', label: 'Improvising',
    citation: 'Liu et al. 2012, Scientific Reports 2:834 (fMRI, 12 freestyle rappers, improvised > memorized lyrics)',
    regions: [[left('superiorfrontal'), 1], [left('caudalmiddlefrontal'), 0.73], [left('caudalanteriorcingulate'), 0.51],
      [left('parsorbitalis'), 0.68], [left('parstriangularis'), 0.76], [left('parsopercularis'), 0.69],
      [left('middletemporal'), 0.68], [left('superiortemporal'), 0.53], [left('fusiform'), 0.55],
      ['Left-Caudate', 0.54], ['Left-Pallidum', 0.45], [left('lingual'), 0.44], [ctx('right', 'lingual'), 0.51],
      [left('lateraloccipital'), 0.49], [ctx('right', 'lateraloccipital'), 0.43], [cerebellum('right'), 0.76]],
  },
  'new-ideas': {
    id: 'new-ideas', rule: 'E2', label: 'New ideas',
    citation: 'Benedek et al. 2014, NeuroImage 88:125–133 (fMRI, 35 adults, new > recalled uses in the Alternate Uses Task)',
    regions: [[left('supramarginal'), 1], [left('inferiorparietal'), 0.5]],
  },
  'autonomic-core': {
    id: 'autonomic-core', rule: 'E3', label: 'Body regulation',
    citation: 'Beissner et al. 2013, Journal of Neuroscience 33:10503 (meta-analysis of 43 studies, core autonomic network)',
    regions: [['Left-Amygdala', 1], [ctx('right', 'insula'), 1], [left('insula'), 0.9],
      [left('caudalanteriorcingulate'), 0.8], [ctx('right', 'caudalanteriorcingulate'), 0.8]],
  },
});

export const BRAIN_MAPPED_REGIONS: readonly string[] = Object.freeze([...new Set([
  ...SIDES.flatMap(side => [...WEIGHTS.arm[side], ...WEIGHTS.leg[side]]),
  ...WEIGHTS.movement, ...WEIGHTS.head, ...WEIGHTS.trunk, ...WEIGHTS.mouth, ...WEIGHTS.eyelid, ...WEIGHTS.brow,
  ...Object.values(BRAIN_EXAMPLES).flatMap(example => example.regions),
].map(([region]) => region))].sort());

export function brainExample(input: SceneFrame): BrainExample | null {
  const id = input.controls.brainExample;
  return id && Object.hasOwn(BRAIN_EXAMPLES, id) ? BRAIN_EXAMPLES[id] : null;
}

const PARCELS: Readonly<Record<string, string>> = {
  superiorfrontal: 'superior frontal', caudalmiddlefrontal: 'caudal middle frontal', caudalanteriorcingulate: 'caudal anterior cingulate',
  parsorbitalis: 'pars orbitalis', parstriangularis: 'pars triangularis', parsopercularis: 'pars opercularis',
  middletemporal: 'middle temporal', superiortemporal: 'superior temporal', lateraloccipital: 'lateral occipital',
  inferiorparietal: 'inferior parietal',
};

function regionLabel(region: string): string {
  const cortical = /^ctx-(lh|rh)-([a-z]+)$/.exec(region);
  if (cortical) return `${cortical[1] === 'lh' ? 'Left' : 'Right'} ${PARCELS[cortical[2]] ?? cortical[2]}`;
  const [first, ...rest] = region.split('-');
  return [first, ...rest.map(word => word.toLowerCase())].join(' ');
}

const ramp = (value: number, start: number, end: number) => THREE.MathUtils.smoothstep(value, start, end);

function angleFromDown(from: TrackingPoint, to: TrackingPoint): number | null {
  const x = to[0] - from[0], y = to[1] - from[1], z = to[2] - from[2];
  const length = Math.hypot(x, y, z);
  return length < 0.03 ? null : Math.acos(clamp(-y / length, -1, 1));
}

function bend(a: TrackingPoint, b: TrackingPoint, c: TrackingPoint): number | null {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - b[0], vy = c[1] - b[1], vz = c[2] - b[2];
  const length = Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz);
  return length < 0.001 ? null : Math.acos(clamp((ux * vx + uy * vy + uz * vz) / length, -1, 1));
}

function armActivity(body: NonNullable<TrackingFrame['body']>, side: Side): number {
  const joints = JOINTS[side];
  const shoulder = body[joints.shoulder], elbow = body[joints.elbow], wrist = body[joints.wrist];
  if (!trackedPoint(shoulder)) return 0;
  const upper = trackedPoint(elbow) ? elbow : trackedPoint(wrist) ? wrist : null;
  const elevation = upper ? angleFromDown(shoulder, upper) : null;
  if (!upper || elevation === null) return 0;
  let activity = ramp(elevation, 0.45, 1.6);
  let confidence = Math.min(shoulder[3], upper[3]);
  if (upper === elbow && trackedPoint(wrist)) {
    const forearm = angleFromDown(elbow, wrist);
    if (forearm !== null) {
      activity = Math.max(activity, ramp(forearm, 1.75, 2.75));
      confidence = Math.min(confidence, wrist[3]);
    }
  }
  return activity * confidenceWeight(confidence);
}

function legFlexion(body: NonNullable<TrackingFrame['body']>, side: Side): number | null {
  const joints = JOINTS[side];
  const hip = body[joints.hip], knee = body[joints.knee], ankle = body[joints.ankle];
  if (!trackedPoint(hip) || !trackedPoint(knee)) return null;
  const thigh = angleFromDown(hip, knee);
  if (thigh === null) return null;
  let flexion = ramp(thigh, 0.35, 1.35);
  let confidence = Math.min(hip[3], knee[3]);
  if (trackedPoint(ankle)) {
    const angle = bend(hip, knee, ankle);
    if (angle !== null) {
      flexion = Math.max(flexion, ramp(angle, 0.35, 1.55));
      confidence = Math.min(confidence, ankle[3]);
    }
  }
  return flexion * confidenceWeight(confidence);
}

function headRotation(input: SceneFrame, tracking: TrackingFrame | null): number {
  const face = tracking?.face;
  const rotation = face?.rotation;
  if (!face || !rotation || rotation.length !== 4 || !rotation.every(Number.isFinite)) return 0;
  const length = Math.hypot(rotation[0], rotation[1], rotation[2], rotation[3]);
  if (length < 0.995 || length > 1.005) return 0;
  const angle = 2 * Math.acos(Math.min(1, Math.abs(rotation[3]) / length));
  return ramp(angle, 0.1, 0.5) * trackingStrength(input, face.sampledAtMs);
}

function sdkCue(input: SceneFrame, channel: Channel, motion: number): number {
  if (input.frame?.signals[channel]?.provenance === 'replayed') return 0;
  return clamp(signalValue(input, channel) ?? 0) * motion;
}

function emit(visit: Visit, rule: BrainRuleId, weights: Weights, drive: number) {
  if (!(drive > 0)) return;
  const amount = clamp(drive);
  for (const [region, weight] of weights) visit(rule, region, amount * weight);
}

function evaluate(input: SceneFrame, visit: Visit): void {
  const example = brainExample(input);
  if (example) { emit(visit, example.rule, example.regions, 1); return; }
  const dynamics = sceneDynamics(input);
  if (dynamics.motion === 0) return;
  const local = input.frame?.source === 'local-camera';
  const tracking = local ? trackingAt(input) : null;
  const strength = trackingStrength(input);
  const body = tracking?.body;
  if (body && strength > 0) {
    for (const side of SIDES) emit(visit, 'M1', WEIGHTS.arm[side], armActivity(body, side) * strength);
    const left = legFlexion(body, 'left'), right = legFlexion(body, 'right');
    const shared = left !== null && right !== null ? Math.min(left, right) : Math.max(left ?? 0, right ?? 0);
    const energy = clamp(tracking?.movement ?? 0);
    if (left !== null) emit(visit, 'M2', WEIGHTS.leg.left, (left - shared + shared * energy) * strength);
    if (right !== null) emit(visit, 'M2', WEIGHTS.leg.right, (right - shared + shared * energy) * strength);
  }
  emit(visit, 'M3', WEIGHTS.movement, ramp(dynamics.movement, 0.05, 0.6));
  emit(visit, 'M4', WEIGHTS.head, headRotation(input, tracking));
  emit(visit, 'M5', WEIGHTS.trunk, ramp(Math.max(Math.abs(dynamics.lean), Math.abs(dynamics.turn)), 0.1, 0.6));
  if (local) {
    emit(visit, 'F1', WEIGHTS.mouth, ramp(Math.max(dynamics.jaw, dynamics.smile), 0.1, 0.7));
    emit(visit, 'F2', WEIGHTS.eyelid, ramp(dynamics.blink, 0.3, 0.8));
    emit(visit, 'F3', WEIGHTS.brow, ramp(dynamics.brow, 0.1, 0.7));
  } else {
    emit(visit, 'S5', WEIGHTS.eyelid, sdkCue(input, 'blink', dynamics.motion));
    emit(visit, 'S6', WEIGHTS.mouth, sdkCue(input, 'talking', dynamics.motion));
  }
}

function strongest(out: Map<string, number>): Visit {
  return (_rule, region, value) => { if (value > (out.get(region) ?? 0)) out.set(region, value); };
}

export function brainRegionActivity(input: SceneFrame, out = new Map<string, number>()): Map<string, number> {
  for (const region of out.keys()) out.set(region, 0);
  evaluate(input, strongest(out));
  return out;
}

export function topBrainRegions(input: SceneFrame, count = 3): BrainRegion[] {
  const best = new Map<string, { intensity: number; rule: BrainRuleId }>();
  evaluate(input, (rule, region, intensity) => {
    if (intensity > (best.get(region)?.intensity ?? 0)) best.set(region, { intensity, rule });
  });
  return [...best].filter(([, entry]) => entry.intensity >= 0.15)
    .sort((a, b) => b[1].intensity - a[1].intensity || a[0].localeCompare(b[0]))
    .slice(0, Math.trunc(clamp(count, 0, 8)))
    .map(([region, entry]) => ({ region, label: regionLabel(region), intensity: entry.intensity, rule: entry.rule }));
}

const GLOW = 0xff7a2e;
const BASE_GLOW = 0.04;
const HIGHLIGHT_GLOW = 1.4;
const TISSUE_SHADE = 0.72;
const HIGHLIGHT_TINT = new THREE.Color(0xff6a1f);
const EXAMPLE_GLOW = 0x1d6dff;
const EXAMPLE_TINT = new THREE.Color(0x2f7dff);
const TILT = 0.45;
const PULSE_RING = { steady: 0xffb0c8, rising: 0xff6f7d, falling: 0x8fc4ff } as const;

export function createAnatomicalBrain(model: THREE.Group): BrainSubject {
  const originals = new Set<THREE.Material>();
  const regions: { name: string; material: THREE.MeshStandardMaterial; base: THREE.Color }[] = [];
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
    originals.add(object.material);
    const material = object.material.clone();
    material.emissive.setHex(GLOW);
    material.emissiveIntensity = BASE_GLOW;
    material.color.multiplyScalar(TISSUE_SHADE);
    object.material = material;
    regions.push({ name: object.name, material, base: material.color.clone() });
  });
  for (const material of originals) material.dispose();
  const names = new Set(regions.map(region => region.name));
  if (BRAIN_MAPPED_REGIONS.some(region => !names.has(region))) {
    disposeObject(model);
    throw new Error('Brain model is missing mapped anatomical regions');
  }
  const root = new THREE.Group();
  root.name = 'AnatomicalBrain';
  const pivot = new THREE.Group();
  pivot.name = 'BrainPivot';
  pivot.position.y = 1.75;
  root.add(pivot);
  try {
    fitModel(model, 2.1);
  } catch (error) {
    disposeObject(model);
    throw error;
  }
  model.position.y -= new THREE.Box3().setFromObject(model).max.y / 2;
  pivot.add(model);
  const ringGeometry = new THREE.TorusGeometry(1.35, 0.016, 6, 96);
  const ring = (name: string, color: number) => {
    const mesh = new THREE.Mesh(ringGeometry, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.4 }));
    mesh.name = name;
    mesh.position.y = 0.3;
    mesh.rotation.x = Math.PI / 2;
    root.add(mesh);
    return mesh;
  };
  const gauge = (mesh: THREE.Mesh, radius: number, value: number) => mesh.scale.set(radius * (1 + value), radius * (1 + value), 1);
  const breathRing = ring('BreathPhaseRing', 0x7fd8e8);
  const breathingRateRing = ring('BreathingRateRing', 0x9fb6ff);
  const pulseRateRing = ring('PulseRateRing', PULSE_RING.steady);
  const pulseMaterial = pulseRateRing.material as THREE.MeshStandardMaterial;
  const activity = new Map<string, number>(regions.map(region => [region.name, 0] as const));
  const raise = strongest(activity);
  let last: SceneFrame | null = null;
  return {
    root,
    update(input) {
      last = input;
      const { time, motion, breath, breathingPace, pulsePace } = sceneDynamics(input);
      pivot.rotation.set(TILT, Math.sin(time * 0.2) * 0.35 * motion, 0);
      // S1-S3 drive body-signal gauges only; BRAIN-EVIDENCE.md forbids mapping these channels to regions.
      gauge(breathRing, 1, breath * 0.12);
      gauge(breathingRateRing, 1.1, breathingPace * 0.2);
      gauge(pulseRateRing, 1.2, pulsePace * 0.2);
      const trend = signalValue(input, 'pulseRate') === null ? undefined : input.frame?.trends?.pulseRate;
      const tone = PULSE_RING[trend?.direction ?? 'steady'];
      pulseMaterial.color.setHex(tone);
      pulseMaterial.emissive.setHex(tone);
      for (const region of activity.keys()) activity.set(region, 0);
      evaluate(input, raise);
      const example = brainExample(input) !== null;
      for (const region of regions) {
        const visible = ramp(activity.get(region.name) ?? 0, 0.05, 0.6) ** 0.7;
        region.material.emissive.setHex(example ? EXAMPLE_GLOW : GLOW);
        region.material.emissiveIntensity = BASE_GLOW + HIGHLIGHT_GLOW * visible;
        region.material.color.copy(region.base).lerp(example ? EXAMPLE_TINT : HIGHLIGHT_TINT, visible * 0.85);
      }
    },
    topRegions: (count = 3) => last ? topBrainRegions(last, count) : [],
    dispose: () => disposeObject(root),
  };
}
