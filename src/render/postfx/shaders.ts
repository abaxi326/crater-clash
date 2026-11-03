/**
 * GLSL ES 3.00 sources for the post-processing chain (see ../postfx.ts).
 *
 * Orientation: the scene canvas is uploaded without UNPACK_FLIP_Y, so texture row 0 is the
 * TOP of the image. Intermediate passes draw with vUv straight through, which keeps that
 * "image space" (v grows downward) in every render target. Only the final composite flips,
 * because the default framebuffer's row 0 is the bottom of the screen. Shockwave UVs from the
 * contract are y-down, i.e. already in image space.
 */

export const MAX_SHOCKWAVES = 8;

/** Full-screen triangle from a 3-vertex buffer (clip-space positions in [-1, 3]). */
export const VERT = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/**
 * Bright pass, full-res scene -> half-res target. Four bilinear taps cover a 4x4 texel block
 * (anti-aliased downsample); each tap is Karis-weighted (1 / (1 + luma)) so single hot pixels
 * do not flicker as the camera moves. Soft knee around the threshold.
 */
export const BRIGHT_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;      // 1 / source size
uniform float uThreshold;
uniform float uKnee;
out vec4 outColor;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 prefilter(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  return c * contrib;
}

void main() {
  vec2 o = uTexel;
  vec3 a = texture(uSrc, vUv + vec2(-o.x, -o.y)).rgb;
  vec3 b = texture(uSrc, vUv + vec2( o.x, -o.y)).rgb;
  vec3 c = texture(uSrc, vUv + vec2(-o.x,  o.y)).rgb;
  vec3 d = texture(uSrc, vUv + vec2( o.x,  o.y)).rgb;
  float wa = 1.0 / (1.0 + luma(a));
  float wb = 1.0 / (1.0 + luma(b));
  float wc = 1.0 / (1.0 + luma(c));
  float wd = 1.0 / (1.0 + luma(d));
  vec3 col = (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
  outColor = vec4(prefilter(col), 1.0);
}`;

/** Dual-Kawase downsample: centre x4 + four diagonal half-texel taps. */
export const DOWN_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;      // 1 / source size
out vec4 outColor;
void main() {
  vec2 h = uTexel;
  vec3 s = texture(uSrc, vUv).rgb * 4.0;
  s += texture(uSrc, vUv + vec2(-h.x, -h.y)).rgb;
  s += texture(uSrc, vUv + vec2( h.x, -h.y)).rgb;
  s += texture(uSrc, vUv + vec2(-h.x,  h.y)).rgb;
  s += texture(uSrc, vUv + vec2( h.x,  h.y)).rgb;
  outColor = vec4(s * 0.125, 1.0);
}`;

/**
 * Dual-Kawase upsample (8 taps, tent-like). The result is blended additively onto the next
 * larger level, so each level accumulates the wider glow of everything below it.
 */
export const UP_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;      // 1 / source size
uniform float uWeight;
out vec4 outColor;
void main() {
  vec2 h = uTexel;
  vec3 s = texture(uSrc, vUv + vec2(-2.0 * h.x, 0.0)).rgb;
  s += texture(uSrc, vUv + vec2( 2.0 * h.x, 0.0)).rgb;
  s += texture(uSrc, vUv + vec2(0.0, -2.0 * h.y)).rgb;
  s += texture(uSrc, vUv + vec2(0.0,  2.0 * h.y)).rgb;
  s += texture(uSrc, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
  s += texture(uSrc, vUv + vec2( h.x, -h.y)).rgb * 2.0;
  s += texture(uSrc, vUv + vec2(-h.x,  h.y)).rgb * 2.0;
  s += texture(uSrc, vUv + vec2( h.x,  h.y)).rgb * 2.0;
  outColor = vec4(s * (uWeight / 12.0), 1.0);
}`;

/**
 * Final composite to the screen. Order: shockwave refraction (+ ring chroma split) and radial
 * chromatic aberration while sampling the scene -> + bloom -> colour grade -> highlight spill
 * -> flash -> vignette -> film grain -> triangular dither (kills 8-bit banding in gradients).
 */
export const COMPOSITE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uBloomTexel;           // 1 / bloom level-0 size
uniform vec2 uSize;                 // output size in px
uniform float uAspect;              // width / height
uniform vec4 uShock[${MAX_SHOCKWAVES}];       // x, y (uv, y down), radius, width (height units)
uniform float uShockStr[${MAX_SHOCKWAVES}];
uniform int uShockCount;
uniform float uChroma;              // 0..1
uniform float uBloomAmt;
uniform vec3 uLift;
uniform vec3 uInvGamma;
uniform vec3 uGain;
uniform float uSaturation;
uniform float uContrast;
uniform vec4 uFlash;                // rgb, amount
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
out vec4 outColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // Image space: (0,0) top-left.
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 asp = vec2(uAspect, 1.0);

  // --- Shockwaves: refraction through a ring-shaped ridge h(t) = (1 - t^2)^2. The sample
  // offset follows the ridge slope, so the band magnifies on its leading edge and compresses
  // behind it, which reads as a pressure wave rather than a smear.
  vec2 disp = vec2(0.0);
  vec2 split = vec2(0.0);
  float crest = 0.0;
  float shade = 0.0;            // embossed lighting across the ridge (bright front, dim wake)
  for (int i = 0; i < ${MAX_SHOCKWAVES}; i++) {
    if (i >= uShockCount) break;
    vec4 s = uShock[i];
    vec2 d = (uv - s.xy) * asp;
    float dist = length(d);
    float t = (dist - s.z) / max(s.w, 1e-4);
    if (abs(t) < 1.0) {
      vec2 dir = d / max(dist, 1e-5);
      float k = 1.0 - t * t;
      float slope = 2.6 * t * k;            // ~ -h'(t) normalised to peak ~1
      float amp = s.w * 0.24 * uShockStr[i];
      disp -= dir * slope * amp;
      split += dir * abs(slope) * amp * 0.16;
      crest += k * k * uShockStr[i];
      shade += slope * k * uShockStr[i];
    }
  }
  disp /= asp;
  split /= asp;

  // --- Radial chromatic aberration (quadratic falloff from centre) plus the ring split.
  vec2 c = uv - 0.5;
  vec2 ca = c * dot(c, c) * (0.0045 + uChroma * 0.03) + split;
  vec2 suv = uv + disp;
  vec3 col;
  col.r = texture(uScene, suv + ca).r;
  col.g = texture(uScene, suv).g;
  col.b = texture(uScene, suv - ca).b;
  col *= 1.0 + shade * 0.07;
  col += crest * 0.025;

  // --- Bloom: 4-tap tent over the half-res level for a smooth bilinear upscale.
  vec2 bh = uBloomTexel * 0.5;
  vec3 bloom = texture(uBloom, uv + vec2(-bh.x, -bh.y)).rgb;
  bloom += texture(uBloom, uv + vec2( bh.x, -bh.y)).rgb;
  bloom += texture(uBloom, uv + vec2(-bh.x,  bh.y)).rgb;
  bloom += texture(uBloom, uv + vec2( bh.x,  bh.y)).rgb;
  col += bloom * (0.25 * uBloomAmt);

  // --- Grade: lift / gamma / gain, contrast about mid-grey, saturation. Identity when neutral.
  col = uGain * (col + uLift * (1.0 - col));
  col = pow(max(col, 0.0), uInvGamma);
  col = (col - 0.5) * uContrast + 0.5;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(l), col, uSaturation), 0.0);

  // Blown highlights spill into the other channels (bright bloom whitens instead of clipping hue).
  float over = max(max(col.r, max(col.g, col.b)) - 1.0, 0.0);
  col += over * 0.45;

  col += uFlash.rgb * uFlash.a;

  // --- Vignette: rounded-rect falloff that follows the screen shape.
  vec2 q = abs(c) * 2.0;
  q = pow(q, vec2(2.6));
  float vd = pow(q.x + q.y, 1.0 / 2.6);
  col *= 1.0 - uVignette * smoothstep(0.45, 1.45, vd) * 0.9;

  col = clamp(col, 0.0, 1.0);

  // --- Film grain: animated, strongest in mid-tones, gone in pure black/white.
  vec2 fc = gl_FragCoord.xy;
  float frame = floor(uTime * 24.0);
  float g = hash12(fc + vec2(frame * 37.0, frame * 17.0)) - 0.5;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col += g * uGrain * 0.11 * (1.0 - abs(lum * 2.0 - 1.0) * 0.7);

  // --- Triangular-PDF dither at +-1 LSB.
  float dn = hash12(fc + 0.37) + hash12(fc.yx * 1.13 + 7.1) - 1.0;
  col += dn / 255.0;

  outColor = vec4(col, 1.0);
}`;
