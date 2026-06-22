// Headless check for the Phase 16 fluid redesign (bucketed scheduler + 4-bit levels +
// flow vectors). Verifies that a source FILLS an enclosed basin FAST, DRAINS when the
// source is removed, forms an INFINITE SOURCE between two sources, settles to a stable
// EQUILIBRIUM, and that flowDir points downhill (and is 0 in air). Models scripts/fire-check.ts.
import { World } from '../src/world/World';
import { Chunk } from '../src/core/Chunk';
import { generateChunk, surfaceHeight, findLandSpawn } from '../src/core/WorldGen';
import { Block } from '../src/core/BlockTypes';
import { MAX_FLUID_OPS_PER_TICK } from '../src/core/constants';
import { levelOf } from '../src/core/fluid';

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
const tickN = (n: number) => {
  for (let i = 0; i < n; i++) world.tickFluids(MAX_FLUID_OPS_PER_TICK);
};

// Build an enclosed basin high above the terrain: a stone floor (R=5), stone walls on the
// border ring, AIR in the 9x9 interior — so water pools 1 deep and can't fall off.
const yF = h + 6; // floor
const yT = yF + 1; // water layer
const R = 5;
for (let dx = -R; dx <= R; dx++)
  for (let dz = -R; dz <= R; dz++) {
    world.editBlock(bx + dx, yF, bz + dz, Block.STONE); // floor
    const border = Math.abs(dx) === R || Math.abs(dz) === R;
    world.editBlock(bx + dx, yT, bz + dz, border ? Block.STONE : Block.AIR); // walls / interior
    world.editBlock(bx + dx, yT + 1, bz + dz, Block.AIR); // headroom (no falling-from-above)
  }

// 1. Fill: a single source fills the whole 9x9 interior, FAST.
world.editBlock(bx, yT, bz, Block.WATER); // source at the centre
const interior = (R - 1) * 2 + 1; // 9
const countWater = (): number => {
  let n = 0;
  for (let dx = -(R - 1); dx <= R - 1; dx++)
    for (let dz = -(R - 1); dz <= R - 1; dz++) if (world.getBlockWorld(bx + dx, yT, bz + dz) === Block.WATER) n++;
  return n;
};
let fillTicks = -1;
for (let i = 0; i < 200; i++) {
  tickN(1);
  if (countWater() === interior * interior) {
    fillTicks = i + 1;
    break;
  }
}
const filled = countWater();
const fillOk = filled === interior * interior && fillTicks >= 0 && fillTicks <= 60;
console.log(`fill: ${filled}/${interior * interior} cells in ${fillTicks} ticks -> ${fillOk ? 'OK' : 'FAIL'}`);
pass &&= fillOk;

// 2. flowDir: at an off-centre flowing cell it points downhill (outward, away from source);
//    in AIR it is zero.
const flow = { x: 0, z: 0 };
world.flowDir(bx + 3, yT, bz, flow);
const flowOk = flow.x > 0.2 && Math.abs(flow.x) > Math.abs(flow.z); // mostly +x (downhill outward)
console.log(`flowDir @+3x: (${flow.x.toFixed(2)},${flow.z.toFixed(2)}) outward -> ${flowOk ? 'OK' : 'FAIL'}`);
pass &&= flowOk;
const air = { x: 0, z: 0 };
world.flowDir(bx, yT + 1, bz, air); // headroom cell = air
const airOk = air.x === 0 && air.z === 0;
console.log(`flowDir in air: (${air.x},${air.z}) -> ${airOk ? 'OK' : 'FAIL'}`);
pass &&= airOk;

// 3. Equilibrium: once filled, more ticks change nothing (no churn).
tickN(40);
const stableOk = countWater() === interior * interior;
console.log(`equilibrium: ${countWater()}/${interior * interior} stable -> ${stableOk ? 'OK' : 'FAIL'}`);
pass &&= stableOk;

// 4. Drain: removing the source empties the basin (flowing water has no feeder).
world.editBlock(bx, yT, bz, Block.AIR);
let drainTicks = -1;
for (let i = 0; i < 300; i++) {
  tickN(1);
  if (countWater() === 0) {
    drainTicks = i + 1;
    break;
  }
}
const drainOk = countWater() === 0 && drainTicks >= 0;
console.log(`drain: ${countWater()} cells left in ${drainTicks} ticks -> ${drainOk ? 'OK' : 'FAIL'}`);
pass &&= drainOk;

// 5. Infinite source: two sources one cell apart over solid -> the gap becomes a SOURCE.
const sx = bx;
const sz = bz;
world.editBlock(sx, yT, sz, Block.WATER); // source A
world.editBlock(sx + 2, yT, sz, Block.WATER); // source B (gap at sx+1)
tickN(40);
const gapBlock = world.getBlockWorld(sx + 1, yT, sz);
const gapFluid = world.getFluidWorld(sx + 1, yT, sz);
const infOk = gapBlock === Block.WATER && levelOf(gapFluid) === 0; // promoted to a source
console.log(`infinite source: gap block=${gapBlock === Block.WATER} level=${levelOf(gapFluid)} -> ${infOk ? 'OK' : 'FAIL'}`);
pass &&= infOk;

console.log(pass ? 'FLUID: PASS' : 'FLUID: FAIL');
process.exit(pass ? 0 : 1);
