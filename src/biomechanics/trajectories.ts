import type {
  CameraPresetId,
  ChannelVector,
  Lang,
  LayerId,
  TechniqueTrajectory,
  TimelineKeyframe,
  VowelId,
} from './types';

function ch(partial: Partial<ChannelVector>): ChannelVector {
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
    ...partial,
  };
}

function kf(
  tNorm: number,
  en: string,
  da: string,
  channels: Partial<ChannelVector>,
  f0Hz: number,
  vowel: VowelId = 'AA',
  jawOpen = 0.35,
  extra?: { jawJut?: number; clavicularHeave?: number },
): TimelineKeyframe {
  return {
    tNorm,
    phase: { en, da },
    channels: ch(channels),
    f0Hz,
    vowel,
    jawOpen,
    jawJut: extra?.jawJut ?? 0,
    clavicularHeave: extra?.clavicularHeave ?? 0,
  };
}

const LAYERS_LARYNX: Record<LayerId, number> = {
  larynx: 1.0,
  extrinsic: 0.45,
  tract: 0.22,
  breath: 0.14,
};

const LAYERS_EXTRINSIC: Record<LayerId, number> = {
  larynx: 1.0,
  extrinsic: 0.92,
  tract: 0.45,
  breath: 0.2,
};

const LAYERS_TRACT: Record<LayerId, number> = {
  larynx: 0.95,
  extrinsic: 0.55,
  tract: 0.92,
  breath: 0.18,
};

const LAYERS_BREATH: Record<LayerId, number> = {
  larynx: 0.85,
  extrinsic: 0.45,
  tract: 0.35,
  breath: 0.96,
};

const INHALE_HEALTHY = (t = 0.08): TimelineKeyframe =>
  kf(
    t,
    'Appoggio Inhale (V-Glottis)',
    'Appoggio-indånding (V-glottis)',
    { PCA: 0.84, DIA: 0.82, APP: 0.42, INF: 0.22, VEL: 0.4 },
    0,
    'AA',
    0.32,
  );

const INHALE_CLAVICULAR = (t = 0.08): TimelineKeyframe =>
  kf(
    t,
    'Shallow Chest Heave',
    'Overfladisk bryst-hiv',
    { PCA: 0.52, DIA: 0.22, APP: 0.1, SUP: 0.55 },
    0,
    'AA',
    0.25,
    { clavicularHeave: 0.82, jawJut: 0.25 },
  );

const RELEASE_HEALTHY = (
  en = 'Clean Release & Rest',
  da = 'Ren afslutning & hvile',
): TimelineKeyframe =>
  kf(
    1.0,
    en,
    da,
    { PCA: 0.48, DIA: 0.2, APP: 0.15, INF: 0.15, VEL: 0.3 },
    0,
    'AA',
    0.24,
  );

const RELEASE_STRAIN: TimelineKeyframe = kf(
  1.0,
  'Pressed Cutoff / Recoil',
  'Klemt afslutning',
  { LCA: 0.65, TA: 0.5, SUP: 0.62, FVF: 0.45 },
  0,
  'AE',
  0.22,
  { jawJut: 0.45 },
);

function buildVibratoKeyframes(healthy: boolean): TimelineKeyframe[] {
  const frames: TimelineKeyframe[] = [
    INHALE_HEALTHY(0.0),
    healthy
      ? kf(
          0.16,
          'Straight-Tone Onset (D4)',
          'Lige tone-ansats (D4)',
          { CT: 0.48, TA: 0.46, LCA: 0.74, IA: 0.72, INF: 0.32, VEL: 0.78, DIA: 0.62, APP: 0.68 },
          293.7,
          'AA',
          0.42,
        )
      : kf(
          0.16,
          'Locked Throat Onset',
          'Låst hals-ansats',
          { CT: 0.44, TA: 0.72, LCA: 0.86, IA: 0.84, SUP: 0.74, FVF: 0.48, DIA: 0.25, APP: 0.3 },
          293.7,
          'AE',
          0.26,
          { jawJut: 0.55 },
        ),
  ];

  // 10 vibrato half-cycles across t = 0.28 .. 0.88 (~5.5 Hz over an 8.5s phrase)
  const oscCount = 12;
  for (let i = 0; i <= oscCount; i++) {
    const t = 0.28 + (i / oscCount) * 0.6;
    const sign = i % 2 === 0 ? 1 : -1;
    const dia = 0.58 - (i / oscCount) * 0.34;
    if (healthy) {
      frames.push(
        kf(
          Number(t.toFixed(3)),
          'Free Cricothyroid Spin (~5.8 Hz)',
          'Fri CT-vibrato (~5,8 Hz)',
          {
            CT: 0.5 + sign * 0.055,
            TA: 0.45 - sign * 0.025,
            LCA: 0.74,
            IA: 0.72,
            AES: 0.26,
            INF: 0.34,
            VEL: 0.8,
            DIA: dia,
            APP: 0.72,
          },
          293.7 * Math.pow(2, (sign * 0.42) / 12),
          'AA',
          0.44,
        ),
      );
    } else {
      // Artificial jaw/wobble vibrato
      frames.push(
        kf(
          Number(t.toFixed(3)),
          'Forced Jaw-Wag Wobble',
          'Tvungen kæbe-rysten',
          {
            CT: 0.44 + sign * 0.09,
            TA: 0.74,
            LCA: 0.88,
            IA: 0.85,
            SUP: 0.72 + sign * 0.14,
            FVF: 0.52,
            VEL: 0.5,
            DIA: 0.18,
            APP: 0.28,
          },
          293.7 * Math.pow(2, (sign * 1.15) / 12),
          'AE',
          0.38 + sign * 0.22,
          { jawJut: 0.58 },
        ),
      );
    }
  }
  frames.push(healthy ? RELEASE_HEALTHY() : RELEASE_STRAIN);
  return frames;
}

function buildRunsKeyframes(healthy: boolean): TimelineKeyframe[] {
  // 9-note pentatonic melisma: C4 - D4 - E4 - G4 - A4 - G4 - E4 - D4 - C4
  const notes = [261.6, 293.7, 329.6, 392.0, 440.0, 392.0, 329.6, 293.7, 261.6];
  const cts = [0.34, 0.41, 0.48, 0.59, 0.66, 0.59, 0.48, 0.41, 0.34];
  const tas = [0.52, 0.49, 0.46, 0.41, 0.38, 0.41, 0.46, 0.49, 0.52];
  const frames: TimelineKeyframe[] = [INHALE_HEALTHY(0.0)];

  for (let i = 0; i < notes.length; i++) {
    const t = 0.16 + (i / (notes.length - 1)) * 0.72;
    const dia = 0.68 - (i / notes.length) * 0.4;
    if (healthy) {
      frames.push(
        kf(
          Number(t.toFixed(3)),
          `Agile Pentatonic Step ${i + 1}/9`,
          `Præcist pentatonisk trin ${i + 1}/9`,
          {
            CT: cts[i],
            TA: tas[i],
            LCA: 0.73,
            IA: 0.71,
            AES: 0.28,
            INF: 0.3,
            VEL: 0.8,
            DIA: dia,
            APP: 0.72,
          },
          notes[i],
          notes[i] > 370 ? 'UH' : 'AA',
          0.38,
        ),
      );
    } else {
      frames.push(
        kf(
          Number(t.toFixed(3)),
          `Slurred Jaw-Bounce Step ${i + 1}/9`,
          `Udtværet kæbe-hop trin ${i + 1}/9`,
          {
            CT: cts[i] * 0.75,
            TA: 0.72,
            LCA: i % 2 === 0 ? 0.88 : 0.45,
            IA: 0.48,
            SUP: 0.74,
            FVF: 0.42,
            DIA: 0.22,
            APP: i % 2 === 0 ? 0.58 : 0.18,
          },
          notes[i] * (i === 4 ? 0.96 : 1.0),
          'AE',
          i % 2 === 0 ? 0.55 : 0.22,
          { jawJut: 0.52 },
        ),
      );
    }
  }
  frames.push(healthy ? RELEASE_HEALTHY() : RELEASE_STRAIN);
  return frames;
}

