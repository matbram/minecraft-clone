// Procedural Web Audio sound effects. No bundled assets — everything is
// synthesized (oscillators + noise + filters + envelopes). Behind ISfx so a
// sample-file backend could replace it later without touching callers.

import { Block, HARDNESS } from '../core/BlockTypes';

export interface ISfx {
  resume(): void;
  setMuted(m: boolean): void;
  playBreak(block: Block): void;
  playPlace(block: Block): void;
  playStep(block: Block): void;
  playPickup(): void;
  ambience(on: boolean): void;
}

const MASTER_GAIN = 0.35;
const AMBIENCE_GAIN = 0.03;
const STEP_GAIN = 0.12;
const PICKUP_GAIN = 0.18;
const PLACE_GAIN = 0.5;
const BREAK_GAIN = 0.8;

export class Sfx implements ISfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private ambienceWanted = false;
  private amb: { src: AudioBufferSourceNode; lfo: OscillatorNode } | null = null;

  // Create the context only inside a user gesture (autoplay policy).
  resume(): void {
    if (!this.ctx) {
      const AC: typeof AudioContext =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
      this.master.connect(this.ctx.destination);
      this.noise = this.makeNoise(0.5);
      if (this.ambienceWanted) this.startAmbience();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.02);
    }
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private hard(block: Block): number {
    const h = HARDNESS[block];
    return Math.max(0, Math.min(2.5, Number.isFinite(h) ? h : 2.0));
  }

  playBreak(block: Block): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const hard = this.hard(block);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.16;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2000 - hard * 350;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    const decay = 0.1 + hard * 0.03;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(BREAK_GAIN, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.004 + decay);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.4);
    src.stop(t + 0.05 + decay);
  }

  playPlace(block: Block): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const base = 140 - this.hard(block) * 10;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(base * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(base, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(PLACE_GAIN, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.12);

    // Soft tap on top of the thunk.
    const tick = ctx.createBufferSource();
    tick.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.15, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    tick.connect(lp).connect(tg).connect(this.master);
    tick.start(t, Math.random() * 0.4);
    tick.stop(t + 0.05);
  }

  playStep(block: Block): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.3;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = this.stepFreq(block);
    const g = ctx.createGain();
    g.gain.setValueAtTime(STEP_GAIN, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.4);
    src.stop(t + 0.06);
  }

  private stepFreq(block: Block): number {
    switch (block) {
      case Block.STONE:
      case Block.GRAVEL:
      case Block.COAL_ORE:
      case Block.IRON_ORE:
      case Block.GOLD_ORE:
      case Block.BEDROCK:
        return 1100;
      case Block.SAND:
        return 700;
      case Block.LOG:
        return 850;
      default:
        return 600; // grass / dirt / leaves
    }
  }

  playPickup(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.exponentialRampToValueAtTime(990, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(PICKUP_GAIN, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  ambience(on: boolean): void {
    this.ambienceWanted = on;
    if (on && this.ctx && !this.amb) this.startAmbience();
    else if (!on && this.amb) this.stopAmbience();
  }

  private startAmbience(): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 200;
    const gain = ctx.createGain();
    gain.gain.value = AMBIENCE_GAIN;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain).connect(gain.gain);
    src.connect(lp).connect(gain).connect(this.master);
    src.start();
    lfo.start();
    this.amb = { src, lfo };
  }

  private stopAmbience(): void {
    if (!this.amb) return;
    try {
      this.amb.src.stop();
      this.amb.lfo.stop();
    } catch {
      /* already stopped */
    }
    this.amb = null;
  }
}
