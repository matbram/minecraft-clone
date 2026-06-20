// Phase 11.5b — the underside of the water surface, seen from below. The water
// mesh's top face is back-face-culled from underneath (and the sky barely fades in
// shallow water), so being submerged near the surface looked like open air with a
// faint tint. This is a dedicated, isolated overhead plane (modelled on Clouds): a
// large camera-following sheet sitting at the LOCAL water-surface height, shaded as a
// rippling translucent surface with a Snell's window (the bright ~48.6° cone, looking
// near-straight-up, where the sky shows through) fading to a more opaque mirror at
// grazing angles. Touches NOTHING in the shared water/glass/leaves material — the
// above-water look is unchanged.

import * as THREE from 'three';

const SIZE = 1600; // big enough to fill the upper view; far parts fade in the shader

const vertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec3 vWorldPos;
  uniform vec3 uCamPos, uSurfaceColor, uDeepColor;
  uniform float uTime, uFade;

  float ripple(vec2 p) {
    return sin(p.x * 0.55 + uTime * 1.3)
         + sin(p.y * 0.48 - uTime * 1.1)
         + sin((p.x + p.y) * 0.33 + uTime * 0.7);
  }

  void main() {
    vec3 v = normalize(vWorldPos - uCamPos);
    float up = clamp(v.y, 0.0, 1.0);             // how much we look UP at this point
    float win = smoothstep(0.62, 0.92, up);       // inside the Snell refraction cone
    float r = ripple(vWorldPos.xz) * 0.16;        // living surface shimmer

    // Sheet: deep-mirror teal at grazing -> lit surface colour straight up; the
    // window brightens toward white (the compressed sky punching through).
    vec3 sheet = mix(uDeepColor * 1.3, uSurfaceColor, 0.35 + 0.65 * win);
    vec3 col = mix(sheet, vec3(1.0), win * 0.55) * (1.0 + r);

    // Opaque mirror at grazing, more transparent in the window so the sky shows.
    float dist = length(vWorldPos.xz - uCamPos.xz);
    float distFade = smoothstep(700.0, 120.0, dist);
    float alpha = mix(0.9, 0.28, win) * (0.92 + 0.08 * r) * distFade * uFade;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

export class WaterCeiling {
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE);
    geo.rotateX(-Math.PI / 2); // lay flat (normal +Y)
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFade: { value: 0 },
        uCamPos: { value: new THREE.Vector3() },
        uSurfaceColor: { value: new THREE.Color(0x3f86a0) },
        uDeepColor: { value: new THREE.Color(0x0a2230) },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide, // seen from below
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  // Place the sheet at the local surface height above the camera and shade it. `fade`
  // (0..1) is the overall strength = how lit it is here (dims deep / in caves / at
  // night); <= 0 hides it. `surfaceY` should be above the camera (caller guarantees).
  update(
    camPos: THREE.Vector3,
    surfaceY: number,
    time: number,
    fade: number,
    surfaceColor: THREE.Color,
    deepColor: THREE.Color,
  ): void {
    if (fade <= 0.001 || surfaceY <= camPos.y) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.mesh.position.set(camPos.x, surfaceY, camPos.z);
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uFade.value = Math.min(1, fade);
    (this.mat.uniforms.uCamPos.value as THREE.Vector3).copy(camPos);
    (this.mat.uniforms.uSurfaceColor.value as THREE.Color).copy(surfaceColor);
    (this.mat.uniforms.uDeepColor.value as THREE.Color).copy(deepColor);
  }

  hide(): void {
    this.mesh.visible = false;
  }
}
