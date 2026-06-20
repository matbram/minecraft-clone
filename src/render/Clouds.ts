// A large translucent cloud plane high above the world, scrolling slowly and
// tinted by the day/night cycle. Follows the camera in X/Z.

import * as THREE from 'three';
import type { DayNight } from './DayNight';

const HEIGHT = 140;
const SIZE = 2000;

function cloudTexture(size = 256): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  // Soft overlapping blobs -> puffy clouds.
  let seed = 0x9e37;
  const rnd = () => {
    seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 1) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 90; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 12 + rnd() * 40;
    const a = 0.06 + rnd() * 0.10;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class Clouds {
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private offset = 0;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE);
    geo.rotateX(-Math.PI / 2); // lay flat
    this.mat = new THREE.MeshBasicMaterial({
      map: cloudTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(camPos: THREE.Vector3, day: DayNight, dt: number): void {
    this.mesh.position.set(camPos.x, HEIGHT, camPos.z);
    this.offset += dt * 0.004;
    const tex = this.mat.map!;
    tex.offset.set(this.offset, this.offset * 0.6);
    this.mat.color.copy(day.cloudTint);
  }

  setVisible(v: boolean): void {
    this.mesh.visible = v;
  }
}
