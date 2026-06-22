// Headless check for Phase 15 rocket projectiles + blast particles (the parts that
// don't need the DOM). Verifies a fired rocket trails smoke and detonates on the
// ground (not a creature), and that the additive blast-particle pool fills then
// drains. The explosion gameplay (crater/knockback/damage) is exercised in-game —
// it goes through Effects, which needs a canvas, so it can't run headless.
import * as THREE from 'three';
import { World } from '../src/world/World';
import { Chunk } from '../src/core/Chunk';
import { generateChunk, surfaceHeight, findLandSpawn } from '../src/core/WorldGen';
import { Fauna } from '../src/world/Fauna';
import { Projectiles } from '../src/fx/Projectiles';
import { BlastParticles } from '../src/fx/BlastParticles';
import { Block } from '../src/core/BlockTypes';

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

const scene = new THREE.Scene();
const fauna = new Fauna(scene, world);
const projectiles = new Projectiles(scene, world, fauna);
const h = surfaceHeight(bx, bz, SEED);

let pass = true;

// 1. Fire straight down from above the surface -> the rocket should trail smoke and
//    detonate on the ground (creatureIdx -1), at roughly the surface height.
let trail = 0;
let detonated = false;
let hitPower = 0;
let hitY = NaN;
projectiles.fire(new THREE.Vector3(bx + 0.5, h + 20, bz + 0.5), new THREE.Vector3(0, -1, 0), 1);
for (let i = 0; i < 120 && !detonated; i++) {
  projectiles.update(
    1 / 60,
    () => trail++,
    (pos, power) => {
      detonated = true;
      hitPower = power;
      hitY = pos.y;
    },
  );
}
const groundOk = detonated && hitPower === 1 && trail > 0 && hitY > h - 2 && hitY < h + 2;
console.log(`rocket: detonated=${detonated} power=${hitPower} trail=${trail} y=${hitY.toFixed(2)} (ground~${h}) -> ${groundOk ? 'OK' : 'FAIL'}`);
pass &&= groundOk;

// 2. Blast particles: a burst fills the pooled Points (drawRange > 0), and after the
//    particles' lifetime it drains back to 0 (swap-remove cleanup works).
const bp = new BlastParticles(scene, true, 100);
bp.burst(0, 0, 0, [[1, 0.8, 0.3]], { count: 20, speed: 4, life: 0.4, size: 1 });
bp.update(1 / 60);
const pts = scene.children.find((c) => (c as THREE.Points).isPoints) as THREE.Points;
const filled = pts ? pts.geometry.drawRange.count : 0;
for (let i = 0; i < 60; i++) bp.update(1 / 60); // > life -> all expire
const drained = pts ? pts.geometry.drawRange.count : -1;
const partsOk = filled === 20 && drained === 0;
console.log(`blast particles: filled=${filled} drained=${drained} -> ${partsOk ? 'OK' : 'FAIL'}`);
pass &&= partsOk;

// 3. World.bulkEdit (Phase 15.1): carve a radius-18 sphere across chunk borders. Every
//    solid in range becomes AIR, and each affected chunk is relit ONCE (onRelight ->
//    clearLight), proving the no-freeze bulk path + cross-chunk fan-out.
for (const c of world.chunks.values()) c.lit = true; // pretend they're lit so we see clears
const relit = new Set<string>();
world.onRelight = (cx, cz) => {
  relit.add(`${cx},${cz}`);
  world.getChunk(cx, cz)?.clearLight();
};
const R = 18;
const craterCells: { x: number; y: number; z: number; type: Block }[] = [];
for (let y = h - R; y <= h + R; y++)
  for (let x = bx - R; x <= bx + R; x++)
    for (let z = bz - R; z <= bz + R; z++) {
      const dx = x + 0.5 - bx;
      const dy = y + 0.5 - h;
      const dz = z + 0.5 - bz;
      if (dx * dx + dy * dy + dz * dz > R * R) continue;
      const b = world.getBlockWorld(x, y, z);
      if (b !== Block.AIR && b !== Block.WATER && b !== Block.BEDROCK) craterCells.push({ x, y, z, type: Block.AIR });
    }
const carved = craterCells.length;
world.bulkEdit(craterCells, true);
let stillSolid = 0;
for (const c of craterCells) if (world.getBlockWorld(c.x, c.y, c.z) !== Block.AIR) stillSolid++;
let allCleared = true;
for (const key of relit) {
  const [cx, cz] = key.split(',').map(Number);
  if (world.getChunk(cx, cz)?.lit) allCleared = false;
}
const bulkOk = carved > 0 && stillSolid === 0 && relit.size >= 2 && allCleared;
console.log(`bulkEdit: carved=${carved} stillSolid=${stillSolid} chunksRelit=${relit.size} cleared=${allCleared} -> ${bulkOk ? 'OK' : 'FAIL'}`);
pass &&= bulkOk;

console.log(pass ? 'ROCKET: PASS' : 'ROCKET: FAIL');
process.exit(pass ? 0 : 1);
