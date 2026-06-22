// Phase 15.1: pooled explosion particles rendered as SOFT round sprites (not the square
// points a bare PointsMaterial gives). A small custom Points ShaderMaterial reads a
// per-particle size + alpha so particles can GROW (smoke billows) or SHRINK (fire embers)
// and FADE OUT properly over their life. Instantiated twice by Effects: an ADDITIVE pool
// for the glowing fireball + sparks (blooms, stays bright in the dark like real flame) and
// a NORMAL-blend pool for grey smoke/dust (tinted by world light so it darkens in caves).

import * as THREE from 'three';

export interface BurstOpts {
  count: number;
  speed: number; // peak initial radial speed (blocks/s)
  life: number; // base lifetime (s)
  size: number; // initial point size (world-ish units)
  endScale?: number; // size multiplier at death: >1 grows (smoke), <1 shrinks (fire)
  alpha?: number; // starting alpha (default 1)
  lifeVar?: number; // ± fraction of life (default 0.3)
  gravity?: number; // downward accel (blocks/s^2); negative = rises (default 0)
  up?: number; // extra initial upward velocity (default 0)
  spread?: number; // initial position jitter radius (default 0.3)
}

type RGB = readonly [number, number, number];

// Soft radial sprite (white core -> transparent edge). Only the alpha channel is used by
// the shader; colour comes from the per-particle attribute. Mirrors softDisc()/discTexture().
function softSprite(size = 64): THREE.Texture {
  if (typeof document === 'undefined') return new THREE.Texture(); // headless tests: no DOM
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

const VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.001, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  precision mediump float;
  uniform sampler2D uTex;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float a = texture2D(uTex, gl_PointCoord).a * vAlpha;
    if (a < 0.01) discard;
    // Output straight alpha; the material's blend mode (additive vs normal) does the rest.
    gl_FragColor = vec4(vColor, a);
  }
`;

export class BlastParticles {
  private readonly geom: THREE.BufferGeometry;
  private readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array; // aColor (set on spawn)
  private readonly sizeAttr: Float32Array; // aSize (per frame)
  private readonly alphaAttr: Float32Array; // aAlpha (per frame)
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly life: Float32Array;
  private readonly maxlife: Float32Array;
  private readonly grav: Float32Array;
  private readonly size0: Float32Array;
  private readonly endScale: Float32Array;
  private readonly alpha0: Float32Array;
  private count = 0;
  private readonly max: number;

  constructor(scene: THREE.Scene, additive: boolean, max = 384) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.sizeAttr = new Float32Array(max);
    this.alphaAttr = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.vz = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxlife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.endScale = new Float32Array(max);
    this.alpha0 = new Float32Array(max);

    this.geom = new THREE.BufferGeometry();
    const mk = (arr: Float32Array, n: number) => {
      const a = new THREE.BufferAttribute(arr, n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.geom.setAttribute('position', mk(this.pos, 3));
    this.geom.setAttribute('aColor', mk(this.col, 3));
    this.geom.setAttribute('aSize', mk(this.sizeAttr, 1));
    this.geom.setAttribute('aAlpha', mk(this.alphaAttr, 1));
    this.geom.setDrawRange(0, 0);

    // uScale matches PointsMaterial's sizeAttenuation (≈ 0.5 * drawing-buffer height).
    // Guarded so headless tests (no DOM) can construct the pool.
    const hasWindow = typeof window !== 'undefined';
    const dpr = hasWindow ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const vh = hasWindow ? window.innerHeight : 1080;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: softSprite() },
        uScale: { value: vh * dpr * 0.5 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geom, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  burst(x: number, y: number, z: number, colors: readonly RGB[], opts: BurstOpts, bright = 1): void {
    const grav = opts.gravity ?? 0;
    const lifeVar = opts.lifeVar ?? 0.3;
    const spread = opts.spread ?? 0.3;
    const up = opts.up ?? 0;
    const endScale = opts.endScale ?? 1;
    const alpha = opts.alpha ?? 1;
    for (let i = 0; i < opts.count && this.count < this.max; i++) {
      const idx = this.count++;
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
      this.col[idx * 3] = c[0] * bright;
      this.col[idx * 3 + 1] = c[1] * bright;
      this.col[idx * 3 + 2] = c[2] * bright;
      const ml = opts.life * (1 - lifeVar + Math.random() * lifeVar * 2);
      this.life[idx] = ml;
      this.maxlife[idx] = ml;
      this.grav[idx] = grav;
      this.size0[idx] = opts.size;
      this.endScale[idx] = endScale;
      this.alpha0[idx] = alpha;
      this.sizeAttr[idx] = opts.size;
      this.alphaAttr[idx] = alpha;
    }
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const last = --this.count; // swap-remove (move every parallel field)
        if (i !== last) {
          for (let k = 0; k < 3; k++) {
            this.pos[i * 3 + k] = this.pos[last * 3 + k];
            this.col[i * 3 + k] = this.col[last * 3 + k];
          }
          this.vx[i] = this.vx[last];
          this.vy[i] = this.vy[last];
          this.vz[i] = this.vz[last];
          this.life[i] = this.life[last];
          this.maxlife[i] = this.maxlife[last];
          this.grav[i] = this.grav[last];
          this.size0[i] = this.size0[last];
          this.endScale[i] = this.endScale[last];
          this.alpha0[i] = this.alpha0[last];
        }
        continue;
      }
      this.vy[i] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vx[i] * dt;
      this.pos[i * 3 + 1] += this.vy[i] * dt;
      this.pos[i * 3 + 2] += this.vz[i] * dt;
      const f = this.life[i] / this.maxlife[i]; // 1 -> 0
      const age = 1 - f;
      this.sizeAttr[i] = this.size0[i] * (1 + (this.endScale[i] - 1) * age);
      this.alphaAttr[i] = this.alpha0[i] * f;
      i++;
    }
    this.geom.setDrawRange(0, this.count);
    (this.geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }
}
