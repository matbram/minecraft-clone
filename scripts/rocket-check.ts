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
let hitIdx = 99;
let hitY = NaN;
projectiles.fire(new THREE.Vector3(bx + 0.5, h + 20, bz + 0.5), new THREE.Vector3(0, -1, 0));
for (let i = 0; i < 120 && !detonated; i++) {
  projectiles.update(
    1 / 60,
    () => trail++,
    (pos, idx) => {
      detonated = true;
      hitIdx = idx;
      hitY = pos.y;
    },
  );
}
const groundOk = detonated && hitIdx === -1 && trail > 0 && hitY > h - 2 && hitY < h + 2;
console.log(`rocket: detonated=${detonated} idx=${hitIdx} trail=${trail} y=${hitY.toFixed(2)} (ground~${h}) -> ${groundOk ? 'OK' : 'FAIL'}`);
pass &&= groundOk;

// 2. Blast particles: a burst fills the pooled Points (drawRange > 0), and after the
//    particles' lifetime it drains back to 0 (swap-remove cleanup works).
const bp = new BlastParticles(scene, true, 0.5, 100);
bp.burst(0, 0, 0, [[1, 0.8, 0.3]], { count: 20, speed: 4, life: 0.4 });
bp.update(1 / 60);
const pts = scene.children.find((c) => (c as THREE.Points).isPoints) as THREE.Points;
const filled = pts ? pts.geometry.drawRange.count : 0;
for (let i = 0; i < 60; i++) bp.update(1 / 60); // > life -> all expire
const drained = pts ? pts.geometry.drawRange.count : -1;
const partsOk = filled === 20 && drained === 0;
console.log(`blast particles: filled=${filled} drained=${drained} -> ${partsOk ? 'OK' : 'FAIL'}`);
pass &&= partsOk;

console.log(pass ? 'ROCKET: PASS' : 'ROCKET: FAIL');
process.exit(pass ? 0 : 1);
