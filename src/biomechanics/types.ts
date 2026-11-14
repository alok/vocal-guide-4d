export type Lang = 'en' | 'da';

export type ChannelId =
  | 'CT'
  | 'TA'
  | 'LCA'
  | 'IA'
  | 'PCA'
  | 'AES'
  | 'FVF'
  | 'INF'
  | 'SUP'
  | 'VEL'
  | 'DIA'
  | 'APP';

export type LayerId = 'larynx' | 'extrinsic' | 'tract' | 'breath';

export type CameraPresetId =
  | 'laryngoscope'
  | 'larynx-3d'
  | 'sagittal-tract'
  | 'breath-appoggio';

export type VowelId = 'AA' | 'AE' | 'EH' | 'IH' | 'IY' | 'OH' | 'UH' | 'UW' | 'MM';

export type ChannelVector = Record<ChannelId, number>;

export interface ChannelMeta {
  id: ChannelId;
  layer: LayerId;
  color: string;
  shortLabel: string;
  name: Record<Lang, string>;
  action: Record<Lang, string>;
}

export const CHANNEL_ORDER: readonly ChannelId[] = [
  'CT',
  'TA',
  'LCA',
  'IA',
  'PCA',
  'AES',
  'FVF',
  'INF',
  'SUP',
  'VEL',
  'DIA',
  'APP',
] as const;

