# Vocal Guide 3+1D (`vocal-guide-4d`) — Specification

## 1. Purpose & Motivation

Static singing guides explain vocal registers, styles, effects, ornaments, and breath support in prose ("thin the vocal folds", "narrow the aryepiglottic funnel", "tilt the larynx", "hold rib expansion while abs meter exhalation"), leaving the learner to guess what the hidden 3D musculature is actually doing over time.

**Vocal Guide 3+1D** fuses Jesper Ordrup's MIT-licensed [Vocal Guide](https://jesperordrup.github.io/vocal-guide/) (21 vocal techniques across 5 categories, Complete Vocal Technique [CVT] 4-mode cross-reference, 5-minute + extended warm-ups, 6-step beginner roadmap, anatomy notes, and 10 vocal myths, with English/Danish toggle) with an interactive **3+1D ($\mathbb{R}^3 \times \mathbb{R}_t$) biomechanical visualizer** built on verified **BodyParts3D 4.3** anatomical meshes.

## 2. Coordinate Frame & Anatomical Provenance

- **Primary Anatomical Source**: BodyParts3D / Anatomography v4.3 (© The Database Center for Life Science — DBCLS, licensed under `CC-BY-SA-2.1-JP`), pinned to `olivercase/body_parts_3d_api` (`fd527e6f4daf732fd814314d9257df5877b844bc`) and OrganUI's SHA-256-verified distributions (`larynx-3d`, `pharynx-3d`, `tongue-3d`, `muscles-3d`, `skeleton-3d`, `lungs-3d`).
- **Patient Millimeter Frame $\to$ Display Scene Frame**:
  - Raw BodyParts3D coordinates $(x_{\text{mm}}, y_{\text{mm}}, z_{\text{mm}})$ use $+x$ = patient left, $-y$ = anterior, $+z$ = superior.
  - All structures from all regional subsets are mapped back to exact patient millimeters, verified via shared landmark geometry (`hyoid-bone` `FJ2772` bounding-box alignment $< 0.05\,\text{mm}$ error), centered on the glottal midpoint $\mathbf{o}_{\text{glottis}}$ (between left and right vocal ligaments), and converted to Three.js scene units ($1\text{ unit} = 10\,\text{mm} = 1\,\text{cm}$):
    $$X = \frac{x_{\text{mm}} - o_x}{10}, \qquad Y = \frac{z_{\text{mm}} - o_z}{10}, \qquad Z = \frac{-(y_{\text{mm}} - o_y)}{10}$$
    so $+X$ is patient left, $+Y$ is superior (up), and $+Z$ is anterior (facing the viewer).

## 3. Four Anatomical Layers

1. **Laryngeal Core (`larynx`)** — Left/right separated BodyParts3D 4.3 meshes for genuine bilateral kinematics:
   - Cartilages & Bone: `hyoid-bone`, `thyroid-cartilage`, `cricoid-cartilage`, `epiglottis`, `right-arytenoid`, `left-arytenoid`, `right-corniculate`, `left-corniculate`, `right-cuneiform`, `left-cuneiform`.
   - Ligaments & Membranes: `right-vocal-ligament`, `left-vocal-ligament`, `right-conus-elasticus`, `left-conus-elasticus`, `median-cricothyroid-ligament`, `thyrohyoid-membrane`, `epiglottic-ligaments`.
   - Intrinsic Muscles: `cricothyroid-recta` (pars recta), `cricothyroid-obliqua` (pars obliqua), `right-vocalis`, `left-vocalis`, `right-thyroarytenoid`, `left-thyroarytenoid`, `right-lateral-cricoarytenoid` (`LCA`), `left-lateral-cricoarytenoid`, `right-posterior-cricoarytenoid` (`PCA`), `left-posterior-cricoarytenoid`, `transverse-arytenoid` (`IA`), `oblique-arytenoid`, `right-aryepiglottic` (`AES`), `left-aryepiglottic`.
   - Parametric Deformable Surfaces (explicitly labeled as biomechanical cover models fitted to BodyParts3D landmarks, since BodyParts3D omits laryngeal mucosa):
     - **True Vocal Fold Mucosal Cover** (left & right): High-resolution ribbon mesh spanning the live anterior thyroid commissure to the live arytenoid vocal processes, exhibiting vertical phase-lagged mucosal waves.
     - **Ventricular (False) Vocal Folds** (left & right): Supraglottic folds superior to the laryngeal ventricle for healthy vs. pressed distortion/grit/growl visualization.
2. **Extrinsic Laryngeal & Jaw Muscles (`extrinsic`)**:
   - Infrahyoid Depressors / Anchors: `sternohyoid`, `sternothyroid`, `thyrohyoid`, `omohyoid`.
   - Suprahyoid Elevators: `digastric`, `stylohyoid`, `mylohyoid`, `geniohyoid`.
   - Jaw & Neck Tension Indicators: `masseter`, `medial-pterygoid`, `lateral-pterygoid`, `sternocleidomastoid`.
3. **Supraglottal Vocal Tract & Articulators (`tract`)**:
   - `tongue`, `genioglossus`, `hyoglossus`, `levator-veli-palatini`, `tensor-veli-palatini`, `musculus-uvulae`, `palatopharyngeus`, `stylopharyngeus`, `superior-pharyngeal-constrictor`, `middle-pharyngeal-constrictor`, `inferior-pharyngeal-constrictor`, `mandible`.
