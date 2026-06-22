// Phase 17 — half-res opaque scene capture (Cinematic only) for true water refraction
// + depth-based colour/transparency + intersection foam. Each frame (when not submerged)
// we render the OPAQUE scene (everything except the transparent layer = water + glass)
// into a half-res colour target with a paired DepthTexture, then hand both — plus the
// inverse projection + near/far + resolution — to the shared uniform block. The water
// shader (Stage 17.3) samples the colour for the refracted view and reconstructs linear
// eye-Z from the depth to measure water thickness. Excluding the transparent layer from
// the capture means the water never refracts itself (no feedback). Mirrors the
// ShadowMapper RT/DepthTexture + PlanarReflection bind/unbind patterns.

import * as THREE from 'three';
import { WATER_SURFACE_DOWNSCALE, LAYER_TRANSPARENT } from '../../core/constants';
import type { Materials } from '../materials';

export class SceneCapture {
  private readonly shared: Materials['shared'];
  private readonly rt: THREE.WebGLRenderTarget;
  private readonly invProj = new THREE.Matrix4();

  constructor(shared: Materials['shared']) {
    this.shared = shared;
    this.rt = new THREE.WebGLRenderTarget(1, 1);
    this.rt.texture.minFilter = THREE.LinearFilter;
    this.rt.texture.magFilter = THREE.LinearFilter;
    this.rt.texture.generateMipmaps = false;
    this.rt.depthTexture = new THREE.DepthTexture(1, 1);
    this.rt.depthTexture.type = THREE.UnsignedIntType;
    this.rt.depthTexture.minFilter = THREE.NearestFilter;
    this.rt.depthTexture.magFilter = THREE.NearestFilter;
    this.setSize(window.innerWidth, window.innerHeight);
  }

  setSize(w: number, h: number): void {
    this.rt.setSize(
      Math.max(1, Math.floor(w * WATER_SURFACE_DOWNSCALE)),
      Math.max(1, Math.floor(h * WATER_SURFACE_DOWNSCALE)),
    );
  }

  // Unbind when refraction is off / submerged / no water on screen -> the water shader
  // falls back to the mesh-baked depth hint + sky reflection (the Medium/Low path).
  // uCameraFar==0 is the "no capture" signal the shader branches on.
  setActive(active: boolean): void {
    if (!active) {
      this.shared.uSceneColor.value = null;
      this.shared.uSceneDepth.value = null;
      this.shared.uCameraNear.value = 0;
      this.shared.uCameraFar.value = 0;
    }
  }

  capture(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevMask = camera.layers.mask;

    // Opaque-only: drop the transparent layer (water + glass) so the captured colour /
    // depth is the scene BEHIND the water surface.
    camera.layers.disable(LAYER_TRANSPARENT);

    renderer.autoClear = true;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(prevTarget);

    renderer.autoClear = prevAutoClear;
    camera.layers.mask = prevMask;

    this.invProj.copy(camera.projectionMatrix).invert();
    this.shared.uInvProjection.value.copy(this.invProj);
    this.shared.uCameraNear.value = camera.near;
    this.shared.uCameraFar.value = camera.far;
    // gl_FragCoord is in drawing-buffer pixels -> match for screen-UV sampling.
    this.shared.uResolution.value.set(renderer.domElement.width, renderer.domElement.height);
    this.shared.uSceneColor.value = this.rt.texture;
    this.shared.uSceneDepth.value = this.rt.depthTexture;
  }
}
