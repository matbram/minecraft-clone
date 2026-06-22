// Phase 15: a pooled THREE.Points particle system for explosions, separate from the
// small block-break Particles. Instantiated twice by Effects: one ADDITIVE pool for the
// glowing fireball + sparks (so fire reads hot and blooms, and stays bright in the dark
// like a real flame), and one NORMAL-blend pool for grey smoke/dust (tinted by world
// light so it darkens in caves). Bigger points, longer/variable life, per-particle
// gravity (negative = buoyant rise), and a colour fade as each particle dies.

import * as THREE from 'three';

export interface BurstOpts {
  count: number;
  speed: number; // peak initial radial speed (blocks/s)
  life: number; // base lifetime (s)
  lifeVar?: number; // ± fraction of life (default 0.3)
  gravity?: number; // downward accel (blocks/s^2); negative = rises (default 0)
  up?: number; // extra initial upward velocity (default 0)
  spread?: number; // initial position jitter radius (default 0.3)
}

type RGB = readonly [number, number, number];

export class BlastParticles {
  private readonly geom: THREE.BufferGeometry;
  private readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array; // drawn colour (base faded by remaining life)
  private readonly base: Float32Array; // base colour
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly life: Float32Array;
  private readonly maxlife: Float32Array;
  private readonly grav: Float32Array;
  private count = 0;
  private readonly max: number;

  constructor(scene: THREE.Scene, additive: boolean, size: number, max = 320) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.vz = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxlife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.geom = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(this.pos, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    const ca = new THREE.BufferAttribute(this.col, 3);
    ca.setUsage(THREE.DynamicDrawUsage);
    this.geom.setAttribute('position', pa);
    this.geom.setAttribute('color', ca);
    this.geom.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      size,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geom, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  // Spawn `count` particles from (x,y,z) in random sphere directions. `colors` is a
  // small palette sampled per particle; `bright` scales the base colour (use the world
  // light for smoke; keep 1 for emissive fire).
  burst(x: number, y: number, z: number, colors: readonly RGB[], opts: BurstOpts, bright = 1): void {
    const grav = opts.gravity ?? 0;
    const lifeVar = opts.lifeVar ?? 0.3;
    const spread = opts.spread ?? 0.3;
    const up = opts.up ?? 0;
    for (let i = 0; i < opts.count && this.count < this.max; i++) {
      const idx = this.count++;
      // Uniform direction on the unit sphere.
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - u * u));
      const dx = r * Math.cos(th);
      const dy = u;
      const dz = r * Math.sin(th);
      const sp = opts.speed * (0.4 + Math.random() * 0.6);
      this.pos[idx * 3] = x + dx * spread * Math.random();
      this.pos[idx * 3 + 1] = y + dy * spread * Math.random();
      this.pos[idx * 3 + 2] = z + dz * spread * Math.random();
      this.vx[idx] = dx * sp;
      this.vy[idx] = dy * sp + up;
      this.vz[idx] = dz * sp;
      const c = colors[(Math.random() * colors.length) | 0];
      this.base[idx * 3] = c[0] * bright;
      this.base[idx * 3 + 1] = c[1] * bright;
      this.base[idx * 3 + 2] = c[2] * bright;
      const ml = opts.life * (1 - lifeVar + Math.random() * lifeVar * 2);
      this.life[idx] = ml;
      this.maxlife[idx] = ml;
      this.grav[idx] = grav;
    }
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const last = --this.count; // swap-remove
        if (i !== last) {
          for (let k = 0; k < 3; k++) {
            this.pos[i * 3 + k] = this.pos[last * 3 + k];
            this.base[i * 3 + k] = this.base[last * 3 + k];
          }
          this.vx[i] = this.vx[last];
          this.vy[i] = this.vy[last];
          this.vz[i] = this.vz[last];
          this.life[i] = this.life[last];
          this.maxlife[i] = this.maxlife[last];
          this.grav[i] = this.grav[last];
        }
        continue;
      }
      this.vy[i] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vx[i] * dt;
      this.pos[i * 3 + 1] += this.vy[i] * dt;
      this.pos[i * 3 + 2] += this.vz[i] * dt;
      const f = this.life[i] / this.maxlife[i]; // 1 -> 0 fade
      this.col[i * 3] = this.base[i * 3] * f;
      this.col[i * 3 + 1] = this.base[i * 3 + 1] * f;
      this.col[i * 3 + 2] = this.base[i * 3 + 2] * f;
      i++;
    }
    this.geom.setDrawRange(0, this.count);
    (this.geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}
