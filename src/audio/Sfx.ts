// Procedural Web Audio sound effects. No bundled assets — everything is
// synthesized (oscillators + noise + filters + envelopes). Behind ISfx so a
// sample-file backend could replace it later without touching callers.

import { Block, HARDNESS } from '../core/BlockTypes';
import { SPEED_OF_SOUND } from '../core/constants';

export interface ISfx {
  resume(): void;
  setMuted(m: boolean): void;
  playBreak(block: Block): void;
  playPlace(block: Block): void;
  playStep(block: Block): void;
  playPickup(): void;
  ambience(on: boolean): void;
  setSubmerged(on: boolean): void;
  playSplash(): void;
  playBubble(): void;
  playExplosion(distBlocks: number, power?: number): void;
  startFlameroar(): void;
  stopFlameroar(): void;
}

const MASTER_GAIN = 0.35;
const AMBIENCE_GAIN = 0.03;
const STEP_GAIN = 0.12;
const PICKUP_GAIN = 0.18;
const PLACE_GAIN = 0.5;
const BREAK_GAIN = 0.8;
// Phase 11.5: underwater. A master low-pass muffles everything below; a deeper
// ambience loop replaces the surface one; plus splash + bubble cues.
const LPF_OPEN = 22000; // ~bypass above water
const LPF_UNDERWATER = 700; // muffled below water
const UW_AMBIENCE_GAIN = 0.05;
const SPLASH_GAIN = 0.5;
const BUBBLE_GAIN = 0.12;
const BOOM_GAIN = 1.1; // explosion is the loudest cue (scaled by MASTER_GAIN like the rest)

