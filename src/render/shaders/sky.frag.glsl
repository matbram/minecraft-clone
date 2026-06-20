precision highp float;
uniform vec3 uZenith;
uniform vec3 uHorizon;
varying vec3 vDir;
void main() {
  float t = clamp(vDir.y, 0.0, 1.0);     // 0 at horizon, 1 overhead
  float k = pow(1.0 - t, 2.2);           // tight, warm-ish horizon band
  vec3 col = mix(uZenith, uHorizon, k);
  gl_FragColor = vec4(col, 1.0);
}
