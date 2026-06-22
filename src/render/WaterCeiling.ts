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

const SIZE = 3000; // larger than the distance fade range so the plane edge never shows

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
  uniform vec3 uCamPos, uSurfaceColor, uDeepColor; // uSurfaceColor=bright cyan, uDeepColor=edge blue
  uniform float uStrength; // user tuning knob (0..1): overall surface opacity
  uniform float uTime, uFade;

  // Layered drifting waves + a finer crinkle -> the busy, rippling surface texture you
  // see looking up while snorkelling (not a flat tint).
  float surf(vec2 p) {
    float w = sin(p.x * 0.55 + uTime * 1.3)
            + sin(p.y * 0.48 - uTime * 1.1)
            + sin((p.x + p.y) * 0.33 + uTime * 0.7);
    w += 0.6 * (sin(p.x * 1.7 - uTime * 2.1) + sin(p.y * 1.9 + uTime * 1.7));
    w += 0.35 * sin((p.x - p.y) * 3.1 + uTime * 2.7);
    return w;
  }

  void main() {
    vec3 v = normalize(vWorldPos - uCamPos);
    float up = clamp(v.y, 0.0, 1.0);               // 1 = looking straight up the cone
    float win = smoothstep(0.45, 0.97, up);         // broad, soft Snell window
    float rw = surf(vWorldPos.xz);
    float ripple = rw * 0.12;                        // brightness wobble
    float glint = smoothstep(2.4, 3.6, rw);          // bright crests

    // Dome colour: ocean-blue at grazing edges -> bright cyan toward the window ->
    // near-white in the centre. This bright-centre / dark-rim IS the reference vignette.
    vec3 base = mix(uDeepColor, uSurfaceColor, smoothstep(0.0, 0.7, up));
    vec3 col = mix(base, vec3(1.0), win); // 16.2b: brighter Snell window (whiter centre)
    col += (ripple + glint * 0.6) * (0.3 + 0.7 * win); // ripples sparkle most near the window
    col *= (0.4 + 0.6 * uFade);                         // dim at night, full in daylight

    // Opacity: opaque sheet occludes the sky/clouds everywhere except the see-through
    // window (so the sun shows through there). Decoupled from light so it's ALWAYS a
    // surface, day or night; the knob (uStrength) scales it.
    float dist = length(vWorldPos.xz - uCamPos.xz);
    float distFade = smoothstep(1400.0, 30.0, dist);
    float alpha = mix(0.94, 0.20, win) * distFade * uStrength;
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
        uStrength: { value: 1 },
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
  // (0..1) is the light at the SURFACE (≈full sky in open water, ≈0 in a sealed cave,
  // dimmed gently with depth). `strength` (0..1) is the user "Water surface" knob scaling
  // overall opacity; either at ~0 hides it. `surfaceY` must be above the camera.
  update(
    camPos: THREE.Vector3,
    surfaceY: number,
    time: number,
    fade: number,
    strength: number,
    cyan: THREE.Color, // bright lit surface colour (window centre brightens to white)
    edge: THREE.Color, // ocean-blue toward grazing edges (the dark vignette rim)
  ): void {
    if (fade <= 0.001 || strength <= 0.001 || surfaceY <= camPos.y) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.mesh.position.set(camPos.x, surfaceY, camPos.z);
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uFade.value = Math.min(1, fade);
    this.mat.uniforms.uStrength.value = Math.min(1, strength);
    (this.mat.uniforms.uCamPos.value as THREE.Vector3).copy(camPos);
    (this.mat.uniforms.uSurfaceColor.value as THREE.Color).copy(cyan);
    (this.mat.uniforms.uDeepColor.value as THREE.Color).copy(edge);
  }

  hide(): void {
    this.mesh.visible = false;
  }
}
