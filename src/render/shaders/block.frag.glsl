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

varying vec2 vUv;
varying vec3 vLight; // x=sky, y=block, z=ao
varying float vFogDepth;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vReflect;
varying vec4 vReflectCoord;

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

void main() {
  vec4 tex = texture2D(uAtlas, vUv);
  if (tex.a < uAlphaTest) discard;

  float shadow = lightShadow();
  // Sun by day, moon by night — shadow dims whichever directional light is up;
  // the night skyglow floor (uNightAmbient) stays unshadowed so shadows aren't black.
  float dir = max(uDayFactor, uMoonFactor) * shadow;
  float sky = vLight.x * max(dir, uNightAmbient);
  float brightness = max(vLight.y, sky);
  brightness = max(brightness, uAmbient);                          // cave floor
  brightness *= vLight.z;                                          // ambient occlusion

  vec3 color = tex.rgb * brightness;
  float outA = tex.a;

  // Cool moonlight cast at night (subtle; fades out by day).
  float moonMix = clamp(uMoonFactor * 4.0, 0.0, 1.0) * (1.0 - uDayFactor) * 0.5;
  color *= mix(vec3(1.0), vec3(0.702, 0.8, 1.0), moonMix);

  // Planar reflective water (top faces only; vReflect baked at mesh time).
  if (vReflect > 0.5 && uReflectStrength > 0.0) {
    vec3 n = normalize(vWorldNormal);
    vec3 v = normalize(cameraPosition - vWorldPos);
    // Animated ripple distorts the projected reflection lookup.
    vec2 ripple = vec2(
      sin(vWorldPos.x * 0.6 + uTime * 1.3) + sin(vWorldPos.z * 0.8 - uTime * 1.1),
      cos(vWorldPos.z * 0.6 + uTime * 1.0) + sin(vWorldPos.x * 0.7 + uTime * 0.9)
    ) * 0.012;
    vec2 ruv = vReflectCoord.xy / vReflectCoord.w + ripple;
    vec3 refl = texture2D(uReflectMap, ruv).rgb;

    float fres = pow(1.0 - max(dot(n, v), 0.0), 5.0);
    fres = clamp(fres, 0.05, 1.0) * uReflectStrength;

    // Sun specular glint (only while the sun is up).
    vec3 r = reflect(-uSunDir, n);
    float spec = pow(max(dot(r, v), 0.0), 120.0) * step(0.0, uSunDir.y) * uReflectStrength;

    color = mix(color, refl, fres * 0.85);
    color += spec * vec3(1.0, 0.96, 0.82);
    outA = mix(tex.a, 1.0, fres * 0.5); // grazing water reads more solid/mirror-like
  }

  // Exponential distance fog so the render edge dissolves into the sky color.
  float fog = clamp(1.0 - exp(-uFogDensity * vFogDepth), 0.0, 1.0);
  color = mix(color, uFogColor, fog);

  gl_FragColor = vec4(color, outA);
}
