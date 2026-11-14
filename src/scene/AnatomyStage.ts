import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import rigJson from '../data/anatomyRig.json';
import {
  CHANNEL_META,
  type CameraPresetId,
  type ChannelId,
  type KinematicFrame,
  type LayerId,
  type RigLandmarks,
} from '../biomechanics/types';
import {
  clamp,
  evaluateMucosalHalfGapMm,
  sampleGlottalCycle,
} from '../biomechanics/kinematics';

export interface StructureInfo {
  id: string;
  name: string;
  layer: LayerId;
  kind: string;
  fma: string;
  channel: ChannelId | null;
  role: string;
  isParametric?: boolean;
}

interface ManagedMesh {
  info: StructureInfo;
  mesh: THREE.Mesh;
  material: THREE.MeshPhysicalMaterial;
  baseColor: THREE.Color;
  restPos: Float32Array;
  livePos: Float32Array;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
}

const CAMERA_PRESETS: Record<
  CameraPresetId,
  { pos: [number, number, number]; target: [number, number, number]; fov: number }
> = {
  laryngoscope: {
    pos: [0.0, 5.3, -1.55],
    target: [0.0, 0.02, -0.02],
    fov: 34,
  },
  'larynx-3d': {
    pos: [5.2, 2.0, 6.1],
    target: [0.0, 0.15, -0.15],
    fov: 36,
  },
  'sagittal-tract': {
    pos: [16.8, 4.1, 2.2],
    target: [0.0, 3.6, 0.6],
    fov: 36,
  },
  'breath-appoggio': {
    pos: [24.0, -9.5, 42.0],
    target: [0.0, -14.2, 0.0],
    fov: 38,
  },
};

const MUCOSAL_S_SEG = 26;
const MUCOSAL_V_SEG = 12;
const AIRFLOW_PARTICLE_COUNT = 220;

export class AnatomyStage {
  private readonly container: HTMLElement;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2(-99, -99);

  private readonly landmarks: RigLandmarks =
    rigJson.landmarks as unknown as RigLandmarks;
  private readonly managed = new Map<string, ManagedMesh>();
  private readonly pickables: THREE.Object3D[] = [];

  // Parametric deformable true mucosal cover & false folds
  private leftMucosaMesh!: THREE.Mesh;
  private rightMucosaMesh!: THREE.Mesh;
  private leftFalseFoldMesh!: THREE.Mesh;
  private rightFalseFoldMesh!: THREE.Mesh;
  private mucosaMat!: THREE.MeshPhysicalMaterial;
  private falseFoldMat!: THREE.MeshPhysicalMaterial;

  // 3D Airflow particle system
  private airflowPoints!: THREE.Points;
  private airflowSeeds!: Float32Array; // [phase01, radialAngle, radialFrac] per particle

  private layerOpacities: Record<LayerId, number> = {
    larynx: 1.0,
    extrinsic: 0.55,
    tract: 0.35,
    breath: 0.2,
  };
  private xrayShield = true;
  private activeCameraPreset: CameraPresetId = 'larynx-3d';
  private camAnimProgress = 1.0;
  private readonly camFromPos = new THREE.Vector3();
  private readonly camToPos = new THREE.Vector3();
  private readonly camFromTarget = new THREE.Vector3();
  private readonly camToTarget = new THREE.Vector3();

  private hoveredId: string | null = null;
  private selectedId: string | null = null;
  private readonly onInspect: (info: StructureInfo | null, pinned: boolean) => void;
  private resizeObserver: ResizeObserver;