export const CHANNEL_META: Record<ChannelId, ChannelMeta> = {
  CT: {
    id: 'CT',
    layer: 'larynx',
    color: '#38bdf8',
    shortLabel: 'CT · Pitch Stretch',
    name: {
      en: 'Cricothyroid (Pars Recta & Obliqua)',
      da: 'Cricothyroideus (Tonehøjde-stræk)',
    },
    action: {
      en: 'Tilts thyroid cartilage forward/down on the cricoid arch, elongating and thinning the vocal folds to raise pitch.',
      da: 'Vippeskjoldbrusken fremad/nedad på ringbrusken, så stemmelæberne strækkes og gøres tyndere for højere toner.',
    },
  },
  TA: {
    id: 'TA',
    layer: 'larynx',
    color: '#f97316',
    shortLabel: 'TA · Body Weight',
    name: {
      en: 'Thyroarytenoid & Vocalis',
      da: 'Thyroarytenoideus & Vocalis (Fylde)',
    },
    action: {
      en: 'Thickens, shortens, and stiffens the muscular fold body for chest-voice depth, firm closure, and longer closed phase.',
      da: 'Gør selve stemmelæbemusklen tykkere og kortere for bryststemme-fylde, tæt lukke og længere lukket fase.',
    },
  },
  LCA: {
    id: 'LCA',
    layer: 'larynx',
    color: '#fb7185',
    shortLabel: 'LCA · Medial Closure',
    name: {
      en: 'Lateral Cricoarytenoid',
      da: 'Lateral Cricoarytenoideus (Lukke)',
    },
    action: {
      en: 'Rotates the arytenoid vocal processes inward to bring the membranous vocal folds together.',
      da: 'Roterer tudbruskenes stemmelæbefremspring indad for at samle den membranøse del af stemmelæberne.',
    },
  },
  IA: {
    id: 'IA',
    layer: 'larynx',
    color: '#e879f9',
    shortLabel: 'IA · Posterior Seal',
    name: {
      en: 'Interarytenoid (Transverse & Oblique)',
      da: 'Interarytenoideus (Bageste lukke)',
    },
    action: {
      en: 'Slides the two arytenoids together to seal the back of the glottis (relaxed in falsetto and breathy singing).',
      da: 'Glider tudbruskene sammen bagtil for fuldt lukke (afslappet ved falset og luftig sang, så der opstår en trekant-sprække).',
    },
  },
  PCA: {
    id: 'PCA',
    layer: 'larynx',
    color: '#2dd4bf',
    shortLabel: 'PCA · Abductor (Open)',
    name: {
      en: 'Posterior Cricoarytenoid',
      da: 'Posterior Cricoarytenoideus (Åbner)',
    },
    action: {
      en: 'Sole abductor of the vocal folds: rocks the arytenoids outward into a wide V-glottis for silent rapid inhalation.',
      da: 'Eneste muskel der åbner stemmelæberne i en bred V-form til hurtig, lydløs indånding.',
    },
  },
  AES: {
    id: 'AES',
    layer: 'larynx',
    color: '#facc15',
    shortLabel: 'AES · Twang Funnel',
    name: {
      en: 'Aryepiglottic Sphincter',
      da: 'Aryepiglottisk Sfinkter (Twang-tragt)',
    },
    action: {
      en: 'Narrows the epilaryngeal funnel above the folds, boosting 2.8–3.2 kHz acoustic ring and vocal efficiency.',
      da: 'Indsnævrer tragten over stemmelæberne (twang), hvilket forstærker 3 kHz-klang og bæreevne uden ekstra pres.',
    },
  },
  FVF: {
    id: 'FVF',
    layer: 'larynx',
    color: '#ef4444',
    shortLabel: 'FVF · False Folds',
    name: {
      en: 'Ventricular (False) Folds',
      da: 'De Falske Stemmelæber',
    },
    action: {
      en: 'Supraglottic folds above the ventricle: add controlled subharmonic grit/growl, or constrict painfully during strain.',
      da: 'Folder over de ægte stemmelæber: skaber kontrolleret grit/growl, eller klemmer uønsket sammen ved hæshed og pres.',
    },
  },
  INF: {
    id: 'INF',
    layer: 'extrinsic',
    color: '#60a5fa',
    shortLabel: 'INF · Larynx Anchor',
    name: {
      en: 'Infrahyoid Strap Depressors',
      da: 'Infrahyoide Sænkere (Strube-anker)',
    },
    action: {
      en: 'Sternothyroid, sternohyoid & omohyoid stabilize or gently lower the larynx for warmth, cry/sob, and open throat.',
      da: 'Stabiliserer eller sænker struben let for varm klang, åben hals og cry/sob uden at synke tungen.',
    },
  },
  SUP: {
    id: 'SUP',
    layer: 'extrinsic',
    color: '#fb923c',
    shortLabel: 'SUP · Larynx Elevators / Jaw',
    name: {
      en: 'Suprahyoid Elevators & Jaw Closers',
      da: 'Suprahyoide Hævere & Kæbespænding',
    },
    action: {
      en: 'Digastric, stylohyoid, mylohyoid & masseter: mild lift brightens tone; excess recruitment hikes the larynx and causes strain.',
      da: 'Let løft lysner klangen, men overaktivitet trækker struben højt op, låser kæben og skaber spænding.',
    },
  },
  VEL: {
    id: 'VEL',
    layer: 'tract',
    color: '#a78bfa',
    shortLabel: 'VEL · Soft Palate & Tract',
    name: {
      en: 'Levator Veli Palatini & Tongue Shaping',
      da: 'Bløde Gane & Vokalformning',
    },
    action: {
      en: 'Lifts the soft palate to seal the nasal port and coordinates tongue-dorsum vowel tuning across the passaggio.',
      da: 'Løfter den bløde gane og former tungeryggen til vokalmodifikation gennem overgangsområdet (passaggio).',
    },
  },
  DIA: {
    id: 'DIA',
    layer: 'breath',
    color: '#34d399',
    shortLabel: 'DIA · Diaphragm Dome',
    name: {
      en: 'Thoracic Diaphragm',
      da: 'Mellemgulvet (Diafragma)',
    },
    action: {
      en: 'Contracts downward to draw air into the lower lungs on inhalation; releases smoothly upward against abdominal metering.',
      da: 'Trækker sig nedad ved indånding og giver jævnt efter opad mod mavestøtten under selve frasen.',
    },
  },
  APP: {
    id: 'APP',
    layer: 'breath',
    color: '#10b981',
    shortLabel: 'APP · Appoggio Support',
    name: {
      en: 'Intercostal Rib Hold & Abdominal Metering',
      da: 'Ribben-hold & Mavestøtte (Appoggio)',
    },
    action: {
      en: 'External intercostals keep the rib cage buoyant while transversus & obliques meter steady subglottal air pressure.',
      da: 'Holder brystkassen udvidet mens de dybe mavemuskler doserer et jævnt lufttryk under stemmelæberne.',
    },
  },
};

