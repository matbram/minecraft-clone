// A shell of stars around the camera, fading in at night via the DayNight model.

import * as THREE from 'three';
import { STAR_COUNT } from '../core/constants';
import type { DayNight } from './DayNight';

const RADIUS = 560; // just inside the sky dome (600)

export class Stars {
  private readonly points: THREE.Points;
  private readonly mat: THREE.PointsMaterial;
  private enabled = true;

  constructor(scene: THREE.Scene) {
    const pos = new Float32Array(STAR_COUNT * 3);
    let seed = 0x1234;
    const rnd = () => {
      seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 1) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < STAR_COUNT; i++) {
      // Uniform on a sphere; bias toward the upper hemisphere.
      const u = rnd() * 2 - 1;
      const phi = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const y = Math.abs(u) * 0.9 + 0.05;
      pos[i * 3] = Math.cos(phi) * r * RADIUS;
      pos[i * 3 + 1] = y * RADIUS;
      pos[i * 3 + 2] = Math.sin(phi) * r * RADIUS;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.6,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true, // occluded by terrain; sky dome doesn't write depth
      fog: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = -1;
    scene.add(this.points);
  }

  update(camPos: THREE.Vector3, day: DayNight): void {
    this.points.position.copy(camPos);
    this.mat.opacity = day.starOpacity;
    this.points.visible = this.enabled && day.starOpacity > 0.01;
  }

  setVisible(v: boolean): void {
    this.enabled = v;
    if (!v) this.points.visible = false;
  }
}
