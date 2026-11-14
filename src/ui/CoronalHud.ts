import { sampleGlottalCycle } from '../biomechanics/kinematics';
import type { KinematicFrame, Lang } from '../biomechanics/types';
import { hzToNoteLabel } from '../audio/vocalSynth';

/**
 * Synchronized 2D Coronal Cross-Section + Glottal Area / EGG Waveform HUD.
 * Shows the vertical phase-lagged mucosal wave (convergent opening -> divergent closing),
 * TA vocalis body thickness, ventricular (false) fold clearance, subglottal air jet,
 * and full-cycle glottal area + contact quotient trace.
 */
export class CoronalHud {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D canvas context unavailable for CoronalHud');
    }
    this.ctx = ctx;
  }

  public render(frame: KinematicFrame, phiRad: number, lang: Lang): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(280, Math.floor(rect.width));
    const h = Math.max(132, Math.floor(rect.height));
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Subtle split: left = coronal cross-section, right = glottal area + EGG trace
    const splitX = Math.floor(w * 0.46);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(splitX, 8);
    ctx.lineTo(splitX, h - 8);
    ctx.stroke();

    const liveSample = sampleGlottalCycle(frame, phiRad);
    this.drawCoronalSlice(ctx, 0, 0, splitX, h, frame, liveSample, lang);
    this.drawGlottalWaveforms(ctx, splitX + 10, 0, w - splitX - 16, h, frame, phiRad, lang);

    ctx.restore();
  }

  private drawCoronalSlice(
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    w: number,
    h: number,
    frame: KinematicFrame,
    sample: ReturnType<typeof sampleGlottalCycle>,
    lang: Lang,
  ): void {
    const cx = x0 + w * 0.5;
    const cy = y0 + h * 0.57;
    const pxPerMm = Math.min(w / 15.5, h / 13.5);

    // Header label
    ctx.fillStyle = 'rgba(226, 232, 240, 0.78)';
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(
      lang === 'da' ? 'KORONALSNIT (FORFRA)' : 'CORONAL FOLD SLICE',
      x0 + 10,
      y0 + 15,
    );

    // Subglottal / transglottal airflow jet glow
    if (Math.abs(sample.jetVelocityMps) > 0.4) {
      const inhaling = sample.jetVelocityMps < 0;
      const grad = ctx.createLinearGradient(cx, cy + 36, cx, cy - 42);
      if (inhaling) {
        grad.addColorStop(0, 'rgba(45, 212, 191, 0.02)');
        grad.addColorStop(0.5, 'rgba(45, 212, 191, 0.28)');
        grad.addColorStop(1, 'rgba(45, 212, 191, 0.12)');
      } else {
        grad.addColorStop(0, 'rgba(56, 189, 248, 0.25)');
        grad.addColorStop(0.55, 'rgba(250, 204, 21, 0.34)');
        grad.addColorStop(1, 'rgba(250, 204, 21, 0.0)');
      }
      const jetHalfPx = Math.max(
        2,
        Math.min(sample.inferiorHalfGapMm, sample.superiorHalfGapMm) * pxPerMm,
      );
      ctx.fillStyle = grad;
      ctx.fillRect(cx - jetHalfPx, cy - 42, jetHalfPx * 2, 78);
    }

    // Draw Left (+1) and Right (-1) True Vocal Folds + False Folds above
    const thickPx = frame.foldThicknessMm * pxPerMm;
    const ySup = cy - thickPx * 0.48;
    const yInf = cy + thickPx * 0.52;
    const wallHalfPx = 6.8 * pxPerMm;

    for (const side of [-1, 1] as const) {
      const infEdgeX = cx + side * sample.inferiorHalfGapMm * pxPerMm;
      const supEdgeX = cx + side * sample.superiorHalfGapMm * pxPerMm;
      const wallX = cx + side * wallHalfPx;

      // Mucosal cover outer silhouette
      ctx.beginPath();
      ctx.moveTo(wallX, yInf + 14);
      ctx.quadraticCurveTo(
        cx + side * (sample.inferiorHalfGapMm * pxPerMm + 6),
        yInf + 6,
        infEdgeX,
        yInf,
      );
      ctx.bezierCurveTo(
        infEdgeX,
        lerpNum(yInf, ySup, 0.35),
        supEdgeX,
        lerpNum(yInf, ySup, 0.65),
        supEdgeX,
        ySup,
      );
      ctx.quadraticCurveTo(
        cx + side * (sample.superiorHalfGapMm * pxPerMm + 9),
        ySup - 3,
        wallX,
        ySup - 2,
      );
      ctx.closePath();

      ctx.fillStyle =
        frame.strainIndex > 0.58
          ? 'rgba(248, 113, 113, 0.88)'
          : 'rgba(251, 191, 182, 0.88)';
      ctx.fill();
      ctx.strokeStyle =
        sample.contactQuotientInstant > 0.4
          ? 'rgba(250, 204, 21, 0.95)'
          : 'rgba(255, 241, 242, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Inner TA / Vocalis muscular body core
      const bodyInset = 1.3 * pxPerMm;
      const bodyInfX = cx + side * (sample.inferiorHalfGapMm * pxPerMm + bodyInset);
      const bodySupX = cx + side * (sample.superiorHalfGapMm * pxPerMm + bodyInset * 1.15);
      ctx.beginPath();
      ctx.moveTo(wallX, yInf + 9);
      ctx.quadraticCurveTo(bodyInfX, yInf + 2, bodyInfX, (yInf + ySup) * 0.52);
      ctx.quadraticCurveTo(bodySupX, ySup + 2, wallX, ySup + 2);
      ctx.closePath();
      const taAlpha = 0.38 + 0.52 * frame.channels.TA;
      ctx.fillStyle = `rgba(220, 38, 38, ${taAlpha.toFixed(2)})`;
      ctx.fill();

      // Ventricular (False) Fold cushion above laryngeal ventricle
      const fvfY = ySup - 11;
      const fvfEdgeX = cx + side * sample.falseFoldHalfGapMm * pxPerMm;
      ctx.beginPath();
      ctx.moveTo(wallX, fvfY + 4);
      ctx.quadraticCurveTo(fvfEdgeX, fvfY + 3, fvfEdgeX, fvfY - 3);
      ctx.quadraticCurveTo(fvfEdgeX + side * 6, fvfY - 9, wallX, fvfY - 10);
      ctx.closePath();
      ctx.fillStyle =
        frame.channels.FVF > 0.35
          ? 'rgba(239, 68, 68, 0.78)'
          : 'rgba(190, 120, 130, 0.42)';
      ctx.fill();
    }

    // Epilaryngeal AES collar indicator lines at top
    const aesHalfPx = (5.8 - 3.3 * frame.aesNarrowing) * pxPerMm;
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.65)';
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(cx - aesHalfPx, y0 + 24);
    ctx.lineTo(cx - aesHalfPx, y0 + 34);
    ctx.moveTo(cx + aesHalfPx, y0 + 24);
    ctx.lineTo(cx + aesHalfPx, y0 + 34);
    ctx.stroke();
    ctx.setLineDash([]);

    // Convergent vs Divergent phase badge
    const delta = sample.inferiorHalfGapMm - sample.superiorHalfGapMm;
    let shapeText = lang === 'da' ? 'Lukket / Hvile' : 'Closed / Rest';
    if (sample.glottalAreaMm2 > 0.4) {
      if (delta > 0.08) {
        shapeText = lang === 'da' ? '▲ Konvergent (Åbner)' : '▲ Convergent (Opening)';
      } else if (delta < -0.08) {
        shapeText = lang === 'da' ? '▼ Divergent (Lukker)' : '▼ Divergent (Closing)';
      } else {
        shapeText = lang === 'da' ? '║ Åben glottis' : '║ Open Glottis';
      }
    }
    ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
    ctx.font = '500 10px system-ui, -apple-system, sans-serif';
    ctx.fillText(shapeText, x0 + 10, h - 8);
  }

  private drawGlottalWaveforms(
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    w: number,
    h: number,
    frame: KinematicFrame,
    phiRad: number,
    lang: Lang,
  ): void {
    ctx.fillStyle = 'rgba(226, 232, 240, 0.88)';
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(hzToNoteLabel(frame.f0Hz), x0, y0 + 15);

    const stretchSign = frame.foldElongationPct >= 0 ? '+' : '';
    const stats = `L ${frame.foldLengthMm.toFixed(1)}mm (${stretchSign}${frame.foldElongationPct.toFixed(0)}%) · CQ ${Math.round(frame.closedQuotient * 100)}%`;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.88)';
    ctx.font = '500 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(stats, x0, y0 + 29);

    const plotTop = y0 + 38;
    const plotH = Math.max(44, h - 62);
    const plotBottom = plotTop + plotH;

    // Baseline
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.beginPath();
    ctx.moveTo(x0, plotBottom);
    ctx.lineTo(x0 + w, plotBottom);
    ctx.stroke();

    // Sample Glottal Area (cyan) and EGG Contact (amber) across φ ∈ [0, 2π]
    const N = 56;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const p = (i / N) * Math.PI * 2;
      const s = sampleGlottalCycle(frame, p);
      const px = x0 + (i / N) * w;
      const py = plotBottom - Math.min(1, s.glottalAreaMm2 / 26.0) * plotH;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // EGG Contact Quotient curve
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const p = (i / N) * Math.PI * 2;
      const s = sampleGlottalCycle(frame, p);
      const px = x0 + (i / N) * w;
      const py = plotBottom - s.contactQuotientInstant * (plotH * 0.78);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.85)';
    ctx.lineWidth = 1.3;
    ctx.stroke();

    // Live phase cursor φ
    const normPhi = (((phiRad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
    const cursorX = x0 + normPhi * w;
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.85)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cursorX, plotTop - 2);
    ctx.lineTo(cursorX, plotBottom + 2);
    ctx.stroke();

    // Legend & P_sub readout
    ctx.fillStyle = '#38bdf8';
    ctx.font = '500 9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(lang === 'da' ? '─ Glottis-areal' : '─ Glottal Area', x0, h - 8);
    ctx.fillStyle = '#facc15';
    ctx.fillText(
      `─ EGG · Psub ${frame.subglottalPressureKpa.toFixed(1)} kPa`,
      x0 + 88,
      h - 8,
    );
  }
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
