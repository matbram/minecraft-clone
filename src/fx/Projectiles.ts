// Phase 15: rocket projectiles. A small pooled set of fast-moving meshes fired by
// the rocket launcher. Mirrors the ItemDrops pattern (fixed slots, per-frame
// integrate, cull) but instead of settling, a rocket detonates on the first block
// or creature it hits (or at max range) via the onDetonate callback. Cosmetic mesh
// only — the gameplay blast (crater/knockback/damage) lives in Explosion.ts.

import * as THREE from 'three';
import { IS_SOLID } from '../core/BlockTypes';
import { CY, ROCKET_SPEED, ROCKET_GRAVITY, ROCKET_MAX_RANGE, ROCKET_TRAIL_DT, ROCKET_RADIUS } from '../core/constants';
import type { World } from '../world/World';
import type { Fauna } from '../world/Fauna';

const MAX = 8;
const FORWARD = new THREE.Vector3(0, 0, 1);

interface Rocket {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dist: number; // blocks travelled (for max-range cutoff)
  trailAcc: number; // seconds since the last trail puff
  power: number; // blast power captured at fire time (ammo × tuning)
  mesh: THREE.Mesh;
}

export class Projectiles {
  private readonly slots: Rocket[] = [];
  private readonly world: World;
  private readonly fauna: Fauna;
  private readonly dir = new THREE.Vector3();
  private readonly next = new THREE.Vector3();

  constructor(scene: THREE.Scene, world: World, fauna: Fauna) {
    this.world = world;
    this.fauna = fauna;
    // One shared elongated body (points along +Z) + a warm tip, merged per slot.
    const body = new THREE.BoxGeometry(ROCKET_RADIUS * 2, ROCKET_RADIUS * 2, ROCKET_RADIUS * 5);
    const mat = new THREE.MeshBasicMaterial({ color: 0x2c3036 });
    const tipGeom = new THREE.ConeGeometry(ROCKET_RADIUS * 1.2, ROCKET_RADIUS * 2.4, 8);
    tipGeom.rotateX(Math.PI / 2); // cone points along +Z
    tipGeom.translate(0, 0, ROCKET_RADIUS * 3.7);
    const tipMat = new THREE.MeshBasicMaterial({ color: 0xff6a2a });
    for (let i = 0; i < MAX; i++) {
      const mesh = new THREE.Mesh(body, mat);
      const tip = new THREE.Mesh(tipGeom, tipMat);
      mesh.add(tip);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.slots.push({ active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), dist: 0, trailAcc: 0, power: 1, mesh });
    }
  }

  // Spawn a rocket from `origin` flying along `dir` (need not be normalized). The
  // start is nudged forward so it clears the shooter. `power` is the blast strength to
  // apply on detonation, captured now so changing ammo mid-flight doesn't retro-scale.
  fire(origin: THREE.Vector3, dir: THREE.Vector3, power: number): void {
    let slot = this.slots.find((s) => !s.active);
    if (!slot) slot = this.slots[0]; // pool full -> recycle the oldest
    this.dir.copy(dir);
    if (this.dir.lengthSq() === 0) this.dir.set(0, 0, -1);
    this.dir.normalize();
    slot.active = true;
    slot.dist = 0;
    slot.trailAcc = 0;
    slot.power = power;
    slot.pos.copy(origin).addScaledVector(this.dir, 0.8);
    slot.vel.copy(this.dir).multiplyScalar(ROCKET_SPEED);
    slot.mesh.position.copy(slot.pos);
    slot.mesh.quaternion.setFromUnitVectors(FORWARD, this.dir);
    slot.mesh.visible = true;
  }

  // onTrail spawns a smoke puff at a world point; onDetonate fires the blast at the
  // impact point with the rocket's captured power.
  update(
    dt: number,
    onTrail: (x: number, y: number, z: number) => void,
    onDetonate: (pos: THREE.Vector3, power: number) => void,
  ): void {
    for (const s of this.slots) {
      if (!s.active) continue;

      s.vel.y -= ROCKET_GRAVITY * dt;
      const segLen = s.vel.length() * dt;
      this.dir.copy(s.vel).normalize();
      this.next.copy(s.pos).addScaledVector(s.vel, dt);

      // Block hit: the destination cell is solid (segments are < 1 block at this
      // speed/step, so a per-frame cell test catches walls without tunneling).
      if (IS_SOLID[this.world.getBlockWorld(Math.floor(this.next.x), Math.floor(this.next.y), Math.floor(this.next.z))]) {
        this.detonate(s, this.next, onDetonate);
        continue;
      }

      // Creature hit: nearest along this frame's travel segment.
      const hit = this.fauna.raycast(s.pos, this.dir, segLen);
      if (hit) {
        this.next.copy(s.pos).addScaledVector(this.dir, hit.dist);
        this.detonate(s, this.next, onDetonate);
        continue;
      }

      // Advance.
      s.pos.copy(this.next);
      s.dist += segLen;

      // Smoke trail along the path.
      s.trailAcc += dt;
      while (s.trailAcc >= ROCKET_TRAIL_DT) {
        onTrail(s.pos.x, s.pos.y, s.pos.z);
        s.trailAcc -= ROCKET_TRAIL_DT;
      }

      // Out of the world -> silent despawn; max range -> air burst.
      if (s.pos.y < -64 || s.pos.y >= CY) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      if (s.dist >= ROCKET_MAX_RANGE) {
        this.detonate(s, s.pos, onDetonate);
        continue;
      }

      s.mesh.position.copy(s.pos);
      s.mesh.quaternion.setFromUnitVectors(FORWARD, this.dir);
    }
  }

  private detonate(s: Rocket, at: THREE.Vector3, onDetonate: (pos: THREE.Vector3, power: number) => void): void {
    s.active = false;
    s.mesh.visible = false;
    onDetonate(at, s.power);
  }
}
