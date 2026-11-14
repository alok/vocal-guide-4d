import './styles.css';
import guideJson from './data/vocalGuideData.json';
import rigJson from './data/anatomyRig.json';
import {
  CHANNEL_META,
  CHANNEL_ORDER,
  type CameraPresetId,
  type ChannelId,
  type ChannelVector,
  type KinematicFrame,
  type Lang,
  type LayerId,
  type RigLandmarks,
} from './biomechanics/types';
import {
  interpolateKeyframes,
  solveKinematics,
} from './biomechanics/kinematics';
import {
  MYTH_SIM_LINKS,
  TECHNIQUE_TRAJECTORIES,
} from './biomechanics/trajectories';
import { AnatomyStage, type StructureInfo } from './scene/AnatomyStage';
import { CoronalHud } from './ui/CoronalHud';
import { VocalSynth, hzToNoteLabel } from './audio/vocalSynth';

type NavTab = 'techniques' | 'cvt' | 'warmup' | 'myths' | 'beginner';

const UI_STRINGS = {
  en: {
    tabs: {
      techniques: '21 Techniques',
      cvt: 'CVT 4 Modes',
      warmup: 'Warm-Up Coach',
      myths: '10 Vocal Myths',
      beginner: 'Beginner & Anatomy',
    },
    audioOff: '🔇 Hear 3+1D Off',
    audioOn: '🔊 Hearing 3+1D',
    healthy: '✓ Healthy',
    strain: '⚠ Strain Fault',
    cameras: {
      laryngoscope: 'Laryngoscope',
      'larynx-3d': 'Larynx 3D',
      'sagittal-tract': 'Sagittal Tract',
      'breath-appoggio': 'Breath Appoggio',
    },
    xray: 'X-Ray Shield',
    macroLabel: 'Macro t',
    microLabel: 'Strobe φ',
    strobeAuto: 'Auto Strobe',
    strobeManual: 'Manual Scrub',
    sandboxActive: 'Manual Muscle Sandbox Active',
    resetTrajectory: '↺ Resume Trajectory',
    searchPlaceholder: 'Search 21 techniques, artists, or sensations…',
    allCategories: 'All (21)',
    prereqLabel: 'Prerequisites:',
    artistsLabel: 'Examples:',
    proveIn3d: 'Load in 3+1D →',
    startWarmup: '▶ Start 5-Min Guided Timer',
    stopWarmup: '⏸ Pause Timer',
    nextStep: 'Skip Step →',
  },
  da: {
    tabs: {
      techniques: '21 Teknikker',
      cvt: 'CVT 4 Modes',
      warmup: 'Opvarmnings-Coach',
      myths: '10 Vokale Myter',
      beginner: 'Begynder & Anatomi',
    },
    audioOff: '🔇 Lyd Fra',
    audioOn: '🔊 Hør 3+1D',
    healthy: '✓ Sund teknik',
    strain: '⚠ Fejl / Pres',
    cameras: {
      laryngoscope: 'Laryngoskop',
      'larynx-3d': 'Strube 3D',
      'sagittal-tract': 'Vokaltrakt',
      'breath-appoggio': 'Åndedræt',
    },
    xray: 'Røntgen-snit',
    macroLabel: 'Makro t',
    microLabel: 'Strobe φ',
    strobeAuto: 'Auto Strobe',
    strobeManual: 'Manuel fase',
    sandboxActive: 'Manuel muskel-sandbox aktiv',
    resetTrajectory: '↺ Genoptag kurve',
    searchPlaceholder: 'Søg blandt 21 teknikker, kunstnere eller klang…',
    allCategories: 'Alle (21)',
    prereqLabel: 'Forudsætninger:',
    artistsLabel: 'Eksempler:',
    proveIn3d: 'Vis i 3+1D →',
    startWarmup: '▶ Start 5-min guidet opvarmning',
    stopWarmup: '⏸ Pause timer',
    nextStep: 'Næste øvelse →',
  },
} as const;

const WARMUP_STEPS = [
  { id: 'warmup-sss', seconds: 60 },
  { id: 'warmup-lip-trills', seconds: 60 },
  { id: 'warmup-humming', seconds: 60 },
  { id: 'warmup-vowel-slides', seconds: 60 },
  { id: 'warmup-sirens', seconds: 60 },
] as const;

class VocalGuideStudioApp {
  private readonly root: HTMLElement;
  private readonly landmarks = rigJson.landmarks as unknown as RigLandmarks;
  private readonly synth = new VocalSynth();

  private stage!: AnatomyStage;
  private coronalHud!: CoronalHud;

  // Interactive UI state
  private lang: Lang = 'en';
  private theme: 'dark' | 'light' = 'dark';
  private activeTab: NavTab = 'techniques';
  private selectedCategory = 'all';
  private searchQuery = '';
  private activeTrajectoryId = 'mixed-voice';
  private variantMode: 'healthy' | 'strain' = 'healthy';

  // Dual-timescale simulation clock
  private playing = true;
  private speed = 1.0;
  private tNorm = 0.0;
  private strobeAuto = true;
  private strobeRateHz = 2.2;
  private phiRad = 0.0;
  private manualOverride: ChannelVector | null = null;
  private manualF0Hz = 293.7;
  private showChannels = true;

