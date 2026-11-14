import {
  CHANNEL_ORDER,
  type ChannelVector,
  type GlottalCycleSample,
  type KinematicFrame,
  type RigLandmarks,
  type TimelineKeyframe,
  type VowelId,
} from './types';

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep01(t: number): number {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const VOWEL_BASE_FORMANTS: Record<
  VowelId,
  { f1: number; f2: number; f3: number; arch: number; front: number; velum: number }
> = {
  AA: { f1: 730, f2: 1120, f3: 2520, arch: -0.25, front: -0.15, velum: 0.9 },
  AE: { f1: 680, f2: 1740, f3: 2560, arch: 0.12, front: 0.42, velum: 0.85 },
  EH: { f1: 540, f2: 1840, f3: 2540, arch: 0.25, front: 0.36, velum: 0.88 },
  IH: { f1: 410, f2: 1980, f3: 2600, arch: 0.44, front: 0.48, velum: 0.9 },
  IY: { f1: 290, f2: 2280, f3: 2920, arch: 0.62, front: 0.62, velum: 0.94 },
  OH: { f1: 560, f2: 920, f3: 2480, arch: 0.08, front: -0.34, velum: 0.92 },
  UH: { f1: 460, f2: 1080, f3: 2440, arch: 0.22, front: -0.24, velum: 0.92 },
  UW: { f1: 320, f2: 860, f3: 2380, arch: 0.48, front: -0.38, velum: 0.95 },
  MM: { f1: 280, f2: 1050, f3: 2250, arch: 0.18, front: 0.08, velum: 0.12 },
};

export function createZeroChannels(): ChannelVector {
  return {
    CT: 0,
    TA: 0,
    LCA: 0,
    IA: 0,
    PCA: 0,
    AES: 0,
    FVF: 0,
    INF: 0,
    SUP: 0,
    VEL: 0,
    DIA: 0,
    APP: 0,
  };
}

export function interpolateKeyframes(
  keyframes: readonly TimelineKeyframe[],
  tNormRaw: number,
): {
  phaseLabel: TimelineKeyframe['phase'];
  channels: ChannelVector;
  f0Hz: number;
  vowel: VowelId;
  jawOpen: number;
  jawJut: number;
  clavicularHeave: number;
} {
  if (keyframes.length === 0) {
    throw new Error('Trajectory must contain at least one keyframe');
  }
  const tNorm = clamp(tNormRaw, 0, 1);
  if (keyframes.length === 1 || tNorm <= keyframes[0].tNorm) {
    const k = keyframes[0];
    return {
      phaseLabel: k.phase,
      channels: { ...k.channels },
      f0Hz: k.f0Hz,
      vowel: k.vowel,
      jawOpen: k.jawOpen,
      jawJut: k.jawJut ?? 0,
      clavicularHeave: k.clavicularHeave ?? 0,
    };
  }

  let idx = keyframes.length - 2;
  for (let i = 0; i < keyframes.length - 1; i++) {
    if (tNorm >= keyframes[i].tNorm && tNorm <= keyframes[i + 1].tNorm) {
      idx = i;
      break;
    }
  }

  const a = keyframes[idx];
  const b = keyframes[idx + 1];
  const span = Math.max(1e-6, b.tNorm - a.tNorm);
  const local = smoothstep01((tNorm - a.tNorm) / span);

  const channels = createZeroChannels();
  for (const ch of CHANNEL_ORDER) {
    channels[ch] = clamp(lerp(a.channels[ch], b.channels[ch], local), 0, 1);
  }

  // Interpolate pitch in log-frequency (semitones) when both frames are phonating
  const f0Hz =
    a.f0Hz > 20 && b.f0Hz > 20
      ? Math.exp(lerp(Math.log(a.f0Hz), Math.log(b.f0Hz), local))
      : lerp(a.f0Hz, b.f0Hz, local);

  return {
    phaseLabel: local < 0.88 ? a.phase : b.phase,
    channels,
    f0Hz,
    vowel: local < 0.5 ? a.vowel : b.vowel,
    jawOpen: clamp(lerp(a.jawOpen, b.jawOpen, local), 0, 1),
    jawJut: clamp(lerp(a.jawJut ?? 0, b.jawJut ?? 0, local), 0, 1),
    clavicularHeave: clamp(
      lerp(a.clavicularHeave ?? 0, b.clavicularHeave ?? 0, local),
      0,
      1,
    ),
  };
}

function rotateAroundX(
  pt: readonly [number, number, number],
  pivot: readonly [number, number, number],
  rad: number,
): [number, number, number] {
  const dy = pt[1] - pivot[1];
  const dz = pt[2] - pivot[2];
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  // Positive visor tilt: superior anterior notch rotates forward (+Z) and downward (-Y)
  return [pt[0], pivot[1] + dy * c - dz * s, pivot[2] + dy * s + dz * c];
}

function rotateAroundY(
  pt: readonly [number, number, number],
  pivot: readonly [number, number, number],
  rad: number,
): [number, number, number] {
  const dx = pt[0] - pivot[0];
  const dz = pt[2] - pivot[2];
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [pivot[0] + dx * c - dz * s, pt[1], pivot[2] + dx * s + dz * c];
}

export function solveKinematics(
  tNorm: number,
  phaseLabel: TimelineKeyframe['phase'],
  channels: ChannelVector,
  f0Hz: number,
  vowel: VowelId,
  jawOpen: number,
  jawJut: number,
  clavicularHeave: number,
  landmarks: RigLandmarks,
): KinematicFrame {
  const { CT, TA, LCA, IA, PCA, AES, FVF, INF, SUP, VEL, DIA, APP } = channels;

  // 1. Extrinsic vertical larynx shift (cm; 1 unit = 1 cm)
  // Infrahyoids gently anchor/lower (-0.82 cm max); suprahyoids elevate (+1.05 cm max)
  const larynxShiftCm = clamp(SUP * 1.02 - INF * 0.82 + jawJut * 0.32, -0.9, 1.25);

  // 2. Cricothyroid visor rotation + anterior pars-obliqua glide (stretches folds)
  // TA slightly antagonizes CT shortening when CT is low
  const netStretch = clamp(CT - 0.18 * TA * (1 - 0.65 * CT), -0.14, 1.0);
  const ctTiltRad = netStretch * 0.21;
  const ctGlideCm = Math.max(0, netStretch) * 0.145 - Math.max(0, -netStretch) * 0.05;

  const antTilted = rotateAroundX(
    landmarks.anteriorCommissure,
    landmarks.cricothyroidPivot,
    ctTiltRad,
  );
  const liveAnteriorCommissure: [number, number, number] = [
    antTilted[0],
    antTilted[1] + larynxShiftCm,
    antTilted[2] + ctGlideCm,
  ];

  // 3. Cricoarytenoid bilateral rotation & interarytenoid medial sliding
  // Resting BodyParts3D vocal processes sit at x ≈ ±0.293 cm (5.87 mm apart).
  // Adduction: LCA rotates vocal process medially; IA slides arytenoid bases together.
  // Abduction: PCA rotates vocal process laterally and slides slightly apart.
  const medialDrive = clamp(0.62 * LCA + 0.38 * IA - 0.85 * PCA, -0.85, 1.0);
  const caRotateLeft = clamp(0.68 * LCA - 0.62 * PCA, -0.65, 0.68);
  const caRotateRight = -caRotateLeft;
  const iaSlideCm = clamp(0.228 * IA + 0.048 * LCA - 0.09 * PCA, -0.1, 0.24);

  const lRot = rotateAroundY(
    landmarks.leftVocalProcess,
    landmarks.leftCricoarytenoidPivot,
    caRotateLeft,
  );
  const rRot = rotateAroundY(
    landmarks.rightVocalProcess,
    landmarks.rightCricoarytenoidPivot,
    caRotateRight,
  );

  // Clamp vocal processes so they meet cleanly at midline (0.0 cm) without interpenetrating
  const midlineX = landmarks.anteriorCommissure[0];
  const rawLeftX = lRot[0] - iaSlideCm;
  const rawRightX = rRot[0] + iaSlideCm;
  const minHalfGap = medialDrive > 0.68 ? 0.0 : 0.002;

  const liveLeftVocalProcess: [number, number, number] = [
    Math.max(midlineX + minHalfGap, rawLeftX),
    lRot[1] + larynxShiftCm,
    lRot[2],
  ];
  const liveRightVocalProcess: [number, number, number] = [
    Math.min(midlineX - minHalfGap, rawRightX),
    rRot[1] + larynxShiftCm,
    rRot[2],
  ];

  // 4. Live fold length, elongation %, thickness, and glottal gaps
  const lenLeftCm = Math.hypot(
    liveLeftVocalProcess[0] - liveAnteriorCommissure[0],
    liveLeftVocalProcess[1] - liveAnteriorCommissure[1],
    liveLeftVocalProcess[2] - liveAnteriorCommissure[2],
  );
  const lenRightCm = Math.hypot(
    liveRightVocalProcess[0] - liveAnteriorCommissure[0],
    liveRightVocalProcess[1] - liveAnteriorCommissure[1],
    liveRightVocalProcess[2] - liveAnteriorCommissure[2],
  );
  const foldLengthMm = 0.5 * (lenLeftCm + lenRightCm) * 10.0;
  const foldElongationPct =
    ((foldLengthMm - landmarks.restingFoldLengthMm) / landmarks.restingFoldLengthMm) *
    100.0;

  // Vertical contacting thickness (Hirano body-cover: TA thickens to ~5.4 mm, CT thins to ~1.5 mm)
  const foldThicknessMm = clamp(2.5 + 3.0 * TA - 1.45 * CT, 1.35, 5.65);

  // Whistle register damps the posterior/middle portion, leaving an anterior vibrating pocket
  const whistleFactor =
    f0Hz > 880 && CT > 0.82 && TA < 0.28
      ? smoothstep01((f0Hz - 880) / 220)
      : 0.0;
  const activeLengthFraction = lerp(1.0, 0.36, whistleFactor);

  const posteriorChinkMm = Math.max(
    0,
    (liveLeftVocalProcess[0] - liveRightVocalProcess[0]) * 10.0,
  );
  // TA medial body bulge helps approximate the mid-membranous glottis
  const taMedialBulgeMm = 0.85 * TA * (1 - 0.45 * CT);
  const membranousGapMm = Math.max(0, 0.52 * posteriorChinkMm - taMedialBulgeMm);

  // 5. Breath Appoggio & Subglottal Pressure
  const inhaling = PCA > 0.38 && LCA < 0.28;
  const diaphragmDescentCm = DIA * 3.4;
  const ribExpansion = clamp(0.62 * DIA + 0.58 * APP - 0.25 * clavicularHeave, 0, 1);
  const abdominalTone = APP;

  const subglottalPressureKpa = inhaling
    ? 0.0
    : clamp(
        0.32 + 1.45 * APP + 0.48 * TA + 0.25 * AES - 0.35 * PCA,
        0.0,
        2.6,
      );

  // 6. Micro-glottal wave parameters (closed quotient, wave amp, phase lag, fry, false folds)
  const phonating = !inhaling && f0Hz > 30 && subglottalPressureKpa > 0.22 && LCA + IA > 0.22;
  const closureDrive = clamp(0.46 * LCA + 0.28 * IA + 0.36 * TA - 0.5 * PCA, 0, 1);
  const closedQuotient = phonating
    ? clamp(0.14 + 0.56 * closureDrive - 0.12 * whistleFactor, 0.06, 0.72)
    : LCA > 0.88 && IA > 0.88 && f0Hz <= 30
      ? 1.0 // Full glottal-stop hold prior to release
      : 0.0;

  // Dicrotic vocal fry when f0 < 92 Hz, CT slack, TA loose-thick, low pressure
  const dicroticFry =
    phonating && f0Hz < 92 && CT < 0.22
      ? smoothstep01((92 - f0Hz) / 30)
      : 0.0;

  const mucosalWaveAmpMm = phonating
    ? clamp(
        (0.48 + 0.72 * subglottalPressureKpa) *
          (1.0 - 0.38 * CT) *
          (1.0 - 0.45 * whistleFactor) *
          (1.0 - 0.25 * Math.max(0, FVF - 0.65)),
        0.18,
        1.65,
      )
    : 0.0;

  // Thicker TA folds create larger inferior-to-superior vertical phase lag (~65-75 deg)
  const verticalPhaseLagRad = lerp(0.42, 1.28, clamp(0.3 + 0.7 * TA - 0.3 * CT, 0, 1));

  // Supraglottic epilarynx (AES twang) and ventricular (false) folds
  const aesNarrowing = AES;
  const falseFoldGapMm = clamp(6.4 - 5.1 * FVF - 1.1 * SUP * jawJut, 0.6, 6.6);
  const falseFoldOscillationMm =
    phonating && FVF > 0.32 ? (FVF - 0.32) * 1.35 * clamp(subglottalPressureKpa, 0.4, 1.8) : 0.0;

  // Transglottal airflow (L/s): negative on inhalation, metered positive on phonation
  let airflowLps = 0;
  if (inhaling) {
    airflowLps = -(0.35 + 0.85 * PCA * (0.4 + 0.6 * DIA));
  } else if (subglottalPressureKpa > 0.05) {
    const leakArea = posteriorChinkMm * 0.45 + membranousGapMm * 0.85;
    const acousticEfficiency = 1.0 - 0.32 * AES;
    airflowLps = clamp(
      (0.07 + 0.09 * leakArea) * subglottalPressureKpa * acousticEfficiency,
      0.0,
      0.85,
    );
  }

  // 7. Vocal tract articulators & live formant frequencies
  const jawAngleRad = jawOpen * 0.34;
  const vowelSpec = VOWEL_BASE_FORMANTS[vowel];
  const velumLiftCm = clamp(0.55 * VEL + 0.45 * vowelSpec.velum, 0, 1) * 0.58;
  const tongueArchCm = vowelSpec.arch * 0.55 - jawOpen * 0.16;
  const tongueFrontCm = vowelSpec.front * 0.52 - SUP * jawJut * 0.25;

  // Tract length scales inversely with larynx height: raised larynx raises all formants; lowered darkens them
  const tractScale = 1.0 + larynxShiftCm * 0.095;
  const f1 = clamp((vowelSpec.f1 + jawOpen * 165) * tractScale, 240, 1050);
  const f2 = clamp((vowelSpec.f2 + AES * 140) * tractScale, 720, 2650);
  const f3 = clamp((vowelSpec.f3 + AES * 310) * tractScale, 2100, 3350);
  // Singer's formant cluster around 2.9–3.2 kHz narrows & intensifies under AES twang
  const f4 = clamp(lerp(3550, 3080, AES) * tractScale, 2850, 3950);

  // 8. Composite biomechanical strain detector
  // Strain arises when high larynx (SUP) + jaw jut + pressed true/false folds + un-anchored breath collide
  const highLarynxUnderLoad = Math.max(0, SUP - 0.45) * clamp(subglottalPressureKpa / 1.5, 0, 1.2);
  const pressedFolds = Math.max(0, TA + LCA - 1.55) * 0.9 + Math.max(0, FVF - 0.55) * 0.85;
  const breathStarvation =
    phonating && subglottalPressureKpa > 1.1 && APP < 0.35 ? 0.45 : 0;
  const strainIndex = clamp(
    highLarynxUnderLoad * 0.95 +
      pressedFolds * 0.65 +
      jawJut * 0.55 +
      clavicularHeave * 0.45 +
      breathStarvation -
      INF * 0.22,
    0,
    1,
  );

  return {
    tNorm,
    phaseLabel,
    channels,
    f0Hz,
    vowel,
    jawOpen,
    jawJut,
    clavicularHeave,
    larynxShiftCm,
    ctTiltRad,
    ctGlideCm,
    caRotateRad: -caRotateLeft,
    iaSlideCm,
    foldLengthMm,
    foldElongationPct,
    foldThicknessMm,
    activeLengthFraction,
    liveAnteriorCommissure,
    liveRightVocalProcess,
    liveLeftVocalProcess,
    membranousGapMm,
    posteriorChinkMm,
    closedQuotient,
    mucosalWaveAmpMm,
    verticalPhaseLagRad,
    dicroticFry,
    aesNarrowing,
    falseFoldGapMm,
    falseFoldOscillationMm,
    jawAngleRad,
    velumLiftCm,
    tongueArchCm,
    tongueFrontCm,
    diaphragmDescentCm,
    ribExpansion,
    abdominalTone,
    subglottalPressureKpa,
    airflowLps,
    strainIndex,
    formantsHz: [Math.round(f1), Math.round(f2), Math.round(f3), Math.round(f4)],
  };
}

/**
 * Evaluates the micro-timescale mucosal wave half-gap (in mm from glottal midline)
 * at normalized longitudinal coordinate s ∈ [0, 1] (0 = anterior commissure, 1 = vocal process)
 * and vertical lip coordinate v ∈ [0, 1] (0 = inferior subglottal margin, 1 = superior free edge)
 * for stroboscopic phase phiRad ∈ [0, 2π).
 */
export function evaluateMucosalHalfGapMm(
  frame: KinematicFrame,
  phiRad: number,
  sLongitudinal: number,
  vVertical: number,
): number {
  const s = clamp(sLongitudinal, 0, 1);
  const v = clamp(vVertical, 0, 1);

  // Baseline static half-gap tapers linearly from 0 at anterior commissure to posteriorChink/2 at s=1,
  // with mid-membranous bowing controlled by membranousGapMm.
  const chinkHalf = 0.5 * frame.posteriorChinkMm * Math.pow(s, 1.35);
  const midBow =
    (0.5 * frame.membranousGapMm - 0.25 * frame.posteriorChinkMm) *
    Math.sin(Math.PI * s);
  const baseHalfGap = Math.max(0, chinkHalf + midBow);

  if (frame.mucosalWaveAmpMm <= 1e-4) {
    return baseHalfGap;
  }

  // Active vibrating envelope: 0 at endpoints; damped posteriorly when activeLengthFraction < 1 (whistle)
  const sActive = frame.activeLengthFraction;
  let spatialEnv = 0;
  if (s < sActive) {
    spatialEnv = Math.sin((Math.PI * s) / Math.max(0.15, sActive));
  }

  // Vertical phase lag: inferior margin (v=0) leads superior margin (v=1) by verticalPhaseLagRad
  // creating convergent glottis during opening and divergent glottis during closing (Titze 1988).
  const phase = phiRad - v * frame.verticalPhaseLagRad;
  let wave = Math.sin(phase);
  if (frame.dicroticFry > 0.01) {
    // Double-pulsed dicrotic oscillation characteristic of vocal fry
    wave =
      (1 - 0.48 * frame.dicroticFry) * Math.sin(phase) +
      0.56 * frame.dicroticFry * Math.sin(2 * phase + 0.45);
  }

  // Shift wave downward according to closedQuotient so negative excursions clip cleanly at midline contact (0 mm)
  const contactBias = Math.sin(Math.PI * (frame.closedQuotient - 0.5));
  const rawHalfGap =
    baseHalfGap + frame.mucosalWaveAmpMm * spatialEnv * (wave - contactBias);
  return Math.max(0, rawHalfGap);
}

export function sampleGlottalCycle(
  frame: KinematicFrame,
  phiRad: number,
): GlottalCycleSample {
  // Sample mid-membranous coronal plane (s = 0.45 * activeLengthFraction)
  const sMid = 0.48 * frame.activeLengthFraction;
  const infHalf = evaluateMucosalHalfGapMm(frame, phiRad, sMid, 0.08);
  const supHalf = evaluateMucosalHalfGapMm(frame, phiRad, sMid, 0.92);

  // Integrate projected glottal area (minimum of inferior/superior channel width along s ∈ [0,1])
  const steps = 16;
  let areaSumMm2 = 0;
  let contactCount = 0;
  const dsMm = frame.foldLengthMm / steps;
  for (let i = 0; i < steps; i++) {
    const s = (i + 0.5) / steps;
    const gInf = evaluateMucosalHalfGapMm(frame, phiRad, s, 0.15);
    const gSup = evaluateMucosalHalfGapMm(frame, phiRad, s, 0.85);
    const minHalf = Math.min(gInf, gSup);
    areaSumMm2 += 2.0 * minHalf * dsMm;
    if (minHalf < 0.03) {
      contactCount++;
    }
  }

  // Ventricular (false) fold subharmonic oscillation at f0 / 2
  const fvfWave =
    frame.falseFoldOscillationMm * Math.sin(0.5 * phiRad + 0.7);
  const falseFoldHalfGapMm = Math.max(
    0.15,
    0.5 * frame.falseFoldGapMm + fvfWave,
  );

  // Bernoulli transglottal jet speed (m/s) when glottis is open under P_sub
  const openFactor = clamp(areaSumMm2 / 14.0, 0, 1);
  const jetVelocityMps =
    frame.airflowLps < 0
      ? -12.0 * Math.abs(frame.airflowLps)
      : openFactor > 0.01
        ? Math.sqrt((2.0 * frame.subglottalPressureKpa * 1000.0) / 1.18) *
          (0.35 + 0.65 * openFactor)
        : 0.0;

  return {
    phiRad,
    glottalAreaMm2: areaSumMm2,
    contactQuotientInstant: contactCount / steps,
    inferiorHalfGapMm: infHalf,
    superiorHalfGapMm: supHalf,
    falseFoldHalfGapMm,
    jetVelocityMps,
  };
}
