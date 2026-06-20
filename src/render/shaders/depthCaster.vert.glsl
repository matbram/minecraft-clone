// Depth-only caster shader for the sun shadow pass. Used as scene.overrideMaterial
// while rendering opaque chunks from the sun's POV into a depth render target.
// Replicates the foliage wind sway from block.vert.glsl so cast shadows line up
// with the visible waving leaves. Color output is unused; only depth matters.

attribute float wave;

uniform float uTime;
uniform float uWind;
uniform float uWindSpeed;

varying vec2 vUv;

void main() {
  vUv = uv;

  vec3 pos = position;
  if (wave > 0.5 && uWind > 0.0) {
    vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
    float t = uTime * uWindSpeed;
    float s = sin(t + wp.x * 0.7 + wp.z * 0.7);
    float s2 = sin(t * 0.6 + wp.x * 0.3 - wp.z * 0.5);
    pos.x += s * uWind;
    pos.z += s2 * uWind;
    pos.y += s * s2 * uWind * 0.3;
  }

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
