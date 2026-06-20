// Phase 4b — true planar water reflection.
//
// Every water surface in this world is coplanar at WATER_SURFACE_Y (WorldGen
// only fills water up to sea level and the player can't place water), so a single
// mirror plane is exactly correct. Each frame we reflect the main camera across
// that plane, clip everything below it with an oblique near plane (Lengyel /
// THREE.Reflector technique), and render the scene into a half-res target. The
// chunk shader samples it projectively on the reflective water top-faces.
//
// The reflection camera uses the DEFAULT layer mask, so it sees opaque chunks +
// sky/sun but NOT the transparent water (which lives only on LAYER_TRANSPARENT)
// — no self-reflection. Reflected terrain uses the chunk material, so it is
// shadowed for free when shadows are enabled.

import * as THREE from 'three';
import { WATER_SURFACE_Y, REFLECT_DOWNSCALE } from '../../core/constants';
import type { Materials } from '../materials';

export class PlanarReflection {
  private readonly shared: Materials['shared'];
  private readonly rt: THREE.WebGLRenderTarget;
  private readonly reflectCam = new THREE.PerspectiveCamera();

  private readonly normal = new THREE.Vector3(0, 1, 0);
  private readonly planePoint = new THREE.Vector3(0, WATER_SURFACE_Y, 0);
  private readonly reflectorPlane = new THREE.Plane();
  private readonly clipPlane = new THREE.Vector4();
  private readonly q = new THREE.Vector4();
  private readonly view = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly rotation = new THREE.Matrix4();
  private readonly camWorldPos = new THREE.Vector3();
  private readonly textureMatrix = new THREE.Matrix4();

  constructor(shared: Materials['shared']) {
    this.shared = shared;
    this.rt = new THREE.WebGLRenderTarget(1, 1);
    this.rt.texture.minFilter = THREE.LinearFilter;
    this.rt.texture.magFilter = THREE.LinearFilter;
    this.rt.texture.generateMipmaps = false;
    this.setSize(window.innerWidth, window.innerHeight);
  }

  setSize(w: number, h: number): void {
    this.rt.setSize(
      Math.max(1, Math.floor(w * REFLECT_DOWNSCALE)),
      Math.max(1, Math.floor(h * REFLECT_DOWNSCALE)),
    );
  }

  // render() binds the map + strength each active frame; when inactive we unbind
  // so an un-rendered target is never left bound to the chunk material.
  setActive(active: boolean): void {
    if (!active) {
      this.shared.uReflectMap.value = null;
      this.shared.uReflectStrength.value = 0;
    }
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    // Below the surface looking up, the mirror is invalid -> flat-water fallback.
    if (camera.position.y <= WATER_SURFACE_Y + 0.02) {
      this.shared.uReflectStrength.value = 0;
      return;
    }

    camera.updateMatrixWorld();
    camera.getWorldPosition(this.camWorldPos);
    const rc = this.reflectCam;

    // Reflect the camera position across the plane.
    this.view.subVectors(this.planePoint, this.camWorldPos);
    this.view.reflect(this.normal).negate().add(this.planePoint);

    // Reflect the look-at point.
    this.rotation.extractRotation(camera.matrixWorld);
    this.lookAt.set(0, 0, -1).applyMatrix4(this.rotation).add(this.camWorldPos);
    this.target.subVectors(this.planePoint, this.lookAt);
    this.target.reflect(this.normal).negate().add(this.planePoint);

    rc.position.copy(this.view);
    rc.up.set(0, 1, 0).applyMatrix4(this.rotation).reflect(this.normal);
    rc.lookAt(this.target);
    rc.near = camera.near;
    rc.far = camera.far;
    rc.updateMatrixWorld(true);
    rc.projectionMatrix.copy(camera.projectionMatrix);

    // texture matrix: world -> reflection UV (projective), incl. [0,1] bias.
    this.textureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0,
    );
    this.textureMatrix.multiply(rc.projectionMatrix);
    this.textureMatrix.multiply(rc.matrixWorldInverse);

    // Oblique near plane at the water surface so geometry below it isn't drawn
    // into the reflection (Lengyel). Build the clip plane in reflection-view space.
    this.reflectorPlane.setFromNormalAndCoplanarPoint(this.normal, this.planePoint);
    this.reflectorPlane.applyMatrix4(rc.matrixWorldInverse);
    this.clipPlane.set(
      this.reflectorPlane.normal.x,
      this.reflectorPlane.normal.y,
      this.reflectorPlane.normal.z,
      this.reflectorPlane.constant,
    );
    const p = rc.projectionMatrix;
    this.q.x = (Math.sign(this.clipPlane.x) + p.elements[8]) / p.elements[0];
    this.q.y = (Math.sign(this.clipPlane.y) + p.elements[9]) / p.elements[5];
    this.q.z = -1.0;
    this.q.w = (1.0 + p.elements[10]) / p.elements[14];
    this.clipPlane.multiplyScalar(2.0 / this.clipPlane.dot(this.q));
    p.elements[2] = this.clipPlane.x;
    p.elements[6] = this.clipPlane.y;
    p.elements[10] = this.clipPlane.z + 1.0;
    p.elements[14] = this.clipPlane.w;

    // Unbind the reflection texture while rendering INTO it — opaque chunks share
    // the chunk material (which holds uReflectMap) and would otherwise form a
    // read/write feedback loop on the same target. (Opaque has vReflect=0 so it
    // never actually samples it; this just avoids the GL warning.)
    const prevTarget = renderer.getRenderTarget();
    this.shared.uReflectMap.value = null;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, rc);
    renderer.setRenderTarget(prevTarget);
    this.shared.uReflectMap.value = this.rt.texture;

    this.shared.uReflectMatrix.value.copy(this.textureMatrix);
    this.shared.uReflectStrength.value = 1;
  }
}
