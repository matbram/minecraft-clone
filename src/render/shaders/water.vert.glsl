// Phase 17 — continuous water surface vertex shader (its own ShaderMaterial, sharing
// the block material's uniform block). The heightfield geometry already carries the
// smoothed/feathered surface; here we just pass world position + the baked per-vertex
// flow / light / foam / depth to the fragment shader, plus the planar-reflection coord.

attribute vec2 flow;   // horizontal flow direction (rivers/waterfalls show direction)
attribute vec2 light;  // x = sky (0..1), y = block (0..1)
attribute float edge;  // shoreline foam factor (0..1)
attribute float depth; // water-column thickness below (blocks)

uniform mat4 uReflectMatrix; // world -> reflection texture (projective)

varying vec3 vWorldPos;
varying vec2 vFlow;
varying vec2 vLight;
varying float vEdge;
varying float vDepth;
varying vec4 vReflectCoord;
varying float vFogDepth;

void main() {
  vFlow = flow;
  vLight = light;
  vEdge = edge;
  vDepth = depth;

  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vReflectCoord = uReflectMatrix * worldPos;

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
