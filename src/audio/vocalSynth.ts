import type { KinematicFrame } from '../biomechanics/types';
import { clamp } from '../biomechanics/kinematics';

/**
 * Real-time pedagogical LF-inspired glottal + 4-formant vocal tract Web Audio synthesizer.
 * Driven directly at 60 Hz from KinematicFrame so users can hear pitch glides, register
 * spectral-tilt changes, breathy chink turbulence, twang 3 kHz ring, fry/false-fold
 * subharmonics, and vowel modification in lockstep with the 3+1D muscle visualization.
 */
export class VocalSynth {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private glottalOsc: OscillatorNode | null = null;
  private subOsc: OscillatorNode | null = null;
  private glottalGain: GainNode | null = null;
  private subGain: GainNode | null = null;
  private spectralTiltFilter: BiquadFilterNode | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private noiseBand: BiquadFilterNode | null = null;
  private noiseGain: GainNode | null = null;
  private formantFilters: BiquadFilterNode[] = [];
  private formantGains: GainNode[] = [];
  private nasalGain: GainNode | null = null;
  private enabled = false;

  public isEnabled(): boolean {
    return this.enabled;
  }

  public async setEnabled(next: boolean): Promise<boolean> {
    this.enabled = next;
    if (next) {
      this.ensureGraph();
      if (this.ctx && this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
    } else if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
    }
    return this.enabled;
  }

