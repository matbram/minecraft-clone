// Cosmetic dropped-block items: small textured cubes that pop out of a broken
// block, fall, spin/bob, get attracted to the player, and vanish on pickup.
//
// Creative build = infinite hotbar, so pickup is purely feel (no counts). A
// survival build (Phase 6) would route the onPickup callback into a counted
// inventory instead of just playing a sound.

import * as THREE from 'three';
import { Block, IS_SOLID, ATLAS_COLS, tileOf } from '../core/BlockTypes';
import { ATLAS_ROWS } from '../render/atlas';
import type { World } from '../world/World';

const MAX = 48;
const SIZE = 0.25;
const POP_UP = 4;
const POP_H = 2;
const GRAVITY = 18;
const SPIN = 1.6;
const BOB_AMP = 0.04;
const BOB_FREQ = 3;
const ATTRACT_R = 2.2;
const ATTRACT_SPEED = 8;
const PICKUP_R = 0.6;
const LIFE = 15;

interface Slot {
  active: boolean;
  age: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  mesh: THREE.Mesh;
}

export class ItemDrops {
  private readonly slots: Slot[] = [];
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly geomCache = new Map<Block, THREE.BufferGeometry>();
  private readonly placeholder: THREE.BufferGeometry;
  private readonly world: World;

  constructor(scene: THREE.Scene, world: World, atlasTexture: THREE.Texture) {
    this.world = world;
    this.mat = new THREE.MeshBasicMaterial({ map: atlasTexture });
    this.placeholder = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
    for (let i = 0; i < MAX; i++) {
      const mesh = new THREE.Mesh(this.placeholder, this.mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.slots.push({
        active: false,
        age: 0,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        mesh,
      });
    }
  }

  // Box geometry whose 6 faces sample this block's atlas tiles. Cached per block.
  private geomFor(block: Block): THREE.BufferGeometry {
    const cached = this.geomCache.get(block);
    if (cached) return cached;
    const g = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let f = 0; f < 6; f++) {
      const tile = tileOf(block, f);
      const col = tile % ATLAS_COLS;
      const row = Math.floor(tile / ATLAS_COLS);
      const u0 = col / ATLAS_COLS;
      const u1 = (col + 1) / ATLAS_COLS;
      const v0 = row / ATLAS_ROWS;
      const v1 = (row + 1) / ATLAS_ROWS;
      for (let k = 0; k < 4; k++) {
        const vi = f * 4 + k;
        const ux = uv.getX(vi);
        const uy = uv.getY(vi);
        uv.setXY(vi, u0 + ux * (u1 - u0), v0 + (1 - uy) * (v1 - v0));
      }
    }
    uv.needsUpdate = true;
    this.geomCache.set(block, g);
    return g;
  }

  spawn(block: Block, x: number, y: number, z: number): void {
    let slot = this.slots.find((s) => !s.active);
    if (!slot) slot = this.slots[0]; // pool full -> recycle the oldest slot
    slot.active = true;
    slot.age = 0;
    slot.pos.set(x, y, z);
    const ang = Math.random() * Math.PI * 2;
    slot.vel.set(Math.cos(ang) * POP_H * Math.random(), POP_UP, Math.sin(ang) * POP_H * Math.random());
    slot.mesh.geometry = this.geomFor(block);
    slot.mesh.position.copy(slot.pos);
    slot.mesh.rotation.set(0, Math.random() * Math.PI * 2, 0);
    slot.mesh.visible = true;
  }

  update(dt: number, playerEye: THREE.Vector3, onPickup: () => void): void {
    for (const s of this.slots) {
      if (!s.active) continue;
      s.age += dt;

      s.vel.y -= GRAVITY * dt;
      s.pos.x += s.vel.x * dt;
      s.pos.y += s.vel.y * dt;
      s.pos.z += s.vel.z * dt;

      // Settle on the ground.
      if (s.vel.y < 0) {
        const below = this.world.getBlockWorld(
          Math.floor(s.pos.x),
          Math.floor(s.pos.y - SIZE / 2 - 0.02),
          Math.floor(s.pos.z),
        );
        if (IS_SOLID[below]) {
          s.pos.y = Math.floor(s.pos.y - SIZE / 2 - 0.02) + 1 + SIZE / 2;
          s.vel.y = 0;
          s.vel.x *= 0.6;
          s.vel.z *= 0.6;
        }
      }

      const dx = playerEye.x - s.pos.x;
      const dy = playerEye.y - 0.4 - s.pos.y;
      const dz = playerEye.z - s.pos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < ATTRACT_R) {
        const f = Math.min(1, ATTRACT_SPEED * dt);
        s.pos.x += dx * f;
        s.pos.y += dy * f;
        s.pos.z += dz * f;
      }

      if (dist < PICKUP_R || s.age > LIFE || s.pos.y < -64) {
        s.active = false;
        s.mesh.visible = false;
        if (dist < PICKUP_R) onPickup();
        continue;
      }

      s.mesh.position.set(s.pos.x, s.pos.y + Math.sin(s.age * BOB_FREQ) * BOB_AMP, s.pos.z);
      s.mesh.rotation.y += SPIN * dt;
    }
  }
}