  // Warm-up coach countdown state
  private warmupRunning = false;
  private warmupStepIndex = 0;
  private warmupRemainingSec = 60;

  // Cached DOM handles for 60 FPS telemetry updates
  private domPlayBtn!: HTMLButtonElement;
  private domPhaseBadge!: HTMLElement;
  private domStrainBadge!: HTMLElement;
  private domMacroRange!: HTMLInputElement;
  private domMacroTime!: HTMLElement;
  private domMicroRange!: HTMLInputElement;
  private domMicroDeg!: HTMLElement;
  private domInspector!: HTMLElement;
  private domChannelSliders = new Map<ChannelId, HTMLInputElement>();
  private domChannelVals = new Map<ChannelId, HTMLElement>();
  private domGuidePane!: HTMLElement;

  private lastFrameTime = performance.now();
  private latestFrame!: KinematicFrame;

  constructor(root: HTMLElement) {
    this.root = root;

    // Support URL hash deep-linking (e.g. #belting or #tech-belting)
    const rawHash = window.location.hash.replace(/^#/, '').replace(/^tech-/, '');
    if (rawHash && TECHNIQUE_TRAJECTORIES[rawHash]) {
      this.activeTrajectoryId = rawHash;
      if (rawHash.startsWith('cvt-')) this.activeTab = 'cvt';
      else if (rawHash.startsWith('warmup-')) this.activeTab = 'warmup';
    }

    this.buildShell();
    this.selectTrajectory(this.activeTrajectoryId, true);
    void this.stage.loadAnatomyGlb('models/vocal-anatomy.glb');

    requestAnimationFrame((now) => this.tick(now));
  }

  private buildShell(): void {
    this.root.innerHTML = `
      <div class="studio-shell">
        <header class="topbar" id="topbar"></header>
        <div class="workspace-grid">
          <main class="guide-pane" id="guidePane"></main>
          <aside class="stage-pane">
            <div class="viewport-wrap" id="viewportWrap">
              <div class="stage-hud-top" id="stageHudTop"></div>
              <div class="inspector-toast" id="inspectorToast" hidden></div>
              <div class="layer-strip" id="layerStrip"></div>
              <div class="coronal-card">
                <canvas id="coronalCanvas" aria-label="Coronal vocal fold cross-section and glottal area HUD"></canvas>
              </div>
            </div>
            <section class="transport-dock" id="transportDock"></section>
          </aside>
        </div>
      </div>
    `;

    this.domGuidePane = this.root.querySelector('#guidePane') as HTMLElement;
    this.domInspector = this.root.querySelector('#inspectorToast') as HTMLElement;

    const viewportWrap = this.root.querySelector('#viewportWrap') as HTMLElement;
    this.stage = new AnatomyStage(viewportWrap, (info, pinned) =>
      this.renderInspector(info, pinned),
    );

    const coronalCanvas = this.root.querySelector(
      '#coronalCanvas',
    ) as HTMLCanvasElement;
    this.coronalHud = new CoronalHud(coronalCanvas);

    this.renderTopbar();
    this.renderStageHud();
    this.renderLayerStrip();
    this.renderTransportDock();
    this.renderGuidePane();
  }

  private renderTopbar(): void {
    const s = UI_STRINGS[this.lang];
    const topbar = this.root.querySelector('#topbar') as HTMLElement;
    topbar.innerHTML = `
      <div class="brand">
        <h1 class="brand-title">Vocal Guide</h1>
        <span class="brand-badge">3+1D Biomechanics</span>
      </div>
      <nav class="nav-tabs" aria-label="Primary sections">
        ${(['techniques', 'cvt', 'warmup', 'myths', 'beginner'] as NavTab[])
          .map(
            (tab) => `
          <button class="nav-tab ${this.activeTab === tab ? 'active' : ''}" data-tab="${tab}">
            ${s.tabs[tab]}
          </button>`,
          )
          .join('')}
      </nav>
      <div class="topbar-actions">
        <button class="pill-btn ${this.synth.isEnabled() ? 'audio-on' : ''}" id="audioBtn">
          ${this.synth.isEnabled() ? s.audioOn : s.audioOff}
        </button>
        <button class="pill-btn" id="langBtn" title="Switch English / Dansk">
          ${this.lang === 'en' ? 'EN · DA' : 'DA · EN'}
        </button>
        <button class="pill-btn" id="themeBtn" title="Toggle Dark / Light Theme">
          ${this.theme === 'dark' ? '☀' : '☾'}
        </button>
        <a class="pill-btn" href="https://github.com/alok/vocal-guide-4d" target="_blank" rel="noopener">
          GitHub ↗
        </a>
      </div>
    `;

    topbar.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.tab as NavTab;
        if (this.activeTab === 'cvt' && !this.activeTrajectoryId.startsWith('cvt-')) {
          this.selectTrajectory('cvt-neutral', false);
        } else if (
          this.activeTab === 'warmup' &&
          !this.activeTrajectoryId.startsWith('warmup-')
        ) {
          this.selectTrajectory(WARMUP_STEPS[this.warmupStepIndex].id, false);
        } else if (
          this.activeTab === 'techniques' &&
          (this.activeTrajectoryId.startsWith('cvt-') ||
            this.activeTrajectoryId.startsWith('warmup-'))
        ) {
          this.selectTrajectory('mixed-voice', false);
        }
        this.renderTopbar();
        this.renderGuidePane();
      });
    });

    topbar.querySelector('#audioBtn')?.addEventListener('click', async () => {
      await this.synth.setEnabled(!this.synth.isEnabled());
      this.renderTopbar();
    });

    topbar.querySelector('#langBtn')?.addEventListener('click', () => {
      this.lang = this.lang === 'en' ? 'da' : 'en';
      document.documentElement.lang = this.lang;
      this.renderTopbar();
      this.renderStageHud();
      this.renderTransportDock();
      this.renderGuidePane();
    });

    topbar.querySelector('#themeBtn')?.addEventListener('click', () => {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = this.theme;
      this.renderTopbar();
    });
  }

  private renderStageHud(): void {
    const s = UI_STRINGS[this.lang];
    const hud = this.root.querySelector('#stageHudTop') as HTMLElement;
    const cam = this.stage.getCameraPreset();

    hud.innerHTML = `
      <div class="hud-cluster" role="group" aria-label="Camera presets">
        ${(
          [
            'laryngoscope',
            'larynx-3d',
            'sagittal-tract',
            'breath-appoggio',
          ] as CameraPresetId[]
        )
          .map(
            (id) => `
          <button class="hud-btn ${cam === id ? 'active' : ''}" data-cam="${id}">
            ${s.cameras[id]}
          </button>`,
          )
          .join('')}
        <button class="hud-btn ${this.stage.isXrayShield() ? 'active' : ''}" id="xrayBtn">
          ${s.xray}
        </button>
      </div>
      <div class="ab-toggle" role="group" aria-label="Healthy vs Strain mode">
        <button class="ab-opt healthy ${this.variantMode === 'healthy' ? 'active' : ''}" data-variant="healthy">
          ${s.healthy}
        </button>
        <button class="ab-opt strain ${this.variantMode === 'strain' ? 'active' : ''}" data-variant="strain">
          ${s.strain}
        </button>
      </div>
    `;

    hud.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.cam as CameraPresetId;
        if (preset === 'breath-appoggio') {
          const ops = this.stage.getLayerOpacities();
          this.stage.setLayerOpacities({ ...ops, breath: Math.max(0.92, ops.breath) });
          this.renderLayerStrip();
        } else if (preset === 'sagittal-tract') {
          const ops = this.stage.getLayerOpacities();
          this.stage.setLayerOpacities({ ...ops, tract: Math.max(0.9, ops.tract) });
          this.renderLayerStrip();
        }
        this.stage.setCameraPreset(preset, false);
        this.renderStageHud();
      });
    });

    hud.querySelector('#xrayBtn')?.addEventListener('click', () => {
      this.stage.setXrayShield(!this.stage.isXrayShield());
      this.renderStageHud();
    });

    hud.querySelectorAll<HTMLButtonElement>('[data-variant]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.variantMode = btn.dataset.variant as 'healthy' | 'strain';
        this.manualOverride = null;
        this.renderStageHud();
        this.renderTransportDock();
        this.renderGuidePane();
      });
    });
  }

  private renderLayerStrip(): void {
    const strip = this.root.querySelector('#layerStrip') as HTMLElement;
    const ops = this.stage.getLayerOpacities();
    const labels: Record<LayerId, string> = {
      larynx: 'Larynx',
      extrinsic: 'Extrinsic',
      tract: 'Tract',
      breath: 'Breath',
    };

    strip.innerHTML = (['larynx', 'extrinsic', 'tract', 'breath'] as LayerId[])
      .map(
        (layer) => `
        <label class="layer-row">
          <span>${labels[layer]}</span>
          <input type="range" min="0" max="100" value="${Math.round(ops[layer] * 100)}" data-layer="${layer}" />
        </label>`,
      )
      .join('');

    strip.querySelectorAll<HTMLInputElement>('[data-layer]').forEach((input) => {
      input.addEventListener('input', () => {
        const layer = input.dataset.layer as LayerId;
        const next = { ...this.stage.getLayerOpacities(), [layer]: Number(input.value) / 100 };
        this.stage.setLayerOpacities(next);
      });
    });
  }

  private renderTransportDock(): void {
    const s = UI_STRINGS[this.lang];
    const dock = this.root.querySelector('#transportDock') as HTMLElement;
    this.domChannelSliders.clear();
    this.domChannelVals.clear();

    dock.innerHTML = `
      <div class="timeline-row">
        <button class="play-btn" id="playPauseBtn">${this.playing ? '⏸ Pause' : '▶ Play'}</button>
        <span class="phase-Readout" id="phaseBadge">—</span>
        <select class="mini-select" id="speedSelect" aria-label="Playback speed">
          ${[0.25, 0.5, 1.0, 1.5]
            .map(
              (sp) =>
                `<option value="${sp}" ${this.speed === sp ? 'selected' : ''}>${sp}× speed</option>`,
            )
            .join('')}
        </select>
        ${
          this.manualOverride
            ? `<button class="hud-btn active" id="resetManualBtn">${s.resetTrajectory}</button>`
            : ''
        }
        <span class="strain-meter ok" id="strainBadge">Strain 0%</span>
      </div>

      <div class="scrubber-wrap">
        <label for="macroRange">${s.macroLabel} <span id="macroTime">0.0s</span></label>
        <input type="range" id="macroRange" min="0" max="1000" value="${Math.round(this.tNorm * 1000)}" />
        <button class="hud-btn" id="toggleChannelsBtn">${this.showChannels ? '▾ 12 Muscles' : '▸ 12 Muscles'}</button>
      </div>

      <div class="scrubber-wrap micro">
        <label for="microRange">${s.microLabel} <span id="microDeg">0°</span></label>
        <input type="range" id="microRange" min="0" max="360" value="${Math.round(((this.phiRad * 180) / Math.PI) % 360)}" />
        <button class="hud-btn ${this.strobeAuto ? 'active' : ''}" id="strobeModeBtn">
          ${this.strobeAuto ? s.strobeAuto : s.strobeManual}
        </button>
      </div>

      <div id="channelsDrawer" ${this.showChannels ? '' : 'hidden'}>
        <div class="channels-grid">
          ${CHANNEL_ORDER.map((chId) => {
            const meta = CHANNEL_META[chId];
            return `
              <div class="ch-cell" title="${meta.name[this.lang]} — ${meta.action[this.lang]}">
                <div class="ch-top">
                  <span style="color:${meta.color};font-weight:700">${meta.shortLabel}</span>
                  <span data-ch-val="${chId}">0%</span>
                </div>
                <input type="range" min="0" max="100" value="0" data-ch-slider="${chId}" style="accent-color:${meta.color}" />
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    this.domPlayBtn = dock.querySelector('#playPauseBtn') as HTMLButtonElement;
    this.domPhaseBadge = dock.querySelector('#phaseBadge') as HTMLElement;
    this.domStrainBadge = dock.querySelector('#strainBadge') as HTMLElement;
    this.domMacroRange = dock.querySelector('#macroRange') as HTMLInputElement;
    this.domMacroTime = dock.querySelector('#macroTime') as HTMLElement;
    this.domMicroRange = dock.querySelector('#microRange') as HTMLInputElement;
    this.domMicroDeg = dock.querySelector('#microDeg') as HTMLElement;

    this.domPlayBtn.addEventListener('click', () => {
      this.playing = !this.playing;
      this.domPlayBtn.textContent = this.playing ? '⏸ Pause' : '▶ Play';
    });

    dock.querySelector('#speedSelect')?.addEventListener('change', (ev) => {
      this.speed = Number((ev.target as HTMLSelectElement).value);
    });

    this.domMacroRange.addEventListener('input', () => {
      this.manualOverride = null;
      this.tNorm = Number(this.domMacroRange.value) / 1000;
    });

    this.domMicroRange.addEventListener('input', () => {
      this.strobeAuto = false;
      this.phiRad = (Number(this.domMicroRange.value) * Math.PI) / 180;
      this.renderTransportDock();
    });

    dock.querySelector('#strobeModeBtn')?.addEventListener('click', () => {
      this.strobeAuto = !this.strobeAuto;
      this.renderTransportDock();
    });

    dock.querySelector('#toggleChannelsBtn')?.addEventListener('click', () => {
      this.showChannels = !this.showChannels;
      this.renderTransportDock();
    });

    dock.querySelector('#resetManualBtn')?.addEventListener('click', () => {
      this.manualOverride = null;
      this.renderTransportDock();
    });

    dock.querySelectorAll<HTMLInputElement>('[data-ch-slider]').forEach((slider) => {
      const chId = slider.dataset.chSlider as ChannelId;
      this.domChannelSliders.set(chId, slider);
      slider.addEventListener('input', () => {
        if (!this.manualOverride && this.latestFrame) {
          this.manualOverride = { ...this.latestFrame.channels };
          this.manualF0Hz = this.latestFrame.f0Hz > 30 ? this.latestFrame.f0Hz : 240;
          this.renderTransportDock();
          const reSlider = this.domChannelSliders.get(chId);
          if (reSlider) reSlider.value = slider.value;
        }
        if (this.manualOverride) {
          this.manualOverride[chId] = Number(slider.value) / 100;
          if (chId === 'CT') {
            this.manualF0Hz = 130 * Math.pow(2, this.manualOverride.CT * 2.4);
          }
        }
      });
    });

    dock.querySelectorAll<HTMLElement>('[data-ch-val]').forEach((el) => {
      this.domChannelVals.set(el.dataset.chVal as ChannelId, el);
    });
  }

  private renderInspector(info: StructureInfo | null, pinned: boolean): void {
    if (!info) {
      this.domInspector.hidden = true;
      return;
    }
    const actPct =
      info.channel && this.latestFrame
        ? ` · ${info.channel} ${Math.round(this.latestFrame.channels[info.channel] * 100)}%`
        : '';
    this.domInspector.hidden = false;
    this.domInspector.innerHTML = `
      <strong>${info.name} ${pinned ? '📌' : ''}</strong>
      <div class="inspector-meta">${info.fma} · ${info.layer.toUpperCase()}${actPct}</div>
      <div>${info.role}</div>
    `;
  }

  private selectTrajectory(id: string, instantCam = false): void {
    const traj = TECHNIQUE_TRAJECTORIES[id];
    if (!traj) return;
    this.activeTrajectoryId = id;
    this.manualOverride = null;
    this.tNorm = 0.0;
    this.stage.setLayerOpacities(traj.defaultLayers);
    this.stage.setCameraPreset(traj.defaultCamera, instantCam);
    window.history.replaceState(null, '', `#${id}`);

    this.renderStageHud();
    this.renderLayerStrip();
    this.renderTransportDock();
    this.renderGuidePane();
  }

  private renderGuidePane(): void {
    if (this.activeTab === 'techniques') {
      this.renderTechniquesTab();
    } else if (this.activeTab === 'cvt') {
      this.renderCvtTab();
    } else if (this.activeTab === 'warmup') {
      this.renderWarmupTab();
    } else if (this.activeTab === 'myths') {
      this.renderMythsTab();
    } else {
      this.renderBeginnerAnatomyTab();
    }
  }

  private renderSpotlightHtml(): string {
    const traj = TECHNIQUE_TRAJECTORIES[this.activeTrajectoryId];
    const tech = guideJson.techniques.find((t) => t.slug === this.activeTrajectoryId);
    const s = UI_STRINGS[this.lang];

    const bioText =
      this.variantMode === 'healthy'
        ? traj.summary[this.lang]
        : traj.strainSummary[this.lang];

    if (!tech) {
      return `
        <section class="spotlight-card">
          <div class="spotlight-kicker">
            <span>3+1D ACTIVE SIMULATION</span>
            <span>${traj.durationSec.toFixed(1)}s loop</span>
          </div>
          <h2>${traj.title[this.lang]}</h2>
          <div class="bio-callout ${this.variantMode === 'strain' ? 'strain-mode' : ''}">
            <strong>${this.variantMode === 'healthy' ? '3+1D Biomechanics:' : 'Strain Mechanism:'}</strong>
            ${bioText}
          </div>
        </section>
      `;
    }

    const how = tech.howTo[this.lang];
    const diffDots =
      '●'.repeat(tech.difficulty) + '○'.repeat(Math.max(0, 5 - tech.difficulty));

    return `
      <section class="spotlight-card">
        <div class="spotlight-kicker">
          <span>${tech.category.toUpperCase()} · DIFFICULTY ${diffDots}</span>
          <span>3+1D · ${traj.durationSec.toFixed(1)}s</span>
        </div>
        <h2>${tech.name}</h2>
        <p style="margin:0 0 8px;color:var(--text-secondary)">${tech.description[this.lang]}</p>

        <div class="bio-callout ${this.variantMode === 'strain' ? 'strain-mode' : ''}">
          <strong>${this.variantMode === 'healthy' ? '3+1D Muscle Choreography:' : '⚠ Vocal Strain Comparison:'}</strong>
          ${bioText}
        </div>

        <div class="detail-meta-row">
          <span class="meta-chip"><strong>Character:</strong> ${tech.character[this.lang]}</span>
          <span class="meta-chip"><strong>${s.artistsLabel}</strong> ${tech.examples}</span>
        </div>

        ${
          tech.prerequisites.length > 0
            ? `<div class="detail-meta-row">
                <span style="font-size:0.76rem;color:var(--text-muted);align-self:center">${s.prereqLabel}</span>
                ${tech.prerequisites
                  .map(
                    (p) =>
                      `<button class="prereq-btn" data-select-tech="${p.slug}">${p.name} →</button>`,
                  )
                  .join('')}
              </div>`
            : ''
        }

        <div class="how-box">
          ${how.headline ? `<p style="margin:0 0 6px;color:var(--text)"><strong>${how.headline}</strong></p>` : ''}
          <p style="margin:0">${how.body}</p>
          ${
            how.exercises.length > 0
              ? `<div class="exercise-list">
                  ${how.exercises.map((ex) => `<span class="exercise-pill">${ex}</span>`).join('')}
                </div>`
              : ''
          }
          ${how.cvtNote ? `<div class="cvt-box"><strong>CVT:</strong> ${how.cvtNote}</div>` : ''}
          ${how.warnings.map((w) => `<div class="warn-box">${w}</div>`).join('')}
          ${
            tech.resources.length > 0
              ? `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
                  ${tech.resources
                    .map(
                      (r) =>
                        `<a class="pill-btn" href="${r.url}" target="_blank" rel="noopener">▶ ${r.label} ↗</a>`,
                    )
                    .join('')}
                </div>`
              : ''
          }
        </div>
      </section>
    `;
  }

  private renderTechniquesTab(): void {
    const s = UI_STRINGS[this.lang];
    const q = this.searchQuery.trim().toLowerCase();

    const filtered = guideJson.techniques.filter((t) => {
      if (this.selectedCategory !== 'all' && t.category !== this.selectedCategory) {
        return false;
      }
      if (!q) return true;
      const hay = `${t.name} ${t.description[this.lang]} ${t.character[this.lang]} ${t.examples}`.toLowerCase();
      return hay.includes(q);
    });

    this.domGuidePane.innerHTML = `
      ${this.renderSpotlightHtml()}

      <div class="filter-bar">
        <input
          type="search"
          class="search-input"
          id="techSearchInput"
          placeholder="${s.searchPlaceholder}"
          value="${escapeAttr(this.searchQuery)}"
        />
        <div class="cat-pills">
          <button class="cat-pill ${this.selectedCategory === 'all' ? 'active' : ''}" data-cat="all">
            ${s.allCategories}
          </button>
          ${guideJson.categories
            .map(
              (c) => `
            <button class="cat-pill ${this.selectedCategory === c.slug ? 'active' : ''}" data-cat="${c.slug}">
              ${c.name[this.lang]}
            </button>`,
            )
            .join('')}
        </div>
      </div>

      <div class="tech-list">
        ${filtered
          .map((t) => {
            const dots =
              '●'.repeat(t.difficulty) + '○'.repeat(Math.max(0, 5 - t.difficulty));
            const selected = t.slug === this.activeTrajectoryId;
            return `
              <button class="tech-card ${selected ? 'selected' : ''}" data-select-tech="${t.slug}">
                <div class="tech-card-head">
                  <span class="tech-card-title">${t.name}</span>
                  <span class="diff-dots">${t.category.toUpperCase()} · ${dots}</span>
                </div>
                <div class="tech-card-desc">${t.description[this.lang]}</div>
                <div class="tech-card-artists">${t.examples}</div>
              </button>
            `;
          })
          .join('')}
      </div>

      ${this.renderFooterCredits()}
    `;

    const searchEl = this.domGuidePane.querySelector(
      '#techSearchInput',
    ) as HTMLInputElement;
    searchEl.addEventListener('input', () => {
      const pos = searchEl.selectionStart ?? searchEl.value.length;
      this.searchQuery = searchEl.value;
      this.renderTechniquesTab();
      const nextEl = this.domGuidePane.querySelector(
        '#techSearchInput',
      ) as HTMLInputElement;
      nextEl.focus();
      nextEl.setSelectionRange(pos, pos);
    });

    this.domGuidePane.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedCategory = btn.dataset.cat ?? 'all';
        this.renderTechniquesTab();
      });
    });

    this.bindSelectTechButtons();
  }

  private renderCvtTab(): void {
    const doc = guideJson.guides.cvt[this.lang];
    const cvtIds = ['cvt-neutral', 'cvt-curbing', 'cvt-overdrive', 'cvt-edge'];

    this.domGuidePane.innerHTML = `
      ${this.renderSpotlightHtml()}

      <div class="mode-grid">
        ${cvtIds
          .map((id) => {
            const tr = TECHNIQUE_TRAJECTORIES[id];
            return `
              <button class="tech-card ${this.activeTrajectoryId === id ? 'selected' : ''}" data-select-tech="${id}">
                <div class="tech-card-head">
                  <span class="tech-card-title">${tr.title[this.lang]}</span>
                  <span class="diff-dots">3+1D</span>
                </div>
                <div class="tech-card-desc">${tr.summary[this.lang]}</div>
              </button>
            `;
          })
          .join('')}
      </div>

      ${this.renderModalSections(doc.sections)}
      ${this.renderFooterCredits()}
    `;

    this.bindSelectTechButtons();
  }

  private renderWarmupTab(): void {
    const doc = guideJson.guides.warmup[this.lang];
    const s = UI_STRINGS[this.lang];
    const mins = Math.floor(this.warmupRemainingSec / 60);
    const secs = String(Math.floor(this.warmupRemainingSec % 60)).padStart(2, '0');

    this.domGuidePane.innerHTML = `
      <div class="warmup-timer-banner">
        <div>
          <div style="font-size:0.75rem;font-family:'JetBrains Mono',monospace;color:var(--accent)">
            STEP ${this.warmupStepIndex + 1} / ${WARMUP_STEPS.length}
          </div>
          <strong>${TECHNIQUE_TRAJECTORIES[WARMUP_STEPS[this.warmupStepIndex].id].title[this.lang]}</strong>
        </div>
        <div class="timer-digits" id="warmupTimerDigits">${mins}:${secs}</div>
        <div style="display:flex;gap:8px">
          <button class="pill-btn" id="warmupToggleBtn">
            ${this.warmupRunning ? s.stopWarmup : s.startWarmup}
          </button>
          <button class="pill-btn" id="warmupNextBtn">${s.nextStep}</button>
        </div>
      </div>

      <div class="tech-list" style="margin-bottom:16px">
        ${WARMUP_STEPS.map((st, idx) => {
          const tr = TECHNIQUE_TRAJECTORIES[st.id];
          return `
            <button class="tech-card ${this.activeTrajectoryId === st.id ? 'selected' : ''}" data-warmup-idx="${idx}">
              <div class="tech-card-head">
                <span class="tech-card-title">${tr.title[this.lang]}</span>
                <span class="diff-dots">60s · 3+1D</span>
              </div>
              <div class="tech-card-desc">${tr.summary[this.lang]}</div>
            </button>
          `;
        }).join('')}
      </div>

      ${this.renderModalSections(doc.sections)}
      ${this.renderFooterCredits()}
    `;

    this.domGuidePane.querySelector('#warmupToggleBtn')?.addEventListener('click', () => {
      this.warmupRunning = !this.warmupRunning;
      if (this.warmupRunning) {
        this.selectTrajectory(WARMUP_STEPS[this.warmupStepIndex].id, false);
      } else {
        this.renderWarmupTab();
      }
    });

    this.domGuidePane.querySelector('#warmupNextBtn')?.addEventListener('click', () => {
      this.warmupStepIndex = (this.warmupStepIndex + 1) % WARMUP_STEPS.length;
      this.warmupRemainingSec = WARMUP_STEPS[this.warmupStepIndex].seconds;
      this.selectTrajectory(WARMUP_STEPS[this.warmupStepIndex].id, false);
    });

    this.domGuidePane
      .querySelectorAll<HTMLButtonElement>('[data-warmup-idx]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          this.warmupStepIndex = Number(btn.dataset.warmupIdx);
          this.warmupRemainingSec = WARMUP_STEPS[this.warmupStepIndex].seconds;
          this.selectTrajectory(WARMUP_STEPS[this.warmupStepIndex].id, false);
        });
      });
  }

  private renderMythsTab(): void {
    const doc = guideJson.guides.myths[this.lang];
    const s = UI_STRINGS[this.lang];
    const introSec = doc.sections[0];
    const mythSections = doc.sections.slice(1);

    this.domGuidePane.innerHTML = `
      ${this.renderSpotlightHtml()}

      <div class="guide-section-card">
        <h3>${doc.title}</h3>
        ${introSec.paragraphs.map((p) => `<p>${p}</p>`).join('')}
      </div>

      ${mythSections
        .map((sec, idx) => {
          const link = MYTH_SIM_LINKS[idx];
          return `
            <div class="guide-section-card">
              <h3>${sec.heading}</h3>
              ${sec.paragraphs.map((p) => `<p>${p}</p>`).join('')}
              ${
                link
                  ? `<div class="bio-callout" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
                      <span>${link.caption[this.lang]}</span>
                      <button class="prereq-btn" data-myth-idx="${idx}">${s.proveIn3d}</button>
                    </div>`
                  : ''
              }
            </div>
          `;
        })
        .join('')}

      ${this.renderFooterCredits()}
    `;

    this.domGuidePane
      .querySelectorAll<HTMLButtonElement>('[data-myth-idx]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const link = MYTH_SIM_LINKS[Number(btn.dataset.mythIdx)];
          if (!link) return;
          this.variantMode = link.compareStrainFirst ? 'strain' : 'healthy';
          this.selectTrajectory(link.trajectoryId, false);
          this.stage.setCameraPreset(link.camera, false);
          this.renderStageHud();
        });
      });

    this.bindSelectTechButtons();
  }

  private renderBeginnerAnatomyTab(): void {
    const intro = guideJson.guides.intro[this.lang];
    const beg = guideJson.guides.beginner[this.lang];
    const anat = guideJson.guides.anatomy[this.lang];

    this.domGuidePane.innerHTML = `
      ${this.renderSpotlightHtml()}
      <h2 style="font-family:'Fraunces',serif;margin:8px 0 12px">${anat.title}</h2>
      ${this.renderModalSections(anat.sections)}
      <h2 style="font-family:'Fraunces',serif;margin:22px 0 12px">${beg.title}</h2>
      ${this.renderModalSections(beg.sections)}
      <h2 style="font-family:'Fraunces',serif;margin:22px 0 12px">${intro.title}</h2>
      ${this.renderModalSections(intro.sections)}
      ${this.renderFooterCredits()}
    `;

    this.bindSelectTechButtons();
  }

  private renderModalSections(
    sections: Array<{
      heading: string;
      paragraphs: string[];
      bullets?: string[];
      table?: { headers: string[]; rows: string[][] };
    }>,
  ): string {
    return sections
      .map(
        (sec) => `
        <div class="guide-section-card">
          ${sec.heading ? `<h3>${sec.heading}</h3>` : ''}
          ${sec.paragraphs.map((p) => `<p>${p}</p>`).join('')}
          ${
            sec.bullets
              ? `<ul>${sec.bullets.map((b) => `<li>${b}</li>`).join('')}</ul>`
              : ''
          }
          ${
            sec.table
              ? `<table class="cvt-table">
                  <thead>
                    <tr>${sec.table.headers.map((h) => `<th>${h}</th>`).join('')}</tr>
                  </thead>
                  <tbody>
                    ${sec.table.rows
                      .map(
                        (r) => `<tr>${r.map((cell) => `<td>${cell}</td>`).join('')}</tr>`,
                      )
                      .join('')}
                  </tbody>
                </table>`
              : ''
          }
        </div>`,
      )
      .join('');
  }

  private renderFooterCredits(): string {
    return `
      <footer class="footer-credits">
        <p>
          <strong>Credits & Open Licenses:</strong> Vocal technique reference adapted from
          <a href="https://jesperordrup.github.io/vocal-guide/" target="_blank" rel="noopener">Jesper Ordrup's Vocal Guide</a>
          (MIT License). 3D anatomical structures derived from
          <strong>BodyParts3D / Anatomography v4.3</strong> (© The Database Center for Life Science — DBCLS,
          <a href="models/ATTRIBUTION.md" target="_blank" rel="noopener">CC BY-SA 2.1 JP</a>).
        </p>
        <p>
          <strong>Pedagogical Scope:</strong> Muscle trajectories, parametric mucosal waves, and LF-formant audio synthesis represent peer-reviewed voice-science models (Titze, Hirano, Sadolin CVT) mapped onto static BodyParts3D geometry for vocal learning—not clinical stroboscopy or medical advice.
        </p>
      </footer>
    `;
  }

  private bindSelectTechButtons(): void {
    this.domGuidePane
      .querySelectorAll<HTMLButtonElement>('[data-select-tech]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const slug = btn.dataset.selectTech;
          if (slug && TECHNIQUE_TRAJECTORIES[slug]) {
            this.selectTrajectory(slug, false);
          }
        });
      });
  }

  private tick(now: number): void {
    const dtSec = Math.min(0.05, Math.max(0.001, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;

    const traj = TECHNIQUE_TRAJECTORIES[this.activeTrajectoryId];
    const keyframes =
      this.variantMode === 'healthy' ? traj.healthy : traj.strain;

    if (this.playing && !this.manualOverride) {
      this.tNorm = (this.tNorm + (dtSec * this.speed) / traj.durationSec) % 1.0;
      this.domMacroRange.value = String(Math.round(this.tNorm * 1000));
    }

    // Advance warm-up timer when active
    if (this.warmupRunning) {
      this.warmupRemainingSec -= dtSec;
      if (this.warmupRemainingSec <= 0) {
        this.warmupStepIndex = (this.warmupStepIndex + 1) % WARMUP_STEPS.length;
        this.warmupRemainingSec = WARMUP_STEPS[this.warmupStepIndex].seconds;
        this.selectTrajectory(WARMUP_STEPS[this.warmupStepIndex].id, false);
      } else if (this.activeTab === 'warmup') {
        const timerEl = this.domGuidePane.querySelector('#warmupTimerDigits');
        if (timerEl) {
          const m = Math.floor(this.warmupRemainingSec / 60);
          const s = String(Math.floor(this.warmupRemainingSec % 60)).padStart(2, '0');
          timerEl.textContent = `${m}:${s}`;
        }
      }
    }

    // Evaluate kinematic state
    let frame: KinematicFrame;
    if (this.manualOverride) {
      frame = solveKinematics(
        this.tNorm,
        {
          en: UI_STRINGS.en.sandboxActive,
          da: UI_STRINGS.da.sandboxActive,
        },
        this.manualOverride,
        this.manualF0Hz,
        'AA',
        0.44,
        0,
        0,
        this.landmarks,
      );
    } else {
      const interp = interpolateKeyframes(keyframes, this.tNorm);
      frame = solveKinematics(
        this.tNorm,
        interp.phaseLabel,
        interp.channels,
        interp.f0Hz,
        interp.vowel,
        interp.jawOpen,
        interp.jawJut,
        interp.clavicularHeave,
        this.landmarks,
      );
    }
    this.latestFrame = frame;

    // Advance stroboscopic micro-phase φ
    if (this.strobeAuto && this.playing) {
      const rate =
        frame.dicroticFry > 0.4
          ? 1.35
          : frame.mucosalWaveAmpMm > 0.02
            ? this.strobeRateHz * (0.75 + 0.45 * Math.min(1.5, frame.f0Hz / 300))
            : 0.4;
      this.phiRad = (this.phiRad + dtSec * rate * Math.PI * 2) % (Math.PI * 2);
      this.domMicroRange.value = String(
        Math.round(((this.phiRad * 180) / Math.PI) % 360),
      );
    }

    // Update DOM readouts efficiently
    this.domPhaseBadge.textContent = `${frame.phaseLabel[this.lang]} · ${hzToNoteLabel(frame.f0Hz)}`;
    this.domMacroTime.textContent = `${(this.tNorm * traj.durationSec).toFixed(1)}s`;
    this.domMicroDeg.textContent = `${Math.round(((this.phiRad * 180) / Math.PI) % 360)}°`;

    const strainPct = Math.round(frame.strainIndex * 100);
    this.domStrainBadge.textContent = `Strain ${strainPct}%`;
    this.domStrainBadge.className = `strain-meter ${strainPct > 45 ? 'warn' : 'ok'}`;

    if (this.showChannels) {
      for (const chId of CHANNEL_ORDER) {
        const pct = Math.round(frame.channels[chId] * 100);
        const valEl = this.domChannelVals.get(chId);
        if (valEl) valEl.textContent = `${pct}%`;
        if (!this.manualOverride) {
          const sl = this.domChannelSliders.get(chId);
          if (sl) sl.value = String(pct);
        }
      }
    }

    // Update 3D WebGL stage, 2D Coronal/EGG HUD, and Web Audio synthesizer
    this.stage.update(frame, this.phiRad, dtSec);
    this.coronalHud.render(frame, this.phiRad, this.lang);
    this.synth.update(frame, !this.playing && !this.manualOverride);

    requestAnimationFrame((nextNow) => this.tick(nextNow));
  }
}

function escapeAttr(val: string): string {
  return val.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

const appRoot = document.getElementById('app');
if (appRoot) {
  new VocalGuideStudioApp(appRoot);
}
