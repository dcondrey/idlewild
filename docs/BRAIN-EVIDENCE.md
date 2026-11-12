# Brain scene evidence and interpretation

Reviewed 2026-11-11. Each cited link below was checked against the primary article. This document defines educational mappings, not evidence of measured neural activity. Camera landmarks, facial weights and SmartSpectra signals do not measure EEG, regional blood flow, neural firing or a person's mood. Motion can select a literature-associated network; animation intensity and timing remain illustrative. Stillness shows a neutral baseline glow and never implies an inactive brain.

Row ids (first column) are stable. Every mapping rule in `src/scenes/brain.ts` names one, and `tests/scenes.test.ts` checks that each rule id exists here. Persistent caption: "Educational simulation based on published studies; not your measured brain activity."

## Anatomy and coordinates

The selected source is Anderson Winkler's [Brain for Blender](https://brainder.org/research/brain-for-blender/): MRI-derived FreeSurfer surfaces of one individual, separate Desikan–Killiany (DK), Destrieux and DKT cortical parcels, and subcortical meshes. It is not a personalized scan or a population functional atlas. The meshes are [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/); attribution, license and modification notices travel in `public/models/brain.glb` `asset.copyright`, `public/models/brain.receipt.json` and `public/models/ATTRIBUTION.md`.

