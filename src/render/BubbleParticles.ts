// Phase 11.5 — bubbles rising from the player's head while submerged, for a sense
// of embodiment (you're a body in the water, not a camera in blue space). ONE pooled
// THREE.Points; bubbles spawn just in front of/below the eye, rise with acceleration
// + lateral wobble, and expire by lifetime. Emission scales with movement. Tinted by
// baked world light so they fade in the dark. Only shown while submerged.

import * as THREE from 'three';
import type { World } from '../world/World';

const MAX = 80;
const RISE = 1.6; // base upward speed (blocks/s)
const RISE_ACCEL = 1.2; // bubbles accelerate as they rise
const LIFE = 1.6; // seconds
const BASE_R = 0xcf / 255;
const BASE_G = 0xe8 / 255;
const BASE_B = 0xff / 255;

// A little bubble: bright thin ring + faint fill + a highlight dot.
function bubbleSprite(size = 32): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  const g = ctx.createRadialGradient(size * 0.42, size * 0.42, 0, size / 2, size / 2, size * 0.42);
  g.addColorStop(0, 'rgba(255,255,255,0.32)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = size * 0.08;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.33, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.arc(size * 0.38, size * 0.35, size * 0.06, 0, Math.PI * 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

export class BubbleParticles {
  private readonly geom = new THREE.BufferGeometry();
  private readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly vy = new Float32Array(MAX);
  private readonly phase = new Float32Array(MAX);
  private readonly life = new Float32Array(MAX);
  private count = 0;
  private emitAccum = 0;
  private t = 0;
  private readonly fwd = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    const pa = new THREE.BufferAttribute(this.pos, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    this.geom.setAttribute('position', pa);
    const ca = new THREE.BufferAttribute(this.col, 3);
    ca.setUsage(THREE.DynamicDrawUsage);
    this.geom.setAttribute('color', ca);
    this.geom.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      map: bubbleSprite(),
      size: 0.09,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      sizeAttenuation: true,
      vertexColors: true,
    });
    this.points = new THREE.Points(this.geom, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  private spawn(cam: THREE.PerspectiveCamera): void {
    if (this.count >= MAX) return;
    const i = this.count++;
    cam.getWorldDirection(this.fwd);
    this.pos[i * 3] = cam.position.x + this.fwd.x * 0.3 + (Math.random() - 0.5) * 0.3;
    this.pos[i * 3 + 1] = cam.position.y - 0.25 + (Math.random() - 0.5) * 0.1;
    this.pos[i * 3 + 2] = cam.position.z + this.fwd.z * 0.3 + (Math.random() - 0.5) * 0.3;
    this.vy[i] = RISE * (0.7 + Math.random() * 0.6);
    this.phase[i] = Math.random() * Math.PI * 2;
    this.life[i] = LIFE * (0.6 + Math.random() * 0.6);
  }

  private swapRemove(i: number): void {
    const last = --this.count;
    if (i !== last) {
      this.pos[i * 3] = this.pos[last * 3];
      this.pos[i * 3 + 1] = this.pos[last * 3 + 1];
      this.pos[i * 3 + 2] = this.pos[last * 3 + 2];
      this.vy[i] = this.vy[last];
      this.phase[i] = this.phase[last];
      this.life[i] = this.life[last];
    }
  }

  update(
    dt: number,
    cam: THREE.PerspectiveCamera,
    submerged: boolean,
    speed: number,
    world: World,
    lightMul: number,
  ): void {
    if (!submerged) {
      if (this.points.visible) {
        this.points.visible = false;
        this.count = 0;
        this.geom.setDrawRange(0, 0);
      }
      return;
    }
    this.points.visible = true;
    this.t += dt;

    // Emission: a baseline trickle (breathing) + more while moving.
    const rate = 2 + Math.min(speed, 6) * 2.5; // bubbles/sec
    this.emitAccum += rate * dt;
    while (this.emitAccum >= 1) {
      this.emitAccum -= 1;
      this.spawn(cam);
    }

    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.swapRemove(i);
        continue;
      }
      this.vy[i] += RISE_ACCEL * dt;
      this.pos[i * 3] += Math.sin(this.t * 3 + this.phase[i]) * 0.25 * dt;
      this.pos[i * 3 + 1] += this.vy[i] * dt;
      this.pos[i * 3 + 2] += Math.cos(this.t * 2.7 + this.phase[i]) * 0.25 * dt;
      const b = world.brightnessAt(
        Math.floor(this.pos[i * 3]),
        Math.floor(this.pos[i * 3 + 1]),
        Math.floor(this.pos[i * 3 + 2]),
        lightMul,
      );
      const v = 0.4 + 0.6 * b; // stay a touch visible, but dim in the dark
      this.col[i * 3] = BASE_R * v;
      this.col[i * 3 + 1] = BASE_G * v;
      this.col[i * 3 + 2] = BASE_B * v;
      i++;
    }
    this.geom.setDrawRange(0, this.count);
    (this.geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}
