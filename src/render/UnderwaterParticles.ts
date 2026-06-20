// Phase 7b — drifting motes/plankton suspended in the water, for a sense of
// volume while submerged. ONE pooled THREE.Points kept in a box around the camera
// (toroidal wrap so the cloud follows the player); only shown when submerged.

import * as THREE from 'three';

const HALF = 12; // half-size of the cloud box around the camera (blocks)
const DRIFT_UP = 0.15; // slow upward current (blocks/s)

export class UnderwaterParticles {
  private readonly geom = new THREE.BufferGeometry();
  private readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly phase: Float32Array;
  private readonly n: number;
  private seeded = false;
  private t = 0;

  constructor(scene: THREE.Scene, count: number) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.phase = new Float32Array(count);
    for (let i = 0; i < count; i++) this.phase[i] = Math.random() * Math.PI * 2;
    const pa = new THREE.BufferAttribute(this.pos, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    this.geom.setAttribute('position', pa);
    const mat = new THREE.PointsMaterial({
      color: 0x9fc4e8,
      size: 0.06,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      sizeAttenuation: true,
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

  update(dt: number, cam: THREE.Vector3, active: boolean): void {
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
    }
    (this.geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
