// Deterministic, seedable integer hashing -> [0, 1).
// This is the backbone of reproducibility: every "random" decision in world
// generation flows through these so the same seed reproduces the same world.

// 2D hash (per the build spec's bit-mix).
export function hash2(x: number, z: number, seed: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296; // 0..1
}

// 3D hash (extends hash2 with a Y mix), for caves/ore blob seeding.
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 1103515245) ^ Math.imul(z, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 11), 2246822519);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296; // 0..1
}

// Integer-valued hash -> [0, 1) for a single coordinate.
export function hashInt(i: number, seed: number): number {
  let h = (seed ^ Math.imul(i, 2654435761)) | 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = h ^ (h >>> 13);
  return (h >>> 0) / 4294967296;
}
