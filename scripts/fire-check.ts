// Headless check for the Phase 15.2 fire sim (FireSim, driven via World). Verifies that a
// lit fire emits particle samples, SPREADS to + CONSUMES a flammable (LOG) column, is
// DOUSED next to water, never exceeds MAX_FIRES, and eventually fully burns out (no FIRE
// blocks, zero active fires). Models the other scripts/*-check.ts.
import { World } from '../src/world/World';
import { Chunk } from '../src/core/Chunk';
import { generateChunk, surfaceHeight, findLandSpawn } from '../src/core/WorldGen';
import { Block, BURN_SECONDS } from '../src/core/BlockTypes';
import { MAX_FIRES, FIRE_SEED_DROP } from '../src/core/constants';
import { fireSurfaceY } from '../src/fx/Explosion';

const SEED = 1337;
const spawn = findLandSpawn(SEED);
const bx = Math.floor(spawn.x);
const bz = Math.floor(spawn.z);
const ccx = Math.floor(bx / 16);
const ccz = Math.floor(bz / 16);
const world = new World(SEED);
for (let cz = ccz - 1; cz <= ccz + 1; cz++)
  for (let cx = ccx - 1; cx <= ccx + 1; cx++) {
    const r = generateChunk(cx, cz, SEED);
    world.addChunk(new Chunk(cx, cz, r.data, r.heightMap, r.maxY));
  }
const h = surfaceHeight(bx, bz, SEED);

let pass = true;
let samples = 0;
let flamingSamples = 0;
world.onFireSample = (_x, _y, _z, flaming) => {
  samples++;
  if (flaming) flamingSamples++;
};

// 1. Water douses: a fire can't be lit in a cell bordering water.
world.editBlock(bx + 6, h, bz, Block.WATER);
const beforeWater = world.activeFireCount;
world.ignite(bx + 7, h, bz, 5); // (bx+7,h,bz) borders the water at bx+6 -> refused
const douseOk = world.activeFireCount === beforeWater;
console.log(`water douse: fires ${world.activeFireCount} (was ${beforeWater}) -> ${douseOk ? 'OK' : 'FAIL'}`);
pass &&= douseOk;

// 1b. "Always ignite" surface scan: a canopy/air detonation must still find ground BELOW
//     center-R. Float a LOG stack; a narrow range above it misses (the old bug), but the
//     FIRE_SEED_DROP-extended range reaches the surface.
for (let y = h + 8; y <= h + 12; y++) world.editBlock(bx - 5, y, bz + 5, Block.LOG);
const naiveY = fireSurfaceY(world, bx - 5, bz + 5, h + 15, h + 13); // range above the logs only
const droppedY = fireSurfaceY(world, bx - 5, bz + 5, h + 15, h + 15 - FIRE_SEED_DROP);
const reachOk = naiveY === -1 && droppedY === h + 13; // misses high, finds the log top once dropped
console.log(`surface reach: naive=${naiveY} dropped=${droppedY} (expect -1, ${h + 13}) -> ${reachOk ? 'OK' : 'FAIL'}`);
pass &&= reachOk;

// 2. Build a floating LOG column above the surface, then light a fire beside it.
const colYs = [h + 3, h + 4, h + 5, h + 6];
for (const y of colYs) world.editBlock(bx, y, bz, Block.LOG);
world.editBlock(bx + 1, h + 4, bz, Block.AIR); // ensure the ignition cell is air
const logsBefore = colYs.filter((y) => world.getBlockWorld(bx, y, bz) === Block.LOG).length;
world.ignite(bx + 1, h + 4, bz, 2); // short life so the test resolves quickly

// 2b. forEachFire (Phase 15.3) enumerates exactly the active fires + reports flaming.
let enumerated = 0;
let anyFlaming = false;
world.forEachFire((_x, _y, _z, _age, _life, flaming) => {
  enumerated++;
  if (flaming) anyFlaming = true;
});
const enumOk = enumerated === world.activeFireCount && enumerated >= 1 && anyFlaming;
console.log(`forEachFire: enumerated=${enumerated} activeCount=${world.activeFireCount} flaming=${anyFlaming} -> ${enumOk ? 'OK' : 'FAIL'}`);
pass &&= enumOk;

// 3. Tick the sim. Track peak fire count (spread => >1) and that the cap holds. Run long
//    enough for the slow, long-burning LOG fires (BURN_SECONDS 38 + smolder) to fully end.
let peak = 0;
for (let i = 0; i < 3000; i++) {
  world.tickFires(64);
  peak = Math.max(peak, world.activeFireCount);
}

