// Composited card shader. See packages/card-fx/src/presets.ts for the params
// each finish feeds in as uniforms.
precision highp float;

uniform sampler2D uArt;
uniform sampler2D uFoilMask;   // greyscale: where foil applies
uniform sampler2D uNormalMap;  // optional: texture relief / embossing
uniform vec2 uTilt;            // current tilt, -1..1 per axis
uniform vec2 uPointer;         // UV of the light hotspot
uniform float uTime;

uniform float uHueSpread;
uniform float uIntensity;
uniform float uGrainScale;
uniform float uSparkleDensity;
uniform float uReliefStrength;

varying vec2 vUv;

vec3 hueShift(vec3 color, float angle) {
  const vec3 k = vec3(0.57735, 0.57735, 0.57735);
  float cosAngle = cos(angle);
  return color * cosAngle + cross(k, color) * sin(angle) + k * dot(k, color) * (1.0 - cosAngle);
}

void main() {
  vec4 art = texture2D(uArt, vUv);
  float foil = texture2D(uFoilMask, vUv).r;

  float angle = (vUv.x + vUv.y) * 3.14159 * uHueSpread + dot(uTilt, vec2(1.0)) * 2.0;
  vec3 sheen = hueShift(vec3(1.0), angle) * uIntensity;

  float dist = distance(vUv, uPointer);
  float glare = smoothstep(0.4, 0.0, dist);

  vec3 color = art.rgb + sheen * foil * 0.5 + vec3(glare) * foil;

  gl_FragColor = vec4(color, art.a);
}