  private ensureGraph(): void {
    if (this.ctx) return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    this.ctx = ctx;

    // Build custom LF-like asymmetric glottal harmonic series (1/n^1.35 rolloff)
    const nHarm = 48;
    const real = new Float32Array(nHarm);
    const imag = new Float32Array(nHarm);
    for (let k = 1; k < nHarm; k++) {
      const amp = 1.0 / Math.pow(k, 1.22);
      real[k] = amp * Math.cos(k * 0.35);
      imag[k] = amp * Math.sin(k * 0.35);
    }
    const glottalWave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });

    const glottalOsc = ctx.createOscillator();
    glottalOsc.setPeriodicWave(glottalWave);
    glottalOsc.frequency.value = 220;

    const subOsc = ctx.createOscillator();
    subOsc.type = 'sawtooth';
    subOsc.frequency.value = 110;

    const glottalGain = ctx.createGain();
    glottalGain.gain.value = 0;

    const subGain = ctx.createGain();
    subGain.gain.value = 0;

    const spectralTiltFilter = ctx.createBiquadFilter();
    spectralTiltFilter.type = 'lowpass';
    spectralTiltFilter.frequency.value = 1800;
    spectralTiltFilter.Q.value = 0.7;

    // White noise buffer for aspiration chink & Sss warm-ups
    const bufLen = ctx.sampleRate * 2;
    const noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuf;
    noiseSource.loop = true;

    const noiseBand = ctx.createBiquadFilter();
    noiseBand.type = 'bandpass';
    noiseBand.frequency.value = 2200;
    noiseBand.Q.value = 0.9;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;

    // Source excitation bus feeding parallel 4-formant vocal tract bank
    const sourceBus = ctx.createGain();
    sourceBus.gain.value = 1.0;

    glottalOsc.connect(glottalGain);
    subOsc.connect(subGain);
    glottalGain.connect(spectralTiltFilter);
    subGain.connect(spectralTiltFilter);
    spectralTiltFilter.connect(sourceBus);

    noiseSource.connect(noiseBand);
    noiseBand.connect(noiseGain);
    noiseGain.connect(sourceBus);

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0;

    // Soft limiter / compressor so peaks stay comfortable
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.12;

    const baseFreqs = [650, 1400, 2600, 3200];
    const baseQs = [6.5, 8.5, 10.5, 12.0];
    const baseLevels = [1.0, 0.62, 0.36, 0.28];

    for (let i = 0; i < 4; i++) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = baseFreqs[i];
      bp.Q.value = baseQs[i];

      const fg = ctx.createGain();
      fg.gain.value = baseLevels[i];

      sourceBus.connect(bp);
      bp.connect(fg);
      fg.connect(masterGain);

      this.formantFilters.push(bp);
      this.formantGains.push(fg);
    }

    // Nasal murmur resonator (~260 Hz) active when velum drops (humming "Mmm")
    const nasalFilter = ctx.createBiquadFilter();
    nasalFilter.type = 'bandpass';
    nasalFilter.frequency.value = 265;
    nasalFilter.Q.value = 5.5;
    const nasalGain = ctx.createGain();
    nasalGain.gain.value = 0.0;
    sourceBus.connect(nasalFilter);
    nasalFilter.connect(nasalGain);
    nasalGain.connect(masterGain);

    masterGain.connect(compressor);
    compressor.connect(ctx.destination);

    glottalOsc.start();
    subOsc.start();
    noiseSource.start();

    this.glottalOsc = glottalOsc;
    this.subOsc = subOsc;
    this.glottalGain = glottalGain;
    this.subGain = subGain;
    this.spectralTiltFilter = spectralTiltFilter;
    this.noiseSource = noiseSource;
    this.noiseBand = noiseBand;
    this.noiseGain = noiseGain;
    this.nasalGain = nasalGain;
    this.masterGain = masterGain;
  }

  public update(frame: KinematicFrame, paused: boolean): void {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const tau = 0.025;

    if (paused) {
      this.masterGain.gain.setTargetAtTime(0, now, 0.03);
      return;
    }

    const phonating = frame.f0Hz > 30 && frame.subglottalPressureKpa > 0.2;
    const f0 = clamp(frame.f0Hz > 30 ? frame.f0Hz : 140, 45, 1600);
    this.glottalOsc?.frequency.setTargetAtTime(f0, now, 0.016);
    this.subOsc?.frequency.setTargetAtTime(f0 * 0.5, now, 0.016);

    // Voiced amplitude scales with P_sub and closure
    const voicedAmp = phonating
      ? clamp(0.18 + 0.24 * frame.subglottalPressureKpa * (0.35 + 0.65 * frame.closedQuotient), 0, 0.65)
      : 0;
    this.glottalGain?.gain.setTargetAtTime(voicedAmp, now, tau);

    // Subharmonic roughness from vocal fry dicrotic pulses or ventricular false-fold oscillation
    const roughDrive = clamp(
      0.55 * frame.dicroticFry + 0.45 * clamp(frame.falseFoldOscillationMm / 0.8, 0, 1),
      0,
      0.8,
    );
    this.subGain?.gain.setTargetAtTime(voicedAmp * roughDrive * 0.68, now, tau);

    // Spectral brightness rises with closedQuotient (chest/belt brassiness) & AES twang
    const tiltHz = clamp(
      650 + 2800 * frame.closedQuotient + 2400 * frame.aesNarrowing + f0 * 1.4,
      550,
      7500,
    );
    this.spectralTiltFilter?.frequency.setTargetAtTime(tiltHz, now, tau);

    // Aspiration turbulence: breathy posterior chink, inspiratory rush, or "Sss" hiss
    let hissAmp = 0;
    let hissFreq = 2200;
    if (frame.airflowLps < -0.15) {
      // Soft inspiratory breath
      hissAmp = clamp(Math.abs(frame.airflowLps) * 0.045, 0, 0.05);
      hissFreq = 1150;
    } else if (!phonating && frame.channels.APP > 0.45 && frame.channels.PCA > 0.1) {
      // Unvoiced "Sss" warm-up exercise!
      hissAmp = 0.085 * frame.channels.APP;
      hissFreq = 4800;
    } else if (phonating) {
      hissAmp = clamp(
        (frame.posteriorChinkMm * 0.022 + frame.membranousGapMm * 0.03) *
          frame.subglottalPressureKpa,
        0.004,
        0.14,
      );
      hissFreq = 2400 + 800 * frame.aesNarrowing;
    }
    this.noiseBand?.frequency.setTargetAtTime(hissFreq, now, tau);
    this.noiseGain?.gain.setTargetAtTime(hissAmp, now, tau);

    // Update 4 vocal tract formants + singer's ring boost
    const [f1, f2, f3, f4] = frame.formantsHz;
    const freqs = [f1, f2, f3, f4];
    const nasalOpen = clamp(1.0 - frame.velumLiftCm / 0.35, 0, 1);
    const oralScale = 1.0 - 0.55 * nasalOpen;
    const ringBoost = 1.0 + 2.1 * frame.aesNarrowing;

    const gains = [
      1.0 * oralScale,
      0.65 * oralScale,
      0.38 * ringBoost * oralScale,
      0.3 * ringBoost * oralScale,
    ];
    const qs = [6.0, 8.5, 10.0 + 6.0 * frame.aesNarrowing, 11.0 + 8.0 * frame.aesNarrowing];

    for (let i = 0; i < 4; i++) {
      this.formantFilters[i]?.frequency.setTargetAtTime(freqs[i], now, tau);
      this.formantFilters[i]?.Q.setTargetAtTime(qs[i], now, tau);
      this.formantGains[i]?.gain.setTargetAtTime(gains[i], now, tau);
    }

    this.nasalGain?.gain.setTargetAtTime(nasalOpen * 0.85, now, tau);
    this.masterGain.gain.setTargetAtTime(0.32, now, tau);
  }

  public dispose(): void {
    this.noiseSource?.stop();
    this.glottalOsc?.stop();
    this.subOsc?.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export function hzToNoteLabel(hz: number): string {
  if (hz < 30) return '— (Silent / Breath)';
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  const note = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave} · ${Math.round(hz)} Hz`;
}
