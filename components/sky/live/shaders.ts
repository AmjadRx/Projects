/**
 * The live sky's shaders (GLSL ES 3.00, for three.js RawShaderMaterial with glslVersion GLSL3).
 * They repeat, per pixel and per star, what the reference renderer draws on a canvas: the sky's
 * gradient, the Milky Way, the stars with their halos and spikes, the meteor, and the ground grid
 * with the horizon line and the ripple. Every design number comes from SKY in lib/motion.ts and is
 * written into the source as a constant here; every formula is lib/sky/astro.ts's (its airmass and
 * its projection's cut-off are mirrored below, and tests/sky-live.test.ts checks the mirror).
 *
 * Coordinates: gl_FragCoord is in device pixels from the bottom left; `cssOf` turns it into CSS
 * px from the top left, the reference's frame. uRes is the drawing buffer's size in device
 * pixels and uScale the device pixels per CSS px on each axis.
 *
 * Every color reaches a shader as a uniform read from the CSS variables (./colors.ts); star colors
 * are data. All output is premultiplied, as the canvas composites it.
 */
import { SKY } from '@/lib/motion';
import { glslFloat as f } from './math';

/**
 * The airmass formula of lib/sky/astro.ts (Kasten and Young, 1989): 1 / (sin h + a (h + b)^c),
 * with h the altitude in degrees. The shaders write these three numbers; the test compares the
 * GLSL text's formula with astro.ts.
 */
export const KASTEN_YOUNG = { a: 0.50572, b: 6.07995, c: -1.6364 } as const;

/** lib/sky/astro.ts `project` drops points whose cos(alt) cos(dAz) is at or under this (behind the viewer). */
export const PROJECT_MIN_COS = 0.02;

const S = SKY.scene;

function consts(values: Record<string, number>): string {
  return Object.entries(values)
    .map(([name, value]) => `const float ${name} = ${f(value)};`)
    .join('\n');
}

const HEADER = `precision highp float;
precision highp int;
`;

const SCREEN = `
uniform vec2 uRes;
uniform vec2 uScale;
vec2 cssOf(vec2 frag) {
  return vec2(frag.x / uScale.x, (uRes.y - frag.y) / uScale.y);
}
`;

/** GLSL source of the airmass function; also read by the test. */
export const AIRMASS_GLSL = `
float airmass(float altDeg) {
  float h = max(0.0, altDeg);
  return 1.0 / (sin(radians(h)) + ${f(KASTEN_YOUNG.a)} * pow(h + ${f(KASTEN_YOUNG.b)}, ${f(KASTEN_YOUNG.c)}));
}
`;

const PI = `const float PI = 3.141592653589793;\n`;

// ---------------------------------------------------------------------------------------------
// A triangle that covers the whole viewport (the sky, the Milky Way and the ground passes)
// ---------------------------------------------------------------------------------------------

export const FULLSCREEN_VERTEX = `${HEADER}
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
// The sky: the gradient from the zenith to the horizon (Blueprint only)
// ---------------------------------------------------------------------------------------------

export const SKY_FRAGMENT = `${HEADER}${SCREEN}
${consts({ MID: S.skyMidStop, DITHER: S.dither })}
uniform float uHorizon;
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uLow;
out vec4 fragColor;

