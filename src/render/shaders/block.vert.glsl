// Voxel vertex shader (ShaderMaterial: position/uv/normal + built-in matrices
// are injected by three.js). `light` carries baked smooth lighting:
//   x = sky light (0..1), y = block light (0..1), z = ambient occlusion (0..1).
// `wave` = 1 for foliage vertices (visual sway only; collision uses block data).
// (Phase 17: water is its own surface mesh/material now — the old per-face water
// reflection attribute/varyings were removed from the block shader.)

attribute vec3 light;
attribute float wave;
attribute vec3 tint; // Phase 12: per-vertex biome colour multiplier (1,1,1 = none)

uniform float uTime;
uniform float uWind;
uniform float uWindSpeed;

varying vec2 vUv;
varying vec3 vLight;
varying float vFogDepth;
varying vec3 vWorldPos;    // Phase 4b: shadow projection
varying vec3 vWorldNormal; // Phase 4b: chunk model matrix is translation-only
varying vec3 vTint;

void main() {
  vUv = uv;
  vLight = light;
  vTint = tint;

  vec3 pos = position;
  if (wave > 0.5 && uWind > 0.0) {
    // World position (chunk-local + chunk-origin translation) keeps the sway
    // coherent across chunk seams.
    vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
    float t = uTime * uWindSpeed;
    float s = sin(t + wp.x * 0.7 + wp.z * 0.7);
    float s2 = sin(t * 0.6 + wp.x * 0.3 - wp.z * 0.5);
    pos.x += s * uWind;
    pos.z += s2 * uWind;
    pos.y += s * s2 * uWind * 0.3;
  }

  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
