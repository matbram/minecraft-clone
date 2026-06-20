// Voxel vertex shader (ShaderMaterial: position/uv/normal + built-in matrices
// are injected by three.js). `light` is our custom per-vertex attribute — flat
// per-face shading in Phase 0, baked smooth lighting in Phase 3 (same layout).

attribute float light;

varying vec2 vUv;
varying float vLight;
varying float vFogDepth;

void main() {
  vUv = uv;
  vLight = light;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
