// Time-of-day model. Owns the phase and derives the sun/moon direction, sky
// gradient + fog colors, the sky-light day factor (drives the already-wired
// uDayFactor), star opacity, and cloud tint. Pure-ish (THREE only for math).

import * as THREE from 'three';
import {
  DAY_CYCLE_SECONDS,
  DAY_START_PHASE,
  FOG_DENSITY_DAY,
  FOG_DENSITY_NIGHT,
} from '../core/constants';

interface Stop {
  e: number; // sun elevation (-1..1)
  zen: number;
  hor: number;
  warm: number;
}

// Sky color keyframes by sun elevation (sRGB hexes). Day horizon == the original
// flat sky color (0x8fc6f0) so noon matches the previous look.
const STOPS: Stop[] = [
  { e: -1.0, zen: 0x05060f, hor: 0x0b1024, warm: 0x1a2b4d },
  { e: -0.06, zen: 0x121a3a, hor: 0x3a2a4a, warm: 0x5a3a5a },
  { e: 0.0, zen: 0x2a3a6b, hor: 0xe9956b, warm: 0xff8a3d },
  { e: 0.18, zen: 0x456fc0, hor: 0xbcd8e8, warm: 0xffd9a0 },
  { e: 0.5, zen: 0x3a7bd5, hor: 0x8fc6f0, warm: 0xfff4d6 },
  { e: 1.0, zen: 0x3a7bd5, hor: 0x8fc6f0, warm: 0xfff4d6 },
];

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class DayNight {
  phase: number;
  paused = false;
  private readonly cycle: number;

  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly moonDir = new THREE.Vector3(0, -1, 0);
  readonly zenith = new THREE.Color();
  readonly horizon = new THREE.Color();
  readonly fogColor = new THREE.Color();
  readonly cloudTint = new THREE.Color();
  dayFactor = 1;
  starOpacity = 0;
  fogDensity = FOG_DENSITY_DAY;
  sunAboveHorizon = true;

  private readonly cA = new THREE.Color();
  private readonly cB = new THREE.Color();

  constructor(cycleSeconds = DAY_CYCLE_SECONDS, startPhase = DAY_START_PHASE) {
    this.cycle = cycleSeconds;
    this.phase = startPhase;
    this.recompute();
  }

  update(dt: number): void {
    if (!this.paused) {
      this.phase = (this.phase + dt / this.cycle) % 1;
      if (this.phase < 0) this.phase += 1;
    }
    this.recompute();
  }

  private sampleStops(e: number, key: 'zen' | 'hor' | 'warm', out: THREE.Color): void {
    let lo = STOPS[0];
    let hi = STOPS[STOPS.length - 1];
    for (let i = 0; i < STOPS.length - 1; i++) {
      if (e >= STOPS[i].e && e <= STOPS[i + 1].e) {
        lo = STOPS[i];
        hi = STOPS[i + 1];
        break;
      }
    }
    const t = hi.e === lo.e ? 0 : (e - lo.e) / (hi.e - lo.e);
    this.cA.set(lo[key]);
    this.cB.set(hi[key]);
    out.copy(this.cA).lerp(this.cB, t);
  }

  private recompute(): void {
    const theta = (this.phase - 0.25) * Math.PI * 2; // 0 at dawn, +pi/2 at noon
    const e = Math.sin(theta);
    this.sunAboveHorizon = e > 0;

    // Sun rides a slightly tilted great circle (nicer for future shadows).
    this.sunDir.set(Math.cos(theta), Math.sin(theta), Math.cos(theta) * 0.35).normalize();
    this.moonDir.copy(this.sunDir).multiplyScalar(-1);

    this.sampleStops(e, 'zen', this.zenith);
    this.sampleStops(e, 'hor', this.horizon);
    const warm = this.cloudTint; // reuse as scratch for warm
    this.sampleStops(e, 'warm', warm);

    // Sun-tinted haze: fog leans warm only near the horizon (dawn/dusk).
    const tint = Math.max(0, Math.min(0.5, 1 - Math.abs(e) * 4));
    this.fogColor.copy(this.horizon).lerp(warm, tint);

    this.dayFactor = Math.max(smoothstep(-0.1, 0.18, e), 0.12);
    this.starOpacity = 1 - smoothstep(-0.05, 0.15, e);
    this.fogDensity = FOG_DENSITY_NIGHT + (FOG_DENSITY_DAY - FOG_DENSITY_NIGHT) * this.dayFactor;

    // Cloud tint: between horizon and white, dimmed at night.
    this.cloudTint.copy(this.horizon).lerp(WHITE, 0.5).multiplyScalar(0.4 + 0.6 * this.dayFactor);
  }
}

const WHITE = new THREE.Color(0xffffff);
