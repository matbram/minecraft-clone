// Voxel vertex shader (ShaderMaterial: position/uv/normal + built-in matrices
// are injected by three.js). `light` carries baked smooth lighting:
//   x = sky light (0..1), y = block light (0..1), z = ambient occlusion (0..1).

attribute vec3 light;

varying vec2 vUv;
varying vec3 vLight;
varying float vFogDepth;

void main() {
  vUv = uv;
  vLight = light;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