export interface TimelineKeyframe {
  tNorm: number; // 0.0 .. 1.0
  phase: Record<Lang, string>;
  channels: ChannelVector;
  f0Hz: number;
  vowel: VowelId;
  jawOpen: number; // 0.0 .. 1.0
  jawJut?: number; // 0.0 .. 1.0 (anterior mandible protrusion in strain)
  clavicularHeave?: number; // 0.0 .. 1.0 (upper chest heave in poor breathing)
}

export interface TechniqueTrajectory {
  id: string;
  kind: 'technique' | 'cvt' | 'warmup' | 'myth';
  title: Record<Lang, string>;
  defaultCamera: CameraPresetId;
  defaultLayers: Record<LayerId, number>;
  durationSec: number;
  summary: Record<Lang, string>;
  strainSummary: Record<Lang, string>;
  healthy: TimelineKeyframe[];
  strain: TimelineKeyframe[];
}

export interface RigLandmarks {
  anteriorCommissure: [number, number, number];
  rightVocalProcess: [number, number, number];
  leftVocalProcess: [number, number, number];
  rightMuscularProcess: [number, number, number];
  leftMuscularProcess: [number, number, number];
  cricothyroidPivot: [number, number, number];
  rightCricoarytenoidPivot: [number, number, number];
  leftCricoarytenoidPivot: [number, number, number];
  epiglottisPetiole: [number, number, number];
  tmjPivot: [number, number, number];
  velumHinge: [number, number, number];
  diaphragmApex: [number, number, number];
  restingFoldLengthMm: number;
}

export interface KinematicFrame {
  tNorm: number;
  phaseLabel: Record<Lang, string>;
  channels: ChannelVector;
  f0Hz: number;
  vowel: VowelId;
  jawOpen: number;
  jawJut: number;
  clavicularHeave: number;
  // Derived 3D laryngeal & tract mechanics
  larynxShiftCm: number;
  ctTiltRad: number;
  ctGlideCm: number;
  caRotateRad: number; // + = abduction (open), - = adduction (close)
  iaSlideCm: number; // medial approximation of arytenoids
  foldLengthMm: number;
  foldElongationPct: number;
  foldThicknessMm: number;
  activeLengthFraction: number;
  liveAnteriorCommissure: [number, number, number];
  liveRightVocalProcess: [number, number, number];
  liveLeftVocalProcess: [number, number, number];
  membranousGapMm: number;
  posteriorChinkMm: number;
  closedQuotient: number;
  mucosalWaveAmpMm: number;
  verticalPhaseLagRad: number;
  dicroticFry: number;
  aesNarrowing: number;
  falseFoldGapMm: number;
  falseFoldOscillationMm: number;
  // Supraglottal & Breath mechanics
  jawAngleRad: number;
  velumLiftCm: number;
  tongueArchCm: number;
  tongueFrontCm: number;
  diaphragmDescentCm: number;
  ribExpansion: number;
  abdominalTone: number;
  subglottalPressureKpa: number;
  airflowLps: number; // negative = inhalation, positive = exhalation/phonation
  strainIndex: number; // 0 .. 1
  formantsHz: [number, number, number, number];
}

export interface GlottalCycleSample {
  phiRad: number;
  glottalAreaMm2: number;
  contactQuotientInstant: number;
  inferiorHalfGapMm: number;
  superiorHalfGapMm: number;
  falseFoldHalfGapMm: number;
  jetVelocityMps: number;
}
