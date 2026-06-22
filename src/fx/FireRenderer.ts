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
  FIRE_FLAME_RADIUS,
  FIRE_CUBE_SIZE,
  FIRE_CUBES_NEAR,
  FIRE_CUBES_FAR,
  FIRE_RISE_SPEED,
} from '../core/constants';
import type { World } from '../world/World';

const RENDER_D2 = FIRE_RENDER_DISTANCE * FIRE_RENDER_DISTANCE;
const TAU = Math.PI * 2;

// Cheap stable hash -> [0,1). Deterministic per (cell seed + cube index) so each cube keeps
// its scatter while still flickering via the time term added at the call site.
function hash01(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

// Flame colour by normalized height t (0 base .. 1 tip). Components > 1 push the bloom
// threshold so the hot core glows. White-hot -> yellow -> orange -> deep red. Core trimmed
// a touch (vs 15.3) so small scattered cubes read as voxels instead of a blown-out blob.
// Exported (Phase 15.6) so the held-torch / body-torch flames reuse the exact rocket ramp.
export function flameColor(out: THREE.Color, t: number): void {
  if (t < 0.35) {
    const u = t / 0.35;
    out.setRGB(1.45 - 0.1 * u, 1.2 - 0.4 * u, 0.7 - 0.45 * u);
  } else if (t < 0.7) {
    const u = (t - 0.35) / 0.35;
    out.setRGB(1.35 - 0.15 * u, 0.8 - 0.4 * u, 0.25 - 0.15 * u);
  } else {
    const u = Math.min(1, (t - 0.7) / 0.3);
    out.setRGB(1.2 - 0.35 * u, 0.4 - 0.28 * u, 0.1 - 0.06 * u);
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

      // CORE: a stable, hottest cluster of cubes at the base (the glowing coals) that just
      // flicker — gives the flame a solid bright bottom and hides the rise-loop wrap.
      const core = Math.round(cubes * 0.45);
      for (let k = 0; k < core && this.n < MAX_FIRE_CUBES; k++) {
        const ph = s0 + k * 2.39;
        const t = (core > 1 ? k / (core - 1) : 0) * 0.35; // base third -> hottest colours
        const flick = 0.6 + 0.4 * Math.sin(time * 12 + ph);
        const radius = FIRE_FLAME_RADIUS * (0.4 + 0.6 * hash01(ph + 1.3)) * (1 - 0.5 * t);
        const ang = hash01(ph + 2.7) * TAU + time * 0.5;
        const ox = Math.cos(ang) * radius + Math.sin(time * 4 + ph) * 0.04;
        const oz = Math.sin(ang) * radius + Math.cos(time * 4 + ph) * 0.04;
        const oy = t * FIRE_FLAME_HEIGHT * strength * 0.5;
        const sc = FIRE_CUBE_SIZE * (1.1 - 0.3 * t) * (0.7 + 0.4 * flick) * strength;
        flameColor(this.col, t);
        this.col.multiplyScalar(0.85 + 0.3 * flick);
        this.write(fx + ox, y + oy, fz + oz, sc);
      }

      // TONGUES: cubes that loop upward (per-cube rise phase), cooling + curling + shrinking
      // and fading out near the top — so the flame visibly licks up and dies into smoke.
      for (let k = core; k < cubes && this.n < MAX_FIRE_CUBES; k++) {
        const ph = s0 + 17 + k * 2.39;
        const p = (time * FIRE_RISE_SPEED + hash01(ph)) % 1; // 0 base .. 1 tip
        const t = 0.2 + p * 0.8; // temperature: cools as it rises
        const swirl = Math.sin(time * 2.3 + ph) + 0.5 * Math.sin(time * 3.9 + ph * 1.7);
        const radius = FIRE_FLAME_RADIUS * (1 - 0.6 * p) * (0.3 + 0.7 * hash01(ph + 1.3));
        const ang = hash01(ph + 2.7) * TAU + time * 0.9 + swirl * 0.6;
        const ox = Math.cos(ang) * radius + swirl * 0.05 * (1 - p);
        const oz = Math.sin(ang) * radius + Math.cos(time * 2.7 + ph) * 0.05 * (1 - p);
        const oy = (0.1 + p * 0.95) * FIRE_FLAME_HEIGHT * strength;
        const env = Math.min(1, p / 0.06) * Math.min(1, (1 - p) / 0.35); // ramp in at base, fade at tip
        if (env <= 0.01) continue;
        const flick = 0.7 + 0.3 * Math.sin(time * 10 + ph);
        const sc = FIRE_CUBE_SIZE * (0.95 - 0.5 * p) * flick * strength * env;
        flameColor(this.col, t);
        this.col.multiplyScalar((0.8 + 0.3 * flick) * env);
        this.write(fx + ox, y + oy, fz + oz, sc);
      }

      // Embers: small cubes rising + fanning out above the flame on a looping phase.
      const embers = 2 + Math.round(cubes * 0.3 * near);
      for (let e = 0; e < embers && this.n < MAX_FIRE_CUBES; e++) {
        const ph = s0 + 50 + e * 3.1;
        const phase = (time * 0.5 + hash01(ph)) % 1; // 0..1 rising
        const fade = 1 - phase;
        const sc = FIRE_CUBE_SIZE * 0.7 * fade * strength;
        if (sc < 0.015) continue;
        const ang = ph * 4 + time;
        const r = 0.1 + phase * (FIRE_FLAME_RADIUS + 0.5);
        const h = FIRE_FLAME_HEIGHT * strength + phase * 1.4;
        this.col.setRGB(0.2 + 1.3 * fade, 0.38 * fade, 0.07 * fade);
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
