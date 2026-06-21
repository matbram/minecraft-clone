// Headless checks for collision (lands flush + onGround), jumping, and the voxel
// raycast — the correctness core of Phase 1. Uses a stub Input (no DOM).
import * as THREE from 'three';
import { World } from '../src/world/World';
import { Chunk } from '../src/core/Chunk';
import { generateChunk, surfaceHeight, findLandSpawn } from '../src/core/WorldGen';
import { Player } from '../src/player/Player';
import type { Input } from '../src/player/Input';
import { raycastVoxel } from '../src/interaction/Raycast';
import { JUMP_VELOCITY } from '../src/core/constants';

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

function stub(keys: Record<string, boolean> = {}): Input {
  return { locked: true, yaw: 0, pitch: 0, isDown: (c: string) => !!keys[c] } as unknown as Input;
}

const h = surfaceHeight(bx, bz, SEED);
let pass = true;

// 1. Falls and lands flush on the surface, onGround true.
const p = new Player(world, stub(), new THREE.Vector3(bx + 0.5, h + 6, bz + 0.5));
for (let i = 0; i < 200; i++) {
  p.prevPos.copy(p.pos);
  p.tick(1 / 20);
}
const restOk = p.onGround && Math.abs(p.pos.y - (h + 1)) < 0.05;
console.log(`land: y=${p.pos.y.toFixed(3)} expected~${h + 1} onGround=${p.onGround} -> ${restOk ? 'OK' : 'FAIL'}`);
pass &&= restOk;

// 2. No tunneling from a high fast fall (start 60 blocks up).
const p2 = new Player(world, stub(), new THREE.Vector3(bx + 0.5, h + 60, bz + 0.5));
for (let i = 0; i < 400; i++) {
  p2.prevPos.copy(p2.pos);
  p2.tick(1 / 20);
}
const fallOk = p2.onGround && Math.abs(p2.pos.y - (h + 1)) < 0.05 && p2.pos.y > h;
console.log(`fast fall: y=${p2.pos.y.toFixed(3)} onGround=${p2.onGround} -> ${fallOk ? 'OK' : 'FAIL'}`);
pass &&= fallOk;

// 3. Jump: held Space from grounded -> leaves the ground, peak ~JUMP^2/(2g) above rest.
const pj = new Player(world, stub({ Space: true }), new THREE.Vector3(bx + 0.5, h + 1.5, bz + 0.5));
let maxY = -Infinity;
for (let i = 0; i < 80; i++) {
  pj.prevPos.copy(pj.pos);
  pj.tick(1 / 20);
  maxY = Math.max(maxY, pj.pos.y);
}
const jumpRise = maxY - (h + 1);
const jumpOk = jumpRise > 0.8 && jumpRise < 2.0; // ~1.29 expected
console.log(`jump: peak rise=${jumpRise.toFixed(2)} (expect ~${(JUMP_VELOCITY * JUMP_VELOCITY / 56).toFixed(2)}) -> ${jumpOk ? 'OK' : 'FAIL'}`);
pass &&= jumpOk;

// 4. Walls: walking +X into a placed solid column stops flush (no penetration).
const wallX = bx + 3;
world.editBlock(wallX, h + 1, bz, 1 /* STONE */);
const pw = new Player(world, stub({ KeyD: true }), new THREE.Vector3(bx + 0.5, h + 1, bz + 0.5)); // KeyD = +X with yaw 0
for (let i = 0; i < 100; i++) {
  pw.prevPos.copy(pw.pos);
  pw.tick(1 / 20);
}
const wallOk = pw.pos.x <= wallX - 0.3 + 1e-2; // maxX must not enter the block at wallX
console.log(`wall stop: x=${pw.pos.x.toFixed(3)} (block at x=${wallX}) -> ${wallOk ? 'OK' : 'FAIL'}`);
pass &&= wallOk;

// 5. Raycast straight down hits the surface cell with an upward face normal.
world.editBlock(bx, h + 1, bz, 0); // clear any decorative plant so the ray reaches ground
const hit = raycastVoxel(world, new THREE.Vector3(bx + 0.5, h + 5, bz + 0.5), new THREE.Vector3(0, -1, 0), 20);
const rayOk = !!hit && hit.cell.y === h && hit.normal.y === 1 && hit.place.y === h + 1;
console.log(`raycast down: ${hit ? `cell.y=${hit.cell.y} normal.y=${hit.normal.y}` : 'null'} -> ${rayOk ? 'OK' : 'FAIL'}`);
pass &&= rayOk;

console.log(pass ? 'PHYSICS: PASS' : 'PHYSICS: FAIL');
process.exit(pass ? 0 : 1);