const logsAfter = colYs.filter((y) => world.getBlockWorld(bx, y, bz) === Block.LOG).length;
const consumed = logsBefore - logsAfter;
const consumeOk = logsBefore === 4 && consumed > 0;
console.log(`consume: logs ${logsBefore} -> ${logsAfter} (consumed ${consumed}) -> ${consumeOk ? 'OK' : 'FAIL'}`);
pass &&= consumeOk;

const spreadOk = peak >= 2;
console.log(`spread: peak active fires=${peak} -> ${spreadOk ? 'OK' : 'FAIL'}`);
pass &&= spreadOk;

const capOk = peak <= MAX_FIRES;
console.log(`cap: peak=${peak} <= MAX_FIRES=${MAX_FIRES} -> ${capOk ? 'OK' : 'FAIL'}`);
pass &&= capOk;

const emitOk = samples > 0 && flamingSamples > 0;
console.log(`emit: samples=${samples} flaming=${flamingSamples} -> ${emitOk ? 'OK' : 'FAIL'}`);
pass &&= emitOk;

// 4. Everything burns out: no active fires + no FIRE blocks left in the column.
let fireBlocks = 0;
for (const y of colYs) if (world.getBlockWorld(bx, y, bz) === Block.FIRE) fireBlocks++;
if (world.getBlockWorld(bx + 1, h + 4, bz) === Block.FIRE) fireBlocks++;
const outOk = world.activeFireCount === 0 && fireBlocks === 0;
console.log(`burn out: active=${world.activeFireCount} fireBlocks=${fireBlocks} -> ${outOk ? 'OK' : 'FAIL'}`);
pass &&= outOk;

// 5. Material model (Phase 15.5): wood burns far longer than grass/bare ground, and a fire
//    on bare STONE with no fuel neighbours never spreads and burns out quickly.
const burnDataOk =
  BURN_SECONDS[Block.LOG] > BURN_SECONDS[Block.TALL_GRASS] && BURN_SECONDS[Block.TALL_GRASS] > BURN_SECONDS[Block.STONE];
console.log(`burn data: log=${BURN_SECONDS[Block.LOG]} grass=${BURN_SECONDS[Block.TALL_GRASS]} stone=${BURN_SECONDS[Block.STONE]} -> ${burnDataOk ? 'OK' : 'FAIL'}`);
pass &&= burnDataOk;

const sx = bx - 8;
const sy = h + 2;
const sz = bz - 8;
// Clear a barren box (no fuel within 2 cells) with a bare stone floor, so a fire here has
// nothing to catch — it must stay put and burn out.
for (let dx = -2; dx <= 2; dx++)
  for (let dz = -2; dz <= 2; dz++) {
    world.editBlock(sx + dx, sy - 1, sz + dz, Block.STONE);
    for (let dy = 0; dy <= 2; dy++) world.editBlock(sx + dx, sy + dy, sz + dz, Block.AIR);
  }
world.ignite(sx, sy, sz, BURN_SECONDS[Block.STONE]);
let stonePeak = 0;
for (let i = 0; i < 600; i++) {
  world.tickFires(64);
  stonePeak = Math.max(stonePeak, world.activeFireCount);
}
const noSpreadOk = stonePeak <= 1 && world.activeFireCount === 0;
console.log(`stone fire: peak=${stonePeak} end=${world.activeFireCount} (no spread, burns out) -> ${noSpreadOk ? 'OK' : 'FAIL'}`);
pass &&= noSpreadOk;

// 6. Torch (Phase 15.8): a placed torch is tracked in the torch registry (its light is now a
//    dynamic GPU shader light, not baked block light), and breaking it removes it.
const tx = bx + 8;
const ty = h + 2;
const tz = bz + 8;
world.editBlock(tx, ty, tz, Block.TORCH);
let foundTorch = false;
world.forEachTorch((x, y, z) => {
  if (x === tx && y === ty && z === tz) foundTorch = true;
});
world.editBlock(tx, ty, tz, Block.AIR); // break it
let stillThere = false;
world.forEachTorch((x, y, z) => {
  if (x === tx && y === ty && z === tz) stillThere = true;
});
const torchOk = foundTorch && !stillThere;
console.log(`torch registry: placed enumerated=${foundTorch} removed-on-break=${!stillThere} -> ${torchOk ? 'OK' : 'FAIL'}`);
pass &&= torchOk;

console.log(pass ? 'FIRE: PASS' : 'FIRE: FAIL');
process.exit(pass ? 0 : 1);