// Interleaved gradient noise (Jimenez 2014): an even dither from 0 to 1 per pixel.
float noise(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec2 css = cssOf(gl_FragCoord.xy);
  float t = clamp(css.y / uHorizon, 0.0, 1.0);
  vec3 c = t < MID ? mix(uZenith, uMid, t / MID) : mix(uMid, uLow, (t - MID) / (1.0 - MID));
  c += (noise(gl_FragCoord.xy) - 0.5) * (DITHER / 255.0);
  fragColor = vec4(c, 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
// The Milky Way: the ESO panorama mapped through galactic coordinates (and the panorama's own small
// offset from them, SKY.scene.milkyWayFrame), added to the sky
// ---------------------------------------------------------------------------------------------

export const MILKY_WAY_FRAGMENT = `${HEADER}${SCREEN}${PI}${AIRMASS_GLSL}
${consts({ EXTINCTION: SKY.extinction, EXPOSURE: SKY.milkyWayExposure, BLACK: S.milkyWayBlack / 255, LAYER: S.milkyWayLayer })}
uniform float uHorizon;
uniform float uWidth;
uniform float uK;
uniform vec2 uOffset;
uniform mat3 uToPanorama;
uniform sampler2D uPanorama;
out vec4 fragColor;

void main() {
  // The layer's own frame: the reference draws the whole layer shifted by the pointer's parallax.
  vec2 css = cssOf(gl_FragCoord.xy) - uOffset;
  float X = css.x - 0.5 * uWidth;
  float Y = uHorizon - css.y;
  // The inverse projection as a direction (forward, right, up), then galactic coordinates in the
  // panorama's own frame (math.ts skyToPanorama).
  float t2 = (X * X + Y * Y) / (4.0 * uK * uK);
  vec3 local = vec3(1.0 - t2, X / uK, Y / uK) / (1.0 + t2);
  vec3 g = uToPanorama * local;
  float l = atan(g.y, g.x);
  float b = asin(clamp(g.z, -1.0, 1.0));
  // galacticToPanorama: u = 0.5 - l / 360 wrapped into [0, 1), v = 0.5 - b / 180.
  float u = 0.5 - l / (2.0 * PI);
  float v = 0.5 - b / PI;
  // No seam where u wraps: take the texture gradient from whichever of two parameterizations is
  // continuous here (Tarini), so the mipmap level never jumps at u = 0 and 1.
  float uA = fract(u);
  float uB = fract(u + 0.5) - 0.5;
  vec2 gA = vec2(dFdx(uA), dFdy(uA));
  vec2 gB = vec2(dFdx(uB), dFdy(uB));
  // The footprint of one of the reference's layer pixels (LAYER CSS px) picks the mipmap level.
  float footprint = LAYER * uScale.x;
  vec2 gu = (dot(gA, gA) <= dot(gB, gB) ? gA : gB) * footprint;
  vec2 gv = vec2(dFdx(v), dFdy(v)) * footprint;
  vec3 texel = textureGrad(uPanorama, vec2(uA, v), vec2(gu.x, gv.x), vec2(gu.y, gv.y)).rgb;
  // Extinction by airmass at the pixel's altitude, and the exposure.
  float altDeg = degrees(asin(clamp(local.z, -1.0, 1.0)));
  float gain = pow(10.0, -0.4 * EXTINCTION * (airmass(altDeg) - 1.0)) * EXPOSURE;
  vec3 c = max(texel - BLACK, 0.0) * gain;
  if (Y <= 0.0) discard;
  fragColor = vec4(c, 0.0);
}
`;

// ---------------------------------------------------------------------------------------------
// The stars: one point per catalogue star
// ---------------------------------------------------------------------------------------------

const STAR = S.star;

export const STAR_VERTEX = `${HEADER}${PI}${AIRMASS_GLSL}
${consts({
  EXTINCTION: SKY.extinction,
  MIN_ALT: STAR.minAltitude,
  MIN_COS: PROJECT_MIN_COS,
  MARGIN: STAR.margin,
  LIMIT: STAR.limit,
  R_BASE: STAR.radius.base,
  R_SLOPE: STAR.radius.slope,
  R_MIN: STAR.radius.min,
  SQUARE_BELOW: STAR.radius.squareBelow,
  A_BASE: STAR.alpha.base,
  A_SLOPE: STAR.alpha.slope,
  A_MIN: STAR.alpha.min,
  A_MAX: STAR.alpha.max,
  SHIMMER_LIMIT: SKY.shimmer.limit,
  SHIMMER_DEPTH: SKY.shimmer.depth,
  HALO_LIMIT: SKY.haloLimit,
  GLOW: STAR.glow.radius,
  SPIKE: STAR.spikes.length,
  SPIKE_W: STAR.spikes.width,
})}
uniform vec2 uRes;
uniform vec2 uScale;
uniform float uWidth;
uniform float uHorizon;
uniform float uK;
uniform float uLst;
uniform vec2 uLat;
uniform float uFacing;
uniform vec2 uShift;
uniform vec2 uShimmer;
uniform float uMaxPoint;
in vec2 aRaDec;
in float aMag;
in vec3 aColor;
in float aDepth;
in float aPhase;
out vec3 vColor;
out vec4 vStar;
out vec2 vCenter;

void hide() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = 0.0;
  vColor = vec3(0.0);
  vStar = vec4(0.0);
  vCenter = vec2(0.0);
}

void main() {
  // toHorizontal: hour angle, altitude and azimuth (from north through east).
  float H = uLst - aRaDec.x;
  float sd = sin(aRaDec.y);
  float cd = cos(aRaDec.y);
  float cH = cos(H);
  float alt = asin(clamp(sd * uLat.x + cd * uLat.y * cH, -1.0, 1.0));
  float az = atan(-cd * sin(H), sd * uLat.y - cd * uLat.x * cH);
  float dAz = mod(az - uFacing + PI, 2.0 * PI) - PI;
  // project: the stereographic projection about the view's centre on the horizon.
  float cosc = cos(alt) * cos(dAz);
  float s = 2.0 * uK / (1.0 + cosc);
  vec2 p = vec2(0.5 * uWidth + s * cos(alt) * sin(dAz) + uShift.x * aDepth, uHorizon - s * sin(alt) + uShift.y * aDepth);
  float altDeg = degrees(alt);
  float v = aMag + EXTINCTION * (airmass(altDeg) - 1.0);
  if (altDeg <= MIN_ALT || cosc <= MIN_COS || p.x < -MARGIN || p.x > uWidth + MARGIN || p.y < -MARGIN || p.y > uHorizon || v > LIMIT) {
    hide();
    return;
  }
  float r = max(R_MIN, R_BASE - R_SLOPE * v);
  float a = clamp(A_BASE - A_SLOPE * v, A_MIN, A_MAX);
  if (v < SHIMMER_LIMIT) a *= 1.0 - uShimmer.y * SHIMMER_DEPTH * (1.0 - sin(uShimmer.x + aPhase));
  float halo = v < HALO_LIMIT ? 1.0 : 0.0;
  float dpr = uScale.x;
  // A star under SQUARE_BELOW px is the reference's square: drawn as a crisp block of whole device
  // pixels, the nearest to its size (always one pixel for the faintest, at the smallest radius),
  // with the same total light, so faint stars stay fine points and never blur into blobs.
  float block = 0.0;
  if (r < SQUARE_BELOW) {
    float side = 2.0 * r * dpr;
    block = r <= R_MIN ? 1.0 : max(1.0, floor(side + 0.5));
    a = min(1.0, a * side * side / (block * block));
  }
  float extent = halo > 0.5 ? max(SPIKE * r + 0.5 * SPIKE_W, GLOW * r) : r;
  float size = block > 0.0 ? block + 2.0 : 2.0 * extent * dpr + 2.0;
  vec2 win = vec2(p.x * uScale.x, uRes.y - p.y * uScale.y);
  gl_Position = vec4(win / uRes * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = min(size, uMaxPoint);
  vColor = aColor;
  vStar = vec4(r, a, halo, block);
  vCenter = win;
}
`;

export const STAR_FRAGMENT = `${HEADER}
${consts({
  GLOW: STAR.glow.radius,
  GLOW_ALPHA: STAR.glow.alpha,
  SPIKE: STAR.spikes.length,
  SPIKE_W: STAR.spikes.width,
  SPIKE_ALPHA: STAR.spikes.alpha,
})}
uniform vec2 uScale;
in vec3 vColor;
in vec4 vStar;
in vec2 vCenter;
out vec4 fragColor;

// The share of the pixel [c - h, c + h] that the band [lo, hi] covers (a box filter).
float band(float c, float h, float lo, float hi) {
  return clamp(min(c + h, hi) - max(c - h, lo), 0.0, 2.0 * h) / (2.0 * h);
}

void main() {
  float r = vStar.x;
  float alpha = vStar.y;
  float block = vStar.w;
  float dpr = uScale.x;
  vec2 dDev = gl_FragCoord.xy - vCenter;
  float core;
  if (block > 0.0) {
    vec2 start = floor(vCenter - 0.5 * block + 0.5);
    vec2 pix = floor(gl_FragCoord.xy);
    core = all(greaterThanEqual(pix, start)) && all(lessThan(pix, start + block)) ? 1.0 : 0.0;
  } else {
    core = clamp(r * dpr + 0.5 - length(dDev), 0.0, 1.0);
  }
  float A = core * alpha;
  if (vStar.z > 0.5) {
    // The halo, under the core: a radial glow, then the diffraction spikes (one stroke of two lines).
    vec2 d = dDev / dpr;
    float h = 0.5 / dpr;
    float glow = GLOW_ALPHA * clamp(1.0 - length(d) / (GLOW * r), 0.0, 1.0);
    float L = SPIKE * r;
    float w = 0.5 * SPIKE_W;
    float hx = band(d.x, h, -L, L);
    float hy = band(d.y, h, -w, w);
    float vx = band(d.x, h, -w, w);
    float vy = band(d.y, h, -L, L);
    float spike = SPIKE_ALPHA * (hx * hy + vx * vy - vx * hy);
    A = 1.0 - (1.0 - glow) * (1.0 - spike) * (1.0 - A);
  }
  A = min(A, 1.0);
  if (A <= 0.0) discard;
  fragColor = vec4(vColor * A, A);
}
`;

// ---------------------------------------------------------------------------------------------
// The meteor: one streak, brightest at its head (Full tier, Blueprint)
// ---------------------------------------------------------------------------------------------

export const METEOR_VERTEX = `${HEADER}${SCREEN}
${consts({ WIDTH: SKY.meteor.width })}
uniform vec2 uHead;
uniform vec2 uTail;
in vec2 position;

void main() {
  vec2 axis = uTail - uHead;
  float len = length(axis);
  vec2 dir = len > 0.0 ? axis / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float margin = 0.5 * WIDTH + 2.0 / uScale.x;
  vec2 css = 0.5 * (uHead + uTail) + dir * position.x * (0.5 * len + margin) + nrm * position.y * margin;
  vec2 win = vec2(css.x * uScale.x, uRes.y - css.y * uScale.y);
  gl_Position = vec4(win / uRes * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const METEOR_FRAGMENT = `${HEADER}${SCREEN}
${consts({ WIDTH: SKY.meteor.width })}
uniform vec2 uHead;
uniform vec2 uTail;
uniform float uAlpha;
uniform vec3 uColor;
out vec4 fragColor;

void main() {
  vec2 css = cssOf(gl_FragCoord.xy);
  vec2 axis = uTail - uHead;
  float len = max(length(axis), 0.0001);
  vec2 dir = axis / len;
  vec2 rel = css - uHead;
  float along = dot(rel, dir);
  float across = abs(rel.x * dir.y - rel.y * dir.x);
  float dpr = uScale.x;
  float cover = clamp(0.5 * WIDTH * dpr + 0.5 - across * dpr, 0.0, 1.0);
  cover *= clamp(along * dpr + 0.5, 0.0, 1.0) * clamp((len - along) * dpr + 0.5, 0.0, 1.0);
  float a = uAlpha * clamp(1.0 - along / len, 0.0, 1.0) * cover;
  if (a <= 0.0) discard;
  fragColor = vec4(uColor * a, a);
}
`;

// ---------------------------------------------------------------------------------------------
// The ground: the fill, the perspective grid, the horizon line and the ripple
// ---------------------------------------------------------------------------------------------

const G = S.ground;

export const GROUND_FRAGMENT = `${HEADER}${SCREEN}
${consts({
  LINES: G.lines,
  SPACING: G.bottomSpacing,
  ROWS: G.rows,
  ROW_STEP: G.rowStep,
  LINE_ALPHA: G.lineAlpha,
  ROW_FADE: G.rowFade,
  HORIZON_ALPHA: G.horizonAlpha,
  LINE_W: G.lineWidth,
  EDGE: G.edge,
  RIPPLE_WIDTH: SKY.ripple.width,
  RIPPLE_ASPECT: SKY.ripple.aspect,
  RIPPLE_ALPHA: SKY.ripple.opacity,
  RIPPLE_LINE: SKY.ripple.lineWidth,
  RIPPLE_MIN: SKY.ripple.minRadius,
})}
uniform float uWidth;
uniform float uHeight;
uniform float uHorizon;
uniform vec3 uFill;
uniform vec3 uLine;
uniform float uVanish;
uniform float uPhase;
uniform vec4 uRipple;
out vec4 fragColor;

// The share of device pixel row [p, p + 1) that the band [b0, b1) covers.
float cover(float p, float b0, float b1) {
  return clamp(min(p + 1.0, b1) - max(p, b0), 0.0, 1.0);
}

void main() {
  vec2 css = cssOf(gl_FragCoord.xy);
  if (css.y < uHorizon) discard;
  vec3 col = uFill;
  float dpr = uScale.x;
  float dy = uScale.y;
  float depth = uHeight - uHorizon;
  float t = (css.y - uHorizon) / depth;

  // Lines from the vanishing point to the bottom edge, opening from clear at the horizon.
  float spacing = uWidth * SPACING;
  if (t > 0.0) {
    float fi = ((css.x - uVanish) / t + uVanish - 0.5 * uWidth) / spacing;
    float i0 = floor(fi);
    for (int j = -1; j <= 2; j++) {
      float i = i0 + float(j);
      if (abs(i) > LINES) continue;
      float xb = 0.5 * uWidth + i * spacing;
      float dx = css.x - (uVanish + (xb - uVanish) * t);
      float dist = abs(dx) * depth / length(vec2(xb - uVanish, depth));
      float c = clamp(0.5 * LINE_W * dpr + 0.5 - dist * dpr, 0.0, 1.0);
      col = mix(col, uLine, c * LINE_ALPHA * t);
    }
  }

  // Rows: z = 1 + k ROW_STEP - phase, at y = horizon + depth / z, fading toward the horizon.
  // Each row is LINE_W px from its top, set on the device pixel grid.
  float py = uRes.y - gl_FragCoord.y - 0.5;
  float yHi = css.y + 1.0 / dy;
  float yLo = css.y - 1.0 / dy - LINE_W;
  float kFrom = (depth / max(yHi - uHorizon, 0.0001) - 1.0 + uPhase) / ROW_STEP;
  float kTo = yLo > uHorizon ? (depth / (yLo - uHorizon) - 1.0 + uPhase) / ROW_STEP : ROWS - 1.0;
  int k0 = int(max(0.0, ceil(kFrom)));
  int k1 = int(min(ROWS - 1.0, floor(kTo)));
  for (int j = 0; j < 8; j++) {
    int k = k0 + j;
    if (k > k1) break;
    float z = 1.0 + float(k) * ROW_STEP - uPhase;
    float y = uHorizon + depth / z;
    if (y > uHeight + EDGE || y < uHorizon + EDGE) continue;
    float a = LINE_ALPHA * min(1.0, (y - uHorizon) / (depth * ROW_FADE));
    float b0 = floor(y * dy + 0.5);
    col = mix(col, uLine, cover(py, b0, b0 + LINE_W * dy) * a);
  }

  // The horizon line.
  float h0 = floor(uHorizon * dy + 0.5);
  col = mix(col, uLine, cover(py, h0, h0 + LINE_W * dy) * HORIZON_ALPHA);

  // The ripple: an ellipse growing from the click point, under the horizon line's pixel row.
  if (uRipple.w > 0.5 && css.y >= uHorizon + EDGE) {
    vec2 centre = vec2(uRipple.x, max(uRipple.y, uHorizon));
    float rx = max(RIPPLE_MIN, uRipple.z * uWidth * RIPPLE_WIDTH);
    vec2 R = vec2(rx, max(RIPPLE_MIN, rx * RIPPLE_ASPECT));
    vec2 q = css - centre;
    float k0e = length(q / R);
    float k1e = length(q / (R * R));
    float d = k1e > 0.0 ? k0e * (k0e - 1.0) / k1e : min(R.x, R.y);
    float c = clamp(0.5 * RIPPLE_LINE * dpr + 0.5 - abs(d) * dpr, 0.0, 1.0);
    col = mix(col, uLine, c * RIPPLE_ALPHA * (1.0 - uRipple.z));
  }
  fragColor = vec4(col, 1.0);
}
`;