export class Sfx implements ISfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lpf: BiquadFilterNode | null = null; // master low-pass (underwater muffle)
  private noise: AudioBuffer | null = null;
  private muted = false;
  private ambienceWanted = false;
  private submerged = false;
  private amb: { src: AudioBufferSourceNode; lfo: OscillatorNode } | null = null;
  private uwAmb: { src: AudioBufferSourceNode; lfo: OscillatorNode } | null = null;
  private flame: { src: AudioBufferSourceNode; lfo: OscillatorNode; gain: GainNode } | null = null;

  // Create the context only inside a user gesture (autoplay policy).
  resume(): void {
    if (!this.ctx) {
      const AC: typeof AudioContext =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
      // Everything routes master -> lpf -> destination, so the one filter muffles
      // all sfx + ambience underwater.
      this.lpf = this.ctx.createBiquadFilter();
      this.lpf.type = 'lowpass';
      this.lpf.frequency.value = this.submerged ? LPF_UNDERWATER : LPF_OPEN;
      this.master.connect(this.lpf).connect(this.ctx.destination);
      this.noise = this.makeNoise(0.5);
      if (this.ambienceWanted) {
        if (this.submerged) this.startUwAmbience();
        else this.startAmbience();
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  // Phase 11.5: toggle the underwater muffle + ambience swap. Safe to call before
  // audio starts (state is stored and applied in resume()).
  setSubmerged(on: boolean): void {
    if (on === this.submerged) return;
    this.submerged = on;
    if (this.lpf && this.ctx) {
      this.lpf.frequency.setTargetAtTime(on ? LPF_UNDERWATER : LPF_OPEN, this.ctx.currentTime, 0.1);
    }
    if (!this.ctx || !this.ambienceWanted) return;
    if (on) {
      this.stopAmbience();
      this.startUwAmbience();
    } else {
      this.stopUwAmbience();
      this.startAmbience();
    }
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
    if (on && this.ctx && !this.amb && !this.uwAmb) {
      if (this.submerged) this.startUwAmbience();
      else this.startAmbience();
    } else if (!on) {
      this.stopAmbience();
      this.stopUwAmbience();
    }
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

  // Phase 15.5: flamethrower roar — a looping filtered-noise whoosh with a fast attack and a
  // flicker LFO, started while firing and faded out on release. No-op until audio resumes.
  startFlameroar(): void {
    if (!this.ctx || !this.master || !this.noise || this.flame) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.9;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 120;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.08); // fast whoosh-in
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 11; // crackly flicker
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.05;
    lfo.connect(lfoGain).connect(gain.gain);
    src.connect(hp).connect(lp).connect(gain).connect(this.master);
    src.start();
    lfo.start();
    this.flame = { src, lfo, gain };
  }

  stopFlameroar(): void {
    if (!this.flame || !this.ctx) return;
    const f = this.flame;
    this.flame = null;
    try {
      f.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      f.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05);
      f.src.stop(this.ctx.currentTime + 0.2);
      f.lfo.stop(this.ctx.currentTime + 0.2);
    } catch {
      /* already stopped */
    }
  }

  // Deep, slow-swelling rumble that replaces the surface ambience while submerged.
  private startUwAmbience(): void {
    if (!this.ctx || !this.master || !this.noise || this.uwAmb) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.6; // slow it down -> lower, heavier
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 120;
    const gain = ctx.createGain();
    gain.gain.value = UW_AMBIENCE_GAIN;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain).connect(gain.gain);
    src.connect(lp).connect(gain).connect(this.master);
    src.start();
    lfo.start();
    this.uwAmb = { src, lfo };
  }

  private stopUwAmbience(): void {
    if (!this.uwAmb) return;
    try {
      this.uwAmb.src.stop();
      this.uwAmb.lfo.stop();
    } catch {
      /* already stopped */
    }
    this.uwAmb = null;
  }

  // Splash: a short filtered-noise burst with a fast downward cutoff sweep. Played
  // when the eye crosses the water surface (both entering and exiting).
  playSplash(): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.setValueAtTime(3200, t);
    bp.frequency.exponentialRampToValueAtTime(380, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(SPLASH_GAIN, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.3);
    src.stop(t + 0.4);
  }

  // Bubble: 1-3 short sine blips sweeping up in pitch. Played occasionally while
  // submerged (and when bubble particles spawn).
  playBubble(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 0.05 + Math.random() * 0.03;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const f0 = 300 + Math.random() * 400;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * 2.2, t + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(BUBBLE_GAIN, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.12);
    }
  }

  // Phase 15/15.1: explosion — a sharp HF crack, a deep low boom thump, and a filtered
  // noise rumble tail. Delayed by distance/speed-of-sound so a far blast flashes first and
  // booms a moment later. `power` (≈1..8) deepens the boom + lengthens the rumble for
  // bigger warheads.
  playExplosion(distBlocks: number, power = 1): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const ctx = this.ctx;
    const p = Math.max(0.5, Math.min(8, power));
    const t = ctx.currentTime + Math.max(0, distBlocks) / SPEED_OF_SOUND;
    const tail = 1.4 + p * 0.25; // rumble length grows with size

    // Crack: bright high-passed noise burst (the leading edge).
    const crack = ctx.createBufferSource();
    crack.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2200;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(BOOM_GAIN * 0.8, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    crack.connect(hp).connect(cg).connect(this.master);
    crack.start(t, Math.random() * 0.2);
    crack.stop(t + 0.2);

    // Boom: deep sine thump sweeping down in pitch (deeper for bigger blasts).
    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(120 / Math.sqrt(p), t);
    boom.frequency.exponentialRampToValueAtTime(35 / Math.sqrt(p), t + 0.5);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(BOOM_GAIN * Math.min(1.5, 0.9 + p * 0.1), t + 0.012);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.5 + p * 0.1);
    boom.connect(bg).connect(this.master);
    boom.start(t);
    boom.stop(t + 0.6 + p * 0.1);

    // Rumble tail: low-passed, slowed noise that lingers.
    const rum = ctx.createBufferSource();
    rum.buffer = this.noise;
    rum.loop = true;
    rum.playbackRate.value = 0.7;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, t + 0.02);
    rg.gain.exponentialRampToValueAtTime(BOOM_GAIN * 0.5, t + 0.09);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + tail);
    rum.connect(lp).connect(rg).connect(this.master);
    rum.start(t);
    rum.stop(t + tail + 0.1);
  }
}
