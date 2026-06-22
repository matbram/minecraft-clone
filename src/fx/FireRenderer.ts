// Phase 15.3: voxel-cube flames. Renders every active (flaming) fire cell as a small
// flickering, tapering cluster of emissive additive cubes — white-hot core ramping to
// orange/red tips, plus a few rising embers — matching the user's voxel-bonfire reference.
// One InstancedMesh (single draw call) holds all cubes for all fires; cube count per flame
// is LOD'd by camera distance and the whole thing is capped at MAX_FIRE_CUBES. Additive +
// bloom makes the core glow. Render-only: reads World.forEachFire each frame, mutates nothing.

import * as THREE from 'three';
import {
  MAX_FIRE_CUBES,
  FIRE_RENDER_DISTANCE,
  FIRE_FLAME_HEIGHT,
  FIRE_CUBE_SIZE,
  FIRE_CUBES_NEAR,
  FIRE_CUBES_FAR,
} from '../core/constants';
import type { World } from '../world/World';

const RENDER_D2 = FIRE_RENDER_DISTANCE * FIRE_RENDER_DISTANCE;
const TAU = Math.PI * 2;

// Flame colour by normalized height t (0 base .. 1 tip). Components > 1 push the bloom
// threshold so the hot core glows. White-hot -> yellow -> orange -> deep red.
function flameColor(out: THREE.Color, t: number): void {
  if (t < 0.35) {
    const u = t / 0.35;
    out.setRGB(1.6 - 0.1 * u, 1.35 - 0.45 * u, 0.8 - 0.5 * u);
  } else if (t < 0.7) {
    const u = (t - 0.35) / 0.35;
    out.setRGB(1.5 - 0.2 * u, 0.9 - 0.45 * u, 0.3 - 0.18 * u);
  } else {
    const u = Math.min(1, (t - 0.7) / 0.3);
    out.setRGB(1.3 - 0.4 * u, 0.45 - 0.33 * u, 0.12 - 0.08 * u);
  }
}

export class FireRenderer {
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
      depthWrite: false, // additive: overlap brightens the core; terrain still occludes (depthTest)
      toneMapped: false, // keep > 1 colours hot into the bloom pass
    });
    this.mesh = new THREE.InstancedMesh(geom, mat, MAX_FIRE_CUBES);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FIRE_CUBES * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  update(world: World, camera: THREE.PerspectiveCamera, time: number): void {
    this.n = 0;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;

    world.forEachFire((x, y, z, age, life, flaming) => {
      if (!flaming || this.n >= MAX_FIRE_CUBES) return;
      const fx = x + 0.5;
      const fz = z + 0.5;
      const dx = fx - cx;
      const dy = y - cy;
      const dz = fz - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > RENDER_D2) return;

      const near = 1 - Math.sqrt(d2) / FIRE_RENDER_DISTANCE; // 1 close .. 0 far
      const cubes = Math.max(1, Math.round(FIRE_CUBES_FAR + (FIRE_CUBES_NEAR - FIRE_CUBES_FAR) * near));
      const strength = life > 0 ? Math.max(0, Math.min(1, (1 - age / life) / 0.2)) : 0; // fade last 20%
      if (strength <= 0) return;
      const s0 = (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 1000 / 1000 * TAU;

      // Flame body: tapering, flickering column.
      for (let k = 0; k < cubes && this.n < MAX_FIRE_CUBES; k++) {
        const t = cubes > 1 ? k / (cubes - 1) : 0;
        const ph = s0 + k * 1.7;
        const flick = 0.5 + 0.5 * Math.sin(time * 8 + ph);
        const radius = FIRE_CUBE_SIZE * 1.1 * (1 - t) * (0.5 + 0.5 * Math.sin(time * 4 + ph));
        const ang = ph * 2 + time * 1.5;
        const oy = t * FIRE_FLAME_HEIGHT * strength + Math.sin(time * 6 + ph) * 0.05;
        const sc = FIRE_CUBE_SIZE * (1 - 0.45 * t) * (0.75 + 0.35 * flick) * strength;
        flameColor(this.col, t);
        this.col.multiplyScalar(0.85 + 0.3 * flick);
        this.write(fx + Math.cos(ang) * radius, y + oy, fz + Math.sin(ang) * radius, sc);
      }

      // Embers rising above the flame on a looping phase.
      const embers = 1 + Math.round(cubes * 0.25 * near);
      for (let e = 0; e < embers && this.n < MAX_FIRE_CUBES; e++) {
        const ph = s0 + 50 + e * 3.1;
        const phase = (time * 0.5 + (ph % TAU) / TAU) % 1; // 0..1 rising
        const fade = 1 - phase;
        const sc = FIRE_CUBE_SIZE * 0.5 * fade * strength;
        if (sc < 0.02) continue;
        const ang = ph * 4 + time;
        const r = 0.1 + phase * 0.45;
        const h = FIRE_FLAME_HEIGHT * strength + phase * 1.3;
        this.col.setRGB(0.2 + 1.3 * fade, 0.4 * fade, 0.08 * fade);
        this.write(fx + Math.cos(ang) * r, y + h, fz + Math.sin(ang) * r, sc);
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