export const TECHNIQUE_TRAJECTORIES: Record<string, TechniqueTrajectory> = {
  'chest-voice': {
    id: 'chest-voice',
    kind: 'technique',
    title: { en: 'Chest Voice', da: 'Chest Voice (Bryststemme)' },
    defaultCamera: 'larynx-3d',
    defaultLayers: LAYERS_LARYNX,
    durationSec: 7.0,
    summary: {
      en: 'Thyroarytenoid & vocalis (TA) thicken the vocal fold body (~4.8 mm) while LCA + IA seal the glottis cleanly, creating a wide inferior-to-superior mucosal wave and warm closed quotient (~58%).',
      da: 'Thyroarytenoideus & vocalis (TA) gør stemmelæberne tykke og fyldige (~4,8 mm), mens LCA + IA lukker glottis tæt med en dyb slimhindebølge.',
    },
    strainSummary: {
      en: 'Over-pressing chest voice clamps the false folds (FVF) and hikes the larynx (SUP) instead of letting TA resonate freely on steady breath.',
      da: 'Overpresset bryststemme klemmer de falske stemmelæber (FVF) sammen og trækker struben op (SUP).',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.18, 'Pre-Phonatory Closure', 'Præ-fonatorisk lukke', { TA: 0.62, CT: 0.16, LCA: 0.74, IA: 0.74, INF: 0.3, VEL: 0.75, DIA: 0.68, APP: 0.58 }, 164.8, 'AA', 0.36),
      kf(0.45, 'Grounded Chest Sustain (E3→G3)', 'Fyldig brysttone (E3→G3)', { TA: 0.74, CT: 0.22, LCA: 0.78, IA: 0.76, INF: 0.32, VEL: 0.8, DIA: 0.48, APP: 0.65 }, 196.0, 'AA', 0.4),
      kf(0.78, 'Resonant Spoken-Depth Hold', 'Varm, afspændt udholden tone', { TA: 0.72, CT: 0.2, LCA: 0.76, IA: 0.75, AES: 0.18, INF: 0.3, VEL: 0.8, DIA: 0.26, APP: 0.68 }, 185.0, 'OH', 0.38),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.2, 'Hard Glottal Slam', 'Hårdt glottalt smæld', { TA: 0.94, CT: 0.1, LCA: 0.95, IA: 0.92, FVF: 0.68, SUP: 0.72, APP: 0.25 }, 164.8, 'AE', 0.22, { jawJut: 0.5 }),
      kf(0.55, 'Pressed Throat Squeeze', 'Presset halsspænding', { TA: 0.95, CT: 0.12, LCA: 0.94, IA: 0.9, FVF: 0.74, SUP: 0.8, APP: 0.22 }, 196.0, 'AE', 0.24, { jawJut: 0.58, clavicularHeave: 0.5 }),
      RELEASE_STRAIN,
    ],
  },

  'head-voice': {
    id: 'head-voice',
    kind: 'technique',
    title: { en: 'Head Voice', da: 'Head Voice (Hovedstemme)' },
    defaultCamera: 'larynx-3d',
    defaultLayers: LAYERS_LARYNX,
    durationSec: 7.5,
    summary: {
      en: 'Cricothyroid (CT) tilts the thyroid cartilage forward/down, stretching the vocal ligaments +22% while LCA + IA maintain full non-breathy closure and lifted soft palate (VEL).',
      da: 'Cricothyroideus (CT) vipper skjoldbrusken fremad/nedad og strækker stemmelæberne +22%, mens LCA + IA bevarer fuldt, ikke-luftigt lukke.',
    },
    strainSummary: {
      en: 'Reaching UP with the chin and neck (SUP) instead of tilting CT chokes the upper range or collapses into weak air leakage.',
      da: 'At række op med hagen og struben (SUP) i stedet for CT-vip klemmer halsen sammen.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.18, 'Light Onset & Velar Lift', 'Let ansats & løftet gane', { CT: 0.58, TA: 0.24, LCA: 0.72, IA: 0.7, AES: 0.25, INF: 0.34, VEL: 0.9, DIA: 0.68, APP: 0.62 }, 392.0, 'UH', 0.42),
      kf(0.5, 'CT Visor Stretch (G4→C5)', 'CT-visorstræk (G4→C5)', { CT: 0.82, TA: 0.2, LCA: 0.75, IA: 0.73, AES: 0.34, INF: 0.38, VEL: 0.94, DIA: 0.45, APP: 0.7 }, 523.3, 'UH', 0.52),
      kf(0.82, 'Ringing Head Sustain (C5)', 'Klingende hovedstemme (C5)', { CT: 0.8, TA: 0.22, LCA: 0.75, IA: 0.73, AES: 0.36, INF: 0.36, VEL: 0.94, DIA: 0.24, APP: 0.72 }, 523.3, 'OH', 0.5),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.22, 'Chin-Up Neck Reach', 'Hage-løft & nakkespænding', { CT: 0.52, TA: 0.45, LCA: 0.85, IA: 0.8, SUP: 0.84, FVF: 0.56, VEL: 0.45, APP: 0.28 }, 392.0, 'IY', 0.24, { jawJut: 0.65 }),
      kf(0.65, 'Pinched High Larynx', 'Klemt høj strube', { CT: 0.65, TA: 0.5, LCA: 0.88, IA: 0.82, SUP: 0.9, FVF: 0.68, VEL: 0.4, APP: 0.24 }, 523.3, 'IY', 0.22, { jawJut: 0.72, clavicularHeave: 0.6 }),
      RELEASE_STRAIN,
    ],
  },

  falsetto: {
    id: 'falsetto',
    kind: 'technique',
    title: { en: 'Falsetto', da: 'Falsetto (Falset)' },
    defaultCamera: 'laryngoscope',
    defaultLayers: LAYERS_LARYNX,
    durationSec: 7.0,
    summary: {
      en: 'Watch from above: CT stretches the folds thin while TA and Interarytenoid (IA) stay relaxed, leaving a signature posterior triangular chink that lets flute-like air shimmer through.',
      da: 'Se oppefra: CT strækker stemmelæberne tynde mens TA og IA slapper af, hvilket efterlader en trekantet sprække bagtil med luftig, fløjtelignende klang.',
    },
    strainSummary: {
      en: 'Dumping uncontrolled air without rib hold (APP) dries the mucosa and runs out of breath in 2 seconds.',
      da: 'Ukontrolleret luftspild uden ribben-støtte udtørrer slimhinden og tømmer lungerne med det samme.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.2, 'Partial Adduction (Posterior Chink)', 'Delvist lukke (bageste sprække)', { CT: 0.66, TA: 0.08, LCA: 0.54, IA: 0.14, INF: 0.22, VEL: 0.78, DIA: 0.66, APP: 0.54 }, 392.0, 'UW', 0.36),
      kf(0.55, 'Ethereal Flute Glide (G4→B4)', 'Luftigt fløjte-glid (G4→B4)', { CT: 0.78, TA: 0.06, LCA: 0.56, IA: 0.12, INF: 0.24, VEL: 0.82, DIA: 0.42, APP: 0.58 }, 493.9, 'UW', 0.4),
      kf(0.84, 'Soft Floating Sustain', 'Blød svævende tone', { CT: 0.74, TA: 0.07, LCA: 0.54, IA: 0.14, INF: 0.22, VEL: 0.8, DIA: 0.22, APP: 0.58 }, 440.0, 'OH', 0.38),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.25, 'Unsupported Air Dump', 'Ustøttet luft-spild', { CT: 0.6, TA: 0.05, LCA: 0.32, IA: 0.04, PCA: 0.18, SUP: 0.58, DIA: 0.12, APP: 0.1 }, 392.0, 'AA', 0.28, { clavicularHeave: 0.7 }),
      kf(0.65, 'Squeezed Whispery Exhaustion', 'Presset hviskende lufttab', { CT: 0.68, TA: 0.1, LCA: 0.38, IA: 0.05, SUP: 0.74, FVF: 0.48, DIA: 0.04, APP: 0.08 }, 466.2, 'AE', 0.24, { jawJut: 0.45 }),
      RELEASE_STRAIN,
    ],
  },

  'mixed-voice': {
    id: 'mixed-voice',
    kind: 'technique',
    title: { en: 'Mixed Voice', da: 'Mixed Voice (Mix-stemme)' },
    defaultCamera: 'larynx-3d',
    defaultLayers: LAYERS_EXTRINSIC,
    durationSec: 8.5,
    summary: {
      en: 'The passaggio handoff in 3+1D: as pitch climbs G3→E4→C5, CT smoothly takes over longitudinal tension while TA tapers gradually—kept connected by LCA/IA closure, AES ring, and UH vowel tuning.',
      da: 'Passaggio-overgangen i 3+1D: når tonen stiger G3→E4→C5, overtager CT gradvist strækket mens TA blødt slanker sig—holdt samlet af LCA/IA-lukke, let twang og vokal-tilpasning.',
    },
    strainSummary: {
      en: 'Dragging heavy TA chest weight past E4/F4 without CT handoff hikes the larynx until the voice suddenly cracks into disconnected falsetto.',
      da: 'At trække tung TA-bryststemme op over overgangen uden CT-skift trækker struben op, indtil stemmen knækker brat over i falset.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.16, 'Chest-Anchored Start (G3)', 'Bryst-forankret start (G3)', { CT: 0.24, TA: 0.68, LCA: 0.76, IA: 0.75, AES: 0.22, INF: 0.32, VEL: 0.78, DIA: 0.7, APP: 0.62 }, 196.0, 'AA', 0.36),
      kf(0.42, 'Primo Passaggio Bridge (E4)', 'Passaggio-bro (E4)', { CT: 0.54, TA: 0.5, LCA: 0.77, IA: 0.75, AES: 0.36, INF: 0.38, VEL: 0.86, DIA: 0.52, APP: 0.72 }, 329.6, 'OH', 0.44),
      kf(0.68, 'Connected High Mix (A4→C5)', 'Forbundet høj mix (A4→C5)', { CT: 0.8, TA: 0.36, LCA: 0.78, IA: 0.76, AES: 0.46, INF: 0.42, VEL: 0.92, DIA: 0.34, APP: 0.8 }, 523.3, 'UH', 0.54),
      kf(0.86, 'Seamless Descent', 'Sømløs nedgang', { CT: 0.48, TA: 0.52, LCA: 0.76, IA: 0.75, AES: 0.3, INF: 0.34, VEL: 0.84, DIA: 0.2, APP: 0.7 }, 293.7, 'OH', 0.42),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.18, 'Heavy Chest Start (G3)', 'Tung bryst-start (G3)', { CT: 0.16, TA: 0.84, LCA: 0.86, IA: 0.84, SUP: 0.45, APP: 0.35 }, 196.0, 'AE', 0.3),
      kf(0.46, 'Pushed Passaggio Ceiling (F4)', 'Presset overgangs-loft (F4)', { CT: 0.26, TA: 0.92, LCA: 0.92, IA: 0.88, SUP: 0.88, FVF: 0.7, APP: 0.3 }, 349.2, 'AE', 0.28, { jawJut: 0.68 }),
      kf(0.56, 'Sudden Register Crack! (A4)', 'Brat stemmeknæk! (A4)', { CT: 0.74, TA: 0.06, LCA: 0.4, IA: 0.08, SUP: 0.76, FVF: 0.35, APP: 0.15 }, 440.0, 'UH', 0.36, { jawJut: 0.5 }),
      RELEASE_STRAIN,
    ],
  },

  'vocal-fry': {
    id: 'vocal-fry',
    kind: 'technique',
    title: { en: 'Vocal Fry', da: 'Vocal Fry (Knirkestemme)' },
    defaultCamera: 'laryngoscope',
    defaultLayers: LAYERS_LARYNX,
    durationSec: 7.0,
    summary: {
      en: 'Slack longitudinal tension (CT ≈ 0), short thick vocalis body, firm medial approximation, and minimal airflow produce slow dicrotic (double-pulsed) bubbling at ~55–70 Hz.',
      da: 'Slap længdespænding (CT ≈ 0), korte tykke stemmelæber og minimal luftstrøm giver langsomme dikrotiske dobbelt-bobler ved ~55–70 Hz.',
    },
    strainSummary: {
      en: 'Grinding down with extrinsic neck muscles and false-fold squeeze turns relaxed fry into harsh throat scraping.',
      da: 'At presse nedad med halsmuskler og falske stemmelæber gør afslappet fry til hård skurren.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.2, 'Slack-Fold Bubbling Onset (~62 Hz)', 'Afslappet boble-ansats (~62 Hz)', { CT: 0.04, TA: 0.48, LCA: 0.7, IA: 0.68, INF: 0.2, VEL: 0.65, DIA: 0.58, APP: 0.28 }, 62.0, 'AA', 0.3),
      kf(0.55, 'Fry Slide into Modal Chest (C3)', 'Glid fra fry ind i bryststemme (C3)', { CT: 0.18, TA: 0.64, LCA: 0.76, IA: 0.74, INF: 0.28, VEL: 0.76, DIA: 0.42, APP: 0.55 }, 130.8, 'AA', 0.38),
      kf(0.84, 'Return to Loose Fry', 'Tilbage til blød fry', { CT: 0.05, TA: 0.45, LCA: 0.68, IA: 0.66, INF: 0.2, VEL: 0.65, DIA: 0.25, APP: 0.26 }, 58.0, 'AA', 0.3),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.25, 'Pressed Subglottal Grind', 'Presset hals-skurren', { CT: 0.05, TA: 0.9, LCA: 0.95, IA: 0.92, FVF: 0.78, SUP: 0.7, APP: 0.6 }, 55.0, 'AE', 0.2, { jawJut: 0.5 }),
      kf(0.7, 'Over-Compressed Scrape', 'Overkomprimeret knirken', { CT: 0.08, TA: 0.92, LCA: 0.96, IA: 0.94, FVF: 0.82, SUP: 0.76, APP: 0.65 }, 60.0, 'AE', 0.2, { jawJut: 0.56 }),
      RELEASE_STRAIN,
    ],
  },

  'whistle-register': {
    id: 'whistle-register',
    kind: 'technique',
    title: { en: 'Whistle Register', da: 'Whistle Register (Fløjteregister)' },
    defaultCamera: 'laryngoscope',
    defaultLayers: LAYERS_LARYNX,
    durationSec: 7.0,
    summary: {
      en: 'Maximum CT elongation with posterior/middle damping leaves only a tiny anterior free-edge pocket (~36% length) oscillating above C6 (1175 Hz) on metered, effortless breath.',
      da: 'Maksimal CT-forlængelse med dæmpning af bagerste del efterlader kun en lille forreste lomme (~36% længde), der svinger over C6 på minimal luft.',
    },
    strainSummary: {
      en: 'Forcing high subglottal air blast through a constricted throat risks acute vocal fold trauma—never push into whistle.',
      da: 'At tvinge højt lufttryk gennem en sammenklemt strube kan skade stemmelæberne akut—pres aldrig fløjteregister frem.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.22, 'Sigh-Like Anterior Pocket Entry (C6)', 'Suk-lignende indgang i forreste lomme (C6)', { CT: 0.94, TA: 0.1, LCA: 0.82, IA: 0.82, AES: 0.44, INF: 0.3, VEL: 0.96, DIA: 0.64, APP: 0.72 }, 1046.5, 'IY', 0.5),
      kf(0.6, 'Pure Whistle Harmonics (D6)', 'Ren fløjteregister-klang (D6)', { CT: 0.98, TA: 0.08, LCA: 0.84, IA: 0.84, AES: 0.48, INF: 0.32, VEL: 0.98, DIA: 0.42, APP: 0.76 }, 1174.7, 'IY', 0.52),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.3, 'Forced Shriek & Throat Clamp', 'Tvunget skrig & strubeklem', { CT: 0.88, TA: 0.52, LCA: 0.96, IA: 0.94, FVF: 0.82, SUP: 0.94, APP: 0.88 }, 1046.5, 'AE', 0.3, { jawJut: 0.78, clavicularHeave: 0.7 }),
      RELEASE_STRAIN,
    ],
  },

  belting: {
    id: 'belting',
    kind: 'technique',
    title: { en: 'Belting', da: 'Belting' },
    defaultCamera: 'sagittal-tract',
    defaultLayers: LAYERS_EXTRINSIC,
    durationSec: 8.0,
    summary: {
      en: 'Healthy belt = robust TA + active CT stretch + strong AES twang ring + high Appoggio (APP), with released jaw and anchored larynx—projecting like a joyful call rather than a throat shout.',
      da: 'Sund belting = solid TA + aktivt CT-stræk + tydeligt AES-twang + stærk Appoggio-støtte med afslappet kæbe og stabil strube.',
    },
    strainSummary: {
      en: 'Bad belting ("pushing pure chest up"): SUP yanks the larynx high, jaw juts forward, false folds (FVF) slam inward, and ribs collapse.',
      da: 'Dårlig belting ("ren bryst presset op"): SUP trækker struben højt op, kæben skydes frem, og de falske stemmelæber klemmer sammen.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.18, 'Anchored Call Setup ("Hey!")', 'Forankret kalde-ansats ("Hej!")', { CT: 0.52, TA: 0.64, LCA: 0.8, IA: 0.78, AES: 0.58, INF: 0.38, SUP: 0.18, VEL: 0.9, DIA: 0.68, APP: 0.78 }, 349.2, 'EH', 0.54),
      kf(0.5, 'Ascending 5th Money Note (C5)', 'Stigende kvint "Money Note" (C5)', { CT: 0.74, TA: 0.58, LCA: 0.82, IA: 0.8, AES: 0.68, INF: 0.4, SUP: 0.22, VEL: 0.94, DIA: 0.44, APP: 0.88 }, 523.3, 'EH', 0.64),
      kf(0.82, 'Buoyant Ringing Hold', 'Bærende, frit klingende hold', { CT: 0.74, TA: 0.56, LCA: 0.82, IA: 0.8, AES: 0.66, INF: 0.4, SUP: 0.2, VEL: 0.94, DIA: 0.22, APP: 0.9 }, 523.3, 'OH', 0.62),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.2, 'Yelled Chest Push', 'Råbt bryst-pres', { CT: 0.28, TA: 0.94, LCA: 0.94, IA: 0.92, AES: 0.3, FVF: 0.72, SUP: 0.86, APP: 0.32 }, 349.2, 'AE', 0.42, { jawJut: 0.7 }),
      kf(0.58, 'Choked High-Larynx Strain (C5)', 'Kvalt høj-strube belastning (C5)', { CT: 0.38, TA: 0.96, LCA: 0.96, IA: 0.94, FVF: 0.86, SUP: 0.95, APP: 0.24 }, 523.3, 'AE', 0.38, { jawJut: 0.82, clavicularHeave: 0.65 }),
      RELEASE_STRAIN,
    ],
  },

  twang: {
    id: 'twang',
    kind: 'technique',
    title: { en: 'Twang', da: 'Twang' },
    defaultCamera: 'laryngoscope',
    defaultLayers: LAYERS_TRACT,
    durationSec: 7.0,
    summary: {
      en: 'Aryepiglottic Sphincter (AES) narrows the epilaryngeal collar between the epiglottis petiole and arytenoids—multiplying 3 kHz acoustic output by +10–15 dB while REDUCING vocal fold impact stress!',
      da: 'Den aryepiglottiske sfinkter (AES) indsnævrer tragten mellem strubelåget og tudbruskene—øger 3 kHz-projektionen markant med MINDRE belastning på stemmelæberne.',
    },
    strainSummary: {
      en: 'Dropping the soft palate (VEL = 0) turns oral twang into honky nasality, or squeezing FVF confuses throat constriction with twang.',
      da: 'At tabe den bløde gane gør klangen nasal i stedet for mund-twang, mens FVF-klem forveksler hals-pres med twang.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.2, 'Neutral Funnel Baseline', 'Neutral tragt-udgangspunkt', { CT: 0.56, TA: 0.44, LCA: 0.74, IA: 0.72, AES: 0.15, INF: 0.24, VEL: 0.92, DIA: 0.65, APP: 0.62 }, 392.0, 'EH', 0.42),
      kf(0.52, 'AES Funnel Narrowing ("Nyaa!")', 'AES tragt-indsnævring ("Nææ!")', { CT: 0.62, TA: 0.44, LCA: 0.76, IA: 0.74, AES: 0.86, INF: 0.22, SUP: 0.24, VEL: 0.95, DIA: 0.44, APP: 0.68 }, 440.0, 'AE', 0.46),
      kf(0.82, 'Tasteful Oral Ring', 'Smagfuld mund-twang med klang', { CT: 0.62, TA: 0.44, LCA: 0.76, IA: 0.74, AES: 0.62, INF: 0.26, VEL: 0.95, DIA: 0.24, APP: 0.7 }, 440.0, 'EH', 0.46),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.3, 'Collapsed Velum Nasal Honk + FVF Squeeze', 'Nasal snøvlen + falske stemmelæbe-klem', { CT: 0.55, TA: 0.68, LCA: 0.88, IA: 0.85, AES: 0.75, FVF: 0.72, SUP: 0.82, VEL: 0.08, APP: 0.28 }, 440.0, 'AE', 0.26, { jawJut: 0.6 }),
      RELEASE_STRAIN,
    ],
  },

  'breathy-singing': {
    id: 'breathy-singing',
    kind: 'technique',
    title: { en: 'Breathy Singing', da: 'Breathy Singing (Luftig sang)' },
    defaultCamera: 'laryngoscope',
    defaultLayers: LAYERS_LARYNX,
    durationSec: 7.0,
    summary: {
      en: 'Deliberately softened LCA/IA adduction leaves a controlled glottal chink so unmodulated air turbulence mixes intimately with gentle mucosal vibration—metered by steady APP rib hold.',
      da: 'Bevidst blødgjort LCA/IA-lukke lader kontrolleret luftturbulens blande sig intimt med blød stemmelæbesvingning—styret af rolig ribben-støtte.',
    },
    strainSummary: {
      en: 'Pushing loud volume while keeping the folds leaky blasts dry air across the mucosa, causing rapid vocal inflammation and hoarseness.',
      da: 'At presse høj volumen ud gennem utætte stemmelæber blæser tør luft hen over slimhinden og giver hurtig hæshed.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.2, 'Soft H-Led Intimate Onset', 'Blød H-ledet intim ansats', { CT: 0.38, TA: 0.32, LCA: 0.52, IA: 0.22, INF: 0.28, VEL: 0.76, DIA: 0.66, APP: 0.58 }, 246.9, 'AA', 0.36),
      kf(0.58, 'Metered Airy Sustain (B3→D4)', 'Doseret luftig frase (B3→D4)', { CT: 0.46, TA: 0.3, LCA: 0.54, IA: 0.24, INF: 0.28, VEL: 0.78, DIA: 0.38, APP: 0.64 }, 293.7, 'OH', 0.38),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.3, 'Forced Loud Breath Blast', 'Presset høj luft-blæsning', { CT: 0.42, TA: 0.45, LCA: 0.42, IA: 0.1, SUP: 0.78, FVF: 0.54, APP: 0.85 }, 293.7, 'AE', 0.3, { jawJut: 0.52, clavicularHeave: 0.65 }),
      RELEASE_STRAIN,
    ],
  },

  'vowel-modification': {
    id: 'vowel-modification',
    kind: 'technique',
    title: { en: 'Vowel Modification', da: 'Vowel Modification (Vokalmodifikation)' },
    defaultCamera: 'sagittal-tract',
    defaultLayers: LAYERS_TRACT,
    durationSec: 8.0,
    summary: {
      en: 'Watch the sagittal vocal tract: as pitch ascends C4→A4, the jaw drops downward/back (never jutting), soft palate lifts high, and spread "EE/AA" subtly rounds toward "IH/UH" to align F1 with harmonics.',
      da: 'Se længdesnittet: når tonen stiger C4→A4, slipper kæben blødt nedad/bagud, ganen løftes, og brede vokaler rundes subtilt mod "IH/UH" så resonansen låser.',
    },
    strainSummary: {
      en: 'Keeping a wide horizontal smile ("splatted EE/AE") on high notes locks the hyoglossus/digastric and chokes the pharynx.',
      da: 'At fastholde en bred vandret vokal på høje toner låser tungen og klemmer svælget sammen.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.18, 'Low Range Pure "AA" (C4)', 'Lavt leje ren "AA" (C4)', { CT: 0.34, TA: 0.56, LCA: 0.75, IA: 0.74, AES: 0.24, INF: 0.3, VEL: 0.8, DIA: 0.68, APP: 0.6 }, 261.6, 'AA', 0.38),
      kf(0.48, 'Passaggio Rounding "AA → OH" (F4)', 'Overgangs-runding "AA → OH" (F4)', { CT: 0.58, TA: 0.46, LCA: 0.76, IA: 0.75, AES: 0.34, INF: 0.36, VEL: 0.88, DIA: 0.48, APP: 0.7 }, 349.2, 'OH', 0.48),
      kf(0.78, 'Upper Range Tuned "UH" + Dropped Jaw (A4)', 'Højt leje tunet "UH" + fri kæbe (A4)', { CT: 0.76, TA: 0.38, LCA: 0.78, IA: 0.76, AES: 0.42, INF: 0.4, VEL: 0.94, DIA: 0.26, APP: 0.78 }, 440.0, 'UH', 0.6),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.22, 'Spread Horizontal Vowel (C4)', 'Flad vandret vokal (C4)', { CT: 0.32, TA: 0.64, LCA: 0.82, IA: 0.8, SUP: 0.52, VEL: 0.55, APP: 0.35 }, 261.6, 'AE', 0.28),
      kf(0.62, 'Splatted High "AE" Throat Lock (A4)', 'Splattet høj "AE" hals-lås (A4)', { CT: 0.56, TA: 0.78, LCA: 0.9, IA: 0.88, FVF: 0.66, SUP: 0.9, VEL: 0.48, APP: 0.28 }, 440.0, 'AE', 0.26, { jawJut: 0.74 }),
      RELEASE_STRAIN,
    ],
  },

  'grit-rasp': {
    id: 'grit-rasp',
    kind: 'technique',
    title: { en: 'Grit / Rasp', da: 'Grit / Rasp (Rå klang)' },
    defaultCamera: 'laryngoscope',
    defaultLayers: LAYERS_LARYNX,
    durationSec: 7.5,
    summary: {
      en: 'Healthy rock/soul grit brings the ventricular (false) folds (FVF) and aryepiglottic rim (AES) close enough to add aperiodic/subharmonic texture ABOVE clean, un-slammed true vocal folds.',
      da: 'Sund grit bringer de falske stemmelæber (FVF) og AES-tragten tæt nok på til at skabe rå overtoner OVER frie, ubelastede ægte stemmelæber.',
    },
    strainSummary: {
      en: 'Grinding the true vocal folds themselves under excessive TA/LCA squeeze scrapes the delicate mucosal cover and causes swelling.',
      da: 'At skurre direkte på de ægte stemmelæber med overdrevent TA/LCA-pres slider på slimhinden og giver hævelse.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.18, 'Clean Twang-Supported Core', 'Ren twang-støttet kerne', { CT: 0.52, TA: 0.52, LCA: 0.76, IA: 0.74, AES: 0.56, FVF: 0.15, INF: 0.32, VEL: 0.88, DIA: 0.68, APP: 0.74 }, 329.6, 'EH', 0.46),
      kf(0.5, 'Supraglottic False-Fold Grit Overlay', 'Supraglottisk falsk-stemmelæbe grit', { CT: 0.56, TA: 0.52, LCA: 0.76, IA: 0.74, AES: 0.66, FVF: 0.52, INF: 0.34, VEL: 0.9, DIA: 0.45, APP: 0.82 }, 369.99, 'EH', 0.5),
      kf(0.8, 'Clean Instant Return (Health Check)', 'Øjeblikkelig ren tone (sundhedstjek)', { CT: 0.56, TA: 0.5, LCA: 0.76, IA: 0.74, AES: 0.5, FVF: 0.1, INF: 0.34, VEL: 0.9, DIA: 0.24, APP: 0.76 }, 369.99, 'EH', 0.48),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.28, 'True-Fold Scrape & High Larynx', 'Ægte stemmelæbe-skurren & høj strube', { CT: 0.42, TA: 0.95, LCA: 0.96, IA: 0.94, FVF: 0.86, SUP: 0.9, APP: 0.35 }, 369.99, 'AE', 0.3, { jawJut: 0.72 }),
      RELEASE_STRAIN,
    ],
  },

  'distortion-overdrive': {
    id: 'distortion-overdrive',
    kind: 'technique',
    title: { en: 'Distortion / Overdrive', da: 'Distortion / Overdrive' },
    defaultCamera: 'laryngoscope',
    defaultLayers: LAYERS_EXTRINSIC,
    durationSec: 7.5,
    summary: {
      en: 'High-energy rock distortion combines intense abdominal Appoggio (APP), narrowed AES twang collar, and controlled ventricular-fold (FVF) modulation while true folds vibrate cleanly underneath.',
      da: 'Intens rock-distortion kombinerer kraftig Appoggio-støtte, snæver AES-tragt og kontrolleret medsving fra de falske stemmelæber over rene ægte stemmelæber.',
    },
    strainSummary: {
      en: 'Screaming from the throat without abdominal metering slams both true and false folds under extreme SUP tension.',
      da: 'At skrige fra halsen uden mavestøtte banker både ægte og falske stemmelæber sammen under ekstrem SUP-spænding.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.18, 'Overdrive Core ("OH/EH" Setup)', 'Overdrive-kerne ("OH/EH" opsætning)', { CT: 0.58, TA: 0.62, LCA: 0.8, IA: 0.78, AES: 0.68, FVF: 0.22, INF: 0.36, VEL: 0.92, DIA: 0.68, APP: 0.84 }, 392.0, 'OH', 0.56),
      kf(0.55, 'Supraglottic Distortion Roar (A4)', 'Supraglottisk distortion-brøl (A4)', { CT: 0.66, TA: 0.6, LCA: 0.8, IA: 0.78, AES: 0.78, FVF: 0.62, INF: 0.38, VEL: 0.94, DIA: 0.4, APP: 0.92 }, 440.0, 'EH', 0.6),
      kf(0.82, 'Controlled Clean Taper', 'Kontrolleret ren afrunding', { CT: 0.64, TA: 0.56, LCA: 0.78, IA: 0.76, AES: 0.62, FVF: 0.14, INF: 0.36, VEL: 0.92, DIA: 0.22, APP: 0.82 }, 440.0, 'OH', 0.56),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.32, 'Unanchored Throat Scream', 'Uforankret hals-skrig', { CT: 0.45, TA: 0.98, LCA: 0.98, IA: 0.96, AES: 0.5, FVF: 0.92, SUP: 0.96, APP: 0.3 }, 440.0, 'AE', 0.36, { jawJut: 0.85, clavicularHeave: 0.75 }),
      RELEASE_STRAIN,
    ],
  },

  growl: {
    id: 'growl',
    kind: 'technique',
    title: { en: 'Growl', da: 'Growl' },
    defaultCamera: 'larynx-3d',
    defaultLayers: LAYERS_EXTRINSIC,
    durationSec: 7.0,
    summary: {
      en: 'Deep blues/gospel growl lowers the larynx via infrahyoids (INF), opens the pharynx, and recruits slow low-frequency ventricular/aryepiglottic rumble (FVF + AES) on warm airflow.',
      da: 'Dyb blues/gospel-growl sænker struben let via INF, åbner svælget og sætter de falske stemmelæber og aryepiglottiske folder i dyb medsvingning.',
    },
    strainSummary: {
      en: 'Forcing a low growl by jamming the tongue root backward onto a tense larynx causes immediate soreness.',
      da: 'At tvinge growl frem ved at presse tungeroden ned og tilbage skaber øjeblikkelig ømhed.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.2, 'Lowered-Larynx Gospel Growl Onset', 'Lav-strube gospel-growl start', { CT: 0.28, TA: 0.56, LCA: 0.74, IA: 0.72, AES: 0.48, FVF: 0.58, INF: 0.62, VEL: 0.84, DIA: 0.64, APP: 0.76 }, 220.0, 'OH', 0.5),
      kf(0.52, 'Transition into Clean Soulful Tone', 'Overgang til ren soulet tone', { CT: 0.46, TA: 0.58, LCA: 0.76, IA: 0.75, AES: 0.36, FVF: 0.1, INF: 0.42, VEL: 0.88, DIA: 0.4, APP: 0.74 }, 293.7, 'AA', 0.48),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.3, 'Tongue-Root Jammed Bark', 'Tungerods-presset halsgøen', { CT: 0.2, TA: 0.92, LCA: 0.94, IA: 0.9, FVF: 0.88, SUP: 0.82, APP: 0.3 }, 220.0, 'AA', 0.24, { jawJut: 0.6 }),
      RELEASE_STRAIN,
    ],
  },

  'cry-sob': {
    id: 'cry-sob',
    kind: 'technique',
    title: { en: 'Cry / Sob', da: 'Cry / Sob (Klynke-vip)' },
    defaultCamera: 'larynx-3d',
    defaultLayers: LAYERS_EXTRINSIC,
    durationSec: 7.5,
    summary: {
      en: 'Infrahyoid anchoring (INF) gently lowers/stabilizes the larynx while strong Cricothyroid tilt (CT) thins the folds—unlocking emotional warmth AND safe high notes without strain!',
      da: 'Infrahyoid forankring (INF) sænker/stabiliserer struben let mens tydeligt CT-vip gør stemmelæberne slanke—nøglen til følelsesfuld varme og sikre høje toner.',
    },
    strainSummary: {
      en: 'Depressing the larynx artificially by pushing the tongue root down ("Kermit swallow") muffles resonance and tenses the floor of the mouth.',
      da: 'At presse struben kunstigt ned med tungeroden giver en kvalt "Kermit"-klang og spændinger under hagen.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.2, 'Gentle Yawn-Sigh Larynx Drop + CT Tilt', 'Blidt gab-suk strube-sænk + CT-vip', { CT: 0.62, TA: 0.34, LCA: 0.74, IA: 0.72, AES: 0.24, INF: 0.62, VEL: 0.9, DIA: 0.66, APP: 0.66 }, 349.2, 'UH', 0.46),
      kf(0.56, 'Anchored Emotional High Note (Bb4)', 'Forankret følelsesladet høj tone (Bb4)', { CT: 0.8, TA: 0.32, LCA: 0.76, IA: 0.74, AES: 0.32, INF: 0.66, VEL: 0.94, DIA: 0.4, APP: 0.74 }, 466.2, 'UH', 0.52),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.32, 'Swallowed Tongue-Root Depression', ' Slugt tungerods-pres', { CT: 0.48, TA: 0.65, LCA: 0.84, IA: 0.82, INF: 0.7, SUP: 0.75, FVF: 0.55, VEL: 0.4, APP: 0.28 }, 392.0, 'UW', 0.22, { jawJut: 0.48 }),
      RELEASE_STRAIN,
    ],
  },

  vibrato: {
    id: 'vibrato',
    kind: 'technique',
    title: { en: 'Vibrato', da: 'Vibrato' },
    defaultCamera: 'larynx-3d',
    defaultLayers: LAYERS_EXTRINSIC,
    durationSec: 8.5,
    summary: {
      en: 'Natural vibrato (~5.5–6.5 Hz) emerges as a free neuromuscular reflex loop between CT/TA tension and steady subglottal breath pressure once SUP/jaw tension lets go.',
      da: 'Naturligt vibrato (~5,5–6,5 Hz) opstår som en fri neuromuskulær balance mellem CT/TA og jævnt lufttryk, når kæbe og hals slipper spændingen.',
    },
    strainSummary: {
      en: 'Faking vibrato by shaking the jaw or pulsing the stomach creates a wide, unstable wobble and fatigues the TMJ and extrinsic neck.',
      da: 'Falsk vibrato skabt ved at ryste kæben eller pumpe maven giver et ustabilt wobble og trætter kæbeleddet.',
    },
    healthy: buildVibratoKeyframes(true),
    strain: buildVibratoKeyframes(false),
  },

  'runs-riffs': {
    id: 'runs-riffs',
    kind: 'technique',
    title: { en: 'Runs & Riffs', da: 'Runs & Riffs (Løb & fraseringer)' },
    defaultCamera: 'larynx-3d',
    defaultLayers: LAYERS_LARYNX,
    durationSec: 8.0,
    summary: {
      en: 'Clean melismatic agility relies on rapid, lightweight CT micro-steps over an unwavering APP breath cushion—the jaw and larynx stay quiet while the intrinsic muscles dance.',
      da: 'Præcise vokal-løb bygger på hurtige, lette CT-mikrotrin hen over en helt rolig Appoggio-støtte—kæbe og strube holdes i ro.',
    },
    strainSummary: {
      en: 'Bouncing the jaw or huffing separate belly/glottal pulses on every note blurs fast runs and locks the throat.',
      da: 'At hoppe med kæben eller støde luften på hver enkelt tone udtværer hurtige løb.',
    },
    healthy: buildRunsKeyframes(true),
    strain: buildRunsKeyframes(false),
  },

  'pitch-bending': {
    id: 'pitch-bending',
    kind: 'technique',
    title: { en: 'Pitch Bending / Scoop', da: 'Pitch Bending / Scoop' },
    defaultCamera: 'larynx-3d',
    defaultLayers: LAYERS_LARYNX,
    durationSec: 7.0,
    summary: {
      en: 'Intentional blues/jazz scoop starts ~1–2 semitones below target pitch and smoothly rotates the CT visor into exact tuning while keeping closure and vowel resonance seamless.',
      da: 'Bevidst blues/jazz-bend starter 1–2 halvtoner under måltonen og roterer glidende CT-visoret på plads i ren intonation.',
    },
    strainSummary: {
      en: 'Uncontrolled scooping from an un-engaged throat drags heavy chest weight upward and lands flat.',
      da: 'Ukontrolleret slæb nedefra trækker tung vægt med op og lander ofte falsk.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.2, 'Expressive Below-Note Entry (Eb4)', 'Udtryksfuld start under tonen (Eb4)', { CT: 0.48, TA: 0.48, LCA: 0.74, IA: 0.73, AES: 0.3, INF: 0.32, VEL: 0.84, DIA: 0.66, APP: 0.66 }, 311.1, 'OH', 0.42),
      kf(0.46, 'Smooth CT Glide into Target (F4)', 'Glidende CT-indstilling på måltonen (F4)', { CT: 0.58, TA: 0.46, LCA: 0.76, IA: 0.74, AES: 0.34, INF: 0.34, VEL: 0.88, DIA: 0.48, APP: 0.72 }, 349.2, 'OH', 0.46),
      kf(0.76, 'Blues Micro-Inflection & Settle', 'Blues mikro-bøjning & landing', { CT: 0.55, TA: 0.47, LCA: 0.76, IA: 0.74, AES: 0.32, INF: 0.34, VEL: 0.88, DIA: 0.26, APP: 0.72 }, 339.0, 'AA', 0.45),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.25, 'Sloppy Under-Supported Scoop', 'Sløset ustøttet slæb opad', { CT: 0.26, TA: 0.82, LCA: 0.88, IA: 0.86, SUP: 0.78, FVF: 0.55, APP: 0.24 }, 290.0, 'AE', 0.28, { jawJut: 0.6 }),
      kf(0.65, 'Flat Strained Landing', 'Flad, presset landing', { CT: 0.42, TA: 0.86, LCA: 0.9, IA: 0.88, SUP: 0.84, FVF: 0.64, APP: 0.22 }, 340.0, 'AE', 0.26, { jawJut: 0.66 }),
      RELEASE_STRAIN,
    ],
  },

  'glottal-stop': {
    id: 'glottal-stop',
    kind: 'technique',
    title: { en: 'Glottal Stop / Onset', da: 'Glottal Stop / Ansats' },
    defaultCamera: 'laryngoscope',
    defaultLayers: LAYERS_LARYNX,
    durationSec: 6.5,
    summary: {
      en: 'Watch the arytenoids from above: LCA + IA briskly close the vocal folds just before release for a crisp pop/R&B vowel attack ("Uh-oh"), then immediately relax into buoyant vibration.',
      da: 'Se tudbruskene oppefra: LCA + IA lukker stemmelæberne kort og præcist før udløsning ("Uh-oh") og slipper straks over i fri svingning.',
    },
    strainSummary: {
      en: 'Hard glottal attack builds excessive P_sub behind tightly jammed folds + false folds, slamming the vocal processes together repeatedly.',
      da: 'Hårdt glottalt slag opbygger overtryk bag hårdt sammenpressede stemmelæber og belaster tudbruskenes spidser.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.2, 'Crisp Balanced Closure ("Uh-")', 'Præcist balanceret lukke ("Uh-")', { CT: 0.42, TA: 0.48, LCA: 0.9, IA: 0.9, INF: 0.26, VEL: 0.84, DIA: 0.64, APP: 0.54 }, 0, 'AA', 0.38),
      kf(0.28, 'Clean Release into Tone', 'Ren udløsning i klang', { CT: 0.44, TA: 0.5, LCA: 0.75, IA: 0.74, AES: 0.28, INF: 0.28, VEL: 0.86, DIA: 0.58, APP: 0.64 }, 293.7, 'AA', 0.42),
      kf(0.52, 'Second Crisp Onset ("-oh!")', 'Anden præcise ansats ("-oh!")', { CT: 0.36, TA: 0.52, LCA: 0.9, IA: 0.9, INF: 0.26, VEL: 0.84, DIA: 0.44, APP: 0.54 }, 0, 'OH', 0.38),
      kf(0.6, 'Resonant Follow-Through', 'Frit klingende fortsættelse', { CT: 0.38, TA: 0.52, LCA: 0.75, IA: 0.74, AES: 0.26, INF: 0.28, VEL: 0.86, DIA: 0.34, APP: 0.64 }, 246.9, 'OH', 0.42),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.22, 'Hyper-Adducted Glottal Slam', 'Overpresset glottalt smæld', { CT: 0.35, TA: 0.95, LCA: 0.99, IA: 0.99, FVF: 0.85, SUP: 0.82, APP: 0.85 }, 0, 'AE', 0.24, { jawJut: 0.6 }),
      kf(0.32, 'Explosive Coughed Attack', 'Eksplosivt hoste-agtigt anslag', { CT: 0.38, TA: 0.9, LCA: 0.94, IA: 0.92, FVF: 0.78, SUP: 0.84, APP: 0.75 }, 293.7, 'AE', 0.26, { jawJut: 0.62 }),
      RELEASE_STRAIN,
    ],
  },

  'breath-support': {
    id: 'breath-support',
    kind: 'technique',
    title: { en: 'Breath Support (Appoggio)', da: 'Breath Support (Åndedrætsstøtte)' },
    defaultCamera: 'breath-appoggio',
    defaultLayers: LAYERS_BREATH,
    durationSec: 9.0,
    summary: {
      en: 'Full 3+1D thorax view: DIA contracts downward ~3.2 cm on inhale while ribs swing wide; during the phrase, External Intercostals + Abdominal Obliques/Transversus (APP) keep the rib cage buoyant and meter rock-steady P_sub!',
      da: 'Fuldt 3+1D brystkasse-view: mellemgulvet (DIA) sænkes ~3,2 cm ved indånding mens ribbenene udvides; under frasen holder interkostaler og dybe mavemuskler (APP) ribbenene åbne og doserer et helt jævnt lufttryk.',
    },
    strainSummary: {
      en: 'Clavicular breathing heaves the shoulders/upper chest, collapses the ribs immediately on onset, and transfers the missing support straight into neck constriction (SUP).',
      da: 'Klavikulær vejrtrækning hiver skuldrene op, lader brystkassen klappe sammen straks ved sangstart og flytter presset op i halsen (SUP).',
    },
    healthy: [
      kf(0.0, 'Neutral Resting Posture', 'Neutral afspændt holdning', { PCA: 0.5, DIA: 0.15, APP: 0.15, INF: 0.18 }, 0, 'AA', 0.26),
      kf(0.22, '360° Diaphragmatic + Rib Expansion', '360° mellemgulvs- & ribbens-udvidelse', { PCA: 0.88, DIA: 0.92, APP: 0.52, INF: 0.25, VEL: 0.5 }, 0, 'AA', 0.34),
      kf(0.34, 'Appoggio Suspension & Clean Onset', 'Appoggio-ophæng & ren ansats', { CT: 0.48, TA: 0.52, LCA: 0.76, IA: 0.75, AES: 0.3, INF: 0.32, VEL: 0.88, DIA: 0.78, APP: 0.76 }, 329.6, 'AA', 0.44),
      kf(0.65, 'Ribs Stay Wide While Abs Meter Ascent', 'Ribben holdes åbne mens maven doserer', { CT: 0.5, TA: 0.52, LCA: 0.76, IA: 0.75, AES: 0.32, INF: 0.34, VEL: 0.88, DIA: 0.46, APP: 0.84 }, 329.6, 'AA', 0.45),
      kf(0.9, 'Controlled End-of-Phrase Economy', 'Kontrolleret luftøkonomi ved frasens slutning', { CT: 0.5, TA: 0.52, LCA: 0.76, IA: 0.75, AES: 0.34, INF: 0.34, VEL: 0.88, DIA: 0.16, APP: 0.88 }, 329.6, 'AA', 0.45),
      RELEASE_HEALTHY(),
    ],
    strain: [
      kf(0.0, 'Slumped / Tense Neck Setup', 'Anspændt udgangspunkt', { PCA: 0.4, SUP: 0.45 }, 0, 'AE', 0.2),
      INHALE_CLAVICULAR(0.2),
      kf(0.38, 'Immediate Rib Collapse & Throat Grab', 'Øjeblikkeligt ribbens-kollaps & halsklem', { CT: 0.44, TA: 0.78, LCA: 0.88, IA: 0.86, FVF: 0.6, SUP: 0.82, DIA: 0.08, APP: 0.18 }, 329.6, 'AE', 0.28, { jawJut: 0.58, clavicularHeave: 0.75 }),
      kf(0.75, 'Out-of-Air Squeeze', 'Lufttom hals-pressen', { CT: 0.4, TA: 0.88, LCA: 0.92, IA: 0.9, FVF: 0.76, SUP: 0.9, DIA: 0.02, APP: 0.12 }, 320.0, 'AE', 0.24, { jawJut: 0.7, clavicularHeave: 0.8 }),
      RELEASE_STRAIN,
    ],
  },

  'messa-di-voce': {
    id: 'messa-di-voce',
    kind: 'technique',
    title: { en: 'Messa di Voce (pp → ff → pp)', da: 'Messa di Voce (pp → ff → pp)' },
    defaultCamera: 'larynx-3d',
    defaultLayers: LAYERS_BREATH,
    durationSec: 9.0,
    summary: {
      en: 'Ultimate control test on one pitch (E4): swelling pp → ff → pp requires smoothly increasing APP + TA + AES ring at the peak, then tapering TA back to silky piano WITHOUT losing closure or pitch!',
      da: 'Den ultimative kontroltest på én tone (E4): crescendo pp → ff → pp kræver jævn øgning af APP + TA + AES ved toppen, og derefter kontrolleret slankning tilbage til pp uden knæk eller tonefald.',
    },
    strainSummary: {
      en: 'Without APP coordination, the loud peak goes sharp & pressed while the decrescendo collapses into breathy crack.',
      da: 'Uden støtte-koordinering bliver toppen presset og for høj, mens decrescendoet kollapser i et luftigt knæk.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.18, 'Pianissimo Silk Onset (pp, E4)', 'Silkeblød pianissimo-start (pp, E4)', { CT: 0.58, TA: 0.26, LCA: 0.7, IA: 0.66, AES: 0.22, INF: 0.34, VEL: 0.88, DIA: 0.74, APP: 0.56 }, 329.6, 'OH', 0.42),
      kf(0.52, 'Fortissimo Resonant Peak (ff, E4)', 'Klangfuldt fortissimo-højdepunkt (ff, E4)', { CT: 0.62, TA: 0.62, LCA: 0.8, IA: 0.78, AES: 0.58, INF: 0.4, VEL: 0.94, DIA: 0.46, APP: 0.9 }, 329.6, 'AA', 0.56),
      kf(0.88, 'Tapered Pianissimo Return (pp, E4)', 'Kontrolleret pianissimo-afrunding (pp, E4)', { CT: 0.58, TA: 0.26, LCA: 0.72, IA: 0.68, AES: 0.26, INF: 0.36, VEL: 0.9, DIA: 0.18, APP: 0.74 }, 329.6, 'OH', 0.42),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.2, 'Breathy Unstable Start', 'Luftig ustabil start', { CT: 0.52, TA: 0.15, LCA: 0.45, IA: 0.2, SUP: 0.5, APP: 0.2 }, 325.0, 'AE', 0.26),
      kf(0.52, 'Over-Blown Sharp Peak', 'Overblæst presset top', { CT: 0.48, TA: 0.92, LCA: 0.94, IA: 0.9, FVF: 0.74, SUP: 0.88, APP: 0.35 }, 339.0, 'AE', 0.34, { jawJut: 0.7 }),
      kf(0.85, 'Collapsed Decrescendo Crack', 'Sammenklappet decrescendo-knæk', { CT: 0.56, TA: 0.08, LCA: 0.36, IA: 0.1, SUP: 0.7, APP: 0.12 }, 322.0, 'UH', 0.26, { jawJut: 0.45 }),
      RELEASE_STRAIN,
    ],
  },

  'dynamic-contrast': {
    id: 'dynamic-contrast',
    kind: 'technique',
    title: { en: 'Dynamic Contrast', da: 'Dynamic Contrast (Dynamisk kontrast)' },
    defaultCamera: 'sagittal-tract',
    defaultLayers: LAYERS_BREATH,
    durationSec: 8.0,
    summary: {
      en: 'Rapid expressive shifts between intimate soft phrasing and ringing forte rely on agile APP subglottal pressure + AES resonance boosts—NOT throat squeezing.',
      da: 'Hurtige udtryksfulde skift mellem intim svag frasering og bærende forte styres af smidig Appoggio-trykregulering og AES-klang—ikke halspres.',
    },
    strainSummary: {
      en: 'Equating "soft" with collapsed breath and "loud" with neck strain destroys tone consistency.',
      da: 'At forveksle "svagt" med manglende støtte og "kraftigt" med halspres ødelægger klangens sammenhæng.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.2, 'Intimate Supported Verse (mp)', 'Intimt støttet vers (mp)', { CT: 0.44, TA: 0.36, LCA: 0.68, IA: 0.62, AES: 0.2, INF: 0.3, VEL: 0.84, DIA: 0.68, APP: 0.58 }, 261.6, 'OH', 0.38),
      kf(0.48, 'Sudden Chorus Bloom (f)', 'Pludseligt omkvæds-løft (f)', { CT: 0.68, TA: 0.56, LCA: 0.8, IA: 0.78, AES: 0.6, INF: 0.38, VEL: 0.94, DIA: 0.46, APP: 0.88 }, 440.0, 'EH', 0.56),
      kf(0.78, 'Whisper-Close Resolution (pp)', 'Blød intim afrunding (pp)', { CT: 0.54, TA: 0.24, LCA: 0.64, IA: 0.52, AES: 0.22, INF: 0.32, VEL: 0.86, DIA: 0.24, APP: 0.66 }, 329.6, 'UH', 0.4),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.22, 'Unsupported Mumbling Verse', 'Ustøttet mumlende vers', { CT: 0.38, TA: 0.2, LCA: 0.42, IA: 0.18, SUP: 0.48, APP: 0.14 }, 261.6, 'AA', 0.22),
      kf(0.55, 'Shouted Chorus Larynx Hike', 'Råbt omkvæd med høj strube', { CT: 0.45, TA: 0.94, LCA: 0.95, IA: 0.92, FVF: 0.8, SUP: 0.92, APP: 0.3 }, 440.0, 'AE', 0.34, { jawJut: 0.76, clavicularHeave: 0.65 }),
      RELEASE_STRAIN,
    ],
  },

  // === COMPLETE VOCAL TECHNIQUE (CVT) 4 MODES ===
  'cvt-neutral': {
    id: 'cvt-neutral',
    kind: 'cvt',
    title: { en: 'CVT · Neutral Mode', da: 'CVT · Neutral Mode' },
    defaultCamera: 'laryngoscope',
    defaultLayers: LAYERS_TRACT,
    durationSec: 6.5,
    summary: {
      en: 'Non-metallic mode (only CVT mode that works on ALL vowels across the entire range, pp–mf, with or without breathiness): open epilarynx (low AES), relaxed jaw, gentle closure.',
      da: 'Den eneste ikke-metalliske CVT-mode: kan synges på ALLE vokaler i hele registret med åben tragt (lav AES), afslappet kæbe og blødt lukke.',
    },
    strainSummary: {
      en: 'Forcing ff volume in Neutral without transitioning to a metallic mode overblows the delicate fold edges.',
      da: 'At tvinge høj volumen ud i Neutral overblæser stemmelæberne.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.22, 'Neutral Airy ("Soft Breath")', 'Neutral med luft', { CT: 0.56, TA: 0.22, LCA: 0.56, IA: 0.28, AES: 0.1, INF: 0.28, VEL: 0.84, DIA: 0.66, APP: 0.56 }, 392.0, 'OH', 0.4),
      kf(0.62, 'Neutral Non-Breathy ("Pure Flute/Bell")', 'Neutral uden luft', { CT: 0.62, TA: 0.28, LCA: 0.74, IA: 0.72, AES: 0.16, INF: 0.3, VEL: 0.88, DIA: 0.38, APP: 0.64 }, 440.0, 'UH', 0.44),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.4, 'Overblown Neutral Constriction', 'Overblæst Neutral-spænding', { CT: 0.58, TA: 0.5, LCA: 0.48, IA: 0.2, FVF: 0.58, SUP: 0.8, APP: 0.8 }, 440.0, 'AE', 0.28, { jawJut: 0.55 }),
      RELEASE_STRAIN,
    ],
  },

  'cvt-curbing': {
    id: 'cvt-curbing',
    kind: 'cvt',
    title: { en: 'CVT · Curbing Mode', da: 'CVT · Curbing Mode' },
    defaultCamera: 'larynx-3d',
    defaultLayers: LAYERS_EXTRINSIC,
    durationSec: 6.5,
    summary: {
      en: 'Half-metallic mode (mf) built on "Hold" (mild cry/moan restraint): slightly lowered/anchored larynx (INF), moderate AES ring, and rounded vowels UH / O / I.',
      da: 'Halv-metallisk mode (mf) baseret på et blidt "Hold": let forankret strube (INF), moderat twang og vokalerne UH / O / I.',
    },
    strainSummary: {
      en: 'Losing the "Hold" on wrong vowels (wide AA/AE) slips into strained Overdrive or cracks.',
      da: 'Mister man sit "Hold" på for bred vokal, glider stemmen ud i pres eller knæk.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.22, 'Establishing the "Hold" (UH Vowel)', 'Etablering af "Hold" (UH-vokal)', { CT: 0.58, TA: 0.46, LCA: 0.76, IA: 0.75, AES: 0.38, INF: 0.52, VEL: 0.9, DIA: 0.66, APP: 0.72 }, 369.99, 'UH', 0.46),
      kf(0.65, 'Soulful Half-Metallic Sustain (A4)', 'Soulet halv-metallisk klang (A4)', { CT: 0.7, TA: 0.44, LCA: 0.78, IA: 0.76, AES: 0.42, INF: 0.54, VEL: 0.92, DIA: 0.36, APP: 0.78 }, 440.0, 'UH', 0.48),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.45, 'Lost Hold → Squeezed Throat', 'Tabt Hold → klemt hals', { CT: 0.52, TA: 0.82, LCA: 0.9, IA: 0.88, FVF: 0.66, SUP: 0.84, APP: 0.3 }, 440.0, 'AE', 0.28, { jawJut: 0.62 }),
      RELEASE_STRAIN,
    ],
  },

  'cvt-overdrive': {
    id: 'cvt-overdrive',
    kind: 'cvt',
    title: { en: 'CVT · Overdrive Mode', da: 'CVT · Overdrive Mode' },
    defaultCamera: 'sagittal-tract',
    defaultLayers: LAYERS_TRACT,
    durationSec: 6.5,
    summary: {
      en: 'Full-metallic direct shout-like mode (f–ff) built on the "Bite" position (dropped jaw, open pharynx, strictly EH / OH vowels) and firm TA + APP support.',
      da: 'Fuld-metallisk direkte råbe-lignende mode (f–ff) bygget på "Bid"-stilling (åben kæbe, åbent svælg, kun EH / OH-vokaler) og stærk støtte.',
    },
    strainSummary: {
      en: 'Pushing Overdrive above its pitch ceiling (C5 men / D5 women) or on EE/OO vowels triggers severe constriction.',
      da: 'At presse Overdrive over tonehøjdeloftet eller på forkerte vokaler udløser kraftig spænding.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.22, '"Bite" Setup on EH ("Hey!")', '"Bid"-opsætning på EH ("Hey!")', { CT: 0.5, TA: 0.68, LCA: 0.82, IA: 0.8, AES: 0.52, INF: 0.36, VEL: 0.92, DIA: 0.66, APP: 0.84 }, 349.2, 'EH', 0.58),
      kf(0.65, 'Full-Metallic Overdrive Projection (Bb4)', 'Fuld-metallisk Overdrive-projektion (Bb4)', { CT: 0.64, TA: 0.66, LCA: 0.82, IA: 0.8, AES: 0.58, INF: 0.38, VEL: 0.94, DIA: 0.36, APP: 0.9 }, 466.2, 'OH', 0.62),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.45, 'Ceiling Violation + Jaw Jut', 'Overskredet loft + fremskudt kæbe', { CT: 0.42, TA: 0.96, LCA: 0.96, IA: 0.94, FVF: 0.82, SUP: 0.92, APP: 0.32 }, 493.9, 'IY', 0.3, { jawJut: 0.8 }),
      RELEASE_STRAIN,
    ],
  },

  'cvt-edge': {
    id: 'cvt-edge',
    kind: 'cvt',
    title: { en: 'CVT · Edge Mode', da: 'CVT · Edge Mode' },
    defaultCamera: 'laryngoscope',
    defaultLayers: LAYERS_TRACT,
    durationSec: 6.5,
    summary: {
      en: 'Brightest, sharpest full-metallic mode (f–ff into extreme highs): intense AES twang funnel narrowing + raised tongue dorsum on twanged vowels (I, EH, A, OE) + high APP support.',
      da: 'Lyseste, skarpeste fuld-metalliske mode (f–ff helt op i det høje leje): kraftig AES-twang-indsnævring + løftet tungeryg på twangede vokaler + stærk støtte.',
    },
    strainSummary: {
      en: 'Attempting Edge without distinct AES twang forces the true vocal folds to absorb the entire load.',
      da: 'At forsøge Edge uden tydeligt AES-twang tvinger de ægte stemmelæber til at bære hele presset.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.22, 'Distinct AES Twang Lock (A4)', 'Tydelig AES-twang lås (A4)', { CT: 0.72, TA: 0.5, LCA: 0.82, IA: 0.8, AES: 0.86, INF: 0.24, SUP: 0.26, VEL: 0.95, DIA: 0.66, APP: 0.84 }, 440.0, 'EH', 0.5),
      kf(0.65, 'Laser-Bright High Edge (D5)', 'Knivskarp høj Edge (D5)', { CT: 0.86, TA: 0.46, LCA: 0.84, IA: 0.82, AES: 0.9, INF: 0.26, SUP: 0.28, VEL: 0.96, DIA: 0.36, APP: 0.9 }, 587.3, 'IH', 0.54),
      RELEASE_HEALTHY(),
    ],
    strain: [
      INHALE_CLAVICULAR(0.0),
      kf(0.45, 'Untwanged Screamed High Note', 'U-twanget skreget høj tone', { CT: 0.65, TA: 0.92, LCA: 0.96, IA: 0.94, AES: 0.3, FVF: 0.88, SUP: 0.95, APP: 0.34 }, 587.3, 'AE', 0.32, { jawJut: 0.82 }),
      RELEASE_STRAIN,
    ],
  },

  // === WARM-UP COACH EXERCISES ===
  'warmup-sss': {
    id: 'warmup-sss',
    kind: 'warmup',
    title: { en: '1 · Breathing "Sss" Hiss (60s)', da: '1 · Åndedræt på "Sss" (60s)' },
    defaultCamera: 'breath-appoggio',
    defaultLayers: LAYERS_BREATH,
    durationSec: 8.0,
    summary: {
      en: '4-count 360° inhale into belly/ribs/back (DIA + PCA), followed by a steady 15–20s unvoiced "Sss" hiss where APP keeps ribs open while abs meter pressure.',
      da: '4-takters 360° indånding i mave/ribben/ryg (DIA + PCA), efterfulgt af et jævnt 15–20s "Sss", hvor APP holder ribbenene åbne.',
    },
    strainSummary: {
      en: 'Chest-heaving and dumping all air in the first 3 seconds leaves nothing for phrasing.',
      da: 'Skulder-hiv og luftspild på 3 sekunder tømmer støtten med det samme.',
    },
    healthy: [
      kf(0.0, 'Relaxed Shoulders & Neck', 'Afslappede skuldre & nakke', { PCA: 0.5, DIA: 0.15, APP: 0.15 }, 0, 'IH', 0.22),
      kf(0.24, '4-Count 360° Inhale', '4-takters 360° indånding', { PCA: 0.88, DIA: 0.9, APP: 0.5, INF: 0.2 }, 0, 'AA', 0.3),
      kf(0.6, 'Steady Metered "Sss" Resistance', 'Jævn doseret "Sss"-modstand', { PCA: 0.22, LCA: 0.35, DIA: 0.52, APP: 0.8, INF: 0.2 }, 0, 'IH', 0.2),
      kf(0.92, 'Sustained Rib Buoyancy to End', 'Ribben holdes åbne helt til slut', { PCA: 0.22, LCA: 0.35, DIA: 0.14, APP: 0.86, INF: 0.2 }, 0, 'IH', 0.2),
      RELEASE_HEALTHY(),
    ],
    strain: [INHALE_CLAVICULAR(0.15), RELEASE_STRAIN],
  },

  'warmup-lip-trills': {
    id: 'warmup-lip-trills',
    kind: 'warmup',
    title: { en: '2 · Lip Trills / Bubbles (60s)', da: '2 · Læbetriller (60s)' },
    defaultCamera: 'sagittal-tract',
    defaultLayers: LAYERS_BREATH,
    durationSec: 7.5,
    summary: {
      en: 'Semi-occluded vocal tract (SOVT): gentle back-pressure from vibrating lips cushions the vocal folds, letting CT & TA glide smoothly across registers with zero jaw/neck strain.',
      da: 'Semi-okkluderet vokaltrakt (SOVT): blidt modtryk fra vibrerende læber aflaster stemmelæberne, så CT & TA glider frit gennem registrene.',
    },
    strainSummary: {
      en: 'Squeezing the cheeks/jaw stops the lips from bubbling and pushes pressure back onto the neck.',
      da: 'At bide kæben sammen stopper læbetrillen og sender spænding i halsen.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.2, 'Low Lip Bubble Start (C3/G3)', 'Lav læbetrille-start', { CT: 0.24, TA: 0.46, LCA: 0.68, IA: 0.66, INF: 0.32, VEL: 0.84, DIA: 0.68, APP: 0.68 }, 196.0, 'UW', 0.18),
      kf(0.55, 'Effortless SOVT Passaggio Glide (G4)', 'Ubesværet SOVT-glid over overgangen', { CT: 0.74, TA: 0.32, LCA: 0.7, IA: 0.68, INF: 0.36, VEL: 0.9, DIA: 0.42, APP: 0.74 }, 392.0, 'UW', 0.2),
      kf(0.85, 'Smooth Glide Back Down', 'Blødt glid ned igen', { CT: 0.28, TA: 0.44, LCA: 0.68, IA: 0.66, INF: 0.32, VEL: 0.84, DIA: 0.22, APP: 0.68 }, 196.0, 'UW', 0.18),
      RELEASE_HEALTHY(),
    ],
    strain: [INHALE_CLAVICULAR(0.15), RELEASE_STRAIN],
  },

  'warmup-humming': {
    id: 'warmup-humming',
    kind: 'warmup',
    title: { en: '3 · Resonant Humming "Mmm" (60s)', da: '3 · Resonant Nynnen "Mmm" (60s)' },
    defaultCamera: 'sagittal-tract',
    defaultLayers: LAYERS_TRACT,
    durationSec: 7.0,
    summary: {
      en: 'Relaxed soft palate (low VEL = open nasal port), parted molars behind closed lips, and gentle thin-edge fold closure awaken sympathetic mask buzz cleanly.',
      da: 'Afslappet blød gane (lav VEL = åben næseport), adskilte kindtænder bag lukkede læber og blødt stemmelæbelukke vækker maske-resonansen skånsomt.',
    },
    strainSummary: {
      en: 'Clenching the teeth while humming locks the masseter and digastric muscles.',
      da: 'Sammenbidte tænder under nynnen låser kæbe- og halsmuskler.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.22, 'Parted-Teeth Mask Hum ("Mmm")', 'Maske-nynnen med løs kæbe ("Mmm")', { CT: 0.38, TA: 0.38, LCA: 0.68, IA: 0.66, AES: 0.22, INF: 0.3, VEL: 0.12, DIA: 0.66, APP: 0.6 }, 246.9, 'MM', 0.22),
      kf(0.62, '5-Note Ascending Hum Scale', '5-toners opadgående nynne-skala', { CT: 0.56, TA: 0.34, LCA: 0.7, IA: 0.68, AES: 0.26, INF: 0.32, VEL: 0.14, DIA: 0.38, APP: 0.66 }, 369.99, 'MM', 0.24),
      RELEASE_HEALTHY(),
    ],
    strain: [INHALE_CLAVICULAR(0.15), RELEASE_STRAIN],
  },

  'warmup-vowel-slides': {
    id: 'warmup-vowel-slides',
    kind: 'warmup',
    title: { en: '4 · Open Vowel Slides (60s)', da: '4 · Åbne Vokal-glid (60s)' },
    defaultCamera: 'sagittal-tract',
    defaultLayers: LAYERS_TRACT,
    durationSec: 7.5,
    summary: {
      en: 'Transitions from nasal hum into lifted-palate oral vowels ("Mah–Meh–Mee–Moh–Moo") while keeping pharyngeal space calm and consistent.',
      da: 'Skifter fra nynnen til mund-vokaler med løftet gane ("Mah–Meh–Mee–Moh–Moo") og roligt, åbent svælg.',
    },
    strainSummary: {
      en: 'Chewing every vowel violently with the jaw destabilizes resonance.',
      da: 'Overdreven kæbetygning på hver vokal forstyrrer resonansen.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.2, '"Mah" — Velum Lifts Cleanly', '"Mah" — bløde gane løftes', { CT: 0.42, TA: 0.46, LCA: 0.74, IA: 0.72, AES: 0.26, INF: 0.32, VEL: 0.88, DIA: 0.66, APP: 0.64 }, 261.6, 'AA', 0.44),
      kf(0.5, '"Mee" — Tongue Fronts Without Jaw Clamp', '"Mee" — tungen frem uden kæbeklem', { CT: 0.54, TA: 0.42, LCA: 0.74, IA: 0.72, AES: 0.32, INF: 0.34, VEL: 0.94, DIA: 0.44, APP: 0.68 }, 329.6, 'IY', 0.38),
      kf(0.8, '"Moo" — Warm Rounded Tract', '"Moo" — varm rundet vokaltrakt', { CT: 0.42, TA: 0.44, LCA: 0.74, IA: 0.72, AES: 0.24, INF: 0.36, VEL: 0.94, DIA: 0.24, APP: 0.66 }, 261.6, 'UW', 0.36),
      RELEASE_HEALTHY(),
    ],
    strain: [INHALE_CLAVICULAR(0.15), RELEASE_STRAIN],
  },

  'warmup-sirens': {
    id: 'warmup-sirens',
    kind: 'warmup',
    title: { en: '5 · Full-Range "Ng / Oo" Sirens (60s)', da: '5 · Fuld-register "Ng / Oo" Sirener (60s)' },
    defaultCamera: 'larynx-3d',
    defaultLayers: LAYERS_LARYNX,
    durationSec: 8.0,
    summary: {
      en: 'Continuous low-to-high-to-low siren stretches the CT muscle and vocal ligaments elastically across chest, mix, and head without register breaks.',
      da: 'Kontinuerlig sirene fra bund til top strækker CT-musklen og stemmelæbebåndene smidigt gennem bryst, mix og hoved uden knæk.',
    },
    strainSummary: {
      en: 'Muscling through the middle instead of letting CT tilt causes an audible jump.',
      da: 'At presse brystvægt med op i stedet for CT-vip skaber et hørbart knæk.',
    },
    healthy: [
      INHALE_HEALTHY(0.0),
      kf(0.18, 'Low Chest Start (E3)', 'Lav bryst-start (E3)', { CT: 0.16, TA: 0.6, LCA: 0.72, IA: 0.7, INF: 0.3, VEL: 0.86, DIA: 0.7, APP: 0.6 }, 164.8, 'UW', 0.34),
      kf(0.52, 'Peak Head Stretch (C5)', 'Top hovedstemme-stræk (C5)', { CT: 0.84, TA: 0.22, LCA: 0.74, IA: 0.72, AES: 0.32, INF: 0.38, VEL: 0.94, DIA: 0.44, APP: 0.74 }, 523.3, 'UW', 0.46),
      kf(0.86, 'Seamless Return (E3)', 'Sømløs landing (E3)', { CT: 0.18, TA: 0.58, LCA: 0.72, IA: 0.7, INF: 0.3, VEL: 0.86, DIA: 0.2, APP: 0.62 }, 164.8, 'UW', 0.34),
      RELEASE_HEALTHY(),
    ],
    strain: [INHALE_CLAVICULAR(0.15), RELEASE_STRAIN],
  },
};