  constructor(
    container: HTMLElement,
    onInspect: (info: StructureInfo | null, pinned: boolean) => void,
  ) {
    this.container = container;
    this.onInspect = onInspect;

    this.scene = new THREE.Scene();

    const w = Math.max(320, container.clientWidth);
    const h = Math.max(280, container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(36, w / h, 0.15, 220);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'anatomy-webgl-canvas';
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2.0;
    this.controls.maxDistance = 95.0;

    this.setupLights();
    this.buildParametricFolds();
    this.buildAirflowParticles();
    this.setCameraPreset('larynx-3d', true);
    this.bindPointerEvents();

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xf8fafc, 0x1e1b2e, 0.95);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff7ed, 1.55);
    key.position.set(16, 24, 26);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x38bdf8, 0.85);
    rim.position.set(-22, 12, -20);
    this.scene.add(rim);

    const laryngoSpot = new THREE.PointLight(0xfff1e6, 0.75, 18, 1.2);
    laryngoSpot.position.set(0, 4.5, 0.4);
    this.scene.add(laryngoSpot);
  }

  public async loadAnatomyGlb(url = 'models/vocal-anatomy.glb'): Promise<void> {
    const structMetaById = new Map<string, (typeof rigJson.structures)[number]>();
    for (const s of rigJson.structures) {
      structMetaById.set(s.id, s);
    }

    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);

    gltf.scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const meta = structMetaById.get(obj.name);
      if (!meta) return;

      const geom = obj.geometry as THREE.BufferGeometry;
      const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
      const restPos = new Float32Array(posAttr.array as Float32Array);
      const livePos = new Float32Array(restPos.length);
      livePos.set(restPos);

      const dynAttr = new THREE.BufferAttribute(livePos, 3);
      dynAttr.setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute('position', dynAttr);

      const baseColor = new THREE.Color(
        meta.baseColor[0],
        meta.baseColor[1],
        meta.baseColor[2],
      );
      const isSoftTissue = meta.kind === 'muscle' || meta.kind === 'organ';
      const material = new THREE.MeshPhysicalMaterial({
        color: baseColor.clone(),
        roughness: isSoftTissue ? 0.48 : 0.38,
        metalness: 0.03,
        clearcoat: meta.layer === 'larynx' ? 0.25 : 0.08,
        clearcoatRoughness: 0.35,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 1.0,
      });

      const mesh = new THREE.Mesh(geom, material);
      mesh.name = meta.id;
      mesh.renderOrder = meta.kind === 'bone' || meta.kind === 'cartilage' ? 2 : 1;

      const info: StructureInfo = {
        id: meta.id,
        name: meta.name,
        layer: meta.layer as LayerId,
        kind: meta.kind,
        fma: meta.fma,
        channel: (meta.channel as ChannelId | null) ?? null,
        role: meta.role,
      };
      mesh.userData.structureInfo = info;

      this.scene.add(mesh);
      this.pickables.push(mesh);
      this.managed.set(meta.id, {
        info,
        mesh,
        material,
        baseColor,
        restPos,
        livePos,
        boundsMin: meta.bounds.min as [number, number, number],
        boundsMax: meta.bounds.max as [number, number, number],
      });
    });

    this.applyOpacities();
  }

  private buildParametricFolds(): void {
    this.mucosaMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0xfbcfe8),
      emissive: new THREE.Color(0x4c1d24),
      emissiveIntensity: 0.22,
      roughness: 0.22,
      metalness: 0.02,
      clearcoat: 0.85,
      clearcoatRoughness: 0.16,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.98,
    });

    this.falseFoldMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0xe17c88),
      emissive: new THREE.Color(0x3b0d15),
      emissiveIntensity: 0.15,
      roughness: 0.34,
      metalness: 0.02,
      clearcoat: 0.55,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
    });

    const createRibbon = (
      sSeg: number,
      vSeg: number,
      mat: THREE.Material,
      info: StructureInfo,
    ): THREE.Mesh => {
      const vertCount = (sSeg + 1) * (vSeg + 1);
      const pos = new Float32Array(vertCount * 3);
      const indices: number[] = [];
      for (let i = 0; i < sSeg; i++) {
        for (let j = 0; j < vSeg; j++) {
          const a = i * (vSeg + 1) + j;
          const b = (i + 1) * (vSeg + 1) + j;
          const c = (i + 1) * (vSeg + 1) + (j + 1);
          const d = i * (vSeg + 1) + (j + 1);
          indices.push(a, b, d, b, c, d);
        }
      }
      const geom = new THREE.BufferGeometry();
      const attr = new THREE.BufferAttribute(pos, 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute('position', attr);
      geom.setIndex(indices);
      const m = new THREE.Mesh(geom, mat);
      m.name = info.id;
      m.userData.structureInfo = info;
      m.renderOrder = 3;
      this.scene.add(m);
      this.pickables.push(m);
      return m;
    };

    const mucosaRole =
      'Biomechanical mucosal cover spanning anterior thyroid commissure to arytenoid vocal process; carries the vertical phase-lagged mucosal wave.';
    this.leftMucosaMesh = createRibbon(
      MUCOSAL_S_SEG,
      MUCOSAL_V_SEG,
      this.mucosaMat,
      {
        id: 'left-mucosal-cover',
        name: 'Left True Vocal Fold (Mucosal Cover)',
        layer: 'larynx',
        kind: 'mucosa (parametric)',
        fma: 'FMA55422',
        channel: 'TA',
        role: mucosaRole,
        isParametric: true,
      },
    );
    this.rightMucosaMesh = createRibbon(
      MUCOSAL_S_SEG,
      MUCOSAL_V_SEG,
      this.mucosaMat,
      {
        id: 'right-mucosal-cover',
        name: 'Right True Vocal Fold (Mucosal Cover)',
        layer: 'larynx',
        kind: 'mucosa (parametric)',
        fma: 'FMA55421',
        channel: 'TA',
        role: mucosaRole,
        isParametric: true,
      },
    );

    const falseRole =
      'Ventricular (false) vocal fold superior to the laryngeal ventricle; stays wide open in clean singing, or oscillates/constricts in grit, overdrive, growl, and strain.';
    this.leftFalseFoldMesh = createRibbon(18, 6, this.falseFoldMat, {
      id: 'left-false-fold',
      name: 'Left Ventricular (False) Vocal Fold',
      layer: 'larynx',
      kind: 'mucosa (parametric)',
      fma: 'FMA55419',
      channel: 'FVF',
      role: falseRole,
      isParametric: true,
    });
    this.rightFalseFoldMesh = createRibbon(18, 6, this.falseFoldMat, {
      id: 'right-false-fold',
      name: 'Right Ventricular (False) Vocal Fold',
      layer: 'larynx',
      kind: 'mucosa (parametric)',
      fma: 'FMA55418',
      channel: 'FVF',
      role: falseRole,
      isParametric: true,
    });
  }

  private buildAirflowParticles(): void {
    const pos = new Float32Array(AIRFLOW_PARTICLE_COUNT * 3);
    const col = new Float32Array(AIRFLOW_PARTICLE_COUNT * 3);
    this.airflowSeeds = new Float32Array(AIRFLOW_PARTICLE_COUNT * 3);

    for (let i = 0; i < AIRFLOW_PARTICLE_COUNT; i++) {
      this.airflowSeeds[i * 3] = i / AIRFLOW_PARTICLE_COUNT;
      this.airflowSeeds[i * 3 + 1] = ((i * 2.39996) % (Math.PI * 2));
      this.airflowSeeds[i * 3 + 2] = 0.2 + 0.8 * ((i * 7) % 13) / 13;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.16,
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.airflowPoints = new THREE.Points(geom, mat);
    this.airflowPoints.renderOrder = 4;
    this.scene.add(this.airflowPoints);
  }

  public setCameraPreset(preset: CameraPresetId, instant = false): void {
    this.activeCameraPreset = preset;
    const cfg = CAMERA_PRESETS[preset];
    this.camera.fov = cfg.fov;
    this.camera.updateProjectionMatrix();

    if (instant) {
      this.camera.position.set(...cfg.pos);
      this.controls.target.set(...cfg.target);
      this.controls.update();
      this.camAnimProgress = 1.0;
    } else {
      this.camFromPos.copy(this.camera.position);
      this.camToPos.set(...cfg.pos);
      this.camFromTarget.copy(this.controls.target);
      this.camToTarget.set(...cfg.target);
      this.camAnimProgress = 0.0;
    }
    this.applyOpacities();
  }

  public getCameraPreset(): CameraPresetId {
    return this.activeCameraPreset;
  }

  public setLayerOpacities(opacities: Record<LayerId, number>): void {
    this.layerOpacities = { ...opacities };
    this.applyOpacities();
  }

  public getLayerOpacities(): Record<LayerId, number> {
    return { ...this.layerOpacities };
  }

  public setXrayShield(enabled: boolean): void {
    this.xrayShield = enabled;
    this.applyOpacities();
  }

  public isXrayShield(): boolean {
    return this.xrayShield;
  }

  private applyOpacities(): void {
    for (const [id, entry] of this.managed) {
      const layerAlpha = this.layerOpacities[entry.info.layer];
      let alpha = layerAlpha;

      // Keep outer shields artistically translucent so deeper muscles shine cleanly
      if (this.xrayShield) {
        if (id === 'thyroid-cartilage' || id === 'thyrohyoid-membrane') {
          alpha *= this.activeCameraPreset === 'laryngoscope' ? 0.25 : 0.42;
        } else if (id === 'thoracic-cage') {
          alpha *= 0.38;
        } else if (id === 'right-lung' || id === 'left-lung') {
          alpha *= 0.52;
        } else if (id === 'sternocleidomastoid') {
          alpha *= 0.35;
        }
      }

      // Unobstructed endoscopic line-of-sight in Laryngoscope view
      if (
        this.activeCameraPreset === 'laryngoscope' &&
        (entry.info.layer === 'tract' || id === 'hyoid-bone')
      ) {
        alpha *= 0.12;
      }

      // Sagittal window: soften outer jaw/constrictors slightly so inner tongue & velum stand out
      if (
        this.activeCameraPreset === 'sagittal-tract' &&
        (id === 'pharyngeal-constrictors' || id === 'masseter')
      ) {
        alpha *= 0.36;
      }

      alpha = clamp(alpha, 0, 1);
      entry.mesh.visible = alpha > 0.025;
      entry.material.opacity = alpha;
      entry.material.depthWrite = alpha > 0.78;
    }

    const larynxAlpha = this.layerOpacities.larynx;
    const showMucosa = larynxAlpha > 0.05;
    this.leftMucosaMesh.visible = showMucosa;
    this.rightMucosaMesh.visible = showMucosa;
    this.leftFalseFoldMesh.visible = showMucosa;
    this.rightFalseFoldMesh.visible = showMucosa;
    this.mucosaMat.opacity = clamp(larynxAlpha * 0.98, 0, 1);
    this.falseFoldMat.opacity = clamp(larynxAlpha * 0.86, 0, 1);
  }

  public update(frame: KinematicFrame, phiRad: number, dtSec: number): void {
    if (this.camAnimProgress < 1.0) {
      this.camAnimProgress = Math.min(1.0, this.camAnimProgress + dtSec * 2.8);
      const u =
        this.camAnimProgress *
        this.camAnimProgress *
        (3 - 2 * this.camAnimProgress);
      this.camera.position.lerpVectors(this.camFromPos, this.camToPos, u);
      this.controls.target.lerpVectors(this.camFromTarget, this.camToTarget, u);
    }
    this.controls.update();

    this.updateAnatomicalMeshes(frame);
    this.updateParametricFolds(frame, phiRad);
    this.updateAirflow(frame, phiRad, dtSec);

    this.renderer.render(this.scene, this.camera);
  }

  private updateAnatomicalMeshes(frame: KinematicFrame): void {
    const lm = this.landmarks;
    const ctPivot = lm.cricothyroidPivot;
    const lCaPivot = lm.leftCricoarytenoidPivot;
    const rCaPivot = lm.rightCricoarytenoidPivot;
    const epiPivot = lm.epiglottisPetiole;
    const tmjPivot = lm.tmjPivot;
    const velPivot = lm.velumHinge;

    const cCt = Math.cos(frame.ctTiltRad);
    const sCt = Math.sin(frame.ctTiltRad);

    // Medial adduction angle on left (+caAdduct) and right (-caAdduct)
    const caLeftAngle = -frame.caRotateRad;
    const cCaL = Math.cos(caLeftAngle);
    const sCaL = Math.sin(caLeftAngle);
    const cCaR = Math.cos(-caLeftAngle);
    const sCaR = Math.sin(-caLeftAngle);

    // Jaw rotation (mandible drops downward -Y and slightly back -Z around TMJ)
    const cJaw = Math.cos(-frame.jawAngleRad);
    const sJaw = Math.sin(-frame.jawAngleRad);
    const jawJutCm = frame.jawJut * 0.52;

    // Live endpoint deltas for vocal folds / vocalis / TA
    const dAntY = frame.liveAnteriorCommissure[1] - lm.anteriorCommissure[1];
    const dAntZ = frame.liveAnteriorCommissure[2] - lm.anteriorCommissure[2];
    const dLeftPostX = frame.liveLeftVocalProcess[0] - lm.leftVocalProcess[0];
    const dLeftPostY = frame.liveLeftVocalProcess[1] - lm.leftVocalProcess[1];
    const dLeftPostZ = frame.liveLeftVocalProcess[2] - lm.leftVocalProcess[2];
    const dRightPostX = frame.liveRightVocalProcess[0] - lm.rightVocalProcess[0];
    const dRightPostY = frame.liveRightVocalProcess[1] - lm.rightVocalProcess[1];
    const dRightPostZ = frame.liveRightVocalProcess[2] - lm.rightVocalProcess[2];

    for (const [id, entry] of this.managed) {
      if (!entry.mesh.visible) continue;

      // 1. Update activation heatmap & hover/selection highlight
      this.tintMaterial(id, entry, frame);

      // 2. Deform vertices from restPos -> livePos
      const src = entry.restPos;
      const dst = entry.livePos;
      const minY = entry.boundsMin[1];
      const maxY = entry.boundsMax[1];
      const spanY = Math.max(0.05, maxY - minY);
      const minZ = entry.boundsMin[2];
      const maxZ = entry.boundsMax[2];
      const spanZ = Math.max(0.05, maxZ - minZ);
      const nVerts = src.length / 3;

      if (id === 'thyroid-cartilage') {
        for (let i = 0; i < nVerts; i++) {
          const k = i * 3;
          const x = src[k];
          const dy = src[k + 1] - ctPivot[1];
          const dz = src[k + 2] - ctPivot[2];
          dst[k] = x;
          dst[k + 1] = ctPivot[1] + dy * cCt - dz * sCt + frame.larynxShiftCm;
          dst[k + 2] = ctPivot[2] + dy * sCt + dz * cCt + frame.ctGlideCm;
        }
      } else if (id === 'cricoid-cartilage') {
        for (let i = 0; i < nVerts; i++) {
          const k = i * 3;
          dst[k] = src[k];
          dst[k + 1] = src[k + 1] + frame.larynxShiftCm;
          dst[k + 2] = src[k + 2];
        }
      } else if (id === 'hyoid-bone' || id === 'thyrohyoid-membrane') {
        const shift = frame.larynxShiftCm * 0.92;
        for (let i = 0; i < nVerts; i++) {
          const k = i * 3;
          dst[k] = src[k];
          dst[k + 1] = src[k + 1] + shift;
          dst[k + 2] = src[k + 2] + jawJutCm * 0.25;
        }
      } else if (
        id === 'cricothyroid-recta' ||
        id === 'cricothyroid-obliqua' ||
        id === 'cricothyroid-ligament'
      ) {
        const swell = id === 'cricothyroid-ligament' ? 0 : 0.08 * frame.channels.CT;
        for (let i = 0; i < nVerts; i++) {
          const k = i * 3;
          const x = src[k];
          const y = src[k + 1];
          const z = src[k + 2];
          const u = clamp((y - minY) / spanY, 0, 1);
          const dy = y - ctPivot[1];
          const dz = z - ctPivot[2];
          const ty = ctPivot[1] + dy * cCt - dz * sCt;
          const tz = ctPivot[2] + dy * sCt + dz * cCt + frame.ctGlideCm;
          const midBelly = Math.sin(Math.PI * u) * swell;
          dst[k] = x + Math.sign(x || 1) * midBelly;
          dst[k + 1] = y + (ty - y) * u + frame.larynxShiftCm;
          dst[k + 2] = z + (tz - z) * u + midBelly * 0.5;
        }
      } else if (id === 'left-arytenoid' || id === 'right-arytenoid') {
        const isLeft = id === 'left-arytenoid';
        const piv = isLeft ? lCaPivot : rCaPivot;
        const cA = isLeft ? cCaL : cCaR;
        const sA = isLeft ? sCaL : sCaR;
        const slideX = isLeft ? -frame.iaSlideCm : frame.iaSlideCm;
        for (let i = 0; i < nVerts; i++) {
          const k = i * 3;
          const dx = src[k] - piv[0];
          const dz = src[k + 2] - piv[2];
          dst[k] = piv[0] + dx * cA - dz * sA + slideX;
          dst[k + 1] = src[k + 1] + frame.larynxShiftCm;
          dst[k + 2] = piv[2] + dx * sA + dz * cA;
        }
      } else if (id === 'interarytenoid') {
        const comp = clamp(1 - frame.iaSlideCm * 1.1, 0.68, 1.18);
        const swell = 0.07 * frame.channels.IA;
        for (let i = 0; i < nVerts; i++) {
          const k = i * 3;
          dst[k] = src[k] * comp;
          dst[k + 1] = src[k + 1] + frame.larynxShiftCm;
          dst[k + 2] = src[k + 2] - swell;
        }
      } else if (
        id === 'left-vocal-ligament' ||
        id === 'right-vocal-ligament' ||
        id === 'left-vocalis' ||
        id === 'right-vocalis' ||
        id === 'left-thyroarytenoid' ||
        id === 'right-thyroarytenoid' ||
        id === 'left-conus-elasticus' ||
        id === 'right-conus-elasticus'
      ) {
        const isLeft = id.startsWith('left-');
        const dPx = isLeft ? dLeftPostX : dRightPostX;
        const dPy = isLeft ? dLeftPostY : dRightPostY;
        const dPz = isLeft ? dLeftPostZ : dRightPostZ;
        const isMuscle = id.includes('vocalis') || id.includes('thyroarytenoid');
        const bellyMedial = isMuscle
          ? (isLeft ? -1 : 1) * 0.085 * frame.channels.TA
          : 0;
        const bellyVert = isMuscle ? 0.06 * frame.channels.TA : 0;

        for (let i = 0; i < nVerts; i++) {
          const k = i * 3;
          const x = src[k];
          const y = src[k + 1];
          const z = src[k + 2];
          // s = 0 at anterior maxZ, s = 1 at posterior minZ
          const s = clamp((maxZ - z) / spanZ, 0, 1);
          const env = Math.sin(Math.PI * s);
          dst[k] = x + dPx * s + bellyMedial * env;
          dst[k + 1] = y + dAntY * (1 - s) + dPy * s + bellyVert * env;
          dst[k + 2] = z + dAntZ * (1 - s) + dPz * s;
        }
      } else if (
        id === 'left-lca' ||
        id === 'right-lca' ||
        id === 'left-pca' ||
        id === 'right-pca'
      ) {
        const isLeft = id.startsWith('left-');
        const dPx = isLeft ? dLeftPostX * 0.55 : dRightPostX * 0.55;
        const act = id.includes('lca') ? frame.channels.LCA : frame.channels.PCA;
        for (let i = 0; i < nVerts; i++) {
          const k = i * 3;
          const u = clamp((src[k + 1] - minY) / spanY, 0, 1);
          const swell = 0.06 * act * Math.sin(Math.PI * u);
          dst[k] = src[k] + dPx * u + Math.sign(src[k] || 1) * swell;
          dst[k + 1] = src[k + 1] + frame.larynxShiftCm;
          dst[k + 2] = src[k + 2];
        }
      } else if (
        id === 'epiglottis' ||
        id === 'epiglottic-ligaments' ||
        id === 'cuneiform-cartilages' ||
        id === 'left-aryepiglottic' ||
        id === 'right-aryepiglottic'
      ) {
        // AES twang narrows the epilaryngeal collar and tilts epiglottis slightly posteriorly
        const tilt = -0.26 * frame.aesNarrowing;
        const cE = Math.cos(tilt);
        const sE = Math.sin(tilt);
        const pinch = 1.0 - 0.28 * frame.aesNarrowing;
        for (let i = 0; i < nVerts; i++) {
          const k = i * 3;
          const u = clamp((src[k + 1] - epiPivot[1]) / 2.6, 0, 1);
          const dy = src[k + 1] - epiPivot[1];
          const dz = src[k + 2] - epiPivot[2];
          const ry = epiPivot[1] + dy * cE - dz * sE;
          const rz = epiPivot[2] + dy * sE + dz * cE;
          dst[k] = src[k] * (1 - (1 - pinch) * u);
          dst[k + 1] = src[k + 1] + (ry - src[k + 1]) * u + frame.larynxShiftCm;
          dst[k + 2] = src[k + 2] + (rz - src[k + 2]) * u;
        }
      } else if (
        id === 'sternothyroid' ||
        id === 'sternohyoid' ||
        id === 'omohyoid'
      ) {
        // Sternal/clavicular origin pinned at minY; superior insertion tracks larynxShiftCm
        const clav = frame.clavicularHeave * 0.45;
        for (let i = 0; i < nVerts; i++) {
          const k = i * 3;
          const u = clamp((src[k + 1] - minY) / spanY, 0, 1);
          dst[k] = src[k];
          dst[k + 1] = src[k + 1] + frame.larynxShiftCm * u + clav * (1 - u);
          dst[k + 2] = src[k + 2];
        }
      } else if (id === 'thyrohyoid') {
        for (let i = 0; i < nVerts; i++) {
          const k = i * 3;
          dst[k] = src[k];
          dst[k + 1] = src[k + 1] + frame.larynxShiftCm * 0.95;
          dst[k + 2] = src[k + 2];
        }
      } else if (id === 'mandible') {
        for (let i = 0; i < nVerts; i++) {
          const k = i * 3;
          const dy = src[k + 1] - tmjPivot[1];
          const dz = src[k + 2] - tmjPivot[2];
          dst[k] = src[k];
          dst[k + 1] = tmjPivot[1] + dy * cJaw - dz * sJaw;
          dst[k + 2] = tmjPivot[2] + dy * sJaw + dz * cJaw + jawJutCm;
        }
      } else if (
        id === 'digastric' ||
        id === 'stylohyoid' ||
        id === 'mylohyoid' ||
        id === 'geniohyoid' ||
        id === 'masseter' ||
        id === 'lateral-pterygoid'
      ) {
        for (let i = 0; i < nVerts; i++) {
          const k = i * 3;
          const x = src[k];
          const y = src[k + 1];
          const z = src[k + 2];
          // Anterior/inferior chin/ramus vertices follow mandible; hyoid-level vertices follow larynxShiftCm
          const jawWeight =
            id === 'masseter' || id === 'lateral-pterygoid'
              ? clamp((maxY - y) / spanY, 0, 1)
              : clamp((z - 1.2) / 4.2, 0, 1);
          const hyoidWeight = (1 - jawWeight) * clamp(1 - (y - 3.5) / 5.5, 0, 1);
          const dy = y - tmjPivot[1];
          const dz = z - tmjPivot[2];
          const jy = tmjPivot[1] + dy * cJaw - dz * sJaw;
          const jz = tmjPivot[2] + dy * sJaw + dz * cJaw + jawJutCm;
          dst[k] = x;
          dst[k + 1] =
            y + (jy - y) * jawWeight + frame.larynxShiftCm * 0.9 * hyoidWeight;
          dst[k + 2] = z + (jz - z) * jawWeight;
        }
      } else if (id === 'tongue' || id === 'genioglossus' || id === 'hyoglossus') {
        for (let i = 0; i < nVerts; i++) {
          const k = i * 3;
          const x = src[k];
          const y = src[k + 1];
          const z = src[k + 2];
          const uSup = clamp((y - minY) / spanY, 0, 1);
          const jawFollow = -frame.jawAngleRad * 1.4 * clamp((z - 1.0) / 4.5, 0, 1);
          dst[k] = x;
          dst[k + 1] =
            y +
            frame.tongueArchCm * uSup +
            jawFollow +
            frame.larynxShiftCm * 0.45 * (1 - uSup);
          dst[k + 2] = z + frame.tongueFrontCm * uSup + jawJutCm * 0.45;
        }
      } else if (
        id === 'levator-veli-palatini' ||
        id === 'tensor-veli-palatini' ||
        id === 'palatopharyngeus'
      ) {
        for (let i = 0; i < nVerts; i++) {
          const k = i * 3;
          const postFrac = clamp((velPivot[2] - src[k + 2] + 1.2) / 3.2, 0, 1);
          dst[k] = src[k];
          dst[k + 1] = src[k + 1] + frame.velumLiftCm * postFrac;
          dst[k + 2] = src[k + 2] - frame.velumLiftCm * 0.32 * postFrac;
        }
      } else if (id === 'pharyngeal-constrictors') {
        const squeeze = 1.0 - 0.16 * frame.strainIndex + 0.06 * frame.channels.INF;
        for (let i = 0; i < nVerts; i++) {
          const k = i * 3;
          const u = 1 - clamp((src[k + 1] - minY) / spanY, 0, 1);
          dst[k] = src[k] * squeeze;
          dst[k + 1] = src[k + 1] + frame.larynxShiftCm * 0.65 * u;
          dst[k + 2] = src[k + 2];
        }
      } else if (id === 'trachea') {
        for (let i = 0; i < nVerts; i++) {
          const k = i * 3;
          const u = clamp((src[k + 1] - minY) / spanY, 0, 1);
          dst[k] = src[k];
          dst[k + 1] = src[k + 1] + frame.larynxShiftCm * u;
          dst[k + 2] = src[k + 2];
        }
      } else if (id === 'diaphragm') {
        // Central dome descends up to -3.4 cm while costal rim swings outward with ribExpansion
        const maxR = 12.2;
        for (let i = 0; i < nVerts; i++) {
          const k = i * 3;
          const x = src[k];
          const y = src[k + 1];
          const z = src[k + 2];
          const r = Math.hypot(x, z - 0.5);
          const domeWeight =
            clamp(1 - Math.pow(r / maxR, 1.8), 0, 1) *
            clamp((y - minY) / (spanY * 0.72), 0.15, 1);
          const ribSwing = 1.0 + 0.065 * frame.ribExpansion;
          dst[k] = x * ribSwing;
          dst[k + 1] = y - frame.diaphragmDescentCm * domeWeight;
          dst[k + 2] = z + (z > 0 ? 0.55 * frame.ribExpansion : 0);
        }
      } else if (id === 'right-lung' || id === 'left-lung') {
        const latScale = 1.0 + 0.065 * frame.ribExpansion;
        for (let i = 0; i < nVerts; i++) {
          const k = i * 3;
          const x = src[k];
          const y = src[k + 1];
          const z = src[k + 2];
          const baseWeight = 1 - clamp((y - minY) / spanY, 0, 1);
          dst[k] = x * latScale;
          dst[k + 1] =
            y -
            frame.diaphragmDescentCm * 0.78 * baseWeight +
            frame.clavicularHeave * 0.65 * (1 - baseWeight);
          dst[k + 2] = z + (z > -1 ? 0.55 * frame.ribExpansion : 0);
        }
      } else if (
        id === 'thoracic-cage' ||
        id === 'external-intercostals' ||
        id === 'internal-intercostals'
      ) {
        // Bucket-handle rib expansion (posterior spine stays fixed at z < -3.5)
        for (let i = 0; i < nVerts; i++) {
          const k = i * 3;
          const x = src[k];
          const y = src[k + 1];
          const z = src[k + 2];
          const antWeight = clamp((z + 3.5) / 12.0, 0, 1);
          const ribZone = clamp(1 - Math.abs(y + 15.0) / 16.0, 0, 1);
          const swing = frame.ribExpansion * antWeight * ribZone;
          const heave = frame.clavicularHeave * clamp((y + 14.0) / 14.0, 0, 1) * antWeight;
          dst[k] = x * (1 + 0.06 * swing);
          dst[k + 1] = y + 0.35 * swing + 0.95 * heave;
          dst[k + 2] = z + 0.65 * swing + 0.3 * heave;
        }
      } else if (
        id === 'external-oblique' ||
        id === 'abdominal-wall' ||
        id === 'rectus-abdominis' ||
        id === 'quadratus-lumborum'
      ) {
        // Epigastric/abdominal expansion on DIA inhale + inward metering support under APP
        const netOutward =
          0.75 * (frame.diaphragmDescentCm / 3.4) - 0.62 * frame.abdominalTone;
        for (let i = 0; i < nVerts; i++) {
          const k = i * 3;
          const x = src[k];
          const y = src[k + 1];
          const z = src[k + 2];
          const antFrac = clamp((z + 2.0) / 11.0, 0, 1);
          const midBelly = Math.sin(Math.PI * clamp((y - minY) / spanY, 0, 1));
          dst[k] = x * (1 + 0.045 * netOutward * midBelly);
          dst[k + 1] = y + 0.35 * frame.abdominalTone * midBelly;
          dst[k + 2] = z + 0.85 * netOutward * antFrac * midBelly;
        }
      } else {
        continue;
      }

      const attr = entry.mesh.geometry.getAttribute(
        'position',
      ) as THREE.BufferAttribute;
      attr.needsUpdate = true;
    }
  }

  private tintMaterial(
    id: string,
    entry: ManagedMesh,
    frame: KinematicFrame,
  ): void {
    const chId = entry.info.channel;
    const act = chId ? frame.channels[chId] : 0;
    const isHovered = this.hoveredId === id;
    const isSelected = this.selectedId === id;

    if (entry.info.kind === 'muscle' && chId) {
      const accent = new THREE.Color(CHANNEL_META[chId].color);
      entry.material.color.copy(entry.baseColor).lerp(accent, act * 0.58);
      entry.material.emissive.copy(accent);
      entry.material.emissiveIntensity = 0.04 + act * 0.44;

      // Highlight vocal strain on SUP / FVF / TA when strainIndex is elevated
      if (
        frame.strainIndex > 0.5 &&
        (chId === 'SUP' || chId === 'FVF' || chId === 'TA')
      ) {
        entry.material.emissive.setHex(0xef4444);
        entry.material.emissiveIntensity = 0.35 + 0.45 * frame.strainIndex;
      }
    } else {
      entry.material.color.copy(entry.baseColor);
      entry.material.emissive.setHex(0x000000);
      entry.material.emissiveIntensity = 0;
    }

    if (isSelected || isHovered) {
      entry.material.emissive.setHex(isSelected ? 0xfacc15 : 0x38bdf8);
      entry.material.emissiveIntensity = Math.max(
        entry.material.emissiveIntensity,
        isSelected ? 0.55 : 0.38,
      );
    }
  }

  private updateParametricFolds(frame: KinematicFrame, phiRad: number): void {
    const ant = frame.liveAnteriorCommissure;
    const lVp = frame.liveLeftVocalProcess;
    const rVp = frame.liveRightVocalProcess;
    const midlineX = ant[0];
    const thickCm = frame.foldThicknessMm * 0.1;

    const updateTrueFold = (mesh: THREE.Mesh, side: -1 | 1): void => {
      const vp = side === 1 ? lVp : rVp;
      const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      let p = 0;

      for (let i = 0; i <= MUCOSAL_S_SEG; i++) {
        const s = i / MUCOSAL_S_SEG;
        const axisY = ant[1] + (vp[1] - ant[1]) * s;
        const axisZ = ant[2] + (vp[2] - ant[2]) * s;
        const lateralWallHalfCm = 0.46 + 0.12 * s;

        for (let j = 0; j <= MUCOSAL_V_SEG; j++) {
          const uProfile = j / MUCOSAL_V_SEG;
          // j spans from subglottal lateral wall (0) -> inferior edge (0.2) -> superior edge (0.78) -> ventricle floor (1.0)
          let halfGapCm: number;
          let yOffsetCm: number;

          if (uProfile < 0.2) {
            const w = uProfile / 0.2;
            const infGapCm = evaluateMucosalHalfGapMm(frame, phiRad, s, 0.0) * 0.1;
            halfGapCm = lateralWallHalfCm * (1 - w) + infGapCm * w;
            yOffsetCm = -thickCm * (0.85 - 0.35 * w);
          } else if (uProfile <= 0.8) {
            const vLip = (uProfile - 0.2) / 0.6;
            halfGapCm = evaluateMucosalHalfGapMm(frame, phiRad, s, vLip) * 0.1;
            yOffsetCm = -thickCm * 0.5 + thickCm * vLip;
          } else {
            const w = (uProfile - 0.8) / 0.2;
            const supGapCm = evaluateMucosalHalfGapMm(frame, phiRad, s, 1.0) * 0.1;
            halfGapCm = supGapCm * (1 - w) + (lateralWallHalfCm * 0.92) * w;
            yOffsetCm = thickCm * (0.5 + 0.12 * w);
          }

          arr[p++] = midlineX + side * halfGapCm;
          arr[p++] = axisY + yOffsetCm;
          arr[p++] = axisZ;
        }
      }
      attr.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    };

    updateTrueFold(this.leftMucosaMesh, 1);
    updateTrueFold(this.rightMucosaMesh, -1);

    // Tint mucosa by contact & strain
    const sample = sampleGlottalCycle(frame, phiRad);
    if (frame.strainIndex > 0.55) {
      this.mucosaMat.color.setHex(0xfca5a5);
      this.mucosaMat.emissive.setHex(0xdc2626);
      this.mucosaMat.emissiveIntensity = 0.48;
    } else {
      this.mucosaMat.color.setHex(0xfbcfe8);
      this.mucosaMat.emissive.setHex(
        sample.contactQuotientInstant > 0.45 ? 0xf59e0b : 0x6b2135,
      );
      this.mucosaMat.emissiveIntensity =
        0.16 + 0.28 * sample.contactQuotientInstant;
    }

    // Update Ventricular (False) Folds (~0.38 cm superior to true folds)
    const updateFalseFold = (mesh: THREE.Mesh, side: -1 | 1): void => {
      const vp = side === 1 ? lVp : rVp;
      const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      let p = 0;
      const fvfBaseCm = sample.falseFoldHalfGapMm * 0.1;

      for (let i = 0; i <= 18; i++) {
        const s = i / 18;
        const axisY = ant[1] + (vp[1] - ant[1]) * s + thickCm * 0.55 + 0.34;
        const axisZ = ant[2] + (vp[2] - ant[2]) * s;
        const env = Math.sin(Math.PI * clamp(s * 0.92 + 0.04, 0, 1));
        const edgeCm = fvfBaseCm + 0.16 * (1 - env);
        const wallCm = 0.58;

        for (let j = 0; j <= 6; j++) {
          const u = j / 6;
          const arch = Math.sin(Math.PI * u);
          const xCm = wallCm * (1 - arch) + edgeCm * arch;
          const yCm = -0.14 + 0.28 * u;
          arr[p++] = midlineX + side * xCm;
          arr[p++] = axisY + yCm;
          arr[p++] = axisZ;
        }
      }
      attr.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    };

    updateFalseFold(this.leftFalseFoldMesh, 1);
    updateFalseFold(this.rightFalseFoldMesh, -1);

    this.falseFoldMat.emissive.setHex(
      frame.channels.FVF > 0.35 ? 0xef4444 : 0x3b0d15,
    );
    this.falseFoldMat.emissiveIntensity =
      0.12 + 0.5 * frame.channels.FVF;
  }

  private updateAirflow(
    frame: KinematicFrame,
    phiRad: number,
    dtSec: number,
  ): void {
    const sample = sampleGlottalCycle(frame, phiRad);
    const inhaling = frame.airflowLps < -0.05;
    const exhaling = frame.airflowLps > 0.015 || sample.jetVelocityMps > 0.5;

    this.airflowPoints.visible = inhaling || exhaling;
    if (!this.airflowPoints.visible) return;

    const posAttr = this.airflowPoints.geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
    const colAttr = this.airflowPoints.geometry.getAttribute(
      'color',
    ) as THREE.BufferAttribute;
    const pos = posAttr.array as Float32Array;
    const col = colAttr.array as Float32Array;

    const speed = inhaling
      ? -0.45 * clamp(Math.abs(frame.airflowLps), 0.2, 1.2)
      : 0.22 + 0.38 * clamp(sample.glottalAreaMm2 / 14.0 + frame.airflowLps, 0.1, 1.4);

    const glottisY = frame.liveAnteriorCommissure[1];
    const halfSlitCm = Math.max(
      0.015,
      Math.min(sample.inferiorHalfGapMm, sample.superiorHalfGapMm) * 0.1,
    );
    const activeZMin =
      frame.liveAnteriorCommissure[2] -
      (frame.liveAnteriorCommissure[2] - frame.liveLeftVocalProcess[2]) *
        frame.activeLengthFraction;
    const activeZMax = frame.liveAnteriorCommissure[2];

    for (let i = 0; i < AIRFLOW_PARTICLE_COUNT; i++) {
      let s01 = this.airflowSeeds[i * 3] + speed * dtSec;
      s01 = ((s01 % 1) + 1) % 1;
      this.airflowSeeds[i * 3] = s01;

      const angle = this.airflowSeeds[i * 3 + 1];
      const rFrac = this.airflowSeeds[i * 3 + 2];

      // Vertical path y ∈ [-6.5 cm trachea .. +7.0 cm pharynx/oral]
      const y = glottisY - 6.5 + s01 * 13.5;
      const distFromGlottis = Math.abs(y - glottisY);
      const pinch = 1 - Math.exp(-distFromGlottis * 1.35);

      const xSpread = halfSlitCm + pinch * (0.62 - 0.22 * frame.aesNarrowing) * rFrac;
      const zMid = 0.5 * (activeZMin + activeZMax);
      const zHalf = 0.5 * (activeZMax - activeZMin) + pinch * 0.35;

      // Curve gently forward into oral cavity above y > 5.5
      const oralCurveZ = y > glottisY + 4.8 ? (y - (glottisY + 4.8)) * 0.85 : 0;

      pos[i * 3] = Math.cos(angle) * xSpread;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = zMid + Math.sin(angle) * zHalf + oralCurveZ;

      if (inhaling) {
        col[i * 3] = 0.18;
        col[i * 3 + 1] = 0.84;
        col[i * 3 + 2] = 0.76;
      } else if (frame.aesNarrowing > 0.5) {
        // Golden ringing jet in twang / belting / edge
        col[i * 3] = 0.98;
        col[i * 3 + 1] = 0.82;
        col[i * 3 + 2] = 0.24;
      } else {
        col[i * 3] = 0.32;
        col[i * 3 + 1] = 0.78;
        col[i * 3 + 2] = 0.98;
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }

  private bindPointerEvents(): void {
    const dom = this.renderer.domElement;

    dom.addEventListener('pointermove', (ev) => {
      const rect = dom.getBoundingClientRect();
      this.pointerNdc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointerNdc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      const hit = this.pickStructure();
      const nextId = hit?.id ?? null;
      if (nextId !== this.hoveredId) {
        this.hoveredId = nextId;
        dom.style.cursor = nextId ? 'pointer' : 'grab';
        if (!this.selectedId) {
          this.onInspect(hit, false);
        }
      }
    });

    dom.addEventListener('pointerleave', () => {
      this.hoveredId = null;
      if (!this.selectedId) {
        this.onInspect(null, false);
      }
    });

    let downPos = { x: 0, y: 0 };
    dom.addEventListener('pointerdown', (ev) => {
      downPos = { x: ev.clientX, y: ev.clientY };
    });

    dom.addEventListener('pointerup', (ev) => {
      if (Math.hypot(ev.clientX - downPos.x, ev.clientY - downPos.y) > 5) return;
      const rect = dom.getBoundingClientRect();
      this.pointerNdc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointerNdc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      const hit = this.pickStructure();
      if (hit && this.selectedId !== hit.id) {
        this.selectedId = hit.id;
        this.onInspect(hit, true);
      } else {
        this.selectedId = null;
        this.onInspect(hit, false);
      }
    });
  }

  private pickStructure(): StructureInfo | null {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    for (const h of hits) {
      if (!h.object.visible) continue;
      const mat = (h.object as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
      if (mat.opacity < 0.14) continue;
      const info = h.object.userData.structureInfo as StructureInfo | undefined;
      if (info) return info;
    }
    return null;
  }

  public clearSelection(): void {
    this.selectedId = null;
    this.onInspect(null, false);
  }

  private handleResize(): void {
    const w = Math.max(280, this.container.clientWidth);
    const h = Math.max(240, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  public dispose(): void {
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
