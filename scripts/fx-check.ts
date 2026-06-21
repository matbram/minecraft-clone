// Headless check for ItemDrops physics: a dropped item must fall, settle ON the
// ground (not tunnel through), and get picked up when the player is near.
import * as THREE from 'three';
import { World } from '../src/world/World';
import { Chunk } from '../src/core/Chunk';
import { generateChunk, surfaceHeight, findLandSpawn } from '../src/core/WorldGen';
import { ItemDrops } from '../src/fx/ItemDrops';
import { Block, IS_SOLID } from '../src/core/BlockTypes';

const SEED = 1337;
// Pick a dry-land column (worldgen has ~30-40% ocean) and generate chunks around it.
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

const scene = new THREE.Scene();
const drops = new ItemDrops(scene, world, new THREE.Texture());
const h = surfaceHeight(bx, bz, SEED);

let pass = true;
const far = new THREE.Vector3(1000, 1000, 1000);

// 1. Drop falls and settles ON the ground (center ~ topSolidY + 1 + SIZE/2 =
//    topSolidY + 1.125), not tunneling through. spawn() applies a random pop in a
//    random direction, so the item may drift to a neighbouring column — compute
//    the expected rest height from the item's FINAL column, not the spawn column.
void h; // (surfaceHeight kept for reference; rest height is column-local below)
drops.spawn(Block.STONE, bx + 0.5, h + 5, bz + 0.5);
for (let i = 0; i < 240; i++) drops.update(1 / 60, far, () => {});
const visible = scene.children.filter((c) => (c as THREE.Mesh).isMesh && c.visible) as THREE.Mesh[];
const drop = visible[0];
let settled = false;
let expect = NaN;
if (visible.length === 1 && drop) {
  const fx = Math.floor(drop.position.x);
  const fz = Math.floor(drop.position.z);
  // Mirror ItemDrops' settle math (ItemDrops.ts): support cell = floor(y - SIZE/2 -
  // 0.02), rest y = supportCell + 1 + SIZE/2. SIZE/2 = 0.125.
  const sc = Math.floor(drop.position.y - 0.125 - 0.02);
  expect = sc + 1.125;
  settled = IS_SOLID[world.getBlockWorld(fx, sc, fz)] && Math.abs(drop.position.y - expect) < 0.06;
}
console.log(`settle: visible=${visible.length} y=${drop?.position.y.toFixed(3)} expect~${expect.toFixed(3)} -> ${settled ? 'OK' : 'FAIL'}`);
pass &&= settled;

// 2. Player near -> pickup fires and the drop disappears. Stand at the item's
//    ACTUAL settled position (it may have drifted from the spawn column via the
//    random pop), so this tests the pickup, not the scatter distance.
let picked = false;
const near = drop
  ? new THREE.Vector3(drop.position.x, drop.position.y + 1.5, drop.position.z)
  : new THREE.Vector3(bx + 0.5, h + 1.5, bz + 0.5);
for (let i = 0; i < 30 && !picked; i++) drops.update(1 / 60, near, () => (picked = true));
const stillVisible = scene.children.filter((c) => (c as THREE.Mesh).isMesh && c.visible).length;
const pickupOk = picked && stillVisible === 0;
console.log(`pickup: picked=${picked} stillVisible=${stillVisible} -> ${pickupOk ? 'OK' : 'FAIL'}`);
pass &&= pickupOk;

console.log(pass ? 'FX: PASS' : 'FX: FAIL');
process.exit(pass ? 0 : 1);