4. **Thoraco-Abdominal Breath Appoggio (`breath`)**:
   - `trachea`, `lungs`, `diaphragm`, `thoracic-cage` (sternum, ribs, costal cartilages, spine), `external-intercostals`, `internal-intercostals`, `rectus-abdominis`, `external-oblique`, `internal-oblique`, `transversus-abdominis`, `quadratus-lumborum`.

## 4. Dual-Timescale `3+1D` Biomechanical Model

Every vocal event is parameterized over two coupled time coordinates:

1. **Macro Gesture / Exercise Time $t \in [0, T]$ ($4\text{–}10\,\text{s}$)**:
   - Drives a 12-channel neuromotor activation vector $\mathbf{u}(t) \in [0,1]^{12}$:
     `CT` (cricothyroid), `TA` (thyroarytenoid + vocalis), `LCA` (lateral cricoarytenoid), `IA` (interarytenoid), `PCA` (posterior cricoarytenoid), `AES` (aryepiglottic twang sphincter), `FVF` (ventricular/false folds), `INF` (infrahyoid depressors), `SUP` (suprahyoid/jaw elevators), `VEL` (velar elevation + vowel tract shaping), `DIA` (diaphragm inspiratory contraction), `APP` (external intercostal rib hold + abdominal metering).
   - Drives rigid + non-rigid 3D kinematics:
     - Whole-larynx vertical displacement $\Delta y_{\text{larynx}}(t)$ with longitudinal strap-muscle stretching/shortening pinned at bony origins.
     - Cricothyroid visor tilt $\theta_{\text{CT}}(t)$ & anterior glide $\Delta z_{\text{CT}}(t)$ around the extracted cricothyroid joint axis, elongating the vocal folds.
     - Bilateral cricoarytenoid rocking/rotation/sliding on the cricoid facets (`PCA` abduction V-glottis $\leftrightarrow$ `LCA` vocal-process approximation $\leftrightarrow$ `IA` posterior cartilaginous seal vs. falsetto/breathy posterior chink).
     - Epilaryngeal funnel narrowing (`AES` + epiglottis tilt).
     - Jaw rotation around the TMJ condylar axis, tongue dorsum vowel modification, and velopharyngeal port lift/drop.
     - Diaphragm central-tendon descent/ascent, lung + costal bucket-handle expansion, and abdominal wall metering.
2. **Micro Stroboscopic Glottal Phase $\phi \in [0, 2\pi)$**:
   - Renders the stroboscopic slow-motion glottal cycle (default $2.5\,\text{Hz}$ visual strobe or manual $0^\circ\text{–}360^\circ$ phase scrub) with inferior-to-superior vertical phase lag ($\Delta\psi \approx 60^\circ$, convergent opening $\to$ divergent closing), closed-quotient $CQ(\text{TA}, \text{LCA}, \text{IA})$, vocal-fry dicrotic double-pulsing, whistle anterior-pocket damping, false-fold subharmonic oscillation, transglottal airflow streamlines, and a synchronized **2D Coronal Cross-Section + Glottal Area / EGG Waveform** HUD.

## 5. Pedagogical Features & Safety Boundary

- **Complete MIT-Attributed Vocal Guide**: All 21 techniques, 5 categories, prerequisites, exercises, safety warnings, CVT 4-mode mapping, Warm-Up Coach with live countdown timer, Beginner 8-week guide, Anatomy notes, and 10 Vocal Myths, in both English (`EN`) and Danish (`DA`).
- **Healthy vs. Strain A/B Mode**: Interactive toggle showing healthy biomechanics vs. common vocal faults (pushed chest belt, high-larynx constriction, protruding jaw, clavicular chest heave, true-fold pressed rasp) with clear visual strain indicators.
- **Synchronized LF-Formant Web Audio Synthesizer**: Optional real-time Web Audio tone/exercise preview driven directly by $\mathbf{u}(t)$ (LF glottal source + 4-formant vocal tract cascade + aspiration turbulence + subharmonic false-fold roughness).
- **Explicit Claim Boundary**: Biomechanical trajectories are pedagogical physiological models grounded in peer-reviewed voice science (Titze myoelastic-aerodynamic mucosal wave theory, Hirano body-cover model, Sadolin CVT laryngoscopic descriptions) applied to BodyParts3D static anatomy — not patient-specific clinical stroboscopy or medical advice.

## 6. Verification Criteria

1. `uv run scripts/build_anatomy.py --verify` verifies SHA-256 checksums, confirms $< 0.05\,\text{mm}$ cross-archive landmark alignment, validates watertight index bounds, and emits `public/models/vocal-anatomy.glb` + `src/data/anatomyRig.json`.
2. `npm test` (Vitest) verifies all 21 technique trajectories, CVT presets, warm-up steps, myth presets, kinematic invariants (fold elongation under `CT`, glottal gap closure under `LCA+IA`, abduction under `PCA`, diaphragm descent under `DIA`), and bilingual content completeness.
3. `npm run build` compiles cleanly with strict TypeScript (`tsc --noEmit && vite build`).
4. Live browser / Playwright verification confirms zero console/page errors, responsive 3D WebGL rendering across camera presets, timeline scrubbing, A/B strain comparison, and deployed GitHub Pages availability at `https://alok.github.io/vocal-guide-4d/`.
