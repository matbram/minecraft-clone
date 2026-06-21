// Phase 12.5b: the planet backdrop you rise off when flying into space. A large
// textured sphere sits below the camera (surface aligned near sea level) and
// cross-fades in by altT, with an additive fresnel shell for the blue atmospheric
// limb ringing the horizon. Pure backdrop: depth-tested so streamed terrain still
// draws on top near the surface; centred under the camera so an infinite flat
// world always has "a planet below you" (no finite-globe edge to fly off).

import * as THREE from 'three';
import { PLANET_R, PLANET_ATMOSPHERE, SEA_LEVEL } from '../core/constants';
import { buildPlanetTexture } from './planetTexture';
import type { DayNight } from './DayNight';

const atmoVert = `
varying vec3 vN;
varying vec3 vView;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const atmoFrag = `
precision highp float;
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vN;
varying vec3 vView;
void main(){
  // Bright at grazing angles (the limb), faint face-on.
  float rim = pow(1.0 - max(0.0, dot(normalize(vN), normalize(vView))), 3.0);
  gl_FragColor = vec4(uColor, rim * uOpacity);
}`;

export class SpaceLayer {
  private readonly planet: THREE.Mesh;
  private readonly planetMat: THREE.MeshBasicMaterial;
  private readonly atmo: THREE.Mesh;
  private readonly atmoMat: THREE.ShaderMaterial;
  private enabled = true;

  constructor(scene: THREE.Scene, seed: number) {
    this.planetMat = new THREE.MeshBasicMaterial({
      map: buildPlanetTexture(seed),
      transparent: true,
      opacity: 0,
      depthTest: true, // terrain (which writes depth) draws over it near the surface
      depthWrite: false,
      fog: false,
    });
    this.planet = new THREE.Mesh(new THREE.SphereGeometry(PLANET_R, 48, 32), this.planetMat);
    this.planet.renderOrder = -2; // over the sky dome (-4) & stars (-3), under sun/moon (-1)
    this.planet.frustumCulled = false;
    this.planet.visible = false;

    this.atmoMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x6aa8ff) },
        uOpacity: { value: 0 },
      },
      vertexShader: atmoVert,
      fragmentShader: atmoFrag,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      depthTest: true,
      depthWrite: false,
      fog: false,
    });
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(PLANET_R * PLANET_ATMOSPHERE, 48, 32), this.atmoMat);
    this.atmo.renderOrder = -2;
    this.atmo.frustumCulled = false;
    this.atmo.visible = false;

    scene.add(this.planet);
    scene.add(this.atmo);
  }

  // altT: 0 at the surface (hidden) -> 1 in full space (fully visible).
  update(camPos: THREE.Vector3, altT: number, day: DayNight): void {
    const show = this.enabled && altT > 0.01;
    this.planet.visible = show;
    this.atmo.visible = show;
    if (!show) return;

    // Centre the globe under the camera; surface aligned near sea level so you
    // appear to rise off the ground while real chunks still stream near it.
    this.planet.position.set(camPos.x, SEA_LEVEL - PLANET_R, camPos.z);
    this.atmo.position.copy(this.planet.position);

    this.planetMat.opacity = altT;
    // Dim the whole globe at night (cheap stand-in for a lit day/night terminator).
    const lum = 0.22 + 0.78 * day.dayFactor;
    this.planetMat.color.setScalar(lum);
    this.atmoMat.uniforms.uOpacity.value = altT * (0.35 + 0.65 * day.dayFactor);
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) {
      this.planet.visible = false;
      this.atmo.visible = false;
    }
  }
}
