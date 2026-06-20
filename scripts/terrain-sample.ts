import { generateChunk, surfaceHeight } from '../src/core/WorldGen';
import { CX, CZ, CY, idx, SEA_LEVEL } from '../src/core/constants';
import { Block } from '../src/core/BlockTypes';

const SEED = 1337;
console.log('spawn height(8,8):', surfaceHeight(8, 8, SEED), 'sea level:', SEA_LEVEL);

let min = 999,
  max = -999;
for (let x = -64; x <= 64; x += 4)
  for (let z = -64; z <= 64; z += 4) {
    const h = surfaceHeight(x, z, SEED);
    if (h < min) min = h;
    if (h > max) max = h;
  }
console.log('terrain height range over +-64:', min, '..', max);

// Count blocks + caves in one chunk.
const r = generateChunk(0, 0, SEED);
const counts: Record<number, number> = {};
let airBelowSurface = 0;
for (let lz = 0; lz < CZ; lz++)
  for (let lx = 0; lx < CX; lx++) {
    const h = surfaceHeight(lx, lz, SEED);
    for (let y = 0; y < CY; y++) {
      const b = r.data[idx(lx, y, lz)];
      counts[b] = (counts[b] || 0) + 1;
      if (b === Block.AIR && y > 1 && y < h) airBelowSurface++;
    }
  }
console.log('block counts chunk(0,0):', counts);
console.log('air pockets below surface (caves):', airBelowSurface);
console.log('maxY:', r.maxY, 'features:', r.features.length);
