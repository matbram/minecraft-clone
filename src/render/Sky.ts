// Gradient sky dome: a large inverted sphere that follows the camera. Colors come
// from the DayNight model. Renders first (renderOrder -1, depthTest off) so the
// world draws over it.

import * as THREE from 'three';
import vert from './shaders/sky.vert.glsl?raw';
import frag from './shaders/sky.frag.glsl?raw';
import type { DayNight } from './DayNight';

export class Sky {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.SphereGeometry(600, 24, 16);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color(0x3a7bd5) },
        uHorizon: { value: new THREE.Color(0x8fc6f0) },
      },
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }

  update(camPos: THREE.Vector3, day: DayNight): void {
    this.mesh.position.copy(camPos);
    (this.mat.uniforms.uZenith.value as THREE.Color).copy(day.zenith);
    (this.mat.uniforms.uHorizon.value as THREE.Color).copy(day.horizon);
  }

  setVisible(v: boolean): void {
    this.mesh.visible = v;
  }
}
