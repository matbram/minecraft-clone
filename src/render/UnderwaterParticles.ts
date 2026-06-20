// Phase 7b — drifting motes/plankton suspended in the water, for a sense of
// volume while submerged. ONE pooled THREE.Points kept in a box around the camera
// (toroidal wrap so the cloud follows the player); only shown when submerged.

import * as THREE from 'three';
import type { World } from '../world/World';

const HALF = 12; // half-size of the cloud box around the camera (blocks)
const DRIFT_UP = 0.15; // slow upward current (blocks/s)
// Base mote tint (cool blue), modulated per-mote by the world light at its cell.
const BASE_R = 0x9f / 255;
const BASE_G = 0xc4 / 255;
const BASE_B = 0xe8 / 255;

// Soft round sprite so motes read as out-of-focus specks, not hard squares.
function softDisc(size = 32): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

export class UnderwaterParticles {
  private readonly geom = new THREE.BufferGeometry();
  private readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly phase: Float32Array;
  private readonly n: number;
  private seeded = false;
  private t = 0;

  constructor(scene: THREE.Scene, count: number) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.phase = new Float32Array(count);
    for (let i = 0; i < count; i++) this.phase[i] = Math.random() * Math.PI * 2;
    const pa = new THREE.BufferAttribute(this.pos, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    this.geom.setAttribute('position', pa);
    const ca = new THREE.BufferAttribute(this.col, 3);
    ca.setUsage(THREE.DynamicDrawUsage);
    this.geom.setAttribute('color', ca);
    const mat = new THREE.PointsMaterial({
      map: softDisc(),
      size: 0.11,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      sizeAttenuation: true,
      vertexColors: true, // tinted per-mote by world light so they don't glow in the dark
    });
    this.points = new THREE.Points(this.geom, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  private seed(cam: THREE.Vector3): void {
    for (let i = 0; i < this.n; i++) {
      this.pos[i * 3] = cam.x + (Math.random() * 2 - 1) * HALF;
      this.pos[i * 3 + 1] = cam.y + (Math.random() * 2 - 1) * HALF;
      this.pos[i * 3 + 2] = cam.z + (Math.random() * 2 - 1) * HALF;
    }
  }

  update(dt: number, cam: THREE.Vector3, active: boolean, world: World, lightMul: number): void {
    if (!active) {
      this.points.visible = false;
      this.seeded = false; // re-seed around the camera next time we submerge
      return;
    }
    if (!this.seeded) {
      this.seed(cam);
      this.seeded = true;
    }
    this.points.visible = true;
    this.t += dt;
    for (let i = 0; i < this.n; i++) {
      const ph = this.phase[i];
      // Gentle drift: slow rise + lateral sway.
      this.pos[i * 3] += Math.sin(this.t * 0.5 + ph) * 0.12 * dt;
      this.pos[i * 3 + 1] += DRIFT_UP * dt;
      this.pos[i * 3 + 2] += Math.cos(this.t * 0.4 + ph) * 0.12 * dt;
      // Toroidal wrap so the cloud stays boxed around the camera.
      for (let a = 0; a < 3; a++) {
        const j = i * 3 + a;
        const d = this.pos[j] - cam.getComponent(a);
        if (d > HALF) this.pos[j] -= HALF * 2;
        else if (d < -HALF) this.pos[j] += HALF * 2;
      }
      // Tint by the baked light at the mote's cell so motes go dark in the dark.
      const b = world.brightnessAt(
        Math.floor(this.pos[i * 3]),
        Math.floor(this.pos[i * 3 + 1]),
        Math.floor(this.pos[i * 3 + 2]),
        lightMul,
      );
      this.col[i * 3] = BASE_R * b;
      this.col[i * 3 + 1] = BASE_G * b;
      this.col[i * 3 + 2] = BASE_B * b;
    }
    (this.geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}
