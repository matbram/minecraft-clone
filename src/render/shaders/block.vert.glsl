// Voxel vertex shader (ShaderMaterial: position/uv/normal + built-in matrices
// are injected by three.js). `light` carries baked smooth lighting:
//   x = sky light (0..1), y = block light (0..1), z = ambient occlusion (0..1).
// `wave` = 1 for foliage vertices (visual sway only; collision uses block data).
// `refl` = 1 for reflective water top faces (Phase 4b planar reflection).

attribute vec3 light;
attribute float wave;
attribute float refl;

uniform float uTime;
uniform float uWind;
uniform float uWindSpeed;
uniform mat4 uReflectMatrix; // Phase 4b: world -> reflection texture (projective)

varying vec2 vUv;
varying vec3 vLight;
varying float vFogDepth;
varying vec3 vWorldPos;    // Phase 4b: shadow projection + water Fresnel
varying vec3 vWorldNormal; // Phase 4b: chunk model matrix is translation-only
varying float vReflect;
varying vec4 vReflectCoord;

void main() {
  vUv = uv;
  vLight = light;

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
  vReflect = refl;
  vReflectCoord = uReflectMatrix * worldPos;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
