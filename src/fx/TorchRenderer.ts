// Phase 15.7: particle flames for PLACED torches. Mirrors FireRenderer — one InstancedMesh
// (single draw call) of small additive cubes that rise, cool + flicker — but reads
// World.forEachTorch instead of forEachFire, and uses torch-sized flame parameters so a
// placed torch looks identical to the held torch (ViewModel.TorchFlame). The painted
// Tile.TORCH billboard now draws only the stick; this draws the flame on top. Render-only.

import * as THREE from 'three';
import {
  MAX_TORCH_CUBES,
  TORCH_RENDER_DISTANCE,
  TORCH_FLAME_CUBES_NEAR,
  TORCH_FLAME_CUBES_FAR,
  TORCH_FLAME_BASE_Y,
  TORCH_FLAME_HEIGHT,
  TORCH_FLAME_RADIUS,
  TORCH_FLAME_CUBE_SIZE,
} from '../core/constants';
import { flameColor } from './FireRenderer';
import type { World } from '../world/World';

const RENDER_D2 = TORCH_RENDER_DISTANCE * TORCH_RENDER_DISTANCE;
const TAU = Math.PI * 2;

function hash01(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

export class TorchRenderer {
  private readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly col = new THREE.Color();
  private n = 0;

  constructor(scene: THREE.Scene) {
    const geom = new THREE.BoxGeometry(1, 1, 1); // unit cube; scaled per instance
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false, // additive core; terrain still occludes via depthTest
      toneMapped: false, // keep > 1 colours hot into the bloom pass
    });
    this.mesh = new THREE.InstancedMesh(geom, mat, MAX_TORCH_CUBES);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TORCH_CUBES * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  update(world: World, camera: THREE.PerspectiveCamera, time: number): void {
    this.n = 0;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;

    world.forEachTorch((x, y, z) => {
      if (this.n >= MAX_TORCH_CUBES) return;
      const fx = x + 0.5;
      const fy = y + TORCH_FLAME_BASE_Y;
      const fz = z + 0.5;
      const dx = fx - cx;
      const dy = fy - cy;
      const dz = fz - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > RENDER_D2) return;

      const near = 1 - Math.sqrt(d2) / TORCH_RENDER_DISTANCE; // 1 close .. 0 far
      const cubes = Math.max(1, Math.round(TORCH_FLAME_CUBES_FAR + (TORCH_FLAME_CUBES_NEAR - TORCH_FLAME_CUBES_FAR) * near));
      const s0 = (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 1000 / 1000 * TAU;

      for (let k = 0; k < cubes && this.n < MAX_TORCH_CUBES; k++) {
        const ph = s0 + k * 2.39;
        const rise = (time * 1.6 + hash01(ph)) % 1; // 0 base .. 1 tip
        const env = Math.min(1, rise / 0.1) * Math.min(1, (1 - rise) / 0.35);
        if (env <= 0.01) continue;
        const flick = 0.7 + 0.3 * Math.sin(time * 12 + ph);
        const ang = hash01(ph + 2.7) * TAU + time * 1.4;
        const rad = TORCH_FLAME_RADIUS * (1 - 0.7 * rise) * (0.4 + 0.6 * hash01(ph + 1.3));
        const ox = Math.cos(ang) * rad;
        const oz = Math.sin(ang) * rad;
        const sc = Math.max(0.001, TORCH_FLAME_CUBE_SIZE * (1 - 0.5 * rise) * flick * env);
        flameColor(this.col, rise);
        this.col.multiplyScalar((0.8 + 0.3 * flick) * env);
        this.write(fx + ox, fy + rise * TORCH_FLAME_HEIGHT, fz + oz, sc);
      }
    });

    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private write(px: number, py: number, pz: number, s: number): void {
    const i = this.n++;
    this.pos.set(px, py, pz);
    this.scl.set(s, s, s);
    this.m.compose(this.pos, this.quat, this.scl);
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.setColorAt(i, this.col);
  }
}
