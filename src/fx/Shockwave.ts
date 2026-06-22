// Phase 15: the blast shock ring — a small pool of transparent additive sphere shells
// that expand fast (faster than the fireball, so they outrun it) and fade as they grow.
// Cosmetic only; reads as the pressure dome / Wilson ring leaving the detonation.

import * as THREE from 'three';
import { EXPLOSION_SHOCKWAVE_SPEED, EXPLOSION_SHOCKWAVE_R } from '../core/constants';

const MAX = 4;

interface Ring {
  active: boolean;
  age: number;
  mesh: THREE.Mesh;
}

export class Shockwave {
  private readonly slots: Ring[] = [];

  constructor(scene: THREE.Scene) {
    const geom = new THREE.SphereGeometry(1, 20, 12);
    for (let i = 0; i < MAX; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xfff2d0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.slots.push({ active: false, age: 0, mesh });
    }
  }

  spawn(x: number, y: number, z: number): void {
    let s = this.slots.find((r) => !r.active);
    if (!s) s = this.slots[0];
    s.active = true;
    s.age = 0;
    s.mesh.position.set(x, y, z);
    s.mesh.scale.setScalar(0.1);
    s.mesh.visible = true;
    (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5;
  }

  update(dt: number): void {
    for (const s of this.slots) {
      if (!s.active) continue;
      s.age += dt;
      const radius = s.age * EXPLOSION_SHOCKWAVE_SPEED;
      if (radius >= EXPLOSION_SHOCKWAVE_R) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      s.mesh.scale.setScalar(radius);
      const frac = radius / EXPLOSION_SHOCKWAVE_R; // 0 -> 1
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - frac) * (1 - frac);
    }
  }
}
