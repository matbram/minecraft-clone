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
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xffd9a0) },
        uSunGlow: { value: 0 },
        uWaterColor: { value: new THREE.Color(0x0a2230) },
        uWaterFade: { value: 0 },
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
    (this.mat.uniforms.uSunDir.value as THREE.Vector3).copy(day.sunDir);
    (this.mat.uniforms.uSunColor.value as THREE.Color).copy(day.sunColor);
    this.mat.uniforms.uSunGlow.value = day.sunGlow;
  }

  // Phase 10 — underwater: fade the whole sky (incl. sun glow) toward the deep
  // water color as the eye descends, so near the surface you still see the sky/sun
  // and it goes dark with depth. fade=0 above water leaves the sky untouched.
  setUnderwater(fade: number, color: THREE.Color): void {
    this.mat.uniforms.uWaterFade.value = fade;
    (this.mat.uniforms.uWaterColor.value as THREE.Color).copy(color);
  }

  setVisible(v: boolean): void {
    this.mesh.visible = v;
  }
}
