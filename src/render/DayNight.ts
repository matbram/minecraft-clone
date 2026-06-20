// Time-of-day model. Owns the phase and derives the sun/moon direction, sky
// gradient + fog colors, the sky-light day factor (drives the already-wired
// uDayFactor), star opacity, and cloud tint. Pure-ish (THREE only for math).

import * as THREE from 'three';
import {
  DAY_CYCLE_SECONDS,
  DAY_START_PHASE,
  FOG_DENSITY_DAY,
  FOG_DENSITY_NIGHT,
  MOON_LIGHT_STRENGTH,
  NIGHT_AMBIENT,
} from '../core/constants';

interface Stop {
  e: number; // sun elevation (-1..1)
  zen: number;
  hor: number;
  warm: number;
}

// Sky color keyframes by sun elevation (sRGB hexes). Day horizon == the original
// flat sky color (0x8fc6f0) so noon matches the previous look. Phase 7a widened
// the twilight band (extra stops around the horizon) so dawn/dusk linger as a
// gradual gradient instead of flashing past in seconds.
const STOPS: Stop[] = [
  { e: -1.0, zen: 0x05060f, hor: 0x0b1024, warm: 0x1a2b4d },
  { e: -0.15, zen: 0x0f1630, hor: 0x2a2340, warm: 0x4a3050 },
  { e: -0.06, zen: 0x1a2348, hor: 0x6b3a4a, warm: 0x9a4a45 },
  { e: 0.02, zen: 0x2a3a6b, hor: 0xe9956b, warm: 0xff8a3d },
  { e: 0.12, zen: 0x3a5aa0, hor: 0xf0b080, warm: 0xffc890 },
  { e: 0.3, zen: 0x456fc0, hor: 0xbcd8e8, warm: 0xffe9c0 },
  { e: 0.55, zen: 0x3a7bd5, hor: 0x8fc6f0, warm: 0xfff4d6 },
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
  dayFactor = 1; // pure 0..1 day directional sky light (no night floor)
  moonFactor = 0; // directional moonlight at night (0 by day)
  nightAmbient = 0; // faint unshadowed skyglow floor at night
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

    // Sun-tinted haze: fog leans warm near the horizon (dawn/dusk). Widened so
    // the warm cast lingers through a gradual twilight.
    const tint = Math.max(0, Math.min(0.5, 1 - Math.abs(e) * 2.2));
    this.fogColor.copy(this.horizon).lerp(warm, tint);

    // Pure day directional factor (no floor) over a wide twilight band. The night
    // floor moved to nightAmbient so moon shadows can darken below it.
    this.dayFactor = smoothstep(-0.22, 0.3, e);
    // Moon rides opposite the sun; moonFactor is "moon up" (== night) by construction.
    this.moonFactor = MOON_LIGHT_STRENGTH * smoothstep(-0.04, 0.12, this.moonDir.y);
    this.nightAmbient = NIGHT_AMBIENT * (1 - this.dayFactor);
    this.starOpacity = 1 - smoothstep(-0.16, 0.16, e);
    this.fogDensity = FOG_DENSITY_NIGHT + (FOG_DENSITY_DAY - FOG_DENSITY_NIGHT) * this.dayFactor;

    // Cloud tint: between horizon and white, dimmed at night.
    this.cloudTint.copy(this.horizon).lerp(WHITE, 0.5).multiplyScalar(0.4 + 0.6 * this.dayFactor);
  }
}

const WHITE = new THREE.Color(0xffffff);
