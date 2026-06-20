// Seeded gradient (Perlin-style) value noise in 2D and 3D, returning [-1, 1].
//
// We avoid heavy simplex tables in favor of a compact hash-gradient Perlin that
// is fully deterministic from (coords, seed) and worker-safe. Quality is plenty
// for terrain heightmaps and caves.

import { hash2, hash3 } from './hash';

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// 2D gradient from a hashed angle.
function grad2(ix: number, iz: number, fx: number, fz: number, seed: number): number {
  const a = hash2(ix, iz, seed) * Math.PI * 2;
  return Math.cos(a) * fx + Math.sin(a) * fz;
}

// 2D Perlin noise -> [-1, 1] (approx; gradient noise stays well within).
export function noise2(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const x1 = x0 + 1;
  const z1 = z0 + 1;
  const fx = x - x0;
  const fz = z - z0;
  const u = fade(fx);
  const v = fade(fz);

  const n00 = grad2(x0, z0, fx, fz, seed);
  const n10 = grad2(x1, z0, fx - 1, fz, seed);
  const n01 = grad2(x0, z1, fx, fz - 1, seed);
  const n11 = grad2(x1, z1, fx - 1, fz - 1, seed);

  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

// 3D gradient from a hashed direction on the unit sphere.
function grad3(
  ix: number,
  iy: number,
  iz: number,
  fx: number,
  fy: number,
  fz: number,
  seed: number,
): number {
  // Two hashes -> spherical direction.
  const theta = hash3(ix, iy, iz, seed) * Math.PI * 2;
  const phi = Math.acos(2 * hash3(ix, iy, iz, seed ^ 0x9e3779b9) - 1);
  const gx = Math.sin(phi) * Math.cos(theta);
  const gy = Math.sin(phi) * Math.sin(theta);
  const gz = Math.cos(phi);
  return gx * fx + gy * fy + gz * fz;
}

// 3D Perlin noise -> [-1, 1].
export function noise3(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const z1 = z0 + 1;
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;
  const u = fade(fx);
  const v = fade(fy);
  const w = fade(fz);

  const n000 = grad3(x0, y0, z0, fx, fy, fz, seed);
  const n100 = grad3(x1, y0, z0, fx - 1, fy, fz, seed);
  const n010 = grad3(x0, y1, z0, fx, fy - 1, fz, seed);
  const n110 = grad3(x1, y1, z0, fx - 1, fy - 1, fz, seed);
  const n001 = grad3(x0, y0, z1, fx, fy, fz - 1, seed);
  const n101 = grad3(x1, y0, z1, fx - 1, fy, fz - 1, seed);
  const n011 = grad3(x0, y1, z1, fx, fy - 1, fz - 1, seed);
  const n111 = grad3(x1, y1, z1, fx - 1, fy - 1, fz - 1, seed);

  const x00 = lerp(n000, n100, u);
  const x10 = lerp(n010, n110, u);
  const x01 = lerp(n001, n101, u);
  const x11 = lerp(n011, n111, u);
  const y0v = lerp(x00, x10, v);
  const y1v = lerp(x01, x11, v);
  return lerp(y0v, y1v, w);
}
