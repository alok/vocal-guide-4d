import { describe, expect, it } from 'vitest';
import rigJson from '../src/data/anatomyRig.json';
import guideJson from '../src/data/vocalGuideData.json';
import {
  createZeroChannels,
  interpolateKeyframes,
  sampleGlottalCycle,
  solveKinematics,
} from '../src/biomechanics/kinematics';
import {
  MYTH_SIM_LINKS,
  TECHNIQUE_TRAJECTORIES,
} from '../src/biomechanics/trajectories';
import type { RigLandmarks } from '../src/biomechanics/types';

const landmarks = rigJson.landmarks as unknown as RigLandmarks;

describe('BodyParts3D 4.3 Rig & Bilingual Vocal Guide Dataset', () => {
  it('verifies sub-0.1mm cross-archive BodyParts3D 4.3 registration and landmark symmetry', () => {
    expect(rigJson.crossArchiveHyoidAlignmentErrorMm.pharynx).toBeLessThan(0.05);
    expect(rigJson.crossArchiveHyoidAlignmentErrorMm.tongue).toBeLessThan(0.05);
    expect(rigJson.crossArchiveHyoidAlignmentErrorMm.lungs_trachea).toBeLessThan(0.15);
    expect(landmarks.restingFoldLengthMm).toBeGreaterThan(12.0);
    expect(landmarks.restingFoldLengthMm).toBeLessThan(16.0);

    // Left (+X) and right (-X) vocal processes should mirror cleanly across midline
    const symDiffCm = Math.abs(
      Math.abs(landmarks.leftVocalProcess[0]) -
        Math.abs(landmarks.rightVocalProcess[0]),
    );
    expect(symDiffCm).toBeLessThan(0.05);
    expect(rigJson.structures.length).toBeGreaterThanOrEqual(45);
  });

  it('contains all 21 techniques in both EN and DA with matching 3+1D trajectories', () => {
    expect(guideJson.techniques).toHaveLength(21);
    for (const tech of guideJson.techniques) {
      expect(tech.description.en.length).toBeGreaterThan(8);
      expect(tech.description.da.length).toBeGreaterThan(8);
      expect(tech.character.en.length).toBeGreaterThan(8);
      expect(tech.character.da.length).toBeGreaterThan(8);
      expect(tech.howTo.en.body.length + tech.howTo.en.headline.length).toBeGreaterThan(15);
      expect(tech.howTo.da.body.length + tech.howTo.da.headline.length).toBeGreaterThan(15);

      const traj = TECHNIQUE_TRAJECTORIES[tech.slug];
      expect(traj, `Missing trajectory for ${tech.slug}`).toBeDefined();
      expect(traj.healthy.length).toBeGreaterThanOrEqual(3);
      expect(traj.strain.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('validates monotonic timeline keyframes across all 30+ presets and myth links', () => {
    for (const [id, traj] of Object.entries(TECHNIQUE_TRAJECTORIES)) {
      for (const variant of [traj.healthy, traj.strain]) {
        for (let i = 1; i < variant.length; i++) {
          expect(
            variant[i].tNorm,
            `Non-monotonic keyframe in ${id}`,
          ).toBeGreaterThan(variant[i - 1].tNorm);
        }
      }
    }
    expect(MYTH_SIM_LINKS).toHaveLength(10);
    for (const link of MYTH_SIM_LINKS) {
      expect(TECHNIQUE_TRAJECTORIES[link.trajectoryId]).toBeDefined();
    }
  });
});

describe('3+1D Biomechanical Kinematics & Mucosal Wave Invariants', () => {
  it('stretches and thins vocal folds under CT vs thickens under TA', () => {
    const chestCh = { ...createZeroChannels(), TA: 0.78, CT: 0.15, LCA: 0.76, IA: 0.75, APP: 0.65 };
    const headCh = { ...createZeroChannels(), TA: 0.18, CT: 0.85, LCA: 0.76, IA: 0.75, APP: 0.68 };

    const chest = solveKinematics(0.5, { en: 'Chest', da: 'Bryst' }, chestCh, 180, 'AA', 0.4, 0, 0, landmarks);
    const head = solveKinematics(0.5, { en: 'Head', da: 'Hoved' }, headCh, 523.3, 'UH', 0.5, 0, 0, landmarks);

    expect(head.foldLengthMm).toBeGreaterThan(chest.foldLengthMm + 2.2);
    expect(head.foldElongationPct).toBeGreaterThan(16);
    expect(chest.foldThicknessMm).toBeGreaterThan(4.1);
    expect(head.foldThicknessMm).toBeLessThan(2.5);
  });

  it('distinguishes inspiratory V-abduction (PCA), falsetto posterior chink, and full head-voice closure', () => {
    const inhale = solveKinematics(
      0.1,
      { en: 'Inhale', da: 'Ind' },
      { ...createZeroChannels(), PCA: 0.85, DIA: 0.85 },
      0,
      'AA',
      0.3,
      0,
      0,
      landmarks,
    );
    expect(inhale.posteriorChinkMm).toBeGreaterThan(6.5);
    expect(inhale.airflowLps).toBeLessThan(-0.4);
    expect(inhale.diaphragmDescentCm).toBeGreaterThan(2.5);

    const falsettoSample = interpolateKeyframes(TECHNIQUE_TRAJECTORIES.falsetto.healthy, 0.55);
    const falsetto = solveKinematics(
      0.55,
      falsettoSample.phaseLabel,
      falsettoSample.channels,
      falsettoSample.f0Hz,
      falsettoSample.vowel,
      falsettoSample.jawOpen,
      falsettoSample.jawJut,
      falsettoSample.clavicularHeave,
      landmarks,
    );

    const headSample = interpolateKeyframes(TECHNIQUE_TRAJECTORIES['head-voice'].healthy, 0.55);
    const head = solveKinematics(
      0.55,
      headSample.phaseLabel,
      headSample.channels,
      headSample.f0Hz,
      headSample.vowel,
      headSample.jawOpen,
      headSample.jawJut,
      headSample.clavicularHeave,
      landmarks,
    );

    expect(falsetto.posteriorChinkMm).toBeGreaterThan(1.4);
    expect(head.posteriorChinkMm).toBeLessThan(0.5);
    expect(head.closedQuotient).toBeGreaterThan(falsetto.closedQuotient + 0.1);
  });

  it('exhibits anterior pocket damping in whistle register and dicrotic pulses in vocal fry', () => {
    const whistleK = interpolateKeyframes(TECHNIQUE_TRAJECTORIES['whistle-register'].healthy, 0.55);
    const whistle = solveKinematics(
      0.55,
      whistleK.phaseLabel,
      whistleK.channels,
      whistleK.f0Hz,
      whistleK.vowel,
      whistleK.jawOpen,
      0,
      0,
      landmarks,
    );
    expect(whistle.activeLengthFraction).toBeLessThan(0.45);

    const fryK = interpolateKeyframes(TECHNIQUE_TRAJECTORIES['vocal-fry'].healthy, 0.22);
    const fry = solveKinematics(
      0.22,
      fryK.phaseLabel,
      fryK.channels,
      fryK.f0Hz,
      fryK.vowel,
      fryK.jawOpen,
      0,
      0,
      landmarks,
    );
    expect(fry.dicroticFry).toBeGreaterThan(0.6);
  });

  it('produces convergent opening and divergent closing across the micro-glottal mucosal cycle', () => {
    const chestK = interpolateKeyframes(TECHNIQUE_TRAJECTORIES['chest-voice'].healthy, 0.5);
    const frame = solveKinematics(
      0.5,
      chestK.phaseLabel,
      chestK.channels,
      chestK.f0Hz,
      chestK.vowel,
      chestK.jawOpen,
      0,
      0,
      landmarks,
    );

    // At opening phase (phi ≈ 0.75 rad), inferior edge leads outward -> inferiorHalfGap > superiorHalfGap (convergent)
    const opening = sampleGlottalCycle(frame, 0.75);
    // At closing phase (phi ≈ 2.65 rad), inferior edge closes first -> superiorHalfGap > inferiorHalfGap (divergent)
    const closing = sampleGlottalCycle(frame, 2.65);

    expect(opening.inferiorHalfGapMm).toBeGreaterThan(opening.superiorHalfGapMm);
    expect(closing.superiorHalfGapMm).toBeGreaterThan(closing.inferiorHalfGapMm);
  });

  it('scores Strain trajectories significantly higher in strainIndex than Healthy trajectories', () => {
    for (const slug of ['belting', 'mixed-voice', 'grit-rasp', 'vibrato', 'breath-support']) {
      const traj = TECHNIQUE_TRAJECTORIES[slug];
      let peakHealthy = 0;
      let peakStrain = 0;
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const hk = interpolateKeyframes(traj.healthy, t);
        const sk = interpolateKeyframes(traj.strain, t);
        peakHealthy = Math.max(
          peakHealthy,
          solveKinematics(t, hk.phaseLabel, hk.channels, hk.f0Hz, hk.vowel, hk.jawOpen, hk.jawJut, hk.clavicularHeave, landmarks).strainIndex,
        );
        peakStrain = Math.max(
          peakStrain,
          solveKinematics(t, sk.phaseLabel, sk.channels, sk.f0Hz, sk.vowel, sk.jawOpen, sk.jawJut, sk.clavicularHeave, landmarks).strainIndex,
        );
      }
      expect(peakStrain, `Expected higher strainIndex on ${slug}`).toBeGreaterThan(
        peakHealthy + 0.35,
      );
    }
  });
});
