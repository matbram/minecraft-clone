// Pragmatic single-pass "light scattering" god rays: a radial blur of the bright
// parts of the frame toward the sun's screen position. No occlusion buffer. Gated
// off (uVisible=0 -> passthrough) when the sun is off-screen or below the horizon,
// and faded as the sun nears the screen edge so it can't pop.

import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Vector2 } from 'three';
import { GODRAYS_DENSITY, GODRAYS_WEIGHT, GODRAYS_DECAY, GODRAYS_EXPOSURE } from '../../core/constants';

export function createGodRaysPass(): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uSunUv: { value: new Vector2(0.5, 0.5) },
      uDensity: { value: GODRAYS_DENSITY },
      uWeight: { value: GODRAYS_WEIGHT },
      uDecay: { value: GODRAYS_DECAY },
      uExposure: { value: GODRAYS_EXPOSURE },
      uVisible: { value: 0 },
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
      uniform vec2 uSunUv;
      uniform float uDensity, uWeight, uDecay, uExposure, uVisible;
      varying vec2 vUv;
      const int SAMPLES = 50;
      void main() {
        vec4 base = texture2D(tDiffuse, vUv);
        if (uVisible < 0.5) { gl_FragColor = base; return; }
        vec2 delta = (vUv - uSunUv) * (uDensity / float(SAMPLES));
        vec2 coord = vUv;
        float illum = 1.0;
        vec3 accum = vec3(0.0);
        for (int i = 0; i < SAMPLES; i++) {
          coord -= delta;
          vec3 s = texture2D(tDiffuse, coord).rgb;
          float l = dot(s, vec3(0.299, 0.587, 0.114));
          s *= smoothstep(0.55, 0.9, l);   // only bright pixels streak
          accum += s * illum * uWeight;
          illum *= uDecay;
        }
        float edge = clamp(1.0 - length(uSunUv - vec2(0.5)) * 1.4, 0.0, 1.0);
        gl_FragColor = base + vec4(accum * uExposure * edge, 0.0);
      }
    `,
  });
}
