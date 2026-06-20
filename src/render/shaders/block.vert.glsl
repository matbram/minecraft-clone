// Voxel vertex shader (ShaderMaterial: position/uv/normal + built-in matrices
// are injected by three.js). `light` carries baked smooth lighting:
//   x = sky light (0..1), y = block light (0..1), z = ambient occlusion (0..1).
// `wave` = 1 for foliage vertices (visual sway only; collision uses block data).

attribute vec3 light;
attribute float wave;

uniform float uTime;
uniform float uWind;
uniform float uWindSpeed;

varying vec2 vUv;
varying vec3 vLight;
varying float vFogDepth;

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

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
