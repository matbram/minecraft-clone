precision highp float;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;    // Phase 8a — sun-direction glow
uniform vec3 uSunColor;
uniform float uSunGlow;
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  float t = clamp(dir.y, 0.0, 1.0);      // 0 at horizon, 1 overhead
  float k = pow(1.0 - t, 2.2);           // tight, warm-ish horizon band
  vec3 col = mix(uZenith, uHorizon, k);

  // Dramatic twilight: warm glow concentrated AROUND the sun, biased low so the
  // upper sky stays clean. uSunGlow ~0 at noon/night -> no wash.
  float d = max(dot(dir, uSunDir), 0.0);
  float wash = pow(d, 4.0) * 0.6 + pow(d, 40.0); // wide halo + tight core
  float horizonBias = smoothstep(0.5, 0.0, dir.y);
  float glow = clamp(wash * uSunGlow * horizonBias, 0.0, 1.0);
  col = mix(col, uSunColor, glow);

  gl_FragColor = vec4(col, 1.0);
}
