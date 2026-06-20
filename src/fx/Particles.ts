// Break-puff particles. ONE pooled THREE.Points (single draw call). Per-particle
// velocity/life kept in plain arrays; position/color in dynamic buffer attrs.

import * as THREE from 'three';

const MAX = 256;
const GRAVITY = 14;

export class Particles {
  private readonly geom: THREE.BufferGeometry;
  private readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly vx = new Float32Array(MAX);
  private readonly vy = new Float32Array(MAX);
  private readonly vz = new Float32Array(MAX);
  private readonly life = new Float32Array(MAX);
  private count = 0;

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.geom = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(this.pos, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    const ca = new THREE.BufferAttribute(this.col, 3);
    ca.setUsage(THREE.DynamicDrawUsage);
    this.geom.setAttribute('position', pa);
    this.geom.setAttribute('color', ca);
    this.geom.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      size: 0.12,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geom, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  burst(x: number, y: number, z: number, color: THREE.Color, count = 10): void {
    for (let i = 0; i < count && this.count < MAX; i++) {
      const idx = this.count++;
      this.pos[idx * 3] = x;
      this.pos[idx * 3 + 1] = y;
      this.pos[idx * 3 + 2] = z;
      this.col[idx * 3] = color.r;
      this.col[idx * 3 + 1] = color.g;
      this.col[idx * 3 + 2] = color.b;
      this.vx[idx] = (Math.random() - 0.5) * 4;
      this.vy[idx] = 1.5 + Math.random() * 1.5;
      this.vz[idx] = (Math.random() - 0.5) * 4;
      this.life[idx] = 0.45 + Math.random() * 0.15;
    }
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const last = --this.count; // swap-remove
        if (i !== last) {
          this.pos[i * 3] = this.pos[last * 3];
          this.pos[i * 3 + 1] = this.pos[last * 3 + 1];
          this.pos[i * 3 + 2] = this.pos[last * 3 + 2];
          this.col[i * 3] = this.col[last * 3];
          this.col[i * 3 + 1] = this.col[last * 3 + 1];
          this.col[i * 3 + 2] = this.col[last * 3 + 2];
          this.vx[i] = this.vx[last];
          this.vy[i] = this.vy[last];
          this.vz[i] = this.vz[last];
          this.life[i] = this.life[last];
        }
        continue; // re-check the swapped-in slot
      }
      this.vy[i] -= GRAVITY * dt;
      this.pos[i * 3] += this.vx[i] * dt;
      this.pos[i * 3 + 1] += this.vy[i] * dt;
      this.pos[i * 3 + 2] += this.vz[i] * dt;
      i++;
    }
    this.geom.setDrawRange(0, this.count);
    (this.geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}
