// Depth caster fragment: discard alpha-cut texels (leaves) so foliage casts a
// leafy shadow rather than a solid block. Depth is written automatically; the
// color attachment is unused.

precision highp float;

uniform sampler2D uAtlas;

varying vec2 vUv;

void main() {
  if (texture2D(uAtlas, vUv).a < 0.5) discard;
  gl_FragColor = vec4(1.0);
}
