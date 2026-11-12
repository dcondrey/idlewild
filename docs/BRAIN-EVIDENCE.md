# Brain scene evidence and interpretation

Reviewed 2026-11-11. This document defines educational mappings, not evidence of measured neural activity. Camera landmarks, facial weights and SmartSpectra signals do not measure EEG, regional blood flow, neural firing or a person's mood. Motion can select a literature-associated network; animation intensity and timing remain illustrative. Stillness must not imply an inactive brain.

## Anatomy and coordinates

The selected source is Anderson Winkler's [Brain for Blender](https://brainder.org/research/brain-for-blender/): MRI-derived FreeSurfer surfaces, separate Desikan–Killiany (DK), Destrieux and DKT cortical parcels, and subcortical meshes from the same individual. It is one person's anatomy, not a personalized scan or population functional atlas. The meshes are [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/); attribution, license and modification notices must accompany distributed and exported derivatives. Acquisition, conversion and runtime verification belong in the asset provenance record.

FreeSurfer surface coordinates use [surface RAS / tkrRAS](https://surfer.nmr.mgh.harvard.edu/fswiki/CoordinateSystems): positive axes point right, anterior and superior. They are not automatically scanner RAS or MNI coordinates. Preserve left/right labels through conversion and verify the actual file conventions and transforms; never paste published MNI activation coordinates onto this mesh without registration.

DK labels describe anatomy. `precentral`, `postcentral` and `paracentral` are useful sensorimotor landmarks, but whole gyri are not exact M1/S1 functional borders or individual hand/foot maps. `superiorfrontal` and `caudalmiddlefrontal` must not be relabeled as exact SMA or premotor cortex. Whole cerebellar hemispheres do not isolate motor lobules. An overlay within these parcels is an approximate educational location, explicitly distinct from the parcel's anatomical label. Subcortical structures require their actual segmented meshes; do not place decorative points and give them anatomical names.

## Movement and facial actions

“Direct” below means a study measured a related task with neuroimaging or electrodes. It does not validate inferring the user's neural activity from video.

| Observable action | Supported association and evidence | Visualization rule and limit |
| --- | --- | --- |
| One arm moving: shoulder, elbow or wrist | Direct fMRI evidence for elbow movement and finger tapping includes contralateral sensorimotor cortex, premotor/SMA regions and cerebellum. [Luft et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC6872124/) | Emphasize the opposite cortical hemisphere, with distributed bilateral support. Shoulder-only application is a broad motor-network extrapolation. Wrist landmarks cannot establish finger articulation or an exact cortical hand map. |
| One leg moving: hip, knee or ankle | The same study measured knee flexion/extension: cortical representation was more medial and less strongly lateralized than upper-limb movement. | Use medial sensorimotor/paracentral context with a contralateral bias, not an exclusive hemisphere. Hip/ankle generalization is illustrative. Visible alternating legs do not establish a validated walking/running brain map. |
| Both arms/legs, coordinated whole-body motion | Limb-task findings support combined sensorimotor and movement-planning context; [Grodd et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC6871814/) directly mapped cerebellar sensorimotor organization. | Combine the observed sides without letting amplitudes add without bound. Cerebellar limb emphasis may be ipsilateral, but do not assign exact lobules or prediction/error values from landmark speed. |
| Head turn or neck movement | Isometric head rotation produced bilateral precentral, SMA, insular, putaminal and cerebellar involvement. [Prudente et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC4469741/) | Use bilateral motor context. Turning right is not a rule to illuminate only left cortex. The study used muscle contraction without actual head movement; nods, tilt and free movement are extrapolations. |
| Torso lean, shoulder/hip shift or balance-like movement | The cited limb/head evidence does not supply a validated trunk-specific map. | Display general bilateral movement context, labeled approximate. Do not claim measured balance, vestibular function or a specific trunk representation. |
| Mouth opening, lip action, smile-like shape or talking detection | Human intracranial recordings found overlapping but distinct mouth-motor patterns for smiling, laughing, lip licking and speech. [Kern et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC6435746/) | Show facial motor context. A smile-shaped face is not evidence of happiness; talking detection does not identify language, phonemes, comprehension or intent. Do not make every facial action the same purported activation map. |
| Blink or wink | Instructed eye closure engaged frontal/supplementary eye fields; winking additionally involved posterior parietal cortex. [van Koningsbruggen et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC5294255/) | Identify the detected eyelid action. Voluntary-task findings do not establish the network of every spontaneous blink. These functional fields are not explicit DK parcels: omit exact overlays unless separately qualified. |
| Brow, cheek, nose or gaze-like weights | The current evidence does not establish a specific regional map for each model output. | Keep the visible facial action and broad facial motor explanation. Do not infer emotion, attention, deception or measured gaze from a coefficient. |

The side is the participant's anatomical side, independent of mirrored preview or camera viewpoint. Landmark occlusion, low visibility, missing face rotation and stale samples must remove the relevant live cue rather than substitute an assumed action. The current tracking contract has twelve limb joints and estimated facial weights; it does not track fingers, muscle activation or force.

## SDK channel rules

The implemented adapter requests six channels. Vendor definitions are in [SmartSpectra data types](https://smartspectra.presagetech.com/docs/data-types); the executable contract is `src/contracts.ts` and `desktop/metrics.cjs`.

| Channel | Supported visualization | Do not infer |
| --- | --- | --- |
| `breath` | Relative chest-movement trace, breathing illustration or separate body-signal ring. | Airflow, lung volume, oxygen, nasal/oral route, calibrated inhalation phase or regional neural activity. |
| `breathingRate` | Report the estimated rate in breaths/min and a clearly labeled rate trend. A rate-driven animation is illustrative. | Individual breath onset, neural oscillation frequency, calmness, stress or a region becoming more/less active. |
| `pulseRate` | Report the estimated averaged rate in beats/min. Rising/falling may describe the signal over a disclosed observation window. | Individual beat timing, HRV, blood pressure, fear, excitement, fitness or an increasing/decreasing brain activation map. |
| `arterialTrace` | Show the vendor's relative arterial waveform separately from the anatomical brain. | Absolute pressure, cerebral perfusion, EEG, validated heartbeat events or emotion. Beat/phase extraction needs independent timing and artifact validation. |
| `blink` | Sampled detection state; optional eyelid-action illustration. | Blink counts without event processing, attention, fatigue or cognitive state. |
| `talking` | Sampled talking detection and an orofacial-action illustration. | Words, emotional tone, language regions, speech quality or reliable breathing rate during speech. |

Each display requires a present, valid, fresh sample on the correct clock. The existing SDK freshness limit is 1,500 ms; tracking uses 300 ms. These are application bounds, not physiological validation. Treat gaps and invalid measurements as unavailable. Repeated copies of one timestamp are not new trend observations. Reset trend history across source/session changes, gaps and seeks; a rising/falling label needs multiple distinct valid samples. Any smoothing window, deadband and animation gain are disclosed design parameters, not research-derived accuracy.

`synthetic` rehearsal and `replayed` breathing continuity remain visibly identified. Replayed values can animate a clearly labeled breathing illustration but cannot contribute to physiological trends or inferred neural relationships. Local camera tracking provides no measured breathing or pulse channels; missing physiology remains missing.

## Body signals and subjective mood

Respiration can interact with brain activity, but a chest trace does not observe that interaction. [Zelano et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC5148230/) recorded nasal-respiration coupling in piriform cortex, amygdala and hippocampus using intracranial electrodes; effects depended on breathing route. [Herrero et al.](https://journals.physiology.org/doi/full/10.1152/jn.00551.2017) measured breathing-related cortical signals during controlled breathing and attention tasks. These support an optional narrated educational example, not a phase-locked live neural display.

In a 15-person fMRI experiment, instructed heart-rate regulation involved prefrontal and other regions, with task-dependent relationships to measured physiology. [Jones et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC4373272/) does not provide a universal map for spontaneous rising/falling pulse. Heart-rate trends may accompany movement or many other conditions; direction alone does not identify a cause or mental state. Cardiac-phase research also requires actual beat timing: [Garfinkel et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC4012313/) studied fear processing relative to cardiac phase, which averaged `pulseRate` cannot reconstruct.

Mood examples must be explicitly selected by the user and labeled **educational example**, never classified from facial movements, pulse or respiration. A choice such as happiness, sadness, anger or fear can introduce a sourced study of emotional recollection: [Damasio et al.](https://www.nature.com/articles/nn1000_1049) used PET while 41 participants recalled emotional autobiographical experiences. That task is not continuous mood detection and does not justify an exclusive “happiness center,” fixed activation strength or a map of the current user. Until task-specific regional evidence and anatomical correspondence are qualified, keep the explanation and anatomy without a fabricated mood heatmap.

## Acceptance boundaries

- Persistent caption distinguishes an anatomical model and educational simulation from neural measurement; selected mood examples remain separate from live inputs.
- Region labels retain the atlas names; functional overlays state their approximation and source.
- Left/right and contralateral/ipsilateral behavior are checked after conversion, rotation and preview mirroring.
- Missing, stale, synthetic and replayed sources remain distinguishable in UI, recordings and exports; none silently becomes measured activity.
- Rendered brightness, particle motion, colors and delays are described as visual encoding, without physiological units or validated activation claims.
