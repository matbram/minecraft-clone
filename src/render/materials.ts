// Exactly ONE opaque + ONE transparent ShaderMaterial, reused by every chunk.
//
// Both materials share the SAME uniform value objects (uAtlas/uFog/uTime), so
// updating them once per frame updates both. Only uAlphaTest differs per pass.

import * as THREE from 'three';
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
  };
}

export function createMaterials(atlas: THREE.Texture, fogColor: THREE.Color): Materials {
  const shared = {
    uAtlas: { value: atlas },
    uFogColor: { value: fogColor },
    uFogDensity: { value: 0.0145 },
    uTime: { value: 0 },
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
