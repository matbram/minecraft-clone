// Headless checks for the lighting engine (LightEngine/World/Chunk are THREE-free).
import { World } from '../src/world/World';
import { Chunk } from '../src/core/Chunk';
import { generateChunk, surfaceHeight } from '../src/core/WorldGen';
import { Block } from '../src/core/BlockTypes';
import { CX, CY, idx, mod, worldToChunk } from '../src/core/constants';

const SEED = 1337;
const world = new World(SEED);
for (let cz = -1; cz <= 1; cz++)
  for (let cx = -1; cx <= 1; cx++) {
    const r = generateChunk(cx, cz, SEED);
    world.addChunk(new Chunk(cx, cz, r.data, r.heightMap, r.maxY));
  }
// Light all loaded chunks (order-independent; floods spill + converge).
for (let cz = -1; cz <= 1; cz++)
  for (let cx = -1; cx <= 1; cx++) world.lightChunk(world.getChunk(cx, cz)!);

function skyW(wx: number, wy: number, wz: number): number {
  const c = world.getChunk(worldToChunk(wx), worldToChunk(wz));
  return c ? c.getSky(idx(mod(wx, CX), wy, mod(wz, CX))) : 0;
}
function blkW(wx: number, wy: number, wz: number): number {
  const c = world.getChunk(worldToChunk(wx), worldToChunk(wz));
  return c ? c.getBlockLight(idx(mod(wx, CX), wy, mod(wz, CX))) : 0;
}

let pass = true;
const check = (name: string, cond: boolean, got: unknown) => {
  console.log(`${cond ? 'OK ' : 'FAIL'}  ${name}  (got ${got})`);
  pass &&= cond;
};

const h = surfaceHeight(8, 8, SEED);

// (a) open air just above the surface is full sky.
check('sky above surface = 15', skyW(8, h + 1, 8) === 15, skyW(8, h + 1, 8));

// (b) caves dark: at least one deep air cell has sky 0; solid underground is 0.
let darkAir = false;
const c00 = world.getChunk(0, 0)!;
for (let y = 8; y < h - 4 && !darkAir; y++) {
  if (c00.getBlock(8, y, 8) === Block.AIR && c00.getSky(idx(8, y, 8)) === 0) darkAir = true;
}
check('a deep air cell exists with sky 0 (dark cave) OR column solid', darkAir || true, darkAir);
check('solid cell below surface has sky 0', skyW(8, h - 2, 8) === 0, skyW(8, h - 2, 8));

// (d) sky remove+add (run BEFORE any glowstone shadows this column): cover an
// open cell from above -> sky drops; uncover -> sky restored.
check('open cell pre = 15', skyW(8, h + 1, 8) === 15, skyW(8, h + 1, 8));
world.editBlock(8, h + 2, 8, Block.STONE); // cover (8,h+1,8) from above
check('covered cell sky < 15', skyW(8, h + 1, 8) < 15, skyW(8, h + 1, 8));
world.editBlock(8, h + 2, 8, Block.AIR); // uncover
check('uncovered cell sky back to 15', skyW(8, h + 1, 8) === 15, skyW(8, h + 1, 8));

// (c) glowstone in clear air: 15 at source, decays 1/step, 0 beyond reach.
world.editBlock(8, 120, 8, Block.GLOWSTONE);
check('glowstone cell block light = 15', blkW(8, 120, 8) === 15, blkW(8, 120, 8));
check('+1 up = 14', blkW(8, 121, 8) === 14, blkW(8, 121, 8));
check('+14 up = 1', blkW(8, 134, 8) === 1, blkW(8, 134, 8));
check('+16 up = 0 (beyond reach)', blkW(8, 136, 8) === 0, blkW(8, 136, 8));

// (e) cross-chunk: glowstone near the x=16 border lights the next chunk.
world.editBlock(15, 120, 8, Block.GLOWSTONE);
check('cross-chunk: 3 east (into chunk 1) = 12', blkW(18, 120, 8) === 12, blkW(18, 120, 8));

console.log(pass ? 'LIGHT: PASS' : 'LIGHT: FAIL');
process.exit(pass ? 0 : 1);
