/**
 * The hero model's light (DESIGN_DIRECTION.md 6.1: "lit by the sky itself"; ARCHITECTURE.md 13A:
 * "an environment map taken from the sky scene"): a sky dome whose colors come from the page
 * (palette.ts `sky`: the canvas's face colors for a solid in front of the sky, from the zenith's
 * cool light overhead to the dark below the horizon), prefiltered once into an environment map
 * for the model's physically based materials. It reflects in metal and lights every face as the
 * sky behind it would. No face takes the thermal ramp: the ramp belongs to the Thermal view.
 *
 * Built again only when the colors change (the theme toggle); nothing here runs per frame.
 */
import {
  BackSide,
  Color,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import type { Rgb, SkyLight } from './palette';

const VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Overhead light at the top, the horizon's light around the middle, the dark below. */
const FRAGMENT = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uSide;
  uniform vec3 uLow;
  uniform float uGain;
  varying vec3 vDirection;
  void main() {
    float y = normalize(vDirection).y;
    vec3 color = y >= 0.0 ? mix(uSide, uTop, smoothstep(0.0, 0.75, y)) : mix(uSide, uLow, smoothstep(0.0, 0.35, -y));
    gl_FragColor = vec4(color * uGain, 1.0);
  }
`;

/** The dome's radius: well inside the cube camera's far plane and outside its near one. */
const DOME_RADIUS = 10;

/**
 * The page's colors say how a light-gray solid looks in front of the sky, face by face; a light is
 * what makes a surface look so. A physically based light-gray surface (albedo about 0.35 in linear
 * light, partly metal) gives back about a quarter of the light that falls on it, so the dome shines
 * four times as bright as the colors it is drawn from: a light-gray part facing up then shows the
 * canvas's top-face color, darker parts and the sides less, and metal reflects a sky that bright.
 */
export const SKY_LIGHT_GAIN = 4;

/** A page color as the linear light the environment holds. */
function linear(rgb: Rgb): Color {
  return new Color().setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace);
}

/** The environment for the hero's Realistic view. The caller owns the result and disposes it. */
export function createSkyEnvironment(gl: WebGLRenderer, sky: SkyLight): WebGLRenderTarget {
  const material = new ShaderMaterial({
    uniforms: {
      uTop: { value: linear(sky.top) },
      uSide: { value: linear(sky.side) },
      uLow: { value: linear(sky.low) },
      uGain: { value: SKY_LIGHT_GAIN },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: BackSide,
    depthWrite: false,
  });
  const geometry = new SphereGeometry(DOME_RADIUS, 48, 24);
  const scene = new Scene();
  scene.add(new Mesh(geometry, material));
  const pmrem = new PMREMGenerator(gl);
  try {
    return pmrem.fromScene(scene, 0);
  } finally {
    pmrem.dispose();
    geometry.dispose();
    material.dispose();
  }
}
