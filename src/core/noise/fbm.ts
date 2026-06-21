// Fractal noise helpers built on the seeded gradient noise.

import { noise2, noise3 } from './simplex';

export interface FbmOptions {
  octaves: number;
  frequency: number; // base frequency (1/wavelength in world units)
  lacunarity: number; // frequency multiplier per octave
  gain: number; // amplitude multiplier per octave
}

const DEFAULTS: FbmOptions = { octaves: 4, frequency: 1 / 96, lacunarity: 2, gain: 0.5 };

// 2D fractional Brownian motion -> roughly [-1, 1].
export function fbm2(x: number, z: number, seed: number, opts: Partial<FbmOptions> = {}): number {
  const o = { ...DEFAULTS, ...opts };
  let freq = o.frequency;
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < o.octaves; i++) {
    sum += amp * noise2(x * freq, z * freq, seed + i * 1013);
    norm += amp;
    freq *= o.lacunarity;
    amp *= o.gain;
  }
  return sum / norm;
}

// 3D fractional Brownian motion -> roughly [-1, 1].
export function fbm3(
  x: number,
  y: number,
  z: number,
  seed: number,
  opts: Partial<FbmOptions> = {},
): number {
  const o = { ...DEFAULTS, ...opts };
  let freq = o.frequency;
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < o.octaves; i++) {
    sum += amp * noise3(x * freq, y * freq, z * freq, seed + i * 1013);
    norm += amp;
    freq *= o.lacunarity;
    amp *= o.gain;
  }
  return sum / norm;
}

// Ridged noise: 1 - |noise|, biased toward sharp ridges/valleys.
// Used for spaghetti caves: a tunnel runs where the ridge value is near its peak.
export function ridged3(x: number, y: number, z: number, seed: number, frequency: number): number {
  const n = noise3(x * frequency, y * frequency, z * frequency, seed);
  return 1 - Math.abs(n); // peaks (~1) along the zero-crossing surface of the noise
}

// 2D ridged multifractal -> ~[0,1] with sharp mountain ridges (squared per octave).
// Used by the biome system to raise mountain peaks where "mountainousness" is high.
export function ridged2(x: number, z: number, seed: number, opts: Partial<FbmOptions> = {}): number {
  const o = { ...DEFAULTS, ...opts };
  let freq = o.frequency;
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < o.octaves; i++) {
    const n = 1 - Math.abs(noise2(x * freq, z * freq, seed + i * 1013));
    sum += amp * n * n; // square -> sharper ridges
    norm += amp;
    freq *= o.lacunarity;
    amp *= o.gain;
  }
  return sum / norm;
}