export interface MythSimLink {
  mythIndex: number; // 0..9 matching the 10 vocal myths in vocalGuideData.json
  trajectoryId: string;
  camera: CameraPresetId;
  compareStrainFirst: boolean;
  caption: Record<Lang, string>;
}

export const MYTH_SIM_LINKS: readonly MythSimLink[] = [
  {
    mythIndex: 0,
    trajectoryId: 'breath-support',
    camera: 'breath-appoggio',
    compareStrainFirst: false,
    caption: {
      en: 'Watch DIA contract downward ONLY on inhale, then release upward as APP (intercostals + abs) meters exhalation.',
      da: 'Se mellemgulvet (DIA) arbejde nedad ved indånding, mens ribben og mavemuskler (APP) styrer udåndingen.',
    },
  },
  {
    mythIndex: 1,
    trajectoryId: 'vowel-modification',
    camera: 'sagittal-tract',
    compareStrainFirst: true,
    caption: {
      en: 'Toggle Strain vs Healthy: yanking the jaw wide chokes the pharynx; moderate downward-back release keeps resonance free.',
      da: 'Skift mellem Strain og Healthy: overåbnet kæbe låser halsen, mens naturligt slip giver fri resonans.',
    },
  },
  {
    mythIndex: 2,
    trajectoryId: 'head-voice',
    camera: 'larynx-3d',
    compareStrainFirst: false,
    caption: {
      en: 'High notes need CT fold elongation and steady P_sub—NOT a huge air blast (notice low metered airflow in Healthy!).',
      da: 'Høje toner kræver CT-stræk og jævnt tryk—IKKE mere luftmængde.',
    },
  },
  {
    mythIndex: 3,
    trajectoryId: 'falsetto',
    camera: 'laryngoscope',
    compareStrainFirst: false,
    caption: {
      en: 'Compare Falsetto (posterior IA chink, airy) vs Head Voice (full LCA+IA closure, ringing) right on the laryngoscope view!',
      da: 'Sammenlign Falset (bageste sprække, luftig) mod Head Voice (fuldt lukke, klangfuld) direkte i laryngoskop-visningen.',
    },
  },
  {
    mythIndex: 4,
    trajectoryId: 'mixed-voice',
    camera: 'larynx-3d',
    compareStrainFirst: false,
    caption: {
      en: 'Singing is pure trainable motor coordination across these 12 muscles—watch the smooth passaggio handoff.',
      da: 'Sang er trænbar muskelkoordinering på tværs af disse 12 kanaler.',
    },
  },
  {
    mythIndex: 5,
    trajectoryId: 'grit-rasp',
    camera: 'laryngoscope',
    compareStrainFirst: true,
    caption: {
      en: '"No pain, no gain" is dangerous: see how Strain slams the true folds, while Healthy Grit uses supraglottic false folds safely.',
      da: 'Smerte i halsen er advarsel om overbelastning af de ægte stemmelæber—aldrig muskelopbygning.',
    },
  },
  {
    mythIndex: 6,
    trajectoryId: 'belting',
    camera: 'sagittal-tract',
    compareStrainFirst: true,
    caption: {
      en: 'Compare Healthy Belt (CT+TA+AES+APP) vs Strain (pushed pure chest + high larynx).',
      da: 'Sammenlign sund Belting (CT+TA+AES+APP) mod farligt bryst-pres.',
    },
  },
  {
    mythIndex: 7,
    trajectoryId: 'vibrato',
    camera: 'larynx-3d',
    compareStrainFirst: true,
    caption: {
      en: 'Compare natural CT spin (Healthy) vs forced jaw-wagging wobble (Strain).',
      da: 'Sammenlign naturligt CT-vibrato mod tvungen kæbe-rysten.',
    },
  },
  {
    mythIndex: 8,
    trajectoryId: 'warmup-humming',
    camera: 'sagittal-tract',
    compareStrainFirst: false,
    caption: {
      en: 'Whispering/clearing scrapes dry folds; gentle SOVT humming & lip trills hydrate and align closure safely.',
      da: 'Blid nynnen og læbetriller beskytter slimhinden bedre end hvisken.',
    },
  },
  {
    mythIndex: 9,
    trajectoryId: 'cry-sob',
    camera: 'larynx-3d',
    compareStrainFirst: false,
    caption: {
      en: 'Range expands safely by training CT tilt + INF anchor rather than pushing force.',
      da: 'Registeret udvides sikkert gennem CT-vip og INF-forankring.',
    },
  },
];
