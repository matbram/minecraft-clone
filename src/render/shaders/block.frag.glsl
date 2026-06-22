precision highp float;

uniform sampler2D uAtlas;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uAlphaTest; // 0.5 for opaque cutout pass, 0.0 for the blended pass
uniform float uDayFactor; // scales SKY light only (day/night; 1.0 = full day)
uniform float uAmbient; // floor so caves are dark but not pure black
uniform vec3 uSunDir;
uniform float uTime;

// Phase 7a — moonlight.
uniform float uMoonFactor;   // directional moon sky-light at night (0 by day)
uniform float uNightAmbient; // faint unshadowed night skyglow floor
uniform vec3 uShadowDir;     // active shadow light (sun by day / moon by night)
uniform vec3 uSkyLightColor; // tints the sky-light term: warm low sun / cool night

// Phase 7b — underwater.
uniform float uUnderwater;      // 1 when the camera eye is submerged
uniform float uUnderwaterDepth; // 0..1 = how far below the surface the eye is

// Phase 4b — sun shadows (2-split cascade). uShadowStrength == 0 -> disabled.
uniform sampler2D uShadowMap0;
uniform sampler2D uShadowMap1;
uniform mat4 uShadowMatrix0;
uniform mat4 uShadowMatrix1;
uniform float uShadowStrength;
uniform float uShadowTexel;

// Phase 4b — planar reflective water. uReflectStrength == 0 -> disabled.
uniform sampler2D uReflectMap;
uniform float uReflectStrength;
uniform vec3 uSkyReflect; // Phase 16.1 — sky colour for water reflection when no planar map

// Phase 15.7/15.8 — dynamic torch/flare point lights (held + nearby placed). MAX must match
// MAX_TORCH_LIGHTS in src/core/constants.ts. uTorchCount==0 -> the loop breaks immediately.
const int MAX_TORCH_LIGHTS = 16;
uniform vec3 uTorchPositions[MAX_TORCH_LIGHTS];
uniform vec3 uTorchColors[MAX_TORCH_LIGHTS];
uniform int uTorchCount;
uniform float uTorchRange;
uniform float uTorchIntensity;

varying vec2 vUv;
varying vec3 vLight; // x=sky, y=block, z=ao
varying float vFogDepth;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vReflect;
varying vec4 vReflectCoord;
varying vec3 vTint;

const float SHADOW_BIAS = 0.0009;

// PCF 3x3; returns visibility (1 = fully lit, 0 = fully shadowed).
float sampleCascade(sampler2D map, vec3 coord, float bias) {
  float vis = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      float d = texture2D(map, coord.xy + vec2(float(x), float(y)) * uShadowTexel).r;
      vis += coord.z - bias > d ? 0.0 : 1.0;
    }
  }
  return vis / 9.0;
}

float inBox(vec3 c) {
  return (c.x > 0.0 && c.x < 1.0 && c.y > 0.0 && c.y < 1.0 && c.z < 1.0) ? 1.0 : 0.0;
}

float lightShadow() {
  if (uShadowStrength <= 0.0) return 1.0;
  vec3 n = normalize(vWorldNormal);
  float ndl = max(dot(n, uShadowDir), 0.0);
  float bias = clamp(SHADOW_BIAS * (1.0 + 2.0 * (1.0 - ndl)), SHADOW_BIAS, SHADOW_BIAS * 4.0);

  vec3 c0 = (uShadowMatrix0 * vec4(vWorldPos, 1.0)).xyz; // ortho -> w == 1
  float vis;
  if (inBox(c0) > 0.5) {
    vis = sampleCascade(uShadowMap0, c0, bias);
  } else {
    vec3 c1 = (uShadowMatrix1 * vec4(vWorldPos, 1.0)).xyz;
    if (inBox(c1) > 0.5) {
      vis = sampleCascade(uShadowMap1, c1, bias);
      // Soften the far cascade's outer edge so shadows fade rather than pop.
      vec2 e = min(c1.xy, 1.0 - c1.xy);
      vis = mix(1.0, vis, clamp(min(e.x, e.y) / 0.06, 0.0, 1.0));
    } else {
      vis = 1.0;
    }
  }

  // Fade out as the active light nears / drops below the horizon.
  float elev = smoothstep(0.0, 0.16, uShadowDir.y);
  return mix(1.0, vis, uShadowStrength * elev);
}

// Cheap animated caustics: layered sins sharpened into rippling light cells.
float caustics(vec2 p, float t) {
  float a = sin(p.x * 3.0 + t * 1.3) + sin(p.y * 3.1 - t * 1.1) + sin((p.x + p.y) * 2.2 + t * 0.9);
  float b = sin(p.x * 1.7 - t * 0.8) * sin(p.y * 1.9 + t * 1.0);
  float v = clamp((a * 0.16 + b * 0.5) * 0.5 + 0.5, 0.0, 1.0);
  return pow(v, 3.0);
}

