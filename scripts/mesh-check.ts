// Headless gate for Phase 18.1 (off-thread meshing): prove the worker path produces
// BYTE-IDENTICAL geometry to the direct main-thread path. The worker reconstructs Chunk
// objects from the shipped neighbour arrays and meshes through a MeshWorld view; here we
// reproduce that (copying arrays like structured clone does) and diff every typed array
// against buildChunkMesh/buildWaterMesh(world, ...). Meshing is THREE-free, so this runs
// under tsx without a real Worker.

import { World } from '../src/world/World';
import { Chunk } from '../src/core/Chunk';
import { generateChunk } from '../src/core/WorldGen';
import { Block } from '../src/core/BlockTypes';
import { buildChunkMesh, type MeshArrays } from '../src/render/ChunkMesh';
import { buildWaterMesh, type WaterMeshArrays } from '../src/render/water/WaterSurfaceMesh';
import { chunkKey } from '../src/world/chunkKey';
import type { MeshWorld } from '../src/render/meshWorld';

const SEED = 1337;
const world = new World(SEED);
// A 3x3 area so the centre chunk (0,0) has all 8 neighbours for seams.
for (let cz = -1; cz <= 1; cz++)
  for (let cx = -1; cx <= 1; cx++) {
    const r = generateChunk(cx, cz, SEED);
    world.addChunk(new Chunk(cx, cz, r.data, r.heightMap, r.maxY, undefined, undefined, r.biomeMap));
  }
for (let cz = -1; cz <= 1; cz++)
  for (let cx = -1; cx <= 1; cx++) world.lightChunk(world.getChunk(cx, cz)!);

// Carve a flowing pool in the centre chunk so the water mesh path (corner heights, flow,
// foam, depth) is actually exercised, not just empty.
const FY = 90;
for (let z = 3; z <= 9; z++)
  for (let x = 3; x <= 9; x++) world.editBlock(x, FY, z, Block.STONE); // floor
for (let z = 4; z <= 8; z++)
  for (let x = 4; x <= 8; x++) world.editBlock(x, FY + 1, z, Block.WATER); // sources on top
for (let i = 0; i < 60; i++) world.tickFluids(1024); // let it spread to varying levels

// Reproduce the worker: rebuild Chunk objects from COPIES of the live arrays + a getChunk view.
function workerView(cx: number, cz: number): MeshWorld {
  const map = new Map<string, Chunk>();
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const c = world.getChunk(cx + dx, cz + dz);
      if (!c) continue;
      const self = dx === 0 && dz === 0;
      map.set(
        chunkKey(c.cx, c.cz),
        new Chunk(
          c.cx,
          c.cz,
          c.data.slice(),
          undefined,
          self ? c.maxY : 0,
          c.light.slice(),
          c.fluid.slice(),
          self ? c.biomeMap.slice() : undefined,
        ),
      );
    }
  return { getChunk: (x, z) => map.get(chunkKey(x, z)) };
}

let pass = true;
function eq(name: string, a: ArrayLike<number> | undefined, b: ArrayLike<number> | undefined): void {
  let ok = (a == null) === (b == null);
  if (ok && a && b) {
    ok = a.length === b.length;
    for (let i = 0; ok && i < a.length; i++) ok = a[i] === b[i];
  }
  if (!ok) pass = false;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} (${a ? a.length : 'null'} vs ${b ? b.length : 'null'})`);
}

function cmpMesh(label: string, a: MeshArrays | null, b: MeshArrays | null): void {
  eq(`${label}.positions`, a?.positions, b?.positions);
  eq(`${label}.normals`, a?.normals, b?.normals);
  eq(`${label}.light`, a?.light, b?.light);
  eq(`${label}.uvs`, a?.uvs, b?.uvs);
  eq(`${label}.wave`, a?.wave, b?.wave);
  eq(`${label}.tint`, a?.tint, b?.tint);
  eq(`${label}.indices`, a?.indices, b?.indices);
}
function cmpWater(label: string, a: WaterMeshArrays | null, b: WaterMeshArrays | null): void {
  eq(`${label}.positions`, a?.positions, b?.positions);
  eq(`${label}.flow`, a?.flow, b?.flow);
  eq(`${label}.light`, a?.light, b?.light);
  eq(`${label}.edge`, a?.edge, b?.edge);
  eq(`${label}.depth`, a?.depth, b?.depth);
  eq(`${label}.indices`, a?.indices, b?.indices);
}

const direct = buildChunkMesh(world, 0, 0);
const directWater = buildWaterMesh(world, 0, 0);
const view = workerView(0, 0);
const worker = buildChunkMesh(view, 0, 0);
const workerWater = buildWaterMesh(view, 0, 0);

cmpMesh('opaque', direct.opaque, worker.opaque);
cmpMesh('transparent', direct.transparent, worker.transparent);
cmpWater('water', directWater, workerWater);

// The carved pool must actually produce water geometry (otherwise the test is vacuous).
const waterExercised = !!directWater && directWater.positions.length > 0;
console.log(`${waterExercised ? 'OK  ' : 'FAIL'} water mesh exercised (verts ${directWater ? directWater.positions.length / 3 : 0})`);
pass &&= waterExercised;

console.log(pass ? 'MESH: PASS' : 'MESH: FAIL');
process.exit(pass ? 0 : 1);
