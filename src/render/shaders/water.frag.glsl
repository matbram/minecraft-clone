precision highp float;

// Phase 17 — continuous water surface. Procedural world-space shading (no per-cell
// tile, no grid): a depth-based base colour, a Fresnel-blended reflection (planar
// mirror at sea level, else sky colour) distorted by flow-biased ripples, a rippling
// sun glint, and shoreline/edge foam. Standing vs flowing water differ ONLY by the
// baked flow vector biasing the same ripple — so they read as one fluid.

uniform float uTime;
uniform vec3 uSunDir;

// Reflection: planar mirror (Cinematic) at the sea-level surface, else sky colour.
uniform sampler2D uReflectMap;
uniform float uReflectStrength;
uniform vec3 uSkyReflect;

// World light (dim water at night / in caves), matching the block shader's terms.
uniform float uDayFactor;
uniform float uMoonFactor;
uniform float uNightAmbient;

uniform vec3 uFogColor;
uniform float uFogDensity;

// Depth colour + foam tunables (mirror constants; shared with the block material block).
uniform vec3 uWaterShallow;
uniform vec3 uWaterDeep;
uniform float uWaterDepthFade;
uniform float uWaterNormalScroll;

varying vec3 vWorldPos;
varying vec2 vFlow;
varying vec2 vLight;
varying float vEdge;
varying float vDepth;
varying vec4 vReflectCoord;
varying float vFogDepth;

const float WATER_SURFACE_Y = 63.0;  // sea level (SEA_LEVEL+1) -> planar mirror plane
const float RIPPLE = 0.16;            // wave steepness (normal tilt)
const float REFLECT_FLOOR = 0.40;     // base reflectivity even looking straight down
const float GLINT_POW = 200.0;        // sun-glint sharpness
const float WATER_ALPHA = 0.72;       // base transparency (see bottom looking down)

void main() {
  vec3 v = normalize(cameraPosition - vWorldPos);
  vec2 p = vWorldPos.xz;
  float t = uTime;

  // Flow bias: a still cell (flow≈0) gets gentle isotropic ripples; a flowing cell
  // scrolls the wave field along the flow direction so rivers/waterfalls show motion.
  float fl = length(vFlow);
  vec2 fdir = fl > 1e-3 ? vFlow / fl : vec2(0.0);
  vec2 scroll = fdir * (t * (1.0 + 3.0 * fl) * (0.4 + uWaterNormalScroll * 20.0));
  vec2 ps = p + scroll;

  // World-space ripple normal — continuous across cells (no per-cell seams).
  float rx = sin(ps.x * 0.7 + t * 1.3) + 0.6 * sin((ps.x + ps.y) * 1.1 + t * 1.9) + 0.4 * sin(ps.x * 1.9 - t * 2.3);
  float rz = sin(ps.y * 0.7 - t * 1.1) + 0.6 * sin((ps.x - ps.y) * 1.1 + t * 1.7) + 0.4 * sin(ps.y * 1.9 + t * 2.1);
  // Stronger chop along the flow direction for moving water.
  float chop = 1.0 + 1.5 * fl;
  vec3 n = normalize(vec3(rx * RIPPLE * chop, 1.0, rz * RIPPLE * chop));

  float fres = pow(1.0 - max(dot(n, v), 0.0), 5.0);
  fres = clamp(REFLECT_FLOOR + (1.0 - REFLECT_FLOOR) * fres, 0.0, 1.0);

  // Reflection colour: planar mirror at the sea-level surface (Cinematic), else the
  // cheap sky colour (Medium/Low + elevated/flowing water). Both rippled.
  vec3 refl;
  if (uReflectStrength > 0.0 && abs(vWorldPos.y - WATER_SURFACE_Y) < 0.6) {
    vec2 ruv = vReflectCoord.xy / vReflectCoord.w + vec2(rx, rz) * 0.02;
    refl = texture2D(uReflectMap, ruv).rgb;
  } else {
    refl = uSkyReflect;
  }

  // World light level (dim at night / in caves), matching the block shader.
  float skyTerm = vLight.x * max(uDayFactor, max(uMoonFactor, uNightAmbient));
  float lightLevel = clamp(max(vLight.y, skyTerm), 0.0, 1.0);

  // Depth colour: clear shallow -> deep blue with water thickness (baked depthHint).
  float dnorm = clamp(vDepth / uWaterDepthFade, 0.0, 1.0);
  vec3 deepCol = mix(uWaterShallow, uWaterDeep, dnorm);
  vec3 base = deepCol * (0.25 + 0.75 * lightLevel);

  vec3 color = mix(base, refl * (0.4 + 0.6 * lightLevel), fres);

  // Rippling sun glint (only while the sun is up).
  vec3 rdir = reflect(-uSunDir, n);
  float spec = pow(max(dot(rdir, v), 0.0), GLINT_POW) * step(0.0, uSunDir.y);
  color += spec * vec3(1.0, 0.97, 0.85) * 1.3;

  // Shoreline / edge foam (mesh-baked). Animated breakup so it reads as churn, not a
  // flat ring. Kept below the bloom threshold so it doesn't glow.
  float foam = vEdge;
  float churn = 0.5 + 0.5 * sin(p.x * 6.0 + p.y * 5.0 + t * 3.0);
  foam *= 0.6 + 0.4 * churn;
  foam = smoothstep(0.15, 0.9, foam);
  vec3 foamCol = vec3(0.78, 0.86, 0.9) * (0.4 + 0.6 * lightLevel);
  color = mix(color, foamCol, foam);

  // Opacity: clearer over shallow water / looking straight down, opaque at grazing +
  // deep + foamy.
  float alpha = mix(WATER_ALPHA, 1.0, fres);
  alpha = max(alpha, 0.45 + 0.55 * dnorm);
  alpha = max(alpha, foam);

  // Distance fog so the water dissolves into the sky like the terrain.
  float fog = clamp(1.0 - exp(-uFogDensity * vFogDepth), 0.0, 1.0);
  color = mix(color, uFogColor, fog);

  gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
}