void main() {
  vec4 tex = texture2D(uAtlas, vUv);
  if (tex.a < uAlphaTest) discard;

  float shadow = lightShadow();
  // Sun by day, moon by night — shadow dims whichever directional light is up;
  // the night skyglow floor (uNightAmbient) stays unshadowed so shadows aren't black.
  float dir = max(uDayFactor, uMoonFactor) * shadow;
  float skyTerm = vLight.x * max(dir, uNightAmbient);
  // Colored directional sky light (warm at low sun, white midday, cool at night);
  // block/torch light (vLight.y) stays neutral. This is the golden-hour look.
  vec3 lit = max(vec3(vLight.y), skyTerm * uSkyLightColor);
  lit = max(lit, vec3(uAmbient));                                  // cave floor
  lit *= vLight.z;                                                 // ambient occlusion

  // Phase 15.7/15.8 — dynamic torch/flare point lights (held + nearby placed): warm/red
  // distance-attenuated glow added to the lit term (illuminates the texture like real block
  // light, not a white wash). Placed torches use this same light, so they match the held one.
  vec3 torch = vec3(0.0);
  for (int i = 0; i < MAX_TORCH_LIGHTS; i++) {
    if (i >= uTorchCount) break;
    float td = length(uTorchPositions[i] - vWorldPos);
    float ta = clamp(1.0 - td / uTorchRange, 0.0, 1.0);
    torch += uTorchColors[i] * (ta * ta);
  }
  lit += torch * uTorchIntensity;

  // Underwater caustics: rippling SUN light on sky-exposed up-faces only (so it has
  // a real source). Scaled by daylight (gone at night) and fading with depth.
  if (uUnderwater > 0.5) {
    float up = max(normalize(vWorldNormal).y, 0.0);
    float c = caustics(vWorldPos.xz, uTime);
    lit += vec3(c * up * vLight.x * uDayFactor * 0.34 * (1.0 - uUnderwaterDepth)); // 16.2b: brighter dancing caustics
  }

  vec3 color = tex.rgb * lit * vTint; // vTint = biome colour (1,1,1 on non-foliage)
  float outA = tex.a;

  // Phase 16.1: smooth, rippling, REFLECTIVE water surface (top faces; vReflect baked at mesh
  // time: 1.0 = sea-level surface -> planar mirror, 0.4 = other water top -> sky reflection).
  // Procedural world-space shading replaces the per-cell tile, so there's no grid: a deep base
  // tint, a Fresnel-blended reflection (sky + terrain) distorted by world-space ripples, and a
  // rippling sun glint. Looking straight down stays see-through; grazing reads as a mirror.
  if (vReflect > 0.25) {
    const float RIPPLE = 0.14;       // wave steepness (normal tilt)
    const float REFLECT_FLOOR = 0.40; // base reflectivity even looking straight down (16.2a: hide blocky bottom)
    const float GLINT_POW = 200.0;    // sun-glint sharpness
    const float WATER_ALPHA = 0.70;   // see the bottom looking down; opaque at grazing
    const vec3 WATER_BASE = vec3(0.03, 0.10, 0.17); // deep water tint (linear-ish)

    vec3 v = normalize(cameraPosition - vWorldPos);
    vec2 p = vWorldPos.xz;
    float t = uTime;
    // World-space ripple normal — continuous across cells (no per-cell seams).
    float rx = sin(p.x * 0.7 + t * 1.3) + 0.6 * sin((p.x + p.y) * 1.1 + t * 1.9) + 0.4 * sin(p.x * 1.9 - t * 2.3);
    float rz = sin(p.y * 0.7 - t * 1.1) + 0.6 * sin((p.x - p.y) * 1.1 + t * 1.7) + 0.4 * sin(p.y * 1.9 + t * 2.1);
    vec3 n = normalize(vec3(rx * RIPPLE, 1.0, rz * RIPPLE));

    float fres = pow(1.0 - max(dot(n, v), 0.0), 5.0);
    fres = clamp(REFLECT_FLOOR + (1.0 - REFLECT_FLOOR) * fres, 0.0, 1.0);

    // Reflection colour: the real planar mirror at the sea-level surface (Cinematic), else a
    // cheap sky-coloured reflection (Medium/Low + elevated water). Both rippled.
    vec3 refl;
    if (vReflect > 0.75 && uReflectStrength > 0.0) {
      vec2 ruv = vReflectCoord.xy / vReflectCoord.w + vec2(rx, rz) * 0.02;
      refl = texture2D(uReflectMap, ruv).rgb;
    } else {
      refl = uSkyReflect;
    }

    vec3 base = WATER_BASE * lit; // smooth base, dimmed by day/night world light
    color = mix(base, refl, fres);

    // Rippling sun glint (only while the sun is up).
    vec3 rdir = reflect(-uSunDir, n);
    float spec = pow(max(dot(rdir, v), 0.0), GLINT_POW) * step(0.0, uSunDir.y);
    color += spec * vec3(1.0, 0.97, 0.85) * 1.3;

    outA = mix(WATER_ALPHA, 1.0, fres);
  }

  // Underwater light absorption along the view ray: water removes red fastest with
  // distance (-> blue-green). This is a CONSTANT per-meter water property (clarity),
  // independent of depth (Phase 11.2). Distance darkening now comes from the
  // light-scaled veil (uFogColor) plus each surface's own baked light, so a shallow
  // pool reads clear while a deep column darkens because little light reaches it.
  if (uUnderwater > 0.5) {
    color *= exp(-vFogDepth * vec3(0.020, 0.009, 0.004));
  }

  // Exponential distance fog so the render edge dissolves into the sky color.
  float fog = clamp(1.0 - exp(-uFogDensity * vFogDepth), 0.0, 1.0);
  color = mix(color, uFogColor, fog);

  gl_FragColor = vec4(color, outA);
}
