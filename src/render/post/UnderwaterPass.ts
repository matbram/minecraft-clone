// Phase 7b — underwater screen distortion. A full-screen pass that warps the
// image with animated sine refraction, adds a cool tint and a vignette while the
// camera is submerged. uStrength=0 -> passthrough (and the pass is disabled).

import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export function createUnderwaterPass(): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uStrength: { value: 0 },
      uCaustic: { value: 0 }, // drifting light dapple (strong shallow+lit, fades deep)
      uSurface: { value: 0 }, // Snell-window brightening when looking up toward the surface
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D tDiffuse;
      uniform float uTime, uStrength, uCaustic, uSurface;
      varying vec2 vUv;
      void main() {
        if (uStrength < 0.001) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
        vec2 uv = vUv;
        uv.x += sin(uv.y * 22.0 + uTime * 1.6) * 0.0035 * uStrength;
        uv.y += cos(uv.x * 20.0 + uTime * 1.9) * 0.0035 * uStrength;
        uv = clamp(uv, 0.0, 1.0);
        vec3 col = texture2D(tDiffuse, uv).rgb;
        // Cohesive cyan cast — strong and present even in shallow water (a real
        // snorkelling view is saturated blue, not faintly tinted).
        float g = clamp(0.45 + 0.4 * uStrength, 0.0, 0.85);
        col = mix(col, col * vec3(0.30, 0.62, 0.95), g);

        // Drifting caustic dapple: sparse moving highlights over the whole view so the
        // water reads as a lit volume, not a flat tint.
        float ca = sin((vUv.x + vUv.y) * 18.0 + uTime * 1.2)
                 + sin((vUv.x - vUv.y) * 15.0 - uTime * 0.9);
        ca = smoothstep(0.7, 2.0, ca * 0.5 + 1.0);
        col *= 1.0 + ca * 0.16 * uCaustic;

        // Strong vignette, tinted to deep ocean-blue at the edges (the dark rim framing
        // the bright Snell window in the reference) rather than a plain darken.
        float vig = smoothstep(1.25, 0.2, length(vUv - 0.5));
        float ve = mix(1.0, vig, 0.4 + 0.5 * uStrength);
        col = mix(vec3(0.02, 0.10, 0.18), col, ve);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
