precision highp float;

uniform sampler2D uAtlas;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uAlphaTest; // 0.5 for opaque cutout pass, 0.0 for the blended pass
uniform float uDayFactor; // scales SKY light only (day/night; 1.0 = full day)
uniform float uAmbient; // floor so caves are dark but not pure black

varying vec2 vUv;
varying vec3 vLight; // x=sky, y=block, z=ao
varying float vFogDepth;

void main() {
  vec4 tex = texture2D(uAtlas, vUv);
  if (tex.a < uAlphaTest) discard;

  float brightness = max(vLight.y, vLight.x * uDayFactor); // day/night scales sky only
  brightness = max(brightness, uAmbient);                  // cave floor
  brightness *= vLight.z;                                   // ambient occlusion

  vec3 color = tex.rgb * brightness;

  // Exponential distance fog so the render edge dissolves into the sky color.
  float fog = clamp(1.0 - exp(-uFogDensity * vFogDepth), 0.0, 1.0);
  color = mix(color, uFogColor, fog);

  gl_FragColor = vec4(color, tex.a);
}
