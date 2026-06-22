// Phase 17 — the continuous water-surface material. A dedicated ShaderMaterial that
// SHARES the block material's uniform block (materials.shared), so the per-frame
// uniform updates in main.ts (uTime, uSunDir, uReflect*, uSkyReflect, day/night, fog,
// water tunables) drive it for free. Transparent, no depth write, FrontSide (the
// from-below view is handled by WaterCeiling).

import * as THREE from 'three';
import type { Materials } from '../materials';
import vertexShader from '../shaders/water.vert.glsl?raw';
import fragmentShader from '../shaders/water.frag.glsl?raw';

export function createWaterMaterial(shared: Materials['shared']): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}
