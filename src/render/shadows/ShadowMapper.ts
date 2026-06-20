// Phase 4b — custom 2-split cascaded sun shadows.
//
// The chunk material is a hand-written ShaderMaterial with no THREE lights, so
// three's built-in shadow system can't be used. Instead we render the opaque
// chunks (the SHADOW_CASTER layer) from the sun's POV into two depth render
// targets — a tight near cascade + a wider far cascade — and sample them in
// block.frag.glsl. Driven entirely off DayNight.sunDir.

import * as THREE from 'three';
import {
  SHADOW_MAP_SIZE,
  SHADOW_CASCADE0,
  SHADOW_CASCADE1,
  SHADOW_CAM_DIST,
  SHADOW_DEPTH,
  SHADOW_STRENGTH,
  LAYER_SHADOW_CASTER,
} from '../../core/constants';
import type { Materials } from '../materials';
import type { DayNight } from '../DayNight';
import depthVert from '../shaders/depthCaster.vert.glsl?raw';
import depthFrag from '../shaders/depthCaster.frag.glsl?raw';

// NDC [-1,1] -> texture [0,1].
const BIAS = new THREE.Matrix4().set(
  0.5, 0.0, 0.0, 0.5,
  0.0, 0.5, 0.0, 0.5,
  0.0, 0.0, 0.5, 0.5,
  0.0, 0.0, 0.0, 1.0,
);

function makeDepthRT(): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  rt.texture.minFilter = THREE.NearestFilter;
  rt.texture.magFilter = THREE.NearestFilter;
  rt.texture.generateMipmaps = false;
  rt.depthTexture = new THREE.DepthTexture(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  rt.depthTexture.type = THREE.UnsignedIntType;
  rt.depthTexture.minFilter = THREE.NearestFilter;
  rt.depthTexture.magFilter = THREE.NearestFilter;
  return rt;
}

export class ShadowMapper {
  private readonly shared: Materials['shared'];
  private readonly rt0 = makeDepthRT();
  private readonly rt1 = makeDepthRT();
  private readonly cam0 = new THREE.OrthographicCamera();
  private readonly cam1 = new THREE.OrthographicCamera();
  private readonly depthMat: THREE.ShaderMaterial;

  private readonly tmpVP = new THREE.Matrix4();
  private readonly origin = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor(shared: Materials['shared']) {
    this.shared = shared;
    for (const c of [this.cam0, this.cam1]) c.layers.set(LAYER_SHADOW_CASTER);

    this.depthMat = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: shared.uAtlas,
        uTime: shared.uTime,
        uWind: shared.uWind,
        uWindSpeed: shared.uWindSpeed,
      },
      vertexShader: depthVert,
      fragmentShader: depthFrag,
    });
  }

  // Bind/unbind the depth maps + strength. Unbound (null) on Low/Medium so an
  // un-rendered target is never left bound to the chunk material.
  setActive(active: boolean): void {
    this.shared.uShadowMap0.value = active ? this.rt0.depthTexture : null;
    this.shared.uShadowMap1.value = active ? this.rt1.depthTexture : null;
    this.shared.uShadowStrength.value = active ? SHADOW_STRENGTH : 0;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, center: THREE.Vector3, day: DayNight): void {
    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevAutoClear = renderer.autoClear;
    scene.overrideMaterial = this.depthMat;
    renderer.autoClear = true;

    this.renderCascade(renderer, scene, center, day, this.cam0, this.rt0, SHADOW_CASCADE0, this.shared.uShadowMatrix0.value);
    this.renderCascade(renderer, scene, center, day, this.cam1, this.rt1, SHADOW_CASCADE1, this.shared.uShadowMatrix1.value);

    scene.overrideMaterial = prevOverride;
    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prevTarget);
  }

  private renderCascade(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    center: THREE.Vector3,
    day: DayNight,
    cam: THREE.OrthographicCamera,
    rt: THREE.WebGLRenderTarget,
    extent: number,
    outMatrix: THREE.Matrix4,
  ): void {
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 1;
    cam.far = SHADOW_DEPTH;

    // Up vector: avoid degeneracy when the sun is straight overhead (noon).
    this.up.set(0, 1, 0);
    if (Math.abs(day.sunDir.y) > 0.95) this.up.set(0, 0, 1);

    cam.position.copy(center).addScaledVector(day.sunDir, SHADOW_CAM_DIST);
    cam.up.copy(this.up);
    cam.lookAt(center);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();

    // Texel-snap in light space (kills shadow crawl when the player moves):
    // map the world origin through the view-proj, round to whole texels, and
    // nudge the projection by the sub-texel remainder.
    this.tmpVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.origin.set(0, 0, 0).applyMatrix4(this.tmpVP).multiplyScalar(SHADOW_MAP_SIZE / 2);
    const dx = (Math.round(this.origin.x) - this.origin.x) * (2 / SHADOW_MAP_SIZE);
    const dy = (Math.round(this.origin.y) - this.origin.y) * (2 / SHADOW_MAP_SIZE);
    cam.projectionMatrix.elements[12] += dx;
    cam.projectionMatrix.elements[13] += dy;

    outMatrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).premultiply(BIAS);

    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
  }
}
