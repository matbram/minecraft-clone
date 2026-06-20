// Exactly ONE opaque + ONE transparent ShaderMaterial, reused by every chunk.
//
// Both materials share the SAME uniform value objects (uAtlas/uFog/uTime), so
// updating them once per frame updates both. Only uAlphaTest differs per pass.

import * as THREE from 'three';
import {
  DAY_FACTOR_DEFAULT,
  LIGHT_AMBIENT,
  WIND_SPEED,
  WIND_STRENGTH,
  SHADOW_MAP_SIZE,
} from '../core/constants';
import vertexShader from './shaders/block.vert.glsl?raw';
import fragmentShader from './shaders/block.frag.glsl?raw';

export interface Materials {
  opaque: THREE.ShaderMaterial;
  transparent: THREE.ShaderMaterial;
  shared: {
    uAtlas: { value: THREE.Texture };
    uFogColor: { value: THREE.Color };
    uFogDensity: { value: number };
    uTime: { value: number };
    uDayFactor: { value: number };
    uAmbient: { value: number };
    uSunDir: { value: THREE.Vector3 };
    // Phase 8a — colored directional sky light (warm low sun / white noon / cool night).
    uSkyLightColor: { value: THREE.Color };
    // Phase 7a — moonlight: directional moon sky-light, night skyglow floor, and
    // the active shadow-casting light dir (sun by day / moon by night).
    uMoonFactor: { value: number };
    uNightAmbient: { value: number };
    uShadowDir: { value: THREE.Vector3 };
    // Phase 7b/9 — underwater: 1 when submerged; depth 0..1 below surface; fill =
    // scattered near-surface ambient light so the volume reads lit-from-above.
    uUnderwater: { value: number };
    uUnderwaterDepth: { value: number };
    uUnderwaterFill: { value: number };
    uWind: { value: number };
    uWindSpeed: { value: number };
    // Phase 4b — sun shadows (Cinematic; uShadowStrength=0 disables + early-outs).
    uShadowMap0: { value: THREE.Texture | null };
    uShadowMap1: { value: THREE.Texture | null };
    uShadowMatrix0: { value: THREE.Matrix4 };
    uShadowMatrix1: { value: THREE.Matrix4 };
    uShadowStrength: { value: number };
    uShadowTexel: { value: number };
    // Phase 4b — planar reflective water (uReflectStrength=0 disables + early-outs).
    uReflectMap: { value: THREE.Texture | null };
    uReflectMatrix: { value: THREE.Matrix4 };
    uReflectStrength: { value: number };
  };
}

export function createMaterials(atlas: THREE.Texture, fogColor: THREE.Color): Materials {
  const shared = {
    uAtlas: { value: atlas },
    uFogColor: { value: fogColor },
    uFogDensity: { value: 0.0145 },
    uTime: { value: 0 },
    uDayFactor: { value: DAY_FACTOR_DEFAULT },
    uAmbient: { value: LIGHT_AMBIENT },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSkyLightColor: { value: new THREE.Color(1, 1, 1) },
    uMoonFactor: { value: 0 },
    uNightAmbient: { value: 0 },
    uShadowDir: { value: new THREE.Vector3(0, 1, 0) },
    uUnderwater: { value: 0 },
    uUnderwaterDepth: { value: 0 },
    uUnderwaterFill: { value: 0 },
    uWind: { value: WIND_STRENGTH },
    uWindSpeed: { value: WIND_SPEED },
    uShadowMap0: { value: null as THREE.Texture | null },
    uShadowMap1: { value: null as THREE.Texture | null },
    uShadowMatrix0: { value: new THREE.Matrix4() },
    uShadowMatrix1: { value: new THREE.Matrix4() },
    uShadowStrength: { value: 0 },
    uShadowTexel: { value: 1 / SHADOW_MAP_SIZE },
    uReflectMap: { value: null as THREE.Texture | null },
    uReflectMatrix: { value: new THREE.Matrix4() },
    uReflectStrength: { value: 0 },
  };

  const opaque = new THREE.ShaderMaterial({
    uniforms: { ...shared, uAlphaTest: { value: 0.5 } },
    vertexShader,
    fragmentShader,
  });

  const transparent = new THREE.ShaderMaterial({
    uniforms: { ...shared, uAlphaTest: { value: 0.0 } },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
  });

  return { opaque, transparent, shared };
}