FreeSurfer surface coordinates are ["Vertex RAS" / surface RAS](https://surfer.nmr.mgh.harvard.edu/fswiki/CoordinateSystems) (right, anterior, superior), distinct from scanner RAS and MNI305. `scripts/prepare-brain.py` maps them to glTF metres as X = −R, Y = S, Z = A (determinant +1, no mirroring): anterior faces +Z toward the viewer and the patient's left hemisphere is +X, which a viewer facing the model sees on the right. Published MNI coordinates are never pasted onto this mesh.

DK labels describe anatomy. `precentral`, `postcentral` and `paracentral` are sensorimotor landmarks, but whole gyri are not exact M1/S1 borders or individual hand/foot maps. `superiorfrontal` and `caudalmiddlefrontal` are never relabeled as SMA, premotor cortex or eye fields. Whole cerebellar hemispheres do not isolate motor lobules. On-screen labels use DK or FreeSurfer anatomical names only (for example "Right precentral", "Left cerebellum cortex").

## Movement

"Direct" means a study measured a related task with neuroimaging or electrodes. It does not validate inferring the user's neural activity from video. Side is the participant's anatomical side (MediaPipe `left*` joints), independent of mirrored preview or camera viewpoint. Weights are visual design parameters.

| Id | Observable action | Evidence | Rule in the scene and limit |
| --- | --- | --- | --- |
| M1 | One arm raised or extended (shoulder, elbow, wrist pose) | Direct fMRI, 11 adults ([Luft et al. 2002](https://pmc.ncbi.nlm.nih.gov/articles/PMC6872124/)): elbow flexion/extension activated contralateral M1 and S1; ipsilateral M1 was absent for elbow but present for finger opposition; SMA-proper was almost absent for elbow; anterior-lobe cerebellar activation was somatotopic. Cerebellar limb activation is mostly ipsilateral ([Grodd et al. 2001](https://pmc.ncbi.nlm.nih.gov/articles/PMC6871814/)). | Opposite-hemisphere `precentral` 1.0 and `postcentral` 0.8, same-side `precentral` 0.25, same-side cerebellum cortex 0.45. Drive is upper-arm elevation from hanging or forearm lift above the elbow in the current frame. Wrist landmarks cannot establish finger articulation or a cortical hand map. |
| M2 | One leg flexed (hip/knee pose) | Same study, knee flexion/extension: M1 activation was medial to the finger focus (x ≈ 14 mm vs 36 mm), less lateralized in M1 and S1, ipsilateral M1 was present, and SMA-proper was prominent bilaterally with slight contralateral predominance. | Opposite `paracentral` 1.0, same-side `paracentral` 0.6, `superiorfrontal` 0.5/0.4, opposite `precentral` 0.3, same-side cerebellum cortex 0.35. Flexion shared by both legs (for example sitting) counts only in proportion to overall movement energy, so a still seated pose is not a leg action. Hip/ankle generalization is illustrative; alternating legs do not establish a walking map. |
| M3 | Overall body movement energy (`tracking.movement`) | [Grodd et al. 2001](https://pmc.ncbi.nlm.nih.gov/articles/PMC6871814/), fMRI, 46 adults: two somatotopic cerebellar body maps; hand, arm and foot mostly ipsilateral; lips and tongue bilateral. | Bilateral cerebellum cortex 0.5, bilateral `precentral` 0.25 and `superiorfrontal` 0.2. Combined with other rules by maximum, never summed. No lobules, prediction or error values. |
| M4 | Head rotation away from neutral (face transform) | [Prudente et al. 2015](https://pmc.ncbi.nlm.nih.gov/articles/PMC4469741/), fMRI of isometric head rotation: bilateral precentral gyrus (medial and lateral to the hand area), SMA, insula, putamen, and ipsilateral cerebellum. | Bilateral `precentral` 0.45, `superiorfrontal` 0.35, `insula` 0.35, putamen 0.35, cerebellum cortex 0.35, from rotation magnitude only. Turning right does not illuminate only one hemisphere. The study had no actual head movement; free turns, nods and tilts are extrapolations. Missing face rotation removes the cue. |
| M5 | Torso lean or shoulder turn | No cited study supplies a trunk-specific map. | Low bilateral `precentral` 0.25, `superiorfrontal` 0.2, cerebellum cortex 0.25 as general movement context, labeled approximate. No claim of balance, vestibular function or a trunk representation. |

## Facial actions

| Id | Observable action | Evidence | Rule in the scene and limit |
| --- | --- | --- | --- |
| F1 | Mouth opening or smile-like shape (local face weights) | [Kern et al. 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6435746/), ECoG in six patients (left hemisphere only): sparse, action-specific but overlapping patterns in ventral sensorimotor (mouth motor) cortex for smiling, laughing, lip licking and speech. [Krippl et al. 2015](https://pmc.ncbi.nlm.nih.gov/articles/PMC4623161/), fMRI, 18 adults: lip-corner pull (AU12) and lip press (AU24) activated M1 bilaterally, with SMA showing the strongest activation, plus putamen and insula. | Bilateral `precentral` 0.55, `postcentral` 0.35, `superiorfrontal` 0.25. DK gyri cannot separate the ventral face area from the arm area or one mouth action from another, so this rule is one shared, symmetric orofacial context. A smile-shaped face is not evidence of happiness. |
| F2 | Eyelid closure (local blink weights) | [van Koningsbruggen et al. 2012](https://pmc.ncbi.nlm.nih.gov/articles/PMC5294255/), case study plus fMRI: voluntary blinking activated frontal and supplementary eye fields (FEF, SEF); winking additionally activated posterior parietal cortex. | Dim bilateral `caudalmiddlefrontal` 0.3 and `superiorfrontal` 0.25. The mesh has no FEF/SEF parcels and their DK placement was not verified from a primary source; this is a design approximation labeled by DK name only. Voluntary-task findings do not establish the network of spontaneous blinks. |
| F3 | Brow raise or lowering (local brow weights) | [Krippl et al. 2015](https://pmc.ncbi.nlm.nih.gov/articles/PMC4623161/): brow raiser (AU1+2) and brow lowerer (AU4) had overlapping bilateral M1 representations with SMA involvement. | Bilateral `precentral` 0.4, `superiorfrontal` 0.3. No inference of emotion, attention or deception. Cheek, nose and gaze-like weights have no rule. |

Landmark occlusion, low confidence, missing face rotation and stale samples remove the relevant cue rather than substitute an assumed action. Tracking tracks twelve limb joints and estimated facial weights; it does not track fingers, muscle activation or force.

## SDK channels

Vendor definitions: [SmartSpectra data types](https://smartspectra.presagetech.com/docs/data-types) (`Breathing.upper_trace`, `Breathing.rate`, `Cardio.pulse_rate`, `Cardio.arterial_pressure_trace`, `Face.blinking`, `Face.talking`). The executable contract is `src/contracts.ts` and `desktop/metrics.cjs`.

| Id | Channel | Rule in the scene | Do not infer |
| --- | --- | --- | --- |
| S1 | `breath` | Relative chest-movement value scales the separate breath-phase ring. Replayed values may animate it. | Airflow, lung volume, oxygen, breathing route, calibrated phase or regional neural activity. |
| S2 | `breathingRate` | Estimated rate sets the radius of a separate breathing-rate gauge ring. | Breath onsets, neural oscillation frequency, calmness, stress or a region becoming more or less active. |
| S3 | `pulseRate` | Estimated averaged rate sets the radius of a separate pulse-rate gauge ring. No beat-synchronous pulsing. | Beat timing, HRV, blood pressure, fear, excitement, fitness or a brain activation map. |
| S4 | `arterialTrace` | No rule in the brain scene. | Absolute pressure, cerebral perfusion, EEG, heartbeat events or emotion. |
| S5 | `blink` | Sampled detection drives the F2 eyelid context. Replayed samples are ignored. | Blink counts, attention, fatigue or cognitive state. |
| S6 | `talking` | Sampled detection drives the F1 orofacial context. Replayed samples are ignored. | Words, language regions, emotional tone or speech quality. |

Each display requires a present, valid, fresh sample on the correct clock (`signalValue`: 1,500 ms limit, linear fade over the final 500 ms; tracking: 300 ms). These are application bounds, not physiological validation. Local camera tracking provides no breathing or pulse channels; missing physiology stays missing.

Rising or falling pulse is not shown. A trend needs multiple distinct valid samples and history reset across sessions, gaps and seeks, but a scene receives one frame and must stay deterministic under seek. A trend would need an upstream field with a disclosed window, and it would still drive the gauge, not regions.

## Body-signal and mood studies (narration only)

| Id | Study | Use and limit |
| --- | --- | --- |
| B1 | [Zelano et al. 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC5148230/), intracranial EEG in seven patients: nasal breathing entrained piriform cortex, amygdala and hippocampus; the effect weakened with oral breathing. | Optional narrated example. A chest trace cannot observe breathing route or limbic coupling; no phase-locked regional display. |
| B2 | [Herrero et al. 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5866472/), intracranial EEG: volitional paced breathing increased breath coherence in a frontotemporal-insular network; attending to breathing involved anterior cingulate, premotor, insular and hippocampal cortex. | Optional narrated example of controlled breathing tasks, not a live map. |
| B3 | [Jones et al. 2015](https://pmc.ncbi.nlm.nih.gov/articles/PMC4373272/), fMRI, 15 adults instructed to raise or lower heart rate with feedback. | Task-specific; no universal map for spontaneous pulse changes. No rule. |
| B4 | [Garfinkel et al. 2014](https://pmc.ncbi.nlm.nih.gov/articles/PMC4012313/): fear processing differed between systole and diastole, using ECG-timed stimuli. | Requires beat timing that averaged `pulseRate` cannot reconstruct. No rule. |
| C1 | [Damasio et al. 2000](https://doi.org/10.1038/79871), PET, 41 adults recalling sadness, happiness, anger or fear: activity in somatosensory cortices and upper brainstem nuclei, among other regions. | Interpretation only, for an example the user explicitly selects, labeled **educational example**. Never classified from face, pulse or breathing. Not implemented: `SceneFrame` has no user-selected example, and no mood heatmap is drawn. |

## Rendering parameters

- Each mesh gets its own clone of the GLB material once at load (102 materials, same shader program, disposed with the scene). Per frame only `emissiveIntensity` changes: 0.06 baseline glow for every region plus up to 0.9 for highlights. A per-hemisphere `ShaderMaterial` was rejected because the GLB exporter refuses custom shaders.
- Attack is a smoothstep ramp on each current-frame input. Release comes from the existing freshness tapers above. There is no hidden easing state, so a seek or repeated frame gives the same output. Temporal smoothing stays in `src/tracking/mapping.ts`.
- Labels list at most the three strongest regions at or above 0.15, using anatomical names.
- Reduced motion or Motion 0 freezes the slow yaw and returns every region to the baseline glow.

## Acceptance boundaries

- The persistent caption distinguishes an anatomical model and educational simulation from neural measurement; selected mood examples remain separate from live inputs.
- Region labels keep atlas names; functional overlays state their approximation and source.
- Left/right and contralateral/ipsilateral behavior are checked after conversion, rotation and preview mirroring (unit test on GLB axes plus anterior/posterior/left/right screenshots).
- Missing, stale, synthetic and replayed sources remain distinguishable in UI, recordings and exports; none silently becomes measured activity.
- Brightness, ring size, colors and delays are visual encoding, without physiological units or validated activation claims.
