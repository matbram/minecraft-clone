precision highp float;

uniform sampler2D uAtlas;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uAlphaTest; // 0.5 for opaque cutout pass, 0.0 for the blended pass

varying vec2 vUv;
varying float vLight;
varying float vFogDepth;

void main() {
  vec4 tex = texture2D(uAtlas, vUv);
  if (tex.a < uAlphaTest) discard;

  vec3 color = tex.rgb * clamp(vLight, 0.0, 1.0);

  // Exponential distance fog so the render edge dissolves into the sky color.
  float fog = 1.0 - exp(-uFogDensity * vFogDepth);
  fog = clamp(fog, 0.0, 1.0);
  color = mix(color, uFogColor, fog);

  gl_FragColor = vec4(color, tex.a);
}
